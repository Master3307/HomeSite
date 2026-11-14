/*
 * Two-factor setup for the admin account, run on the server itself:
 *
 *   pnpm 2fa:setup    new secret into .env (ADMIN_2FA_SECRET), QR code + key
 *                     (--force replaces an existing secret)
 *   pnpm 2fa:verify   the current code with a countdown; any key or Ctrl+C stops
 *   pnpm 2fa:qr       QR code of the current secret
 *   pnpm 2fa:key      the current secret
 *
 * Turn it on with ADMIN_2FA=on in .env (admin login and critical actions
 * such as the backup page then need a code). Restart the account API after
 * changing .env.
 */
const fs = require("node:fs");
const path = require("node:path");
const QRCode = require("qrcode");

const ROOT = path.resolve(__dirname, "..");
// TWOFA_ENV_FILE: another .env (only for testing).
const ENV_FILE = process.env.TWOFA_ENV_FILE ? path.resolve(process.env.TWOFA_ENV_FILE) : path.join(ROOT, ".env");
const { generateSecret, currentCode, otpauthUrl, base32Decode } = require("../server/services/totp.cjs");
const { parseEnv, setEnvValues } = require("../server/services/backup.cjs");

const command = process.argv[2];

function readEnv() {
  return fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "";
}

function secretOrExit() {
  const secret = parseEnv(readEnv()).ADMIN_2FA_SECRET;
  try {
    if (secret && base32Decode(secret).length >= 10) return secret;
  } catch {
    // fall through
  }
  console.error("No 2FA secret yet. Run `pnpm 2fa:setup` first.");
  process.exit(1);
}

async function printQr(secret) {
  const qr = await QRCode.toString(otpauthUrl(secret), { type: "terminal", small: true, errorCorrectionLevel: "M" });
  console.log(qr);
}

const grouped = (secret) => secret.match(/.{1,4}/g).join(" ");

async function setup() {
  const env = readEnv();
  const existing = parseEnv(env).ADMIN_2FA_SECRET;
  if (existing && !process.argv.includes("--force")) {
    console.error("A 2FA secret already exists. Use `pnpm 2fa:qr` / `pnpm 2fa:key` to see it,");
    console.error("or `pnpm 2fa:setup -- --force` to replace it (old codes stop working).");
    process.exit(1);
  }

  const secret = generateSecret();
  const enabled = parseEnv(env).ADMIN_2FA;
  const changes = { ADMIN_2FA_SECRET: secret };
  if (enabled === undefined) changes.ADMIN_2FA = "off";
  fs.writeFileSync(ENV_FILE, setEnvValues(env, changes, `Admin two-factor (pnpm 2fa:setup, ${new Date().toISOString()})`), { mode: 0o600 });

  console.log("\nScan this with your authenticator app (Google Authenticator, Aegis, 2FAS, 1Password, …):\n");
  await printQr(secret);
  console.log(`Key (if you type it in):  ${grouped(secret)}\n`);
  console.log("Saved as ADMIN_2FA_SECRET in .env.");
  console.log("Check a code with `pnpm 2fa:verify`, then set ADMIN_2FA=on in .env and restart the account API.\n");
}

function verify() {
  const secret = secretOrExit();
  const stdin = process.stdin;
  let timer = null;

  const stop = () => {
    clearInterval(timer);
    process.stdout.write("\x1b[?25h\n");
    if (stdin.isTTY) stdin.setRawMode(false);
    process.exit(0);
  };

  if (stdin.isTTY) {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", stop); // any key stops
  }
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  console.log("Current admin 2FA code (press any key to stop):\n");
  process.stdout.write("\x1b[?25l"); // hide cursor

  const draw = () => {
    const { code, secondsLeft, period } = currentCode(secret);
    const width = 30;
    const filled = Math.round((secondsLeft / period) * width);
    const bar = "█".repeat(filled) + "░".repeat(width - filled);
    const color = secondsLeft <= 5 ? "\x1b[31m" : secondsLeft <= 10 ? "\x1b[33m" : "\x1b[32m";
    process.stdout.write(`\r\x1b[2K  \x1b[1m${code.slice(0, 3)} ${code.slice(3)}\x1b[0m   ${color}${bar}\x1b[0m ${String(secondsLeft).padStart(2)}s`);
  };

  draw();
  timer = setInterval(draw, 250);
}

async function main() {
  switch (command) {
    case "setup":
      return setup();
    case "verify":
      return verify();
    case "qr":
      return printQr(secretOrExit());
    case "key":
      return console.log(grouped(secretOrExit()));
    default:
      console.log("Usage: pnpm 2fa:setup | 2fa:verify | 2fa:qr | 2fa:key");
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
