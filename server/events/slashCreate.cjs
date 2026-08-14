/**
 * @file Slash Command Interaction Handler
 * @author Naman Vrati
 * @since 3.0.0
 * @version 3.3.0
 */

module.exports = {
  name: "interactionCreate",

  /**
   * @description Executes when an interaction is created and handles it.
   * @author Naman Vrati
   * @param {import('discord.js').CommandInteraction & { client: import('../typings').Client }} interaction
   * The interaction which was created.
   */
  async execute(interaction) {
    const { client } = interaction;

    /*
		Ignore buttons, select menus, modals, autocomplete, and context menus.
		Their own event files handle them.
	  */
    if (!interaction.isChatInputCommand()) {
      return;
    }

    const command = client.slashCommands.get(interaction.commandName);

    if (!command) {
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(
        `[Slash Commands] Failed to execute /${interaction.commandName}:`,
        error,
      );

      /*
		  Commands such as /level defer immediately, so their initial response
		  has already been acknowledged. They must receive editReply(), not
		  another reply().

		  Commands that fail before replying/defering still receive a normal,
		  private reply.
		*/
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
        /*
			Avoid crashing the interaction event if Discord has already expired
			the token or the response itself cannot be delivered.
		  */
        console.error(
          `[Slash Commands] Failed to send error response for /${interaction.commandName}:`,
          responseError,
        );
      }
    }
  },
};
