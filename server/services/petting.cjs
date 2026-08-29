const fs = require("node:fs/promises");
const path = require("node:path");

const levels = require("./levels.cjs");

// A user whose normal pet was not returned cannot pet anybody for 10 minutes.
const PET_COOLDOWN_MS = 10 * 60 * 1000;

// The recipient has one minute to pet the original petter back and start a combo.
const COMBO_START_WINDOW_MS = 60 * 1000;

// Once a combo is active, the next expected return pet must happen within 3 minutes.
const COMBO_TIMEOUT_MS = 3 * 60 * 1000;

// Kept so stale pair history can eventually be cleaned up without removing useful data too quickly.
const PAIR_HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000;

// Balanced rewards:
// - A normal pet gives a very small reward.
// - A successful returned pet is worth more because it starts social interaction.
// - Combo rewards taper over time to prevent easy point farming.
const NORMAL_PET_POINTS = 2;
const NORMAL_TARGET_POINTS = 1;

const COMBO_START_PETTER_POINTS = 5;
const COMBO_START_TARGET_POINTS = 3;

const COMBO_EARLY_PETTER_POINTS = 3;
const COMBO_EARLY_TARGET_POINTS = 2;

const COMBO_MID_PETTER_POINTS = 2;
const COMBO_MID_TARGET_POINTS = 1;

const COMBO_LATE_PETTER_POINTS = 1;
const COMBO_LATE_TARGET_POINTS = 1;

// After this many pets in the same continuous combo, it can still continue visually,
// but no more level points are awarded until the combo ends.
const COMBO_REWARD_CAP_COUNT = 30;

const DATA_DIRECTORY = path.resolve(__dirname, "db");

const STATS_FILE = path.join(DATA_DIRECTORY, "petting.csv");
const PAIRS_FILE = path.join(DATA_DIRECTORY, "petting-pairs.json");
const COMBOS_FILE = path.join(DATA_DIRECTORY, "petting-combos.json");
const PETS_FILE = path.join(DATA_DIRECTORY, "pets.json");
const ACHIEVEMENTS_FILE = path.join(DATA_DIRECTORY, "achievements.json");

const CSV_HEADER = [
  "userId",
  "totalGiven",
  "totalReceived",
  "uniquePeoplePetted",
  "uniquePeoplePettingYou",
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
  return parseStatsCsv(await readFileOrDefault(STATS_FILE, ""));
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

async function loadJsonArray(filePath) {
  const contents = await readFileOrDefault(filePath, "[]");

  try {
    const parsed = JSON.parse(contents);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed;
  } catch (error) {
    console.error(`[petting] Invalid JSON array in ${filePath}:`, error);

    return [];
  }
}

async function writeFileAtomic(filePath, contents) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  await fs.writeFile(temporaryPath, contents, "utf8");
  await fs.rename(temporaryPath, filePath);
}

async function saveAll({ stats, pairs, combos, achievements, pets }) {
  await fs.mkdir(DATA_DIRECTORY, { recursive: true });

  await Promise.all([
    writeFileAtomic(STATS_FILE, stringifyStatsCsv(stats)),
    writeFileAtomic(PAIRS_FILE, `${JSON.stringify(pairs, null, 2)}\n`),
    writeFileAtomic(COMBOS_FILE, `${JSON.stringify(combos, null, 2)}\n`),
    writeFileAtomic(
      ACHIEVEMENTS_FILE,
      `${JSON.stringify(achievements, null, 2)}\n`,
    ),
    writeFileAtomic(PETS_FILE, `${JSON.stringify(pets, null, 2)}\n`),
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
  const normalizedUserId = String(userId);
  const unlocked = achievementStore[normalizedUserId];

  if (!Array.isArray(unlocked)) {
    achievementStore[normalizedUserId] = [];
  }

  return achievementStore[normalizedUserId];
}

function getPairPendingPet(pair) {
  if (!pair || typeof pair !== "object") {
    return null;
  }

  const pendingPet = pair.pendingPet;

  if (
    !pendingPet ||
    typeof pendingPet !== "object" ||
    !pendingPet.fromUserId ||
    !pendingPet.toUserId
  ) {
    return null;
  }

  return {
    fromUserId: String(pendingPet.fromUserId),
    toUserId: String(pendingPet.toUserId),
    sentAt: toNumber(pendingPet.sentAt),
    expiresAt: toNumber(pendingPet.expiresAt),
  };
}

function setUserCooldown(pair, userId, cooldownUntil) {
  pair.cooldowns ??= {};
  pair.cooldowns[String(userId)] = toNumber(cooldownUntil);
}

function getUserCooldownUntil(pair, userId) {
  return toNumber(pair?.cooldowns?.[String(userId)]);
}

function clearUserCooldown(pair, userId) {
  if (!pair?.cooldowns) {
    return;
  }

  delete pair.cooldowns[String(userId)];
}

function cleanupPairCooldowns(pair, now) {
  if (!pair?.cooldowns || typeof pair.cooldowns !== "object") {
    pair.cooldowns = {};
    return;
  }

  for (const [userId, cooldownUntil] of Object.entries(pair.cooldowns)) {
    if (toNumber(cooldownUntil) <= now) {
      delete pair.cooldowns[userId];
    }
  }
}

function expirePendingPet({ pair, now }) {
  const pendingPet = getPairPendingPet(pair);

  if (!pendingPet) {
    return null;
  }

  if (pendingPet.expiresAt > now) {
    return null;
  }

  pair.pendingPet = null;

  const cooldownUntil = now + PET_COOLDOWN_MS;
  const existingCooldownUntil = getUserCooldownUntil(
    pair,
    pendingPet.fromUserId,
  );

  setUserCooldown(
    pair,
    pendingPet.fromUserId,
    Math.max(existingCooldownUntil, cooldownUntil),
  );

  return {
    fromUserId: pendingPet.fromUserId,
    toUserId: pendingPet.toUserId,
    expiredAt: pendingPet.expiresAt,
    cooldownUntil: Math.max(existingCooldownUntil, cooldownUntil),
  };
}

function clearExpiredState({ pairs, combos, stats, now }) {
  for (const [key, pair] of Object.entries(pairs)) {
    if (!pair || typeof pair !== "object") {
      delete pairs[key];
      continue;
    }

    cleanupPairCooldowns(pair, now);
    expirePendingPet({ pair, now });

    const hasActiveCooldown = Object.values(pair.cooldowns ?? {}).some(
      (cooldownUntil) => toNumber(cooldownUntil) > now,
    );

    const hasPendingPet = Boolean(getPairPendingPet(pair));
    const lastPetAt = toNumber(pair.lastPetAt);

    if (
      !hasActiveCooldown &&
      !hasPendingPet &&
      lastPetAt > 0 &&
      lastPetAt + PAIR_HISTORY_RETENTION_MS < now
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

function getGlobalCooldownUntil(pairs, userId, now) {
  const normalizedUserId = String(userId);
  let latestCooldownUntil = 0;

  for (const pair of Object.values(pairs)) {
    if (!pair || typeof pair !== "object") {
      continue;
    }

    const cooldownUntil = getUserCooldownUntil(pair, normalizedUserId);

    if (cooldownUntil > now) {
      latestCooldownUntil = Math.max(latestCooldownUntil, cooldownUntil);
    }
  }

  return latestCooldownUntil;
}

function isActiveComboBetween(combos, userA, userB, now) {
  const combo = combos[pairKey(userA, userB)];

  if (
    !combo ||
    !Array.isArray(combo.users) ||
    !combo.users.includes(String(userA)) ||
    !combo.users.includes(String(userB))
  ) {
    return false;
  }

  return toNumber(combo.expiresAt) > now;
}

function isExpectedComboPet(combo, petterId, targetId) {
  if (!combo || typeof combo !== "object") {
    return false;
  }

  return (
    String(combo.expectedPetterId) === String(petterId) &&
    String(combo.expectedTargetId) === String(targetId)
  );
}

function endOtherCombos({ combos, stats, userId, allowedPartnerId, now }) {
  const normalizedUserId = String(userId);
  const normalizedAllowedPartnerId = String(allowedPartnerId);
  const endedCombos = [];

  for (const [key, combo] of Object.entries(combos)) {
    if (
      !Array.isArray(combo.users) ||
      !combo.users.includes(normalizedUserId)
    ) {
      continue;
    }

    const partnerId = combo.users.find((id) => id !== normalizedUserId);

    if (partnerId === normalizedAllowedPartnerId) {
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
      reason: "STARTED_NEW_PET",
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

  if (!petterHasPettedTargetBefore) {
    petterStats.uniquePeoplePetted += 1;
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
    [10, { petterPoints: 10, targetPoints: 5 }],
    [25, { petterPoints: 20, targetPoints: 10 }],
    [50, { petterPoints: 40, targetPoints: 20 }],
  ]);

  return (
    milestoneRewards.get(comboCount) || {
      petterPoints: 0,
      targetPoints: 0,
    }
  );
}

function calculateComboRewards(comboCount, { isStart = false } = {}) {
  if (isStart) {
    return {
      petterPoints: COMBO_START_PETTER_POINTS,
      targetPoints: COMBO_START_TARGET_POINTS,
      milestonePoints: {
        petterPoints: 0,
        targetPoints: 0,
      },
      rewardCapped: false,
    };
  }

  if (comboCount > COMBO_REWARD_CAP_COUNT) {
    return {
      petterPoints: 0,
      targetPoints: 0,
      milestonePoints: {
        petterPoints: 0,
        targetPoints: 0,
      },
      rewardCapped: true,
    };
  }

  let petterPoints = COMBO_EARLY_PETTER_POINTS;
  let targetPoints = COMBO_EARLY_TARGET_POINTS;

  if (comboCount >= 11 && comboCount <= 25) {
    petterPoints = COMBO_MID_PETTER_POINTS;
    targetPoints = COMBO_MID_TARGET_POINTS;
  } else if (comboCount >= 26) {
    petterPoints = COMBO_LATE_PETTER_POINTS;
    targetPoints = COMBO_LATE_TARGET_POINTS;
  }

  const milestonePoints = calculateMilestoneReward(comboCount);

  return {
    petterPoints: petterPoints + milestonePoints.petterPoints,
    targetPoints: targetPoints + milestonePoints.targetPoints,
    milestonePoints,
    rewardCapped: false,
  };
}

function createCombo({ petterId, targetId, now, count = 2, startedAt = now }) {
  return {
    users: [String(petterId), String(targetId)],
    startedAt,
    lastPetAt: now,
    count,
    expiresAt: now + COMBO_TIMEOUT_MS,
    expectedPetterId: String(targetId),
    expectedTargetId: String(petterId),
  };
}

async function petUser({ petterId, targetId, now = Date.now() }) {
  const normalizedPetterId = String(petterId);
  const normalizedTargetId = String(targetId);

  if (normalizedPetterId === normalizedTargetId) {
    return {
      ok: false,
      code: "SELF_PET",
    };
  }

  return enqueueMutation(async () => {
    const [stats, pairs, combos, achievements, pets] = await Promise.all([
      loadStats(),
      loadJson(PAIRS_FILE),
      loadJson(COMBOS_FILE),
      loadJson(ACHIEVEMENTS_FILE),
      loadJsonArray(PETS_FILE),
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
    const pair = pairs[key] || {};

    pair.pettedBy ??= {};
    pair.cooldowns ??= {};

    const currentCombo = combos[key];
    const hasActivePairCombo = isActiveComboBetween(
      combos,
      normalizedPetterId,
      normalizedTargetId,
      now,
    );

    const isValidComboResponse =
      hasActivePairCombo &&
      isExpectedComboPet(currentCombo, normalizedPetterId, normalizedTargetId);

    const pendingPet = getPairPendingPet(pair);

    const isValidComboStart =
      !hasActivePairCombo &&
      pendingPet &&
      pendingPet.fromUserId === normalizedTargetId &&
      pendingPet.toUserId === normalizedPetterId &&
      pendingPet.expiresAt > now;

    // During a valid active combo response, both involved users bypass cooldowns.
    // Otherwise, a user-level cooldown applies globally, no matter whom they pet.
    if (!isValidComboResponse && !isValidComboStart) {
      const cooldownUntil = getGlobalCooldownUntil(
        pairs,
        normalizedPetterId,
        now,
      );

      if (cooldownUntil > now) {
        return {
          ok: false,
          code: "COOLDOWN",
          reason: "UNANSWERED_PET",
          cooldownUntil,
          targetId: normalizedTargetId,
        };
      }
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

    pair.lastPetterId = normalizedPetterId;
    pair.lastTargetId = normalizedTargetId;
    pair.lastPetAt = now;

    const unlockedAchievements = [];

    let type = "normal";
    let comboResult = {
      started: false,
      continued: false,
      count: 0,
      expiresAt: 0,
      partnerId: null,
      milestonePoints: 0,
      rewardCapped: false,
    };

    let petterPoints = NORMAL_PET_POINTS;
    let targetPoints = NORMAL_TARGET_POINTS;

    if (isValidComboResponse) {
      type = "combo";

      currentCombo.count = toNumber(currentCombo.count) + 1;
      currentCombo.lastPetAt = now;
      currentCombo.expiresAt = now + COMBO_TIMEOUT_MS;
      currentCombo.expectedPetterId = normalizedTargetId;
      currentCombo.expectedTargetId = normalizedPetterId;

      petterStats.currentCombo = currentCombo.count;
      targetStats.currentCombo = currentCombo.count;

      petterStats.bestCombo = Math.max(
        petterStats.bestCombo,
        currentCombo.count,
      );

      targetStats.bestCombo = Math.max(
        targetStats.bestCombo,
        currentCombo.count,
      );

      const rewards = calculateComboRewards(currentCombo.count);

      petterPoints = rewards.petterPoints;
      targetPoints = rewards.targetPoints;

      pair.pendingPet = null;
      clearUserCooldown(pair, normalizedPetterId);
      clearUserCooldown(pair, normalizedTargetId);

      comboResult = {
        started: false,
        continued: true,
        count: currentCombo.count,
        expiresAt: currentCombo.expiresAt,
        partnerId: normalizedTargetId,
        milestonePoints:
          rewards.milestonePoints.petterPoints +
          rewards.milestonePoints.targetPoints,
        rewardCapped: rewards.rewardCapped,
      };
    } else if (isValidComboStart) {
      type = "comboStarted";

      const combo = createCombo({
        petterId: normalizedPetterId,
        targetId: normalizedTargetId,
        now,
      });

      combos[key] = combo;

      pair.pendingPet = null;
      clearUserCooldown(pair, normalizedPetterId);
      clearUserCooldown(pair, normalizedTargetId);

      petterStats.comboStarts += 1;
      targetStats.comboStarts += 1;

      petterStats.currentCombo = combo.count;
      targetStats.currentCombo = combo.count;

      petterStats.bestCombo = Math.max(petterStats.bestCombo, combo.count);
      targetStats.bestCombo = Math.max(targetStats.bestCombo, combo.count);

      const rewards = calculateComboRewards(combo.count, {
        isStart: true,
      });

      petterPoints = rewards.petterPoints;
      targetPoints = rewards.targetPoints;

      comboResult = {
        started: true,
        continued: false,
        count: combo.count,
        expiresAt: combo.expiresAt,
        partnerId: normalizedTargetId,
        milestonePoints: 0,
        rewardCapped: false,
      };
    } else {
      // A normal pet starts a one-minute pending response window.
      //
      // No cooldown starts immediately. If the target does not return the pet
      // before this pending window expires, clearExpiredState() gives the original
      // petter a global ten-minute cooldown on their next petting request.
      pair.pendingPet = {
        fromUserId: normalizedPetterId,
        toUserId: normalizedTargetId,
        sentAt: now,
        expiresAt: now + COMBO_START_WINDOW_MS,
      };

      comboResult = {
        started: false,
        continued: false,
        count: 0,
        expiresAt: 0,
        partnerId: null,
        milestonePoints: 0,
        rewardCapped: false,
      };
    }

    pairs[key] = pair;

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

    const reciprocationWindowEndsAt =
      type === "normal" ? now + COMBO_START_WINDOW_MS : 0;

    pets.push({
      petterId: normalizedPetterId,
      targetId: normalizedTargetId,
      sentAt: now,
      sentAtIso: new Date(now).toISOString(),
      type,
      combo: {
        started: Boolean(comboResult.started),
        continued: Boolean(comboResult.continued),
        count: Number(comboResult.count) || 0,
        expiresAt: Number(comboResult.expiresAt) || 0,
        milestonePoints: Number(comboResult.milestonePoints) || 0,
        rewardCapped: Boolean(comboResult.rewardCapped),
      },
      rewards: {
        petterPoints,
        targetPoints,
      },
      cooldownUntil: getGlobalCooldownUntil(pairs, normalizedPetterId, now),
      reciprocationWindowEndsAt,
    });

    await saveAll({
      stats,
      pairs,
      combos,
      achievements,
      pets,
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
      cooldownUntil: getGlobalCooldownUntil(pairs, normalizedPetterId, now),
      reciprocationWindowEndsAt,
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
    const [stats, pairs, combos] = await Promise.all([
      loadStats(),
      loadJson(PAIRS_FILE),
      loadJson(COMBOS_FILE),
    ]);

    const now = Date.now();

    clearExpiredState({
      pairs,
      combos,
      stats,
      now,
    });

    const userStats = getOrCreateStats(stats, normalizedUserId);

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
          expectedPetterId: String(combo.expectedPetterId || ""),
          expectedTargetId: String(combo.expectedTargetId || ""),
        };

        break;
      }
    }

    return {
      ...userStats,
      cooldownUntil: getGlobalCooldownUntil(pairs, normalizedUserId, now),
      activeCombo,
    };
  });
}

async function getLeaderboard({ sortBy = "totalGiven", limit = 10 } = {}) {
  const allowedSorts = new Set([
    "totalGiven",
    "totalReceived",
    "bestCombo",
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
  COMBO_START_WINDOW_MS,
  COMBO_TIMEOUT_MS,
  COMBO_REWARD_CAP_COUNT,
  ACHIEVEMENTS,
  petUser,
  getUserStats,
  getLeaderboard,
  getRank,
  getUserAchievements,
};
