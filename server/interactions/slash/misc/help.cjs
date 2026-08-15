const {
  EmbedBuilder,
  SlashCommandBuilder,
  ApplicationCommandOptionType,
} = require("discord.js");

const COLORS = {
  primary: 0x5865f2,
  success: 0x57f287,
  error: 0xed4245,
  muted: 0x99aab5,
};

/**
 * @param {import("discord.js").Client} client
 * @returns {string}
 */
function getBotAvatar(client) {
  return client.user?.displayAvatarURL({ size: 256 }) ?? null;
}

/**
 * @param {import("discord.js").ChatInputCommandInteraction} interaction
 * @returns {EmbedBuilder}
 */
function createBaseEmbed(interaction) {
  const avatar = getBotAvatar(interaction.client);

  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setFooter({
      text: `${interaction.client.user?.username ?? "Bot"} • Help Center`,
      iconURL: avatar,
    })
    .setTimestamp();
}

/**
 * @param {import("discord.js").SlashCommandBuilder} command
 * @returns {string}
 */
function formatOptions(command) {
  const options = command.options ?? [];

  if (!options.length) {
    return "This command has no options.";
  }

  return options
    .map((option) => {
      const required = option.required ? "`Required`" : "`Optional`";
      const type =
        ApplicationCommandOptionType[option.type]
          ?.replaceAll("_", " ")
          .toLowerCase() ?? "unknown";

      return [
        `**${option.name}** ${required}`,
        `> ${option.description || "No description provided."}`,
        `> Type: \`${type}\``,
      ].join("\n");
    })
    .join("\n\n");
}

/**
 * @type {import("../../../typings").SlashInteractionCommand}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Browse all commands or view help for one command.")
    .addStringOption((option) =>
      option
        .setName("command")
        .setDescription("The command to get detailed help for.")
        .setAutocomplete(true),
    ),

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused().toLowerCase();

    const choices = interaction.client.slashCommands
      .map((command) => ({
        name: `/${command.data.name} — ${command.data.description}`,
        value: command.data.name,
      }))
      .filter(
        (command) =>
          command.value.includes(focusedValue) ||
          command.name.toLowerCase().includes(focusedValue),
      )
      .slice(0, 25);

    await interaction.respond(choices);
  },

  async execute(interaction) {
    const requestedName = interaction.options
      .getString("command")
      ?.trim()
      .replace(/^\//, "")
      .toLowerCase();

    const commands = interaction.client.slashCommands;

    if (requestedName) {
      const command = commands.get(requestedName);

      if (!command) {
        const suggestions = commands
          .map((item) => item.data.name)
          .filter((name) => name.includes(requestedName))
          .slice(0, 5);

        const suggestionText = suggestions.length
          ? `\n\nDid you mean: ${suggestions
              .map((name) => `\`/${name}\``)
              .join(", ")}?`
          : "";

        const errorEmbed = createBaseEmbed(interaction)
          .setColor(COLORS.error)
          .setTitle("Command not found")
          .setDescription(
            `I couldn't find a command named \`/${requestedName}\`.${suggestionText}`,
          );

        return interaction.reply({
          embeds: [errorEmbed],
          ephemeral: true,
        });
      }

      const commandEmbed = createBaseEmbed(interaction)
        .setTitle(`/${command.data.name}`)
        .setDescription(
          command.data.description || "No description has been provided.",
        )
        .addFields(
          {
            name: "Usage",
            value: `\`/${command.data.name}\``,
            inline: true,
          },
          {
            name: "Options",
            value: formatOptions(command.data),
            inline: false,
          },
        );

      return interaction.reply({ embeds: [commandEmbed] });
    }

    const sortedCommands = commands
      .map((command) => command.data)
      .sort((a, b) => a.name.localeCompare(b.name));

    const commandLines = sortedCommands.map(
      (command) =>
        `</${command.name}:0> — ${command.description || "*No description*"}`,
    );

    // Discord embed field values max out at 1,024 chars.
    const fields = [];
    let currentChunk = [];

    for (const line of commandLines) {
      const proposed = [...currentChunk, line].join("\n");

      if (proposed.length > 1024 && currentChunk.length > 0) {
        fields.push({
          name: fields.length === 0 ? "Available commands" : "More commands",
          value: currentChunk.join("\n"),
          inline: false,
        });

        currentChunk = [line];
      } else {
        currentChunk.push(line);
      }
    }

    if (currentChunk.length > 0) {
      fields.push({
        name: fields.length === 0 ? "Available commands" : "More commands",
        value: currentChunk.join("\n"),
        inline: false,
      });
    }

    const listEmbed = createBaseEmbed(interaction)
      .setTitle("Command Center")
      .setDescription(
        [
          `I currently have **${sortedCommands.length}** slash command${
            sortedCommands.length === 1 ? "" : "s"
          }.`,
          "",
          "Use `/help command:<command>` to see its options and usage.",
        ].join("\n"),
      )
      .addFields(
        fields.length
          ? fields
          : [
              {
                name: "No commands available",
                value: "No slash commands are currently registered.",
              },
            ],
      );

    return interaction.reply({ embeds: [listEmbed] });
  },
};
