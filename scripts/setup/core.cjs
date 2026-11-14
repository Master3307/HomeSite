/*
 * Shared by the setup GUI and CLI: reading/writing .env, the setup state
 * (which optional features you want or skipped) and the stage status.
 *
 * SETUP_ENV_FILE points at another .env (testing only).
 */
const fs = require("node:fs");
const path = require("node:path");
const settings = require("../../config/settings.cjs");
const { STAGES } = require("./stages.cjs");
const { parseEnv, setEnvValues } = require("../../server/services/backup.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const ENV_FILE = process.env.SETUP_ENV_FILE ? path.resolve(process.env.SETUP_ENV_FILE) : path.join(ROOT, ".env");
// Your answers ("no thanks", skipped stages). Gitignored, part of backups.
const STATE_FILE = path.join(path.dirname(ENV_FILE), ".setup-state.json");
const BACKUP_DIR = path.join(ROOT, "server", "services", "db", "backups");

const readText = () => (fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "");
const readEnv = () => parseEnv(readText());

function readState() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return { wants: state.wants ?? {}, skipped: state.skipped ?? [], started: Boolean(state.started) };
  } catch {
    return { wants: {}, skipped: [], started: false };
  }
}

function writeState(next) {
  const state = { ...readState(), ...next };
  state.skipped = [...new Set(state.skipped)];
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

/** Validates, keeps a copy of the old file, writes. Returns { changed, removed, errors }. */
function saveEnv(values = {}, remove = []) {
  const errors = {};
  const clean = {};
  for (const [key, raw] of Object.entries(values)) {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(key)) {
      errors[key] = "Invalid name.";
      continue;
    }
    const value = String(raw ?? "").replace(/\r/g, "");
    const problem = settings.validate(key, value);
    if (problem) errors[key] = problem;
    else clean[key] = value;
  }
  if (Object.keys(errors).length) return { changed: [], removed: [], errors };

  const before = readText();
  let text = before;
  if (Object.keys(clean).length) text = setEnvValues(text, clean, `Set with pnpm setup (${new Date().toISOString()})`);
  const removeSet = new Set(remove.filter((key) => /^[A-Z][A-Z0-9_]*$/.test(key)));
  if (removeSet.size) {
    text = `${text
      .split(/\r?\n/)
      .filter((line) => {
        const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
        return !(match && !line.trim().startsWith("#") && removeSet.has(match[1]));
      })
      .join("\n")
      .replace(/\n+$/, "")}\n`;
  }
  if (text !== before) {
    if (before && !process.env.SETUP_ENV_FILE) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(BACKUP_DIR, `env-${Date.now()}.bak`), before, { mode: 0o600 });
    }
    fs.writeFileSync(ENV_FILE, text, { mode: 0o600 });
  }
  return { changed: Object.keys(clean), removed: [...removeSet], errors: {} };
}

/*
 * Stage status:
 *   done     everything it needs is set
 *   off      a feature you said no to
 *   skipped  you skipped it for now
 *   todo     still open
 * A stage is "done" when its required + needed values are set; stages with
 * only optional values are done once any of them is set.
 */
function stageStatus(env, state, stage) {
  if (stage.feature && state.wants[stage.feature] === false) return "off";
  const entries = stage.keys.map((key) => settings.BY_KEY.get(key)).filter(Boolean);
  // Required + needed values decide; "important" ones are recommended, not blocking.
  const essential = entries.filter((entry) => entry.importance === "required" || entry.needed);
  const isSet = (key) => settings.isSet(env, key);
  if (stage.special === "twofa") {
    if (settings.ON.has(String(env.ADMIN_2FA ?? "").toLowerCase()) && isSet("ADMIN_2FA_SECRET")) return "done";
  } else if (essential.length ? essential.every((entry) => isSet(entry.key)) : entries.some((entry) => isSet(entry.key))) {
    return "done";
  }
  if (state.skipped.includes(stage.id)) return "skipped";
  return "todo";
}

function stages(env = readEnv(), state = readState()) {
  return STAGES.map((stage) => ({ ...stage, status: stageStatus(env, state, stage) }));
}

/** First stage that still needs you (todo), else null. */
function nextStage(env, state) {
  return stages(env, state).find((stage) => stage.status === "todo") ?? null;
}

module.exports = { ROOT, ENV_FILE, STATE_FILE, readEnv, readState, writeState, saveEnv, stages, nextStage, settings };
