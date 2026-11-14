const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn, execFile } = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const settingsSchema = require("../../config/settings.cjs");

/*
 * Full backups of everything that is not in git: the databases and data
 * files (server/services/db), avatars, logs, .env and other untracked or
 * ignored files that users, editors and the bots create.
 *
 * Archive: a normal Linux tar.gz, encrypted exactly like
 *   openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -md sha256
 * with the password "admin:<admin key>", so it can be opened anywhere:
 *
 *   openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 \
 *     -pass 'pass:admin:KEY' -in backup.tar.gz.enc | tar -xz
 *
 * Inside: manifest.json (format, export time, every file with size,
 * SHA-256 and local creation time) and files/<path>. The checksums catch a
 * damaged or tampered archive.
 *
 * db/backup-file-times.json keeps the local creation time of every backed
 * up file (shipped in the archive too); imports use it to decide which
 * version of a file is newer.
 *
 * KEEP THIS UP TO DATE: new data files or folders written at runtime must be
 * covered here (see CLAUDE.md). Anything git doesn't track is included
 * automatically, minus EXCLUDED below.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DB_DIR = path.join(__dirname, "db");
const TIMES_INDEX = path.join(DB_DIR, "backup-file-times.json");
const BACKUP_DIR = path.join(DB_DIR, "backups");
const WORK_DIR = path.join(DB_DIR, ".backup-work");
const ACCOUNTS_DB = "server/services/db/accounts.sqlite";
const ACTIVITY_LOG = "server/services/db/activity-log.jsonl";

const FORMAT = "homesite-backup";
const FORMAT_VERSION = 1;
const PBKDF2_ITERATIONS = 600_000;
const MAGIC = Buffer.from("Salted__");
const KEEP_SAFETY_BACKUPS = 5;
const STAGING_TTL_MS = 60 * 60 * 1000;

// Never backed up: dependencies, builds, generated files, the backups themselves.
const EXCLUDED = [
  ".git/",
  "node_modules/",
  "server/node_modules/",
  ".pnpm-store/",
  "dist/",
  "dist-ssr/",
  ".vite/",
  "public/search-index.json",
  "public/sitemap.xml",
  "public/fdc-polls/",
  "server/services/db/backups/",
  "server/services/db/.backup-work/",
  "server/services/db/fdc-polls/.import.lock",
  "server/services/db/accounts.sqlite-wal",
  "server/services/db/accounts.sqlite-shm",
  // Hub logins: they belong to this server only.
  "server/services/db/hub-sessions.json",
  // The hub's live activity feed (last 7 days, rebuilt by itself).
  "server/services/db/hub-live.jsonl",
];

// Used when git isn't available.
const FALLBACK_PATHS = [
  ".env",
  ".logs",
  "note.md",
  "public/lobby-code.json",
  "server/services/avatars",
  "server/services/db",
];

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

const toPosix = (value) => value.split(path.sep).join("/");

function isExcluded(rel) {
  if (rel.endsWith(".tmp") || /\.tmp$|\.[0-9a-f-]{36}\.tmp$/.test(rel)) return true;
  return EXCLUDED.some((entry) => (entry.endsWith("/") ? rel.startsWith(entry) : rel === entry));
}

/* A path inside the repository (no "..", no absolute paths). */
function safeJoin(rel) {
  const target = path.resolve(REPO_ROOT, rel);
  if (target !== REPO_ROOT && !target.startsWith(REPO_ROOT + path.sep)) {
    throw httpError(400, `Unsafe path in backup: ${rel}`);
  }
  return target;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024, ...options }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    );
  });
}

async function walk(rel) {
  const absolute = safeJoin(rel);
  const stat = await fs.lstat(absolute).catch(() => null);
  if (!stat) return [];
  if (stat.isFile()) return [rel];
  if (!stat.isDirectory()) return [];
  const out = [];
  for (const entry of await fs.readdir(absolute)) out.push(...(await walk(path.posix.join(rel, entry))));
  return out;
}

/** Every file to back up (relative POSIX paths), sorted. */
async function listFiles() {
  let paths = [];
  try {
    const untracked = await run("git", ["ls-files", "--others", "--exclude-standard", "-z"]);
    const ignored = await run("git", ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"]);
    paths = `${untracked}${ignored}`.split("\0").filter(Boolean);
  } catch {
    for (const entry of FALLBACK_PATHS) paths.push(...(await walk(entry)));
  }

  const files = [];
  for (const rel of new Set(paths.map(toPosix))) {
    if (isExcluded(rel)) continue;
    const stat = await fs.lstat(safeJoin(rel)).catch(() => null);
    if (stat?.isFile()) files.push(rel);
  }
  return files.sort();
}

/** Paths git tracks: a backup never overwrites those (they come from the repository). */
async function trackedSet() {
  try {
    return new Set((await run("git", ["ls-files", "-z"])).split("\0").filter(Boolean));
  } catch {
    return new Set();
  }
}

async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  await pipeline(fsSync.createReadStream(file), hash);
  return hash.digest("hex");
}

const createdTime = (stat) => Math.round(stat.birthtimeMs || stat.mtimeMs);

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, file);
}

/* ---------- file times index ---------- */

async function loadTimes() {
  const index = await readJson(TIMES_INDEX, null);
  return index?.files && typeof index.files === "object" ? index : { version: 1, files: {} };
}

/**
 * Current info of every file, with its local creation time. The index keeps
 * the first creation time seen for unchanged content; `differences` lists
 * files whose creation time on disk no longer matches the index (copied,
 * restored or recreated files).
 */
async function describeFiles(files) {
  const index = await loadTimes();
  const described = [];
  const differences = [];

  for (const rel of files) {
    const stat = await fs.stat(safeJoin(rel));
    const sha256 = await sha256File(safeJoin(rel));
    const onDisk = createdTime(stat);
    const known = index.files[rel];

    let createdAt = onDisk;
    if (known?.sha256 === sha256 && Number.isFinite(known.createdAt)) {
      createdAt = known.createdAt;
      if (Math.abs(known.createdAt - onDisk) > 2000) {
        differences.push({ path: rel, indexed: known.createdAt, onDisk });
      }
    }

    described.push({ path: rel, size: stat.size, sha256, createdAt, modifiedAt: Math.round(stat.mtimeMs) });
  }

  return { described, differences };
}

async function saveTimes(described, extra = {}) {
  const index = await loadTimes();
  for (const file of described) {
    index.files[file.path] = { sha256: file.sha256, size: file.size, createdAt: file.createdAt };
  }
  await writeJson(TIMES_INDEX, { ...index, ...extra, version: 1, updatedAt: new Date().toISOString() });
}

/* ---------- encryption (OpenSSL compatible) ---------- */

function deriveKey(password, salt) {
  const material = crypto.pbkdf2Sync(Buffer.from(password, "utf8"), salt, PBKDF2_ITERATIONS, 48, "sha256");
  return { key: material.subarray(0, 32), iv: material.subarray(32, 48) };
}

/** "admin:<key>" — the archive password (user name + admin key). */
const passwordFor = (adminKey) => `admin:${adminKey}`;

async function encryptFile(source, destination, password) {
  const salt = crypto.randomBytes(8);
  const { key, iv } = deriveKey(password, salt);
  const output = fsSync.createWriteStream(destination, { mode: 0o600 });
  output.write(Buffer.concat([MAGIC, salt]));
  await pipeline(fsSync.createReadStream(source), crypto.createCipheriv("aes-256-cbc", key, iv), output);
}

async function decryptFile(source, destination, password) {
  const handle = await fs.open(source, "r");
  const header = Buffer.alloc(16);
  await handle.read(header, 0, 16, 0);
  await handle.close();
  if (!header.subarray(0, 8).equals(MAGIC)) throw httpError(400, "This is not a HomeSite backup file.");

  const { key, iv } = deriveKey(password, header.subarray(8, 16));
  try {
    await pipeline(
      fsSync.createReadStream(source, { start: 16 }),
      crypto.createDecipheriv("aes-256-cbc", key, iv),
      fsSync.createWriteStream(destination, { mode: 0o600 }),
    );
  } catch {
    throw httpError(400, "Wrong admin key for this backup, or the file is damaged.");
  }
}

function tar(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr || `tar exited with ${code}`))));
  });
}

async function workDir(prefix) {
  await fs.mkdir(WORK_DIR, { recursive: true, mode: 0o700 });
  return fs.mkdtemp(path.join(WORK_DIR, `${prefix}-`));
}

/* ---------- export ---------- */

async function gitCommit() {
  return (await run("git", ["rev-parse", "HEAD"]).catch(() => "")).trim() || null;
}

/**
 * Builds an encrypted backup. `db`: the live accounts database (copied
 * consistently with SQLite's backup API). Returns { file, name, manifest,
 * differences }; the caller streams `file` and removes it.
 */
async function createBackup({ adminKey, db = null, reason = "export", into = null }) {
  const stage = await workDir("export");
  try {
    const files = await listFiles();
    const { described, differences } = await describeFiles(files);
    const exportedAt = Date.now();

    for (const file of described) {
      const target = path.join(stage, "files", file.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      if (file.path === ACCOUNTS_DB && db) {
        await db.backup(target);
        file.sha256 = await sha256File(target);
        file.size = (await fs.stat(target)).size;
      } else {
        await fs.copyFile(safeJoin(file.path), target);
      }
    }

    await saveTimes(described, { lastExportAt: exportedAt });
    // The index (with these times) goes into the archive too.
    const indexTarget = path.join(stage, "file-times.json");
    await fs.copyFile(TIMES_INDEX, indexTarget);

    const manifest = {
      format: FORMAT,
      version: FORMAT_VERSION,
      exportedAt,
      exportedAtIso: new Date(exportedAt).toISOString(),
      reason,
      host: os.hostname(),
      commit: await gitCommit(),
      encryption: { cipher: "aes-256-cbc", kdf: "pbkdf2-sha256", iterations: PBKDF2_ITERATIONS, user: "admin" },
      files: described,
    };
    await writeJson(path.join(stage, "manifest.json"), manifest);

    const plain = path.join(stage, "backup.tar.gz");
    await tar(["-czf", plain, "-C", stage, "manifest.json", "file-times.json", "files"]);

    const stamp = new Date(exportedAt).toISOString().replace(/[:]/g, "-").replace(/\..+/, "");
    const name = `homesite-backup-${stamp}.tar.gz.enc`;
    await fs.mkdir(into ?? WORK_DIR, { recursive: true, mode: 0o700 });
    const output = path.join(into ?? WORK_DIR, name);
    await encryptFile(plain, output, passwordFor(adminKey));

    return { file: output, name, manifest, differences };
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

/** What would be in a backup (no contents), plus creation-time differences. */
async function overview() {
  const files = await listFiles();
  const { described, differences } = await describeFiles(files);
  const groups = {};
  for (const file of described) {
    const group = categoryOf(file.path);
    groups[group] ??= { files: 0, bytes: 0 };
    groups[group].files += 1;
    groups[group].bytes += file.size;
  }
  const index = await loadTimes();
  return { groups, totalFiles: described.length, differences, lastExportAt: index.lastExportAt ?? null };
}

function categoryOf(rel) {
  if (rel === ".env") return "env";
  if (rel === ACCOUNTS_DB) return "accounts";
  if (rel.startsWith("server/services/db/fdc-polls/recycling-bin/")) return "recycling";
  if (rel.startsWith("server/services/db/fdc-polls/")) return "fdc";
  if (rel.startsWith("server/services/avatars/")) return "avatars";
  if (rel === ACTIVITY_LOG || rel.startsWith(".logs/")) return "logs";
  if (rel.startsWith("server/services/db/")) return "data";
  return "other";
}

/* ---------- .env ---------- */

const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

function parseEnvValue(raw) {
  const value = raw.trim();
  if (value.startsWith('"')) {
    const end = value.lastIndexOf('"');
    return value.slice(1, end > 0 ? end : undefined).replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (value.startsWith("'")) {
    const end = value.lastIndexOf("'");
    return value.slice(1, end > 0 ? end : undefined);
  }
  return value.replace(/\s+#.*$/, "");
}

/** Values only; comments and blank lines are ignored. */
function parseEnv(text) {
  const values = {};
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const match = line.match(ENV_LINE);
    if (match) values[match[1]] = parseEnvValue(match[2]);
  }
  return values;
}

function formatEnvValue(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./:@,+=-]*$/.test(text)
    ? text
    : `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

/** Sets values in .env text, keeping comments and order; new keys are appended. */
function setEnvValues(text, changes, note) {
  const lines = String(text ?? "").split(/\r?\n/);
  const pending = new Map(Object.entries(changes));
  const out = lines.map((line) => {
    if (/^\s*#/.test(line)) return line;
    const match = line.match(ENV_LINE);
    if (!match || !pending.has(match[1])) return line;
    const value = pending.get(match[1]);
    pending.delete(match[1]);
    return `${match[1]}=${formatEnvValue(value)}`;
  });
  while (out.length && out.at(-1) === "") out.pop();
  if (pending.size) {
    out.push("", `# ${note}`);
    for (const [key, value] of pending) out.push(`${key}=${formatEnvValue(value)}`);
  }
  return `${out.join("\n")}\n`;
}

/** Known settings (config/settings.cjs) with their description and importance. */
async function envCatalog() {
  return Object.fromEntries(
    settingsSchema.SETTINGS.map((setting) => [
      setting.key,
      { label: setting.label, description: setting.description, importance: setting.importance },
    ]),
  );
}

/* ---------- merging known data files (points, levels, achievements) ---------- */

function parseCsv(text) {
  const rows = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (quoted) {
        if (char === '"' && line[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else if (char === '"') quoted = false;
        else cell += char;
      } else if (char === '"') quoted = true;
      else if (char === ",") {
        cells.push(cell);
        cell = "";
      } else cell += char;
    }
    cells.push(cell);
    rows.push(cells);
  }
  return rows;
}

const csvCell = (value) => (/[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value));

/*
 * Merges a per-user CSV (header + one row per user in the first column):
 * numbers that only grow are maxed, the rest comes from the row with the
 * newer `updatedAt` (or the higher `points`).
 */
function mergeUserCsv(localText, backupText, { maxColumns, newerBy }) {
  const [localHeader, ...localRows] = parseCsv(localText);
  const [backupHeader, ...backupRows] = parseCsv(backupText);
  const header = [...new Set([...(localHeader ?? []), ...(backupHeader ?? [])])];
  const toObject = (head, row) => Object.fromEntries(head.map((name, index) => [name, row[index] ?? ""]));

  const merged = new Map(localRows.map((row) => [row[0], toObject(localHeader, row)]));
  for (const row of backupRows) {
    const other = toObject(backupHeader, row);
    const mine = merged.get(row[0]);
    if (!mine) {
      merged.set(row[0], other);
      continue;
    }
    const otherNewer = Number(other[newerBy] ?? 0) > Number(mine[newerBy] ?? 0);
    const base = otherNewer ? { ...mine, ...other } : { ...other, ...mine };
    for (const column of maxColumns) {
      if (column in mine || column in other) base[column] = String(Math.max(Number(mine[column]) || 0, Number(other[column]) || 0));
    }
    merged.set(row[0], base);
  }
  return `${[header, ...[...merged.values()].map((row) => header.map((name) => row[name] ?? ""))].map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

/* Known files and how to merge them (other files: one version or the other). */
const MERGERS = {
  "server/services/db/levels.csv": (local, backup) => {
    // Discord levels: the row with more points wins (level belongs to it).
    const [header, ...localRows] = parseCsv(local);
    const [, ...backupRows] = parseCsv(backup);
    const byUser = new Map(localRows.map((row) => [row[0], row]));
    const points = header.indexOf("points");
    for (const row of backupRows) {
      const mine = byUser.get(row[0]);
      if (!mine || Number(row[points]) > Number(mine[points])) byUser.set(row[0], row);
    }
    return `${[header, ...byUser.values()].map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
  },
  "server/services/db/petting.csv": (local, backup) =>
    mergeUserCsv(local, backup, {
      maxColumns: ["totalGiven", "totalReceived", "uniquePeoplePetted", "uniquePeoplePettingYou", "comboStarts", "bestCombo"],
      newerBy: "updatedAt",
    }),
  "server/services/db/achievements.json": (local, backup) => {
    const a = JSON.parse(local || "{}");
    const b = JSON.parse(backup || "{}");
    for (const [user, list] of Object.entries(b)) a[user] = [...new Set([...(a[user] ?? []), ...list])];
    return `${JSON.stringify(a, null, 2)}\n`;
  },
  "server/services/db/pets.json": (local, backup) => {
    const key = (pet) => `${pet.petterId}:${pet.targetId}:${pet.sentAt}`;
    const all = new Map();
    for (const pet of [...JSON.parse(local || "[]"), ...JSON.parse(backup || "[]")]) all.set(key(pet), pet);
    return `${JSON.stringify([...all.values()].sort((x, y) => x.sentAt - y.sentAt), null, 2)}\n`;
  },
  /*
   * Birthdays ({ userId: { day, month, year } }): everyone from both sides.
   * Same day: a known birth year fills a missing one. Different day: the
   * newer file's entry (the person changed it there).
   */
  "server/services/db/birthdays.json": (local, backup, { backupNewer } = {}) => {
    const a = JSON.parse(local || "{}");
    const b = JSON.parse(backup || "{}");
    if (Array.isArray(a) || Array.isArray(b)) throw new Error("Unexpected birthdays format.");
    const merged = { ...a };
    for (const [user, entry] of Object.entries(b)) {
      const mine = merged[user];
      if (!mine) {
        merged[user] = entry;
      } else if (mine.day === entry.day && mine.month === entry.month) {
        merged[user] = { ...mine, year: mine.year ?? entry.year ?? null };
      } else if (backupNewer) {
        merged[user] = entry;
      }
    }
    return `${JSON.stringify(merged, null, 2)}\n`;
  },
  // Who was already congratulated: wished on either side counts (never twice).
  "server/services/db/birthday-celebration-state.json": (local, backup) => {
    const a = JSON.parse(local || "{}");
    const b = JSON.parse(backup || "{}");
    const merged = { ...b, ...a, birthdays: { ...(b.birthdays ?? {}) } };
    for (const [key, entry] of Object.entries(a.birthdays ?? {})) {
      const other = merged.birthdays[key];
      merged.birthdays[key] = other ? { ...other, ...entry, wished: Boolean(entry.wished || other.wished) } : entry;
    }
    return `${JSON.stringify(merged, null, 2)}\n`;
  },
};

/* ---------- import: analysis ---------- */

/* Units that are taken or kept as a whole (an FDC folder must stay consistent). */
function unitOf(rel) {
  const poll = rel.match(/^(server\/services\/db\/fdc-polls\/\d{4}-\d{2}-\d{2})\//);
  if (poll) return poll[1];
  if (rel.startsWith("server/services/db/fdc-polls/recycling-bin/")) return "server/services/db/fdc-polls/recycling-bin";
  return rel;
}

async function extract(archive, password) {
  const stage = await workDir("import");
  const plain = path.join(stage, "backup.tar.gz");
  await decryptFile(archive, plain, password);
  const out = path.join(stage, "content");
  await fs.mkdir(out);
  try {
    await tar(["-xzf", plain, "-C", out, "--no-same-owner", "--no-same-permissions", "--no-overwrite-dir"]);
  } catch {
    throw httpError(400, "Wrong admin key for this backup, or the file is damaged.");
  }
  await fs.rm(plain, { force: true });

  // Only plain files and folders (no links pointing anywhere else).
  const check = async (dir) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw httpError(400, "The backup contains links; refusing to import it.");
      if (entry.isDirectory()) await check(full);
    }
  };
  await check(out);
  return { stage, content: out };
}

async function readManifest(content) {
  const manifest = await readJson(path.join(content, "manifest.json"), null);
  if (manifest && manifest.format !== FORMAT) throw httpError(400, "This is not a HomeSite backup.");
  if (manifest?.version > FORMAT_VERSION) {
    // Newer format: still readable as long as the file list is there.
    manifest.newerFormat = true;
  }
  if (manifest?.files) return manifest;

  // No manifest (hand-made archive): describe the files as they are.
  const files = [];
  const base = path.join(content, "files");
  const visit = async (dir) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) {
        const stat = await fs.stat(full);
        files.push({ path: toPosix(path.relative(base, full)), size: stat.size, sha256: await sha256File(full), createdAt: createdTime(stat) });
      }
    }
  };
  await visit(base);
  return { format: FORMAT, version: 0, exportedAt: null, files, generated: true };
}

function usersOf(dbPath) {
  const Database = require("better-sqlite3");
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const hasUsers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
    const users = hasUsers ? db.prepare("SELECT * FROM users").all() : [];
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
    const counts = Object.fromEntries(tables.map(({ name }) => [name, db.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get().c]));
    return { users, counts };
  } finally {
    db.close();
  }
}

/**
 * Reads an encrypted backup and works out what an import would do, without
 * changing anything. The plan stays on disk for `applyImport`.
 */
async function analyzeImport({ archive, password, localDb }) {
  const { stage, content } = await extract(archive, password);
  try {
    const manifest = await readManifest(content);

    // Integrity: every file must match its checksum.
    const damaged = [];
    for (const file of manifest.files) {
      const full = path.join(content, "files", file.path);
      const sha = await sha256File(full).catch(() => null);
      if (!sha || sha !== file.sha256) damaged.push(file.path);
    }
    if (damaged.length) {
      throw httpError(400, `The backup is damaged (${damaged.length} file(s) don't match their checksum).`);
    }

    const tracked = await trackedSet();
    const localTimes = await loadTimes();
    const exportedAt = manifest.exportedAt;

    // ---- files, grouped in units ----
    const units = new Map();
    for (const file of manifest.files) {
      if ([ACCOUNTS_DB, ".env", ACTIVITY_LOG].includes(file.path)) continue;
      if (isExcluded(file.path) || tracked.has(file.path)) continue;
      safeJoin(file.path);
      const id = unitOf(file.path);
      if (!units.has(id)) units.set(id, []);
      units.get(id).push(file);
    }

    const fileUnits = [];
    for (const [id, files] of units) {
      let identical = 0;
      let missing = 0;
      let backupTime = 0;
      let localTime = 0;
      for (const file of files) {
        backupTime = Math.max(backupTime, file.createdAt ?? 0);
        const local = safeJoin(file.path);
        const stat = await fs.stat(local).catch(() => null);
        if (!stat) {
          missing += 1;
          continue;
        }
        const sha = await sha256File(local);
        const known = localTimes.files[file.path];
        const time = known?.sha256 === sha && known.createdAt ? known.createdAt : createdTime(stat);
        localTime = Math.max(localTime, time);
        if (sha === file.sha256) identical += 1;
      }

      const status = identical === files.length ? "identical" : missing === files.length ? "new" : "differs";
      if (status === "identical") {
        fileUnits.push({ id, status, files: files.length, category: categoryOf(files[0].path) });
        continue;
      }

      const newest = status === "new" || backupTime > localTime ? "backup" : "local";
      const sinceExport = status === "new" ? "backup" : exportedAt && localTime > exportedAt ? "local" : "backup";
      const mergeable = status === "differs" && files.length === 1 && Boolean(MERGERS[files[0].path]);
      fileUnits.push({
        mergeable,
        id,
        status,
        files: files.length,
        bytes: files.reduce((sum, file) => sum + file.size, 0),
        category: categoryOf(files[0].path),
        backupTime,
        localTime: localTime || null,
        // merge: combine known files, otherwise newest/sinceExport; restore: the backup.
        defaults: { newest: mergeable ? "merge" : newest, sinceExport: mergeable ? "merge" : sinceExport, restore: "backup" },
      });
    }

    // ---- accounts database ----
    let accounts = null;
    const backupDb = path.join(content, "files", ACCOUNTS_DB);
    if (fsSync.existsSync(backupDb)) {
      const backup = usersOf(backupDb);
      const localUsers = localDb
        ? localDb.prepare("SELECT * FROM users").all()
        : [];
      const byDiscord = new Map(localUsers.map((user) => [user.discord_user_id, user]));
      accounts = {
        localExists: Boolean(localDb),
        tables: backup.counts,
        users: backup.users.map((user) => {
          const local = byDiscord.get(user.discord_user_id);
          const same =
            local && Object.keys(user).every((key) => key === "last_login_at" || String(user[key]) === String(local[key]));
          return {
            id: user.id,
            discordUserId: user.discord_user_id,
            username: user.username,
            displayName: user.display_name,
            role: user.role ?? "user",
            createdAt: user.created_at,
            lastLoginAt: user.last_login_at,
            status: !local ? "new" : same ? "same" : "merge",
            keepsId: !local ? user.id : user.created_at < local.created_at ? user.id : local.id,
          };
        }),
        localOnly: localUsers
          .filter((user) => !backup.users.some((other) => other.discord_user_id === user.discord_user_id))
          .map((user) => ({ discordUserId: user.discord_user_id, displayName: user.display_name, username: user.username })),
      };
    }

    // ---- .env ----
    let env = null;
    const backupEnvFile = path.join(content, "files", ".env");
    if (fsSync.existsSync(backupEnvFile)) {
      const backupValues = parseEnv(await fs.readFile(backupEnvFile, "utf8"));
      const localValues = parseEnv(await fs.readFile(path.join(REPO_ROOT, ".env"), "utf8").catch(() => ""));
      const catalog = await envCatalog();
      const keys = [...new Set([...Object.keys(backupValues), ...Object.keys(localValues)])].sort();
      env = keys.map((key) => ({
        key,
        status: !(key in localValues) ? "backup-only" : !(key in backupValues) ? "local-only" : backupValues[key] === localValues[key] ? "same" : "differs",
        backup: backupValues[key] ?? null,
        local: localValues[key] ?? null,
        description: catalog[key]?.description ?? "",
        importance: catalog[key]?.importance ?? "unknown",
      }));
    }

    // ---- activity log ----
    let activity = null;
    const backupLog = path.join(content, "files", ACTIVITY_LOG);
    if (fsSync.existsSync(backupLog)) {
      const local = await fs.readFile(safeJoin(ACTIVITY_LOG), "utf8").catch(() => "");
      const remote = await fs.readFile(backupLog, "utf8");
      activity = {
        status: local === remote ? "identical" : !local ? "new" : remote.startsWith(local) ? "backup-longer" : local.startsWith(remote) ? "local-longer" : "different",
        backupEntries: remote.split("\n").filter(Boolean).length,
        localEntries: local.split("\n").filter(Boolean).length,
      };
    }

    const plan = {
      id: path.basename(stage),
      createdAt: Date.now(),
      manifest: {
        version: manifest.version,
        exportedAt,
        host: manifest.host ?? null,
        commit: manifest.commit ?? null,
        files: manifest.files.length,
        newerFormat: Boolean(manifest.newerFormat),
        generated: Boolean(manifest.generated),
      },
      units: fileUnits,
      accounts,
      env,
      activity,
    };
    await writeJson(path.join(stage, "plan.json"), plan);
    return plan;
  } catch (error) {
    await fs.rm(stage, { recursive: true, force: true });
    throw error;
  }
}

/* ---------- import: apply ---------- */

function columnsOf(db, table) {
  return db.prepare(`PRAGMA table_info("${table}")`).all().map((column) => column.name);
}

/**
 * Merges the backup's accounts database into the live one:
 *  - users of the selected Discord IDs; one account per Discord ID, keeping
 *    the oldest UUID (references and avatar files are renamed),
 *  - LobbyCat progress merged (max points, all milestones),
 *  - other tables: rows added that aren't there yet,
 *  - only columns both versions have (old and new formats mix fine),
 *  - sessions are not imported (everyone just logs in again).
 */
function mergeAccounts(localDb, backupPath, selected, report, strategy = "merge") {
  const restore = strategy === "restore";
  const Database = require("better-sqlite3");
  const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
  const remap = new Map();

  try {
    const backupTables = backup
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all();
    const localTables = new Set(
      localDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name),
    );

    localDb.pragma("foreign_keys = OFF");
    const merge = localDb.transaction(() => {
      const userTables = [...localTables].filter((table) => table !== "users" && columnsOf(localDb, table).includes("user_id"));

      const renameUser = (from, to) => {
        localDb.prepare("UPDATE users SET id = ? WHERE id = ?").run(to, from);
        for (const table of userTables) localDb.prepare(`UPDATE "${table}" SET user_id = ? WHERE user_id = ?`).run(to, from);
        const user = localDb.prepare("SELECT avatar_path FROM users WHERE id = ?").get(to);
        if (user?.avatar_path?.includes(from)) {
          const next = user.avatar_path.replace(from, to);
          localDb.prepare("UPDATE users SET avatar_path = ? WHERE id = ?").run(next, to);
          report.avatarRenames.push({ from: user.avatar_path, to: next });
        }
      };

      // ---- users ----
      if (backupTables.some((table) => table.name === "users") && localTables.has("users")) {
        const localColumns = columnsOf(localDb, "users");
        for (const user of backup.prepare("SELECT * FROM users").all()) {
          if (!selected.has(user.discord_user_id)) {
            report.usersSkipped += 1;
            continue;
          }
          const local = localDb.prepare("SELECT * FROM users WHERE discord_user_id = ?").get(user.discord_user_id);
          const columns = Object.keys(user).filter((column) => localColumns.includes(column));

          if (!local) {
            let id = user.id;
            if (localDb.prepare("SELECT 1 FROM users WHERE id = ?").get(id)) id = crypto.randomUUID();
            if (user.email && localDb.prepare("SELECT 1 FROM users WHERE email = ?").get(user.email)) user.email = null;
            const values = columns.map((column) => (column === "id" ? id : user[column]));
            localDb.prepare(`INSERT INTO users (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(...values);
            remap.set(user.id, id);
            report.usersAdded += 1;
            continue;
          }

          // Same Discord user: one account, the oldest id.
          let id = local.id;
          if (user.created_at && local.created_at && user.created_at < local.created_at && user.id !== local.id) {
            if (!localDb.prepare("SELECT 1 FROM users WHERE id = ?").get(user.id)) {
              renameUser(local.id, user.id);
              id = user.id;
            }
          }
          remap.set(user.id, id);

          // Newer profile wins; gaps are filled; the earliest creation date stays.
          const current = localDb.prepare("SELECT * FROM users WHERE id = ?").get(id);
          const backupNewer = String(user.updated_at ?? "") > String(current.updated_at ?? "");
          const updates = {};
          for (const column of columns) {
            if (["id", "discord_user_id", "avatar_path"].includes(column)) continue;
            if (column === "created_at") {
              if (user.created_at && user.created_at < current.created_at) updates.created_at = user.created_at;
            } else if (column === "last_login_at") {
              if (String(user.last_login_at) > String(current.last_login_at)) updates.last_login_at = user.last_login_at;
            } else if ((current[column] === null || current[column] === "") && user[column] !== null) {
              updates[column] = user[column];
            } else if ((backupNewer || restore) && user[column] !== null && column !== "email") {
              updates[column] = user[column];
            }
          }
          const keys = Object.keys(updates);
          if (keys.length) {
            localDb.prepare(`UPDATE users SET ${keys.map((key) => `"${key}" = ?`).join(", ")} WHERE id = ?`).run(...keys.map((key) => updates[key]), id);
          }
          report.usersMerged += 1;
        }
      }

      const mapUser = (id) => remap.get(id) ?? null;

      // ---- other tables ----
      for (const { name, sql } of backupTables) {
        if (name === "users" || name === "sessions") {
          if (name === "sessions") report.sessionsSkipped = backup.prepare("SELECT COUNT(*) AS c FROM sessions").get().c;
          continue;
        }
        if (!localTables.has(name)) {
          localDb.exec(sql);
          localTables.add(name);
          report.tablesCreated.push(name);
        }

        const localColumns = columnsOf(localDb, name);
        const rows = backup.prepare(`SELECT * FROM "${name}"`).all();
        const hasUser = localColumns.includes("user_id");

        for (const row of rows) {
          if (hasUser) {
            const mapped = mapUser(row.user_id);
            if (!mapped) continue; // user not imported
            row.user_id = mapped;
          }
          const columns = Object.keys(row).filter((column) => localColumns.includes(column));

          if (name === "lobby_cat") {
            const local = localDb.prepare("SELECT * FROM lobby_cat WHERE user_id = ?").get(row.user_id);
            if (local && restore) {
              // Restore: the backup's points, level and milestones exactly.
              const keys = columns.filter((column) => column !== "user_id");
              localDb.prepare(`UPDATE lobby_cat SET ${keys.map((key) => `"${key}" = ?`).join(", ")} WHERE user_id = ?`).run(...keys.map((key) => row[key]), row.user_id);
              report.rowsRestored += 1;
              continue;
            }
            if (local) {
              const newer = String(row.updated_at ?? "") > String(local.updated_at ?? "") ? row : local;
              const milestones = { ...JSON.parse(local.milestones_json || "{}"), ...JSON.parse(row.milestones_json || "{}") };
              const merged = {
                ...newer,
                points: Math.max(local.points ?? 0, row.points ?? 0),
                level: Math.max(local.level ?? 0, row.level ?? 0),
                total_pets: Math.max(local.total_pets ?? 0, row.total_pets ?? 0),
                best_streak: Math.max(local.best_streak ?? 0, row.best_streak ?? 0),
                milestones_json: JSON.stringify(milestones),
                created_at: [local.created_at, row.created_at].filter(Boolean).sort()[0] ?? local.created_at,
              };
              const keys = columns.filter((column) => column !== "user_id" && column in merged);
              localDb.prepare(`UPDATE lobby_cat SET ${keys.map((key) => `"${key}" = ?`).join(", ")} WHERE user_id = ?`).run(...keys.map((key) => merged[key]), row.user_id);
              report.rowsMerged += 1;
              continue;
            }
          }

          const result = localDb
            .prepare(`INSERT ${restore ? "OR REPLACE" : "OR IGNORE"} INTO "${name}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
            .run(...columns.map((column) => row[column]));
          report.rowsAdded += result.changes;
        }
      }
    });
    merge();
  } finally {
    localDb.pragma("foreign_keys = ON");
    backup.close();
  }
  return remap;
}

async function readPlan(planId) {
  if (!/^import-[A-Za-z0-9]+$/.test(String(planId))) throw httpError(400, "Unknown import.");
  const stage = path.join(WORK_DIR, planId);
  const plan = await readJson(path.join(stage, "plan.json"), null);
  if (!plan) throw httpError(410, "This import has expired. Please check the backup again.");
  if (Date.now() - plan.createdAt > STAGING_TTL_MS) {
    await fs.rm(stage, { recursive: true, force: true });
    throw httpError(410, "This import has expired. Please check the backup again.");
  }
  return { plan, stage, content: path.join(stage, "content") };
}

async function pruneSafetyBackups() {
  const entries = (await fs.readdir(BACKUP_DIR).catch(() => [])).filter((name) => name.endsWith(".tar.gz.enc")).sort();
  for (const name of entries.slice(0, Math.max(0, entries.length - KEEP_SAFETY_BACKUPS))) {
    await fs.rm(path.join(BACKUP_DIR, name), { force: true });
  }
}

/**
 * Applies an analysed import:
 *  `choices`: { mode: "newest" | "sinceExport", units: { [id]: "backup" | "local" },
 *               users: [discordUserId], env: { [KEY]: "backup" | "local" } }
 * A safety backup of the current state is written to db/backups first.
 */
async function applyImport({ planId, adminKey, localDb, choices, activity }) {
  const { plan, stage, content } = await readPlan(planId);
  const report = {
    safetyBackup: null,
    filesWritten: 0,
    unitsTaken: [],
    unitsKept: 0,
    usersAdded: 0,
    usersMerged: 0,
    usersSkipped: 0,
    rowsAdded: 0,
    rowsMerged: 0,
    rowsRestored: 0,
    filesMerged: [],
    tablesCreated: [],
    sessionsSkipped: 0,
    avatarRenames: [],
    envChanged: [],
    activityLog: null,
    restartNeeded: true,
  };

  // 1. Safety first: everything as it is right now.
  const safety = await createBackup({ adminKey, db: localDb, reason: "before-import", into: BACKUP_DIR });
  report.safetyBackup = path.relative(REPO_ROOT, safety.file);
  await pruneSafetyBackups();

  const manifest = await readManifest(content);
  const byUnit = new Map();
  for (const file of manifest.files) {
    const id = unitOf(file.path);
    if (!byUnit.has(id)) byUnit.set(id, []);
    byUnit.get(id).push(file);
  }

  // 2. Files, unit by unit.
  const written = [];
  // strategy "merge" (another machine) uses mode newest | sinceExport; "restore" takes the backup.
  const strategy = choices?.strategy === "restore" ? "restore" : "merge";
  const mode = strategy === "restore" ? "restore" : choices?.mode === "sinceExport" ? "sinceExport" : "newest";
  report.strategy = strategy;
  for (const unit of plan.units) {
    if (unit.status === "identical") continue;
    const decision = choices?.units?.[unit.id] ?? unit.defaults?.[mode] ?? "local";
    const files = byUnit.get(unit.id) ?? [];
    if (decision === "merge" && files.length === 1 && MERGERS[files[0].path]) {
      const target = safeJoin(files[0].path);
      const local = await fs.readFile(target, "utf8").catch(() => "");
      const backup = await fs.readFile(path.join(content, "files", files[0].path), "utf8");
      try {
        await fs.writeFile(
          target,
          MERGERS[files[0].path](local, backup, { backupNewer: (unit.backupTime ?? 0) > (unit.localTime ?? 0) }),
        );
        report.filesMerged.push(files[0].path);
      } catch {
        report.unitsKept += 1; // unexpected format: keep the current file
      }
      continue;
    }
    if (decision !== "backup") {
      report.unitsKept += 1;
      continue;
    }
    // An FDC folder / the recycling bin is replaced as a whole (it's in the safety backup).
    if (files.length > 1 || unit.id !== files[0]?.path) {
      const folder = safeJoin(unit.id);
      const keep = new Set(files.map((file) => file.path));
      for (const existing of await walk(unit.id)) if (!keep.has(existing)) await fs.rm(safeJoin(existing), { force: true });
      await fs.mkdir(folder, { recursive: true });
    }
    for (const file of files) {
      const target = safeJoin(file.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(path.join(content, "files", file.path), target);
      written.push({ path: file.path, size: file.size, sha256: file.sha256, createdAt: file.createdAt });
      report.filesWritten += 1;
    }
    report.unitsTaken.push(unit.id);
  }

  // 3. Accounts database.
  const backupDb = path.join(content, "files", ACCOUNTS_DB);
  if (plan.accounts && fsSync.existsSync(backupDb)) {
    const selected = new Set(Array.isArray(choices?.users) ? choices.users.map(String) : plan.accounts.users.map((user) => user.discordUserId));
    if (localDb) {
      mergeAccounts(localDb, backupDb, selected, report, strategy);
      for (const rename of report.avatarRenames) {
        const from = safeJoin(path.posix.join("server/services", rename.from));
        const to = safeJoin(path.posix.join("server/services", rename.to));
        await fs.rename(from, to).catch(() => {});
      }
    } else {
      await fs.copyFile(backupDb, safeJoin(ACCOUNTS_DB));
      report.usersAdded = plan.accounts.users.length;
    }
  }

  // 4. .env: only the chosen values.
  if (plan.env) {
    const changes = {};
    for (const entry of plan.env) {
      const choice =
        choices?.env?.[entry.key] ??
        (entry.status === "backup-only" || (strategy === "restore" && entry.status === "differs") ? "backup" : "local");
      if (choice === "backup" && entry.backup !== null && entry.backup !== entry.local) changes[entry.key] = entry.backup;
    }
    if (Object.keys(changes).length) {
      const envPath = path.join(REPO_ROOT, ".env");
      const current = await fs.readFile(envPath, "utf8").catch(() => "");
      await fs.writeFile(envPath, setEnvValues(current, changes, `Imported from the backup of ${new Date(plan.manifest.exportedAt ?? Date.now()).toISOString()}`), { mode: 0o600 });
      report.envChanged = Object.keys(changes);
    }
  }

  // 5. Activity log: never rewritten; a different history is kept next to it.
  const backupLog = path.join(content, "files", ACTIVITY_LOG);
  if (plan.activity && fsSync.existsSync(backupLog)) {
    const status = plan.activity.status;
    if (status === "new" || status === "backup-longer" || (strategy === "restore" && status !== "identical" && status !== "local-longer")) {
      if (status === "different") {
        // Restore: the current log is kept next to it, never lost.
        await fs.copyFile(safeJoin(ACTIVITY_LOG), safeJoin(`server/services/db/activity-log.before-restore-${Date.now()}.jsonl`)).catch(() => {});
      }
      await fs.copyFile(backupLog, safeJoin(ACTIVITY_LOG));
      activity?.reset?.();
      report.activityLog = status === "new" ? "imported" : "extended with the backup's newer entries";
    } else if (status === "different") {
      const name = `server/services/db/activity-log.imported-${new Date(plan.manifest.exportedAt ?? Date.now()).toISOString().slice(0, 10)}.jsonl`;
      await fs.copyFile(backupLog, safeJoin(name));
      report.activityLog = `kept the current log; the backup's log was saved as ${path.basename(name)}`;
    } else {
      report.activityLog = "unchanged";
    }
  }

  // 6. Remember the creation times that came with the backup.
  await saveTimes(written, { lastImportAt: Date.now() });

  await fs.rm(stage, { recursive: true, force: true });
  return report;
}

/** Deletes import work folders older than an hour. */
async function cleanupStaging() {
  for (const name of await fs.readdir(WORK_DIR).catch(() => [])) {
    const full = path.join(WORK_DIR, name);
    const stat = await fs.stat(full).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > STAGING_TTL_MS) await fs.rm(full, { recursive: true, force: true });
  }
}

/* ---------- .env editing (write only) ---------- */

/*
 * Everything the admin settings page needs. Non-secret values are included
 * (the page is unlocked with the admin key + 2FA); secrets and unknown
 * custom entries never are, those need revealEnv (2FA) one at a time.
 */
async function envOverview() {
  const values = parseEnv(await fs.readFile(path.join(REPO_ROOT, ".env"), "utf8").catch(() => ""));
  const { sections, features, settings } = settingsSchema.describe();
  const suggestions = settingsSchema.suggestions(values);

  const known = settings.map((setting) => {
    const set = settingsSchema.isSet(values, setting.key);
    const status = settingsSchema.statusOf(values, setting.key);
    return {
      ...setting,
      known: true,
      set,
      state: status.state,
      reason: status.reason ?? null,
      value: setting.type === "secret" ? null : (values[setting.key] ?? ""),
      suggestion: suggestions[setting.key] ?? null,
    };
  });
  const custom = Object.keys(values)
    .filter((key) => !settingsSchema.BY_KEY.has(key))
    .sort()
    .map((key) => ({
      key,
      known: false,
      label: key,
      description: "",
      type: "secret",
      importance: "unknown",
      set: values[key] !== "",
      state: values[key] !== "" ? "set" : "missing",
      value: null,
    }));

  return {
    sections,
    features: features.map((feature) => ({ ...feature, ...settingsSchema.featureStatus(values, feature.id) })),
    keys: [...known, ...custom],
  };
}

/** Which services need a restart / the site a rebuild after these keys change. */
function restartsFor(keys) {
  const applies = new Set();
  for (const key of keys) for (const target of settingsSchema.BY_KEY.get(key)?.applies ?? ["bot", "accounts", "profile"]) applies.add(target);
  return [...applies];
}

/** Throws a 400 for the first invalid value (before any 2FA code is used up). */
function validateEnv(changes) {
  for (const [key, value] of Object.entries(changes ?? {})) {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(key)) throw httpError(400, `Invalid name: ${key}`);
    if (typeof value !== "string" || value.length > 4096 || /[\r\0]/.test(value)) throw httpError(400, `Invalid value for ${key}.`);
    const problem = settingsSchema.validate(key, value);
    if (problem) throw httpError(400, `${settingsSchema.BY_KEY.get(key)?.label ?? key}: ${problem}`);
  }
}

async function setEnv(changes) {
  validateEnv(changes);
  const clean = {};
  for (const [key, value] of Object.entries(changes ?? {})) {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(key)) throw httpError(400, `Invalid name: ${key}`);
    if (typeof value !== "string" || value.length > 4096 || /[\r\0]/.test(value)) throw httpError(400, `Invalid value for ${key}.`);
    const problem = settingsSchema.validate(key, value);
    if (problem) throw httpError(400, `${settingsSchema.BY_KEY.get(key)?.label ?? key}: ${problem}`);
    clean[key] = value;
  }
  if (!Object.keys(clean).length) return [];
  const envPath = path.join(REPO_ROOT, ".env");
  const current = await fs.readFile(envPath, "utf8").catch(() => "");
  // Previous version kept (it is in the next backup too).
  await fs.mkdir(BACKUP_DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(BACKUP_DIR, `env-${Date.now()}.bak`), current, { mode: 0o600 });
  await fs.writeFile(envPath, setEnvValues(current, clean, `Added on the website ${new Date().toISOString()}`), { mode: 0o600 });
  return Object.keys(clean);
}

/**
 * Removes values from .env: known settings fall back to their defaults,
 * custom entries are gone completely. The old file is kept in db/backups.
 */
async function removeEnv(names) {
  const remove = new Set((Array.isArray(names) ? names : []).filter((name) => /^[A-Z][A-Z0-9_]{0,63}$/.test(name)));
  if (!remove.size) throw httpError(400, "Nothing to remove.");
  const envPath = path.join(REPO_ROOT, ".env");
  const current = await fs.readFile(envPath, "utf8").catch(() => "");
  await fs.mkdir(BACKUP_DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(BACKUP_DIR, `env-${Date.now()}.bak`), current, { mode: 0o600 });
  const kept = current.split(/\r?\n/).filter((line) => {
    if (/^\s*#/.test(line)) return true;
    const match = line.match(ENV_LINE);
    return !(match && remove.has(match[1]));
  });
  await fs.writeFile(envPath, `${kept.join("\n").replace(/\n+$/, "")}\n`, { mode: 0o600 });
  return [...remove];
}

/** One current value (only with 2FA, see adminBackup.cjs). */
async function revealEnv(name) {
  const values = parseEnv(await fs.readFile(path.join(REPO_ROOT, ".env"), "utf8").catch(() => ""));
  if (!(name in values)) throw httpError(404, `${name} is not set.`);
  return values[name];
}

module.exports = {
  validateEnv,
  restartsFor,
  removeEnv,
  revealEnv,
  createBackup,
  overview,
  analyzeImport,
  applyImport,
  cleanupStaging,
  envOverview,
  setEnv,
  parseEnv,
  setEnvValues,
  passwordFor,
  WORK_DIR,
  BACKUP_DIR,
};
