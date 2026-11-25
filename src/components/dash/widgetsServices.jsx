import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { integrationFileUrl, integrationGet, integrationImage, uploadToIntegration } from '../../lib/dashIntegrations.js'
import { Empty, LoadError, Loading, Num, compactNumber, timeAgo, useRemote } from './kit.jsx'
import { SoftImage } from './widgetsFeeds.jsx'
import { CollectedState, Several, together, useCollected, useWidgetIntegrations } from './widgetsIntegrations.jsx'

/*
 * Widgets for the newer integrations: files (WebDAV, Nextcloud, copyparty,
 * Paperless documents), photos (Immich), containers (Portainer), messages
 * (Gotify, ntfy), service stats (any integration with numbers) and
 * Syncthing. Every one takes several integrations at once.
 */

const bytes = (value, language) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return ''
  const unit = Math.min(4, Math.floor(Math.log(Math.max(1, number)) / Math.log(1024)))
  return `${(number / 1024 ** unit).toLocaleString(language, { maximumFractionDigits: unit ? 1 : 0 })} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`
}

const FILE_ICONS = [
  [/\.(png|jpe?g|gif|webp|avif|heic|svg|bmp)$/i, 'image'],
  [/\.(mp3|flac|ogg|opus|wav|m4a|aac)$/i, 'music_note'],
  [/\.(mp4|mkv|webm|mov|avi)$/i, 'movie'],
  [/\.(pdf)$/i, 'picture_as_pdf'],
  [/\.(zip|7z|rar|tar|gz|xz|zst)$/i, 'folder_zip'],
  [/\.(txt|md|log|csv|json|ya?ml|toml|ini)$/i, 'description'],
  [/\.(js|jsx|ts|py|rs|go|c|cpp|java|sh|html|css)$/i, 'code'],
]
const fileIcon = (item) => (item.dir ? 'folder' : item.type === 'document' ? 'article' : (FILE_ICONS.find(([pattern]) => pattern.test(item.name))?.[1] ?? 'draft'))

/* ---------- files ---------- */

function FilesView({ widget }) {
  const { picked, empty } = useWidgetIntegrations(widget, 'files', { multi: true })
  if (empty) return empty
  return <Several picked={picked} render={(item) => <FilesOne key={item.id} item={item} widget={widget} />} />
}

function FilesOne({ item, widget }) {
  const { t, i18n } = useTranslation('dash')
  const { sort = 'name', foldersFirst = true, count = 50, sizes = true, dates = true, quota = true, upload = true, browse = true } = widget.options
  const start = String(widget.options.path || '/').startsWith('/') ? String(widget.options.path || '/') : `/${widget.options.path}`
  const [path, setPath] = useState(start.endsWith('/') ? start : `${start}/`)
  const [state, setState] = useState(null) // { busy, error, done }
  const [over, setOver] = useState(false)
  const fileRef = useRef(null)
  const documents = item.kind === 'paperless'
  const { data, error, reload } = useRemote(`int:${item.id}:list:${documents ? '/' : path}`, (signal) => integrationGet(item.id, 'list', documents ? { size: count } : { path }, signal), { refresh: 5 * 60, private: true })

  async function send(files) {
    if (!files?.length || documents) return
    const list = [...files].slice(0, 20)
    setState({ busy: true, progress: 0, index: 0, total: list.length, name: list[0].name })
    try {
      for (const [index, file] of list.entries()) {
        setState({ busy: true, progress: 0, index, total: list.length, name: file.name })
        await uploadToIntegration(item.id, path, file, (progress) => setState((current) => (current?.busy ? { ...current, progress } : current)))
      }
      setState({ done: files.length })
      reload()
    } catch (problem) {
      setState({ error: problem.message })
    }
  }

  if (!data) return error ? <LoadError error={error} onRetry={reload} /> : <Loading lines={4} />
  const order = { name: (a, b) => a.name.localeCompare(b.name, i18n.language, { numeric: true }), modified: (a, b) => new Date(b.modified ?? 0) - new Date(a.modified ?? 0), size: (a, b) => (b.size ?? 0) - (a.size ?? 0) }
  const items = [...(data.items ?? [])].sort((a, b) => (foldersFirst && a.dir !== b.dir ? (a.dir ? -1 : 1) : (order[sort] ?? order.name)(a, b))).slice(0, Math.max(5, Math.min(200, Number(count) || 50)))
  const parts = path.split('/').filter(Boolean)
  const canUpload = upload && !documents

  return (
    <div
      className={`dash-w-files${over ? ' is-over' : ''}`}
      onDragOver={(event) => {
        if (!canUpload || !event.dataTransfer?.types?.includes('Files')) return
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        if (!canUpload) return
        event.preventDefault()
        setOver(false)
        send(event.dataTransfer.files)
      }}
    >
      {!documents && (
        <div className="dash-w-files__bar">
          <nav className="dash-w-files__crumbs" aria-label={t('widgets.files.where')}>
            <button type="button" className="dash-link-button" onClick={() => setPath('/')} disabled={!browse || path === '/'}>
              <span className="material-symbols-outlined" aria-hidden="true">
                home
              </span>
              <span className="sr-only">{t('widgets.files.top')}</span>
            </button>
            {parts.map((part, index) => (
              <span key={index}>
                /
                <button type="button" className="dash-link-button" disabled={!browse || index === parts.length - 1} onClick={() => setPath(`/${parts.slice(0, index + 1).join('/')}/`)}>
                  {part}
                </button>
              </span>
            ))}
          </nav>
          {canUpload && (
            <>
              <button type="button" className="dash-tool" onClick={() => fileRef.current?.click()} disabled={state?.busy} aria-label={t('widgets.files.upload')} title={t('widgets.files.upload')}>
                <span className="material-symbols-outlined">{state?.busy ? 'progress_activity' : 'upload'}</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                onChange={(event) => {
                  send(event.target.files)
                  event.target.value = ''
                }}
              />
            </>
          )}
          {data.web && (
            <a className="dash-tool" href={data.web} target="_blank" rel="noopener noreferrer" aria-label={t('widgets.files.openThere')} title={t('widgets.files.openThere')}>
              <span className="material-symbols-outlined">open_in_new</span>
            </a>
          )}
        </div>
      )}
      {quota && data.quota && (
        <p className="dash-w-files__quota">
          <span className="dash-meter__bar" aria-hidden="true">
            <span style={{ width: `${Math.min(100, (data.quota.used / (data.quota.used + (data.quota.free ?? 0) || 1)) * 100)}%` }} />
          </span>
          <small>{data.quota.free !== null ? t('widgets.files.quota', { used: bytes(data.quota.used, i18n.language), free: bytes(data.quota.free, i18n.language) }) : bytes(data.quota.used, i18n.language)}</small>
        </p>
      )}
      {state?.error && <p className="dash-error">{state.error}</p>}
      {state?.busy && (
        <div className="dash-w-files__progress" role="status">
          <span>
            {state.total > 1 ? `${state.index + 1}/${state.total} · ` : ''}
            {state.name}
          </span>
          <span className="dash-image__progress" style={{ '--progress': `${Math.round((state.progress ?? 0) * 100)}%` }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((state.progress ?? 0) * 100)} aria-label={t('widgets.files.uploading')} />
        </div>
      )}
      {state?.done && <p className="dash-hint dash-ok">{t('widgets.files.uploaded', { count: state.done })}</p>}
      {items.length ? (
        <ul className="dash-w-files__list">
          {browse && path !== '/' && !documents && (
            <li>
              <button type="button" onClick={() => setPath(`/${parts.slice(0, -1).join('/')}${parts.length > 1 ? '/' : ''}`)}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  arrow_upward
                </span>
                <span className="dash-w-files__name">..</span>
              </button>
            </li>
          )}
          {items.map((entry) => {
            const content = (
              <>
                <span className={`material-symbols-outlined${entry.dir ? ' is-dir' : ''}`} aria-hidden="true">
                  {fileIcon(entry)}
                </span>
                <span className="dash-w-files__name">{entry.name}</span>
                {sizes && !entry.dir && entry.size !== null && <small>{bytes(entry.size, i18n.language)}</small>}
                {dates && entry.modified && <small className="dash-w-files__date">{timeAgo(entry.modified, i18n.language)}</small>}
              </>
            )
            return (
              <li key={entry.path}>
                {entry.dir ? (
                  <button type="button" onClick={() => browse && setPath(entry.path)} disabled={!browse}>
                    {content}
                  </button>
                ) : (
                  <a href={entry.link ?? integrationFileUrl(item.id, entry.path)} {...(entry.link ? { target: '_blank', rel: 'noopener noreferrer' } : { download: entry.name })}>
                    {content}
                  </a>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="dash-muted">{t('widgets.files.emptyFolder')}</p>
      )}
      {canUpload && over && <p className="dash-w-files__drop">{t('widgets.files.drop')}</p>}
    </div>
  )
}

/* ---------- photos (Immich) ---------- */

function PhotosView({ widget }) {
  const { picked, empty } = useWidgetIntegrations(widget, 'photos', { multi: true })
  if (empty) return empty
  return <Several picked={picked} render={(item) => <PhotosOne key={item.id} item={item} widget={widget} />} />
}

function PhotosOne({ item, widget }) {
  const { t } = useTranslation('dash')
  const { sort = 'random', layout = 'single', interval = 12, refresh = 30 } = widget.options
  const size = layout === 'single' ? 12 : Math.max(2, Math.min(30, Number(widget.options.count) || 6))
  const { data, error, reload } = useRemote(`int:${item.id}:photos:${sort}:${size}`, (signal) => integrationGet(item.id, 'photos', { sort, size }, signal), { refresh: Math.max(1, Number(refresh) || 30) * 60, private: true })
  const [index, setIndex] = useState(0)
  useEffect(() => {
    if (layout !== 'single' || !data?.length) return undefined
    const timer = setInterval(() => document.visibilityState === 'visible' && setIndex((value) => (value + 1) % data.length), Math.max(4, Number(interval) || 12) * 1000)
    return () => clearInterval(timer)
  }, [layout, data, interval])
  if (!data) return error ? <LoadError error={error} onRetry={reload} /> : <Loading lines={3} />
  if (!data.length) return <Empty icon="photo_library">{t('widgets.photos.none')}</Empty>
  if (layout === 'single') {
    const photo = data[index % data.length]
    return (
      <a className="dash-w-photo" href={photo.link} target="_blank" rel="noopener noreferrer" title={photo.title}>
        <SoftImage key={photo.id} src={integrationImage(item.id, photo.id, 600)} />
      </a>
    )
  }
  return (
    <ul className="dash-w-photos">
      {data.map((photo) => (
        <li key={photo.id}>
          <a href={photo.link} target="_blank" rel="noopener noreferrer" title={photo.title}>
            <SoftImage src={integrationImage(item.id, photo.id, 300)} />
          </a>
        </li>
      ))}
    </ul>
  )
}

/* ---------- containers (Portainer) ---------- */

function ContainersView({ widget }) {
  const { picked, empty } = useWidgetIntegrations(widget, 'containers', { multi: true })
  if (empty) return empty
  if (together(widget, picked)) return <ContainersTogether picked={picked} widget={widget} />
  return <Several picked={picked} render={(item) => <ContainersOne key={item.id} item={item} widget={widget} />} />
}

/* Every host's containers in one list, each with its host. */
function ContainersTogether({ picked, widget }) {
  const filter = widget.options.filter ?? 'all'
  const collected = useCollected(picked, { key: (item) => `int:${item.id}:containers:${filter}`, load: (item, signal) => integrationGet(item.id, 'containers', { filter }, signal) })
  const data = collected.ready.flatMap((part) => part.data.map((container) => ({ ...container, id: `${part.item.id}:${container.id}`, from: part.item.name })))
  return (
    <>
      {collected.collectors}
      <CollectedState collected={collected}>
        <ContainersBody data={data} widget={widget} />
      </CollectedState>
    </>
  )
}

function ContainersOne({ item, widget }) {
  const { filter = 'all' } = widget.options
  const { data, error, reload } = useRemote(`int:${item.id}:containers:${filter}`, (signal) => integrationGet(item.id, 'containers', { filter }, signal), { refresh: 60, private: true })
  if (!data) return error ? <LoadError error={error} onRetry={reload} /> : <Loading lines={4} />
  return <ContainersBody data={data} widget={widget} />
}

function ContainersBody({ data, widget }) {
  const { t } = useTranslation('dash')
  const { image = false } = widget.options
  const running = data.filter((container) => container.state === 'running').length
  return (
    <div className="dash-w-status">
      <p className={`dash-w-status__sum${running === data.length ? ' is-ok' : ''}`}>
        <span className={`dash-dot dash-dot--${running === data.length ? 'up' : 'down'}`} aria-hidden="true" />
        {t('widgets.containers.running', { count: running, total: data.length })}
      </p>
      <ul>
        {[...data]
          .sort((a, b) => (a.state === 'running') - (b.state === 'running') || a.name.localeCompare(b.name))
          .map((container) => (
            <li key={container.id}>
              <span title={container.status}>
                <span className={`dash-dot dash-dot--${container.state === 'running' ? 'up' : container.state === 'paused' || container.state === 'restarting' ? 'slow' : 'down'}`} aria-hidden="true" />
                <span className="dash-w-status__name">
                  {container.name}
                  {image && <small className="dash-muted"> {container.image}</small>}
                  {container.from && <small className="dash-muted"> · {container.from}</small>}
                </span>
                <span className="dash-w-status__ms">{container.status}</span>
              </span>
            </li>
          ))}
      </ul>
    </div>
  )
}

/* ---------- messages (Gotify, ntfy) ---------- */

function MessagesView({ widget }) {
  const { picked, empty } = useWidgetIntegrations(widget, 'messages', { multi: true })
  if (empty) return empty
  if (together(widget, picked)) return <MessagesTogether picked={picked} widget={widget} />
  return <Several picked={picked} render={(item) => <MessagesOne key={item.id} item={item} widget={widget} />} />
}

/* Every server's messages in one stream, newest first. */
function MessagesTogether({ picked, widget }) {
  const size = Math.max(1, Math.min(50, Number(widget.options.count) || 10))
  const since = widget.options.since ?? '24h'
  const collected = useCollected(picked, { key: (item) => `int:${item.id}:messages:${size}:${since}`, load: (item, signal) => integrationGet(item.id, 'messages', { size, since }, signal) })
  const data = collected.ready
    .flatMap((part) => part.data.map((message) => ({ ...message, id: `${part.item.id}:${message.id}`, source: message.source || part.item.name })))
    .sort((a, b) => new Date(b.date ?? 0) - new Date(a.date ?? 0))
    .slice(0, size)
  return (
    <>
      {collected.collectors}
      <CollectedState collected={collected}>
        <MessagesBody data={data} />
      </CollectedState>
    </>
  )
}

function MessagesOne({ item, widget }) {
  const size = Math.max(1, Math.min(50, Number(widget.options.count) || 10))
  const since = widget.options.since ?? '24h'
  const { data, error, reload } = useRemote(`int:${item.id}:messages:${size}:${since}`, (signal) => integrationGet(item.id, 'messages', { size, since }, signal), { refresh: 60, private: true })
  if (!data) return error ? <LoadError error={error} onRetry={reload} /> : <Loading lines={3} />
  return <MessagesBody data={data} />
}

function MessagesBody({ data }) {
  const { t, i18n } = useTranslation('dash')
  if (!data.length) return <p className="dash-muted">{t('widgets.messages.none')}</p>
  return (
    <ul className="dash-w-msgs">
      {data.map((message) => (
        <li key={message.id} className={Number(message.priority) >= 4 ? 'is-high' : undefined}>
          {message.title && <strong>{message.title}</strong>}
          <span>{message.text}</span>
          <small>{[message.source, message.date && timeAgo(message.date, i18n.language)].filter(Boolean).join(' · ')}</small>
        </li>
      ))}
    </ul>
  )
}

/* ---------- service stats (any integration with numbers) ---------- */

function StatsView({ widget }) {
  const { picked, empty } = useWidgetIntegrations(widget, 'stats', { multi: true })
  if (empty) return empty
  return <Several picked={picked} render={(item) => <StatsOne key={item.id} item={item} />} />
}

function StatsOne({ item }) {
  const { t, i18n } = useTranslation('dash')
  const { data, error, reload } = useRemote(`int:${item.id}:stats`, (signal) => integrationGet(item.id, 'stats', {}, signal), { refresh: 10 * 60, private: true })
  if (!data) return error ? <LoadError error={error} onRetry={reload} /> : <Loading lines={2} />
  const cells = Object.entries(data).filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
  return (
    <ul className="dash-w-dns__cells">
      {cells.map(([key, value]) => (
        <li key={key}>
          <strong>
            <Num>{['download', 'upload', 'ping', 'hoursListened'].includes(key) ? value.toLocaleString(i18n.language) : compactNumber(value, i18n.language)}</Num>
          </strong>
          <small>{t(`widgets.stats.keys.${key}`, { defaultValue: key })}</small>
        </li>
      ))}
    </ul>
  )
}

/* ---------- Syncthing ---------- */

function SyncView({ widget }) {
  const { picked, empty } = useWidgetIntegrations(widget, 'sync', { multi: true })
  if (empty) return empty
  return <Several picked={picked} render={(item) => <SyncOne key={item.id} item={item} />} />
}

function SyncOne({ item }) {
  const { t, i18n } = useTranslation('dash')
  const { data, error, reload } = useRemote(`int:${item.id}:status`, (signal) => integrationGet(item.id, 'status', {}, signal), { refresh: 60, private: true })
  if (!data) return error ? <LoadError error={error} onRetry={reload} /> : <Loading lines={3} />
  return (
    <div className="dash-w-sys">
      <p className="dash-muted dash-w-sys__load">{t('widgets.sync.devices', { connected: data.devices.connected, total: data.devices.total })}</p>
      <ul className="dash-meters">
        {data.folders.map((folder) => (
          <li key={folder.id} className={`dash-meter${folder.state === 'error' ? ' is-high' : ''}`}>
            <span className="dash-meter__label">
              <span className="material-symbols-outlined" aria-hidden="true">
                {folder.paused ? 'pause_circle' : folder.state === 'idle' ? 'check_circle' : folder.state === 'error' ? 'error' : 'sync'}
              </span>
              {folder.label}
            </span>
            <span className="dash-meter__bar" aria-hidden="true">
              <span style={{ width: `${folder.percent}%` }} />
            </span>
            <strong title={folder.needBytes ? bytes(folder.needBytes, i18n.language) : undefined}>{t(`widgets.sync.states.${folder.paused ? 'paused' : folder.state}`, { defaultValue: folder.state })}</strong>
          </li>
        ))}
      </ul>
    </div>
  )
}

export const SERVICE_VIEWS = { FilesView, PhotosView, ContainersView, MessagesView, StatsView, SyncView }
