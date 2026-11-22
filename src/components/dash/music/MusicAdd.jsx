import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { loadIntegrations, useIntegrations } from '../../../lib/dashIntegrations.js'
import * as music from '../../../lib/music.js'

/*
 * Adding music in Customize → Music: upload files (with progress and how
 * much space is left), a link or YouTube video / playlist, a folder from a
 * WebDAV / Nextcloud / copyparty integration, albums or random songs from
 * Navidrome / OpenSubsonic. Each says in one line what it does.
 */

const AUDIO = /\.(mp3|m4a|aac|ogg|oga|opus|flac|wav|webm|weba)$/i
const mb = (bytes) => Math.round((bytes / 1048576) * 10) / 10

function Card({ icon, title, text, children }) {
  return (
    <section className="music-add__card">
      <header>
        <span className="material-symbols-outlined" aria-hidden="true">
          {icon}
        </span>
        <div>
          <h4>{title}</h4>
          <p>{text}</p>
        </div>
      </header>
      {children}
    </section>
  )
}

export default function MusicAdd() {
  const { t } = useTranslation('dash')
  const state = music.useMusic()
  const { items } = useIntegrations()
  const [uploads, setUploads] = useState([])
  const [over, setOver] = useState(false)
  const [link, setLink] = useState('')
  const [folder, setFolder] = useState({ integration: '', path: '/' })
  const [navidrome, setNavidrome] = useState({ integration: '', q: '', albums: null, loading: false })
  const [notice, setNotice] = useState({ kind: '', text: '' })
  const [addingAll, setAddingAll] = useState(false)
  const fileRef = useRef(null)
  useEffect(() => {
    loadIntegrations().catch(() => {})
  }, [])
  const folders = items.filter((item) => ['webdav', 'nextcloud', 'copyparty'].includes(item.kind))
  const subsonics = items.filter((item) => ['navidrome', 'opensubsonic'].includes(item.kind))
  const quota = state.library.quota
  const act = async (work) => {
    setNotice({ kind: '', text: '' })
    try {
      const text = await work()
      if (text) setNotice({ kind: 'ok', text })
    } catch (failure) {
      setNotice({ kind: 'error', text: failure.message })
    }
  }

  const upload = async (files) => {
    const audio = [...files].filter((file) => /^audio\//.test(file.type) || AUDIO.test(file.name))
    // 50 at a time for everyone else; the owner drops a whole collection.
    const list = quota?.limit === null ? audio : audio.slice(0, 50)
    if (!list.length) return setNotice({ kind: 'error', text: t('music.noAudio') })
    setUploads(list.map((file) => ({ name: file.name, size: file.size, progress: 0, state: 'waiting' })))
    for (const [index, file] of list.entries()) {
      const update = (patch) => setUploads((current) => current.map((entry, other) => (other === index ? { ...entry, ...patch } : entry)))
      update({ state: 'uploading' })
      try {
        await music.uploadTrack(file, (progress) => update({ progress }))
        update({ state: 'done', progress: 1 })
      } catch (failure) {
        update({ state: 'error', error: failure.message })
      }
    }
  }

  return (
    <div className="music-add">
      <Card icon="upload" title={t('music.upload')} text={t('music.uploadText')}>
        <button
          type="button"
          className={`music-drop${over ? ' is-over' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            event.preventDefault()
            setOver(false)
            upload(event.dataTransfer.files)
          }}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            cloud_upload
          </span>
          <strong>{t('music.dropFiles')}</strong>
          <small>{quota?.fileLimit === null ? t('music.formatsOwner') : t('music.formats')}</small>
        </button>
        <input ref={fileRef} type="file" accept="audio/*,.flac,.opus,.m4a" multiple hidden onChange={(event) => upload(event.target.files)} />
        {quota && (
          <div className="music-quota">
            <span className="music-quota__bar" style={{ '--used': `${quota.limit ? Math.min(100, (quota.used / quota.limit) * 100) : 0}%` }} aria-hidden="true" />
            <small>{quota.limit === null ? t('music.quotaOwner', { used: mb(quota.used) }) : t('music.quota', { used: mb(quota.used), limit: mb(quota.limit), left: mb(Math.max(0, quota.limit - quota.used)) })}</small>
          </div>
        )}
        {uploads.length > 0 && (
          <ul className="music-uploads">
            {uploads.map((entry, index) => (
              <li key={`${entry.name}:${index}`} className={`is-${entry.state}`}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  {entry.state === 'done' ? 'check_circle' : entry.state === 'error' ? 'error' : entry.state === 'uploading' ? 'upload' : 'schedule'}
                </span>
                <span className="music-uploads__name">{entry.name}</span>
                <small>{entry.error ?? `${mb(entry.size)} MB`}</small>
                {entry.state === 'uploading' && <span className="music-uploads__bar" style={{ '--progress': `${Math.round(entry.progress * 100)}%` }} />}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card icon="link" title={t('music.link')} text={t('music.linkText')}>
        <form
          className="music-add__form"
          onSubmit={(event) => {
            event.preventDefault()
            if (!link.trim()) return
            act(async () => {
              const track = await music.addLink(link.trim())
              setLink('')
              return t('music.added', { title: track.title })
            })
          }}
        >
          <input value={link} onChange={(event) => setLink(event.target.value)} placeholder={t('music.linkPlaceholder')} aria-label={t('music.link')} inputMode="url" />
          <button type="submit" className="dash-button dash-button--small" disabled={!link.trim()}>
            {t('settings.add')}
          </button>
        </form>
      </Card>

      <Card icon="folder" title={t('music.folder')} text={t('music.folderText')}>
        {folders.length === 0 ? (
          <p className="dash-hint">{t('music.noFolders')}</p>
        ) : (
          <form
            className="music-add__form"
            onSubmit={(event) => {
              event.preventDefault()
              act(async () => {
                const result = await music.addFolder(folder.integration || folders[0].id, folder.path || '/')
                return [t('music.folderAdded', { added: result.added, skipped: result.skipped }), result.full ? t('music.libraryFull', { limit: quota?.songs }) : result.more ? t('music.folderMore') : ''].filter(Boolean).join(' ')
              })
            }}
          >
            <select value={folder.integration || folders[0].id} onChange={(event) => setFolder({ ...folder, integration: event.target.value })} aria-label={t('music.folderFrom')}>
              {folders.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <input value={folder.path} onChange={(event) => setFolder({ ...folder, path: event.target.value })} placeholder="/Music/" aria-label={t('music.path')} />
            <button type="submit" className="dash-button dash-button--small">
              {t('settings.add')}
            </button>
          </form>
        )}
      </Card>

      <Card icon="album" title="Navidrome / OpenSubsonic" text={t('music.navidromeText')}>
        {subsonics.length === 0 ? (
          <p className="dash-hint">{t('music.noNavidrome')}</p>
        ) : (
          <>
            <form
              className="music-add__form"
              onSubmit={(event) => {
                event.preventDefault()
                setNavidrome((current) => ({ ...current, loading: true }))
                act(async () => {
                  const albums = await music.navidromeAlbums(navidrome.integration || subsonics[0].id, navidrome.q.trim())
                  setNavidrome((current) => ({ ...current, albums, loading: false }))
                }).finally(() => setNavidrome((current) => ({ ...current, loading: false })))
              }}
            >
              {subsonics.length > 1 && (
                <select value={navidrome.integration || subsonics[0].id} onChange={(event) => setNavidrome({ ...navidrome, integration: event.target.value, albums: null })} aria-label="Navidrome">
                  {subsonics.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              )}
              <input value={navidrome.q} onChange={(event) => setNavidrome({ ...navidrome, q: event.target.value })} placeholder={t('music.albumSearch')} aria-label={t('music.albumSearch')} />
              <button type="submit" className="dash-button dash-button--small" disabled={navidrome.loading}>
                {navidrome.q.trim() ? t('music.findAlbums') : t('music.newestAlbums')}
              </button>
              <button
                type="button"
                className="dash-button dash-button--quiet dash-button--small"
                disabled={addingAll}
                onClick={() => {
                  setAddingAll(true)
                  act(async () => {
                    const result = await music.addNavidrome(navidrome.integration || subsonics[0].id, { all: true })
                    return [t('music.songsAdded', { count: result.added }), result.full ? t('music.libraryFull', { limit: result.limit }) : ''].filter(Boolean).join(' ')
                  }).finally(() => setAddingAll(false))
                }}
              >
                <span className={`material-symbols-outlined${addingAll ? ' is-spinning' : ''}`} aria-hidden="true">
                  {addingAll ? 'progress_activity' : 'library_add'}
                </span>
                {addingAll ? t('music.addingAll') : t('music.addAll')}
              </button>
            </form>
            {navidrome.albums && (
              <ul className="music-albums">
                {navidrome.albums.length === 0 && <li className="dash-hint">{t('music.noMatch')}</li>}
                {navidrome.albums.map((album) => (
                  <li key={album.id}>
                    <span className="music-songs__text">
                      <strong>{album.name}</strong>
                      <small>{[album.artist, album.year, album.songs ? t('music.tracks', { count: album.songs }) : null].filter(Boolean).join(' · ')}</small>
                    </span>
                    <button
                      type="button"
                      className="dash-button dash-button--quiet dash-button--small"
                      onClick={() =>
                        act(async () => {
                          const result = await music.addNavidrome(navidrome.integration || subsonics[0].id, { album: album.id })
                          return t('music.songsAdded', { count: result.added })
                        })
                      }
                    >
                      {t('settings.add')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>

      {notice.text && (
        <p className={notice.kind === 'error' ? 'dash-error' : 'music-add__ok'} role="status">
          {notice.text}
        </p>
      )}
    </div>
  )
}
