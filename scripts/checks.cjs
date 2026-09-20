#!/usr/bin/env node
"use strict";

/**
 * Local repository checks.
 *
 * Usage:
 *   node scripts/checks.cjs
 *   pnpm checks
 *
 * Optional environment variables, loaded from .env when present:
 *   DISCORD_BOT_TOKEN
 *   DISCORD_CLIENT_ID
 *   DISCORD_USER_ID
 *   DISCORD_REDIRECT_URI
 *   VITE_DISCORD_API_URL
 *
 * Optional flags:
 *   --discord-smoke-test   Require and run live Discord API checks.
 *   --no-discord-smoke-test Skip live Discord API checks even if configured.
 *   --install              Run `pnpm install --frozen-lockfile` before checks.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { createRequire } = require("node:module");

const projectRoot = path.resolve(__dirname, "..");
const logsDirectory = path.join(projectRoot, ".logs");
const dotenvPath = path.join(projectRoot, ".env");

const args = new Set(process.argv.slice(2));
const shouldInstall = args.has("--install");
const forceDiscordSmokeTest = args.has("--discord-smoke-test");
const skipDiscordSmokeTest = args.has("--no-discord-smoke-test");

if (forceDiscordSmokeTest && skipDiscordSmokeTest) {
  console.error(
    "Cannot use --discord-smoke-test and --no-discord-smoke-test together.",
  );
  process.exit(2);
}

process.chdir(projectRoot);
fs.mkdirSync(logsDirectory, { recursive: true });

loadDotEnvIfPresent();

const checks = [];
const localRequire = createRequire(path.join(projectRoot, "package.json"));

function loadDotEnvIfPresent() {
  if (!fs.existsSync(dotenvPath)) {
    console.log(
      "ℹ No .env file found in the project root; using existing environment variables.",
    );
    return;
  }

  try {
    require("dotenv").config({ path: dotenvPath, override: false });
    console.log("✓ Loaded environment variables from .env.");
  } catch (error) {
    console.warn(
      `⚠ Found .env but could not load it with dotenv: ${error.message}`,
    );
  }
}

function formatCommand(command, commandArgs) {
  return [command, ...commandArgs]
    .map((part) => (/\s/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}

function runCommand(command, commandArgs, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      cwd: projectRoot,
      env: process.env,
      shell: process.platform === "win32",
      ...options,
    });

    let output = "";

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });

    child.on("error", (error) => {
      output += `${error.stack || error.message}${os.EOL}`;
      resolve({
        command: formatCommand(command, commandArgs),
        output,
        status: 1,
      });
    });

    child.on("close", (status, signal) => {
      if (signal) {
        output += `Process terminated by signal: ${signal}${os.EOL}`;
      }

      resolve({
        command: formatCommand(command, commandArgs),
        output,
        status: status ?? 1,
      });
    });
  });
}

async function runCheck(id, label, callback) {
  const logPath = path.join(logsDirectory, `${id}.log`);

  process.stdout.write(`\n▶ ${label}\n`);

  let status = "success";
  let output = "";

  try {
    output = await callback();

    if (typeof output !== "string") {
      output = String(output ?? "");
    }
  } catch (error) {
    status = "failure";
    output = `${error.stack || error.message || String(error)}${os.EOL}`;
  }

  fs.writeFileSync(logPath, output, "utf8");

  if (status === "success") {
    process.stdout.write(`✓ Passed — log: .ci-logs/${id}.log\n`);
  } else {
    process.stdout.write(`✗ Failed — log: .ci-logs/${id}.log\n`);
  }

  checks.push({ id, label, logPath, status });
}

async function commandCheck(id, label, command, commandArgs) {
  await runCheck(id, label, async () => {
    const result = await runCommand(command, commandArgs);
    const output = `$ ${result.command}${os.EOL}${result.output}`;

    if (result.status !== 0) {
      throw new Error(output);
    }

    return output;
  });
}

function assertFile(filePath, message) {
  if (!fs.existsSync(filePath)) {
    throw new Error(message || `Missing required file: ${filePath}`);
  }

  if (!fs.statSync(filePath).isFile()) {
    throw new Error(`Expected a file but found something else: ${filePath}`);
  }
}

function assertDirectory(directoryPath, message) {
  if (!fs.existsSync(directoryPath)) {
    throw new Error(message || `Missing required directory: ${directoryPath}`);
  }

  if (!fs.statSync(directoryPath).isDirectory()) {
    throw new Error(
      `Expected a directory but found something else: ${directoryPath}`,
    );
  }
}

function findJavaScriptFiles(directory) {
  const ignoredDirectories = new Set([
    ".git",
    ".ci-logs",
    "dist",
    "node_modules",
  ]);

  const files = [];

  function walk(currentDirectory) {
    for (const entry of fs.readdirSync(currentDirectory, {
      withFileTypes: true,
    })) {
      const absolutePath = path.join(currentDirectory, entry.name);
      const relativePath = path.relative(projectRoot, absolutePath);

      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          walk(absolutePath);
        }

        continue;
      }

      if (
        entry.isFile() &&
        [".js", ".cjs", ".mjs"].includes(path.extname(entry.name))
      ) {
        files.push(relativePath);
      }
    }
  }

  walk(directory);
  return files.sort();
}

function getDirectorySizeBytes(directory) {
  let total = 0;

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      total += getDirectorySizeBytes(filePath);
    } else if (entry.isFile()) {
      total += fs.statSync(filePath).size;
    }
  }

  return total;
}

function formatBytes(bytes) {
  if (bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );

  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();

  let body;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    const details =
      typeof body === "string" ? body : JSON.stringify(body, null, 2);

    throw new Error(
      `Discord returned HTTP ${response.status} for ${url}.${os.EOL}${details}`,
    );
  }

  return body;
}

function printSummary() {
  const failedChecks = checks.filter((check) => check.status === "failure");

  console.log("\n# Repository checks\n");
  console.log("| Status | Check | Result |");
  console.log("| :---: | --- | --- |");

  for (const check of checks) {
    const icon = check.status === "success" ? "✅" : "❌";
    const result = check.status === "success" ? "Passed" : "Failed";
    console.log(`| ${icon} | ${check.label} | ${result} |`);
  }

  if (failedChecks.length === 0) {
    console.log("\n## ✅ All repository checks passed");
    return;
  }

  console.log(`\n## ❌ ${failedChecks.length} check(s) failed`);

  for (const check of failedChecks) {
    const log = fs.existsSync(check.logPath)
      ? fs.readFileSync(check.logPath, "utf8").trim()
      : "No captured output was produced by this check.";

    console.log(`\n### ${check.label}`);
    console.log(`Log: ${path.relative(projectRoot, check.logPath)}\n`);
    console.log("```text");
    console.log(log || "No captured output was produced by this check.");
    console.log("```");
  }
}

async function main() {
  await runCheck("versions", "Toolchain versions", async () => {
    const commands = [
      ["node", ["--version"]],
      ["pnpm", ["--version"]],
      ["npm", ["--version"]],
    ];

    const lines = [];

    for (const [command, commandArgs] of commands) {
      const result = await runCommand(command, commandArgs);

      if (result.status !== 0) {
        throw new Error(
          `$ ${result.command}${os.EOL}${result.output || `Unable to run ${command}.`}`,
        );
      }

      const version = result.output.trim();
      lines.push(`${command}: ${version}`);
    }

    return `${lines.join(os.EOL)}${os.EOL}`;
  });

  await runCheck("manifest", "Package manifest and lockfile", async () => {
    assertFile(path.join(projectRoot, "package.json"));
    assertFile(
      path.join(projectRoot, "pnpm-lock.yaml"),
      "pnpm-lock.yaml is missing.",
    );
    assertFile(
      path.join(projectRoot, ".oxlintrc.json"),
      ".oxlintrc.json is missing.",
    );

    const packageJson = JSON.parse(
      fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
    );

    if (!packageJson.packageManager?.startsWith("pnpm@")) {
      throw new Error(
        `Expected a pnpm packageManager field, received "${packageJson.packageManager ?? "missing"}".`,
      );
    }

    return [
      `✓ packageManager: ${packageJson.packageManager}`,
      "✓ pnpm-lock.yaml is present.",
      "✓ .oxlintrc.json is present.",
      "",
    ].join(os.EOL);
  });

  await runCheck(
    "dependencies-installed",
    "Local dependencies are installed",
    async () => {
      const nodeModules = path.join(projectRoot, "node_modules");

      if (!fs.existsSync(nodeModules)) {
        throw new Error(
          [
            "node_modules is missing.",
            "Run `pnpm install --frozen-lockfile` and retry.",
            "Or run this script with `--install` to install first.",
          ].join(os.EOL),
        );
      }

      return "✓ node_modules is present.\n";
    },
  );

  if (shouldInstall) {
    await commandCheck(
      "install",
      "Install dependencies with frozen lockfile",
      "pnpm",
      ["install", "--frozen-lockfile"],
    );
  }

  await commandCheck("dependencies", "pnpm dependency graph", "pnpm", [
    "list",
    "--depth",
    "0",
  ]);

  await runCheck(
    "package-resolution",
    "Critical package resolution",
    async () => {
      const requiredPackages = [
        "vite",
        "react",
        "react-dom",
        "discord.js",
        "@discordjs/rest",
        "discord-api-types/v10",
        "dotenv",
        "sharp",
        "canvas",
      ];

      const lines = [];
      const failures = [];

      for (const packageName of requiredPackages) {
        try {
          const resolved = localRequire.resolve(packageName);
          lines.push(`✓ ${packageName}: ${resolved}`);
        } catch (error) {
          const message = `✗ Cannot resolve ${packageName}: ${error.message}`;
          lines.push(message);
          failures.push(message);
        }
      }

      if (failures.length > 0) {
        throw new Error(`${lines.join(os.EOL)}${os.EOL}`);
      }

      return `${lines.join(os.EOL)}${os.EOL}`;
    },
  );

  await commandCheck("oxlint", "Oxlint", "pnpm", ["exec", "oxlint", "."]);

  await runCheck("syntax", "JavaScript syntax", async () => {
    const files = findJavaScriptFiles(projectRoot);

    if (files.length === 0) {
      return "No JavaScript files found.\n";
    }

    const lines = [`Checking syntax for ${files.length} JavaScript files.`];
    const failures = [];

    for (const relativeFile of files) {
      const result = await runCommand("node", ["--check", relativeFile]);
      const output = result.output.trim();

      if (result.status === 0) {
        lines.push(`✓ Valid syntax: ${relativeFile}`);
      } else {
        failures.push(relativeFile);
        lines.push(`✗ Invalid syntax: ${relativeFile}`);

        if (output) {
          lines.push(output);
        }
      }
    }

    if (failures.length > 0) {
      throw new Error(`${lines.join(os.EOL)}${os.EOL}`);
    }

    return `${lines.join(os.EOL)}${os.EOL}`;
  });

  await runCheck(
    "discord-bot-static",
    "Discord bot static validation",
    async () => {
      const botPath = path.join(projectRoot, "server", "bot.cjs");
      assertFile(botPath, "server/bot.cjs is missing.");

      const syntax = await runCommand("node", ["--check", "server/bot.cjs"]);

      if (syntax.status !== 0) {
        throw new Error(
          `$ ${syntax.command}${os.EOL}${syntax.output || "Syntax validation failed."}`,
        );
      }

      const lines = ["✓ server/bot.cjs syntax is valid."];

      for (const directory of [
        "server/events",
        "server/commands",
        "server/interactions",
      ]) {
        const directoryPath = path.join(projectRoot, directory);

        if (!fs.existsSync(directoryPath)) {
          lines.push(`⚠ Optional bot directory missing: ${directory}`);
          continue;
        }

        assertDirectory(directoryPath);
        lines.push(`✓ Directory is valid: ${directory}`);
      }

      for (const dependency of [
        "discord.js",
        "@discordjs/rest",
        "discord-api-types/v10",
        "dotenv",
      ]) {
        const resolved = localRequire.resolve(dependency);
        lines.push(`✓ Resolved bot dependency: ${dependency} (${resolved})`);
      }

      const source = fs.readFileSync(botPath, "utf8");

      for (const expectedFragment of [
        "DISCORD_BOT_TOKEN",
        "DISCORD_CLIENT_ID",
        "client.login(token)",
      ]) {
        if (!source.includes(expectedFragment)) {
          throw new Error(
            `server/bot.cjs is missing expected entry-point code: ${expectedFragment}`,
          );
        }
      }

      lines.push("✓ Bot entry point passed static validation.");
      lines.push(
        "✓ The bot was not started; no Discord login or API request was made.",
      );

      return `${lines.join(os.EOL)}${os.EOL}`;
    },
  );

  await runCheck("vite-config", "Vite configuration", async () => {
    const result = await runCommand("node", ["--check", "vite.config.js"]);

    if (result.status !== 0) {
      throw new Error(
        `$ ${result.command}${os.EOL}${result.output || "Vite config syntax validation failed."}`,
      );
    }

    assertFile(path.join(projectRoot, "index.html"), "index.html is missing.");
    assertDirectory(path.join(projectRoot, "src"), "src directory is missing.");

    return [
      "✓ vite.config.js syntax is valid.",
      "✓ index.html exists.",
      "✓ src directory exists.",
      "",
    ].join(os.EOL);
  });

  await commandCheck("build", "Production build", "pnpm", ["run", "build"]);

  await runCheck("build-output", "Build output", async () => {
    const distDirectory = path.join(projectRoot, "dist");

    assertDirectory(distDirectory, "dist directory is missing.");
    assertFile(
      path.join(distDirectory, "index.html"),
      "dist/index.html is missing.",
    );
    assertFile(
      path.join(distDirectory, "404.html"),
      "dist/404.html is missing.",
    );

    let fileCount = 0;

    function countFiles(directory) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const itemPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          countFiles(itemPath);
        } else if (entry.isFile()) {
          fileCount += 1;
        }
      }
    }

    countFiles(distDirectory);

    const sizeBytes = getDirectorySizeBytes(distDirectory);
    const sizeHuman = formatBytes(sizeBytes);

    return [
      `file_count=${fileCount}`,
      `size_bytes=${sizeBytes}`,
      `size_human=${sizeHuman}`,
      `✓ dist contains ${fileCount} files and occupies ${sizeHuman}.`,
      "",
    ].join(os.EOL);
  });

  const discordVariables = [
    "DISCORD_BOT_TOKEN",
    "DISCORD_CLIENT_ID",
    "DISCORD_USER_ID",
  ];

  const missingDiscordVariables = discordVariables.filter(
    (name) => !process.env[name],
  );

  const shouldRunDiscordSmokeTest =
    !skipDiscordSmokeTest &&
    (forceDiscordSmokeTest || missingDiscordVariables.length === 0);

  if (shouldRunDiscordSmokeTest) {
    await runCheck(
      "discord-configuration",
      "Discord smoke-test configuration",
      async () => {
        if (missingDiscordVariables.length > 0) {
          throw new Error(
            [
              "Discord smoke test was explicitly requested, but required variables are missing:",
              ...missingDiscordVariables.map((name) => `- ${name}`),
              "",
              "Set them in the project-root .env file or export them in your shell.",
            ].join(os.EOL),
          );
        }

        const lines = [
          "✓ DISCORD_BOT_TOKEN is available.",
          "✓ DISCORD_CLIENT_ID is available.",
          "✓ DISCORD_USER_ID is available.",
          "✓ Environment variables were loaded.",
          `discord_user_id=${process.env.DISCORD_USER_ID}`,
          `discord_redirect_uri=${process.env.DISCORD_REDIRECT_URI || "not configured"}`,
          `discord_api_url=${process.env.VITE_DISCORD_API_URL || "not configured"}`,
          "",
        ];

        return lines.join(os.EOL);
      },
    );

    await runCheck(
      "discord-bot-identity",
      "Discord bot token and application identity",
      async () => {
        const bot = await fetchJson("https://discord.com/api/v10/users/@me", {
          headers: {
            Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
            "User-Agent":
              "HomeSite-Local-Discord-Smoke-Test (https://github.com/Master3307/HomeSite, 1.0)",
          },
        });

        if (bot.id !== process.env.DISCORD_CLIENT_ID) {
          throw new Error(
            `Token belongs to application ${bot.id}, but DISCORD_CLIENT_ID is ${process.env.DISCORD_CLIENT_ID}.`,
          );
        }

        return [
          "✓ Bot token is valid.",
          `✓ Authenticated bot: ${bot.username} (${bot.id}).`,
          "",
        ].join(os.EOL);
      },
    );

    await runCheck(
      "discord-user-lookup",
      "Configured Discord user lookup",
      async () => {
        const user = await fetchJson(
          `https://discord.com/api/v10/users/${encodeURIComponent(process.env.DISCORD_USER_ID)}`,
          {
            headers: {
              Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
              "User-Agent":
                "HomeSite-Local-Discord-Smoke-Test (https://github.com/Master3307/HomeSite, 1.0)",
            },
          },
        );

        return `✓ Configured Discord user was fetched: ${user.global_name || user.username}.\n`;
      },
    );
  } else if (skipDiscordSmokeTest) {
    console.log(
      "\nℹ Discord API smoke test skipped because --no-discord-smoke-test was supplied.",
    );
  } else {
    console.log(
      [
        "\nℹ Discord API smoke test skipped because its required values are not all available.",
        `  Missing: ${missingDiscordVariables.join(", ")}`,
        "  Add them to .env or run with --discord-smoke-test to treat missing values as a failure.",
      ].join(os.EOL),
    );
  }

  printSummary();

  if (checks.some((check) => check.status === "failure")) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
