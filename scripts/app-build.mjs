/*
 * pnpm app:build — the website as two Android apps (Capacitor, app/android):
 *
 *   home  HomeSite             (APP_ID, APP_NAME)            every page except /cult
 *   cult  Cult of black Cats   (CULT_APP_ID, CULT_APP_NAME)  the /cult pages
 *
 * Both are the very same website build (`pnpm build`, here into app/www so the
 * web's dist/ stays as it is). Capacitor serves it from inside the app under
 * the site's own address (FRONTEND_ORIGIN's host), so logins, cookies,
 * passkeys and the APIs behave exactly like on the web; only the APIs are
 * reached over the internet. Each app gets its own branding (Gradle flavors,
 * app/android/app/src/<flavor>/) and an index.html that names the app
 * (<meta name="homesite-app">, read by src/lib/native.js).
 *
 *   pnpm app:build                 both apps: release APKs + AABs (Play Store), signed
 *   pnpm app:build -- --app cult   only one app (home | cult)
 *   pnpm app:build -- --debug      debug APKs only (quicker, inspectable, not for stores)
 *   pnpm app:build -- --install    also installs the APK(s) on a phone over adb
 *   pnpm app:build -- --skip-web   reuse app/www (no new website build)
 *   pnpm app:build -- --sync-only  only prepare app/android (no Gradle run)
 *
 * Needs JDK 21 and the Android SDK (ANDROID_HOME / JAVA_HOME, or the
 * defaults ~/Android/Sdk and ~/Android/jdk-21). The release signing key is
 * made on the first build in app/keys/ (never in git: back it up!). Output
 * in app/build/. Push needs app/google-services.json with both apps (docs/app.md).
 */
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = path.join(ROOT, "app");
const ANDROID = path.join(APP, "android");
const KEYS = path.join(APP, "keys");
const OUT = path.join(APP, "build");
// The apps' copy of the website build (the same `pnpm build`, only in another folder, so dist/ isn't touched).
const WWW = path.join(APP, "www");

const argv = process.argv.slice(2);
const args = new Set(argv);
const debug = args.has("--debug");
const only = argv.includes("--app") ? argv[argv.indexOf("--app") + 1] : "";

const settings = require("../config/settings.cjs");
const { parseEnv, setEnvValues } = require("../server/services/backup.cjs");
const ENV_FILE = path.join(ROOT, ".env");

const log = (message) => console.log(`\x1b[35m[app]\x1b[0m ${message}`);
const fail = (message) => {
  console.error(`\x1b[31m[app]\x1b[0m ${message}`);
  process.exit(1);
};
const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, { stdio: "inherit", cwd: ROOT, ...options });
  if (result.status !== 0) fail(`${command} ${commandArgs.join(" ")} failed (${result.status ?? result.signal}).`);
};

/* ---------- settings ---------- */

const readEnv = () => parseEnv(fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "");
let env = readEnv();
const value = (key) => settings.resolve(env, key) || settings.suggestions(env)[key] || "";
const saveEnv = (changes, comment) => {
  fs.writeFileSync(ENV_FILE, setEnvValues(fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "", changes, comment), { mode: 0o600 });
  env = readEnv();
};

let site;
try {
  site = new URL(settings.resolve(env, "FRONTEND_ORIGIN"));
} catch {
  fail("FRONTEND_ORIGIN is not set (pnpm setup:gui).");
}
if (site.protocol !== "https:") fail(`FRONTEND_ORIGIN must be an https address for the apps (now ${site.origin}).`);

const PACKAGE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const FLAVORS = [
  { key: "home", idKey: "APP_ID", nameKey: "APP_NAME", fallbackName: "HomeSite App" },
  { key: "cult", idKey: "CULT_APP_ID", nameKey: "CULT_APP_NAME", fallbackName: "CultSite App" },
].map((flavor) => {
  const id = value(flavor.idKey).toLowerCase();
  if (!PACKAGE.test(id)) fail(`${flavor.idKey} "${id}" is not a valid package name (e.g. com.example.${flavor.key}).`);
  if (!settings.resolve(env, flavor.idKey)) {
    // The server needs it too (the app's login address), so it is saved.
    saveEnv({ [flavor.idKey]: id }, "App IDs (pnpm app:build)");
    log(`${flavor.idKey} was empty: saved ${id} in .env (set it on the server too, the account API uses it for the app login).`);
  }
  return { ...flavor, id, name: value(flavor.nameKey) || flavor.fallbackName };
});
if (FLAVORS[0].id === FLAVORS[1].id) fail("APP_ID and CULT_APP_ID must be different.");
if (only && !FLAVORS.some((flavor) => flavor.key === only)) fail(`--app must be home or cult (not "${only}").`);
const building = FLAVORS.filter((flavor) => !only || flavor.key === only);
const capitalized = (text) => text[0].toUpperCase() + text.slice(1);

/* ---------- toolchain ---------- */

function findJava() {
  const candidates = [process.env.JAVA_HOME, path.join(os.homedir(), "Android", "jdk-21"), "/usr/lib/jvm/java-21-openjdk", "/usr/lib/jvm/default"].filter(Boolean);
  for (const home of candidates) {
    const java = path.join(home, "bin", "java");
    if (!fs.existsSync(java)) continue;
    const version = spawnSync(java, ["-version"], { encoding: "utf8" }).stderr;
    const major = Number(/version "(\d+)/.exec(version)?.[1]);
    if (major >= 21) return home;
  }
  return null;
}
function findSdk() {
  const candidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, path.join(os.homedir(), "Android", "Sdk")].filter(Boolean);
  return candidates.find((dir) => fs.existsSync(path.join(dir, "platforms"))) ?? null;
}

/* ---------- signing key (one for both apps) ---------- */

function keystore(javaHome) {
  const props = path.join(KEYS, "keystore.properties");
  if (!fs.existsSync(props)) {
    fs.mkdirSync(KEYS, { recursive: true, mode: 0o700 });
    const password = crypto.randomBytes(24).toString("base64url");
    log("No signing key yet: making app/keys/release.keystore (back up app/keys/, an app can only be updated with the same key).");
    execFileSync(path.join(javaHome, "bin", "keytool"), [
      "-genkeypair", "-noprompt", "-keystore", path.join(KEYS, "release.keystore"), "-storetype", "PKCS12",
      "-alias", "upload", "-keyalg", "RSA", "-keysize", "4096", "-validity", "36500",
      "-storepass", password, "-keypass", password, "-dname", `CN=${FLAVORS[0].name}`,
    ], { stdio: "ignore" });
    fs.writeFileSync(props, `storeFile=${path.join(KEYS, "release.keystore")}\nstorePassword=${password}\nkeyAlias=upload\nkeyPassword=${password}\n`, { mode: 0o600 });
  }
  const values = Object.fromEntries(fs.readFileSync(props, "utf8").split("\n").filter((line) => line.includes("=")).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
  const list = execFileSync(path.join(javaHome, "bin", "keytool"), ["-list", "-v", "-keystore", values.storeFile, "-alias", values.keyAlias, "-storepass", values.storePassword], { encoding: "utf8" });
  const fingerprint = /SHA256:\s*([0-9A-F:]{95})/.exec(list)?.[1];
  return { props, fingerprint };
}

/* ---------- Capacitor config + Gradle properties ---------- */

function writeCapacitorConfig() {
  const config = {
    // Capacitor's own id/name; the apps' real ones come from Gradle (homesite.properties).
    appId: FLAVORS[0].id,
    appName: FLAVORS[0].name,
    webDir: path.relative(ROOT, WWW),
    // The bundled site answers under the real site's host (same cookies, passkeys and CORS as the web).
    server: { hostname: site.hostname, androidScheme: "https", iosScheme: "capacitor" },
    android: { path: "app/android", allowMixedContent: false, captureInput: true, webContentsDebuggingEnabled: debug, backgroundColor: "#140a14" },
    ios: { path: "app/ios", contentInset: "never" },
    plugins: {
      SystemBars: { insetsHandling: "css", style: "DEFAULT" },
      SplashScreen: { launchShowDuration: 3000, launchAutoHide: false, launchFadeOutDuration: 200, showSpinner: false, androidScaleType: "CENTER_INSIDE" },
      PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
      CapacitorHttp: { enabled: false },
      CapacitorCookies: { enabled: false },
    },
  };
  fs.writeFileSync(path.join(ROOT, "capacitor.config.json"), `${JSON.stringify(config, null, 2)}\n`);
}

function writeGradleProperties(signing) {
  // Version: date + minutes, always growing (Play needs a higher versionCode for every upload).
  const now = new Date();
  const versionCode = Math.floor(now.getTime() / 60_000) - 28_000_000;
  let commit = "";
  try {
    commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    // not a git checkout
  }
  const versionName = `${now.getUTCFullYear()}.${now.getUTCMonth() + 1}.${now.getUTCDate()}${commit ? `+${commit}` : ""}`;
  const escape = (text) => text.replace(/\\/g, "\\\\");
  const lines = [
    "# Written by pnpm app:build (scripts/app-build.mjs) from .env. Don't edit, don't commit.",
    `appHost=${site.hostname}`,
    ...FLAVORS.flatMap((flavor) => [`${flavor.key}AppId=${flavor.id}`, `${flavor.key}Name=${escape(flavor.name)}`]),
    `versionCode=${versionCode}`,
    `versionName=${versionName}`,
    signing ? `signingProperties=${signing}` : "",
  ];
  fs.writeFileSync(path.join(ANDROID, "homesite.properties"), `${lines.filter(Boolean).join("\n")}\n`);
  return { versionCode, versionName };
}

/* Each app's index.html names the app (src/lib/native.js reads it before React starts). */
function writeFlavorPages() {
  const source = fs.readFileSync(path.join(WWW, "index.html"), "utf8");
  const attr = (text) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  for (const flavor of FLAVORS) {
    const meta = `<meta name="homesite-app" content="${flavor.key}" data-id="${attr(flavor.id)}" />`;
    const html = source.replace(/<head>/i, `<head>\n    ${meta}`).replace(/<title>[^<]*<\/title>/i, `<title>${attr(flavor.name)}</title>`);
    if (!html.includes(meta)) fail("Could not mark index.html for the app (no <head>).");
    const target = path.join(ANDROID, "app", "src", flavor.key, "assets", "public");
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "index.html"), html);
  }
}

/* ---------- build ---------- */

const javaHome = findJava();
const sdk = findSdk();
if (!args.has("--sync-only")) {
  if (!javaHome) fail("JDK 21 not found. Set JAVA_HOME (or unpack one to ~/Android/jdk-21).");
  if (!sdk) fail("Android SDK not found. Set ANDROID_HOME (or install it to ~/Android/Sdk).");
}

let signing = null;
if (!debug && javaHome) {
  signing = keystore(javaHome);
  if (signing.fingerprint) {
    const known = settings.resolve(env, "APP_CERT_FINGERPRINTS").toUpperCase();
    if (!known.includes(signing.fingerprint)) {
      saveEnv({ APP_CERT_FINGERPRINTS: [known, signing.fingerprint].filter(Boolean).join(",") }, "App signing key (pnpm app:build)");
      log("Added the signing key's fingerprint to APP_CERT_FINGERPRINTS (the site publishes it in /.well-known/assetlinks.json; deploy it).");
    }
  }
}

if (!args.has("--skip-web")) {
  log("Building the website (pnpm build into app/www) …");
  run("pnpm", ["run", "build"], { env: { ...process.env, BUILD_OUT_DIR: path.relative(ROOT, WWW) } });
}
if (!fs.existsSync(path.join(WWW, "index.html"))) fail("app/www is missing. Run without --skip-web.");

writeCapacitorConfig();
if (!fs.existsSync(path.join(ANDROID, "app", "build.gradle"))) fail("app/android is missing (it is part of the repository).");
const version = writeGradleProperties(signing?.props);

// Push: the Firebase project's config (optional, never in git). It must list both apps.
const googleServices = path.join(APP, "google-services.json");
const googleServicesTarget = path.join(ANDROID, "app", "google-services.json");
if (fs.existsSync(googleServices)) {
  let packages = [];
  try {
    packages = JSON.parse(fs.readFileSync(googleServices, "utf8")).client.map((client) => client.client_info.android_client_info.package_name);
  } catch {
    fail("app/google-services.json can't be read.");
  }
  const missing = FLAVORS.filter((flavor) => !packages.includes(flavor.id));
  if (missing.length) fail(`app/google-services.json has no Android app for ${missing.map((flavor) => flavor.id).join(" and ")}: add it in Firebase (Project settings → Your apps) and download the file again.`);
  fs.copyFileSync(googleServices, googleServicesTarget);
  log("Push: using app/google-services.json.");
} else {
  fs.rmSync(googleServicesTarget, { force: true });
  log("Push: no app/google-services.json, the apps build without push (docs/app.md).");
}

log("Copying the site into the apps (cap sync) …");
run("pnpm", ["exec", "cap", "sync", "android"]);
// The site's 404 helpers and the server rewrite list mean nothing inside the app.
for (const file of ["404.html", "serve.json"]) fs.rmSync(path.join(ANDROID, "app", "src", "main", "assets", "public", file), { force: true });
writeFlavorPages();

if (args.has("--sync-only")) {
  log("app/android is ready (open it in Android Studio, or run without --sync-only).");
  process.exit(0);
}

const gradleEnv = { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk };
const gradlew = path.join(ANDROID, process.platform === "win32" ? "gradlew.bat" : "gradlew");
const tasks = building.flatMap((flavor) => (debug ? [`assemble${capitalized(flavor.key)}Debug`] : [`assemble${capitalized(flavor.key)}Release`, `bundle${capitalized(flavor.key)}Release`]));
log(`Gradle: ${tasks.join(", ")} …`);
run(gradlew, [...tasks, "--console=plain"], { cwd: ANDROID, env: gradleEnv });

fs.mkdirSync(OUT, { recursive: true });
const outputs = [];
const copy = (from, name) => {
  if (!fs.existsSync(from)) return null;
  const target = path.join(OUT, name);
  fs.copyFileSync(from, target);
  outputs.push(target);
  return target;
};
const label = version.versionName.replace(/\+/g, "-");
const apks = [];
for (const flavor of building) {
  const slug = flavor.name.replace(/[^A-Za-z0-9]+/g, "") || flavor.key;
  const type = debug ? "debug" : "release";
  const apk = copy(path.join(ANDROID, "app", "build", "outputs", "apk", flavor.key, type, `app-${flavor.key}-${type}.apk`), `${slug}-${label}${debug ? "-debug" : ""}.apk`);
  if (apk) apks.push(apk);
  if (!debug) copy(path.join(ANDROID, "app", "build", "outputs", "bundle", `${flavor.key}Release`, `app-${flavor.key}-release.aab`), `${slug}-${label}.aab`);
}
if (!apks.length) fail("Gradle finished but no APK was found.");

log(`Done (version ${version.versionName}, code ${version.versionCode}):`);
for (const file of outputs) console.log(`  ${path.relative(ROOT, file)}  (${(fs.statSync(file).size / 1048576).toFixed(1)} MB)`);
if (signing?.fingerprint) console.log(`  Signing key SHA-256: ${signing.fingerprint}`);

if (args.has("--install")) {
  const adb = path.join(sdk, "platform-tools", "adb");
  for (const apk of apks) {
    log(`Installing ${path.basename(apk)} on the connected phone (adb) …`);
    run(fs.existsSync(adb) ? adb : "adb", ["install", "-r", apk]);
  }
}
