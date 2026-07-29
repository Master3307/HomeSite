/**
 * @file Main File of the bot, responsible for registering events, commands, interactions etc.
 * @author Naman Vrati
 * @since 1.0.0
 * @version 3.3.0
 */

require('dotenv').config()

const fs = require('fs')
const path = require('path')
const {
  Client,
  Collection,
  GatewayIntentBits,
  Partials,
} = require('discord.js')
const { REST } = require('@discordjs/rest')
const { Routes } = require('discord-api-types/v9')

const token = process.env.DISCORD_BOT_TOKEN
const client_id = process.env.DISCORD_CLIENT_ID
const test_guild_id = process.env.DISCORD_GUILD_ID

if (!token) throw new Error('Missing DISCORD_BOT_TOKEN')
if (!client_id) throw new Error('Missing DISCORD_CLIENT_ID')
if (!test_guild_id) throw new Error('Missing DISCORD_GUILD_ID')

const EVENTS_DIR = path.join(__dirname, 'events')
const COMMANDS_DIR = path.join(__dirname, 'commands')
const INTERACTIONS_DIR = path.join(__dirname, 'interactions')
const TRIGGERS_DIR = path.join(__dirname, 'triggers')

/**
 * From v13, specifying the intents is compulsory.
 * @type {import('./typings').Client}
 * @description Main Application Client
 */

// @ts-ignore
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
})

/**********************************************************************/
// Define Collection of Commands, Slash Commands and cooldowns

client.commands = new Collection()
client.slashCommands = new Collection()
client.buttonCommands = new Collection()
client.selectCommands = new Collection()
client.contextCommands = new Collection()
client.modalCommands = new Collection()
client.cooldowns = new Collection()
client.autocompleteInteractions = new Collection()
client.triggers = new Collection()

/**********************************************************************/
// Helper functions

function readJsFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return []
  return fs.readdirSync(dirPath).filter((file) => file.endsWith('.cjs'))
}

function readSubdirectories(dirPath) {
  if (!fs.existsSync(dirPath)) return []
  return fs.readdirSync(dirPath).filter((entry) => {
    const fullPath = path.join(dirPath, entry)
    return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()
  })
}

/**********************************************************************/
// Event handler

const eventFiles = readJsFiles(EVENTS_DIR)

for (const file of eventFiles) {
  const event = require(path.join(EVENTS_DIR, file))
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args, client))
  } else {
    client.on(event.name, async (...args) => await event.execute(...args, client))
  }
}

/**********************************************************************/
// Registration of Message-Based Legacy Commands.

const commandFolders = readSubdirectories(COMMANDS_DIR)

for (const folder of commandFolders) {
  const folderPath = path.join(COMMANDS_DIR, folder)
  const commandFiles = readJsFiles(folderPath)

  for (const file of commandFiles) {
    const command = require(path.join(folderPath, file))
    client.commands.set(command.name, command)
  }
}

/**********************************************************************/
// Registration of Slash-Command Interactions.

const slashBaseDir = path.join(INTERACTIONS_DIR, 'slash')
const slashCommands = readSubdirectories(slashBaseDir)

for (const moduleName of slashCommands) {
  const modulePath = path.join(slashBaseDir, moduleName)
  const commandFiles = readJsFiles(modulePath)

  for (const commandFile of commandFiles) {
    const command = require(path.join(modulePath, commandFile))
    client.slashCommands.set(command.data.name, command)
  }
}

/**********************************************************************/
// Registration of Autocomplete Interactions.

const autocompleteBaseDir = path.join(INTERACTIONS_DIR, 'autocomplete')
const autocompleteInteractions = readSubdirectories(autocompleteBaseDir)

for (const moduleName of autocompleteInteractions) {
  const modulePath = path.join(autocompleteBaseDir, moduleName)
  const files = readJsFiles(modulePath)

  for (const interactionFile of files) {
    const interaction = require(path.join(modulePath, interactionFile))
    client.autocompleteInteractions.set(interaction.name, interaction)
  }
}

/**********************************************************************/
// Registration of Context-Menu Interactions

const contextMenusBaseDir = path.join(INTERACTIONS_DIR, 'context-menus')
const contextMenus = readSubdirectories(contextMenusBaseDir)

for (const folder of contextMenus) {
  const folderPath = path.join(contextMenusBaseDir, folder)
  const files = readJsFiles(folderPath)

  for (const file of files) {
    const menu = require(path.join(folderPath, file))
    const keyName = `${folder.toUpperCase()} ${menu.data.name}`
    client.contextCommands.set(keyName, menu)
  }
}

/**********************************************************************/
// Registration of Button-Command Interactions.

const buttonBaseDir = path.join(INTERACTIONS_DIR, 'buttons')
const buttonCommands = readSubdirectories(buttonBaseDir)

for (const moduleName of buttonCommands) {
  const modulePath = path.join(buttonBaseDir, moduleName)
  const commandFiles = readJsFiles(modulePath)

  for (const commandFile of commandFiles) {
    const command = require(path.join(modulePath, commandFile))
    client.buttonCommands.set(command.id, command)
  }
}

/**********************************************************************/
// Registration of Modal-Command Interactions.

const modalBaseDir = path.join(INTERACTIONS_DIR, 'modals')
const modalCommands = readSubdirectories(modalBaseDir)

for (const moduleName of modalCommands) {
  const modulePath = path.join(modalBaseDir, moduleName)
  const commandFiles = readJsFiles(modulePath)

  for (const commandFile of commandFiles) {
    const command = require(path.join(modulePath, commandFile))
    client.modalCommands.set(command.id, command)
  }
}

/**********************************************************************/
// Registration of Select-Menus Interactions

const selectMenusBaseDir = path.join(INTERACTIONS_DIR, 'select-menus')
const selectMenus = readSubdirectories(selectMenusBaseDir)

for (const moduleName of selectMenus) {
  const modulePath = path.join(selectMenusBaseDir, moduleName)
  const commandFiles = readJsFiles(modulePath)

  for (const commandFile of commandFiles) {
    const command = require(path.join(modulePath, commandFile))
    client.selectCommands.set(command.id, command)
  }
}

/**********************************************************************/
// Registration of Slash-Commands in Discord API

const rest = new REST({ version: '9' }).setToken(token)

const commandJsonData = [
  ...Array.from(client.slashCommands.values()).map((c) => c.data.toJSON()),
  ...Array.from(client.contextCommands.values()).map((c) => c.data),
]

;(async () => {
  try {
    console.log('Started refreshing application (/) commands.')

    await rest.put(
      Routes.applicationGuildCommands(client_id, test_guild_id),
      { body: commandJsonData }
    )

    console.log('Successfully reloaded application (/) commands.')
  } catch (error) {
    console.error(error)
  }
})()

/**********************************************************************/
// Registration of Message Based Chat Triggers

const triggerFolders = readSubdirectories(TRIGGERS_DIR)

for (const folder of triggerFolders) {
  const folderPath = path.join(TRIGGERS_DIR, folder)
  const triggerFiles = readJsFiles(folderPath)

  for (const file of triggerFiles) {
    const trigger = require(path.join(folderPath, file))
    client.triggers.set(trigger.name, trigger)
  }
}

// Login into your client application with bot's token.
client.login(token)
