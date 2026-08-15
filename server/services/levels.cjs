const fs = require("node:fs/promises");
const path = require("node:path");
const { parse } = require("csv-parse/sync");
const { stringify } = require("csv-stringify/sync");
const { EmbedBuilder } = require("discord.js");

const DATA_FILE = path.join(__dirname, "levels.csv");

const LEVEL_UP_CHANNEL_ID = "1483528579722514472";

const MAX_LEVEL = 13;

// Progression tuning
const BASE_LEVEL_POINTS = 1300;
const LEVEL_GROWTH = 2.613;

// Message XP tuning
const MESSAGE_COOLDOWN_MS = 13_000;
const MIN_MESSAGE_LENGTH = 7;
const MIN_MESSAGE_POINTS = 13;
const MAX_MESSAGE_POINTS = 26;

const LEVEL_REWARDS = {
  1: {
    roleId: "1537933506766966924",
    label: "Meowcomer",
  },
  2: {
    roleId: "1537935662915780739",
    label: "Black Cat",
  },
  3: {
    roleId: "1537935742557364326",
    label: "Talcative",
  },
  4: {
    roleId: "1537935823981387786",
    label: "Seeker of News",
  },
  5: {
    roleId: "1537936248281497610",
    label: "Gossip Spreader",
  },
  6: {
    roleId: "1537936305147744336",
    label: "Purrfect Listener",
  },
  7: {
    roleId: "1537936407048359976",
    label: "Knowledgeable Cat",
  },
  8: {
    roleId: "1537936470109855774",
    label: "Cult Worshiper",
  },
  9: {
    roleId: "1537936530645975201",
    label: "True Cult Member",
  },
  10: {
    roleId: "1537936583091552470",
    label: "Taught Leader",
  },
  11: {
    roleId: "1537936674338639933",
    label: "Wisdom Keeper",
  },
  12: {
    roleId: "1537936764101206096",
    label: "Catful Diety",
  },
  13: {
    roleId: "1537936830937440266",
    label: "Bastet",
  },
};

const users = new Map();
const messageCooldowns = new Map();

let writeQueue = Promise.resolve();

function getUser(userId) {
  if (!users.has(userId)) {
    users.set(userId, {
      userId,
      points: 0,
      level: 0,
    });
  }

  return users.get(userId);
}

function pointsNeededForNextLevel(currentLevel) {
  if (currentLevel >= MAX_LEVEL) {
    return null;
  }

  return Math.round(BASE_LEVEL_POINTS * Math.pow(LEVEL_GROWTH, currentLevel));
}

function totalPointsForLevel(targetLevel) {
  const safeLevel = Math.max(0, Math.min(MAX_LEVEL, Math.floor(targetLevel)));

  let total = 0;

  for (let level = 0; level < safeLevel; level++) {
    total += pointsNeededForNextLevel(level);
  }

  return total;
}

function calculateLevel(points) {
  const safePoints = Math.max(0, Math.floor(points));
  let level = 0;

  while (level < MAX_LEVEL && safePoints >= totalPointsForLevel(level + 1)) {
    level++;
  }

  return level;
}

function getProgress(user) {
  if (user.level >= MAX_LEVEL) {
    return {
      isMaxLevel: true,
      currentLevel: MAX_LEVEL,
      nextLevel: null,
      pointsIntoLevel: null,
      pointsNeeded: null,
      pointsForNextLevel: null,
    };
  }

  const currentLevelPoints = totalPointsForLevel(user.level);
  const nextLevelPoints = totalPointsForLevel(user.level + 1);

  return {
    isMaxLevel: false,
    currentLevel: user.level,
    nextLevel: user.level + 1,
    pointsIntoLevel: Math.max(0, user.points - currentLevelPoints),
    pointsNeeded: nextLevelPoints - currentLevelPoints,
    pointsForNextLevel: nextLevelPoints,
  };
}

async function write() {
  const rows = [...users.values()]
    .sort((a, b) => {
      if (b.points !== a.points) {
        return b.points - a.points;
      }

      return a.userId.localeCompare(b.userId);
    })
    .map((user) => ({
      userId: user.userId,
      points: user.points,
      level: user.level,
    }));

  const csv = stringify(rows, {
    header: true,
    columns: ["userId", "points", "level"],
  });

  const temporaryFile = `${DATA_FILE}.tmp`;

  await fs.writeFile(temporaryFile, csv, "utf8");
  await fs.rename(temporaryFile, DATA_FILE);
}

function save() {
  writeQueue = writeQueue
    .catch((error) => {
      console.error("[Levels] Previous CSV save failed:", error);
    })
    .then(write);

  return writeQueue;
}

async function load() {
  try {
    const csv = await fs.readFile(DATA_FILE, "utf8");

    const rows = parse(csv, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    users.clear();

    for (const row of rows) {
      if (!row.userId) {
        continue;
      }

      const points = Math.max(0, Number.parseInt(row.points, 10) || 0);

      users.set(row.userId, {
        userId: row.userId,
        points,
        level: calculateLevel(points),
      });
    }

    // Normalizes the CSV and corrects any old/mismatched level values.
    await save();

    console.log(`[Levels] Loaded ${users.size} record(s).`);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    // First startup: immediately create a valid empty CSV.
    await save();

    console.log("[Levels] Created services/levels.csv.");
  }
}

function calculateMessagePoints(message) {
  const contentLength = message.content.trim().length;
  const lengthBonus = Math.min(4, Math.floor(contentLength / 100));
  const randomBonus = Math.floor(Math.random() * 5);

  return Math.min(
    MAX_MESSAGE_POINTS,
    MIN_MESSAGE_POINTS + lengthBonus + randomBonus,
  );
}

async function grantRewards(member, oldLevel, newLevel) {
  const grantedRoles = [];

  for (let level = oldLevel + 1; level <= newLevel; level++) {
    const reward = LEVEL_REWARDS[level];

    if (!reward?.roleId) {
      continue;
    }

    const role = member.guild.roles.cache.get(reward.roleId);

    if (!role) {
      console.warn(
        `[Levels] Reward role ${reward.roleId} for level ${level} was not found.`,
      );
      continue;
    }

    if (member.roles.cache.has(role.id)) {
      continue;
    }

    try {
      await member.roles.add(role, `Reached level ${level}`);
      grantedRoles.push(role);
    } catch (error) {
      console.error(
        `[Levels] Could not give role "${role.name}" to ${member.user.tag}:`,
        error,
      );
    }
  }

  return grantedRoles;
}

async function announceLevelUp(member, oldLevel, newLevel, points) {
  const channel = await member.client.channels
    .fetch(LEVEL_UP_CHANNEL_ID)
    .catch(() => null);

  if (!channel?.isTextBased()) {
    console.warn(
      `[Levels] Channel ${LEVEL_UP_CHANNEL_ID} is missing or not text-based.`,
    );
    return;
  }

  const grantedRoles = await grantRewards(member, oldLevel, newLevel);

  const rewardText = grantedRoles.length
    ? grantedRoles.map((role) => role.toString()).join(", ")
    : "No reward at this level";

  const embed = new EmbedBuilder()
    .setColor("#8B5CF6")
    .setAuthor({
      name: "Level up!",
    })
    .setThumbnail(
      member.displayAvatarURL({
        size: 256,
        extension: "png",
        forceStatic: false,
      }),
    )
    .setDescription(
      `Congratulations ${member}, you reached **Level ${newLevel}**!`,
    )
    .addFields(
      {
        name: "Total points",
        value: `${points.toLocaleString()} points`,
        inline: true,
      },
      {
        name: "Reward",
        value: rewardText,
        inline: true,
      },
    )
    .setFooter({
      text:
        newLevel >= MAX_LEVEL
          ? "Maximum level reached — you can still earn points."
          : "Keep being active to earn more points.",
    })
    .setTimestamp();

  await channel.send({
    content: `${member}`,
    embeds: [embed],
    allowedMentions: {
      users: [member.id],
    },
  });
}

async function applyPoints(member, pointsDelta) {
  if (!member?.id || !member?.user) {
    throw new Error("[Levels] applyPoints requires a GuildMember object.");
  }

  const user = getUser(member.id);
  const oldLevel = user.level;

  user.points = Math.max(0, user.points + Math.floor(pointsDelta));

  user.level = calculateLevel(user.points);

  await save();

  if (user.level > oldLevel) {
    await announceLevelUp(member, oldLevel, user.level, user.points);
  }

  return user;
}

async function setPoints(member, points) {
  if (!member?.id || !member?.user) {
    throw new Error("[Levels] setPoints requires a GuildMember object.");
  }

  const user = getUser(member.id);
  const oldLevel = user.level;

  user.points = Math.max(0, Math.floor(points));
  user.level = calculateLevel(user.points);

  await save();

  if (user.level > oldLevel) {
    await announceLevelUp(member, oldLevel, user.level, user.points);
  }

  return user;
}

async function setLevel(member, level) {
  if (!member?.id || !member?.user) {
    throw new Error("[Levels] setLevel requires a GuildMember object.");
  }

  const safeLevel = Math.max(0, Math.min(MAX_LEVEL, Math.floor(level)));

  const user = getUser(member.id);
  const oldLevel = user.level;

  user.level = safeLevel;
  user.points = totalPointsForLevel(safeLevel);

  await save();

  if (user.level > oldLevel) {
    await announceLevelUp(member, oldLevel, user.level, user.points);
  }

  return user;
}

async function trackMessage(message) {
  if (!message.guild) {
    return null;
  }

  /*
    Other bot accounts CAN gain XP.

    Only exclude this bot's own level-up announcement messages, otherwise
    it could earn points from its own embeds in the announcement channel.
  */
  if (
    message.author.id === message.client.user.id &&
    message.channelId === LEVEL_UP_CHANNEL_ID
  ) {
    return null;
  }

  if (!message.member) {
    return null;
  }

  if (message.content.trim().length < MIN_MESSAGE_LENGTH) {
    return null;
  }

  const now = Date.now();
  const lastMessageAt = messageCooldowns.get(message.author.id) || 0;

  if (now - lastMessageAt < MESSAGE_COOLDOWN_MS) {
    return null;
  }

  messageCooldowns.set(message.author.id, now);

  const points = calculateMessagePoints(message);
  const user = await applyPoints(message.member, points);

  return {
    points,
    user,
  };
}

function getLeaderboard(limit = 10) {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));

  return [...users.values()]
    .sort((a, b) => {
      if (b.points !== a.points) {
        return b.points - a.points;
      }

      return a.userId.localeCompare(b.userId);
    })
    .slice(0, safeLimit)
    .map((user, index) => ({
      rank: index + 1,
      userId: user.userId,
      points: user.points,
      level: user.level,
    }));
}

module.exports = {
  MAX_LEVEL,
  LEVEL_REWARDS,

  load,
  save,

  getUser,
  getProgress,
  getLeaderboard,

  pointsNeededForNextLevel,
  totalPointsForLevel,
  calculateLevel,

  trackMessage,

  applyPoints,
  setPoints,
  setLevel,
};
