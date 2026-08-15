const {
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  MessageFlags,
} = require("discord.js");

const TARGET_CHANNEL_ID = "1479194712111059137";
const PING_ROLE_ID = "1487023716658319400";
const PRIVILEGED_ROLE_IDS = [
  "1479193560778805300",
  "1479193858565865472",
  "1479222319711780904",
];

function hasPrivilegedRole(member) {
  return PRIVILEGED_ROLE_IDS.some((roleId) =>
    member?.roles?.cache?.has(roleId),
  );
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
      } catch (_) {
        // Ignore undeletable, already deleted, or permission-related failures.
      }
    }

    lastId = messages.last()?.id;
    if (!lastId) break;
    if (messages.size < 100) break;
  }
}

async function postLobbyCode(client, code, desc = null) {
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

  await clearChannel(channel);

  const embed = new EmbedBuilder()
    .setColor("#2F1A80")
    .setTitle(code)
    .addFields({
      name: "updated",
      value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
      inline: false,
    })
    .setTimestamp();

  if (desc) {
    embed.setDescription(desc);
  }

  return channel.send({
    content: `||<@&${PING_ROLE_ID}>||\n**Current Lobby Code:**`,
    embeds: [embed],
    allowedMentions: {
      roles: [PING_ROLE_ID],
    },
  });
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

    await postLobbyCode(interaction.client, code, desc);

    await interaction.editReply({
      content: `Done. Lobby code updated in <#${TARGET_CHANNEL_ID}>.`,
    });
  },

  hasPrivilegedRole,
  postLobbyCode,
  TARGET_CHANNEL_ID,
};
