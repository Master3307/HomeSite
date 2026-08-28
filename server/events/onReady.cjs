const levels = require("../services/levels.cjs");
const birthdayCelebrations = require("../services/birthdayCelebrations.cjs");

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
  },
};
