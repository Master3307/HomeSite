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

/**
 * Checks a code for `purpose` (each code works once per purpose).
 * Returns true when 2FA is off.
 */
function checkTwoFactor(code, purpose = "default") {
  if (!twoFactorEnabled()) return true;
  const step = verifyCode(process.env.ADMIN_2FA_SECRET, code);
  if (step === null) return false;
  if ((usedSteps.get(purpose) ?? -1) >= step) return false;
  usedSteps.set(purpose, step);
  return true;
}

module.exports = {
  generateSecret,
  currentCode,
  verifyCode,
  otpauthUrl,
  twoFactorEnabled,
  checkTwoFactor,
  base32Decode,
  PERIOD,
};
