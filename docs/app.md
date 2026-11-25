# The apps: HomeSite App and CultSite App (Android, later iOS)

The apps are the website. `pnpm app:build` runs the normal website build (into
`app/www`, so the web's `dist/` stays untouched) and puts it into two
[Capacitor](https://capacitorjs.com) apps:

| App | Setting (ID / name) | Default name | Shows | Starts on |
| --- | --- | --- | --- | --- |
| HomeSite | `APP_ID` / `APP_NAME` | HomeSite App | every page except /cult: home, /card, /about, /dash, /maps, the hub … | `/` |
| Cult of black Cats | `CULT_APP_ID` / `CULT_APP_NAME` | CultSite App | /cult and everything under it | `/cult` |

Both apps show the account pages (`/settings`, `/cult/notifications`,
`/privacy`), because each needs login and push. In the HomeSite app they
wear HomeSite's look (`CultShell` checks `appBrand`). A link to the other app's
pages opens the other app if it is installed, otherwise the browser. Inside the
apps they never show each other's content. The web is unchanged: one site with
everything.

Inside each app, Capacitor serves the files under the site's own address (the
host of `FRONTEND_ORIGIN`, e.g. `https://home.example.com`). For the browser
engine the pages *are* the website, so these all work exactly as on the web,
without any app-specific code on the servers:

- login cookies (`AUTH_COOKIE_DOMAIN`), the hub cookie, CORS and the CSRF checks
- passkeys (the relying party is the site's host)
- the account API, the profile API, the hub terminal WebSocket and the live feed

Only the APIs go over the internet. The pages, fonts, emoji and images are inside
the apps.

**Login in both apps:** each app has its own login (Android keeps every app's
cookies separate). Logging in to one doesn't log in the other.

## What the apps do differently (`src/lib/native.js`)

| Topic | Web | Apps |
| --- | --- | --- |
| Which app | (none) | `<meta name="homesite-app" content="home\|cult" data-id="<package>">` in each app's `index.html` (written by the build into `app/android/app/src/<flavor>/assets/public/`) |
| Discord login | the page goes to Discord and back | Discord opens in the system browser (RFC 8252). The account API sends a one-time code to `<package>://login`, and the app trades it with its PKCE verifier (`POST /auth/app/exchange`) for the normal login cookie. |
| Links to other sites | new tab / same tab | a browser tab (Custom Tab) |
| The site's own links | normal | this app's pages stay inside it (also `target="_blank"`, links from other apps, notification taps); the other app's pages go to that app or the browser (`pageOwner`, `openOtherApp`) |
| Downloads (backups, pictures, settings) | the browser's download | Android's "Save as" dialog (pick a folder, e.g. Downloads); the share sheet as a fallback / on iOS |
| Back button | the browser's | closes an open dialog first, then goes back (React Router's `history.state.idx`; the WebView's own `canGoBack` misses the page's history), then minimises the app |
| System bars | the browser's | coloured like the page (top = `--bg-secondary`, bottom = `--bg-primary`), with light or dark icons to match |
| Push notifications | Web Push (`public/push-sw.js`) | Firebase Cloud Messaging |

Native code is in `app/android/app/src/main/java/org/homesite/app/`. `MainActivity`
turns on edge-to-edge and passkeys. `HomeSitePlugin` is the site's own small
bridge:

- `info`: push / version / app
- `setBars`
- `openUrl`: hands a link to Android, so the other app opens it
- `saveFile`: the "Save as" dialog

Branding lives per app in `app/android/app/src/home/` and `app/android/app/src/cult/`:

- `res/`: icons, splash, notification icon, colours in `values/brand.xml`
- `AndroidManifest.xml`: which of the site's links open that app; keep it in
  step with `pageOwner` in `native.js`

The sources of the icons, plus 512px PNGs for the stores, are in `app/branding/`.
The Cult icon is the server's cat (`public/hehehe/general-icon`), traced as a
vector.

## Building

Needs **JDK 21** and the **Android SDK** (platform 36 and build tools). It finds
them through `JAVA_HOME` / `ANDROID_HOME`, or in `~/Android/jdk-21` and
`~/Android/Sdk`.

```bash
pnpm app:build                   # both apps: signed release APKs + AABs in app/build/
pnpm app:build -- --app cult     # only one (home | cult)
pnpm app:build -- --debug        # debug APKs (quicker, can be inspected with chrome://inspect)
pnpm app:build -- --install      # also installs them on the phone connected over adb
pnpm app:build -- --skip-web     # reuse app/www instead of building the site again
pnpm app:build -- --sync-only    # only prepare app/android (then open it in Android Studio)
```

Everything owner-specific comes from `.env` through `config/settings.cjs` (section
"Website", feature "Android / iOS apps"):

- `APP_ID` / `CULT_APP_ID`: the package names. They are also the login addresses
  `<id>://login`. If they are empty, the build fills them in from the site's host
  (`org.example.home` / `org.example.cult`) and saves them. **Never change them
  once an app is in a store.**
- `APP_NAME` / `CULT_APP_NAME`: the names under the icons (HomeSite App /
  CultSite App).
- `APP_CERT_FINGERPRINTS`: SHA-256 fingerprints of the signing keys. The site
  publishes them in `/.well-known/assetlinks.json` for both packages
  (`scripts/app-links.cjs`, part of `pnpm build`). The build adds the local key's
  fingerprint automatically.
- `APP_TEAM_ID`: for iOS later (`apple-app-site-association`, also split /cult
  vs the rest).

The build writes these generated files, which are not in git:

- `capacitor.config.json`
- `app/android/homesite.properties`: package names, names, host, version and the
  signing file for Gradle
- `app/www/`: the site build
- `app/android/app/src/*/assets/`: each app's `index.html`

The version is the date plus the commit (`2026.11.17+abc1234`). The version code
is the number of minutes since a fixed point, so every build is higher than the
one before (Play needs that).

### The signing key, back it up

The first release build creates `app/keys/release.keystore` and
`app/keys/keystore.properties` (random password). Both apps are signed with it.
An installed app can only be updated by an APK signed with the **same key**, so
copy `app/keys/` somewhere safe. It is never in git and not in the site's
backups. With Google Play App Signing (the default for new apps), this key is
only the *upload key* and Google can reset it. Without Play, losing it means
everyone has to reinstall.

## Servers: what has to be set

On the server that runs the account API (its `.env`), then restart the API:

1. `APP_ID` and `CULT_APP_ID`: the same values as in the build. Without them,
   `/auth/discord?app=…&scheme=…` answers "App login is not set up", and Discord
   login in that app does not work.
2. Deploy the website once after the first app build, so
   `https://<site>/.well-known/assetlinks.json` lists both packages with the key.
   Otherwise links don't open the apps (they go to the browser), and passkeys
   can't be used in them. Check: `curl https://<site>/.well-known/assetlinks.json`.
3. Push:
   - Browser: `pnpm push:setup` writes `WEB_PUSH_PUBLIC_KEY` / `WEB_PUSH_PRIVATE_KEY`.
     Run it **on the server**, or copy both values over; they must be the same
     everywhere the account API runs.
   - Apps: see below.
   - `pnpm push:setup -- --check` shows what is ready.

## Push notifications

Every notification of the site (`services/moderation.cjs` `notify()`: about
your account, your cat designs, birthdays, reports for staff) can also be
pushed. In **Settings → Notifications**, everyone:

- turns push on per device: this browser, the HomeSite app, the CultSite app;
- picks "Push" per kind, next to "On the site" and "By email";
- sees and removes their devices.

Logging out turns push off on that device. Devices live in the `push_devices`
table (`accounts.sqlite`). It is in backups and is deleted with the account.
Dead tokens are removed when a push service reports them gone.

### Push in the apps (Firebase), once

1. Go to [console.firebase.google.com](https://console.firebase.google.com/) and
   add a project (no Analytics needed).
2. Add **two Android apps** to it, with the package names `APP_ID` and
   `CULT_APP_ID`. Download `google-services.json` after adding both: it lists
   both. Put it in **`app/google-services.json`** (never in git). The build
   checks that both apps are in it. Without the file the apps still build, and
   Settings says "This build of the app has no push notifications".
3. In Project settings → Service accounts → "Generate new private key", download
   the JSON. Put it into the server's `.env` as `FCM_SERVICE_ACCOUNT`, either the
   whole JSON on one line or as base64 (`base64 -w0 key.json`). Then restart the
   account API.

Each app makes one Android notification channel per kind (General, About my
account, My cat designs, Birthdays, New reports), so people can also tune them
in Android's settings.

## Google Play

1. Make a [Play Console](https://play.google.com/console) developer account
   (one-time fee, identity check).
2. Create **two apps** and upload `app/build/HomeSiteApp-<version>.aab` and
   `app/build/CultSiteApp-<version>.aab`, to internal testing first. Play App
   Signing is on by default. The store icons are in `app/branding/*-512.png`.
3. After the upload, Play shows **its** signing key's SHA-256 for each app
   (Setup → App signing). Add both to `APP_CERT_FINGERPRINTS` (comma-separated,
   keep the local one) and deploy the site, so links and passkeys also work in
   the Play versions.
4. The store listing needs:
   - a privacy policy URL: `/privacy` describes what is stored;
   - the data safety form: account data (Discord ID, name, avatar), optional
     email, push tokens, nothing sold, nothing for ads;
   - screenshots;
   - content rating.
5. Every new upload needs a higher version code. `pnpm app:build` takes care of
   that.

## iOS / App Store (later)

The same idea works on iOS. It needs a Mac with Xcode and an Apple Developer
account. The steps:

1. On the Mac: `pnpm exec cap add ios` (it creates `app/ios`; the path is already
   in `capacitor.config.json`). Make two targets (HomeSite, Cult) like the Android
   flavors: each has its own bundle ID, icon, and an `index.html` with the
   `homesite-app` meta.
2. Set `APP_TEAM_ID`. The site then serves
   `/.well-known/apple-app-site-association`: /cult for the Cult app, the rest for
   HomeSite.
3. In Xcode, add the capabilities:
   - Associated Domains (`applinks:<host>`, `webcredentials:<host>`)
   - Push Notifications
   - the URL scheme = the bundle ID (Info → URL Types), for the Discord login
4. Push: add both iOS apps to the Firebase project, put each
   `GoogleService-Info.plist` into its target, and upload an APNs key in Firebase.
5. **Difference to Android:** WKWebView can't serve the files under `https://<host>`,
   so the app's origin is `capacitor://<host>`. That means three changes:
   - add `capacitor://<host>` to the account API's and profile API's allowed
     origins;
   - log in through Capacitor's native HTTP (`CapacitorHttp` / `CapacitorCookies`),
     or a bearer token, because Safari blocks cross-site cookies;
   - passkeys need the associated domain.

   Plan this before submitting; Android doesn't have these issues.

## Testing

- Install: `pnpm app:build -- --debug --install`, or copy an APK to the phone
  and open it (allow "install unknown apps" once).
- Inspect: with a debug build, `chrome://inspect` on the computer shows the
  apps' WebViews (USB debugging on).
- Emulator (no phone needed):
  - `~/Android/Sdk/emulator/emulator -avd homesite -no-window -gpu host`; the
    software GPU modes crash when the WebView draws.
  - Before assetlinks is live, app links can be approved by hand:
    `adb shell pm set-app-links --package <id> 2 <host>`.
- Things to check after changes:
  - Discord login in both apps, email login, passkeys
  - /hub (terminal)
  - downloads (Save as)
  - push: Settings → Notifications → Send a test
  - links between the two apps, and from a chat app
  - the back button
  - light and dark theme bars
