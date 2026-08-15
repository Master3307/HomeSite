const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("Shows a user's global and server-specific avatars.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to look up")
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const selectedUser =
        interaction.options.getUser("user") ?? interaction.user;

      // No need to force-refetch; the User object from options/interaction is already complete.
      const user = await interaction.client.users.fetch(selectedUser.id);

      const member = interaction.inGuild()
        ? await interaction.guild.members.fetch(user.id).catch(() => null)
        : null;

      const globalAvatar = user.displayAvatarURL({
        extension: "png",
        size: 4096,
        forceStatic: true,
      });

      const serverAvatar =
        member?.avatarURL({
          size: 4096,
          forceStatic: false,
        }) ?? null;

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`${member?.displayName ?? user.username}'s avatar`)
        .setImage(serverAvatar ?? globalAvatar)
        .setDescription(
          `Global avatar: [Open global avatar](<${globalAvatar}>)\n` +
            (serverAvatar
              ? `Server avatar: [Open server avatar](<${serverAvatar}>)`
              : `Server avatar: No server-specific avatar set.`),
        )
        .setTimestamp();

      if (serverAvatar) {
        embed.setThumbnail(globalAvatar);
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error("Error in /avatar command:", error);
      await interaction.editReply({
        content:
          "Something went wrong while fetching the avatar. Please try again later.",
      });
    }
  },
};
