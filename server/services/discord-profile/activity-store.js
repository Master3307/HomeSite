import path from "node:path";
import { fileURLToPath } from "node:url";

import { ACTIVITY_HEADERS, SESSION_HEADERS } from "./constants.js";

import { appendCsvRow, readCsvRows, writeCsvRows } from "./file-store.js";

import { formatPresence } from "./discord-formatters.js";

import {
  activityKey,
  normalizeActivityKind,
  safeJsonParseArray,
  updateGameStreak,
} from "./utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_DIR = path.join(__dirname, "..", "db");

const ACTIVITY_CSV_PATH = path.join(DB_DIR, "activity.csv");
const ACTIVITY_SESSIONS_CSV_PATH = path.join(DB_DIR, "activity_sessions.csv");

function toActivityRow(
  activity,
  existing = null,
  nowIso = new Date().toISOString(),
) {
  const kind = normalizeActivityKind(activity);

  return {
    key: activityKey(activity),
    kind,
    name: activity.name ?? null,
    type: activity.type ?? null,
    type_label: activity.type_label ?? null,
    application_id: activity.application_id ?? null,
    details: activity.details ?? null,
    state: activity.state ?? null,
    emoji_name: activity.emoji?.name ?? null,
    emoji_id: activity.emoji?.id ?? null,
    emoji_animated: activity.emoji?.animated ?? null,
    url: activity.url ?? null,
    sync_id: activity.sync_id ?? null,
    party_id: activity.party?.id ?? null,
    party_size_current: activity.party?.size?.[0] ?? null,
    party_size_max: activity.party?.size?.[1] ?? null,
    button_1: activity.buttons?.[0] ?? null,
    button_2: activity.buttons?.[1] ?? null,
    large_image: activity.assets?.large_image ?? null,
    large_text: activity.assets?.large_text ?? null,
    small_image: activity.assets?.small_image ?? null,
    small_text: activity.assets?.small_text ?? null,
    image_source:
      existing?.image_source ??
      (activity.assets?.small_image || activity.assets?.large_image
        ? "discord"
        : null),
    first_seen_at: existing?.first_seen_at ?? nowIso,
    last_active_at: nowIso,
    last_started_at:
      existing?.last_started_at ?? activity.timestamps?.start ?? nowIso,
    last_ended_at: existing?.last_ended_at ?? null,
    total_active_ms: Number(existing?.total_active_ms || 0),
    total_active_seconds: Math.floor(
      Number(existing?.total_active_ms || 0) / 1000,
    ),
    total_active_minutes: Math.floor(
      Number(existing?.total_active_ms || 0) / 60000,
    ),
    session_count: Number(existing?.session_count || 0),
    streak: kind === "game" ? Number(existing?.streak || 0) : null,
    is_active: true,
    active_session_started_at:
      existing?.active_session_started_at ??
      activity.timestamps?.start ??
      nowIso,
    song_url: existing?.song_url ?? null,
    album_url: existing?.album_url ?? null,
    artist_links_json: existing?.artist_links_json ?? "[]",
    last_sync_id: existing?.last_sync_id ?? null,
  };
}

function sessionFromSummary(summary, endedAtIso) {
  const startedAtIso =
    summary.active_session_started_at || summary.last_started_at || endedAtIso;

  const durationMs = Math.max(
    0,
    new Date(endedAtIso).getTime() - new Date(startedAtIso).getTime(),
  );

  return {
    session_id: `${summary.key}:${new Date(
      startedAtIso,
    ).getTime()}:${new Date(endedAtIso).getTime()}`,
    key: summary.key,
    kind: summary.kind,
    name: summary.name,
    type: summary.type,
    type_label: summary.type_label,
    application_id: summary.application_id,
    details: summary.details,
    state: summary.state,
    emoji_name: summary.emoji_name,
    emoji_id: summary.emoji_id,
    emoji_animated: summary.emoji_animated,
    url: summary.url,
    sync_id: summary.sync_id,
    party_id: summary.party_id,
    party_size_current: summary.party_size_current,
    party_size_max: summary.party_size_max,
    button_1: summary.button_1,
    button_2: summary.button_2,
    large_image: summary.large_image,
    large_text: summary.large_text,
    small_image: summary.small_image,
    small_text: summary.small_text,
    image_source: summary.image_source ?? null,
    started_at: startedAtIso,
    ended_at: endedAtIso,
    duration_ms: durationMs,
    duration_seconds: Math.floor(durationMs / 1000),
    duration_minutes: Math.floor(durationMs / 60000),
    song_url: summary.song_url ?? null,
    album_url: summary.album_url ?? null,
    artist_links_json: summary.artist_links_json ?? "[]",
    last_sync_id: summary.last_sync_id ?? null,
  };
}

export function summaryForApi(summary) {
  const { active_session_started_at, ...row } = summary;
  const imageUrl = row.small_image || row.large_image || null;

  return {
    ...row,
    type: row.type === "" ? null : Number(row.type),
    party_size_current:
      row.party_size_current === "" ? null : Number(row.party_size_current),
    party_size_max:
      row.party_size_max === "" ? null : Number(row.party_size_max),
    total_active_ms: Number(row.total_active_ms || 0),
    total_active_seconds: Math.floor(Number(row.total_active_ms || 0) / 1000),
    total_active_minutes: Math.floor(Number(row.total_active_ms || 0) / 60000),
    session_count: Number(row.session_count || 0),
    streak: row.streak == null || row.streak === "" ? null : Number(row.streak),
    is_active: row.is_active === true || row.is_active === "true",
    active_session_started_at,
    image_url: imageUrl,
    song_url: row.song_url || null,
    album_url: row.album_url || null,
    artist_links: safeJsonParseArray(row.artist_links_json),
  };
}

function historyRowForApi(row) {
  const imageUrl = row.small_image || row.large_image || null;

  return {
    ...row,
    type: row.type === "" ? null : Number(row.type),
    party_size_current:
      row.party_size_current === "" ? null : Number(row.party_size_current),
    party_size_max:
      row.party_size_max === "" ? null : Number(row.party_size_max),
    duration_ms: Number(row.duration_ms || 0),
    duration_seconds: Number(row.duration_seconds || 0),
    duration_minutes: Number(row.duration_minutes || 0),
    image_url: imageUrl,
    song_url: row.song_url || null,
    album_url: row.album_url || null,
    artist_links: safeJsonParseArray(row.artist_links_json),
  };
}

export function createActivityStore({ enrichment }) {
  let store = new Map();
  let writeQueue = Promise.resolve();

  async function load() {
    const rows = await readCsvRows(ACTIVITY_CSV_PATH, ACTIVITY_HEADERS);

    const map = new Map();

    for (const row of rows) {
      await enrichment.enrichRow(row);

      map.set(row.key, {
        ...row,
        total_active_ms: Number(row.total_active_ms || 0),
        session_count: Number(row.session_count || 0),
        streak: row.streak === "" ? null : Number(row.streak),
        is_active: row.is_active === "true",
        active_session_started_at:
          row.is_active === "true" ? row.last_started_at || null : null,
        last_sync_id: row.last_sync_id || null,
      });
    }

    store = map;

    await persist();

    return store;
  }

  async function persist() {
    const rows = [...store.values()].sort(
      (first, second) =>
        new Date(second.last_active_at || 0).getTime() -
        new Date(first.last_active_at || 0).getTime(),
    );

    for (const row of rows) {
      await enrichment.enrichRow(row);
    }

    const output = rows.map((row) => ({
      ...row,
      total_active_seconds: Math.floor(Number(row.total_active_ms || 0) / 1000),
      total_active_minutes: Math.floor(
        Number(row.total_active_ms || 0) / 60000,
      ),
      is_active: row.is_active ? "true" : "false",
    }));

    await writeCsvRows(ACTIVITY_CSV_PATH, ACTIVITY_HEADERS, output);
  }

  function queueWrite(task) {
    writeQueue = writeQueue.then(task).catch((error) => {
      console.error("Activity write failed:", error);
    });

    return writeQueue;
  }

  async function closeInactiveActivities(liveKeys, nowIso) {
    for (const [key, summary] of store.entries()) {
      if (!summary.is_active || liveKeys.has(key)) {
        continue;
      }

      const sessionRow = sessionFromSummary(summary, nowIso);

      await enrichment.enrichRow(sessionRow);

      summary.total_active_ms =
        Number(summary.total_active_ms || 0) + sessionRow.duration_ms;

      summary.total_active_seconds = Math.floor(summary.total_active_ms / 1000);

      summary.total_active_minutes = Math.floor(
        summary.total_active_ms / 60000,
      );

      summary.session_count = Number(summary.session_count || 0) + 1;

      summary.last_ended_at = nowIso;
      summary.is_active = false;
      summary.active_session_started_at = null;

      store.set(key, summary);

      await appendCsvRow(
        ACTIVITY_SESSIONS_CSV_PATH,
        SESSION_HEADERS,
        sessionRow,
      );
    }
  }

  async function syncPresence(presence, reason = "poll") {
    const nowIso = new Date().toISOString();
    const activities = formatPresence(presence)?.activities ?? [];
    const liveKeys = new Set();

    for (const activity of activities) {
      const key = activityKey(activity);

      liveKeys.add(key);

      const existing = store.get(key);
      const next = toActivityRow(activity, existing, nowIso);

      if (!existing || !existing.is_active) {
        next.active_session_started_at = activity.timestamps?.start || nowIso;

        if (next.kind === "game") {
          next.streak = updateGameStreak(existing || {}, nowIso);
        }
      } else {
        next.active_session_started_at =
          existing.active_session_started_at ||
          existing.last_started_at ||
          activity.timestamps?.start ||
          nowIso;

        next.streak = existing.streak ?? next.streak;
      }

      next.total_active_ms = Number(existing?.total_active_ms || 0);

      next.total_active_seconds = Math.floor(next.total_active_ms / 1000);

      next.total_active_minutes = Math.floor(next.total_active_ms / 60000);

      next.session_count = Number(existing?.session_count || 0);
      next.last_ended_at = existing?.last_ended_at ?? null;
      next.is_active = true;

      await enrichment.enrichRow(next);

      store.set(key, next);
    }

    await closeInactiveActivities(liveKeys, nowIso);

    if (reason !== "silent") {
      await queueWrite(() => persist());
    }
  }

  function getSummaryForActivity(activity) {
    const existing = store.get(activityKey(activity));
    const row = toActivityRow(activity, existing);

    row.kind = normalizeActivityKind(activity);

    return row;
  }

  function getAllSummaries() {
    return [...store.values()]
      .sort(
        (first, second) =>
          new Date(second.last_active_at || 0).getTime() -
          new Date(first.last_active_at || 0).getTime(),
      )
      .map(summaryForApi);
  }

  return {
    load,
    syncPresence,
    getSummaryForActivity,
    getAllSummaries,
    get rawStore() {
      return store;
    },
  };
}

export async function getActivityHistory(limit, enrichment) {
  const rows = await readCsvRows(ACTIVITY_SESSIONS_CSV_PATH, SESSION_HEADERS);

  let touched = false;

  for (const row of rows) {
    const beforeImage = row.small_image || row.large_image || "";
    const beforeSong = row.song_url || "";
    const beforeArtists = row.artist_links_json || "";
    const beforeSync = row.last_sync_id || "";

    await enrichment.enrichRow(row);

    if (
      beforeImage !== (row.small_image || row.large_image || "") ||
      beforeSong !== (row.song_url || "") ||
      beforeArtists !== (row.artist_links_json || "") ||
      beforeSync !== (row.last_sync_id || "")
    ) {
      touched = true;
    }
  }

  if (touched) {
    await writeCsvRows(ACTIVITY_SESSIONS_CSV_PATH, SESSION_HEADERS, rows);
  }

  const sorted = rows.sort(
    (first, second) =>
      new Date(second.ended_at || second.started_at || 0).getTime() -
      new Date(first.ended_at || first.started_at || 0).getTime(),
  );

  let latestMusicIncluded = false;

  const filtered = sorted.filter((row) => {
    if (row.kind !== "music") {
      return true;
    }

    if (latestMusicIncluded) {
      return false;
    }

    latestMusicIncluded = true;

    return true;
  });

  return filtered.slice(0, limit).map(historyRowForApi);
}
