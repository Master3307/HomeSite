/*
 * Converts archived FDC polls (server/services/db/fdc-polls) to their public
 * shape, without voter identities. Used by scripts/export-fdc.cjs for the
 * static export and by the account API for live data.
 */

function validTimestamp(value) {
  const ms =
    typeof value === "number"
      ? value
      : typeof value?.ms === "number"
        ? value.ms
        : Date.parse(value?.iso ?? value);

  if (!Number.isFinite(ms)) return null;

  return {
    iso: new Date(ms).toISOString(),
    ms,
  };
}

function cleanStatistics(statistics, options) {
  const supplied = Array.isArray(statistics?.options) ? statistics.options : [];

  const counts = options.map((option) => {
    const entry = supplied.find((item) => item.optionNumber === option.number);

    return {
      optionNumber: option.number,
      votes: Math.max(0, Number(entry?.votes) || 0),
    };
  });

  const total = Number.isFinite(statistics?.totalVoters)
    ? Math.max(0, statistics.totalVoters)
    : counts.reduce((sum, entry) => sum + entry.votes, 0);

  const highest = Math.max(0, ...counts.map((entry) => entry.votes));

  return {
    totalVoters: total,

    options: counts.map((entry) => ({
      ...entry,
      percentage: total ? Number(((entry.votes / total) * 100).toFixed(2)) : 0,
    })),

    winningOptionNumbers: total
      ? counts
          .filter((entry) => entry.votes === highest)
          .map((entry) => entry.optionNumber)
      : [],

    isTie:
      total > 0 && counts.filter((entry) => entry.votes === highest).length > 1,
  };
}

function publicOptions(poll, date) {
  return poll.options.map((option) => {
    if (
      !Number.isInteger(option.number) ||
      option.number < 1 ||
      option.number > 6
    ) {
      throw new Error(`Invalid option number in ${date}.`);
    }

    const id = /^\d{17,20}$/.test(option.emoji?.id ?? "")
      ? option.emoji.id
      : null;

    return {
      number: option.number,
      description: String(option.description ?? ""),

      emoji: {
        display: String(option.emoji?.display ?? ""),
        name: option.emoji?.name ?? null,
        id,
        animated: Boolean(option.emoji?.animated),
      },

      // null: no image (some past FDCs only have a name).
      image: option.media === null ? null : `${option.number}.webp`,
      // Bumped when an editor replaces the image (cache busting).
      imageVersion: Number.isInteger(option.media?.revision) ? option.media.revision : 0,
    };
  });
}

/* Votes editors entered from elsewhere (e.g. the Steam group chat). */
function externalVotes(poll) {
  const sources = Object.entries(poll.externalVotes ?? {}).map(([id, source]) => {
    const counts = {};
    let total = 0;
    for (const [number, count] of Object.entries(source.counts ?? {})) {
      const value = Math.max(0, Math.floor(Number(count) || 0));
      if (!value) continue;
      counts[number] = value;
      total += value;
    }
    return { id, label: String(source.label ?? id), counts, total };
  });
  return { sources, total: sources.reduce((sum, source) => sum + source.total, 0) };
}

function withExternal(results, external) {
  if (!external.total) return results;
  const options = (results?.options ?? []).map((entry) => {
    const extra = external.sources.reduce((sum, source) => sum + (source.counts[entry.optionNumber] ?? 0), 0);
    return { ...entry, votes: (Number(entry.votes) || 0) + extra };
  });
  return {
    ...results,
    options,
    totalVoters: (Number(results?.totalVoters) || 0) + external.total,
  };
}

/** The public poll document for an archived poll stored under `date`. */
function toPublicPoll(poll, date) {
  if (!poll?.id || !Array.isArray(poll.options) || !poll.options.length) {
    throw new Error(`Invalid poll: ${date}/data.json`);
  }

  const options = publicOptions(poll, date);

  /*
   * Imported closed polls retain their original official results.
   * Live/new polls use the archive's current statistics.
   */
  const useOfficialResults =
    poll.status === "closed" && poll.officialResults?.final === true;

  const external = externalVotes(poll);

  // Archive statistics already include external votes (fdcArchive calculate);
  // official (imported) results don't, so they're added here.
  // Without saved statistics (e.g. written by a script): votes + external.
  const computed = () =>
    withExternal(
      {
        totalVoters: (poll.votes ?? []).length,
        options: options.map((option) => ({
          optionNumber: option.number,
          votes: (poll.votes ?? []).filter((vote) => vote.optionNumber === option.number).length,
        })),
      },
      external,
    );

  let statistics = cleanStatistics(
    useOfficialResults ? withExternal(poll.officialResults, external) : (poll.statistics ?? computed()),
    options,
  );

  // Past FDCs where only the winner is known (no vote counts survived).
  const votesKnown = !(useOfficialResults && poll.officialResults.votesKnown === false);
  if (!votesKnown) {
    statistics = {
      ...statistics,
      winningOptionNumbers: (poll.officialResults.winningOptionNumbers ?? []).filter((number) =>
        options.some((option) => option.number === number),
      ),
      isTie: false,
    };
  }

  return {
    version: 1,
    id: String(poll.id),
    date,
    status: poll.status,
    timeZone: poll.timeZone ?? "Europe/Berlin",
    sentAt: validTimestamp(poll.sentAt ?? poll.createdAt),
    endsAt: validTimestamp(poll.endsAt),
    closedAt: validTimestamp(poll.closedAt),
    updatedAt: validTimestamp(poll.updatedAt),
    messageUrl: typeof poll.messageUrl === "string" ? poll.messageUrl : null,
    options,
    statistics,

    externalVotes: external.sources,
    votesKnown,

    statisticsSource: useOfficialResults
      ? "historical_official_results"
      : "archive_statistics",

    endTimestampSource: poll.importMetadata?.endTimestampSource ?? "scheduled",
  };
}

/** The summary list entry for a public poll. */
function toSummaryEntry(publicPoll) {
  return {
    id: publicPoll.id,
    date: publicPoll.date,
    status: publicPoll.status,
    sentAt: publicPoll.sentAt,
    endsAt: publicPoll.endsAt,
    closedAt: publicPoll.closedAt,
    totalVoters: publicPoll.statistics.totalVoters,
    dataFile: `${publicPoll.date}/data.json`,
  };
}

function buildPublicSummary(sourceSummary, entries) {
  const polls = [...entries].sort(
    (a, b) => (b.sentAt?.ms ?? 0) - (a.sentAt?.ms ?? 0),
  );

  return {
    version: 1,
    exportedAt: validTimestamp(Date.now()),
    totalFdcCount: sourceSummary?.totalFdcCount ?? polls.length,
    archivedPollCount: polls.length,
    latestPoll: polls[0] ?? null,
    polls,
  };
}

module.exports = {
  validTimestamp,
  cleanStatistics,
  toPublicPoll,
  toSummaryEntry,
  buildPublicSummary,
};
