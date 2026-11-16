const crypto = require("node:crypto");

/*
 * Two-factor codes for the admin account (TOTP, RFC 6238): 6 digits, a new
 * one every 30 seconds, compatible with every authenticator app.
 *
 * .env:
 *   ADMIN_2FA=on            turn it on (admin login + critical actions)
 *   ADMIN_2FA_SECRET=…      base32 secret, created by `pnpm 2fa:setup`
 *
 * The secret only exists on the server, so setting it up needs access to
 * the machine the site runs on.
 */

const PERIOD = 30;
const DIGITS = 6;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const ISSUER = "HomeSite";
const ACCOUNT = "admin";

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(text) {
  const clean = String(text ?? "").toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error("The 2FA secret is not valid base32.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A new random secret (160 bits, base32). */
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function codeAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const number = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(number).padStart(DIGITS, "0");
}

const stepOf = (ms = Date.now()) => Math.floor(ms / 1000 / PERIOD);

/** The current code and how many seconds it stays valid. */
function currentCode(secret, ms = Date.now()) {
  const step = stepOf(ms);
  return { code: codeAt(secret, step), secondsLeft: PERIOD - (Math.floor(ms / 1000) % PERIOD), period: PERIOD };
}

/**
 * Checks a code (one step of clock drift allowed either way). Returns the
 * matched step, or null. Callers reject steps that were already used.
 */
function verifyCode(secret, code, ms = Date.now()) {
  const clean = String(code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const step = stepOf(ms);
  for (const candidate of [step, step - 1, step + 1]) {
    const expected = codeAt(secret, candidate);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return candidate;
  }
  return null;
}

function otpauthUrl(secret) {
  const label = encodeURIComponent(`${ISSUER}:${ACCOUNT}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${ISSUER}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD}`;
}

/* ---------- server side ---------- */

const ON = new Set(["1", "true", "on", "yes"]);

/** 2FA is required when ADMIN_2FA is on and a valid secret exists. */
function twoFactorEnabled() {
  if (!ON.has(String(process.env.ADMIN_2FA ?? "").trim().toLowerCase())) return false;
  try {
    return base32Decode(process.env.ADMIN_2FA_SECRET).length >= 10;
  } catch {
    return false;
  }
}

const usedSteps = new Map(); // purpose -> last accepted step (no replays)

/*
 * After a correct code, the same login (`holders`: e.g. "account:<session>",
 * "hub:<session>") needs no new code for a short while
 * (ADMIN_2FA_GRACE_MINUTES, default 10, 0 = always ask). Kept in memory
 * only: a restart asks again. Another browser or login always needs a code.
 */
const grace = new Map(); // holder -> until (ms)

function graceMs() {
  const minutes = Number(process.env.ADMIN_2FA_GRACE_MINUTES ?? 10);
  return Number.isFinite(minutes) && minutes >= 0 ? Math.min(minutes, 120) * 60_000 : 10 * 60_000;
}

const holderList = (holders) => [].concat(holders ?? []).filter(Boolean).map(String);

/** Until when (ms) one of `holders` needs no code, or 0. */
function twoFactorFreshUntil(holders) {
  const now = Date.now();
  for (const [holder, until] of grace) if (until < now) grace.delete(holder);
  return Math.max(0, ...holderList(holders).map((holder) => grace.get(holder) ?? 0));
}

/** Marks `holders` as just checked (e.g. a new hub session after its login code). */
function grantTwoFactor(holders) {
  const until = Date.now() + graceMs();
  if (graceMs() > 0) for (const holder of holderList(holders)) grace.set(holder, until);
  return until;
}

/**
 * Checks a code for `purpose` (each code works once per purpose). Without a
 * code, passes while one of `holders` is within its grace time.
 * Returns true when 2FA is off.
 */
function checkTwoFactor(code, purpose = "default", holders = []) {
  if (!twoFactorEnabled()) return true;
  const typed = String(code ?? "").replace(/\s/g, "");
  if (!typed) return twoFactorFreshUntil(holders) > Date.now();
  const step = verifyCode(process.env.ADMIN_2FA_SECRET, typed);
  if (step === null) return false;
  if ((usedSteps.get(purpose) ?? -1) >= step) return false;
  usedSteps.set(purpose, step);
  grantTwoFactor(holders);
  return true;
}

module.exports = {
  generateSecret,
  currentCode,
  verifyCode,
  otpauthUrl,
  twoFactorEnabled,
  checkTwoFactor,
  twoFactorFreshUntil,
  grantTwoFactor,
  base32Decode,
  PERIOD,
};
