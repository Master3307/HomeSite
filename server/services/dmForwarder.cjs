const { Events } = require("discord.js");

module.exports = function startDmForwarder(client) {
  const recipientId = process.env.DISCORD_USER_ID;

  if (!recipientId || !/^\d+$/.test(recipientId)) {
    throw new Error(
      "Missing or invalid DISCORD_USER_ID: set your numeric Discord user ID in .env.",
    );
  }

  client.on(Events.MessageCreate, async (message) => {
    // Only forward direct messages from human users.
    if (message.inGuild() || message.author.bot) return;

    // Don't forward your own DMs back to yourself.
    if (message.author.id === recipientId) return;

    try {
      const recipient = await client.users.fetch(recipientId);

      const attachmentUrls = [...message.attachments.values()].map(
        (attachment) => attachment.url,
      );

      const body =
        [message.content, ...attachmentUrls].filter(Boolean).join("\n") ||
        "[Message without text or attachments]";

      const prefix = `[@${message.author.id}] ~ `;
      const suffix = `\n\nMessage ID:\n${message.id}`;
      const chunkSize = 2000 - prefix.length - suffix.length;

      for (let offset = 0; offset < body.length; offset += chunkSize) {
        await recipient.send({
          content: prefix + body.slice(offset, offset + chunkSize) + suffix,
          allowedMentions: {
            parse: [],
            repliedUser: false,
          },
        });
      }
    } catch (error) {
      console.error(
        `[DM Forwarder] Failed to forward message ${message.id} from ${message.author.id}:`,
        error,
      );
    }
  });
};
