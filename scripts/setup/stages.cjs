/*
 * The guided setup (pnpm setup:gui / pnpm setup:cli), stage by stage.
 * Settings themselves live in config/settings.cjs; a stage only picks
 * which ones to ask for, in which order, with a short guide.
 *
 *   feature   ask "do you want this?" first (no -> stage skipped)
 *   keys      settings asked in this stage
 *   steps     the guide, one line per step
 *   special   "twofa": the GUI/CLI also create the 2FA secret and QR code
 */
const { youtube } = require("../../config/settings.cjs");

const STAGES = [
  {
    id: "website",
    icon: "language",
    title: "Your website",
    intro: "Where will the site run? For trying it out locally, the defaults are fine. Leave the API addresses empty until you have a server.",
    steps: [
      "Running it on your own computer? Keep http://localhost:5173 and continue.",
      "On a server: point a domain at it and put a reverse proxy in front (Caddy, Nginx or a Cloudflare Tunnel).",
      "The account API (pnpm accounts) and the profile API (pnpm discord) each get their own subdomain, e.g. accounts-api.example.com.",
    ],
    links: [
      { label: "Caddy reverse proxy quick start", url: "https://caddyserver.com/docs/quick-starts/reverse-proxy" },
      { label: "Cloudflare Tunnel", url: "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/" },
      { label: "Video tutorials (YouTube)", url: youtube("cloudflare tunnel self host website tutorial"), video: true },
    ],
    keys: ["FRONTEND_ORIGIN", "ACCOUNT_API_ORIGIN", "PROFILE_API_ORIGIN", "AUTH_COOKIE_DOMAIN"],
  },
  {
    id: "discord",
    icon: "smart_toy",
    title: "Discord app & bot",
    intro: "HomeSite's bot, the website login and the live Discord card all use one Discord application. Creating it takes about five minutes.",
    steps: [
      "Open the Discord Developer Portal and click New Application. Give it your bot's name.",
      "General Information: copy the Application ID.",
      "Bot: click Reset Token and copy the token. Below, turn on Presence Intent, Server Members Intent and Message Content Intent.",
      "OAuth2 → URL Generator: tick bot and applications.commands, then Administrator (or the permissions you want). Open the link to invite the bot.",
      "In Discord: User Settings → Advanced → turn on Developer Mode. Then right-click your server → Copy Server ID.",
    ],
    links: [
      { label: "Discord Developer Portal", url: "https://discord.com/developers/applications" },
      { label: "Discord: build your first app", url: "https://discord.com/developers/docs/quick-start/getting-started" },
      { label: "Video tutorials (YouTube)", url: youtube("how to create a discord bot token developer portal invite"), video: true },
    ],
    keys: ["DISCORD_CLIENT_ID", "DISCORD_BOT_TOKEN", "DISCORD_GUILD_ID", "DISCORD_INVITE_CODE", "BOT_DISPLAY_NAME"],
  },
  {
    id: "people",
    icon: "group",
    title: "You & your moderators",
    intro: "Who owns the site and who moderates. With Developer Mode on, right-click a person or role → Copy ID.",
    steps: [
      "Your user ID: right-click your own name → Copy User ID.",
      "Moderator role: Server Settings → Roles → right-click the role → Copy Role ID.",
    ],
    links: [
      { label: "Where to find IDs", url: "https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID" },
      { label: "Video tutorials (YouTube)", url: youtube("discord developer mode copy user id role id"), video: true },
    ],
    keys: ["DISCORD_USER_ID", "BOT_OWNERS", "MOD_ROLE_ID", "COMMUNITY_LEADER_ID"],
  },
  {
    id: "login",
    icon: "login",
    feature: "login",
    title: "Website login",
    intro: "Lets people log in with Discord on the site (voting, settings sync) and gives you the admin login. Needs the account API (pnpm accounts).",
    steps: [
      "Developer Portal → OAuth2: click Reset Secret and copy the Client Secret.",
      "Still under OAuth2 → Redirects: add <Account API address>/auth/discord/callback (the suggestion below) and save.",
      "Session secret: just press Generate.",
    ],
    links: [{ label: "Discord Developer Portal", url: "https://discord.com/developers/applications" }],
    keys: ["DISCORD_CLIENT_SECRET", "DISCORD_REDIRECT_URI", "FRONTEND_REDIRECT_URL", "SESSION_SECRET", "ACCOUNT_API_PORT"],
  },
  {
    id: "admin",
    icon: "admin_panel_settings",
    title: "Admin access",
    intro:
      'The admin key is the password for "Use an admin code" in the login. It unlocks FDC tools, backups and /admin-settings, so you can change everything later in the browser.',
    steps: ["Press Generate and store the key in your password manager.", "Optional, but recommended: two-factor codes (next stage)."],
    keys: ["ADMIN_KEY"],
  },
  {
    id: "twofa",
    icon: "verified_user",
    feature: "twofa",
    special: "twofa",
    title: "Two-factor codes",
    intro: "Adds 6-digit codes from an authenticator app to the admin login and every critical action. Only possible with access to the server, on purpose.",
    steps: [
      "Install an authenticator app (Aegis, 2FAS, Google Authenticator, 1Password …).",
      "Create the secret and scan the QR code.",
      "Type the current code to check it. 2FA is switched on after that.",
    ],
    links: [
      { label: "Aegis (Android)", url: "https://getaegis.app/" },
      { label: "2FAS (iOS & Android)", url: "https://2fas.com/" },
    ],
    keys: ["ADMIN_2FA_SECRET", "ADMIN_2FA"],
  },
  {
    id: "hub",
    icon: "hub",
    feature: "hub",
    title: "Hub",
    intro:
      "/hub is your control room: members of every server with search, a live activity log, the bot's commands, all logs, the database, these settings and (if you want) a terminal on the server. It also unlocks looking up Discord users on the profile API (/<user id>-ui). It needs its own key, plus a 2FA code when 2FA is on.",
    steps: [
      "Press Generate for the hub key and store it in your password manager (it is not the admin key).",
      "Only if you need it: turn on the server terminal. Whoever has the key (and 2FA code) gets a shell on this machine.",
      "Restart the account API and the profile API, then open /hub on your site.",
    ],
    links: [{ label: "What a web terminal can do (xterm.js)", url: "https://xtermjs.org/" }],
    keys: ["HUB_KEY", "HUB_TERMINAL", "HUB_SESSION_TTL_HOURS"],
  },
  {
    id: "profile",
    icon: "badge",
    feature: "profile",
    title: "Live Discord card",
    intro: "The home page shows your Discord status, games and music. Runs as its own service (pnpm discord) and needs your user ID from earlier.",
    steps: ["Start it with pnpm discord, and make the profile API address from the first stage point at it.", "Optional: API keys below for better game art and music details."],
    keys: ["PORT"],
  },
  {
    id: "gameArt",
    icon: "sports_esports",
    feature: "gameArt",
    title: "Game artwork",
    intro: "Covers and details for the games on your profile card. Each service is free; fill in the ones you like.",
    steps: ["RAWG: sign up and copy the API key.", "IGDB: create an application in the Twitch developer console (client ID + secret).", "SteamGridDB: profile → API."],
    links: [
      { label: "RAWG API", url: "https://rawg.io/apidocs" },
      { label: "Twitch developer console", url: "https://dev.twitch.tv/console/apps" },
      { label: "SteamGridDB API key", url: "https://www.steamgriddb.com/profile/preferences/api" },
    ],
    keys: ["RAWG_API_KEY", "IGDB_CLIENT_ID", "IGDB_CLIENT_SECRET", "STEAMGRIDDB_API_KEY"],
  },
  {
    id: "spotify",
    icon: "music_note",
    feature: "spotify",
    title: "Spotify details",
    intro: "Better album art and links for what you listen to.",
    steps: ["Spotify developer dashboard → Create app (any redirect URI, Web API) → Settings: copy the client ID and secret."],
    links: [
      { label: "Spotify developer dashboard", url: "https://developer.spotify.com/dashboard" },
      { label: "Video tutorials (YouTube)", url: youtube("spotify developer dashboard create app client id secret"), video: true },
    ],
    keys: ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"],
  },
  {
    id: "lobby",
    icon: "sports_esports",
    feature: "lobby",
    title: "Lobby codes",
    intro: "Members post game lobby codes with /lobby-code; the newest shows up on the /cult page. Optional review for new members.",
    steps: ["Copy the IDs of the channel (and roles) you want to use. Leave the review channel empty to let everyone post directly."],
    keys: ["LOBBY_CHANNEL_ID", "LOBBY_PING_ROLE_ID", "LOBBY_REVIEW_CHANNEL_ID", "LOBBY_REVIEW_ROLE_ID", "LOBBY_TRUSTED_ROLE_IDS"],
  },
  {
    id: "fdc",
    icon: "checkroom",
    feature: "fdc",
    title: "FDC polls",
    intro: "Weekly design/outfit polls with images, run from Discord (/fdc) or the website, with an archive.",
    steps: ["Copy the poll channel's ID. The bot needs Send Messages, Embed Links, Attach Files, Add Reactions and Manage Messages there.", "Optional: a role that is pinged for new polls (it must be mentionable)."],
    keys: ["FDC_CHANNEL_ID", "FDC_ROLE_ID"],
  },
  {
    id: "community",
    icon: "forum",
    title: "Community extras",
    intro: "Small bot features. Each one is off until you give it a channel or role; skip what you don't need.",
    steps: ["Sticky message: keeps an info text at the bottom of a channel.", "Levels: XP for messages, level-up posts and up to 13 level roles.", "Birthdays and a role for new members."],
    keys: [
      "STICKY_CHANNEL_ID",
      "STICKY_MESSAGE",
      "LEVEL_UP_CHANNEL_ID",
      "LEVEL_ROLE_IDS",
      "BIRTHDAY_CHANNEL_ID",
      "JOIN_ROLE_ID",
    ],
  },
  {
    id: "minecraft",
    icon: "dns",
    feature: "minecraft",
    title: "Minecraft server status",
    intro: "A live status card for a Minecraft Java server, kept at the bottom of a thread.",
    steps: ["Enter the server address and the thread (or channel) ID for the status card."],
    keys: ["MINECRAFT_HOST", "MINECRAFT_PORT", "MINECRAFT_STATUS_THREAD_ID"],
  },
  {
    id: "maps",
    icon: "map",
    feature: "maps",
    title: "Maps",
    intro: "/maps works without any keys. These add an OpenStreetMap login (edit notes), street photos and photo uploads.",
    steps: ["Register the apps with the links below; each setting explains the exact options."],
    links: [
      { label: "OSM applications", url: "https://www.openstreetmap.org/oauth2/applications/new" },
      { label: "Mapillary developers", url: "https://www.mapillary.com/dashboard/developers" },
    ],
    keys: ["VITE_OSM_CLIENT_ID", "VITE_OSM_DEV_CLIENT_ID", "VITE_MAPILLARY_CLIENT_TOKEN", "VITE_WIKIMEDIA_CLIENT_ID"],
  },
  {
    id: "extras",
    icon: "tune",
    title: "Nice to have",
    intro: "A source link, your own search engine for the dashboard and automatic deploys from GitHub.",
    steps: ["Auto deploy: add a GitHub webhook (push events) pointing at your deploy listener, with this secret."],
    links: [{ label: "GitHub: creating webhooks", url: "https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks" }],
    keys: ["SOURCE_REPO_URL", "SEARCH_ENGINE_URL", "SEARCH_ENGINE_NAME", "GITHUB_WEBHOOK_SECRET"],
  },
];

const NEXT_STEPS = [
  { command: "pnpm install", text: "install everything (once)" },
  { command: "pnpm dev", text: "the website on http://localhost:5173" },
  { command: "pnpm bot", text: "the Discord bot" },
  { command: "pnpm accounts", text: "the account API (login, voting, admin)" },
  { command: "pnpm discord", text: "the live Discord card API" },
  { command: "pnpm build", text: "a production build in dist/" },
];

module.exports = { STAGES, NEXT_STEPS };
