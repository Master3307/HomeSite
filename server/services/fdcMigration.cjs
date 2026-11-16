const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

/*
 * Moving FDC options from pictures to designed cats.
 *
 * Old FDC options are pictures. New ones are designed cats (Bongo Cat
 * items, rendered by bongoRender). Every option that has a picture but no
 * design is "waiting for migration", wherever it is:
 *   - options of FDC polls (ended ones in the archive and running ones),
 *     id `p.<date>.<number>`, designed through the bot (fdcArchive
 *     `setDesigns`, the option then shows its design, the picture stays);
 *   - recycling-bin items whose poll is gone from the archive, id `b.<item>`
 *     (fdcRecycle `setDesign`).
 * A bin item that came from an archived option is the same cat: it is not
 * listed on its own, designing the option designs the bin copy too, and a
 * design the bin copy already has is offered as the starting point.
 *
 * Editors design directly (the old picture next to the designer), members
 * suggest a design that an editor approves, adjusts or rejects.
 *
 *   <archive>/recycling-bin/suggestions.json  { version: 1, suggestions: [...] }
 */

const ID_PATTERN = /^(?:b\.[A-Za-z0-9_-]{8,40}|p\.\d{4}-\d{2}-\d{2}\.[1-6])$/;
const SUGGESTION_PATTERN = /^[A-Za-z0-9_-]{8,40}$/;
const MAX_PENDING_TOTAL = 300;
const MAX_PENDING_PER_USER = 20;
const MAX_NOTE = 300;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function cleanNote(note) {
  return String(note ?? "")
    // oxlint-disable-next-line no-control-regex -- removing them is the point
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, MAX_NOTE);
}

/* Suggestions saved before poll options were part of the migration named bin items by their bare id. */
const normalizeId = (id) => (/^[A-Za-z0-9_-]{8,40}$/.test(String(id ?? "")) ? `b.${id}` : String(id ?? ""));

/**
 * `polls()`: the archive's polls, `[{ raw, public }]` (fdcPublic shape),
 * newest first. `designPoll(pollId, number, spec, actor)`: renders the
 * design and saves it on the option through the bot. `nameOf(discordId)`:
 * a display name for "designed by".
 */
const instances = new Set();

/* Account deleted: their suggestions go from every migration (members.cjs). */
async function forgetEverywhere(discordId) {
  for (const instance of instances) await instance.forget(discordId).catch((error) => console.warn("[FDC migration] Forget:", error.message));
}

function createMigration(archiveRoot, { recycleBin, renderDesign, polls, designPoll, nameOf = () => null }) {
  const BIN = path.join(archiveRoot, "recycling-bin");
  const FILE = path.join(BIN, "suggestions.json");
  let queue = Promise.resolve();

  async function load() {
    try {
      const data = JSON.parse(await fs.readFile(FILE, "utf8"));
      const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
      return { version: 1, suggestions: suggestions.map((entry) => ({ ...entry, itemId: normalizeId(entry.itemId) })) };
    } catch {
      return { version: 1, suggestions: [] };
    }
  }

  async function save(state) {
    await fs.mkdir(BIN, { recursive: true });
    const temporary = `${FILE}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await fs.rename(temporary, FILE);
  }

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

  const person = (actor) => (actor ? { discordId: actor.discordId, name: actor.name } : null);

  /* Who designed a poll option last (the archive's edit history keeps the Discord id). */
  function designerOf(raw, number) {
    const history = Array.isArray(raw.editHistory) ? raw.editHistory : [];
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const entry = history[index];
      if (entry?.designs?.some?.((item) => item?.number === number && item.design)) return { id: entry.by ?? null, at: entry.at?.iso ?? null };
    }
    return null;
  }

  /*
   * Every cat of the migration: `{ entries, binByKey }`. Entries carry
   * what the page shows (`imageUrl`, `designUrl` relative to the API).
   */
  async function collect() {
    const [archive, bin] = await Promise.all([polls(), recycleBin.snapshot()]);
    const binByKey = new Map(bin.items.map((item) => [item.key, item]));
    const entries = [];
    const covered = new Set();

    for (const { raw, public: poll } of archive) {
      if (raw.status === "creating") continue;
      const winners = poll.statistics?.winningOptionNumbers ?? [];
      for (const option of poll.options) {
        const rawOption = raw.options.find((entry) => entry.number === option.number);
        if (!rawOption?.media) continue; // designed from the start, or only a name
        const key = `${poll.date}:${option.number}`;
        const copy = binByKey.get(key) ?? null;
        if (copy) covered.add(copy.id);
        const designed = Boolean(rawOption.design);
        const designer = designed ? designerOf(raw, option.number) : null;
        const version = option.imageVersion ?? 0;
        entries.push({
          id: `p.${poll.date}.${option.number}`,
          source: "poll",
          pollId: poll.id,
          running: raw.status !== "closed" && Number(raw.endsAt?.ms) > Date.now(),
          binId: copy?.id ?? null,
          description: option.description,
          emoji: option.emoji,
          date: poll.date,
          optionNumber: option.number,
          won: winners.includes(option.number),
          imageUrl: `/fdc/images/${poll.date}/${option.number}.webp?v=${version}`,
          designUrl: designed ? `/fdc/images/${poll.date}/${rawOption.design.file}?v=${version}` : null,
          design: rawOption.design?.spec ?? null,
          // The bin copy was designed already: a head start.
          startDesign: !designed && copy?.design?.spec ? copy.design.spec : null,
          migratedAt: designer?.at ?? rawOption.design?.savedAt?.iso ?? null,
          migratedBy: designer?.id ? (nameOf(designer.id) ?? null) : null,
        });
      }
    }

    for (const item of bin.items) {
      if (covered.has(item.id)) continue;
      entries.push({
        id: `b.${item.id}`,
        source: "bin",
        binId: item.id,
        description: item.description,
        emoji: item.emoji,
        date: item.date,
        optionNumber: item.optionNumber,
        won: Boolean(item.won),
        imageUrl: `/fdc/recycle/images/${encodeURIComponent(item.id)}?v=${item.imageVersion ?? 0}`,
        designUrl: item.design ? `/fdc/recycle/designs/${encodeURIComponent(item.id)}?v=${item.design.revision ?? 0}` : null,
        design: item.design?.spec ?? null,
        startDesign: null,
        migratedAt: item.design?.at ?? null,
        migratedBy: item.design?.by?.name ?? null,
      });
    }
    return { entries, binByKey };
  }

  async function find(id) {
    if (!ID_PATTERN.test(String(id))) throw httpError(400, "Invalid cat.");
    const { entries } = await collect();
    // A bin item that came from an archived option is listed as that option.
    const entry = entries.find((item) => item.id === id) ?? (id.startsWith("b.") ? entries.find((item) => item.binId === id.slice(2)) : null);
    if (!entry) throw httpError(404, "That cat isn't there anymore.");
    return entry;
  }

  /* Renders and stores a design (editor or approved suggestion), on the option and its bin copy. */
  async function apply(id, spec, actor, extra = {}) {
    const entry = await find(id);
    if (entry.source === "poll") {
      await designPoll(entry.pollId, entry.optionNumber, spec, actor);
      // The bin copy is the same cat; one it has already keeps its own design.
      if (entry.binId && !entry.startDesign) {
        const rendered = await renderDesign(spec);
        await recycleBin.setDesign(entry.binId, rendered, actor, extra).catch((error) => console.warn("[FDC migration] Bin copy:", error.message));
      }
    } else {
      const rendered = await renderDesign(spec);
      await recycleBin.setDesign(entry.binId, rendered, actor, extra);
    }
    return { id: entry.id, description: entry.description, date: entry.date, optionNumber: entry.optionNumber, source: entry.source, design: spec };
  }

  const instance = {
    /**
     * Everything the migration page shows: `{ total, migrated, remaining,
     * done, suggestions }`. Editors get every pending suggestion, others
     * only their own.
     */
    async overview(viewer, { editor }) {
      const { entries } = await collect();
      const { suggestions } = await load();
      const exists = new Set(entries.filter((entry) => !entry.design).map((entry) => entry.id));
      const pending = suggestions.filter((entry) => entry.status === "pending" && exists.has(entry.itemId));
      const visible = editor ? pending : pending.filter((entry) => entry.by?.discordId === viewer.discordId);
      const withCount = (entry) => ({ ...entry, suggestions: pending.filter((item) => item.itemId === entry.id).length });
      const remaining = entries.filter((entry) => !entry.design).map(withCount);
      const done = entries.filter((entry) => entry.design).sort((a, b) => String(b.migratedAt ?? "").localeCompare(String(a.migratedAt ?? "")));
      return {
        total: entries.length,
        migrated: done.length,
        remaining,
        done,
        suggestions: visible.map((entry) => ({
          id: entry.id,
          itemId: entry.itemId,
          design: entry.design,
          note: entry.note,
          by: entry.by?.name ?? null,
          mine: entry.by?.discordId === viewer.discordId,
          at: entry.at,
        })),
        editor,
      };
    },

    /** Just the counts (the FDC section shows the Migration button while something is left). */
    async counts() {
      const { entries } = await collect();
      const remaining = entries.filter((entry) => !entry.design).length;
      return { total: entries.length, remaining, migrated: entries.length - remaining };
    },

    /** An editor designs a cat directly. */
    async design(id, spec, actor) {
      const result = await apply(id, spec, actor);
      // Suggestions for it are answered by this.
      await change(async (state) => {
        for (const entry of state.suggestions) {
          if (entry.itemId === result.id && entry.status === "pending") {
            entry.status = "superseded";
            entry.decidedAt = new Date().toISOString();
            entry.decidedBy = person(actor);
          }
        }
      });
      return result;
    },

    /** A member suggests a design. Nothing changes until an editor approves it. */
    async suggest(id, spec, note, actor, normalize) {
      const entry = await find(id);
      if (entry.design) throw httpError(409, "That cat already has a design.");
      id = entry.id;
      const design = await normalize(spec);
      return change(async (current) => {
        const pending = current.suggestions.filter((item) => item.status === "pending");
        if (pending.length >= MAX_PENDING_TOTAL) throw httpError(429, "Lots of suggestions are waiting already. Try again later.");
        const mine = pending.filter((item) => item.by?.discordId === actor.discordId);
        if (mine.length >= MAX_PENDING_PER_USER) throw httpError(429, "You have many suggestions waiting already. Wait until an editor looked at them.");
        // One open suggestion per person and cat: a new one replaces it.
        for (const item of mine) {
          if (item.itemId === id) {
            item.status = "replaced";
            item.decidedAt = new Date().toISOString();
          }
        }
        const suggestion = {
          id: crypto.randomBytes(9).toString("base64url"),
          itemId: id,
          design,
          note: cleanNote(note),
          by: person(actor),
          at: new Date().toISOString(),
          status: "pending",
        };
        current.suggestions.push(suggestion);
        // Keep the file small: decided suggestions older than 90 days go.
        const cutoff = Date.now() - 90 * 86_400_000;
        current.suggestions = current.suggestions.filter((item) => item.status === "pending" || Date.parse(item.decidedAt ?? item.at) > cutoff);
        return { id: suggestion.id, item: entry.description };
      });
    },

    /** An editor answers a suggestion. `approve`: optionally with their own changes (`spec`). */
    async decide(suggestionId, approve, actor, spec = null) {
      if (!SUGGESTION_PATTERN.test(String(suggestionId))) throw httpError(400, "Invalid suggestion.");
      const { suggestions } = await load();
      const found = suggestions.find((entry) => entry.id === suggestionId);
      if (!found || found.status !== "pending") throw httpError(404, "That suggestion was already answered.");
      let result = null;
      if (approve) result = await apply(found.itemId, spec ?? found.design, actor, { suggestedBy: found.by });
      return change(async (state) => {
        const now = new Date().toISOString();
        for (const entry of state.suggestions) {
          if (entry.id === suggestionId) {
            entry.status = approve ? "approved" : "rejected";
          } else if (approve && entry.itemId === found.itemId && entry.status === "pending") {
            entry.status = "superseded";
          } else continue;
          entry.decidedAt = now;
          entry.decidedBy = person(actor);
        }
        return { approved: approve, itemId: found.itemId, by: found.by, item: result?.description ?? null, source: result?.source ?? null };
      });
    },

    /** Removes a person from the suggestions (account deleted). */
    async forget(discordId) {
      return change(async (state) => {
        state.suggestions = state.suggestions
          .filter((entry) => !(entry.status === "pending" && entry.by?.discordId === discordId))
          .map((entry) => (entry.by?.discordId === discordId ? { ...entry, by: null } : entry));
      });
    },
  };
  instances.add(instance);
  return instance;
}

module.exports = { createMigration, forgetEverywhere };
