const fs = require("node:fs/promises");
const path = require("node:path");

const levels = require("./levels.cjs");

const PET_COOLDOWN_MS = 60 * 60 * 1000;
const RECIPROCATION_WINDOW_MS = 60 * 1000;
const COMBO_TIMEOUT_MS = 60 * 60 * 1000;

const NORMAL_PET_POINTS = 2;
const RECIPROCATION_POINTS = 8;
const COMBO_START_POINTS = 15;
const COMBO_CONTINUE_POINTS = 3;

const DATA_DIRECTORY = path.resolve(__dirname, "db");
const STATS_FILE = path.join(DATA_DIRECTORY, "petting.csv");
const PAIRS_FILE = path.join(DATA_DIRECTORY, "petting-pairs.json");
const COMBOS_FILE = path.join(DATA_DIRECTORY, "petting-combos.json");
const ACHIEVEMENTS_FILE = path.join(
  DATA_DIRECTORY,
  "petting-achievements.json",
);

const CSV_HEADER = [
  "userId",
  "totalGiven",
  "totalReceived",
  "uniquePeoplePetted",
  "uniquePeoplePettingYou",
  "reciprocalPets",
  "comboStarts",
  "bestCombo",
  "currentCombo",
  "lastPetAt",
  "selectedCat",
  "updatedAt",
];

const ACHIEVEMENTS = [
  {
    id: "first_pet",
    name: "Gentle Start",
    description: "Pet someone for the first time.",
    stat: "totalGiven",
    threshold: 1,
  },
  {
    id: "pet_10",
    name: "Friendly Paws",
    description: "Pet people 10 times.",
    stat: "totalGiven",
    threshold: 10,
  },
  {
    id: "pet_100",
    name: "Certified Petter",
    description: "Pet people 100 times.",
    stat: "totalGiven",
    threshold: 100,
  },
  {
    id: "pet_1_000",
    name: "Professional Scritcher",
    description: "Pet people 1,000 times.",
    stat: "totalGiven",
    threshold: 1_000,
  },
  {
    id: "received_10",
    name: "Pettable",
    description: "Be petted 10 times.",
    stat: "totalReceived",
    threshold: 10,
  },
  {
    id: "received_100",
    name: "Very Pettable",
    description: "Be petted 100 times.",
    stat: "totalReceived",
    threshold: 100,
  },
  {
    id: "first_reciprocation",
    name: "Pet Them Back",
    description: "Return a pet within one minute.",
    stat: "reciprocalPets",
    threshold: 1,
  },
  {
    id: "reciprocal_25",
    name: "Mutual Affection",
    description: "Return 25 pets.",
    stat: "reciprocalPets",
    threshold: 25,
  },
  {
    id: "combo_5",
    name: "Purrfect Rhythm",
    description: "Reach a 5-pet combo.",
    stat: "bestCombo",
    threshold: 5,
  },
  {
    id: "combo_10",
    name: "Double Paws",
    description: "Reach a 10-pet combo.",
    stat: "bestCombo",
    threshold: 10,
  },
  {
    id: "combo_50",
    name: "Infinite Scritches",
    description: "Reach a 50-pet combo.",
    stat: "bestCombo",
    threshold: 50,
  },
  {
    id: "social_cat",
    name: "Social Cat",
    description: "Pet 25 different people.",
    stat: "uniquePeoplePetted",
    threshold: 25,
  },
];

let mutationQueue = Promise.resolve();

function enqueueMutation(task) {
  const queuedTask = mutationQueue.then(task, task);

  mutationQueue = queuedTask.catch(() => {});

  return queuedTask;
}

function pairKey(userA, userB) {
  return [String(userA), String(userB)].sort().join(":");
}

function createDefaultStats(userId) {
  return {
    userId: String(userId),
    totalGiven: 0,
    totalReceived: 0,
    uniquePeoplePetted: 0,
    uniquePeoplePettingYou: 0,
    reciprocalPets: 0,
    comboStarts: 0,
    bestCombo: 0,
    currentCombo: 0,
    lastPetAt: 0,
    selectedCat: "default",
    updatedAt: 0,
  };
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCsvLine(line) {
  const values = [];
  let currentValue = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === '"' && quoted && nextCharacter === '"') {
      currentValue += '"';
      index += 1;
      continue;
    }

    if (character === '"') {
      quoted = !quoted;
      continue;
    }

    if (character === "," && !quoted) {
      values.push(currentValue);
      currentValue = "";
      continue;
    }

    currentValue += character;
  }

  values.push(currentValue);

  return values;
}

function escapeCsvValue(value) {
  const stringValue = String(value ?? "");

  if (
    stringValue.includes(",") ||
    stringValue.includes('"') ||
    stringValue.includes("\n")
  ) {
    return `"${stringValue.replaceAll('"', '""')}"`;
  }

  return stringValue;
}

function parseStatsCsv(contents) {
  const lines = contents
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length <= 1) {
    return {};
  }

  const headers = parseCsvLine(lines[0]);
  const users = {};

  for (const line of lines.slice(1)) {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""]),
    );

    if (!row.userId) {
      continue;
    }

    users[row.userId] = {
      userId: row.userId,
      totalGiven: toNumber(row.totalGiven),
      totalReceived: toNumber(row.totalReceived),
      uniquePeoplePetted: toNumber(row.uniquePeoplePetted),
      uniquePeoplePettingYou: toNumber(row.uniquePeoplePettingYou),
      reciprocalPets: toNumber(row.reciprocalPets),
      comboStarts: toNumber(row.comboStarts),
      bestCombo: toNumber(row.bestCombo),
      currentCombo: toNumber(row.currentCombo),
      lastPetAt: toNumber(row.lastPetAt),
      selectedCat: row.selectedCat || "default",
      updatedAt: toNumber(row.updatedAt),
    };
  }

  return users;
}

function stringifyStatsCsv(statsByUserId) {
  const rows = [CSV_HEADER.join(",")];

  const users = Object.values(statsByUserId).sort((userA, userB) =>
    userA.userId.localeCompare(userB.userId),
  );

  for (const user of users) {
    rows.push(
      CSV_HEADER.map((header) => escapeCsvValue(user[header])).join(","),
    );
  }

  return `${rows.join("\n")}\n`;
}

async function readFileOrDefault(filePath, fallback) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }

    throw error;
  }
}

async function loadStats() {
  const contents = await readFileOrDefault(STATS_FILE, "");

  return parseStatsCsv(contents);
}

async function loadJson(filePath) {
  const contents = await readFileOrDefault(filePath, "{}");

  try {
    const parsed = JSON.parse(contents);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return parsed;
  } catch (error) {
    console.error(`[petting] Invalid JSON in ${filePath}:`, error);
    return {};
  }
}

async function writeFileAtomic(filePath, contents) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  await fs.writeFile(temporaryPath, contents, "utf8");
  await fs.rename(temporaryPath, filePath);
}

async function saveAll({ stats, pairs, combos, achievements }) {
  await fs.mkdir(DATA_DIRECTORY, { recursive: true });

  await Promise.all([
    writeFileAtomic(STATS_FILE, stringifyStatsCsv(stats)),
    writeFileAtomic(PAIRS_FILE, `${JSON.stringify(pairs, null, 2)}\n`),
    writeFileAtomic(COMBOS_FILE, `${JSON.stringify(combos, null, 2)}\n`),
    writeFileAtomic(
      ACHIEVEMENTS_FILE,
      `${JSON.stringify(achievements, null, 2)}\n`,
    ),
  ]);
}

function getOrCreateStats(statsByUserId, userId) {
  const normalizedUserId = String(userId);

  if (!statsByUserId[normalizedUserId]) {
    statsByUserId[normalizedUserId] = createDefaultStats(normalizedUserId);
  }

  return statsByUserId[normalizedUserId];
}

function getUnlockedAchievementIds(achievementStore, userId) {
  const unlocked = achievementStore[String(userId)];

  if (!Array.isArray(unlocked)) {
    achievementStore[String(userId)] = [];
  }

  return achievementStore[String(userId)];
}

function clearExpiredState({ pairs, combos, stats, now }) {
  for (const [key, pair] of Object.entries(pairs)) {
    if (!pair || typeof pair !== "object") {
      delete pairs[key];
      continue;
    }

    if (toNumber(pair.cooldownUntil) <= now) {
      pair.cooldownUntil = 0;
    }

    if (
      toNumber(pair.lastPetAt) + PET_COOLDOWN_MS * 2 < now &&
      !pair.cooldownUntil
    ) {
      delete pairs[key];
    }
  }

  for (const [key, combo] of Object.entries(combos)) {
    if (!combo || typeof combo !== "object" || !Array.isArray(combo.users)) {
      delete combos[key];
      continue;
    }

    if (toNumber(combo.expiresAt) > now) {
      continue;
    }

    for (const userId of combo.users) {
      const userStats = getOrCreateStats(stats, userId);
      userStats.currentCombo = 0;
      userStats.updatedAt = now;
    }

    delete combos[key];
  }
}

function endOtherCombos({ combos, stats, userId, allowedPartnerId, now }) {
  const endedCombos = [];

  for (const [key, combo] of Object.entries(combos)) {
    if (!Array.isArray(combo.users) || !combo.users.includes(userId)) {
      continue;
    }

    const partnerId = combo.users.find((id) => id !== userId);

    if (partnerId === allowedPartnerId) {
      continue;
    }

    for (const participantId of combo.users) {
      const participantStats = getOrCreateStats(stats, participantId);
      participantStats.currentCombo = 0;
      participantStats.updatedAt = now;
    }

    endedCombos.push({
      key,
      users: combo.users,
      count: toNumber(combo.count),
    });

    delete combos[key];
  }

  return endedCombos;
}

function updateUniquePettingCounts({
  petterStats,
  targetStats,
  pairs,
  petterId,
  targetId,
}) {
  const key = pairKey(petterId, targetId);
  const pair = pairs[key] || {};

  const petterHasPettedTargetBefore =
    pair.pettedBy?.[String(petterId)] === true;
  const targetHasBeenPettedByPetterBefore =
    pair.pettedBy?.[String(petterId)] === true;

  if (!petterHasPettedTargetBefore) {
    petterStats.uniquePeoplePetted += 1;
  }

  if (!targetHasBeenPettedByPetterBefore) {
    targetStats.uniquePeoplePettingYou += 1;
  }

  pair.pettedBy ??= {};
  pair.pettedBy[String(petterId)] = true;

  pairs[key] = pair;
}

function evaluateAchievements({ achievementStore, userId, stats }) {
  const unlockedIds = getUnlockedAchievementIds(achievementStore, userId);
  const newlyUnlocked = [];

  for (const achievement of ACHIEVEMENTS) {
    if (unlockedIds.includes(achievement.id)) {
      continue;
    }

    if (toNumber(stats[achievement.stat]) < achievement.threshold) {
      continue;
    }

    unlockedIds.push(achievement.id);
    newlyUnlocked.push(achievement);
  }

  return newlyUnlocked;
}

function awardLevelPoints(userId, amount, reason) {
  if (!amount || amount <= 0) {
    return;
  }

  try {
    if (typeof levels.addPoints === "function") {
      levels.addPoints(String(userId), amount, reason);
      return;
    }

    if (typeof levels.addXP === "function") {
      levels.addXP(String(userId), amount, reason);
      return;
    }

    if (typeof levels.addExperience === "function") {
      levels.addExperience(String(userId), amount, reason);
      return;
    }

    console.warn(
      "[petting] levels.cjs does not export addPoints, addXP, or addExperience.",
    );
  } catch (error) {
    console.error(
      `[petting] Failed to award ${amount} points to ${userId}:`,
      error,
    );
  }
}

function calculateMilestoneReward(comboCount) {
  const milestoneRewards = new Map([
    [5, 10],
    [10, 20],
    [25, 50],
    [50, 100],
    [100, 250],
  ]);

  return milestoneRewards.get(comboCount) || 0;
}

async function petUser({ petterId, targetId, now = Date.now() }) {
  const normalizedPetterId = String(petterId);
  const normalizedTargetId = String(targetId);

  if (normalizedPetterId === normalizedTargetId) {
    return { ok: false, code: "SELF_PET" };
  }

  return enqueueMutation(async () => {
    const [stats, pairs, combos, achievements] = await Promise.all([
      loadStats(),
      loadJson(PAIRS_FILE),
      loadJson(COMBOS_FILE),
      loadJson(ACHIEVEMENTS_FILE),
    ]);

    clearExpiredState({
      pairs,
      combos,
      stats,
      now,
    });

    const petterStats = getOrCreateStats(stats, normalizedPetterId);
    const targetStats = getOrCreateStats(stats, normalizedTargetId);

    const key = pairKey(normalizedPetterId, normalizedTargetId);
    const previousPair = pairs[key] || {};
    const previousPetterId = String(previousPair.lastPetterId || "");
    const previousTargetId = String(previousPair.lastTargetId || "");
    const previousPetAt = toNumber(previousPair.lastPetAt);
    const cooldownUntil = toNumber(previousPair.cooldownUntil);

    const isReturnedPet =
      previousPetterId === normalizedTargetId &&
      previousTargetId === normalizedPetterId &&
      now - previousPetAt <= RECIPROCATION_WINDOW_MS;

    if (!isReturnedPet && cooldownUntil > now) {
      return {
        ok: false,
        code: "COOLDOWN",
        cooldownUntil,
        targetId: normalizedTargetId,
      };
    }

    const endedCombos = endOtherCombos({
      combos,
      stats,
      userId: normalizedPetterId,
      allowedPartnerId: normalizedTargetId,
      now,
    });

    updateUniquePettingCounts({
      petterStats,
      targetStats,
      pairs,
      petterId: normalizedPetterId,
      targetId: normalizedTargetId,
    });

    petterStats.totalGiven += 1;
    petterStats.lastPetAt = now;
    petterStats.updatedAt = now;

    targetStats.totalReceived += 1;
    targetStats.updatedAt = now;

    const pair = pairs[key] || {};
    pair.pettedBy ??= {};
    pair.pettedBy[normalizedPetterId] = true;
    pair.lastPetterId = normalizedPetterId;
    pair.lastTargetId = normalizedTargetId;
    pair.lastPetAt = now;

    const unlockedAchievements = [];
    let type = "normal";
    let comboResult = null;
    let petterPoints = NORMAL_PET_POINTS;
    let targetPoints = 0;

    if (isReturnedPet) {
      type = "reciprocated";

      petterStats.reciprocalPets += 1;
      targetStats.reciprocalPets += 1;

      pair.cooldownUntil = 0;

      const existingCombo = combos[key];
      const comboIsStillValid =
        existingCombo &&
        toNumber(existingCombo.expiresAt) > now &&
        Array.isArray(existingCombo.users) &&
        existingCombo.users.includes(normalizedPetterId) &&
        existingCombo.users.includes(normalizedTargetId);

      if (comboIsStillValid) {
        type = "combo";

        existingCombo.count = toNumber(existingCombo.count) + 1;
        existingCombo.lastPetAt = now;
        existingCombo.expiresAt = now + COMBO_TIMEOUT_MS;

        petterStats.currentCombo = existingCombo.count;
        targetStats.currentCombo = existingCombo.count;

        petterStats.bestCombo = Math.max(
          petterStats.bestCombo,
          existingCombo.count,
        );
        targetStats.bestCombo = Math.max(
          targetStats.bestCombo,
          existingCombo.count,
        );

        const milestonePoints = calculateMilestoneReward(existingCombo.count);

        petterPoints = COMBO_CONTINUE_POINTS + milestonePoints;
        targetPoints = COMBO_CONTINUE_POINTS + milestonePoints;

        comboResult = {
          started: false,
          continued: true,
          count: existingCombo.count,
          expiresAt: existingCombo.expiresAt,
          partnerId: normalizedTargetId,
          milestonePoints,
        };
      } else {
        const combo = {
          users: [normalizedPetterId, normalizedTargetId],
          startedAt: now,
          lastPetAt: now,
          count: 2,
          expiresAt: now + COMBO_TIMEOUT_MS,
        };

        combos[key] = combo;

        petterStats.comboStarts += 1;
        targetStats.comboStarts += 1;

        petterStats.currentCombo = combo.count;
        targetStats.currentCombo = combo.count;

        petterStats.bestCombo = Math.max(petterStats.bestCombo, combo.count);
        targetStats.bestCombo = Math.max(targetStats.bestCombo, combo.count);

        petterPoints = RECIPROCATION_POINTS + COMBO_START_POINTS;
        targetPoints = RECIPROCATION_POINTS + COMBO_START_POINTS;

        comboResult = {
          started: true,
          continued: false,
          count: combo.count,
          expiresAt: combo.expiresAt,
          partnerId: normalizedTargetId,
          milestonePoints: 0,
        };
      }
    } else {
      pair.cooldownUntil = now + PET_COOLDOWN_MS;

      comboResult = {
        started: false,
        continued: false,
        count: 0,
        expiresAt: 0,
        partnerId: null,
        milestonePoints: 0,
      };
    }

    pairs[key] = pair;

    petterStats.updatedAt = now;
    targetStats.updatedAt = now;

    unlockedAchievements.push(
      ...evaluateAchievements({
        achievementStore: achievements,
        userId: normalizedPetterId,
        stats: petterStats,
      }).map((achievement) => ({
        userId: normalizedPetterId,
        ...achievement,
      })),
    );

    unlockedAchievements.push(
      ...evaluateAchievements({
        achievementStore: achievements,
        userId: normalizedTargetId,
        stats: targetStats,
      }).map((achievement) => ({
        userId: normalizedTargetId,
        ...achievement,
      })),
    );

    await saveAll({
      stats,
      pairs,
      combos,
      achievements,
    });

    awardLevelPoints(
      normalizedPetterId,
      petterPoints,
      `Petting ${normalizedTargetId}`,
    );

    awardLevelPoints(
      normalizedTargetId,
      targetPoints,
      `Being petted by ${normalizedPetterId}`,
    );

    return {
      ok: true,
      type,
      petterId: normalizedPetterId,
      targetId: normalizedTargetId,
      cooldownUntil: toNumber(pair.cooldownUntil),
      reciprocationWindowEndsAt:
        type === "normal" ? now + RECIPROCATION_WINDOW_MS : 0,
      combo: comboResult,
      endedCombos,
      rewards: {
        petterPoints,
        targetPoints,
      },
      stats: {
        petter: { ...petterStats },
        target: { ...targetStats },
      },
      unlockedAchievements,
    };
  });
}

async function getUserStats(userId) {
  const normalizedUserId = String(userId);

  return enqueueMutation(async () => {
    const [stats, combos] = await Promise.all([
      loadStats(),
      loadJson(COMBOS_FILE),
    ]);

    const userStats = getOrCreateStats(stats, normalizedUserId);
    const now = Date.now();

    let activeCombo = null;

    for (const combo of Object.values(combos)) {
      if (
        Array.isArray(combo.users) &&
        combo.users.includes(normalizedUserId) &&
        toNumber(combo.expiresAt) > now
      ) {
        activeCombo = {
          users: combo.users,
          count: toNumber(combo.count),
          startedAt: toNumber(combo.startedAt),
          lastPetAt: toNumber(combo.lastPetAt),
          expiresAt: toNumber(combo.expiresAt),
        };

        break;
      }
    }

    return {
      ...userStats,
      activeCombo,
    };
  });
}

async function getLeaderboard({ sortBy = "totalGiven", limit = 10 } = {}) {
  const allowedSorts = new Set([
    "totalGiven",
    "totalReceived",
    "bestCombo",
    "reciprocalPets",
    "comboStarts",
  ]);

  const normalizedSortBy = allowedSorts.has(sortBy) ? sortBy : "totalGiven";

  const normalizedLimit = Math.min(Math.max(Number(limit) || 10, 1), 100);

  return enqueueMutation(async () => {
    const stats = await loadStats();

    return Object.values(stats)
      .sort(
        (userA, userB) =>
          toNumber(userB[normalizedSortBy]) -
            toNumber(userA[normalizedSortBy]) ||
          toNumber(userB.bestCombo) - toNumber(userA.bestCombo) ||
          toNumber(userB.totalReceived) - toNumber(userA.totalReceived) ||
          userA.userId.localeCompare(userB.userId),
      )
      .slice(0, normalizedLimit)
      .map((user, index) => ({
        rank: index + 1,
        ...user,
      }));
  });
}

async function getRank(userId, sortBy = "totalGiven") {
  const normalizedUserId = String(userId);
  const leaderboard = await getLeaderboard({
    sortBy,
    limit: 100_000,
  });

  const index = leaderboard.findIndex(
    (entry) => entry.userId === normalizedUserId,
  );

  return index === -1 ? null : index + 1;
}

async function getUserAchievements(userId) {
  const normalizedUserId = String(userId);

  return enqueueMutation(async () => {
    const [stats, achievements] = await Promise.all([
      loadStats(),
      loadJson(ACHIEVEMENTS_FILE),
    ]);

    const userStats = getOrCreateStats(stats, normalizedUserId);
    const unlockedIds = getUnlockedAchievementIds(
      achievements,
      normalizedUserId,
    );

    return ACHIEVEMENTS.map((achievement) => ({
      ...achievement,
      unlocked: unlockedIds.includes(achievement.id),
      current: toNumber(userStats[achievement.stat]),
      progress: Math.min(
        toNumber(userStats[achievement.stat]) / achievement.threshold,
        1,
      ),
    }));
  });
}

module.exports = {
  PET_COOLDOWN_MS,
  RECIPROCATION_WINDOW_MS,
  COMBO_TIMEOUT_MS,
  ACHIEVEMENTS,
  petUser,
  getUserStats,
  getLeaderboard,
  getRank,
  getUserAchievements,
};
