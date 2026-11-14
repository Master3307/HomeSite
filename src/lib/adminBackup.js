import { accountFetch } from "./account";

/*
 * Admin settings: backup, restore and .env settings (admin account only; see
 * server/services/adminBackup.cjs). Every action sends the admin key again.
 */

// Token from unlocking the page (admin key + 2FA), sent with every request.
let unlockToken = null;

async function json(response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (data?.locked) unlockToken = null;
    throw Object.assign(new Error(data?.error || `Request failed (${response.status}).`), {
      status: response.status,
      locked: Boolean(data?.locked),
      twoFactor: Boolean(data?.twoFactor),
    });
  }
  return data;
}

const withUnlock = (headers = {}) => (unlockToken ? { ...headers, "X-Admin-Unlock": unlockToken } : headers);

const get = (path) => accountFetch(path, { cache: "no-store", headers: withUnlock() });

const post = (path, body) =>
  accountFetch(path, {
    method: "POST",
    headers: withUnlock({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });

/** Whether 2FA is on (before unlocking). */
export async function loadAdminStatus() {
  return json(await accountFetch("/account/admin/status", { cache: "no-store" }));
}

/** Unlocks the page for 15 minutes (admin key, plus the 2FA code when on). */
export async function unlockAdmin(key, code) {
  const data = await json(await post("/account/admin/unlock", { key, code }));
  unlockToken = data.token;
  return data;
}

export const isUnlocked = () => Boolean(unlockToken);

export async function loadBackupOverview() {
  return json(await get("/account/admin/backup/overview"));
}

/** Downloads the encrypted backup; returns { name, files, timeDifferences }. */
export async function exportBackup(key, code) {
  const response = await post("/account/admin/backup/export", { key, code });
  if (!response.ok) await json(response);

  const blob = await response.blob();
  const name =
    response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "homesite-backup.tar.gz.enc";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);

  return {
    name,
    bytes: blob.size,
    files: Number(response.headers.get("X-Backup-Files") || 0),
    timeDifferences: Number(response.headers.get("X-Backup-Time-Differences") || 0),
  };
}

/** Uploads a backup and gets the import plan (nothing changes yet). */
export async function analyzeBackup(file, key, backupKey = "") {
  return json(
    await accountFetch("/account/admin/backup/import/analyze", {
      method: "POST",
      headers: withUnlock({
        "Content-Type": "application/octet-stream",
        "X-Admin-Key": key,
        ...(backupKey ? { "X-Backup-Key": backupKey } : {}),
      }),
      body: file,
    }),
  );
}

export async function applyBackup(planId, key, code, choices) {
  return json(await post("/account/admin/backup/import/apply", { planId, key, code, choices }));
}

export async function loadEnvOverview() {
  return json(await get("/account/admin/env"));
}

/** Saves new values and removes others in one go; returns { changed, removed, restart }. */
export async function saveEnvValues(key, code, values, remove = []) {
  return json(await post("/account/admin/env", { key, code, values, remove }));
}

/** Known settings fall back to their defaults; custom entries are deleted. */
export async function removeEnvValues(key, code, names) {
  return json(await post("/account/admin/env/remove", { key, code, names }));
}

/** One value (needs 2FA). */
export async function revealEnvValue(key, code, name) {
  return json(await post("/account/admin/env/reveal", { key, code, name }));
}
