const {
  SlashCommandBuilder,
  ChannelType,
  MessageFlags,
  ApplicationIntegrationType,
  InteractionContextType,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("send-message")
    .setDescription("Send a message to a channel or directly to a user.")
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    )
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("The message to send.")
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(2000),
    )
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("The destination channel. Defaults to this chat.")
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.PublicThread,
          ChannelType.PrivateThread,
          ChannelType.AnnouncementThread,
        )
        .setRequired(false),
    )
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("Send the message to this user as a DM instead.")
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("reply-to-message-id")
        .setDescription("Reply to this message ID in the destination chat.")
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    if (interaction.user.id !== process.env.DISCORD_USER_ID) {
      return interaction.editReply({
        content: "Only the bot owner can use this command.",
      });
    }

    const content = interaction.options.getString("message", true);
    const selectedChannel = interaction.options.getChannel("channel");
    const selectedUser = interaction.options.getUser("user");
    const replyToMessageId = interaction.options
      .getString("reply-to-message-id")
      ?.trim();

    if (selectedChannel && selectedUser) {
      return interaction.editReply({
        content: "Specify either a channel or a user, not both.",
      });
    }

    if (!content.trim()) {
      return interaction.editReply({
        content: "The message cannot contain only whitespace.",
      });
    }

    if (
      replyToMessageId !== undefined &&
      !/^\d{17,20}$/.test(replyToMessageId)
    ) {
      return interaction.editReply({
        content: "Provide a valid numeric message ID, not a message link.",
      });
    }

    const payload = {
      content,
      allowedMentions: {
        parse: [],
        repliedUser: false,
      },
    };

    if (replyToMessageId) {
      payload.reply = {
        messageReference: replyToMessageId,

        // Fail rather than silently sending without a reply.
        failIfNotExists: true,
      };
    }

    try {
      // Explicit user: send into the bot's DM with that user.
      if (selectedUser) {
        const dmChannel = await selectedUser.createDM();

        // Verify that the referenced message exists in this destination.
        if (replyToMessageId) {
          await dmChannel.messages.fetch(replyToMessageId);
        }

        await dmChannel.send(payload);

        return interaction.editReply({
          content: replyToMessageId
            ? `Reply sent to <@${selectedUser.id}> via DM.`
            : `Message sent to <@${selectedUser.id}> via DM.`,
          allowedMentions: { parse: [] },
        });
      }

      // Preserve user-installed current-chat sending when no reply is needed.
      if (!selectedChannel && !replyToMessageId) {
        await interaction.followUp({
          ...payload,
          flags: 0,
        });

        return interaction.editReply({
          content: "Message sent to this chat.",
        });
      }

      // Explicit channel, or a true reply in the current chat:
      // both require the bot's normal channel access.
      const channelId = selectedChannel?.id ?? interaction.channelId;
      const channel = channelId
        ? await interaction.client.channels.fetch(channelId)
        : null;

      if (!channel || !channel.isSendable()) {
        return interaction.editReply({
          content:
            "The bot cannot send to this destination. Replying requires " +
            "the bot to have access to the destination chat.",
        });
      }

      if (replyToMessageId) {
        await channel.messages.fetch(replyToMessageId);
      }

      const sentMessage = await channel.send(payload);

      return interaction.editReply({
        content: `${replyToMessageId ? "Reply" : "Message"} sent successfully: ${sentMessage.url}`,
      });
    } catch (error) {
      console.error("[send-message] Failed to send message:", error);

      let errorMessage = "Failed to send the message. Check the bot logs.";

      if (error.code === 50007) {
        errorMessage =
          "I couldn't DM that user. They may have DMs disabled or blocked the bot.";
      } else if (error.code === 50013 || error.code === 50001) {
        errorMessage = replyToMessageId
          ? "I couldn't access or reply to that message. The bot needs " +
            "access to the destination chat and permission to read " +
            "message history and send messages. A user installation " +
            "alone does not grant this access."
          : "I don't have permission to send messages to that destination.";
      } else if (error.code === 10003) {
        errorMessage =
          "That channel no longer exists or is unavailable to the bot.";
      } else if (error.code === 10008) {
        errorMessage =
          "That message was not found in the destination chat. Check " +
          "the message ID and selected channel or user. It may have been deleted.";
      }

      return interaction.editReply({
        content: errorMessage,
      });
    }
  },
};
