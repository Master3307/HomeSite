const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");
const { EmbedBuilder } = require("discord.js");

const ROOT = path.join(__dirname, "db", "fdc-polls");
const SUMMARY_PATH = path.join(ROOT, "summary.json");
const TIME_ZONE = "Europe/Berlin";
const UPDATE_DELAY = 1500;
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

const records = new Map();
const live = new Map();
const reservedDates = new Set();
const updateTimers = new Map();

let summary;
let queue = Promise.resolve();
let initialization;
let registeredClient;
let closingTimer;

function serial(task) {
  const result = queue.then(task);
  queue = result.catch((error) => {
    console.error("[FDC] Archive operation failed:", error);
  });
  return result;
}

function timestamp(value = Date.now()) {
  const ms = Number(value);
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

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, file);
}

function calculate(poll) {
  poll.votes.sort(
    (a, b) => b.observedAt.ms - a.observedAt.ms || b.sequence - a.sequence,
  );

  const total = poll.votes.length;
  const counts = poll.options.map(
    (option) =>
      poll.votes.filter((vote) => vote.optionNumber === option.number).length,
  );
  const highest = Math.max(0, ...counts);

  poll.statistics = {
    totalVoters: total,
    options: poll.options.map((option, index) => ({
      optionNumber: option.number,
      votes: counts[index],
      percentage: total
        ? Number(((counts[index] / total) * 100).toFixed(2))
        : 0,
    })),
    winningOptionNumbers: total
      ? poll.options
          .filter((_, index) => counts[index] === highest)
          .map((option) => option.number)
      : [],
    isTie: total > 0 && counts.filter((count) => count === highest).length > 1,
  };
}

function buildSummary() {
  const polls = [...records.values()].sort(
    (a, b) => b.createdAt.ms - a.createdAt.ms,
  );

  const voters = new Map();
  let lifetimeVoteEventCount = 0;

  for (const poll of polls) {
    for (const event of poll.voteHistory) {
      if (
        !["add", "switch", "recovered_add", "recovered_switch"].includes(
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

  const indexedPolls = polls.map((poll) => ({
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

  return {
    ...summary,
    version: 1,
    timeZone: TIME_ZONE,
    archivedPollCount: polls.length,
    lifetimeUniqueVoterCount: voterList.length,
    lifetimeVoteEventCount,
    overallVoterIds: voterList.map((voter) => voter.userId),
    voters: voterList,
    latestPoll: latest
      ? {
          ...indexedPolls[0],
          voterIds: latest.votes.map((vote) => vote.userId),
          votes: latest.votes,
        }
      : null,
    polls: indexedPolls,
    updatedAt: timestamp(),
  };
}

async function saveSummary() {
  /*
   * The stored lifetime counter is authoritative.
   * Re-read it so manual changes are respected on the next update.
   */
  const disk = await readJson(SUMMARY_PATH, null);

  if (disk) {
    if (!Number.isSafeInteger(disk.totalFdcCount) || disk.totalFdcCount < 0) {
      throw new Error(
        "summary.json totalFdcCount must be a non-negative safe integer.",
      );
    }

    summary.totalFdcCount = disk.totalFdcCount;
    summary.countedPollIds = Array.isArray(disk.countedPollIds)
      ? disk.countedPollIds
      : summary.countedPollIds;
  }

  const counted = new Set(summary.countedPollIds);

  for (const poll of records.values()) {
    if (!counted.has(poll.id)) {
      summary.totalFdcCount += 1;
      counted.add(poll.id);
    }
  }

  summary.countedPollIds = [...counted];
  summary = buildSummary();
  await atomicJson(SUMMARY_PATH, summary);
}

async function persist(poll) {
  calculate(poll);
  poll.updatedAt = timestamp();

  await atomicJson(path.join(ROOT, poll.date, "data.json"), poll);

  records.set(poll.id, poll);
  await saveSummary();
}

async function initialize() {
  if (initialization) return initialization;

  initialization = (async () => {
    await fs.mkdir(ROOT, { recursive: true });

    summary = await readJson(SUMMARY_PATH, {
      version: 1,
      totalFdcCount: 0,
      countedPollIds: [],
    });

    if (
      !Number.isSafeInteger(summary.totalFdcCount) ||
      summary.totalFdcCount < 0
    ) {
      throw new Error(
        "summary.json totalFdcCount must be a non-negative safe integer.",
      );
    }

    summary.countedPollIds ??= [];

    for (const entry of await fs.readdir(ROOT, {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) {
        continue;
      }

      const poll = await readJson(
        path.join(ROOT, entry.name, "data.json"),
        null,
      );

      if (!poll) continue;

      if (
        poll.version !== 1 ||
        !poll.id ||
        !Array.isArray(poll.options) ||
        !Array.isArray(poll.votes) ||
        !Array.isArray(poll.voteHistory)
      ) {
        throw new Error(`Invalid FDC archive: ${entry.name}/data.json`);
      }

      calculate(poll);
      records.set(poll.id, poll);
    }

    await saveSummary();
  })().catch((error) => {
    initialization = null;
    throw error;
  });

  return initialization;
}

function emojiKey(emoji) {
  return emoji.id ? `custom:${emoji.id}` : `unicode:${emoji.name}`;
}

function nextEvent(poll, action, userId, optionNumber, previous, source, at) {
  poll.lastSequence += 1;

  const event = {
    sequence: poll.lastSequence,
    action,
    userId,
    optionNumber,
    previousOptionNumber: previous?.optionNumber ?? null,
    votedAt: source === "gateway" && action !== "remove" ? at : null,
    observedAt: at,
    timestampSource: source,
  };

  poll.voteHistory.push(event);
  return event;
}

function applyVote(poll, userId, optionNumber, source, at) {
  const previous = poll.votes.find((vote) => vote.userId === userId);

  if (previous?.optionNumber === optionNumber) return false;

  const action =
    source === "gateway"
      ? previous
        ? "switch"
        : "add"
      : previous
        ? "recovered_switch"
        : "recovered_add";

  const event = nextEvent(
    poll,
    action,
    userId,
    optionNumber,
    previous,
    source,
    at,
  );

  poll.votes = poll.votes.filter((vote) => vote.userId !== userId);
  poll.votes.push({
    userId,
    optionNumber,
    votedAt: source === "gateway" ? at : null,
    observedAt: at,
    timestampSource: source,
    sequence: event.sequence,
  });

  return true;
}

function removeVote(poll, userId, optionNumber, source, at) {
  const previous = poll.votes.find((vote) => vote.userId === userId);

  if (
    !previous ||
    (optionNumber !== null && previous.optionNumber !== optionNumber)
  ) {
    return false;
  }

  nextEvent(
    poll,
    source === "gateway" ? "remove" : "recovered_remove",
    userId,
    previous.optionNumber,
    previous,
    source,
    at,
  );

  poll.votes = poll.votes.filter((vote) => vote.userId !== userId);
  return true;
}

function pollEmbed(poll, ended = false) {
  calculate(poll);

  const list = poll.options
    .map((option, index) => {
      const stats = poll.statistics.options[index];
      return (
        `${option.number}. ${option.emoji.discord}・${option.description}\n` +
        `   └ ${stats.votes} vote${stats.votes === 1 ? "" : "s"} ` +
        `(${stats.percentage.toFixed(1)}%)`
      );
    })
    .join("\n\n");

  const seconds = Math.floor(poll.endsAt.ms / 1000);
  const total = poll.statistics.totalVoters;

  const footer = ended
    ? `Poll closed・**${total}** voter${total === 1 ? "" : "s"}.`
    : `Ends <t:${seconds}:R> (<t:${seconds}:f>)\n` +
      `**${total}** voter${total === 1 ? "" : "s"}.`;

  return new EmbedBuilder()
    .setColor(ended ? 0x5865f2 : 0xf1c40f)
    .setTitle(ended ? "Friday Dress Code: Results" : "Friday Dress Code Poll")
    .setDescription(
      `${list}\n\n${
        ended ? "" : "**Choose your vote with the emojis below.**\n"
      }${footer}`,
    )
    .setTimestamp();
}

function resultsEmbed(poll) {
  calculate(poll);

  const winners = poll.options.filter((option) =>
    poll.statistics.winningOptionNumbers.includes(option.number),
  );

  const description = !winners.length
    ? "No votes were cast."
    : `${winners.length === 1 ? "**Winner:**" : "**Tie:**"}\n${winners
        .map((option) => `${option.number}. ${option.description}`)
        .join("\n")}`;

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Friday Dress Code: Final Results")
    .setDescription(description)
    .setFooter({
      text: `The poll has ended. Total voters: ${poll.votes.length}`,
    })
    .setTimestamp();
}

function scheduleEmbed(poll) {
  if (updateTimers.has(poll.id)) return;

  const timer = setTimeout(() => {
    updateTimers.delete(poll.id);

    serial(async () => {
      const runtime = live.get(poll.id);

      if (!runtime || poll.status !== "active") return;

      try {
        await runtime.message.edit({
          embeds: [pollEmbed(poll)],
        });
      } catch (error) {
        console.error(`[FDC] Embed update failed: ${poll.id}`, error);
      }
    }).catch(() => {});
  }, UPDATE_DELAY);

  timer.unref?.();
  updateTimers.set(poll.id, timer);
}

async function downloadWebp(url, destination) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(`Image download failed: HTTP ${response.status}`);
  }

  const declared = Number(response.headers.get("content-length") || 0);

  if (declared > MAX_IMAGE_BYTES) {
    await response.body?.cancel();
    throw new Error("An image exceeds the 30 MiB archive download limit.");
  }

  const chunks = [];
  let bytes = 0;

  for await (const chunk of response.body) {
    bytes += chunk.length;

    if (bytes > MAX_IMAGE_BYTES) {
      throw new Error("An image exceeds the 30 MiB archive download limit.");
    }

    chunks.push(chunk);
  }

  const output = await sharp(Buffer.concat(chunks), {
    animated: true,
  })
    .webp({ quality: 90, effort: 4 })
    .toBuffer({ resolveWithObject: true });

  const temporary = `${destination}.tmp`;
  await fs.writeFile(temporary, output.data);
  await fs.rename(temporary, destination);

  return {
    bytes: output.data.length,
    width: output.info.width,
    height: output.info.height,
    pages: output.info.pages ?? 1,
    format: "webp",
  };
}

async function fetchReactionUsers(message, poll) {
  const byUser = new Map();

  for (const option of poll.options) {
    const reaction = message.reactions.cache.find(
      (candidate) => emojiKey(candidate.emoji) === option.emoji.key,
    );

    if (!reaction) continue;

    /*
     * Fetch both normal and burst reaction users.
     * Duplicate users are merged into a Set.
     */
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

          if (!byUser.has(user.id)) byUser.set(user.id, new Set());
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

  return byUser;
}

async function reconcile(poll, message) {
  const byUser = await fetchReactionUsers(message, poll);
  const at = timestamp();
  let changed = false;

  /*
   * Preserve an existing selection when it still exists.
   * When an offline user reacted to several options with no surviving
   * stored selection, the lowest option number is the deterministic choice.
   */
  for (const vote of [...poll.votes]) {
    if (!byUser.has(vote.userId)) {
      changed = removeVote(poll, vote.userId, null, "recovery", at) || changed;
    }
  }

  for (const [userId, selections] of byUser) {
    const previous = poll.votes.find((vote) => vote.userId === userId);
    const selected =
      previous && selections.has(previous.optionNumber)
        ? previous.optionNumber
        : Math.min(...selections);

    changed = applyVote(poll, userId, selected, "recovery", at) || changed;

    for (const number of selections) {
      if (number === selected) continue;

      const option = poll.options.find((item) => item.number === number);
      const reaction = message.reactions.cache.find(
        (candidate) => emojiKey(candidate.emoji) === option.emoji.key,
      );

      try {
        await reaction?.users.remove(userId);
      } catch (error) {
        console.error("[FDC] Duplicate reaction removal failed:", error);
      }
    }
  }

  poll.lastReconciledAt = at;
  poll.lastRecoveryError = null;
  await persist(poll);

  if (changed && poll.status === "active") scheduleEmbed(poll);
}

async function closePoll(poll) {
  const runtime = live.get(poll.id);
  if (!runtime) return;

  if (!["active", "closing"].includes(poll.status)) return;

  const timer = updateTimers.get(poll.id);
  if (timer) clearTimeout(timer);
  updateTimers.delete(poll.id);

  poll.status = "closing";
  poll.closingStartedAt ??= timestamp();
  await persist(poll);

  await runtime.message.edit({
    embeds: [pollEmbed(poll, true)],
  });

  if (!poll.resultsMessageId) {
    /*
     * Stable nonce reduces duplicate result messages on a retry.
     * Discord's nonce deduplication is time-limited, not transactional.
     */
    const result = await runtime.channel.send({
      embeds: [resultsEmbed(poll)],
      nonce: poll.messageId,
      enforceNonce: true,
    });

    poll.resultsMessageId = result.id;
    poll.resultsSentAt = timestamp(result.createdTimestamp);
    await persist(poll);
  }

  poll.status = "closed";
  poll.closedAt = timestamp();
  await persist(poll);
  live.delete(poll.id);
}

async function recoverInternal(client) {
  for (const poll of records.values()) {
    if (!["active", "closing"].includes(poll.status)) continue;

    try {
      const channel = await client.channels.fetch(poll.channelId);

      if (!channel?.messages?.fetch || typeof channel.send !== "function") {
        throw new Error("The poll channel is unavailable.");
      }

      const message = await channel.messages.fetch(poll.messageId);
      live.set(poll.id, { message, channel });

      /*
       * A partially closed poll already has its final snapshot.
       * Do not recount late reactions while retrying its results message.
       */
      if (poll.status === "active") {
        await reconcile(poll, message);
      }

      if (poll.status === "closing" || poll.endsAt.ms <= Date.now()) {
        await closePoll(poll);
      } else {
        await message.edit({ embeds: [pollEmbed(poll)] });
      }

      console.log(`[FDC] Recovered ${poll.date}: ${poll.id}`);
    } catch (error) {
      poll.lastRecoveryError = {
        message: error.message,
        observedAt: timestamp(),
      };

      await persist(poll);
      console.error(`[FDC] Recovery failed for ${poll.id}:`, error);
    }
  }
}

async function handlePacket(client, packet, receivedAt) {
  const supported = new Set([
    "MESSAGE_REACTION_ADD",
    "MESSAGE_REACTION_REMOVE",
    "MESSAGE_REACTION_REMOVE_ALL",
    "MESSAGE_REACTION_REMOVE_EMOJI",
  ]);

  if (!supported.has(packet.t)) return;

  const payload = packet.d;
  const poll = records.get(payload.message_id);

  if (!poll || poll.status !== "active" || receivedAt >= poll.endsAt.ms) {
    return;
  }

  const at = timestamp(receivedAt);
  let changed = false;

  if (packet.t === "MESSAGE_REACTION_REMOVE_ALL") {
    for (const vote of [...poll.votes]) {
      changed = removeVote(poll, vote.userId, null, "gateway", at) || changed;
    }
  } else {
    const option = poll.options.find(
      (item) => item.emoji.key === emojiKey(payload.emoji),
    );

    if (!option) return;

    if (packet.t === "MESSAGE_REACTION_REMOVE_EMOJI") {
      for (const vote of [...poll.votes]) {
        if (vote.optionNumber !== option.number) continue;

        changed =
          removeVote(poll, vote.userId, option.number, "gateway", at) ||
          changed;
      }
    } else if (packet.t === "MESSAGE_REACTION_ADD") {
      const user =
        payload.member?.user ?? (await client.users.fetch(payload.user_id));

      if (user.bot) return;

      const previous = poll.votes.find(
        (vote) => vote.userId === payload.user_id,
      );

      changed = applyVote(poll, payload.user_id, option.number, "gateway", at);

      if (changed && previous && previous.optionNumber !== option.number) {
        const oldOption = poll.options.find(
          (item) => item.number === previous.optionNumber,
        );

        const reaction = live
          .get(poll.id)
          ?.message.reactions.cache.find(
            (candidate) => emojiKey(candidate.emoji) === oldOption.emoji.key,
          );

        try {
          await reaction?.users.remove(payload.user_id);
        } catch (error) {
          console.error("[FDC] Previous reaction removal failed:", error);
        }
      }
    } else {
      /*
       * Automatic removal of the old option does not remove the
       * new selection because its option number no longer matches.
       */
      changed = removeVote(poll, payload.user_id, option.number, "gateway", at);
    }
  }

  if (changed) {
    await persist(poll);
    scheduleEmbed(poll);
  }
}

function register(client) {
  if (registeredClient === client) return;
  if (registeredClient)
    throw new Error("FDC already registered on another client.");

  registeredClient = client;

  /*
   * Raw gateway packets also cover removals on recovered messages
   * without depending on a newly-created collector's collected cache.
   */
  client.on("raw", (packet) => {
    const receivedAt = Date.now();

    if (!packet.t?.startsWith("MESSAGE_REACTION_")) return;

    serial(async () => {
      await initialize();
      await handlePacket(client, packet, receivedAt);
    }).catch(() => {});
  });

  client.on("shardResume", () => {
    serial(async () => {
      await initialize();
      await recoverInternal(client);
    }).catch(() => {});
  });

  closingTimer = setInterval(() => {
    serial(async () => {
      await initialize();

      for (const poll of records.values()) {
        if (
          ["active", "closing"].includes(poll.status) &&
          poll.endsAt.ms <= Date.now() &&
          live.has(poll.id)
        ) {
          try {
            await closePoll(poll);
          } catch (error) {
            console.error(`[FDC] Closing failed for ${poll.id}:`, error);
          }
        }
      }
    }).catch(() => {});
  }, 1000);

  closingTimer.unref?.();
}

async function recover(client) {
  register(client);

  return serial(async () => {
    await initialize();
    await recoverInternal(client);
  });
}

async function create({
  client,
  interaction,
  channel,
  roleId,
  endsAt,
  endInput,
  options,
}) {
  register(client);

  /*
   * Reserve the date before downloads, while allowing existing polls'
   * reaction writes to continue during image conversion.
   */
  const date = dateKey(endsAt.getTime());
  const folder = path.join(ROOT, date);

  await serial(async () => {
    await initialize();

    if (
      reservedDates.has(date) ||
      [...records.values()].some((poll) => poll.date === date)
    ) {
      throw new Error(`An FDC archive already exists for ${date}.`);
    }

    try {
      await fs.access(folder);
      throw new Error(
        `The archive directory ${date} already exists. ` +
          "Check it before creating another poll for that date.",
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    reservedDates.add(date);
    await fs.mkdir(folder);
  });

  let mediaMessage;
  let pollMessage;
  let archived = false;

  try {
    const savedOptions = [];

    for (const option of options) {
      const localFile = `${option.number}.webp`;
      const image = await downloadWebp(
        option.media.url,
        path.join(folder, localFile),
      );

      savedOptions.push({
        number: option.number,
        description: option.description,
        emoji: option.emoji,
        media: {
          originalAttachmentId: option.media.id,
          originalName: option.media.name,
          originalUrl: option.media.url,
          originalProxyUrl: option.media.proxyURL,
          originalContentType: option.media.contentType,
          originalSize: option.media.size,
          originalWidth: option.media.width,
          originalHeight: option.media.height,
          localFile,
          savedAt: timestamp(),
          ...image,
        },
      });
    }

    if (endsAt.getTime() <= Date.now()) {
      throw new Error("The selected end time passed during image processing.");
    }

    /*
     * Send the original media to Discord; retain converted WebP copies
     * locally. Discord upload limits therefore stay unchanged.
     */
    mediaMessage = await channel.send({
      content: "Options:",
      files: options.map((option) => ({
        attachment: option.media.url,
        name: `${option.number}-${option.media.name ?? "media"}`,
      })),
    });

    const poll = {
      version: 1,
      id: interaction.id,
      date,
      timeZone: TIME_ZONE,
      status: "creating",
      guildId: interaction.guildId,
      channelId: channel.id,
      senderUserId: interaction.user.id,
      interactionId: interaction.id,
      roleId,
      commandName: "fdc",
      createdAt: timestamp(interaction.createdTimestamp),
      sentAt: null,
      mediaSentAt: timestamp(mediaMessage.createdTimestamp),
      endsAt: timestamp(endsAt.getTime()),
      originalEndInput: endInput,
      closedAt: null,
      closingStartedAt: null,
      resultsSentAt: null,
      messageId: null,
      messageUrl: null,
      mediaMessageId: mediaMessage.id,
      resultsMessageId: null,
      options: savedOptions,
      votes: [],
      voteHistory: [],
      lastSequence: 0,
      lastReconciledAt: null,
      lastRecoveryError: null,
      updatedAt: timestamp(),
      statistics: null,
    };

    pollMessage = await channel.send({
      content: `<@&${roleId}>・Vote for The FDC! :D`,
      allowedMentions: { roles: [roleId] },
      embeds: [pollEmbed(poll)],
    });

    poll.id = pollMessage.id;
    poll.messageId = pollMessage.id;
    poll.messageUrl = pollMessage.url;
    poll.sentAt = timestamp(pollMessage.createdTimestamp);

    await serial(async () => {
      poll.status = "active";
      live.set(poll.id, { message: pollMessage, channel });

      /*
       * The archive is durable before initial reactions are added.
       * If setup fails afterward, the failed poll remains archived.
       */
      archived = true;
      await persist(poll);
    });

    try {
      for (const option of savedOptions) {
        await pollMessage.react(option.emoji.reaction);
      }
    } catch (error) {
      await serial(async () => {
        poll.status = "failed";
        poll.failure = {
          message: error.message,
          observedAt: timestamp(),
        };
        live.delete(poll.id);
        await persist(poll);
      });

      throw new Error(
        "The poll was archived, but initial reactions failed. " +
          "Check reaction permissions and emoji availability.",
      );
    }

    return poll;
  } catch (error) {
    if (!archived) {
      await pollMessage?.delete().catch(() => {});
      await mediaMessage?.delete().catch(() => {});
      await fs.rm(folder, { recursive: true, force: true }).catch(() => {});
    }

    throw error;
  } finally {
    reservedDates.delete(date);
  }
}

module.exports = {
  create,
  recover,
};
