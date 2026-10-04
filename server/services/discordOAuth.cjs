const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const rateLimit = require("express-rate-limit");

const Database = require("better-sqlite3");
const sharp = require("sharp");
const { v7: uuidv7 } = require("uuid");

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_CDN = "https://cdn.discordapp.com";

const DB_DIR = path.join(__dirname, "db");
const DB_PATH = path.join(DB_DIR, "accounts.sqlite");
const AVATAR_DIR = path.join(__dirname, "avatars");

const AUTH_COOKIE_NAME = "__Secure-homesite_auth";
const OAUTH_STATE_COOKIE_NAME = "__Secure-homesite_oauth_state";

const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

const SESSION_TTL_DAYS = Math.max(
  1,
  Number(process.env.SESSION_TTL_DAYS || 30),
);

const ALLOWED_THEMES = new Set(["dark", "light"]);

const ALLOWED_LANGUAGES = new Set([
  "bar",
  "de",
  "en",
  "es",
  "fr",
  "hr",
  "it",
  "lv",
  "uk",
]);

function nowIso() {
  return new Date().toISOString();
}

function getSessionMaxAgeMs() {
  return SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
}

function createRandomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function safeTokenEqual(expected, received) {
  if (typeof expected !== "string" || typeof received !== "string") {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(received, "utf8");

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function parseSettings(value) {
  if (!value || typeof value !== "string") {
    return {};
  }

  try {
    const parsed = JSON.parse(value);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const settings = {};

    if (ALLOWED_THEMES.has(parsed.theme)) {
      settings.theme = parsed.theme;
    }

    if (ALLOWED_LANGUAGES.has(parsed.language)) {
      settings.language = parsed.language;
    }

    return settings;
  } catch {
    return {};
  }
}

function getDefaultDiscordAvatarUrl(discordUser) {
  const index = Number(discordUser?.discriminator || 0) % 5;

  return `${DISCORD_CDN}/embed/avatars/${index}.png`;
}

function getGlobalDiscordAvatarUrl(discordUser) {
  if (!discordUser?.avatar) {
    return getDefaultDiscordAvatarUrl(discordUser);
  }

  const extension = discordUser.avatar.startsWith("a_") ? "gif" : "webp";

  return `${DISCORD_CDN}/avatars/${discordUser.id}/${discordUser.avatar}.${extension}?size=256`;
}

function getGuildDiscordAvatarUrl(discordUserId, guildAvatarHash) {
  if (!guildAvatarHash) {
    return null;
  }

  const extension = guildAvatarHash.startsWith("a_") ? "gif" : "webp";

  return `${DISCORD_CDN}/guilds/${process.env.DISCORD_GUILD_ID}/users/${discordUserId}/avatars/${guildAvatarHash}.${extension}?size=256`;
}

async function ensureStorageDirectories() {
  await fs.mkdir(DB_DIR, {
    recursive: true,
    mode: 0o700,
  });

  await fs.mkdir(AVATAR_DIR, {
    recursive: true,
    mode: 0o700,
  });
}

function ensureSettingsColumn(db) {
  const columns = db.prepare("PRAGMA table_info(users)").all();

  const hasSettingsColumn = columns.some(
    (column) => column.name === "settings_json",
  );

  if (!hasSettingsColumn) {
    db.exec(`
      ALTER TABLE users
      ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}'
    `);

    console.log("[Accounts] Added users.settings_json column.");
  }
}

function ensureRoleColumn(db) {
  const columns = db.prepare("PRAGMA table_info(users)").all();

  const hasRoleColumn = columns.some((column) => column.name === "role");

  if (!hasRoleColumn) {
    db.exec(`
      ALTER TABLE users
      ADD COLUMN role TEXT NOT NULL DEFAULT 'user'
    `);

    console.log("[Accounts] Added users.role column.");
  }
}

function openDatabase() {
  const db = new Database(DB_PATH);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      discord_user_id TEXT NOT NULL UNIQUE,

      username TEXT NOT NULL,
      display_name TEXT NOT NULL,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      settings_json TEXT NOT NULL DEFAULT '{}',

      avatar_path TEXT,
      avatar_updated_at TEXT,

      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique
      ON users(email)
      WHERE email IS NOT NULL;

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,

      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,

      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS sessions_user_id_idx
      ON sessions(user_id);

    CREATE INDEX IF NOT EXISTS sessions_expires_at_idx
      ON sessions(expires_at);
  `);

  ensureSettingsColumn(db);
  ensureRoleColumn(db);

  return db;
}

async function fetchGuildMember(discordUserId) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!botToken || !guildId) {
    return null;
  }

  const response = await fetch(
    `${DISCORD_API}/guilds/${guildId}/members/${discordUserId}`,
    {
      headers: {
        Authorization: `Bot ${botToken}`,
      },
    },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `Discord guild-member lookup failed with HTTP ${response.status}.`,
    );
  }

  return response.json();
}

async function getPreferredDiscordAvatar(discordUser) {
  try {
    const guildMember = await fetchGuildMember(discordUser.id);

    if (guildMember?.avatar) {
      const url = getGuildDiscordAvatarUrl(discordUser.id, guildMember.avatar);

      if (url) {
        return {
          source: "guild",
          url,
          isAnimated: guildMember.avatar.startsWith("a_"),
        };
      }
    }
  } catch (error) {
    console.warn(
      `[OAuth] Guild avatar lookup failed for Discord user ${discordUser.id}:`,
      error.message,
    );
  }

  return {
    source: "global",
    url: getGlobalDiscordAvatarUrl(discordUser),
    isAnimated: Boolean(discordUser.avatar?.startsWith("a_")),
  };
}

async function downloadAndSaveAvatar(discordUser, userId) {
  const preferredAvatar = await getPreferredDiscordAvatar(discordUser);

  const finalPath = path.join(AVATAR_DIR, `${userId}.webp`);
  const temporaryPath = `${finalPath}.${crypto.randomUUID()}.tmp`;

  const avatarResponse = await fetch(preferredAvatar.url, {
    headers: {
      Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,*/*",
    },
  });

  if (!avatarResponse.ok) {
    throw new Error(
      `Discord ${preferredAvatar.source} avatar download failed with HTTP ${avatarResponse.status}.`,
    );
  }

  const avatarBuffer = Buffer.from(await avatarResponse.arrayBuffer());

  try {
    const image = sharp(avatarBuffer, {
      animated: preferredAvatar.isAnimated,
    });

    const metadata = await image.metadata();

    const animationDelay = Array.isArray(metadata.delay)
      ? metadata.delay
      : undefined;

    const animationLoop = Number.isInteger(metadata.loop) ? metadata.loop : 0;

    await image
      .rotate()
      .resize(256, 256, {
        fit: "cover",
        position: "centre",
        withoutEnlargement: true,
      })
      .webp({
        quality: 88,
        effort: 4,
        loop: animationLoop,
        delay: animationDelay,
      })
      .toFile(temporaryPath);

    await fs.rename(temporaryPath, finalPath);
  } catch (error) {
    await fs
      .rm(temporaryPath, {
        force: true,
      })
      .catch(() => {});

    throw error;
  }

  console.log(
    `[OAuth] Updated ${preferredAvatar.isAnimated ? "animated " : ""}${preferredAvatar.source} avatar for local user ${userId}.`,
  );

  return `avatars/${userId}.webp`;
}

function registerDiscordOAuth(app) {
  const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: "Too many authentication requests. Please try again later.",
    },
  });

  const accountReadRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: "Too many account requests. Please try again later.",
    },
  });

  const accountMutationRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: "Too many account changes. Please try again later.",
    },
  });

  const avatarRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: "Too many avatar requests. Please try again later.",
    },
  });

  let db = null;

  const storageReady = ensureStorageDirectories().then(() => {
    db = openDatabase();

    console.log(`[Accounts] SQLite database: ${DB_PATH}`);
    console.log(`[Accounts] Avatar directory: ${AVATAR_DIR}`);
  });

  function requireStorage(_req, res, next) {
    storageReady.then(
      () => next(),
      (error) => {
        console.error("[Accounts] Storage startup error:", error);

        return res.status(500).json({
          error: "Account storage is unavailable.",
        });
      },
    );
  }

  function getUserById(userId) {
    return db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  }

  function getUserByDiscordId(discordUserId) {
    return db
      .prepare("SELECT * FROM users WHERE discord_user_id = ?")
      .get(String(discordUserId));
  }

  function createUserFromDiscord(discordUser) {
    const now = nowIso();

    const user = {
      id: uuidv7(),
      discordUserId: String(discordUser.id),
      username: String(discordUser.username || "unknown"),
      role: "user",
      displayName: String(
        discordUser.global_name || discordUser.username || "Unknown user",
      ),
      email: discordUser.email ? String(discordUser.email) : null,
      settingsJson: "{}",
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    };

    db.prepare(
      `
      INSERT INTO users (
        id,
        discord_user_id,
        username,
        display_name,
        email,
        role,
        settings_json,
        created_at,
        updated_at,
        last_login_at
      ) VALUES (
        @id,
        @discordUserId,
        @username,
        @displayName,
        @email,
        @role,
        @settingsJson,
        @createdAt,
        @updatedAt,
        @lastLoginAt
      )
    `,
    ).run(user);

    return getUserById(user.id);
  }

  function updateUserFromDiscord(userId, discordUser) {
    const now = nowIso();

    db.prepare(
      `
      UPDATE users
      SET
        username = ?,
        display_name = ?,
        email = COALESCE(?, email),
        updated_at = ?,
        last_login_at = ?
      WHERE id = ?
    `,
    ).run(
      String(discordUser.username || "unknown"),
      String(discordUser.global_name || discordUser.username || "Unknown user"),
      discordUser.email ? String(discordUser.email) : null,
      now,
      now,
      userId,
    );

    return getUserById(userId);
  }

  function upsertUserFromDiscord(discordUser) {
    const existingUser = getUserByDiscordId(discordUser.id);

    if (existingUser) {
      return updateUserFromDiscord(existingUser.id, discordUser);
    }

    return createUserFromDiscord(discordUser);
  }

  function updateAvatarPath(userId, avatarPath) {
    const now = nowIso();

    db.prepare(
      `
      UPDATE users
      SET
        avatar_path = ?,
        avatar_updated_at = ?,
        updated_at = ?
      WHERE id = ?
    `,
    ).run(avatarPath, now, now, userId);

    return getUserById(userId);
  }

  function updateUserSettings(userId, currentSettings, updates) {
    const nextSettings = {
      ...currentSettings,
      ...updates,
    };

    const now = nowIso();

    db.prepare(
      `
      UPDATE users
      SET
        settings_json = ?,
        updated_at = ?
      WHERE id = ?
    `,
    ).run(JSON.stringify(nextSettings), now, userId);

    return nextSettings;
  }

  function deleteExpiredSessions() {
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(nowIso());
  }

  function createPersistentSession(userId) {
    deleteExpiredSessions();

    const rawToken = createRandomToken();
    const createdAt = new Date();
    const expiresAt = new Date(
      createdAt.getTime() + getSessionMaxAgeMs(),
    ).toISOString();

    db.prepare(
      `
      INSERT INTO sessions (
        id,
        user_id,
        token_hash,
        created_at,
        expires_at,
        last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
    ).run(
      crypto.randomUUID(),
      userId,
      hashToken(rawToken),
      createdAt.toISOString(),
      expiresAt,
      createdAt.toISOString(),
    );

    return {
      token: rawToken,
      expiresAt,
    };
  }

  function getAuthenticatedUser(rawToken) {
    if (!rawToken || typeof rawToken !== "string") {
      return null;
    }

    const now = nowIso();

    const accountSession = db
      .prepare(
        `
        SELECT
          sessions.id AS session_id,
          sessions.expires_at,

          users.id AS user_id,
          users.username,
          users.display_name,
          users.avatar_path,
          users.settings_json
        FROM sessions
        INNER JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ?
          AND sessions.expires_at > ?
        LIMIT 1
      `,
      )
      .get(hashToken(rawToken), now);

    if (!accountSession) {
      return null;
    }

    db.prepare(
      `
      UPDATE sessions
      SET last_seen_at = ?
      WHERE id = ?
    `,
    ).run(now, accountSession.session_id);

    return accountSession;
  }

  function deletePersistentSession(rawToken) {
    if (!rawToken || typeof rawToken !== "string") {
      return;
    }

    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(
      hashToken(rawToken),
    );
  }

  function setAuthCookie(res, rawToken) {
    res.cookie(AUTH_COOKIE_NAME, rawToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: getSessionMaxAgeMs(),
    });
  }

  function clearAuthCookie(res) {
    res.clearCookie(AUTH_COOKIE_NAME, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
  }

  function setOAuthStateCookie(res, state) {
    res.cookie(OAUTH_STATE_COOKIE_NAME, state, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/auth/discord",
      maxAge: OAUTH_STATE_MAX_AGE_MS,
    });
  }

  function clearOAuthStateCookie(res) {
    res.clearCookie(OAUTH_STATE_COOKIE_NAME, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/auth/discord",
    });
  }

  function toPublicUser(accountSession) {
    const apiOrigin = String(process.env.API_ORIGIN || "").replace(/\/$/, "");

    return {
      id: accountSession.user_id,
      username: accountSession.username,
      displayName: accountSession.display_name,
      avatarUrl: accountSession.avatar_path
        ? `${apiOrigin}/${accountSession.avatar_path}`
        : null,
      settings: parseSettings(accountSession.settings_json),
    };
  }

  function requireAuthenticatedUser(req, res, next) {
    const rawToken = req.cookies?.[AUTH_COOKIE_NAME];
    const accountSession = getAuthenticatedUser(rawToken);

    if (!accountSession) {
      clearAuthCookie(res);

      return res.status(401).json({
        authenticated: false,
      });
    }

    req.accountSession = accountSession;

    return next();
  }

  app.get("/auth/discord", authRateLimiter, requireStorage, (_req, res) => {
    const state = createRandomToken();

    setOAuthStateCookie(res, state);

    const query = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      redirect_uri: process.env.DISCORD_REDIRECT_URI,
      response_type: "code",
      scope: "identify",
      state,
      prompt: "consent",
    });

    return res.redirect(
      `https://discord.com/oauth2/authorize?${query.toString()}`,
    );
  });

  app.get(
    "/auth/discord/callback",
    authRateLimiter,
    requireStorage,
    async (req, res) => {
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const expectedState = req.cookies?.[OAUTH_STATE_COOKIE_NAME];

      clearOAuthStateCookie(res);

      if (!code || !state || !safeTokenEqual(expectedState, state)) {
        return res
          .status(400)
          .send("Invalid or expired Discord login request.");
      }

      try {
        const tokenResponse = await fetch(`${DISCORD_API}/oauth2/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: "authorization_code",
            code,
            redirect_uri: process.env.DISCORD_REDIRECT_URI,
          }),
        });

        if (!tokenResponse.ok) {
          console.error(
            "[OAuth] Discord token exchange failed:",
            await tokenResponse.text(),
          );

          return res.status(401).send("Discord login failed.");
        }

        const tokens = await tokenResponse.json();

        const userResponse = await fetch(`${DISCORD_API}/users/@me`, {
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
          },
        });

        if (!userResponse.ok) {
          console.error(
            "[OAuth] Discord user fetch failed:",
            await userResponse.text(),
          );

          return res.status(401).send("Could not load Discord user.");
        }

        const discordUser = await userResponse.json();

        if (!discordUser?.id || !discordUser?.username) {
          return res
            .status(401)
            .send("Discord returned an invalid user profile.");
        }

        let user = upsertUserFromDiscord(discordUser);

        try {
          const avatarPath = await downloadAndSaveAvatar(discordUser, user.id);
          user = updateAvatarPath(user.id, avatarPath);
        } catch (avatarError) {
          console.warn(
            `[OAuth] Avatar update failed for user ${user.id}:`,
            avatarError.message,
          );
        }

        const oldToken = req.cookies?.[AUTH_COOKIE_NAME];

        if (oldToken) {
          deletePersistentSession(oldToken);
        }

        const persistentSession = createPersistentSession(user.id);

        setAuthCookie(res, persistentSession.token);

        return res.redirect(
          process.env.FRONTEND_REDIRECT_URL || process.env.FRONTEND_ORIGIN,
        );
      } catch (error) {
        console.error("[OAuth] Discord callback error:", error);

        return res.status(500).send("An internal server error occurred.");
      }
    },
  );

  app.get("/auth/me", accountReadRateLimiter, requireStorage, (req, res) => {
    const rawToken = req.cookies?.[AUTH_COOKIE_NAME];
    const accountSession = getAuthenticatedUser(rawToken);

    if (!accountSession) {
      clearAuthCookie(res);

      return res.status(401).json({
        authenticated: false,
      });
    }

    return res.json({
      authenticated: true,
      user: toPublicUser(accountSession),
    });
  });

  app.patch(
    "/account/settings",
    accountMutationRateLimiter,
    requireStorage,
    requireAuthenticatedUser,
    (req, res) => {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const updates = {};

      if (Object.prototype.hasOwnProperty.call(body, "theme")) {
        if (!ALLOWED_THEMES.has(body.theme)) {
          return res.status(400).json({
            error: "Invalid theme.",
          });
        }

        updates.theme = body.theme;
      }

      if (Object.prototype.hasOwnProperty.call(body, "language")) {
        if (!ALLOWED_LANGUAGES.has(body.language)) {
          return res.status(400).json({
            error: "Invalid language.",
          });
        }

        updates.language = body.language;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({
          error: "No valid settings were provided.",
        });
      }

      const currentSettings = parseSettings(req.accountSession.settings_json);

      const settings = updateUserSettings(
        req.accountSession.user_id,
        currentSettings,
        updates,
      );

      return res.json({
        settings,
      });
    },
  );

  app.post(
    "/auth/logout",
    accountMutationRateLimiter,
    requireStorage,
    (req, res) => {
      const rawToken = req.cookies?.[AUTH_COOKIE_NAME];

      deletePersistentSession(rawToken);
      clearAuthCookie(res);

      return res.status(204).end();
    },
  );

  app.get(
    "/avatars/:userId.webp",
    avatarRateLimiter,
    requireStorage,
    async (req, res) => {
      const userId = String(req.params.userId || "");

      if (!isUuid(userId)) {
        return res.status(400).send("Invalid avatar ID.");
      }

      const avatarPath = path.join(AVATAR_DIR, `${userId}.webp`);

      try {
        await fs.access(avatarPath);

        res.setHeader("Content-Type", "image/webp");
        res.setHeader("Cache-Control", "public, max-age=3600");

        return res.sendFile(avatarPath);
      } catch {
        return res.status(404).send("Avatar not found.");
      }
    },
  );
}

module.exports = {
  registerDiscordOAuth,
};
