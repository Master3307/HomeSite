const { setting } = require("../config.cjs");
const { getInternalKey } = require("./internalKey.cjs");

/*
 * The profile questions of Discord's onboarding ("--- Profile ---", gender,
 * hobbies) moved to the website. For everyone with an account on the site
 * the bot moves these roles into their profile (account API,
 * POST /internal/profile-roles) and then takes the roles away; people
 * without an account keep them. It checks
 *   - when someone gets one of the roles (onboarding gives them again),
 *   - every 10 minutes for all accounts (a missed event, the bot was off),
 *   - right after an account is created (internal API /members/:id/profile-roles).
 *
 * Settings: PROFILE_ROLE_ID (the divider), PROFILE_GENDER_ROLES and
 * PROFILE_HOBBY_ROLES ("answer:roleId,..."). Empty: off.
 */

const SWEEP_MS = 10 * 60_000;
const SNOWFLAKE = /^\d{17,20}$/;

/* "male:123,female:456" -> Map(roleId -> answer) */
function pairs(name) {
  const map = new Map();
  for (const part of String(setting(name) ?? "").split(",")) {
    const [answer, roleId] = part.split(":").map((value) => value?.trim());
    if (answer && SNOWFLAKE.test(roleId ?? "")) map.set(roleId, answer);
  }
  return map;
}

function config() {
  const divider = SNOWFLAKE.test(setting("PROFILE_ROLE_ID") ?? "") ? setting("PROFILE_ROLE_ID") : null;
  const genders = pairs("PROFILE_GENDER_ROLES");
  const hobbies = pairs("PROFILE_HOBBY_ROLES");
  const all = new Set([...(divider ? [divider] : []), ...genders.keys(), ...hobbies.keys()]);
  return { divider, genders, hobbies, all, on: all.size > 0 };
}

async function accountApi(path, { method = "GET", body } = {}) {
  const port = Number(setting("ACCOUNT_API_PORT")) || 3002;
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "X-Internal-Key": getInternalKey(), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Account API answered ${response.status}`);
  return response.json();
}

const busy = new Set(); // members being handled (role events come in bursts)

/**
 * Moves one member's profile roles to the site. Returns what happened:
 * `{ moved: string[], account: boolean }` (nothing moved without an account).
 */
async function migrateMember(member) {
  const settings = config();
  if (!settings.on || !member || member.user?.bot || busy.has(member.id)) return { moved: [], account: false };
  const held = member.roles.cache.filter((role) => settings.all.has(role.id));
  if (!held.size) return { moved: [], account: null };
  busy.add(member.id);
  try {
    const gender = held.map((role) => settings.genders.get(role.id)).find(Boolean) ?? null;
    const hobbies = held.map((role) => settings.hobbies.get(role.id)).filter(Boolean);
    const result = await accountApi("/internal/profile-roles", { method: "POST", body: { discordId: member.id, gender, hobbies } });
    if (!result.account) return { moved: [], account: false };
    await member.roles.remove([...held.keys()], "Profile answers live on the website now");
    console.log(`[Profile roles] Moved ${held.size} role(s) of ${member.user.tag} to their website profile.`);
    return { moved: held.map((role) => role.name), account: true };
  } finally {
    busy.delete(member.id);
  }
}

async function sweep(client) {
  const settings = config();
  const guild = client.guilds.cache.get(setting("DISCORD_GUILD_ID"));
  if (!settings.on || !guild) return;
  const { ids } = await accountApi("/internal/profile-roles/accounts");
  if (!ids.length) return;
  const members = await guild.members.fetch({ user: ids.slice(0, 1000) }).catch(() => guild.members.cache);
  for (const member of members.values()) {
    await migrateMember(member).catch((error) => console.warn(`[Profile roles] ${member.user.tag}:`, error.message));
  }
}

let started = false;

function startProfileRoles(client) {
  if (started) return;
  started = true;
  // Onboarding (or anyone) gives a profile role: move it if they have an account.
  client.on("guildMemberUpdate", (before, after) => {
    if (after.guild.id !== setting("DISCORD_GUILD_ID")) return;
    const settings = config();
    if (!settings.on) return;
    const gained = after.roles.cache.some((role) => settings.all.has(role.id) && !before.roles.cache.has(role.id));
    if (gained) migrateMember(after).catch((error) => console.warn("[Profile roles]", error.message));
  });
  const run = () => sweep(client).catch((error) => console.warn("[Profile roles] Sweep failed:", error.message));
  setTimeout(run, 30_000);
  setInterval(run, SWEEP_MS).unref?.();
}

module.exports = { startProfileRoles, migrateMember };
