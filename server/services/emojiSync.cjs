"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const DB_FILE = path.join(__dirname, "db", "emoji-sync.json");

const SOURCE_GUILD_ID = process.env.DISCORD_GUILD_ID;
const DEBOUNCE_MS = Number(process.env.EMOJI_SYNC_DEBOUNCE_MS || 10_000);

let syncInProgress = false;
let syncQueued = false;
let debounceTimer = null;

function assertConfig() {
  if (!SOURCE_GUILD_ID) {
    throw new Error(
      "[emoji-sync] Missing DISCORD_GUILD_ID. It is the source guild for application emoji sync.",
    );
  }
}

async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function ensureStateDirectory() {
  await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
}

async function readState() {
  await ensureStateDirectory();

  try {
    const raw = await fs.readFile(DB_FILE, "utf8");
    const state = JSON.parse(raw);

    if (!state || typeof state !== "object" || !Array.isArray(state.mappings)) {
      throw new Error("Invalid emoji sync state format.");
    }

    return state;
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        version: 1,
        mappings: [],
      };
    }

    throw error;
  }
}

async function writeState(state) {
  await ensureStateDirectory();

  const temporaryFile = `${DB_FILE}.tmp`;

  await fs.writeFile(
    temporaryFile,
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8",
  );

  await fs.rename(temporaryFile, DB_FILE);
}

function getMapping(state, sourceEmojiId) {
  return state.mappings.find(
    (mapping) => mapping.sourceEmojiId === sourceEmojiId,
  );
}

function removeMapping(state, sourceEmojiId) {
  state.mappings = state.mappings.filter(
    (mapping) => mapping.sourceEmojiId !== sourceEmojiId,
  );
}

function upsertMapping(state, mapping) {
  removeMapping(state, mapping.sourceEmojiId);
  state.mappings.push(mapping);
}

async function getAsset(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to download emoji asset: HTTP ${response.status} ${response.statusText}`,
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  return {
    buffer,
    hash: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
}

function makeHashKey(animated, hash) {
  return `${animated ? "animated" : "static"}:${hash}`;
}

function isValidEmojiName(name) {
  return /^[a-zA-Z0-9_]{2,32}$/.test(name);
}

function sanitizeEmojiName(name) {
  const sanitized = String(name || "emoji")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);

  if (sanitized.length >= 2) {
    return sanitized;
  }

  return "emoji";
}

function createUniqueName({
  preferredName,
  sourceEmojiId,
  applicationEmojis,
  ignoreApplicationEmojiId = null,
}) {
  const usedNames = new Set(
    applicationEmojis
      .filter((emoji) => emoji.id !== ignoreApplicationEmojiId)
      .map((emoji) => emoji.name),
  );

  const cleanName = sanitizeEmojiName(preferredName);

  if (!usedNames.has(cleanName)) {
    return cleanName;
  }

  const sourceSuffix = sourceEmojiId.slice(-6);
  const suffix = `_${sourceSuffix}`;
  const baseLength = Math.max(2, 32 - suffix.length);
  const base = cleanName.slice(0, baseLength);
  const stableFallback = `${base}${suffix}`;

  if (!usedNames.has(stableFallback)) {
    return stableFallback;
  }

  for (let number = 2; number < 10_000; number += 1) {
    const numberedSuffix = `${suffix}_${number}`;
    const numberedBaseLength = Math.max(2, 32 - numberedSuffix.length);
    const candidate = `${cleanName.slice(0, numberedBaseLength)}${numberedSuffix}`;

    if (!usedNames.has(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Could not allocate a unique application emoji name for source emoji ${sourceEmojiId}.`,
  );
}

async function getApplicationEmojis(client) {
  if (!client.application) {
    throw new Error(
      "[emoji-sync] client.application is unavailable. Run sync after the client ready event.",
    );
  }

  return client.application.emojis.fetch();
}

async function syncApplicationEmojis({ client, sourceGuild, state }) {
  const sourceEmojis = await sourceGuild.emojis.fetch();
  const applicationEmojis = await getApplicationEmojis(client);

  const applicationByHash = new Map();

  for (const applicationEmoji of applicationEmojis.values()) {
    try {
      const { hash } = await getAsset(applicationEmoji.imageURL());

      applicationByHash.set(
        makeHashKey(applicationEmoji.animated, hash),
        applicationEmoji,
      );
    } catch (error) {
      console.warn(
        `[emoji-sync] Could not hash application emoji ${applicationEmoji.name} (${applicationEmoji.id}): ${error.message}`,
      );
    }
  }

  const result = {
    sourceEmojiCount: sourceEmojis.size,
    applicationEmojiCount: applicationEmojis.size,
    created: 0,
    renamed: 0,
    adopted: 0,
    deleted: 0,
    failed: 0,
  };

  for (const sourceEmoji of sourceEmojis.values()) {
    const existingMapping = getMapping(state, sourceEmoji.id);

    const mappedApplicationEmoji = existingMapping
      ? applicationEmojis.get(existingMapping.applicationEmojiId)
      : null;

    try {
      const { buffer, hash } = await getAsset(sourceEmoji.imageURL());
      const hashKey = makeHashKey(sourceEmoji.animated, hash);

      if (mappedApplicationEmoji) {
        const desiredName = createUniqueName({
          preferredName: sourceEmoji.name,
          sourceEmojiId: sourceEmoji.id,
          applicationEmojis: [...applicationEmojis.values()],
          ignoreApplicationEmojiId: mappedApplicationEmoji.id,
        });

        if (
          existingMapping.ownership === "bot_created" &&
          mappedApplicationEmoji.name !== desiredName
        ) {
          await mappedApplicationEmoji.edit({
            name: desiredName,
          });

          result.renamed += 1;
          await delay(750);
        }

        upsertMapping(state, {
          ...existingMapping,
          sourceGuildId: sourceGuild.id,
          sourceEmojiName: sourceEmoji.name,
          sourceAnimated: sourceEmoji.animated,
          sourceHash: hash,
          updatedAt: new Date().toISOString(),
        });

        continue;
      }

      const identicalApplicationEmoji = applicationByHash.get(hashKey);

      if (identicalApplicationEmoji) {
        upsertMapping(state, {
          sourceGuildId: sourceGuild.id,
          sourceEmojiId: sourceEmoji.id,
          sourceEmojiName: sourceEmoji.name,
          sourceAnimated: sourceEmoji.animated,
          sourceHash: hash,
          applicationEmojiId: identicalApplicationEmoji.id,
          ownership: "adopted",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        result.adopted += 1;
        continue;
      }

      const uniqueName = createUniqueName({
        preferredName: sourceEmoji.name,
        sourceEmojiId: sourceEmoji.id,
        applicationEmojis: [...applicationEmojis.values()],
      });

      const createdApplicationEmoji = await client.application.emojis.create({
        attachment: buffer,
        name: uniqueName,
      });

      upsertMapping(state, {
        sourceGuildId: sourceGuild.id,
        sourceEmojiId: sourceEmoji.id,
        sourceEmojiName: sourceEmoji.name,
        sourceAnimated: sourceEmoji.animated,
        sourceHash: hash,
        applicationEmojiId: createdApplicationEmoji.id,
        ownership: "bot_created",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      applicationEmojis.set(
        createdApplicationEmoji.id,
        createdApplicationEmoji,
      );

      applicationByHash.set(hashKey, createdApplicationEmoji);

      result.created += 1;

      // Application emoji endpoints are separately rate-limited.
      await delay(1_000);
    } catch (error) {
      result.failed += 1;

      console.error(
        `[emoji-sync] Failed importing ${sourceEmoji.name} (${sourceEmoji.id}):`,
        error,
      );
    }
  }

  const sourceEmojiIds = new Set(sourceEmojis.keys());

  for (const mapping of [...state.mappings]) {
    if (sourceEmojiIds.has(mapping.sourceEmojiId)) {
      continue;
    }

    removeMapping(state, mapping.sourceEmojiId);

    // Never remove an app emoji that existed before this sync service.
    if (mapping.ownership !== "bot_created") {
      continue;
    }

    const applicationEmoji = applicationEmojis.get(mapping.applicationEmojiId);

    if (!applicationEmoji) {
      continue;
    }

    try {
      await applicationEmoji.delete();

      result.deleted += 1;
      await delay(1_000);
    } catch (error) {
      result.failed += 1;

      console.error(
        `[emoji-sync] Failed deleting obsolete application emoji ${applicationEmoji.name} (${applicationEmoji.id}):`,
        error,
      );
    }
  }

  return result;
}

async function runEmojiSync(client) {
  assertConfig();

  if (syncInProgress) {
    syncQueued = true;
    return null;
  }

  syncInProgress = true;

  try {
    const sourceGuild = await client.guilds.fetch(SOURCE_GUILD_ID);
    const state = await readState();

    const result = await syncApplicationEmojis({
      client,
      sourceGuild,
      state,
    });

    await writeState(state);

    console.log(
      `[emoji-sync] Sync complete: ${result.created} created, ${result.renamed} renamed, ${result.adopted} adopted, ${result.deleted} deleted, ${result.failed} failed.`,
    );

    return result;
  } finally {
    syncInProgress = false;

    if (syncQueued) {
      syncQueued = false;
      queueEmojiSync(client, "queued follow-up");
    }
  }
}

function queueEmojiSync(client, reason = "source guild emoji update") {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    debounceTimer = null;

    runEmojiSync(client).catch((error) => {
      console.error(`[emoji-sync] Sync failed after ${reason}:`, error);
    });
  }, DEBOUNCE_MS);
}

function registerEmojiSync(client) {
  assertConfig();

  client.on("emojiCreate", (emoji) => {
    if (emoji.guild?.id !== SOURCE_GUILD_ID) {
      return;
    }

    queueEmojiSync(client, "source emoji created");
  });

  client.on("emojiUpdate", (oldEmoji, newEmoji) => {
    if (newEmoji.guild?.id !== SOURCE_GUILD_ID) {
      return;
    }

    queueEmojiSync(client, "source emoji updated");
  });

  client.on("emojiDelete", (emoji) => {
    if (emoji.guild?.id !== SOURCE_GUILD_ID) {
      return;
    }

    queueEmojiSync(client, "source emoji deleted");
  });

  console.log(
    `[emoji-sync] Source guild ${SOURCE_GUILD_ID} will mirror into this application's emoji collection.`,
  );
}

module.exports = {
  registerEmojiSync,
  runEmojiSync,
  queueEmojiSync,
};
