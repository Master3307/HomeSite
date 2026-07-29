const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const TARGET_CHANNEL_ID = '1479194712111059137';
const PRIVILEGED_ROLE_ID = '1479193560778805300';
const PING_ROLE_ID = '1487023716658319400';

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
        // ignore undeletable / missing perms / already deleted
      }
    }

    lastId = messages.last()?.id;
    if (!lastId) break;

    if (messages.size < 100) break;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lobby-code')
    .setDescription('Replace the lobby-code channel with a fresh code post.')
    .addStringOption((option) =>
      option
        .setName('code')
        .setDescription('The current lobby code')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(100)
    )
    .addStringOption((option) =>
      option
        .setName('desc')
        .setDescription('Optional embed description')
        .setRequired(false)
        .setMaxLength(4000)
    )
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: 'This command can only be used inside the server.',
        ephemeral: true,
      });
    }

    const member = interaction.member;
    const hasPrivilegedRole = member.roles?.cache?.has(PRIVILEGED_ROLE_ID);

    if (!hasPrivilegedRole) {
      return interaction.reply({
        content: 'You are not allowed to use this command.',
        ephemeral: true,
      });
    }

    const code = interaction.options.getString('code', true);
    const desc = interaction.options.getString('desc') ?? null;

    const channel = await interaction.client.channels.fetch(TARGET_CHANNEL_ID).catch(() => null);

    if (!channel || !channel.isTextBased()) {
      return interaction.reply({
        content: 'Target channel was not found or is not a text channel.',
        ephemeral: true,
      });
    }

    await interaction.reply({
      content: `Updating <#${TARGET_CHANNEL_ID}>...`,
      ephemeral: true,
    });

    await clearChannel(channel);

    const embed = new EmbedBuilder()
      .setTitle(code)
      .addFields({
        name: 'updated',
        value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
        inline: false,
      });

    if (desc) {
      embed.setDescription(desc);
    }

    await channel.send({
      content: `||<@&${PING_ROLE_ID}>||\nCurrent Lobby Code:`,
      embeds: [embed],
      allowedMentions: {
        roles: [PING_ROLE_ID],
      },
    });

    await interaction.editReply({
      content: `Lobby code updated in <#${TARGET_CHANNEL_ID}>.`,
    });
  },
};
