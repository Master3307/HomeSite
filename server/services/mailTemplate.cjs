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

/* ---------- colours (src/styles/cult.css) ---------- */

const mix = (a, b, weight) => {
  const parse = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  const [x, y] = [parse(a), parse(b)];
  return `#${x.map((value, index) => Math.round(value * weight + y[index] * (1 - weight)).toString(16).padStart(2, "0")).join("")}`;
};

/*
 * The page is the same dusk as /cult (src/styles/cult.css: --bg-secondary at
 * the top to --bg-primary at the bottom); `page` is the solid colour for
 * mail apps that drop gradients. Button and the strip on top of the card
 * run from the accent to a deeper shade of it.
 */
function palette(theme, accent) {
  const red = accent || "#b60b0b";
  const dark = {
    page: "#240b0b",
    pageTop: "#1a0b0b",
    pageBottom: "#470404",
    card: "#1d0c0d",
    raised: "#2a1213",
    line: "#43201f",
    text: "#f1eaea",
    muted: "#c2aeae",
    accent: accent ? mix(accent, "#120a10", 0.85) : "#c8161a",
    accentDeep: mix(red, "#000000", 0.62),
    accentText: "#ffffff",
    code: accent ? mix(accent, "#ffffff", 0.45) : "#ff8a80",
    shadow: "0 18px 48px rgba(0,0,0,0.45)",
  };
  const light = {
    page: "#ecd9d3",
    pageTop: "#f7efeb",
    pageBottom: "#d9b3ac",
    card: "#fffcfa",
    raised: "#f8eeea",
    line: "#ead6cf",
    text: "#2a1214",
    muted: "#6b4a4b",
    accent: accent ? mix(accent, "#2c1618", 0.85) : "#b60b0b",
    accentDeep: mix(red, "#2a0303", 0.55),
    accentText: "#ffffff",
    code: accent ? mix(accent, "#2a1214", 0.7) : "#8f0a0a",
    shadow: "0 14px 40px rgba(110,40,36,0.16)",
  };
  return theme === "dark" ? { main: dark, other: light } : { main: light, other: dark };
}

/** A gradient background with a solid fallback (Outlook and some webmails only show the colour). */
const gradient = (from, to, solid, angle = "180deg") => `background-color:${solid};background-image:linear-gradient(${angle},${from},${to})`;

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
  const file = path.join(__dirname, "..", "..", "public", "hehehe", `${code}-logo.png`);
  return fs.existsSync(file) ? { src: `cid:${LOGO_CID}`, attachment: { filename: "logo.png", path: file, cid: LOGO_CID } } : { src: `${siteOrigin()}/hehehe/${code}-logo.webp`, attachment: null };
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
  const { main, other } = palette(theme, prefs.accent);
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
        return `<p class="email-quote" style="margin:0 0 16px;padding:10px 14px;border-left:3px solid ${main.accent};background:${main.raised};border-radius:10px;font-size:15px;line-height:1.5;color:${main.text}">${escape(block.quote).replace(/\n/g, "<br>")}</p>`;
      }
      if (block.code) {
        textParts.push(`    ${block.code}`, "");
        return `<table role="presentation" class="email-code" cellpadding="0" cellspacing="0" style="margin:6px 0 20px"><tr><td style="padding:14px 24px;border-radius:14px;background:${main.raised};border:1px solid ${main.line};font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:${main.code}" aria-label="${escape(t("code.copy"))}">${escape(block.code)}</td></tr></table>`;
      }
      if (block.button) {
        textParts.push(`${block.button.label}: ${block.button.url}`, "");
        return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 20px"><tr><td class="email-button" style="border-radius:13px;${gradient(main.accent, main.accentDeep, main.accent, "135deg")}"><a href="${escape(block.button.url)}" style="display:inline-block;padding:13px 24px;border-radius:13px;font-size:15px;font-weight:700;color:${main.accentText};text-decoration:none">${escape(block.button.label)}</a></td></tr></table>`;
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
  .email-page { background-color: ${other.page} !important; background-image: linear-gradient(180deg, ${other.pageTop}, ${other.pageBottom}) !important; }
  body { background-color: ${other.pageBottom} !important; background-image: linear-gradient(180deg, ${other.pageTop}, ${other.pageBottom}) !important; }
  .email-card { background: ${other.card} !important; border-color: ${other.line} !important; box-shadow: ${other.shadow} !important; }
  .email-text, .email-title, .email-brand, .email-quote { color: ${other.text} !important; }
  .email-code td { color: ${other.code} !important; }
  .email-note, .email-footer, .email-footer a { color: ${other.muted} !important; }
  .email-code td, .email-quote { background: ${other.raised} !important; border-color: ${other.line} !important; }
  .email-button { background-color: ${other.accent} !important; background-image: linear-gradient(135deg, ${other.accent}, ${other.accentDeep}) !important; }
}
[data-ogsc] .email-page { background: ${other.page} !important; }
[data-ogsc] .email-card { background: ${other.card} !important; }
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
@media (max-width: 600px) { .email-card { border-radius: 0 !important; } .email-inner { padding: 22px 18px !important; } }${appMode}
</style>
${prefs.customCss ? `<style data-custom-css>\n${safeCss(prefs.customCss)}\n</style>` : ""}
</head>
<body class="cult-page email" style="margin:0;padding:0;background-color:${main.pageBottom};background-image:linear-gradient(180deg,${main.pageTop},${main.pageBottom});background-repeat:no-repeat">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escape(title)}</div>
<table role="presentation" class="email-page" width="100%" cellpadding="0" cellspacing="0" bgcolor="${main.page}" style="${gradient(main.pageTop, main.pageBottom, main.page)};font-family:Nunito,'Google Sans','Segoe UI',system-ui,-apple-system,sans-serif">
<tr><td align="center" style="padding:32px 12px 40px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td style="padding:0 6px 16px">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="padding-right:12px"><img src="${escape(logo.src)}" width="44" height="44" alt="" style="display:block;border-radius:50%"></td>
        <td class="email-brand" style="font-size:20px;font-weight:800;letter-spacing:-0.01em;color:${main.text}">${escape(brand)}</td>
      </tr></table>
    </td></tr>
    <tr><td class="email-card" bgcolor="${main.card}" style="background:${main.card};border:1px solid ${main.line};border-radius:20px;box-shadow:${main.shadow};overflow:hidden">
      <div class="email-strip" style="height:5px;line-height:5px;font-size:0;${gradient(main.accent, main.accentDeep, main.accent, "90deg")}">&nbsp;</div>
      <div class="email-inner" style="padding:28px 30px 14px">
        <h1 class="email-title" style="margin:0 0 18px;font-size:24px;line-height:1.25;font-weight:800;color:${main.text}">${escape(title)}</h1>
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
