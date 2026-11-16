const fs = require("node:fs");
const path = require("node:path");

/*
 * Birthday reminders: members pick people on the website's birthday list
 * (/cult/birthdays) and the bot DMs them the day before and on the day.
 *
 *   db/birthday-reminders.json
 *     { version: 1, reminders: { [subscriberId]: [targetId, ...] },
 *       sent: { "<date>:<subscriber>:<target>:<before|day>": true } }  (last 60 days)
 *
 * Shared by the account API (choosing) and the bot (sending).
 */

const FILE = path.join(__dirname, "db", "birthday-reminders.json");
const SNOWFLAKE = /^\d{17,20}$/;
const MAX_PER_PERSON = 200;

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return { version: 1, reminders: data?.reminders && typeof data.reminders === "object" ? data.reminders : {}, sent: data?.sent && typeof data.sent === "object" ? data.sent : {} };
  } catch {
    return { version: 1, reminders: {}, sent: {} };
  }
}

function write(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const temporary = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, FILE);
}

/** The people `subscriberId` gets reminded about. */
function remindersOf(subscriberId) {
  return read().reminders[String(subscriberId)] ?? [];
}

function setReminder(subscriberId, targetId, on) {
  if (!SNOWFLAKE.test(String(subscriberId)) || !SNOWFLAKE.test(String(targetId))) throw new Error("Invalid user.");
  const data = read();
  const list = new Set(data.reminders[subscriberId] ?? []);
  if (on) list.add(String(targetId));
  else list.delete(String(targetId));
  if (list.size > MAX_PER_PERSON) throw Object.assign(new Error("That's a lot of reminders already."), { status: 400 });
  if (list.size) data.reminders[subscriberId] = [...list];
  else delete data.reminders[subscriberId];
  write(data);
  return [...list];
}

/** Marks a reminder as sent; false if it was sent already. Old marks are dropped. */
function markSent(key) {
  const data = read();
  if (data.sent[key]) return false;
  data.sent[key] = true;
  const cutoff = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  for (const old of Object.keys(data.sent)) if (old.slice(0, 10) < cutoff) delete data.sent[old];
  write(data);
  return true;
}

module.exports = { read, remindersOf, setReminder, markSent };
