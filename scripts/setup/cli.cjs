/*
 * pnpm setup:cli: the guided setup in the terminal.
 *
 * Walks through every stage (scripts/setup/stages.cjs) with a short guide
 * and links, asks whether you want each optional feature and then asks for
 * its values one by one. Everything can be skipped. Each stage is saved
 * right away, so stopping halfway (Ctrl+C or "q") loses nothing.
 *
 *   --all    also revisit stages that are already done
 *
 * Prefer a browser? pnpm setup:gui
 */
const readline = require("node:readline");
const { STAGES, NEXT_STEPS } = require("./stages.cjs");
const core = require("./core.cjs");
const { settings } = core;
const totp = require("../../server/services/totp.cjs");

const tty = process.stdout.isTTY;
const color = (code) => (text) => (tty ? `\x1b[${code}m${text}\x1b[0m` : String(text));
const bold = color("1");
const dim = color("2");
const green = color("32");
const yellow = color("33");
const red = color("31");
const cyan = color("36");
const purple = color("35");
// Clickable links in terminals that support OSC 8; the URL is printed too.
const link = (label, url) => (tty ? `\x1b]8;;${url}\x1b\\${cyan(label)}\x1b]8;;\x1b\\ ${dim(url)}` : `${label}: ${url}`);

const WIDTH = Math.min(process.stdout.columns || 80, 92);

function wrap(text, indent = "  ") {
  const lines = [];
  let line = "";
  for (const word of String(text).split(/\s+/)) {
    if (line && line.length + word.length + 1 > WIDTH - indent.length) {
      lines.push(indent + line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(indent + line);
  return lines.join("\n");
}

/* ---------- input ---------- */

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
let muted = false;
// Secrets are echoed as dots while typing.
rl._writeToOutput = function write(text) {
  if (muted && !/\n|\r/.test(text)) rl.output.write(text.length === 1 ? "•" : "");
  else rl.output.write(text);
};

class Quit extends Error {}
rl.on("SIGINT", () => {
  console.log(dim("\n\nStopped. Everything you confirmed so far is saved in .env."));
  process.exit(0);
});

// Lines are queued, so pasted or piped answers are never lost.
const lines = [];
let waiting = null;
let closed = false;
rl.on("line", (line) => {
  if (waiting) {
    const resolve = waiting;
    waiting = null;
    resolve(line);
  } else lines.push(line);
});
rl.on("close", () => {
  closed = true;
  if (waiting) waiting(null);
});

async function ask(question, { secret = false } = {}) {
  rl.output.write(question);
  muted = secret && tty;
  const answer = lines.length ? lines.shift() : closed ? null : await new Promise((resolve) => (waiting = resolve));
  if (muted) rl.output.write("\n");
  muted = false;
  if (answer === null) throw new Quit(); // input ended (Ctrl+D)
  if (!tty) rl.output.write(`${secret ? "•••" : answer}\n`);
  return answer.trim();
}

async function choice(question, options, fallback) {
  const hint = options.map((option) => (option === fallback ? bold(option.toUpperCase()) : option)).join("/");
  for (;;) {
    const answer = (await ask(`${question} ${dim(`[${hint}]`)} `)).toLowerCase() || fallback;
    if (answer === "q") throw new Quit();
    if (options.includes(answer)) return answer;
    console.log(yellow("  Please answer with one of: ") + options.join(", "));
  }
}

/* ---------- output ---------- */

function mask(entry, value) {
  if (!value) return dim("not set");
  if (entry.type === "secret") return green(`set (${value.length} characters, hidden)`);
  return green(value.length > 60 ? `${value.slice(0, 57)}…` : value);
}

function header(stage, index, total) {
  const title = ` ${index}/${total} · ${stage.title} `;
  console.log(`\n${purple("━".repeat(3))}${bold(purple(title))}${purple("━".repeat(Math.max(3, WIDTH - title.length - 3)))}`);
  console.log(wrap(stage.intro));
  if (stage.steps?.length) {
    console.log("");
    stage.steps.forEach((step, number) => console.log(`  ${cyan(`${number + 1}.`)} ${wrap(step, "     ").trimStart()}`));
  }
  if (stage.links?.length) {
    console.log("");
    for (const entry of stage.links) console.log(`  ${entry.video ? "▶" : "↗"} ${link(entry.label, entry.url)}`);
  }
  console.log("");
}

/* ---------- asking for one setting ---------- */

async function askSetting(key, env, pending) {
  const entry = settings.BY_KEY.get(key);
  const current = pending[key] ?? env[key] ?? "";
  const suggestion = !current ? settings.suggestions({ ...env, ...pending })[key] : null;
  const status = settings.statusOf({ ...env, ...pending }, key);
  const mark =
    status.state === "set" ? green("✔") : status.state === "missing-required" ? red("✘") : status.state === "missing" ? dim("○") : yellow("⚠");

  console.log(`  ${mark} ${bold(entry.label)} ${dim(key)}${status.reason && status.state !== "set" ? `  ${yellow(status.reason)}` : ""}`);
  console.log(dim(wrap(entry.description, "    ")));
  for (const help of entry.help ?? []) console.log(`    ${help.video ? "▶" : "↗"} ${link(help.label, help.url)}`);
  console.log(`    ${dim("now:")} ${mask(entry, current)}${!current && entry.default ? dim(`  (default: ${entry.default})`) : ""}`);

  const keys = [
    "Enter = keep",
    suggestion ? `s = use ${suggestion.length > 40 ? `${suggestion.slice(0, 37)}…` : suggestion}` : null,
    entry.generate ? "g = generate" : null,
    current ? "- = remove" : null,
    "q = save & quit",
  ].filter(Boolean);
  console.log(dim(`    ${keys.join(" · ")}`));

  for (;;) {
    let answer;
    if (entry.type === "toggle") {
      const on = settings.ON.has(String(current || entry.default).toLowerCase());
      answer = (await ask(`    ${entry.label}? ${dim(`[on/off, now ${on ? "on" : "off"}]`)} `)).toLowerCase();
    } else {
      answer = await ask(`    ${cyan("›")} `, { secret: entry.type === "secret" });
    }
    if (answer === "q") throw new Quit();
    if (answer === "") return; // keep
    if (answer === "-") {
      pending[key] = null;
      return;
    }
    if (answer === "s" && suggestion) answer = suggestion;
    if (answer === "g" && entry.generate) {
      answer = settings.generateValue(key);
      console.log(`    ${green("Generated.")}${key === "ADMIN_KEY" ? ` Your admin key: ${bold(answer)} ${dim("(store it in your password manager)")}` : ""}`);
    }
    const problem = settings.validate(key, answer);
    if (problem) {
      console.log(red(`    ${problem}`));
      continue;
    }
    pending[key] = answer;
    return;
  }
}

function flush(pending) {
  const values = {};
  const remove = [];
  for (const [key, value] of Object.entries(pending)) {
    if (value === null) remove.push(key);
    else values[key] = value;
  }
  if (!Object.keys(values).length && !remove.length) return;
  const result = core.saveEnv(values, remove);
  for (const key of Object.keys(pending)) delete pending[key];
  if (Object.keys(result.errors).length) console.log(red(`  Not saved: ${JSON.stringify(result.errors)}`));
  else console.log(green(`  ✔ Saved ${[...result.changed, ...result.removed].length} value(s) to .env`));
}

/* ---------- 2FA ---------- */

async function twofaStage(env) {
  const QRCode = require("qrcode");
  let secret = env.ADMIN_2FA_SECRET;
  if (!secret || (await choice("  Create a new 2FA secret?", ["y", "n"], secret ? "n" : "y")) === "y") {
    secret = totp.generateSecret();
    core.saveEnv({ ADMIN_2FA_SECRET: secret, ADMIN_2FA: "off" });
  }
  console.log(`\n  Scan this with your authenticator app:\n`);
  console.log((await QRCode.toString(totp.otpauthUrl(secret), { type: "terminal", small: true })).replace(/^/gm, "  "));
  console.log(`  Key: ${bold(secret.match(/.{1,4}/g).join(" "))}\n`);
  for (;;) {
    const code = await ask(`  Current 6-digit code ${dim("(Enter = later)")} ${cyan("›")} `);
    if (!code) {
      console.log(dim("  2FA stays off. Run this stage again or `pnpm 2fa:verify` later."));
      return;
    }
    if (code === "q") throw new Quit();
    if (totp.verifyCode(secret, code) !== null) {
      core.saveEnv({ ADMIN_2FA: "on" });
      console.log(green("  ✔ Code correct. 2FA is on (restart the account API)."));
      return;
    }
    console.log(red("  That code doesn't match. Check the time on your phone and try the newest code."));
  }
}

/* ---------- main ---------- */

async function main() {
  const all = process.argv.includes("--all");
  console.log(`\n${bold(purple("  HomeSite setup"))}`);
  console.log(wrap("Answer what you like, skip what you don't. Every stage is saved immediately to .env; run this again any time to continue. Prefer a browser? pnpm setup:gui"));
  console.log(dim(`  Writing to ${core.ENV_FILE}`));

  const pending = {};
  try {
    for (const [index, base] of STAGES.entries()) {
      const env = core.readEnv();
      let state = core.readState();
      const stage = core.stages(env, state).find((entry) => entry.id === base.id);
      if (!all && stage.status === "done") {
        console.log(`\n  ${green("✔")} ${bold(stage.title)} ${dim("already set up")}`);
        continue;
      }
      if (!all && stage.status === "off") {
        console.log(`\n  ${dim("○")} ${bold(stage.title)} ${dim("off (you said no earlier; --all to revisit)")}`);
        continue;
      }

      header(stage, index + 1, STAGES.length);

      if (stage.feature) {
        const feature = settings.FEATURES.find((entry) => entry.id === stage.feature);
        const answer = await choice(`  ${bold(`Use ${feature.title.toLowerCase()}?`)} ${dim("y = yes · n = no · s = skip for now")}`, ["y", "n", "s"], "y");
        if (answer === "n") {
          state = core.writeState({ wants: { ...state.wants, [stage.feature]: false } });
          continue;
        }
        if (answer === "s") {
          core.writeState({ skipped: [...state.skipped, stage.id] });
          continue;
        }
        core.writeState({ wants: { ...state.wants, [stage.feature]: true }, skipped: state.skipped.filter((id) => id !== stage.id) });
      } else {
        const answer = await choice(`  ${bold("Set this up now?")} ${dim("y = yes · s = skip for now")}`, ["y", "s"], "y");
        if (answer === "s") {
          core.writeState({ skipped: [...state.skipped, stage.id] });
          continue;
        }
      }

      if (stage.special === "twofa") {
        await twofaStage(env);
        continue;
      }
      for (const key of stage.keys) {
        console.log("");
        await askSetting(key, core.readEnv(), pending);
      }
      flush(pending);
    }
  } catch (error) {
    if (!(error instanceof Quit)) throw error;
    flush(pending);
    console.log(dim("\n  Saved. Run `pnpm setup:cli` again to continue where you left off."));
    rl.close();
    return;
  }

  const left = core.stages().filter((stage) => stage.status === "todo" || stage.status === "skipped");
  console.log(`\n${bold(green("  All done!"))}${left.length ? dim(` (${left.length} stage(s) skipped: ${left.map((stage) => stage.title).join(", ")})`) : ""}\n`);
  console.log("  Next:");
  for (const step of NEXT_STEPS) console.log(`    ${cyan(step.command.padEnd(15))} ${dim(step.text)}`);
  console.log(dim("\n  Change anything later with pnpm setup:gui, or on /admin-settings once the site runs.\n"));
  rl.close();
}

main().catch((error) => {
  console.error(red(error.stack || error.message));
  process.exit(1);
});
