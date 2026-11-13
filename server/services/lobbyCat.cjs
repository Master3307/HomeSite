const rateLimit = require("express-rate-limit");

/*
 * LobbyCat trust: points, level, petting streak and milestones per account,
 * stored in the accounts database (table lobby_cat).
 *
 * The website reports what happened (pets, a mood answer, milestone ids)
 * and the server does the scoring, so points can't simply be posted.
 * Keep LEVELS and the scoring in sync with src/lib/lobbyCatBrain/progress.js,
 * which applies the same rules locally for guests.
 *
 *   GET  /lobby-cat         -> state (401 for guests)
 *   POST /lobby-cat/events  -> { day, pets, mood, milestones } -> state + result
 */

// Points needed for each trust level (index = level).
// Exponential: each level needs about 1.7× the points of the one before.
const LEVELS = [0, 30, 90, 200, 400, 750, 1350, 2400, 4200, 7300, 12500, 21000];

const POINTS = {
  pet: 1,
  dailyPetCap: 60, // points from pets per day
  firstPetOfDay: 3,
  streakBonusPerDay: 2, // + per day of streak beyond the first
  streakBonusMaxDays: 10,
  mood: 5, // once per day
};

const MOODS = new Set(["great", "okay", "down", "tired"]);
const MILESTONE_ID = /^[a-z0-9][a-z0-9:._-]{0,63}$/;
const MAX_MILESTONES = 400;
const MAX_MILESTONES_PER_REQUEST = 25;
const MAX_PETS_PER_REQUEST = 60;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function levelFor(points) {
  let level = 0;
  for (let index = 0; index < LEVELS.length; index += 1) {
    if (points >= LEVELS[index]) level = index;
  }
  return level;
}

function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function shiftDay(day, offset) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return utcDay(date);
}

/* The client's local date, as long as it is plausible (time zones span ±1 day). */
function resolveDay(input) {
  const today = utcDay();
  if (typeof input === "string" && DAY_PATTERN.test(input)) {
    if ([shiftDay(today, -1), today, shiftDay(today, 1)].includes(input)) return input;
  }
  return today;
}

function parseMilestones(json) {
  try {
    const value = JSON.parse(json || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function toState(row) {
  // Computed from points, so a change to LEVELS applies to old rows too.
  const level = levelFor(row.points);
  return {
    points: row.points,
    level,
    levelStart: LEVELS[level],
    nextLevelAt: LEVELS[level + 1] ?? null,
    totalPets: row.total_pets,
    streak: row.streak,
    bestStreak: row.best_streak,
    lastPetDay: row.last_pet_day,
    lastMood: row.last_mood,
    lastMoodDay: row.last_mood_day,
    milestones: parseMilestones(row.milestones_json),
  };
}

function registerLobbyCat(app, { requireStorage, getRequestSession, getDatabase }) {
  let prepared = null;

  function statements() {
    if (prepared) return prepared;

    const db = getDatabase();

    db.exec(`
      CREATE TABLE IF NOT EXISTS lobby_cat (
        user_id TEXT PRIMARY KEY,
        points INTEGER NOT NULL DEFAULT 0,
        level INTEGER NOT NULL DEFAULT 0,
        total_pets INTEGER NOT NULL DEFAULT 0,
        streak INTEGER NOT NULL DEFAULT 0,
        best_streak INTEGER NOT NULL DEFAULT 0,
        last_pet_day TEXT,
        day TEXT,
        day_pet_points INTEGER NOT NULL DEFAULT 0,
        last_mood TEXT,
        last_mood_day TEXT,
        milestones_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,

        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    prepared = {
      db,
      get: db.prepare("SELECT * FROM lobby_cat WHERE user_id = ?"),
      insert: db.prepare(
        "INSERT OR IGNORE INTO lobby_cat (user_id, created_at, updated_at) VALUES (?, ?, ?)",
      ),
      update: db.prepare(`
        UPDATE lobby_cat SET
          points = @points,
          level = @level,
          total_pets = @total_pets,
          streak = @streak,
          best_streak = @best_streak,
          last_pet_day = @last_pet_day,
          day = @day,
          day_pet_points = @day_pet_points,
          last_mood = @last_mood,
          last_mood_day = @last_mood_day,
          milestones_json = @milestones_json,
          updated_at = @updated_at
        WHERE user_id = @user_id
      `),
    };

    return prepared;
  }

  function loadRow(userId) {
    const { get, insert } = statements();
    const now = new Date().toISOString();
    insert.run(userId, now, now);
    return get.get(userId);
  }

  function applyEvents(userId, body) {
    const { db, update } = statements();

    return db.transaction(() => {
      const row = { ...loadRow(userId) };
      const now = new Date().toISOString();
      const day = resolveDay(body?.day);
      const before = levelFor(row.points);

      let gained = 0;
      let streakEvent = null;

      if (row.day !== day) {
        row.day = day;
        row.day_pet_points = 0;
      }

      const pets = Math.min(
        MAX_PETS_PER_REQUEST,
        Math.max(0, Math.floor(Number(body?.pets) || 0)),
      );

      if (pets > 0) {
        if (row.last_pet_day !== day) {
          row.streak = row.last_pet_day === shiftDay(day, -1) ? row.streak + 1 : 1;
          row.best_streak = Math.max(row.best_streak, row.streak);
          row.last_pet_day = day;

          const bonus =
            POINTS.firstPetOfDay +
            POINTS.streakBonusPerDay *
              Math.min(row.streak - 1, POINTS.streakBonusMaxDays);

          gained += bonus;
          streakEvent = { streak: row.streak, bonus };
        }

        const petPoints = Math.min(
          pets * POINTS.pet,
          Math.max(0, POINTS.dailyPetCap - row.day_pet_points),
        );

        row.day_pet_points += petPoints;
        row.total_pets += pets;
        gained += petPoints;
      }

      if (MOODS.has(body?.mood) && row.last_mood_day !== day) {
        row.last_mood = body.mood;
        row.last_mood_day = day;
        gained += POINTS.mood;
      }

      const milestones = parseMilestones(row.milestones_json);
      const ids = Array.isArray(body?.milestones) ? body.milestones : [];

      for (const id of ids.slice(0, MAX_MILESTONES_PER_REQUEST)) {
        if (typeof id !== "string" || !MILESTONE_ID.test(id)) continue;

        const entry = milestones[id];
        if (!entry && Object.keys(milestones).length >= MAX_MILESTONES) continue;

        milestones[id] = {
          count: (entry?.count ?? 0) + 1,
          first: entry?.first ?? now,
          last: now,
        };
      }

      row.milestones_json = JSON.stringify(milestones);
      row.points += gained;
      row.level = levelFor(row.points);
      row.updated_at = now;

      update.run(row);

      return {
        state: toState(row),
        result: {
          gained,
          leveledUp: row.level > before ? row.level : null,
          streak: streakEvent,
        },
      };
    })();
  }

  const limiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many requests." },
  });

  function requireSession(req, res, next) {
    const session = getRequestSession(req);
    if (!session) return res.status(401).json({ authenticated: false });
    req.lobbyCatSession = session;
    return next();
  }

  app.get("/lobby-cat", limiter, requireStorage, requireSession, (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ state: toState(loadRow(req.lobbyCatSession.user_id)) });
  });

  app.post("/lobby-cat/events", limiter, requireStorage, requireSession, (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(applyEvents(req.lobbyCatSession.user_id, req.body));
    } catch (error) {
      console.error("[LobbyCat]", error);
      res.status(500).json({ error: "Could not save LobbyCat progress." });
    }
  });
}

module.exports = { registerLobbyCat, LOBBY_CAT_LEVELS: LEVELS };
