/*
 * pnpm mail:test <address> [--all]
 *
 * Sends a test email through the SMTP settings in .env (SMTP_*), to check
 * the email setup before members rely on it. `--all` sends the four looks
 * (light / dark, English / German) to compare them. `--preview <folder>`
 * only writes the HTML files there, nothing is sent.
 */
require("dotenv").config({ quiet: true });
const fs = require("node:fs");
const path = require("node:path");
const mail = require("../server/services/mail.cjs");

const LOOKS = [
  ["en", "dark"],
  ["en", "light"],
  ["de", "dark"],
  ["de", "light"],
];

(async () => {
  const args = process.argv.slice(2);
  const previewAt = args.indexOf("--preview");
  if (previewAt !== -1) {
    const folder = path.resolve(args[previewAt + 1] || "mail-preview");
    fs.mkdirSync(folder, { recursive: true });
    for (const [language, theme] of [...LOOKS, ["en", "system"]]) {
      const message = await mail.sendPreview({ language, theme });
      fs.writeFileSync(path.join(folder, `${language}-${theme}.html`), message.html);
    }
    console.log(`Previews written to ${folder}`);
    return;
  }

  const to = args.find((arg) => arg.includes("@"));
  if (!to) {
    console.log("Usage: pnpm mail:test you@example.com [--all]   or   pnpm mail:test --preview <folder>");
    process.exit(1);
  }
  if (!mail.available()) {
    console.log("Email isn't set up: SMTP_HOST and SMTP_FROM are needed (pnpm setup:gui → Email).");
    process.exit(1);
  }
  try {
    for (const [language, theme] of args.includes("--all") ? LOOKS : [["en", "system"]]) {
      await mail.sendPreview({ to, language, theme });
      console.log(`Sent (${language}, ${theme}) to ${to}.`);
    }
    console.log("Check the inbox (and the spam folder).");
  } catch (error) {
    console.error(`Sending failed: ${error.message}`);
    process.exit(1);
  }
})();
