const {
  SlashCommandBuilder,
  MessageFlags,
  ApplicationIntegrationType,
  InteractionContextType,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("react")
    .setDescription("Add an emoji reaction to a message in this chat.")
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
        .setName("emoji")
        .setDescription("A Unicode emoji, custom emoji, or custom emoji ID.")
        .setRequired(true)
        .setMinLength(1),
    )
    .addStringOption((option) =>
      option
        .setName("message-id")
        .setDescription("The ID of the message to react to in this chat.")
        .setRequired(true),
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

    const emojiInput = interaction.options.getString("emoji", true).trim();
    const messageId = interaction.options.getString("message-id", true).trim();

    if (!emojiInput) {
      return interaction.editReply({
        content: "The emoji cannot contain only whitespace.",
      });
    }

    if (!/^\d{17,20}$/.test(messageId)) {
      return interaction.editReply({
        content: "Provide a valid numeric message ID, not a message link.",
      });
    }

    // Normalize custom emoji markup to its ID.
    const customEmojiMatch = emojiInput.match(
      /^<a?:[A-Za-z0-9_]+:(\d{17,20})>$/,
    );
    const emoji = customEmojiMatch?.[1] ?? emojiInput;

    try {
      // Reactions require the bot's normal access to the current chat.
      const channel = interaction.channelId
        ? await interaction.client.channels.fetch(interaction.channelId)
        : null;

      if (!channel || !channel.isTextBased() || !channel.messages) {
        return interaction.editReply({
          content:
            "The bot cannot access messages in this chat. Adding reactions " +
            "requires the bot to have access to the destination chat. " +
            "A user installation alone does not grant this access.",
        });
      }

      const message = await channel.messages.fetch(messageId);

      await message.react(emoji);

      return interaction.editReply({
        content: `Reaction added successfully: ${message.url}`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error("[react] Failed to add reaction:", error);

      let errorMessage = "Failed to add the reaction. Check the bot logs.";

      if (error.code === 50013 || error.code === 50001) {
        errorMessage =
          "I couldn't access that message or add the reaction. Check the " +
          "bot's View Channel, Read Message History, and Add Reactions " +
          "permissions. For external custom emojis, also check Use " +
          "External Emojis. A user installation alone does not grant " +
          "access to this chat.";
      } else if (error.code === 10003) {
        errorMessage =
          "This channel no longer exists or is unavailable to the bot.";
      } else if (error.code === 10008) {
        errorMessage =
          "That message was not found in this chat. Check the message ID " +
          "and run the command in the channel containing the message. " +
          "It may have been deleted.";
      } else if (error.code === 10014) {
        errorMessage =
          "That emoji is invalid or unavailable to the bot. Use an actual " +
          "Unicode emoji such as 👍, a custom emoji such as <:name:id> " +
          "or <a:name:id>, or a custom emoji ID.";
      } else if (error.code === 30010) {
        errorMessage = "That message has reached Discord's reaction limit.";
      } else if (
        error.code === "EmojiType" ||
        error.code === "EmojiResolvable"
      ) {
        errorMessage =
          "I couldn't resolve that emoji. Use an actual Unicode emoji " +
          "such as 👍, custom emoji markup, or a custom emoji ID.";
      }

      return interaction.editReply({
        content: errorMessage,
        allowedMentions: { parse: [] },
      });
    }
  },
};
