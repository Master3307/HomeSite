import { accountFetch } from "../account";
import { localDay, shiftDay } from "./memory";

/*
 * Trust points, levels and petting streaks.
 *
 * Logged-in users: the account API scores everything
 * (server/services/lobbyCat.cjs) and stores it with the account; this module
 * batches events and sends them. Guests: the same rules are applied locally
 * and kept in the browser. Keep LEVELS/POINTS in sync with the server.
 */

// Exponential: each level needs about 1.7× the points of the one before.
export const LEVELS = [0, 30, 90, 200, 400, 750, 1350, 2400, 4200, 7300, 12500, 21000];

const POINTS = {
  pet: 1,
  dailyPetCap: 60,
  firstPetOfDay: 3,
  streakBonusPerDay: 2,
  streakBonusMaxDays: 10,
  mood: 5,
};

const FLUSH_DELAY_MS = 1500;

export function levelFor(points) {
  let level = 0;
  LEVELS.forEach((threshold, index) => {
    if (points >= threshold) level = index;
  });
  return level;
}

/** Guest scoring; mirrors applyEvents() on the server. Mutates `progress`. */
function applyLocally(progress, { pets = 0, mood = null }) {
  const day = localDay();
  const before = levelFor(progress.points);
  let gained = 0;
  let streak = null;

  if (progress.day !== day) {
    progress.day = day;
    progress.dayPetPoints = 0;
  }

  if (pets > 0) {
    if (progress.lastPetDay !== day) {
      progress.streak =
        progress.lastPetDay === shiftDay(day, -1) ? progress.streak + 1 : 1;
      progress.bestStreak = Math.max(progress.bestStreak, progress.streak);
      progress.lastPetDay = day;

      const bonus =
        POINTS.firstPetOfDay +
        POINTS.streakBonusPerDay * Math.min(progress.streak - 1, POINTS.streakBonusMaxDays);
      gained += bonus;
      streak = { streak: progress.streak, bonus };
    }

    const petPoints = Math.min(
      pets * POINTS.pet,
      Math.max(0, POINTS.dailyPetCap - progress.dayPetPoints),
    );
    progress.dayPetPoints += petPoints;
    progress.totalPets += pets;
    gained += petPoints;
  }

  if (mood && progress.lastMoodDay !== day) {
    progress.lastMood = mood;
    progress.lastMoodDay = day;
    gained += POINTS.mood;
  }

  progress.points += gained;
  progress.level = levelFor(progress.points);

  return { gained, leveledUp: progress.level > before ? progress.level : null, streak };
}

export async function fetchServerProgress() {
  try {
    const response = await accountFetch("/lobby-cat", { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()).state ?? null;
  } catch {
    return null;
  }
}

/**
 * Collects events and applies them locally (guest) or on the server
 * (account). `onResult(result, progress)` is called after each application.
 */
export function createProgressSync({ mode, localProgress, onResult, onError }) {
  let pending = { pets: 0, mood: null, milestones: [] };
  let timer = null;
  let inFlight = false;

  function hasPending() {
    return pending.pets > 0 || pending.mood || pending.milestones.length > 0;
  }

  async function flush({ keepalive = false } = {}) {
    clearTimeout(timer);
    timer = null;
    if (mode !== "server" || inFlight || !hasPending()) return;

    const batch = pending;
    pending = { pets: 0, mood: null, milestones: [] };
    inFlight = true;

    try {
      const response = await accountFetch("/lobby-cat/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day: localDay(), ...batch }),
        keepalive,
      });
      if (!response.ok) throw new Error(`LobbyCat sync failed (${response.status}).`);

      const { state, result } = await response.json();
      onResult?.(result, state);
    } catch (error) {
      // Put the events back and try again with the next batch.
      pending = {
        pets: Math.min(60, pending.pets + batch.pets),
        mood: pending.mood ?? batch.mood,
        milestones: [...batch.milestones, ...pending.milestones].slice(0, 25),
      };
      onError?.(error);
    } finally {
      inFlight = false;
      if (hasPending() && !timer) schedule();
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(flush, FLUSH_DELAY_MS);
  }

  function record(events) {
    if (mode === "server") {
      pending.pets += events.pets ?? 0;
      if (events.mood) pending.mood = events.mood;
      if (events.milestone) pending.milestones.push(events.milestone);
      schedule();
      return;
    }

    if (events.pets || events.mood) {
      const result = applyLocally(localProgress, events);
      onResult?.(result, localProgress);
    }
  }

  function onPageHide() {
    flush({ keepalive: true });
  }

  window.addEventListener("pagehide", onPageHide);

  return {
    recordPet: () => record({ pets: 1 }),
    recordMood: (mood) => record({ mood }),
    recordMilestone: (id) => record({ milestone: id }),
    flush,
    dispose() {
      window.removeEventListener("pagehide", onPageHide);
      flush({ keepalive: true });
    },
  };
}
