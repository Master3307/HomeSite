/**
 * @file Main trigger handler file.
 * @author Naman Vrati
 * @since 2.0.0
 * @version 3.3.0
 */

module.exports = {
	name: "messageCreate",

	/**
	 * @description Runs the first trigger whose words appear in a message.
	 * @param {import('discord.js').Message & { client: import('../typings').Client }} message The message which was created.
	 */
	async execute(message) {
		const { triggers } = message.client;
		if (!triggers?.size || message.author.bot) return;

		const trigger = triggers.find((entry) =>
			entry.name.some((name) => message.content.includes(name)),
		);
		if (!trigger) return;

		try {
			await trigger.execute(message, message.content.split(/ +/));
		} catch (error) {
			console.error("[Triggers] Failed:", error);
			await message
				.reply({ content: "there was an error trying to execute that trigger!" })
				.catch(() => null);
		}
	},
};
