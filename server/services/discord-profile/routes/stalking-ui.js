const STALKING_UI_CSS_URL =
  "https://github.com/Master3307/HomeSite/raw/refs/heads/master/src/styles/main.css";

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function registerStalkingUiRoute(app) {
  app.get("/stalking-ui", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");

    res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <title>Discord presence history</title>

  <style>
    :root {
      --bg-primary: #150a24;
      --bg-secondary: #63369e;
      --text-primary: #eee;
      --text-secondary: #c0bfe6;
      --accent: #3d29d4;
      --accent-hover: #594bd667;
      --border: #47405b;
      --link: #00d5ff;
    }

    :root[data-theme="light"] {
      --bg-primary: #b28ee1;
      --bg-secondary: #8452c5;
      --text-primary: #eee;
      --text-secondary: #c1bdce;
      --accent: #5f4ee6;
      --accent-hover: #4638c9;
      --border: #e6e0f6;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text-primary);
      background: linear-gradient(
        to bottom,
        var(--bg-secondary),
        var(--bg-primary)
      ) fixed;
      font-family: system-ui, sans-serif;
    }

    .card {
      position: relative;
      width: 95%;
      max-width: 777px;
      margin: 42px auto;
      padding: 28px 26px;
      background: #ffffff04;
      border-radius: 13px;
      backdrop-filter: blur(13px);
      -webkit-backdrop-filter: blur(13px);
      box-shadow:
        0 10px 30px rgba(0, 0, 0, 0.14),
        inset 0 1px 0 rgba(255, 255, 255, 0.047);
    }

    button {
      padding: 10px 16px;
      border: 0;
      border-radius: 13px;
      background: var(--accent);
      color: var(--text-primary);
      cursor: pointer;
      font: inherit;
    }

    a { color: var(--link); }
  </style>

  <link
    rel="stylesheet"
    href="${escapeAttribute(STALKING_UI_CSS_URL)}"
  >

  <style>
    .stalking-ui {
      padding: 24px 0 40px;
      line-height: 1.5;
    }

    .stalking-ui .card {
      width: calc(100% - 32px);
      max-width: 1100px;
      margin: 18px auto;
      text-align: left;
    }

    .stalking-ui h1,
    .stalking-ui h2,
    .stalking-ui p { margin: 0; }

    .stalking-ui h1 {
      font-size: clamp(1.65rem, 4vw, 2.4rem);
    }

    .stalking-ui h2 { font-size: 1.15rem; }

    .stalking-ui .muted {
      color: var(--text-secondary);
      font-size: 0.85rem;
      overflow-wrap: anywhere;
    }

    .stalking-ui .toolbar,
    .stalking-ui .section-heading,
    .stalking-ui .links,
    .stalking-ui .status-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }

    .stalking-ui .controls,
    .stalking-ui .profile-pills,
    .stalking-ui .profile-name-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
    }

    .stalking-ui label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.85rem;
    }

    .stalking-ui select {
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 13px;
      color: var(--text-primary);
      background: var(--bg-primary);
      font: inherit;
    }

    .stalking-ui button:disabled {
      opacity: 0.55;
      cursor: wait;
    }

    .stalking-ui .identity,
    .stalking-ui .notice { margin-top: 14px; }

    .stalking-ui .monitoring {
      margin-top: 18px;
      padding: 12px 14px;
      border-radius: 13px;
      background: #ffffff08;
      border: 1px solid var(--border);
    }

    .stalking-ui .error {
      margin-top: 12px;
      color: #ffb7bd;
      overflow-wrap: anywhere;
    }

    .stalking-ui .profile-card {
      padding: 0;
      overflow: hidden;
    }

    .stalking-ui .profile-banner {
      display: block;
      width: 100%;
      height: clamp(130px, 24vw, 230px);
      object-fit: cover;
      background: var(--bg-primary);
    }

    .stalking-ui .profile-body {
      padding: 26px;
    }

    .stalking-ui .profile-main {
      display: flex;
      align-items: center;
      gap: 24px;
    }

    .stalking-ui .profile-avatar-wrap {
      position: relative;
      width: 120px;
      height: 120px;
      flex: 0 0 auto;
    }

    .stalking-ui .profile-avatar {
      display: block;
      width: 120px;
      height: 120px;
      border-radius: 50%;
      object-fit: cover;
      background: var(--bg-primary);
    }

    .stalking-ui .profile-avatar-fallback {
      display: grid;
      place-items: center;
      width: 120px;
      height: 120px;
      border-radius: 50%;
      background: var(--bg-primary);
      font-size: 2.5rem;
    }

    .stalking-ui .profile-decoration {
      position: absolute;
      top: -13px;
      left: -13px;
      width: 146px;
      height: 146px;
      object-fit: contain;
      pointer-events: none;
    }

    .stalking-ui .profile-info {
      min-width: 0;
      flex: 1;
    }

    .stalking-ui .profile-name {
      font-size: clamp(1.5rem, 4vw, 2rem);
      overflow-wrap: anywhere;
    }

    .stalking-ui .profile-info p { margin-top: 7px; }

    .stalking-ui .profile-pills { margin-top: 14px; }

    .stalking-ui .profile-links {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      margin-top: 18px;
      font-size: 0.85rem;
    }

    .stalking-ui .status-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
      width: calc(100% - 32px);
      max-width: 1100px;
      margin: 18px auto;
    }

    .stalking-ui .status-grid .card {
      width: 100%;
      margin: 0;
      padding: 22px 18px;
    }

    .stalking-ui .status-heading { margin-bottom: 14px; }

    .stalking-ui .status-badge,
    .stalking-ui .info-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 5px 10px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: #ffffff08;
      font-size: 0.82rem;
    }

    .stalking-ui .status-badge { white-space: nowrap; }

    .stalking-ui .status-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: #9297a1;
      flex: 0 0 auto;
    }

    .stalking-ui .status-dot[data-status="online"] {
      background: #43d997;
    }

    .stalking-ui .status-dot[data-status="idle"] {
      background: #f4c35a;
    }

    .stalking-ui .status-dot[data-status="dnd"] {
      background: #ff626e;
    }

    .stalking-ui .status-dot[data-status="unknown"] {
      background: #b292e6;
    }

    .stalking-ui dl {
      display: grid;
      grid-template-columns: minmax(100px, 0.8fr) minmax(0, 1.2fr);
      gap: 12px;
      margin: 0;
      font-size: 0.85rem;
    }

    .stalking-ui dt { color: var(--text-secondary); }

    .stalking-ui dd {
      margin: 0;
      overflow-wrap: anywhere;
    }

    .stalking-ui time {
      display: block;
      font-variant-numeric: tabular-nums;
    }

    .stalking-ui .relative {
      display: block;
      margin-top: 2px;
      color: var(--text-secondary);
      font-size: 0.75rem;
    }

    .stalking-ui .history-wrap {
      overflow-x: auto;
      margin-top: 18px;
    }

    .stalking-ui table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
      min-width: 650px;
    }

    .stalking-ui th,
    .stalking-ui td {
      text-align: left;
      padding: 12px 10px;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }

    .stalking-ui th {
      color: var(--text-secondary);
      font-weight: 500;
    }

    .stalking-ui .history-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 16px;
    }

    .stalking-ui [hidden] { display: none !important; }

    @media (max-width: 760px) {
      .stalking-ui .status-grid { grid-template-columns: 1fr; }
      .stalking-ui .card { padding: 22px 18px; }
      .stalking-ui .profile-card { padding: 0; }
      .stalking-ui .profile-body { padding: 24px 18px; }
    }

    @media (max-width: 500px) {
      .stalking-ui .profile-main {
        flex-direction: column;
        align-items: flex-start;
      }
    }
  </style>
</head>

<body>
  <main class="stalking-ui">
    <header class="card">
      <div class="toolbar">
        <div>
          <h1>Discord presence</h1>
          <p class="muted identity" id="identity">Loading tracker…</p>
        </div>

        <div class="controls">
          <button id="refresh" type="button">Refresh</button>

          <label>
            <input id="auto-refresh" type="checkbox" checked>
            Auto refresh
          </label>

          <label>
            Theme
            <select id="theme">
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </select>
          </label>
        </div>
      </div>

      <div class="monitoring" id="monitoring" role="status">
        Connecting to the API…
      </div>

      <p class="error" id="error" role="alert" hidden></p>

      <div class="links notice">
        <p class="muted" id="updated">No snapshot loaded.</p>

        <div class="controls">
          <a id="state-link" href="./stalking">State JSON</a>
          <a id="history-link" href="./stalking-history">History JSON</a>
        </div>
      </div>
    </header>

    <section class="card profile-card" aria-label="Tracked user profile">
      <div id="profile">
        <div class="profile-body">
          <h2>Tracked user</h2>
          <p class="muted notice">Loading profile information…</p>
        </div>
      </div>
    </section>

    <section class="card" aria-label="Overall presence">
      <div id="overall"></div>
    </section>

    <section class="status-grid" aria-label="Client presence">
      <article class="card" id="desktop"></article>
      <article class="card" id="mobile"></article>
      <article class="card" id="web"></article>
    </section>

    <section class="card">
      <div class="section-heading">
        <div>
          <h2>Status history</h2>
          <p class="muted" id="history-summary">Loading history…</p>
        </div>

        <div class="controls">
          <label>
            Scope
            <select id="scope-filter">
              <option value="all">All scopes</option>
              <option value="overall">Overall</option>
              <option value="desktop">Desktop</option>
              <option value="mobile">Mobile</option>
              <option value="web">Web</option>
              <option value="monitoring">Monitoring</option>
            </select>
          </label>

          <label>
            Status
            <select id="status-filter">
              <option value="all">All statuses</option>
              <option value="online">Online</option>
              <option value="idle">AFK / Idle</option>
              <option value="dnd">Do not disturb</option>
              <option value="offline">Offline</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
        </div>
      </div>

      <div class="history-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Observed at</th>
              <th scope="col">Scope</th>
              <th scope="col">Event / transition</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody id="history-body"></tbody>
        </table>
      </div>

      <div class="history-footer">
        <p class="muted" id="history-count"></p>
        <button id="load-more" type="button" hidden>Load more</button>
      </div>

      <p class="muted notice">
        Times use your browser's local timezone. Last seen and status
        timestamps are tracker observations, not confirmed user interaction.
        Unknown means monitoring or presence information was unavailable.
        Offline does not distinguish invisible status.
      </p>
    </section>
  </main>

  <script>
    (() => {
      "use strict";

      const REFRESH_MS = 10000;
      const PROFILE_REFRESH_MS = 5 * 60 * 1000;
      const PAGE_SIZE = 100;

      const pageUrl = new URL(window.location.href);
      pageUrl.pathname = pageUrl.pathname.replace(/\\/$/, "");
      pageUrl.search = "";
      pageUrl.hash = "";

      const elements = Object.fromEntries(
        [
          "identity", "monitoring", "error", "updated",
          "profile", "overall", "desktop", "mobile", "web",
          "refresh", "auto-refresh", "theme",
          "scope-filter", "status-filter",
          "history-summary", "history-body",
          "history-count", "load-more",
          "state-link", "history-link"
        ].map((id) => [id, document.getElementById(id)])
      );

      const statusNames = {
        online: "Online",
        idle: "AFK / Idle",
        dnd: "Do not disturb",
        offline: "Offline",
        unknown: "Unknown"
      };

      const eventNames = {
        tracker_started: "Tracker started",
        tracker_stopped: "Tracker stopped",
        monitoring_connected: "Monitoring connected",
        monitoring_gap: "Monitoring gap"
      };

      const dateFormat = new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "medium"
      });

      const relativeFormat = new Intl.RelativeTimeFormat(undefined, {
        numeric: "auto"
      });

      let historyEvents = [];
      let visibleCount = PAGE_SIZE;
      let loading = false;
      let latestState = null;
      let profileData = null;
      let profileUserId = null;
      let lastProfileAttempt = 0;
      let profileRetryAfter = 0;
      let profileError = "";

      function endpointUrl(endpoint) {
        return new URL(endpoint, pageUrl);
      }

      elements["state-link"].href = endpointUrl("./stalking").href;
      elements["history-link"].href =
        endpointUrl("./stalking-history").href;

      function escapeHtml(value) {
        return String(value ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      }

      function safeImageUrl(value) {
        if (typeof value !== "string" || !value) return null;

        try {
          const url = new URL(value, pageUrl);

          return ["https:", "http:"].includes(url.protocol)
            ? url.href
            : null;
        } catch {
          return null;
        }
      }

      function imageHtml(value, className, alt) {
        const url = safeImageUrl(value);

        return url
          ? '<img class="' + escapeHtml(className) +
            '" src="' + escapeHtml(url) +
            '" alt="' + escapeHtml(alt) +
            '" referrerpolicy="no-referrer">'
          : "";
      }

      function relativeTime(value) {
        const seconds = (Date.parse(value) - Date.now()) / 1000;
        if (!Number.isFinite(seconds)) return "";

        const units = [
          ["day", 86400],
          ["hour", 3600],
          ["minute", 60],
          ["second", 1]
        ];

        for (const [unit, size] of units) {
          if (Math.abs(seconds) >= size || unit === "second") {
            return relativeFormat.format(
              Math.round(seconds / size),
              unit
            );
          }
        }
      }

      function dateText(value) {
        if (!value) return "Not available";

        const milliseconds = new Date(value).getTime();

        return Number.isFinite(milliseconds)
          ? dateFormat.format(new Date(milliseconds))
          : "Not available";
      }

      function timeHtml(value) {
        const milliseconds = Date.parse(value);

        if (!value || !Number.isFinite(milliseconds)) {
          return '<span class="muted">Not observed</span>';
        }

        const iso = new Date(milliseconds).toISOString();

        return '<time datetime="' + escapeHtml(iso) +
          '" title="' + escapeHtml(iso) + '">' +
          escapeHtml(dateFormat.format(new Date(milliseconds))) +
          '</time><span class="relative">' +
          escapeHtml(relativeTime(iso)) + '</span>';
      }

      function badgeHtml(status) {
        const safeStatus = Object.hasOwn(statusNames, status)
          ? status
          : "unknown";

        return '<span class="status-badge">' +
          '<span class="status-dot" data-status="' +
          safeStatus + '" aria-hidden="true"></span>' +
          escapeHtml(statusNames[safeStatus]) + '</span>';
      }

      function infoPill(value) {
        return '<span class="info-pill">' +
          escapeHtml(value) + '</span>';
      }

      function renderProfile() {
        const user = profileData?.user ?? {};
        const id = latestState?.user_id ?? profileUserId;
        const name = user.global_name || user.username || "Tracked user";

        const username = user.username
          ? "@" + user.username +
            (user.discriminator && user.discriminator !== "0"
              ? "#" + user.discriminator
              : "")
          : "Profile information unavailable";

        const avatar = safeImageUrl(user.avatar);
        const banner = imageHtml(
          user.banner,
          "profile-banner",
          "Profile banner"
        );

        const membership = {
          member: "Member of configured server",
          not_member: "Not in configured server",
          unavailable: "Membership unavailable"
        }[profileData?.lookup?.membership_status];

        const pills = [];

        if (user.bot) pills.push(infoPill("Bot"));
        if (user.system) pills.push(infoPill("System account"));

        if (profileData?.guild?.name) {
          pills.push(infoPill(profileData.guild.name));
        }

        if (membership) pills.push(infoPill(membership));

        if (user.created_at) {
          pills.push(infoPill("Created " + dateText(user.created_at)));
        }

        const profileLink = id
          ? endpointUrl("./" + id + "-ui").href
          : null;

        const jsonLink = id
          ? endpointUrl("./" + id).href
          : null;

        elements.profile.innerHTML =
          banner +
          '<div class="profile-body">' +
          '<div class="profile-main">' +
          '<div class="profile-avatar-wrap">' +
          '<div class="profile-avatar-fallback"' +
          (avatar ? ' hidden' : '') + '>' +
          escapeHtml(Array.from(name)[0] ?? "?") + '</div>' +
          (avatar
            ? imageHtml(avatar, "profile-avatar", name + " avatar")
            : "") +
          imageHtml(
            user.avatar_decoration,
            "profile-decoration",
            ""
          ) +
          '</div><div class="profile-info">' +
          '<div class="profile-name-row">' +
          '<h2 class="profile-name">' + escapeHtml(name) + '</h2>' +
          badgeHtml(latestState?.overall?.status) +
          '</div><p class="muted">' + escapeHtml(username) + '</p>' +
          '<p class="muted">User ' + escapeHtml(id ?? "Unknown") + '</p>' +
          '<div class="profile-pills">' + pills.join("") + '</div>' +
          (profileError
            ? '<p class="error">' + escapeHtml(profileError) + '</p>'
            : "") +
          '<div class="profile-links">' +
          (profileLink
            ? '<a href="' + escapeHtml(profileLink) +
              '">Full user profile</a>'
            : "") +
          (jsonLink
            ? '<a href="' + escapeHtml(jsonLink) +
              '">User JSON</a>'
            : "") +
          '</div></div></div></div>';

        elements.profile.querySelectorAll("img").forEach((image) => {
          image.addEventListener("error", () => {
            image.hidden = true;

            if (image.classList.contains("profile-avatar")) {
              const fallback = elements.profile.querySelector(
                ".profile-avatar-fallback"
              );

              if (fallback) fallback.hidden = false;
            }
          }, { once: true });
        });
      }

      function renderRecord(container, title, record) {
        const value = record ?? {};

        const fields = [
          ["Status observed since", "status_since"],
          ["Last observed", "last_observed_at"],
          ["Last seen", "last_seen_at"],
          ["Last online", "last_online_at"],
          ["Last AFK / Idle", "last_afk_at"],
          ["Last DND", "last_dnd_at"],
          ["Offline transition", "offline_since"],
          ["Offline observed since", "offline_observed_since"]
        ];

        container.innerHTML =
          '<div class="status-heading"><h2>' +
          escapeHtml(title) + '</h2>' +
          badgeHtml(value.status) + '</div><dl>' +
          fields.map(([label, key]) =>
            '<dt>' + escapeHtml(label) + '</dt><dd>' +
            timeHtml(value[key]) + '</dd>'
          ).join("") + '</dl>';
      }

      function renderState(state) {
        latestState = state;

        elements.identity.textContent =
          "User " + state.user_id + " · Guild " + state.guild_id;

        const tracking = state.tracking ?? {};

        const details = [
          tracking.connected
            ? "Gateway connected"
            : "Monitoring unavailable",
          tracking.membership_verified
            ? "Membership verified"
            : "Membership not verified",
          tracking.presence_available
            ? "Presence available"
            : "Presence unknown"
        ];

        if (tracking.last_error?.message) {
          details.push("Tracker error: " + tracking.last_error.message);
        }

        elements.monitoring.textContent = details.join(" · ");

        elements.updated.innerHTML =
          'Snapshot updated: ' + timeHtml(state.updated_at) +
          '<span class="relative">Last received Gateway event: ' +
          escapeHtml(
            state.tracking?.last_gateway_event_at
              ? dateText(state.tracking.last_gateway_event_at)
              : "None recorded"
          ) + '</span>';

        renderRecord(elements.overall, "Overall", state.overall);
        renderRecord(elements.desktop, "Desktop", state.clients?.desktop);
        renderRecord(elements.mobile, "Mobile", state.clients?.mobile);
        renderRecord(elements.web, "Web browser", state.clients?.web);
      }

      function renderHistory() {
        const scope = elements["scope-filter"].value;
        const status = elements["status-filter"].value;

        const filtered = historyEvents.filter((event) => {
          const matchesScope =
            scope === "all" ||
            (scope === "monitoring"
              ? event.type !== "status_change"
              : event.scope === scope);

          const matchesStatus =
            status === "all" ||
            (event.type === "status_change" && event.to === status);

          return matchesScope && matchesStatus;
        });

        const shown = filtered.slice(0, visibleCount);

        elements["history-body"].innerHTML = shown.length
          ? shown.map((event) => {
              const description = event.type === "status_change"
                ? badgeHtml(event.from) + ' → ' + badgeHtml(event.to)
                : escapeHtml(eventNames[event.type] ?? event.type);

              return '<tr><td>' + timeHtml(event.at) +
                '</td><td>' + escapeHtml(event.scope ?? "monitoring") +
                '</td><td>' + description +
                '</td><td>' + escapeHtml(event.source ?? "—") +
                '</td></tr>';
            }).join("")
          : '<tr><td colspan="4" class="muted">' +
            'No matching history entries.</td></tr>';

        elements["history-count"].textContent =
          "Showing " + shown.length + " of " +
          filtered.length + " matching entries · newest first";

        elements["load-more"].hidden =
          shown.length >= filtered.length;
      }

      async function fetchJson(endpoint) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);

        try {
          const response = await fetch(endpointUrl(endpoint), {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal
          });

          let data;

          try {
            data = await response.json();
          } catch {
            throw new Error(
              endpoint + " returned a non-JSON response."
            );
          }

          if (!response.ok) {
            const error = new Error(
              data.error ??
              (endpoint + " returned HTTP " + response.status)
            );

            const retrySeconds = Number(
              response.headers.get("Retry-After")
            );

            error.retrySeconds =
              Number.isFinite(retrySeconds) && retrySeconds > 0
                ? retrySeconds
                : 0;

            throw error;
          }

          return data;
        } finally {
          clearTimeout(timeout);
        }
      }

      async function refreshProfile(force) {
        const userId = latestState?.user_id;
        if (!userId || !/^\\d{17,20}$/.test(userId)) return;

        if (profileUserId !== userId) {
          profileUserId = userId;
          profileData = null;
          profileError = "";
          lastProfileAttempt = 0;
          profileRetryAfter = 0;
        }

        const now = Date.now();

        if (now < profileRetryAfter) return;

        if (
          !force &&
          lastProfileAttempt &&
          now - lastProfileAttempt < PROFILE_REFRESH_MS
        ) {
          return;
        }

        lastProfileAttempt = now;

        try {
          profileData = await fetchJson("./" + userId);
          profileError = "";
        } catch (error) {
          profileError =
            "Could not refresh profile: " + error.message +
            (profileData ? " Showing previously loaded profile." : "");

          if (error.retrySeconds) {
            profileRetryAfter =
              Date.now() + error.retrySeconds * 1000;
          }
        }
      }

      async function refresh(forceProfile = false) {
        if (loading) return;

        loading = true;
        elements.refresh.disabled = true;
        elements.refresh.textContent = "Refreshing…";

        try {
          const results = await Promise.allSettled([
            fetchJson("./stalking"),
            fetchJson("./stalking-history")
          ]);

          const errors = [];

          if (results[0].status === "fulfilled") {
            renderState(results[0].value);
          } else {
            errors.push("State: " + results[0].reason.message);
          }

          if (results[1].status === "fulfilled") {
            const history = results[1].value;

            historyEvents = [...(history.events ?? [])].sort(
              (left, right) =>
                Date.parse(right.at) - Date.parse(left.at)
            );

            elements["history-summary"].textContent =
              "Rolling " + history.retention_days +
              "-day history · " + historyEvents.length +
              " retained entries";

            renderHistory();
          } else {
            errors.push("History: " + results[1].reason.message);
          }

          await refreshProfile(forceProfile);

          if (latestState) renderProfile();

          elements.error.hidden = errors.length === 0;
          elements.error.textContent = errors.length
            ? errors.join(" · ") +
              " — previously loaded tracking data may be out of date."
            : "";
        } catch (error) {
          elements.error.hidden = false;
          elements.error.textContent =
            "Could not update the UI: " + error.message;
        } finally {
          loading = false;
          elements.refresh.disabled = false;
          elements.refresh.textContent = "Refresh";
        }
      }

      function applyTheme(value) {
        if (value === "system") {
          delete document.documentElement.dataset.theme;
        } else {
          document.documentElement.dataset.theme = value;
        }

        try {
          localStorage.setItem("stalking-ui-theme", value);
        } catch {}
      }

      let savedTheme = "dark";

      try {
        const stored = localStorage.getItem("stalking-ui-theme");

        if (["dark", "light", "system"].includes(stored)) {
          savedTheme = stored;
        }
      } catch {}

      elements.theme.value = savedTheme;
      applyTheme(savedTheme);

      elements.theme.addEventListener("change", () => {
        applyTheme(elements.theme.value);
      });

      elements.refresh.addEventListener("click", () => {
        void refresh(true);
      });

      for (const id of ["scope-filter", "status-filter"]) {
        elements[id].addEventListener("change", () => {
          visibleCount = PAGE_SIZE;
          renderHistory();
        });
      }

      elements["load-more"].addEventListener("click", () => {
        visibleCount += PAGE_SIZE;
        renderHistory();
      });

      elements["auto-refresh"].addEventListener("change", () => {
        if (elements["auto-refresh"].checked) {
          void refresh();
        }
      });

      setInterval(() => {
        if (
          elements["auto-refresh"].checked &&
          !document.hidden
        ) {
          void refresh();
        }
      }, REFRESH_MS);

      document.addEventListener("visibilitychange", () => {
        if (
          !document.hidden &&
          elements["auto-refresh"].checked
        ) {
          void refresh();
        }
      });

      void refresh();
    })();
  </script>
</body>
</html>`);
  });
}
