/**
 * @file Slash Command Interaction Handler
 * @author Naman Vrati
 * @since 3.0.0
 * @version 3.3.0
 */

const UNKNOWN_INTERACTION_CODE = 10062;

module.exports = {
  name: "interactionCreate",

  /**
   * @description Executes when an interaction is created and handles it.
   * @param {import('discord.js').CommandInteraction & { client: import('../typings').Client }} interaction
   */
  async execute(interaction) {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    const { client } = interaction;

    const command = client.slashCommands.get(interaction.commandName);

    if (!command) {
      return;
    }

    const receivedAt = Date.now();

    try {
      await command.execute(interaction);
    } catch (error) {
      const elapsedMs = Date.now() - receivedAt;

      console.error(
        `[Slash Commands] /${interaction.commandName} failed after ${elapsedMs}ms:`,
        error,
      );

      /*
        The interaction has expired or was already consumed elsewhere.
        A fallback reply would only create another 10062 error.
      */
      if (error?.code === UNKNOWN_INTERACTION_CODE) {
        console.error(
          `[Slash Commands] /${interaction.commandName} could not be acknowledged. ` +
            "Check for duplicate bot processes/listeners or event-loop blocking.",
        );
        return;
      }

      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({
            content: "There was an issue while executing that command!",
            embeds: [],
            components: [],
          });
          return;
        }

        await interaction.reply({
          content: "There was an issue while executing that command!",
          ephemeral: true,
        });
      } catch (responseError) {
        if (responseError?.code !== UNKNOWN_INTERACTION_CODE) {
          console.error(
            `[Slash Commands] Could not send failure response for ` +
              `/${interaction.commandName}:`,
            responseError,
          );
        }
      }
    }
  },
};
