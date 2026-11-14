const { Collection, ChannelType } = require("discord.js");

const levels = require("../services/levels.cjs");
const minecraftStatus = require("../services/minecraftStatus.cjs");
const { setting } = require("../config.cjs");

const prefix = process.env.BOT_PREFIX || "!";
const owners = process.env.BOT_OWNERS ? process.env.BOT_OWNERS.split(",") : [];

const {
  hasPrivilegedRole,
  postLobbyCode,
  TARGET_CHANNEL_ID,
} = require("../interactions/slash/utility/lobby-code.cjs");
const lobbySubmissions = require("../services/lobbySubmissions.cjs");
const STICKY_CHANNEL_ID = setting("STICKY_CHANNEL_ID");
const MINECRAFT_STATUS_THREAD_ID = setting("MINECRAFT_STATUS_THREAD_ID");

const { sendStickyMessageToChannel } = require("../services/stickyMessage.cjs");

const escapeRegex = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

module.exports = {
  name: "messageCreate",

  async execute(message) {
    const { client, guild, channel, content, author } = message;

    /*
      Award XP before rejecting bot messages, so other Discord bots may level.

      levels.cjs ignores this bot's own level-up messages in the announcement
      channel to prevent an XP loop.
    */
    try {
      await levels.trackMessage(message);
    } catch (error) {
      console.error("[Levels] Failed to track message activity:", error);
    }

    /*
      Bots gain XP above, but never run normal message behavior below:
      - sticky reposting
      - Minecraft-status reposting
      - lobby-code handling
      - mention responses
      - prefix commands

      This prevents message loops.
    */
    if (author?.bot) {
      return;
    }

    /*
      Minecraft status thread:
      - A human message makes the existing status card no longer be last.
      - Queue a debounced refresh/repost after chat settles.
      - The service deletes the old card and sends the replacement at bottom.
    */
    if (MINECRAFT_STATUS_THREAD_ID && message.channelId === MINECRAFT_STATUS_THREAD_ID) {
      try {
        minecraftStatus.bumpMinecraftStatusSoon(client);
      } catch (error) {
        console.error(
          "[Minecraft Status] Failed to queue bottom-status update:",
          error,
        );
      }

      return;
    }

    /*
      Generic sticky-message channel behavior.

      stickyMessage.cjs persists the precise sticky message ID in:
      db/sticky-messages.json

      It deletes only that recorded ID. It will never search for and delete
      arbitrary messages authored by this bot.
    */
    if (STICKY_CHANNEL_ID && message.channelId === STICKY_CHANNEL_ID) {
      try {
        await sendStickyMessageToChannel(client, message.channelId);
      } catch (error) {
        console.error("[Sticky] Failed to send sticky message:", error);
      }

      return;
    }

    if (guild && TARGET_CHANNEL_ID && channel.id === TARGET_CHANNEL_ID) {
      // First line is the code, the rest is the description (#27).
      const { code, description } = lobbySubmissions.parseLobbyMessage(content);

      if (!code) {
        return;
      }

      if (hasPrivilegedRole(message.member)) {
        try {
          await postLobbyCode(client, code, description, author.id);
        } catch (error) {
          console.error(
            "Failed to update lobby code from messageCreate:",
            error,
          );
        }

        return;
      }

      try {
        await lobbySubmissions.submitFromChannel(client, {
          code,
          description,
          userId: author.id,
        });
      } catch (error) {
        console.error("Failed to send approval request for lobby code:", error);
      }

      await message.delete().catch(() => null);
      return;
    }

    if (
      message.content === `<@${client.user.id}>` ||
      message.content === `<@!${client.user.id}>`
    ) {
      require("../messages/onMention.cjs").execute(message);
      return;
    }

    const checkPrefix = prefix.toLowerCase();

    const prefixRegex = new RegExp(
      `^(<@!?${client.user.id}>|${escapeRegex(checkPrefix)})\\s*`,
    );

    if (!prefixRegex.test(content.toLowerCase())) {
      return;
    }

    const [matchedPrefix] = content.toLowerCase().match(prefixRegex);

    const args = content.slice(matchedPrefix.length).trim().split(/ +/);

    const commandName = args.shift()?.toLowerCase();

    if (!message.content.startsWith(matchedPrefix)) {
      return;
    }

    const command =
      client.commands.get(commandName) ||
      client.commands.find(
        (cmd) => cmd.aliases && cmd.aliases.includes(commandName),
      );

    if (!command) {
      return;
    }

    if (command.ownerOnly && !owners.includes(message.author.id)) {
      return message.reply({
        content: "This is a owner only command!",
      });
    }

    if (command.guildOnly && message.channel.type === ChannelType.DM) {
      return message.reply({
        content: "I can't execute that command inside DMs!",
      });
    }

    if (command.permissions && message.channel.type !== ChannelType.DM) {
      const authorPerms = message.channel.permissionsFor(message.author);

      if (!authorPerms || !authorPerms.has(command.permissions)) {
        return message.reply({
          content: "You can not do this!",
        });
      }
    }

    if (command.args && !args.length) {
      let reply = `You didn't provide any arguments, ${message.author}!`;

      if (command.usage) {
        reply +=
          `\nThe proper usage would be: ` +
          `\`${prefix}${command.name} ${command.usage}\``;
      }

      return message.channel.send({
        content: reply,
      });
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
          content:
            `please wait ${timeLeft.toFixed(1)} more second(s) ` +
            `before reusing the \`${command.name}\` command.`,
        });
      }
    }

    timestamps.set(message.author.id, now);

    setTimeout(() => {
      timestamps.delete(message.author.id);
    }, cooldownAmount);

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
