const crypto = require("node:crypto");
const rateLimit = require("express-rate-limit");

const { setting } = require("../config.cjs");
const { httpError } = require("./http.cjs");

/*
 * Push notifications (account API).
 *
 * Browsers the person turned push on in (Web Push with VAPID keys;
 * public/push-sw.js shows them).
 *
 * What gets pushed: every notify() of services/moderation.cjs, for the
 * categories where the person left "Push" on (settings.notify.<category>.push).
 *
 *   GET    /push/config          { web: <VAPID public key> | null }
 *   GET    /push/devices         the own devices (no tokens)
 *   POST   /push/devices         { kind: "web", token, keys, label? } add / refresh this browser
 *   DELETE /push/devices/:id     remove one of the own devices
 *   POST   /push/devices/remove  { token } remove this device by its token (logout, turning it off)
 *   POST   /push/test            a test notification to the own devices
 *
 * Settings: WEB_PUSH_PUBLIC_KEY / WEB_PUSH_PRIVATE_KEY (`pnpm push:setup`),
 * WEB_PUSH_CONTACT. Push switches off cleanly when the keys are empty.
 * Table push_devices (accounts.sqlite, in backups; deleted with the account).
 */

const MAX_DEVICES = 12;
const KINDS = new Set(["web"]);

const nowIso = () => new Date().toISOString();
const newId = () => crypto.randomBytes(8).toString("hex");

function route(handler) {
  return async (req, res) => {
    try {
      const result = await handler(req, res);
      if (!res.headersSent) res.json(result ?? { ok: true });
    } catch (error) {
      const status = error.status ?? 500;
      if (status >= 500 && !error.status) console.error("[Push]", error);
      if (!res.headersSent) res.status(status).json({ error: status >= 500 && !error.status ? "Something went wrong." : error.message });
    }
  };
}

/* ---------- Web Push ---------- */

let webPushLib = null;
function webPush() {
  const publicKey = setting("WEB_PUSH_PUBLIC_KEY");
  const privateKey = setting("WEB_PUSH_PRIVATE_KEY");
  if (!publicKey || !privateKey) return null;
  if (!webPushLib) {
    webPushLib = require("web-push");
    const contact = setting("WEB_PUSH_CONTACT") || (setting("PRIVACY_CONTACT_EMAIL") ? `mailto:${setting("PRIVACY_CONTACT_EMAIL")}` : setting("FRONTEND_ORIGIN"));
    try {
      webPushLib.setVapidDetails(contact || "mailto:admin@example.com", publicKey, privateKey);
    } catch (error) {
      console.warn("[Push] Web Push keys are invalid:", error.message);
      webPushLib = null;
      return null;
    }
  }
  return webPushLib;
}

/* ---------- the service ---------- */

function registerPush(app, { getRequestSession, getDatabase }) {
  let ready = false;
  const db = () => {
    const handle = getDatabase();
    if (!handle) throw httpError(503, "Accounts are not available.");
    if (!ready) {
      handle.exec(`
        CREATE TABLE IF NOT EXISTS push_devices (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          token TEXT NOT NULL UNIQUE,
          keys_json TEXT,
          label TEXT,
          created_at TEXT NOT NULL,
          last_seen_at TEXT,
          last_sent_at TEXT
        );
        CREATE INDEX IF NOT EXISTS push_devices_user_idx ON push_devices(user_id);
      `);
      // Devices of the former Android app (kind "fcm") can't be reached any more.
      handle.prepare("DELETE FROM push_devices WHERE kind <> 'web'").run();
      ready = true;
    }
    return handle;
  };

  const config = () => ({ web: webPush() ? setting("WEB_PUSH_PUBLIC_KEY") : null });
  const removeToken = (token) => db().prepare("DELETE FROM push_devices WHERE token = ?").run(token);
  const sessionOf = (req) => {
    const session = getRequestSession(req);
    if (!session) throw httpError(401, "Log in first.");
    return session;
  };

  /** Pushes one message to all of a person's devices. Never throws. */
  async function sendToUser(userId, message) {
    let devices;
    try {
      devices = db().prepare("SELECT id, kind, token, keys_json FROM push_devices WHERE user_id = ?").all(userId);
    } catch {
      return 0;
    }
    if (!devices.length) return 0;
    const web = webPush();
    let sent = 0;
    await Promise.all(
      devices.map(async (device) => {
        let result = "failed";
        try {
          if (device.kind === "web" && web) {
            const payload = JSON.stringify({ title: message.title, body: message.body || "", link: message.link || "", category: message.category || "", tag: message.tag || "" });
            await web.sendNotification({ endpoint: device.token, keys: JSON.parse(device.keys_json || "{}") }, payload, { TTL: 24 * 3600, urgency: "normal", topic: message.tag ? String(message.tag).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined : undefined });
            result = "ok";
          }
        } catch (error) {
          result = [404, 410].includes(error?.statusCode) ? "gone" : "failed";
          if (result === "failed") console.warn("[Push] Web Push failed:", error?.statusCode || error?.message);
        }
        try {
          if (result === "gone") removeToken(device.token);
          if (result === "ok") {
            db().prepare("UPDATE push_devices SET last_sent_at = ? WHERE id = ?").run(nowIso(), device.id);
            sent += 1;
          }
        } catch {
          // storage went away
        }
      }),
    );
    return sent;
  }

  const readLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false });
  const writeLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });
  const testLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 5, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many test notifications. Wait a few minutes." } });

  app.get("/push/config", readLimiter, route(() => config()));

  app.get(
    "/push/devices",
    readLimiter,
    route((req) => {
      const session = sessionOf(req);
      const devices = db()
        .prepare("SELECT id, kind, label, created_at AS createdAt, last_seen_at AS lastSeenAt, last_sent_at AS lastSentAt FROM push_devices WHERE user_id = ? ORDER BY created_at")
        .all(session.user_id);
      return { devices, ...config() };
    }),
  );

  app.post(
    "/push/devices",
    writeLimiter,
    route((req) => {
      const session = sessionOf(req);
      const kind = String(req.body?.kind ?? "");
      const token = String(req.body?.token ?? "").trim();
      // eslint-disable-next-line no-control-regex
      const label = String(req.body?.label ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 60) || null;
      if (!KINDS.has(kind)) throw httpError(400, "Unknown device kind.");
      if (kind === "web" && !webPush()) throw httpError(503, "Push in the browser is not set up on this server.");
      // Only real push services, so the server never posts to an address someone made up.
      let endpoint;
      try {
        endpoint = new URL(token);
      } catch {
        throw httpError(400, "Invalid push subscription.");
      }
      if (endpoint.protocol !== "https:" || token.length > 1000) throw httpError(400, "Invalid push subscription.");
      const p256dh = String(req.body?.keys?.p256dh ?? "");
      const auth = String(req.body?.keys?.auth ?? "");
      if (!/^[A-Za-z0-9_-]{80,100}={0,2}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}={0,2}$/.test(auth)) throw httpError(400, "Invalid push subscription.");
      const keys = JSON.stringify({ p256dh, auth });

      const handle = db();
      const existing = handle.prepare("SELECT id, user_id FROM push_devices WHERE token = ?").get(token);
      if (existing) {
        // The same device, maybe someone else logged in on it now: it belongs to whoever registers it.
        handle.prepare("UPDATE push_devices SET user_id = ?, kind = ?, keys_json = ?, label = COALESCE(?, label), last_seen_at = ? WHERE id = ?").run(session.user_id, kind, keys, label, nowIso(), existing.id);
        return { ok: true, id: existing.id };
      }
      const count = handle.prepare("SELECT COUNT(*) AS c FROM push_devices WHERE user_id = ?").get(session.user_id).c;
      if (count >= MAX_DEVICES) {
        // The device not seen for the longest makes room.
        handle.prepare("DELETE FROM push_devices WHERE id = (SELECT id FROM push_devices WHERE user_id = ? ORDER BY COALESCE(last_seen_at, created_at) LIMIT 1)").run(session.user_id);
      }
      const id = newId();
      handle.prepare("INSERT INTO push_devices (id, user_id, kind, token, keys_json, label, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, session.user_id, kind, token, keys, label, nowIso(), nowIso());
      return { ok: true, id };
    }),
  );

  app.delete(
    "/push/devices/:id",
    writeLimiter,
    route((req) => {
      const session = sessionOf(req);
      const result = db().prepare("DELETE FROM push_devices WHERE id = ? AND user_id = ?").run(String(req.params.id), session.user_id);
      if (!result.changes) throw httpError(404, "No such device.");
      return { ok: true };
    }),
  );

  // By token, without a login check: whoever holds the token is that device (logging out turns it off).
  app.post(
    "/push/devices/remove",
    writeLimiter,
    route((req) => {
      const token = String(req.body?.token ?? "").trim();
      if (!token || token.length > 4096) throw httpError(400, "Missing token.");
      removeToken(token);
      return { ok: true };
    }),
  );

  app.post(
    "/push/test",
    testLimiter,
    route(async (req) => {
      const session = sessionOf(req);
      const language = (() => {
        try {
          return JSON.parse(session.settings_json || "{}").language;
        } catch {
          return "";
        }
      })();
      const german = String(language || "").startsWith("de");
      const sent = await sendToUser(session.user_id, {
        title: german ? "Benachrichtigungen funktionieren" : "Notifications work",
        body: german ? "So sehen Push-Benachrichtigungen von HomeSite aus." : "This is how push notifications from HomeSite look.",
        link: "/settings/notifications",
        category: "general",
        tag: "test",
      });
      if (!sent) throw httpError(409, "No device got it. Turn push on for this device first.");
      return { ok: true, sent };
    }),
  );

  return { sendToUser, config };
}

module.exports = { registerPush };
