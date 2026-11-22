import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import * as music from '../../../lib/music.js'
import { Empty } from '../kit.jsx'
import { Cover, SourceBadge, TrackEditor, time, useTrackMenu } from './parts.jsx'

/*
 * The library in Customize → Music: songs, albums (cover tiles), artists and
 * sources; search and sort; select several (click, Shift + click for a
 * range) to play, shuffle, queue, put in a playlist or remove; a menu per
 * track (⋯ or right click) with editing.
 */

const VIEWS = ['songs', 'albums', 'artists', 'sources']
const PAGE = 300 // rows drawn at a time; more come as you scroll (a big library stays quick)
const text = (value) => String(value ?? '').toLocaleLowerCase()

function SongList({ tracks, onEdit, selectable = true, selected, setSelected }) {
  const { t } = useTranslation('dash')
  const state = music.useMusic()
  const menu = useTrackMenu({ onEdit })
  const last = useRef(null)
  const playing = music.currentTrack()?.id
  const [count, setCount] = useState(PAGE)
  const end = useRef(null)
  useEffect(() => setCount(PAGE), [tracks])
  useEffect(() => {
    const element = end.current
    if (!element) return undefined
    const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && setCount((value) => value + PAGE), { rootMargin: '600px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [count, tracks.length])
  const choose = (event, index) => {
    const id = tracks[index].id
    const next = new Set(selected)
    if (event.shiftKey && last.current !== null) {
      const [from, to] = [Math.min(last.current, index), Math.max(last.current, index)]
      for (let at = from; at <= to; at++) next.add(tracks[at].id)
    } else if (next.has(id)) next.delete(id)
    else next.add(id)
    last.current = index
    setSelected(next)
  }
  return (
    <>
      <ol className="music-songs">
        {tracks.slice(0, count).map((track, index) => {
          const ids = selected.has(track.id) && selected.size > 1 ? [...selected] : [track.id]
          return (
            <li key={track.id} className={`${playing === track.id ? 'is-playing' : ''}${selected.has(track.id) ? ' is-selected' : ''}`} onContextMenu={(event) => menu.open(event, ids, ids.length === 1 ? track : null)}>
              {selectable && <input type="checkbox" checked={selected.has(track.id)} onChange={() => {}} onClick={(event) => choose(event, index)} aria-label={t('music.select', { title: track.title })} />}
              <button type="button" className="music-songs__main" onClick={() => music.playTracks(tracks.map((item) => item.id), { from: index })} onDoubleClick={(event) => event.preventDefault()} title={t('music.playFromHere')}>
                <span className="music-songs__cover">
                  <Cover track={track} size={38} />
                  <span className="material-symbols-outlined music-songs__hover" aria-hidden="true">
                    {playing === track.id && state.playing ? 'equalizer' : 'play_arrow'}
                  </span>
                </span>
                <span className="music-songs__text">
                  <strong>{track.title}</strong>
                  <small>{[track.artist, track.album].filter(Boolean).join(' · ') || t('music.unknownArtist')}</small>
                </span>
              </button>
              <SourceBadge track={track} short />
              <span className="music-songs__time">{track.duration ? time(track.duration) : ''}</span>
              <button type="button" className="dash-tool" onClick={(event) => menu.open(event, ids, ids.length === 1 ? track : null)} aria-label={t('music.more', { title: track.title })} title={t('music.moreShort')}>
                <span className="material-symbols-outlined">more_horiz</span>
              </button>
            </li>
          )
        })}
      </ol>
      {count < tracks.length && (
        <button ref={end} type="button" className="dash-button dash-button--quiet dash-button--small music-more-button" onClick={() => setCount((value) => value + PAGE)}>
          {t('music.showMore', { count: Math.min(PAGE, tracks.length - count) })}
        </button>
      )}
      {menu.node}
    </>
  )
}

function Tiles({ groups, onOpen, kind }) {
  const { t } = useTranslation('dash')
  return (
    <div className={`music-tiles music-tiles--${kind}`}>
      {groups.map((group) => (
        <div key={group.key} className="music-tile">
          <button type="button" className="music-tile__open" onClick={() => onOpen(group)}>
            <span className="music-tile__art">
              {kind === 'artists' ? (
                <span className="music-tile__avatar" aria-hidden="true">
                  {(group.name || '?').slice(0, 1).toUpperCase()}
                </span>
              ) : (
                <Cover track={group.tracks.find((track) => track.cover) ?? group.tracks[0]} size={132} />
              )}
            </span>
            <strong>{group.name || t('music.unknown')}</strong>
            <small>{[group.sub, t('music.tracks', { count: group.tracks.length })].filter(Boolean).join(' · ')}</small>
          </button>
          <button type="button" className="music-tile__play" onClick={() => music.playTracks(group.tracks.map((track) => track.id))} aria-label={t('music.playGroup', { name: group.name || t('music.unknown') })} title={t('music.play')}>
            <span className="material-symbols-outlined">play_arrow</span>
          </button>
        </div>
      ))}
    </div>
  )
}

export default function MusicLibrary() {
  const { t, i18n } = useTranslation('dash')
  const state = music.useMusic()
  const [view, setView] = useState('songs')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('added')
  const [open, setOpen] = useState(null) // { kind, key, name }
  const [selected, setSelected] = useState(() => new Set())
  const [editing, setEditing] = useState(null)
  const tracks = state.library.tracks
  const words = text(query).trim().split(/\s+/).filter(Boolean)
  const found = useMemo(() => tracks.filter((track) => words.every((word) => text(`${track.title} ${track.artist} ${track.album} ${track.genre}`).includes(word))), [tracks, words.join(' ')]) // eslint-disable-line react-hooks/exhaustive-deps
  const sorted = useMemo(() => {
    const by = {
      added: (a, b) => String(b.addedAt ?? '').localeCompare(String(a.addedAt ?? '')),
      title: (a, b) => text(a.title).localeCompare(text(b.title), i18n.language),
      artist: (a, b) => text(a.artist).localeCompare(text(b.artist), i18n.language) || text(a.album).localeCompare(text(b.album)) || (a.track ?? 0) - (b.track ?? 0),
      album: (a, b) => text(a.album).localeCompare(text(b.album), i18n.language) || (a.track ?? 0) - (b.track ?? 0),
      duration: (a, b) => (b.duration ?? 0) - (a.duration ?? 0),
    }[sort]
    return [...found].sort(by)
  }, [found, sort, i18n.language])
  const grouped = useMemo(() => {
    if (view === 'songs') return []
    const map = new Map()
    for (const track of sorted) {
      const key = view === 'albums' ? `${text(track.album)}|${text(track.artist)}` : view === 'artists' ? text(track.artist) : track.source
      if (!map.has(key)) map.set(key, { key, name: view === 'albums' ? track.album : view === 'artists' ? track.artist : t(`music.sources.${track.source}`), sub: view === 'albums' ? track.artist : null, tracks: [] })
      map.get(key).tracks.push(track)
    }
    const list = [...map.values()]
    for (const group of list) if (view === 'albums') group.tracks.sort((a, b) => (a.track ?? 0) - (b.track ?? 0))
    return list.sort((a, b) => text(a.name).localeCompare(text(b.name), i18n.language))
  }, [sorted, view, t, i18n.language])
  const openGroup = open ? grouped.find((group) => group.key === open.key) : null
  const shown = openGroup ? openGroup.tracks : sorted
  const ids = [...selected].filter((id) => tracks.some((track) => track.id === id))

  if (state.library.status === 'loading' && !tracks.length) return <p className="dash-hint">{t('music.loading')}</p>
  if (state.library.status === 'error') return <p className="dash-error">{state.library.error}</p>
  if (!tracks.length) return <Empty icon="library_music">{t('music.libraryEmpty')}</Empty>

  return (
    <div className="music-library">
      <div className="music-library__bar">
        <div className="dash-segment" role="tablist" aria-label={t('music.view')}>
          {VIEWS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={view === name}
              className={view === name ? 'is-active' : ''}
              onClick={() => {
                setView(name)
                setOpen(null)
              }}
            >
              {t(`music.views.${name}`)}
            </button>
          ))}
        </div>
        <label className="music-search">
          <span className="material-symbols-outlined" aria-hidden="true">
            search
          </span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('music.searchLibrary')} aria-label={t('music.searchLibrary')} />
        </label>
        {(view === 'songs' || openGroup) && (
          <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label={t('music.sort')}>
            {['added', 'title', 'artist', 'album', 'duration'].map((name) => (
              <option key={name} value={name}>
                {t(`music.sorts.${name}`)}
              </option>
            ))}
          </select>
        )}
      </div>

      {openGroup && (
        <div className="music-library__group-head">
          <button type="button" className="dash-tool" onClick={() => setOpen(null)} aria-label={t('music.back')} title={t('music.back')}>
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          {view === 'albums' && <Cover track={openGroup.tracks.find((track) => track.cover) ?? openGroup.tracks[0]} size={64} />}
          <div>
            <h3>{openGroup.name || t('music.unknown')}</h3>
            <p className="dash-muted">{[openGroup.sub, t('music.tracks', { count: openGroup.tracks.length }), time(openGroup.tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0))].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="dash-row">
            <button type="button" className="dash-button dash-button--small" onClick={() => music.playTracks(openGroup.tracks.map((track) => track.id), { shuffle: false })}>
              <span className="material-symbols-outlined" aria-hidden="true">
                play_arrow
              </span>
              {t('music.play')}
            </button>
            <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => music.playTracks(openGroup.tracks.map((track) => track.id), { shuffle: true })}>
              <span className="material-symbols-outlined" aria-hidden="true">
                shuffle
              </span>
              {t('music.shufflePlay')}
            </button>
          </div>
        </div>
      )}

      {view !== 'songs' && !openGroup ? (
        grouped.length ? <Tiles groups={grouped} kind={view} onOpen={(group) => setOpen({ key: group.key })} /> : <p className="dash-hint">{t('music.noMatch')}</p>
      ) : (
        <>
          <div className={`music-selection${ids.length ? ' is-active' : ''}`}>
            <label className="dash-check">
              <input type="checkbox" checked={shown.length > 0 && shown.every((track) => selected.has(track.id))} onChange={(event) => setSelected(event.target.checked ? new Set(shown.map((track) => track.id)) : new Set())} />
              <span>{ids.length ? t('music.selected', { count: ids.length }) : t('music.selectAll')}</span>
            </label>
            {ids.length > 0 ? (
              <>
                <button type="button" className="dash-button dash-button--small" onClick={() => music.playTracks(ids, { shuffle: false })}>
                  {t('music.play')}
                </button>
                <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => music.playTracks(ids, { shuffle: true })}>
                  {t('music.shufflePlay')}
                </button>
                <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => music.enqueue(ids)}>
                  {t('music.enqueue')}
                </button>
                <button
                  type="button"
                  className="dash-button dash-button--quiet dash-button--small"
                  onClick={() => {
                    music.savePlaylist(null, { name: t('music.newPlaylistName'), tracks: ids }).catch(() => {})
                    setSelected(new Set())
                  }}
                >
                  {t('music.toPlaylist')}
                </button>
                <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => setSelected(new Set())}>
                  {t('music.clearSelection')}
                </button>
              </>
            ) : (
              <span className="dash-hint">{t('music.selectHint', { count: shown.length, length: time(shown.reduce((sum, track) => sum + (track.duration ?? 0), 0)) })}</span>
            )}
          </div>
          {shown.length ? <SongList tracks={shown} onEdit={setEditing} selected={selected} setSelected={setSelected} /> : <p className="dash-hint">{t('music.noMatch')}</p>}
        </>
      )}
      {editing && <TrackEditor track={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
