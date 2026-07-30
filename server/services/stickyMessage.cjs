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
        return;
      }
    } catch {
      // stored message missing, continue to search
    }
  }

  // Walk recent messages in pages (like lobby-code's clearChannel), looking for the latest bot message
  let lastId = null;
  while (true) {
    const messages = await channel.messages.fetch({
      limit: 100,
      ...(lastId ? { before: lastId } : {}),
    });
    if (!messages.size) break;

    // find bot messages in this page
    const botMsgs = messages.filter((m) => m.author?.id === client.user.id);
    if (botMsgs.size) {
      // pick the newest bot message
      const toDelete = botMsgs
        .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
        .first();
      try {
        await toDelete.delete();
      } catch {
        // ignore deletion failures
      }
      return;
    }

    lastId = messages.last()?.id;
    if (!lastId) break;
    if (messages.size < 100) break;
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
