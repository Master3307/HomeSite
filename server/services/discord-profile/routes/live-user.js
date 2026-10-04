import { DISCORD_API, DISCORD_BOT_TOKEN, DISCORD_GUILD_ID } from "../config.js";

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

function isDiscordSnowflake(value) {
  return /^\d{17,20}$/.test(value);
}

export function registerLiveUserRoute(app, { client }) {
  app.get("/api/:discordUserId", async (req, res) => {
    const discordUserId = String(req.params.discordUserId || "").trim();

    if (!isDiscordSnowflake(discordUserId)) {
      return res.status(400).json({
        error: "Invalid Discord user ID",
      });
    }

    console.log(`Live Discord user request: ${discordUserId}`);

    try {
      const guild = await client.guilds.fetch(DISCORD_GUILD_ID);

      let member;

      try {
        member = await guild.members.fetch({
          user: discordUserId,
          withPresences: true,
        });
      } catch (error) {
        if (error?.code === 10007 || error?.status === 404) {
          return res.status(404).json({
            error: "Discord user is not a member of this server",
            guild_id: DISCORD_GUILD_ID,
            user_id: discordUserId,
          });
        }

        throw error;
      }

      let apiUser = null;

      try {
        const response = await fetch(`${DISCORD_API}/users/${discordUserId}`, {
          headers: {
            Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
          },
        });

        if (response.ok) {
          apiUser = await response.json();
        } else {
          console.warn(
            `Discord REST user lookup failed for ${discordUserId}: ${response.status}`,
          );
        }
      } catch (error) {
        console.warn(
          `Discord REST user lookup failed for ${discordUserId}:`,
          error instanceof Error ? error.message : error,
        );
      }

      const user = apiUser ?? member.user;

      const publicFlags =
        apiUser?.public_flags ?? member.user.flags?.bitfield ?? 0;

      return res.json({
        fetched_at: new Date().toISOString(),

        guild: {
          id: guild.id,
          name: guild.name,
          icon:
            guild.iconURL({
              extension: "webp",
              size: 256,
            }) ?? null,
          member_count: guild.memberCount,
        },

        user: {
          id: user.id,
          username: user.username,
          global_name: user.global_name ?? member.user.globalName ?? null,
          discriminator:
            user.discriminator ?? member.user.discriminator ?? null,
          bot: user.bot ?? member.user.bot ?? false,
          system: user.system ?? member.user.system ?? false,
          avatar: avatarUrl(user),
          banner: bannerUrl(user),
          accent_color: user.accent_color ?? null,
          avatar_decoration: avatarDecorationUrl(user),
          guild_badge: guildBadgeUrl(user),
          badges: mapBadges(publicFlags),
          public_flags: publicFlags,
          primary_guild: user.primary_guild ?? null,
          collectibles: user.collectibles ?? null,
          created_at: snowflakeToTimestamp(user.id),
        },

        member: formatLiveGuildMember(member),

        presence: formatPresence(member.presence) ?? {
          status: "offline",
          client_status: {},
          activities: [],
        },
      });
    } catch (error) {
      console.error(
        `Live Discord user lookup failed for ${discordUserId}:`,
        error,
      );

      return res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch Discord user from guild",
      });
    }
  });
}
