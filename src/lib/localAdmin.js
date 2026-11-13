/*
 * Local admin mode: the admin code also works when the account API is
 * unreachable. The code is checked in the browser against a salted PBKDF2
 * hash of ADMIN_KEY embedded at build time (vite.config.js).
 *
 * A local session only unlocks things in this browser (e.g. preparing FDC
 * drafts); anything that needs Discord is sent once the server is back.
 */

const VERIFIER = import.meta.env.VITE_ADMIN_KEY_VERIFIER || "";
const SESSION_KEY = "homesite:localAdmin";
const SESSION_MS = 12 * 60 * 60 * 1000;

export const LOCAL_ADMIN_USER = Object.freeze({
  id: "local-admin",
  discordUserId: "1525217425987993752",
  role: "owner",
  isAdminSession: true,
  local: true,
  username: "cultbot",
  displayName: "Cultbot",
  avatarUrl: null,
  settings: {},
});

export function isLocalAdminAvailable() {
  return Boolean(VERIFIER) && Boolean(globalThis.crypto?.subtle);
}

function fromBase64(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

/** Constant-time comparison of two byte arrays. */
function equalBytes(a, b) {
  if (a.length !== b.length) return false;

  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a[index] ^ b[index];
  }

  return difference === 0;
}

export async function verifyAdminCodeLocally(code) {
  if (!isLocalAdminAvailable() || !code) return false;

  const [salt, iterations, expected] = VERIFIER.split(":");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(code),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: fromBase64(salt),
      iterations: Number(iterations),
    },
    key,
    256,
  );

  return equalBytes(new Uint8Array(bits), fromBase64(expected));
}

export function getLocalAdminSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");

    if (!session || session.expiresAt < Date.now()) {
      if (session) localStorage.removeItem(SESSION_KEY);
      return null;
    }

    return { ...LOCAL_ADMIN_USER, expiresAt: session.expiresAt };
  } catch {
    return null;
  }
}

export function startLocalAdminSession() {
  const expiresAt = Date.now() + SESSION_MS;

  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ expiresAt }));
  } catch {
    // Storage blocked: the session lasts until reload.
  }

  return { ...LOCAL_ADMIN_USER, expiresAt };
}

export function clearLocalAdminSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing stored.
  }
}
