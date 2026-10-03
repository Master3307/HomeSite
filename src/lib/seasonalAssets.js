const ASSET_BASE_PATH = "/hehehe";
const FALLBACK_CODE = "general";

const SEASONAL_OVERRIDES = [
  {
    code: "halloween",
    start: "2026-10-01",
    end: "2026-11-01",
  },
];

function toStartOfDay(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);

  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function toEndOfDay(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);

  return new Date(year, month - 1, day, 23, 59, 59, 999);
}

function isWithinRange(date, start, end) {
  return date >= toStartOfDay(start) && date <= toEndOfDay(end);
}

export function getSeasonalCode(date = new Date()) {
  const activeOverride = SEASONAL_OVERRIDES.find(({ start, end }) =>
    isWithinRange(date, start, end),
  );

  return activeOverride?.code ?? FALLBACK_CODE;
}

export function getDiscordPicSrc(date = new Date()) {
  return `${ASSET_BASE_PATH}/${getSeasonalCode(date)}-logo.webp`;
}

export function getFaviconSrc(date = new Date()) {
  return `${ASSET_BASE_PATH}/${getSeasonalCode(date)}-icon.webp`;
}
