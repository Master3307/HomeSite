const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

/*
 * Site-wide activity log: who logged in, and what editors did on the
 * website (FDC polls, archive edits, votes from elsewhere, recycling bin,
 * emojis, …), with the exact changes.
 *
 * Append-only: there is no route or function to edit or delete entries.
 * Every entry stores the hash of the one before it, so changing or removing
 * a line in the file by hand breaks the chain, and `verify` reports it.
 *
 * Levels of an entry:
 *   risky   deleting things, creating polls, editing ended polls, …
 *   normal  everything else worth knowing (logins, edits, uploads, …)
 *   detail  small housekeeping (moving items between folders, …)
 *
 * Views (what `list` returns):
 *   risky    only risky entries
 *   normal   risky + normal entries, without the detailed change lists
 *   verbose  everything, with all details
 */

const LEVELS = new Set(["risky", "normal", "detail"]);
const MAX_LIMIT = 200;
const GENESIS = "0".repeat(64);

function createActivityLog(directory) {
  const FILE = path.join(directory, "activity-log.jsonl");

  let queue = Promise.resolve();
  let tail = null; // { seq, hash } of the last entry

  async function readAll() {
    let raw = "";
    try {
      raw = await fs.readFile(FILE, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { broken: true, line };
        }
      });
  }

  const hashOf = (entry) =>
    crypto
      .createHash("sha256")
      .update(JSON.stringify({ ...entry, hash: undefined }))
      .digest("hex");

  /**
   * Adds an entry. `actor`: { discordId, name }; `details`: anything that
   * describes the exact change (shown in the verbose view).
   */
  function append({ level = "normal", action, actor = null, summary, target = null, details = null }) {
    const run = queue.then(async () => {
      await fs.mkdir(directory, { recursive: true });

      if (!tail) {
        const entries = (await readAll()).filter((entry) => !entry.broken);
        const last = entries.at(-1);
        tail = last ? { seq: last.seq, hash: last.hash } : { seq: 0, hash: GENESIS };
      }

      const entry = {
        seq: tail.seq + 1,
        at: new Date().toISOString(),
        level: LEVELS.has(level) ? level : "normal",
        action: String(action),
        actor: actor ? { discordId: actor.discordId ?? null, name: actor.name ?? null } : null,
        summary: String(summary ?? action),
        target,
        details,
        prev: tail.hash,
      };
      entry.hash = hashOf(entry);

      await fs.appendFile(FILE, `${JSON.stringify(entry)}\n`, "utf8");
      tail = { seq: entry.seq, hash: entry.hash };
      return entry;
    });

    // Logging must never break the action that is being logged.
    queue = run.catch((error) => console.error("[Activity] Could not write the log:", error));
    return run.catch(() => null);
  }

  /** Newest first. `view`: risky | normal | verbose; `before`: seq cursor. */
  async function list({ view = "normal", before = null, limit = 50, search = "" } = {}) {
    await queue;
    const words = String(search).toLowerCase().split(/\s+/).filter(Boolean);
    const max = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || 50));

    const visible = (await readAll())
      .filter((entry) => !entry.broken)
      .filter((entry) =>
        view === "risky" ? entry.level === "risky" : view === "verbose" ? true : entry.level !== "detail",
      )
      .filter((entry) => !before || entry.seq < Number(before))
      .filter((entry) => {
        if (!words.length) return true;
        const text = `${entry.summary} ${entry.action} ${entry.actor?.name ?? ""} ${JSON.stringify(entry.target ?? "")}`.toLowerCase();
        return words.every((word) => text.includes(word));
      })
      .reverse();

    const page = visible.slice(0, max).map((entry) => ({
      seq: entry.seq,
      at: entry.at,
      level: entry.level,
      action: entry.action,
      actor: entry.actor,
      summary: entry.summary,
      target: entry.target,
      ...(view === "verbose" ? { details: entry.details } : {}),
    }));

    return { entries: page, next: visible.length > max ? page.at(-1).seq : null };
  }

  /** Whether the hash chain is intact (nothing edited or deleted). */
  async function verify() {
    await queue;
    let prev = GENESIS;
    let seq = 0;
    for (const entry of await readAll()) {
      if (entry.broken) return { intact: false, problemAt: seq + 1, reason: "unreadable line" };
      if (entry.prev !== prev || entry.seq !== seq + 1 || hashOf(entry) !== entry.hash) {
        return { intact: false, problemAt: entry.seq ?? seq + 1, reason: "changed or missing entry" };
      }
      prev = entry.hash;
      seq = entry.seq;
    }
    return { intact: true, entries: seq };
  }

  /** Forget the cached last entry (after the file was replaced by an import). */
  function reset() {
    tail = null;
  }

  return { append, list, verify, reset };
}

module.exports = { createActivityLog };
