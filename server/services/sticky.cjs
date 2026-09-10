const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const DB_DIRECTORY = path.resolve(__dirname, "db");
const STICKY_FILE_PATH = path.join(DB_DIRECTORY, "sticky-messages.json");

let stickyMessages = new Map();
let initialized = false;
let initializationPromise = null;
let saveQueue = Promise.resolve();

function normalizeSticky(value) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.content !== "string" ||
    typeof value.messageId !== "string"
  ) {
    return null;
  }

  return {
    content: value.content,
    messageId: value.messageId,
  };
}

function loadStickyState() {
  if (!fs.existsSync(STICKY_FILE_PATH)) {
    return;
  }

  try {
    const raw = fs.readFileSync(STICKY_FILE_PATH, "utf8");

    if (!raw.trim()) {
      return;
    }

    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.warn(
        `[Sticky] Ignoring invalid sticky state file: ${STICKY_FILE_PATH}`,
      );
      return;
    }

    for (const [channelId, sticky] of Object.entries(parsed)) {
      const normalized = normalizeSticky(sticky);

      if (normalized) {
        stickyMessages.set(channelId, normalized);
      }
    }
  } catch (error) {
    console.error(
      `[Sticky] Failed to load sticky state from ${STICKY_FILE_PATH}:`,
      error,
    );
  }
}

function ensureInitialized() {
  if (initialized) {
    return;
  }

  initialized = true;
  loadStickyState();
}

function serializeStickyState() {
  return JSON.stringify(Object.fromEntries(stickyMessages), null, 2) + "\n";
}

async function writeStickyState() {
  await fsp.mkdir(DB_DIRECTORY, { recursive: true });

  const tempPath = path.join(
    DB_DIRECTORY,
    `.sticky-messages.${process.pid}.${Date.now()}.${Math.random()
      .toString(16)
      .slice(2)}.tmp`,
  );

  try {
    await fsp.writeFile(tempPath, serializeStickyState(), "utf8");
    await fsp.rename(tempPath, STICKY_FILE_PATH);
  } catch (error) {
    await fsp.unlink(tempPath).catch(() => null);
    throw error;
  }
}

function queueSave() {
  ensureInitialized();

  saveQueue = saveQueue.catch(() => null).then(() => writeStickyState());

  return saveQueue;
}

async function initializeStickyStore() {
  if (!initializationPromise) {
    initializationPromise = Promise.resolve().then(() => {
      ensureInitialized();
    });
  }

  return initializationPromise;
}

function setSticky(channelId, content, messageId) {
  ensureInitialized();

  if (!channelId || !messageId) {
    throw new Error("Sticky channelId and messageId are required.");
  }

  stickyMessages.set(String(channelId), {
    content: String(content ?? ""),
    messageId: String(messageId),
  });

  return queueSave();
}

function getSticky(channelId) {
  ensureInitialized();

  if (!channelId) {
    return null;
  }

  return stickyMessages.get(String(channelId)) ?? null;
}

function removeSticky(channelId) {
  ensureInitialized();

  if (!channelId) {
    return Promise.resolve();
  }

  stickyMessages.delete(String(channelId));
  return queueSave();
}

module.exports = {
  DB_DIRECTORY,
  STICKY_FILE_PATH,
  initializeStickyStore,
  setSticky,
  getSticky,
  removeSticky,
};
