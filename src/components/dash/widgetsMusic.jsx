import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import * as music from '../../lib/music.js'
import MusicQueue from './music/MusicQueue.jsx'
import { Controls, Cover, Elsewhere, SeekBar, SourceBadge, Volume } from './music/parts.jsx'

/*
 * The music widget: only the player. Cover (on a blur of itself), title,
 * artist and where it's from, seek, controls, volume; below it what plays
 * next, and "Choose music" (playlists and a quick search of the library).
 * Managing the library, playlists and adding music is Customize → Music
 * ("Manage"). Small widgets get a mini player.
 */

export const openMusicSettings = () => window.dispatchEvent(new CustomEvent('dash:settings', { detail: 'music' }))

function Picker({ onClose }) {
  const { t } = useTranslation('dash')
  const state = music.useMusic()
  const [query, setQuery] = useState('')
  const input = useRef(null)
  useEffect(() => input.current?.focus({ preventScroll: true }), [])
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  const songs = words.length ? state.library.tracks.filter((track) => words.every((word) => `${track.title} ${track.artist ?? ''} ${track.album ?? ''}`.toLocaleLowerCase().includes(word))).slice(0, 8) : []
  return (
    <div className="music-picker" role="dialog" aria-label={t('music.choose')} onKeyDown={(event) => event.key === 'Escape' && (event.stopPropagation(), onClose())}>
      <label className="music-search">
        <span className="material-symbols-outlined" aria-hidden="true">
          search
        </span>
        <input ref={input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('music.searchLibrary')} aria-label={t('music.searchLibrary')} />
        <button type="button" className="dash-tool" onClick={onClose} aria-label={t('settings.close')}>
          <span className="material-symbols-outlined">close</span>
        </button>
      </label>
      {words.length > 0 ? (
        songs.length ? (
          <ul className="music-picker__list">
            {songs.map((track) => (
              <li key={track.id}>
                <button
                  type="button"
                  onClick={() => {
                    music.playTracks([track.id, ...music.getMusic().queue.filter((id) => id !== track.id)])
                    onClose()
                  }}
                >
                  <Cover track={track} size={30} />
                  <span className="music-songs__text">
                    <strong>{track.title}</strong>
                    <small>{track.artist ?? ''}</small>
                  </span>
                </button>
                <button type="button" className="dash-tool" onClick={() => music.enqueue([track.id], { next: true })} title={t('music.playNext')} aria-label={t('music.playNext')}>
                  <span className="material-symbols-outlined">queue_play_next</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dash-hint">{t('music.noMatch')}</p>
        )
      ) : (
        <ul className="music-picker__list">
          <li>
            <button
              type="button"
              onClick={() => {
                music.playTracks(
                  state.library.tracks.map((track) => track.id),
                  { shuffle: true },
                )
                onClose()
              }}
              disabled={!state.library.tracks.length}
            >
              <span className="music-picker__icon material-symbols-outlined" aria-hidden="true">
                shuffle
              </span>
              <span className="music-songs__text">
                <strong>{t('music.shuffleAll')}</strong>
                <small>{t('music.tracks', { count: state.library.tracks.length })}</small>
              </span>
            </button>
          </li>
          {state.library.playlists.map((playlist) => (
            <li key={playlist.id}>
              <button
                type="button"
                onClick={() => {
                  music.playTracks(playlist.tracks)
                  onClose()
                }}
                disabled={!playlist.tracks.length}
              >
                <span className="music-picker__icon material-symbols-outlined" aria-hidden="true">
                  queue_music
                </span>
                <span className="music-songs__text">
                  <strong>{playlist.name}</strong>
                  <small>{t('music.tracks', { count: playlist.tracks.length })}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function MusicView({ widget }) {
  const { t } = useTranslation('dash')
  const state = music.useMusic()
  const track = music.currentTrack()
  const [picking, setPicking] = useState(false)
  const root = useRef(null)
  const [size, setSize] = useState('large')
  useEffect(() => {
    music.startMusic()
    music.loadLibrary().catch(() => {})
  }, [])
  useEffect(() => {
    const element = root.current?.parentElement
    if (!element) return undefined
    const observer = new ResizeObserver(() => setSize(element.clientHeight < 260 || element.clientWidth < 240 ? 'mini' : element.clientHeight < 420 ? 'medium' : 'large'))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const cover = music.coverOf(track)
  if (state.library.status === 'error' && /401|log in/i.test(state.library.error ?? ''))
    return (
      <div className="music-widget music-widget--empty">
        <span className="material-symbols-outlined" aria-hidden="true">
          lock
        </span>
        <p>{t('music.login')}</p>
      </div>
    )
  const nothing = state.library.status === 'ready' && !state.library.tracks.length
  return (
    <div
      ref={root}
      className={`music-widget music-widget--${size}`}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === ' ') {
          event.preventDefault()
          music.toggle()
        }
      }}
    >
      {cover && widget.options.backdrop !== false && <span className="music-widget__backdrop" style={{ backgroundImage: `url("${cover.replace(/"/g, '%22')}")` }} aria-hidden="true" />}
      <div className="music-widget__now">
        <Cover track={track} size={size === 'mini' ? 52 : size === 'medium' ? 76 : 108} className="music-widget__cover" />
        <div className="music-widget__text">
          <strong>{track?.title ?? (nothing ? t('music.emptyTitle') : t('music.nothing'))}</strong>
          <span>{track ? [track.artist, track.album].filter(Boolean).join(' · ') || ' ' : nothing ? t('music.emptyText') : t('music.chooseText')}</span>
          {track && size !== 'mini' && <SourceBadge track={track} />}
        </div>
      </div>
      {size !== 'mini' && <SeekBar />}
      <div className="music-widget__bar">
        <Controls size={size === 'mini' ? 'small' : 'normal'} />
        {size === 'large' && <Volume />}
      </div>
      <Elsewhere />
      {size === 'large' && widget.options.upNext !== false && state.queue.length > state.index + 1 && (
        <section className="music-widget__next">
          <h4>{t('music.upNext')}</h4>
          <MusicQueue compact limit={6} />
        </section>
      )}
      <div className="music-widget__actions">
        <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => setPicking(!picking)} aria-expanded={picking} disabled={nothing}>
          <span className="material-symbols-outlined" aria-hidden="true">
            library_music
          </span>
          {t('music.choose')}
        </button>
        <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={openMusicSettings}>
          <span className="material-symbols-outlined" aria-hidden="true">
            {nothing ? 'add_circle' : 'tune'}
          </span>
          {nothing ? t('music.addMusic') : t('music.manage')}
        </button>
      </div>
      {picking && <Picker onClose={() => setPicking(false)} />}
    </div>
  )
}

export const MUSIC_VIEWS = { MusicView }
