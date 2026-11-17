/*
 * Push notification keys, run on the server itself:
 *
 *   pnpm push:setup             new VAPID keys for Web Push into .env
 *                               (--force replaces existing ones: every browser
 *                               then has to turn push on again)
 *   pnpm push:setup -- --check  shows what is set up (browser / app), no changes
 *
 * Push in the app (Firebase) needs FCM_SERVICE_ACCOUNT in .env and the
 * project's google-services.json in app/ (docs/app.md). Restart the account
 * API after changing .env.
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
// PUSH_ENV_FILE: another .env (only for testing).
const ENV_FILE = process.env.PUSH_ENV_FILE ? path.resolve(process.env.PUSH_ENV_FILE) : path.join(ROOT, ".env");
const { parseEnv, setEnvValues } = require("../server/services/backup.cjs");

const readEnv = () => (fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "");

function check() {
  const env = parseEnv(readEnv());
  const web = Boolean(env.WEB_PUSH_PUBLIC_KEY && env.WEB_PUSH_PRIVATE_KEY);
  let app = false;
  try {
    const raw = String(env.FCM_SERVICE_ACCOUNT || "").trim();
    const account = raw ? JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")) : null;
    app = Boolean(account?.project_id && account?.client_email && account?.private_key);
  } catch {
    app = false;
  }
  const googleServices = fs.existsSync(path.join(ROOT, "app", "google-services.json"));
  console.log(`Browser push (Web Push): ${web ? "ready" : "not set up (run pnpm push:setup)"}`);
  console.log(`App push (Firebase):     ${app ? "server ready" : "FCM_SERVICE_ACCOUNT missing or invalid"}`);
  console.log(`App build:               ${googleServices ? "app/google-services.json found" : "no app/google-services.json (the app builds without push)"}`);
}

function setup() {
  const env = readEnv();
  const current = parseEnv(env);
  if (current.WEB_PUSH_PRIVATE_KEY && !process.argv.includes("--force")) {
    console.error("Web Push keys already exist. `pnpm push:setup -- --force` replaces them");
    console.error("(every browser then has to turn push on again). `-- --check` shows the status.");
    process.exit(1);
  }
  const { generateVAPIDKeys } = require("web-push");
  const keys = generateVAPIDKeys();
  fs.writeFileSync(
    ENV_FILE,
    setEnvValues(env, { WEB_PUSH_PUBLIC_KEY: keys.publicKey, WEB_PUSH_PRIVATE_KEY: keys.privateKey }, `Web Push keys (pnpm push:setup, ${new Date().toISOString()})`),
    { mode: 0o600 },
  );
  console.log("Saved WEB_PUSH_PUBLIC_KEY and WEB_PUSH_PRIVATE_KEY in .env.");
  console.log("Restart the account API; people can then turn push on in Settings → Notifications.");
}

if (process.argv.includes("--check")) check();
else setup();
