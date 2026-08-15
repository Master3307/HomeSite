const { EmbedBuilder, ChannelType } = require("discord.js");

const prefix = process.env.BOT_PREFIX || "!";

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
      text: `${message.client.user?.username ?? "Bot"} • Help Center`,
      iconURL: getBotAvatar(message.client),
    })
    .setTimestamp();
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

module.exports = {
  name: "help",
  description: "Browse all commands or view help for one command.",
  aliases: ["commands", "cmds"],
  usage: "[command name]",
  cooldown: 5,

  async execute(message, args) {
    const { commands } = message.client;

    // /help equivalent: !help
    if (!args.length) {
      const sortedCommands = commands
        .filter((command) => command.name)
        .sort((a, b) => a.name.localeCompare(b.name));

      const commandLines = sortedCommands.map((command) => {
        const description = command.description || "No description provided.";
        return `\`${prefix}${command.name}\` — ${description}`;
      });

      const commandChunks = chunkLines(commandLines);

      const commandFields = commandChunks.map((chunk, index) => ({
        name: index === 0 ? "Available Commands" : "More Commands",
        value: chunk,
        inline: false,
      }));

      const helpEmbed = createBaseEmbed(message)
        .setTitle("Command Center")
        .setDescription(
          [
            `I currently have **${sortedCommands.length}** command${
              sortedCommands.length === 1 ? "" : "s"
            }.`,
            "",
            `Use \`${prefix}help <command>\` for detailed information.`,
            `Example: \`${prefix}help random-cat\``,
          ].join("\n"),
        )
        .addFields(
          commandFields.length
            ? commandFields
            : [
                {
                  name: "No commands available",
                  value: "No prefix commands are currently loaded.",
                },
              ],
        );

      try {
        await message.author.send({ embeds: [helpEmbed] });

        if (message.channel.type !== ChannelType.DM) {
          await message.reply({
            content: "📬 I've sent the full command list to your DMs!",
            allowedMentions: {
              repliedUser: false,
            },
          });
        }
      } catch (error) {
        console.error(
          `Could not send help DM to ${message.author.tag}.`,
          error,
        );

        const fallbackEmbed = createBaseEmbed(message)
          .setColor(COLORS.error)
          .setTitle("I couldn't send you a DM")
          .setDescription(
            [
              "Your DMs may be disabled or blocked for this server.",
              "",
              "Please enable DMs temporarily and try again.",
            ].join("\n"),
          );

        await message.reply({
          embeds: [fallbackEmbed],
          allowedMentions: {
            repliedUser: false,
          },
        });
      }

      return;
    }

    const requestedName = args[0].trim().toLowerCase();

    const command =
      commands.get(requestedName) ||
      commands.find((item) =>
        item.aliases?.some((alias) => alias.toLowerCase() === requestedName),
      );

    if (!command) {
      const suggestions = commands
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

      await message.reply({
        embeds: [errorEmbed],
        allowedMentions: {
          repliedUser: false,
        },
      });

      return;
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
          name: "Usage",
          value: `\`${prefix}${command.name}${usageSuffix}\``,
          inline: false,
        },
        {
          name: "Aliases",
          value: aliases,
          inline: true,
        },
        {
          name: "Cooldown",
          value: `${command.cooldown ?? 3} second(s)`,
          inline: true,
        },
      );

    await message.reply({
      embeds: [commandEmbed],
      allowedMentions: {
        repliedUser: false,
      },
    });
  },
};
