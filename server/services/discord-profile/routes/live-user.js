import { Routes } from "discord.js";

import { DISCORD_GUILD_ID } from "../config.js";

import {
  avatarDecorationUrl,
  avatarUrl,
  bannerUrl,
  formatLiveGuildMember,
  formatPresence,
  guildBadgeUrl,
  mapBadges,
  snowflakeToTimestamp,
} from "../discord-formatters.js";

import { registerLiveUserUiRoute } from "./live-user-ui.js";

const GUILD_SCAN_CONCURRENCY = 3;

// Coalesce simultaneous requests for the same user.
// Completed results are not retained as a lookup cache.
const activeLookups = new Map();

function isDiscordSnowflake(value) {
  return /^\d{17,20}$/.test(value);
}

function getErrorCode(error) {
  const code = Number(error?.code);
  return Number.isFinite(code) ? code : null;
}

function getErrorStatus(error) {
  const status = Number(error?.status);
  return Number.isFinite(status) ? status : null;
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function compareSnowflakes(first, second) {
  const left = BigInt(first);
  const right = BigInt(second);

  return left < right ? -1 : left > right ? 1 : 0;
}

function getCachedPresence(guild, member, userId, client) {
  if (!client.isReady() || !guild.available) return null;

  return member.presence ?? guild.presences.cache.get(userId) ?? null;
}

function formatGuild(guild) {
  return {
    id: guild.id,
    name: guild.name,
    icon:
      guild.iconURL({
        extension: "webp",
        size: 256,
      }) ?? null,
    member_count: guild.memberCount,
    available: guild.available,
  };
}

async function fetchBotGuildIds(client) {
  const ids = new Set();
  let after = null;

  while (true) {
    const query = new URLSearchParams({
      limit: "200",
    });

    if (after) query.set("after", after);

    const page = await client.rest.get(Routes.userGuilds(), {
      query,
    });

    if (!Array.isArray(page)) {
      throw new Error("Discord returned an invalid bot guild list.");
    }

    if (!page.length) break;

    for (const guild of page) {
      ids.add(guild.id);
    }

    const nextAfter = page
      .map((guild) => guild.id)
      .sort(compareSnowflakes)
      .at(-1);

    if (after && compareSnowflakes(nextAfter, after) <= 0) {
      throw new Error("Bot guild pagination did not advance.");
    }

    after = nextAfter;
  }

  return [...ids].sort(compareSnowflakes);
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await worker(items[index]);
      }
    },
  );

  await Promise.all(workers);

  return results;
}

async function inspectGuild(client, guildId, userId) {
  let guild = null;
  let member = null;

  try {
    guild = await client.guilds.fetch({
      guild: guildId,
      force: true,
    });

    if (!guild) {
      throw new Error("Guild information is unavailable.");
    }

    member = await guild.members.fetch({
      user: userId,
      force: true,
    });
  } catch (error) {
    // Only a definitive Unknown Member response establishes non-membership.
    if (guild && getErrorCode(error) === 10007) {
      return {
        guild_id: guildId,
        status: "not_member",
        guild,
        member: null,
      };
    }

    return {
      guild_id: guildId,
      status: "unavailable",
      guild,
      member: null,
      error: {
        code: getErrorCode(error),
        http_status: getErrorStatus(error),
        message: describeError(error),
      },
    };
  }

  return {
    guild_id: guildId,
    status: "member",
    guild,
    member,
  };
}

async function buildLiveUserResponse(client, discordUserId) {
  // Global profile remains independent of guild membership.
  const apiUser = await client.rest.get(Routes.user(discordUserId));

  const warnings = [];
  let guildIds = [];
  let guildListComplete = true;

  try {
    guildIds = await fetchBotGuildIds(client);
  } catch (error) {
    guildListComplete = false;

    // Still inspect every guild known to this client.
    guildIds = [...client.guilds.cache.keys()].sort(compareSnowflakes);

    warnings.push({
      scope: "guild_scan",
      code: getErrorCode(error),
      message:
        "Could not fetch the complete bot guild list. " +
        "The scan is using locally known guilds and may be incomplete.",
    });

    console.warn("Bot guild enumeration failed:", describeError(error));
  }

  let configuredResult = null;

  // Check the configured guild first, before starting fallback checks.
  if (DISCORD_GUILD_ID) {
    configuredResult = await inspectGuild(
      client,
      DISCORD_GUILD_ID,
      discordUserId,
    );
  }

  const otherGuildIds = guildIds.filter(
    (guildId) => guildId !== DISCORD_GUILD_ID,
  );

  const otherResults = await mapWithConcurrency(
    otherGuildIds,
    GUILD_SCAN_CONCURRENCY,
    (guildId) => inspectGuild(client, guildId, discordUserId),
  );

  const results = [
    ...(configuredResult ? [configuredResult] : []),
    ...otherResults,
  ];

  const sharedResults = results.filter((result) => result.status === "member");

  const failedResults = results.filter(
    (result) => result.status === "unavailable",
  );

  // Configured guild is first in results; other guilds are ordered by ID.
  // Select only a verified shared guild that is currently available.
  const selected =
    sharedResults.find((result) => result.guild.available) ?? null;

  for (const result of failedResults) {
    warnings.push({
      scope: "guild_scan",
      guild_id: result.guild_id,
      code: result.error?.code ?? null,
      message:
        "Could not verify membership in this guild. " +
        "It was not classified as a shared guild or as non-membership.",
    });

    console.warn(
      `Guild membership check failed for ${discordUserId} in ${result.guild_id}:`,
      result.error?.message,
    );
  }

  const unavailableShared = sharedResults.filter(
    (result) => !result.guild.available,
  );

  if (unavailableShared.length) {
    warnings.push({
      scope: "guild_scan",
      message:
        "Some verified shared guilds are currently unavailable. " +
        "They are listed but were not selected as the primary server.",
    });
  }

  const configuredStatus = DISCORD_GUILD_ID
    ? (configuredResult?.status ?? "unavailable")
    : "not_configured";

  const primarySource = !selected
    ? null
    : selected.guild_id === DISCORD_GUILD_ID
      ? "configured"
      : "fallback";

  // Format every verified shared guild, not only the primary one.
  const mutualGuilds = sharedResults.map((result) => {
    const cachedPresence = getCachedPresence(
      result.guild,
      result.member,
      discordUserId,
      client,
    );

    return {
      ...formatGuild(result.guild),
      is_primary: result.guild_id === selected?.guild_id,
      is_configured: result.guild_id === DISCORD_GUILD_ID,
      membership_verified_at: new Date().toISOString(),
      member: formatLiveGuildMember(result.member),
      presence: cachedPresence ? formatPresence(cachedPresence) : null,
    };
  });

  const primary = mutualGuilds.find((guild) => guild.is_primary) ?? null;

  const checkedBotGuildIds = new Set(guildIds);

  const botGuildFailures = failedResults.filter((result) =>
    checkedBotGuildIds.has(result.guild_id),
  );

  const scanComplete = guildListComplete && botGuildFailures.length === 0;

  const publicFlags = apiUser.public_flags ?? 0;

  return {
    fetched_at: new Date().toISOString(),

    lookup: {
      user_source: "discord_rest",
      member_source: primary ? "discord_rest" : null,
      presence_source: primary?.presence ? "discord_gateway_cache" : null,

      configured_guild_id: DISCORD_GUILD_ID || null,
      configured_membership_status: configuredStatus,

      in_configured_guild:
        configuredStatus === "member"
          ? true
          : configuredStatus === "not_member"
            ? false
            : null,

      // This now describes the selected primary guild.
      membership_status: primary
        ? "member"
        : sharedResults.length || !scanComplete
          ? "unavailable"
          : "not_member",

      selected_guild_id: primary?.id ?? null,
      selected_guild_source: primarySource,
      presence_available: primary?.presence !== null && primary !== null,
    },

    guild_scan: {
      guild_list_complete: guildListComplete,
      complete: scanComplete,
      bot_guild_count: guildIds.length,
      checked_guild_count: results.length,
      verified_shared_guild_count: mutualGuilds.length,
      confirmed_not_member_count: results.filter(
        (result) => result.status === "not_member",
      ).length,
      failed_guild_ids: failedResults.map((result) => result.guild_id),
      fallback_order: "guild_id_ascending",
    },

    // Only the selected, verified shared guild is represented here.
    // The configured guild is never substituted when membership failed.
    guild: primary
      ? {
          id: primary.id,
          name: primary.name,
          icon: primary.icon,
          member_count: primary.member_count,
          available: primary.available,
        }
      : null,

    mutual_guilds: mutualGuilds,

    user: {
      id: apiUser.id,
      username: apiUser.username,
      global_name: apiUser.global_name ?? null,
      discriminator: apiUser.discriminator ?? null,

      bot: apiUser.bot ?? false,
      system: apiUser.system ?? false,

      avatar: avatarUrl(apiUser),
      avatar_hash: apiUser.avatar ?? null,

      banner: bannerUrl(apiUser),
      banner_hash: apiUser.banner ?? null,

      accent_color: apiUser.accent_color ?? null,

      avatar_decoration: avatarDecorationUrl(apiUser),
      avatar_decoration_data: apiUser.avatar_decoration_data ?? null,

      guild_badge: guildBadgeUrl(apiUser),
      primary_guild: apiUser.primary_guild ?? null,

      collectibles: apiUser.collectibles ?? null,

      badges: mapBadges(publicFlags),
      public_flags: publicFlags,

      created_at: snowflakeToTimestamp(apiUser.id),
    },

    raw_user: apiUser,

    member: primary?.member ?? null,
    presence: primary?.presence ?? null,

    warnings,
  };
}

function getLiveUserResponse(client, discordUserId) {
  const existing = activeLookups.get(discordUserId);
  if (existing) return existing;

  const pending = buildLiveUserResponse(client, discordUserId);
  activeLookups.set(discordUserId, pending);

  const clear = () => {
    if (activeLookups.get(discordUserId) === pending) {
      activeLookups.delete(discordUserId);
    }
  };

  pending.then(clear, clear);

  return pending;
}

export function registerLiveUserRoute(app, { client }) {
  registerLiveUserUiRoute(app);

  app.get("/:discordUserId", async (req, res, next) => {
    const discordUserId = String(req.params.discordUserId || "").trim();

    if (!isDiscordSnowflake(discordUserId)) {
      if (/^\d+$/.test(discordUserId)) {
        return res.status(400).json({
          error: "Invalid Discord user ID",
        });
      }

      return next();
    }

    console.log(`Live Discord user request: ${discordUserId}`);
    res.setHeader("Cache-Control", "no-store");

    try {
      const data = await getLiveUserResponse(client, discordUserId);
      return res.json(data);
    } catch (error) {
      console.error(
        `Live Discord user lookup failed for ${discordUserId}:`,
        error,
      );

      const code = getErrorCode(error);
      const status = getErrorStatus(error);

      if (code === 10013) {
        return res.status(404).json({
          error: "Discord user not found",
          user_id: discordUserId,
        });
      }

      if (status === 429) {
        res.setHeader("Retry-After", "5");

        return res.status(503).json({
          error: "Discord is rate-limiting user lookups. Try again shortly.",
          user_id: discordUserId,
        });
      }

      return res.status(502).json({
        error: "Failed to fetch user information from Discord",
        user_id: discordUserId,
      });
    }
  });
}
