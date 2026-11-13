const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

const archive = require("../../../services/fdcArchive.cjs");
const {
  MOD_ROLE_ID,
  ROLE_ID,
  DEFAULT_EMOJIS,
  resolveEndTime,
  resolveTarget,
  resolveOptions,
} = require("../../../services/fdcSetup.cjs");

const data = new SlashCommandBuilder()
  .setName("fdc")
  .setDescription("Start a Friday Dress Code poll");

/*
 * Discord requires required options to precede optional options.
 * Register all four required media/description pairs first.
 */
for (let number = 1; number <= 4; number += 1) {
  data
    .addAttachmentOption((option) =>
      option
        .setName(`${number}_media`)
        .setDescription(`Image or GIF for option ${number}`)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName(`${number}_description`)
        .setDescription(`Name and description for option ${number}`)
        .setMaxLength(400)
        .setRequired(true),
    );
}

data.addStringOption((option) =>
  option
    .setName("ends_at")
    .setDescription(
      "12h, 1d12h, or a date/time; default 24h. Dates use the bot's local timezone.",
    )
    .setMaxLength(100)
    .setRequired(false),
);

for (let number = 1; number <= 4; number += 1) {
  data.addStringOption((option) =>
    option
      .setName(`${number}_emoji`)
      .setDescription(
        `Reaction emoji for option ${number}; default ${DEFAULT_EMOJIS[number - 1]}`,
      )
      .setMaxLength(100)
      .setRequired(false),
  );
}

module.exports = {
  moderatorOnly: true,
  data,

  async recover(client) {
    await archive.recover(client);
  },

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
    }

    const member = interaction.member;

    if (
      !member.roles.cache.has(MOD_ROLE_ID) &&
      !member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
      return interaction.reply({
        content: "You don't have permission to use this command.",
        ephemeral: true,
      });
    }

    /*
     * Acknowledge before network requests, downloads, and conversion.
     */
    await interaction.deferReply({ ephemeral: true });

    try {
      const endInput = interaction.options.getString("ends_at");
      const endsAt = resolveEndTime(endInput);
      const { channel } = await resolveTarget(interaction.guild);

      const rawOptions = [];

      for (let number = 1; number <= 4; number += 1) {
        rawOptions.push({
          media: interaction.options.getAttachment(`${number}_media`, true),
          description: interaction.options.getString(
            `${number}_description`,
            true,
          ),
          emoji: interaction.options.getString(`${number}_emoji`),
        });
      }

      const options = await resolveOptions(
        interaction.client,
        interaction.guild,
        rawOptions,
      );

      const poll = await archive.create({
        client: interaction.client,
        source: {
          id: interaction.id,
          interactionId: interaction.id,
          guildId: interaction.guildId,
          userId: interaction.user.id,
          createdTimestamp: interaction.createdTimestamp,
          via: "discord",
        },
        channel,
        roleId: ROLE_ID,
        endsAt,
        endInput,
        options,
      });

      const endSeconds = Math.floor(poll.endsAt.ms / 1000);

      await interaction.editReply({
        content: [
          `FDC poll created in ${channel}: ${poll.messageUrl}`,
          `Closes <t:${endSeconds}:R> (<t:${endSeconds}:f>).`,
          `Archive: ${poll.date}/data.json with all four WebP images.`,
          "Votes and participation history are saved after every change.",
        ].join("\n"),
      });
    } catch (error) {
      console.error("[FDC] Creation failed:", error);

      await interaction.editReply({
        content: `I could not create the FDC poll: ${error.message}`,
      });
    }
  },
};
