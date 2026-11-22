#!/usr/bin/env node
require("dotenv").config();

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const readline = require("node:readline");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const Database = require("better-sqlite3");

const backup = require("../server/services/backup.cjs");
const totp = require("../server/services/totp.cjs");
const { createActivityLog } = require("../server/services/activityLog.cjs");

const REPO_ROOT = path.resolve(__dirname, "..");
const DB_DIR = path.join(REPO_ROOT, "server", "services", "db");
const ACCOUNTS_DB_PATH = path.join(DB_DIR, "accounts.sqlite");
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a ?? ""), "utf8");
  const bufB = Buffer.from(String(b ?? ""), "utf8");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function promptLine(question, { mask = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: Boolean(process.stdin.isTTY),
    });

    if (mask && process.stdin.isTTY) {
      rl._writeToOutput = function writeMasked(str) {
        if (str.startsWith(question)) {
          rl.output.write(
            question + "*".repeat(Math.max(0, str.length - question.length)),
          );
        } else if (str === "\r\n" || str === "\n" || str === "\r") {
          rl.output.write(str);
        }
      };
    }

    rl.question(question, (answer) => {
      rl.close();
      if (mask && process.stdin.isTTY) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function downloadBackupToTemp(urlString) {
  await fsp.mkdir(backup.WORK_DIR, { recursive: true, mode: 0o700 });
  const tempPath = path.join(
    backup.WORK_DIR,
    `download-${crypto.randomUUID()}.tar.gz.enc`,
  );

  const response = await fetch(urlString, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(
      `Download failed with HTTP ${response.status} ${response.statusText}`,
    );
  }

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(
      `Remote backup exceeds the ${MAX_DOWNLOAD_BYTES} byte limit.`,
    );
  }

  if (!response.body) {
    throw new Error("Remote response had an empty body.");
  }

  let downloaded = 0;
  const meter = new TransformStream({
    transform(chunk, controller) {
      downloaded += chunk.byteLength;
      if (downloaded > MAX_DOWNLOAD_BYTES) {
        controller.error(
          new Error("Remote backup download exceeded the maximum size limit."),
        );
        return;
      }
      controller.enqueue(chunk);
    },
  });

  const outStream = fs.createWriteStream(tempPath, { mode: 0o600 });
  try {
    const nodeStream = Readable.fromWeb(response.body.pipeThrough(meter));
    await pipeline(nodeStream, outStream);
  } catch (err) {
    outStream.destroy();
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    throw err;
  }

  return tempPath;
}

function usage() {
  console.log(
    "Usage: pnpm backup:import <path-or-url> [--restore|--merge] [--yes]",
  );
  console.log(
    "  <path-or-url>  Local .tar.gz.enc file path or http(s):// download URL",
  );
  console.log(
    "  --merge        Merge backup with local data using newest/merge defaults (default)",
  );
  console.log("  --restore      Restore backup state over local data");
  console.log("  --yes          Skip final confirmation prompt");
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("--help") || args.includes("-h")) {
    usage();
    process.exit(args.length ? 0 : 1);
  }

  const sourceArg = args.find((arg) => !arg.startsWith("--"));
  const strategy = args.includes("--restore") ? "restore" : "merge";
  const autoConfirm = args.includes("--yes");

  if (!sourceArg) {
    usage();
    process.exit(1);
  }

  const fromUrl = isHttpUrl(sourceArg);
  if (!fromUrl) {
    const localCheck = path.resolve(process.cwd(), sourceArg);
    if (!fs.existsSync(localCheck) || !fs.statSync(localCheck).isFile()) {
      console.error(`Backup file not found: ${localCheck}`);
      process.exit(1);
    }
  }

  // 1. Verify Admin Key
  const configuredAdminKey = String(process.env.ADMIN_KEY ?? "").trim();
  if (!configuredAdminKey) {
    console.error("ADMIN_KEY is not set in .env.");
    process.exit(1);
  }

  const enteredAdminKey = await promptLine("Admin key: ", { mask: true });
  if (!timingSafeEqualStr(enteredAdminKey, configuredAdminKey)) {
    console.error("Invalid admin key.");
    process.exit(1);
  }

  // 2. Verify 2FA if ADMIN_2FA=on
  const twoFaEnabled =
    String(process.env.ADMIN_2FA ?? "")
      .trim()
      .toLowerCase() === "on";
  if (twoFaEnabled) {
    const code = await promptLine("2FA code: ");
    if (typeof totp.checkTwoFactor === "function") {
      await totp.checkTwoFactor(code, "backup-import", [`cli:${process.pid}`]);
    } else if (typeof totp.verifyCode === "function") {
      const ok = totp.verifyCode(process.env.ADMIN_2FA_SECRET, code);
      if (!ok) {
        console.error("Invalid 2FA code.");
        process.exit(1);
      }
    } else {
      console.error(
        "2FA is enabled, but no verification helper was found in server/services/totp.cjs.",
      );
      process.exit(1);
    }
  }

  // 3. Download if URL, then analyze & apply
  let archivePath = path.resolve(process.cwd(), sourceArg);
  let downloadedTempPath = null;
  let localDb = null;

  try {
    if (fromUrl) {
      console.log(`Downloading backup from ${sourceArg}...`);
      downloadedTempPath = await downloadBackupToTemp(sourceArg);
      archivePath = downloadedTempPath;
    }

    localDb = fs.existsSync(ACCOUNTS_DB_PATH)
      ? new Database(ACCOUNTS_DB_PATH)
      : null;
    const activity = createActivityLog(DB_DIR);

    console.log(
      `\nAnalyzing ${fromUrl ? sourceArg : path.basename(archivePath)}...`,
    );
    const plan = await backup.analyzeImport({
      archive: archivePath,
      password: backup.passwordFor(enteredAdminKey),
      localDb,
    });

    const changedUnits = plan.units.filter((u) => u.status !== "identical");
    console.log(
      `- Manifest files: ${plan.manifest.files} (exported ${plan.manifest.exportedAt ? new Date(plan.manifest.exportedAt).toISOString() : "unknown"})`,
    );
    console.log(
      `- File units differing/new: ${changedUnits.length} of ${plan.units.length}`,
    );
    if (plan.accounts) {
      console.log(
        `- Accounts in backup: ${plan.accounts.users.length} (local-only: ${plan.accounts.localOnly.length})`,
      );
    }
    if (plan.env) {
      const envDiffs = plan.env.filter(
        (e) => e.status === "differs" || e.status === "backup-only",
      );
      console.log(`- .env keys to add/update: ${envDiffs.length}`);
    }
    if (plan.activity) {
      console.log(`- Activity log status: ${plan.activity.status}`);
    }

    if (!autoConfirm) {
      const confirm = await promptLine(
        `\nApply backup using "${strategy}" strategy? [y/N]: `,
      );
      if (!/^y(es)?$/i.test(confirm)) {
        console.log("Import cancelled.");
        await backup.cleanupStaging();
        process.exit(0);
      }
    }

    console.log("Creating safety backup & applying import...");
    const report = await backup.applyImport({
      planId: plan.id,
      adminKey: enteredAdminKey,
      localDb,
      choices: { strategy },
      activity,
    });

    activity?.log?.("admin.backup.import.cli", {
      actor: "cli",
      source: fromUrl ? "url" : "file",
      strategy,
      filesWritten: report.filesWritten,
      filesMerged: report.filesMerged.length,
      usersAdded: report.usersAdded,
      usersMerged: report.usersMerged,
    });

    console.log("\nImport complete:");
    console.log(`- Safety backup saved: ${report.safetyBackup}`);
    console.log(
      `- Files written: ${report.filesWritten}, merged: ${report.filesMerged.length}`,
    );
    console.log(
      `- Users added: ${report.usersAdded}, merged: ${report.usersMerged}, skipped: ${report.usersSkipped}`,
    );
    if (report.envChanged.length) {
      console.log(`- .env keys updated: ${report.envChanged.join(", ")}`);
    }
    if (report.activityLog) {
      console.log(`- Activity log: ${report.activityLog}`);
    }
    console.log(
      "\nNote: Restart the backend services (bot, accounts, discord) so they pick up all imported files.",
    );
  } finally {
    localDb?.close();
    if (downloadedTempPath) {
      await fsp.rm(downloadedTempPath, { force: true }).catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error("Backup import failed:", err?.message || err);
  process.exit(1);
});
