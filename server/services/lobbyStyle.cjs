const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const assets = require("./bongoAssets.cjs");

/*
 * What the lobby cat wears (db/lobby-cat-style.json), set by FDC editors:
 *
 *   mode            "outfit"         one outfit (the default)
 *                   "random"         a completely random look (skin, hat, bongos)
 *                   "randomOutfits"  cycles through saved outfits
 *   outfit          { skin, hat, bongos } item ids (null skin = default cat)
 *   intervalMinutes how often the random modes change
 *   randomLists     outfit lists the "random outfits" mode uses ([] = all)
 *   temporary       { outfit, until } worn for everyone until a moment
 *   wearWinner      the winning FDC design is worn 10:00-24:00 on result day
 *   lists           shared outfit lists: [{ id, name, outfits: [{ id, name, outfit }] }]
 *
 * Order: temporary > birthday > FDC winner > mode. On someone's birthday
 * celebration (services/birthday.cjs) the cat wears their birthday dress
 * code all day, if they designed one.
 */

const FILE = path.join(__dirname, "db", "lobby-cat-style.json");
const FDC_ROOT = path.join(__dirname, "db", "fdc-polls");
const DEFAULT_OUTFIT = { skin: null, hat: null, bongos: "1319" };
const MODES = new Set(["outfit", "random", "randomOutfits"]);
const MAX_LISTS = 40;
const MAX_OUTFITS = 200;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

const defaults = () => ({
  version: 1,
  mode: "outfit",
  outfit: { ...DEFAULT_OUTFIT },
  intervalMinutes: 15,
  randomLists: [],
  temporary: null,
  wearWinner: true,
  lists: [],
  updatedAt: null,
  updatedBy: null,
});

function read() {
  try {
    return { ...defaults(), ...JSON.parse(fs.readFileSync(FILE, "utf8")) };
  } catch {
    return defaults();
  }
}

async function write(state) {
  await fsp.mkdir(path.dirname(FILE), { recursive: true });
  const temporary = `${FILE}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
  await fsp.rename(temporary, FILE);
}

/* ---------- outfits ---------- */

/** Cleans an outfit: ids must exist in the catalog and fit their slot. */
function cleanOutfit(raw) {
  const catalog = assets.readCatalog();
  const ids = new Map((catalog?.items ?? []).map((item) => [item.id, item.slot]));
  const pick = (value, slot) => {
    const id = value === null || value === undefined || value === "" ? null : String(value);
    if (id === null || id === "cat") return null;
    return ids.get(id) === slot ? id : null;
  };
  return { skin: pick(raw?.skin, "skin"), hat: pick(raw?.hat, "hat"), bongos: pick(raw?.bongos, "bongos") };
}

const cleanName = (value, fallback) => String(value ?? "").trim().slice(0, 60) || fallback;

/* ---------- deterministic randomness (same look for every visitor) ---------- */

function seeded(seed) {
  let value = crypto.createHash("sha256").update(String(seed)).digest().readUInt32LE(0);
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return ((value >>> 0) % 1_000_000) / 1_000_000;
  };
}

function randomLook(slot) {
  const catalog = assets.readCatalog();
  const items = (catalog?.items ?? []).filter((item) => !item.retired);
  const of = (kind) => items.filter((item) => item.slot === kind);
  const random = seeded(`look:${slot}`);
  const choose = (list) => (list.length ? list[Math.floor(random() * list.length)].id : null);
  return {
    skin: random() < 0.08 ? null : choose(of("skin")),
    hat: random() < 0.2 ? null : choose(of("hat")),
    bongos: random() < 0.15 ? null : choose(of("bongos")),
  };
}

function randomOutfit(state, slot) {
  const lists = state.randomLists.length ? state.lists.filter((list) => state.randomLists.includes(list.id)) : state.lists;
  const pool = lists.flatMap((list) => list.outfits);
  if (!pool.length) return null;
  // A fresh shuffle for every round through the pool, so nothing repeats too soon.
  const round = Math.floor(slot / pool.length);
  const random = seeded(`round:${round}`);
  const order = pool.map((outfit, index) => [random(), index]).sort((a, b) => a[0] - b[0]).map(([, index]) => pool[index]);
  return order[slot % pool.length];
}

/* ---------- the FDC winner ---------- */

/* Wall-clock parts of `date` in `timeZone`. */
function zoned(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return parts;
}

/* The UTC moment of a wall-clock time in `timeZone` (DST-safe enough for whole hours). */
function atZoned(dateKey, hour, timeZone) {
  const [year, month, day] = dateKey.split("-").map(Number);
  let guess = Date.UTC(year, month - 1, day, hour);
  for (let step = 0; step < 2; step += 1) {
    const parts = zoned(new Date(guess), timeZone);
    const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute));
    guess += Date.UTC(year, month - 1, day, hour) - shown;
  }
  return guess;
}

let winnerCache = { at: 0, value: null };

/** The latest finished FDC whose single winner has a design: `{ outfit, start, end, date, number }`. */
async function latestWinner() {
  if (Date.now() - winnerCache.at < 60_000) return winnerCache.value;
  let value = null;
  try {
    const { designPrimaryOutfit } = await import(path.join(__dirname, "..", "..", "shared", "bongo-design.mjs"));
    const dates = (await fsp.readdir(FDC_ROOT)).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort().reverse().slice(0, 4);
    for (const date of dates) {
      const poll = JSON.parse(await fsp.readFile(path.join(FDC_ROOT, date, "data.json"), "utf8"));
      if (poll.status !== "closed") continue;
      const winners = poll.statistics?.winningOptionNumbers ?? [];
      if (winners.length !== 1) break; // a tie: nobody wins the outfit
      const option = poll.options.find((entry) => entry.number === winners[0]);
      if (!option?.design?.spec) break;
      const closed = new Date(poll.closedAt?.iso ?? poll.endsAt?.iso ?? 0);
      const timeZone = poll.timeZone || "Europe/Berlin";
      const parts = zoned(closed, timeZone);
      const day = `${parts.year}-${parts.month}-${parts.day}`;
      const start = Math.max(atZoned(day, 10, timeZone), closed.getTime());
      const end = atZoned(day, 24, timeZone);
      value = { outfit: cleanOutfit(designPrimaryOutfit(option.design.spec)), start, end, date, number: option.number, description: option.description };
      break;
    }
  } catch {
    value = null;
  }
  winnerCache = { at: Date.now(), value };
  return value;
}

/* ---------- birthdays: the birthday person's dress code ---------- */

async function birthdayOutfit(now) {
  const birthdays = require("./birthday.cjs");
  const today = new Date(now);
  for (const userId of birthdays.celebratingOn(today)) {
    const dress = birthdays.currentDressCode(userId, today);
    if (!dress?.spec) continue;
    const { designPrimaryOutfit } = await import(path.join(__dirname, "..", "..", "shared", "bongo-design.mjs"));
    const midnight = new Date(today);
    midnight.setHours(24, 0, 0, 0);
    return { outfit: cleanOutfit(designPrimaryOutfit(dress.spec)), source: "birthday", until: midnight.getTime(), label: "Birthday dress code" };
  }
  return null;
}

/* ---------- what the cat wears now ---------- */

/** `{ outfit, source, until, label }`; `until`: when to ask again (ms) or null. */
async function resolve(now = Date.now()) {
  const state = read();
  if (state.temporary && Date.parse(state.temporary.until) > now) {
    return { outfit: cleanOutfit(state.temporary.outfit), source: "temporary", until: Date.parse(state.temporary.until), label: state.temporary.label ?? null };
  }
  const birthday = await birthdayOutfit(now);
  if (birthday) return birthday;
  if (state.wearWinner) {
    const winner = await latestWinner();
    if (winner && now >= winner.start && now < winner.end) {
      return { outfit: winner.outfit, source: "winner", until: winner.end, label: `FDC ${winner.date}, option ${winner.number}` };
    }
    if (winner && now < winner.start) {
      // Check again when the winner day starts.
      const next = await resolveMode(state, now);
      return { ...next, until: Math.min(next.until ?? Infinity, winner.start) };
    }
  }
  return resolveMode(state, now);
}

async function resolveMode(state, now) {
  const interval = Math.max(1, state.intervalMinutes) * 60_000;
  const slot = Math.floor(now / interval);
  const until = (slot + 1) * interval;
  if (state.mode === "random") return { outfit: cleanOutfit(randomLook(slot)), source: "random", until, label: null };
  if (state.mode === "randomOutfits") {
    const picked = randomOutfit(state, slot);
    if (picked) return { outfit: cleanOutfit(picked.outfit), source: "randomOutfits", until, label: picked.name };
  }
  return { outfit: cleanOutfit(state.outfit), source: "outfit", until: null, label: null };
}

/* ---------- editors ---------- */

/**
 * One change: `{ action, … }`. Returns the new state.
 *   wear            { outfit, until? }        until: ISO time -> temporary
 *   endTemporary
 *   mode            { mode, intervalMinutes?, randomLists? }
 *   winner          { enabled }
 *   addList         { name }                  renameList { id, name }   deleteList { id }
 *   addOutfit       { listId, name, outfit }  renameOutfit { listId, id, name }
 *   deleteOutfit    { listId, id }
 */
async function change(body, actor) {
  const state = read();
  const action = String(body?.action ?? "");
  const now = new Date().toISOString();
  const listOf = (id) => {
    const list = state.lists.find((entry) => entry.id === id);
    if (!list) throw httpError(404, "That outfit list doesn't exist any more.");
    return list;
  };
  let summary;

  switch (action) {
    case "wear": {
      const outfit = cleanOutfit(body.outfit);
      if (body.until) {
        const until = new Date(String(body.until));
        if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) throw httpError(400, "Pick a time in the future.");
        state.temporary = { outfit, until: until.toISOString(), label: cleanName(body.label, "") || null, setBy: actor?.name ?? null };
        summary = `dressed the lobby cat until ${until.toISOString()}`;
      } else {
        state.outfit = outfit;
        state.mode = "outfit";
        state.temporary = null;
        summary = "dressed the lobby cat";
      }
      break;
    }
    case "endTemporary":
      state.temporary = null;
      summary = "took off the lobby cat's temporary outfit";
      break;
    case "mode": {
      if (!MODES.has(body.mode)) throw httpError(400, "Unknown mode.");
      state.mode = body.mode;
      if (body.intervalMinutes !== undefined) {
        const minutes = Math.round(Number(body.intervalMinutes));
        if (!Number.isFinite(minutes) || minutes < 1 || minutes > 7 * 24 * 60) throw httpError(400, "Pick 1 minute to 7 days.");
        state.intervalMinutes = minutes;
      }
      if (Array.isArray(body.randomLists)) state.randomLists = body.randomLists.map(String).filter((id) => state.lists.some((list) => list.id === id));
      summary = `set the lobby cat to ${state.mode === "outfit" ? "one outfit" : state.mode === "random" ? "random looks" : "random outfits"}${state.mode === "outfit" ? "" : ` every ${state.intervalMinutes} min`}`;
      break;
    }
    case "winner":
      state.wearWinner = Boolean(body.enabled);
      summary = `${state.wearWinner ? "turned on" : "turned off"} the FDC winner outfit`;
      break;
    case "addList": {
      if (state.lists.length >= MAX_LISTS) throw httpError(400, `At most ${MAX_LISTS} lists.`);
      state.lists.push({ id: crypto.randomBytes(6).toString("hex"), name: cleanName(body.name, "New list"), outfits: [] });
      summary = `added the outfit list "${state.lists.at(-1).name}"`;
      break;
    }
    case "renameList": {
      const list = listOf(String(body.id));
      list.name = cleanName(body.name, list.name);
      summary = `renamed an outfit list to "${list.name}"`;
      break;
    }
    case "deleteList": {
      const list = listOf(String(body.id));
      state.lists = state.lists.filter((entry) => entry !== list);
      state.randomLists = state.randomLists.filter((id) => id !== list.id);
      summary = `deleted the outfit list "${list.name}" (${list.outfits.length} outfits)`;
      break;
    }
    case "addOutfit": {
      let list = body.listId ? listOf(String(body.listId)) : state.lists[0];
      if (!list) {
        list = { id: crypto.randomBytes(6).toString("hex"), name: "Outfits", outfits: [] };
        state.lists.push(list);
      }
      if (list.outfits.length >= MAX_OUTFITS) throw httpError(400, `At most ${MAX_OUTFITS} outfits per list.`);
      list.outfits.push({ id: crypto.randomBytes(6).toString("hex"), name: cleanName(body.name, "Outfit"), outfit: cleanOutfit(body.outfit), createdAt: now, createdBy: actor?.name ?? null });
      summary = `saved the outfit "${list.outfits.at(-1).name}" to "${list.name}"`;
      break;
    }
    case "renameOutfit": {
      const outfit = listOf(String(body.listId)).outfits.find((entry) => entry.id === String(body.id));
      if (!outfit) throw httpError(404, "That outfit doesn't exist any more.");
      outfit.name = cleanName(body.name, outfit.name);
      summary = `renamed an outfit to "${outfit.name}"`;
      break;
    }
    case "deleteOutfit": {
      const list = listOf(String(body.listId));
      const outfit = list.outfits.find((entry) => entry.id === String(body.id));
      if (!outfit) throw httpError(404, "That outfit doesn't exist any more.");
      list.outfits = list.outfits.filter((entry) => entry !== outfit);
      summary = `deleted the outfit "${outfit.name}"`;
      break;
    }
    default:
      throw httpError(400, "Unknown change.");
  }

  state.updatedAt = now;
  state.updatedBy = actor?.name ?? null;
  await write(state);
  return { state, summary };
}

module.exports = { read, resolve, change, cleanOutfit, latestWinner, FILE };
