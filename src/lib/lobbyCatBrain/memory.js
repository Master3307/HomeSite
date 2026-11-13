/*
 * LobbyCat's memory in this browser (localStorage).
 *
 * - visits / firstSeenAt / lastSeenAt: to tell strangers, returning visitors
 *   and long absences apart.
 * - lastAccountId / lastLoggedIn: to notice logins, re-logins and switches.
 * - milestones: things that happened once or rarely ("intro", "pet:first",
 *   "cultbot:met", …) as { id: { count, first, last } }. For logged-in users
 *   they are also stored on the account (see progress.js), so the cat
 *   doesn't introduce itself again on another device.
 * - daily: once-per-day remarks (`{ key: "YYYY-MM-DD" }`), local only.
 * - rotation: which variant of each line was said last, so lines rotate
 *   instead of repeating.
 * - progress: trust points/level/streak for guests (accounts use the server).
 */

const STORAGE_KEY = "homesite:lobbyCat";
const VERSION = 1;

function emptyProgress() {
  return {
    points: 0,
    level: 0,
    totalPets: 0,
    streak: 0,
    bestStreak: 0,
    lastPetDay: null,
    day: null,
    dayPetPoints: 0,
    lastMood: null,
    lastMoodDay: null,
  };
}

function emptyMemory() {
  return {
    v: VERSION,
    firstSeenAt: null,
    lastSeenAt: null,
    visits: 0,
    lastAccountId: null,
    lastLoggedIn: false,
    interactions: 0,
    lastMoodAskAt: null,
    milestones: {},
    daily: {},
    rotation: {},
    progress: emptyProgress(),
  };
}

export function loadMemory() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!stored || stored.v !== VERSION) return emptyMemory();

    const memory = { ...emptyMemory(), ...stored };
    memory.progress = { ...emptyProgress(), ...stored.progress };
    return memory;
  } catch {
    return emptyMemory();
  }
}

export function saveMemory(memory) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // Storage blocked: the cat just forgets after this visit.
  }
}

export function localDay(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function shiftDay(day, offset) {
  const [year, month, date] = day.split("-").map(Number);
  return localDay(new Date(year, month - 1, date + offset));
}

/** Records a milestone hit in `milestones` (mutates) and returns the entry. */
export function addMilestone(milestones, id, at = new Date().toISOString()) {
  const entry = milestones[id];
  milestones[id] = {
    count: (entry?.count ?? 0) + 1,
    first: entry?.first ?? at,
    last: at,
  };
  return milestones[id];
}

/** Keeps the entry with more hits / the latest timestamp for each id. */
export function mergeMilestones(...sources) {
  const merged = {};

  for (const source of sources) {
    for (const [id, entry] of Object.entries(source ?? {})) {
      const current = merged[id];
      merged[id] = current
        ? {
            count: Math.max(current.count, entry.count ?? 0),
            first: [current.first, entry.first].filter(Boolean).sort()[0] ?? null,
            last: [current.last, entry.last].filter(Boolean).sort().at(-1) ?? null,
          }
        : { ...entry };
    }
  }

  return merged;
}

/*
 * Index of the next variant to say for `key`. Variants come out of a
 * shuffled "bag": every variant is used once before any repeats, in a
 * random order, and a new bag never starts with the line said last.
 */
export function nextVariant(memory, key, length) {
  if (length <= 1) return 0;

  let entry = memory.rotation[key];
  if (!entry || typeof entry !== "object" || !Array.isArray(entry.bag)) {
    entry = { bag: [], last: Number.isInteger(entry) ? entry : null };
  }

  let bag = entry.bag.filter((index) => Number.isInteger(index) && index < length);
  if (!bag.length) {
    bag = Array.from({ length }, (_, index) => index).filter((index) => index !== entry.last);
    for (let i = bag.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }

  const next = bag.shift();
  memory.rotation[key] = { bag, last: next };
  return next;
}
