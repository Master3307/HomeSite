const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { setting } = require("../config.cjs");
const { getInternalKey } = require("./internalKey.cjs");

/*
 * The look of every email the site sends: a tiny, nearly static page of the
 * cult (its colours, the seasonal logo), in the member's language and theme,
 * with their accent colour and their own custom CSS (like on the site:
 * Settings → Custom CSS; if it breaks the email, that's on them).
 *
 * Themes: "light" / "dark" are drawn that way and tell mail apps so
 * (color-scheme), "system" (and people without an account) follow the mail
 * app's light / dark mode (prefers-color-scheme, plus Outlook's [data-ogsc]).
 *
 * Texts: src/locales/<language>/email.json (English as the fallback), like
 * the site's other translations.
 *
 * Notification emails carry List-Unsubscribe (+ one-click, RFC 8058) with a
 * signed link (`unsubscribeToken`); security emails can't be turned off.
 */

const LOCALES = path.join(__dirname, "..", "..", "src", "locales");
const cache = new Map();

function strings(language) {
  if (!cache.has(language)) {
    let value = null;
    try {
      value = JSON.parse(fs.readFileSync(path.join(LOCALES, language, "email.json"), "utf8"));
    } catch {
      value = null;
    }
    cache.set(language, value);
  }
  return cache.get(language);
}

/** `t("a.b", { name })` in `language`, falling back to English, then the key. */
function translator(language) {
  const lookup = (table, key) => key.split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), table);
  return (key, values = {}) => {
    const text = lookup(strings(language), key) ?? lookup(strings("en"), key) ?? key;
    return String(text).replace(/\{\{(\w+)\}\}/g, (_, name) => (values[name] === undefined ? "" : String(values[name])));
  };
}

const languages = () => {
  try {
    return fs.readdirSync(LOCALES).filter((entry) => fs.existsSync(path.join(LOCALES, entry, "email.json")) || fs.existsSync(path.join(LOCALES, entry, "common.json")));
  } catch {
    return ["en"];
  }
};

const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/* ---------- who it is for ---------- */

/** Language, theme, accent, custom CSS and name of an account row (users table). */
function prefsOf(user) {
  let settings = {};
  try {
    settings = JSON.parse(user?.settings_json || "{}");
  } catch {
    settings = {};
  }
  const language = languages().includes(settings.language) ? settings.language : "en";
  const theme = ["light", "dark", "system"].includes(settings.theme) ? settings.theme : "system";
  const accent = /^#[0-9a-f]{6}$/i.test(String(settings.accent ?? "")) ? settings.accent.toLowerCase() : null;
  const customCss = settings.customCssEnabled !== false && typeof settings.customCss === "string" ? settings.customCss.slice(0, 20_000) : "";
  return { language, theme, accent, customCss, name: user?.display_name || user?.username || null };
}

/* ---------- colours: exactly /cult's (src/styles/cult.css, discord-widget.css) ---------- */

/*
 * The page is the site's background: --bg-secondary at the top to
 * --bg-primary at 80% (main.css body::before). The card is the site's card
 * (the Discord server card): --bg-secondary at 55% over the page, a border
 * and wells of --text-primary at 12% / 6%, 18px corners, the same shadow.
 * The accent is the cult red: /cult uses it even when a member picked
 * their own colour. `*Solid` are the same colours mixed for mail apps
 * without gradients or transparency (classic Outlook).
 */
const PALETTES = {
  light: {
    pageTop: "#f4ebe6",
    pageBottom: "#c79c95",
    pageSolid: "#e2cbc6",
    card: "rgba(244,235,230,0.55)",
    cardSolid: "#f0e4df",
    line: "rgba(44,22,24,0.12)",
    lineSolid: "#d8cbc7",
    raised: "rgba(44,22,24,0.06)",
    raisedSolid: "#e4d8d3",
    text: "#2c1618",
    muted: "#73504f",
    accent: "#b60b0b",
    accentDeep: "#610000",
    accentText: "#ffffff",
    shadow: "0 18px 40px rgba(0,0,0,0.22)",
  },
  dark: {
    pageTop: "#1a0b0b",
    pageBottom: "#470404",
    pageSolid: "#2c0808",
    card: "rgba(26,11,11,0.55)",
    cardSolid: "#1e0b0b",
    line: "rgba(238,238,238,0.12)",
    lineSolid: "#372626",
    raised: "rgba(238,238,238,0.06)",
    raisedSolid: "#2a1919",
    text: "#eeeeee",
    muted: "#c0bfe6",
    accent: "#b60b0b",
    accentDeep: "#610000",
    accentText: "#ffffff",
    shadow: "0 18px 40px rgba(0,0,0,0.22)",
  },
};

function palette(theme) {
  return theme === "dark" ? { main: PALETTES.dark, other: PALETTES.light } : { main: PALETTES.light, other: PALETTES.dark };
}

/** The site's page gradient on its solid fallback colour. */
const pageBackground = (colors) => `background-color:${colors.pageSolid};background-image:linear-gradient(180deg,${colors.pageTop} 0%,${colors.pageBottom} 80%)`;

/** A colour with transparency on its solid fallback (both are written; apps keep the last one they understand). */
const layered = (solid, alpha) => `background:${solid};background-color:${alpha}`;

/* ---------- links ---------- */

const siteOrigin = () => (setting("FRONTEND_ORIGIN") || "").replace(/\/+$/, "");
const apiOrigin = () => (setting("ACCOUNT_API_ORIGIN") || siteOrigin()).replace(/\/+$/, "");

const tokenKey = () => crypto.createHash("sha256").update(`homesite-unsubscribe:${getInternalKey() || setting("SESSION_SECRET") || ""}`).digest();

/** A signed, never-expiring token for "stop these emails" (user id + category). */
function unsubscribeToken(userId, category) {
  return crypto.createHmac("sha256", tokenKey()).update(`${userId}:${category}`).digest("base64url").slice(0, 32);
}

function checkUnsubscribe(userId, category, token) {
  const expected = Buffer.from(unsubscribeToken(String(userId), String(category)));
  const given = Buffer.from(String(token ?? ""));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

function unsubscribeUrl(userId, category) {
  const query = new URLSearchParams({ u: userId, c: category, t: unsubscribeToken(userId, category) });
  return `${apiOrigin()}/email/unsubscribe?${query}`;
}

/* ---------- the page ---------- */

/** A safe <style> body from the member's own CSS (no way out of the element). */
const safeCss = (css) => String(css ?? "").replace(/</g, "\\3c ");

/* The seasonal logo, sent inside the email (cid:), so it shows even when mail apps block outside images. */
const LOGO_CID = "logo@homesite";
function seasonLogo(date = new Date()) {
  const today = `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  let code = "general";
  try {
    // The same schedule as the site (shared/seasons.json).
    const seasons = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "shared", "seasons.json"), "utf8"));
    code = seasons.find(({ from, to }) => (from <= to ? today >= from && today <= to : today >= from || today <= to))?.code ?? "general";
  } catch {
    // general look
  }
  // The site's server icon (a dark tile, the same in light and dark), as PNG for mail apps.
  const file = path.join(__dirname, "..", "..", "public", "hehehe", `${code}-icon.png`);
  return fs.existsSync(file) ? { src: `cid:${LOGO_CID}`, attachment: { filename: "icon.png", path: file, cid: LOGO_CID } } : { src: `${siteOrigin()}/hehehe/${code}-icon.webp`, attachment: null };
}

/**
 * Renders an email. `blocks`: [{ text } | { code } | { button: { label, url } } | { note } | { quote }].
 * Returns `{ subject, html, text, headers }`.
 */
function render({ user = null, language: forcedLanguage, theme: forcedTheme, subject, title, blocks = [], category = null, security = false }) {
  const prefs = prefsOf(user);
  const language = forcedLanguage ?? prefs.language;
  const theme = forcedTheme ?? prefs.theme;
  const t = translator(language);
  const { main, other } = palette(theme);
  const followsApp = theme === "system";
  const site = siteOrigin();
  const brand = t("brand");
  const unsubscribe = user && category ? unsubscribeUrl(user.id, category) : null;
  const greeting = prefs.name ? t("greeting", { name: prefs.name }) : t("greetingAnon");
  const logo = seasonLogo();

  const textParts = [greeting, ""];
  const htmlBlocks = blocks
    .map((block) => {
      if (block.text) {
        textParts.push(block.text, "");
        return `<p class="email-text" style="margin:0 0 16px;font-size:16px;line-height:1.55;color:${main.text}">${escape(block.text).replace(/\n/g, "<br>")}</p>`;
      }
      if (block.quote) {
        textParts.push(`> ${block.quote}`, "");
        return `<p class="email-quote" style="margin:0 0 16px;padding:10px 14px;border-left:3px solid ${main.accent};${layered(main.raisedSolid, main.raised)};border-radius:12px;font-size:15px;line-height:1.5;color:${main.text}">${escape(block.quote).replace(/\n/g, "<br>")}</p>`;
      }
      if (block.code) {
        textParts.push(`    ${block.code}`, "");
        return `<table role="presentation" class="email-code" cellpadding="0" cellspacing="0" style="margin:6px 0 20px"><tr><td bgcolor="${main.raisedSolid}" style="padding:14px 24px;border-radius:12px;${layered(main.raisedSolid, main.raised)};border:1px solid ${main.line};font-family:'JetBrains Mono','SFMono-Regular',Menlo,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:${main.text}" aria-label="${escape(t("code.copy"))}">${escape(block.code)}</td></tr></table>`;
      }
      if (block.button) {
        textParts.push(`${block.button.label}: ${block.button.url}`, "");
        return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 20px"><tr><td class="email-button" bgcolor="${main.accent}" style="border-radius:12px;background-color:${main.accent};background-image:linear-gradient(135deg,${main.accent},${main.accentDeep})"><a href="${escape(block.button.url)}" style="display:inline-block;padding:12px 20px;border-radius:12px;font-size:15px;font-weight:650;color:${main.accentText};text-decoration:none">${escape(block.button.label)}</a></td></tr></table>`;
      }
      if (block.note) {
        textParts.push(block.note, "");
        return `<p class="email-note" style="margin:0 0 14px;font-size:13px;line-height:1.5;color:${main.muted}">${escape(block.note).replace(/\n/g, "<br>")}</p>`;
      }
      return "";
    })
    .join("\n");

  const footerLines = [
    security ? escape(t("footer.security")) : category ? escape(t("footer.why")) : "",
    [
      site ? `<a href="${escape(site)}/cult/settings#notifications" style="color:${main.muted}">${escape(t("footer.settings"))}</a>` : "",
      unsubscribe ? `<a href="${escape(unsubscribe)}" style="color:${main.muted}">${escape(t("footer.unsubscribe"))}</a>` : "",
    ]
      .filter(Boolean)
      .join(" &nbsp;·&nbsp; "),
    escape(t("footer.sent", { site: site.replace(/^https?:\/\//, "") || brand })),
  ].filter(Boolean);

  textParts.push("—", ...(security ? [t("footer.security")] : category ? [t("footer.why")] : []));
  if (site) textParts.push(`${t("footer.settings")}: ${site}/cult/settings#notifications`);
  if (unsubscribe) textParts.push(`${t("footer.unsubscribe")}: ${unsubscribe}`);

  // The mail app's own dark / light mode, for people on "system".
  const appMode = followsApp
    ? `
@media (prefers-color-scheme: dark) {
  .email-page { background-color: ${other.pageSolid} !important; background-image: linear-gradient(180deg, ${other.pageTop} 0%, ${other.pageBottom} 80%) !important; }
  body { background-color: ${other.pageBottom} !important; background-image: linear-gradient(180deg, ${other.pageTop} 0%, ${other.pageBottom} 80%) !important; }
  .email-card { background-color: ${other.card} !important; border-color: ${other.line} !important; }
  .email-text, .email-title, .email-brand, .email-quote, .email-code td { color: ${other.text} !important; }
  .email-note, .email-footer, .email-footer a, .email-kicker { color: ${other.muted} !important; }
  .email-code td, .email-quote { background-color: ${other.raised} !important; border-color: ${other.line} !important; }
}
[data-ogsc] .email-page { background: ${other.pageSolid} !important; }
[data-ogsc] .email-card { background: ${other.cardSolid} !important; }
[data-ogsc] .email-text, [data-ogsc] .email-title, [data-ogsc] .email-brand { color: ${other.text} !important; }`
    : "";

  const html = `<!doctype html>
<html lang="${escape(language)}" data-theme="${escape(theme)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="${followsApp ? "light dark" : theme}">
<meta name="supported-color-schemes" content="${followsApp ? "light dark" : theme}">
<title>${escape(subject)}</title>
<style>
:root { color-scheme: ${followsApp ? "light dark" : theme}; supported-color-schemes: ${followsApp ? "light dark" : theme}; }
body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; }
a { color: ${main.accent}; }
@media (max-width: 600px) { .email-inner { padding: 20px 18px 4px !important; } }${appMode}
</style>
${prefs.customCss ? `<style data-custom-css>\n${safeCss(prefs.customCss)}\n</style>` : ""}
</head>
<body class="cult-page email" style="margin:0;padding:0;background-color:${main.pageBottom};background-image:linear-gradient(180deg,${main.pageTop} 0%,${main.pageBottom} 80%);background-repeat:no-repeat">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escape(title)}</div>
<table role="presentation" class="email-page" width="100%" cellpadding="0" cellspacing="0" bgcolor="${main.pageSolid}" style="${pageBackground(main)};font-family:'Google Sans Flex','Google Sans','Segoe UI',system-ui,-apple-system,sans-serif">
<tr><td align="center" style="padding:32px 12px 40px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td class="email-card" bgcolor="${main.cardSolid}" style="${layered(main.cardSolid, main.card)};border:1px solid ${main.line};border-radius:18px;box-shadow:${main.shadow}">
      <div class="email-inner" style="padding:22px 22px 6px">
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px"><tr>
          <td style="padding-right:14px"><img src="${escape(logo.src)}" width="56" height="56" alt="" style="display:block;width:56px;height:56px;border-radius:16px"></td>
          <td>
            <div class="email-kicker" style="font-size:12px;font-weight:700;color:${main.muted}">${escape(t("kicker"))}</div>
            <div class="email-brand" style="font-size:19px;font-weight:700;line-height:1.3;color:${main.text}">${escape(brand)}</div>
          </td>
        </tr></table>
        <h1 class="email-title" style="margin:0 0 16px;font-size:26px;line-height:1.2;font-weight:800;letter-spacing:-0.01em;color:${main.text}">${escape(title)}</h1>
        <p class="email-text" style="margin:0 0 16px;font-size:16px;line-height:1.55;color:${main.text}">${escape(greeting)}</p>
        ${htmlBlocks}
      </div>
    </td></tr>
    <tr><td class="email-footer" style="padding:16px 10px 0;font-size:12px;line-height:1.6;color:${main.muted};text-align:center">
      ${footerLines.join("<br>")}
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;

  const headers = {};
  if (unsubscribe) {
    headers["List-Unsubscribe"] = `<${unsubscribe}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  return { subject, html, text: textParts.join("\n"), headers, attachments: logo.attachment ? [logo.attachment] : [] };
}

module.exports = { render, translator, prefsOf, checkUnsubscribe, unsubscribeToken, siteOrigin, languages };
