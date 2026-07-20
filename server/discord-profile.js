import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { Client, GatewayIntentBits, ActivityType } from 'discord.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(cors())

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN
const DISCORD_USER_ID = process.env.DISCORD_USER_ID
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID
const IGDB_CLIENT_ID = process.env.IGDB_CLIENT_ID
const IGDB_CLIENT_SECRET = process.env.IGDB_CLIENT_SECRET
const STEAMGRIDDB_API_KEY = process.env.STEAMGRIDDB_API_KEY
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET
const PORT = process.env.PORT || 3001
const ACTIVITY_POLL_INTERVAL_MS = Math.max(15000, Number(process.env.ACTIVITY_POLL_INTERVAL_MS || 30000))

const ACTIVITY_CSV_PATH = path.join(__dirname, 'activity.csv')
const ACTIVITY_SESSIONS_CSV_PATH = path.join(__dirname, 'activity_sessions.csv')
const GAME_IMAGE_CACHE_PATH = path.join(__dirname, 'game_image_cache.json')

if (!DISCORD_BOT_TOKEN) throw new Error('Missing DISCORD_BOT_TOKEN')
if (!DISCORD_USER_ID) throw new Error('Missing DISCORD_USER_ID')
if (!DISCORD_GUILD_ID) throw new Error('Missing DISCORD_GUILD_ID')

const DISCORD_API = 'https://discord.com/api/v10'
const CDN = 'https://cdn.discordapp.com'
const STEAMGRIDDB_API = 'https://www.steamgriddb.com/api/v2'

const ACTIVITY_HEADERS = [
  'key',
  'kind',
  'name',
  'type',
  'type_label',
  'application_id',
  'details',
  'state',
  'emoji_name',
  'emoji_id',
  'emoji_animated',
  'url',
  'sync_id',
  'party_id',
  'party_size_current',
  'party_size_max',
  'button_1',
  'button_2',
  'large_image',
  'large_text',
  'small_image',
  'small_text',
  'image_source',
  'first_seen_at',
  'last_active_at',
  'last_started_at',
  'last_ended_at',
  'total_active_ms',
  'total_active_seconds',
  'total_active_minutes',
  'session_count',
  'streak',
  'is_active',
  'song_url',
  'album_url',
  'artist_links_json',
  'last_sync_id',
]

const SESSION_HEADERS = [
  'session_id',
  'key',
  'kind',
  'name',
  'type',
  'type_label',
  'application_id',
  'details',
  'state',
  'emoji_name',
  'emoji_id',
  'emoji_animated',
  'url',
  'sync_id',
  'party_id',
  'party_size_current',
  'party_size_max',
  'button_1',
  'button_2',
  'large_image',
  'large_text',
  'small_image',
  'small_text',
  'image_source',
  'started_at',
  'ended_at',
  'duration_ms',
  'duration_seconds',
  'duration_minutes',
  'song_url',
  'album_url',
  'artist_links_json',
  'last_sync_id',
]

const USER_FLAGS = {
  STAFF: 1 << 0,
  PARTNER: 1 << 1,
  HYPESQUAD: 1 << 2,
  BUG_HUNTER_LEVEL_1: 1 << 3,
  HYPESQUAD_ONLINE_HOUSE_1: 1 << 6,
  HYPESQUAD_ONLINE_HOUSE_2: 1 << 7,
  HYPESQUAD_ONLINE_HOUSE_3: 1 << 8,
  PREMIUM_EARLY_SUPPORTER: 1 << 9,
  BUG_HUNTER_LEVEL_2: 1 << 14,
  VERIFIED_BOT: 1 << 16,
  VERIFIED_DEVELOPER: 1 << 17,
  CERTIFIED_MODERATOR: 1 << 18,
  ACTIVE_DEVELOPER: 1 << 22,
}

function hasFlag(bits = 0, flag) {
  return (bits & flag) === flag
}

function mapBadges(publicFlags = 0) {
  const badges = []
  if (hasFlag(publicFlags, USER_FLAGS.STAFF)) badges.push({ key: 'staff', label: 'Discord Staff' })
  if (hasFlag(publicFlags, USER_FLAGS.PARTNER)) badges.push({ key: 'partner', label: 'Partnered Server Owner' })
  if (hasFlag(publicFlags, USER_FLAGS.HYPESQUAD)) badges.push({ key: 'hypesquad', label: 'HypeSquad Events' })
  if (hasFlag(publicFlags, USER_FLAGS.BUG_HUNTER_LEVEL_1)) badges.push({ key: 'bug-hunter-1', label: 'Bug Hunter Lv1' })
  if (hasFlag(publicFlags, USER_FLAGS.HYPESQUAD_ONLINE_HOUSE_1)) badges.push({ key: 'bravery', label: 'House Bravery' })
  if (hasFlag(publicFlags, USER_FLAGS.HYPESQUAD_ONLINE_HOUSE_2)) badges.push({ key: 'brilliance', label: 'House Brilliance' })
  if (hasFlag(publicFlags, USER_FLAGS.HYPESQUAD_ONLINE_HOUSE_3)) badges.push({ key: 'balance', label: 'House Balance' })
  if (hasFlag(publicFlags, USER_FLAGS.PREMIUM_EARLY_SUPPORTER)) badges.push({ key: 'early-supporter', label: 'Early Supporter' })
  if (hasFlag(publicFlags, USER_FLAGS.BUG_HUNTER_LEVEL_2)) badges.push({ key: 'bug-hunter-2', label: 'Bug Hunter Lv2' })
  if (hasFlag(publicFlags, USER_FLAGS.VERIFIED_DEVELOPER)) badges.push({ key: 'verified-developer', label: 'Early Verified Bot Developer' })
  if (hasFlag(publicFlags, USER_FLAGS.CERTIFIED_MODERATOR)) badges.push({ key: 'moderator', label: 'Moderator Programs Alumni' })
  if (hasFlag(publicFlags, USER_FLAGS.ACTIVE_DEVELOPER)) badges.push({ key: 'active-developer', label: 'Active Developer' })
  return badges
}

function avatarUrl(user) {
  if (!user.avatar) {
    const index = Number(user.discriminator || 0) % 5
    return `${CDN}/embed/avatars/${index}.png`
  }
  const isGif = user.avatar.startsWith('a_')
  return `${CDN}/avatars/${user.id}/${user.avatar}.${isGif ? 'gif' : 'webp'}?size=256`
}

function bannerUrl(user) {
  if (!user.banner) return null
  const isGif = user.banner.startsWith('a_')
  return `${CDN}/banners/${user.id}/${user.banner}.${isGif ? 'gif' : 'webp'}?size=512`
}

function avatarDecorationUrl(user) {
  const asset = user.avatar_decoration_data?.asset
  if (!asset) return null
  return `${CDN}/avatar-decoration-presets/${asset}.png`
}

function guildBadgeUrl(user) {
  const guildId = user.primary_guild?.identity_guild_id
  const badge = user.primary_guild?.badge
  if (!guildId || !badge) return null
  return `${CDN}/guild-tag-badges/${guildId}/${badge}.png`
}

function formatActivity(activity) {
  const largeImage = activity.assets?.largeImageURL() ?? null
  const smallImage = activity.assets?.smallImageURL() ?? null

  return {
    name: activity.name,
    type: activity.type,
    type_label: ActivityType[activity.type] ?? 'Unknown',
    details: activity.details ?? null,
    state: activity.state ?? null,
    emoji: activity.emoji ? { name: activity.emoji.name, id: activity.emoji.id, animated: activity.emoji.animated } : null,
    timestamps: activity.timestamps ? {
      start: activity.timestamps.start ? new Date(activity.timestamps.start).toISOString() : null,
      end: activity.timestamps.end ? new Date(activity.timestamps.end).toISOString() : null,
    } : null,
    assets: activity.assets ? {
      large_image: largeImage,
      large_text: activity.assets.largeText ?? null,
      small_image: smallImage,
      small_text: activity.assets.smallText ?? null,
    } : null,
    image_url: largeImage || smallImage || null,
    application_id: activity.applicationId ?? null,
    url: activity.url ?? null,
    sync_id: activity.syncId ?? null,
    buttons: Array.isArray(activity.buttons) ? activity.buttons : [],
    party: activity.party ? {
      id: activity.party.id ?? null,
      size: Array.isArray(activity.party.size) ? activity.party.size : null,
    } : null,
    created_at: activity.createdTimestamp ? new Date(activity.createdTimestamp).toISOString() : null,
  }
}

function formatPresence(presence) {
  if (!presence) return null
  return {
    status: presence.status ?? 'offline',
    activities: (presence.activities ?? []).map(formatActivity),
  }
}

function csvEscape(value) {
  const stringValue = value == null ? '' : String(value)
  if (/[",\n]/.test(stringValue)) return `"${stringValue.replace(/"/g, '""')}"`
  return stringValue
}

function parseCsvLine(line) {
  const values = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current)
      current = ''
    } else {
      current += char
    }
  }
  values.push(current)
  return values
}

function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter(Boolean)
  if (!lines.length) return []
  const headers = parseCsvLine(lines[0])
  return lines.slice(1).map(line => {
    const cells = parseCsvLine(line)
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']))
  })
}

async function ensureCsvFile(filePath, headers) {
  try {
    await fs.access(filePath)
  } catch {
    await fs.writeFile(filePath, `${headers.join(',')}\n`, 'utf8')
  }
}

async function readCsvRows(filePath, headers) {
  await ensureCsvFile(filePath, headers)
  const raw = await fs.readFile(filePath, 'utf8')
  return parseCsv(raw)
}

async function writeCsvRows(filePath, headers, rows) {
  const body = rows.map(row => headers.map(header => csvEscape(row[header] ?? '')).join(',')).join('\n')
  await fs.writeFile(filePath, `${headers.join(',')}\n${body}${body ? '\n' : ''}`, 'utf8')
}

async function appendCsvRow(filePath, headers, row) {
  await ensureCsvFile(filePath, headers)
  const line = headers.map(header => csvEscape(row[header] ?? '')).join(',')
  await fs.appendFile(filePath, `${line}\n`, 'utf8')
}

async function ensureJsonFile(filePath, fallbackValue) {
  try {
    await fs.access(filePath)
  } catch {
    await fs.writeFile(filePath, JSON.stringify(fallbackValue, null, 2), 'utf8')
  }
}

async function readJsonFile(filePath, fallbackValue) {
  await ensureJsonFile(filePath, fallbackValue)
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return fallbackValue
  }
}

async function writeJsonFile(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8')
}

function normalizeActivityKind(activity) {
  if (activity.type === ActivityType.Listening || activity.name === 'Spotify') return 'music'
  if (activity.type === ActivityType.Playing) return 'game'
  return 'activity'
}

function activityKey(activity) {
  const kind = normalizeActivityKind(activity)
  if (kind === 'music') return `music:${activity.name || 'unknown'}`
  if (kind === 'game') return `game:${activity.name || 'unknown'}`
  return `activity:${activity.type}:${activity.application_id || 'na'}:${activity.name || 'unknown'}`
}

function sameUtcDay(a, b) {
  return a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
}

function yesterdayUtc(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  d.setUTCDate(d.getUTCDate() - 1)
  return d
}

function updateGameStreak(existing, nowIso) {
  const now = new Date(nowIso)
  const last = existing.last_active_at ? new Date(existing.last_active_at) : null
  if (!last) return 1
  if (sameUtcDay(last, now)) return existing.streak || 1
  if (sameUtcDay(last, yesterdayUtc(now))) return (existing.streak || 1) + 1
  return 1
}

function safeJsonParseArray(value) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function toActivityRow(activity, existing = null, nowIso = new Date().toISOString()) {
  const kind = normalizeActivityKind(activity)
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
    image_source: existing?.image_source ?? (activity.assets?.small_image || activity.assets?.large_image ? 'discord' : null),
    first_seen_at: existing?.first_seen_at ?? nowIso,
    last_active_at: nowIso,
    last_started_at: existing?.last_started_at ?? activity.timestamps?.start ?? nowIso,
    last_ended_at: existing?.last_ended_at ?? null,
    total_active_ms: Number(existing?.total_active_ms || 0),
    total_active_seconds: Math.floor(Number(existing?.total_active_ms || 0) / 1000),
    total_active_minutes: Math.floor(Number(existing?.total_active_ms || 0) / 60000),
    session_count: Number(existing?.session_count || 0),
    streak: kind === 'game' ? Number(existing?.streak || 0) : null,
    is_active: true,
    active_session_started_at: existing?.active_session_started_at ?? activity.timestamps?.start ?? nowIso,
    song_url: existing?.song_url ?? null,
    album_url: existing?.album_url ?? null,
    artist_links_json: existing?.artist_links_json ?? '[]',
    last_sync_id: existing?.last_sync_id ?? null,
  }
}

function sessionFromSummary(summary, endedAtIso) {
  const startedAtIso = summary.active_session_started_at || summary.last_started_at || endedAtIso
  const durationMs = Math.max(0, new Date(endedAtIso).getTime() - new Date(startedAtIso).getTime())
  return {
    session_id: `${summary.key}:${new Date(startedAtIso).getTime()}:${new Date(endedAtIso).getTime()}`,
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
    artist_links_json: summary.artist_links_json ?? '[]',
    last_sync_id: summary.last_sync_id ?? null,
  }
}

let spotifyTokenCache = {
  access_token: null,
  expires_at: 0,
}

async function getSpotifyAccessToken() {
  const now = Date.now()
  if (spotifyTokenCache.access_token && spotifyTokenCache.expires_at > now + 60000) {
    return spotifyTokenCache.access_token
  }

  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) return null

  const basic = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })

  if (!response.ok) return null

  const data = await response.json()
  spotifyTokenCache = {
    access_token: data.access_token,
    expires_at: Date.now() + (Number(data.expires_in || 0) * 1000),
  }

  return spotifyTokenCache.access_token
}

async function fetchSpotifyTrackMeta(trackId) {
  if (!trackId) return null

  const token = await getSpotifyAccessToken()
  if (!token) return null

  try {
    const response = await fetch(`https://api.spotify.com/v1/tracks/${encodeURIComponent(trackId)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) return null

    const track = await response.json()
    return {
      song_url: track?.external_urls?.spotify ?? (track?.id ? `https://open.spotify.com/track/${track.id}` : null),
      album_url: track?.album?.external_urls?.spotify ?? null,
      artists: Array.isArray(track?.artists)
        ? track.artists.map(artist => ({
            id: artist?.id ?? null,
            name: artist?.name ?? null,
            url: artist?.external_urls?.spotify ?? (artist?.id ? `https://open.spotify.com/artist/${artist.id}` : null),
          })).filter(artist => artist.name && artist.url)
        : [],
    }
  } catch (error) {
    console.warn(`Failed Spotify metadata lookup for track ${trackId}:`, error.message)
    return null
  }
}

async function enrichSpotifyActivityLinks(row) {
  const isSpotify = row.kind === 'music' || row.name === 'Spotify' || Number(row.type) === ActivityType.Listening
  if (!isSpotify) return row

  const currentSyncId = row.sync_id || null
  const previousSyncId = row.last_sync_id || null
  const trackChanged = !!currentSyncId && currentSyncId !== previousSyncId

  if (!currentSyncId) {
    row.song_url = row.song_url || null
    row.album_url = row.album_url || null
    row.artist_links_json = row.artist_links_json || '[]'
    row.last_sync_id = previousSyncId
    return row
  }

  const alreadyEnriched =
    !trackChanged &&
    row.song_url &&
    safeJsonParseArray(row.artist_links_json).length > 0

  if (alreadyEnriched) {
    return row
  }

  const meta = await fetchSpotifyTrackMeta(currentSyncId)
  if (!meta) {
    row.song_url = `https://open.spotify.com/track/${currentSyncId}`
    row.album_url = null
    row.artist_links_json = '[]'
    row.last_sync_id = currentSyncId
    return row
  }

  row.song_url = meta.song_url || `https://open.spotify.com/track/${currentSyncId}`
  row.album_url = meta.album_url || null
  row.artist_links_json = JSON.stringify(meta.artists || [])
  row.last_sync_id = currentSyncId
  return row
}

let gameImageCache = {}
let igdbTokenCache = {
  access_token: null,
  expires_at: 0,
}

async function loadGameImageCache() {
  gameImageCache = await readJsonFile(GAME_IMAGE_CACHE_PATH, {})
}

async function saveGameImageCache() {
  await writeJsonFile(GAME_IMAGE_CACHE_PATH, gameImageCache)
}

function buildIgdbImageUrl(imageId, size = 'cover_small') {
  if (!imageId) return null
  return `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg`
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[®™:]/g, '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\[.*?\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function scoreNameMatch(query, candidate) {
  const q = normalizeName(query)
  const c = normalizeName(candidate)
  if (!q || !c) return 0
  if (q === c) return 100
  if (c.startsWith(q)) return 90
  if (q.startsWith(c)) return 85
  if (c.includes(q) || q.includes(c)) return 75

  const qWords = new Set(q.split(' ').filter(Boolean))
  const cWords = new Set(c.split(' ').filter(Boolean))
  let overlap = 0
  for (const word of qWords) {
    if (cWords.has(word)) overlap++
  }
  return overlap * 10
}

async function getIgdbAccessToken() {
  const now = Date.now()
  if (igdbTokenCache.access_token && igdbTokenCache.expires_at > now + 60000) {
    return igdbTokenCache.access_token
  }

  if (!IGDB_CLIENT_ID || !IGDB_CLIENT_SECRET) return null

  const tokenUrl = new URL('https://id.twitch.tv/oauth2/token')
  tokenUrl.searchParams.set('client_id', IGDB_CLIENT_ID)
  tokenUrl.searchParams.set('client_secret', IGDB_CLIENT_SECRET)
  tokenUrl.searchParams.set('grant_type', 'client_credentials')

  const response = await fetch(tokenUrl, { method: 'POST' })
  if (!response.ok) return null

  const data = await response.json()
  igdbTokenCache = {
    access_token: data.access_token,
    expires_at: Date.now() + (Number(data.expires_in || 0) * 1000),
  }

  return igdbTokenCache.access_token
}

async function fetchIgdbGameIcon(gameName) {
  if (!gameName) return null

  const token = await getIgdbAccessToken()
  if (!token) return null

  try {
    const body = `fields name,cover.image_id; search "${String(gameName).replace(/"/g, '\\"')}"; limit 5;`

    const response = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Client-ID': IGDB_CLIENT_ID,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/plain',
      },
      body,
    })

    if (!response.ok) return null

    const results = await response.json()
    if (!Array.isArray(results) || !results.length) return null

    const chosen = [...results]
      .map(item => ({ item, score: scoreNameMatch(gameName, item?.name) }))
      .sort((a, b) => b.score - a.score)[0]?.item

    return buildIgdbImageUrl(chosen?.cover?.image_id ?? null, 'cover_small')
  } catch (error) {
    console.warn(`Failed IGDB fallback for ${gameName}:`, error.message)
    return null
  }
}

async function sgdbRequest(endpoint, query = {}) {
  if (!STEAMGRIDDB_API_KEY) return null

  const url = new URL(`${STEAMGRIDDB_API}${endpoint}`)
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value !== '') url.searchParams.set(key, String(value))
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${STEAMGRIDDB_API_KEY}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) return null
  return response.json()
}

async function searchSteamGridDbGame(gameName) {
  if (!gameName) return null
  try {
    const data = await sgdbRequest(`/search/autocomplete/${encodeURIComponent(gameName)}`)
    const list = Array.isArray(data?.data) ? data.data : []
    if (!list.length) return null

    const chosen = [...list]
      .map(item => {
        const game = item?.data ?? item
        return { game, score: scoreNameMatch(gameName, game?.name) }
      })
      .sort((a, b) => b.score - a.score)[0]?.game

    return chosen ?? null
  } catch (error) {
    console.warn(`Failed SteamGridDB search for ${gameName}:`, error.message)
    return null
  }
}

function pickBestSteamGridDbAsset(items, preferredStyles = []) {
  if (!Array.isArray(items) || !items.length) return null

  const styleRank = new Map(preferredStyles.map((style, index) => [style, index]))
  const scored = items.map(item => {
    const styleScore = styleRank.has(item.style) ? 100 - styleRank.get(item.style) : 0
    const baseScore = Number(item.score || 0)
    return { item, score: styleScore + baseScore }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.item ?? null
}

async function fetchSteamGridDbGameImage(gameName) {
  if (!gameName) return null

  const cacheKey = `game:${normalizeName(gameName)}`
  if (gameImageCache[cacheKey]) return gameImageCache[cacheKey]

  try {
    const game = await searchSteamGridDbGame(gameName)
    if (!game?.id) return null

    const icons = await sgdbRequest(`/icons/game/${game.id}`, {
      styles: 'official,custom',
      dimensions: '512,1024',
      mimes: 'image/png',
      types: 'static',
      nsfw: 'false',
      humor: 'false',
      epilepsy: 'false',
      limit: 50,
    })

    const bestIcon = pickBestSteamGridDbAsset(icons?.data, ['official', 'custom'])
    if (bestIcon?.url) {
      const payload = { url: bestIcon.url, thumb: bestIcon.thumb ?? null, source: 'steamgriddb-icon', game_id: game.id, matched_name: game.name }
      gameImageCache[cacheKey] = payload
      await saveGameImageCache()
      return payload
    }

    const grids = await sgdbRequest(`/grids/game/${game.id}`, {
      styles: 'alternate,no_logo,material,blurred,white_logo',
      dimensions: '512x512,1024x1024',
      mimes: 'image/png,image/webp,image/jpeg',
      types: 'static',
      nsfw: 'false',
      humor: 'false',
      epilepsy: 'false',
      limit: 50,
    })

    const bestGrid = pickBestSteamGridDbAsset(grids?.data, ['alternate', 'no_logo', 'material', 'blurred', 'white_logo'])
    if (bestGrid?.url) {
      const payload = { url: bestGrid.url, thumb: bestGrid.thumb ?? null, source: 'steamgriddb-grid', game_id: game.id, matched_name: game.name }
      gameImageCache[cacheKey] = payload
      await saveGameImageCache()
      return payload
    }

    return null
  } catch (error) {
    console.warn(`Failed SteamGridDB lookup for ${gameName}:`, error.message)
    return null
  }
}

async function fetchBestGameImage(gameName) {
  if (!gameName) return null

  const cacheKey = `game:${normalizeName(gameName)}`
  if (gameImageCache[cacheKey]) return gameImageCache[cacheKey]

  const sgdb = await fetchSteamGridDbGameImage(gameName)
  if (sgdb?.url) return sgdb

  const igdbUrl = await fetchIgdbGameIcon(gameName)
  if (igdbUrl) {
    const payload = { url: igdbUrl, thumb: igdbUrl, source: 'igdb-cover' }
    gameImageCache[cacheKey] = payload
    await saveGameImageCache()
    return payload
  }

  return null
}

async function enrichRow(row) {
  await enrichSpotifyActivityLinks(row)

  const hasDiscordImage = !!(row.small_image || row.large_image)
  if (hasDiscordImage) {
    row.image_source = row.image_source || 'discord'
    return row.small_image || row.large_image || null
  }

  if (row.kind === 'game') {
    const result = await fetchBestGameImage(row.name)
    if (result?.url) {
      row.small_image = result.url
      row.image_source = result.source || null
      return result.url
    }
  }

  return null
}

function summaryForApi(summary) {
  const { active_session_started_at, ...row } = summary
  const image_url = row.small_image || row.large_image || null
  return {
    ...row,
    type: row.type === '' ? null : Number(row.type),
    party_size_current: row.party_size_current === '' ? null : Number(row.party_size_current),
    party_size_max: row.party_size_max === '' ? null : Number(row.party_size_max),
    total_active_ms: Number(row.total_active_ms || 0),
    total_active_seconds: Math.floor(Number(row.total_active_ms || 0) / 1000),
    total_active_minutes: Math.floor(Number(row.total_active_ms || 0) / 60000),
    session_count: Number(row.session_count || 0),
    streak: row.streak == null || row.streak === '' ? null : Number(row.streak),
    is_active: row.is_active === true || row.is_active === 'true',
    active_session_started_at,
    image_url,
    song_url: row.song_url || null,
    album_url: row.album_url || null,
    artist_links: safeJsonParseArray(row.artist_links_json),
  }
}

function historyRowForApi(row) {
  const image_url = row.small_image || row.large_image || null
  return {
    ...row,
    type: row.type === '' ? null : Number(row.type),
    party_size_current: row.party_size_current === '' ? null : Number(row.party_size_current),
    party_size_max: row.party_size_max === '' ? null : Number(row.party_size_max),
    duration_ms: Number(row.duration_ms || 0),
    duration_seconds: Number(row.duration_seconds || 0),
    duration_minutes: Number(row.duration_minutes || 0),
    image_url,
    song_url: row.song_url || null,
    album_url: row.album_url || null,
    artist_links: safeJsonParseArray(row.artist_links_json),
  }
}

let cachedPresence = null
let activityStore = new Map()
let trackingReady = false
let writeQueue = Promise.resolve()

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildPresences],
})

async function loadActivityStore() {
  const rows = await readCsvRows(ACTIVITY_CSV_PATH, ACTIVITY_HEADERS)
  const map = new Map()

  for (const row of rows) {
    await enrichRow(row)
    map.set(row.key, {
      ...row,
      total_active_ms: Number(row.total_active_ms || 0),
      session_count: Number(row.session_count || 0),
      streak: row.streak === '' ? null : Number(row.streak),
      is_active: row.is_active === 'true',
      active_session_started_at: row.is_active === 'true' ? row.last_started_at || null : null,
      last_sync_id: row.last_sync_id || null,
    })
  }

  await writeCsvRows(ACTIVITY_CSV_PATH, ACTIVITY_HEADERS, [...map.values()])
  return map
}

async function persistActivityStore() {
  const rows = [...activityStore.values()]
    .sort((a, b) => new Date(b.last_active_at || 0).getTime() - new Date(a.last_active_at || 0).getTime())

  for (const row of rows) {
    await enrichRow(row)
  }

  const output = rows.map(row => ({
    ...row,
    total_active_seconds: Math.floor(Number(row.total_active_ms || 0) / 1000),
    total_active_minutes: Math.floor(Number(row.total_active_ms || 0) / 60000),
    is_active: row.is_active ? 'true' : 'false',
  }))

  await writeCsvRows(ACTIVITY_CSV_PATH, ACTIVITY_HEADERS, output)
}

function queueWrite(task) {
  writeQueue = writeQueue.then(task).catch(err => console.error('Activity write failed:', err))
  return writeQueue
}

async function closeInactiveActivities(liveKeys, nowIso) {
  for (const [key, summary] of activityStore.entries()) {
    if (!summary.is_active || liveKeys.has(key)) continue

    const session = sessionFromSummary(summary, nowIso)
    await enrichRow(session)

    summary.total_active_ms = Number(summary.total_active_ms || 0) + session.duration_ms
    summary.total_active_seconds = Math.floor(summary.total_active_ms / 1000)
    summary.total_active_minutes = Math.floor(summary.total_active_ms / 60000)
    summary.session_count = Number(summary.session_count || 0) + 1
    summary.last_ended_at = nowIso
    summary.is_active = false
    summary.active_session_started_at = null

    activityStore.set(key, summary)
    await appendCsvRow(ACTIVITY_SESSIONS_CSV_PATH, SESSION_HEADERS, session)
  }
}

async function syncPresenceActivities(reason = 'poll') {
  if (!trackingReady) return

  const nowIso = new Date().toISOString()
  const activities = formatPresence(cachedPresence)?.activities ?? []
  const liveKeys = new Set()

  for (const activity of activities) {
    const key = activityKey(activity)
    liveKeys.add(key)

    const existing = activityStore.get(key)
    const next = toActivityRow(activity, existing, nowIso)

    if (!existing || !existing.is_active) {
      next.active_session_started_at = activity.timestamps?.start || nowIso
      if (next.kind === 'game') next.streak = updateGameStreak(existing || {}, nowIso)
    } else {
      next.active_session_started_at = existing.active_session_started_at || existing.last_started_at || activity.timestamps?.start || nowIso
      next.streak = existing.streak ?? next.streak
    }

    next.total_active_ms = Number(existing?.total_active_ms || 0)
    next.total_active_seconds = Math.floor(next.total_active_ms / 1000)
    next.total_active_minutes = Math.floor(next.total_active_ms / 60000)
    next.session_count = Number(existing?.session_count || 0)
    next.last_ended_at = existing?.last_ended_at ?? null
    next.is_active = true

    await enrichRow(next)
    activityStore.set(key, next)
  }

  await closeInactiveActivities(liveKeys, nowIso)

  if (reason !== 'silent') {
    await queueWrite(() => persistActivityStore())
  }
}

async function getActivityHistory(limit = 100) {
  const rows = await readCsvRows(ACTIVITY_SESSIONS_CSV_PATH, SESSION_HEADERS)

  let touched = false
  for (const row of rows) {
    const beforeImage = row.small_image || row.large_image || ''
    const beforeSong = row.song_url || ''
    const beforeArtists = row.artist_links_json || ''
    const beforeSync = row.last_sync_id || ''
    await enrichRow(row)
    if (
      beforeImage !== (row.small_image || row.large_image || '') ||
      beforeSong !== (row.song_url || '') ||
      beforeArtists !== (row.artist_links_json || '') ||
      beforeSync !== (row.last_sync_id || '')
    ) {
      touched = true
    }
  }

  if (touched) {
    await writeCsvRows(ACTIVITY_SESSIONS_CSV_PATH, SESSION_HEADERS, rows)
  }

  const sorted = rows.sort(
    (a, b) => new Date(b.ended_at || b.started_at || 0).getTime() - new Date(a.ended_at || a.started_at || 0).getTime()
  )

  let latestMusicIncluded = false
  const filtered = sorted.filter(row => {
    if (row.kind !== 'music') return true
    if (latestMusicIncluded) return false
    latestMusicIncluded = true
    return true
  })

  return filtered.slice(0, limit).map(historyRowForApi)
}

client.on('ready', async () => {
  console.log(`Bot ready: ${client.user.tag}`)
  try {
    await loadGameImageCache()
    const guild = await client.guilds.fetch(DISCORD_GUILD_ID)
    const member = await guild.members.fetch({ user: DISCORD_USER_ID, withPresences: true })
    cachedPresence = member.presence ?? null
    activityStore = await loadActivityStore()
    trackingReady = true
    await syncPresenceActivities('ready')
    console.log(`Seeded presence: ${cachedPresence?.status ?? 'offline'}`)
  } catch (err) {
    console.warn('Could not seed presence on ready:', err.message)
  }
})

client.on('presenceUpdate', async (_old, newPresence) => {
  if (newPresence?.userId === DISCORD_USER_ID) {
    cachedPresence = newPresence
    await syncPresenceActivities('presenceUpdate')
  }
})

client.on('error', err => console.error('Discord client error:', err))
client.login(DISCORD_BOT_TOKEN)

setInterval(async () => {
  try {
    await syncPresenceActivities('poll')
  } catch (err) {
    console.error('Periodic activity sync failed:', err)
  }
}, ACTIVITY_POLL_INTERVAL_MS)

app.get('/', async (_req, res) => {
  try {
    const response = await fetch(`${DISCORD_API}/users/${DISCORD_USER_ID}`, {
      headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
    })

    if (!response.ok) return res.status(response.status).json({ error: 'Failed to fetch Discord user' })

    const user = await response.json()
    const presence = formatPresence(cachedPresence) ?? { status: 'offline', activities: [] }

    for (const activity of presence.activities) {
      const existing = activityStore.get(activityKey(activity))
      const row = toActivityRow(activity, existing)
      row.kind = normalizeActivityKind(activity)
      await enrichSpotifyActivityLinks(row)
      activity.song_url = row.song_url || null
      activity.album_url = row.album_url || null
      activity.artist_links = safeJsonParseArray(row.artist_links_json)
    }

    const activity_history = [...activityStore.values()]
      .sort((a, b) => new Date(b.last_active_at || 0).getTime() - new Date(a.last_active_at || 0).getTime())
      .map(summaryForApi)

    res.json({
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
      activity_history,
    })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' })
  }
})

app.get('/history', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100)))
    const rows = await getActivityHistory(limit)
    res.json(rows)
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to read activity history' })
  }
})

app.get('/api/discord-profile/avatar', async (_req, res) => {
  try {
    const response = await fetch(`${DISCORD_API}/users/${DISCORD_USER_ID}`, {
      headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
    })

    if (!response.ok) return res.status(response.status).send('Failed to fetch Discord user')

    const user = await response.json()
    if (!user.avatar) return res.status(404).send('No avatar')

    const isGif = user.avatar.startsWith('a_')
    const url = `${CDN}/avatars/${user.id}/${user.avatar}.${isGif ? 'gif' : 'png'}?size=256`

    const imageRes = await fetch(url)
    if (!imageRes.ok) return res.status(imageRes.status).send('Failed to fetch avatar image')

    res.setHeader('Content-Type', imageRes.headers.get('content-type') || 'image/png')
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.send(Buffer.from(await imageRes.arrayBuffer()))
  } catch (error) {
    res.status(500).send(error instanceof Error ? error.message : 'Avatar proxy failed')
  }
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Discord profile API listening on http://localhost:${PORT}`)
  console.log(`Activity summary file: ${ACTIVITY_CSV_PATH}`)
  console.log(`Activity sessions file: ${ACTIVITY_SESSIONS_CSV_PATH}`)
  console.log(`Game image cache file: ${GAME_IMAGE_CACHE_PATH}`)
  console.log(`Activity polling interval: ${ACTIVITY_POLL_INTERVAL_MS}ms`)
  console.log(`SteamGridDB enabled: ${STEAMGRIDDB_API_KEY ? 'yes' : 'no'}`)
  console.log(`IGDB fallback enabled: ${IGDB_CLIENT_ID && IGDB_CLIENT_SECRET ? 'yes' : 'no'}`)
  console.log(`Spotify enrichment enabled: ${SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET ? 'yes' : 'no'}`)
})