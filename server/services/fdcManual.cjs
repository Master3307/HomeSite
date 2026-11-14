const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const sharp = require("sharp");

/*
 * Builds an archive entry for an FDC that only exists elsewhere, e.g. the
 * oldest ones from the Steam group chat (Steam has no API for chat polls).
 * Used by the website form (fdcArchive.createManual, via the bot) and by
 * `pnpm fdc:import --manifest` (no Discord needed).
 *
 * Votes are stored as votes from elsewhere (`externalVotes`), with a label
 * such as "Steam group", so they show like any other outside votes.
 */

const DISCORD_EPOCH = 1420070400000n;
// One option is enough when only the winner is known (the rest was lost).
const MIN_OPTIONS = 1;
const MAX_OPTIONS = 6;
const MAX_DESCRIPTION_LENGTH = 400;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

const stamp = (ms) => ({ iso: new Date(ms).toISOString(), ms });

/* A Discord-style id (sortable by time), so poll routes accept it like any other. */
function manualId(ms) {
  const time = (BigInt(Math.floor(ms)) - DISCORD_EPOCH) << 22n;
  return String(time | BigInt(crypto.randomInt(0, 1 << 22)));
}

function sourceId(label) {
  return (
    String(label ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "elsewhere"
  );
}

async function saveImage(buffer, destination) {
  const output = await sharp(buffer, { animated: true })
    .webp({ quality: 90, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  await fs.writeFile(destination, output.data);
  return {
    format: "webp",
    bytes: output.data.length,
    width: output.info.width,
    height: output.info.height,
    pages: output.info.pages ?? 1,
  };
}

/* Results from the external votes (manual polls have no Discord votes). */
function statisticsFrom(options, externalVotes) {
  const counts = options.map((option) =>
    Object.values(externalVotes).reduce((sum, source) => sum + (source.counts[option.number] ?? 0), 0),
  );
  const total = counts.reduce((sum, count) => sum + count, 0);
  const highest = Math.max(0, ...counts);
  return {
    totalVoters: total,
    externalVoters: total,
    options: options.map((option, index) => ({
      optionNumber: option.number,
      votes: counts[index],
      percentage: total ? Number(((counts[index] / total) * 100).toFixed(2)) : 0,
    })),
    winningOptionNumbers: total ? options.filter((_, index) => counts[index] === highest).map((option) => option.number) : [],
    isTie: total > 0 && counts.filter((count) => count === highest).length > 1,
  };
}

/**
 * `input`: {
 *   date, folder, timeZone, endsAt (Date), question?, creatorId?, via,
 *   options: [{ description, emoji (archive shape), media: { buffer, name, contentType } }],
 *   votes?: { label, counts: { [number]: count } },
 *   winner?: number   (only the winner is known: no vote counts)
 *   note?
 * }
 * Writes `<n>.webp` into `folder` and returns the poll record (also saved
 * as data.json).
 */
async function buildManualPoll(input) {
  const options = Array.isArray(input.options) ? input.options : [];
  if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
    throw httpError(400, `An FDC needs ${MIN_OPTIONS}–${MAX_OPTIONS} options.`);
  }
  if (!(input.endsAt instanceof Date) || Number.isNaN(input.endsAt.getTime())) {
    throw httpError(400, "Pick the day the FDC ended.");
  }

  const now = Date.now();
  const savedOptions = [];

  for (const [index, option] of options.entries()) {
    const number = index + 1;
    // Old Steam polls often lack a name, an emoji or even the image: all
    // optional, but an option without an image needs a name.
    const description = String(option.description ?? "").trim();
    if (description.length > MAX_DESCRIPTION_LENGTH) throw httpError(400, `Option ${number}'s name is too long.`);
    const hasImage = Boolean(option.media?.buffer?.length);
    if (!hasImage && !description) throw httpError(400, `Option ${number} needs an image or a name.`);

    if (!hasImage) {
      savedOptions.push({ number, description, emoji: option.emoji?.key ? option.emoji : null, media: null });
      continue;
    }

    const localFile = `${number}.webp`;
    const image = await saveImage(option.media.buffer, path.join(input.folder, localFile)).catch(() => {
      throw httpError(400, `Option ${number}'s image could not be read.`);
    });

    savedOptions.push({
      number,
      description,
      emoji: option.emoji?.key ? option.emoji : null,
      media: {
        originalAttachmentId: null,
        originalName: option.media.name ?? null,
        originalUrl: null,
        originalProxyUrl: null,
        originalContentType: option.media.contentType ?? null,
        originalSize: option.media.buffer.length,
        originalWidth: null,
        originalHeight: null,
        localFile,
        savedAt: stamp(now),
        ...image,
      },
    });
  }

  const keys = savedOptions.map((option) => option.emoji?.key).filter(Boolean);
  if (new Set(keys).size !== keys.length) throw httpError(400, "Each option needs a different emoji.");

  // Only the winner known: no counts at all. A single option is the winner.
  const winner =
    input.winner !== undefined && input.winner !== null && input.winner !== ""
      ? Number(input.winner)
      : !input.votes && savedOptions.length === 1
        ? 1
        : null;
  if (winner !== null && !savedOptions.some((option) => option.number === winner)) {
    throw httpError(400, "Pick which option won.");
  }

  const externalVotes = {};
  if (input.votes && winner === null) {
    const counts = {};
    for (const option of savedOptions) {
      const value = Number(input.votes.counts?.[option.number] ?? 0);
      if (!Number.isInteger(value) || value < 0 || value > 10000) {
        throw httpError(400, `Option ${option.number} needs a whole number of votes.`);
      }
      if (value) counts[option.number] = value;
    }
    const label = String(input.votes.label ?? "Steam group").trim().slice(0, 40) || "Steam group";
    externalVotes[sourceId(label)] = { label, counts, updatedAt: stamp(now), updatedBy: input.creatorId ?? null };
  }

  const endMs = input.endsAt.getTime();
  const poll = {
    version: 1,
    id: manualId(endMs),
    date: input.date,
    timeZone: input.timeZone ?? "Europe/Berlin",
    status: "closed",
    guildId: null,
    channelId: null,
    senderUserId: input.creatorId ?? null,
    interactionId: null,
    roleId: null,
    commandName: "manual",
    createdVia: input.via ?? "manual",
    createdAt: stamp(endMs),
    sentAt: stamp(endMs),
    mediaSentAt: null,
    endsAt: stamp(endMs),
    originalEndInput: null,
    closedAt: stamp(endMs),
    closingStartedAt: null,
    resultsSentAt: null,
    messageId: null,
    messageUrl: null,
    mediaMessageId: null,
    resultsMessageId: null,
    question: input.question ? String(input.question).trim().slice(0, 300) : null,
    note: input.note ? String(input.note).trim().slice(0, 500) : null,
    options: savedOptions,
    votes: [],
    voteHistory: [],
    lastSequence: 0,
    lastReconciledAt: null,
    lastRecoveryError: null,
    updatedAt: stamp(now),
    statistics: statisticsFrom(savedOptions, externalVotes),
    externalVotes,
    ...(winner !== null
      ? {
          officialResults: {
            source: "manual_winner_only",
            final: true,
            votesKnown: false,
            totalVoters: 0,
            options: savedOptions.map((option) => ({ optionNumber: option.number, votes: 0, percentage: 0 })),
            winningOptionNumbers: [winner],
            isTie: false,
          },
        }
      : {}),
    importMetadata: {
      importedAt: stamp(now),
      source: input.via === "manifest" ? "manual_manifest" : "manual_website",
      addedBy: input.creatorId ?? null,
      warnings: [],
    },
  };

  await fs.writeFile(path.join(input.folder, "data.json"), `${JSON.stringify(poll, null, 2)}\n`, "utf8");
  return poll;
}

module.exports = { buildManualPoll, manualId, sourceId };
