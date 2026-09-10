const { getSticky, setSticky, removeSticky } = require("./sticky.cjs");

const STICKY_CHANNEL_ID = "1479219328258674709";

const STICKY_TEXT =
  "Vote for a Friday dress code **here** every Thursday!\n" +
  "Suggest Outfits in https://discord.com/channels/1479192792386375852/1479366652239024239!";

/*
  Prevent simultaneous messageCreate events from both trying to:
  1. delete the same old sticky
  2. send replacement stickies
  3. overwrite the JSON state in the wrong order

  Each channel gets its own promise queue, so different sticky channels can
  still operate independently.
*/
const stickyQueues = new Map();

function queueStickyOperation(channelId, operation) {
  const previousOperation = stickyQueues.get(channelId) ?? Promise.resolve();

  const nextOperation = previousOperation.catch(() => null).then(operation);

  stickyQueues.set(channelId, nextOperation);

  nextOperation.finally(() => {
    if (stickyQueues.get(channelId) === nextOperation) {
      stickyQueues.delete(channelId);
    }
  });

  return nextOperation;
}

async function deletePreviousStickyMessage(channel, client) {
  const sticky = getSticky(channel.id);

  /*
    Deliberately do not search message history for "the latest bot message".

    Only delete the message that this service itself previously recorded as
    the sticky message. This prevents normal bot messages from being deleted.
  */
  if (!sticky?.messageId) {
    return;
  }

  try {
    const previous = await channel.messages.fetch(sticky.messageId);

    if (previous.author?.id !== client.user.id) {
      console.warn(
        `[Sticky] Stored message ${sticky.messageId} in channel ${channel.id} ` +
          "is not owned by this bot. Refusing to delete it.",
      );

      await removeSticky(channel.id);
      return;
    }

    await previous.delete();
  } catch (error) {
    /*
      A missing/deleted message is fine. Remove the stale stored state before
      the new sticky is sent and persisted.
    */
    if (error?.code !== 10008) {
      console.warn(
        `[Sticky] Could not delete stored sticky ${sticky.messageId} ` +
          `in channel ${channel.id}:`,
        error,
      );
    }
  }

  await removeSticky(channel.id);
}

async function resolveTextChannel(client, channelOrId) {
  const channelId =
    typeof channelOrId === "string" ? channelOrId : channelOrId?.id;

  if (!channelId) {
    throw new Error("Sticky channel id is missing.");
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    const actualType = channel?.type ?? "null";

    throw new Error(
      `Sticky channel not found or is not text-based. ` +
        `channelId=${channelId} type=${actualType}`,
    );
  }

  if (!channel.isSendable()) {
    throw new Error(`Sticky channel is not sendable. channelId=${channelId}`);
  }

  return channel;
}

async function sendStickyMessageToChannel(client, channelOrId) {
  const channel = await resolveTextChannel(client, channelOrId);

  return queueStickyOperation(channel.id, async () => {
    await deletePreviousStickyMessage(channel, client);

    const sentMessage = await channel.send(STICKY_TEXT);

    try {
      await setSticky(channel.id, STICKY_TEXT, sentMessage.id);
    } catch (error) {
      /*
        Avoid leaving an untracked sticky behind if persistence fails. If this
        delete also fails, log both errors so the issue is visible.
      */
      await sentMessage.delete().catch((deleteError) => {
        console.error(
          `[Sticky] Sent sticky ${sentMessage.id} but could not save state, ` +
            "and cleanup deletion also failed:",
          deleteError,
        );
      });

      throw new Error(
        `Sticky message was sent but could not be saved to disk: ${error.message}`,
      );
    }

    return sentMessage;
  });
}

async function sendStickyToStickyChannel(client) {
  return sendStickyMessageToChannel(client, STICKY_CHANNEL_ID);
}

module.exports = {
  STICKY_CHANNEL_ID,
  STICKY_TEXT,
  sendStickyMessageToChannel,
  sendStickyToStickyChannel,
};
