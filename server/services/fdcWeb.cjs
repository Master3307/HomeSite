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
const { createRecycleBin } = require("./fdcRecycle.cjs");

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

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

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

function canVote(session) {
  return Boolean(session && session.discord_user_id !== ADMIN_DISCORD_USER_ID);
}

async function voterList(poll) {
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

function registerFdcWeb(app, { requireStorage, getRequestSession }) {
  const readLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
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
          canVote: canVote(session),
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
          canVote: canVote(session),
          myVote: myVote?.optionNumber ?? null,
          canManage: poll.status === "active" && (await canCreateFdc(session)),
          // Editors can recycle options of ended polls.
          recycled:
            poll.status !== "active" && (await canCreateFdc(session))
              ? (await recycleBin.keys()).filter((key) => key.startsWith(`${date}:`)).map((key) => Number(key.split(":")[1]))
              : null,
        },
        // Voter identities are only shown to logged-in users.
        voters: session ? await voterList(poll) : null,
      };
    }),
  );

  app.get("/fdc/images/:date/:file", readLimiter, async (req, res) => {
    const { date, file } = req.params;

    if (!DATE_PATTERN.test(date) || !/^[1-6]\.webp$/.test(file)) {
      return res.status(400).send("Invalid image.");
    }

    try {
      const imagePath = path.join(ARCHIVE_ROOT, date, file);
      await fs.access(imagePath);

      res.setHeader("Content-Type", "image/webp");
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
      if (!canVote(session)) throw httpError(403, "This account cannot vote.");

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

      const { endsAt, options } = req.body ?? {};

      const result = await botFetch("/fdc/polls", {
        method: "POST",
        body: { creatorId: session.discord_user_id, endsAt, options },
        timeout: 180_000,
      });

      readCache.clear();
      console.log(
        `[FDC web] Poll ${result.id} (${result.date}) created by ${session.username}.`,
      );

      return result;
    }),
  );

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

      const result = await botFetch(`/fdc/polls/${pollId}/edit`, {
        method: "POST",
        body: { actorId: session.discord_user_id, options: req.body?.options },
        timeout: 180_000,
      });

      readCache.clear();
      console.log(`[FDC web] Poll ${pollId} edited by ${session.username}.`);
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

  const recycleRoute = (handler) =>
    route(async (req) => handler(req, await requireRecycler(req)));

  app.get("/fdc/recycle", readLimiter, requireStorage, recycleRoute(() => recycleBin.snapshot()));
  app.get("/fdc/recycle/candidates", readLimiter, requireStorage, recycleRoute(() => recycleBin.candidates()));

  app.post(
    "/fdc/recycle/items",
    manageLimiter,
    requireStorage,
    recycleRoute((req, actor) => recycleBin.add({ options: req.body?.options, folderId: req.body?.folderId ?? null }, actor)),
  );
  app.post(
    "/fdc/recycle/items/remove",
    manageLimiter,
    requireStorage,
    recycleRoute((req, actor) => recycleBin.remove(req.body?.ids, actor)),
  );
  app.post(
    "/fdc/recycle/items/move",
    manageLimiter,
    requireStorage,
    recycleRoute((req, actor) => recycleBin.move(req.body?.ids, req.body?.folderId ?? null, actor)),
  );
  app.post(
    "/fdc/recycle/folders",
    manageLimiter,
    requireStorage,
    recycleRoute((req, actor) => recycleBin.createFolder(req.body?.name, actor)),
  );
  app.post(
    "/fdc/recycle/folders/:id/rename",
    manageLimiter,
    requireStorage,
    recycleRoute((req, actor) => recycleBin.renameFolder(req.params.id, req.body?.name, actor)),
  );
  app.post(
    "/fdc/recycle/folders/:id/delete",
    manageLimiter,
    requireStorage,
    recycleRoute((req, actor) => recycleBin.deleteFolder(req.params.id, actor)),
  );

  // Item images (ids are random, the images come from public polls anyway).
  app.get("/fdc/recycle/images/:id", readLimiter, async (req, res) => {
    const file = await recycleBin.imagePath(req.params.id).catch(() => null);
    if (!file) return res.status(404).send("Image not found.");
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    return res.sendFile(file);
  });

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
        return result;
      }),
    );
  }

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

      lobbyCache = { value, expires: Date.now() + LOBBY_CACHE_MS };
      return value;
    }),
  );
}

module.exports = {
  registerFdcWeb,
  /** Paths whose body is parsed by their own (larger) JSON parser. */
  // Upload routes: new polls and image edits of running polls.
  LARGE_BODY_PATHS: {
    has: (requestPath) =>
      requestPath === "/fdc/polls" ||
      requestPath === "/fdc/emojis" ||
      /^\/fdc\/polls\/\d{17,20}\/edit$/.test(requestPath),
  },
};
