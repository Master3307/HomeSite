const LIVE_USER_UI_CSS_URL =
  "https://github.com/Master3307/HomeSite/raw/refs/heads/master/src/styles/main.css";

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function registerLiveUserUiRoute(app) {
  app.get(/^\/(\d{17,20})-ui\/?$/, (req, res) => {
    const discordUserId = req.params[0];

    res.setHeader("Cache-Control", "no-store");

    res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <title>Discord user profile</title>

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
    href="${escapeAttribute(LIVE_USER_UI_CSS_URL)}"
  >

  <style>
    .user-ui {
      padding: 24px 0 40px;
      line-height: 1.5;
    }

    .user-ui .card {
      width: calc(100% - 32px);
      max-width: 1000px;
      margin: 18px auto;
      text-align: left;
    }

    .user-ui h1,
    .user-ui h2,
    .user-ui h3,
    .user-ui p { margin: 0; }

    .user-ui h1 {
      font-size: clamp(1.7rem, 4vw, 2.5rem);
      overflow-wrap: anywhere;
    }

    .user-ui h2 { font-size: 1.15rem; }
    .user-ui h3 { font-size: 1rem; }

    .user-ui .muted {
      color: var(--text-secondary);
      font-size: 0.85rem;
      overflow-wrap: anywhere;
    }

    .user-ui .toolbar,
    .user-ui .controls,
    .user-ui .name-row,
    .user-ui .pills {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
    }

    .user-ui .toolbar { justify-content: space-between; }

    .user-ui label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.85rem;
    }

    .user-ui input[type="text"],
    .user-ui select {
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 13px;
      background: var(--bg-primary);
      color: var(--text-primary);
      font: inherit;
      min-width: 0;
    }

    .user-ui input[type="text"] {
      width: min(100%, 230px);
    }

    .user-ui button:disabled {
      opacity: 0.55;
      cursor: wait;
    }

    .user-ui .profile-card {
      padding: 0;
      overflow: hidden;
    }

    .user-ui .banner {
      display: block;
      width: 100%;
      height: clamp(130px, 25vw, 230px);
      object-fit: cover;
      background: var(--bg-primary);
    }

    .user-ui .profile-content { padding: 28px 26px; }

    .user-ui .avatar-wrap {
      position: relative;
      width: 120px;
      height: 120px;
      margin-bottom: 18px;
    }

    .user-ui .avatar {
      width: 120px;
      height: 120px;
      border-radius: 50%;
      object-fit: cover;
      background: var(--bg-primary);
    }

    .user-ui .decoration {
      position: absolute;
      top: -13px;
      left: -13px;
      width: 146px;
      height: 146px;
      object-fit: contain;
      pointer-events: none;
    }

    .user-ui .avatar-fallback {
      display: grid;
      place-items: center;
      width: 120px;
      height: 120px;
      border-radius: 50%;
      background: var(--bg-primary);
      font-size: 2.4rem;
    }

    .user-ui .profile-meta { margin-top: 8px; }
    .user-ui .pills { margin-top: 16px; }

    .user-ui .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 5px 10px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: #ffffff08;
      font-size: 0.82rem;
    }

    .user-ui .dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: #9297a1;
      flex: 0 0 auto;
    }

    .user-ui .dot[data-status="online"] { background: #43d997; }
    .user-ui .dot[data-status="idle"] { background: #f4c35a; }
    .user-ui .dot[data-status="dnd"] { background: #ff626e; }
    .user-ui .dot[data-status="unknown"] { background: #b292e6; }

    .user-ui .section-body { margin-top: 18px; }

    .user-ui dl {
      display: grid;
      grid-template-columns: minmax(120px, 0.6fr) minmax(0, 1.4fr);
      gap: 12px 16px;
      margin: 0;
      font-size: 0.88rem;
    }

    .user-ui dt { color: var(--text-secondary); }

    .user-ui dd {
      margin: 0;
      overflow-wrap: anywhere;
    }

    .user-ui .activities,
    .user-ui .guild-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 14px;
      margin-top: 18px;
    }

    .user-ui .activity,
    .user-ui .shared-guild {
      padding: 18px;
      border-radius: 13px;
      background: #ffffff08;
      border: 1px solid var(--border);
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .user-ui .shared-guild.is-primary {
      border-color: var(--link);
    }

    .user-ui .activity p { margin-top: 7px; }

    .user-ui details {
      margin-top: 16px;
      min-width: 0;
    }

    .user-ui summary {
      cursor: pointer;
      color: var(--text-secondary);
    }

    .user-ui pre {
      margin: 12px 0 0;
      padding: 14px;
      border-radius: 13px;
      background: #00000022;
      overflow: auto;
      max-height: 420px;
      font: 0.78rem/1.6 ui-monospace, monospace;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .user-ui .guild-heading {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .user-ui .guild-icon {
      width: 48px;
      height: 48px;
      border-radius: 13px;
    }

    .user-ui .message {
      margin-top: 12px;
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: 13px;
      background: #ffffff08;
      overflow-wrap: anywhere;
    }

    .user-ui .error { color: #ffb7bd; }
    .user-ui .notice { margin-top: 14px; }
    .user-ui [hidden] { display: none !important; }

    @media (max-width: 560px) {
      .user-ui .card { padding: 22px 18px; }
      .user-ui .profile-card { padding: 0; }
      .user-ui .profile-content { padding: 22px 18px; }
      .user-ui dl { grid-template-columns: 1fr; gap: 4px; }
      .user-ui dd { margin-bottom: 12px; }
      .user-ui .activities,
      .user-ui .guild-list { grid-template-columns: 1fr; }
    }
  </style>
</head>

<body>
  <main class="user-ui">
    <section class="card">
      <div class="toolbar">
        <form class="controls" id="lookup-form">
          <label for="lookup-id">Discord ID</label>
          <input
            id="lookup-id"
            type="text"
            inputmode="numeric"
            pattern="[0-9]{17,20}"
            minlength="17"
            maxlength="20"
            required
            value="${discordUserId}"
          >
          <button type="submit">Open</button>
        </form>

        <div class="controls">
          <button id="refresh" type="button">Refresh</button>

          <label>
            <input id="auto-refresh" type="checkbox">
            Auto refresh · 30s
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

      <p class="muted notice" id="updated" role="status">Loading profile…</p>
      <p class="message error" id="error" role="alert" hidden></p>
      <div id="warnings"></div>
    </section>

    <section class="card profile-card">
      <div id="profile">
        <div class="profile-content">
          <h1>Discord user</h1>
          <p class="muted">Waiting for the API…</p>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="toolbar">
        <h2>Account information</h2>
        <a id="json-link" href="../">Open JSON</a>
      </div>
      <div class="section-body" id="account"></div>
    </section>

    <section class="card">
      <h2>Presence & activities</h2>
      <p class="muted notice" id="presence-source"></p>
      <div id="presence"></div>
    </section>

    <section class="card">
      <h2>Selected shared server</h2>
      <div class="section-body" id="guild"></div>
    </section>

    <section class="card">
      <h2>All shared servers</h2>
      <p class="muted notice" id="guild-scan-summary"></p>
      <div class="guild-list" id="mutual-guilds"></div>
    </section>

    <section class="card">
      <h2>Additional data</h2>
      <p class="muted notice">
        Expand these sections to inspect fields returned by your API.
      </p>
      <div id="additional"></div>
    </section>
  </main>

  <script>
    (() => {
      "use strict";

      const USER_ID = "${discordUserId}";
      const REFRESH_MS = 30000;

      const pageUrl = new URL(window.location.href);
      pageUrl.pathname = pageUrl.pathname.replace(/\\/$/, "");
      pageUrl.search = "";
      pageUrl.hash = "";

      const apiUrl = new URL("./" + USER_ID, pageUrl);

      const ids = [
        "lookup-form", "lookup-id", "refresh", "auto-refresh",
        "theme", "updated", "error", "warnings", "profile",
        "account", "json-link", "presence", "guild", "additional",
        "presence-source", "guild-scan-summary", "mutual-guilds"
      ];

      const elements = Object.fromEntries(
        ids.map((id) => [id, document.getElementById(id)])
      );

      const statusNames = {
        online: "Online",
        idle: "AFK / Idle",
        dnd: "Do not disturb",
        offline: "Offline",
        unknown: "Unknown"
      };

      const activityTypes = {
        0: "Playing",
        1: "Streaming",
        2: "Listening",
        3: "Watching",
        4: "Custom status",
        5: "Competing"
      };

      const dateFormat = new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "medium"
      });

      let loading = false;
      let retryAfter = 0;

      function esc(value) {
        return String(value ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      }

      function safeUrl(value) {
        if (typeof value !== "string" || !value) return null;

        try {
          const url = new URL(value, window.location.href);
          return ["https:", "http:"].includes(url.protocol)
            ? url.href
            : null;
        } catch {
          return null;
        }
      }

      function imageHtml(value, className, alt) {
        const url = safeUrl(value);

        return url
          ? '<img class="' + esc(className) +
            '" src="' + esc(url) +
            '" alt="' + esc(alt) +
            '" referrerpolicy="no-referrer">'
          : "";
      }

      function dateText(value) {
        if (value === null || value === undefined || value === "") {
          return "Not available";
        }

        const date = new Date(value);

        return Number.isFinite(date.getTime())
          ? dateFormat.format(date)
          : "Not available";
      }

      function valueHtml(value) {
        if (value === null || value === undefined) {
          return '<span class="muted">Not available</span>';
        }

        if (typeof value === "boolean") return value ? "Yes" : "No";

        if (typeof value === "object") {
          return '<pre>' + esc(JSON.stringify(value, null, 2)) + '</pre>';
        }

        return esc(value);
      }

      function fieldsHtml(entries) {
        return '<dl>' + entries.map(([label, value]) =>
          '<dt>' + esc(label) + '</dt><dd>' +
          valueHtml(value) + '</dd>'
        ).join("") + '</dl>';
      }

      function detailsHtml(title, value) {
        return '<details><summary>' + esc(title) +
          '</summary><pre>' +
          esc(JSON.stringify(value ?? null, null, 2)) +
          '</pre></details>';
      }

      function badgeHtml(value, label) {
        const status = Object.hasOwn(statusNames, value)
          ? value
          : "unknown";

        return '<span class="pill">' +
          '<span class="dot" data-status="' + status +
          '" aria-hidden="true"></span>' +
          (label ? esc(label) + ': ' : "") +
          esc(statusNames[status]) + '</span>';
      }

      function selectionText(data) {
        if (data.guild) {
          return (data.lookup?.selected_guild_source === "configured"
            ? "Preferred server: "
            : "Fallback server: ") + data.guild.name;
        }

        if (data.mutual_guilds?.length) {
          return "Shared servers found; none currently available for selection";
        }

        return data.guild_scan?.complete
          ? "No shared servers found"
          : "Shared-server scan incomplete";
      }

      function render(data) {
        const user = data.user ?? {};
        const name = user.global_name || user.username || USER_ID;

        const username = user.username
          ? "@" + user.username +
            (user.discriminator && user.discriminator !== "0"
              ? "#" + user.discriminator
              : "")
          : USER_ID;

        const presence = data.presence;
        const avatar = safeUrl(user.avatar);

        document.title = name + " · Discord profile";

        elements.profile.innerHTML =
          imageHtml(user.banner, "banner", "Profile banner") +
          '<div class="profile-content">' +
          '<div class="avatar-wrap">' +
          (avatar
            ? imageHtml(avatar, "avatar", name + " avatar")
            : '<div class="avatar-fallback">' +
              esc(Array.from(name)[0] ?? "?") + '</div>') +
          imageHtml(user.avatar_decoration, "decoration", "") +
          '</div><div class="name-row"><h1>' + esc(name) + '</h1>' +
          badgeHtml(presence?.status ?? "unknown") + '</div>' +
          '<p class="muted profile-meta">' + esc(username) + '</p>' +
          '<p class="muted profile-meta">User ' + esc(user.id ?? USER_ID) +
          '</p><div class="pills">' +
          (user.bot ? '<span class="pill">Bot</span>' : "") +
          (user.system ? '<span class="pill">System account</span>' : "") +
          '<span class="pill">' + esc(selectionText(data)) +
          '</span><span class="pill">' +
          esc(data.mutual_guilds?.length ?? 0) +
          ' verified shared servers</span></div></div>';

        elements.account.innerHTML = fieldsHtml([
          ["User ID", user.id],
          ["Username", user.username],
          ["Display name", user.global_name],
          ["Account created", dateText(user.created_at)],
          ["Bot account", user.bot],
          ["System account", user.system],
          ["Public flags", user.public_flags],
          ["Badges", user.badges]
        ]);

        elements["presence-source"].textContent = data.guild
          ? "Gateway presence from " + data.guild.name +
            " · " + data.guild.id
          : "No available verified shared server selected.";

        renderPresence(presence);
        renderGuild(data);
        renderMutualGuilds(data);

        elements.additional.innerHTML =
          detailsHtml("Lookup information", data.lookup) +
          detailsHtml("Guild scan information", data.guild_scan) +
          detailsHtml("Formatted user", user) +
          detailsHtml("User's primary guild identity", user.primary_guild) +
          detailsHtml("Collectibles", user.collectibles) +
          detailsHtml("Raw Discord user", data.raw_user);

        elements.warnings.innerHTML = (data.warnings ?? [])
          .map((warning) =>
            '<p class="message">' +
            esc(warning.scope ?? "Warning") + ': ' +
            esc(warning.message ?? JSON.stringify(warning)) +
            '</p>'
          ).join("");

        elements.updated.textContent =
          "Fetched " + dateText(data.fetched_at) +
          " · Times use your browser's local timezone.";

        document.querySelectorAll(".user-ui img").forEach((image) => {
          image.addEventListener("error", () => {
            image.hidden = true;
          }, { once: true });
        });
      }

      function renderPresence(presence) {
        if (!presence) {
          elements.presence.innerHTML =
            '<p class="muted notice">' +
            'Presence unavailable. This does not mean offline.</p>';
          return;
        }

        const clients = presence.client_status ?? {};
        let html = '<div class="pills">' +
          badgeHtml(presence.status, "Overall");

        for (const platform of ["desktop", "mobile", "web"]) {
          html += badgeHtml(
            clients[platform] ?? "unknown",
            platform
          );
        }

        html += '</div>';

        const activities = Array.isArray(presence.activities)
          ? presence.activities
          : [];

        if (activities.length) {
          html += '<div class="activities">' +
            activities.map((activity) => {
              const type =
                activityTypes[activity.type] ??
                activity.type_label ??
                "Activity";

              return '<article class="activity">' +
                '<p class="muted">' + esc(type) + '</p>' +
                '<h3>' + esc(activity.name ?? "Activity") + '</h3>' +
                (activity.details
                  ? '<p>' + esc(activity.details) + '</p>'
                  : "") +
                (activity.state
                  ? '<p class="muted">' + esc(activity.state) + '</p>'
                  : "") +
                detailsHtml("Activity data", activity) +
                '</article>';
            }).join("") + '</div>';
        } else {
          html += '<p class="muted notice">' +
            'No activities exposed in the formatted presence.</p>';
        }

        html += detailsHtml("Complete formatted presence", presence);
        elements.presence.innerHTML = html;
      }

      function renderGuild(data) {
        const guild = data.guild;
        const member = data.member;

        if (!guild || !member) {
          elements.guild.innerHTML =
            '<p class="muted">' + esc(selectionText(data)) + '</p>';
          return;
        }

        let html =
          '<p class="muted">' +
          (data.lookup?.selected_guild_source === "configured"
            ? "The user belongs to the preferred server."
            : "Using the first available verified shared server as fallback.") +
          '</p><div class="guild-heading notice">' +
          imageHtml(guild.icon, "guild-icon", "") +
          '<h3>' + esc(guild.name) + '</h3>' +
          '</div><div class="section-body">' +
          fieldsHtml([
            ["Guild ID", guild.id],
            ["Member count", guild.member_count]
          ]) + '</div>';

        html += '<div class="section-body">' +
          fieldsHtml(
            Object.entries(member).map(([key, value]) => [
              key.replaceAll("_", " "),
              value
            ])
          ) + '</div>';

        html += detailsHtml("Complete member data", member);
        elements.guild.innerHTML = html;
      }

      function renderMutualGuilds(data) {
        const guilds = data.mutual_guilds ?? [];
        const scan = data.guild_scan ?? {};

        elements["guild-scan-summary"].textContent =
          guilds.length + " verified shared servers · " +
          (scan.complete
            ? "All enumerated bot guilds checked successfully"
            : "Incomplete scan: some guilds could not be listed or checked") +
          " · " + (scan.bot_guild_count ?? 0) + " bot guilds enumerated";

        if (!guilds.length) {
          elements["mutual-guilds"].innerHTML =
            '<p class="muted">' +
            (scan.complete
              ? "No servers shared with this bot were found."
              : "No shared servers verified yet. Failed checks may hide additional matches.") +
            '</p>';
          return;
        }

        elements["mutual-guilds"].innerHTML = guilds.map((guild) => {
          const member = guild.member ?? {};
          const roles = Array.isArray(member.roles)
            ? member.roles.map((role) => role.name).join(", ")
            : "";

          return '<article class="shared-guild' +
            (guild.is_primary ? ' is-primary' : '') + '">' +
            '<div class="guild-heading">' +
            imageHtml(guild.icon, "guild-icon", "") +
            '<h3>' + esc(guild.name) + '</h3></div>' +
            '<div class="pills">' +
            (guild.is_primary
              ? '<span class="pill">Selected server</span>'
              : "") +
            (guild.is_configured
              ? '<span class="pill">Preferred server</span>'
              : "") +
            (!guild.available
              ? '<span class="pill">Currently unavailable</span>'
              : "") +
            badgeHtml(guild.presence?.status ?? "unknown") +
            '</div><div class="section-body">' +
            fieldsHtml([
              ["Guild ID", guild.id],
              ["Member count", guild.member_count],
              ["Display name", member.display_name],
              ["Nickname", member.nickname],
              ["Joined", dateText(member.joined_at)],
              ["Roles", roles || "None"]
            ]) + '</div>' +
            detailsHtml("Member details", guild.member) +
            detailsHtml("Presence details", guild.presence) +
            '</article>';
        }).join("");
      }

      async function refresh() {
        if (loading) return;

        if (Date.now() < retryAfter) {
          elements.error.hidden = false;
          elements.error.textContent =
            "Please wait before retrying: " +
            Math.ceil((retryAfter - Date.now()) / 1000) + " seconds.";
          return;
        }

        loading = true;
        elements.refresh.disabled = true;
        elements.refresh.textContent = "Scanning guilds…";

        const controller = new AbortController();

        // Full guild scans can take longer than a single-user lookup.
        const timeout = setTimeout(() => controller.abort(), 120000);

        try {
          const response = await fetch(apiUrl, {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal
          });

          const retryHeader = Number(response.headers.get("Retry-After"));

          if (Number.isFinite(retryHeader) && retryHeader > 0) {
            retryAfter = Date.now() + retryHeader * 1000;
          }

          let data;

          try {
            data = await response.json();
          } catch {
            throw new Error(
              "The API returned a non-JSON response (HTTP " +
              response.status + ")."
            );
          }

          if (!response.ok) {
            throw new Error(
              data.error ?? ("API returned HTTP " + response.status)
            );
          }

          render(data);
          elements.error.hidden = true;
          elements.error.textContent = "";
        } catch (error) {
          elements.error.hidden = false;
          elements.error.textContent =
            (error.name === "AbortError"
              ? "The guild scan request timed out."
              : error.message) +
            " Any previously displayed profile may be out of date.";
        } finally {
          clearTimeout(timeout);
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
          localStorage.setItem("discord-profile-ui-theme", value);
        } catch {}
      }

      let theme = "dark";

      try {
        const saved = localStorage.getItem("discord-profile-ui-theme");
        if (["dark", "light", "system"].includes(saved)) theme = saved;
      } catch {}

      elements.theme.value = theme;
      applyTheme(theme);

      elements.theme.addEventListener("change", () => {
        applyTheme(elements.theme.value);
      });

      elements["json-link"].href = apiUrl.href;

      elements["lookup-form"].addEventListener("submit", (event) => {
        event.preventDefault();

        const id = elements["lookup-id"].value.trim();

        if (!/^\\d{17,20}$/.test(id)) {
          elements.error.hidden = false;
          elements.error.textContent = "Enter a 17–20 digit Discord ID.";
          return;
        }

        window.location.assign(new URL("./" + id + "-ui", pageUrl));
      });

      elements.refresh.addEventListener("click", refresh);

      elements["auto-refresh"].addEventListener("change", () => {
        if (elements["auto-refresh"].checked) void refresh();
      });

      setInterval(() => {
        if (elements["auto-refresh"].checked && !document.hidden) {
          void refresh();
        }
      }, REFRESH_MS);

      document.addEventListener("visibilitychange", () => {
        if (!document.hidden && elements["auto-refresh"].checked) {
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
