/**
 * @file Button Interaction Handler
 * @author Naman Vrati
 * @since 3.0.0
 * @version 3.3.0
 */

const { InteractionType, ComponentType } = require("discord-api-types/v10");
const {
  ActionRowBuilder,
  ButtonBuilder,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");

const {
  hasPrivilegedRole,
  postLobbyCode,
} = require("../interactions/slash/utility/lobby-code.cjs");

function disableActionRows(rows) {
  return rows.map((row) =>
    ActionRowBuilder.from(row).setComponents(
      row.components.map((component) =>
        ButtonBuilder.from(component).setDisabled(true),
      ),
    ),
  );
}

module.exports = {
  name: "interactionCreate",

  /**
   * @description Executes when an interaction is created and handle it.
   * @author Naman Vrati
   * @param {import('discord.js').ButtonInteraction & { client: import('../typings').Client }} interaction The interaction which was created
   */
  async execute(interaction) {
    const { client } = interaction;

    // Checks if the interaction is a button interaction (to prevent weird bugs)
    if (interaction.type !== InteractionType.MessageComponent) return;
    if (interaction.componentType !== ComponentType.Button) return;

    // Handle dynamic lobby approval / denial buttons first.
    if (
      interaction.customId.startsWith("lobbyapprove:") ||
      interaction.customId.startsWith("lobbydeny:")
    ) {
      if (!interaction.inGuild()) {
        return interaction.reply({
          content: "This button can only be used inside the server.",
          flags: MessageFlags.Ephemeral,
        });
      }

      if (!hasPrivilegedRole(interaction.member)) {
        return interaction.reply({
          content: "You are not allowed to review lobby codes.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const [action, userId, encodedCode] = interaction.customId.split(":");
      const code = Buffer.from(encodedCode, "base64url").toString("utf8");
      const disabledRows = disableActionRows(interaction.message.components);

      if (action === "lobbyapprove") {
        try {
          await postLobbyCode(interaction.client, code, null);

          const approvedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor("#57F287")
            .addFields({
              name: "Decision",
              value: `Approved by ${interaction.user}`,
              inline: false,
            });

          await interaction.update({
            embeds: [approvedEmbed],
            components: disabledRows,
          });

          const user = await interaction.client.users
            .fetch(userId)
            .catch(() => null);
          if (user) {
            await user
              .send({
                embeds: [
                  new EmbedBuilder()
                    .setColor("#57F287")
                    .setTitle("Lobby Code Approved")
                    .setDescription(
                      "Your submitted lobby code has been approved and posted.",
                    )
                    .addFields({
                      name: "Approved Code",
                      value: code,
                      inline: false,
                    }),
                ],
              })
              .catch(() => null);
          }

          return;
        } catch (err) {
          console.error(err);

          if (interaction.replied || interaction.deferred) {
            return interaction.followUp({
              content: "Failed to approve and post the lobby code.",
              flags: MessageFlags.Ephemeral,
            });
          }

          return interaction.reply({
            content: "Failed to approve and post the lobby code.",
            flags: MessageFlags.Ephemeral,
          });
        }
      }

      if (action === "lobbydeny") {
        try {
          const deniedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor("#ED4245")
            .addFields({
              name: "Decision",
              value: `Denied by ${interaction.user}`,
              inline: false,
            });

          await interaction.update({
            embeds: [deniedEmbed],
            components: disabledRows,
          });

          const user = await interaction.client.users
            .fetch(userId)
            .catch(() => null);
          if (user) {
            await user
              .send({
                embeds: [
                  new EmbedBuilder()
                    .setColor("#ED4245")
                    .setTitle("Lobby Code Denied")
                    .setDescription(
                      "Your submitted lobby code was reviewed and denied.",
                    )
                    .addFields({
                      name: "Submitted Code",
                      value: code,
                      inline: false,
                    })
                    .setTimestamp(),
                ],
              })
              .catch(() => null);
          }

          return;
        } catch (err) {
          console.error(err);

          if (interaction.replied || interaction.deferred) {
            return interaction.followUp({
              content: "Failed to deny the lobby code.",
              flags: MessageFlags.Ephemeral,
            });
          }

          return interaction.reply({
            content: "Failed to deny the lobby code.",
            flags: MessageFlags.Ephemeral,
          });
        }
      }
    }

    const command = client.buttonCommands.get(interaction.customId);

    // If the interaction is not a command in cache, return error message.
    // You can modify the error message at ./messages/defaultButtonError.js file!

    if (!command) {
      await require("../messages/defaultButtonError").execute(interaction);
      return;
    }

    // A try to execute the interaction.
    try {
      await command.execute(interaction);
      return;
    } catch (err) {
      console.error(err);
      await interaction.reply({
        content: "There was an issue while executing that button!",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  },
};
