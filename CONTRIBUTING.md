# Contributing to HomeSite

Thanks for your interest in contributing to **HomeSite**! Contributions are welcome, including bug reports, feature requests, documentation improvements, design feedback, and pull requests.

Please read this guide before opening an issue or submitting code.

## Code of Conduct

Be respectful, constructive, and considerate of others. Harassment, personal attacks, and disruptive behavior are not welcome.

## Before You Start

Before beginning work:

1. Search the existing [issues](https://github.com/Master3307/HomeSite/issues) and [pull requests](https://github.com/Master3307/HomeSite/pulls) to avoid duplicates.
2. For larger changes or new features, open an issue first to discuss the idea and implementation approach.
3. Keep each pull request focused on one logical change.
4. Do not include unrelated refactors, formatting changes, or generated files unless they are necessary for the change.

## Development Setup

### Requirements

You will need:

- A current LTS version of [Node.js](https://nodejs.org/)
- [pnpm](https://pnpm.io/)
- Git

### Fork and Clone

1. Fork [Master3307/HomeSite](https://github.com/Master3307/HomeSite) on GitHub.
2. Clone your fork:

```bash
git clone https://github.com/<your-username>/HomeSite.git
cd HomeSite
```

3. Add the upstream remote:

```bash
git remote add upstream https://github.com/Master3307/HomeSite.git
```

4. Install dependencies:

```bash
pnpm install
```

### Run the Project

Start the local development server:

```bash
pnpm dev
```

Use the local URL printed by the development server.

## Making Changes

### Create a Branch

Start from an up-to-date `master` branch:

```bash
git checkout master
git pull upstream master
git checkout -b feat/short-description
```

Use descriptive branch names:

- `feat/` for new functionality
- `fix/` for bug fixes
- `docs/` for documentation changes
- `refactor/` for internal code cleanup
- `test/` for test changes
- `chore/` for tooling, dependency, or maintenance work

For example:

```bash
git checkout -b fix/mobile-navigation-overflow
```

### Code Guidelines

- Follow the conventions already present in the codebase.
- Keep components, functions, and commits focused and readable.
- Prefer clear names and straightforward logic over clever abstractions.
- Update documentation when you change user-facing behavior, setup instructions, configuration, or public APIs.
- Add or update tests when the project has relevant test coverage.
- Do not commit secrets, `.env` files, credentials, API keys, or private configuration.

## Checks Before Submitting

Before opening a pull request, install dependencies and run the checks defined by the project:

```bash
pnpm install
pnpm dev
pnpm build
```

Make sure the site works locally and that your changes do not introduce browser-console errors.

## Commit Messages

Use short, descriptive, imperative commit messages. Conventional Commits are preferred:

```text
feat: add project filter controls
fix: prevent navigation menu overflow
docs: clarify local setup steps
refactor: simplify route metadata handling
chore: update development dependencies
```

Avoid vague messages such as `updates`, `fix stuff`, or `wip`.

## Reporting Bugs

Before reporting a bug, search existing issues to see whether it has already been reported.

A helpful bug report includes:

- A clear description of the problem
- Steps to reproduce it
- Expected behavior
- Actual behavior
- Browser, operating system, and relevant version details
- Screenshots, console output, or logs when useful
- A minimal reproduction, if possible

## Suggesting Features

Feature requests are welcome. Please describe:

- The problem the feature solves
- The proposed behavior or design
- Any alternatives you considered
- Potential trade-offs or compatibility concerns

For substantial features, please wait for feedback before spending significant time implementing them.

## Pull Requests

When opening a pull request:

- Use a concise title that explains the change.
- Explain what changed and why.
- Link related issues using `Closes #<issue-number>` when applicable.
- Include screenshots or recordings for visible UI changes.
- Describe how you tested the change.
- Respond to review feedback constructively.

## Security Issues

Please do not report security vulnerabilities in public issues. Contact the repository owner privately with enough detail to reproduce and assess the issue.

## License

By contributing to HomeSite, you agree that your contributions will be licensed under the repository's existing license.
