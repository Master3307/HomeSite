const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const Database = require("better-sqlite3");
const sharp = require("sharp");
const { v7: uuidv7 } = require("uuid");

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_CDN = "https://cdn.discordapp.com";

const DB_DIR = path.join(__dirname, "db");
const DB_PATH = path.join(DB_DIR, "accounts.sqlite");
const AVATAR_DIR = path.join(__dirname, "avatars");

const AUTH_COOKIE_NAME = "__Secure-homesite_auth";

const SESSION_TTL_DAYS = Math.max(
  1,
  Number(process.env.SESSION_TTL_DAYS || 30),
);

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

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function getDiscordAvatarUrl(discordUser) {
  if (!discordUser?.avatar) {
    const index = Number(discordUser?.discriminator || 0) % 5;

    return `${DISCORD_CDN}/embed/avatars/${index}.png`;
  }

  const extension = discordUser.avatar.startsWith("a_") ? "gif" : "webp";

  return `${DISCORD_CDN}/avatars/${discordUser.id}/${discordUser.avatar}.${extension}?size=256`;
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

  return db;
}

async function downloadAndSaveAvatar(discordUser, userId) {
  const remoteAvatarUrl = getDiscordAvatarUrl(discordUser);

  const finalPath = path.join(AVATAR_DIR, `${userId}.webp`);
  const temporaryPath = `${finalPath}.${crypto.randomUUID()}.tmp`;

  const avatarResponse = await fetch(remoteAvatarUrl, {
    headers: {
      Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,*/*",
    },
  });

  if (!avatarResponse.ok) {
    throw new Error(
      `Discord avatar download failed with HTTP ${avatarResponse.status}.`,
    );
  }

  const avatarBuffer = Buffer.from(await avatarResponse.arrayBuffer());

  try {
    await sharp(avatarBuffer, {
      animated: false,
    })
      .rotate()
      .resize(256, 256, {
        fit: "cover",
        position: "centre",
        withoutEnlargement: true,
      })
      .webp({
        quality: 88,
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

  return `avatars/${userId}.webp`;
}

function destroyOAuthSession(req) {
  return new Promise((resolve) => {
    if (!req.session) {
      resolve();
      return;
    }

    req.session.destroy(() => resolve());
  });
}

function registerDiscordOAuth(app) {
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
      displayName: String(
        discordUser.global_name || discordUser.username || "Unknown user",
      ),
      email: discordUser.email ? String(discordUser.email) : null,
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
        created_at,
        updated_at,
        last_login_at
      ) VALUES (
        @id,
        @discordUserId,
        @username,
        @displayName,
        @email,
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

    const session = db
      .prepare(
        `
        SELECT
          sessions.id AS session_id,
          sessions.expires_at,

          users.id AS user_id,
          users.username,
          users.display_name,
          users.avatar_path
        FROM sessions
        INNER JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ?
          AND sessions.expires_at > ?
        LIMIT 1
      `,
      )
      .get(hashToken(rawToken), now);

    if (!session) {
      return null;
    }

    db.prepare(
      `
      UPDATE sessions
      SET last_seen_at = ?
      WHERE id = ?
    `,
    ).run(now, session.session_id);

    return session;
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

  function toPublicUser(session) {
    const apiOrigin = String(process.env.API_ORIGIN || "").replace(/\/$/, "");

    return {
      id: session.user_id,
      username: session.username,
      displayName: session.display_name,
      avatarUrl: session.avatar_path
        ? `${apiOrigin}/${session.avatar_path}`
        : null,
    };
  }

  app.get("/auth/discord", requireStorage, (req, res) => {
    const state = crypto.randomBytes(32).toString("base64url");

    req.session.oauthState = state;

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

  app.get("/auth/discord/callback", requireStorage, async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";

    if (!code || !state || state !== req.session?.oauthState) {
      return res.status(400).send("Invalid or expired Discord login request.");
    }

    delete req.session.oauthState;

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

      const persistentSession = createPersistentSession(user.id);

      setAuthCookie(res, persistentSession.token);

      await destroyOAuthSession(req);

      return res.redirect(
        process.env.FRONTEND_REDIRECT_URL || process.env.FRONTEND_ORIGIN,
      );
    } catch (error) {
      console.error("[OAuth] Discord callback error:", error);

      return res.status(500).send("An internal server error occurred.");
    }
  });

  app.get("/auth/me", requireStorage, (req, res) => {
    const rawToken = req.cookies?.[AUTH_COOKIE_NAME];
    const session = getAuthenticatedUser(rawToken);

    if (!session) {
      clearAuthCookie(res);

      return res.status(401).json({
        authenticated: false,
      });
    }

    return res.json({
      authenticated: true,
      user: toPublicUser(session),
    });
  });

  app.post("/auth/logout", requireStorage, async (req, res) => {
    const rawToken = req.cookies?.[AUTH_COOKIE_NAME];

    deletePersistentSession(rawToken);
    clearAuthCookie(res);

    await destroyOAuthSession(req);

    return res.status(204).end();
  });

  app.get("/avatars/:userId.webp", requireStorage, async (req, res) => {
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
  });
}

module.exports = {
  registerDiscordOAuth,
};
