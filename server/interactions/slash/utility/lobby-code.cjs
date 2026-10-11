const {
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  MessageFlags,
} = require("discord.js");

const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const TARGET_CHANNEL_ID = "1479194712111059137";
const PING_ROLE_ID = "1487023716658319400";
const PRIVILEGED_ROLE_IDS = [
  "1479193560778805300",
  "1479193858565865472",
  "1479222319711780904",
];

const LOBBY_CODE_FILES = [
  path.resolve(__dirname, "../../../services/db/lobby-code.json"),
  path.resolve(__dirname, "../../../../public/lobby-code.json"),
];

// Keep simultaneous updates from interleaving.
let lobbyUpdateQueue = Promise.resolve();

function hasPrivilegedRole(member) {
  return PRIVILEGED_ROLE_IDS.some((roleId) =>
    member?.roles?.cache?.has(roleId),
  );
}

async function saveLobbyCode(data) {
  const json = `${JSON.stringify(data, null, 2)}\n`;

  for (const file of LOBBY_CODE_FILES) {
    await fs.mkdir(path.dirname(file), {
      recursive: true,
    });

    const temporaryFile = `${file}.${randomUUID()}.tmp`;

    try {
      await fs.writeFile(temporaryFile, json, "utf8");
      await fs.rename(temporaryFile, file);
    } finally {
      await fs.unlink(temporaryFile).catch(() => null);
    }
  }
}

async function clearChannel(channel, keepMessageId = null) {
  let lastId;

  while (true) {
    const messages = await channel.messages.fetch({
      limit: 100,
      ...(lastId ? { before: lastId } : {}),
    });

    if (!messages.size) break;

    const filtered = messages.filter((msg) => msg.id !== keepMessageId);

    if (!filtered.size) break;

    const recent = filtered.filter((msg) => {
      const ageMs = Date.now() - msg.createdTimestamp;
      return ageMs < 14 * 24 * 60 * 60 * 1000;
    });

    if (recent.size) {
      await channel.bulkDelete(recent, true);
    }

    const old = filtered.filter((msg) => {
      const ageMs = Date.now() - msg.createdTimestamp;
      return ageMs >= 14 * 24 * 60 * 60 * 1000;
    });

    for (const msg of old.values()) {
      try {
        await msg.delete();
      } catch {
        // Ignore undeletable, already deleted, or permission-related failures.
      }
    }

    lastId = messages.last()?.id;

    if (!lastId || messages.size < 100) {
      break;
    }
  }
}

async function performLobbyUpdate(
  client,
  code,
  desc = null,
  updatedById = null,
) {
  const channel = await client.channels
    .fetch(TARGET_CHANNEL_ID)
    .catch(() => null);

  if (
    !channel ||
    !channel.isTextBased() ||
    channel.type !== ChannelType.GuildText
  ) {
    throw new Error(
      "Target channel was not found or is not a normal text channel.",
    );
  }

  const user = updatedById
    ? await client.users.fetch(updatedById).catch(() => null)
    : null;

  await clearChannel(channel);

  const updatedAt = new Date();
  const unixTimestamp = Math.floor(updatedAt.getTime() / 1000);

  const updatedValue = updatedById
    ? `Updated by <@${updatedById}>\n<t:${unixTimestamp}:R>`
    : `<t:${unixTimestamp}:R>`;

  const embed = new EmbedBuilder()
    .setColor("#2F1A80")
    .setTitle(code)
    .addFields({
      name: "updated",
      value: updatedValue,
      inline: false,
    });

  if (desc) {
    embed.setDescription(desc);
  }

  const sentMessage = await channel.send({
    content: `||<@&${PING_ROLE_ID}>||\n**Current Lobby Code:**`,
    embeds: [embed],
    allowedMentions: {
      roles: [PING_ROLE_ID],
      users: updatedById ? [updatedById] : [],
    },
  });

  await saveLobbyCode({
    code,
    description: desc || null,
    updatedBy: updatedById
      ? {
          id: updatedById,
          username: user?.username ?? null,
          displayName: user?.globalName ?? user?.username ?? null,
        }
      : null,
    updatedAt: updatedAt.toISOString(),
    updatedAtUnix: unixTimestamp,
    channelId: TARGET_CHANNEL_ID,
    messageId: sentMessage.id,
  });

  return sentMessage;
}

function postLobbyCode(client, code, desc = null, updatedById = null) {
  const update = lobbyUpdateQueue.then(() =>
    performLobbyUpdate(client, code, desc, updatedById),
  );

  // A failed update must not block subsequent updates.
  lobbyUpdateQueue = update.catch(() => undefined);

  return update;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("lobby-code")
    .setDescription("Replace the lobby-code channel with a fresh code post.")
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName("code")
        .setDescription("The current lobby code")
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(100),
    )
    .addStringOption((option) =>
      option
        .setName("desc")
        .setDescription("Optional embed description")
        .setRequired(false)
        .setMaxLength(4000),
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: "This command can only be used inside the server.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const member = interaction.member;

    if (!hasPrivilegedRole(member)) {
      return interaction.reply({
        content: "You are not allowed to use this command.",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    const code = interaction.options.getString("code", true).trim();
    const desc = interaction.options.getString("desc")?.trim() || null;

    await interaction.editReply({
      content: `Clearing <#${TARGET_CHANNEL_ID}> and posting the new lobby code...`,
    });

    await postLobbyCode(interaction.client, code, desc, interaction.user.id);

    await interaction.editReply({
      content: `Done. Lobby code updated in <#${TARGET_CHANNEL_ID}>.`,
    });
  },

  hasPrivilegedRole,
  postLobbyCode,
  TARGET_CHANNEL_ID,
};
