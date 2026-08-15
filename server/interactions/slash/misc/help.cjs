const {
  EmbedBuilder,
  SlashCommandBuilder,
  ApplicationCommandOptionType,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");

const MOD_ROLE_ID = "1479193858565865472";

const COLORS = {
  primary: 0x5865f2,
  success: 0x57f287,
  error: 0xed4245,
  muted: 0x99aab5,
};

function getBotAvatar(client) {
  return client.user?.displayAvatarURL({ size: 256 }) ?? null;
}

function createBaseEmbed(interaction) {
  const avatar = getBotAvatar(interaction.client);

  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setFooter({
      text: interaction.client.user?.username ?? "Bot",
      iconURL: avatar,
    })
    .setTimestamp();
}

function isModerator(interaction) {
  const member = interaction.member;

  return (
    member?.roles?.cache?.has(MOD_ROLE_ID) ||
    member?.permissions?.has(PermissionFlagsBits.Administrator)
  );
}

function canViewCommand(interaction, command) {
  return !command.moderatorOnly || isModerator(interaction);
}

/*
 * Embed field values may not exceed 1,024 characters.
 * Commands with many options, such as /fdc, are split across fields.
 */
function formatOptionFields(command) {
  const options = command.options ?? [];

  if (!options.length) {
    return [
      {
        name: "Options",
        value: "This command has no options.",
        inline: false,
      },
    ];
  }

  const optionBlocks = options.map((option) => {
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
  });

  const fields = [];
  let currentChunk = "";

  for (const block of optionBlocks) {
    const proposed = currentChunk ? `${currentChunk}\n\n${block}` : block;

    if (proposed.length > 1024 && currentChunk) {
      fields.push({
        name: fields.length === 0 ? "Options" : "Options (continued)",
        value: currentChunk,
        inline: false,
      });

      currentChunk = block;
    } else {
      currentChunk = proposed;
    }
  }

  if (currentChunk) {
    fields.push({
      name: fields.length === 0 ? "Options" : "Options (continued)",
      value: currentChunk,
      inline: false,
    });
  }

  return fields;
}

function createCommandFields(commands, title) {
  if (!commands.length) {
    return [];
  }

  const commandLines = commands.map(
    (command) =>
      `</${command.data.name}:0> — ${
        command.data.description || "*No description*"
      }`,
  );

  const fields = [];
  let currentChunk = [];

  for (const line of commandLines) {
    const proposed = [...currentChunk, line].join("\n");

    if (proposed.length > 1024 && currentChunk.length > 0) {
      fields.push({
        name: fields.length === 0 ? title : `${title} (continued)`,
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
      name: fields.length === 0 ? title : `${title} (continued)`,
      value: currentChunk.join("\n"),
      inline: false,
    });
  }

  return fields;
}

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
    const canViewModeratorCommands = isModerator(interaction);

    const choices = interaction.client.slashCommands
      .filter((command) => !command.moderatorOnly || canViewModeratorCommands)
      .map((command) => ({
        name: `/${command.data.name}: ${command.data.description}`,
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
    const userIsModerator = isModerator(interaction);

    if (requestedName) {
      const command = commands.get(requestedName);

      if (!command) {
        const suggestions = commands
          .filter((item) => canViewCommand(interaction, item))
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
          flags: MessageFlags.Ephemeral,
        });
      }

      if (command.moderatorOnly && !userIsModerator) {
        return interaction.reply({
          content: "You don't have permission to use this command.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const commandEmbed = createBaseEmbed(interaction)
        .setTitle(`/${command.data.name}`)
        .setDescription(
          command.data.description || "No description has been provided.",
        )
        .addFields(
          {
            name: "Category",
            value: command.moderatorOnly ? "Moderator" : "Public",
            inline: true,
          },
          {
            name: "Usage",
            value: `\`/${command.data.name}\``,
            inline: true,
          },
          ...formatOptionFields(command.data),
        );

      return interaction.reply({
        embeds: [commandEmbed],
      });
    }

    const sortedCommands = commands
      .map((command) => command)
      .sort((a, b) => a.data.name.localeCompare(b.data.name));

    const publicCommands = sortedCommands.filter(
      (command) => !command.moderatorOnly,
    );

    const moderatorCommands = sortedCommands.filter(
      (command) => command.moderatorOnly,
    );

    const fields = [...createCommandFields(publicCommands, "Public commands")];

    if (userIsModerator) {
      fields.push(
        ...createCommandFields(moderatorCommands, "Moderator commands"),
      );
    }

    const visibleCommandCount = userIsModerator
      ? sortedCommands.length
      : publicCommands.length;

    const listEmbed = createBaseEmbed(interaction)
      .setTitle("Command Center")
      .setDescription(
        [
          `I currently have **${visibleCommandCount}** available slash command${
            visibleCommandCount === 1 ? "" : "s"
          }.`,
          "",
          "Use `/help command:<command>` to see its options and usage.",
          userIsModerator
            ? "You can also view moderator commands."
            : "Moderator commands are hidden.",
        ].join("\n"),
      )
      .addFields(
        fields.length
          ? fields
          : [
              {
                name: "No commands available",
                value: "No slash commands are currently registered.",
                inline: false,
              },
            ],
      );

    return interaction.reply({
      embeds: [listEmbed],
    });
  },
};
