import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import * as music from '../../../lib/music.js'
import { DashMenu } from '../menus.jsx'
import '../../../styles/music.css'

/* Pieces shared by the music widget and Customize → Music. */

export const SOURCE_ICONS = { upload: 'upload_file', builtin: 'library_music', link: 'link', youtube: 'smart_display', webdav: 'folder', navidrome: 'album' }
export function time(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

export function Cover({ track, size = 48, className = '' }) {
  const [broken, setBroken] = useState(false)
  const src = music.coverOf(track)
  useEffect(() => setBroken(false), [src])
  if (!src || broken)
    return (
      <span className={`music-cover is-empty ${className}`.trim()} style={{ width: size, height: size }} aria-hidden="true">
        <span className="material-symbols-outlined" style={{ fontSize: Math.max(16, size * 0.42) }}>
          {SOURCE_ICONS[track?.source] ?? 'music_note'}
        </span>
      </span>
    )
  return <img className={`music-cover ${className}`.trim()} src={src} width={size} height={size} alt="" loading="lazy" onError={() => setBroken(true)} />
}

export function SourceBadge({ track, short = false }) {
  const { t } = useTranslation('dash')
  if (!track) return null
  return (
    <span className="music-source" title={t(`music.sources.${track.source}`)}>
      <span className="material-symbols-outlined" aria-hidden="true">
        {SOURCE_ICONS[track.source] ?? 'music_note'}
      </span>
      {!short && t(`music.sources.${track.source}`)}
    </span>
  )
}

/* The ⋯ / right-click menu of a track (or of several: `ids`). */
export function useTrackMenu({ onEdit }) {
  const { t } = useTranslation('dash')
  const state = music.useMusic()
  const [menu, setMenu] = useState(null)
  const open = (event, ids, track = null) => {
    event.preventDefault()
    event.stopPropagation()
    const box = event.currentTarget.getBoundingClientRect?.()
    const x = event.clientX || box?.right || 0
    const y = event.clientY || box?.bottom || 0
    const playlists = state.library.playlists
    setMenu({
      x,
      y,
      label: track ? track.title : t('music.selected', { count: ids.length }),
      items: [
        { label: t('music.play'), icon: 'play_arrow', onSelect: () => music.playTracks(ids) },
        { label: t('music.playNext'), icon: 'queue_play_next', onSelect: () => music.enqueue(ids, { next: true }) },
        { label: t('music.enqueue'), icon: 'add_to_queue', onSelect: () => music.enqueue(ids) },
        ...(playlists.length ? ['-', ...playlists.slice(0, 12).map((playlist) => ({ label: t('music.addTo', { name: playlist.name }), icon: 'playlist_add', onSelect: () => music.savePlaylist(playlist.id, { tracks: [...new Set([...playlist.tracks, ...ids])] }) }))] : []),
        { label: t('music.newPlaylistFrom'), icon: 'playlist_add_check', onSelect: () => music.savePlaylist(null, { name: track ? track.title : t('music.newPlaylistName'), tracks: ids }) },
        '-',
        ...(track?.editable ? [{ label: t('music.edit'), icon: 'edit', onSelect: () => onEdit?.(track) }] : []),
        ...(ids.every((id) => music.trackById(id)?.editable) ? [{ label: ids.length > 1 ? t('music.removeSeveral', { count: ids.length }) : t('music.remove'), icon: 'delete', danger: true, onSelect: () => Promise.all(ids.map((id) => music.removeTrack(id))).catch(() => {}) }] : []),
      ],
    })
  }
  return { open, node: <DashMenu menu={menu} onClose={() => setMenu(null)} /> }
}

/* Editing a track's details (title, artist, album, year, genre) in a small dialog. */
export function TrackEditor({ track, onClose }) {
  const { t } = useTranslation('dash')
  const ref = useRef(null)
  const [form, setForm] = useState({ title: track.title ?? '', artist: track.artist ?? '', album: track.album ?? '', year: track.year ?? '', genre: track.genre ?? '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog ref={ref} className="dash-dialog music-editor" onClose={onClose} onClick={(event) => event.target === ref.current && ref.current.close()} aria-label={t('music.edit')}>
      <form
        className="music-editor__form"
        onSubmit={async (event) => {
          event.preventDefault()
          setSaving(true)
          try {
            await music.editTrack(track.id, form)
            ref.current?.close()
          } catch (failure) {
            setError(failure.message)
          } finally {
            setSaving(false)
          }
        }}
      >
        <header className="music-editor__head">
          <Cover track={track} size={64} />
          <div>
            <h3>{t('music.editTitle')}</h3>
            <SourceBadge track={track} />
          </div>
        </header>
        {['title', 'artist', 'album', 'year', 'genre'].map((key) => (
          <label key={key} className="dash-field">
            <span className="dash-field__label">{t(`music.fields.${key}`)}</span>
            <input value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} inputMode={key === 'year' ? 'numeric' : undefined} maxLength={key === 'year' ? 4 : 200} required={key === 'title'} />
          </label>
        ))}
        {error && <p className="dash-error">{error}</p>}
        <div className="dash-row music-editor__actions">
          <button type="button" className="dash-button dash-button--quiet" onClick={() => ref.current?.close()}>
            {t('settings.cancel')}
          </button>
          <button type="submit" className="dash-button" disabled={saving}>
            {t('settings.save')}
          </button>
        </div>
      </form>
    </dialog>
  )
}

/* Seek bar: drag shows where it will go, the track jumps on release. */
export function SeekBar({ className = '' }) {
  const { t } = useTranslation('dash')
  const state = music.useMusic()
  const [dragging, setDragging] = useState(null)
  const shown = dragging ?? state.position
  const end = state.duration || 0
  const commit = () => {
    if (dragging !== null) music.seek(dragging)
    setDragging(null)
  }
  return (
    <div className={`music-seek ${className}`.trim()}>
      <span>{time(shown)}</span>
      <input
        type="range"
        min="0"
        max={Math.max(1, end)}
        step="1"
        value={Math.min(shown, end || shown)}
        onChange={(event) => setDragging(Number(event.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        disabled={!music.currentTrack() || !end}
        aria-label={t('music.seek')}
        aria-valuetext={`${time(shown)} / ${time(end)}`}
        style={{ '--progress': `${end ? (shown / end) * 100 : 0}%` }}
      />
      <span>{end ? time(end) : '–:––'}</span>
    </div>
  )
}

export function Controls({ size = 'normal' }) {
  const { t } = useTranslation('dash')
  const state = music.useMusic()
  const empty = !state.queue.length
  return (
    <div className={`music-controls music-controls--${size}`}>
      <button type="button" className={`dash-tool${state.shuffle ? ' is-active' : ''}`} aria-pressed={state.shuffle} onClick={() => music.setShuffle(!state.shuffle)} title={t('music.shuffle')} aria-label={t('music.shuffle')}>
        <span className="material-symbols-outlined">shuffle</span>
      </button>
      <button type="button" className="dash-tool" onClick={() => music.previous()} disabled={empty} title={t('music.previous')} aria-label={t('music.previous')}>
        <span className="material-symbols-outlined">skip_previous</span>
      </button>
      <button type="button" className="music-play" onClick={() => music.toggle()} disabled={empty} title={state.playing ? t('music.pause') : t('music.play')} aria-label={state.playing ? t('music.pause') : t('music.play')}>
        <span className={`material-symbols-outlined${state.buffering && state.playing ? ' is-spinning' : ''}`}>{state.buffering && state.playing ? 'progress_activity' : state.playing ? 'pause' : 'play_arrow'}</span>
      </button>
      <button type="button" className="dash-tool" onClick={() => music.next()} disabled={empty} title={t('music.next')} aria-label={t('music.next')}>
        <span className="material-symbols-outlined">skip_next</span>
      </button>
      <button type="button" className={`dash-tool${state.repeat !== 'off' ? ' is-active' : ''}`} onClick={() => music.setRepeat(state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off')} title={t(`music.repeat.${state.repeat}`)} aria-label={t(`music.repeat.${state.repeat}`)}>
        <span className="material-symbols-outlined">{state.repeat === 'one' ? 'repeat_one' : 'repeat'}</span>
      </button>
    </div>
  )
}

export function Volume() {
  const { t } = useTranslation('dash')
  const state = music.useMusic()
  const before = useRef(0.6)
  return (
    <div className="music-volume">
      <button
        type="button"
        className="dash-tool"
        onClick={() => {
          if (state.volume > 0) {
            before.current = state.volume
            music.setVolume(0)
          } else music.setVolume(before.current || 0.6)
        }}
        title={state.volume === 0 ? t('music.unmute') : t('music.mute')}
        aria-label={state.volume === 0 ? t('music.unmute') : t('music.mute')}
      >
        <span className="material-symbols-outlined">{state.volume === 0 ? 'volume_off' : state.volume < 0.5 ? 'volume_down' : 'volume_up'}</span>
      </button>
      <input type="range" min="0" max="1" step="0.01" value={state.volume} onChange={(event) => music.setVolume(Number(event.target.value))} aria-label={t('music.volume')} aria-valuetext={`${Math.round(state.volume * 100)} %`} style={{ '--progress': `${state.volume * 100}%` }} />
    </div>
  )
}

/* "Playing in another tab / device": take it over here. */
export function Elsewhere() {
  const { t } = useTranslation('dash')
  const state = music.useMusic()
  if (state.elsewhere)
    return (
      <div className="music-note">
        <span className="material-symbols-outlined" aria-hidden="true">
          {state.elsewhere.where === 'tab' ? 'tab' : 'devices'}
        </span>
        <span>{t(state.elsewhere.where === 'tab' ? 'music.elsewhereTab' : 'music.elsewhereDevice')}</span>
        <button type="button" className="dash-button dash-button--small" onClick={() => music.continueHere()}>
          {t('music.continueHere')}
        </button>
      </div>
    )
  if (state.blocked)
    return (
      <div className="music-note">
        <span className="material-symbols-outlined" aria-hidden="true">
          touch_app
        </span>
        <span>{t('music.blocked')}</span>
      </div>
    )
  return null
}
