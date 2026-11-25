const { memberGate, isMember } = require("./membership.cjs");
const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");
const rateLimit = require("express-rate-limit");

const { ADMIN_DISCORD_USER_ID } = require("./discordOAuth.cjs");
const {
  toPublicPoll,
  toSummaryEntry,
  buildPublicSummary,
} = require("./fdcPublic.cjs");
const { getInternalKey, getBotInternalUrl } = require("./internalKey.cjs");
const { renderDesign, normalize: normalizeDesignSpec } = require("./bongoRender.cjs");
const { createMigration } = require("./fdcMigration.cjs");
const { registerStats } = require("./statsWeb.cjs");
const bongoAssets = require("./bongoAssets.cjs");
const { createRecycleBin } = require("./fdcRecycle.cjs");
const { httpError } = require("./http.cjs");

/*
 * Public website routes for FDC polls, the Discord widget and the lobby code,
 * mounted on the account API. Reads come straight from the archive files; votes and new
 * polls are forwarded to the bot's internal API, which owns the archive.
 */

const ARCHIVE_ROOT = process.env.FDC_ARCHIVE_DIR
  ? path.resolve(process.env.FDC_ARCHIVE_DIR)
  : path.join(__dirname, "db", "fdc-polls");

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const READ_CACHE_MS = 3000;
const WIDGET_CACHE_MS = 30_000;
const LOBBY_CACHE_MS = 10_000;
const LOBBY_FILE = path.join(__dirname, "db", "lobby-code.json");
const PERMISSION_CACHE_MS = 60_000;
const DISCORD_INVITE_CODE = process.env.DISCORD_INVITE_CODE || "3vCGMRapHT";
const CREATE_BODY_LIMIT = "48mb";

/* With the Bongo Cat assets imported, options are designed cats: no new or changed pictures. */
const PICTURES_RETIRED = "FDC options are designed cats now: pictures can't be added or changed anymore.";
const picturesRetired = () => Boolean(bongoAssets.readCatalog());

function ownerIds() {
  return new Set(
    String(process.env.BOT_OWNERS || process.env.DISCORD_USER_ID || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

async function botFetch(route, { method = "GET", body, timeout = 10_000 } = {}) {
  const key = getInternalKey();
  if (!key) throw httpError(503, "The bot connection is not configured.");

  let response;

  try {
    response = await fetch(`${getBotInternalUrl()}${route}`, {
      method,
      headers: {
        "X-Internal-Key": key,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    throw httpError(503, `The bot is unavailable (${error.name}).`);
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw httpError(response.status, data?.error || `Bot error ${response.status}.`);
  }

  return data;
}

/* ---------- archive reads ---------- */

const readCache = new Map();

async function cached(key, ttl, load) {
  const hit = readCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const value = await load();
  readCache.set(key, { value, expires: Date.now() + ttl });
  return value;
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function readArchivedPoll(date) {
  return cached(`poll:${date}`, READ_CACHE_MS, () =>
    readJson(path.join(ARCHIVE_ROOT, date, "data.json")),
  );
}

function readPublicSummary() {
  return cached("summary", READ_CACHE_MS, async () => {
    const source = await readJson(path.join(ARCHIVE_ROOT, "summary.json"));
    const entries = [];

    for (const entry of await fs.readdir(ARCHIVE_ROOT, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || !DATE_PATTERN.test(entry.name)) continue;

      const poll = await readArchivedPoll(entry.name);
      if (poll) entries.push(toSummaryEntry(toPublicPoll(poll, entry.name)));
    }

    return buildPublicSummary(source, entries);
  });
}

/* ---------- permissions ---------- */

const permissionCache = new Map();

async function canCreateFdc(session) {
  if (!session) return false;
  if (["owner", "admin"].includes(session.role)) return true;
  if (ownerIds().has(session.discord_user_id)) return true;

  const hit = permissionCache.get(session.discord_user_id);
  if (hit && hit.expires > Date.now()) return hit.value;

  let value = false;

  try {
    const result = await botFetch(`/fdc/permissions/${session.discord_user_id}`, {
      timeout: 5000,
    });
    value = result.moderator === true;
  } catch (error) {
    console.warn("[FDC web] Permission lookup failed:", error.message);
  }

  permissionCache.set(session.discord_user_id, {
    value,
    expires: Date.now() + PERMISSION_CACHE_MS,
  });

  return value;
}

/* Logged in with a real account that is in the Discord server (services/membership.cjs). */
async function canVote(session) {
  return Boolean(session && session.discord_user_id !== ADMIN_DISCORD_USER_ID && (await isMember(session.discord_user_id)));
}

/* `profileKeyOf(id)`: "@name" when the voter has a public profile (their name links to it). */
async function voterList(poll, profileKeyOf = () => null) {
  const votes = Array.isArray(poll.votes) ? poll.votes : [];
  if (!votes.length) return [];

  let members = {};

  try {
    ({ members } = await botFetch("/fdc/members", {
      method: "POST",
      body: { ids: votes.map((vote) => vote.userId) },
      timeout: 6000,
    }));
  } catch (error) {
    console.warn("[FDC web] Voter lookup failed:", error.message);
  }

  return votes
    .map((vote) => ({
      userId: vote.userId,
      optionNumber: vote.optionNumber,
      displayName: members[vote.userId]?.displayName ?? null,
      avatarUrl: members[vote.userId]?.avatarUrl ?? null,
      votedAt: vote.votedAt?.iso ?? vote.observedAt?.iso ?? null,
      via: vote.timestampSource === "web" ? "web" : "discord",
      profile: profileKeyOf(vote.userId),
    }))
    .sort((a, b) => a.optionNumber - b.optionNumber);
}

/* ---------- Discord widget ---------- */

async function inviteWidget() {
  const response = await fetch(
    `https://discord.com/api/v10/invites/${DISCORD_INVITE_CODE}?with_counts=true`,
    { signal: AbortSignal.timeout(6000) },
  );

  if (!response.ok) throw httpError(502, `Discord invite lookup failed (${response.status}).`);

  const invite = await response.json();
  const guild = invite.guild ?? {};
  const cdn = "https://cdn.discordapp.com";

  return {
    id: guild.id ?? null,
    name: guild.name ?? "Discord",
    description: guild.description ?? null,
    iconUrl: guild.icon ? `${cdn}/icons/${guild.id}/${guild.icon}.webp?size=128` : null,
    bannerUrl: guild.banner
      ? `${cdn}/banners/${guild.id}/${guild.banner}.webp?size=960`
      : guild.splash
        ? `${cdn}/splashes/${guild.id}/${guild.splash}.webp?size=960`
        : null,
    memberCount: invite.approximate_member_count ?? null,
    onlineCount: invite.approximate_presence_count ?? null,
    boostCount: guild.premium_subscription_count ?? 0,
    boostTier: null,
    members: [],
    voice: [],
    source: "invite",
    updatedAt: new Date().toISOString(),
  };
}

/* ---------- routes ---------- */

function registerFdcWeb(app, { requireStorage, getRequestSession, getDatabase = () => null, activity = null, getModeration = () => null }) {
  // Voting, making and editing FDCs, the recycle bin, designs, emojis, the lobby code: server members only.
  // Looking at the archive stays open (services/membership.cjs).
  app.use(["/fdc", "/discord/lobby"], memberGate({ methods: ["POST", "PUT", "PATCH", "DELETE"] }));
  const privacy = require("./privacy.cjs");
  const profileKeyOf = (discordId) => {
    try {
      if (!/^\d{17,20}$/.test(String(discordId)) || privacy.isHidden(discordId)) return null;
      // The voter list is only shown to logged-in members: everyone- and members-profiles are linked.
      const row = getDatabase()?.prepare("SELECT username, profile_public, profile_visibility FROM users WHERE discord_user_id = ?").get(String(discordId));
      return row && (row.profile_visibility ? row.profile_visibility !== "private" : row.profile_public) ? `@${row.username}` : null;
    } catch {
      return null;
    }
  };
  /* Activity log entry for an editor action (services/activityLog.cjs). */
  const actorOf = (session) =>
    session ? { discordId: session.discord_user_id, name: session.display_name || session.username } : null;
  const audit = (session, entry) => activity?.append({ actor: actorOf(session), ...entry });

  const readLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });

  // Pictures (archive, recycling bin, designs): a page like the migration loads a hundred at once.
  const imageLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 1500,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });

  const voteLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many votes. Please slow down." },
  });

  const createLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many polls created. Please try again later." },
  });

  const route = (handler) => async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(await handler(req, res));
    } catch (error) {
      const status = error.status ?? 500;
      if (status >= 500) console.error("[FDC web]", error);
      res.status(status).json({ error: error.message || "Request failed." });
    }
  };

  app.get(
    "/fdc/summary",
    readLimiter,
    requireStorage,
    route(async (req) => {
      const session = getRequestSession(req);
      const summary = await readPublicSummary();

      return {
        ...summary,
        viewer: {
          authenticated: Boolean(session),
          canVote: await canVote(session),
          member: session ? await isMember(session.discord_user_id) : false,
          canCreate: await canCreateFdc(session),
        },
      };
    }),
  );

  app.get(
    "/fdc/polls/:date",
    readLimiter,
    requireStorage,
    route(async (req) => {
      const { date } = req.params;
      if (!DATE_PATTERN.test(date)) throw httpError(400, "Invalid FDC date.");

      const poll = await readArchivedPoll(date);
      if (!poll) throw httpError(404, "Poll not found.");

      const session = getRequestSession(req);
      const publicPoll = toPublicPoll(poll, date);
      const myVote = session
        ? (poll.votes ?? []).find((vote) => vote.userId === session.discord_user_id)
        : null;

      return {
        ...publicPoll,
        imageBase: `/fdc/images/${date}/`,
        viewer: {
          authenticated: Boolean(session),
          canVote: await canVote(session),
          member: session ? await isMember(session.discord_user_id) : false,
          myVote: myVote?.optionNumber ?? null,
          canManage: poll.status === "active" && (await canCreateFdc(session)),
          // Editors: fix archived polls and enter votes from elsewhere.
          isEditor: await canCreateFdc(session),
          // Editors can recycle options of ended polls.
          recycled:
            poll.status !== "active" && (await canCreateFdc(session))
              ? (await recycleBin.keys()).filter((key) => key.startsWith(`${date}:`)).map((key) => Number(key.split(":")[1]))
              : null,
        },
        // Voter identities are only shown to logged-in users.
        voters: session ? await voterList(poll, profileKeyOf) : null,
      };
    }),
  );

  app.get("/fdc/images/:date/:file", imageLimiter, async (req, res) => {
    const { date, file } = req.params;

    // Option images (1.webp) and designed cats (1-design.png / .gif).
    if (!DATE_PATTERN.test(date) || !/^[1-6](\.webp|-design\.(png|gif))$/.test(file)) {
      return res.status(400).send("Invalid image.");
    }

    try {
      const imagePath = path.join(ARCHIVE_ROOT, date, file);
      await fs.access(imagePath);

      res.setHeader("Content-Type", file.endsWith(".webp") ? "image/webp" : file.endsWith(".gif") ? "image/gif" : "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      return res.sendFile(imagePath);
    } catch {
      return res.status(404).send("Image not found.");
    }
  });

  app.post(
    "/fdc/polls/:pollId/vote",
    voteLimiter,
    requireStorage,
    route(async (req) => {
      const session = getRequestSession(req);
      if (!session) throw httpError(401, "Log in to vote.");
      if (!(await canVote(session))) throw httpError(403, "This account cannot vote.");

      const { pollId } = req.params;
      if (!/^\d{17,20}$/.test(pollId)) throw httpError(400, "Invalid poll.");

      const raw = req.body?.optionNumber;
      const optionNumber = raw === null ? null : Number(raw);

      if (optionNumber !== null && !Number.isInteger(optionNumber)) {
        throw httpError(400, "Invalid option.");
      }

      const result = await botFetch(`/fdc/polls/${pollId}/vote`, {
        method: "POST",
        body: { userId: session.discord_user_id, optionNumber },
      });

      readCache.clear();
      return result;
    }),
  );

  app.post(
    "/fdc/polls",
    createLimiter,
    express.json({ limit: CREATE_BODY_LIMIT }),
    requireStorage,
    route(async (req) => {
      const session = getRequestSession(req);
      if (!session) throw httpError(401, "Log in to create an FDC.");
      if (!(await canCreateFdc(session))) {
        throw httpError(403, "You are not allowed to create an FDC.");
      }

      const { endsAt, options: rawOptions } = req.body ?? {};
      if (!Array.isArray(rawOptions)) throw httpError(400, "Missing options.");

      // Every new option is a designed cat (pictures only without imported Bongo Cat assets).
      const options = await Promise.all(
        rawOptions.map(async (option, index) => {
          // Without imported Bongo Cat assets there is nothing to design with: images only.
          if (picturesRetired()) {
            if (!option?.design) throw httpError(400, `Option ${index + 1} needs a designed cat.`);
            if (option.image) throw httpError(400, PICTURES_RETIRED);
          }
          if (!option?.design && !option?.image) throw httpError(400, `Option ${index + 1} needs an image.`);
          return {
            description: option.description,
            emoji: option.emoji,
            image: option.image ?? null,
            design: option.design ? await renderForBot(option.design, index + 1) : null,
            display: !option.design || (option.image && option.display === "image") ? "image" : "design",
          };
        }),
      );

      const result = await botFetch("/fdc/polls", {
        method: "POST",
        body: { creatorId: session.discord_user_id, endsAt, options },
        timeout: 180_000,
      });

      readCache.clear();
      console.log(
        `[FDC web] Poll ${result.id} (${result.date}) created by ${session.username}.`,
      );
      audit(session, {
        level: "risky",
        action: "fdc-create",
        summary: `created the FDC poll for ${result.date}`,
        target: { pollId: result.id, date: result.date },
        details: {
          endsAt: result.endsAt ?? endsAt,
          options: (options ?? []).map((option, index) => ({
            number: index + 1,
            description: option?.description,
            emoji: option?.emoji || "default",
            image: option?.image?.name ?? null,
            editedByBot: Boolean(option?.image?.edit),
            design: option?.design ? { frames: option.design.frames, display: option.display } : null,
          })),
        },
      });

      return result;
    }),
  );

  /* A design spec -> the rendered image the bot stores and posts. */
  async function renderForBot(spec, number) {
    try {
      const rendered = await renderDesign(spec);
      return {
        spec: rendered.design,
        data: rendered.buffer.toString("base64"),
        extension: rendered.extension,
        frames: rendered.frames,
        width: rendered.width,
        height: rendered.height,
      };
    } catch (error) {
      throw httpError(error.status ?? 400, `Option ${number}'s design: ${error.message}`);
    }
  }

  const manageLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 40,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many poll changes. Please try again later." },
  });

  /* Editors (same people who may create polls) manage running polls. */
  async function requireEditor(req) {
    const session = getRequestSession(req);
    if (!session) throw httpError(401, "Log in to manage FDC polls.");
    if (!(await canCreateFdc(session))) {
      throw httpError(403, "You are not allowed to manage FDC polls.");
    }

    const { pollId } = req.params;
    if (!/^\d{17,20}$/.test(pollId)) throw httpError(400, "Invalid poll.");

    return { session, pollId };
  }

  app.post(
    "/fdc/polls/:pollId/edit",
    manageLimiter,
    express.json({ limit: CREATE_BODY_LIMIT }),
    requireStorage,
    route(async (req) => {
      const { session, pollId } = await requireEditor(req);
      if (picturesRetired() && (req.body?.options ?? []).some?.((option) => option?.image)) throw httpError(400, PICTURES_RETIRED);

      const result = await botFetch(`/fdc/polls/${pollId}/edit`, {
        method: "POST",
        body: { actorId: session.discord_user_id, options: req.body?.options },
        timeout: 180_000,
      });

      readCache.clear();
      console.log(`[FDC web] Poll ${pollId} edited by ${session.username}.`);
      if (result.changed) {
        const parts = [
          result.images?.length && `${result.images.length} image(s)`,
          result.descriptions?.length && `${result.descriptions.length} name(s)`,
          result.emojis?.length && `${result.emojis.length} emoji`,
        ].filter(Boolean);
        audit(session, {
          // Changing an ended poll's info is risky; running polls are normal.
          level: result.archiveOnly ? "risky" : "normal",
          action: result.archiveOnly ? "fdc-edit-archived" : "fdc-edit",
          summary: `edited ${parts.join(", ")} of the ${result.archiveOnly ? "ended " : ""}FDC ${result.date}`,
          target: { pollId, date: result.date },
          details: { changes: result.changes },
        });
      }
      return result;
    }),
  );

  /*
   * Option designs of a running or ended poll: add / change / remove a
   * design, switch between image and design. Body: `{ changes: [{ number,
   * design?: spec | null, display?: "image" | "design" }] }`.
   */
  app.post(
    "/fdc/polls/:pollId/designs",
    manageLimiter,
    express.json({ limit: "256kb" }),
    requireStorage,
    route(async (req) => {
      const { session, pollId } = await requireEditor(req);
      const rawChanges = Array.isArray(req.body?.changes) ? req.body.changes.slice(0, 6) : [];
      if (!rawChanges.length) throw httpError(400, "Nothing to change.");
      // Migrated for good: a design isn't taken away and the poll doesn't go back to the picture.
      if (picturesRetired() && rawChanges.some((change) => change?.design === null || change?.display === "image")) throw httpError(400, PICTURES_RETIRED);
      // What the options were before (a picture option getting its first design is a migration).
      const before = await archivePolls()
        .then((list) => list.find((entry) => String(entry.public.id) === String(pollId)) ?? null)
        .catch(() => null);
      const changes = await Promise.all(
        rawChanges.map(async (change) => ({
          number: Number(change?.number),
          design: change?.design === null ? null : change?.design ? await renderForBot(change.design, change.number) : undefined,
          display: change?.display,
        })),
      );
      const result = await botFetch(`/fdc/polls/${pollId}/designs`, {
        method: "POST",
        body: { actorId: session.discord_user_id, changes },
        timeout: 180_000,
      });
      readCache.clear();
      const actor = { discordId: session.discord_user_id, name: session.display_name || session.username };
      for (const change of changes) {
        if (!change.design || !before) continue;
        const raw = before.raw.options.find((option) => option.number === change.number);
        const shown = before.public.options.find((option) => option.number === change.number);
        await migration.recordManage(
          { date: before.public.date, optionNumber: change.number, description: shown?.description ?? null, hadDesign: Boolean(raw?.design), hadPicture: Boolean(raw?.media) },
          actor,
        );
      }
      audit(session, {
        level: result.archiveOnly ? "risky" : "normal",
        action: "fdc-design",
        summary: `changed the designs of the ${result.archiveOnly ? "ended " : ""}FDC ${result.date} (${result.options.map((option) => `option ${option.number}: shows ${option.display}`).join(", ")})`,
        target: { pollId, date: result.date },
        details: { options: result.options },
      });
      return result;
    }),
  );

  /* ---------- recycling bin (services/fdcRecycle.cjs) ---------- */

  const recycleBin = createRecycleBin(ARCHIVE_ROOT);

  async function requireRecycler(req) {
    const session = getRequestSession(req);
    if (!session) throw httpError(401, "Log in to use the recycling bin.");
    if (!(await canCreateFdc(session))) throw httpError(403, "Only FDC editors can use the recycling bin.");
    return {
      discordId: session.discord_user_id,
      name: session.display_name || session.username,
      avatarUrl: session.avatar_path ? `/${session.avatar_path}` : null,
    };
  }

  const recycleRoute = (handler, describe = null) =>
    route(async (req) => {
      const actor = await requireRecycler(req);
      const result = await handler(req, actor);
      if (describe) {
        const entry = describe(result, req);
        if (entry) activity?.append({ actor: { discordId: actor.discordId, name: actor.name }, ...entry });
      }
      return result;
    });

  app.get("/fdc/recycle", readLimiter, requireStorage, recycleRoute(() => recycleBin.snapshot()));
  app.get("/fdc/recycle/candidates", readLimiter, requireStorage, recycleRoute(() => recycleBin.candidates()));

  app.post(
    "/fdc/recycle/items",
    manageLimiter,
    requireStorage,
    recycleRoute(
      (req, actor) => recycleBin.add({ options: req.body?.options, folderId: req.body?.folderId ?? null }, actor),
      (result) =>
        result.added && {
          level: "normal",
          action: "recycle-add",
          summary: `recycled ${result.added} option(s)${result.folder ? ` into "${result.folder}"` : ""}`,
          details: { items: result.items },
        },
    ),
  );
  app.post(
    "/fdc/recycle/items/remove",
    manageLimiter,
    requireStorage,
    recycleRoute(
      (req, actor) => recycleBin.remove(req.body?.ids, actor),
      (result) =>
        result.removed && {
          level: "risky",
          action: "recycle-remove",
          summary: `removed ${result.removed} option(s) from the recycling bin`,
          details: { items: result.items },
        },
    ),
  );
  app.post(
    "/fdc/recycle/items/move",
    manageLimiter,
    requireStorage,
    recycleRoute(
      (req, actor) => recycleBin.move(req.body?.ids, req.body?.folderId ?? null, actor),
      (result) =>
        result.moved && {
          level: "detail",
          action: "recycle-move",
          summary: `moved ${result.moved} recycled option(s) to "${result.folder ?? "Unsorted"}"`,
          details: { items: result.items },
        },
    ),
  );
  app.post(
    "/fdc/recycle/folders",
    manageLimiter,
    requireStorage,
    recycleRoute(
      (req, actor) => recycleBin.createFolder(req.body?.name, actor),
      (folder) => ({ level: "detail", action: "recycle-folder-create", summary: `created the recycling folder "${folder.name}"` }),
    ),
  );
  app.post(
    "/fdc/recycle/folders/:id/rename",
    manageLimiter,
    requireStorage,
    recycleRoute(
      (req, actor) => recycleBin.renameFolder(req.params.id, req.body?.name, actor),
      (folder) => ({
        level: "normal",
        action: "recycle-folder-rename",
        summary: `renamed the recycling folder "${folder.previousName}" to "${folder.name}"`,
      }),
    ),
  );
  app.post(
    "/fdc/recycle/folders/:id/delete",
    manageLimiter,
    requireStorage,
    recycleRoute(
      (req, actor) => recycleBin.deleteFolder(req.params.id, actor),
      (result) => ({ level: "risky", action: "recycle-folder-delete", summary: `deleted the recycling folder "${result.name}"` }),
    ),
  );

  // Item images (ids are random, the images come from public polls anyway).
  app.get("/fdc/recycle/images/:id", imageLimiter, async (req, res) => {
    const file = await recycleBin.imagePath(req.params.id).catch(() => null);
    if (!file) return res.status(404).send("Image not found.");
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    return res.sendFile(file);
  });

  /* ---------- migration: picture options to designed cats (services/fdcMigration.cjs) ---------- */

  // Every poll in the archive (running ones too), the public shape plus the raw file.
  async function archivePolls() {
    const polls = [];
    for (const entry of await fs.readdir(ARCHIVE_ROOT, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || !DATE_PATTERN.test(entry.name)) continue;
      const raw = await readArchivedPoll(entry.name).catch(() => null);
      if (!raw || !Array.isArray(raw.options)) continue;
      try {
        polls.push({ raw, public: toPublicPoll(raw, entry.name) });
      } catch {
        // A broken archive entry: skip it.
      }
    }
    return polls.sort((a, b) => b.public.date.localeCompare(a.public.date));
  }

  // Saves a migrated design on a poll option (the bot owns the archive); the option then shows it.
  async function designPollOption(pollId, number, spec, actor) {
    if (!/^\d{17,20}$/.test(String(pollId))) throw httpError(400, "Invalid poll.");
    const design = await renderForBot(spec, number);
    const result = await botFetch(`/fdc/polls/${pollId}/designs`, {
      method: "POST",
      body: { actorId: actor.discordId, changes: [{ number, design, display: "design" }] },
      timeout: 180_000,
    });
    readCache.clear();
    return result;
  }

  const nameOfMember = (discordId) => {
    try {
      const row = getDatabase()?.prepare("SELECT display_name, username FROM users WHERE discord_user_id = ?").get(String(discordId));
      return row ? row.display_name || row.username : null;
    } catch {
      return null;
    }
  };

  const migration = createMigration(ARCHIVE_ROOT, { recycleBin, renderDesign, polls: archivePolls, designPoll: designPollOption, nameOf: nameOfMember });

  // The Stats page (FDC editors): the migration log, lobby cat taps and pets.
  registerStats(app, { requireStorage, getRequestSession, getDatabase, canView: canCreateFdc, migration });

  const suggestLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "That's a lot of suggestions. Please try again later." },
  });

  function memberOf(req) {
    const session = getRequestSession(req);
    if (!session) throw httpError(401, "Log in to help with the migration.");
    return {
      session,
      actor: { discordId: session.discord_user_id, name: session.display_name || session.username },
    };
  }

  // Images of bin items (the old picture is the reference), public like the polls they come from.
  app.get("/fdc/recycle/designs/:id", imageLimiter, async (req, res) => {
    const found = await recycleBin.designPath(req.params.id).catch(() => null);
    if (!found) return res.status(404).send("Design not found.");
    res.setHeader("Content-Type", found.type);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    return res.sendFile(found.file);
  });

  // Counts only: the FDC section shows "Migration" / "Contribute" while cats are left.
  app.get(
    "/fdc/migration/status",
    readLimiter,
    requireStorage,
    route(async (req) => {
      const session = getRequestSession(req);
      if (!session) return { remaining: 0, total: 0, migrated: 0, editor: false, loggedIn: false };
      return { ...(await migration.counts()), editor: await canCreateFdc(session), loggedIn: true };
    }),
  );

  app.get(
    "/fdc/migration",
    readLimiter,
    requireStorage,
    route(async (req) => {
      const { session, actor } = memberOf(req);
      return migration.overview(actor, { editor: await canCreateFdc(session) });
    }),
  );

  app.post(
    "/fdc/migration/:id/design",
    manageLimiter,
    express.json({ limit: "64kb" }),
    requireStorage,
    recycleRoute(
      (req, actor) => migration.design(req.params.id, req.body?.design, actor),
      (result) => ({
        level: "normal",
        action: "fdc-migrate",
        summary: result.source === "poll" ? `designed option ${result.optionNumber} ("${result.description}") of the FDC ${result.date}` : `designed the recycled cat "${result.description}"`,
        details: { id: result.id, date: result.date, option: result.optionNumber },
      }),
    ),
  );

  app.post(
    "/fdc/migration/:id/suggest",
    suggestLimiter,
    express.json({ limit: "64kb" }),
    requireStorage,
    route(async (req) => {
      const { actor } = memberOf(req);
      const standing = getModeration()?.standing?.(actor.discordId);
      if (standing?.banned || standing?.limited) throw httpError(403, "Your account is limited right now.");
      const result = await migration.suggest(req.params.id, req.body?.design, req.body?.note, actor, normalizeDesignSpec);
      activity?.append({ actor, level: "detail", action: "fdc-migrate-suggest", summary: `suggested a cat design for "${result.item}"` });
      return { ok: true, id: result.id };
    }),
  );

  app.post(
    "/fdc/migration/suggestions/:id/:decision",
    manageLimiter,
    express.json({ limit: "64kb" }),
    requireStorage,
    recycleRoute(
      async (req, actor) => {
        const decision = req.params.decision;
        if (decision !== "approve" && decision !== "reject") throw httpError(400, "Approve or reject.");
        const result = await migration.decide(req.params.id, decision === "approve", actor, req.body?.design ?? null);
        // Tell the member how it went (site notification, their preferences decide).
        if (result.by?.discordId && result.by.discordId !== actor.discordId) {
          getModeration()
            ?.notifyDiscord?.([result.by.discordId], {
              category: "fdc",
              title: result.approved ? "Your cat design was approved" : "Your cat design wasn't used",
              body: result.approved ? `Thanks! "${result.item}" is a designed cat now.` : "An editor looked at your suggestion and chose something else this time.",
              link: "/cult?fdc=migrate#fdc",
            })
            ?.catch?.(() => {});
        }
        return result;
      },
      (result) => ({ level: "normal", action: result.approved ? "fdc-migrate-approve" : "fdc-migrate-reject", summary: `${result.approved ? "approved" : "rejected"} a suggested cat design${result.by?.name ? ` by ${result.by.name}` : ""}` }),
    ),
  );

  let emojiCache = null;

  app.get(
    "/fdc/emojis",
    readLimiter,
    requireStorage,
    route(async (req) => {
      const session = getRequestSession(req);
      if (!session || !(await canCreateFdc(session))) {
        throw httpError(403, "Only FDC editors can browse server emojis here.");
      }

      if (!emojiCache || emojiCache.expires < Date.now()) {
        emojiCache = { value: await botFetch("/fdc/emojis"), expires: Date.now() + 60_000 };
      }
      return emojiCache.value;
    }),
  );

  app.post(
    "/fdc/emojis",
    manageLimiter,
    express.json({ limit: "16mb" }),
    requireStorage,
    route(async (req) => {
      const session = getRequestSession(req);
      if (!session) throw httpError(401, "Log in to upload emojis.");
      if (!(await canCreateFdc(session))) {
        throw httpError(403, "You are not allowed to upload emojis.");
      }

      const result = await botFetch("/fdc/emojis", {
        method: "POST",
        body: { name: req.body?.name, image: req.body?.image },
        timeout: 60_000,
      });

      emojiCache = null;
      console.log(`[FDC web] Emoji :${result.name}: uploaded by ${session.username}.`);
      audit(session, {
        level: "normal",
        action: "emoji-upload",
        summary: `uploaded the emoji :${result.name}:${result.animated ? " (animated)" : ""}`,
        target: { emojiId: result.id },
      });
      return result;
    }),
  );

  app.post(
    "/fdc/emojis/:id/delete",
    manageLimiter,
    requireStorage,
    route(async (req) => {
      const session = getRequestSession(req);
      if (!session) throw httpError(401, "Log in to delete emojis.");
      if (!(await canCreateFdc(session))) {
        throw httpError(403, "You are not allowed to delete emojis.");
      }
      if (req.body?.confirm !== true) throw httpError(400, "Confirmation required.");
      if (!/^\d{17,20}$/.test(req.params.id)) throw httpError(400, "Invalid emoji.");

      const result = await botFetch(`/fdc/emojis/${req.params.id}`, { method: "DELETE" });

      emojiCache = null;
      console.log(`[FDC web] Emoji :${result.name}: deleted by ${session.username}.`);
      audit(session, {
        level: "risky",
        action: "emoji-delete",
        summary: `deleted the bot emoji :${result.name}:`,
        target: { emojiId: req.params.id },
      });
      return result;
    }),
  );

  app.post(
    "/fdc/polls/:pollId/external-votes",
    manageLimiter,
    requireStorage,
    route(async (req) => {
      const { session, pollId } = await requireEditor(req);
      const result = await botFetch(`/fdc/polls/${pollId}/external-votes`, {
        method: "POST",
        body: {
          actorId: session.discord_user_id,
          source: req.body?.source,
          label: req.body?.label,
          counts: req.body?.counts ?? null,
        },
      });
      readCache.clear();
      console.log(`[FDC web] Poll ${pollId}: external votes (${req.body?.source}) by ${session.username}.`);
      const removed = !result.current;
      const total = (votes) => Object.values(votes?.counts ?? {}).reduce((sum, value) => sum + value, 0);
      audit(session, {
        level: removed ? "risky" : "normal",
        action: removed ? "fdc-votes-remove" : "fdc-votes-set",
        summary: removed
          ? `removed the votes from "${result.previous?.label ?? result.source}" on the FDC ${result.date}`
          : `set ${total(result.current)} votes from "${result.current.label}" on the FDC ${result.date}` +
            (result.previous ? ` (was ${total(result.previous)})` : ""),
        target: { pollId, date: result.date },
        details: { source: result.source, before: result.previous?.counts ?? null, after: result.current?.counts ?? null },
      });
      return result;
    }),
  );

  for (const action of ["close", "discard"]) {
    app.post(
      `/fdc/polls/:pollId/${action}`,
      manageLimiter,
      requireStorage,
      route(async (req) => {
        const { session, pollId } = await requireEditor(req);

        // The site asks for confirmation; the request has to say so too.
        if (req.body?.confirm !== true) throw httpError(400, "Confirmation required.");

        const result = await botFetch(`/fdc/polls/${pollId}/${action}`, {
          method: "POST",
          body: { actorId: session.discord_user_id },
          timeout: 60_000,
        });

        readCache.clear();
        console.log(`[FDC web] Poll ${pollId}: ${action} by ${session.username}.`);
        audit(session, {
          level: "risky",
          action: action === "close" ? "fdc-close" : "fdc-discard",
          summary:
            action === "close"
              ? `ended the FDC ${result.date} early`
              : `discarded the running FDC ${result.date} (${result.votes} votes deleted)`,
          target: { pollId, date: result.date },
          details: result,
        });
        return result;
      }),
    );
  }

  /* An FDC from before (Steam group chat …): archive only, editors. */
  app.post(
    "/fdc/polls/manual",
    createLimiter,
    express.json({ limit: CREATE_BODY_LIMIT }),
    requireStorage,
    route(async (req) => {
      const session = getRequestSession(req);
      if (!session) throw httpError(401, "Log in to add an FDC.");
      if (!(await canCreateFdc(session))) throw httpError(403, "You are not allowed to add FDCs.");

      const { endsAt, question, votes, winner } = req.body ?? {};
      const rawOptions = Array.isArray(req.body?.options) ? req.body.options.slice(0, 6) : [];
      if (picturesRetired() && rawOptions.some((option) => option?.image)) throw httpError(400, PICTURES_RETIRED);
      const options = await Promise.all(rawOptions.map(async (option, index) => ({ ...option, design: option?.design ? await renderForBot(option.design, index + 1) : null })));
      const result = await botFetch("/fdc/polls/manual", {
        method: "POST",
        body: { creatorId: session.discord_user_id, endsAt, question, options, votes, winner },
        timeout: 180_000,
      });

      readCache.clear();
      audit(session, {
        level: "risky",
        action: "fdc-create-manual",
        summary: winner
          ? `added the past FDC ${result.date} by hand (${result.options} option(s), only the winner known)`
          : `added the past FDC ${result.date} by hand (${result.options} options, ${result.votes} votes)`,
        target: { pollId: result.id, date: result.date },
        details: {
          question: question || null,
          options: (options ?? []).map((option, index) => ({
            number: index + 1,
            description: option?.description,
            emoji: option?.emoji || "default",
            image: option?.image?.name ?? null,
          })),
          votes: winner ? null : (votes ?? null),
          winner: winner ?? null,
        },
      });
      return result;
    }),
  );

  /* ---------- activity log (read only, editors) ---------- */

  app.get(
    "/account/activity",
    readLimiter,
    requireStorage,
    route(async (req) => {
      const session = getRequestSession(req);
      if (!session) throw httpError(401, "Log in to see the activity log.");
      if (!(await canCreateFdc(session))) throw httpError(403, "Only editors can see the activity log.");
      if (!activity) throw httpError(503, "The activity log is not available.");

      const view = ["risky", "normal", "verbose"].includes(req.query.view) ? req.query.view : "normal";
      return {
        ...(await activity.list({ view, before: req.query.before || null, search: String(req.query.q ?? "").slice(0, 100) })),
        integrity: await activity.verify(),
      };
    }),
  );

  let widgetCache = null;

  app.get(
    "/discord/widget",
    readLimiter,
    route(async (_req, res) => {
      if (widgetCache && widgetCache.expires > Date.now()) {
        res.set("Cache-Control", "public, max-age=30");
        return widgetCache.value;
      }

      let value;

      try {
        value = await botFetch("/discord/widget", { timeout: 5000 });
      } catch (error) {
        console.warn("[Widget] Bot unavailable, using invite data:", error.message);
        value = await inviteWidget();
      }

      value = { ...value, inviteUrl: `https://discord.gg/${DISCORD_INVITE_CODE}` };
      widgetCache = { value, expires: Date.now() + WIDGET_CACHE_MS };
      res.set("Cache-Control", "public, max-age=30");
      return value;
    }),
  );

  let lobbyCache = null;

  // Guests' codes all go to review, but keep the review channel quiet.
  const lobbyGuestLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many lobby codes submitted. Please try again later." },
  });

  const lobbyUserLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many lobby codes submitted. Please try again later." },
  });

  /*
   * Submit a lobby code. The session decides how it is handled by the bot
   * (services/lobbySubmissions.cjs): admin-code sessions post directly,
   * Discord logins post directly when privileged and otherwise need
   * approval, guests (with a name) always need approval.
   */
  app.post(
    "/discord/lobby",
    (req, res, next) => {
      let session = null;
      try {
        session = getRequestSession(req);
      } catch {
        session = null;
      }
      req.lobbySession = session;
      return (session ? lobbyUserLimiter : lobbyGuestLimiter)(req, res, next);
    },
    route(async (req) => {
      const session = req.lobbySession;
      const { code, description, guestName } = req.body ?? {};

      const body = session
        ? {
            mode: session.discord_user_id === ADMIN_DISCORD_USER_ID ? "admin" : "user",
            userId: session.discord_user_id,
            code,
            description,
          }
        : { mode: "guest", guestName, code, description };

      const result = await botFetch("/discord/lobby", {
        method: "POST",
        body,
        timeout: 20_000,
      });

      if (result.status === "posted") lobbyCache = null;

      console.log(
        `[Lobby] Web submission (${body.mode}${session ? ` ${session.username}` : ""}): ${result.status}.`,
      );
      activity?.append({
        level: "normal",
        action: "lobby-submit",
        actor: session ? actorOf(session) : { discordId: null, name: `${String(guestName ?? "").slice(0, 32)} (guest)` },
        summary: `${result.status === "posted" ? "posted" : "sent for approval"} a lobby code`,
        details: { code, description: description || null, mode: body.mode },
      });

      return result;
    }),
  );

  /* Lobby code with the updater's avatar and resolved mentions (via the bot). */
  app.get(
    "/discord/lobby",
    readLimiter,
    route(async () => {
      if (lobbyCache && lobbyCache.expires > Date.now()) return lobbyCache.value;

      let value;

      try {
        value = await botFetch("/discord/lobby", { timeout: 5000 });
      } catch (error) {
        console.warn("[Lobby] Bot unavailable, serving the saved file:", error.message);
        value = { ...((await readJson(LOBBY_FILE)) ?? { code: null }), mentions: {} };
      }

      // Mentioned people with a site profile (not private) link to it.
      const users = value.mentions?.users;
      const db = getDatabase();
      if (users && db) {
        for (const [id, user] of Object.entries(users)) {
          const row = db.prepare("SELECT username, profile_visibility FROM users WHERE discord_user_id = ?").get(id);
          if (row && row.profile_visibility !== "private") user.key = `@${row.username}`;
        }
      }

      lobbyCache = { value, expires: Date.now() + LOBBY_CACHE_MS };
      return value;
    }),
  );
}

module.exports = {
  registerFdcWeb,
  canCreateFdc,
  /** Paths whose body is parsed by their own (larger) JSON parser. */
  // Upload routes: new polls and image edits of running polls.
  LARGE_BODY_PATHS: {
    has: (requestPath) =>
      requestPath === "/fdc/polls" ||
      requestPath === "/fdc/polls/manual" ||
      requestPath === "/fdc/emojis" ||
      // An .ics file (up to 6 MB), parsed by dashCalendar.cjs.
      requestPath === "/calendars/import" ||
      // Contacts from a .vcf (photos included), parsed by dashContacts.cjs.
      requestPath === "/contacts/import" ||
      requestPath === "/bongo/admin/import/start" ||
      /^\/bongo\/admin\/import\/[0-9a-f]+\/file$/.test(requestPath) ||
      /^\/fdc\/polls\/\d{17,20}\/(edit|designs)$/.test(requestPath),
  },
};
