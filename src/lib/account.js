export const ACCOUNT_API_URL = "https://accounts-api.master3307.org";

export async function getCurrentAccount() {
  const response = await fetch(`${ACCOUNT_API_URL}/auth/me`, {
    credentials: "include",
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Account request failed: ${response.status}`);
  }

  const data = await response.json();

  return data.authenticated ? data.user : null;
}

export async function logoutAccount() {
  const response = await fetch(`${ACCOUNT_API_URL}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok && response.status !== 204) {
    throw new Error(`Logout failed: ${response.status}`);
  }
}
