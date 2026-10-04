import { ActivityType } from "discord.js";

import { CDN } from "./config.js";
import { USER_FLAGS } from "./constants.js";

function hasFlag(bits = 0, flag) {
  return (bits & flag) === flag;
}

export function mapBadges(publicFlags = 0) {
  const badges = [];

  if (hasFlag(publicFlags, USER_FLAGS.STAFF)) {
    badges.push({
      key: "staff",
      label: "Discord Staff",
    });
  }

  if (hasFlag(publicFlags, USER_FLAGS.PARTNER)) {
    badges.push({
      key: "partner",
      label: "Partnered Server Owner",
    });
  }

  if (hasFlag(publicFlags, USER_FLAGS.HYPESQUAD)) {
    badges.push({
      key: "hypesquad",
      label: "HypeSquad Events",
    });
  }

  if (hasFlag(publicFlags, USER_FLAGS.BUG_HUNTER_LEVEL_1)) {
    badges.push({
      key: "bug-hunter-1",
      label: "Bug Hunter Lv1",
    });
  }

  if (hasFlag(publicFlags, USER_FLAGS.HYPESQUAD_ONLINE_HOUSE_1)) {
    badges.push({
      key: "bravery",
      label: "House Bravery",
    });
  }

  if (hasFlag(publicFlags, USER_FLAGS.HYPESQUAD_ONLINE_HOUSE_2)) {
    badges.push({
      key: "brilliance",
      label: "House Brilliance",
    });
  }

  if (hasFlag(publicFlags, USER_FLAGS.HYPESQUAD_ONLINE_HOUSE_3)) {
    badges.push({
      key: "balance",
      label: "House Balance",
    });
  }

  if (hasFlag(publicFlags, USER_FLAGS.PREMIUM_EARLY_SUPPORTER)) {
    badges.push({
      key: "early-supporter",
      label: "Early Supporter",
    });
  }

  if (hasFlag(publicFlags, USER_FLAGS.BUG_HUNTER_LEVEL_2)) {
    badges.push({
      key: "bug-hunter-2",
      label: "Bug Hunter Lv2",
    });
  }

  if (hasFlag(publicFlags, USER_FLAGS.VERIFIED_DEVELOPER)) {
    badges.push({
      key: "verified-developer",
      label: "Early Verified Bot Developer",
    });
  }

  if (hasFlag(publicFlags, USER_FLAGS.CERTIFIED_MODERATOR)) {
    badges.push({
      key: "moderator",
      label: "Moderator Programs Alumni",
    });
  }

  if (hasFlag(publicFlags, USER_FLAGS.ACTIVE_DEVELOPER)) {
    badges.push({
      key: "active-developer",
      label: "Active Developer",
    });
  }

  return badges;
}

export function avatarUrl(user) {
  if (!user?.avatar) {
    const index = Number(user?.discriminator || 0) % 5;

    return `${CDN}/embed/avatars/${index}.png`;
  }

  const isGif = user.avatar.startsWith("a_");

  return `${CDN}/avatars/${user.id}/${user.avatar}.${
    isGif ? "gif" : "webp"
  }?size=256`;
}

export function bannerUrl(user) {
  if (!user?.banner) return null;

  const isGif = user.banner.startsWith("a_");

  return `${CDN}/banners/${user.id}/${user.banner}.${
    isGif ? "gif" : "webp"
  }?size=512`;
}

export function avatarDecorationUrl(user) {
  const asset = user?.avatar_decoration_data?.asset;

  if (!asset) return null;

  return `${CDN}/avatar-decoration-presets/${asset}.png`;
}

export function guildBadgeUrl(user) {
  const guildId = user?.primary_guild?.identity_guild_id;
  const badge = user?.primary_guild?.badge;

  if (!guildId || !badge) return null;

  return `${CDN}/guild-tag-badges/${guildId}/${badge}.png`;
}

export function snowflakeToTimestamp(snowflake) {
  try {
    const discordEpoch = 1420070400000n;
    const timestamp = (BigInt(snowflake) >> 22n) + discordEpoch;

    return new Date(Number(timestamp)).toISOString();
  } catch {
    return null;
  }
}

export function memberAvatarUrl(member) {
  if (!member?.avatar) return null;

  const isGif = member.avatar.startsWith("a_");

  return `${CDN}/guilds/${member.guild.id}/users/${member.id}/avatars/${
    member.avatar
  }.${isGif ? "gif" : "webp"}?size=256`;
}

export function memberBannerUrl(member) {
  if (!member?.banner) return null;

  const isGif = member.banner.startsWith("a_");

  return `${CDN}/guilds/${member.guild.id}/users/${member.id}/banners/${
    member.banner
  }.${isGif ? "gif" : "webp"}?size=512`;
}

export function formatRole(role) {
  return {
    id: role.id,
    name: role.name,
    color: role.hexColor,
    color_value: role.color,
    position: role.position,
    hoist: role.hoist,
    managed: role.managed,
    mentionable: role.mentionable,
    icon:
      role.iconURL({
        extension: "webp",
        size: 128,
      }) ?? null,
    unicode_emoji: role.unicodeEmoji ?? null,
    permissions: role.permissions.bitfield.toString(),
    created_at: snowflakeToTimestamp(role.id),
  };
}

export function formatActivity(activity) {
  const largeImage = activity.assets?.largeImageURL() ?? null;
  const smallImage = activity.assets?.smallImageURL() ?? null;

  return {
    name: activity.name,
    type: activity.type,
    type_label: ActivityType[activity.type] ?? "Unknown",
    details: activity.details ?? null,
    state: activity.state ?? null,
    emoji: activity.emoji
      ? {
          name: activity.emoji.name,
          id: activity.emoji.id,
          animated: activity.emoji.animated,
        }
      : null,
    timestamps: activity.timestamps
      ? {
          start: activity.timestamps.start
            ? new Date(activity.timestamps.start).toISOString()
            : null,
          end: activity.timestamps.end
            ? new Date(activity.timestamps.end).toISOString()
            : null,
        }
      : null,
    assets: activity.assets
      ? {
          large_image: largeImage,
          large_text: activity.assets.largeText ?? null,
          small_image: smallImage,
          small_text: activity.assets.smallText ?? null,
        }
      : null,
    image_url: largeImage || smallImage || null,
    application_id: activity.applicationId ?? null,
    url: activity.url ?? null,
    sync_id: activity.syncId ?? null,
    buttons: Array.isArray(activity.buttons) ? activity.buttons : [],
    party: activity.party
      ? {
          id: activity.party.id ?? null,
          size: Array.isArray(activity.party.size) ? activity.party.size : null,
        }
      : null,
    created_at: activity.createdTimestamp
      ? new Date(activity.createdTimestamp).toISOString()
      : null,
  };
}

export function formatPresence(presence) {
  if (!presence) {
    return null;
  }

  return {
    status: presence.status ?? "offline",
    client_status: presence.clientStatus ?? {},
    activities: (presence.activities ?? []).map(formatActivity),
  };
}

export function formatLiveGuildMember(member) {
  const roles = member.roles.cache
    .filter((role) => role.id !== member.guild.id)
    .sort((first, second) => second.position - first.position)
    .map(formatRole);

  return {
    guild_id: member.guild.id,
    guild_name: member.guild.name,
    id: member.id,
    nickname: member.nickname ?? null,
    display_name:
      member.displayName ?? member.user.globalName ?? member.user.username,
    avatar: memberAvatarUrl(member),
    banner: memberBannerUrl(member),
    joined_at: member.joinedAt?.toISOString() ?? null,
    premium_since: member.premiumSince?.toISOString() ?? null,
    communication_disabled_until:
      member.communicationDisabledUntil?.toISOString() ?? null,
    pending: member.pending ?? false,
    deaf: member.deaf ?? false,
    mute: member.mute ?? false,
    flags: member.flags?.bitfield?.toString?.() ?? "0",
    roles,
    role_ids: roles.map((role) => role.id),
    highest_role: member.roles.highest
      ? formatRole(member.roles.highest)
      : null,
    permissions: member.permissions.bitfield.toString(),
    permissions_in_guild: member.permissions.toArray(),
  };
}
