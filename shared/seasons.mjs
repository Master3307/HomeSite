import SEASONS from "./seasons.json";

/*
 * Seasonal looks (logo, favicon, emails): the code of the season for a date.
 * The ranges (shared/seasons.json, "MM-DD", both days included) repeat every
 * year; outside of them the code is "general". Assets:
 * public/hehehe/<code>-logo.webp|png and <code>-icon.webp. The server
 * (emails, services/mailTemplate.cjs) reads the same JSON.
 */

export { SEASONS };
export const FALLBACK_SEASON = "general";

const monthDay = (date) => `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function seasonFor(date = new Date()) {
  const today = monthDay(date);
  const season = SEASONS.find(({ from, to }) => (from <= to ? today >= from && today <= to : today >= from || today <= to));
  return season?.code ?? FALLBACK_SEASON;
}
