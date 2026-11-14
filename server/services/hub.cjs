const crypto = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const rateLimit = require("express-rate-limit");

const { setting, number, origin } = require("../config.cjs");
const { twoFactorEnabled, checkTwoFactor } = require("./totp.cjs");
const { adminKeyMatches } = require("./discordOAuth.cjs");
const { getInternalKey, getBotInternalUrl } = require("./internalKey.cjs");
const backup = require("./backup.cjs");
const hubLogs = require("./hubLogs.cjs");
const { createHubDb } = require("./hubDb.cjs");
const { registerTerminal, attachTerminalSockets, terminalEnabled } = require("./hubTerminal.cjs");

/*
 * /hub (account API): one place for members, live activity, bot commands,
 * logs, the database, settings and a server terminal.
 *
 * Access: HUB_KEY (config/settings.cjs), plus a 2FA code when ADMIN_2FA is
 * on. With 2FA on, the admin key (ADMIN_KEY) + a code works as well. Logging in sets the __Secure-homesite_hub cookie (for the parent
 * domain, AUTH_COOKIE_DOMAIN), so the profile API's /<id>-ui pages accept it
 * too (they check it with GET /hub/session). Not the admin key.
 *
 * Sessions are stored hashed in db/hub-sessions.json (not backed up) and
 * never bound to an IP, so switching networks or VPNs keeps you logged in.
 *
 * The site owner (DISCORD_USER_ID) logged in on the website with Discord
 * counts as logged in to the hub as well, without the key. With 2FA on, the
 * hub still asks that login for one code (then it gets a normal hub
 * session), so a stolen Discord session alone never opens the terminal.
 */

const COOKIE = "__Secure-homesite_hub";
const SESSIONS_FILE = path.join(__dirname, "db", "hub-sessions.json");
const AUTH_COOKIE_DOMAIN = setting("AUTH_COOKIE_DOMAIN") || undefined;

const ttlMs = () => Math.max(1, number("HUB_SESSION_TTL_HOURS") || 12) * 60 * 60 * 1000;
const hubKey = () => String(setting("HUB_KEY") || "");
const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest();
const tokenHash = (token) => sha256(token).toString("hex");

function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

function keyMatches(received) {
  const expected = hubKey();
  if (expected.length < 24 || typeof received !== "string" || !received) return false;
  return crypto.timingSafeEqual(sha256(expected), sha256(received));
}

/*
 * The visitor's IP, only for rate limits. CF-Connecting-IP is set by
 * Cloudflare and only trusted when the request comes from this machine
 * (cloudflared / a local reverse proxy); otherwise Express' req.ip ("trust
 * proxy" 1: the address the proxy saw). Never the first X-Forwarded-For
 * entry, which a client can make up.
 */
function clientIp(req) {
  const remote = req.socket?.remoteAddress ?? "";
  const local = /^(::1|127\.|::ffff:127\.)/.test(remote);
  const cloudflare = String(req.headers["cf-connecting-ip"] ?? "").trim();
  return (local && /^[0-9a-f:.]{3,45}$/i.test(cloudflare) && cloudflare) || req.ip || remote;
}

function readCookie(req, name) {
  if (req.cookies?.[name]) return req.cookies[name];
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/* ---------- sessions ---------- */

const sessions = (() => {
  let map = new Map();
  try {
    map = new Map(Object.entries(JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"))));
  } catch {
    // none yet
  }
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(SESSIONS_FILE), { recursive: true });
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(map)), { mode: 0o600 });
      } catch (error) {
        console.error("[Hub] Could not save sessions:", error.message);
      }
    }, 200);
  };
  return {
    create(info) {
      const token = crypto.randomBytes(32).toString("base64url");
      const now = Date.now();
      for (const [hash, entry] of map) if (entry.expiresAt < now) map.delete(hash);
      map.set(tokenHash(token), { id: crypto.randomBytes(6).toString("hex"), createdAt: now, lastSeen: now, expiresAt: now + ttlMs(), ...info });
      save();
      return token;
    },
    get(token) {
      if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const entry = map.get(tokenHash(token));
      if (!entry) return null;
      if (entry.expiresAt < Date.now()) {
        map.delete(tokenHash(token));
        save();
        return null;
      }
      if (Date.now() - entry.lastSeen > 60_000) {
        entry.lastSeen = Date.now();
        save();
      }
      return entry;
    },
    remove(token) {
      if (token && map.delete(tokenHash(token))) save();
    },
    clear() {
      map.clear();
      save();
    },
    list: () => [...map.values()].filter((entry) => entry.expiresAt > Date.now()),
  };
})();

const AUTH_COOKIE = "__Secure-homesite_auth";
let accountOf = () => null; // the website account session of a request (set by registerHub)

/** The owner's website session (logged in with Discord), else null. */
function ownerAccount(req) {
  const owner = setting("DISCORD_USER_ID");
  if (!owner) return null;
  // WebSocket upgrades don't pass through cookie-parser.
  if (!req.cookies) {
    const value = readCookie(req, AUTH_COOKIE);
    req.cookies = value ? { [AUTH_COOKIE]: value } : {};
  }
  const account = accountOf(req);
  return account?.discord_user_id === owner ? account : null;
}

function discordSession(account) {
  return {
    id: `discord-${account.session_id}`,
    name: account.display_name || account.username,
    discordId: account.discord_user_id,
    method: "Discord login",
    viaDiscord: true,
    expiresAt: Date.parse(account.expires_at) || Date.now() + ttlMs(),
  };
}

function authenticate(req) {
  if (!hubKey()) return null;
  const session = sessions.get(readCookie(req, COOKIE));
  if (session) return session;
  // Without 2FA the owner's Discord login is enough (with 2FA: one code via /hub/login).
  if (!twoFactorEnabled()) {
    const account = ownerAccount(req);
    if (account) return discordSession(account);
  }
  return null;
}

function requireHub(req) {
  if (!hubKey()) throw httpError(503, "The hub is off: set HUB_KEY in the settings (pnpm setup:gui) and restart the account API.", { locked: true });
  const session = authenticate(req);
  if (!session) throw httpError(401, "Log in to the hub first.", { locked: true });
  return session;
}

/* ---------- other services ---------- */

async function callBot(route, { method = "GET", body, timeout = 15_000 } = {}) {
  const key = getInternalKey();
  if (!key) throw httpError(503, "The bot's internal API needs DISCORD_BOT_TOKEN or INTERNAL_API_KEY.");
  let response;
  try {
    response = await fetch(`${getBotInternalUrl()}${route}`, {
      method,
      headers: { "X-Internal-Key": key, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    throw httpError(503, "The Discord bot is not reachable (is `pnpm bot` running?).");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw httpError(response.status, data?.error || `Bot request failed (${response.status}).`);
  return data;
}

const profileInternal = () => `http://127.0.0.1:${number("PORT") || 3001}`;

async function timed(run) {
  const started = Date.now();
  try {
    const data = await run();
    return { ok: true, ms: Date.now() - started, ...data };
  } catch (error) {
    return { ok: false, ms: Date.now() - started, error: error.message };
  }
}

async function health() {
  const memory = process.memoryUsage();
  const [bot, profile, site] = await Promise.all([
    timed(async () => {
      const data = await callBot("/health", { timeout: 5000 });
      return { ready: data.ready, ping: data.ping, uptimeMs: data.uptimeMs, memoryMb: data.memoryMb };
    }),
    timed(async () => {
      const response = await fetch(`${profileInternal()}/health`, { signal: AbortSignal.timeout(5000) });
      const data = await response.json();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { ready: data.discord_ready, tracking: data.activity_tracking_ready, uptimeMs: data.uptime_ms ?? null, memoryMb: data.memory_mb ?? null };
    }),
    timed(async () => {
      const target = origin("FRONTEND_ORIGIN");
      const response = await fetch(target, { method: "HEAD", signal: AbortSignal.timeout(6000) });
      if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
      return { status: response.status, url: target };
    }),
  ]);
  return {
    accounts: { ok: true, ms: 0, uptimeMs: Math.round(process.uptime() * 1000), memoryMb: Math.round(memory.rss / 1024 / 1024), node: process.version },
    bot,
    profile,
    site,
    checkedAt: new Date().toISOString(),
  };
}

/* ---------- routes ---------- */

function registerHub(app, { getRequestSession, toPublicUser, getDatabase, activity, allowedOrigins }) {
  // Who is acting, per request: the name saved with the hub login.
  accountOf = (req) => getRequestSession(req);
  const current = new AsyncLocalStorage();
  const log = (entry) => {
    const session = current.getStore();
    const actor = { discordId: session?.discordId ?? setting("DISCORD_USER_ID") ?? null, name: session?.name ?? "Owner" };
    return activity?.append({ actor, ...entry, details: { via: "hub", ...(entry.details ?? {}) } });
  };
  const hubDb = createHubDb({ getDatabase, log });

  // Website activity log entries for the live feed.
  const siteListeners = new Set();
  if (activity) {
    const original = activity.append.bind(activity);
    activity.append = (entry) => {
      const pending = original(entry);
      Promise.resolve(pending).then((saved) => saved && siteListeners.forEach((listener) => listener(saved)));
      return pending;
    };
  }

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 8,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => clientIp(req),
    validate: { keyGeneratorIpFallback: false },
    message: { error: "Too many attempts. Wait a few minutes." },
  });

  // Also a cap over everyone, against guessing from many addresses (VPNs, botnets).
  const globalLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: false,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: () => "everyone",
    validate: { keyGeneratorIpFallback: false },
    message: { error: "Too many failed hub logins right now. Wait a few minutes." },
  });

  const json = express.json({ limit: "512kb" });

  const route = (handler) => async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      req.hub = requireHub(req);
      const result = await current.run(req.hub, () => handler(req, res));
      if (result !== undefined && !res.headersSent) res.json(result);
    } catch (error) {
      const status = error.status ?? 500;
      if (status >= 500 && status !== 503) console.error("[Hub]", error);
      if (!res.headersSent) {
        res.status(status).json({
          error: status >= 500 && status !== 503 ? "Something went wrong." : error.message,
          ...(error.locked ? { locked: true } : {}),
          ...(error.twoFactor ? { twoFactor: true } : {}),
        });
      }
    }
  };

  const cookieOptions = () => ({
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    domain: AUTH_COOKIE_DOMAIN,
    maxAge: ttlMs(),
  });

  /* ----- login ----- */

  app.get("/hub/session", (req, res) => {
    res.set("Cache-Control", "no-store");
    const session = authenticate(req);
    const owner = ownerAccount(req);
    const base = {
      configured: Boolean(hubKey()),
      twoFactor: twoFactorEnabled(),
      adminKeyAllowed: twoFactorEnabled(),
      // Logged in on the site as the owner: only a 2FA code is missing.
      discordOwner: owner ? { name: owner.display_name || owner.username } : null,
    };
    if (!session) return res.status(401).json({ authenticated: false, ...base });
    return res.json({ authenticated: true, ...base, viaDiscord: Boolean(session.viaDiscord), expiresAt: new Date(session.expiresAt).toISOString(), terminal: terminalEnabled() });
  });

  app.post("/hub/login", globalLoginLimiter, loginLimiter, json, (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!hubKey()) return res.status(503).json({ error: "The hub is off: set HUB_KEY (pnpm setup:gui) and restart the account API." });
    // The hub key, (only together with 2FA) the admin key, or the owner's Discord login on the site.
    const owner = !req.body?.key ? ownerAccount(req) : null;
    const method = owner
      ? "Discord login"
      : keyMatches(req.body?.key)
        ? "hub key"
        : twoFactorEnabled() && adminKeyMatches(req.body?.key)
          ? "admin key"
          : null;
    if (!method) return res.status(403).json({ error: twoFactorEnabled() ? "Wrong key. Use the hub key or the admin key." : "Wrong hub key." });
    if (twoFactorEnabled() && !checkTwoFactor(req.body?.code, "hub")) {
      return res.status(403).json({ error: "Wrong or already used 2FA code.", twoFactor: true });
    }
    // Named after the Discord account logged in on the site, if any.
    const account = getRequestSession(req);
    const identity = { name: account?.display_name || account?.username || "Owner", discordId: account?.discord_user_id ?? null, method };
    const token = sessions.create({ ...identity, ua: String(req.get("User-Agent") ?? "").slice(0, 160), ip: clientIp(req) });
    res.cookie(COOKIE, token, cookieOptions());
    current.run(identity, () =>
      log({
        level: "normal",
        action: "hub-login",
        summary: `unlocked the hub with ${method === "Discord login" ? "their Discord login" : `the ${method}`}${twoFactorEnabled() ? " and 2FA" : ""}`,
        details: { ip: clientIp(req) },
      }),
    );
    return res.json({ authenticated: true, twoFactor: twoFactorEnabled(), expiresAt: new Date(Date.now() + ttlMs()).toISOString() });
  });

  app.post("/hub/logout", (req, res) => {
    sessions.remove(readCookie(req, COOKIE));
    const { maxAge: _maxAge, ...options } = cookieOptions();
    res.clearCookie(COOKIE, options);
    res.json({ ok: true });
  });

  app.post(
    "/hub/logout-everywhere",
    route(() => {
      sessions.clear();
      log({ level: "normal", action: "hub-logout-all", summary: "signed every device out of the hub" });
      return { ok: true };
    }),
  );

  /* ----- overview ----- */

  app.get(
    "/hub/overview",
    route(async (req) => {
      const [discord, services] = await Promise.all([callBot("/hub/overview", { timeout: 40_000 }).catch((error) => ({ error: error.message })), health()]);
      const account = getRequestSession(req);
      const db = getDatabase?.();
      const now = new Date().toISOString();
      const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
      const accounts = db
        ? {
            users: db.prepare("SELECT COUNT(*) AS total FROM users").get().total,
            newThisWeek: db.prepare("SELECT COUNT(*) AS total FROM users WHERE created_at > ?").get(weekAgo).total,
            activeSessions: db.prepare("SELECT COUNT(*) AS total FROM sessions WHERE expires_at > ?").get(now).total,
            activeThisWeek: db.prepare("SELECT COUNT(DISTINCT user_id) AS total FROM sessions WHERE last_seen_at > ?").get(weekAgo).total,
          }
        : null;
      const recent = activity ? (await activity.list({ view: "normal", limit: 8 })).entries : [];
      return {
        viewer: account ? { source: "account", ...toPublicUser(account) } : null,
        discord,
        services,
        accounts,
        recentActivity: recent,
        hub: { sessions: sessions.list().length, expiresAt: new Date(req.hub.expiresAt).toISOString(), terminal: terminalEnabled(), twoFactor: twoFactorEnabled() },
        profileApi: origin("PROFILE_API_ORIGIN") || null,
      };
    }),
  );

  app.get("/hub/health", route(() => health()));
  app.get("/hub/live", route((req) => callBot(`/hub/live?${new URLSearchParams({ before: String(req.query.before ?? ""), limit: String(req.query.limit ?? 200) })}`)));

  /* ----- Discord (from the bot) ----- */

  const query = (req) => new URLSearchParams(Object.entries(req.query).map(([key, value]) => [key, String(value)])).toString();
  app.get("/hub/members", route((req) => callBot(`/hub/members?${query(req)}`, { timeout: 40_000 })));
  app.get("/hub/user/:id", route((req) => callBot(`/hub/user/${encodeURIComponent(req.params.id)}`)));
  app.get("/hub/channels", route((req) => callBot(`/hub/channels?${query(req)}`)));
  app.get("/hub/roles", route((req) => callBot(`/hub/roles?${query(req)}`)));
  app.get("/hub/commands", route(() => callBot("/hub/commands")));
  app.post(
    "/hub/commands/autocomplete",
    json,
    route((req) => callBot("/hub/commands/autocomplete", { method: "POST", body: req.body ?? {} })),
  );
  app.post(
    "/hub/commands/run",
    json,
    route(async (req) => {
      const body = req.body ?? {};
      const label = body.kind === "prefix" ? `${body.name} ${body.args ?? ""}`.trim() : [body.name, body.group, body.sub].filter(Boolean).join(" ");
      const result = await callBot("/hub/commands/run", { method: "POST", body, timeout: 120_000 });
      log({
        level: "risky",
        action: "hub-command",
        summary: `ran ${body.kind === "prefix" ? "the prefix command" : "/"}${label} from the hub${result.ok ? "" : " (failed)"}`,
        target: { command: body.name, channelId: body.channelId ?? null },
        details: { options: body.options ?? null, args: body.args ?? null, error: result.error ?? null },
      });
      return result;
    }),
  );

  /* ----- live feed: Discord activity + website activity log ----- */

  app.get(
    "/hub/events",
    route(async (req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        Connection: "keep-alive",
      });
      res.write(`: ${" ".repeat(2048)}\n\n`);
      const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      if (activity) send("site-history", (await activity.list({ view: "normal", limit: 60 })).entries);
      const past = await callBot("/hub/live?limit=300").catch(() => null);
      if (past) send("discord-history", past.entries);
      const onSite = (entry) => send("site", entry);
      siteListeners.add(onSite);

      // One upstream stream from the bot per viewer; reconnects if the bot restarts.
      const controller = new AbortController();
      let closed = false;
      (async function upstream() {
        while (!closed) {
          try {
            const response = await fetch(`${getBotInternalUrl()}/hub/events`, { headers: { "X-Internal-Key": getInternalKey() ?? "" }, signal: controller.signal });
            if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
            send("status", { discord: "connected" });
            const decoder = new TextDecoder();
            let rest = "";
            for await (const chunk of response.body) {
              const parts = (rest + decoder.decode(chunk, { stream: true })).split("\n\n");
              rest = parts.pop();
              for (const part of parts) {
                const line = part.split("\n").find((entry) => entry.startsWith("data: "));
                if (line) res.write(`event: discord\n${line}\n\n`);
              }
            }
          } catch {
            if (closed) return;
          }
          send("status", { discord: "reconnecting" });
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      })();

      const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
      req.on("close", () => {
        closed = true;
        clearInterval(ping);
        siteListeners.delete(onSite);
        controller.abort();
      });
    }),
  );

  app.get(
    "/hub/activity",
    route(async (req) => {
      if (!activity) return { entries: [], next: null };
      const view = ["risky", "normal", "verbose"].includes(req.query.view) ? req.query.view : "verbose";
      return activity.list({ view, before: req.query.before || null, limit: req.query.limit || 100, search: req.query.search || "" });
    }),
  );
  app.get("/hub/activity/verify", route(() => (activity ? activity.verify() : { intact: true, entries: 0 })));

  /* ----- logs ----- */

  app.get("/hub/logs", route(async () => ({ sources: await hubLogs.sources() })));
  app.get("/hub/logs/read", route((req) => hubLogs.read(req.query.id, req.query.lines)));
  app.get(
    "/hub/logs/follow",
    route((req, res) => {
      hubLogs.follow(req.query.id, req, res);
    }),
  );

  /* ----- database ----- */

  const rowid = (req) => {
    const value = Number(req.params.rowid);
    if (!Number.isInteger(value)) throw httpError(400, "Invalid row.");
    return value;
  };
  app.get("/hub/db/tables", route(() => ({ tables: hubDb.tables() })));
  app.get("/hub/db/tables/:name", route((req) => hubDb.rows(req.params.name, req.query)));
  app.post("/hub/db/tables/:name/rows", json, route((req) => hubDb.insertRow(req.params.name, req.body?.values)));
  app.patch("/hub/db/tables/:name/rows/:rowid", json, route((req) => hubDb.updateRow(req.params.name, rowid(req), req.body?.values)));
  app.post("/hub/db/tables/:name/rows/:rowid/delete", route((req) => hubDb.deleteRow(req.params.name, rowid(req))));

  app.get("/hub/users", route((req) => hubDb.users(req.query)));
  app.post("/hub/users", json, route((req) => hubDb.createUser(req.body)));
  app.get("/hub/users/:id", route((req) => hubDb.getUser(req.params.id)));
  app.patch("/hub/users/:id", json, route((req) => hubDb.updateUser(req.params.id, req.body)));
  app.post("/hub/users/:id/logout", route((req) => hubDb.logoutUser(req.params.id)));
  app.post("/hub/users/:id/delete", route((req) => hubDb.deleteUser(req.params.id)));

  app.get("/hub/files", route((req) => hubDb.files(req.query.dir || "")));
  app.get("/hub/files/read", route((req) => hubDb.readFile(req.query.path)));
  app.post("/hub/files/write", json, route((req) => hubDb.writeFile(req.body?.path, req.body?.text, req.body?.modifiedAt)));

  /* ----- settings (.env) ----- */

  app.get("/hub/env", route(async () => ({ ...(await backup.envOverview()), canReveal: twoFactorEnabled(), twoFactor: twoFactorEnabled() })));

  app.post(
    "/hub/env",
    json,
    route(async (req) => {
      const values = req.body?.values ?? {};
      backup.validateEnv(values); // before the 2FA code is used up
      if (twoFactorEnabled() && !checkTwoFactor(req.body?.code, "hub-env")) throw httpError(403, "Wrong or already used 2FA code.", { twoFactor: true });
      const names = Array.isArray(req.body?.remove) ? req.body.remove : [];
      const changed = Object.keys(values).length ? await backup.setEnv(values) : [];
      const removed = names.length ? await backup.removeEnv(names) : [];
      if (changed.length || removed.length) {
        log({
          level: "risky",
          action: "env-change",
          summary: `changed settings in the hub: ${[...changed, ...removed.map((name) => `${name} (removed)`)].join(", ")}`,
          details: { changed, removed },
        });
      }
      return { changed, removed, restart: backup.restartsFor([...changed, ...removed]) };
    }),
  );

  app.post(
    "/hub/env/reveal",
    json,
    route(async (req) => {
      if (!twoFactorEnabled()) throw httpError(403, "Viewing values needs 2FA: run `pnpm 2fa:setup` on the server and set ADMIN_2FA=on.");
      if (!checkTwoFactor(req.body?.code, "hub-reveal")) throw httpError(403, "Wrong or already used 2FA code.", { twoFactor: true });
      const name = String(req.body?.name ?? "");
      const value = await backup.revealEnv(name);
      log({ level: "risky", action: "env-view", summary: `viewed the .env value ${name} in the hub`, target: { key: name } });
      return { name, value };
    }),
  );

  /* ----- terminal ----- */

  registerTerminal(app, {
    requireHub: (req) => {
      const session = requireHub(req);
      current.enterWith(session); // so terminal entries carry the right name
      return session;
    },
    log,
  });

  return {
    attach(server) {
      attachTerminalSockets(server, { authenticate, originAllowed: (value) => Boolean(value) && allowedOrigins.has(value) });
    },
  };
}

module.exports = { registerHub, HUB_COOKIE: COOKIE };
