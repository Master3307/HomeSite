const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const { toPublicPoll } = require("./fdcPublic.cjs");

/*
 * FDC recycling bin: options of ended polls (won or not) that editors keep
 * to reuse in later polls.
 *
 *   <archive>/recycling-bin/
 *     index.json        folders + items (the source of truth)
 *     history.jsonl     one line per change (who, what, when)
 *     <item>.webp       items without a folder
 *     <folder dir>/     one directory per folder: "<slug>-<folderId>"
 *       <item>.webp
 *
 * Moving an item to another folder moves its file too. Every read runs
 * `reconcile`, which finds image files that were moved by hand and drops
 * entries whose image is gone, so index and files stay in step.
 *
 * Items remember where they came from (poll date + option number), so an
 * option can be in the bin only once and shows up as a candidate again
 * when its item is removed.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{8,40}$/;
const MAX_FOLDER_NAME = 40;
const MAX_ITEMS_PER_REQUEST = 100;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

const newId = () => crypto.randomBytes(9).toString("base64url");

function slug(name) {
  return (
    String(name)
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_]+/g, "-")
      .toLowerCase()
      .slice(0, 30) || "folder"
  );
}

function cleanFolderName(name) {
  const value = String(name ?? "")
    // oxlint-disable-next-line no-control-regex -- removing them is the point
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, MAX_FOLDER_NAME);
  if (!value) throw httpError(400, "Give the folder a name.");
  return value;
}

function emojiValue(emoji) {
  if (!emoji) return "";
  if (emoji.id && emoji.name) return `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
  return emoji.display || "";
}

function createRecycleBin(archiveRoot) {
  const BIN = path.join(archiveRoot, "recycling-bin");
  const INDEX = path.join(BIN, "index.json");
  const HISTORY = path.join(BIN, "history.jsonl");

  let queue = Promise.resolve();

  /* Serialised read-modify-write of the bin. */
  function change(task) {
    const run = queue.then(async () => {
      const state = await load();
      const result = await task(state);
      await save(state);
      return result;
    });
    queue = run.catch(() => undefined);
    return run;
  }

  async function readJson(file, fallback) {
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return fallback;
      throw error;
    }
  }

  async function load() {
    await fs.mkdir(BIN, { recursive: true });
    const state = await readJson(INDEX, null);
    if (!state || state.version !== 1) return { version: 1, folders: [], items: [] };
    state.folders ??= [];
    state.items ??= [];
    return state;
  }

  async function save(state) {
    state.updatedAt = new Date().toISOString();
    const temporary = `${INDEX}.${newId()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await fs.rename(temporary, INDEX);
  }

  async function log(action, actor, details) {
    const entry = {
      at: new Date().toISOString(),
      action,
      by: actor ? { discordId: actor.discordId, name: actor.name } : null,
      ...details,
    };
    await fs.appendFile(HISTORY, `${JSON.stringify(entry)}\n`, "utf8").catch(() => {});
  }

  const folderDir = (folder) => (folder ? `${slug(folder.name)}-${folder.id}` : "");
  const itemFile = (folder, id) => path.posix.join(folderDir(folder), `${id}.webp`);
  const findFolder = (state, id) => (id ? state.folders.find((folder) => folder.id === id) ?? null : null);

  /* Every image file in the bin by item id (to find files moved by hand). */
  async function scanFiles() {
    const found = new Map();
    const entries = await fs.readdir(BIN, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".webp")) {
        found.set(entry.name.slice(0, -5), entry.name);
      } else if (entry.isDirectory()) {
        for (const file of await fs.readdir(path.join(BIN, entry.name)).catch(() => [])) {
          if (file.endsWith(".webp")) found.set(file.slice(0, -5), path.posix.join(entry.name, file));
        }
      }
    }
    return found;
  }

  /* Index and files in step: follow moved files, drop items whose image is gone. */
  async function reconcile(state) {
    const files = await scanFiles();
    let changed = false;

    for (const folder of state.folders) {
      await fs.mkdir(path.join(BIN, folderDir(folder)), { recursive: true });
    }

    state.items = state.items.filter((item) => {
      const actual = files.get(item.id);
      if (!actual) {
        changed = true;
        return false;
      }
      if (actual !== item.file) {
        item.file = actual;
        changed = true;
      }
      // The directory a file is in decides its folder.
      const dir = path.posix.dirname(actual);
      const folderId = dir === "." ? null : (state.folders.find((folder) => folderDir(folder) === dir)?.id ?? null);
      if (item.folderId !== folderId) {
        item.folderId = folderId;
        changed = true;
      }
      return true;
    });

    return changed;
  }

  async function snapshot() {
    return change(async (state) => {
      await reconcile(state);
      return structuredClone(state);
    });
  }

  /* Ended polls in the archive, newest first (public shape + raw options). */
  async function endedPolls() {
    const polls = [];
    const entries = await fs.readdir(archiveRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || !DATE_PATTERN.test(entry.name)) continue;
      const raw = await readJson(path.join(archiveRoot, entry.name, "data.json"), null);
      if (!raw) continue;
      const ended =
        raw.status === "closed" || (raw.status !== "creating" && Number(raw.endsAt?.ms) <= Date.now());
      if (!ended) continue;
      try {
        polls.push({ raw, public: toPublicPoll(raw, entry.name) });
      } catch {
        // Broken archive entry: skip it.
      }
    }
    return polls.sort((a, b) => b.public.date.localeCompare(a.public.date));
  }

  function describeOption(poll, option) {
    const stats = poll.public.statistics.options.find((entry) => entry.optionNumber === option.number);
    return {
      key: `${poll.public.date}:${option.number}`,
      pollId: poll.public.id,
      date: poll.public.date,
      optionNumber: option.number,
      optionCount: poll.public.options.length,
      description: option.description,
      emoji: { ...option.emoji, value: emojiValue(option.emoji) },
      won: poll.public.statistics.winningOptionNumbers.includes(option.number),
      tie: poll.public.statistics.isTie,
      votes: stats?.votes ?? 0,
      percentage: stats?.percentage ?? 0,
      totalVoters: poll.public.statistics.totalVoters,
      imageVersion: option.imageVersion ?? 0,
    };
  }

  return {
    /** `{ folders, items }` (items with folderId, source, recycler, …). */
    snapshot,

    /** Options of ended polls that are not in the bin. */
    async candidates() {
      const state = await snapshot();
      const inBin = new Set(state.items.map((item) => item.key));
      const list = [];
      for (const poll of await endedPolls()) {
        for (const option of poll.public.options) {
          const described = describeOption(poll, option);
          if (!inBin.has(described.key)) list.push(described);
        }
      }
      return list;
    },

    /** Keys ("date:number") of options already in the bin. */
    async keys() {
      const state = await snapshot();
      return state.items.map((item) => item.key);
    },

    async add({ options, folderId }, actor) {
      if (!Array.isArray(options) || !options.length) throw httpError(400, "Pick at least one option.");
      if (options.length > MAX_ITEMS_PER_REQUEST) throw httpError(400, "Too many options at once.");

      const polls = new Map((await endedPolls()).map((poll) => [poll.public.date, poll]));

      return change(async (state) => {
        await reconcile(state);
        const folder = findFolder(state, folderId);
        if (folderId && !folder) throw httpError(404, "That folder doesn't exist anymore.");

        const added = [];
        const existing = new Set(state.items.map((item) => item.key));

        for (const request of options) {
          const date = String(request?.date ?? "");
          const number = Number(request?.optionNumber);
          if (!DATE_PATTERN.test(date) || !Number.isInteger(number)) throw httpError(400, "Invalid option.");

          const poll = polls.get(date);
          if (!poll) throw httpError(409, `The FDC from ${date} hasn't ended (or doesn't exist).`);
          const option = poll.public.options.find((entry) => entry.number === number);
          if (!option) throw httpError(404, `Option ${number} of ${date} doesn't exist.`);

          const key = `${date}:${number}`;
          if (existing.has(key)) continue;

          const id = newId();
          const file = itemFile(folder, id);
          const rawOption = poll.raw.options.find((entry) => entry.number === number);
          const source = path.join(archiveRoot, date, rawOption?.media?.localFile ?? option.image);
          await fs.copyFile(source, path.join(BIN, file)).catch(() => {
            throw httpError(404, `The image of option ${number} (${date}) is missing.`);
          });

          const item = {
            ...describeOption(poll, option),
            id,
            folderId: folder?.id ?? null,
            file,
            recycledBy: actor,
            recycledAt: new Date().toISOString(),
            media: {
              width: rawOption?.media?.width ?? null,
              height: rawOption?.media?.height ?? null,
              pages: rawOption?.media?.pages ?? 1,
            },
          };
          state.items.push(item);
          existing.add(key);
          added.push(item);
        }

        await log("add", actor, { items: added.map((item) => ({ id: item.id, key: item.key })), folderId: folder?.id ?? null });
        return { added: added.length };
      });
    },

    async remove(ids, actor) {
      const wanted = new Set((Array.isArray(ids) ? ids : []).filter((id) => ID_PATTERN.test(String(id))));
      if (!wanted.size) throw httpError(400, "Nothing to remove.");

      return change(async (state) => {
        await reconcile(state);
        const removed = state.items.filter((item) => wanted.has(item.id));
        for (const item of removed) await fs.rm(path.join(BIN, item.file), { force: true });
        state.items = state.items.filter((item) => !wanted.has(item.id));
        await log("remove", actor, { items: removed.map((item) => ({ id: item.id, key: item.key })) });
        return { removed: removed.length };
      });
    },

    async move(ids, folderId, actor) {
      const wanted = new Set((Array.isArray(ids) ? ids : []).filter((id) => ID_PATTERN.test(String(id))));
      if (!wanted.size) throw httpError(400, "Nothing to move.");

      return change(async (state) => {
        await reconcile(state);
        const folder = findFolder(state, folderId);
        if (folderId && !folder) throw httpError(404, "That folder doesn't exist anymore.");

        let moved = 0;
        for (const item of state.items) {
          if (!wanted.has(item.id) || item.folderId === (folder?.id ?? null)) continue;
          const file = itemFile(folder, item.id);
          await fs.rename(path.join(BIN, item.file), path.join(BIN, file));
          item.file = file;
          item.folderId = folder?.id ?? null;
          moved += 1;
        }

        await log("move", actor, { items: [...wanted], folderId: folder?.id ?? null });
        return { moved };
      });
    },

    async createFolder(name, actor) {
      const clean = cleanFolderName(name);
      return change(async (state) => {
        if (state.folders.some((folder) => folder.name.toLowerCase() === clean.toLowerCase())) {
          throw httpError(409, `There's already a folder called "${clean}".`);
        }
        const folder = { id: newId(), name: clean, createdAt: new Date().toISOString(), createdBy: actor };
        await fs.mkdir(path.join(BIN, folderDir(folder)), { recursive: true });
        state.folders.push(folder);
        await log("folder-create", actor, { folder: { id: folder.id, name: clean } });
        return folder;
      });
    },

    async renameFolder(id, name, actor) {
      const clean = cleanFolderName(name);
      return change(async (state) => {
        await reconcile(state);
        const folder = findFolder(state, id);
        if (!folder) throw httpError(404, "That folder doesn't exist anymore.");
        if (state.folders.some((other) => other.id !== id && other.name.toLowerCase() === clean.toLowerCase())) {
          throw httpError(409, `There's already a folder called "${clean}".`);
        }

        const before = folderDir(folder);
        const old = folder.name;
        folder.name = clean;
        const after = folderDir(folder);

        if (before !== after) {
          await fs.rename(path.join(BIN, before), path.join(BIN, after));
          for (const item of state.items) {
            if (item.folderId === id) item.file = path.posix.join(after, path.posix.basename(item.file));
          }
        }

        await log("folder-rename", actor, { folder: { id, from: old, to: clean } });
        return folder;
      });
    },

    /** Deletes a folder; its items move out of it (to the top level). */
    async deleteFolder(id, actor) {
      return change(async (state) => {
        await reconcile(state);
        const folder = findFolder(state, id);
        if (!folder) throw httpError(404, "That folder doesn't exist anymore.");

        for (const item of state.items) {
          if (item.folderId !== id) continue;
          const file = itemFile(null, item.id);
          await fs.rename(path.join(BIN, item.file), path.join(BIN, file));
          item.file = file;
          item.folderId = null;
        }
        await fs.rm(path.join(BIN, folderDir(folder)), { recursive: true, force: true });
        state.folders = state.folders.filter((entry) => entry.id !== id);

        await log("folder-delete", actor, { folder: { id, name: folder.name } });
        return { deleted: true };
      });
    },

    /** Absolute path of an item's image, or null. */
    async imagePath(id) {
      if (!ID_PATTERN.test(String(id))) return null;
      const state = await snapshot();
      const item = state.items.find((entry) => entry.id === id);
      return item ? path.join(BIN, item.file) : null;
    },
  };
}

module.exports = { createRecycleBin };
