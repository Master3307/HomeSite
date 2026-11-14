import { siteConfig } from "./siteConfig";
import {
  clearLocalAdminSession,
  getLocalAdminSession,
  isLocalAdminAvailable,
  startLocalAdminSession,
  verifyAdminCodeLocally,
} from "./localAdmin";

/*
 * In `pnpm dev` the API is reached through the same-origin /account-api
 * proxy (scripts/account-api-proxy.mjs), so admin-key sessions work on
 * localhost. Set VITE_ACCOUNT_API_URL=/account-api at build time to use the
 * proxy from `pnpm preview` on a local server as well.
 */
export const ACCOUNT_API_URL =
  import.meta.env.VITE_ACCOUNT_API_URL ||
  (import.meta.env.DEV ? "/account-api" : siteConfig.accountApiOrigin || "/account-api");

const CSRF_HEADER_NAME = "X-Requested-With";
const CSRF_HEADER_VALUE = "homesite-web";

export const DISCORD_LOGIN_URL = `${ACCOUNT_API_URL}/auth/discord`;

/** Discord login is switched off for now; flip to true to re-enable it. */
export const LOGIN_AVAILABLE = true;

/*
 * Cached avatars are served by the account API (/avatars/<id>.webp). The API
 * prefixes them with ACCOUNT_API_ORIGIN; when that isn't set the path is relative and
 * would wrongly resolve against the website, so resolve it against the API.
 */
function withApiAvatar(user) {
  if (!user || typeof user.avatarUrl !== "string" || !user.avatarUrl.startsWith("/")) {
    return user;
  }

  return { ...user, avatarUrl: `${ACCOUNT_API_URL}${user.avatarUrl}` };
}

export async function accountFetch(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});

  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE);
  }

  return fetch(`${ACCOUNT_API_URL}${path}`, {
    ...options,
    method,
    headers,
    credentials: "include",
  });
}

/**
 * The logged-in user. Falls back to a local admin session (see
 * lib/localAdmin.js) when the server has no session or is unreachable.
 */
export async function getCurrentAccount() {
  let response;

  try {
    response = await accountFetch("/auth/me");
  } catch (error) {
    const local = getLocalAdminSession();
    if (local) return local;
    throw error;
  }

  if (response.ok) {
    const data = await response.json().catch(() => null);
    if (data?.authenticated) return withApiAvatar(data.user);
  }

  const local = getLocalAdminSession();
  if (local) return local;

  if (response.ok || response.status === 401) {
    return null;
  }

  throw new Error(`Account request failed: ${response.status}`);
}

export async function updateAccountSettings(settings) {
  // Local admin sessions have nothing to sync to.
  if (getLocalAdminSession()) {
    return null;
  }

  const response = await accountFetch("/account/settings", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(settings),
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    const data = await response.json().catch(() => null);

    throw new Error(
      data?.error || `Settings update failed: ${response.status}`,
    );
  }

  const data = await response.json();

  return data.settings;
}

export async function logoutAccount() {
  const local = getLocalAdminSession();
  clearLocalAdminSession();

  let response;

  try {
    response = await accountFetch("/auth/logout", {
      method: "POST",
    });
  } catch (error) {
    if (local) return;
    throw error;
  }

  if (!response.ok && response.status !== 204 && !local) {
    throw new Error(`Logout failed: ${response.status}`);
  }
}

async function loginLocally(key) {
  if (!isLocalAdminAvailable()) {
    throw new Error(
      "The account server is unreachable and offline admin login is not set up.",
    );
  }

  if (!(await verifyAdminCodeLocally(key))) {
    throw new Error("Invalid admin code.");
  }

  return startLocalAdminSession();
}

/**
 * Logs in as the admin ("Cultbot") account with the ADMIN_KEY code.
 * Uses the account server when it can; when the server is unreachable or
 * does not support admin login, the code is checked in the browser and a
 * local admin session is started instead (`user.local === true`).
 */
/**
 * Admin login. With ADMIN_2FA on, the server answers `twoFactor: true` and
 * the login needs `code` (from the authenticator app) as well.
 */
export async function loginWithAdminCode(key, code = "") {
  let response;

  try {
    response = await accountFetch("/auth/admin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(code ? { key, code } : { key }),
    });
  } catch {
    return loginLocally(key);
  }

  const data = await response.json().catch(() => null);

  if (response.ok && data?.user) {
    clearLocalAdminSession();
    return withApiAvatar(data.user);
  }

  // The server rejected the code itself: do not fall back.
  if ([400, 401, 429].includes(response.status) && data?.error) {
    throw Object.assign(new Error(data.error), { twoFactor: Boolean(data.twoFactor) });
  }

  // Server down (5xx), admin login missing (404) or disabled: work locally.
  return loginLocally(key);
}
