const { ChannelType } = require("discord.js");
const { getSticky, setSticky } = require("./sticky.cjs");

const STICKY_CHANNEL_ID = "1479219328258674709";
const STICKY_TEXT =
  "Vote for a Friday dress code **here** every Thursday!\n" +
  "Suggest Outfits in https://discord.com/channels/1479192792386375852/1479366652239024239!";

async function deletePreviousStickyMessage(channel, client) {
  const sticky = getSticky(channel.id);

  if (sticky?.messageId) {
    try {
      const previous = await channel.messages.fetch(sticky.messageId);
      if (previous && previous.author?.id === client.user.id) {
        await previous.delete();
      }
      return;
    } catch {
      // If the stored message is missing, fall back to finding the latest bot message.
    }
  }

  const messages = await channel.messages.fetch({ limit: 20 });
  const previousBotMessage = messages
    .filter((msg) => msg.author?.id === client.user.id)
    .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
    .first();

  if (previousBotMessage) {
    try {
      await previousBotMessage.delete();
    } catch {
      // ignore deletion failures
    }
  }
}

async function sendStickyMessageToChannel(client, channel) {
  if (!channel || !channel.isTextBased()) {
    const actualType = channel?.type ?? "null";
    throw new Error(
      `Sticky channel not found or is not text-based. channelId=${channel?.id ?? "null"} type=${actualType}`,
    );
  }

  await deletePreviousStickyMessage(channel, client);
  const sentMessage = await channel.send(STICKY_TEXT);
  setSticky(channel.id, STICKY_TEXT, sentMessage.id);
  return sentMessage;
}

async function sendStickyToStickyChannel(client) {
  const channel = await client.channels
    .fetch(STICKY_CHANNEL_ID)
    .catch(() => null);
  return sendStickyMessageToChannel(client, channel);
}

module.exports = {
  STICKY_CHANNEL_ID,
  sendStickyMessageToChannel,
  sendStickyToStickyChannel,
};
