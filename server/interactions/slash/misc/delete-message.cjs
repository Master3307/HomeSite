const {
    SlashCommandBuilder,
    MessageFlags,
    ApplicationIntegrationType,
    InteractionContextType,
} = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
    .setName("delete-message")
    .setDescription("Delete a message in this chat.")
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(
        InteractionContextType.Guild,
        InteractionContextType.BotDM,
        InteractionContextType.PrivateChannel,
    )
    .addStringOption((option) =>
    option
    .setName("message-id")
    .setDescription("The ID of the message to delete in this chat.")
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

        const messageId = interaction.options.getString("message-id", true).trim();

        if (!/^\d{17,20}$/.test(messageId)) {
            return interaction.editReply({
                content: "Provide a valid numeric message ID, not a message link.",
            });
        }

        try {
            const channel = interaction.channelId
            ? await interaction.client.channels.fetch(interaction.channelId)
            : null;

            if (!channel || !channel.isTextBased() || !channel.messages) {
                return interaction.editReply({
                    content:
                    "The bot cannot access messages in this chat. Deleting messages " +
                    "requires the bot to have access to the destination chat. " +
                    "A user installation alone does not grant this access.",
                });
            }

            const message = await channel.messages.fetch(messageId);

            await message.delete();

            return interaction.editReply({
                content: `Message deleted successfully. Message ID: ${messageId}`,
                allowedMentions: { parse: [] },
            });
        } catch (error) {
            console.error("[message-delete] Failed to delete message:", error);

            let errorMessage = "Failed to delete the message. Check the bot logs.";

            if (error.code === 50013 || error.code === 50001) {
                errorMessage =
                "I couldn't access or delete that message. Check the bot's " +
                "View Channel and Read Message History permissions. Deleting " +
                "another user's message in a server also requires Manage Messages. " +
                "In DMs, the bot can only delete its own messages.";
            } else if (error.code === 10003) {
                errorMessage =
                "This channel no longer exists or is unavailable to the bot.";
            } else if (error.code === 10008) {
                errorMessage =
                "That message was not found in this chat. Check the message ID " +
                "and run the command in the channel containing the message. " +
                "It may have already been deleted.";
            }

            return interaction.editReply({
                content: errorMessage,
                allowedMentions: { parse: [] },
            });
        }
    },
};
