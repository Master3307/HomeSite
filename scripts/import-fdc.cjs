require("dotenv").config();

/*
 * Imports FDC polls into the archive (server/services/db/fdc-polls).
 *
 *   pnpm fdc:import                     Discord: the old bot's polls and native
 *                                       Discord polls in the FDC channel
 *   pnpm fdc:import --manifest f.json   FDCs that only exist elsewhere (the
 *                                       oldest ones are Steam group chat polls);
 *                                       no Discord connection needed
 *   … --with-discord                    with --manifest: also scan Discord
 *   … --dry  (or --dry-run)             only report what would be imported
 *
 * Steam has no API for group chat messages or polls, so a manifest lists
 * them by hand (see scripts/fdc-manifest.example.json): per poll the date,
 * and per option, as far as known, an image file, a name, an emoji and a
 * vote count (an option needs at least an image or a name). When the counts are lost, give `"winner": <number>` (or a single
 * option, which is then the winner). Polls whose date is already archived
 * are skipped.
 */

const fs = require("node:fs/promises");
const path = require("node:path");
const { once } = require("node:events");

const sharp = require("sharp");

const {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
} = require("discord.js");

const PROJECT_ROOT = path.resolve(__dirname, "..");

const ROOT = process.env.FDC_ARCHIVE_DIR
  ? path.resolve(process.env.FDC_ARCHIVE_DIR)
  : path.join(PROJECT_ROOT, "server", "services", "db", "fdc-polls");

const SUMMARY_PATH = path.join(ROOT, "summary.json");
const LOCK_PATH = path.join(ROOT, ".import.lock");
const REPORT_PATH = path.join(ROOT, "import-report.json");

const CHANNEL_ID = process.env.FDC_IMPORT_CHANNEL_ID || process.env.FDC_CHANNEL_ID || "";

// The bot posts the FDC messages; its user ID is the application ID.
const AUTHOR_ID = process.env.FDC_IMPORT_AUTHOR_ID || process.env.DISCORD_CLIENT_ID || "";

const TIME_ZONE = "Europe/Berlin";
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

const MEDIA_WINDOW_MS = 5 * 60 * 1000;
const RESULTS_WINDOW_MS = 10 * 60 * 1000;

// `--dry` / `--dry-run`: report what would be imported, write nothing.
const DRY_RUN = process.argv.includes("--dry-run") || process.argv.includes("--dry");

/*
 * Native Discord polls (the FDCs from before the bot): 4–6 answers, the
 * option images in the poll author's messages right before (or after) it.
 */
const NATIVE_MIN_OPTIONS = 4;
const NATIVE_MAX_OPTIONS = 6;
const NATIVE_MEDIA_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣"];

const MANIFEST = (() => {
  const index = process.argv.indexOf("--manifest");
  return index !== -1 ? process.argv[index + 1] : null;
})();
const USE_DISCORD = !MANIFEST || process.argv.includes("--with-discord");

const token = process.env.DISCORD_BOT_TOKEN;

if (USE_DISCORD && !token) {
  throw new Error("Missing DISCORD_BOT_TOKEN.");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

const report = {
  version: 1,
  startedAt: stamp(),
  completedAt: null,
  dryRun: DRY_RUN,
  channelId: CHANNEL_ID,
  authorId: AUTHOR_ID,
  scannedMessages: 0,
  detectedPolls: 0,
  detectedNativePolls: 0,
  imported: [],
  skipped: [],
  failed: [],
  unmatchedResults: [],
};

function stamp(ms = Date.now()) {
  return {
    iso: new Date(ms).toISOString(),
    ms,
  };
}

function dateKey(ms) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));

  const get = (type) => parts.find((part) => part.type === type).value;

  return `${get("year")}-${get("month")}-${get("day")}`;
}

function compareIds(a, b) {
  if (BigInt(a.id) < BigInt(b.id)) return -1;
  if (BigInt(a.id) > BigInt(b.id)) return 1;
  return 0;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function atomicJson(file, value) {
  const temporary = `${file}.tmp`;

  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");

  await fs.rename(temporary, file);
}

function snapshot(message) {
  if (!message) return null;

  return {
    id: message.id,
    channelId: message.channelId,
    guildId: message.guildId,

    author: {
      id: message.author.id,
      username: message.author.username,
      bot: message.author.bot,
    },

    content: message.content,
    createdAt: stamp(message.createdTimestamp),

    editedAt: message.editedTimestamp ? stamp(message.editedTimestamp) : null,

    embeds: message.embeds.map((embed) => embed.toJSON()),

    attachments: [...message.attachments.values()].map((attachment) =>
      attachment.toJSON(),
    ),

    interactionMetadata: message.interactionMetadata
      ? {
          id: message.interactionMetadata.id,
          type: message.interactionMetadata.type,
          userId: message.interactionMetadata.user?.id ?? null,
        }
      : null,

    interaction: message.interaction
      ? {
          id: message.interaction.id,
          commandName: message.interaction.commandName,
          userId: message.interaction.user?.id ?? null,
        }
      : null,

    reactions: [...message.reactions.cache.values()].map((reaction) => ({
      emoji: {
        id: reaction.emoji.id,
        name: reaction.emoji.name,
        animated: Boolean(reaction.emoji.animated),
      },
      count: reaction.count,
      countDetails: reaction.countDetails ?? null,
    })),
  };
}

function parseEmoji(value) {
  const custom = value.match(/^<(a?):([^:>]+):(\d+)>$/);

  if (custom) {
    return {
      requested: value,
      display: `:${custom[2]}:`,
      discord: value,
      name: custom[2],
      id: custom[3],
      animated: custom[1] === "a",
      source: "historical_message",
      key: `custom:${custom[3]}`,
      reaction: custom[3],
    };
  }

  return {
    requested: value,
    display: value,
    discord: value,
    name: null,
    id: null,
    animated: false,
    source: "unicode",
    key: `unicode:${value}`,
    reaction: value,
  };
}

function reactionKey(reaction) {
  return reaction.emoji.id
    ? `custom:${reaction.emoji.id}`
    : `unicode:${reaction.emoji.name}`;
}

function parsePoll(message) {
  const embed = message.embeds.find(
    (item) =>
      item.title === "Friday Dress Code Poll" ||
      item.title === "Friday Dress Code: Results",
  );

  if (!embed?.description) return null;

  const pattern =
    /(?:^|\n\n)(\d+)\. ([^\n]+?)・([\s\S]*?)\n[ \t]*└ (\d+) votes? \(([\d.]+)%\)(?=\n\n|$)/g;

  const options = [];
  let match;

  while ((match = pattern.exec(embed.description)) !== null) {
    options.push({
      number: Number(match[1]),
      emoji: parseEmoji(match[2]),
      description: match[3],
      savedVotes: Number(match[4]),
      savedPercentage: Number(match[5]),
    });
  }

  if (
    options.length < 1 ||
    options.length > 6 ||
    options.some((option, index) => option.number !== index + 1)
  ) {
    return null;
  }

  const totalMatch = embed.description.match(/\*\*(\d+)\*\* voters?\./);

  if (!totalMatch) return null;

  const closed =
    embed.title === "Friday Dress Code: Results" &&
    /Poll closed/.test(embed.description);

  const running =
    embed.title === "Friday Dress Code Poll" &&
    /Ends <t:\d+:R>/.test(embed.description);

  if (!closed && !running) return null;

  const scheduled = embed.description.match(/Ends <t:(\d+):R>/);

  const total = Number(totalMatch[1]);

  const highest = Math.max(...options.map((option) => option.savedVotes));

  return {
    message,
    embed,
    options,
    total,
    closed,

    scheduledEndMs: scheduled ? Number(scheduled[1]) * 1000 : null,

    winners: total
      ? options.filter((option) => option.savedVotes === highest)
      : [],

    countsMatchTotal:
      options.reduce((sum, option) => sum + option.savedVotes, 0) === total,
  };
}

function parseResult(message) {
  const embed = message.embeds.find(
    (item) => item.title === "Friday Dress Code: Final Results",
  );

  const total = embed?.footer?.text?.match(
    /^The poll has ended\. Total voters: (\d+)$/,
  );

  if (!embed?.description || !total) return null;

  return {
    message,
    embed,
    total: Number(total[1]),
    description: embed.description,
  };
}

function expectedResultDescription(poll) {
  if (poll.total === 0) return "No votes were cast.";

  return (
    `${poll.winners.length === 1 ? "**Winner:**" : "**Tie:**"}\n` +
    poll.winners
      .map((option) => `${option.number}. ${option.description}`)
      .join("\n")
  );
}

function closureReference(poll) {
  return poll.embed.timestamp ?? poll.message.editedTimestamp ?? null;
}

function candidateResults(poll, results) {
  if (!poll.closed) return [];

  const reference = closureReference(poll);

  if (!Number.isFinite(reference)) return [];

  const expected = expectedResultDescription(poll);

  return results.filter((result) => {
    const difference = result.message.createdTimestamp - reference;

    return (
      result.message.createdTimestamp >= poll.message.createdTimestamp &&
      difference >= -2000 &&
      difference <= RESULTS_WINDOW_MS &&
      result.total === poll.total &&
      result.description === expected
    );
  });
}

/*
 * One shared selector ensures the directory date, endsAt, and
 * timestamp provenance always use the same source.
 */
function resolveEndTimestamp(poll, result) {
  const candidates = [
    {
      ms: poll.scheduledEndMs,
      source: "original_poll_description",
      scheduledEndKnown: true,
    },
  ];

  if (poll.closed) {
    candidates.push(
      {
        ms: result?.embed.timestamp,
        source: "final_results_embed_timestamp_approximation",
        scheduledEndKnown: false,
      },
      {
        ms: poll.embed.timestamp,
        source: "closed_poll_embed_timestamp_approximation",
        scheduledEndKnown: false,
      },
      {
        ms: result?.message.createdTimestamp,
        source: "results_message_timestamp_approximation",
        scheduledEndKnown: false,
      },
      {
        ms: poll.message.editedTimestamp,
        source: "poll_edit_timestamp_approximation",
        scheduledEndKnown: false,
      },
    );
  }

  const selected = candidates.find(
    (candidate) =>
      typeof candidate.ms === "number" && Number.isFinite(candidate.ms),
  );

  if (!selected) {
    throw new Error("No usable scheduled-end or closure timestamp was found.");
  }

  return selected;
}

function chooseMedia(poll, media, polls) {
  const priorPoll = polls
    .filter((item) => compareIds(item.message, poll.message) < 0)
    .at(-1);

  const candidates = media.filter((message) => {
    const gap = poll.message.createdTimestamp - message.createdTimestamp;

    return (
      compareIds(message, poll.message) < 0 &&
      (!priorPoll || compareIds(message, priorPoll.message) > 0) &&
      gap >= 0 &&
      gap <= MEDIA_WINDOW_MS &&
      message.attachments.size === poll.options.length
    );
  });

  if (candidates.length !== 1) {
    throw new Error(
      "Expected one matching Options message; " + `found ${candidates.length}.`,
    );
  }

  return candidates[0];
}

function imageAttachments(message) {
  return [...message.attachments.values()].filter(
    (attachment) =>
      attachment.contentType?.startsWith("image/") ||
      /\.(png|jpe?g|gif|webp|avif)$/i.test(attachment.name ?? ""),
  );
}

async function scanChannel(channel) {
  const polls = [];
  const media = [];
  const results = [];
  // Every message, oldest first after sorting (to find images next to native polls).
  const timeline = [];
  const nativePolls = [];

  let before;

  while (true) {
    const batch = await channel.messages.fetch({
      limit: 100,
      before,
      cache: false,
    });

    if (!batch.size) break;

    report.scannedMessages += batch.size;

    for (const message of batch.values()) {
      timeline.push({
        id: message.id,
        authorId: message.author.id,
        at: message.createdTimestamp,
        images: imageAttachments(message),
        message,
      });

      if (message.poll) {
        const count = message.poll.answers.size;
        if (count >= NATIVE_MIN_OPTIONS && count <= NATIVE_MAX_OPTIONS) {
          nativePolls.push(message);
        } else {
          report.skipped.push({
            messageId: message.id,
            reason: `native_poll_with_${count}_options`,
          });
        }
      }

      if (
        message.author.id !== AUTHOR_ID ||
        !message.author.bot ||
        message.webhookId
      ) {
        continue;
      }

      const poll = parsePoll(message);
      const result = parseResult(message);

      if (poll) {
        polls.push(poll);
      } else if (result) {
        results.push(result);
      } else if (
        message.content.trim() === "Options:" &&
        message.attachments.size >= 1 &&
        message.attachments.size <= 6
      ) {
        media.push(message);
      }
    }

    const oldest = [...batch.keys()].reduce((minimum, id) =>
      BigInt(id) < BigInt(minimum) ? id : minimum,
    );

    if (oldest === before) {
      throw new Error("Channel-history pagination did not advance.");
    }

    before = oldest;

    console.log(
      `[FDC import] Scanned ${report.scannedMessages} messages; ` +
        `found ${polls.length} polls.`,
    );

    if (batch.size < 100) break;
  }

  polls.sort((a, b) => compareIds(a.message, b.message));

  media.sort(compareIds);

  results.sort((a, b) => compareIds(a.message, b.message));

  report.detectedPolls = polls.length;

  timeline.sort(compareIds);
  nativePolls.sort(compareIds);
  report.detectedNativePolls = nativePolls.length;

  return { polls, media, results, timeline, nativePolls };
}

async function downloadImage(attachment, destination) {
  const response = await fetch(attachment.url, {
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(`Attachment ${attachment.id}: HTTP ${response.status}`);
  }

  const declared = Number(response.headers.get("content-length") || 0);

  if (declared > MAX_IMAGE_BYTES) {
    await response.body?.cancel();

    throw new Error(`Attachment ${attachment.id} exceeds 30 MiB.`);
  }

  if (!response.body) {
    throw new Error(
      `Attachment ${attachment.id} returned an empty response body.`,
    );
  }

  const chunks = [];
  let bytes = 0;

  for await (const chunk of response.body) {
    bytes += chunk.length;

    if (bytes > MAX_IMAGE_BYTES) {
      throw new Error(`Attachment ${attachment.id} exceeds 30 MiB.`);
    }

    chunks.push(chunk);
  }

  const converted = await sharp(Buffer.concat(chunks), {
    animated: true,
  })
    .webp({
      quality: 90,
      effort: 4,
    })
    .toBuffer({
      resolveWithObject: true,
    });

  await fs.writeFile(destination, converted.data);

  return {
    format: "webp",
    bytes: converted.data.length,
    width: converted.info.width,
    height: converted.info.height,
    pages: converted.info.pages ?? 1,
    savedAt: stamp(),
  };
}

async function observeReactions(message, options, observedAt) {
  const byUser = new Map();

  for (const option of options) {
    const reaction = message.reactions.cache.find(
      (item) => reactionKey(item) === option.emoji.key,
    );

    if (!reaction) continue;

    for (const type of [0, 1]) {
      let after;

      while (true) {
        const users = await reaction.users.fetch({
          limit: 100,
          after,
          type,
        });

        for (const user of users.values()) {
          if (user.bot) continue;

          if (!byUser.has(user.id)) {
            byUser.set(user.id, new Set());
          }

          byUser.get(user.id).add(option.number);
        }

        if (users.size < 100) break;

        const next = [...users.keys()].reduce(
          (highest, id) => (BigInt(id) > BigInt(highest) ? id : highest),
          "0",
        );

        if (next === after) {
          throw new Error("Reaction-user pagination did not advance.");
        }

        after = next;
      }
    }
  }

  const observations = [...byUser.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([userId, selections]) => ({
      userId,

      optionNumbers: [...selections].sort((a, b) => a - b),

      observedAt,
      votedAt: null,
      timestampSource: "historical_import",
    }));

  const unambiguous = observations.filter(
    (item) => item.optionNumbers.length === 1,
  );

  const votes = unambiguous.map((item, index) => ({
    userId: item.userId,
    optionNumber: item.optionNumbers[0],
    votedAt: null,
    observedAt,
    timestampSource: "historical_import",
    sequence: index + 1,
  }));

  votes.sort((a, b) => b.sequence - a.sequence);

  const history = votes
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((vote) => ({
      sequence: vote.sequence,
      action: "recovered_add",
      userId: vote.userId,
      optionNumber: vote.optionNumber,
      previousOptionNumber: null,
      votedAt: null,
      observedAt,
      timestampSource: "historical_import",
    }));

  return {
    observations,

    ambiguous: observations.filter((item) => item.optionNumbers.length > 1),

    votes,
    history,
  };
}

function calculateStatistics(options, votes) {
  const total = votes.length;

  const counts = options.map(
    (option) =>
      votes.filter((vote) => vote.optionNumber === option.number).length,
  );

  const highest = Math.max(0, ...counts);

  return {
    totalVoters: total,

    options: options.map((option, index) => ({
      optionNumber: option.number,
      votes: counts[index],

      percentage: total
        ? Number(((counts[index] / total) * 100).toFixed(2))
        : 0,
    })),

    winningOptionNumbers: total
      ? options
          .filter((_, index) => counts[index] === highest)
          .map((option) => option.number)
      : [],

    isTie: total > 0 && counts.filter((count) => count === highest).length > 1,
  };
}

async function existingRecords() {
  const records = [];

  for (const entry of await fs.readdir(ROOT, {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) {
      continue;
    }

    const record = await readJson(
      path.join(ROOT, entry.name, "data.json"),
      null,
    );

    if (!record) continue;

    if (
      !record.id ||
      !Array.isArray(record.options) ||
      !Array.isArray(record.votes) ||
      !Array.isArray(record.voteHistory)
    ) {
      throw new Error(`Invalid existing archive: ${entry.name}/data.json`);
    }

    records.push(record);
  }

  return records;
}

async function rebuildSummary() {
  const old = await readJson(SUMMARY_PATH, {
    version: 1,
    totalFdcCount: 0,
    countedPollIds: [],
  });

  if (!Number.isSafeInteger(old.totalFdcCount) || old.totalFdcCount < 0) {
    throw new Error(
      "summary.json totalFdcCount must be a non-negative safe integer.",
    );
  }

  const polls = (await existingRecords()).sort(
    (a, b) => b.createdAt.ms - a.createdAt.ms,
  );

  const counted = new Set(old.countedPollIds ?? []);
  let totalFdcCount = old.totalFdcCount;

  for (const poll of polls) {
    if (!counted.has(poll.id)) {
      counted.add(poll.id);
      totalFdcCount += 1;
    }
  }

  const voters = new Map();
  let lifetimeVoteEventCount = 0;

  for (const poll of polls) {
    for (const event of poll.voteHistory) {
      if (
        !["add", "switch", "recovered_add", "recovered_switch", "imported"].includes(
          event.action,
        )
      ) {
        continue;
      }

      lifetimeVoteEventCount += 1;

      let voter = voters.get(event.userId);

      if (!voter) {
        voter = {
          userId: event.userId,
          pollIds: [],
          voteEventCount: 0,
          firstObservedVoteAt: event.observedAt,
          lastObservedVoteAt: event.observedAt,
        };

        voters.set(event.userId, voter);
      }

      if (!voter.pollIds.includes(poll.id)) {
        voter.pollIds.push(poll.id);
      }

      voter.voteEventCount += 1;

      if (event.observedAt.ms < voter.firstObservedVoteAt.ms) {
        voter.firstObservedVoteAt = event.observedAt;
      }

      if (event.observedAt.ms > voter.lastObservedVoteAt.ms) {
        voter.lastObservedVoteAt = event.observedAt;
      }
    }
  }

  const voterList = [...voters.values()].sort(
    (a, b) =>
      b.lastObservedVoteAt.ms - a.lastObservedVoteAt.ms ||
      a.userId.localeCompare(b.userId),
  );

  const indexed = polls.map((poll) => ({
    id: poll.id,
    date: poll.date,
    dataFile: `${poll.date}/data.json`,
    messageId: poll.messageId,
    mediaMessageId: poll.mediaMessageId,
    resultsMessageId: poll.resultsMessageId,
    senderUserId: poll.senderUserId,
    guildId: poll.guildId,
    channelId: poll.channelId,
    status: poll.status,
    createdAt: poll.createdAt,
    sentAt: poll.sentAt,
    endsAt: poll.endsAt,
    closedAt: poll.closedAt,
    statistics: poll.statistics,
  }));

  const latest = polls[0];

  const next = {
    ...old,
    version: 1,
    timeZone: TIME_ZONE,
    totalFdcCount,
    countedPollIds: [...counted],
    archivedPollCount: polls.length,
    lifetimeUniqueVoterCount: voterList.length,
    lifetimeVoteEventCount,

    overallVoterIds: voterList.map((voter) => voter.userId),

    voters: voterList,

    latestPoll: latest
      ? {
          ...indexed[0],

          voterIds: latest.votes.map((vote) => vote.userId),

          votes: latest.votes,
        }
      : null,

    polls: indexed,
    updatedAt: stamp(),
  };

  await atomicJson(SUMMARY_PATH, next);
}

async function buildRecord(poll, mediaMessage, result, end, staging) {
  const message = await poll.message.fetch();
  const importedAt = stamp();
  const warnings = [];

  if (!end.scheduledEndKnown) {
    warnings.push(
      "Original scheduled deadline unavailable; " +
        `endsAt uses ${end.source}.`,
    );
  }

  if (!poll.countsMatchTotal) {
    warnings.push("The saved option counts do not add up to the saved total.");
  }

  const senderUserId =
    message.interactionMetadata?.user?.id ??
    message.interaction?.user?.id ??
    null;

  if (!senderUserId) {
    warnings.push("Original command sender is not exposed by the message.");
  }

  if (poll.closed && !result) {
    warnings.push("No unambiguous separate final-results message was matched.");
  }

  const attachments = [...mediaMessage.attachments.values()];

  const options = [];

  for (let index = 0; index < poll.options.length; index += 1) {
    const option = poll.options[index];
    const attachment = attachments[index];
    const localFile = `${option.number}.webp`;

    console.log(
      `[FDC import] ${message.id}: ` + `downloading option ${option.number}`,
    );

    const saved = await downloadImage(
      attachment,
      path.join(staging, localFile),
    );

    options.push({
      number: option.number,
      description: option.description,
      emoji: option.emoji,

      media: {
        originalAttachmentId: attachment.id,
        originalName: attachment.name,
        originalUrl: attachment.url,
        originalProxyUrl: attachment.proxyURL,
        originalContentType: attachment.contentType,
        originalSize: attachment.size,
        originalWidth: attachment.width,
        originalHeight: attachment.height,
        localFile,
        ...saved,
      },
    });
  }

  const reactions = await observeReactions(message, options, importedAt);

  if (reactions.ambiguous.length) {
    warnings.push(
      `${reactions.ambiguous.length} users currently react ` +
        "to multiple options; their selections are preserved " +
        "but excluded from single-choice votes.",
    );
  }

  const observedStatistics = calculateStatistics(options, reactions.votes);

  if (poll.closed && observedStatistics.totalVoters !== poll.total) {
    warnings.push(
      "Current unambiguous reaction voters differ " +
        "from the saved final total.",
    );
  }

  const roleId = message.content.match(/<@&(\d+)>/)?.[1] ?? null;

  const closedAtMs = poll.closed
    ? (result?.message.createdTimestamp ??
      poll.embed.timestamp ??
      message.editedTimestamp ??
      end.ms)
    : null;

  return {
    version: 1,
    id: message.id,
    date: dateKey(end.ms),
    timeZone: TIME_ZONE,
    status: poll.closed ? "closed" : "active",
    guildId: message.guildId,
    channelId: message.channelId,
    senderUserId,

    interactionId:
      message.interactionMetadata?.id ?? message.interaction?.id ?? null,

    roleId,
    commandName: "fdc",
    createdAt: stamp(message.createdTimestamp),
    sentAt: stamp(message.createdTimestamp),
    mediaSentAt: stamp(mediaMessage.createdTimestamp),
    endsAt: stamp(end.ms),
    originalEndInput: null,

    closedAt: closedAtMs !== null ? stamp(closedAtMs) : null,

    closingStartedAt: null,

    resultsSentAt: result ? stamp(result.message.createdTimestamp) : null,

    messageId: message.id,
    messageUrl: message.url,
    mediaMessageId: mediaMessage.id,
    resultsMessageId: result?.message.id ?? null,
    options,
    votes: reactions.votes,
    voteHistory: reactions.history,
    lastSequence: reactions.history.length,
    lastReconciledAt: importedAt,
    lastRecoveryError: null,
    updatedAt: importedAt,

    statistics: observedStatistics,

    officialResults: {
      source: "saved_poll_embed",
      final: poll.closed,
      totalVoters: poll.total,

      options: poll.options.map((option) => ({
        optionNumber: option.number,
        votes: option.savedVotes,
        percentage: option.savedPercentage,
      })),

      winningOptionNumbers: poll.closed
        ? poll.winners.map((option) => option.number)
        : [],

      isTie: poll.closed && poll.winners.length > 1,

      resultsDescription: result?.description ?? null,

      resultsEmbedTimestamp: Number.isFinite(result?.embed.timestamp)
        ? stamp(result.embed.timestamp)
        : null,
    },

    reactionSnapshot: {
      observedAt: importedAt,
      users: reactions.observations,
      ambiguousUsers: reactions.ambiguous,
      historicalFinalVoteIdentityGuaranteed: false,
      historicalVoteOrderKnown: false,
    },

    importMetadata: {
      importedAt,
      source: "discord_channel_history",
      scheduledEndKnown: end.scheduledEndKnown,
      endTimestampSource: end.source,
      senderKnown: senderUserId !== null,
      voteTimestampsKnown: false,
      voteOrderKnown: false,
      originalEndInputKnown: false,
      warnings,
    },

    sourceMessages: {
      poll: snapshot(message),
      media: snapshot(mediaMessage),
      results: snapshot(result?.message),
    },
  };
}

/* ---------- native Discord polls ---------- */

/** A poll answer's emoji in the archive's shape (default keycap when it has none). */
function nativeEmoji(raw, number) {
  if (raw?.id) {
    const markup = `<${raw.animated ? "a" : ""}:${raw.name}:${raw.id}>`;
    return {
      requested: markup,
      display: `:${raw.name}:`,
      discord: markup,
      name: raw.name,
      id: raw.id,
      animated: Boolean(raw.animated),
      source: "discord_poll",
      key: `custom:${raw.id}`,
      reaction: raw.id,
    };
  }
  return parseEmoji(raw?.name || DEFAULT_EMOJIS[number - 1]);
}

/*
 * The option images of a native poll: images from the poll author's
 * messages directly before the poll (the usual "Options:" post), or right
 * after it, within an hour. The number of images has to match the options
 * exactly, so a random image is never picked up by mistake.
 */
function findNativeImages(message, timeline) {
  const count = message.poll.answers.size;
  const index = timeline.findIndex((entry) => entry.id === message.id);
  const author = message.author.id;

  const collect = (step) => {
    const found = [];
    for (let i = index + step; i >= 0 && i < timeline.length; i += step) {
      const entry = timeline[i];
      if (entry.authorId !== author) break;
      if (Math.abs(entry.at - message.createdTimestamp) > NATIVE_MEDIA_WINDOW_MS) break;
      if (entry.message.poll) break;
      if (entry.images.length) found.push(entry);
      if (found.reduce((sum, item) => sum + item.images.length, 0) >= count) break;
    }
    // Chronological order, attachments in their message order.
    return (step < 0 ? found.reverse() : found);
  };

  const flatten = (entries) => entries.flatMap((entry) => entry.images.map((image) => ({ image, message: entry.message })));

  const before = flatten(collect(-1));
  if (before.length === count) return { images: before, where: "before" };

  const after = flatten(collect(1));
  if (after.length === count) return { images: after, where: "after" };
  if (before.length + after.length === count) return { images: [...before, ...after], where: "around" };

  throw new Error(
    `Expected ${count} option images next to the poll, found ${before.length} before and ${after.length} after.`,
  );
}

/* "1 - Wounded Knight" -> "Wounded Knight": the number is shown separately. */
function cleanAnswerText(text, number) {
  const value = String(text ?? "").trim();
  const stripped = value.replace(new RegExp(`^${number}\\s*[-–—:.]\\s+`), "").trim();
  return stripped || value || `Option ${number}`;
}

async function fetchVoters(answer) {
  const users = [];
  let after;
  for (;;) {
    const batch = await answer.voters.fetch({ limit: 100, after });
    users.push(...batch.values());
    if (batch.size < 100) break;
    after = [...batch.keys()].reduce((highest, id) => (BigInt(id) > BigInt(highest) ? id : highest), "0");
  }
  return users.filter((user) => !user.bot);
}

async function buildNativeRecord(message, found, staging) {
  const importedAt = stamp();
  const poll = message.poll;
  const answers = [...poll.answers.values()].sort((a, b) => a.id - b.id);
  const endMs = poll.expiresTimestamp ?? message.createdTimestamp;
  const warnings = [];

  const options = [];
  const votes = [];
  const history = [];
  const counts = [];

  for (const [index, answer] of answers.entries()) {
    const number = index + 1;
    const { image } = found.images[index];
    const localFile = `${number}.webp`;

    console.log(`[FDC import] ${message.id}: downloading option ${number}`);
    const saved = await downloadImage(image, path.join(staging, localFile));

    options.push({
      number,
      description: cleanAnswerText(answer.text, number),
      emoji: nativeEmoji(answer._emoji, number),
      media: {
        originalAttachmentId: image.id,
        originalName: image.name,
        originalUrl: image.url,
        originalProxyUrl: image.proxyURL,
        originalContentType: image.contentType,
        originalSize: image.size,
        originalWidth: image.width,
        originalHeight: image.height,
        localFile,
        ...saved,
      },
    });

    if (!answer.emoji && !answer._emoji) {
      warnings.push(`Option ${number} had no emoji; ${DEFAULT_EMOJIS[index]} is used.`);
    }

    const voters = await fetchVoters(answer);
    counts.push(answer.voteCount ?? voters.length);

    for (const user of voters) {
      const sequence = history.length + 1;
      const event = {
        sequence,
        action: "imported",
        userId: user.id,
        optionNumber: number,
        previousOptionNumber: null,
        votedAt: null,
        observedAt: importedAt,
        timestampSource: "discord_poll",
      };
      history.push(event);
      votes.push({
        userId: user.id,
        optionNumber: number,
        votedAt: null,
        observedAt: importedAt,
        timestampSource: "discord_poll",
        sequence,
      });
    }
  }

  const total = counts.reduce((sum, count) => sum + count, 0);
  const highest = Math.max(0, ...counts);
  const winners = total ? options.filter((_, index) => counts[index] === highest).map((option) => option.number) : [];

  if (poll.allowMultiselect) warnings.push("The poll allowed several answers per person.");

  // Discord's "poll has closed" system message, if there is one.
  const resultMessage = found.resultMessage ?? null;
  const media = found.images[0].message;

  return {
    version: 1,
    id: message.id,
    date: dateKey(endMs),
    timeZone: TIME_ZONE,
    status: "closed",
    guildId: message.guildId,
    channelId: message.channelId,
    senderUserId: message.author.id,
    interactionId: null,
    roleId: message.content.match(/<@&(\d+)>/)?.[1] ?? null,
    commandName: "discord-poll",
    createdVia: "discord-poll",
    createdAt: stamp(message.createdTimestamp),
    sentAt: stamp(message.createdTimestamp),
    mediaSentAt: stamp(media.createdTimestamp),
    endsAt: stamp(endMs),
    originalEndInput: null,
    closedAt: stamp(endMs),
    closingStartedAt: null,
    resultsSentAt: resultMessage ? stamp(resultMessage.createdTimestamp) : null,
    messageId: message.id,
    messageUrl: message.url,
    mediaMessageId: media.id,
    mediaMessageIds: [...new Set(found.images.map((item) => item.message.id))],
    resultsMessageId: resultMessage?.id ?? null,
    question: poll.question?.text ?? null,
    options,
    votes,
    voteHistory: history,
    lastSequence: history.length,
    lastReconciledAt: importedAt,
    lastRecoveryError: null,
    updatedAt: importedAt,
    statistics: calculateStatistics(options, votes),

    officialResults: {
      source: "discord_poll_results",
      final: true,
      totalVoters: total,
      options: options.map((option, index) => ({
        optionNumber: option.number,
        votes: counts[index],
        percentage: total ? Number(((counts[index] / total) * 100).toFixed(2)) : 0,
      })),
      winningOptionNumbers: winners,
      isTie: winners.length > 1,
      resultsDescription: null,
      resultsEmbedTimestamp: null,
    },

    importMetadata: {
      importedAt,
      source: "discord_native_poll",
      scheduledEndKnown: Boolean(poll.expiresTimestamp),
      endTimestampSource: poll.expiresTimestamp ? "poll_expiry" : "message_created",
      imagesFound: found.where,
      senderKnown: true,
      voteTimestampsKnown: false,
      voteOrderKnown: false,
      originalEndInputKnown: false,
      warnings,
    },

    sourceMessages: {
      poll: snapshot(message),
      media: snapshot(media),
      results: snapshot(resultMessage),
    },
  };
}

async function importNativePolls({ nativePolls, timeline, existingIds, existingDates }) {
  for (const message of nativePolls) {
    const id = message.id;
    let staging;

    try {
      if (existingIds.has(id)) {
        report.skipped.push({ messageId: id, reason: "already_archived" });
        continue;
      }

      const poll = message.poll;
      const ended = poll.resultsFinalized || (poll.expiresTimestamp && poll.expiresTimestamp <= Date.now());
      if (!ended) {
        report.skipped.push({ messageId: id, reason: "native_poll_still_running" });
        continue;
      }

      const date = dateKey(poll.expiresTimestamp ?? message.createdTimestamp);
      if (existingDates.has(date)) {
        report.skipped.push({ messageId: id, date, reason: "date_already_archived" });
        continue;
      }

      const found = findNativeImages(message, timeline);
      found.resultMessage =
        timeline.find(
          (entry) => entry.message.type === 46 && entry.message.reference?.messageId === id,
        )?.message ?? null;

      const answers = [...poll.answers.values()].sort((a, b) => a.id - b.id);

      if (DRY_RUN) {
        report.imported.push({
          messageId: id,
          date,
          kind: "native_poll",
          optionCount: answers.length,
          imagesFound: found.where,
          mediaMessageIds: [...new Set(found.images.map((item) => item.message.id))],
          options: answers.map((answer, index) => ({
            number: index + 1,
            emoji: answer._emoji?.id ? `:${answer._emoji.name}:` : (answer._emoji?.name ?? DEFAULT_EMOJIS[index]),
            description: cleanAnswerText(answer.text, index + 1),
            votes: answer.voteCount ?? null,
          })),
          plannedOnly: true,
        });
        existingDates.add(date);
        console.log(
          `[FDC import] Would import native poll ${date}: ${answers.length} options, images ${found.where} the poll`,
        );
        continue;
      }

      staging = path.join(ROOT, `.import-${id}`);
      await fs.mkdir(staging);

      const record = await buildNativeRecord(message, found, staging);
      await atomicJson(path.join(staging, "data.json"), record);
      await fs.rename(staging, path.join(ROOT, date));
      staging = null;

      existingIds.add(id);
      existingDates.add(date);
      await rebuildSummary();

      report.imported.push({
        messageId: id,
        date,
        kind: "native_poll",
        optionCount: record.options.length,
        officialVoters: record.officialResults.totalVoters,
        warnings: record.importMetadata.warnings,
      });
      console.log(`[FDC import] Imported native poll ${date}: ${id} (${record.options.length} options)`);
    } catch (error) {
      if (staging) await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
      report.failed.push({ messageId: id, kind: "native_poll", error: error.message });
      console.error(`[FDC import] Failed native poll ${id}: ${error.message}`);
    }
  }
}

/* ---------- manifests (Steam group chat polls, no Discord) ---------- */

/* Berlin wall-clock time -> Date (same approach as src/lib/fdcTime.js). */
function berlinDate(year, month, day, hour, minute) {
  const offset = (ms) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: TIME_ZONE,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
      })
        .formatToParts(new Date(ms))
        .map((part) => [part.type, part.value]),
    );
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute) - Math.floor(ms / 60000) * 60000;
  };
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let result = guess - offset(guess);
  const second = guess - offset(result);
  if (second !== result) result = second;
  return new Date(result);
}

/** "2026-03-27" or "2026-03-27 10:00" / "2026-03-27T10:00" (Berlin time); default 10:00. */
function manifestEnd(poll) {
  const value = String(poll.endsAt ?? poll.date ?? "").trim();
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (!match) throw new Error(`Invalid date "${value}" (use YYYY-MM-DD or YYYY-MM-DD HH:MM).`);
  const [, year, month, day, hour = "10", minute = "0"] = match;
  return berlinDate(Number(year), Number(month), Number(day), Number(hour), Number(minute));
}

async function importManifest(existingDates) {
  const { buildManualPoll } = require("../server/services/fdcManual.cjs");
  const file = path.resolve(MANIFEST);
  const base = path.dirname(file);
  const manifest = JSON.parse(await fs.readFile(file, "utf8"));
  const polls = Array.isArray(manifest) ? manifest : manifest.polls ?? [];
  const defaultLabel = manifest.label ?? "Steam group";

  console.log(`[FDC import] Manifest ${path.relative(PROJECT_ROOT, file)}: ${polls.length} poll(s).`);

  for (const entry of polls) {
    let staging;
    try {
      const end = manifestEnd(entry);
      const date = dateKey(end.getTime());
      if (existingDates.has(date)) {
        report.skipped.push({ date, reason: "date_already_archived", kind: "manifest" });
        console.log(`[FDC import] ${date}: already archived, skipped.`);
        continue;
      }

      const options = [];
      for (const [index, option] of (entry.options ?? []).entries()) {
        // Image optional; without one the option needs a name.
        const imagePath = option.image ? path.resolve(base, String(option.image)) : null;
        const buffer = imagePath
          ? await fs.readFile(imagePath).catch(() => {
              throw new Error(`Option ${index + 1}: image ${option.image} not found.`);
            })
          : null;
        options.push({
          // Name and emoji are optional (old Steam polls often had neither).
          description: option.description ?? option.name ?? "",
          emoji: String(option.emoji ?? "").trim() ? parseEmoji(String(option.emoji).trim()) : null,
          media: buffer ? { buffer, name: path.basename(imagePath), contentType: null } : null,
          votes: Number(option.votes ?? 0),
          winner: option.winner === true,
        });
      }

      const counts = Object.fromEntries(options.map((option, index) => [index + 1, option.votes]));
      // Only the winner known: `"winner": 2` on the poll or `"winner": true` on an option,
      // and no vote counts. A poll with a single option is that winner.
      const anyVotes = options.some((option) => option.votes > 0);
      const winner =
        entry.winner ?? (options.findIndex((option) => option.winner) + 1 || (!anyVotes && options.length === 1 ? 1 : null));

      if (DRY_RUN) {
        report.imported.push({
          date,
          kind: "manifest",
          optionCount: options.length,
          options: options.map((option, index) => ({
            number: index + 1,
            emoji: option.emoji?.display ?? "(none)",
            description: option.description,
            votes: option.votes,
          })),
          plannedOnly: true,
        });
        existingDates.add(date);
        console.log(`[FDC import] Would add ${date} from the manifest (${options.length} options).`);
        continue;
      }

      staging = path.join(ROOT, `.manifest-${date}`);
      await fs.mkdir(staging);
      const record = await buildManualPoll({
        date,
        folder: staging,
        timeZone: TIME_ZONE,
        endsAt: end,
        question: entry.question,
        note: entry.note,
        options,
        votes: winner ? null : { label: entry.label ?? defaultLabel, counts },
        winner,
        via: "manifest",
      });
      await fs.rename(staging, path.join(ROOT, date));
      staging = null;

      existingDates.add(date);
      await rebuildSummary();
      report.imported.push({ date, kind: "manifest", optionCount: record.options.length, messageId: record.id });
      console.log(`[FDC import] Added ${date} from the manifest (${record.options.length} options).`);
    } catch (error) {
      if (staging) await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
      report.failed.push({ date: entry.date ?? null, kind: "manifest", error: error.message });
      console.error(`[FDC import] Manifest poll ${entry.date ?? "?"} failed: ${error.message}`);
    }
  }
}

async function main() {
  await fs.mkdir(ROOT, {
    recursive: true,
  });

  let lock;
  let summaryReady = false;

  try {
    try {
      lock = await fs.open(LOCK_PATH, "wx");

      await lock.writeFile(
        JSON.stringify({
          pid: process.pid,
          startedAt: report.startedAt,
        }),
      );
    } catch (error) {
      if (error.code === "EEXIST") {
        throw new Error(
          "An import lock already exists. " +
            "Ensure no importer is running before removing " +
            "server/services/db/fdc-polls/.import.lock.",
        );
      }

      throw error;
    }

    const existingSummary = await readJson(SUMMARY_PATH, null);

    if (
      existingSummary &&
      (!Number.isSafeInteger(existingSummary.totalFdcCount) ||
        existingSummary.totalFdcCount < 0)
    ) {
      throw new Error("Invalid summary.json totalFdcCount.");
    }

    const existing = await existingRecords();
    summaryReady = true;

    if (!DRY_RUN && existingSummary) {
      await fs.copyFile(
        SUMMARY_PATH,
        path.join(ROOT, `summary.backup-${Date.now()}.json`),
      );
    }

    if (MANIFEST) {
      await importManifest(new Set(existing.map((poll) => poll.date)));
      if (!USE_DISCORD) {
        console.log(
          `[FDC import] ${DRY_RUN ? "Would add" : "Added"}: ${report.imported.length}; ` +
            `skipped: ${report.skipped.length}; failed: ${report.failed.length}.`,
        );
        if (report.failed.length) process.exitCode = 1;
        return;
      }
    }

    const ready = once(client, "clientReady");

    await client.login(token);
    await ready;

    const channel = await client.channels.fetch(CHANNEL_ID);

    if (!channel?.guild || !channel.messages?.fetch) {
      throw new Error("The configured channel is not a guild message channel.");
    }

    const me = await channel.guild.members.fetchMe();
    const permissions = channel.permissionsFor(me);

    if (
      !permissions?.has(PermissionFlagsBits.ViewChannel) ||
      !permissions.has(PermissionFlagsBits.ReadMessageHistory)
    ) {
      throw new Error("The bot needs View Channel and Read Message History.");
    }

    const { polls, media, results, timeline, nativePolls } = await scanChannel(channel);

    const existingIds = new Set(existing.map((poll) => poll.id));

    const existingDates = new Set(existing.map((poll) => poll.date));

    const resultCandidates = new Map();
    const resultUsage = new Map();

    for (const poll of polls) {
      const candidates = candidateResults(poll, results);

      resultCandidates.set(poll.message.id, candidates);

      for (const result of candidates) {
        const count = resultUsage.get(result.message.id) ?? 0;

        resultUsage.set(result.message.id, count + 1);
      }
    }

    const matchedResultIds = new Set();

    for (const record of existing) {
      if (record.resultsMessageId) {
        matchedResultIds.add(record.resultsMessageId);
      }
    }

    for (const poll of polls) {
      const id = poll.message.id;
      let staging;
      let committed = false;

      try {
        if (existingIds.has(id)) {
          report.skipped.push({
            messageId: id,
            reason: "already_archived",
          });

          continue;
        }

        const candidates = resultCandidates.get(id);

        const result =
          candidates.length === 1 &&
          resultUsage.get(candidates[0].message.id) === 1
            ? candidates[0]
            : null;

        const end = resolveEndTimestamp(poll, result);

        const date = dateKey(end.ms);
        const destination = path.join(ROOT, date);

        if (existingDates.has(date)) {
          throw new Error(
            `Date collision: ${date} already belongs to another poll.`,
          );
        }

        try {
          await fs.access(destination);

          throw new Error(
            `Directory ${date} already exists; ` + "refusing to overwrite it.",
          );
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }

        const mediaMessage = chooseMedia(poll, media, polls);

        if (DRY_RUN) {
          report.imported.push({
            messageId: id,
            date,
            status: poll.closed ? "closed" : "active",
            mediaMessageId: mediaMessage.id,
            resultsMessageId: result?.message.id ?? null,
            optionCount: poll.options.length,
            endsAt: stamp(end.ms),
            endTimestampSource: end.source,
            plannedOnly: true,
          });

          existingDates.add(date);

          if (result) {
            matchedResultIds.add(result.message.id);
          }

          continue;
        }

        staging = path.join(ROOT, `.import-${id}`);

        await fs.mkdir(staging);

        const record = await buildRecord(
          poll,
          mediaMessage,
          result,
          end,
          staging,
        );

        await atomicJson(path.join(staging, "data.json"), record);

        await fs.rename(staging, destination);

        staging = null;
        committed = true;

        existingIds.add(id);
        existingDates.add(date);

        if (result) {
          matchedResultIds.add(result.message.id);
        }

        await rebuildSummary();

        report.imported.push({
          messageId: id,
          date,
          status: record.status,
          optionCount: record.options.length,
          officialVoters: record.officialResults.totalVoters,
          observedVoters: record.votes.length,
          endsAt: record.endsAt,
          endTimestampSource: record.importMetadata.endTimestampSource,
          warnings: record.importMetadata.warnings,
        });

        console.log(
          `[FDC import] Imported ${date}: ${id} ` +
            `(${record.options.length} options; ` +
            `${record.importMetadata.endTimestampSource})`,
        );
      } catch (error) {
        if (staging) {
          await fs
            .rm(staging, {
              recursive: true,
              force: true,
            })
            .catch(() => {});
        }

        report.failed.push({
          messageId: id,
          archiveCommitted: committed,
          error: error.message,
        });

        console.error(`[FDC import] Failed ${id}: ${error.message}`);
      }
    }

    await importNativePolls({ nativePolls, timeline, existingIds, existingDates });

    report.unmatchedResults = results
      .filter((result) => !matchedResultIds.has(result.message.id))
      .map((result) => ({
        messageId: result.message.id,
        totalVoters: result.total,

        sentAt: stamp(result.message.createdTimestamp),

        embedTimestamp: Number.isFinite(result.embed.timestamp)
          ? stamp(result.embed.timestamp)
          : null,
      }));

    if (!DRY_RUN) {
      await rebuildSummary();
    }

    console.log(
      `[FDC import] ${DRY_RUN ? "Would import" : "Imported"}: ` +
        `${report.imported.length}; ` +
        `skipped: ${report.skipped.length}; ` +
        `failed: ${report.failed.length}.`,
    );

    if (report.failed.length) {
      process.exitCode = 1;
    }
  } catch (error) {
    report.fatalError = error.stack || error.message;

    process.exitCode = 1;

    console.error("[FDC import] Fatal:", error);
  } finally {
    client.destroy();

    if (lock) {
      if (!DRY_RUN && summaryReady) {
        await rebuildSummary().catch((error) => {
          report.summaryError = error.message;
          process.exitCode = 1;
        });
      }

      report.completedAt = stamp();

      await atomicJson(REPORT_PATH, report).catch((error) => {
        console.error("[FDC import] Could not write report:", error);

        process.exitCode = 1;
      });

      await lock.close();

      await fs.unlink(LOCK_PATH).catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(error);
  client.destroy();
  process.exitCode = 1;
});
