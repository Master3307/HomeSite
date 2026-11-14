/*
 * Writes .env.example from config/settings.cjs (the single source of truth).
 *
 *   pnpm env:example            rewrite .env.example
 *   pnpm env:example -- --check exit 1 when .env.example is out of date (CI)
 */
const fs = require("node:fs");
const path = require("node:path");
const { SECTIONS, SETTINGS, FEATURES } = require("../config/settings.cjs");

const FILE = path.join(__dirname, "..", ".env.example");
const RULE = `# ${"=".repeat(77)}`;

function wrap(text, width = 76) {
  const lines = [];
  for (const paragraph of String(text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && line.length + word.length + 1 > width) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    lines.push(line);
  }
  return lines.map((line) => `# ${line}`.trimEnd());
}

function render() {
  const out = [
    RULE,
    "# HomeSite settings",
    RULE,
    "#",
    "# Easiest: run `pnpm setup:gui` (or `pnpm setup:cli` in a terminal). It walks",
    "# you through everything, with guides, and writes .env for you. Once the site",
    "# runs, the admin account can change all of this on /admin-settings.",
    "#",
    "# By hand: copy this file to .env and fill in what you need. Empty values use",
    "# the default or switch that feature off; nothing has to be changed in code.",
    "#",
    "# Generated from config/settings.cjs by `pnpm env:example`; edit that file,",
    "# not this one.",
    "",
  ];

  for (const section of SECTIONS) {
    const settings = SETTINGS.filter((setting) => setting.section === section.id);
    if (!settings.length) continue;
    out.push("", RULE, `# ${section.title}`, RULE, ...wrap(section.text), "");

    for (const setting of settings) {
      const feature = FEATURES.find((entry) => entry.id === setting.feature);
      const tags = [
        setting.importance !== "optional" ? setting.importance : null,
        feature && !feature.core ? `feature: ${feature.title}` : null,
        setting.needed ? "needed for that feature" : null,
        setting.public ? "public, part of the website build" : null,
      ].filter(Boolean);
      out.push(`# ${setting.label}${tags.length ? ` (${tags.join(", ")})` : ""}`);
      out.push(...wrap(setting.description));
      for (const help of setting.help ?? []) out.push(`#   ${help.label}: ${help.url}`);
      if (setting.example) out.push(`#   Example: ${setting.example}`);
      if (setting.generate) out.push("#   `pnpm setup:cli` can generate it for you.");
      if (setting.type === "secret") out.push("#   Secret: never commit the real value.");
      out.push(`${setting.key}=${setting.type === "secret" ? "" : (setting.default ?? "")}`, "");
    }
  }

  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

const next = render();
if (process.argv.includes("--check")) {
  const current = fs.existsSync(FILE) ? fs.readFileSync(FILE, "utf8") : "";
  if (current !== next) {
    console.error(".env.example is out of date. Run `pnpm env:example`.");
    process.exit(1);
  }
  console.log(".env.example is up to date.");
} else {
  fs.writeFileSync(FILE, next);
  console.log(`Wrote .env.example (${SETTINGS.length} settings).`);
}
