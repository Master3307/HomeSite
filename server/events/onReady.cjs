const levels = require("../services/levels.cjs");
const birthdayCelebrations = require("../services/birthdayCelebrations.cjs");
const minecraftStatus = require("../services/minecraftStatus.cjs");
const fdc = require("../interactions/slash/utility/fdc.cjs");

module.exports = {
  name: "clientReady",
  once: true,

  async execute(client) {
    console.log(`Ready! Logged in as ${client.user.tag}`);

    try {
      await levels.load();
      console.log("[Levels] Service initialized.");
    } catch (error) {
      console.error("[Levels] Failed to initialize:", error);
    }

    try {
      birthdayCelebrations.startBirthdayCelebrations(client);
      console.log("[Birthday] Celebration scheduler initialized.");
    } catch (error) {
      console.error("[Birthday] Failed to initialize scheduler:", error);
    }

    try {
      minecraftStatus.startMinecraftStatusUpdater(client);
      console.log("[Minecraft Status] Bottom-sticky updater initialized.");
    } catch (error) {
      console.error("[Minecraft Status] Failed to initialize updater:", error);
    }

    try {
      await fdc.recover(client);
      console.log("[FDC] Poll recovery initialized.");
    } catch (error) {
      console.error("[FDC] Failed to recover active polls:", error);
    }
  },
};
