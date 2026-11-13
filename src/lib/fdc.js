import { useCallback, useEffect, useRef, useState } from "react";
import { ACCOUNT_API_URL, accountFetch, getCurrentAccount } from "./account";
import { deleteFdcDraft, draftToPayload, saveFdcDraft, updateFdcDraft } from "./fdcDrafts";
import { getLocalAdminSession } from "./localAdmin";

/*
 * FDC (Friday Dress Code) polls.
 *
 * Live data comes from the account API (server/services/fdcWeb.cjs), which
 * also accepts website votes and new polls. If it is unreachable, the static
 * export in /fdc-polls (scripts/export-fdc.cjs, built with the site) is used
 * as a read-only fallback.
 */

const PUBLIC_ROOT = `${import.meta.env.BASE_URL}fdc-polls/`;
const LIVE_REFRESH_MS = 15_000;

export const FDC_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const FDC_OPTION_COUNT = 4;
export const FDC_DEFAULT_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣"];

export function timestampMs(value) {
  if (value === null || value === undefined) return null;

  const ms =
    typeof value === "number"
      ? value
      : typeof value?.ms === "number"
        ? value.ms
        : Date.parse(value?.iso ?? value);

  return Number.isFinite(ms) ? ms : null;
}

export function isRunningPoll(poll, now = Date.now()) {
  const end = timestampMs(poll?.endsAt);

  return poll?.status === "active" && end !== null && end > now;
}

export function formatPollDate(value, language) {
  const ms = timestampMs(value);

  if (ms === null) return "—";

  return new Intl.DateTimeFormat(language || undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(ms));
}

/** "3 h 12 min" style remaining time. */
export function formatRemaining(value, now, language) {
  const ms = timestampMs(value);
  if (ms === null) return null;

  const minutes = Math.max(0, Math.round((ms - now) / 60_000));
  const format = (unit, amount) =>
    new Intl.NumberFormat(language || undefined, {
      style: "unit",
      unit,
      unitDisplay: "narrow",
    }).format(amount);

  if (minutes < 60) return format("minute", minutes);

  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${format("hour", hours)} ${format("minute", minutes % 60)}`;

  return format("day", Math.round(hours / 24));
}

export function publicPollImage(poll, option) {
  const file = option.image || `${option.number}.webp`;
  // Images are cached for a long time; a replaced image gets a new URL.
  const version = option.imageVersion ? `?v=${option.imageVersion}` : "";

  if (poll.imageBase) {
    return `${ACCOUNT_API_URL}${poll.imageBase}${encodeURIComponent(file)}${version}`;
  }

  return (
    `${PUBLIC_ROOT}${encodeURIComponent(poll.date)}/` +
    encodeURIComponent(file) +
    version
  );
}

/** The option's current (raw) archive image as a File, for the editor. */
export async function fetchPollImageFile(poll, option) {
  const response = await fetch(publicPollImage(poll, option), { cache: "no-cache" });
  if (!response.ok) throw new Error(`Could not load the image (${response.status}).`);

  const blob = await response.blob();
  return new File([blob], `${option.number}.webp`, { type: blob.type || "image/webp" });
}

/** CDN URL of a custom Discord emoji, or null for Unicode emoji. */
export function customEmojiUrl(emoji) {
  if (!emoji?.id) return null;

  return `https://cdn.discordapp.com/emojis/${emoji.id}.${
    emoji.animated ? "gif" : "webp"
  }?size=48`;
}

/* ---------- loading ---------- */

async function fetchServerJson(path, signal) {
  const response = await accountFetch(path, { signal, cache: "no-store" });

  if (response.status === 404) {
    throw Object.assign(new Error("Not found."), { status: 404 });
  }

  if (!response.ok) {
    throw new Error(`Could not load FDC data (${response.status}).`);
  }

  return response.json();
}

async function fetchStaticJson(relativePath, signal) {
  const response = await fetch(`${PUBLIC_ROOT}${relativePath}`, {
    signal,
    cache: "no-cache",
  });

  if (!response.ok) {
    throw new Error(`Could not load FDC data (${response.status}).`);
  }

  const data = await response.json();

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid FDC data.");
  }

  return data;
}

/** Tries the live API first and falls back to the static export. */
async function loadWithFallback(serverPath, staticPath, signal) {
  try {
    return { ...(await fetchServerJson(serverPath, signal)), live: true };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error.status === 404) throw error;

    console.warn("FDC API unavailable, using static data:", error.message);
    return { ...(await fetchStaticJson(staticPath, signal)), live: false };
  }
}

export async function loadFdcSummary(signal) {
  const data = await loadWithFallback("/fdc/summary", "summary.json", signal);

  if (!Array.isArray(data.polls)) {
    throw new Error("Invalid FDC summary.");
  }

  // A local admin session can always prepare polls (saved as drafts).
  const localAdmin = getLocalAdminSession();
  const viewer = localAdmin && !data.viewer?.canCreate
    ? { ...data.viewer, authenticated: true, canCreate: true, local: true }
    : data.viewer;

  return {
    ...data,
    viewer,

    polls: [...data.polls].sort(
      (a, b) => (timestampMs(b.sentAt) ?? 0) - (timestampMs(a.sentAt) ?? 0),
    ),
  };
}

export async function loadFdcPoll(entry, signal) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry?.date ?? "")) {
    throw new Error("Invalid FDC date.");
  }

  const date = encodeURIComponent(entry.date);
  const data = await loadWithFallback(
    `/fdc/polls/${date}`,
    `${date}/data.json`,
    signal,
  );

  if (
    !Array.isArray(data.options) ||
    !data.statistics ||
    data.date !== entry.date
  ) {
    throw new Error("Invalid FDC poll.");
  }

  return data;
}

/* ---------- actions ---------- */

async function postJson(path, body) {
  const response = await accountFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw Object.assign(
      new Error(data?.error || `Request failed (${response.status}).`),
      { status: response.status, serverMessage: Boolean(data?.error) },
    );
  }

  return data;
}

/** Votes for `optionNumber`, or withdraws the vote with null. */
export function voteFdc(pollId, optionNumber) {
  return postJson(`/fdc/polls/${encodeURIComponent(pollId)}/vote`, {
    optionNumber,
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function sendFdc({ endsAt, options }) {
  const payload = await Promise.all(
    options.map(async (option) => ({
      description: option.description,
      emoji: option.emoji,
      image: {
        name: option.file.name,
        type: option.file.type,
        data: await fileToBase64(option.file),
        // Editor settings the bot applies to every frame (GIFs).
        ...(option.edit ? { edit: option.edit } : {}),
      },
    })),
  );

  return postJson("/fdc/polls", { endsAt, options: payload });
}

/* ---------- managing a running poll (editors) ---------- */

/**
 * Changes options of a running poll.
 * `changes`: `[{ number, description?, file? }]`; a file replaces the image
 * in the archive and in the Discord options message.
 */
export async function editFdc(pollId, changes) {
  const options = await Promise.all(
    changes.map(async (change) => ({
      number: change.number,
      ...(change.description !== undefined ? { description: change.description } : {}),
      ...(change.file
        ? {
            image: {
              name: change.file.name,
              type: change.file.type,
              data: await fileToBase64(change.file),
              ...(change.edit ? { edit: change.edit } : {}),
            },
          }
        : {}),
    })),
  );

  return postJson(`/fdc/polls/${encodeURIComponent(pollId)}/edit`, { options });
}

/** Ends a running poll now (results are posted as usual). */
export function closeFdc(pollId) {
  return postJson(`/fdc/polls/${encodeURIComponent(pollId)}/close`, { confirm: true });
}

/** Deletes a running poll everywhere: Discord messages and archive. */
export function discardFdc(pollId) {
  return postJson(`/fdc/polls/${encodeURIComponent(pollId)}/discard`, { confirm: true });
}

/** Whether a failed send should be kept as a draft instead of discarded. */
function isServerUnavailable(error) {
  if (!error.status) return true; // network error / CORS on a 502 page
  if (error.status >= 500 || error.status === 404) return true;
  return [401, 403].includes(error.status) && Boolean(getLocalAdminSession());
}

/**
 * Creates and sends a new FDC poll through the bot.
 * `options`: `[{ file, description, emoji }]` × 4; `endsAt`: ISO string or
 * a duration such as "24h" (counted from when it is sent).
 *
 * When the server is unreachable (or the session is local-only), the poll
 * is saved as a draft on this device instead: `{ queued: true, draft }`.
 */
export async function createFdc(input) {
  try {
    return await sendFdc(input);
  } catch (error) {
    if (!isServerUnavailable(error)) throw error;

    const draft = await saveFdcDraft(input);
    return { queued: true, draft, reason: error.message };
  }
}

/** Tries to send a saved draft; removes it on success. */
export async function sendFdcDraft(draft) {
  try {
    const result = await sendFdc(draftToPayload(draft));
    await deleteFdcDraft(draft.id);
    return result;
  } catch (error) {
    const message =
      [401, 403].includes(error.status)
        ? "Log in with the admin code while the server is online to send drafts."
        : !error.status || error.status >= 500
          ? "The server is still unreachable."
          : error.message;

    await updateFdcDraft(draft.id, { lastError: message, lastTriedAt: Date.now() });
    throw new Error(message);
  }
}

/* ---------- hooks ---------- */

function useLoader(key, load, { refreshMs } = {}) {
  const [state, setState] = useState({
    key: null,
    data: null,
    loading: false,
    error: null,
  });
  const [version, setVersion] = useState(0);
  const loadRef = useRef(load);

  useEffect(() => {
    loadRef.current = load;
  });

  const reload = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    if (!key) return undefined;

    const controller = new AbortController();

    loadRef.current(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setState({ key, data, loading: false, error: null });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        // Keep showing the last data when a background refresh fails.
        setState((current) =>
          current.key === key && current.data
            ? current
            : { key, data: null, loading: false, error: error.message },
        );
      });

    return () => controller.abort();
  }, [key, version]);

  useEffect(() => {
    if (!key || !refreshMs) return undefined;

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, refreshMs);

    return () => window.clearInterval(timer);
  }, [key, refreshMs, reload]);

  if (!key) return { data: null, loading: false, error: null, reload };
  if (state.key !== key) return { data: null, loading: true, error: null, reload };

  return { ...state, reload };
}

export function useFdcSummary() {
  return useLoader("summary", loadFdcSummary, { refreshMs: LIVE_REFRESH_MS * 4 });
}

export function useFdcPoll(entry, { live = false } = {}) {
  const key = entry?.id && entry?.date ? `${entry.id}:${entry.date}` : null;

  return useLoader(
    key,
    (signal) => loadFdcPoll({ id: entry.id, date: entry.date }, signal),
    { refreshMs: live ? LIVE_REFRESH_MS : 0 },
  );
}

export function useFdcAccount() {
  const [state, setState] = useState({
    loading: true,
    authenticated: false,
    user: null,
    displayName: null,
  });

  useEffect(() => {
    let active = true;

    getCurrentAccount()
      .then((user) => {
        if (!active) return;

        setState({
          loading: false,
          authenticated: Boolean(user),
          user,
          displayName: user?.displayName ?? null,
        });
      })
      .catch((error) => {
        if (!active) return;

        console.error("Could not load current account:", error);
        setState({
          loading: false,
          authenticated: false,
          user: null,
          displayName: null,
        });
      });

    return () => {
      active = false;
    };
  }, []);

  return state;
}

export function useFdcClock(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}
