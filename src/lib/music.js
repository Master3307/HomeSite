import { useSyncExternalStore } from 'react'

import { sendFile } from './chunkedUpload.js'
import { ACCOUNT_API_URL, accountFetch } from './account.js'

/*
 * Background music on /dash (server/services/dashMusic.cjs): the library,
 * a queue with shuffle and repeat, and the player.
 *
 * Plays in the background: an <audio> for files and streams, a hidden
 * YouTube player for videos and playlists. Volume fades on start, pause and
 * hand-over. Media keys and the lock screen work (Media Session).
 *
 * Only one player per account:
 *   - tabs of this browser talk over a BroadcastChannel: the one that starts
 *     plays, the others fade out; a newly opened dash takes over where the
 *     other tab is (if the browser lets it start sound, else that tab plays on
 *     and this one offers "Continue here")
 *   - other devices: the server knows which device plays (/music/claim);
 *     whoever starts last plays, the others pause
 * What plays, the queue and the position are kept in this browser
 * (localStorage), the library on the account.
 */

const STATE_KEY = 'homesite:music'
const DEVICE_KEY = 'homesite:music:device'
const CLAIM_MS = 15_000

/* How it plays (Customize → Music, synced with the dash): fades, playing on in a hidden tab. */
let options = { fade: true, fadeMs: 600, background: true }
export function setMusicOptions(next) {
  options = { ...options, ...next }
}

const read = (key, fallback) => {
  try {
    const value = JSON.parse(localStorage.getItem(key))
    return value ?? fallback
  } catch {
    return fallback
  }
}
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage blocked: this visit only
  }
}
const deviceId = (() => {
  let id = null
  return () => {
    if (id) return id
    try {
      id = localStorage.getItem(DEVICE_KEY)
      if (!id) {
        id = `d-${crypto.randomUUID()}`
        localStorage.setItem(DEVICE_KEY, id)
      }
    } catch {
      id = `d-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
    }
    return id
  }
})()
const tabId = `tab-${Math.random().toString(36).slice(2, 10)}`

async function call(path, { method = 'GET', body, raw = null, signal } = {}) {
  const response = await accountFetch(path, {
    method,
    signal,
    cache: 'no-store',
    headers: raw ? { 'Content-Type': 'application/octet-stream' } : body ? { 'Content-Type': 'application/json' } : undefined,
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status })
  return data
}

export const coverOf = (track) => (!track?.cover ? null : /^https:\/\//.test(track.cover) ? track.cover : `${ACCOUNT_API_URL}/music/tracks/${encodeURIComponent(track.id)}/cover`)
const streamOf = (track) => (track.source === 'link' ? track.url : `${ACCOUNT_API_URL}/music/tracks/${encodeURIComponent(track.id)}/stream`)

/* ---------- the store ---------- */

const saved = read(STATE_KEY, {})
let state = {
  library: { status: 'idle', tracks: [], playlists: [], quota: null, builtin: false, error: null },
  queue: Array.isArray(saved.queue) ? saved.queue.slice(0, 3000) : [],
  index: Number.isInteger(saved.index) ? saved.index : 0,
  position: Number(saved.position) || 0,
  duration: 0,
  volume: typeof saved.volume === 'number' ? Math.min(1, Math.max(0, saved.volume)) : 0.6,
  shuffle: Boolean(saved.shuffle),
  repeat: ['off', 'all', 'one'].includes(saved.repeat) ? saved.repeat : 'off',
  // What you last asked for: 'play' or 'pause' (pause means pause: nothing starts by itself after it).
  intent: saved.intent === 'play' ? 'play' : 'pause',
  playing: false,
  buffering: false,
  elsewhere: null, // { where: 'tab' | 'device', track } when something else of this account plays
  blocked: false, // the browser didn't let this tab start sound (needs a click)
  error: null,
}
const listeners = new Set()
const emit = () => listeners.forEach((listener) => listener())
function set(patch) {
  state = { ...state, ...patch }
  if (['queue', 'index', 'volume', 'shuffle', 'repeat', 'intent'].some((key) => key in patch) || ('position' in patch && Math.floor(patch.position) % 5 === 0)) {
    write(STATE_KEY, { queue: state.queue, index: state.index, position: state.position, volume: state.volume, shuffle: state.shuffle, repeat: state.repeat, intent: state.intent })
  }
  emit()
}
export const useMusic = () => useSyncExternalStore((listener) => (listeners.add(listener), () => listeners.delete(listener)), () => state)
export const getMusic = () => state
export const trackById = (id) => state.library.tracks.find((track) => track.id === id) ?? null
export const currentTrack = () => trackById(state.queue[state.index]) ?? null

/* ---------- library ---------- */

let loading = null
export function loadLibrary(force = false) {
  if (loading && !force) return loading
  if (state.library.status === 'ready' && !force) return Promise.resolve(state.library)
  set({ library: { ...state.library, status: state.library.status === 'ready' ? 'ready' : 'loading' } })
  loading = call('/music/library')
    .then((data) => {
      set({ library: { status: 'ready', tracks: data.tracks ?? [], playlists: data.playlists ?? [], quota: data.quota ?? null, builtin: Boolean(data.builtin), error: null } })
      // Tracks that are gone leave the queue.
      const known = new Set((data.tracks ?? []).map((track) => track.id))
      const queue = state.queue.filter((id) => known.has(id))
      if (queue.length !== state.queue.length) set({ queue, index: Math.min(state.index, Math.max(0, queue.length - 1)) })
      return state.library
    })
    .catch((error) => {
      set({ library: { ...state.library, status: 'error', error: error.message } })
      throw error
    })
    .finally(() => {
      loading = null
    })
  return loading
}
const addTracks = (tracks) => set({ library: { ...state.library, tracks: [...tracks, ...state.library.tracks.filter((track) => !tracks.some((added) => added.id === track.id))] } })

/* Uploads one file, with real progress (0–1); over 50 MB in parts (lib/chunkedUpload.js). */
export async function uploadTrack(file, onProgress = null) {
  const data = await sendFile(`/music/upload?name=${encodeURIComponent(file.name)}`, file, { purpose: 'music', onProgress })
  addTracks([data])
  loadLibrary(true).catch(() => {})
  return data
}
export async function addLink(url) {
  const track = await call('/music/links', { method: 'POST', body: { url } })
  addTracks([track])
  return track
}
export async function addFolder(integration, path) {
  const result = await call('/music/folders', { method: 'POST', body: { integration, path } })
  addTracks(result.tracks ?? [])
  return result
}
export const navidromeAlbums = (integration, q = '') => call(`/music/navidrome/${encodeURIComponent(integration)}/albums${q ? `?q=${encodeURIComponent(q)}` : ''}`)
export async function addNavidrome(integration, { album = null, all = false, random = null } = {}) {
  const result = await call('/music/navidrome', { method: 'POST', body: { integration, album, all, random } })
  addTracks(result.tracks ?? [])
  return result
}
export async function editTrack(id, patch) {
  const track = await call(`/music/tracks/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch })
  set({ library: { ...state.library, tracks: state.library.tracks.map((entry) => (entry.id === id ? track : entry)) } })
  if (state.queue[state.index] === id) mediaSession()
  return track
}
export async function removeTrack(id) {
  await call(`/music/tracks/${encodeURIComponent(id)}`, { method: 'DELETE' })
  const playingIt = state.queue[state.index] === id
  const queue = state.queue.filter((entry) => entry !== id)
  set({
    library: { ...state.library, tracks: state.library.tracks.filter((track) => track.id !== id), playlists: state.library.playlists.map((playlist) => ({ ...playlist, tracks: playlist.tracks.filter((entry) => entry !== id) })) },
    queue,
    index: Math.min(state.index, Math.max(0, queue.length - 1)),
  })
  if (playingIt) {
    stopEngines()
    set({ playing: false, position: 0 })
  }
}
export async function savePlaylist(id, patch) {
  const playlist = id ? await call(`/music/playlists/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }) : await call('/music/playlists', { method: 'POST', body: patch })
  const others = state.library.playlists.filter((entry) => entry.id !== playlist.id)
  set({ library: { ...state.library, playlists: id ? state.library.playlists.map((entry) => (entry.id === id ? playlist : entry)) : [...others, playlist] } })
  return playlist
}
export async function removePlaylist(id) {
  await call(`/music/playlists/${encodeURIComponent(id)}`, { method: 'DELETE' })
  set({ library: { ...state.library, playlists: state.library.playlists.filter((entry) => entry.id !== id) } })
}

/* ---------- engines ---------- */

let audio = null
let youtube = null // { player, ready: Promise }
let fadeTimer = null
let current = null // the track loaded into an engine

function audioElement() {
  if (audio) return audio
  audio = new Audio()
  audio.preload = 'auto'
  audio.addEventListener('timeupdate', () => current?.source !== 'youtube' && set({ position: audio.currentTime }))
  audio.addEventListener('durationchange', () => Number.isFinite(audio.duration) && set({ duration: audio.duration }))
  audio.addEventListener('waiting', () => set({ buffering: true }))
  audio.addEventListener('playing', () => set({ buffering: false }))
  audio.addEventListener('ended', () => ended())
  audio.addEventListener('error', () => {
    if (current?.source === 'youtube') return
    set({ error: 'play', playing: false, buffering: false })
    // A track that can't play: on to the next one (not in a loop over a broken queue).
    if (state.queue.length > 1) setTimeout(() => next(true), 1200)
  })
  return audio
}

function loadYouTube() {
  if (youtube) return youtube.ready
  let resolve
  const ready = new Promise((done) => {
    resolve = done
  })
  youtube = { player: null, ready }
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;width:1px;height:1px;left:-10px;top:-10px;opacity:0;pointer-events:none'
  host.setAttribute('aria-hidden', 'true')
  const target = document.createElement('div')
  host.appendChild(target)
  document.body.appendChild(host)
  const make = () => {
    youtube.player = new window.YT.Player(target, {
      width: 1,
      height: 1,
      host: 'https://www.youtube-nocookie.com',
      playerVars: { autoplay: 0, controls: 0, disablekb: 1, playsinline: 1, rel: 0 },
      events: {
        onReady: () => resolve(youtube.player),
        onStateChange: (event) => {
          const YT = window.YT.PlayerState
          if (event.data === YT.ENDED) ended()
          if (event.data === YT.PLAYING) set({ buffering: false, duration: youtube.player.getDuration() || state.duration })
          if (event.data === YT.BUFFERING) set({ buffering: true })
        },
        onError: () => {
          set({ error: 'play', playing: false })
          if (state.queue.length > 1) setTimeout(() => next(true), 1200)
        },
      },
    })
  }
  if (window.YT?.Player) make()
  else {
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      make()
    }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.async = true
    document.head.appendChild(script)
  }
  return ready
}
let youtubeTicker = null
const tickYouTube = () => {
  clearInterval(youtubeTicker)
  youtubeTicker = setInterval(() => {
    if (current?.source !== 'youtube' || !youtube?.player?.getCurrentTime) return
    set({ position: youtube.player.getCurrentTime() || 0, duration: youtube.player.getDuration() || state.duration })
  }, 500)
}

function setEngineVolume(value) {
  if (current?.source === 'youtube') youtube?.player?.setVolume?.(Math.round(value * 100))
  else if (audio) audio.volume = value
}
/* Volume from where it is to `to` in FADE_MS (no fade with reduced motion). */
function fade(to, done = null) {
  clearInterval(fadeTimer)
  const FADE_MS = options.fadeMs
  const still = !options.fade || FADE_MS <= 0 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const from = current?.source === 'youtube' ? (youtube?.player?.getVolume?.() ?? 100) / 100 : (audio?.volume ?? state.volume)
  if (still) {
    setEngineVolume(to)
    done?.()
    return
  }
  const start = performance.now()
  fadeTimer = setInterval(() => {
    const share = Math.min(1, (performance.now() - start) / FADE_MS)
    setEngineVolume(from + (to - from) * share)
    if (share >= 1) {
      clearInterval(fadeTimer)
      done?.()
    }
  }, 30)
}
function stopEngines() {
  clearInterval(fadeTimer)
  audio?.pause()
  youtube?.player?.pauseVideo?.()
}

/* Loads the queue's current track into its engine (and starts it at `at` seconds). */
async function start(at = 0) {
  const track = currentTrack()
  if (!track) return false
  const changed = current?.id !== track.id
  if (changed) {
    stopEngines()
    current = track
    set({ duration: track.duration ?? 0, position: at, error: null })
  }
  if (track.source === 'youtube') {
    const player = await loadYouTube()
    if (changed) {
      if (track.youtube?.list && !track.youtube.video) player.loadPlaylist({ list: track.youtube.list, listType: 'playlist', startSeconds: at })
      else player.loadVideoById({ videoId: track.youtube.video, startSeconds: at })
    } else player.playVideo()
    player.setVolume(0)
    tickYouTube()
    fade(state.volume)
    return true
  }
  const element = audioElement()
  if (changed || !element.src) {
    element.src = streamOf(track)
    element.currentTime = at
  }
  element.volume = 0
  try {
    await element.play()
  } catch (error) {
    if (error?.name === 'NotAllowedError') {
      set({ blocked: true, playing: false })
      return false
    }
    throw error
  }
  fade(state.volume)
  return true
}

function ended() {
  if (state.repeat === 'one') {
    seek(0)
    if (current?.source === 'youtube') youtube?.player?.playVideo?.()
    else audio?.play().catch(() => {})
    return
  }
  next(true)
}

/* ---------- controls ---------- */

export async function play({ take = true } = {}) {
  if (!state.queue.length) return
  set({ blocked: false, intent: 'play' })
  const ok = await start(current?.id === state.queue[state.index] ? state.position : state.position)
  if (!ok) return
  set({ playing: true, elsewhere: null })
  if (take) announce()
  mediaSession()
}
/* `quiet`: stopped by something else (another tab, a hidden tab), not by you: your "play" stays. */
export function pause({ quiet = false } = {}) {
  if (!quiet) set({ intent: 'pause' })
  if (!state.playing) return
  fade(0, () => {
    stopEngines()
    setEngineVolume(state.volume)
  })
  set({ playing: false })
  if (!quiet) claim(false)
  mediaSession()
}
export const toggle = () => (state.playing ? pause() : play())
/* Go on where it was: only if you hadn't paused (music was playing when the dash closed). */
export const shouldResume = () => state.intent === 'play' && !state.playing && !state.elsewhere && state.queue.length > 0

/* The order to play in: as listed, or shuffled once (every track once before any repeats). */
let shuffled = null
function order() {
  if (!state.shuffle) return null
  if (!shuffled || shuffled.length !== state.queue.length) {
    shuffled = state.queue.map((_, index) => index)
    for (let index = shuffled.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1))
      ;[shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]]
    }
  }
  return shuffled
}
export async function next(auto = false) {
  if (!state.queue.length) return
  const list = order()
  let index
  if (list) {
    const at = list.indexOf(state.index)
    index = list[at + 1] ?? (state.repeat === 'all' || !auto ? list[0] : null)
  } else index = state.index + 1 < state.queue.length ? state.index + 1 : state.repeat === 'all' || !auto ? 0 : null
  if (index === null) {
    pause()
    set({ position: 0 })
    return
  }
  const wasPlaying = state.playing || auto
  set({ index, position: 0 })
  current = null
  if (wasPlaying) await play()
}
export async function previous() {
  // Past the first seconds: back to the start of this one.
  if (state.position > 4) return seek(0)
  const list = order()
  const index = list ? (list[list.indexOf(state.index) - 1] ?? list.at(-1)) : (state.index - 1 + state.queue.length) % state.queue.length
  set({ index, position: 0 })
  current = null
  if (state.playing) await play()
}
export function seek(seconds) {
  const at = Math.max(0, Math.min(state.duration || seconds, seconds))
  if (current?.source === 'youtube') youtube?.player?.seekTo?.(at, true)
  else if (audio && current) audio.currentTime = at
  set({ position: at })
}
export function setVolume(value) {
  const volume = Math.min(1, Math.max(0, value))
  set({ volume })
  if (state.playing) setEngineVolume(volume)
}
export function setShuffle(on) {
  shuffled = null
  set({ shuffle: on })
}
export const setRepeat = (repeat) => set({ repeat })

/** Plays these tracks (a playlist, the library, a selection), from `start`. */
export async function playTracks(ids, { from = 0, shuffle = null } = {}) {
  const queue = ids.filter((id) => trackById(id)).slice(0, 3000)
  if (!queue.length) return
  shuffled = null
  if (shuffle !== null) set({ shuffle })
  const index = state.shuffle && shuffle ? Math.floor(Math.random() * queue.length) : Math.min(from, queue.length - 1)
  set({ queue, index, position: 0 })
  current = null
  await play()
}
export function enqueue(ids, { next: soon = false } = {}) {
  const add = ids.filter((id) => trackById(id))
  shuffled = null
  if (soon) {
    const queue = [...state.queue]
    queue.splice(state.index + 1, 0, ...add)
    set({ queue })
  } else set({ queue: [...state.queue, ...add].slice(0, 3000) })
}
export function dequeue(position) {
  shuffled = null
  const queue = state.queue.filter((_, index) => index !== position)
  const removingCurrent = position === state.index
  set({ queue, index: position < state.index ? state.index - 1 : Math.min(state.index, Math.max(0, queue.length - 1)) })
  if (removingCurrent) {
    current = null
    if (state.playing) play()
  }
}
export function moveInQueue(from, to) {
  if (to < 0 || to >= state.queue.length) return
  shuffled = null
  const queue = [...state.queue]
  const [item] = queue.splice(from, 1)
  queue.splice(to, 0, item)
  let index = state.index
  if (from === state.index) index = to
  else if (from < state.index && to >= state.index) index--
  else if (from > state.index && to <= state.index) index++
  set({ queue, index })
}
export function clearQueue() {
  stopEngines()
  current = null
  shuffled = null
  set({ queue: [], index: 0, position: 0, duration: 0, playing: false, intent: 'pause' })
  mediaSession()
}
export async function jumpTo(position) {
  set({ index: position, position: 0 })
  current = null
  await play()
}

/* ---------- system controls (media keys, lock screen) ---------- */

function mediaSession() {
  if (!('mediaSession' in navigator)) return
  const track = currentTrack()
  try {
    navigator.mediaSession.metadata = track ? new window.MediaMetadata({ title: track.title, artist: track.artist ?? '', album: track.album ?? '', artwork: coverOf(track) ? [{ src: coverOf(track), sizes: '300x300' }] : [] }) : null
    navigator.mediaSession.playbackState = state.playing ? 'playing' : 'paused'
    navigator.mediaSession.setActionHandler('play', () => play())
    navigator.mediaSession.setActionHandler('pause', () => pause())
    navigator.mediaSession.setActionHandler('nexttrack', () => next())
    navigator.mediaSession.setActionHandler('previoustrack', () => previous())
    navigator.mediaSession.setActionHandler('seekto', (details) => details.seekTime !== undefined && seek(details.seekTime))
  } catch {
    // not supported here
  }
}

/* ---------- only one player: tabs and devices ---------- */

let channel = null
let claimTimer = null
function announce() {
  channel?.postMessage({ type: 'playing', from: tabId, track: state.queue[state.index], position: state.position })
  claim(true, true)
}
async function claim(playing, take = false) {
  clearInterval(claimTimer)
  try {
    await call('/music/claim', { method: 'POST', body: { device: deviceId(), playing, take, track: state.queue[state.index] ?? null, position: Math.round(state.position) } })
  } catch {
    // offline or logged out: only this browser's tabs are kept in step
  }
  if (playing) claimTimer = setInterval(checkClaim, CLAIM_MS)
}
async function checkClaim() {
  if (!state.playing) return clearInterval(claimTimer)
  try {
    const current = await call('/music/claim', { method: 'POST', body: { device: deviceId(), playing: true, track: state.queue[state.index] ?? null, position: Math.round(state.position) } })
    // Another device started: this one steps back.
    if (current && current.device !== deviceId() && current.playing) {
      pause({ quiet: true })
      set({ elsewhere: { where: 'device', track: current.track } })
    }
  } catch {
    // keep playing
  }
}

let started = false
let pausedHidden = false
/** Call once when the dash opens: hand-over between tabs, the library, system controls. */
export function startMusic() {
  if (started || typeof window === 'undefined') return
  started = true
  // "Keep playing in the background" off: a hidden tab pauses, and goes on when you're back.
  document.addEventListener('visibilitychange', () => {
    if (options.background) return
    if (document.hidden && state.playing) {
      pausedHidden = true
      pause({ quiet: true })
    } else if (!document.hidden && pausedHidden) {
      pausedHidden = false
      if (state.intent === 'play' && !state.elsewhere) play()
    }
  })
  if ('BroadcastChannel' in window) {
    channel = new BroadcastChannel('homesite-music')
    channel.onmessage = ({ data }) => {
      if (!data || data.from === tabId) return
      if (data.type === 'playing' && state.playing) {
        // Another tab took over: fade out here.
        pause({ quiet: true })
        set({ elsewhere: { where: 'tab', track: data.track } })
      } else if (data.type === 'playing') set({ elsewhere: { where: 'tab', track: data.track } })
      else if (data.type === 'paused' && state.elsewhere?.where === 'tab') set({ elsewhere: null })
      else if (data.type === 'hello' && state.playing) {
        // A new dash opened: offer it the music where it is now.
        channel.postMessage({ type: 'handover', from: tabId, to: data.from, queue: state.queue, index: state.index, position: state.position })
      } else if (data.type === 'handover' && data.to === tabId) takeOver(data)
      else if (data.type === 'took' && data.to === tabId && state.playing) {
        pause({ quiet: true })
        set({ elsewhere: { where: 'tab', track: data.track } })
      }
    }
    channel.postMessage({ type: 'hello', from: tabId })
    window.addEventListener('pagehide', () => {
      if (state.playing) channel.postMessage({ type: 'paused', from: tabId })
    })
  }
  mediaSession()
}

/* Taking the music over from another tab, at its position (only if the browser lets this tab start sound). */
async function takeOver(data) {
  const offered = { queue: data.queue, index: data.index, position: data.position }
  pendingHandover = { ...offered, from: data.from }
  await loadLibrary().catch(() => {})
  set({ queue: offered.queue, index: offered.index, position: offered.position })
  current = null
  const ok = await start(offered.position).catch(() => false)
  if (!ok) {
    // No sound allowed yet: the other tab plays on, this one offers to continue here.
    set({ elsewhere: { where: 'tab', track: offered.queue[offered.index] } })
    return
  }
  set({ playing: true, elsewhere: null })
  channel?.postMessage({ type: 'took', from: tabId, to: data.from, track: offered.queue[offered.index] })
  claim(true, true)
  mediaSession()
  pendingHandover = null
}
let pendingHandover = null
/** "Continue here": take the music from the other tab or device now. */
export async function continueHere() {
  if (pendingHandover) {
    const data = pendingHandover
    const ok = await start(data.position).catch(() => false)
    if (!ok) return
    set({ playing: true, elsewhere: null, blocked: false })
    channel?.postMessage({ type: 'took', from: tabId, to: data.from, track: data.queue[data.index] })
    claim(true, true)
    pendingHandover = null
    mediaSession()
    return
  }
  await play()
}
