/*
 * After the build (pnpm build): the files that link the site with its app.
 *
 *   dist/.well-known/assetlinks.json               Android: links to the site open
 *                                                  the app, passkeys work in it
 *   dist/.well-known/apple-app-site-association    the same for iOS (APP_TEAM_ID)
 *
 * For both apps (APP_ID = HomeSite, CULT_APP_ID = Cult of black Cats), signed
 * with the keys in APP_CERT_FINGERPRINTS; APP_TEAM_ID for iOS. Without any app
 * ID nothing is written (the site has no app).
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.resolve(ROOT, process.env.BUILD_OUT_DIR || "dist");
const settings = require("../config/settings.cjs");
const { parseEnv } = require("../server/services/backup.cjs");

const envFile = path.join(ROOT, ".env");
const env = { ...parseEnv(fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : ""), ...process.env };
const PACKAGE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const appIds = ["APP_ID", "CULT_APP_ID"].map((key) => settings.resolve(env, key).toLowerCase()).filter((id) => PACKAGE.test(id));
const fingerprints = settings
  .resolve(env, "APP_CERT_FINGERPRINTS")
  .split(",")
  .map((value) => value.trim().toUpperCase())
  .filter((value) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value));
const teamId = settings.resolve(env, "APP_TEAM_ID").toUpperCase();

const wellKnown = path.join(DIST, ".well-known");
const write = (name, data) => {
  fs.mkdirSync(wellKnown, { recursive: true });
  fs.writeFileSync(path.join(wellKnown, name), `${JSON.stringify(data, null, 2)}\n`);
  console.log(`[Build] Wrote dist/.well-known/${name}`);
};

if (!appIds.length) {
  console.log("[Build] No APP_ID: no app links.");
  process.exit(0);
}

if (fingerprints.length) {
  write(
    "assetlinks.json",
    appIds.map((id) => ({
      relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
      target: { namespace: "android_app", package_name: id, sha256_cert_fingerprints: fingerprints },
    })),
  );
} else {
  console.log("[Build] No APP_CERT_FINGERPRINTS: no assetlinks.json (pnpm app:build adds the local key's).");
}

if (/^[A-Z0-9]{10}$/.test(teamId)) {
  // Each app opens its own pages (like the Android manifests): the Cult app /cult, HomeSite the rest.
  const [home, cult] = ["APP_ID", "CULT_APP_ID"].map((key) => settings.resolve(env, key).toLowerCase()).map((id) => (PACKAGE.test(id) ? `${teamId}.${id}` : ""));
  const details = [];
  if (cult) details.push({ appIDs: [cult], components: [{ "/": "/cult" }, { "/": "/cult/*" }] });
  if (home) details.push({ appIDs: [home], components: [...(cult ? [{ "/": "/cult*", exclude: true }] : []), { "/": "*" }] });
  write("apple-app-site-association", {
    applinks: { details },
    webcredentials: { apps: [home, cult].filter(Boolean) },
  });
  // `serve` would send it without a type; Apple wants JSON.
  const serveFile = path.join(DIST, "serve.json");
  if (fs.existsSync(serveFile)) {
    const serve = JSON.parse(fs.readFileSync(serveFile, "utf8"));
    serve.headers = [
      ...(serve.headers ?? []).filter((entry) => entry.source !== "/.well-known/apple-app-site-association"),
      { source: "/.well-known/apple-app-site-association", headers: [{ key: "Content-Type", value: "application/json" }] },
    ];
    fs.writeFileSync(serveFile, `${JSON.stringify(serve, null, 2)}\n`);
  }
}
