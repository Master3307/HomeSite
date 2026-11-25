import { accountFetch } from "./account";

/*
 * Backup & restore in the hub's settings (server/services/adminBackup.cjs).
 * The unlocked hub session is the login; exporting and importing also send
 * the admin key (it encrypts the archive) and a 2FA code when needed.
 */

async function json(response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw Object.assign(new Error(data?.error || `Request failed (${response.status}).`), {
      status: response.status,
      locked: Boolean(data?.locked),
      twoFactor: Boolean(data?.twoFactor),
    });
  }
  return data;
}

const get = (path) => accountFetch(path, { cache: "no-store" });

const post = (path, body) =>
  accountFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

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

/* A job on the server (checking, applying), polled until it's done: its result. */
async function followJob(id, onProgress) {
  let misses = 0;
  for (;;) {
    await wait(800);
    let job;
    try {
      job = await json(await get(`/account/admin/backup/import/job/${encodeURIComponent(id)}`));
      misses = 0;
    } catch (error) {
      // A dropped poll (network, a proxy hiccup) isn't the job failing; a few in a row are.
      if (error.status === 404 || error.status === 403 || ++misses >= 5) throw error;
      continue;
    }
    if (job.error) throw new Error(job.error);
    if (job.done) return job.result;
    onProgress({ step: job.step, done: 0, total: 0 });
  }
}

/**
 * Uploads a backup in parts (Cloudflare refuses single requests over
 * 100 MB; a part that fails is sent again from where the server got to),
 * then has it checked as a job (Cloudflare also ends requests that take
 * over 100 seconds). Returns the import plan; nothing changes yet.
 * `onProgress({ step, done, total, bytes })`.
 */
export async function analyzeBackup(file, key, backupKey = "", onProgress = () => {}) {
  const adminHeaders = { "X-Admin-Key": key, ...(backupKey ? { "X-Backup-Key": backupKey } : {}) };
  const start = await json(await accountFetch("/account/admin/backup/import/upload", { method: "POST", headers: adminHeaders }));
  const size = start.chunkSize || 32 * 1024 * 1024;
  let offset = 0;
  let tries = 0;
  while (offset < file.size) {
    onProgress({ step: "Uploading", done: offset, total: file.size, bytes: true });
    let response = null;
    try {
      response = await accountFetch(`/account/admin/backup/import/upload/${encodeURIComponent(start.id)}?offset=${offset}`, {
        method: "PUT",
        headers: { ...adminHeaders, "Content-Type": "application/octet-stream" },
        body: file.slice(offset, offset + size),
      });
    } catch (error) {
      if (++tries >= 3) throw error;
      await wait(1000 * tries);
      continue;
    }
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      offset = data.received;
      tries = 0;
      continue;
    }
    // The server says how far it got: go on from there (a part arrived although its answer didn't).
    if (Number.isSafeInteger(data.received) && response.status !== 413 && ++tries < 3) {
      offset = data.received;
      await wait(500);
      continue;
    }
    throw Object.assign(new Error(data.error || `Request failed (${response.status}).`), { status: response.status });
  }
  onProgress({ step: "Decrypting and checking", done: 0, total: 0 });
  const { id } = await json(
    await accountFetch("/account/admin/backup/import/analyze/start", {
      method: "POST",
      headers: { ...adminHeaders, "X-Upload-Id": start.id },
    }),
  );
  return followJob(id, onProgress);
}

/** Applies a checked plan as a job (a safety backup comes first): the report. */
export async function applyBackup(planId, key, code, choices, onProgress = () => {}) {
  const { id } = await json(await post("/account/admin/backup/import/apply/start", { planId, key, code, choices }));
  return followJob(id, onProgress);
}
