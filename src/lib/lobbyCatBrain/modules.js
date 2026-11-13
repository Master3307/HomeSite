/*
 * What LobbyCat says, as small modules grouped by event:
 *
 *   activate   - the very first pet ever (wakes the cat up)
 *   arrive     - page opened, cat already awake (first match wins: one greeting)
 *   context    - after the greeting (first match wins: one remark, later)
 *   milestones - on arrival: visits, days known, … (all run)
 *   pet        - the cat was clicked (first match wins, may stay silent)
 *   progress   - trust points were applied (all run)
 *   idle       - nothing happened for a while (first match wins)
 *   notice     - something happened on the page (lobby code copied, FDC vote,
 *                hovering over the cat, coming back to the tab, …)
 *
 * A module is `{ id, run(ctx) }`; `run` returns true when it handled the
 * event. Add a module to the right list to teach the cat something new.
 * Lines live in src/locales/<lang>/lobby-cat.json; most keys hold several
 * variants, picked in a shuffled order so the cat doesn't repeat itself.
 *
 * ctx (see brain.js): kind ("guest" | "user" | "owner" | "leader" | "admin"),
 * name, trust, level, progress, memory, session, visit, now, hour, weekday,
 * activatedAt, say(lines) (right away), later(lines) (one at a time, spaced
 * out), line(key, vars), seq(key, vars), has(id), hit(id), daily(key),
 * ask(…), levelName(level).
 */

const FRIEND_TRUST = 3;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const LONG_ABSENCE_MS = 7 * DAY;

// Questions (mood included) only start once the cat has known you a while.
const QUESTIONS_AFTER_ACTIVATION_MS = 4 * HOUR;
const QUESTION_GAP_MS = 30 * HOUR;
const QUESTION_REPEAT_MS = 10 * DAY;
const QUESTION_MIN_INTERACTIONS = 8;
const MOOD_ASK_GAP_MS = 4 * DAY;

const PET_TALK_GAP_MS = 9_000;
const PET_COMBOS = [5, 15, 30, 60, 100];
const RAPID_PETS = 6; // within 3 seconds
const ROUND_TWO_MS = 2 * 60 * 1000;

// Announced once each (milestones "pets:<n>", "streak:<n>", …).
const PET_MILESTONES = [50, 100, 250, 500, 1000, 2500, 5000, 10000];
const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100];
const VISIT_MILESTONES = [10, 25, 50, 100, 250];
const DAYS_KNOWN_MILESTONES = [7, 30, 100, 200, 365];

/*
 * Little questions with answer buttons, scattered over time: at most one
 * question (mood included) per visit and per ~day, each one resting
 * QUESTION_REPEAT_MS after it was asked. `kinds` limits who gets it, `when`
 * adds conditions. Lines: questions.<id> in lobby-cat.json; answers are
 * remembered as milestones "q:<id>:<choice>" (see the remember module).
 */
const EVERYONE = ["guest", "user", "owner", "leader", "admin"];

const QUESTIONS = [
  { id: "treat", choices: [["fish", "🐟"], ["milk", "🥛"], ["cookies", "🍪"], ["catnip", "🌿"]] },
  { id: "owl", choices: [["night", "🦉"], ["early", "🐦"], ["sleepy", "😴"]] },
  {
    id: "fdc",
    kinds: ["guest", "user", "owner", "leader"],
    // Voting runs mid-week to Friday.
    when: (ctx) => [3, 4, 5].includes(ctx.weekday),
    choices: [["yes", "✅"], ["notYet", "⏳"], ["what", "❓"]],
  },
  {
    id: "fur",
    when: (ctx) => ctx.session.pets >= 10,
    choices: [["soft", "⭐"], ["verySoft", "✨"], ["softest", "💫"]],
  },
  { id: "spot", choices: [["ears", "👂"], ["chin", "🙂"], ["back", "🐈"], ["belly", "⚠️"]] },
  { id: "game", choices: [["yarn", "🧶"], ["laser", "🔴"], ["box", "📦"], ["hide", "🫣"]] },
  { id: "bongo", kinds: ["guest", "user"], choices: [["daily", "🥁"], ["sometimes", "🐾"], ["notYet", "🤔"]] },
  { id: "ownerPlans", kinds: ["owner"], choices: [["working", "🛠️"], ["secret", "🤫"], ["later", "😅"]] },
  { id: "cultbotVotes", kinds: ["admin"], choices: [["all", "🤖"], ["counting", "📊"], ["lost", "🙈"]] },
  { id: "leaderFavorite", kinds: ["leader"], choices: [["yes", "💖"], ["maybe", "🤔"], ["earn", "😼"]] },
  {
    id: "leaderOffering",
    kinds: ["leader"],
    choices: [["fish", "🐟"], ["yarn", "🧶"], ["crown", "👑"], ["you", "🐱"]],
  },
];

/** Long enough since waking up, and no question recently or this visit. */
function canAskQuestion(ctx) {
  const { memory, session } = ctx;
  if (session.askedQuestion || ctx.busy()) return false;
  if (!ctx.activatedAt || ctx.now - ctx.activatedAt < QUESTIONS_AFTER_ACTIVATION_MS) return false;
  if (memory.lastQuestionAt && ctx.now - memory.lastQuestionAt < QUESTION_GAP_MS) return false;
  return true;
}

function questionAskedAt(ctx, id) {
  const last = ctx.milestones()[`q:${id}`]?.last;
  return last ? Date.parse(last) : 0;
}

/** The eligible question asked longest ago (never-asked ones first, in order). */
function nextQuestion(ctx) {
  return QUESTIONS.filter((question) => (question.kinds ?? EVERYONE).includes(ctx.kind))
    .filter((question) => !question.when || question.when(ctx))
    .filter((question) => ctx.now - questionAskedAt(ctx, question.id) > QUESTION_REPEAT_MS)
    .sort((a, b) => questionAskedAt(ctx, a.id) - questionAskedAt(ctx, b.id))[0];
}

function askQuestion(ctx, question) {
  ctx.session.askedQuestion = true;
  ctx.memory.lastQuestionAt = ctx.now;
  ctx.hit(`q:${question.id}`);

  const vars = { name: ctx.name };
  ctx.ask({
    text: ctx.line(`questions.${question.id}.ask`, vars),
    choices: question.choices.map(([id, emoji]) => ({
      id,
      emoji,
      label: ctx.t(`questions.${question.id}.options.${id}`),
    })),
    onAnswer(answer) {
      if (!answer) return;
      ctx.say([ctx.line(`questions.${question.id}.answers.${answer}`, vars)]);
      ctx.hit(`q:${question.id}:${answer}`);
      if (!ctx.has("answered:first")) {
        ctx.hit("answered:first");
        ctx.later([ctx.line("milestone.firstAnswer")]);
      }
    },
  });
}

/*
 * Answers the cat brings up again later (milestone "q:<id>:<choice>").
 * Lines: remember.<id>.<choice>.
 */
const REMEMBERED = ["treat", "owl", "bongo", "spot", "game"];
const REMEMBER_GAP_DAYS = 5;

const MOODS = [
  { id: "great", emoji: "😺" },
  { id: "okay", emoji: "😼" },
  { id: "down", emoji: "😿" },
  { id: "tired", emoji: "😴" },
];

/** The intro, said once per person (milestone "intro"). */
function introLines(ctx) {
  if (ctx.has("intro")) return [];
  ctx.hit("intro");
  return ctx.seq("intro");
}

/*
 * The cult leader gets worship most of the time, but every third time the
 * cat talks to them like any good friend, so it doesn't become one-note.
 */
function leaderTurn(ctx, key) {
  const count = (ctx.memory.leaderTurns?.[key] ?? 0) + 1;
  ctx.memory.leaderTurns = { ...ctx.memory.leaderTurns, [key]: count };
  return count % 3 !== 0;
}

/*
 * Fox's devotion grows over time: worship (stage 0), devoted (1), zealous (2).
 * It comes from how much Fox has been around (pets + visits); a long petting
 * session pushes it one stage further for that visit.
 */
const LEADER_STAGES = ["", "devoted.", "zealous."];
const LEADER_DEVOTED_AT = 60;
const LEADER_ZEALOUS_AT = 200;
const LEADER_SESSION_BUMP_PETS = 25;

function leaderBaseStage(ctx) {
  const devotion = (ctx.progress.totalPets ?? 0) + 5 * (ctx.memory.visits ?? 0);
  return devotion >= LEADER_ZEALOUS_AT ? 2 : devotion >= LEADER_DEVOTED_AT ? 1 : 0;
}

function leaderKey(ctx, base) {
  const bump = ctx.session.pets >= LEADER_SESSION_BUMP_PETS ? 1 : 0;
  const stage = Math.min(2, leaderBaseStage(ctx) + bump);
  return `leader.${LEADER_STAGES[stage]}${base}`;
}

/** Announces a newly reached devotion stage, once ever per stage. */
function leaderStageNews(ctx) {
  const stage = leaderBaseStage(ctx);
  const lines = [];
  if (stage >= 1 && !ctx.has("leader:devoted")) {
    ctx.hit("leader:devoted");
    lines.push(...ctx.seq("leader.devotedReached", { name: ctx.name }));
  }
  if (stage >= 2 && !ctx.has("leader:zealous")) {
    ctx.hit("leader:zealous");
    lines.push(...ctx.seq("leader.zealousReached", { name: ctx.name }));
  }
  return lines;
}

function named(ctx, key, namedKey) {
  return ctx.name ? ctx.line(namedKey, { name: ctx.name }) : ctx.line(key);
}

function daysKnown(ctx) {
  return ctx.activatedAt ? Math.floor((ctx.now - ctx.activatedAt) / DAY) : 0;
}

/** The highest step in `steps` reached by `value` and not announced yet. */
function newMilestone(ctx, prefix, steps, value) {
  const reached = steps.filter((step) => value >= step);
  const top = reached.at(-1);
  if (!top || ctx.has(`${prefix}:${top}`)) return null;
  // Mark every step up to here, so skipped ones aren't announced later.
  for (const step of reached) if (!ctx.has(`${prefix}:${step}`)) ctx.hit(`${prefix}:${step}`);
  return top;
}

export const MODULES = {
  activate: [
    {
      // First pet ever: be happy about it first. Everything else comes later.
      id: "wake-up",
      run(ctx) {
        ctx.hit("activated");
        if (!ctx.has("pet:first")) ctx.hit("pet:first");

        const vars = { name: ctx.name };
        const happy =
          ctx.kind === "owner"
            ? ctx.line("owner.firstPet")
            : ctx.kind === "leader"
              ? ctx.line("leader.firstPet", vars)
              : ctx.kind === "admin"
                ? ctx.line("cultbot.firstPet")
                : ctx.line("pet.first");
        ctx.say([happy]);

        // Who you are, then the intro, one line at a time over the next minutes.
        const followUp = [];
        if (ctx.kind === "leader") {
          ctx.hit("leader:met");
          ctx.hit("intro");
          followUp.push(...ctx.seq("leader.meet", vars));
        } else if (ctx.kind === "owner") {
          ctx.hit("owner:met");
          ctx.hit("intro");
          followUp.push(...ctx.seq("owner.meet"));
        } else if (ctx.kind === "admin") {
          ctx.hit("cultbot:met");
          followUp.push(...ctx.seq("cultbot.meet"));
        } else {
          if (ctx.kind === "user") {
            ctx.hit("login:first");
            followUp.push(ctx.line("login.firstAwake", vars));
          }
          followUp.push(...introLines(ctx));
        }
        ctx.later(followUp);
        return true;
      },
    },
  ],

  arrive: [
    {
      id: "leader",
      run(ctx) {
        const { visit } = ctx;
        if (ctx.kind !== "leader") return false;
        const vars = { name: ctx.name };

        if (!ctx.has("leader:met")) {
          ctx.hit("leader:met");
          const [first, ...rest] = ctx.seq("leader.meet", vars);
          ctx.say([first]);
          ctx.later(rest);
          return true;
        }

        let greeting = null;
        if (visit.justLoggedIn) greeting = ctx.line("leader.login", vars);
        else if (visit.absenceMs > LONG_ABSENCE_MS) greeting = ctx.line("leader.longAbsence", vars);
        else if (visit.isNewVisit) {
          greeting = leaderTurn(ctx, "greet")
            ? ctx.line(leaderKey(ctx, "greet"), vars)
            : ctx.line("greet.welcomeBackFriend", vars);
        }

        ctx.say([greeting]);
        // A new devotion stage is big news, but it can wait a moment.
        ctx.later(leaderStageNews(ctx));
        return true;
      },
    },
    {
      id: "owner",
      run(ctx) {
        const { visit } = ctx;
        if (ctx.kind !== "owner") return false;

        if (!ctx.has("owner:met")) {
          ctx.hit("owner:met");
          const [first, ...rest] = ctx.seq("owner.meet");
          ctx.say([first]);
          ctx.later(rest);
        } else if (visit.justLoggedIn) ctx.say([ctx.line("owner.login")]);
        else if (visit.absenceMs > LONG_ABSENCE_MS) ctx.say([ctx.line("owner.longAbsence")]);
        else if (visit.isNewVisit) ctx.say([ctx.line("owner.greet")]);
        return true;
      },
    },
    {
      // Cultbot (admin-code login) and LobbyCat are both mascots of the cult.
      id: "cultbot",
      run(ctx) {
        if (ctx.kind !== "admin") return false;

        if (!ctx.has("cultbot:met")) {
          ctx.hit("cultbot:met");
          const [first, ...rest] = ctx.seq("cultbot.meet");
          ctx.say([first]);
          ctx.later(rest);
        } else if (ctx.visit.justLoggedIn || ctx.visit.isNewVisit) {
          ctx.say([ctx.line("cultbot.greet")]);
        }
        return true;
      },
    },
    {
      id: "login",
      run(ctx) {
        const { visit } = ctx;
        if (ctx.kind !== "user" || !visit.justLoggedIn) return false;
        const vars = { name: ctx.name };

        let line;
        if (!ctx.has("login:first")) line = ctx.line("login.first", vars);
        else if (visit.previousAccountId && visit.previousAccountId !== visit.accountId) {
          line = ctx.line("login.switched", vars);
        } else line = ctx.line("login.again", vars);

        ctx.hit("login:first");
        ctx.say([line]);
        ctx.later(introLines(ctx));
        return true;
      },
    },
    {
      id: "welcome-back",
      run(ctx) {
        const { visit } = ctx;
        if (!visit.isNewVisit) return false;

        let greeting;
        if (visit.absenceMs > LONG_ABSENCE_MS) {
          greeting = named(ctx, "greet.longAbsence", "greet.longAbsenceNamed");
        } else if (ctx.name && ctx.trust >= FRIEND_TRUST) {
          greeting = ctx.line("greet.welcomeBackFriend", { name: ctx.name });
        } else {
          greeting = named(ctx, "greet.welcomeBack", "greet.welcomeBackNamed");
        }

        ctx.say([greeting]);
        ctx.later(introLines(ctx));
        return true;
      },
    },
    // Navigating back within half an hour: stay quiet.
  ],

  // One remark after the greeting, queued (spaced out), each at most once a day.
  context: [
    {
      id: "leader-offering",
      run(ctx) {
        if (ctx.kind !== "leader" || leaderBaseStage(ctx) < 1) return false;
        if (!ctx.daily("leader-offering")) return false;
        ctx.later([ctx.line("leader.offering", { name: ctx.name })]);
        return true;
      },
    },
    {
      id: "streak-reminder",
      run(ctx) {
        const { progress, today, yesterday } = ctx;
        if (progress.streak < 2 || progress.lastPetDay !== yesterday) return false;
        if (progress.lastPetDay === today || !ctx.daily("streak-reminder")) return false;
        ctx.later([ctx.line("context.streakReminder", { count: progress.streak })]);
        return true;
      },
    },
    {
      id: "fdc-day",
      run(ctx) {
        const key = ctx.weekday === 4 ? "thursday" : ctx.weekday === 5 ? "friday" : null;
        if (!key || !ctx.daily(`fdc-${key}`)) return false;
        ctx.later([ctx.line(`context.${key}`)]);
        return true;
      },
    },
    {
      id: "weekend",
      run(ctx) {
        if (![0, 6].includes(ctx.weekday) || !ctx.daily("weekend")) return false;
        ctx.later([ctx.line("context.weekend")]);
        return true;
      },
    },
    {
      id: "time-of-day",
      run(ctx) {
        const key =
          ctx.hour < 5
            ? "lateNight"
            : ctx.hour >= 6 && ctx.hour < 10
              ? "morning"
              : ctx.hour >= 12 && ctx.hour < 14
                ? "lunch"
                : ctx.hour >= 18 && ctx.hour < 22
                  ? "evening"
                  : null;
        if (!key || !ctx.daily(`time-${key}`)) return false;
        ctx.later([ctx.line(`context.${key}`)]);
        return true;
      },
    },
  ],

  // On arrival (cat awake): things worth celebrating, said later.
  milestones: [
    {
      id: "visits",
      run(ctx) {
        const reached = newMilestone(ctx, "visits", VISIT_MILESTONES, ctx.memory.visits ?? 0);
        if (reached) ctx.later([ctx.line("milestone.visits", { count: reached, name: ctx.name })]);
      },
    },
    {
      id: "days-known",
      run(ctx) {
        const reached = newMilestone(ctx, "days", DAYS_KNOWN_MILESTONES, daysKnown(ctx));
        if (reached) ctx.later([ctx.line("milestone.days", { count: reached, name: ctx.name })]);
      },
    },
    {
      id: "night-visit",
      run(ctx) {
        if (ctx.hour >= 5 || ctx.has("visit:night")) return;
        ctx.hit("visit:night");
        ctx.later([ctx.line("milestone.nightVisit")]);
      },
    },
  ],

  pet: [
    {
      // Lots of pets in a few seconds: zoomies.
      id: "zoomies",
      run(ctx) {
        const { session } = ctx;
        if (session.petTimes.length < RAPID_PETS || ctx.now - (session.zoomiesAt ?? 0) < 60_000) return false;
        session.zoomiesAt = ctx.now;
        ctx.say([ctx.line("pet.rapid")]);
        if (!ctx.has("pet:zoomies")) ctx.hit("pet:zoomies");
        return true;
      },
    },
    {
      // Petting again after a little break.
      id: "round-two",
      run(ctx) {
        const { session } = ctx;
        if (session.pets < 2 || (session.sinceLastPet ?? 0) < ROUND_TWO_MS) return false;
        ctx.say([ctx.line("pet.roundTwo")], { priority: "low" });
        return true;
      },
    },
    {
      // Never got the intro (e.g. awake from another device): queue it, keep going.
      id: "late-intro",
      run(ctx) {
        if (!ctx.has("intro") && ctx.kind !== "owner" && ctx.kind !== "leader") {
          ctx.later(introLines(ctx));
        }
        return false;
      },
    },
    {
      // Rarely: ask how the user feels, with a few answers to pick from.
      id: "mood",
      run(ctx) {
        const { memory, session, progress } = ctx;
        if (!canAskQuestion(ctx)) return false;
        if (memory.interactions < QUESTION_MIN_INTERACTIONS || session.pets < 3) return false;
        if (progress.lastMoodDay === ctx.today) return false;
        if (memory.lastMoodAskAt && ctx.now - memory.lastMoodAskAt < MOOD_ASK_GAP_MS) return false;

        session.askedQuestion = true;
        memory.lastMoodAskAt = ctx.now;
        memory.lastQuestionAt = ctx.now;
        ctx.hit("mood:asked");

        ctx.ask({
          text: ctx.line("mood.ask"),
          choices: MOODS.map((mood) => ({
            id: mood.id,
            emoji: mood.emoji,
            label: ctx.t(`mood.options.${mood.id}`),
          })),
          onAnswer(answer) {
            if (!answer) {
              ctx.say([ctx.line("mood.noAnswer")], { priority: "low" });
              return;
            }
            // Reply first; the mood points (and a possible level-up) follow.
            ctx.say([ctx.line(`mood.${answer}`)]);
            ctx.hit(`mood:${answer}`);
            ctx.recordMood(answer);
          },
        });
        return true;
      },
    },
    {
      // Now and then: one of the little questions (see QUESTIONS).
      id: "question",
      run(ctx) {
        if (ctx.session.pets < 4 || ctx.memory.interactions < QUESTION_MIN_INTERACTIONS) return false;
        if (!canAskQuestion(ctx)) return false;

        const question = nextQuestion(ctx);
        if (!question) return false;
        askQuestion(ctx, question);
        return true;
      },
    },
    {
      id: "combo",
      run(ctx) {
        const combo = PET_COMBOS.find((count) => count === ctx.session.pets);
        if (!combo) return false;
        ctx.say([ctx.line(`pet.combo${combo}`)], { priority: "low" });
        return true;
      },
    },
    {
      // It loves pets: a happy little line every few pets (never every click).
      id: "love",
      run(ctx) {
        const { session } = ctx;
        if (ctx.busy() || session.pets < 2 || session.pets % 3 !== 0) return false;
        if (ctx.now - session.lastSpokeAt < PET_TALK_GAP_MS) return false;

        const vars = { name: ctx.name };
        const even = session.pets % 2 === 0;
        let text;
        if (ctx.kind === "admin") text = ctx.line("cultbot.pet");
        else if (ctx.kind === "owner" && even) text = ctx.line("owner.pet");
        else if (ctx.kind === "leader" && leaderTurn(ctx, "pet")) text = ctx.line(leaderKey(ctx, "pet"), vars);
        else if (ctx.hour < 5 || ctx.hour >= 23) text = ctx.line("pet.sleepy");
        else if (ctx.name && ctx.trust >= FRIEND_TRUST && even) text = ctx.line("pet.loveFriend", vars);
        else text = ctx.line(even ? "pet.purr" : "pet.love");

        ctx.say([text], { priority: "low" });
        return true;
      },
    },
  ],

  progress: [
    {
      id: "level-up",
      run(ctx, result) {
        if (!result?.leveledUp || ctx.has(`friend:${result.leveledUp}`)) return;
        ctx.hit(`friend:${result.leveledUp}`);
        const key =
          ctx.kind === "owner" ? "owner.levelUp" : ctx.kind === "leader" ? "leader.levelUp" : "levelUp";
        ctx.say([ctx.line(key, { level: ctx.levelName(result.leveledUp), name: ctx.name })]);
      },
    },
    {
      // First pets of a day: thank them, and celebrate streaks.
      id: "daily-pets",
      run(ctx, result) {
        if (!result?.streak || !ctx.session.hadFirstPetBefore) return;
        if (result.streak.streak >= 2) {
          ctx.later([ctx.line("pet.streak", { count: result.streak.streak })]);
        } else {
          ctx.later([ctx.line("pet.dailyFirst")], { priority: "low" });
        }
      },
    },
    {
      id: "pet-count",
      run(ctx) {
        const reached = newMilestone(ctx, "pets", PET_MILESTONES, ctx.progress.totalPets ?? 0);
        if (reached) ctx.later([ctx.line("milestone.pets", { count: reached, name: ctx.name })]);
      },
    },
    {
      id: "best-streak",
      run(ctx) {
        const reached = newMilestone(ctx, "streak", STREAK_MILESTONES, ctx.progress.streak ?? 0);
        if (reached) ctx.later([ctx.line("milestone.streak", { count: reached })]);
      },
    },
  ],

  // ctx.event = { type, detail } from catNotice() in lib/lobbyCat.js (or the brain).
  notice: [
    {
      id: "lobby-copied",
      run(ctx) {
        if (ctx.event.type !== "lobby-copied" || ctx.session.noticed.has("lobby-copied")) return false;
        ctx.session.noticed.add("lobby-copied");
        if (!ctx.has("lobby:first")) {
          ctx.hit("lobby:first");
          ctx.say([ctx.line("milestone.firstLobby")]);
          return true;
        }
        const key = ctx.kind === "leader" ? "notice.lobbyCopiedLeader" : "notice.lobbyCopied";
        ctx.say([ctx.line(key, { name: ctx.name })]);
        return true;
      },
    },
    {
      id: "lobby-submitted",
      run(ctx) {
        if (ctx.event.type !== "lobby-submitted") return false;
        const posted = ctx.event.detail?.status === "posted";
        ctx.say([ctx.line(posted ? "notice.lobbyPosted" : "notice.lobbyPending")]);
        return true;
      },
    },
    {
      id: "fdc-voted",
      run(ctx) {
        if (ctx.event.type !== "fdc-voted") return false;
        if (ctx.event.detail?.removed) {
          ctx.say([ctx.line("notice.fdcVoteRemoved")], { priority: "low" });
        } else if (!ctx.has("fdc:first-vote")) {
          ctx.hit("fdc:first-vote");
          ctx.say([ctx.line("milestone.firstVote")]);
        } else {
          const key = ctx.kind === "leader" ? "notice.fdcVotedLeader" : "notice.fdcVoted";
          ctx.say([ctx.line(key, { name: ctx.name })]);
        }
        return true;
      },
    },
    {
      // The pointer rests on the cat without petting: tease (once a visit).
      id: "hover",
      run(ctx) {
        if (ctx.event.type !== "hover" || ctx.session.noticed.has("hover") || ctx.busy()) return false;
        if (ctx.now - ctx.session.lastPetAt < 20_000) return false;
        ctx.session.noticed.add("hover");
        ctx.say([ctx.line("notice.hover")], { priority: "low" });
        return true;
      },
    },
    {
      // Back to the tab after a while.
      id: "tab-return",
      run(ctx) {
        if (ctx.event.type !== "tab-return" || ctx.session.noticed.has("tab-return")) return false;
        ctx.session.noticed.add("tab-return");
        ctx.later([named(ctx, "notice.tabReturn", "notice.tabReturnNamed")]);
        return true;
      },
    },
  ],

  idle: [
    {
      // A quiet moment is a good time for a question, too.
      id: "question",
      run(ctx) {
        if (ctx.memory.interactions < QUESTION_MIN_INTERACTIONS || !canAskQuestion(ctx)) return false;
        const question = nextQuestion(ctx);
        if (!question) return false;
        askQuestion(ctx, question);
        return true;
      },
    },
    {
      // Bring up something the user answered before ("I saved you some fish").
      id: "remember",
      run(ctx) {
        const milestones = ctx.milestones();

        for (const id of REMEMBERED) {
          const answer = Object.keys(milestones)
            .filter((key) => key.startsWith(`q:${id}:`))
            .sort((a, b) => (milestones[b].last ?? "").localeCompare(milestones[a].last ?? ""))[0]
            ?.slice(`q:${id}:`.length);

          if (!answer) continue;
          const lastSaid = ctx.memory.daily[`remember-${id}`];
          if (lastSaid && lastSaid > ctx.shiftDay(ctx.today, -REMEMBER_GAP_DAYS)) continue;

          ctx.memory.daily[`remember-${id}`] = ctx.today;
          ctx.say([ctx.line(`remember.${id}.${answer}`)], { priority: "low" });
          return true;
        }
        return false;
      },
    },
    {
      // Something it knows about the two of you (streak, days known, pets).
      id: "smart",
      run(ctx) {
        if (ctx.session.idleLines % 2 !== 0 || !ctx.daily("smart-fact")) return false;
        const days = daysKnown(ctx);
        const pets = ctx.progress.totalPets ?? 0;
        const streak = ctx.progress.streak ?? 0;

        let text = null;
        if (streak >= 3) text = ctx.line("idle.smartStreak", { count: streak });
        else if (days >= 3) text = ctx.line("idle.smartDays", { count: days });
        else if (pets >= 20) text = ctx.line("idle.smartPets", { count: pets });
        if (!text) return false;

        ctx.say([text], { priority: "low" });
        return true;
      },
    },
    {
      id: "chatter",
      run(ctx) {
        const vars = { name: ctx.name };
        const odd = ctx.session.idleLines % 2 === 1;
        let text;
        if (ctx.kind === "admin" && odd) text = ctx.line("cultbot.idle");
        else if (ctx.kind === "owner" && odd) text = ctx.line("owner.idle");
        else if (ctx.kind === "leader" && leaderTurn(ctx, "idle")) text = ctx.line(leaderKey(ctx, "idle"), vars);
        // Otherwise half playful (a little action), half talk.
        else text = ctx.line(Math.random() < 0.5 ? "idle.play" : "idle.talk");

        ctx.say([text], { priority: "low" });
        return true;
      },
    },
  ],
};
