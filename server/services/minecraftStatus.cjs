const fs = require("node:fs/promises");
const path = require("node:path");
const dns = require("node:dns").promises;

const { JavaPingClient } = require("craftping");
const { AttachmentBuilder, EmbedBuilder } = require("discord.js");

const MINECRAFT_SERVER = {
  host: "nigelserver2026.aternos.me",
  port: 25565,
};

const STATUS_FILE = path.join(__dirname, "db", "minecraft-status.json");
const THUMBNAIL_FILE = path.join(__dirname, "db", "minecraft-server.png");

const DEFAULT_STATE = {
  threadId: "1543613705651093624",
  messageId: null,
};

let updateInProgress = false;
let bumpTimeout = null;
let intervalHandle = null;

async function readStatusState() {
  try {
    const raw = await fs.readFile(STATUS_FILE, "utf8");
    const state = JSON.parse(raw);

    if (!state.threadId) {
      throw new Error("minecraft-status.json is missing a valid threadId.");
    }

    return {
      threadId: state.threadId,
      messageId: state.messageId ?? null,
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      await writeStatusState(DEFAULT_STATE);
      return { ...DEFAULT_STATE };
    }

    if (error instanceof SyntaxError) {
      throw new Error(
        `Could not parse ${STATUS_FILE}. Ensure it contains valid JSON.`,
      );
    }

    throw error;
  }
}

async function writeStatusState(state) {
  await fs.mkdir(path.dirname(STATUS_FILE), {
    recursive: true,
  });

  const temporaryFile = `${STATUS_FILE}.tmp`;

  await fs.writeFile(
    temporaryFile,
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8",
  );

  await fs.rename(temporaryFile, STATUS_FILE);
}

function createMinecraftThumbnailAttachment() {
  return new AttachmentBuilder(THUMBNAIL_FILE, {
    name: "minecraft-server.png",
  });
}

function flattenMinecraftText(component) {
  if (component == null) {
    return "";
  }

  if (typeof component === "string") {
    return component;
  }

  if (Array.isArray(component)) {
    return component.map(flattenMinecraftText).join("");
  }

  if (typeof component !== "object") {
    return String(component);
  }

  const parts = [];

  if (typeof component.text === "string") {
    parts.push(component.text);
  }

  if (typeof component.translate === "string") {
    parts.push(component.translate);
  }

  if (Array.isArray(component.extra)) {
    parts.push(component.extra.map(flattenMinecraftText).join(""));
  }

  if (Array.isArray(component.with)) {
    parts.push(component.with.map(flattenMinecraftText).join(""));
  }

  return parts.join("");
}

function stripMinecraftFormatting(text) {
  return text
    .replace(/§[0-9A-FK-OR]/gi, "")
    .replace(/&[0-9A-FK-OR]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/*
  Aternos uses a dynamic Java port, published through:
  _minecraft._tcp.<server hostname>

  Resolve it before every ping. Never hard-code the result, because the
  assigned port can change whenever the Aternos server is restarted.
*/
async function resolveMinecraftServerAddress() {
  const fallbackAddress = {
    host: MINECRAFT_SERVER.host,
    port: MINECRAFT_SERVER.port,
  };

  try {
    const records = await dns.resolveSrv(
      `_minecraft._tcp.${MINECRAFT_SERVER.host}`,
    );

    if (!records.length) {
      return fallbackAddress;
    }

    records.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }

      return b.weight - a.weight;
    });

    const record = records[0];

    return {
      host: record.name.replace(/\.$/, ""),
      port: record.port,
    };
  } catch (error) {
    console.warn(
      "[Minecraft Status] SRV lookup failed; using default address:",
      error.code ?? error.message,
    );

    return fallbackAddress;
  }
}

function isAternosOfflineResponse(result) {
  const motd = stripMinecraftFormatting(
    flattenMinecraftText(result.description),
  ).toLowerCase();

  const version = stripMinecraftFormatting(
    flattenMinecraftText(result.version?.name),
  ).toLowerCase();

  return motd.includes("this server is offline") || version.includes("offline");
}

async function fetchMinecraftStatus() {
  try {
    const resolvedServer = await resolveMinecraftServerAddress();

    console.log(
      `[Minecraft Status] Checking ${resolvedServer.host}:${resolvedServer.port}`,
    );

    const minecraftPing = new JavaPingClient();
    const startedAt = performance.now();

    const result = await minecraftPing.ping(
      resolvedServer.host,
      resolvedServer.port,
      {
        signal: AbortSignal.timeout(10_000),
      },
    );

    const latency = Math.round(performance.now() - startedAt);
    const motd = stripMinecraftFormatting(
      flattenMinecraftText(result.description),
    );
    const version = stripMinecraftFormatting(
      flattenMinecraftText(result.version?.name),
    );

    /*
      Aternos can answer a regular Minecraft status ping while the actual
      server is stopped. Its proxy returns an offline MOTD/version response,
      so a successful craftping request alone must not mean "server online".
    */
    if (isAternosOfflineResponse(result)) {
      console.log("[Minecraft Status] returned an offline status response.");

      return {
        online: false,
        displayHost: MINECRAFT_SERVER.host,
        displayPort: MINECRAFT_SERVER.port,
        error: "The Server is offline.",
      };
    }

    return {
      online: true,
      displayHost: MINECRAFT_SERVER.host,
      displayPort: MINECRAFT_SERVER.port,
      motd: motd || "No MOTD configured",
      onlinePlayers: result.players?.online ?? 0,
      maxPlayers: result.players?.max ?? 0,
      version: version || "Unknown",
      latency,
      playerNames: (result.players?.sample ?? [])
        .map((player) => player.name)
        .filter(Boolean),
      error: null,
    };
  } catch (error) {
    console.error("[Minecraft Status] Direct ping failed:", error);

    return {
      online: false,
      displayHost: MINECRAFT_SERVER.host,
      displayPort: MINECRAFT_SERVER.port,
      error: error.message || "The Minecraft status check failed.",
    };
  }
}

function makeMinecraftStatusEmbed(status) {
  const updatedAt = Math.floor(Date.now() / 1000);
  const address = `\`${status.displayHost}\``;

  if (!status.online) {
    return new EmbedBuilder()
      .setColor("#DD2E44")
      .setTitle("🔴 Offline")
      .setDescription(status.error ?? "The Server is currently offline.")
      .addFields({
        name: "Server address",
        value: address,
        inline: true,
      })
      .setThumbnail("attachment://minecraft-server.png")
      .setTimestamp();
  }

  const fields = [
    {
      name: "Players",
      value: `👥 ${status.onlinePlayers}/${status.maxPlayers}`,
      inline: true,
    },
    {
      name: "Version",
      value: `🧱 ${status.version}`,
      inline: true,
    },
    {
      name: "Latency",
      value: `📶 ${status.latency} ms`,
      inline: true,
    },
    {
      name: "Server address",
      value: address,
      inline: true,
    },
  ];

  return new EmbedBuilder()
    .setColor("#78B159")
    .setTitle("🟢 Online")
    .setDescription(status.motd || "")
    .addFields(fields)
    .setThumbnail("attachment://minecraft-server.png")
    .setTimestamp();
}

async function getLatestThreadMessage(thread) {
  const messages = await thread.messages.fetch({
    limit: 1,
  });

  return messages.first() ?? null;
}

function isUnknownMessageError(error) {
  return error?.code === 10008;
}

async function updateMinecraftStatus(client) {
  if (updateInProgress) {
    return;
  }

  updateInProgress = true;

  try {
    const state = await readStatusState();
    const thread = await client.channels.fetch(state.threadId);

    if (!thread?.isThread()) {
      throw new Error(
        `Minecraft status target ${state.threadId} could not be accessed as a thread.`,
      );
    }

    if (thread.archived) {
      await thread.setArchived(
        false,
        "Refreshing bottom Minecraft server status",
      );
    }

    if (!thread.sendable) {
      throw new Error(
        "The bot cannot send messages in the configured Minecraft status thread.",
      );
    }

    const status = await fetchMinecraftStatus();
    const embed = makeMinecraftStatusEmbed(status);

    const createPayload = () => ({
      embeds: [embed],
      files: [createMinecraftThumbnailAttachment()],
    });

    let oldStatusMessage = null;

    if (state.messageId) {
      try {
        oldStatusMessage = await thread.messages.fetch(state.messageId);
      } catch (error) {
        if (!isUnknownMessageError(error)) {
          throw error;
        }

        console.warn(
          "[Minecraft Status] Previous status message was deleted; creating a replacement.",
        );
      }
    }

    const newestMessage = await getLatestThreadMessage(thread);

    const statusIsAtBottom =
      oldStatusMessage &&
      newestMessage &&
      oldStatusMessage.id === newestMessage.id;

    if (statusIsAtBottom) {
      /*
        Do not pass attachments: [] here. That would explicitly remove the
        thumbnail attachment during the edit. The new file replaces it.
      */
      await oldStatusMessage.edit(createPayload());
      return;
    }

    const newStatusMessage = await thread.send(createPayload());

    await writeStatusState({
      threadId: thread.id,
      messageId: newStatusMessage.id,
    });

    if (oldStatusMessage?.deletable) {
      try {
        await oldStatusMessage.delete();
      } catch (error) {
        console.warn(
          "[Minecraft Status] Could not remove the old status message:",
          error,
        );
      }
    }

    console.log(
      "[Minecraft Status] Status message created or moved to bottom.",
    );
  } finally {
    updateInProgress = false;
  }
}

function bumpMinecraftStatusSoon(client) {
  if (bumpTimeout) {
    clearTimeout(bumpTimeout);
  }

  bumpTimeout = setTimeout(() => {
    bumpTimeout = null;

    updateMinecraftStatus(client).catch((error) => {
      console.error(
        "[Minecraft Status] Could not move status card to thread bottom:",
        error,
      );
    });
  }, 3_000);
}

function startMinecraftStatusUpdater(client) {
  if (intervalHandle) {
    return intervalHandle;
  }

  const refresh = () => {
    updateMinecraftStatus(client).catch((error) => {
      console.error("[Minecraft Status] Scheduled update failed:", error);
    });
  };

  refresh();

  intervalHandle = setInterval(refresh, 2 * 60 * 1000);

  return intervalHandle;
}

module.exports = {
  fetchMinecraftStatus,
  makeMinecraftStatusEmbed,
  updateMinecraftStatus,
  bumpMinecraftStatusSoon,
  startMinecraftStatusUpdater,
};
