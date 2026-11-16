# Contributing to HomeSite

Thanks for helping! Bug reports, ideas, translations, docs fixes and pull requests are all welcome. Be kind and constructive.

## Quick start

You need [Node.js](https://nodejs.org/) (LTS, CI uses 22), [pnpm](https://pnpm.io/) and Git.

```bash
git clone https://github.com/<your-username>/HomeSite.git
cd HomeSite
pnpm install
pnpm dev          # the site on the printed local URL
```

The backends (Discord bot, account API, profile API) need a `.env`. `pnpm setup:gui` walks you through it; everything optional can be skipped. [CLAUDE.md](./CLAUDE.md) explains how the project fits together.

## Making a change

1. Look for an existing [issue](https://github.com/Master3307/HomeSite/issues) first. For bigger changes, open one and talk about it before you start.
2. Branch off `dev` (that's where work happens; `master` is what's live):

   ```bash
   git checkout dev && git pull
   git checkout -b fix/short-description   # feat/ fix/ docs/ refactor/ chore/
   ```

3. Keep the change focused: one thing per pull request, no unrelated reformatting.
4. Never commit `.env` or anything secret. New settings go into `config/settings.cjs` (then `pnpm env:example`).
5. Check it before opening the pull request:

   ```bash
   pnpm exec oxlint .   # lint
   pnpm checks          # everything CI checks (lint, syntax, build)
   ```

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat: …`, `fix: …`, `docs: …`, `refactor: …`, `chore: …`.

A pull request should say what changed and why, link the issue (`Closes #123`), show screenshots for visible changes, and say how you tested it.

## Translations

The site is translated on [Weblate](http://weblate.master3307.org/engage/homesite/). Want a new language? Open an issue or ask on Discord.

## Security

Please don't report security problems in public issues. Use [a private security advisory](https://github.com/Master3307/HomeSite/security/advisories/new) instead.

## License

Your contributions are licensed under the project's [Apache License 2.0](./LICENSE). Keep the [NOTICE](./NOTICE) file: it is how the project gets credited.
