export const ACCOUNT_API_URL = "https://accounts-api.master3307.org";

const CSRF_HEADER_NAME = "X-Requested-With";
const CSRF_HEADER_VALUE = "homesite-web";

async function accountFetch(path, options = {}) {
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

export async function getCurrentAccount() {
  const response = await accountFetch("/auth/me");

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Account request failed: ${response.status}`);
  }

  const data = await response.json();

  return data.authenticated ? data.user : null;
}

export async function updateAccountSettings(settings) {
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
  const response = await accountFetch("/auth/logout", {
    method: "POST",
  });

  if (!response.ok && response.status !== 204) {
    throw new Error(`Logout failed: ${response.status}`);
  }
}
