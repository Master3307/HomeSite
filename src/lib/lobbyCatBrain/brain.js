import { siteConfig } from "../siteConfig";
import { getSavedGuestName } from "../lobby";
import {
  addMilestone,
  loadMemory,
  localDay,
  mergeMilestones,
  nextVariant,
  saveMemory,
  shiftDay,
} from "./memory";
import { createProgressSync, fetchServerProgress, levelFor } from "./progress";
import { MODULES } from "./modules";

/*
 * LobbyCat's brain: keeps memory and trust progress, and runs the modules
 * in modules.js for each event. The component (components/cult/LobbyCat.jsx)
 * provides speech: `speak(texts, { priority })`, `ask(question)` and
 * `isBusy()`; this file never draws anything.
 *
 * Activation: the cat stays quiet until someone pets it for the first time
 * (milestone "activated", stored in this browser and, when logged in, on
 * the account). Only then does it greet, remark or chatter on its own.
 *
 * Pacing: anything the cat says on its own goes through a "drip" queue that
 * lets out one line at a time with a pause of DRIP_GAP_MS in between, so a
 * visit starts with one line instead of a wall of text and stays lively.
 * Replies to pets and clicks are immediate.
 */

const NEW_VISIT_GAP_MS = 30 * 60 * 1000;
const ARRIVE_DELAY_MS = 1600;
const DRIP_CHECK_MS = 1500;
const DRIP_GAP_MS = [22_000, 40_000]; // random pause between unprompted lines
const IDLE_FIRST_MS = 100_000; // first idle line after this much quiet
const IDLE_GAP_MS = [150_000, 300_000]; // later ones, randomly spaced
const MAX_IDLE_LINES = 4;
const HOVER_TEASE_MS = 3500;
const TAB_AWAY_MS = 5 * 60 * 1000;

/*
 * Who arrived is worked out once per page load: React (StrictMode) may mount
 * the cat twice, and coming back to /cult in the same tab shouldn't count as
 * a new visit or greet again.
 */
let pageVisit = null;

// Special people, matched by Discord ID (never by name):
// LobbyCat's owner (~ MrKoby07 ~) and the cult leader (RottedFox13, "Fox").
export const OWNER_DISCORD_ID = siteConfig.ownerDiscordId;
export const LEADER_DISCORD_ID = siteConfig.leaderDiscordId;
const LEADER_NAME = "Fox";

function accountKind(account) {
  if (!account) return "guest";
  if (account.isAdminSession) return "admin";
  if (LEADER_DISCORD_ID && account.discordUserId === LEADER_DISCORD_ID) return "leader";
  if (OWNER_DISCORD_ID && account.discordUserId === OWNER_DISCORD_ID) return "owner";
  return "user";
}

const between = ([min, max]) => min + Math.random() * (max - min);

export function createLobbyCatBrain({ getT, speak, ask, isBusy }) {
  const memory = loadMemory();
  const session = {
    pets: 0,
    petTimes: [],
    lastPetAt: 0,
    sinceLastPet: null,
    lastSpokeAt: 0,
    lastActivityAt: Date.now(),
    askedQuestion: false,
    noticed: new Set(),
    idleLines: 0,
    nextIdleAt: 0,
    hadFirstPetBefore: null,
    awaySince: null,
  };

  let account = null;
  let kind = "guest";
  let visit = {};
  let serverMilestones = {};
  let progress = memory.progress;
  let sync = null;
  let disposed = false;
  let arrived = false;
  const timers = new Set();

  // Unprompted lines waiting their turn: [{ text, options }]
  const drip = [];
  let nextDripAt = 0;

  const later = (fn, ms) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!disposed) fn();
    }, ms);
    timers.add(timer);
  };

  function milestones() {
    return mergeMilestones(memory.milestones, serverMilestones);
  }

  /* Petted at least once, here or on the account (older visitors too). */
  function isActive() {
    const all = milestones();
    return Boolean(all.activated || all["pet:first"]);
  }

  function activatedAt() {
    const all = milestones();
    const first = all.activated?.first ?? all["pet:first"]?.first;
    return first ? Date.parse(first) : null;
  }

  function speakNow(list, options) {
    const now = Date.now();
    session.lastSpokeAt = now;
    // Anything said pushes the next unprompted line back a full pause.
    nextDripAt = Math.max(nextDripAt, now + between(DRIP_GAP_MS));
    speak(list, options);
  }

  function context() {
    const t = getT();
    const now = Date.now();
    const date = new Date(now);
    const today = localDay(date);
    const level = levelFor(progress.points ?? 0);

    const ctx = {
      t,
      kind,
      account,
      name:
        (kind === "leader" && LEADER_NAME) ||
        account?.displayName ||
        (kind === "guest" ? getSavedGuestName() : "") ||
        null,
      // The owner and the leader are always trusted completely.
      trust: kind === "owner" || kind === "leader" ? Infinity : level,
      level,
      progress,
      memory,
      session,
      visit,
      now,
      hour: date.getHours(),
      weekday: date.getDay(),
      today,
      yesterday: shiftDay(today, -1),
      activatedAt: activatedAt(),
      active: isActive(),

      busy: isBusy,
      milestones,
      shiftDay,
      has: (id) => Boolean(milestones()[id]),
      hit(id) {
        addMilestone(memory.milestones, id);
        saveMemory(memory);
        if (kind !== "guest" && sync) sync.recordMilestone(id);
      },
      /** True once per day for `key` (and marks it as used). */
      daily(key) {
        if (memory.daily[key] === today) return false;
        memory.daily[key] = today;
        saveMemory(memory);
        return true;
      },

      /** One variant of a line; variants are shuffled and never repeat back to back. */
      line(key, vars = {}) {
        const variants = t(key, { ...vars, returnObjects: true });
        if (!Array.isArray(variants)) return t(key, vars);

        const index = nextVariant(memory, key, variants.length);
        saveMemory(memory);
        return t(`${key}.${index}`, vars);
      },
      /**
       * A sequence of lines. `key` holds either one sequence (strings) or
       * several variants of it (arrays of strings), from which one is picked.
       */
      seq(key, vars = {}) {
        const value = t(key, { ...vars, returnObjects: true });
        if (!Array.isArray(value)) return [t(key, vars)];

        if (value.length && Array.isArray(value[0])) {
          const index = nextVariant(memory, key, value.length);
          saveMemory(memory);
          return value[index].map((_line, line) => t(`${key}.${index}.${line}`, vars));
        }
        return value.map((_line, index) => t(`${key}.${index}`, vars));
      },
      levelName: (value) => t(`levels.${value}`),

      /** Say right away (replies to the user). */
      say(texts, options) {
        const list = texts.filter(Boolean);
        if (list.length) speakNow(list, options);
      },
      /** Say on its own, in turn, one line at a time with pauses. */
      later(texts, options = {}) {
        for (const text of texts.filter(Boolean)) drip.push({ text, options });
      },
      ask(question) {
        session.lastSpokeAt = Date.now();
        ask(question);
      },
      recordMood: (mood) => sync?.recordMood(mood),
    };

    return ctx;
  }

  function run(event, ...args) {
    const ctx = context();
    if (event === "notice") ctx.event = args[0];
    for (const module of MODULES[event] ?? []) {
      try {
        if (module.run(ctx, ...args)) return true;
      } catch (error) {
        console.warn(`[LobbyCat] Module ${event}/${module.id} failed:`, error);
      }
    }
    return false;
  }

  function runAll(event, ...args) {
    const ctx = context();
    for (const module of MODULES[event] ?? []) {
      try {
        module.run(ctx, ...args);
      } catch (error) {
        console.warn(`[LobbyCat] Module ${event}/${module.id} failed:`, error);
      }
    }
  }

  /* Lets one queued line out when the cat is free and has been quiet a while. */
  function pumpDrip() {
    if (disposed || !drip.length || isBusy()) return;
    if (document.visibilityState !== "visible") return;
    const now = Date.now();
    if (now < nextDripAt) return;

    const { text, options } = drip.shift();
    speakNow([text], options);
  }

  function onProgress(result, state) {
    if (state) {
      progress = { ...progress, ...state };
      if (state.milestones) serverMilestones = state.milestones;
      if (kind === "guest") {
        memory.progress = progress;
        saveMemory(memory);
      }
    }
    runAll("progress", result);
  }

  function greet() {
    if (pageVisit.greeted) return;
    pageVisit.greeted = true;
    if (!isActive()) return; // Quiet until the first pet.

    run("arrive");
    run("context");
    runAll("milestones");
  }

  // Coming back to the tab after a while is worth a little remark.
  function onVisibility() {
    if (document.visibilityState === "hidden") {
      session.awaySince = Date.now();
      return;
    }
    const away = session.awaySince ? Date.now() - session.awaySince : 0;
    session.awaySince = null;
    if (away >= TAB_AWAY_MS && arrived && isActive()) {
      run("notice", { type: "tab-return", detail: { away } });
    }
  }
  document.addEventListener("visibilitychange", onVisibility);

  const dripTimer = setInterval(pumpDrip, DRIP_CHECK_MS);
  let hoverTimer = null;

  return {
    /** Page opened: work out who this is and greet them (or not). */
    async arrive(currentAccount) {
      account = currentAccount ?? null;
      kind = accountKind(account);

      const accountId = account?.id ?? null;

      if (!pageVisit || pageVisit.visit.accountId !== accountId) {
        const now = Date.now();
        const absenceMs = memory.lastSeenAt ? now - memory.lastSeenAt : null;
        const isNewVisit = absenceMs === null || absenceMs > NEW_VISIT_GAP_MS;

        pageVisit = {
          greeted: false,
          visit: {
            firstEver: !memory.firstSeenAt,
            isNewVisit,
            absenceMs: absenceMs ?? 0,
            accountId,
            previousAccountId: memory.lastAccountId,
            justLoggedIn: Boolean(
              account && (memory.lastAccountId !== account.id || !memory.lastLoggedIn),
            ),
          },
        };

        memory.firstSeenAt ??= now;
        if (isNewVisit) memory.visits += 1;
        memory.lastSeenAt = now;
        if (account) memory.lastAccountId = account.id;
        memory.lastLoggedIn = Boolean(account);
        saveMemory(memory);
      }

      visit = pageVisit.visit;

      // Accounts keep trust and milestones (activation too) on the server.
      const serverMode = Boolean(account) && !account.local;

      if (serverMode) {
        const state = await fetchServerProgress();
        if (disposed) return;

        if (state) {
          progress = state;
          serverMilestones = state.milestones ?? {};
        }
      }

      sync = createProgressSync({
        mode: serverMode ? "server" : "local",
        localProgress: memory.progress,
        onResult: onProgress,
      });

      // Share milestones from this browser with the account (activation, intro, …).
      if (serverMode) {
        for (const id of Object.keys(memory.milestones)) {
          if (!serverMilestones[id]) sync.recordMilestone(id);
        }
      }

      arrived = true;
      session.nextIdleAt = Date.now() + IDLE_FIRST_MS;
      nextDripAt = Date.now() + ARRIVE_DELAY_MS;
      later(greet, ARRIVE_DELAY_MS);
    },

    /** The cat was clicked. Hearts are the component's job; this decides on words. */
    pet() {
      const now = Date.now();
      session.sinceLastPet = session.lastPetAt ? now - session.lastPetAt : null;
      session.lastPetAt = now;
      session.pets += 1;
      session.petTimes = [...session.petTimes.filter((time) => now - time < 3000), now];
      session.lastActivityAt = now;
      session.hadFirstPetBefore ??= isActive();
      memory.interactions += 1;
      saveMemory(memory);

      sync?.recordPet();

      // The very first pet wakes the cat up: it's happy about the pet first,
      // everything else (greeting, intro) follows slowly afterwards.
      if (!isActive()) {
        run("activate");
        if (pageVisit) pageVisit.greeted = true;
        return;
      }

      run("pet");
    },

    /** The pointer rests on the cat (the component reports enter / leave). */
    hover(active) {
      if (hoverTimer) clearTimeout(hoverTimer);
      hoverTimer = null;
      if (!active || !arrived) return;

      hoverTimer = setTimeout(() => {
        hoverTimer = null;
        if (!disposed) run("notice", { type: "hover", detail: {} });
      }, HOVER_TEASE_MS);
    },

    /** Something happened on the page (see catNotice in lib/lobbyCat.js). */
    notice(type, detail) {
      if (!pageVisit?.greeted || !isActive()) return;
      session.lastActivityAt = Date.now();
      run("notice", { type, detail });
    },

    /** Called every few seconds; may say something after a quiet while. */
    tick() {
      if (!arrived || !isActive() || document.visibilityState !== "visible" || isBusy()) return;
      if (drip.length || session.idleLines >= MAX_IDLE_LINES) return;

      const now = Date.now();
      const quietFor = now - Math.max(session.lastActivityAt, session.lastSpokeAt);
      if (now < session.nextIdleAt || quietFor < IDLE_FIRST_MS / 2) return;

      session.idleLines += 1;
      session.nextIdleAt = now + between(IDLE_GAP_MS);
      run("idle");
    },

    dispose() {
      disposed = true;
      timers.forEach(clearTimeout);
      clearInterval(dripTimer);
      if (hoverTimer) clearTimeout(hoverTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      sync?.dispose();
    },
  };
}
