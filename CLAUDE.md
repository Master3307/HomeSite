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

# Backends (each needs .env, see .env.example)
pnpm bot            # Discord bot (server/bot.cjs)
pnpm accounts       # Account/OAuth API (server/account-api.cjs, ACCOUNT_API_PORT, default 3002)
pnpm discord        # Discord profile/presence API (server/services/discord-profile.js, PORT, default 3001)
```

There is no test suite. Validation is `pnpm checks` (oxlint, `node --check` on every .js/.cjs/.mjs file, static bot-entry validation, build + dist checks). `pnpm checks --discord-smoke-test` additionally hits the live Discord API with credentials from `.env`.

Other scripts: `search:index` (rebuild `public/search-index.json`), `fdc:import` / `fdc:export` (FDC poll data), `sitemap`, `images`, `fonts:update` (self-hosted fonts / Material Symbols), `git-sync`, `cleaner`.

## Architecture

### Frontend (`src/`)
- `main.jsx` wraps the app in `HelmetProvider` → `BrowserRouter` → `AccountSettingsProvider` → `Root`.
- `Root.jsx` renders `App` plus the global `ThemeSwitch` / `LanguageSwitch`, and runs `twemoji.parse` over the whole tree on every route/language change (emoji served from `/twemoji/svg/`). `themeSwitchHiddenPaths` controls where the theme switch is hidden (glob-style patterns, e.g. `/cult*`).
- `App.jsx` holds all routes (`react-router` v8); unknown paths render `<Error forcedCode={404} />`. Public routes that should be indexed must also be added to the hardcoded list in `scripts/generate-sitemap.mjs`.
- `pages/` are route components; `components/cult/` contains the Cult (Discord community) features: FDC archive/polls, voting, lobby code.
- Site search: `scripts/generate-search-index.mjs` crawls the routes in `App.jsx` and the components they render, collects static `t('key')` calls and resolves them in every locale into `public/search-index.json` (gitignored, generated). Each entry is identified as `<namespace>:<key>` with its source file:line. `components/Search.jsx` (ranking in `lib/search.js`) searches it client-side; `SearchHighlight` in `Root.jsx` scrolls to and highlights the hit after navigation. Profile search is a static placeholder in `lib/search.js`. Tune excluded routes/keys and per-route keywords in the script's config section.
- `lib/i18n.js` auto-discovers translations via `import.meta.glob('../locales/*/*.json')`: each folder under `src/locales/` is a language, each JSON file a namespace. Adding a language or namespace needs no code changes. Other languages are translated through Weblate.
- Frontend env vars must be prefixed `VITE_` (e.g. `VITE_DISCORD_API_URL`).

### Backends (`server/`, mostly CommonJS `.cjs`)
- **Discord bot** (`bot.cjs`, based on NamVr's DiscordBot-Template): dynamically loads handlers from `events/`, `commands/<category>/` (legacy prefix commands), and `interactions/{slash,buttons,select-menus,context-menus,modals,autocomplete}/<category>/`. Adding a command means dropping a file in the right folder; follow the shape of existing files. Types live in `server/typings.d.ts`. CI statically checks that `bot.cjs` still references `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID` and `client.login(token)`.
- **Account API** (`account-api.cjs` + `services/discordOAuth.cjs`): Express on 127.0.0.1, Discord OAuth login, SQLite (`better-sqlite3`, `accounts.sqlite`), cached avatars. A reverse proxy routes public `/auth/*` and `/avatars/*` here.
- **Discord profile API** (`services/discord-profile.js` + `services/discord-profile/`): ESM Express service for presence/activity tracking, enrichment (RAWG/IGDB/SteamGridDB/Spotify), and live-user/stalking routes. This is the `/api` target in dev.
- Other `services/` modules (levels, birthdays, petting, sticky messages, Minecraft status, FDC archive, DM forwarder) are used by the bot.
- Runtime data is stored in `server/services/db/` (gitignored). FDC poll data in `server/services/db/fdc-polls` is exported to `public/fdc-polls` (dev) or `dist/fdc-polls` (build) by `scripts/export-fdc.cjs`.

### Deployment
`scripts/deploy.sh` runs on the server (`/opt/homesite-api`): hard-reset to `origin/master`, `pnpm install --frozen-lockfile`, `pnpm checks`, `pnpm build`, then restart the systemd units `homesite`, `accounts-api`, `discord-bot`, `discord-profile`. It is triggered by `server/services/github-deploy-listener.mjs`. So `master` is production; day-to-day work happens on `dev`.

## Conventions
- Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, optional scope, `!` / `BREAKING CHANGE:` for breaking changes). See `.github/.copilot-commit-message-instructions.md`.
- Branch prefixes: `feat/`, `fix/`, `docs/`, `refactor/`, `test/`, `chore/`; PRs target `master`.
- Never commit `.env`; document new env vars in `.env.example`.
- Commit messages and PR descriptions must not include a `Claude-Session:` trailer or session link unless the owner explicitly asks for it.
