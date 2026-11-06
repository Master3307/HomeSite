import { useEffect, useState } from "react";
import { ACCOUNT_API_URL } from "./account";

const PUBLIC_ROOT = `${import.meta.env.BASE_URL}fdc-polls/`;

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

export function publicPollImage(poll, option) {
  return (
    `${PUBLIC_ROOT}${encodeURIComponent(poll.date)}/` +
    `${encodeURIComponent(option.image || `${option.number}.webp`)}`
  );
}

/*
 * Future public/auth-aware server integration.
 *
 * Return the same summary/poll shape as the static export.
 * Pass the caller's AbortSignal to fetch when implementing these.
 *
 * Do not expose private voter identities through public responses.
 */
async function fetchSummaryFromServer() {
  return null;
}

async function fetchPollFromServer() {
  return null;
}

/*
 * Future private endpoint:
 * authenticate on the server before returning voter identities.
 */
export async function fetchPrivatePollVoters() {
  return null;
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

export async function loadFdcSummary(signal) {
  const serverData = await fetchSummaryFromServer({ signal });

  const data = serverData ?? (await fetchStaticJson("summary.json", signal));

  if (!Array.isArray(data.polls)) {
    throw new Error("Invalid FDC summary.");
  }

  return {
    ...data,

    polls: [...data.polls].sort(
      (a, b) => (timestampMs(b.sentAt) ?? 0) - (timestampMs(a.sentAt) ?? 0),
    ),
  };
}

export async function loadFdcPoll(entry, signal) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry?.date ?? "")) {
    throw new Error("Invalid FDC date.");
  }

  const serverData = await fetchPollFromServer({
    id: entry.id,
    date: entry.date,
    signal,
  });

  const data =
    serverData ??
    (await fetchStaticJson(
      `${encodeURIComponent(entry.date)}/data.json`,
      signal,
    ));

  if (
    !Array.isArray(data.options) ||
    !data.statistics ||
    data.date !== entry.date
  ) {
    throw new Error("Invalid FDC poll.");
  }

  return data;
}

export function useFdcSummary() {
  const [state, setState] = useState({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();

    loadFdcSummary(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;

        setState({
          data,
          loading: false,
          error: null,
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;

        setState({
          data: null,
          loading: false,
          error: error.message,
        });
      });

    return () => controller.abort();
  }, []);

  return state;
}

export function useFdcPoll(entry) {
  const id = entry?.id;
  const date = entry?.date;

  const [state, setState] = useState({
    key: null,
    data: null,
    loading: false,
    error: null,
  });

  const key = id && date ? `${id}:${date}` : null;

  useEffect(() => {
    if (!key) return undefined;

    const controller = new AbortController();

    loadFdcPoll({ id, date }, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;

        setState({
          key,
          data,
          loading: false,
          error: null,
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;

        setState({
          key,
          data: null,
          loading: false,
          error: error.message,
        });
      });

    return () => controller.abort();
  }, [id, date, key]);

  if (!key) {
    return {
      data: null,
      loading: false,
      error: null,
    };
  }

  if (state.key !== key) {
    return {
      data: null,
      loading: true,
      error: null,
    };
  }

  return state;
}

export function useFdcAccount() {
  const [state, setState] = useState({
    loading: true,
    authenticated: false,
    displayName: null,
  });

  useEffect(() => {
    const controller = new AbortController();

    async function loadAccount() {
      try {
        const response = await fetch(`${ACCOUNT_API_URL}/auth/me`, {
          credentials: "include",
          signal: controller.signal,
          cache: "no-store",
        });

        if (!response.ok) {
          if (!controller.signal.aborted) {
            setState({
              loading: false,
              authenticated: false,
              displayName: null,
            });
          }

          return;
        }

        const data = await response.json();

        if (controller.signal.aborted) return;

        setState({
          loading: false,
          authenticated: data.authenticated === true,
          displayName: data.user?.displayName ?? null,
        });
      } catch (error) {
        if (controller.signal.aborted) return;

        console.error("Could not load current account:", error);

        setState({
          loading: false,
          authenticated: false,
          displayName: null,
        });
      }
    }

    loadAccount();

    return () => controller.abort();
  }, []);

  return state;
}

export function useFdcClock() {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  return now;
}
