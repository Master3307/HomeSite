const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");

const prefix = process.env.BOT_PREFIX || "!";
const MOD_ROLE_ID = "1479193858565865472";

const COLORS = {
  primary: 0x5865f2,
  error: 0xed4245,
};

function getBotAvatar(client) {
  return client.user?.displayAvatarURL({ size: 256 }) ?? null;
}

function createBaseEmbed(message) {
  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setFooter({
      text: message.client.user?.username ?? "Bot",
      iconURL: getBotAvatar(message.client),
    })
    .setTimestamp();
}

function isModerator(message) {
  if (!message.guild || !message.member) {
    return false;
  }

  return (
    message.member.roles.cache.has(MOD_ROLE_ID) ||
    message.member.permissions.has(PermissionFlagsBits.Administrator)
  );
}

function canViewCommand(message, command) {
  return !command.moderatorOnly || isModerator(message);
}

function chunkLines(lines, maxLength = 1024) {
  const chunks = [];
  let currentChunk = [];

  for (const line of lines) {
    const nextChunk = [...currentChunk, line].join("\n");

    if (nextChunk.length > maxLength && currentChunk.length > 0) {
      chunks.push(currentChunk.join("\n"));
      currentChunk = [line];
      continue;
    }

    currentChunk.push(line);
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join("\n"));
  }

  return chunks;
}

function createCommandFields(commands, title) {
  if (!commands.length) {
    return [];
  }

  const commandLines = commands.map((command) => {
    const description = command.description || "No description provided.";
    return `\`${prefix}${command.name}\`: ${description}`;
  });

  return chunkLines(commandLines).map((chunk, index) => ({
    name: index === 0 ? title : `${title} (continued)`,
    value: chunk,
    inline: false,
  }));
}

module.exports = {
  name: "help",
  description: "Browse all commands or view help for one command.",
  aliases: ["commands", "cmds"],
  usage: "[command name]",
  cooldown: 5,

  async execute(message, args) {
    const { commands } = message.client;
    const userIsModerator = isModerator(message);

    // !help — show command categories directly in the current channel.
    if (!args.length) {
      const sortedCommands = commands
        .filter((command) => command.name)
        .sort((a, b) => a.name.localeCompare(b.name));

      const publicCommands = sortedCommands.filter(
        (command) => !command.moderatorOnly,
      );

      const moderatorCommands = sortedCommands.filter(
        (command) => command.moderatorOnly,
      );

      const fields = [
        ...createCommandFields(publicCommands, "Public Commands"),
      ];

      if (userIsModerator) {
        fields.push(
          ...createCommandFields(moderatorCommands, "Moderator Commands"),
        );
      }

      const visibleCommandCount = userIsModerator
        ? sortedCommands.length
        : publicCommands.length;

      const helpEmbed = createBaseEmbed(message)
        .setTitle("Command Center")
        .setDescription(
          [
            `I currently have **${visibleCommandCount}** available command${
              visibleCommandCount === 1 ? "" : "s"
            }.`,
            "",
            `Use \`${prefix}help <command>\` for detailed information.`,
            `Example: \`${prefix}help random-cat\``,
            userIsModerator
              ? "You can view moderator commands."
              : "Moderator commands are hidden.",
          ].join("\n"),
        )
        .addFields(
          fields.length
            ? fields
            : [
                {
                  name: "No commands available",
                  value: "No prefix commands are currently loaded.",
                },
              ],
        );

      return message.reply({
        embeds: [helpEmbed],
        allowedMentions: {
          repliedUser: false,
        },
      });
    }

    const requestedName = args[0].trim().toLowerCase();

    const command =
      commands.get(requestedName) ||
      commands.find((item) =>
        item.aliases?.some((alias) => alias.toLowerCase() === requestedName),
      );

    if (!command) {
      const suggestions = commands
        .filter((item) => canViewCommand(message, item))
        .filter((item) => {
          const names = [item.name, ...(item.aliases ?? [])];

          return names.some((name) =>
            name.toLowerCase().includes(requestedName),
          );
        })
        .map((item) => `\`${prefix}${item.name}\``)
        .slice(0, 5);

      const errorEmbed = createBaseEmbed(message)
        .setColor(COLORS.error)
        .setTitle("Command Not Found")
        .setDescription(
          [
            `I couldn't find a command named \`${requestedName}\`.`,
            suggestions.length
              ? `\nDid you mean: ${suggestions.join(", ")}?`
              : `\nUse \`${prefix}help\` to see every available command.`,
          ].join("\n"),
        );

      return message.reply({
        embeds: [errorEmbed],
        allowedMentions: {
          repliedUser: false,
        },
      });
    }

    // Do not reveal moderator command information to regular users.
    if (command.moderatorOnly && !userIsModerator) {
      return message.reply({
        content: "You don't have permission to use this command.",
        allowedMentions: {
          repliedUser: false,
        },
      });
    }

    const aliases = command.aliases?.length
      ? command.aliases.map((alias) => `\`${prefix}${alias}\``).join(", ")
      : "No aliases";

    const usageSuffix = command.usage ? ` ${command.usage}` : "";

    const commandEmbed = createBaseEmbed(message)
      .setTitle(`${prefix}${command.name}`)
      .setDescription(command.description || "No description provided.")
      .addFields(
        {
          name: "Category",
          value: command.moderatorOnly ? "Moderator" : "Public",
          inline: true,
        },
        {
          name: "Cooldown",
          value: `${command.cooldown ?? 3} second(s)`,
          inline: true,
        },
        {
          name: "Usage",
          value: `\`${prefix}${command.name}${usageSuffix}\``,
          inline: false,
        },
        {
          name: "Aliases",
          value: aliases,
          inline: false,
        },
      );

    return message.reply({
      embeds: [commandEmbed],
      allowedMentions: {
        repliedUser: false,
      },
    });
  },
};
