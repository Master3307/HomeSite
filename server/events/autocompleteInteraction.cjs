/**
 * @file Autocomplete Interaction Handler
 * @author Naman Vrati
 * @since 3.3.0
 * @version 3.3.0
 */

module.exports = {
	name: "interactionCreate",

	/**
	 * @description Executes when an interaction is created and handle it.
	 * @author Naman Vrati
	 * @param {import('discord.js').AutocompleteInteraction & { client: import('../typings').Client }} interaction The interaction which was created
	 */

	async execute(interaction) {
		if (!interaction.isAutocomplete()) return;

		const { client } = interaction;

		// A handler in interactions/autocomplete/, else the slash command's
		// own autocomplete() (e.g. /help).
		const own = client.autocompleteInteractions.get(interaction.commandName);
		const command = client.slashCommands.get(interaction.commandName);
		const run = own
			? () => own.execute(interaction)
			: command?.autocomplete
				? () => command.autocomplete(interaction)
				: null;
		if (!run) return;

		try {
			await run();
		} catch (err) {
			console.error(`[Autocomplete] /${interaction.commandName} failed:`, err);
			if (!interaction.responded) await interaction.respond([]).catch(() => null);
		}
	},
};
