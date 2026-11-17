const crypto = require("node:crypto");

const { setting } = require("../config.cjs");
const { getInternalKey } = require("./internalKey.cjs");

/*
 * Secrets kept for an account (TOTP secrets in emailAuth.cjs, the /dash
 * GitHub token in dashWeb.cjs): AES-256-GCM, the key derived from the
 * internal key. A database copied to another server (or a backup imported
 * there) can't open them; the features then ask to set them up again.
 */

const secretKey = () => crypto.createHash("sha256").update(`homesite-account-secrets:${getInternalKey() || setting("SESSION_SECRET") || ""}`).digest();

function seal(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
  const data = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString("base64url")).join(".");
}

function unseal(sealed) {
  const [iv, tag, data] = String(sealed).split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", secretKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

module.exports = { secretKey, seal, unseal };
