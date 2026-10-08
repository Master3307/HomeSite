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

export function registerLiveUserRoute(app, { client }) {
  registerLiveUserUiRoute(app);

  app.get("/:discordUserId", async (req, res, next) => {
    const discordUserId = String(req.params.discordUserId || "").trim();

    // Allow named routes registered after this route, such as /history,
    // to reach their own handlers.
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
      // Fetch the global user independently of guild membership.
      // Keep the raw API object to retain all fields Discord returns.
      const apiUser = await client.rest.get(Routes.user(discordUserId));

      let guild = null;
      let member = null;
      let membershipStatus = "unavailable";

      const warnings = [];

      // Guild information is enrichment, not a requirement for user lookup.
      if (DISCORD_GUILD_ID) {
        try {
          guild = await client.guilds.fetch(DISCORD_GUILD_ID);

          if (guild) {
            try {
              member = await guild.members.fetch({
                user: discordUserId,
                force: true,
              });

              membershipStatus = "member";
            } catch (error) {
              if (getErrorCode(error) === 10007) {
                membershipStatus = "not_member";
              } else {
                console.warn(
                  `Discord member lookup failed for ${discordUserId}:`,
                  describeError(error),
                );

                warnings.push({
                  scope: "member",
                  code: getErrorCode(error),
                  message:
                    "Global user fetched, but server membership could not be retrieved.",
                });
              }
            }
          } else {
            warnings.push({
              scope: "guild",
              message: "The configured Discord server was unavailable.",
            });
          }
        } catch (error) {
          console.warn(
            `Discord guild lookup failed for ${DISCORD_GUILD_ID}:`,
            describeError(error),
          );

          warnings.push({
            scope: "guild",
            code: getErrorCode(error),
            message:
              "Global user fetched, but the configured server could not be retrieved.",
          });
        }
      }

      const publicFlags = apiUser.public_flags ?? 0;

      // Single-member REST fetches do not fetch presence.
      // This comes from the client's Gateway-maintained guild presence cache.
      const cachedPresence = member
        ? (member.presence ?? guild?.presences.cache.get(discordUserId) ?? null)
        : null;

      const presence = cachedPresence
        ? (formatPresence(cachedPresence) ?? null)
        : null;

      return res.json({
        fetched_at: new Date().toISOString(),

        lookup: {
          user_source: "discord_rest",
          member_source: member ? "discord_rest" : null,
          presence_source: presence ? "discord_gateway_cache" : null,

          configured_guild_id: DISCORD_GUILD_ID || null,
          membership_status: membershipStatus,

          // This refers only to the configured guild.
          // It does not claim whether other mutual guilds exist.
          in_configured_guild:
            membershipStatus === "member"
              ? true
              : membershipStatus === "not_member"
                ? false
                : null,

          presence_available: presence !== null,
        },

        guild: guild
          ? {
              id: guild.id,
              name: guild.name,
              icon:
                guild.iconURL({
                  extension: "webp",
                  size: 256,
                }) ?? null,
              member_count: guild.memberCount,
            }
          : null,

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

        // Exact global-user response, including any additional fields
        // that are not represented in the formatted object above.
        raw_user: apiUser,

        member: member ? formatLiveGuildMember(member) : null,

        // Unknown/unavailable does not mean offline.
        presence,

        warnings,
      });
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
