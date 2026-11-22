import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import * as music from '../../../lib/music.js'
import { Empty } from '../kit.jsx'
import { Cover, time } from './parts.jsx'

/*
 * Playlists in Customize → Music: make one (empty, or from what's in the
 * queue), open it to reorder by dragging or remove songs, rename, play,
 * shuffle, delete.
 */

function PlaylistSongs({ playlist }) {
  const { t } = useTranslation('dash')
  const [dragging, setDragging] = useState(null)
  const [order, setOrder] = useState(null)
  const list = order ?? playlist.tracks
  const save = (tracks) => music.savePlaylist(playlist.id, { tracks }).catch(() => {})
  if (!list.length) return <p className="dash-hint">{t('music.playlistEmpty')}</p>
  return (
    <ol className="music-songs music-songs--sortable">
      {list.map((id, index) => {
        const track = music.trackById(id)
        if (!track) return null
        return (
          <li
            key={`${id}:${index}`}
            draggable
            className={dragging === index ? 'is-dragging' : ''}
            onDragStart={(event) => {
              setDragging(index)
              setOrder(list)
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', id)
            }}
            onDragOver={(event) => {
              if (dragging === null) return
              event.preventDefault()
              if (dragging !== index) {
                const next = [...list]
                const [item] = next.splice(dragging, 1)
                next.splice(index, 0, item)
                setOrder(next)
                setDragging(index)
              }
            }}
            onDragEnd={() => {
              if (order) save(order)
              setDragging(null)
              setOrder(null)
            }}
          >
            <span className="material-symbols-outlined music-grip" aria-hidden="true">
              drag_indicator
            </span>
            <button type="button" className="music-songs__main" onClick={() => music.playTracks(list, { from: index })}>
              <Cover track={track} size={32} />
              <span className="music-songs__text">
                <strong>{track.title}</strong>
                <small>{track.artist ?? ''}</small>
              </span>
            </button>
            <span className="music-songs__time">{track.duration ? time(track.duration) : ''}</span>
            <button type="button" className="dash-tool" onClick={() => save(list.filter((_, other) => other !== index))} title={t('music.fromPlaylist')} aria-label={t('music.fromPlaylist')}>
              <span className="material-symbols-outlined">remove</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

export default function MusicPlaylists() {
  const { t } = useTranslation('dash')
  const state = music.useMusic()
  const [name, setName] = useState('')
  const [open, setOpen] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [error, setError] = useState('')
  const act = async (work) => {
    setError('')
    try {
      await work()
    } catch (failure) {
      setError(failure.message)
    }
  }
  const playlists = state.library.playlists
  return (
    <div className="music-playlists">
      <form
        className="music-playlists__new"
        onSubmit={(event) => {
          event.preventDefault()
          if (!name.trim()) return
          act(async () => {
            const playlist = await music.savePlaylist(null, { name: name.trim(), tracks: event.nativeEvent.submitter?.value === 'queue' ? state.queue : [] })
            setName('')
            setOpen(playlist.id)
          })
        }}
      >
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('music.newPlaylist')} aria-label={t('music.newPlaylist')} maxLength={80} />
        <button type="submit" value="empty" className="dash-button dash-button--small" disabled={!name.trim()}>
          {t('music.create')}
        </button>
        {state.queue.length > 0 && (
          <button type="submit" value="queue" className="dash-button dash-button--quiet dash-button--small" disabled={!name.trim()}>
            {t('music.fromQueue', { count: state.queue.length })}
          </button>
        )}
      </form>
      {error && <p className="dash-error">{error}</p>}
      {playlists.length === 0 && <Empty icon="queue_music">{t('music.playlistsEmpty')}</Empty>}
      <ul className="music-playlists__list">
        {playlists.map((playlist) => {
          const tracks = playlist.tracks.map(music.trackById).filter(Boolean)
          const length = tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0)
          const covers = tracks.filter((track) => track.cover).slice(0, 4)
          return (
            <li key={playlist.id} className={open === playlist.id ? 'is-open' : ''}>
              <div className="music-playlists__row">
                <span className={`music-playlists__art music-playlists__art--${Math.min(4, covers.length)}`} aria-hidden="true">
                  {covers.length ? covers.map((track) => <Cover key={track.id} track={track} size={covers.length > 1 ? 24 : 48} />) : <span className="material-symbols-outlined">queue_music</span>}
                </span>
                {renaming === playlist.id ? (
                  <input
                    className="music-playlists__rename"
                    defaultValue={playlist.name}
                    autoFocus
                    maxLength={80}
                    onBlur={(event) => {
                      setRenaming(null)
                      const value = event.target.value.trim()
                      if (value && value !== playlist.name) act(() => music.savePlaylist(playlist.id, { name: value }))
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        setRenaming(null)
                      }
                    }}
                    aria-label={t('music.rename')}
                  />
                ) : (
                  <button type="button" className="music-playlists__name" onClick={() => setOpen(open === playlist.id ? null : playlist.id)} aria-expanded={open === playlist.id}>
                    <strong>{playlist.name}</strong>
                    <small>{[t('music.tracks', { count: tracks.length }), length ? time(length) : null].filter(Boolean).join(' · ')}</small>
                  </button>
                )}
                <button type="button" className="dash-tool" onClick={() => music.playTracks(playlist.tracks, { shuffle: false })} disabled={!tracks.length} title={t('music.play')} aria-label={t('music.play')}>
                  <span className="material-symbols-outlined">play_arrow</span>
                </button>
                <button type="button" className="dash-tool" onClick={() => music.playTracks(playlist.tracks, { shuffle: true })} disabled={!tracks.length} title={t('music.shufflePlay')} aria-label={t('music.shufflePlay')}>
                  <span className="material-symbols-outlined">shuffle</span>
                </button>
                <button type="button" className="dash-tool" onClick={() => music.enqueue(playlist.tracks)} disabled={!tracks.length} title={t('music.enqueue')} aria-label={t('music.enqueue')}>
                  <span className="material-symbols-outlined">add_to_queue</span>
                </button>
                <button type="button" className="dash-tool" onClick={() => setRenaming(playlist.id)} title={t('music.rename')} aria-label={t('music.rename')}>
                  <span className="material-symbols-outlined">edit</span>
                </button>
                <button
                  type="button"
                  className="dash-tool dash-tool--danger"
                  onClick={() => {
                    if (window.confirm(t('music.confirmDelete', { name: playlist.name }))) act(() => music.removePlaylist(playlist.id))
                  }}
                  title={t('music.removePlaylist')}
                  aria-label={t('music.removePlaylist')}
                >
                  <span className="material-symbols-outlined">delete</span>
                </button>
              </div>
              {open === playlist.id && <PlaylistSongs playlist={playlist} />}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
