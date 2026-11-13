import { accountFetch } from "./account";

const GUEST_NAME_KEY = "homesite:lobbyGuestName";

export const LOBBY_LIMITS = { code: 100, description: 1000, name: 32 };

/**
 * Submits a lobby code through the account API and the bot. The server
 * decides from the session whether it is posted right away or sent to the
 * moderators for approval: resolves to `{ status: "posted" | "pending" }`.
 */
export async function submitLobbyCode({ code, description, guestName }) {
  let response;

  try {
    response = await accountFetch("/discord/lobby", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, description, guestName }),
    });
  } catch {
    throw new Error("The server is unreachable right now. Please try again later.");
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error || `Submitting failed (${response.status}).`);
  }

  return data;
}

export function getSavedGuestName() {
  try {
    return localStorage.getItem(GUEST_NAME_KEY) || "";
  } catch {
    return "";
  }
}

export function saveGuestName(name) {
  try {
    localStorage.setItem(GUEST_NAME_KEY, name);
  } catch {
    // Storage blocked: the name just isn't remembered.
  }
}
