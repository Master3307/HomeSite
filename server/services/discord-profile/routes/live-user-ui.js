import crypto from "node:crypto";
import siteConfig from "../../../config.cjs";
import totp from "../../totp.cjs";
import { hubAccess, hubKeyConfigured } from "../hub-auth.js";

/*
 * GET /<discord user id>-ui: a readable page for one Discord user (profile,
 * live presence, every shared server, raw API data with copy buttons).
 *
 * Locked: without a hub login (or the hub key) it shows a login form that
 * logs in to /hub through the account API (hub key + 2FA code when on), so
 * one login covers the hub and these pages.
 */

const ICONS = {
  back: "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z",
  copy: "M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z",
  check: "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
  refresh: "M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
  open: "M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7zM19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7z",
  lock: "M18 8h-1V6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zM9 6a3 3 0 0 1 6 0v2H9V6zm9 14H6V10h12v10zm-6-3a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  search: "M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
  theme: "M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 0 1-4.4 2.26 5.4 5.4 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z",
  chevron: "M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z",
};

const icon = (name, size = 20) =>
  `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;

function page({ id, authenticated, nonce }) {
  const config = {
    id,
    authenticated,
    configured: hubKeyConfigured(),
    twoFactor: totp.twoFactorEnabled(),
    hub: `${siteConfig.origin("FRONTEND_ORIGIN")}/hub`,
    accountApi: siteConfig.origin("ACCOUNT_API_ORIGIN"),
    icons: Object.fromEntries(Object.keys(ICONS).map((name) => [name, icon(name, 18)])),
  };
  // JSON inside <script type="application/json">: only "<" needs escaping.
  const json = JSON.stringify(config).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<meta name="robots" content="noindex">
<title>${authenticated ? "Discord user" : "Hub login"} · ${id}</title>
<style>
:root, :root[data-theme="dark"] {
  --bg1: #150a24; --bg2: #63369e; --text: #eee; --muted: #c0bfe6; --accent: #3d29d4; --accent2: #7b6cff;
  --line: #ffffff1c; --card: #ffffff08; --card2: #ffffff10; --link: #00d5ff; --code: #0b0614b3;
  --ok: #43d997; --idle: #f4c35a; --dnd: #ff626e; --off: #8d86a8;
}
:root[data-theme="light"] {
  --bg1: #b28ee1; --bg2: #8452c5; --text: #fff; --muted: #efe8ff; --accent: #5f4ee6; --line: #ffffff33;
  --card: #ffffff1a; --card2: #ffffff26; --code: #2a1550c7;
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body {
  color: var(--text); font: 15px/1.45 "Google Sans Flex", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  background: linear-gradient(to bottom, var(--bg2), var(--bg1) 80%) fixed; background-color: var(--bg1);
  padding: max(14px, env(safe-area-inset-top)) 16px 48px;
}
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
.i { fill: currentColor; flex: none; vertical-align: middle; }
.wrap { max-width: 1080px; margin: 0 auto; }
.bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
.bar .grow { flex: 1; }
.btn {
  display: inline-flex; align-items: center; gap: 6px; padding: 8px 13px; border-radius: 11px; border: 1px solid var(--line);
  background: var(--card2); color: var(--text); font: inherit; font-size: 14px; cursor: pointer; text-decoration: none !important; white-space: nowrap;
}
.btn:hover { background: #ffffff1f; }
.btn.primary { background: var(--accent); border-color: transparent; }
.btn.primary:hover { filter: brightness(1.12); }
.btn.icon { padding: 8px; }
.btn[aria-pressed="true"] { background: var(--accent); }
.lookup { display: flex; align-items: center; gap: 6px; padding: 0 10px; border-radius: 11px; border: 1px solid var(--line); background: var(--card); }
.lookup input { width: 190px; max-width: 46vw; border: 0; background: none; color: var(--text); font: inherit; padding: 8px 0; outline: none; }
.card { background: #ffffff06; border-radius: 13px; backdrop-filter: blur(13px); -webkit-backdrop-filter: blur(13px); box-shadow: 0 10px 30px rgba(0,0,0,.14), inset 0 1px 0 rgba(255,255,255,.047); }
.card > h2 { margin: 0; padding: 16px 18px 0; font-size: 16px; font-weight: 650; }
.card .body { padding: 12px 18px 18px; }
.grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 16px; margin-top: 16px; }
.stack { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-content: start; min-width: 0; }
.dot { display: inline-block; border-radius: 50%; background: var(--off); }
@media (max-width: 860px) { .grid { grid-template-columns: 1fr; } }

/* profile */
.hero { overflow: hidden; }
.banner { height: 150px; background: var(--accent) center/cover no-repeat; }
.hero-main { display: flex; gap: 20px; align-items: flex-end; padding: 0 22px 20px; margin-top: -54px; flex-wrap: wrap; }
.avatar { position: relative; width: 120px; height: 120px; flex: none; }
.avatar img.face {
  width: 120px; height: 120px; border-radius: 50%; object-fit: cover; background: #ffffff14;
  /* cut out where the status dot sits, like Discord (no ring needed on any background) */
  -webkit-mask-image: radial-gradient(circle at 103px 103px, transparent 23px, #000 23.5px);
  mask-image: radial-gradient(circle at 103px 103px, transparent 23px, #000 23.5px);
}
.avatar img.deco { position: absolute; top: -12px; left: -12px; width: 144px; height: 144px; max-width: none; pointer-events: none; }
.avatar .dot { position: absolute; right: 1px; bottom: 1px; width: 32px; height: 32px; border-radius: 50%; background: var(--off); }
.dot[data-s="online"] { background: var(--ok) !important; } .dot[data-s="idle"] { background: var(--idle) !important; } .dot[data-s="dnd"] { background: var(--dnd) !important; }
.names { min-width: 0; flex: 1; padding-bottom: 4px; }
.names h1 { margin: 0; font-size: clamp(1.5rem, 4vw, 2.1rem); line-height: 1.15; overflow-wrap: anywhere; }
.names .sub { color: var(--muted); display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 4px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; background: var(--card2); border: 1px solid var(--line); font-size: 13px; }
.chip .sw { width: 10px; height: 10px; border-radius: 50%; background: var(--off); }
.tag { font-size: 11px; font-weight: 650; padding: 1px 6px; border-radius: 4px; background: #ffffff1c; vertical-align: 3px; }
.facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 0 22px; padding: 0 22px 14px; }
.fact { padding: 10px 0; min-width: 0; border-top: 1px solid var(--line); }
.fact small { display: block; color: var(--muted); font-size: 12px; }
.fact b { display: block; font-weight: 600; overflow-wrap: anywhere; }
.copyable { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.copyable:hover { color: var(--link); }

/* presence */
.status-line { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.status-line .dot { position: static; width: 12px; height: 12px; border: 0; }
.devices { color: var(--muted); font-size: 13px; }
.activity { display: flex; gap: 14px; padding: 12px 0 0; margin-top: 12px; border-top: 1px solid var(--line); }
.activity img { width: 72px; height: 72px; border-radius: 10px; object-fit: cover; flex: none; background: var(--card2); }
.activity .t { min-width: 0; flex: 1; }
.activity .k { font-size: 13px; color: var(--muted); }
.activity strong { display: block; overflow-wrap: anywhere; }
.activity .d { color: var(--muted); font-size: 14px; overflow-wrap: anywhere; }
.progress { height: 5px; border-radius: 99px; background: #ffffff26; margin-top: 8px; overflow: hidden; }
.progress span { display: block; height: 100%; background: var(--text); width: 0; }
.times { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.empty { color: var(--muted); }

/* servers */
.guild { border-top: 1px solid var(--line); }
.guild:first-child { border-top: 0; }
.guild summary { list-style: none; display: flex; gap: 12px; align-items: center; padding: 10px 4px; cursor: pointer; border-radius: 9px; }
.guild summary:hover { background: #ffffff0d; }
.guild summary::-webkit-details-marker { display: none; }
.guild summary img, .guild summary .gi { width: 40px; height: 40px; border-radius: 12px; flex: none; background: var(--accent); display: grid; place-items: center; font-weight: 700; }
.guild summary .t { flex: 1; min-width: 0; }
.guild summary .t small { display: block; color: var(--muted); }
.guild[open] summary .i { transform: rotate(180deg); }
.guild .gbody { padding: 4px 4px 14px; display: grid; gap: 12px; }
.kv { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; font-size: 14px; }
.kv dt { color: var(--muted); } .kv dd { margin: 0; overflow-wrap: anywhere; }

/* raw */
.raw details { border-top: 1px solid var(--line); }
.raw details:first-child { border-top: 0; }
.raw summary { cursor: pointer; padding: 10px 0; font-weight: 600; display: flex; gap: 8px; align-items: center; }
.code { position: relative; }
.code pre { margin: 0 0 12px; padding: 14px; padding-right: 52px; border-radius: 12px; background: var(--code); border: 1px solid var(--line); overflow: auto; max-height: 460px;
  font: 12.5px/1.5 ui-monospace, "JetBrains Mono", "Cascadia Code", Menlo, monospace; white-space: pre; tab-size: 2; }
.code .btn { position: absolute; top: 8px; right: 8px; padding: 6px; }
.k1 { color: #c4a7ff; } .s1 { color: #9ff2c3; } .n1 { color: #ffd28a; } .b1 { color: #7cd4ff; }
.warn { margin-top: 10px; padding: 10px 12px; border-radius: 12px; background: #ffb84d22; border: 1px solid #ffb84d55; font-size: 14px; }
.toast { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); background: #000c; padding: 9px 15px; border-radius: 10px; opacity: 0; transition: opacity .2s; pointer-events: none; }
.toast.show { opacity: 1; }
.skeleton { height: 340px; display: grid; place-items: center; color: var(--muted); }

/* login */
.login { max-width: 420px; margin: 9vh auto 0; padding: 26px; }
.login h1 { margin: 10px 0 4px; font-size: 1.6rem; }
.login p { color: var(--muted); margin: 0 0 18px; }
.login label { display: block; font-size: 13px; color: var(--muted); margin: 12px 0 6px; }
.login input { width: 100%; padding: 12px 13px; border-radius: 11px; border: 1px solid var(--line); background: var(--code); color: var(--text); font: inherit; outline: none; }
.login input:focus { border-color: var(--accent2); box-shadow: 0 0 0 3px #7b6cff44; }
.login input.code { letter-spacing: .4em; font-size: 20px; text-align: center; font-variant-numeric: tabular-nums; }
.login .btn.primary { width: 100%; justify-content: center; margin-top: 18px; padding: 12px; font-size: 15px; }
.login .error { color: #ffb7bd; margin-top: 12px; min-height: 1.2em; }
.lockicon { width: 52px; height: 52px; border-radius: 16px; background: var(--accent); display: grid; place-items: center; }
</style>
</head>
<body>
<script type="application/json" id="config">${json}</script>
<div class="wrap" id="app"></div>
<div class="toast" id="toast" role="status"></div>
<script nonce="${nonce}">
(() => {
  const C = JSON.parse(document.getElementById("config").textContent);
  const $ = (selector, root = document) => root.querySelector(selector);
  const app = $("#app");
  const I = C.icons;
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // The vite dev proxy (/profile-api/...) uses /account-api; production uses the account API address.
  const ACCOUNT_API = location.pathname.startsWith("/profile-api/") ? "/account-api" : (C.accountApi || "/account-api");
  const SELF = location.pathname.replace(/-ui\\/?$/, "");

  /* theme */
  const theme = (() => { try { return localStorage.getItem("theme"); } catch { return null; } })();
  if (theme) document.documentElement.dataset.theme = theme;
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch {}
  }

  function toast(text) {
    const node = $("#toast");
    node.textContent = text;
    node.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => node.classList.remove("show"), 1600);
  }
  async function copy(text, button) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = Object.assign(document.createElement("textarea"), { value: text });
      document.body.append(area); area.select(); document.execCommand("copy"); area.remove();
    }
    toast("Copied");
    if (button) { const old = button.innerHTML; button.innerHTML = I.check; setTimeout(() => (button.innerHTML = old), 1200); }
  }
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-copy]");
    if (target) copy(target.dataset.copy, target.matches("button") ? target : null);
  });

  const topBar = (extra = "") => \`
    <div class="bar">
      <a class="btn" href="\${esc(C.hub)}#members">\${I.back} Hub</a>
      <div class="grow"></div>
      <form class="lookup" id="lookup">\${I.search}<input name="id" inputmode="numeric" placeholder="Look up a user ID" autocomplete="off"></form>
      \${extra}
      <button class="btn icon" id="theme" title="Theme">\${I.theme}</button>
    </div>\`;

  function bindBar() {
    $("#theme").onclick = toggleTheme;
    $("#lookup").onsubmit = (event) => {
      event.preventDefault();
      const id = event.target.id.value.trim();
      if (/^\\d{17,20}$/.test(id)) location.href = SELF.replace(/\\d{17,20}$/, id) + "-ui";
      else toast("A user ID has 17–20 digits");
    };
  }

  /* ---------- login ---------- */

  async function login() {
    // Signed in on the site as the owner: the Discord login replaces the key.
    let owner = null;
    try {
      const response = await fetch(ACCOUNT_API + "/hub/session", { credentials: "include", cache: "no-store" });
      owner = (await response.json()).discordOwner ?? null;
    } catch {}
    // Without 2FA the Discord login is enough; reload once so the server sees it (never loop).
    if (owner && !C.twoFactor) {
      let tried = false;
      try { tried = sessionStorage.getItem("hub-ui-reload") === "1"; sessionStorage.setItem("hub-ui-reload", "1"); } catch {}
      if (!tried) return location.reload();
    }
    app.innerHTML = topBar() + \`
      <form class="card login" id="login" autocomplete="on">
        <div class="lockicon">\${I.lock}</div>
        <h1>Hub login</h1>
        <p>\${!C.configured ? "This is locked: set HUB_KEY on the server first (pnpm setup:gui)." : owner ? "You're signed in with Discord as " + esc(owner.name) + ". Enter a code from your authenticator app to continue." : "Looking up Discord users is private. Log in with the hub key" + (C.twoFactor ? " (or the admin key) and a 2FA code" : "") + ", or sign in on the site with your Discord; this also opens the hub."}</p>
        \${owner ? "" : '<label for="key">Hub key</label><input id="key" name="key" type="password" autocomplete="current-password" required ' + (C.configured ? "" : "disabled") + ">"}
        \${C.twoFactor ? '<label for="code">2FA code</label><input id="code" class="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" pattern="[0-9 ]*" required>' : ""}
        <button class="btn primary" \${C.configured ? "" : "disabled"}>\${I.lock} Unlock</button>
        <div class="error" id="error" role="alert"></div>
      </form>\`;
    bindBar();
    const form = $("#login");
    form.onsubmit = async (event) => {
      event.preventDefault();
      const button = form.querySelector("button");
      button.disabled = true;
      $("#error").textContent = "";
      try {
        const response = await fetch(ACCOUNT_API + "/hub/login", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", "X-Requested-With": "homesite-web" },
          body: JSON.stringify({ key: form.key ? form.key.value : undefined, code: form.code ? form.code.value.replace(/\\s/g, "") : undefined }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Login failed (" + response.status + ").");
        location.reload();
      } catch (error) {
        $("#error").textContent = error.message === "Failed to fetch" ? "The account API is not reachable." : error.message;
        button.disabled = false;
        if (form.code) form.code.value = "";
      }
    };
    (form.key || form.code)?.focus();
  }

  /* ---------- profile ---------- */

  const STATUS = { online: "Online", idle: "Idle", dnd: "Do not disturb", offline: "Offline", invisible: "Offline" };
  const KIND = { 0: "Playing", 1: "Streaming", 2: "Listening to", 3: "Watching", 4: "Custom status", 5: "Competing in" };
  const fmtDate = (value) => (value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");
  function ago(value) {
    if (!value) return "";
    const seconds = Math.round((Date.now() - new Date(value)) / 1000);
    const units = [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]];
    for (const [unit, size] of units) if (Math.abs(seconds) >= size) return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(-Math.round(seconds / size), unit);
    return "just now";
  }
  const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = String(s % 60).padStart(2, "0"); return h ? h + ":" + String(m).padStart(2, "0") + ":" + r : m + ":" + r; };

  function highlight(json) {
    return esc(json).replace(/(&quot;(?:\\\\.|[^&]|&(?!quot;))*?&quot;)(\\s*:)?|\\b(true|false|null)\\b|-?\\b\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?\\b/gi, (match, string, colon, bool) => {
      if (string) return colon ? '<span class="k1">' + string + "</span>" + colon : '<span class="s1">' + string + "</span>";
      if (bool) return '<span class="b1">' + match + "</span>";
      return '<span class="n1">' + match + "</span>";
    });
  }
  const codeBlock = (value) => {
    const text = JSON.stringify(value, null, 2);
    return '<div class="code"><button class="btn" title="Copy" data-copy="' + esc(text) + '">' + I.copy + "</button><pre>" + highlight(text) + "</pre></div>";
  };

  function activityCard(activity) {
    if (activity.type === 4) return "";
    const start = activity.timestamps?.start ? new Date(activity.timestamps.start).getTime() : null;
    const end = activity.timestamps?.end ? new Date(activity.timestamps.end).getTime() : null;
    const image = activity.image_url ? '<img src="' + esc(activity.image_url) + '" alt="" loading="lazy">' : "";
    const timing = start && end
      ? '<div class="progress"><span data-start="' + start + '" data-end="' + end + '"></span></div><div class="times"><span data-elapsed="' + start + '"></span><span>' + clock(end - start) + "</span></div>"
      : start ? '<div class="d"><span data-elapsed="' + start + '"></span> elapsed</div>' : "";
    return '<div class="activity">' + image + '<div class="t"><div class="k">' + esc(KIND[activity.type] ?? activity.type_label) + "</div><strong>" + esc(activity.name) + "</strong>" +
      (activity.details ? '<div class="d">' + esc(activity.details) + "</div>" : "") +
      (activity.state ? '<div class="d">' + esc(activity.state) + "</div>" : "") +
      (activity.assets?.large_text && activity.assets.large_text !== activity.details ? '<div class="d">' + esc(activity.assets.large_text) + "</div>" : "") +
      (activity.party?.size ? '<div class="d">Party ' + activity.party.size.join(" of ") + "</div>" : "") +
      timing + (/^https?:\\/\\//i.test(activity.url ?? "") ? '<div class="d"><a href="' + esc(activity.url) + '" target="_blank" rel="noopener">' + esc(activity.url) + "</a></div>" : "") + "</div></div>";
  }

  function guildCard(guild) {
    const member = guild.member ?? {};
    const roles = (member.roles ?? []).map((role) => '<span class="chip"><span class="sw" style="background:' + esc(role.color && role.color !== "#000000" ? role.color : "var(--off)") + '"></span>' + esc(role.name) + "</span>").join("");
    const perms = member.permissions_in_guild ?? [];
    return '<details class="guild"' + (guild.is_primary ? " open" : "") + "><summary>" +
      (guild.icon ? '<img src="' + esc(guild.icon) + '" alt="">' : '<span class="gi">' + esc((guild.name || "?").slice(0, 1)) + "</span>") +
      '<span class="t"><b>' + esc(guild.name) + "</b>" + (guild.is_primary ? ' <span class="tag">Main</span>' : "") +
      "<small>" + esc(member.nickname ? "Nickname: " + member.nickname : member.display_name ?? "") + " · " + (guild.member_count ?? "?") + " members</small></span>" + I.chevron + "</summary>" +
      '<div class="gbody"><dl class="kv">' +
      "<dt>Joined</dt><dd>" + fmtDate(member.joined_at) + " (" + ago(member.joined_at) + ")</dd>" +
      (member.premium_since ? "<dt>Boosting since</dt><dd>" + fmtDate(member.premium_since) + "</dd>" : "") +
      (member.communication_disabled_until ? "<dt>Timed out until</dt><dd>" + fmtDate(member.communication_disabled_until) + "</dd>" : "") +
      "<dt>Highest role</dt><dd>" + esc(member.highest_role?.name ?? "—") + "</dd>" +
      "<dt>Voice</dt><dd>" + (member.deaf ? "deafened " : "") + (member.mute ? "muted" : "") + (!member.deaf && !member.mute ? "—" : "") + "</dd>" +
      "<dt>Server ID</dt><dd><span class=\\"copyable\\" data-copy=\\"" + esc(guild.id) + "\\">" + esc(guild.id) + " " + I.copy + "</span></dd>" +
      "</dl>" + (roles ? '<div class="chips">' + roles + "</div>" : '<div class="empty">No roles</div>') +
      (perms.length ? '<details><summary class="d">' + perms.length + " permissions</summary><div class=\\"chips\\" style=\\"margin-top:8px\\">" + perms.map((perm) => '<span class="chip">' + esc(perm) + "</span>").join("") + "</div></details>" : "") +
      "</div></details>";
  }

  function render(data) {
    const user = data.user ?? {};
    const presence = data.presence;
    const status = presence?.status ?? "offline";
    const name = data.member?.display_name || user.global_name || user.username;
    const devices = Object.entries(presence?.client_status ?? {}).map(([device, value]) => device + " (" + value + ")").join(", ");
    const custom = presence?.activities?.find((activity) => activity.type === 4);
    const banner = data.member?.banner || user.banner;
    const accent = user.accent_color != null ? "#" + Number(user.accent_color).toString(16).padStart(6, "0") : null;

    app.innerHTML = topBar('<button class="btn icon" id="refresh" title="Refresh">' + I.refresh + '</button><button class="btn" id="auto" aria-pressed="false" title="Refresh every 15 seconds">Live</button><a class="btn" href="https://discord.com/users/' + esc(user.id) + '" target="_blank" rel="noopener">' + I.open + " Discord</a>") + \`
      <section class="card hero">
        <div class="banner" style="\${banner ? "background-image:url('" + esc(banner) + "')" : accent ? "background:" + esc(accent) : ""}"></div>
        <div class="hero-main">
          <div class="avatar">
            <img class="face" src="\${esc(data.member?.avatar || user.avatar)}" alt="">
            \${user.avatar_decoration ? '<img class="deco" src="' + esc(user.avatar_decoration) + '" alt="">' : ""}
            <span class="dot" data-s="\${esc(status)}" title="\${esc(STATUS[status] ?? status)}"></span>
          </div>
          <div class="names">
            <h1>\${esc(name)} \${user.bot ? '<span class="tag">Bot</span>' : ""}</h1>
            <div class="sub">
              <span class="copyable" data-copy="\${esc(user.username)}">@\${esc(user.username)}</span>
              \${user.global_name && user.global_name !== name ? "<span>· " + esc(user.global_name) + "</span>" : ""}
              \${user.primary_guild?.tag ? '<span class="chip">' + (user.guild_badge ? '<img src="' + esc(user.guild_badge) + '" width="14" height="14" alt="">' : "") + esc(user.primary_guild.tag) + "</span>" : ""}
            </div>
            \${user.badges?.length ? '<div class="chips" style="margin-top:8px">' + user.badges.map((badge) => '<span class="chip">' + esc(badge.label) + "</span>").join("") + "</div>" : ""}
          </div>
        </div>
        <div class="facts">
          <div class="fact"><small>User ID</small><b class="copyable" data-copy="\${esc(user.id)}">\${esc(user.id)} \${I.copy}</b></div>
          <div class="fact"><small>Account created</small><b>\${fmtDate(user.created_at)}</b><small>\${ago(user.created_at)}</small></div>
          <div class="fact"><small>Shared servers</small><b>\${data.mutual_guilds?.length ?? 0} of \${data.guild_scan?.bot_guild_count ?? "?"}</b></div>
          <div class="fact"><small>Fetched</small><b>\${fmtDate(data.fetched_at)}</b><small>\${esc(data.lookup?.presence_source ? "live presence" : "no presence")}</small></div>
        </div>
      </section>
      <div class="grid">
        <div class="stack">
          <section class="card"><h2>Presence</h2><div class="body">
            <div class="status-line"><span class="dot" data-s="\${esc(status)}"></span><b>\${esc(STATUS[status] ?? status)}</b><span class="devices">\${esc(devices)}</span></div>
            \${custom ? '<div class="activity"><div class="t"><div class="k">Custom status</div><strong>' + esc((custom.emoji?.name ? custom.emoji.name + " " : "") + (custom.state ?? "")) + "</strong></div></div>" : ""}
            \${(presence?.activities ?? []).map(activityCard).join("") || (presence ? "" : '<p class="empty">No presence: not in a shared server, or offline.</p>')}
          </div></section>
          <section class="card raw"><h2>Raw data</h2><div class="body">
            <details open><summary>\${I.chevron} User</summary>\${codeBlock(data.user)}</details>
            <details><summary>\${I.chevron} Member (primary server)</summary>\${codeBlock(data.member)}</details>
            <details><summary>\${I.chevron} Presence</summary>\${codeBlock(data.presence)}</details>
            <details><summary>\${I.chevron} Discord API user</summary>\${codeBlock(data.raw_user)}</details>
            <details><summary>\${I.chevron} Lookup &amp; server scan</summary>\${codeBlock({ lookup: data.lookup, guild_scan: data.guild_scan, warnings: data.warnings })}</details>
            <details><summary>\${I.chevron} Everything</summary>\${codeBlock(data)}</details>
          </div></section>
        </div>
        <div class="stack">
          <section class="card"><h2>Servers</h2><div class="body">
            \${(data.mutual_guilds ?? []).map(guildCard).join("") || '<p class="empty">Not in any server with the bot.</p>'}
            \${(data.warnings ?? []).map((warning) => '<div class="warn">' + esc(warning.message) + "</div>").join("")}
          </div></section>
        </div>
      </div>\`;
    bindBar();
    $("#refresh").onclick = () => load(true);
    const auto = $("#auto");
    auto.setAttribute("aria-pressed", String(Boolean(timer)));
    auto.onclick = () => {
      if (timer) { clearInterval(timer); timer = null; } else timer = setInterval(() => load(false), 15000);
      auto.setAttribute("aria-pressed", String(Boolean(timer)));
    };
    tick();
  }

  // Live progress bars and elapsed times.
  function tick() {
    const now = Date.now();
    document.querySelectorAll("[data-start][data-end]").forEach((bar) => {
      const start = Number(bar.dataset.start), end = Number(bar.dataset.end);
      bar.style.width = Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100)) + "%";
    });
    document.querySelectorAll("[data-elapsed]").forEach((node) => (node.textContent = clock(now - Number(node.dataset.elapsed))));
  }
  setInterval(tick, 1000);

  let timer = null;
  async function load(showToast) {
    try {
      const response = await fetch(SELF, { credentials: "include", headers: { Accept: "application/json", "X-Requested-With": "homesite-web" }, cache: "no-store" });
      if (response.status === 401) return login();
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "HTTP " + response.status);
      const scroll = window.scrollY;
      const open = [...document.querySelectorAll("details")].map((node) => node.open);
      render(data);
      if (open.length) document.querySelectorAll("details").forEach((node, index) => open[index] !== undefined && (node.open = open[index]));
      window.scrollTo(0, scroll);
      if (showToast) toast("Updated");
    } catch (error) {
      if (!app.querySelector(".hero")) {
        app.innerHTML = topBar() + '<section class="card skeleton"><div>' + esc(error.message) + "</div></section>";
        bindBar();
      } else toast(error.message);
    }
  }

  if (!C.authenticated) login();
  else {
    app.innerHTML = topBar() + '<section class="card skeleton">Loading…</section>';
    bindBar();
    load(false);
  }
})();
</script>
</body>
</html>`;
}

export function registerLiveUserUiRoute(app) {
  app.get(/^\/(\d{17,20})-ui\/?$/, async (req, res) => {
    const id = req.params[0];
    const authenticated = Boolean(await hubAccess(req));
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("Vary", "Cookie, Authorization");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    // Only this page's own script may run (the code is public; the data comes from Discord).
    const nonce = crypto.randomBytes(16).toString("base64");
    const accountApi = siteConfig.origin("ACCOUNT_API_ORIGIN");
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'none'",
        `script-src 'nonce-${nonce}'`,
        "style-src 'unsafe-inline'",
        "img-src https: data:",
        "font-src 'self'",
        `connect-src 'self'${accountApi ? ` ${accountApi}` : ""}`,
        "form-action 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
      ].join("; "),
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(authenticated ? 200 : 401).type("html").send(page({ id, authenticated, nonce }));
  });
}
