import { ActivityType } from "discord.js";

export function safeJsonParseArray(value) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[®™:]/g, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/\[.*?\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function scoreNameMatch(query, candidate) {
  const queryValue = normalizeName(query);
  const candidateValue = normalizeName(candidate);

  if (!queryValue || !candidateValue) return 0;
  if (queryValue === candidateValue) return 100;
  if (candidateValue.startsWith(queryValue)) return 90;
  if (queryValue.startsWith(candidateValue)) return 85;
  if (
    candidateValue.includes(queryValue) ||
    queryValue.includes(candidateValue)
  ) {
    return 75;
  }

  const queryWords = new Set(queryValue.split(" ").filter(Boolean));
  const candidateWords = new Set(candidateValue.split(" ").filter(Boolean));

  let overlap = 0;

  for (const word of queryWords) {
    if (candidateWords.has(word)) {
      overlap++;
    }
  }

  return overlap * 10;
}

export function normalizeActivityKind(activity) {
  if (activity.type === ActivityType.Listening || activity.name === "Spotify") {
    return "music";
  }

  if (activity.type === ActivityType.Playing) {
    return "game";
  }

  return "activity";
}

export function activityKey(activity) {
  const kind = normalizeActivityKind(activity);

  if (kind === "music") {
    return `music:${activity.name || "unknown"}`;
  }

  if (kind === "game") {
    return `game:${activity.name || "unknown"}`;
  }

  return `activity:${activity.type}:${activity.application_id || "na"}:${
    activity.name || "unknown"
  }`;
}

export function sameUtcDay(first, second) {
  return (
    first.getUTCFullYear() === second.getUTCFullYear() &&
    first.getUTCMonth() === second.getUTCMonth() &&
    first.getUTCDate() === second.getUTCDate()
  );
}

export function yesterdayUtc(date) {
  const yesterday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );

  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  return yesterday;
}

export function updateGameStreak(existing, nowIso) {
  const now = new Date(nowIso);
  const last = existing.last_active_at
    ? new Date(existing.last_active_at)
    : null;

  if (!last) return 1;
  if (sameUtcDay(last, now)) return existing.streak || 1;
  if (sameUtcDay(last, yesterdayUtc(now))) {
    return (existing.streak || 1) + 1;
  }

  return 1;
}
