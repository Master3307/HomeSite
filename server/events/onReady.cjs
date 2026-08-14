/**
 * @file Ready Event File.
 * @author Naman Vrati
 * @since 1.0.0
 * @version 3.2.2
 */

const levels = require("../services/levels.cjs");

module.exports = {
  name: "clientReady",
  once: true,

  /**
   * @description Executes when client is ready (bot initialization).
   * @param {import('../typings').Client} client Main Application Client.
   */
  async execute(client) {
    try {
      await levels.load();
      console.log(`[Levels] Service initialized.`);
    } catch (error) {
      console.error("[Levels] Failed to initialize:", error);
    }

    console.log(`Ready! Logged in as ${client.user.tag}`);
  },
};
