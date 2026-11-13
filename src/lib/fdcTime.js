/*
 * FDC times are Europe/Berlin times (the server's and the cult's clock),
 * whatever time zone the visitor's browser is in. These helpers convert
 * between real moments (Date) and Berlin wall-clock time, and format a
 * moment in the visitor's local time when that differs.
 */

export const FDC_TIME_ZONE = "Europe/Berlin";

const partsFormatter = new Map();

function formatterFor(timeZone) {
  if (!partsFormatter.has(timeZone)) {
    partsFormatter.set(
      timeZone,
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        weekday: "short",
      }),
    );
  }
  return partsFormatter.get(timeZone);
}

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall-clock parts of `date` in `timeZone`: { year, month (1–12), day, hour, minute, weekday }. */
export function zonedParts(date, timeZone = FDC_TIME_ZONE) {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday] ?? 0,
  };
}

/* Offset of `timeZone` from UTC at a moment, in ms. */
function zoneOffset(ms, timeZone) {
  const parts = zonedParts(new Date(ms), timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return asUtc - Math.floor(ms / 60_000) * 60_000;
}

/** The moment when the wall clock in `timeZone` shows these parts. */
export function fromZoned({ year, month, day, hour = 0, minute = 0 }, timeZone = FDC_TIME_ZONE) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let result = guess - zoneOffset(guess, timeZone);
  // Around a DST switch the offset can differ at the result; correct once.
  const second = guess - zoneOffset(result, timeZone);
  if (second !== result) result = second;
  return new Date(result);
}

/** Calendar day arithmetic on { year, month, day } (time zone free). */
export function addDays({ year, month, day }, amount) {
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** Tomorrow (Berlin) at hour:minute (Berlin). */
export function tomorrowAt(hour, minute = 0, now = new Date()) {
  const today = zonedParts(now);
  return fromZoned({ ...addDays(today, 1), hour, minute });
}

/** Whether the visitor's clock shows something else than Berlin at `date`. */
export function differsFromLocal(date) {
  const berlin = zonedParts(date);
  const local = {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
  return ["year", "month", "day", "hour", "minute"].some((key) => berlin[key] !== local[key]);
}

export function formatZoned(date, language, options, timeZone = FDC_TIME_ZONE) {
  return new Intl.DateTimeFormat(language || undefined, { ...options, timeZone }).format(date);
}

export function formatLocal(date, language, options) {
  return new Intl.DateTimeFormat(language || undefined, options).format(date);
}

/*
 * Local time for a Berlin time, worded relative to it: only the time when
 * it's the same day, else weekday + time.
 */
export function localHint(date, language) {
  if (!differsFromLocal(date)) return null;
  const sameDay = zonedParts(date).day === date.getDate();
  return formatLocal(
    date,
    language,
    sameDay ? { hour: "2-digit", minute: "2-digit" } : { weekday: "short", hour: "2-digit", minute: "2-digit" },
  );
}
