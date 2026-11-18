const crypto = require("node:crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");

const { setting, enabled } = require("../config.cjs");
const { httpError } = require("./http.cjs");
const { seal, unseal } = require("./secretBox.cjs");
const { safeFetch, parseTarget } = require("./safeFetch.cjs");
const { kinds: KINDS } = require("../../shared/dash-integrations.json");

/*
 * /dash integrations, in the style of Homarr: a connection to a service
 * (Navidrome, Jellyfin, GitHub, Pi-hole, Home Assistant …) saved on your
 * account once, then used by any widget that shows that kind of thing
 * (shared/dash-integrations.json `provides`). Synced with the account like
 * the rest of the dash.
 *
 *   GET    /account/dash/integrations              { items, privateAllowed }
 *   POST   /account/dash/integrations              { kind, name, url, config, secrets } (tested first)
 *   PATCH  /account/dash/integrations/:id          same; secrets left out stay as they are
 *   DELETE /account/dash/integrations/:id
 *   POST   /account/dash/integrations/:id/test
 *   GET    /dash/integrations/:id/:action?…        what a widget shows (fixed actions per kind)
 *   POST   /dash/integrations/:id/:action          the few changes (Home Assistant: toggle)
 *   GET    /dash/integrations/:id/image?item=&size= cover art (Navidrome, Jellyfin)
 *
 * Safe by design (the code is public):
 *   - the secrets (passwords, tokens, API keys) are sealed (AES-GCM,
 *     secretBox.cjs) in the table dash_integrations and never leave the
 *     server; the browser only learns which ones are saved. The hub's
 *     database view hides the column, account deletion removes the rows
 *     (members.cjs clears every table with the user's id), backups carry
 *     them sealed (a server with another internal key can't open them: they
 *     show as "save the password again")
 *   - each kind has a fixed list of read actions with checked parameters;
 *     nothing passes a free path through, except the GitHub / GitLab / Gitea
 *     repository paths (allow-listed) and the JSON API kind (relative paths
 *     under the address you gave)
 *   - every request goes through safeFetch.cjs: public addresses only (no
 *     LAN, localhost, cloud metadata; pinned address; ports 80, 443,
 *     1024-65535). Only the site owner may point integrations at private
 *     addresses, and only with DASH_PRIVATE_INTEGRATIONS=on (a home server
 *     on the same network)
 *   - images: only raster types (never SVG), served with nosniff and a
 *     sandboxing CSP
 *   - logged in only, rate-limited, mutations behind the CSRF check
 *     (account-api.cjs), answers cached a few seconds per integration
 */

const MAX_PER_USER = 30;
const RESULT_TTL_MS = 15_000;
const RASTER = /^image\/(png|jpeg|webp|gif|avif)$/;
const ID = /^int-[A-Za-z0-9-]{8,60}$/;

const plainText = (value, max) => String(value ?? "").trim().slice(0, max);
const nowIso = () => new Date().toISOString();

/* ---------- requests to a service ---------- */

function joinUrl(base, path, query) {
  const root = base.endsWith("/") ? base : `${base}/`;
  const url = new URL(String(path).replace(/^\/+/, ""), root);
  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  return url;
}

function contextFor(integration, { allowPrivate }) {
  const request = async (path, { method = "GET", headers = {}, body = null, query = null, accept = null, raw = false, form = null, json = null } = {}) => {
    const url = joinUrl(integration.url, path, query);
    let payload = body;
    const sendHeaders = { Accept: "application/json", ...headers };
    if (json !== null) {
      payload = JSON.stringify(json);
      sendHeaders["Content-Type"] = "application/json";
    } else if (form) {
      payload = new URLSearchParams(form).toString();
      sendHeaders["Content-Type"] = "application/x-www-form-urlencoded";
    }
    const answer = await safeFetch(parseTarget(url.href, { ports: "service" }), { method, headers: sendHeaders, body: payload, allowPrivate, ports: "service", accept, maxBytes: raw ? 4 * 1024 * 1024 : 2 * 1024 * 1024 });
    if (raw) return answer;
    if (answer.status === 401 || answer.status === 403) throw httpError(400, `${KINDS[integration.kind].name} didn't accept the login (${answer.status}).`);
    if (answer.status === 404) throw httpError(404, `${KINDS[integration.kind].name} answered "not found" (is the address right?).`);
    if (answer.status >= 400) throw httpError(502, `${KINDS[integration.kind].name} answered ${answer.status}.`);
    return answer.json();
  };
  return { ...integration, allowPrivate, request };
}

/* Sessions some services need (Pi-hole v6, qBittorrent): kept in memory per integration. */
const sessions = new Map(); // id -> { value, until }
const sessionOf = (id) => {
  const entry = sessions.get(id);
  return entry && entry.until > Date.now() ? entry.value : null;
};
const keepSession = (id, value, ms) => sessions.set(id, { value, until: Date.now() + ms });

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
const clampInt = (value, min, max, fallback) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

/* ---------- the kinds ---------- */

const REPO_QUERY = new Set(["per_page", "page", "state", "sha", "sort", "direction", "limit"]);
function repoQuery(query) {
  const clean = {};
  for (const [key, value] of Object.entries(query ?? {})) if (REPO_QUERY.has(key) && /^[A-Za-z0-9_.-]{1,40}$/.test(String(value))) clean[key] = String(value);
  return clean;
}
function repoPath(query, pattern) {
  const path = String(query?.path ?? "");
  if (!pattern.test(path) || path.includes("..")) throw httpError(400, "That repository path isn't allowed.");
  return path;
}

/* Subsonic API (Navidrome): token auth, md5(password + salt). */
function subsonic(ctx, method, params = {}) {
  const salt = crypto.randomBytes(8).toString("hex");
  const token = crypto.createHash("md5").update(`${ctx.secrets.password ?? ""}${salt}`).digest("hex");
  return { path: `rest/${method}`, query: { u: ctx.config.username, t: token, s: salt, v: "1.16.1", c: "HomeSite", f: "json", ...params } };
}
async function subsonicCall(ctx, method, params) {
  const { path, query } = subsonic(ctx, method, params);
  const data = await ctx.request(path, { query });
  const body = data?.["subsonic-response"];
  if (!body) throw httpError(502, `That doesn't look like ${KINDS[ctx.kind]?.name ?? "a Subsonic server"} (Subsonic API).`);
  if (body.status !== "ok") throw httpError(400, `${KINDS[ctx.kind]?.name ?? "Subsonic"}: ${body.error?.message ?? "error"}`);
  return body;
}
const ALBUM_TYPES = { newest: "newest", recent: "recent", frequent: "frequent", random: "random", highest: "highest", starred: "starred" };

const jellyfinHeaders = (ctx) => ({ Authorization: `MediaBrowser Client="HomeSite", Device="Dash", DeviceId="homesite-dash", Version="1.0", Token="${ctx.secrets.apiKey}"`, "X-Emby-Token": ctx.secrets.apiKey });
const JELLYFIN_TYPES = { music: "MusicAlbum", movies: "Movie", shows: "Series", all: "Movie,Series,MusicAlbum" };
const JELLYFIN_SORT = { newest: "DateCreated", recent: "DatePlayed", frequent: "PlayCount", random: "Random" };

async function piholeV6(ctx) {
  let sid = sessionOf(ctx.id);
  if (sid === null && ctx.secrets.password) {
    const auth = await ctx.request("api/auth", { method: "POST", json: { password: ctx.secrets.password } });
    sid = auth?.session?.sid;
    if (!auth?.session?.valid || !sid) throw httpError(400, "Pi-hole didn't accept the password.");
    keepSession(ctx.id, sid, Math.max(60, Number(auth.session.validity) || 1800) * 1000 - 30_000);
  }
  const headers = sid ? { "X-FTL-SID": sid } : {};
  const [summary, blocking] = await Promise.all([ctx.request("api/stats/summary", { headers }), ctx.request("api/dns/blocking", { headers }).catch(() => null)]);
  return {
    queries: num(summary?.queries?.total),
    blocked: num(summary?.queries?.blocked),
    percent: num(summary?.queries?.percent_blocked),
    domains: num(summary?.gravity?.domains_being_blocked),
    clients: num(summary?.clients?.active),
    enabled: blocking ? blocking.blocking === "enabled" : null,
  };
}

async function qbit(ctx, path, query) {
  const origin = new URL(ctx.url).origin;
  const login = async () => {
    const answer = await ctx.request("api/v2/auth/login", { method: "POST", form: { username: ctx.config.username ?? "", password: ctx.secrets.password ?? "" }, headers: { Referer: origin, Origin: origin }, raw: true });
    const cookie = String([].concat(answer.headers["set-cookie"] ?? []).find((line) => /^SID=/.test(line)) ?? "").split(";")[0];
    if (answer.status >= 400 || !cookie || answer.text().trim() === "Fails.") throw httpError(400, "qBittorrent didn't accept the login.");
    keepSession(ctx.id, cookie, 25 * 60_000);
    return cookie;
  };
  let cookie = sessionOf(ctx.id) ?? (await login());
  let answer = await ctx.request(path, { query, headers: { Cookie: cookie, Referer: origin }, raw: true });
  if (answer.status === 403) {
    cookie = await login();
    answer = await ctx.request(path, { query, headers: { Cookie: cookie, Referer: origin }, raw: true });
  }
  if (answer.status >= 400) throw httpError(502, `qBittorrent answered ${answer.status}.`);
  return answer.json();
}

const ENTITY = /^[a-z_]{1,40}\.[a-z0-9_]{1,80}$/;
const TOGGLE_DOMAINS = new Set(["light", "switch", "fan", "input_boolean", "automation", "script", "scene", "siren", "humidifier"]);
const haHeaders = (ctx) => ({ Authorization: `Bearer ${ctx.secrets.token}` });
const haEntity = (state) => ({
  id: state.entity_id,
  name: state.attributes?.friendly_name ?? state.entity_id,
  state: state.state,
  unit: state.attributes?.unit_of_measurement ?? "",
  deviceClass: state.attributes?.device_class ?? "",
  domain: String(state.entity_id).split(".")[0],
  changedAt: state.last_changed ?? null,
})

function arrCalendar(kind) {
  return async (ctx, query) => {
    const days = clampInt(query.days, 1, 60, 14);
    const past = clampInt(query.past, 0, 14, 1);
    const start = new Date(Date.now() - past * 86_400_000).toISOString();
    const end = new Date(Date.now() + days * 86_400_000).toISOString();
    const list = await ctx.request("api/v3/calendar", { headers: { "X-Api-Key": ctx.secrets.apiKey }, query: { start, end, unmonitored: "false", ...(kind === "sonarr" ? { includeSeries: "true" } : {}) } });
    const poster = (images) => (images ?? []).find((image) => image.coverType === "poster")?.remoteUrl ?? null;
    return (Array.isArray(list) ? list : []).slice(0, 100).map((item) =>
      kind === "sonarr"
        ? {
            id: `s${item.id}`,
            title: item.series?.title ?? "",
            subtitle: `S${String(item.seasonNumber).padStart(2, "0")}E${String(item.episodeNumber).padStart(2, "0")}${item.title ? ` · ${item.title}` : ""}`,
            date: item.airDateUtc ?? item.airDate ?? null,
            hasFile: Boolean(item.hasFile),
            poster: poster(item.series?.images),
            kind: "episode",
          }
        : {
            id: `r${item.id}`,
            title: item.title ?? "",
            subtitle: item.year ? String(item.year) : "",
            date: item.digitalRelease ?? item.physicalRelease ?? item.inCinemas ?? null,
            hasFile: Boolean(item.hasFile),
            poster: poster(item.images),
            kind: "movie",
          },
    );
  };
}
function arrQueue(kind) {
  return async (ctx) => {
    const data = await ctx.request("api/v3/queue", { headers: { "X-Api-Key": ctx.secrets.apiKey }, query: { pageSize: 20, ...(kind === "sonarr" ? { includeSeries: "true", includeEpisode: "true" } : { includeMovie: "true" }) } });
    return (data?.records ?? []).map((item) => ({
      id: String(item.id),
      name: kind === "sonarr" ? `${item.series?.title ?? item.title} ${item.episode ? `S${String(item.episode.seasonNumber).padStart(2, "0")}E${String(item.episode.episodeNumber).padStart(2, "0")}` : ""}`.trim() : (item.movie?.title ?? item.title),
      progress: item.size ? 1 - (Number(item.sizeleft) || 0) / item.size : 0,
      state: item.trackedDownloadState ?? item.status ?? "",
      eta: item.timeleft ?? null,
    }));
  };
}


/* ---------- files: WebDAV (also Nextcloud) and copyparty ---------- */

const SAFE_PATH = /^\/[^\0\\]*$/;
/** A path inside the service ("/", "/Music/2024/"); never "..", always starting with "/". */
function cleanPath(value, { dir = false } = {}) {
  let path = String(value ?? "/").trim() || "/";
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/{2,}/g, "/");
  if (!SAFE_PATH.test(path) || path.split("/").some((part) => part === ".." || part === ".") || path.length > 1000) throw httpError(400, "That path isn't allowed.");
  if (dir && !path.endsWith("/")) path += "/";
  return path;
}
const encodePath = (path) => path.split("/").map((part) => encodeURIComponent(part)).join("/");
const xmlText = (block, tag) => {
  const match = new RegExp(`<(?:[A-Za-z0-9]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9]+:)?${tag}>`, "i").exec(block);
  return match ? match[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() : "";
};

/* The WebDAV root of an integration (Nextcloud: the user's files under remote.php). */
function davRoot(ctx) {
  if (ctx.kind === "nextcloud") return `${ctx.url.replace(/\/+$/, "")}/remote.php/dav/files/${encodeURIComponent(ctx.config.username ?? "")}`;
  return ctx.url.replace(/\/+$/, "");
}
const davHeaders = (ctx) => (ctx.secrets.password || ctx.config.username ? basicAuth(ctx) : {});

async function davList(ctx, path) {
  const rootUrl = davRoot(ctx);
  const target = `${rootUrl}${encodePath(path)}`;
  const answer = await safeFetch(parseTarget(target, { ports: "service" }), {
    method: "PROPFIND",
    headers: { ...davHeaders(ctx), Depth: "1", "Content-Type": "application/xml; charset=utf-8", Accept: "application/xml, text/xml" },
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getcontenttype/><d:quota-used-bytes/><d:quota-available-bytes/></d:prop></d:propfind>',
    allowPrivate: ctx.allowPrivate,
    ports: "service",
  });
  if (answer.status === 401 || answer.status === 403) throw httpError(400, `${KINDS[ctx.kind].name} didn't accept the login.`);
  if (answer.status === 404) throw httpError(404, "That folder doesn't exist.");
  if (answer.status !== 207) throw httpError(502, `${KINDS[ctx.kind].name} answered ${answer.status}.`);
  const basePath = new URL(rootUrl).pathname.replace(/\/+$/, "");
  const blocks = answer.text().match(/<(?:[A-Za-z0-9]+:)?response\b[\s\S]*?<\/(?:[A-Za-z0-9]+:)?response>/gi) ?? [];
  let quota = null;
  const items = [];
  for (const block of blocks) {
    let href = xmlText(block, "href");
    try {
      href = decodeURIComponent(new URL(href, rootUrl).pathname);
    } catch {
      continue;
    }
    const inside = href.startsWith(basePath) ? href.slice(basePath.length) || "/" : href;
    const dir = /<(?:[A-Za-z0-9]+:)?collection\b/i.test(block);
    if (inside.replace(/\/+$/, "") === path.replace(/\/+$/, "")) {
      const used = Number(xmlText(block, "quota-used-bytes"));
      const free = Number(xmlText(block, "quota-available-bytes"));
      if (Number.isFinite(used) && used >= 0) quota = { used, free: Number.isFinite(free) && free >= 0 ? free : null };
      continue;
    }
    const name = inside.replace(/\/+$/, "").split("/").pop();
    if (!name) continue;
    items.push({ name, path: dir ? `${inside.replace(/\/+$/, "")}/` : inside, dir, size: dir ? null : num(xmlText(block, "getcontentlength")), modified: xmlText(block, "getlastmodified") || null, type: xmlText(block, "getcontenttype") || null });
  }
  return { path, items, quota, web: ctx.kind === "nextcloud" ? `${ctx.url.replace(/\/+$/, "")}/apps/files/?dir=${encodeURIComponent(path)}` : `${rootUrl}${encodePath(path)}` };
}

const copypartyHeaders = (ctx) => (ctx.secrets.password ? { PW: ctx.secrets.password } : {});
async function copypartyList(ctx, path) {
  const data = await ctx.request(`${encodePath(path).replace(/^\//, "")}`, { headers: copypartyHeaders(ctx), query: { ls: "" } });
  const base = ctx.url.replace(/\/+$/, "");
  const entry = (item, dir) => {
    const name = decodeURIComponent(String(item.href ?? "")).replace(/\/+$/, "");
    return { name, path: `${path}${name}${dir ? "/" : ""}`, dir, size: dir ? null : num(item.sz), modified: num(item.ts) ? new Date(item.ts * 1000).toISOString() : null, type: null };
  };
  return {
    path,
    items: [...(data.dirs ?? []).map((item) => entry(item, true)), ...(data.files ?? []).map((item) => entry(item, false))].filter((item) => item.name),
    quota: null,
    web: `${base}${encodePath(path)}`,
  };
}

async function paperlessList(ctx, query) {
  const data = await ctx.request("api/documents/", { headers: { Authorization: `Token ${ctx.secrets.token}` }, query: { ordering: "-created", page_size: clampInt(query.size, 1, 50, 15), ...(query.q ? { query: String(query.q).slice(0, 100) } : {}) } });
  const base = ctx.url.replace(/\/+$/, "");
  return {
    path: "/",
    items: (data.results ?? []).map((doc) => ({ name: doc.title || doc.original_file_name || `#${doc.id}`, path: `/${doc.id}`, dir: false, size: null, modified: doc.created ?? doc.added ?? null, type: "document", link: `${base}/documents/${doc.id}/details` })),
    quota: null,
    web: `${base}/documents`,
  };
}

/* A file through the server (download / open), and an upload into a folder. */
const FILE_LIMIT = 50 * 1024 * 1024;
async function fileDownload(ctx, path) {
  const clean = cleanPath(path);
  if (clean.endsWith("/")) throw httpError(400, "That's a folder.");
  const target = ctx.kind === "copyparty" ? `${ctx.url.replace(/\/+$/, "")}${encodePath(clean)}` : `${davRoot(ctx)}${encodePath(clean)}`;
  const headers = ctx.kind === "copyparty" ? copypartyHeaders(ctx) : davHeaders(ctx);
  const answer = await safeFetch(parseTarget(target, { ports: "service" }), { headers, allowPrivate: ctx.allowPrivate, ports: "service", maxBytes: FILE_LIMIT, timeout: 30_000 });
  if (answer.status >= 400) throw httpError(answer.status === 404 ? 404 : 502, answer.status === 404 ? "That file doesn't exist." : `It answered ${answer.status}.`);
  return { name: clean.split("/").pop(), buffer: answer.buffer, type: answer.type };
}
async function fileUpload(ctx, folder, name, buffer) {
  const dir = cleanPath(folder, { dir: true });
  const file = String(name ?? "").trim();
  if (!file || file.length > 200 || /[\\/\0]/.test(file) || file === "." || file === "..") throw httpError(400, "That file name isn't allowed.");
  const target = ctx.kind === "copyparty" ? `${ctx.url.replace(/\/+$/, "")}${encodePath(dir + file)}` : `${davRoot(ctx)}${encodePath(dir + file)}`;
  const headers = { ...(ctx.kind === "copyparty" ? copypartyHeaders(ctx) : davHeaders(ctx)), "Content-Type": "application/octet-stream" };
  const answer = await safeFetch(parseTarget(target, { ports: "service" }), { method: "PUT", headers, body: buffer, allowPrivate: ctx.allowPrivate, ports: "service", timeout: 60_000 });
  if (answer.status === 401 || answer.status === 403) throw httpError(400, "The service didn't allow the upload.");
  if (answer.status >= 400) throw httpError(502, `The upload failed (${answer.status}).`);
  return { ok: true, path: dir + file };
}
const FILES = { list: null, file: fileDownload, upload: fileUpload };

/* ---------- more services ---------- */

const plexHeaders = (ctx) => ({ "X-Plex-Token": ctx.secrets.token, Accept: "application/json" });
const absHeaders = (ctx) => ({ Authorization: `Bearer ${ctx.secrets.token}` });
const immichHeaders = (ctx) => ({ "x-api-key": ctx.secrets.apiKey });
const portainerHeaders = (ctx) => ({ "X-API-Key": ctx.secrets.apiKey });
const proxmoxHeaders = (ctx) => ({ Authorization: `PVEAPIToken=${ctx.config.tokenId}=${ctx.secrets.secret}` });
const percent = (part, whole) => (Number(whole) > 0 ? (Number(part) / Number(whole)) * 100 : null);
function uptimeText(seconds) {
  const s = Number(seconds) || 0;
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3600);
  return days ? `${days} d ${hours} h` : `${hours} h ${Math.floor((s % 3600) / 60)} min`;
}

async function proxmoxResources(ctx) {
  const data = await ctx.request("api2/json/cluster/resources", { headers: proxmoxHeaders(ctx) });
  return Array.isArray(data?.data) ? data.data : [];
}

const ADAPTERS = {
  navidrome: {
    test: async (ctx) => {
      const body = await subsonicCall(ctx, "ping");
      return `${body.type ? body.type[0].toUpperCase() + body.type.slice(1) : KINDS[ctx.kind].name} ${body.serverVersion ?? body.version ?? ""}`.trim();
    },
    actions: {
      nowPlaying: async (ctx) => {
        const body = await subsonicCall(ctx, "getNowPlaying");
        return (body.nowPlaying?.entry ?? []).map((entry) => ({
          id: entry.id,
          title: entry.title,
          artist: entry.artist ?? "",
          album: entry.album ?? "",
          cover: entry.coverArt ?? null,
          user: entry.username ?? "",
          player: entry.playerName ?? "",
          minutesAgo: num(entry.minutesAgo),
          duration: num(entry.duration),
          type: "music",
        }));
      },
      library: async (ctx, query) => {
        const type = ALBUM_TYPES[query.sort] ?? "newest";
        const body = await subsonicCall(ctx, "getAlbumList2", { type, size: clampInt(query.size, 1, 40, 12) });
        return (body.albumList2?.album ?? []).map((album) => ({ id: album.id, title: album.name, subtitle: album.artist ?? "", year: num(album.year), cover: album.coverArt ?? null, count: num(album.songCount), type: "album" }));
      },
      stats: async (ctx) => {
        const [scan, artists] = await Promise.all([subsonicCall(ctx, "getScanStatus"), subsonicCall(ctx, "getArtists").catch(() => null)]);
        const artistCount = (artists?.artists?.index ?? []).reduce((sum, index) => sum + (index.artist?.length ?? 0), 0);
        return { songs: num(scan.scanStatus?.count), artists: artists ? artistCount : null, scanning: Boolean(scan.scanStatus?.scanning), lastScan: scan.scanStatus?.lastScan ?? null };
      },
    },
    image: async (ctx, item, size) => {
      const { path, query } = subsonic(ctx, "getCoverArt", { id: item, size });
      return ctx.request(path, { query, raw: true, accept: RASTER });
    },
  },

  jellyfin: {
    test: async (ctx) => {
      const info = await ctx.request("System/Info", { headers: jellyfinHeaders(ctx) });
      return `${info.ServerName ?? "Jellyfin"} ${info.Version ?? ""}`.trim();
    },
    actions: {
      nowPlaying: async (ctx) => {
        const list = await ctx.request("Sessions", { headers: jellyfinHeaders(ctx), query: { activeWithinSeconds: 960 } });
        return (Array.isArray(list) ? list : [])
          .filter((session) => session.NowPlayingItem)
          .map((session) => {
            const item = session.NowPlayingItem;
            return {
              id: `${session.Id}:${item.Id}`,
              title: item.Name ?? "",
              artist: item.Artists?.join(", ") || item.SeriesName || "",
              album: item.Album ?? (item.SeasonName ? `${item.SeasonName}` : ""),
              cover: item.AlbumId && item.Type === "Audio" ? item.AlbumId : (item.SeriesId && item.Type === "Episode" ? item.SeriesId : item.Id),
              user: session.UserName ?? "",
              player: [session.Client, session.DeviceName].filter(Boolean).join(" · "),
              paused: Boolean(session.PlayState?.IsPaused),
              position: num(session.PlayState?.PositionTicks) !== null ? session.PlayState.PositionTicks / 1e7 : null,
              duration: num(item.RunTimeTicks) !== null ? item.RunTimeTicks / 1e7 : null,
              type: item.Type === "Audio" ? "music" : "video",
            };
          });
      },
      library: async (ctx, query) => {
        const list = await ctx.request("Items", {
          headers: jellyfinHeaders(ctx),
          query: { SortBy: JELLYFIN_SORT[query.sort] ?? "DateCreated", SortOrder: "Descending", Recursive: "true", IncludeItemTypes: JELLYFIN_TYPES[query.media] ?? JELLYFIN_TYPES.all, Limit: clampInt(query.size, 1, 40, 12), Fields: "ProductionYear", ImageTypeLimit: 1 },
        });
        return (list?.Items ?? []).map((item) => ({ id: item.Id, title: item.Name ?? "", subtitle: item.AlbumArtist ?? (item.ProductionYear ? String(item.ProductionYear) : ""), year: num(item.ProductionYear), cover: item.Id, type: item.Type === "MusicAlbum" ? "album" : "video" }));
      },
      stats: async (ctx) => {
        const counts = await ctx.request("Items/Counts", { headers: jellyfinHeaders(ctx) });
        return { movies: num(counts.MovieCount), series: num(counts.SeriesCount), episodes: num(counts.EpisodeCount), albums: num(counts.AlbumCount), songs: num(counts.SongCount), artists: num(counts.ArtistCount) };
      },
    },
    image: async (ctx, item, size) => ctx.request(`Items/${encodeURIComponent(item)}/Images/Primary`, { headers: jellyfinHeaders(ctx), query: { maxHeight: size, maxWidth: size, quality: 85 }, raw: true, accept: RASTER }),
  },

  github: {
    test: async (ctx) => {
      const user = await ctx.request("user", { headers: githubHeaders(ctx) });
      return `@${user.login}`;
    },
    actions: {
      api: (ctx, query) => ctx.request(repoPath(query, /^\/repos\/[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}(\/(releases|releases\/latest|commits|pulls|tags|languages|contributors))?$/), { headers: githubHeaders(ctx), query: repoQuery(query) }),
    },
  },

  gitlab: {
    test: async (ctx) => {
      const user = await ctx.request("api/v4/user", { headers: { "PRIVATE-TOKEN": ctx.secrets.token } });
      return `@${user.username}`;
    },
    actions: {
      api: (ctx, query) => ctx.request(`api/v4${repoPath(query, /^\/projects\/[A-Za-z0-9_.%-]{1,200}(\/(releases|repository\/tags|repository\/commits|merge_requests))?$/)}`, { headers: { "PRIVATE-TOKEN": ctx.secrets.token }, query: repoQuery(query) }),
    },
  },

  gitea: {
    test: async (ctx) => {
      if (ctx.secrets.token) {
        const user = await ctx.request("api/v1/user", { headers: { Authorization: `token ${ctx.secrets.token}` } });
        return `@${user.login}`;
      }
      const version = await ctx.request("api/v1/version");
      return `Version ${version.version ?? ""}`.trim();
    },
    actions: {
      api: (ctx, query) => ctx.request(`api/v1${repoPath(query, /^\/repos\/[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}(\/(releases|tags|commits|pulls))?$/)}`, { headers: ctx.secrets.token ? { Authorization: `token ${ctx.secrets.token}` } : {}, query: repoQuery(query) }),
    },
  },

  pihole: {
    test: async (ctx) => {
      const summary = await ADAPTERS.pihole.actions.summary(ctx);
      return summary.queries !== null ? `${summary.queries} queries today` : "Pi-hole";
    },
    actions: {
      summary: async (ctx) => {
        if (ctx.config.version === "v5") {
          const data = await ctx.request("admin/api.php", { query: { summaryRaw: "", auth: ctx.secrets.password ?? "" } });
          if (Array.isArray(data)) throw httpError(400, "Pi-hole didn't accept the API token.");
          return { queries: num(data.dns_queries_today), blocked: num(data.ads_blocked_today), percent: num(data.ads_percentage_today), domains: num(data.domains_being_blocked), clients: num(data.unique_clients), enabled: data.status ? data.status === "enabled" : null };
        }
        return piholeV6(ctx);
      },
    },
  },

  adguard: {
    test: async (ctx) => {
      const status = await ctx.request("control/status", { headers: basicAuth(ctx) });
      return `AdGuard Home ${status.version ?? ""}`.trim();
    },
    actions: {
      summary: async (ctx) => {
        const [stats, status] = await Promise.all([ctx.request("control/stats", { headers: basicAuth(ctx) }), ctx.request("control/status", { headers: basicAuth(ctx) })]);
        const queries = num(stats.num_dns_queries);
        const blocked = num(stats.num_blocked_filtering);
        return { queries, blocked, percent: queries ? (blocked / queries) * 100 : 0, domains: null, clients: null, enabled: Boolean(status.protection_enabled), avgMs: num(stats.avg_processing_time) !== null ? stats.avg_processing_time * 1000 : null };
      },
    },
  },

  homeassistant: {
    test: async (ctx) => {
      const config = await ctx.request("api/config", { headers: haHeaders(ctx) });
      return `${config.location_name ?? "Home Assistant"} ${config.version ?? ""}`.trim();
    },
    actions: {
      states: async (ctx, query) => {
        const ids = String(query.entities ?? "")
          .split(",")
          .map((id) => id.trim())
          .filter((id) => ENTITY.test(id))
          .slice(0, 24);
        return Promise.all(ids.map((id) => ctx.request(`api/states/${id}`, { headers: haHeaders(ctx) }).then(haEntity, () => ({ id, name: id, state: "unavailable", unit: "", domain: id.split(".")[0], missing: true }))));
      },
      entities: async (ctx) => {
        const list = await ctx.request("api/states", { headers: haHeaders(ctx) });
        return (Array.isArray(list) ? list : []).slice(0, 2000).map((state) => ({ id: state.entity_id, name: state.attributes?.friendly_name ?? state.entity_id, domain: String(state.entity_id).split(".")[0] }));
      },
    },
    mutations: {
      toggle: async (ctx, body) => {
        const id = String(body?.entity ?? "");
        const domain = id.split(".")[0];
        if (!ENTITY.test(id) || !TOGGLE_DOMAINS.has(domain)) throw httpError(400, "That can't be switched from here.");
        const service = domain === "script" || domain === "scene" ? "turn_on" : "toggle";
        await ctx.request(`api/services/${domain === "scene" ? "scene" : domain === "script" ? "script" : "homeassistant"}/${service}`, { method: "POST", headers: haHeaders(ctx), json: { entity_id: id } });
        return haEntity(await ctx.request(`api/states/${id}`, { headers: haHeaders(ctx) }));
      },
    },
  },

  uptimekuma: {
    test: async (ctx) => {
      const page = await ctx.request(`api/status-page/${encodeURIComponent(ctx.config.slug)}`);
      return page.config?.title ?? "Uptime Kuma";
    },
    actions: {
      status: async (ctx) => {
        const slug = encodeURIComponent(ctx.config.slug);
        const [page, beats] = await Promise.all([ctx.request(`api/status-page/${slug}`), ctx.request(`api/status-page/heartbeat/${slug}`)]);
        const monitors = (page.publicGroupList ?? []).flatMap((group) => (group.monitorList ?? []).map((monitor) => ({ ...monitor, group: group.name })));
        return {
          title: page.config?.title ?? "",
          monitors: monitors.slice(0, 60).map((monitor) => {
            const list = beats.heartbeatList?.[monitor.id] ?? [];
            const last = list[list.length - 1];
            return { id: monitor.id, name: monitor.name, group: monitor.group, status: last ? last.status : null, ping: last ? num(last.ping) : null, uptime: num(beats.uptimeList?.[`${monitor.id}_24`]), history: list.slice(-30).map((beat) => beat.status) };
          }),
        };
      },
    },
  },

  sonarr: {
    test: async (ctx) => `Sonarr ${(await ctx.request("api/v3/system/status", { headers: { "X-Api-Key": ctx.secrets.apiKey } })).version ?? ""}`.trim(),
    actions: { calendar: arrCalendar("sonarr"), queue: arrQueue("sonarr") },
  },

  radarr: {
    test: async (ctx) => `Radarr ${(await ctx.request("api/v3/system/status", { headers: { "X-Api-Key": ctx.secrets.apiKey } })).version ?? ""}`.trim(),
    actions: { calendar: arrCalendar("radarr"), queue: arrQueue("radarr") },
  },

  qbittorrent: {
    test: async (ctx) => {
      const info = await qbit(ctx, "api/v2/transfer/info");
      return info ? "qBittorrent" : "";
    },
    actions: {
      queue: async (ctx, query) => {
        const [info, torrents] = await Promise.all([qbit(ctx, "api/v2/transfer/info"), qbit(ctx, "api/v2/torrents/info", { filter: query.filter === "all" ? "all" : "active", sort: "dlspeed", reverse: "true", limit: clampInt(query.size, 1, 40, 10) })]);
        return {
          down: num(info.dl_info_speed),
          up: num(info.up_info_speed),
          items: (Array.isArray(torrents) ? torrents : []).map((torrent) => ({ id: torrent.hash, name: torrent.name, progress: num(torrent.progress) ?? 0, down: num(torrent.dlspeed), up: num(torrent.upspeed), eta: num(torrent.eta), state: torrent.state, size: num(torrent.size) })),
        };
      },
    },
  },

  glances: {
    test: async (ctx) => {
      const system = await glances(ctx, "system");
      return [system.hostname, system.os_name].filter(Boolean).join(" · ") || "Glances";
    },
    actions: {
      system: (ctx) => ADAPTERS.glances.actions.stats(ctx),
      stats: async (ctx) => {
        const [quick, fs, uptime, load, system] = await Promise.all([glances(ctx, "quicklook"), glances(ctx, "fs").catch(() => []), glances(ctx, "uptime").catch(() => null), glances(ctx, "load").catch(() => null), glances(ctx, "system").catch(() => ({}))]);
        return {
          host: system.hostname ?? "",
          os: [system.os_name, system.os_version].filter(Boolean).join(" "),
          cpu: num(quick.cpu),
          memory: num(quick.mem),
          swap: num(quick.swap),
          load: load ? [num(load.min1), num(load.min5), num(load.min15)] : null,
          cores: num(load?.cpucore),
          uptime: typeof uptime === "string" ? uptime : null,
          disks: (Array.isArray(fs) ? fs : []).slice(0, 12).map((disk) => ({ mount: disk.mnt_point, percent: num(disk.percent), used: num(disk.used), size: num(disk.size) })),
        };
      },
    },
  },


  plex: {
    test: async (ctx) => {
      const data = await ctx.request("", { headers: plexHeaders(ctx) });
      return `${data?.MediaContainer?.friendlyName ?? "Plex"} ${data?.MediaContainer?.version ?? ""}`.trim();
    },
    actions: {
      nowPlaying: async (ctx) => {
        const data = await ctx.request("status/sessions", { headers: plexHeaders(ctx) });
        return (data?.MediaContainer?.Metadata ?? []).map((item) => ({
          id: `${item.sessionKey ?? ""}:${item.ratingKey}`,
          title: item.title ?? "",
          artist: item.type === "episode" ? (item.grandparentTitle ?? "") : (item.grandparentTitle ?? item.originalTitle ?? ""),
          album: item.parentTitle ?? "",
          cover: String(item.type === "track" ? (item.parentRatingKey ?? item.ratingKey) : item.type === "episode" ? (item.grandparentRatingKey ?? item.ratingKey) : item.ratingKey),
          user: item.User?.title ?? "",
          player: [item.Player?.product, item.Player?.title].filter(Boolean).join(" · "),
          paused: item.Player?.state === "paused",
          position: num(item.viewOffset) !== null ? item.viewOffset / 1000 : null,
          duration: num(item.duration) !== null ? item.duration / 1000 : null,
          type: item.type === "track" ? "music" : "video",
        }));
      },
      library: async (ctx, query) => {
        const data = await ctx.request("library/recentlyAdded", { headers: plexHeaders(ctx), query: { "X-Plex-Container-Start": 0, "X-Plex-Container-Size": clampInt(query.size, 1, 40, 12) } });
        return (data?.MediaContainer?.Metadata ?? []).map((item) => ({ id: String(item.ratingKey), title: item.type === "season" ? item.parentTitle : item.title, subtitle: item.type === "album" ? (item.parentTitle ?? "") : item.type === "season" ? (item.title ?? "") : item.year ? String(item.year) : "", year: num(item.year), cover: String(item.ratingKey), type: item.type === "album" ? "album" : "video" }));
      },
    },
    image: async (ctx, item, size) => ctx.request(`photo/:/transcode`, { headers: plexHeaders(ctx), query: { width: size, height: size, minSize: 1, upscale: 1, url: `/library/metadata/${item}/thumb` }, raw: true, accept: RASTER }),
  },

  audiobookshelf: {
    test: async (ctx) => `@${(await ctx.request("api/me", { headers: absHeaders(ctx) })).username ?? "?"}`,
    actions: {
      library: async (ctx, query) => {
        const data = await ctx.request("api/me/items-in-progress", { headers: absHeaders(ctx) });
        return (data?.libraryItems ?? []).slice(0, clampInt(query.size, 1, 40, 12)).map((item) => ({ id: item.id, title: item.media?.metadata?.title ?? "", subtitle: item.media?.metadata?.authorName ?? item.media?.metadata?.author ?? "", year: num(item.media?.metadata?.publishedYear), cover: item.id, type: "album" }));
      },
      stats: async (ctx) => {
        const data = await ctx.request("api/me/listening-stats", { headers: absHeaders(ctx) });
        return { hoursListened: Math.round((Number(data?.totalTime) || 0) / 360) / 10, minutesToday: Math.round((Number(data?.today) || 0) / 60), books: num(Object.keys(data?.items ?? {}).length) };
      },
    },
    image: async (ctx, item, size) => ctx.request(`api/items/${encodeURIComponent(item)}/cover`, { headers: absHeaders(ctx), query: { width: size, format: "jpeg" }, raw: true, accept: RASTER }),
  },

  immich: {
    test: async (ctx) => (await ctx.request("api/users/me", { headers: immichHeaders(ctx) })).name ?? "Immich",
    actions: {
      photos: async (ctx, query) => {
        const size = clampInt(query.size, 1, 30, 6);
        let assets;
        if (query.sort === "recent") {
          const data = await ctx.request("api/search/metadata", { method: "POST", headers: immichHeaders(ctx), json: { size, order: "desc", type: "IMAGE" } });
          assets = data?.assets?.items ?? [];
        } else {
          assets = await ctx.request("api/search/random", { method: "POST", headers: immichHeaders(ctx), json: { size, type: "IMAGE" } }).catch(() => ctx.request("api/assets/random", { headers: immichHeaders(ctx), query: { count: size } }));
        }
        const base = ctx.url.replace(/\/+$/, "");
        return (Array.isArray(assets) ? assets : []).map((asset) => ({ id: asset.id, title: asset.originalFileName ?? "", date: asset.fileCreatedAt ?? asset.localDateTime ?? null, link: `${base}/photos/${asset.id}` }));
      },
      stats: async (ctx) => {
        const data = await ctx.request("api/assets/statistics", { headers: immichHeaders(ctx) });
        return { photos: num(data?.images), videos: num(data?.videos) };
      },
    },
    image: async (ctx, item) => ctx.request(`api/assets/${encodeURIComponent(item)}/thumbnail`, { headers: immichHeaders(ctx), query: { size: "preview" }, raw: true, accept: RASTER }),
  },

  webdav: {
    test: async (ctx) => {
      const listing = await davList(ctx, "/");
      return `${listing.items.length} items in /`;
    },
    actions: { list: (ctx, query) => davList(ctx, cleanPath(query.path, { dir: true })) },
    files: FILES,
  },

  nextcloud: {
    test: async (ctx) => {
      const listing = await davList(ctx, "/");
      return `${listing.items.length} items in your files`;
    },
    actions: { list: (ctx, query) => davList(ctx, cleanPath(query.path, { dir: true })) },
    files: FILES,
  },

  copyparty: {
    test: async (ctx) => {
      const listing = await copypartyList(ctx, "/");
      return `${listing.items.length} items in /`;
    },
    actions: { list: (ctx, query) => copypartyList(ctx, cleanPath(query.path, { dir: true })) },
    files: FILES,
  },

  paperless: {
    test: async (ctx) => {
      const data = await ctx.request("api/statistics/", { headers: { Authorization: `Token ${ctx.secrets.token}` } });
      return `${data.documents_total ?? 0} documents`;
    },
    actions: {
      list: (ctx, query) => paperlessList(ctx, query),
      stats: async (ctx) => {
        const data = await ctx.request("api/statistics/", { headers: { Authorization: `Token ${ctx.secrets.token}` } });
        return { documents: num(data.documents_total), inbox: num(data.documents_inbox), characters: num(data.character_count) };
      },
    },
  },

  syncthing: {
    test: async (ctx) => `Syncthing ${(await ctx.request("rest/system/version", { headers: { "X-API-Key": ctx.secrets.apiKey } })).version ?? ""}`.trim(),
    actions: {
      status: async (ctx) => {
        const headers = { "X-API-Key": ctx.secrets.apiKey };
        const [folders, connections] = await Promise.all([ctx.request("rest/config/folders", { headers }), ctx.request("rest/system/connections", { headers }).catch(() => null)]);
        const list = await Promise.all(
          (Array.isArray(folders) ? folders : []).slice(0, 20).map(async (folder) => {
            const status = await ctx.request("rest/db/status", { headers, query: { folder: folder.id } }).catch(() => null);
            const global = Number(status?.globalBytes) || 0;
            return { id: folder.id, label: folder.label || folder.id, paused: Boolean(folder.paused), state: status?.state ?? "unknown", percent: global ? Math.round(((Number(status?.inSyncBytes) || 0) / global) * 1000) / 10 : 100, needBytes: num(status?.needBytes) };
          }),
        );
        const devices = Object.values(connections?.connections ?? {});
        return { folders: list, devices: { connected: devices.filter((device) => device.connected).length, total: devices.length } };
      },
    },
  },

  portainer: {
    test: async (ctx) => `Portainer ${(await ctx.request("api/status", { headers: portainerHeaders(ctx) })).Version ?? ""}`.trim(),
    actions: {
      containers: async (ctx, query) => {
        let endpoint = String(ctx.config.endpoint ?? "").trim();
        if (!/^\d{1,6}$/.test(endpoint)) {
          const endpoints = await ctx.request("api/endpoints", { headers: portainerHeaders(ctx) });
          endpoint = String(endpoints?.[0]?.Id ?? "1");
        }
        const list = await ctx.request(`api/endpoints/${endpoint}/docker/containers/json`, { headers: portainerHeaders(ctx), query: { all: query.filter === "running" ? "0" : "1" } });
        return (Array.isArray(list) ? list : []).slice(0, 80).map((container) => ({ id: String(container.Id).slice(0, 12), name: String(container.Names?.[0] ?? container.Id).replace(/^\//, ""), image: container.Image ?? "", state: container.State ?? "", status: container.Status ?? "" }));
      },
    },
  },

  gotify: {
    test: async (ctx) => `@${(await ctx.request("current/user", { headers: { "X-Gotify-Key": ctx.secrets.token } })).name ?? "?"}`,
    actions: {
      messages: async (ctx, query) => {
        const headers = { "X-Gotify-Key": ctx.secrets.token };
        const [data, apps] = await Promise.all([ctx.request("message", { headers, query: { limit: clampInt(query.size, 1, 50, 10) } }), ctx.request("application", { headers }).catch(() => [])]);
        const names = new Map((Array.isArray(apps) ? apps : []).map((app) => [app.id, app.name]));
        return (data?.messages ?? []).map((message) => ({ id: `g${message.id}`, title: message.title ?? "", text: String(message.message ?? "").slice(0, 500), source: names.get(message.appid) ?? "", priority: num(message.priority), date: message.date ?? null }));
      },
    },
  },

  ntfy: {
    test: async (ctx) => ((await ctx.request("v1/health")).healthy ? "ntfy is healthy" : "ntfy"),
    actions: {
      messages: async (ctx, query) => {
        const topics = String(ctx.config.topics ?? "")
          .split(",")
          .map((topic) => topic.trim())
          .filter((topic) => /^[-_A-Za-z0-9]{1,64}$/.test(topic))
          .slice(0, 10);
        if (!topics.length) throw httpError(400, "No topics.");
        const answer = await ctx.request(`${topics.join(",")}/json`, { headers: ctx.secrets.token ? { Authorization: `Bearer ${ctx.secrets.token}` } : {}, query: { poll: 1, since: ["1h", "12h", "24h", "7d"].includes(query.since) ? query.since : "24h" }, raw: true });
        if (answer.status >= 400) throw httpError(answer.status === 401 || answer.status === 403 ? 400 : 502, `ntfy answered ${answer.status}.`);
        const lines = answer.text().split("\n").filter(Boolean);
        const list = [];
        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            if (event.event === "message") list.push({ id: `n${event.id}`, title: event.title ?? "", text: String(event.message ?? "").slice(0, 500), source: event.topic ?? "", priority: num(event.priority), date: event.time ? new Date(event.time * 1000).toISOString() : null });
          } catch {
            // not a JSON line
          }
        }
        return list.reverse().slice(0, clampInt(query.size, 1, 50, 10));
      },
    },
  },

  proxmox: {
    test: async (ctx) => `Proxmox VE ${(await ctx.request("api2/json/version", { headers: proxmoxHeaders(ctx) }))?.data?.version ?? ""}`.trim(),
    actions: {
      stats: async (ctx) => {
        const resources = await proxmoxResources(ctx);
        const guests = resources.filter((item) => item.type === "qemu" || item.type === "lxc");
        return { nodes: resources.filter((item) => item.type === "node").length, vmsRunning: guests.filter((item) => item.type === "qemu" && item.status === "running").length, vms: guests.filter((item) => item.type === "qemu").length, containersRunning: guests.filter((item) => item.type === "lxc" && item.status === "running").length, containers: guests.filter((item) => item.type === "lxc").length };
      },
      // The first node in the System widget's shape (like Glances); storages as disks.
      system: async (ctx) => {
        const resources = await proxmoxResources(ctx);
        const node = resources.find((item) => item.type === "node" && item.status === "online") ?? resources.find((item) => item.type === "node");
        if (!node) throw httpError(404, "No Proxmox node found.");
        return {
          host: node.node ?? node.name ?? "",
          os: "Proxmox VE",
          cpu: Number.isFinite(Number(node.cpu)) ? Math.round(node.cpu * 1000) / 10 : null,
          memory: percent(node.mem, node.maxmem),
          swap: null,
          load: null,
          cores: num(node.maxcpu),
          uptime: node.uptime ? uptimeText(node.uptime) : null,
          disks: resources.filter((item) => item.type === "storage" && item.node === node.node && Number(item.maxdisk) > 0).slice(0, 10).map((item) => ({ mount: item.storage, percent: percent(item.disk, item.maxdisk), used: num(item.disk), size: num(item.maxdisk) })),
        };
      },
    },
  },

  speedtest: {
    test: async (ctx) => {
      const result = await ADAPTERS.speedtest.actions.stats(ctx);
      return result.download !== null ? `${result.download} Mbit/s down` : "Speedtest Tracker";
    },
    actions: {
      stats: async (ctx) => {
        // v1 API (with a token), else the older open endpoint.
        const data = ctx.secrets.token ? await ctx.request("api/v1/results/latest", { headers: { Authorization: `Bearer ${ctx.secrets.token}` } }) : await ctx.request("api/speedtest/latest");
        const result = data?.data ?? data ?? {};
        const mbit = (value, bits) => {
          const number = Number(value);
          if (!Number.isFinite(number)) return null;
          return Math.round((bits ? number / 1e6 : number) * 10) / 10;
        };
        return {
          download: mbit(result.download_bits ?? result.download, result.download_bits !== undefined),
          upload: mbit(result.upload_bits ?? result.upload, result.upload_bits !== undefined),
          ping: num(result.ping) !== null ? Math.round(result.ping * 10) / 10 : null,
        };
      },
    },
  },

  custom: {
    test: async (ctx) => {
      await ADAPTERS.custom.actions.get(ctx, { path: "" });
      return "OK";
    },
    actions: {
      get: (ctx, query) => {
        const path = String(query.path ?? "");
        if (path.length > 500 || /^[a-z][a-z0-9+.-]*:|^\/\/|\.\.|\\/i.test(path)) throw httpError(400, "Only paths under the integration's address work.");
        const headers = ctx.config.headerName && /^[A-Za-z0-9-]{1,60}$/.test(ctx.config.headerName) ? { [ctx.config.headerName]: ctx.secrets.headerValue ?? "" } : {};
        return ctx.request(path, { headers });
      },
    },
  },
};

// Every OpenSubsonic server speaks the same API as Navidrome.
ADAPTERS.opensubsonic = ADAPTERS.navidrome;

function githubHeaders(ctx) {
  return { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", Authorization: `Bearer ${ctx.secrets.token}` };
}
function basicAuth(ctx) {
  return { Authorization: `Basic ${Buffer.from(`${ctx.config.username ?? ""}:${ctx.secrets.password ?? ""}`).toString("base64")}` };
}
async function glances(ctx, plugin) {
  const headers = ctx.config.username ? basicAuth(ctx) : {};
  // Glances 4 (api/4), else 3.
  try {
    return await ctx.request(`api/4/${plugin}`, { headers });
  } catch (error) {
    if (error.status !== 404) throw error;
    return ctx.request(`api/3/${plugin}`, { headers });
  }
}

/* ---------- storage and routes ---------- */

function cleanInput(kindId, body, previous = null) {
  const kind = KINDS[kindId];
  if (!kind || !ADAPTERS[kindId]) throw httpError(400, "Unknown kind of integration.");
  const rawUrl = plainText(body.url, 500) || previous?.url || kind.url.default || "";
  if (!rawUrl && kind.url.required) throw httpError(400, "The address is missing.");
  const url = parseTarget(rawUrl, { ports: "service" });
  url.search = "";
  const config = {};
  const secrets = { ...(previous?.secrets ?? {}) };
  for (const field of kind.fields) {
    if (field.type === "secret") {
      if (body.secrets && Object.prototype.hasOwnProperty.call(body.secrets, field.key)) {
        const value = String(body.secrets[field.key] ?? "").slice(0, 2000);
        if (value) secrets[field.key] = value;
        else delete secrets[field.key];
      }
      if (field.required && !secrets[field.key]) throw httpError(400, `${field.key} is missing.`);
    } else {
      let value = plainText(body.config?.[field.key] ?? previous?.config?.[field.key] ?? field.default ?? "", 200);
      if (field.type === "select" && !field.choices.includes(value)) value = field.default ?? field.choices[0];
      if (field.required && !value) throw httpError(400, `${field.key} is missing.`);
      config[field.key] = value;
    }
  }
  return { kind: kindId, name: plainText(body.name, 60) || previous?.name || kind.name, url: url.href.replace(/\/+$/, ""), config, secrets };
}

function registerDashIntegrations(app, { getRequestSession, getDatabase, requireStorage, activity = null, limiter }) {
  let ready = false;
  const db = () => {
    const handle = getDatabase();
    if (!handle) throw httpError(503, "Accounts are not available.");
    if (!ready) {
      handle.exec(`
        CREATE TABLE IF NOT EXISTS dash_integrations (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          config_json TEXT NOT NULL DEFAULT '{}',
          sealed_secret TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS dash_integrations_user ON dash_integrations (user_id);
      `);
      ready = true;
    }
    return handle;
  };

  const isOwner = (session) => Boolean(session?.discord_user_id && session.discord_user_id === setting("DISCORD_USER_ID"));
  const privateAllowed = (session) => isOwner(session) && enabled("DASH_PRIVATE_INTEGRATIONS");

  function load(row) {
    let secrets = {};
    let broken = false;
    if (row.sealed_secret) {
      try {
        secrets = JSON.parse(unseal(row.sealed_secret));
      } catch {
        // Sealed on another server (a restored backup): the secrets have to be saved again.
        broken = true;
      }
    }
    let config = {};
    try {
      config = JSON.parse(row.config_json || "{}");
    } catch {
      config = {};
    }
    return { id: row.id, kind: row.kind, name: row.name, url: row.url, config, secrets, broken, createdAt: row.created_at, updatedAt: row.updated_at };
  }
  /* What the browser may see: never the secrets, only which are saved. */
  const toPublic = (item) => ({ id: item.id, kind: item.kind, name: item.name, url: item.url, config: item.config, saved: Object.keys(item.secrets).filter((key) => item.secrets[key]), broken: item.broken, createdAt: item.createdAt, updatedAt: item.updatedAt });

  const mine = (session) => db().prepare("SELECT * FROM dash_integrations WHERE user_id = ? ORDER BY created_at").all(session.user_id).map(load);
  function one(session, id) {
    if (!ID.test(String(id))) throw httpError(404, "Unknown integration.");
    const row = db().prepare("SELECT * FROM dash_integrations WHERE id = ? AND user_id = ?").get(id, session.user_id);
    if (!row) throw httpError(404, "Unknown integration.");
    const item = load(row);
    if (item.broken) throw httpError(409, "This integration's password or key has to be saved again (it was saved on another server).");
    return item;
  }

  async function test(session, item) {
    const adapter = ADAPTERS[item.kind];
    try {
      return await adapter.test(contextFor(item, { allowPrivate: privateAllowed(session) }));
    } catch (error) {
      if (error.status) throw httpError(400, error.message);
      throw httpError(400, `Couldn't reach ${KINDS[item.kind].name}.`);
    }
  }

  const results = new Map(); // `${id}:${action}:${query}` -> { at, value }
  const forget = (id) => {
    sessions.delete(id);
    for (const key of results.keys()) if (key.startsWith(`${id}:`)) results.delete(key);
  };

  const writeLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false });
  const toggleLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false });
  const route = (handler) => async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    res.set("X-Content-Type-Options", "nosniff");
    try {
      const session = getRequestSession(req);
      if (!session) throw httpError(401, "Log in first.");
      const result = await handler(req, res, session);
      if (result !== undefined && !res.headersSent) res.json(result);
    } catch (error) {
      const status = error.status ?? 500;
      if (!error.status) console.error("[Dash] integration:", error.message);
      if (!res.headersSent) res.status(status).json({ error: error.status ? error.message : "Something went wrong." });
    }
  };
  const log = (session, action, item) =>
    activity?.append({ actor: { discordId: session.discord_user_id, name: session.display_name || session.username }, level: "detail", action, summary: `${action === "dash.integration.add" ? "added" : action === "dash.integration.remove" ? "removed" : "changed"} a ${KINDS[item.kind]?.name ?? item.kind} integration on their dash` });

  app.get(
    "/account/dash/integrations",
    limiter,
    requireStorage,
    route((_req, _res, session) => ({ items: mine(session).map(toPublic), privateAllowed: privateAllowed(session) })),
  );

  app.post(
    "/account/dash/integrations",
    writeLimiter,
    requireStorage,
    route(async (req, _res, session) => {
      if (mine(session).length >= MAX_PER_USER) throw httpError(400, `That's the most integrations there can be (${MAX_PER_USER}).`);
      const clean = cleanInput(String(req.body?.kind ?? ""), req.body ?? {});
      const item = { id: `int-${crypto.randomUUID()}`, ...clean, broken: false, createdAt: nowIso(), updatedAt: nowIso() };
      const message = await test(session, item);
      db()
        .prepare("INSERT INTO dash_integrations (id, user_id, kind, name, url, config_json, sealed_secret, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(item.id, session.user_id, item.kind, item.name, item.url, JSON.stringify(item.config), Object.keys(item.secrets).length ? seal(JSON.stringify(item.secrets)) : null, item.createdAt, item.updatedAt);
      log(session, "dash.integration.add", item);
      return { item: toPublic(item), message };
    }),
  );

  app.patch(
    "/account/dash/integrations/:id",
    writeLimiter,
    requireStorage,
    route(async (req, _res, session) => {
      if (!ID.test(req.params.id)) throw httpError(404, "Unknown integration.");
      const row = db().prepare("SELECT * FROM dash_integrations WHERE id = ? AND user_id = ?").get(req.params.id, session.user_id);
      if (!row) throw httpError(404, "Unknown integration.");
      const previous = load(row);
      // A broken one (another server's seal) needs its secrets typed in again.
      const clean = cleanInput(previous.kind, req.body ?? {}, previous.broken ? { ...previous, secrets: {} } : previous);
      const item = { ...previous, ...clean, broken: false, updatedAt: nowIso() };
      const message = await test(session, item);
      db()
        .prepare("UPDATE dash_integrations SET name = ?, url = ?, config_json = ?, sealed_secret = ?, updated_at = ? WHERE id = ? AND user_id = ?")
        .run(item.name, item.url, JSON.stringify(item.config), Object.keys(item.secrets).length ? seal(JSON.stringify(item.secrets)) : null, item.updatedAt, item.id, session.user_id);
      forget(item.id);
      log(session, "dash.integration.change", item);
      return { item: toPublic(item), message };
    }),
  );

  app.delete(
    "/account/dash/integrations/:id",
    writeLimiter,
    requireStorage,
    route((req, _res, session) => {
      if (!ID.test(req.params.id)) throw httpError(404, "Unknown integration.");
      const row = db().prepare("SELECT kind FROM dash_integrations WHERE id = ? AND user_id = ?").get(req.params.id, session.user_id);
      if (!row) throw httpError(404, "Unknown integration.");
      db().prepare("DELETE FROM dash_integrations WHERE id = ? AND user_id = ?").run(req.params.id, session.user_id);
      forget(req.params.id);
      log(session, "dash.integration.remove", row);
      return { ok: true };
    }),
  );

  app.post(
    "/account/dash/integrations/:id/test",
    writeLimiter,
    requireStorage,
    route(async (req, _res, session) => ({ message: await test(session, one(session, req.params.id)) })),
  );

  app.get(
    "/dash/integrations/:id/image",
    limiter,
    requireStorage,
    async (req, res) => {
      res.set("X-Content-Type-Options", "nosniff");
      res.set("Content-Security-Policy", "default-src 'none'; sandbox");
      try {
        const session = getRequestSession(req);
        if (!session) throw httpError(401, "Log in first.");
        const item = one(session, req.params.id);
        const adapter = ADAPTERS[item.kind];
        const key = String(req.query.item ?? "");
        if (!adapter.image || !/^[A-Za-z0-9_-]{1,120}$/.test(key)) throw httpError(400, "No picture.");
        const size = clampInt(req.query.size, 32, 600, 300);
        const answer = await adapter.image(contextFor(item, { allowPrivate: privateAllowed(session) }), key, size);
        if (answer.status >= 400 || !RASTER.test(answer.type)) throw httpError(404, "No picture.");
        res.set("Cache-Control", "private, max-age=86400");
        res.type(answer.type).send(answer.buffer);
      } catch (error) {
        res.set("Cache-Control", "private, no-store");
        res.status(error.status ?? 502).json({ error: error.status ? error.message : "No picture." });
      }
    },
  );

  // A file from a files integration, through the server (its login stays here): always a download, never shown as a page.
  app.get("/dash/integrations/:id/file", limiter, requireStorage, async (req, res) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Content-Security-Policy", "default-src 'none'; sandbox");
    res.set("Cache-Control", "private, no-store");
    try {
      const session = getRequestSession(req);
      if (!session) throw httpError(401, "Log in first.");
      const item = one(session, req.params.id);
      const files = ADAPTERS[item.kind].files;
      if (!files) throw httpError(404, "No files here.");
      const file = await files.file(contextFor(item, { allowPrivate: privateAllowed(session) }), req.query.path);
      res.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.name || "file")}`);
      res.type("application/octet-stream").send(file.buffer);
    } catch (error) {
      res.status(error.status ?? 502).json({ error: error.status ? error.message : "The file couldn't be loaded." });
    }
  });

  // An upload into a folder of a files integration (raw body, 50 MB at most).
  const uploadLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false });
  const rawBody = express.raw({ type: () => true, limit: "50mb" });
  app.post(
    "/dash/integrations/:id/upload",
    uploadLimiter,
    requireStorage,
    rawBody,
    route(async (req, _res, session) => {
      const item = one(session, req.params.id);
      const files = ADAPTERS[item.kind].files;
      if (!files) throw httpError(404, "This integration can't take uploads.");
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw httpError(400, "The file is empty.");
      const result = await files.upload(contextFor(item, { allowPrivate: privateAllowed(session) }), req.query.path, req.query.name, req.body);
      forget(item.id);
      log(session, "dash.integration.change", item);
      return result;
    }),
  );

  app.get(
    "/dash/integrations/:id/:action",
    limiter,
    requireStorage,
    route(async (req, _res, session) => {
      const item = one(session, req.params.id);
      const action = ADAPTERS[item.kind].actions?.[req.params.action];
      if (!action || !Object.prototype.hasOwnProperty.call(ADAPTERS[item.kind].actions, req.params.action)) throw httpError(404, "Unknown action.");
      const query = Object.fromEntries(Object.entries(req.query).filter(([, value]) => typeof value === "string").map(([key, value]) => [key, value.slice(0, 2000)]));
      const key = `${item.id}:${req.params.action}:${new URLSearchParams(query).toString()}`;
      const hit = results.get(key);
      if (hit && Date.now() - hit.at < RESULT_TTL_MS) return hit.value;
      const value = await action(contextFor(item, { allowPrivate: privateAllowed(session) }), query);
      results.set(key, { at: Date.now(), value });
      if (results.size > 3000) results.delete(results.keys().next().value);
      return value;
    }),
  );

  app.post(
    "/dash/integrations/:id/:action",
    toggleLimiter,
    requireStorage,
    route(async (req, _res, session) => {
      const item = one(session, req.params.id);
      const mutations = ADAPTERS[item.kind].mutations ?? {};
      if (!Object.prototype.hasOwnProperty.call(mutations, req.params.action)) throw httpError(404, "Unknown action.");
      const value = await mutations[req.params.action](contextFor(item, { allowPrivate: privateAllowed(session) }), req.body ?? {});
      forget(item.id);
      return value;
    }),
  );
}

module.exports = { registerDashIntegrations, ADAPTERS };
