const { setting } = require("../config.cjs");

/*
 * Who is in the Discord server. Anyone can have an account on the site
 * (MEMBERS_ONLY_LOGIN off, the default); what belongs to the server
 * community — voting, birthdays, member profiles and the member list, the
 * lobby cat, the cat designer's wardrobe, reporting, the server nickname —
 * is only for people who are in it right now. Leaving takes it away again,
 * joining gives it back (checked live, kept 5 minutes).
 *
 *   isMember(discordId)          true / false (the site owner always true)
 *   memberOnly(req, res, next)   a route guard: 401 logged out, 403 not in the server
 *   memberGate({ methods, except })  for app.use(paths, …): every route under those paths
 *                                (`except`: patterns of req.path, which is relative to the mount path)
 *
 * Asked straight from Discord with the bot token (no running bot needed).
 * When Discord can't be asked, the last known answer (users.in_server)
 * counts, never a guess in someone's favour. Configured by
 * services/discordOAuth.cjs (database, Discord lookup, sessions).
 */

const CACHE_MS = 5 * 60_000;
const cache = new Map(); // discordId -> { at, member }
const deps = { getDatabase: null, fetchGuildMember: null, getRequestSession: null, adminId: null };

function configureMembership(next) {
  Object.assign(deps, next);
}

const serverConfigured = () => Boolean(process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_GUILD_ID);

function remember(discordId, member) {
  cache.set(discordId, { at: Date.now(), member });
  if (cache.size > 5000) cache.delete(cache.keys().next().value);
  try {
    deps.getDatabase?.()?.prepare("UPDATE users SET in_server = ? WHERE discord_user_id = ?").run(member ? 1 : 0, discordId);
  } catch {
    // column not there yet (members.cjs adds it on start)
  }
}

/** Is this Discord account in the server now? */
async function isMember(discordId) {
  if (!discordId) return false;
  // The site owner, and the hub's admin-key login (a stand-in account), are always in.
  if (discordId === setting("DISCORD_USER_ID") || (deps.adminId && discordId === deps.adminId)) return true;
  // No server set up: there is nothing to be a member of, so the community parts are open to accounts.
  if (!serverConfigured()) return true;
  const hit = cache.get(discordId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.member;
  try {
    const member = await deps.fetchGuildMember(discordId);
    remember(discordId, member !== null);
    return member !== null;
  } catch {
    // Discord not answering: the last thing we knew.
    let known = null;
    try {
      known = deps.getDatabase?.()?.prepare("SELECT in_server FROM users WHERE discord_user_id = ?").get(discordId)?.in_server ?? null;
    } catch {
      known = null;
    }
    return known === 1;
  }
}

/** Login, Discord events, the daily check: what is known now. */
function noteMembership(discordId, member) {
  if (discordId) remember(discordId, Boolean(member));
}

async function memberOnly(req, res, next) {
  const session = deps.getRequestSession?.(req);
  if (!session) return res.status(401).json({ error: "Log in first.", code: "logged-out" });
  if (await isMember(session.discord_user_id)) return next();
  return res.status(403).json({ error: "This is for members of the Discord server.", code: "not-member" });
}

/** Used as app.use(paths, memberGate(…)): every route under them (only these methods, when given) needs membership. */
function memberGate({ methods = null, except = [] } = {}) {
  return (req, res, next) => {
    if (methods && !methods.includes(req.method)) return next();
    if (except.some((pattern) => pattern.test(req.path))) return next();
    return memberOnly(req, res, next);
  };
}

module.exports = { configureMembership, isMember, noteMembership, memberOnly, memberGate, serverConfigured };
