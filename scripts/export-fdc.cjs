const fs = require("node:fs/promises");
const path = require("node:path");

const {
  toPublicPoll,
  toSummaryEntry,
  buildPublicSummary,
} = require("../server/services/fdcPublic.cjs");

const PROJECT_ROOT = path.resolve(__dirname, "..");

const SOURCE = process.env.FDC_ARCHIVE_DIR
  ? path.resolve(process.env.FDC_ARCHIVE_DIR)
  : path.join(PROJECT_ROOT, "server", "services", "db", "fdc-polls");

const OUTPUT_ROOT = path.join(
  PROJECT_ROOT,
  process.argv.includes("--dist") ? "dist" : "public",
);

const DESTINATION = path.join(OUTPUT_ROOT, "fdc-polls");

const STAGING = path.join(OUTPUT_ROOT, ".fdc-polls-export");

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  try {
    await fs.access(SOURCE);
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log("[FDC export] Source directory does not exist; skipping.");
      return;
    }

    throw error;
  }

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

      const publicPoll = toPublicPoll(poll, directory.name);
      const targetFolder = path.join(STAGING, directory.name);

      await fs.mkdir(targetFolder);

      for (const option of publicPoll.options) {
        if (!option.image) continue; // past FDC option without an image
        await fs.copyFile(
          path.join(sourceFolder, option.image),
          path.join(targetFolder, option.image),
        );
      }

      await writeJson(path.join(targetFolder, "data.json"), publicPoll);

      polls.push(toSummaryEntry(publicPoll));
    }

    await writeJson(
      path.join(STAGING, "summary.json"),
      buildPublicSummary(sourceSummary, polls),
    );

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
