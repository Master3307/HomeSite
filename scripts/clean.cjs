require("dotenv").config();

const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v10");

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token) throw new Error("Missing DISCORD_BOT_TOKEN");
if (!clientId) throw new Error("Missing DISCORD_CLIENT_ID");
if (!guildId) throw new Error("Missing DISCORD_GUILD_ID");

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: [],
    });

    console.log(`Cleared guild-specific commands for guild ${guildId}.`);
  } catch (error) {
    console.error("Failed to clear guild-specific commands:", error);
    process.exitCode = 1;
  }
})();
