import { seasonFor } from '/shared/seasons.mjs'

/* The seasonal logo and favicon (the seasons are in shared/seasons.mjs). */

const ASSET_BASE_PATH = '/hehehe'

export const getSeasonalCode = (date = new Date()) => seasonFor(date)

export function getDiscordPicSrc(date = new Date()) {
  return `${ASSET_BASE_PATH}/${getSeasonalCode(date)}-logo.webp`
}

export function getFaviconSrc(date = new Date()) {
  return `${ASSET_BASE_PATH}/${getSeasonalCode(date)}-icon.webp`
}
