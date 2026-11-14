# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Personal website (home.master3307.org) built with Vite + React 19, plus several Node backends in `server/`: the Discord "Cultbot", a Discord OAuth account API, and a Discord profile/presence API. Package manager is **pnpm** (`packageManager` is pinned; CI uses Node 22 and `--frozen-lockfile`).

## Commands

```bash
pnpm install
pnpm dev            # builds search index, then Vite dev server; proxies /api -> http://127.0.0.1:3001 (discord-profile service)
pnpm build          # sitemap -> search index -> vite build -> export FDC polls into dist/ -> create dist/404.html
pnpm preview        # vite preview on port 8081
pnpm checks         # local equivalent of CI (scripts/checks.cjs); logs to .logs/
pnpm exec oxlint .  # lint only (config: .oxlintrc.json, react + oxc plugins)

# Setup (writes .env; guides, links, skip anything)
pnpm setup:gui      # local web page (Setup + Settings tabs), first free port 4780-4799, opens the browser
pnpm setup:cli      # same in the terminal
pnpm env:example    # regenerate .env.example from config/settings.cjs (checked by pnpm checks)

# Backends (each needs .env, see .env.example)
pnpm bot            # Discord bot (server/bot.cjs)
pnpm accounts       # Account/OAuth API (server/account-api.cjs, ACCOUNT_API_PORT, default 3002)
pnpm discord        # Discord profile/presence API (server/services/discord-profile.js, PORT, default 3001)
```

There is no test suite. Validation is `pnpm checks` (oxlint, `node --check` on every .js/.cjs/.mjs file, static bot-entry validation, build + dist checks). `pnpm checks --discord-smoke-test` additionally hits the live Discord API with credentials from `.env`.

Admin 2FA (run on the server): `pnpm 2fa:setup` (new secret into `.env` as `ADMIN_2FA_SECRET`, prints a terminal QR code and the key; `-- --force` replaces it), `pnpm 2fa:verify` (live code + countdown, any key stops), `pnpm 2fa:qr`, `pnpm 2fa:key`. `ADMIN_2FA=on` then requires a code for the admin login and critical actions (unlocking `/admin-settings`, export/import, .env changes and viewing). Logic in `server/services/totp.cjs`.

Hub (`/hub`, see Architecture): needs `HUB_KEY` (+ a 2FA code when `ADMIN_2FA=on`; with 2FA on, the admin key + code works too). The site owner (`DISCORD_USER_ID`) logged in on the site with Discord needs no key: with 2FA off that login is enough, with 2FA on only the code is asked. `HUB_TERMINAL=on` enables the server terminal.

Other scripts: `fdc:rebadge` (re-upload FDC option images to Discord with the number + emoji badge; preview by default, `--apply` / `--all`), `search:index` (rebuild `public/search-index.json`), `fdc:import` / `fdc:export` (FDC poll data), `sitemap`, `images`, `fonts:update` (self-hosted fonts: Google Sans Flex, the Material Symbols subset, and the JetBrains Mono Nerd Font for the hub console), `git-sync`, `cleaner`.

## Architecture

### Frontend (`src/`)
- `main.jsx` wraps the app in `HelmetProvider` → `BrowserRouter` → `AccountSettingsProvider` → `Root`.
- `Root.jsx` renders `App` plus the global `ThemeSwitch` / `LanguageSwitch`, and runs `twemoji.parse` over the whole tree on every route/language change (emoji served from `/twemoji/svg/`). `themeSwitchHiddenPaths` controls where the theme switch is hidden (glob-style patterns, e.g. `/cult*`).
- `App.jsx` holds all routes (`react-router` v8); unknown paths render `<Error forcedCode={404} />`. Public routes that should be indexed must also be added to the hardcoded list in `scripts/generate-sitemap.mjs`.
- `pages/` are route components; `components/cult/` contains the Cult (Discord community) features: FDC archive/polls, voting, lobby code.
- Site search: `scripts/generate-search-index.mjs` crawls the routes in `App.jsx` and the components they render, collects static `t('key')` calls and resolves them in every locale into `public/search-index.json` (gitignored, generated). Each entry is identified as `<namespace>:<key>` with its source file:line. `components/Search.jsx` (ranking in `lib/search.js`) searches it client-side; `SearchHighlight` in `Root.jsx` scrolls to and highlights the hit after navigation. Profile search is a static placeholder in `lib/search.js`. Tune excluded routes/keys and per-route keywords in the script's config section.
- `lib/i18n.js` auto-discovers translations via `import.meta.glob('../locales/*/*.json')`: each folder under `src/locales/` is a language, each JSON file a namespace. Adding a language or namespace needs no code changes. Other languages are translated through Weblate.
- Frontend config: settings with `public: true` in `config/settings.cjs` are injected by `vite.config.js` and read via `src/lib/siteConfig.js` (needs a rebuild after changes). Never hardcode IDs, domains or URLs.
- Icons: Material Symbols are self-hosted as a subset font. Icon names used dynamically (`<Icon name={…} />`, `icon: '…'`) must be listed in `scripts/material-symbols.extra.json`, then run `pnpm fonts:update`.

### Backends (`server/`, mostly CommonJS `.cjs`)
- **Discord bot** (`bot.cjs`, based on NamVr's DiscordBot-Template): dynamically loads handlers from `events/`, `commands/<category>/` (legacy prefix commands), and `interactions/{slash,buttons,select-menus,context-menus,modals,autocomplete}/<category>/`. Adding a command means dropping a file in the right folder; follow the shape of existing files. Types live in `server/typings.d.ts`. CI statically checks that `bot.cjs` still references `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID` and `client.login(token)`.
- **Account API** (`account-api.cjs` + `services/discordOAuth.cjs`): Express on 127.0.0.1, Discord OAuth login, SQLite (`better-sqlite3`, `accounts.sqlite`), cached avatars. A reverse proxy routes public `/auth/*` and `/avatars/*` here.
- **Discord profile API** (`services/discord-profile.js` + `services/discord-profile/`): ESM Express service for presence/activity tracking, enrichment (RAWG/IGDB/SteamGridDB/Spotify), and the live-user routes. Public: `/`, `/health`, `/api/discord-profile/avatar` and `/<DISCORD_USER_ID>` (the home page card). Everything else that exposes people (`/<id>`, `/<id>-ui`, `/history`) needs the hub key or a hub login (`discord-profile/hub-auth.js`). This is the `/api` target in dev (`/profile-api` is the same without the prefix, for the `-ui` pages).
- **Hub** (`/hub`, `src/pages/Hub.jsx` + `src/components/hub/`; backend `services/hub.cjs` on the account API): overview/health/stats, member list + ranked search, live activity feed (SSE), running bot commands (`services/hubCommands.cjs` builds a stand-in interaction/message), logs (`services/hubLogs.cjs`), database/users/data files (`services/hubDb.cjs`), the settings workspace and a server terminal (`services/hubTerminal.cjs` + `pty-helper.py`, WebSocket with HTTP fallback, sessions resume after dropped connections). Discord data comes from the bot's internal API (`services/hubBot.cjs`, `/hub/*` routes); the bot records every activity change for the Live tab in `db/hub-live.jsonl` (last 2000 events, max 7 days, not backed up). Login: `HUB_KEY` + 2FA → `__Secure-homesite_hub` cookie (parent domain, so the profile API's `-ui` pages accept it via `GET /hub/session`); sessions live in `db/hub-sessions.json` (not backed up). The code is public: keep every hub route behind `requireHub`, every mutation behind the Origin/CSRF check (`requireTrustedMutation`), log writes to the activity log, never send secrets to the browser.
- **Service logs:** every service calls `services/processLog.cjs` `capture(name)` first, which copies its console output to `.logs/services/<name>.log` (rotated at 5 MB). New services should do the same so `/hub` → Logs shows them.
- Other `services/` modules (levels, birthdays, petting, sticky messages, Minecraft status, FDC archive, DM forwarder) are used by the bot.
- Runtime data is stored in `server/services/db/` (gitignored). FDC poll data in `server/services/db/fdc-polls` is exported to `public/fdc-polls` (dev) or `dist/fdc-polls` (build) by `scripts/export-fdc.cjs`.

### Deployment
`scripts/deploy.sh` runs on the server (`/opt/homesite-api`): hard-reset to `origin/master`, `pnpm install --frozen-lockfile`, `pnpm checks`, `pnpm build`, then restart the systemd units `homesite`, `accounts-api`, `discord-bot`, `discord-profile`. It is triggered by `server/services/github-deploy-listener.mjs`. So `master` is production; day-to-day work happens on `dev`.

### Backups (keep up to date!)
`server/services/backup.cjs` (admin page `/admin-settings`, also the Settings tab in `/hub`; `/backup` redirects there; routes in `server/services/adminBackup.cjs`) exports everything git doesn't track — `server/services/db/` (accounts SQLite, FDC archive, recycling bin, activity log, bot data), avatars, logs, `.env` — as one encrypted archive and imports it again (merge or restore).
- **Any change to runtime data must be checked against the backup immediately:** new files or folders written at runtime, new SQLite tables/columns, renamed paths or changed JSON/CSV formats. Make sure they are included (or deliberately listed in `EXCLUDED`), and that imports merge them correctly (`MERGERS` for files with per-user data such as points, levels, birthdays; `mergeAccounts` for the database).
- Compatibility both ways: an old backup must import into new code and a new backup into old code (column intersection, tolerant JSON readers, `manifest.version`).

### Settings / environment variables (keep up to date!)
`config/settings.cjs` is the single source of truth for every .env setting (section, feature, label, description, type, importance, `needed`, default, `public`, `applies`, help links). It drives `.env.example` (`pnpm env:example`), `/admin-settings`, the hub's Settings tab, `pnpm setup:gui` / `setup:cli` (stages in `scripts/setup/stages.cjs`) and runtime defaults (`server/config.cjs`: `setting`, `ids`, `number`, `enabled`, `origin`).
Whenever a setting is added, renamed, removed or changes meaning:
- Add/update it in `config/settings.cjs`, run `pnpm env:example`, and add it to a setup stage if a newcomer should be asked about it.
- Read it through `server/config.cjs` / `siteConfig`, never `process.env` with a personal hardcoded fallback. Empty optional values must switch that feature off cleanly, not crash.
- Owner-specific values (IDs, domains) belong in the local `.env`, not in code or `.env.example`.

## Conventions
- Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, optional scope, `!` / `BREAKING CHANGE:` for breaking changes). See `.github/.copilot-commit-message-instructions.md`.
- Branch prefixes: `feat/`, `fix/`, `docs/`, `refactor/`, `test/`, `chore/`; PRs target `master`.
- Never commit `.env`; document new env vars in `.env.example`.
- Commit messages and PR descriptions must not include a `Claude-Session:` trailer or session link unless the owner explicitly asks for it.
