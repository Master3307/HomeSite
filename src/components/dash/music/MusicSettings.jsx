import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { updateDashSettings, useDashSettings } from '../../../lib/dashSettings.js'
import * as music from '../../../lib/music.js'
import MusicAdd from './MusicAdd.jsx'
import MusicLibrary from './MusicLibrary.jsx'
import MusicPlaylists from './MusicPlaylists.jsx'
import MusicQueue from './MusicQueue.jsx'
import { Controls, Cover, Elsewhere, SeekBar, SourceBadge, Volume } from './parts.jsx'

/*
 * Customize → Music: what plays (with the controls), then the library,
 * the queue, playlists, adding music and how it plays. The widget is only
 * the player; everything to manage is here.
 */

const SECTIONS = [
  { id: 'library', icon: 'library_music' },
  { id: 'queue', icon: 'queue_music' },
  { id: 'playlists', icon: 'featured_play_list' },
  { id: 'add', icon: 'add_circle' },
  { id: 'playback', icon: 'tune' },
]

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="dash-check music-toggle">
      <input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  )
}

function Playback() {
  const { t } = useTranslation('dash')
  const settings = useDashSettings()
  const state = music.useMusic()
  const options = settings.music
  const change = (patch) => updateDashSettings({ music: { ...options, ...patch } })
  return (
    <div className="music-playback">
      <Toggle label={t('music.settings.background')} hint={t('music.settings.backgroundHint')} checked={options.background} onChange={(background) => change({ background })} />
      <Toggle label={t('music.settings.resume')} hint={t('music.settings.resumeHint')} checked={options.resume} onChange={(resume) => change({ resume })} />
      <Toggle label={t('music.settings.fade')} hint={t('music.settings.fadeHint')} checked={options.fade} onChange={(fade) => change({ fade })} />
      {options.fade && (
        <label className="dash-field">
          <span className="dash-field__label">
            {t('music.settings.fadeMs')} <small>{(options.fadeMs / 1000).toFixed(1)} s</small>
          </span>
          <input type="range" min="100" max="3000" step="100" value={options.fadeMs} onChange={(event) => change({ fadeMs: Number(event.target.value) })} />
        </label>
      )}
      <Toggle label={t('music.settings.chip')} hint={t('music.settings.chipHint')} checked={options.chip} onChange={(chip) => change({ chip })} />
      <div className="dash-field">
        <span className="dash-field__label">{t('music.volume')}</span>
        <Volume />
      </div>
      <p className="dash-hint">{t('music.settings.oneDevice')}</p>
      {state.queue.length > 0 && (
        <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => music.clearQueue()}>
          {t('music.clearQueue')}
        </button>
      )}
    </div>
  )
}

export default function MusicSettings() {
  const { t } = useTranslation('dash')
  const state = music.useMusic()
  const [section, setSection] = useState('library')
  const track = music.currentTrack()
  useEffect(() => {
    music.startMusic()
    music.loadLibrary().catch(() => {})
  }, [])
  const login = state.library.status === 'error' && /401|log in/i.test(state.library.error ?? '')
  return (
    <div className="dash-panel music-settings">
      <div className="music-now">
        <Cover track={track} size={64} />
        <div className="music-now__text">
          <strong>{track?.title ?? t('music.nothing')}</strong>
          <span>{[track?.artist, track?.album].filter(Boolean).join(' · ')}</span>
          {track && <SourceBadge track={track} />}
        </div>
        <Controls />
        <SeekBar />
        <Elsewhere />
      </div>
      {login ? (
        <p className="dash-hint">{t('music.login')}</p>
      ) : (
        <>
          <div className="dash-segment music-settings__tabs" role="tablist" aria-label={t('settings.tabs.music')}>
            {SECTIONS.map((entry) => (
              <button key={entry.id} type="button" role="tab" aria-selected={section === entry.id} className={section === entry.id ? 'is-active' : ''} onClick={() => setSection(entry.id)}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  {entry.icon}
                </span>
                {t(`music.sections.${entry.id}`)}
                {entry.id === 'queue' && state.queue.length > 0 && <span className="music-count">{state.queue.length}</span>}
              </button>
            ))}
          </div>
          {section === 'library' && <MusicLibrary />}
          {section === 'queue' && <MusicQueue />}
          {section === 'playlists' && <MusicPlaylists />}
          {section === 'add' && <MusicAdd />}
          {section === 'playback' && <Playback />}
        </>
      )}
    </div>
  )
}
