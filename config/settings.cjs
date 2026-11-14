/*
 * Every setting HomeSite reads from .env, in one place.
 *
 * This list is the single source of truth for:
 *   - .env.example                (pnpm env:example writes it from here)
 *   - the admin settings page     (/admin-settings, server/services/backup.cjs)
 *   - the setup wizard            (pnpm setup:cli / pnpm setup:gui)
 *   - runtime defaults            (server/config.cjs, vite.config.js)
 *
 * Adding a setting: add it below, run `pnpm env:example`, read it with
 * `setting("KEY")` from server/config.cjs (backend) or `siteConfig.KEY`
 * from src/lib/siteConfig.js (frontend; needs `public: true`).
 *
 * Fields:
 *   key          env name
 *   section      where it shows up (SECTIONS)
 *   feature      optional feature it belongs to (FEATURES); empty values
 *                switch that part off instead of breaking anything
 *   label        short human name
 *   description  what it does, in plain words
 *   type         text | secret | url | number | toggle | id | ids | select
 *   importance   required | important | recommended | optional
 *   needed       essential for its feature: warns once the feature is in use
 *   default      used when the value is not set (also in .env.example)
 *   example      placeholder shown in forms
 *   public       also baked into the website build (never for secrets!)
 *   applies      what has to restart: bot | accounts | profile | site (rebuild)
 *   generate     can be generated: "secret" (random) | "key" (admin key)
 *   suggest      (env) => value derived from other settings
 *   help         [{ label, url }] guides; videos -> YouTube search
 *   videos       YouTube search query for video tutorials
 */

const SECTIONS = [
  { id: "site", icon: "language", title: "Website", text: "Where the site and its APIs live." },
  { id: "discord", icon: "smart_toy", title: "Discord app & bot", text: "The Discord application that powers the bot and the login." },
  { id: "people", icon: "group", title: "People & roles", text: "Who owns the site and which Discord roles have extra rights." },
  { id: "features", icon: "extension", title: "Bot features", text: "Optional bot features. Leave a feature empty to switch it off." },
  { id: "integrations", icon: "hub", title: "Integrations", text: "Third-party services for game art, music, maps and deploys." },
  { id: "security", icon: "shield", title: "Security", text: "Secrets, sessions, the admin login and two-factor codes." },
  { id: "advanced", icon: "settings", title: "Advanced", text: "Ports, internal addresses and timings. The defaults are usually fine." },
];

const FEATURES = [
  { id: "bot", title: "Discord bot", text: "The bot itself (commands, widget data, FDC polls, levels …).", core: true },
  { id: "login", title: "Website login with Discord", text: "Lets people log in on the site with their Discord account (also needed for voting and the admin login)." },
  { id: "profile", title: "Discord profile card", text: "Shows your live Discord status, games and music on the home page." },
  { id: "lobby", title: "Lobby codes", text: "/lobby-code posts game lobby codes to a channel and the /cult page." },
  { id: "fdc", title: "FDC polls", text: "Fashion/design contest polls in a Discord channel, also managed on the website." },
  { id: "sticky", title: "Sticky message", text: "Keeps an info message at the bottom of a channel." },
  { id: "levels", title: "Levels & XP", text: "Members earn XP for messages and get level roles." },
  { id: "birthdays", title: "Birthdays", text: "Birthday wishes in a channel." },
  { id: "joinRole", title: "Role on join", text: "Gives new members a role automatically." },
  { id: "minecraft", title: "Minecraft server status", text: "A live status message for a Minecraft server in a thread." },
  { id: "gameArt", title: "Game artwork", text: "Covers and details for the games shown on the profile card." },
  { id: "spotify", title: "Spotify details", text: "Better album art and links for music on the profile card." },
  { id: "maps", title: "Maps login & photos", text: "OpenStreetMap login, Mapillary and Wikimedia photos on /maps." },
  { id: "deploy", title: "Auto deploy from GitHub", text: "Updates the server when you push to the main branch." },
  { id: "twofa", title: "Two-factor codes for the admin", text: "Authenticator-app codes for the admin login and critical actions." },
  { id: "hub", title: "Admin hub", text: "/hub: members, live activity, bot commands, logs, database, settings and a server terminal, behind the hub key (and 2FA when on)." },
];

const DEV_PORTAL = { label: "Discord Developer Portal", url: "https://discord.com/developers/applications" };
const DEV_MODE = {
  label: "How to copy IDs in Discord (Developer Mode)",
  url: "https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID",
};
const ID_VIDEOS = "discord how to copy user server channel role id developer mode";

const trimSlash = (value) => String(value ?? "").replace(/\/+$/, "");

const SETTINGS = [
  /* ---------- Website ---------- */
  {
    key: "FRONTEND_ORIGIN",
    section: "site",
    label: "Website address",
    description: "The public address of the website, without a trailing slash. Used for CORS, cookies, the sitemap and links.",
    type: "url",
    importance: "required",
    default: "http://localhost:5173",
    example: "https://example.com",
    public: true,
    applies: ["accounts", "profile", "site"],
  },
  {
    key: "FRONTEND_REDIRECT_URL",
    section: "site",
    feature: "login",
    label: "Page after login",
    description: "Where people land after logging in with Discord. Empty: the website address.",
    type: "url",
    importance: "optional",
    default: "",
    example: "https://example.com/cult",
    suggest: (env) => (env.FRONTEND_ORIGIN ? `${trimSlash(env.FRONTEND_ORIGIN)}/cult` : ""),
    applies: ["accounts"],
  },
  {
    key: "ACCOUNT_API_ORIGIN",
    section: "site",
    feature: "login",
    label: "Account API address",
    description:
      "Public address of the account API (server/account-api.cjs). Your reverse proxy (Nginx, Caddy, Cloudflare Tunnel …) forwards it to ACCOUNT_API_PORT. Empty: the website uses /account-api on its own address.",
    type: "url",
    importance: "important",
    default: "",
    example: "https://accounts-api.example.com",
    public: true,
    applies: ["accounts", "profile", "site"],
  },
  {
    key: "PROFILE_API_ORIGIN",
    section: "site",
    feature: "profile",
    label: "Profile API address",
    description:
      "Public address of the Discord profile/presence API (server/services/discord-profile.js, PORT). The home page loads your live Discord card from here.",
    type: "url",
    importance: "important",
    default: "",
    example: "https://discord-api.example.com",
    public: true,
    applies: ["profile", "site"],
  },
  {
    key: "AUTH_COOKIE_DOMAIN",
    section: "site",
    feature: "login",
    label: "Login cookie domain",
    description:
      "Shares the login cookie between the site and its API subdomains, e.g. example.com when the site is example.com and the API accounts-api.example.com. Empty: the cookie only works on the API's own host.",
    type: "text",
    importance: "recommended",
    default: "",
    example: "example.com",
    suggest: (env) => {
      try {
        return new URL(env.FRONTEND_ORIGIN).hostname.split(".").slice(-2).join(".");
      } catch {
        return "";
      }
    },
    applies: ["accounts"],
  },
  {
    key: "SOURCE_REPO_URL",
    section: "site",
    label: "Source code link",
    description: 'Link for "View source on GitHub" at the bottom of the cult page. Empty hides it.',
    type: "url",
    importance: "optional",
    default: "",
    example: "https://github.com/you/HomeSite",
    public: true,
    applies: ["profile", "site"],
  },
  {
    key: "SEARCH_ENGINE_URL",
    section: "site",
    label: "Own search engine",
    description: "An extra search engine for the dashboard (e.g. your own SearXNG). Use %s where the search text goes. Empty hides it.",
    type: "url",
    importance: "optional",
    default: "",
    example: "https://search.example.com/search?q=%s",
    public: true,
    applies: ["site"],
  },

  {
    key: "SEARCH_ENGINE_NAME",
    section: "site",
    label: "Own search engine name",
    description: "Name shown for that search engine.",
    type: "text",
    importance: "optional",
    default: "My search",
    public: true,
    applies: ["site"],
  },

  /* ---------- Discord app & bot ---------- */
  {
    key: "DISCORD_CLIENT_ID",
    section: "discord",
    feature: "bot",
    label: "Application ID",
    description: "Discord Developer Portal → your application → General Information → Application ID. The bot's user ID is the same number.",
    type: "id",
    importance: "required",
    default: "",
    public: true,
    applies: ["bot", "accounts", "site"],
    help: [DEV_PORTAL, { label: "Discord: getting started with apps", url: "https://discord.com/developers/docs/quick-start/getting-started" }],
    videos: "create discord bot application developer portal",
  },
  {
    key: "DISCORD_CLIENT_SECRET",
    section: "discord",
    feature: "login",
    label: "Client secret",
    description: "Developer Portal → OAuth2 → Client Secret (Reset Secret to see it). Needed for the website login.",
    type: "secret",
    importance: "important",
    needed: true,
    default: "",
    applies: ["accounts"],
    help: [DEV_PORTAL],
    videos: "discord oauth2 client secret developer portal",
  },
  {
    key: "DISCORD_BOT_TOKEN",
    section: "discord",
    feature: "bot",
    label: "Bot token",
    description:
      "Developer Portal → Bot → Reset Token. Also turn on the Server Members and Message Content intents there, and invite the bot to your server (OAuth2 → URL Generator → bot + applications.commands).",
    type: "secret",
    importance: "required",
    default: "",
    applies: ["bot", "profile"],
    help: [DEV_PORTAL, { label: "Discord: bot users & tokens", url: "https://discord.com/developers/docs/topics/oauth2#bot-users" }],
    videos: "discord bot token privileged intents invite bot to server",
  },
  {
    key: "DISCORD_REDIRECT_URI",
    section: "discord",
    feature: "login",
    label: "OAuth redirect",
    description: "Must match an entry under Developer Portal → OAuth2 → Redirects exactly. The account API answers on /auth/discord/callback. Empty: <Account API address>/auth/discord/callback.",
    type: "url",
    importance: "optional",
    default: "",
    example: "https://accounts-api.example.com/auth/discord/callback",
    suggest: (env) => (env.ACCOUNT_API_ORIGIN ? `${trimSlash(env.ACCOUNT_API_ORIGIN)}/auth/discord/callback` : ""),
    applies: ["accounts"],
    help: [DEV_PORTAL],
  },
  {
    key: "DISCORD_GUILD_ID",
    section: "discord",
    feature: "bot",
    label: "Server ID",
    description: "Your Discord server. Right-click the server icon → Copy Server ID (needs Developer Mode).",
    type: "id",
    importance: "required",
    default: "",
    public: true,
    applies: ["bot", "profile", "accounts", "site"],
    help: [DEV_MODE],
    videos: ID_VIDEOS,
  },
  {
    key: "DISCORD_INVITE_CODE",
    section: "discord",
    label: "Invite code",
    description: "The part after discord.gg/ of a permanent invite to your server, used by the widget and the Join buttons.",
    type: "text",
    importance: "recommended",
    default: "",
    example: "abcDEF123",
    public: true,
    applies: ["accounts", "site"],
    help: [{ label: "Discord: invites 101", url: "https://support.discord.com/hc/en-us/articles/208866998-Invites-101" }],
  },
  {
    key: "BOT_PREFIX",
    section: "discord",
    feature: "bot",
    label: "Command prefix",
    description: "Prefix for the old text commands (slash commands always work).",
    type: "text",
    importance: "optional",
    default: "!",
    applies: ["bot"],
  },
  {
    key: "BOT_DISPLAY_NAME",
    section: "discord",
    label: "Admin account name",
    description: 'Name of the admin account on the website (the admin-code login acts as the bot). Usually your bot\'s name.',
    type: "text",
    importance: "optional",
    default: "Admin",
    public: true,
    applies: ["accounts", "site"],
  },
  {
    key: "EMOJI_SYNC_DEBOUNCE_MS",
    section: "advanced",
    feature: "bot",
    label: "Emoji sync delay (ms)",
    description: "How long the bot waits after emoji changes before syncing them.",
    type: "number",
    importance: "optional",
    default: "10000",
    applies: ["bot"],
  },

  /* ---------- People & roles ---------- */
  {
    key: "DISCORD_USER_ID",
    section: "people",
    label: "Your Discord user ID",
    description: "You, the site owner. The profile card shows this person; right-click yourself → Copy User ID.",
    type: "id",
    importance: "recommended",
    default: "",
    public: true,
    applies: ["profile", "site", "bot"],
    help: [DEV_MODE],
    videos: ID_VIDEOS,
  },
  {
    key: "BOT_OWNERS",
    section: "people",
    feature: "bot",
    label: "Bot owners",
    description: "User IDs that may use owner-only bot commands, separated by commas.",
    type: "ids",
    importance: "important",
    default: "",
    suggest: (env) => env.DISCORD_USER_ID || "",
    applies: ["bot"],
    help: [DEV_MODE],
  },
  {
    key: "COMMUNITY_LEADER_ID",
    section: "people",
    label: "Community leader",
    description: "A second special person (e.g. the server's leader): can always post lobby codes, and gets their own lobby-cat greetings. Optional.",
    type: "id",
    importance: "optional",
    default: "",
    public: true,
    applies: ["bot", "site"],
    help: [DEV_MODE],
  },
  {
    key: "MOD_ROLE_ID",
    section: "people",
    feature: "bot",
    label: "Moderator role",
    description: "Role that may use moderation commands (ban, kick …) and manage FDC polls. Right-click the role → Copy Role ID.",
    type: "id",
    importance: "recommended",
    default: "",
    applies: ["bot"],
    help: [DEV_MODE],
    videos: ID_VIDEOS,
  },
  {
    key: "JOIN_ROLE_ID",
    section: "features",
    feature: "joinRole",
    label: "Role for new members",
    description: "Given to everyone who joins. Empty: off. The bot's role must be above it.",
    type: "id",
    importance: "optional",
    default: "",
    applies: ["bot"],
  },

  /* ---------- Bot features ---------- */
  {
    key: "LOBBY_CHANNEL_ID",
    section: "features",
    feature: "lobby",
    label: "Lobby code channel",
    description: "Channel where /lobby-code posts codes. Empty: lobby codes are off.",
    type: "id",
    importance: "optional",
    needed: true,
    default: "",
    applies: ["bot"],
  },
  {
    key: "LOBBY_PING_ROLE_ID",
    section: "features",
    feature: "lobby",
    label: "Lobby ping role",
    description: "Role pinged for new lobby codes. Empty: no ping.",
    type: "id",
    importance: "optional",
    default: "",
    applies: ["bot"],
  },
  {
    key: "LOBBY_REVIEW_CHANNEL_ID",
    section: "features",
    feature: "lobby",
    label: "Lobby review channel",
    description: "Codes from members without a trusted role wait here for approval. Empty: everyone posts directly.",
    type: "id",
    importance: "optional",
    default: "",
    applies: ["bot", "accounts"],
  },
  {
    key: "LOBBY_REVIEW_ROLE_ID",
    section: "features",
    feature: "lobby",
    label: "Lobby reviewer role",
    description: "Role pinged in the review channel.",
    type: "id",
    importance: "optional",
    needed: true,
    default: "",
    applies: ["bot"],
  },
  {
    key: "LOBBY_TRUSTED_ROLE_IDS",
    section: "features",
    feature: "lobby",
    label: "Trusted roles",
    description: "Roles whose lobby codes skip the review, separated by commas.",
    type: "ids",
    importance: "optional",
    default: "",
    applies: ["bot"],
  },
  {
    key: "FDC_CHANNEL_ID",
    section: "features",
    feature: "fdc",
    label: "FDC channel",
    description: "Default channel for FDC polls. Empty: polls need a channel picked in /fdc.",
    type: "id",
    importance: "optional",
    needed: true,
    default: "",
    applies: ["bot"],
  },
  {
    key: "FDC_ROLE_ID",
    section: "features",
    feature: "fdc",
    label: "FDC role",
    description: "Role that may create FDC polls and is pinged for new ones (moderators always may).",
    type: "id",
    importance: "optional",
    default: "",
    applies: ["bot", "accounts"],
  },
  {
    key: "STICKY_CHANNEL_ID",
    section: "features",
    feature: "sticky",
    label: "Sticky message channel",
    description: "The bot keeps its info message at the bottom of this channel. Empty: off.",
    type: "id",
    importance: "optional",
    needed: true,
    default: "",
    applies: ["bot"],
  },
  {
    key: "STICKY_MESSAGE",
    section: "features",
    feature: "sticky",
    label: "Sticky message text",
    description: "The text the bot keeps at the bottom of the sticky channel. Discord markdown works; write \\n for a new line.",
    type: "text",
    multiline: true,
    importance: "optional",
    default: "",
    needed: true,
    applies: ["bot"],
  },
  {
    key: "LEVEL_UP_CHANNEL_ID",
    section: "features",
    feature: "levels",
    label: "Level-up channel",
    description: "Where level-up messages go. Empty: they are not posted (XP still counts).",
    type: "id",
    importance: "optional",
    default: "",
    applies: ["bot"],
  },
  {
    key: "LEVEL_ROLE_IDS",
    section: "features",
    feature: "levels",
    label: "Level roles",
    description: "Role IDs for level 1, 2, 3 … in order, separated by commas (up to 13). Missing ones are skipped.",
    type: "ids",
    importance: "optional",
    default: "",
    applies: ["bot"],
  },
  {
    key: "BIRTHDAY_CHANNEL_ID",
    section: "features",
    feature: "birthdays",
    label: "Birthday channel",
    description: "Where birthday wishes are posted. Empty: off.",
    type: "id",
    importance: "optional",
    needed: true,
    default: "",
    applies: ["bot"],
  },
  {
    key: "MINECRAFT_HOST",
    section: "features",
    feature: "minecraft",
    label: "Minecraft server",
    description: "Address of the Minecraft (Java) server to show. Empty: off.",
    type: "text",
    importance: "optional",
    needed: true,
    default: "",
    example: "play.example.com",
    applies: ["bot"],
  },
  {
    key: "MINECRAFT_PORT",
    section: "features",
    feature: "minecraft",
    label: "Minecraft port",
    description: "Usually 25565.",
    type: "number",
    importance: "optional",
    default: "25565",
    applies: ["bot"],
  },
  {
    key: "MINECRAFT_STATUS_THREAD_ID",
    section: "features",
    feature: "minecraft",
    label: "Minecraft status thread",
    description: "Thread or channel where the live status message lives.",
    type: "id",
    importance: "optional",
    needed: true,
    default: "",
    applies: ["bot"],
  },

  /* ---------- Integrations ---------- */
  {
    key: "RAWG_API_KEY",
    section: "integrations",
    feature: "gameArt",
    label: "RAWG API key",
    description: "Game details and covers. Free key at rawg.io.",
    type: "secret",
    importance: "optional",
    default: "",
    applies: ["profile"],
    help: [{ label: "RAWG API docs", url: "https://rawg.io/apidocs" }],
  },
  {
    key: "IGDB_CLIENT_ID",
    section: "integrations",
    feature: "gameArt",
    label: "IGDB / Twitch client ID",
    description: "IGDB uses a Twitch developer application.",
    type: "text",
    importance: "optional",
    needed: true,
    default: "",
    applies: ["profile"],
    help: [
      { label: "IGDB: getting started", url: "https://api-docs.igdb.com/#getting-started" },
      { label: "Twitch developer console", url: "https://dev.twitch.tv/console/apps" },
    ],
    videos: "igdb api twitch client id secret",
  },
  {
    key: "IGDB_CLIENT_SECRET",
    section: "integrations",
    feature: "gameArt",
    label: "IGDB / Twitch client secret",
    description: "From the same Twitch application.",
    type: "secret",
    importance: "optional",
    needed: true,
    default: "",
    applies: ["profile"],
  },
  {
    key: "STEAMGRIDDB_API_KEY",
    section: "integrations",
    feature: "gameArt",
    label: "SteamGridDB API key",
    description: "Nicer game artwork.",
    type: "secret",
    importance: "optional",
    default: "",
    applies: ["profile"],
    help: [{ label: "SteamGridDB API key", url: "https://www.steamgriddb.com/profile/preferences/api" }],
  },
  {
    key: "SPOTIFY_CLIENT_ID",
    section: "integrations",
    feature: "spotify",
    label: "Spotify client ID",
    description: "Create an app in the Spotify developer dashboard (any redirect URI).",
    type: "text",
    importance: "optional",
    needed: true,
    default: "",
    applies: ["profile"],
    help: [{ label: "Spotify developer dashboard", url: "https://developer.spotify.com/dashboard" }],
    videos: "spotify developer dashboard client id secret",
  },
  {
    key: "SPOTIFY_CLIENT_SECRET",
    section: "integrations",
    feature: "spotify",
    label: "Spotify client secret",
    description: "From the same Spotify app.",
    type: "secret",
    importance: "optional",
    needed: true,
    default: "",
    applies: ["profile"],
  },
  {
    key: "VITE_OSM_CLIENT_ID",
    section: "integrations",
    feature: "maps",
    label: "OpenStreetMap client ID",
    description:
      "OAuth 2 client ID of a public OSM application (no secret, the site uses PKCE). Redirect URIs: <your site>/maps and http://localhost:5173/maps; confidential: unchecked; permissions: read preferences, modify the map, modify notes. Empty: OSM login off.",
    type: "text",
    importance: "optional",
    default: "",
    applies: ["site"],
    help: [{ label: "Register an OSM application", url: "https://www.openstreetmap.org/oauth2/applications/new" }],
  },
  {
    key: "VITE_OSM_DEV_CLIENT_ID",
    section: "integrations",
    feature: "maps",
    label: "OSM test server client ID",
    description: 'Same for the OSM test server, used when "Test server" is picked in the map settings.',
    type: "text",
    importance: "optional",
    default: "",
    applies: ["site"],
    help: [{ label: "OSM test server", url: "https://master.apis.dev.openstreetmap.org/oauth2/applications/new" }],
  },
  {
    key: "VITE_MAPILLARY_CLIENT_TOKEN",
    section: "integrations",
    feature: "maps",
    label: "Mapillary client token",
    description: "Public, read-only client token (starts with MLY|) for street-level photos. Never the client secret.",
    type: "text",
    importance: "optional",
    default: "",
    applies: ["site"],
    help: [{ label: "Mapillary developer dashboard", url: "https://www.mapillary.com/dashboard/developers" }],
  },
  {
    key: "VITE_WIKIMEDIA_CLIENT_ID",
    section: "integrations",
    feature: "maps",
    label: "Wikimedia client ID",
    description:
      "OAuth 2.0 client ID of a non-confidential Wikimedia consumer for photo uploads to Commons. Callback: <your site>/maps; grants: basic rights, upload new files. Until approved only your own account can use it.",
    type: "text",
    importance: "optional",
    default: "",
    applies: ["site"],
    help: [{ label: "Propose a Wikimedia consumer", url: "https://meta.wikimedia.org/wiki/Special:OAuthConsumerRegistration/propose/oauth2" }],
  },
  {
    key: "GITHUB_WEBHOOK_SECRET",
    section: "integrations",
    feature: "deploy",
    label: "GitHub webhook secret",
    description: "Secret of the GitHub push webhook that triggers scripts/deploy.sh (server/services/github-deploy-listener.mjs).",
    type: "secret",
    importance: "optional",
    default: "",
    generate: "secret",
    help: [{ label: "GitHub: creating webhooks", url: "https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks" }],
    videos: "github webhook secret setup",
  },

  /* ---------- Security ---------- */
  {
    key: "SESSION_SECRET",
    section: "security",
    feature: "login",
    label: "Session secret",
    description: "Long random secret for the short OAuth state session. Generate one, nobody needs to remember it.",
    type: "secret",
    importance: "important",
    default: "",
    generate: "secret",
    applies: ["accounts"],
  },
  {
    key: "SESSION_TTL_DAYS",
    section: "security",
    feature: "login",
    label: "Stay logged in (days)",
    description: "How long a website login lasts.",
    type: "number",
    importance: "optional",
    default: "30",
    applies: ["accounts"],
  },
  {
    key: "ADMIN_KEY",
    section: "security",
    label: "Admin key",
    description:
      'Password for "Use an admin code" on the login: logs in as the bot with the owner role (FDC polls, backups, these settings). At least 16 characters; empty disables admin login. Keep it somewhere safe.',
    type: "secret",
    importance: "important",
    default: "",
    generate: "key",
    applies: ["accounts", "site"],
  },
  {
    key: "ADMIN_SESSION_TTL_HOURS",
    section: "security",
    label: "Admin login (hours)",
    description: "How long an admin-code login lasts.",
    type: "number",
    importance: "optional",
    default: "12",
    applies: ["accounts"],
  },
  {
    key: "ADMIN_2FA",
    section: "security",
    feature: "twofa",
    label: "Two-factor codes",
    description:
      "When on, the admin login and critical actions (opening admin settings, backups, .env changes) need a 6-digit code from an authenticator app. Run `pnpm 2fa:setup` and `pnpm 2fa:verify` first.",
    type: "toggle",
    importance: "recommended",
    default: "off",
    applies: ["accounts"],
    help: [{ label: "Aegis (Android)", url: "https://getaegis.app/" }, { label: "2FAS (iOS/Android)", url: "https://2fas.com/" }],
  },
  {
    key: "ADMIN_2FA_SECRET",
    section: "security",
    feature: "twofa",
    label: "Two-factor secret",
    description: "Written by `pnpm 2fa:setup` (show it again with `pnpm 2fa:qr`). Needs access to the server on purpose.",
    type: "secret",
    importance: "important",
    needed: true,
    default: "",
    applies: ["accounts"],
  },
  {
    key: "INTERNAL_API_KEY",
    section: "security",
    feature: "bot",
    label: "Internal API key",
    description: "Shared secret between the account API and the bot. Empty: derived from the bot token, which works fine.",
    type: "secret",
    importance: "optional",
    default: "",
    generate: "secret",
    applies: ["bot", "accounts"],
  },
  {
    key: "HUB_KEY",
    section: "security",
    feature: "hub",
    label: "Hub key",
    description:
      "Private key for /hub and for looking up Discord users on the profile API (/<user id>, /<user id>-ui, /history). With 2FA on, the hub also asks for a code. Scripts can send it as the X-Hub-Key header. At least 24 characters; empty locks the hub and those lookups completely. Not the admin key.",
    type: "secret",
    importance: "recommended",
    default: "",
    generate: "key",
    applies: ["accounts", "profile"],
  },
  {
    key: "HUB_SESSION_TTL_HOURS",
    section: "security",
    feature: "hub",
    label: "Hub login (hours)",
    description: "How long a hub login lasts before the key (and 2FA code) is needed again.",
    type: "number",
    importance: "optional",
    default: "12",
    applies: ["accounts"],
  },
  {
    key: "HUB_TERMINAL",
    section: "security",
    feature: "hub",
    label: "Server terminal in the hub",
    description:
      "A full shell on the server inside /hub (runs as the user of the account API). Only turn it on if you need it; anyone with the hub key (and 2FA code) gets shell access.",
    type: "toggle",
    importance: "optional",
    default: "off",
    applies: ["accounts"],
  },
  {
    key: "HUB_TERMINAL_SHELL",
    section: "advanced",
    feature: "hub",
    label: "Terminal shell",
    description: "Shell for the hub terminal. Empty: $SHELL, else /bin/bash.",
    type: "text",
    importance: "optional",
    default: "",
    example: "/usr/bin/fish",
    applies: ["accounts"],
  },

  /* ---------- Advanced ---------- */
  {
    key: "ACCOUNT_API_PORT",
    section: "advanced",
    feature: "login",
    label: "Account API port",
    description: "Local port of server/account-api.cjs. Your reverse proxy forwards ACCOUNT_API_ORIGIN here (including /auth, /account, /avatars, /fdc, /discord).",
    type: "number",
    importance: "recommended",
    default: "3002",
    applies: ["accounts"],
  },
  {
    key: "PORT",
    section: "advanced",
    feature: "profile",
    label: "Profile API port",
    description: "Local port of the Discord profile API (pnpm discord). Also the /api target of `pnpm dev`.",
    type: "number",
    importance: "recommended",
    default: "3001",
    applies: ["profile"],
  },
  {
    key: "BOT_INTERNAL_URL",
    section: "advanced",
    feature: "bot",
    label: "Bot internal API",
    description: "Local address of the bot's internal API; the account API forwards website votes and polls here.",
    type: "url",
    importance: "optional",
    default: "http://127.0.0.1:3004",
    applies: ["bot", "accounts"],
  },
  {
    key: "ACCOUNT_API_PROXY_TARGETS",
    section: "advanced",
    label: "Dev proxy targets",
    description:
      "`pnpm dev` / `pnpm preview` serve the account API under /account-api. Targets tried in order, separated by commas. Empty: the local API, then ACCOUNT_API_ORIGIN.",
    type: "text",
    importance: "optional",
    default: "",
    applies: ["site"],
  },
  {
    key: "VITE_ACCOUNT_API_URL",
    section: "advanced",
    label: "Account API URL in the build",
    description: "Overrides ACCOUNT_API_ORIGIN for the website build. Set to /account-api to serve a build with `pnpm preview` on a local server.",
    type: "text",
    importance: "optional",
    default: "",
    applies: ["site"],
  },
  {
    key: "ACTIVITY_POLL_INTERVAL_MS",
    section: "advanced",
    feature: "profile",
    label: "Presence poll interval (ms)",
    description: "How often the profile API refreshes Discord activity. At least 15000.",
    type: "number",
    importance: "optional",
    default: "30000",
    applies: ["profile"],
  },
];

const BY_KEY = new Map(SETTINGS.map((setting) => [setting.key, setting]));

const ON = new Set(["1", "true", "on", "yes"]);

/** Value of a setting from an env object, falling back to its default. */
function resolve(env, key) {
  const raw = env?.[key];
  if (raw !== undefined && String(raw).trim() !== "") return String(raw).trim();
  return BY_KEY.get(key)?.default ?? "";
}

/** Values for `public: true` settings, baked into the website build. */
function publicConfig(env) {
  return Object.fromEntries(SETTINGS.filter((setting) => setting.public).map((setting) => [setting.key, resolve(env, setting.key)]));
}

const youtube = (query) => `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

/** JSON-safe description of everything (for the admin page and the setup GUI). */
function describe() {
  return {
    sections: SECTIONS,
    features: FEATURES,
    settings: SETTINGS.map(({ suggest, ...setting }) => ({
      ...setting,
      help: [...(setting.help ?? []), ...(setting.videos ? [{ label: "Video tutorials (YouTube)", url: youtube(setting.videos), video: true }] : [])],
      suggests: Boolean(suggest),
    })),
  };
}

/** Suggested values for empty settings, given the current env. */
function suggestions(env) {
  const out = {};
  for (const setting of SETTINGS) {
    if (!setting.suggest || resolve(env, setting.key) !== (setting.default ?? "")) continue;
    const value = setting.suggest(env);
    if (value) out[setting.key] = value;
  }
  return out;
}

const isSet = (env, key) => String(env?.[key] ?? "").trim() !== "";

/*
 * A feature is "in use" once any of its values is set (2FA: once it is
 * switched on). Then its `needed` values matter; otherwise they are just
 * optional. Core features are always in use.
 */
function featureInUse(env, featureId) {
  const feature = FEATURES.find((entry) => entry.id === featureId);
  if (!feature) return false;
  if (feature.core) return true;
  if (featureId === "twofa") return ON.has(String(env?.ADMIN_2FA ?? "").trim().toLowerCase());
  return SETTINGS.some((setting) => setting.feature === featureId && isSet(env, setting.key));
}

function featureStatus(env, featureId) {
  const settings = SETTINGS.filter((setting) => setting.feature === featureId);
  const missing = settings.filter((setting) => (setting.needed || setting.importance === "required") && !isSet(env, setting.key));
  return {
    inUse: featureInUse(env, featureId),
    total: settings.length,
    set: settings.filter((setting) => isSet(env, setting.key)).length,
    missing: missing.map((setting) => setting.key),
    keys: settings.map((setting) => setting.key),
  };
}

/**
 * How a setting looks right now:
 *   set | missing-required (red) | needed (yellow, "Needed for …") |
 *   missing-important (yellow) | missing (gray)
 */
function statusOf(env, key) {
  const setting = BY_KEY.get(key);
  if (isSet(env, key)) return { state: "set" };
  if (!setting) return { state: "missing" };
  const feature = FEATURES.find((entry) => entry.id === setting.feature);
  if (setting.importance === "required" && setting.default) {
    return { state: "missing-important", reason: `Using the default (${setting.default})` };
  }
  if (setting.importance === "required") {
    return { state: "missing-required", reason: feature ? `Needed for ${feature.title}` : "Required" };
  }
  if (setting.needed && featureInUse(env, setting.feature)) {
    return { state: "needed", reason: `Needed for ${feature.title}` };
  }
  // Important for an optional feature you don't use (yet): just gray.
  if (setting.importance === "important" && feature && !feature.core && !featureInUse(env, setting.feature)) {
    return { state: "missing", reason: `Important once you use ${feature.title}` };
  }
  if (setting.importance === "important") return { state: "missing-important", reason: feature ? `Important for ${feature.title}` : "Important" };
  if (setting.needed && feature) return { state: "missing", reason: `Needed once you use ${feature.title}` };
  return { state: "missing" };
}

/** Returns an error message, or null when the value is fine ("" always is). */
function validate(key, value) {
  const setting = BY_KEY.get(key);
  const text = String(value ?? "").trim();
  if (!setting || text === "") return null;
  switch (setting.type) {
    case "number":
      return /^\d+$/.test(text) ? null : "Use a whole number.";
    case "id":
      return /^\d{17,20}$/.test(text) ? null : "A Discord ID is a 17–20 digit number (Developer Mode → Copy ID).";
    case "ids":
      return text.split(/[\s,]+/).filter(Boolean).every((part) => /^(\d{17,20}|[0-9a-f-]{36})$/i.test(part))
        ? null
        : "Use IDs separated by commas.";
    case "toggle":
      return /^(on|off|true|false|1|0|yes|no)$/i.test(text) ? null : "Use on or off.";
    case "url":
      if (text.startsWith("/")) return null;
      try {
        const url = new URL(text.replace("%s", "x"));
        return /^https?:$/.test(url.protocol) ? null : "Use an http(s) address.";
      } catch {
        return "That is not a valid address (include https://).";
      }
    default:
      if (key === "ADMIN_KEY" && text.length < 16) return "At least 16 characters.";
      if (key === "HUB_KEY" && text.length < 24) return "At least 24 characters (use generate).";
      return null;
  }
}

/** Generates a value for settings with `generate`. */
function generateValue(key) {
  const crypto = require("node:crypto");
  const setting = BY_KEY.get(key);
  if (setting?.generate === "key") return crypto.randomBytes(24).toString("base64url");
  return crypto.randomBytes(48).toString("base64url");
}

module.exports = {
  validate,
  generateValue,
  SECTIONS,
  FEATURES,
  SETTINGS,
  BY_KEY,
  ON,
  resolve,
  publicConfig,
  describe,
  suggestions,
  featureStatus,
  featureInUse,
  statusOf,
  isSet,
  youtube,
};
