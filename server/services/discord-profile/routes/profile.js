import { DISCORD_API, DISCORD_BOT_TOKEN, DISCORD_USER_ID } from "../config.js";

import {
  avatarDecorationUrl,
  avatarUrl,
  bannerUrl,
  formatPresence,
  guildBadgeUrl,
  mapBadges,
} from "../discord-formatters.js";

import {
  activityKey,
  normalizeActivityKind,
  safeJsonParseArray,
} from "../utils.js";

export function registerProfileRoutes(
  app,
  { enrichment, activityStore, getCachedPresence, getActivityHistory },
) {
  app.get("/", async (_req, res) => {
    try {
      const response = await fetch(`${DISCORD_API}/users/${DISCORD_USER_ID}`, {
        headers: {
          Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        },
      });

      if (!response.ok) {
        return res.status(response.status).json({
          error: "Failed to fetch Discord user",
        });
      }

      const user = await response.json();

      const presence = formatPresence(getCachedPresence()) ?? {
        status: "offline",
        activities: [],
      };

      for (const activity of presence.activities) {
        const row = activityStore.getSummaryForActivity(activity);

        row.kind = normalizeActivityKind(activity);

        await enrichment.enrichSpotifyActivityLinks(row);

        activity.song_url = row.song_url || null;
        activity.album_url = row.album_url || null;
        activity.artist_links = safeJsonParseArray(row.artist_links_json);
      }

      return res.json({
        id: user.id,
        username: user.username,
        global_name: user.global_name ?? null,
        discriminator: user.discriminator,
        avatar: avatarUrl(user),
        banner: bannerUrl(user),
        avatar_decoration: avatarDecorationUrl(user),
        guild_badge: guildBadgeUrl(user),
        badges: mapBadges(user.public_flags),
        public_flags: user.public_flags,
        primary_guild: user.primary_guild ?? null,
        collectibles: user.collectibles ?? null,
        presence,
        activity_history: activityStore.getAllSummaries(),
      });
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.get("/history", async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(500, Number(req.query.limit || 1000)));

      const rows = await getActivityHistory(limit, enrichment);

      return res.json(rows);
    } catch (error) {
      return res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to read activity history",
      });
    }
  });

  app.get("/api/discord-profile/avatar", async (_req, res) => {
    try {
      const response = await fetch(`${DISCORD_API}/users/${DISCORD_USER_ID}`, {
        headers: {
          Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        },
      });

      if (!response.ok) {
        return res.status(response.status).send("Failed to fetch Discord user");
      }

      const user = await response.json();

      if (!user.avatar) {
        return res.status(404).send("No avatar");
      }

      const isGif = user.avatar.startsWith("a_");

      const avatarUrl = `https://cdn.discordapp.com/avatars/${user.id}/${
        user.avatar
      }.${isGif ? "gif" : "png"}?size=256`;

      const imageResponse = await fetch(avatarUrl);

      if (!imageResponse.ok) {
        return res
          .status(imageResponse.status)
          .send("Failed to fetch avatar image");
      }

      res.setHeader(
        "Content-Type",
        imageResponse.headers.get("content-type") || "image/png",
      );

      res.setHeader("Cache-Control", "public, max-age=300");

      return res.send(Buffer.from(await imageResponse.arrayBuffer()));
    } catch (error) {
      return res
        .status(500)
        .send(error instanceof Error ? error.message : "Avatar proxy failed");
    }
  });
}
