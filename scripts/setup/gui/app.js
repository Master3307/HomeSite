/*
 * HomeSite setup GUI (served by scripts/setup/gui.cjs). Plain JavaScript:
 * the whole view is re-rendered from `data` + local drafts, and refreshed
 * whenever .env changes on disk (server-sent events).
 */
(() => {
  const TOKEN = new URLSearchParams(location.search).get("token") || "";
  const app = document.getElementById("app");

  const view = {
    tab: sessionStorage.getItem("setup:tab") || "setup",
    stage: sessionStorage.getItem("setup:stage") || null,
    drafts: {}, // key -> new value (undefined = untouched)
    removing: new Set(),
    revealed: {},
    errors: {},
    query: "",
    twofa: null, // { secret, svg } after creating one
    savingUntil: 0,
  };
  let data = null;

  const STATE_ICONS = {
    set: "check_circle",
    "missing-required": "cancel",
    needed: "warning",
    "missing-important": "warning",
    missing: "radio_button_unchecked",
    changed: "edit",
    removing: "delete",
  };
  const STAGE_ICONS = { done: "check_circle", todo: "radio_button_unchecked", skipped: "skip_next", off: "toggle_off" };
  const ON = new Set(["1", "true", "on", "yes"]);

  /* ---------- helpers ---------- */

  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

  async function api(path, body) {
    const response = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: { "X-Setup-Token": TOKEN, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(json.error || "Request failed."), { data: json });
    return json;
  }

  let toastTimer = null;
  function toast(text) {
    const element = document.getElementById("toast");
    element.textContent = text;
    element.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove("is-visible"), 3200);
  }

  const setting = (key) => data.settings.find((entry) => entry.key === key);
  const pendingCount = () => Object.keys(view.drafts).length + view.removing.size;
  const attention = (entry) => ["missing-required", "needed", "missing-important"].includes(entry.state);

  /* ---------- one field (used by both tabs) ---------- */

  function fieldHtml(entry) {
    const changed = view.drafts[entry.key] !== undefined;
    const removing = view.removing.has(entry.key);
    const tone = removing ? "removing" : changed ? "changed" : entry.state;
    const value = changed ? view.drafts[entry.key] : entry.type === "secret" ? "" : (entry.value ?? "");
    const id = `f-${entry.key}`;
    let control;

    if (entry.type === "toggle") {
      const on = ON.has(String(value || entry.default || "").toLowerCase());
      control = `<button type="button" class="switch" role="switch" aria-checked="${on}" data-toggle="${entry.key}" id="${id}"><i></i>${on ? "On" : "Off"}</button>`;
    } else if (entry.multiline) {
      control = `<textarea id="${id}" rows="3" data-key="${entry.key}" placeholder="${esc(entry.example || "")}" ${removing ? "disabled" : ""}>${esc(value)}</textarea>`;
    } else {
      const secret = entry.type === "secret";
      const placeholder = secret && entry.set ? "Saved. Type to replace it" : entry.example || (entry.default ? `Default: ${entry.default}` : entry.type === "id" ? "17–20 digit ID" : "");
      control = `<input id="${id}" data-key="${entry.key}" type="${secret ? "password" : "text"}" autocomplete="off" spellcheck="false"
        class="${entry.type === "id" || entry.type === "ids" || secret ? "mono" : ""}" placeholder="${esc(placeholder)}" value="${esc(value)}" ${removing ? "disabled" : ""}>`;
    }

    const buttons = [
      entry.generate && !removing ? `<button type="button" class="icon-button" title="Generate a random value" data-generate="${entry.key}"><span class="icon">auto_fix_high</span></button>` : "",
      entry.type === "secret" && entry.set ? `<button type="button" class="icon-button" title="Show / hide" data-reveal="${entry.key}"><span class="icon">${view.revealed[entry.key] !== undefined ? "visibility_off" : "visibility"}</span></button>` : "",
      changed ? `<button type="button" class="icon-button" title="Undo" data-undo="${entry.key}"><span class="icon">undo</span></button>` : "",
      entry.set && !changed
        ? `<button type="button" class="icon-button ${removing ? "is-active" : ""}" title="${removing ? "Keep it" : entry.known ? "Remove (back to the default)" : "Delete"}" data-remove="${entry.key}"><span class="icon">${removing ? "undo" : entry.known ? "restart_alt" : "delete"}</span></button>`
        : "",
    ].join("");

    const reason = removing ? (entry.known ? "Back to the default on save" : "Deleted on save") : changed ? "Unsaved" : entry.reason || "";
    const foot = [
      entry.suggestion && !entry.set && !changed ? `<button type="button" class="chip suggest" data-suggest="${entry.key}"><span class="icon">lightbulb</span>Use ${esc(entry.suggestion)}</button>` : "",
      ...(entry.help ?? []).map(
        (help) => `<a class="chip ${help.video ? "video" : ""}" href="${esc(help.url)}" target="_blank" rel="noopener noreferrer"><span class="icon">${help.video ? "smart_display" : "menu_book"}</span>${esc(help.label)}</a>`,
      ),
    ].join("");

    return `<li class="field" data-tone="${tone}" id="s-${entry.key}">
      <span class="icon" aria-hidden="true">${STATE_ICONS[tone] || "radio_button_unchecked"}</span>
      <div class="field-body">
        <div class="field-head">
          <label for="${id}">${esc(entry.label)}</label><code>${esc(entry.key)}</code>
          ${entry.importance && !["optional", "unknown"].includes(entry.importance) ? `<span class="importance ${entry.importance}">${entry.importance}</span>` : ""}
          ${reason ? `<span class="reason">${esc(reason)}</span>` : ""}
        </div>
        ${entry.description ? `<p>${esc(entry.description)}</p>` : ""}
        <div class="control">${control}${buttons}</div>
        ${view.errors[entry.key] ? `<p class="error">${esc(view.errors[entry.key])}</p>` : ""}
        ${view.revealed[entry.key] !== undefined ? `<code class="revealed">${esc(view.revealed[entry.key] || "(empty)")}</code>` : ""}
        ${foot ? `<div class="foot">${foot}</div>` : ""}
      </div>
    </li>`;
  }

  /* ---------- setup tab ---------- */

  function currentStage() {
    const stages = data.stages;
    if (view.stage === "__done") return null;
    let stage = stages.find((entry) => entry.id === view.stage);
    if (!stage) stage = stages.find((entry) => entry.status === "todo") || null;
    return stage;
  }

  function stageDrafts(stage) {
    return stage.keys.some((key) => view.drafts[key] !== undefined || view.removing.has(key));
  }

  function setupHtml() {
    const stages = data.stages;
    const done = stages.filter((stage) => stage.status !== "todo").length;
    const stage = currentStage();

    const stepper = `<nav class="stepper" aria-label="Setup stages">
      <div class="progress"><small>${done} of ${stages.length} stages handled</small><div><span style="width:${Math.round((done / stages.length) * 100)}%"></span></div></div>
      ${stages
        .map(
          (entry) => `<button type="button" class="step ${stage && entry.id === stage.id ? "is-current" : ""}" data-stage="${entry.id}" data-status="${entry.status}" title="${esc(entry.title)}">
            <span class="icon" aria-hidden="true">${STAGE_ICONS[entry.status]}</span><span>${esc(entry.title)}</span>
            <small>${entry.status === "done" ? "done" : entry.status === "off" ? "off" : entry.status === "skipped" ? "skipped" : ""}</small>
          </button>`,
        )
        .join("")}
      <button type="button" class="step ${!stage ? "is-current" : ""}" data-stage="__done"><span class="icon">celebration</span><span>Finish</span></button>
    </nav>`;

    return `<div class="setup">${stepper}<div class="stack">${stage ? stageHtml(stage) : finishHtml()}</div></div>`;
  }

  function stageHtml(stage) {
    const index = data.stages.findIndex((entry) => entry.id === stage.id) + 1;
    const feature = stage.feature ? data.features.find((entry) => entry.id === stage.feature) : null;
    const asking = feature && feature.want === null && stage.status !== "done";
    const off = stage.status === "off";

    let body;
    if (off) {
      body = `<div class="question"><p>You said you don't need <strong>${esc(feature.title)}</strong>.</p>
        <div class="row"><button class="button ghost" data-stage-action="reopen" data-id="${stage.id}"><span class="icon">undo</span>Set it up after all</button>
        <button class="button" data-next><span class="icon">arrow_forward</span>Next</button></div></div>`;
    } else if (asking) {
      body = `<div class="question"><p class="muted">${esc(feature.text)}</p><strong>Do you want ${esc(feature.title.toLowerCase())}?</strong>
        <div class="row">
          <button class="button big" data-want="1" data-id="${stage.id}"><span class="icon">check</span>Yes, set it up</button>
          <button class="button big ghost" data-want="0" data-id="${stage.id}"><span class="icon">block</span>No thanks</button>
        </div>
        <button class="chip" style="align-self:center" data-stage-action="skip" data-id="${stage.id}"><span class="icon">skip_next</span>Decide later</button></div>`;
    } else if (stage.special === "twofa") {
      body = twofaHtml(stage);
    } else {
      body = `<ul class="fields">${stage.keys.map((key) => setting(key)).filter(Boolean).map(fieldHtml).join("")}</ul>
        <div class="row end">
          ${stage.status !== "done" ? `<button class="button ghost" data-stage-action="skip" data-id="${stage.id}"><span class="icon">skip_next</span>Skip for now</button>` : ""}
          <button class="button" data-save-continue="${stage.id}"><span class="icon">${stageDrafts(stage) ? "save" : "arrow_forward"}</span>${stageDrafts(stage) ? "Save & continue" : "Continue"}</button>
        </div>`;
    }

    return `<section class="card">
      <div class="card-head"><span class="icon" aria-hidden="true">${esc(stage.icon)}</span>
        <div><small class="muted">Stage ${index} of ${data.stages.length}${stage.status === "done" ? " · done" : stage.status === "skipped" ? " · skipped" : ""}</small><h2>${esc(stage.title)}</h2><p>${esc(stage.intro)}</p></div></div>
      ${stage.status === "done" && !off ? `<div class="banner"><span class="icon">check_circle</span>This stage is set up. You can still change anything below.</div>` : ""}
      ${stage.steps?.length ? `<ol class="guide">${stage.steps.map((step) => `<li>${esc(step)}</li>`).join("")}</ol>` : ""}
      ${stage.links?.length ? `<div class="foot">${stage.links.map((help) => `<a class="chip ${help.video ? "video" : ""}" href="${esc(help.url)}" target="_blank" rel="noopener noreferrer"><span class="icon">${help.video ? "smart_display" : "open_in_new"}</span>${esc(help.label)}</a>`).join("")}</div>` : ""}
      ${body}
    </section>`;
  }

  function twofaHtml(stage) {
    const enabled = setting("ADMIN_2FA")?.value && ON.has(String(setting("ADMIN_2FA").value).toLowerCase());
    if (enabled && setting("ADMIN_2FA_SECRET")?.set && !view.twofa) {
      return `<div class="banner"><span class="icon">verified_user</span>2FA is on. Restart the account API if it is running.</div>
        <div class="row end"><button class="button ghost" data-twofa-show><span class="icon">qr_code</span>Show the QR code again</button><button class="button" data-next><span class="icon">arrow_forward</span>Next</button></div>`;
    }
    if (!view.twofa) {
      return `<div class="row">
          <button class="button big" data-twofa-new><span class="icon">key</span>${setting("ADMIN_2FA_SECRET")?.set ? "Create a new secret" : "Create the secret"}</button>
          ${setting("ADMIN_2FA_SECRET")?.set ? `<button class="button big ghost" data-twofa-show><span class="icon">qr_code</span>Use the existing one</button>` : ""}
          <button class="button ghost" data-stage-action="skip" data-id="${stage.id}"><span class="icon">skip_next</span>Skip for now</button>
        </div>`;
    }
    return `<div class="qr">${view.twofa.svg}<div class="stack" style="gap:.6rem">
        <p>Scan this with your authenticator app, or type the key:</p>
        <code class="revealed">${esc(view.twofa.secret.match(/.{1,4}/g).join(" "))}</code>
        <label for="twofa-code">Current 6-digit code</label>
        <div class="control"><input id="twofa-code" class="mono" inputmode="numeric" maxlength="7" placeholder="123 456" autocomplete="one-time-code">
        <button class="button" data-twofa-verify><span class="icon">verified_user</span>Check & turn on</button></div>
        ${view.errors.__twofa ? `<p class="error">${esc(view.errors.__twofa)}</p>` : ""}
      </div></div>`;
  }

  function finishHtml() {
    const open = data.stages.filter((stage) => stage.status === "skipped");
    return `<section class="card">
      <div class="card-head"><span class="icon">celebration</span><div><h2>All set!</h2><p>Your settings are saved in <code>${esc(data.file)}</code>.</p></div></div>
      ${open.length ? `<div class="banner info"><span class="icon">skip_next</span>Skipped for now: ${open.map((stage) => esc(stage.title)).join(", ")}. Click them on the left whenever you like.</div>` : ""}
      <p>Start things with:</p>
      <ul class="next-steps">${data.nextSteps
        .map((step) => `<li><code>${esc(step.command)}</code><span class="muted">${esc(step.text)}</span><button class="icon-button" title="Copy" data-copy="${esc(step.command)}" style="margin-left:auto"><span class="icon">content_copy</span></button></li>`)
        .join("")}</ul>
      <p class="muted">After changing settings, restart the matching service. Website settings need a new build. Once the site runs, the admin account can change everything on <code>/admin-settings</code>.</p>
    </section>`;
  }

  /* ---------- settings tab ---------- */

  function settingsHtml() {
    const needle = view.query.trim().toLowerCase();
    const match = (entry) => !needle || `${entry.key} ${entry.label} ${entry.description}`.toLowerCase().includes(needle);
    const custom = data.settings.filter((entry) => !entry.known);

    const sections = data.sections
      .map((section) => {
        const entries = data.settings.filter((entry) => entry.known && entry.section === section.id && match(entry));
        if (!entries.length) return "";
        return `<section class="card" id="sec-${section.id}">
          <div class="card-head"><span class="icon">${esc(section.icon)}</span><div><h2>${esc(section.title)}</h2><p>${esc(section.text)}</p></div></div>
          <ul class="fields">${entries.map(fieldHtml).join("")}</ul></section>`;
      })
      .join("");

    const nav = data.sections
      .map((section) => {
        const count = data.settings.filter((entry) => entry.section === section.id && attention(entry)).length;
        return `<a href="#sec-${section.id}"><span class="icon">${esc(section.icon)}</span>${esc(section.title)}${count ? `<span class="badge">${count}</span>` : ""}</a>`;
      })
      .join("");

    return `<div class="settings">
      <nav class="section-nav">${nav}${custom.length ? `<a href="#sec-custom"><span class="icon">data_object</span>Custom values</a>` : ""}</nav>
      <div class="stack">
        <div class="card search"><span class="icon muted">search</span><input type="search" id="search" placeholder="Search settings…" value="${esc(view.query)}"></div>
        ${sections}
        ${custom.filter(match).length ? `<section class="card" id="sec-custom"><div class="card-head"><span class="icon">data_object</span><div><h2>Custom values</h2><p>Entries in .env that HomeSite doesn't know.</p></div></div><ul class="fields">${custom.filter(match).map(fieldHtml).join("")}</ul></section>` : ""}
      </div>
    </div>`;
  }

  /* ---------- render ---------- */

  function render() {
    if (!data) return;
    document.getElementById("file").textContent = data.file;
    for (const tab of document.querySelectorAll("[data-tab]")) tab.setAttribute("aria-selected", String(tab.dataset.tab === view.tab));

    // Keep focus and cursor while re-rendering (live updates while typing).
    const active = document.activeElement;
    const focusId = active && active.id ? active.id : null;
    const selection = focusId && "selectionStart" in active ? [active.selectionStart, active.selectionEnd] : null;

    const count = pendingCount();
    app.innerHTML =
      (view.tab === "setup" ? setupHtml() : settingsHtml()) +
      `<div class="savebar ${count && view.tab === "settings" ? "is-visible" : ""}">
        <strong><span class="icon">edit_note</span>${count} unsaved change${count === 1 ? "" : "s"}</strong>
        <button class="button ghost" data-discard>Discard</button>
        <button class="button" data-save><span class="icon">save</span>Save</button>
      </div>`;

    if (focusId) {
      const element = document.getElementById(focusId);
      if (element) {
        element.focus();
        if (selection && element.setSelectionRange) {
          try {
            element.setSelectionRange(...selection);
          } catch {
            // number inputs etc.
          }
        }
      }
    }
  }

  async function load() {
    const previous = data;
    data = await api("/api/state");
    if (previous && view.tab === "setup" && view.stage) {
      // Finished elsewhere (Settings tab, editor, CLI)? Move on if you weren't editing it.
      const before = previous.stages.find((stage) => stage.id === view.stage);
      const now = data.stages.find((stage) => stage.id === view.stage);
      if (before?.status === "todo" && now?.status === "done" && !stageDrafts(now) && Date.now() > view.savingUntil) {
        const next = data.stages.find((stage) => stage.status === "todo");
        view.stage = next?.id ?? null;
        toast(`“${now.title}” is set up now. On to ${next ? `“${next.title}”` : "the finish"}.`);
      }
    }
    render();
  }

  /* ---------- actions ---------- */

  async function save(keys) {
    const values = {};
    const remove = [];
    for (const [key, value] of Object.entries(view.drafts)) if (!keys || keys.includes(key)) values[key] = value;
    for (const key of view.removing) if (!keys || keys.includes(key)) remove.push(key);
    if (!Object.keys(values).length && !remove.length) return true;
    view.savingUntil = Date.now() + 1500;
    try {
      const result = await api("/api/save", { values, remove });
      for (const key of [...result.changed, ...result.removed]) {
        delete view.drafts[key];
        view.removing.delete(key);
        delete view.errors[key];
      }
      toast(`Saved ${result.changed.length + result.removed.length} setting(s).`);
      await load();
      return true;
    } catch (error) {
      view.errors = { ...view.errors, ...(error.data?.errors ?? {}) };
      toast(error.message === "Request failed." ? "Some values need fixing." : error.message);
      render();
      return false;
    }
  }

  // fromId: the stage you were on (it may count as done by now).
  function goToNext(fromId = currentStage()?.id) {
    const stages = data.stages;
    const index = stages.findIndex((stage) => stage.id === fromId);
    // The next open stage after this one, then any open one before it.
    const next =
      stages.slice(index + 1).find((stage) => stage.status === "todo") ||
      stages.find((stage, position) => position !== index && stage.status === "todo");
    view.stage = next ? next.id : "__done";
    sessionStorage.setItem("setup:stage", view.stage);
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setDraft(key, value) {
    const entry = setting(key);
    const saved = entry ? (entry.type === "secret" ? "" : (entry.value ?? "")) : "";
    if (value === saved) delete view.drafts[key];
    else view.drafts[key] = value;
    delete view.errors[key];
  }

  app.addEventListener("input", (event) => {
    const key = event.target.dataset.key;
    if (key) {
      const hadDraft = view.drafts[key] !== undefined;
      setDraft(key, event.target.value);
      // Re-render only when the field's look changes (first keystroke / back to saved).
      if (hadDraft !== (view.drafts[key] !== undefined)) render();
      else document.querySelector(".savebar strong")?.replaceChildren(document.createTextNode(`${pendingCount()} unsaved change${pendingCount() === 1 ? "" : "s"}`));
    }
    if (event.target.id === "search") {
      view.query = event.target.value;
      render();
    }
  });

  app.addEventListener("click", async (event) => {
    const target = event.target.closest("button, a");
    if (!target) return;
    const { dataset } = target;

    if (dataset.stage) {
      view.stage = dataset.stage;
      sessionStorage.setItem("setup:stage", view.stage);
      view.twofa = null;
      render();
    } else if (dataset.toggle) {
      const entry = setting(dataset.toggle);
      const current = view.drafts[entry.key] ?? entry.value ?? entry.default ?? "";
      setDraft(entry.key, ON.has(String(current).toLowerCase()) ? "off" : "on");
      render();
    } else if (dataset.generate) {
      const { value } = await api("/api/generate", { key: dataset.generate });
      setDraft(dataset.generate, value);
      view.revealed[dataset.generate] = value;
      render();
    } else if (dataset.reveal) {
      if (view.revealed[dataset.reveal] !== undefined) delete view.revealed[dataset.reveal];
      else view.revealed[dataset.reveal] = (await api("/api/reveal", { key: dataset.reveal })).value;
      render();
    } else if (dataset.undo) {
      delete view.drafts[dataset.undo];
      delete view.errors[dataset.undo];
      render();
    } else if (dataset.remove) {
      if (view.removing.has(dataset.remove)) view.removing.delete(dataset.remove);
      else view.removing.add(dataset.remove);
      render();
    } else if (dataset.suggest) {
      setDraft(dataset.suggest, setting(dataset.suggest).suggestion);
      render();
    } else if (dataset.saveContinue) {
      const stage = data.stages.find((entry) => entry.id === dataset.saveContinue);
      if (await save(stage.keys)) goToNext(stage.id);
    } else if (dataset.stageAction) {
      await api("/api/stage", { id: dataset.id, action: dataset.stageAction });
      await load();
      if (dataset.stageAction === "skip") goToNext(dataset.id);
    } else if (dataset.want !== undefined) {
      await api("/api/stage", { id: dataset.id, action: "want", want: dataset.want === "1" });
      await load();
      if (dataset.want !== "1") goToNext(dataset.id);
    } else if (dataset.next !== undefined) {
      goToNext();
    } else if (dataset.twofaNew !== undefined) {
      view.twofa = await api("/api/2fa/new", {});
      view.savingUntil = Date.now() + 1500;
      render();
    } else if (dataset.twofaShow !== undefined) {
      view.twofa = await api("/api/2fa/qr");
      render();
    } else if (dataset.twofaVerify !== undefined) {
      view.savingUntil = Date.now() + 2000;
      try {
        await api("/api/2fa/verify", { code: document.getElementById("twofa-code").value });
        view.twofa = null;
        delete view.errors.__twofa;
        toast("2FA is on.");
        await load();
      } catch (error) {
        view.errors.__twofa = error.message;
        render();
      }
    } else if (dataset.copy) {
      await navigator.clipboard?.writeText(dataset.copy).catch(() => {});
      toast(`Copied: ${dataset.copy}`);
    } else if (dataset.save !== undefined) {
      await save();
    } else if (dataset.discard !== undefined) {
      view.drafts = {};
      view.removing = new Set();
      view.errors = {};
      render();
    }
  });

  document.querySelector(".tabs").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-tab]");
    if (!tab) return;
    view.tab = tab.dataset.tab;
    sessionStorage.setItem("setup:tab", view.tab);
    render();
  });

  window.addEventListener("beforeunload", (event) => {
    if (pendingCount()) event.preventDefault();
  });

  /* ---------- live updates ---------- */

  function connect() {
    const live = document.getElementById("live");
    const source = new EventSource(`/api/events?token=${encodeURIComponent(TOKEN)}`);
    source.addEventListener("open", () => live.classList.add("is-on"));
    source.addEventListener("changed", () => {
      if (Date.now() > view.savingUntil) toast("Updated from .env");
      load().catch(() => {});
    });
    source.addEventListener("error", () => live.classList.remove("is-on"));
  }

  if (!TOKEN) {
    app.innerHTML = `<p class="center muted">Open the link printed in the terminal (it contains a token).</p>`;
    return;
  }
  load()
    .then(connect)
    .catch((error) => {
      app.innerHTML = `<p class="center error">${esc(error.message)}</p>`;
    });
})();
