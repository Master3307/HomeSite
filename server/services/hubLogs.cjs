const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

/*
 * Logs for /hub: every local log the project writes, plus the systemd
 * journal of the services when it is there.
 *
 *   .logs/services/<name>.log   console output of bot, account API, profile API, deploy listener (processLog.cjs)
 *   .logs/*.log                 pnpm checks
 *   server/services/db/*.jsonl  append-only data logs (activity log, recycling bin history)
 *   journalctl -u <unit>        systemd units from scripts/deploy.sh (server only)
 */

const ROOT = path.resolve(__dirname, "..", "..");
const LOGS = path.join(ROOT, ".logs");
const DB = path.join(__dirname, "db");
const UNITS = ["discord-bot", "accounts-api", "discord-profile", "homesite", "github-deploy-listener", "homesite-deploy"];
const MAX_READ = 2 * 1024 * 1024;

let journalUnits = null; // detected once

function detectJournal() {
  if (journalUnits) return journalUnits;
  journalUnits = [];
  if (spawnSync("sh", ["-c", "command -v journalctl"], { stdio: "ignore" }).status !== 0) return journalUnits;
  for (const unit of UNITS) {
    const result = spawnSync("journalctl", ["-u", `${unit}.service`, "-n", "1", "--no-pager", "-q", "-o", "cat"], { encoding: "utf8", timeout: 4000 });
    if (result.status === 0 && result.stdout.trim()) journalUnits.push(unit);
  }
  return journalUnits;
}

async function walk(directory, depth = 0) {
  const found = [];
  let entries = [];
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory() && depth < 3 && entry.name !== "backups" && !entry.name.startsWith(".backup")) found.push(...(await walk(full, depth + 1)));
    else if (entry.isFile() && /\.(log|jsonl)(\.1)?$/.test(entry.name)) found.push(full);
  }
  return found;
}

const SERVICE_LABELS = { bot: "Discord bot", accounts: "Account API", profile: "Profile API", deploy: "Deploy listener" };

async function sources() {
  const files = [...(await walk(LOGS)), ...(await walk(DB))];
  const list = [];
  for (const file of files) {
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat) continue;
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    const base = path.basename(file).replace(/\.(log|jsonl)(\.1)?$/, "");
    const group = rel.startsWith(".logs/services/") ? "services" : rel.startsWith(".logs/") ? "checks" : "data";
    list.push({
      id: `file:${rel}`,
      group,
      label: group === "services" ? `${SERVICE_LABELS[base] ?? base}${rel.endsWith(".1") ? " (older)" : ""}` : rel.replace(/^\.logs\/|^server\/services\/db\//, ""),
      path: rel,
      bytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    });
  }
  for (const unit of detectJournal()) list.push({ id: `journal:${unit}`, group: "journal", label: `${unit}.service`, path: `journalctl -u ${unit}`, bytes: null, modifiedAt: null });
  const order = { services: 0, journal: 1, data: 2, checks: 3 };
  return list.sort((a, b) => order[a.group] - order[b.group] || a.label.localeCompare(b.label));
}

function resolveFile(id) {
  const rel = String(id ?? "").replace(/^file:/, "");
  const full = path.resolve(ROOT, rel);
  const inside = [LOGS, DB].some((dir) => full.startsWith(dir + path.sep));
  if (!inside || !/\.(log|jsonl)(\.1)?$/.test(full) || full.includes(`${path.sep}backups${path.sep}`)) {
    throw Object.assign(new Error("Unknown log."), { status: 404 });
  }
  return full;
}

/** The last `lines` lines of a log. */
async function read(id, lines = 400) {
  const count = Math.min(5000, Math.max(10, Number(lines) || 400));
  if (String(id).startsWith("journal:")) {
    const unit = String(id).slice(8);
    if (!detectJournal().includes(unit)) throw Object.assign(new Error("Unknown unit."), { status: 404 });
    const result = spawnSync("journalctl", ["-u", `${unit}.service`, "-n", String(count), "--no-pager", "-o", "short-iso"], { encoding: "utf8", timeout: 10_000, maxBuffer: 16 * 1024 * 1024 });
    return { lines: result.stdout.split("\n").filter(Boolean), size: null };
  }
  const file = resolveFile(id);
  const stat = await fsp.stat(file);
  const start = Math.max(0, stat.size - MAX_READ);
  const handle = await fsp.open(file, "r");
  try {
    const buffer = Buffer.alloc(stat.size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const all = buffer.toString("utf8").split("\n");
    if (start > 0) all.shift(); // partial first line
    if (all.at(-1) === "") all.pop();
    return { lines: all.slice(-count), size: stat.size };
  } finally {
    await handle.close();
  }
}

/** Streams new lines as server-sent events until the request closes. */
function follow(id, req, res) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", Connection: "keep-alive" });
  res.write(`: ${" ".repeat(2048)}\n\n`);
  const send = (lines) => lines.length && res.write(`data: ${JSON.stringify(lines)}\n\n`);
  const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
  let stop = () => {};

  if (String(id).startsWith("journal:")) {
    const unit = String(id).slice(8);
    if (!detectJournal().includes(unit)) return res.end();
    const child = spawn("journalctl", ["-u", `${unit}.service`, "-f", "-n", "0", "--no-pager", "-o", "short-iso"]);
    let rest = "";
    child.stdout.on("data", (chunk) => {
      const parts = (rest + chunk).split("\n");
      rest = parts.pop();
      send(parts);
    });
    stop = () => child.kill();
  } else {
    const file = resolveFile(id);
    let position = fs.existsSync(file) ? fs.statSync(file).size : 0;
    let rest = "";
    let reading = false;
    const check = () => {
      if (reading) return;
      reading = true;
      fs.stat(file, (error, stat) => {
        if (error) return (reading = false);
        if (stat.size < position) position = 0; // rotated
        if (stat.size === position) return (reading = false);
        const stream = fs.createReadStream(file, { start: position, end: stat.size - 1, encoding: "utf8" });
        let text = "";
        stream.on("data", (chunk) => (text += chunk));
        stream.on("end", () => {
          position = stat.size;
          const parts = (rest + text).split("\n");
          rest = parts.pop();
          send(parts);
          reading = false;
        });
        stream.on("error", () => (reading = false));
      });
    };
    const timer = setInterval(check, 1000);
    stop = () => clearInterval(timer);
  }

  req.on("close", () => {
    clearInterval(ping);
    stop();
  });
}

module.exports = { sources, read, follow };
