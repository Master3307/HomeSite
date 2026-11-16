const express = require("express");
const rateLimit = require("express-rate-limit");

const template = require("./mailTemplate.cjs");

/*
 * "Stop these emails" from a notification email (mailTemplate.cjs signs
 * the link: user id + category, HMAC with the server's secret).
 *
 *   GET  /email/unsubscribe?u&c&t   a tiny page asking to confirm
 *   POST /email/unsubscribe?u&c&t   turns the emails off (the page's button,
 *                                   or the mail app's one-click, RFC 8058)
 *
 * Only `settings.notify[category].email` changes (all categories for
 * "all"); site notifications stay. The token is the only authority, so the
 * route skips the Origin / CSRF check (account-api.cjs) and needs no login.
 */

const CATEGORIES = ["moderation", "reports", "fdc", "birthdays"];

function registerEmailUnsubscribe(app, { getDatabase, activity = null }) {
  const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false });
  const form = express.urlencoded({ extended: false, limit: "4kb" });

  function lookup(req) {
    const userId = String(req.query.u ?? "");
    const category = String(req.query.c ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(userId) || !(category === "all" || CATEGORIES.includes(category))) return null;
    if (!template.checkUnsubscribe(userId, category, req.query.t)) return null;
    const user = getDatabase()?.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    return user ? { user, category } : null;
  }

  function page(res, user, { title, text, button = null, status = 200 }) {
    const { language, theme } = template.prefsOf(user);
    const message = template.render({ user, language, theme, subject: title, title, blocks: [{ text }] });
    // The email's look, with a form instead of links (a real page this time).
    let html = message.html;
    if (button) {
      html = html.replace(
        "</div>\n    </td></tr>",
        `<form method="post" style="margin:0 0 18px"><button type="submit" style="padding:12px 22px;border:0;border-radius:13px;background:#b60b0b;color:#fff;font:inherit;font-size:15px;font-weight:700;cursor:pointer">${button}</button></form></div>\n    </td></tr>`,
      );
    }
    res.status(status).set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" });
    res.send(html);
  }

  app.get("/email/unsubscribe", limiter, (req, res) => {
    const found = lookup(req);
    if (!found) return page(res, null, { title: template.translator("en")("unsubscribe.title"), text: template.translator("en")("unsubscribe.invalid"), status: 404 });
    const t = template.translator(template.prefsOf(found.user).language);
    return page(res, found.user, {
      title: t("unsubscribe.title"),
      text: t("unsubscribe.question", { category: t(`categories.${found.category}`) }),
      button: t("unsubscribe.button"),
    });
  });

  app.post("/email/unsubscribe", limiter, form, (req, res) => {
    const found = lookup(req);
    if (!found) return res.status(404).type("text/plain").send("This link doesn't work any more.");
    const { user, category } = found;
    let settings = {};
    try {
      settings = JSON.parse(user.settings_json || "{}");
    } catch {
      settings = {};
    }
    const notify = { ...(settings.notify ?? {}) };
    for (const name of category === "all" ? CATEGORIES : [category]) notify[name] = { site: notify[name]?.site !== false, email: false };
    // Stamped now: the account's settings win over an older copy in a browser.
    settings = { ...settings, notify, _at: Date.now() };
    getDatabase().prepare("UPDATE users SET settings_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(settings), new Date().toISOString(), user.id);
    activity?.append({ actor: { discordId: user.discord_user_id, name: user.display_name || user.username }, level: "detail", action: "email-unsubscribe", summary: `turned off emails about ${category === "all" ? "everything" : category}` });
    // One-click from the mail app: a plain 200 is all it wants.
    if (String(req.body?.["List-Unsubscribe"] ?? "") === "One-Click") return res.status(200).type("text/plain").send("Unsubscribed.");
    const t = template.translator(template.prefsOf(user).language);
    return page(res, user, { title: t("unsubscribe.title"), text: t("unsubscribe.done") });
  });
}

module.exports = { registerEmailUnsubscribe };
