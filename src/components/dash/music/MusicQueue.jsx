import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import * as music from '../../../lib/music.js'
import { Empty } from '../kit.jsx'
import { Cover, time } from './parts.jsx'

/* What plays next: drag to reorder, click to jump there, remove; the one playing is marked. */
export default function MusicQueue({ limit = null, compact = false }) {
  const { t } = useTranslation('dash')
  const state = music.useMusic()
  const [dragging, setDragging] = useState(null)
  if (!state.queue.length) return <Empty icon="queue_music">{t('music.queueEmpty')}</Empty>
  // In the widget: only what comes after the one playing.
  const start = compact ? state.index + 1 : 0
  const rows = state.queue.map((id, index) => ({ id, index })).slice(start, limit ? start + limit : undefined)
  return (
    <>
      <ol className={`music-songs music-songs--sortable${compact ? ' is-compact' : ''}`}>
        {rows.map(({ id, index }) => {
          const track = music.trackById(id)
          if (!track) return null
          return (
            <li
              key={`${id}:${index}`}
              className={`${index === state.index ? 'is-playing' : ''}${dragging === index ? ' is-dragging' : ''}`}
              draggable
              onDragStart={(event) => {
                setDragging(index)
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', id)
              }}
              onDragOver={(event) => {
                if (dragging === null) return
                event.preventDefault()
                if (dragging !== index) {
                  music.moveInQueue(dragging, index)
                  setDragging(index)
                }
              }}
              onDragEnd={() => setDragging(null)}
            >
              <span className="material-symbols-outlined music-grip" aria-hidden="true">
                drag_indicator
              </span>
              <button type="button" className="music-songs__main" onClick={() => music.jumpTo(index)}>
                <span className="music-songs__cover">
                  <Cover track={track} size={compact ? 30 : 36} />
                  {index === state.index && (
                    <span className="material-symbols-outlined music-songs__now" aria-hidden="true">
                      {state.playing ? 'equalizer' : 'pause'}
                    </span>
                  )}
                </span>
                <span className="music-songs__text">
                  <strong>{track.title}</strong>
                  <small>{track.artist ?? t(`music.sources.${track.source}`)}</small>
                </span>
              </button>
              {!compact && <span className="music-songs__time">{track.duration ? time(track.duration) : ''}</span>}
              <button type="button" className="dash-tool" onClick={() => music.dequeue(index)} title={t('music.dequeue')} aria-label={t('music.dequeue')}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </li>
          )
        })}
      </ol>
      {limit && state.queue.length - start > limit && <p className="dash-hint music-more">{t('music.moreInQueue', { count: state.queue.length - start - limit })}</p>}
    </>
  )
}
