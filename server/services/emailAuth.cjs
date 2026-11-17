const crypto = require("node:crypto");
const rateLimit = require("express-rate-limit");
const QRCode = require("qrcode");

const { setting, enabled } = require("../config.cjs");
const { secretKey, seal, unseal } = require("./secretBox.cjs");
const totp = require("./totp.cjs");
const mail = require("./mail.cjs");
const privacy = require("./privacy.cjs");
const { httpError } = require("./http.cjs");

/*
 * Logging in with a verified email and a password, and two-factor
 * protection for those logins. Accounts are only ever created with Discord;
 * this is a second way into an existing account. Discord logins never ask
 * for these second factors (Discord handles that).
 *
 * Account (logged in):
 *   GET    /account/security                    what is set up
 *   POST   /account/email/verify     { code }   confirms the email from PATCH /account/email
 *   POST   /account/password/start              emails a code to confirm a password change
 *   POST   /account/password  { password, code }
 *   DELETE /account/password
 *   POST   /account/2fa/email     { enabled }
 *   POST   /account/2fa/totp/start              secret + QR code
 *   POST   /account/2fa/totp/confirm  { code }
 *   DELETE /account/2fa/totp
 *   POST   /account/2fa/passkey/options
 *   POST   /account/2fa/passkey/verify { response, name }
 *   DELETE /account/2fa/passkey/:id
 * Login (logged out):
 *   GET    /auth/email                          whether email logins are available
 *   POST   /auth/email/login   { email, password } -> session, or { ticket, methods }
 *   POST   /auth/email/2fa/send     { ticket }       an email code
 *   POST   /auth/email/2fa/options  { ticket }       passkey options
 *   POST   /auth/email/2fa  { ticket, method, code | response, trust }  (trust: skip this step for 30 days here)
 *   POST   /auth/email/reset/start  { email }        (same answer whether it exists or not)
 *   POST   /auth/email/reset   { email, code, password }
 *
 * Security: scrypt password hashes; one-time codes stored as HMACs, 10
 * minutes, 5 tries; authenticator secrets encrypted (AES-256-GCM, key from
 * the server's internal key); login tickets in memory for 5 minutes; strict
 * rate limits; the same error for unknown emails and wrong passwords.
 * Mutations go through the account API's Origin + CSRF header check.
 */

const CODE_TTL_MS = 10 * 60_000;
const CODE_TRIES = 5;
const TICKET_TTL_MS = 5 * 60_000;
const PASSWORD_MIN = 10;
const PASSWORD_MAX = 200;
const MAX_PASSKEYS = 10;
const LOCK_AFTER = 8; // wrong passwords in a row -> 15 minutes locked
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

const nowIso = () => new Date().toISOString();

/* ---------- small crypto helpers ---------- */

const codeHmac = (purpose, subject, code) => crypto.createHmac("sha256", secretKey()).update(`${purpose}:${subject}:${code}`).digest("hex");

const scrypt = (password, salt) =>
  new Promise((resolve, reject) => crypto.scrypt(password.normalize("NFKC"), salt, 64, SCRYPT, (error, key) => (error ? reject(error) : resolve(key))));

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${SCRYPT.N}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

// Compared against when the email is unknown, so both cases take the same time.
let dummyHash = null;
async function checkPassword(password, stored) {
  dummyHash ??= await hashPassword(crypto.randomBytes(16).toString("hex"));
  const [, , salt, key] = String(stored || dummyHash).split("$");
  const expected = Buffer.from(key, "base64url");
  const actual = await scrypt(String(password), Buffer.from(salt, "base64url"));
  return Boolean(stored) && actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

const randomCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

function validPassword(password) {
  const text = String(password ?? "");
  if (text.length < PASSWORD_MIN) throw httpError(400, `Use at least ${PASSWORD_MIN} characters.`);
  if (text.length > PASSWORD_MAX) throw httpError(400, "That password is too long.");
  if (new Set(text).size < 4) throw httpError(400, "That password is too simple.");
  return text;
}

function route(handler) {
  return async (req, res) => {
    try {
      const result = await handler(req, res);
      if (!res.headersSent) res.json(result ?? { ok: true });
    } catch (error) {
      const status = error.status ?? 500;
      if (status >= 500 && !error.status) console.error("[EmailAuth]", error);
      if (!res.headersSent) res.status(status).json({ error: status >= 500 && !error.status ? "Something went wrong." : error.message, ...(error.extra ?? {}) });
    }
  };
}

function registerEmailAuth(app, { requireStorage, getRequestSession, getDatabase, activity, startSession, fetchGuildMember, isBanned = () => false }) {
  let ready = false;
  const db = () => {
    const handle = getDatabase();
    if (!handle) throw httpError(503, "Accounts are not available.");
    if (!ready) {
      const columns = new Set(handle.prepare("PRAGMA table_info(users)").all().map((column) => column.name));
      const add = (name, definition) => !columns.has(name) && handle.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
      add("email_verified_at", "TEXT");
      add("password_hash", "TEXT");
      add("twofa_json", "TEXT NOT NULL DEFAULT '{}'");
      add("login_failures", "INTEGER NOT NULL DEFAULT 0");
      add("locked_until", "TEXT");
      handle.exec(`
        CREATE TABLE IF NOT EXISTS account_codes (
          user_id TEXT NOT NULL,
          purpose TEXT NOT NULL,
          code_hash TEXT NOT NULL,
          payload TEXT,
          expires_at TEXT NOT NULL,
          tries INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, purpose)
        );
      `);
      ready = true;
    }
    return handle;
  };
  for (const delay of [700, 3500]) setTimeout(() => {
    try {
      db();
    } catch {
      // storage not ready yet
    }
  }, delay).unref();

  const log = (entry) => activity?.append(entry);
  const actorOf = (user) => ({ discordId: user.discord_user_id, name: user.display_name || user.username });
  const userById = (id) => db().prepare("SELECT * FROM users WHERE id = ?").get(id);
  const twofaOf = (user) => {
    try {
      const data = JSON.parse(user.twofa_json || "{}");
      return { email: Boolean(data.email), totp: data.totp ?? null, passkeys: Array.isArray(data.passkeys) ? data.passkeys : [] };
    } catch {
      return { email: false, totp: null, passkeys: [] };
    }
  };
  const saveTwofa = (userId, data) => db().prepare("UPDATE users SET twofa_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(data), nowIso(), userId);
  const methodsOf = (user) => {
    const data = twofaOf(user);
    return [...(data.email && user.email_verified_at && mail.available() ? ["email"] : []), ...(data.totp?.confirmed ? ["totp"] : []), ...(data.passkeys.length ? ["passkey"] : [])];
  };
  const requireUser = (req) => {
    const session = getRequestSession(req);
    if (!session) throw httpError(401, "Log in first.");
    const user = userById(session.user_id);
    if (!user) throw httpError(401, "Log in first.");
    return user;
  };

  /* ----- one-time codes ----- */

  /* "Something changed about logging in" emails, with "Wasn't you? Reset your password". */
  const securityMail = (userId, kind, values = {}) => {
    const fresh = userById(userId);
    if (fresh) mail.sendSecurity({ user: fresh, kind, values }).catch(() => {});
  };

  // Which email texts (src/locales/<language>/email.json) a code purpose uses.
  const MAIL_PURPOSE = { "verify-email": "verify", "set-password": "password", login: "login", reset: "reset" };

  async function issueCode(user, purpose, { to = user.email, payload = null } = {}) {
    const code = randomCode();
    db()
      .prepare("INSERT OR REPLACE INTO account_codes (user_id, purpose, code_hash, payload, expires_at, tries) VALUES (?, ?, ?, ?, ?, 0)")
      .run(user.id, purpose, codeHmac(purpose, user.id, code), payload, new Date(Date.now() + CODE_TTL_MS).toISOString());
    // In the member's language and look, greeting them by name.
    await mail.sendCode({ to, user, purpose: MAIL_PURPOSE[purpose] ?? "test", code });
  }

  /** Checks a code; returns its payload. Wrong / expired / too many tries all fail the same way. */
  function useCode(user, purpose, code) {
    const row = db().prepare("SELECT * FROM account_codes WHERE user_id = ? AND purpose = ?").get(user.id, purpose);
    const clean = String(code ?? "").replace(/\s/g, "");
    if (!row || Date.parse(row.expires_at) < Date.now() || row.tries >= CODE_TRIES) throw httpError(400, "That code is wrong or expired. Ask for a new one.");
    const expected = Buffer.from(row.code_hash, "hex");
    const actual = Buffer.from(codeHmac(purpose, user.id, clean), "hex");
    if (!/^\d{6}$/.test(clean) || !crypto.timingSafeEqual(expected, actual)) {
      db().prepare("UPDATE account_codes SET tries = tries + 1 WHERE user_id = ? AND purpose = ?").run(user.id, purpose);
      throw httpError(400, "That code is wrong or expired. Ask for a new one.");
    }
    db().prepare("DELETE FROM account_codes WHERE user_id = ? AND purpose = ?").run(user.id, purpose);
    return row.payload;
  }

  const limiter = (windowMinutes, limit, message = "Too many tries. Wait a little and try again.") =>
    rateLimit({ windowMs: windowMinutes * 60_000, limit, standardHeaders: "draft-8", legacyHeaders: false, message: { error: message } });
  const codeLimiter = limiter(15, 6, "Too many codes asked for. Wait a few minutes.");
  const loginLimiter = limiter(15, 15);
  const secondLimiter = limiter(15, 20);
  const accountLimiter = limiter(1, 30);

  /* ----- passkeys (WebAuthn) ----- */

  let webauthn = null;
  const passkeyLib = async () => (webauthn ??= await import("@simplewebauthn/server"));
  /* The site's origin (already checked against the allowed ones by the CSRF middleware) and its host as RP ID. */
  const relyingParty = (req) => {
    const origin = req.get("Origin");
    if (!origin) throw httpError(400, "Missing origin.");
    return { origin, rpID: new URL(origin).hostname };
  };
  const challenges = new Map(); // key -> { challenge, expires }
  const remember = (key, challenge) => {
    for (const [entry, value] of challenges) if (value.expires < Date.now()) challenges.delete(entry);
    challenges.set(key, { challenge, expires: Date.now() + TICKET_TTL_MS });
  };
  const recall = (key) => {
    const value = challenges.get(key);
    challenges.delete(key);
    if (!value || value.expires < Date.now()) throw httpError(400, "That took too long. Try again.");
    return value.challenge;
  };

  /* ----- logged in: what's set up ----- */

  app.get(
    "/account/security",
    accountLimiter,
    requireStorage,
    route(async (req, res) => {
      res.set("Cache-Control", "no-store");
      const user = requireUser(req);
      const data = twofaOf(user);
      return {
        email: user.email ?? null,
        emailVerified: Boolean(user.email && user.email_verified_at),
        mailAvailable: mail.available(),
        hasPassword: Boolean(user.password_hash),
        twofa: {
          email: data.email,
          totp: Boolean(data.totp?.confirmed),
          passkeys: data.passkeys.map((key) => ({ id: key.id, name: key.name, addedAt: key.addedAt })),
        },
      };
    }),
  );

  /* Called by PATCH /account/email (members.cjs) when mail works: the new address waits for its code. */
  const verifySends = new Map(); // userId -> send times (no email bombing through this route)
  async function startEmailChange(user, email) {
    const now = Date.now();
    const recent = (verifySends.get(user.id) ?? []).filter((at) => now - at < 60 * 60_000);
    if (recent.length && now - recent.at(-1) < 30_000) throw httpError(429, "A code is on its way. Wait half a minute before asking for another one.");
    if (recent.length >= 5) throw httpError(429, "That's a lot of codes. Try again in an hour.");
    verifySends.set(user.id, [...recent, now]);
    await issueCode(user, "verify-email", { to: email, payload: email });
  }

  app.post(
    "/account/email/verify",
    secondLimiter,
    requireStorage,
    route(async (req) => {
      const user = requireUser(req);
      const email = useCode(user, "verify-email", req.body?.code);
      if (!email || !EMAIL.test(email)) throw httpError(400, "That code is wrong or expired. Ask for a new one.");
      if (db().prepare("SELECT 1 FROM users WHERE email = ? AND id != ?").get(email, user.id)) throw httpError(409, "Another account uses that email.");
      db().prepare("UPDATE users SET email = ?, email_verified_at = ?, updated_at = ? WHERE id = ?").run(email, nowIso(), nowIso(), user.id);
      log({ level: "normal", action: "email-verified", actor: actorOf(user), summary: "verified an email address" });
      return { email, emailVerified: true };
    }),
  );

  /* ----- password ----- */

  app.post(
    "/account/password/start",
    codeLimiter,
    requireStorage,
    route(async (req) => {
      const user = requireUser(req);
      if (!user.email || !user.email_verified_at) throw httpError(400, "Verify an email first.");
      await issueCode(user, "set-password");
      return { sent: true };
    }),
  );

  app.post(
    "/account/password",
    secondLimiter,
    requireStorage,
    route(async (req) => {
      const user = requireUser(req);
      if (!user.email || !user.email_verified_at) throw httpError(400, "Verify an email first.");
      const password = validPassword(req.body?.password);
      useCode(user, "set-password", req.body?.code);
      db().prepare("UPDATE users SET password_hash = ?, login_failures = 0, locked_until = NULL, updated_at = ? WHERE id = ?").run(await hashPassword(password), nowIso(), user.id);
      log({ level: "normal", action: "password-set", actor: actorOf(user), summary: "set a password for email logins" });
      securityMail(user.id, "passwordChanged");
      return { hasPassword: true };
    }),
  );

  app.delete(
    "/account/password",
    accountLimiter,
    requireStorage,
    route(async (req) => {
      const user = requireUser(req);
      db().prepare("UPDATE users SET password_hash = NULL, updated_at = ? WHERE id = ?").run(nowIso(), user.id);
      log({ level: "normal", action: "password-removed", actor: actorOf(user), summary: "removed the email login password" });
      securityMail(user.id, "passwordRemoved");
      return { hasPassword: false };
    }),
  );

  /* ----- second factors ----- */

  app.post(
    "/account/2fa/email",
    accountLimiter,
    requireStorage,
    route(async (req) => {
      const user = requireUser(req);
      const on = req.body?.enabled === true;
      if (on && (!user.email_verified_at || !mail.available())) throw httpError(400, "Verify an email first.");
      saveTwofa(user.id, { ...twofaOf(user), email: on });
      log({ level: "normal", action: "2fa", actor: actorOf(user), summary: `${on ? "turned on" : "turned off"} email codes for email logins` });
      securityMail(user.id, "twoFactor", { change: on ? "email codes on" : "email codes off" });
      return { email: on };
    }),
  );

  app.post(
    "/account/2fa/totp/start",
    accountLimiter,
    requireStorage,
    route(async (req) => {
      const user = requireUser(req);
      const secret = totp.generateSecret();
      saveTwofa(user.id, { ...twofaOf(user), pendingTotp: seal(secret) });
      const issuer = encodeURIComponent(setting("BOT_DISPLAY_NAME") || "HomeSite");
      const uri = `otpauth://totp/${issuer}:${encodeURIComponent(user.username)}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
      return { secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
    }),
  );

  app.post(
    "/account/2fa/totp/confirm",
    secondLimiter,
    requireStorage,
    route(async (req) => {
      const user = requireUser(req);
      const data = JSON.parse(user.twofa_json || "{}");
      if (!data.pendingTotp) throw httpError(400, "Start again.");
      const secret = unseal(data.pendingTotp);
      const step = totp.verifyCode(secret, req.body?.code);
      if (step === null) throw httpError(400, "That code doesn't match. Check the time on your phone and try the next one.");
      delete data.pendingTotp;
      saveTwofa(user.id, { ...twofaOf(user), ...data, totp: { secret: seal(secret), confirmed: true, lastStep: step, addedAt: nowIso() } });
      log({ level: "normal", action: "2fa", actor: actorOf(user), summary: "added an authenticator app for email logins" });
      securityMail(user.id, "twoFactor", { change: "authenticator app added" });
      return { totp: true };
    }),
  );

  app.delete(
    "/account/2fa/totp",
    accountLimiter,
    requireStorage,
    route(async (req) => {
      const user = requireUser(req);
      saveTwofa(user.id, { ...twofaOf(user), totp: null });
      log({ level: "normal", action: "2fa", actor: actorOf(user), summary: "removed the authenticator app" });
      securityMail(user.id, "twoFactor", { change: "authenticator app removed" });
      return { totp: false };
    }),
  );

  app.post(
    "/account/2fa/passkey/options",
    accountLimiter,
    requireStorage,
    route(async (req) => {
      const user = requireUser(req);
      const data = twofaOf(user);
      if (data.passkeys.length >= MAX_PASSKEYS) throw httpError(400, "That's the most passkeys an account can have.");
      const { generateRegistrationOptions } = await passkeyLib();
      const { rpID } = relyingParty(req);
      const options = await generateRegistrationOptions({
        rpName: setting("BOT_DISPLAY_NAME") || "HomeSite",
        rpID,
        userName: user.username,
        userDisplayName: user.display_name,
        userID: new TextEncoder().encode(user.id),
        attestationType: "none",
        excludeCredentials: data.passkeys.map((key) => ({ id: key.id, transports: key.transports })),
        // Discoverable (the device can offer it without an email first) and with the person checked: also good for logging in with the passkey alone.
        authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "preferred" },
      });
      remember(`register:${user.id}`, options.challenge);
      return options;
    }),
  );

  app.post(
    "/account/2fa/passkey/verify",
    accountLimiter,
    requireStorage,
    route(async (req) => {
      const user = requireUser(req);
      const { verifyRegistrationResponse } = await passkeyLib();
      const { origin, rpID } = relyingParty(req);
      const result = await verifyRegistrationResponse({
        response: req.body?.response,
        expectedChallenge: recall(`register:${user.id}`),
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: false,
      }).catch(() => ({ verified: false }));
      if (!result.verified) throw httpError(400, "That passkey couldn't be checked. Try again.");
      const credential = result.registrationInfo.credential;
      const data = twofaOf(user);
      const name = String(req.body?.name ?? "").trim().slice(0, 40) || `Passkey ${data.passkeys.length + 1}`;
      data.passkeys.push({ id: credential.id, publicKey: Buffer.from(credential.publicKey).toString("base64url"), counter: credential.counter, transports: credential.transports ?? [], rpID, name, addedAt: nowIso() });
      saveTwofa(user.id, data);
      log({ level: "normal", action: "2fa", actor: actorOf(user), summary: `added the passkey "${name}"` });
      securityMail(user.id, "twoFactor", { change: `passkey "${name}" added` });
      return { passkeys: data.passkeys.map((key) => ({ id: key.id, name: key.name, addedAt: key.addedAt })) };
    }),
  );

  app.delete(
    "/account/2fa/passkey/:id",
    accountLimiter,
    requireStorage,
    route(async (req) => {
      const user = requireUser(req);
      const data = twofaOf(user);
      data.passkeys = data.passkeys.filter((key) => key.id !== String(req.params.id));
      saveTwofa(user.id, data);
      log({ level: "normal", action: "2fa", actor: actorOf(user), summary: "removed a passkey" });
      securityMail(user.id, "twoFactor", { change: "passkey removed" });
      return { passkeys: data.passkeys.map((key) => ({ id: key.id, name: key.name, addedAt: key.addedAt })) };
    }),
  );

  /* "Firefox on Linux" from a User-Agent (only for the email, nothing is stored). */
  function browserName(agent = "") {
    const text = String(agent);
    const browser = /Edg\//.test(text) ? "Edge" : /OPR\//.test(text) ? "Opera" : /Firefox\//.test(text) ? "Firefox" : /Chrome\//.test(text) ? "Chrome" : /Safari\//.test(text) ? "Safari" : "a browser";
    const system = /Android/.test(text) ? "Android" : /iPhone|iPad/.test(text) ? "iOS" : /Windows/.test(text) ? "Windows" : /Mac OS X/.test(text) ? "macOS" : /Linux/.test(text) ? "Linux" : "an unknown system";
    return `${browser}, ${system}`;
  }

  /* ----- trusted devices: no second step for 30 days on a browser that passed it ----- */

  /*
   * After the second step, the browser may be trusted (checkbox, on by
   * default). The cookie holds `userId.expires.mac`; the MAC covers the
   * password hash and the account's 2FA methods, so changing either (or a
   * password reset) ends the trust everywhere. The password is still needed.
   */
  const TRUST_COOKIE = "__Secure-homesite_trust";
  const TRUST_MS = 30 * 86_400_000;
  const trustMac = (user, expires) => crypto.createHmac("sha256", secretKey()).update(`trust:${user.id}:${expires}:${user.password_hash}:${methodsOf(user).join(",")}`).digest("base64url");

  function trusted(req, user) {
    const [userId, expires, mac] = String(req.cookies?.[TRUST_COOKIE] ?? "").split(".");
    if (userId !== user.id || !(Number(expires) > Date.now()) || !mac) return false;
    const expected = Buffer.from(trustMac(user, expires));
    const given = Buffer.from(mac);
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
  }

  function trustBrowser(res, user) {
    const expires = String(Date.now() + TRUST_MS);
    res.cookie(TRUST_COOKIE, `${user.id}.${expires}.${trustMac(user, expires)}`, { httpOnly: true, secure: true, sameSite: "strict", path: "/auth/email", maxAge: TRUST_MS });
  }

  /* ----- logging in with email ----- */

  const tickets = new Map(); // ticket -> { userId, expires, tries }
  function newTicket(userId) {
    for (const [ticket, value] of tickets) if (value.expires < Date.now()) tickets.delete(ticket);
    const ticket = crypto.randomBytes(24).toString("base64url");
    tickets.set(ticket, { userId, expires: Date.now() + TICKET_TTL_MS, tries: 0 });
    return ticket;
  }
  function ticketUser(ticket) {
    const value = tickets.get(String(ticket ?? ""));
    if (!value || value.expires < Date.now() || value.tries >= CODE_TRIES) {
      tickets.delete(String(ticket ?? ""));
      throw httpError(401, "That took too long. Log in again.");
    }
    const user = userById(value.userId);
    if (!user) throw httpError(401, "Log in again.");
    return { user, value };
  }

  /* Only server members (like the Discord login), never accounts deleted < 13 days ago. */
  async function mayLogIn(user) {
    if (privacy.isHidden(user.discord_user_id) || isBanned(user.discord_user_id)) return false;
    const owner = user.discord_user_id === setting("DISCORD_USER_ID");
    if (owner || !enabled("MEMBERS_ONLY_LOGIN") || !process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_GUILD_ID) return true;
    const member = await fetchGuildMember(user.discord_user_id).catch(() => undefined);
    return member !== null;
  }

  function finish(req, res, user, how) {
    db().prepare("UPDATE users SET login_failures = 0, locked_until = NULL, last_login_at = ? WHERE id = ?").run(nowIso(), user.id);
    // A browser that isn't trusted yet: tell the owner of the address (with a way out if it wasn't them).
    if (how !== "trusted device") securityMail(user.id, "newBrowser", { browser: browserName(req.get("User-Agent")) });
    startSession(res, req, user.id);
    log({ level: "normal", action: "login", actor: actorOf(user), summary: `logged in with email${how ? ` (${how})` : ""}` });
    return { ok: true };
  }

  app.get(
    "/auth/email",
    accountLimiter,
    route(async (_req, res) => {
      res.set("Cache-Control", "no-store");
      // available: email + password logins; passkeys: logging in with a passkey alone (always, see below).
      return { available: mail.available(), passkeys: true };
    }),
  );

  app.post(
    "/auth/email/login",
    loginLimiter,
    requireStorage,
    route(async (req, res) => {
      if (!mail.available()) throw httpError(503, "Email logins aren't set up on this site.");
      const email = String(req.body?.email ?? "").trim().toLowerCase();
      const password = String(req.body?.password ?? "").slice(0, PASSWORD_MAX);
      const user = EMAIL.test(email) ? db().prepare("SELECT * FROM users WHERE email = ? AND email_verified_at IS NOT NULL").get(email) : null;
      const wrong = () => httpError(401, "That email and password don't match.");
      if (user?.locked_until && Date.parse(user.locked_until) > Date.now()) throw httpError(429, "Too many wrong passwords. Try again in 15 minutes, or log in with Discord.");
      if (!(await checkPassword(password, user?.password_hash))) {
        if (user) {
          const failures = (user.login_failures ?? 0) + 1;
          db().prepare("UPDATE users SET login_failures = ?, locked_until = ? WHERE id = ?").run(failures, failures >= LOCK_AFTER ? new Date(Date.now() + 15 * 60_000).toISOString() : null, user.id);
        }
        throw wrong();
      }
      if (!(await mayLogIn(user))) throw httpError(403, "Only members of the server can log in.");
      const methods = methodsOf(user);
      if (!methods.length) return finish(req, res, user, null);
      if (trusted(req, user)) return finish(req, res, user, "trusted device");
      return { twoFactor: true, ticket: newTicket(user.id), methods };
    }),
  );

  app.post(
    "/auth/email/2fa/send",
    codeLimiter,
    requireStorage,
    route(async (req) => {
      const { user } = ticketUser(req.body?.ticket);
      if (!methodsOf(user).includes("email")) throw httpError(400, "Email codes aren't on for this account.");
      await issueCode(user, "login");
      return { sent: true };
    }),
  );

  app.post(
    "/auth/email/2fa/options",
    secondLimiter,
    requireStorage,
    route(async (req) => {
      const { user } = ticketUser(req.body?.ticket);
      const { passkeys } = twofaOf(user);
      if (!passkeys.length) throw httpError(400, "No passkeys on this account.");
      const { generateAuthenticationOptions } = await passkeyLib();
      const { rpID } = relyingParty(req);
      const options = await generateAuthenticationOptions({ rpID, allowCredentials: passkeys.map((key) => ({ id: key.id, transports: key.transports })), userVerification: "preferred" });
      remember(`login:${req.body.ticket}`, options.challenge);
      return options;
    }),
  );

  app.post(
    "/auth/email/2fa",
    secondLimiter,
    requireStorage,
    route(async (req, res) => {
      const { user, value } = ticketUser(req.body?.ticket);
      const method = String(req.body?.method ?? "");
      if (!methodsOf(user).includes(method)) throw httpError(400, "Pick one of your methods.");
      value.tries += 1;
      if (method === "email") {
        useCode(user, "login", req.body?.code);
      } else if (method === "totp") {
        const data = twofaOf(user);
        const step = totp.verifyCode(unseal(data.totp.secret), req.body?.code);
        // A code works once (no replay within its 30 s).
        if (step === null || step <= (data.totp.lastStep ?? -1)) throw httpError(400, "That code doesn't match.");
        saveTwofa(user.id, { ...data, totp: { ...data.totp, lastStep: step } });
      } else {
        const data = twofaOf(user);
        const response = req.body?.response;
        const key = data.passkeys.find((entry) => entry.id === response?.id);
        if (!key) throw httpError(400, "That passkey isn't on this account.");
        const { verifyAuthenticationResponse } = await passkeyLib();
        const { origin, rpID } = relyingParty(req);
        const result = await verifyAuthenticationResponse({
          response,
          expectedChallenge: recall(`login:${req.body.ticket}`),
          expectedOrigin: origin,
          expectedRPID: rpID,
          credential: { id: key.id, publicKey: Buffer.from(key.publicKey, "base64url"), counter: key.counter, transports: key.transports },
          requireUserVerification: false,
        }).catch(() => ({ verified: false }));
        if (!result.verified) throw httpError(400, "That passkey couldn't be checked.");
        key.counter = result.authenticationInfo.newCounter;
        saveTwofa(user.id, data);
      }
      tickets.delete(String(req.body.ticket));
      if (req.body?.trust !== false) trustBrowser(res, userById(user.id) ?? user);
      return finish(req, res, user, method === "totp" ? "authenticator" : method);
    }),
  );

  /* ----- logging in with a passkey alone ----- */

  /*
   * Passwordless: the browser / phone / password manager offers the passkeys
   * it has for this site (also as autofill on the email field), without an
   * email or password first. The passkey must check the person
   * (fingerprint, face, PIN: userVerification required), which makes it two
   * factors in one, so no second step follows. The account is found by the
   * passkey's id (and its user handle must match); the same rules as every
   * login apply (members only, bans, the lock after wrong tries).
   */
  function passkeyOwner(credentialId) {
    // A quick pre-filter (LIKE with _ and % escaped), then the exact match below.
    const pattern = `%${credentialId.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    const rows = db().prepare("SELECT * FROM users WHERE twofa_json IS NOT NULL AND twofa_json LIKE ? ESCAPE '\\'").all(pattern);
    for (const user of rows) {
      const data = twofaOf(user);
      const key = data.passkeys.find((entry) => entry.id === credentialId);
      if (key) return { user, data, key };
    }
    return null;
  }

  app.post(
    "/auth/email/passkey/options",
    loginLimiter,
    requireStorage,
    route(async (req) => {
      const { generateAuthenticationOptions } = await passkeyLib();
      const { rpID } = relyingParty(req);
      const options = await generateAuthenticationOptions({ rpID, allowCredentials: [], userVerification: "required" });
      const flow = crypto.randomBytes(18).toString("base64url");
      remember(`passkey:${flow}`, options.challenge);
      return { flow, options };
    }),
  );

  app.post(
    "/auth/email/passkey",
    loginLimiter,
    requireStorage,
    route(async (req, res) => {
      const response = req.body?.response;
      const credentialId = typeof response?.id === "string" ? response.id : "";
      const expectedChallenge = recall(`passkey:${String(req.body?.flow ?? "")}`);
      if (!/^[A-Za-z0-9_-]{16,1024}$/.test(credentialId)) throw httpError(400, "That passkey couldn't be checked.");
      const found = passkeyOwner(credentialId);
      if (!found) throw httpError(400, "This passkey isn't linked to an account here. Log in another way, then add it in Settings → Email & login.");
      const { user, data, key } = found;
      // The user handle the passkey was made with is the account id.
      const handle = response?.response?.userHandle;
      if (handle && Buffer.from(handle, "base64url").toString("utf8") !== user.id) throw httpError(400, "That passkey couldn't be checked.");
      if (user.locked_until && Date.parse(user.locked_until) > Date.now()) throw httpError(429, "Too many wrong tries. Try again in 15 minutes, or log in with Discord.");
      const { verifyAuthenticationResponse } = await passkeyLib();
      const { origin, rpID } = relyingParty(req);
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: { id: key.id, publicKey: Buffer.from(key.publicKey, "base64url"), counter: key.counter, transports: key.transports },
        requireUserVerification: true,
      }).catch(() => ({ verified: false }));
      if (!result.verified) throw httpError(400, "That passkey couldn't be checked.");
      if (!(await mayLogIn(user))) throw httpError(403, "Only members of the server can log in.");
      key.counter = result.authenticationInfo.newCounter;
      key.lastUsedAt = nowIso();
      saveTwofa(user.id, data);
      return finish(req, res, user, "passkey");
    }),
  );

  /* ----- forgot the password ----- */

  app.post(
    "/auth/email/reset/start",
    codeLimiter,
    requireStorage,
    route(async (req) => {
      const email = String(req.body?.email ?? "").trim().toLowerCase();
      const user = EMAIL.test(email) ? db().prepare("SELECT * FROM users WHERE email = ? AND email_verified_at IS NOT NULL").get(email) : null;
      // The same answer either way: nobody can test which emails have accounts.
      if (user && mail.available()) await issueCode(user, "reset").catch(() => {});
      return { sent: true };
    }),
  );

  app.post(
    "/auth/email/reset",
    secondLimiter,
    requireStorage,
    route(async (req) => {
      const email = String(req.body?.email ?? "").trim().toLowerCase();
      const user = EMAIL.test(email) ? db().prepare("SELECT * FROM users WHERE email = ? AND email_verified_at IS NOT NULL").get(email) : null;
      if (!user) throw httpError(400, "That code is wrong or expired. Ask for a new one.");
      const password = validPassword(req.body?.password);
      useCode(user, "reset", req.body?.code);
      db().prepare("UPDATE users SET password_hash = ?, login_failures = 0, locked_until = NULL, updated_at = ? WHERE id = ?").run(await hashPassword(password), nowIso(), user.id);
      log({ level: "normal", action: "password-reset", actor: actorOf(user), summary: "reset the email login password" });
      securityMail(user.id, "passwordReset");
      // The second factor (if any) is still asked at the next login.
      return { ok: true };
    }),
  );

  return { startEmailChange, mailAvailable: () => mail.available() };
}

module.exports = { registerEmailAuth };
