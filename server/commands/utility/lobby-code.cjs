const { EmbedBuilder, ChannelType } = require("discord.js");

const prefix = process.env.BOT_PREFIX || "!";

const TARGET_CHANNEL_ID = "1479194712111059137";
const PING_ROLE_ID = "1487023716658319400";

const PRIVILEGED_ROLE_IDS = [
  "1479193560778805300",
  "1479193858565865472",
  "1479222319711780904",
];

/**
 * @param {import("discord.js").GuildMember | null | undefined} member
 * @returns {boolean}
 */
function hasPrivilegedRole(member) {
  return PRIVILEGED_ROLE_IDS.some((roleId) =>
    member?.roles?.cache?.has(roleId),
  );
}

/**
 * Deletes all messages in a channel, including messages older than 14 days.
 *
 * @param {import("discord.js").TextChannel} channel
 * @param {string | null} keepMessageId
 */
async function clearChannel(channel, keepMessageId = null) {
  let lastId;

  while (true) {
    const messages = await channel.messages.fetch({
      limit: 100,
      ...(lastId ? { before: lastId } : {}),
    });

    if (!messages.size) break;

    const filtered = messages.filter((message) => message.id !== keepMessageId);

    if (!filtered.size) break;

    const recentMessages = filtered.filter((message) => {
      const ageMs = Date.now() - message.createdTimestamp;
      return ageMs < 14 * 24 * 60 * 60 * 1000;
    });

    if (recentMessages.size) {
      await channel.bulkDelete(recentMessages, true);
    }

    const oldMessages = filtered.filter((message) => {
      const ageMs = Date.now() - message.createdTimestamp;
      return ageMs >= 14 * 24 * 60 * 60 * 1000;
    });

    for (const oldMessage of oldMessages.values()) {
      try {
        await oldMessage.delete();
      } catch (error) {
        // Ignore deleted messages and messages the bot cannot delete.
      }
    }

    lastId = messages.last()?.id;

    if (!lastId || messages.size < 100) break;
  }
}

/**
 * @param {import("discord.js").Client} client
 * @param {string} code
 * @param {string | null} description
 */
async function postLobbyCode(client, code, description = null) {
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
      name: "Updated",
      value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
      inline: false,
    })
    .setTimestamp();

  if (description) {
    embed.setDescription(description);
  }

  return channel.send({
    content: `||<@&${PING_ROLE_ID}>||\n**Current Lobby Code:**`,
    embeds: [embed],
    allowedMentions: {
      roles: [PING_ROLE_ID],
    },
  });
}

/**
 * @type {import("../../typings").LegacyCommand}
 */
module.exports = {
  name: "lobby-code",
  description: "Replace the lobby-code channel with a fresh code post.",
  aliases: ["lobbycode", "code"],
  usage: "<code> [description]",
  cooldown: 3,

  /**
   * Usage:
   * !lobby-code ABCD1234 Playing with friends
   *
   * @param {import("discord.js").Message} message
   * @param {string[]} args
   */
  async execute(message, args) {
    if (!message.guild) {
      return message.reply({
        content: "This command can only be used inside the server.",
        allowedMentions: {
          repliedUser: false,
        },
      });
    }

    if (!hasPrivilegedRole(message.member)) {
      return message.reply({
        content: "You are not allowed to use this command.",
        allowedMentions: {
          repliedUser: false,
        },
      });
    }

    const code = args.shift()?.trim();

    if (!code) {
      return message.reply({
        content: [
          "You need to provide a lobby code.",
          `Usage: \`${prefix}lobby-code <code> [description]\``,
          `Example: \`${prefix}lobby-code ABCD1234 Playing with friends\``,
        ].join("\n"),
        allowedMentions: {
          repliedUser: false,
        },
      });
    }

    if (code.length > 100) {
      return message.reply({
        content: "The lobby code cannot be longer than 100 characters.",
        allowedMentions: {
          repliedUser: false,
        },
      });
    }

    const description = args.join(" ").trim() || null;

    if (description?.length > 4000) {
      return message.reply({
        content: "The description cannot be longer than 4,000 characters.",
        allowedMentions: {
          repliedUser: false,
        },
      });
    }

    const statusMessage = await message.reply({
      content: `Clearing <#${TARGET_CHANNEL_ID}> and posting the new lobby code...`,
      allowedMentions: {
        repliedUser: false,
      },
    });

    try {
      await postLobbyCode(message.client, code, description);

      await statusMessage.edit({
        content: `✅ Done. Lobby code updated in <#${TARGET_CHANNEL_ID}>.`,
      });
    } catch (error) {
      console.error("Failed to update the lobby code:", error);

      await statusMessage.edit({
        content:
          "❌ I couldn't update the lobby code. Check my permissions and configuration.",
      });
    }
  },

  hasPrivilegedRole,
  postLobbyCode,
  clearChannel,
  TARGET_CHANNEL_ID,
};
