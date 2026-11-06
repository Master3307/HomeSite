const fs = require("node:fs/promises");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");

const SOURCE = path.join(PROJECT_ROOT, "server", "services", "db", "fdc-polls");

const OUTPUT_ROOT = path.join(
  PROJECT_ROOT,
  process.argv.includes("--dist") ? "dist" : "public",
);

const DESTINATION = path.join(OUTPUT_ROOT, "fdc-polls");

const STAGING = path.join(OUTPUT_ROOT, ".fdc-polls-export");

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

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  await fs.access(SOURCE);

  const sourceSummary = JSON.parse(
    await fs.readFile(path.join(SOURCE, "summary.json"), "utf8"),
  );

  await fs.mkdir(path.dirname(DESTINATION), {
    recursive: true,
  });

  await fs.rm(STAGING, {
    recursive: true,
    force: true,
  });

  await fs.mkdir(STAGING);

  const polls = [];

  try {
    const directories = await fs.readdir(SOURCE, {
      withFileTypes: true,
    });

    for (const directory of directories) {
      if (
        !directory.isDirectory() ||
        !/^\d{4}-\d{2}-\d{2}$/.test(directory.name)
      ) {
        continue;
      }

      const sourceFolder = path.join(SOURCE, directory.name);

      const poll = JSON.parse(
        await fs.readFile(path.join(sourceFolder, "data.json"), "utf8"),
      );

      if (!poll.id || !Array.isArray(poll.options) || !poll.options.length) {
        throw new Error(`Invalid poll: ${directory.name}/data.json`);
      }

      const targetFolder = path.join(STAGING, directory.name);

      await fs.mkdir(targetFolder);

      const options = [];

      for (const option of poll.options) {
        if (
          !Number.isInteger(option.number) ||
          option.number < 1 ||
          option.number > 6
        ) {
          throw new Error(`Invalid option number in ${directory.name}.`);
        }

        const imageName = `${option.number}.webp`;

        await fs.copyFile(
          path.join(sourceFolder, imageName),
          path.join(targetFolder, imageName),
        );

        options.push({
          number: option.number,
          description: String(option.description ?? ""),

          emoji: {
            display: String(option.emoji?.display ?? ""),
            name: option.emoji?.name ?? null,
            animated: Boolean(option.emoji?.animated),
          },

          image: imageName,
        });
      }

      /*
       * Imported closed polls retain their original official results.
       * Live/new polls use the archive's current statistics.
       */
      const useOfficialResults =
        poll.status === "closed" && poll.officialResults?.final === true;

      const statistics = cleanStatistics(
        useOfficialResults ? poll.officialResults : poll.statistics,
        options,
      );

      const publicPoll = {
        version: 1,
        id: String(poll.id),
        date: directory.name,
        status: poll.status,
        timeZone: poll.timeZone ?? "Europe/Berlin",
        sentAt: validTimestamp(poll.sentAt ?? poll.createdAt),
        endsAt: validTimestamp(poll.endsAt),
        closedAt: validTimestamp(poll.closedAt),
        updatedAt: validTimestamp(poll.updatedAt),
        options,
        statistics,

        statisticsSource: useOfficialResults
          ? "historical_official_results"
          : "archive_statistics",

        endTimestampSource:
          poll.importMetadata?.endTimestampSource ?? "scheduled",
      };

      await writeJson(path.join(targetFolder, "data.json"), publicPoll);

      polls.push({
        id: publicPoll.id,
        date: publicPoll.date,
        status: publicPoll.status,
        sentAt: publicPoll.sentAt,
        endsAt: publicPoll.endsAt,
        closedAt: publicPoll.closedAt,
        totalVoters: statistics.totalVoters,
        dataFile: `${directory.name}/data.json`,
      });
    }

    polls.sort((a, b) => (b.sentAt?.ms ?? 0) - (a.sentAt?.ms ?? 0));

    await writeJson(path.join(STAGING, "summary.json"), {
      version: 1,
      exportedAt: {
        iso: new Date().toISOString(),
        ms: Date.now(),
      },
      totalFdcCount: sourceSummary.totalFdcCount,
      archivedPollCount: polls.length,
      latestPoll: polls[0] ?? null,
      polls,
    });

    await fs.rm(DESTINATION, {
      recursive: true,
      force: true,
    });

    await fs.rename(STAGING, DESTINATION);

    console.log(
      `[FDC export] Published ${polls.length} polls without voter identities.`,
    );
  } catch (error) {
    await fs.rm(STAGING, {
      recursive: true,
      force: true,
    });

    throw error;
  }
}

main().catch((error) => {
  console.error("[FDC export] Failed:", error);
  process.exitCode = 1;
});
