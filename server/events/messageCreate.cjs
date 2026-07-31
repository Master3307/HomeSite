/**
 * @file Message Based Commands Handler
 * @author Naman Vrati
 * @since 1.0.0
 * @version 3.3.0
 */

const {
  Collection,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const prefix = process.env.BOT_PREFIX || "!";
const owners = process.env.BOT_OWNERS ? process.env.BOT_OWNERS.split(",") : [];

const {
  hasPrivilegedRole,
  postLobbyCode,
  TARGET_CHANNEL_ID,
} = require("../interactions/slash/utility/lobby-code.cjs");

const REVIEW_CHANNEL_ID = "1532015231671472399";
const REVIEW_ROLE_ID = "1479193560778805300";
const STICKY_CHANNEL_ID = "1479219328258674709";

const escapeRegex = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const { sendStickyMessageToChannel } = require("../services/stickyMessage.cjs");

module.exports = {
  name: "messageCreate",

  async execute(message) {
    const { client, guild, channel, content, author } = message;

    if (message.channelId === STICKY_CHANNEL_ID) {
      // Only repost sticky after human messages (also skips our own sticky posts).
      if (author?.bot) return;

      try {
        await sendStickyMessageToChannel(client, message.channelId);
      } catch (error) {
        console.error("Failed to send sticky message:", error);
      }
      return;
    }

    // For non-sticky channels, ignore bot messages as before.
    if (author.bot) return;

    if (guild && channel.id === TARGET_CHANNEL_ID) {
      const code = content.trim();
      if (!code) return;

      if (hasPrivilegedRole(message.member)) {
        try {
          await postLobbyCode(client, code, null);
        } catch (error) {
          console.error(
            "Failed to update lobby code from messageCreate:",
            error,
          );
        }

        return;
      }

      try {
        const reviewChannel = await client.channels
          .fetch(REVIEW_CHANNEL_ID)
          .catch(() => null);

        if (
          reviewChannel &&
          reviewChannel.isTextBased() &&
          reviewChannel.type === ChannelType.GuildText
        ) {
          const encodedCode = Buffer.from(code, "utf8").toString("base64url");

          const embed = new EmbedBuilder()
            .setColor("#2F1A80")
            .setTitle("Lobby Code Approval Request")
            .setDescription(
              `A non-privileged user submitted a lobby code that requires approval.\n\n<@&${REVIEW_ROLE_ID}>`,
            )
            .addFields(
              {
                name: "User",
                value: `${author} (${author.tag ?? author.username})`,
                inline: false,
              },
              {
                name: "User ID",
                value: author.id,
                inline: false,
              },
              {
                name: "Requested Code",
                value: code,
                inline: false,
              },
              {
                name: "Original Message ID",
                value: message.id,
                inline: false,
              },
            );

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`lobbyapprove:${author.id}:${encodedCode}`)
              .setLabel("Approve")
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`lobbydeny:${author.id}:${encodedCode}`)
              .setLabel("Deny")
              .setStyle(ButtonStyle.Danger),
          );

          await reviewChannel.send({
            embeds: [embed],
            components: [row],
          });
        }

        await message.delete().catch(() => null);

        await author
          .send({
            embeds: [
              new EmbedBuilder()
                .setColor("#2F1A80")
                .setTitle("Lobby Code Pending Approval")
                .setDescription(
                  `You do not currently have permission to post lobby codes directly in <#${TARGET_CHANNEL_ID}>. Your submitted code has been forwarded for review. Please wait for approval or denial from the staff team.`,
                )
                .addFields({
                  name: "Submitted Code",
                  value: code,
                  inline: false,
                }),
            ],
          })
          .catch(() => null);
      } catch (error) {
        console.error("Failed to send approval request for lobby code:", error);
      }

      return;
    }

    if (
      message.content == `<@${client.user.id}>` ||
      message.content == `<@!${client.user.id}>`
    ) {
      require("../messages/onMention.cjs").execute(message);
      return;
    }

    const checkPrefix = prefix.toLowerCase();

    const prefixRegex = new RegExp(
      `^(<@!?${client.user.id}>|${escapeRegex(checkPrefix)})\\s*`,
    );

    if (!prefixRegex.test(content.toLowerCase())) return;

    const [matchedPrefix] = content.toLowerCase().match(prefixRegex);

    const args = content.slice(matchedPrefix.length).trim().split(/ +/);
    const commandName = args.shift()?.toLowerCase();

    if (!message.content.startsWith(matchedPrefix)) return;

    const command =
      client.commands.get(commandName) ||
      client.commands.find(
        (cmd) => cmd.aliases && cmd.aliases.includes(commandName),
      );

    if (!command) return;

    if (command.ownerOnly && !owners.includes(message.author.id)) {
      return message.reply({ content: "This is a owner only command!" });
    }

    if (command.guildOnly && message.channel.type === ChannelType.DM) {
      return message.reply({
        content: "I can't execute that command inside DMs!",
      });
    }

    if (command.permissions && message.channel.type !== ChannelType.DM) {
      const authorPerms = message.channel.permissionsFor(message.author);
      if (!authorPerms || !authorPerms.has(command.permissions)) {
        return message.reply({ content: "You can not do this!" });
      }
    }

    if (command.args && !args.length) {
      let reply = `You didn't provide any arguments, ${message.author}!`;

      if (command.usage) {
        reply += `\nThe proper usage would be: \`${prefix}${command.name} ${command.usage}\``;
      }

      return message.channel.send({ content: reply });
    }

    const { cooldowns } = client;

    if (!cooldowns.has(command.name)) {
      cooldowns.set(command.name, new Collection());
    }

    const now = Date.now();
    const timestamps = cooldowns.get(command.name);
    const cooldownAmount = (command.cooldown || 3) * 1000;

    if (timestamps.has(message.author.id)) {
      const expirationTime = timestamps.get(message.author.id) + cooldownAmount;

      if (now < expirationTime) {
        const timeLeft = (expirationTime - now) / 1000;
        return message.reply({
          content: `please wait ${timeLeft.toFixed(
            1,
          )} more second(s) before reusing the \`${command.name}\` command.`,
        });
      }
    }

    timestamps.set(message.author.id, now);
    setTimeout(() => timestamps.delete(message.author.id), cooldownAmount);

    try {
      command.execute(message, args);
    } catch (error) {
      console.error(error);
      message.reply({
        content: "There was an error trying to execute that command!",
      });
    }
  },
};
