const fs = require("node:fs/promises");
const path = require("node:path");

const mcs = require("node-mcstatus");
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

async function fetchMinecraftStatus() {
  try {
    const result = await mcs.statusJava(
      MINECRAFT_SERVER.host,
      MINECRAFT_SERVER.port,
      {
        query: false,
      },
    );

    return {
      online: result.online === true,
      displayHost: MINECRAFT_SERVER.host,
      displayPort: MINECRAFT_SERVER.port,
      motd: result.motd?.clean ?? "No MOTD configured",
      onlinePlayers: result.players?.online ?? 0,
      maxPlayers: result.players?.max ?? 0,
      version:
        result.version?.name_clean ?? result.version?.name_raw ?? "Unknown",
      latency: result.round_trip_latency ?? null,
      playerNames: (result.players?.list ?? [])
        .map((player) => player.name_clean)
        .filter(Boolean),
      error: null,
    };
  } catch (error) {
    console.error("[Minecraft Status] Lookup failed:", error);

    return {
      online: false,
      displayHost: MINECRAFT_SERVER.host,
      displayPort: MINECRAFT_SERVER.port,
      error: error.message,
    };
  }
}

function makeMinecraftStatusEmbed(status) {
  const updatedAt = Math.floor(Date.now() / 1000);
  const address = `\`${status.displayHost}\``;

  if (!status.online) {
    return new EmbedBuilder()
      .setColor("#ED4245")
      .setTitle("🔴 Offline")
      .setDescription("The server did not respond to the latest status check.")
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
      name: "Server address",
      value: address,
      inline: false,
    },
  ];

  return new EmbedBuilder()
    .setColor("#57F287")
    .setTitle("🟢 Online")
    .setDescription(status.motd || "No MOTD configured")
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
        Editing with a new uploaded attachment can leave old attachments on
        the Discord message. Supplying attachments: [] replaces/removes the
        existing attachment list before uploading the current thumbnail.
      */
      await oldStatusMessage.edit({
        ...createPayload(),
        attachments: [],
      });

      return;
    }

    /*
      Send replacement before deleting old status card. This protects against
      a temporary Discord/API failure leaving no status panel in the thread.
    */
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
