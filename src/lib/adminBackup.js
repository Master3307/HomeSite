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

/** The unlock header for other admin APIs used from the admin settings (Bongo Cat assets). */
export const adminUnlockHeaders = () => (unlockToken ? { 'X-Admin-Unlock': unlockToken } : {});

export async function loadBackupOverview() {
  return json(await get("/account/admin/backup/overview"));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Packs the backup on the server (a job, polled for its step), then
 * downloads it. `onProgress({ step, done, total })` for the progress bar;
 * total 0 = unknown. Returns { name, bytes, files, timeDifferences }.
 */
export async function exportBackup(key, code, onProgress = () => {}) {
  onProgress({ step: "Starting", done: 0, total: 0 });
  const { id } = await json(await post("/account/admin/backup/export/start", { key, code }));
  let job;
  for (;;) {
    job = await json(await get(`/account/admin/backup/export/${encodeURIComponent(id)}`));
    if (job.error) throw new Error(job.error);
    if (job.ready) break;
    onProgress({ step: job.step, done: job.done, total: job.total });
    await wait(500);
  }

  const response = await get(`/account/admin/backup/export/${encodeURIComponent(id)}/download`);
  if (!response.ok) await json(response);
  const size = Number(response.headers.get("Content-Length") || 0);
  const reader = response.body.getReader();
  const parts = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    received += value.length;
    onProgress({ step: "Downloading", done: received, total: size, bytes: true });
  }
  const blob = new Blob(parts, { type: "application/octet-stream" });
  const name = job.name ?? "homesite-backup.tar.gz.enc";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);

  return { name, bytes: blob.size, files: job.files ?? 0, timeDifferences: job.differences ?? 0 };
}

/**
 * Uploads a backup in parts (Cloudflare refuses single requests over
 * 100 MB) and gets the import plan; nothing changes yet.
 * `onProgress({ step, done, total, bytes })`.
 */
export async function analyzeBackup(file, key, backupKey = "", onProgress = () => {}) {
  const adminHeaders = { "X-Admin-Key": key, ...(backupKey ? { "X-Backup-Key": backupKey } : {}) };
  const start = await json(await accountFetch("/account/admin/backup/import/upload", { method: "POST", headers: withUnlock(adminHeaders) }));
  const size = start.chunkSize || 32 * 1024 * 1024;
  for (let offset = 0; offset < file.size; offset += size) {
    onProgress({ step: "Uploading", done: offset, total: file.size, bytes: true });
    await json(
      await accountFetch(`/account/admin/backup/import/upload/${encodeURIComponent(start.id)}?offset=${offset}`, {
        method: "PUT",
        headers: withUnlock({ ...adminHeaders, "Content-Type": "application/octet-stream" }),
        body: file.slice(offset, offset + size),
      }),
    );
  }
  onProgress({ step: "Decrypting and checking", done: 0, total: 0 });
  return json(
    await accountFetch("/account/admin/backup/import/analyze", {
      method: "POST",
      headers: withUnlock({ ...adminHeaders, "X-Upload-Id": start.id }),
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
