const crypto = require("node:crypto");
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
  return { ...integration, request };
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
  if (!body) throw httpError(502, "That doesn't look like Navidrome (Subsonic API).");
  if (body.status !== "ok") throw httpError(400, `Navidrome: ${body.error?.message ?? "error"}`);
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

const ADAPTERS = {
  navidrome: {
    test: async (ctx) => {
      const body = await subsonicCall(ctx, "ping");
      return `Navidrome ${body.serverVersion ?? body.version ?? ""}`.trim();
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
