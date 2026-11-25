import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { accountFetch } from '../../lib/account.js'
import { absolute, uploadFile } from '../../lib/dashBackgrounds.js'
import { integrationGet, integrationImage } from '../../lib/dashIntegrations.js'
import { Empty, LoadError, Loading, useRemote } from './kit.jsx'
import { useWidgetIntegrations } from './widgetsIntegrations.jsx'

/*
 * The slideshow widget: pictures from your uploads (Settings → Dash files,
 * kind "image"), an Immich album (through the integration, the key stays on
 * the server) or links. One picture at a time, crossfaded / slid / slowly
 * zoomed; the next is loaded before it's shown. Pauses while the pointer is
 * on it and while the tab is hidden; arrows, dots, swipe and the arrow keys.
 */

const loadPictures = async () => {
  const response = await accountFetch('/files?kind=image')
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
  return (data.files ?? []).map(absolute)
}

/* The slides of a widget: { status, slides: [{ key, src, caption, link }], error, reload }. */
function useSlides(widget) {
  const { source = 'uploads', pictures = [], album = '', order = 'inorder', links = [] } = widget.options
  const immich = useWidgetIntegrations(widget, 'photos')
  const item = source === 'immich' ? immich.picked[0] : null
  const uploads = useRemote('slideshow:pictures', loadPictures, { refresh: 15 * 60, private: true, enabled: source === 'uploads' })
  const albumData = useRemote(`int:${item?.id}:album:${album}:${order}`, (signal) => integrationGet(item.id, 'photos', { album, sort: order === 'random' ? 'random' : 'album', size: 300 }, signal), { refresh: 30 * 60, private: true, enabled: Boolean(item && album) })
  const slides = useMemo(() => {
    let list = []
    if (source === 'uploads') {
      const files = uploads.data ?? []
      const chosen = Array.isArray(pictures) && pictures.length ? pictures.map((id) => files.find((file) => file.id === id)).filter(Boolean) : files
      list = chosen.map((file) => ({ key: file.id, src: file.url, caption: file.name }))
    } else if (source === 'immich') {
      list = (albumData.data ?? []).map((photo) => ({ key: photo.id, src: integrationImage(item.id, photo.id, 1440), caption: photo.title, link: photo.link }))
    } else {
      list = (Array.isArray(links) ? links : []).filter((row) => /^https?:\/\//i.test(row.url ?? '')).map((row, index) => ({ key: `${index}:${row.url}`, src: row.url, caption: row.caption ?? '' }))
    }
    // Shuffled once per load (Immich albums come shuffled from the server).
    if (order === 'random' && source !== 'immich') list = list.map((slide) => [Math.random(), slide]).sort((a, b) => a[0] - b[0]).map(([, slide]) => slide)
    return list
    // Shuffle again only when the pictures change.
  }, [source, uploads.data, albumData.data, JSON.stringify(pictures), JSON.stringify(links), order, item?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (source === 'immich') {
    if (immich.empty) return { status: 'empty', element: immich.empty, slides }
    if (!album) return { status: 'setup', slides }
    return { status: albumData.data ? 'done' : albumData.error ? 'error' : 'loading', error: albumData.error, reload: albumData.reload, slides }
  }
  if (source === 'uploads') return { status: uploads.data ? 'done' : uploads.error ? 'error' : 'loading', error: uploads.error, reload: uploads.reload, slides }
  return { status: 'done', slides }
}

function SlideshowView({ widget }) {
  const { t } = useTranslation('dash')
  const { interval = 8, transition = 'fade', fit = 'cover', captions = false, controls = true } = widget.options
  const { status, element, error, reload, slides } = useSlides(widget)
  const [index, setIndex] = useState(0)
  const [previous, setPrevious] = useState(null)
  const [paused, setPaused] = useState(false)
  const [direction, setDirection] = useState(1)
  const swipe = useRef(null)
  const count = slides.length
  const current = count ? slides[index % count] : null

  const go = (next, by = 1) => {
    if (count < 2) return
    setPrevious(current)
    setDirection(by)
    setIndex(((next % count) + count) % count)
  }
  // On by itself, every `interval` seconds while visible and not hovered.
  useEffect(() => {
    if (count < 2 || paused) return undefined
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') go(index + 1)
    }, Math.max(2, Number(interval) || 8) * 1000)
    return () => clearInterval(timer)
  }) // eslint-disable-line react-hooks/exhaustive-deps
  // The next picture is fetched before it's due.
  useEffect(() => {
    if (count < 2) return
    const next = new Image()
    next.decoding = 'async'
    next.src = slides[(index + 1) % count].src
  }, [index, count, slides])
  useEffect(() => {
    if (index >= count && count) setIndex(0)
  }, [count, index])

  if (status === 'empty') return element
  if (status === 'setup') return <Empty icon="photo_album" setup>{t('widgets.slideshow.pickAlbum')}</Empty>
  if (status === 'loading') return <Loading lines={3} />
  if (status === 'error') return <LoadError error={error} onRetry={reload} />
  if (!count) return <Empty icon="slideshow" setup>{t(`widgets.slideshow.empty.${widget.options.source ?? 'uploads'}`)}</Empty>

  const picture = (slide, className) => (
    <img key={`${slide.key}-${className}`} className={`dash-slides__img ${className}`} src={slide.src} alt={slide.caption || ''} decoding="async" draggable={false} style={{ objectFit: fit === 'contain' ? 'contain' : 'cover', '--slide-ms': `${Math.max(2, Number(interval) || 8) * 1000 + 1500}ms` }} />
  )
  return (
    <div
      className={`dash-slides dash-slides--${transition}${direction < 0 ? ' is-back' : ''}`}
      tabIndex={0}
      role="region"
      aria-roledescription={t('widgets.slideshow.name')}
      aria-label={current?.caption || t('widgets.slideshow.name')}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') go(index + 1)
        if (event.key === 'ArrowLeft') go(index - 1, -1)
      }}
      onPointerDown={(event) => (swipe.current = event.pointerType === 'touch' ? event.clientX : null)}
      onPointerUp={(event) => {
        if (swipe.current === null) return
        const moved = event.clientX - swipe.current
        swipe.current = null
        if (Math.abs(moved) > 40) go(index + (moved < 0 ? 1 : -1), moved < 0 ? 1 : -1)
      }}
    >
      {previous && previous.key !== current.key && picture(previous, 'is-out')}
      {current.link ? (
        <a href={current.link} target="_blank" rel="noopener noreferrer" className="dash-slides__link" tabIndex={-1}>
          {picture(current, 'is-in')}
        </a>
      ) : (
        picture(current, 'is-in')
      )}
      {captions && current.caption && <p className="dash-slides__caption">{current.caption}</p>}
      {controls && count > 1 && (
        <>
          <button type="button" className="dash-slides__nav dash-slides__nav--prev" onClick={() => go(index - 1, -1)} aria-label={t('widgets.slideshow.previous')}>
            <span className="material-symbols-outlined">chevron_left</span>
          </button>
          <button type="button" className="dash-slides__nav dash-slides__nav--next" onClick={() => go(index + 1)} aria-label={t('widgets.slideshow.next')}>
            <span className="material-symbols-outlined">chevron_right</span>
          </button>
          {count <= 24 && (
            <div className="dash-slides__dots" role="tablist">
              {slides.map((slide, position) => (
                <button key={slide.key} type="button" role="tab" aria-selected={position === index} aria-label={t('widgets.slideshow.goTo', { n: position + 1 })} onClick={() => go(position, position < index ? -1 : 1)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* Editor: which of your pictures (none ticked = all), and uploading more. */
function PicturesEditor({ value, setOption }) {
  const { t } = useTranslation('dash')
  const chosen = Array.isArray(value) ? value : []
  const { data, error, reload } = useRemote('slideshow:pictures', loadPictures, { refresh: 15 * 60, private: true })
  const [progress, setProgress] = useState(null)
  const [problem, setProblem] = useState(null)
  const input = useRef(null)
  const toggle = (id) => setOption(chosen.includes(id) ? chosen.filter((entry) => entry !== id) : [...chosen, id])
  const upload = async (files) => {
    setProblem(null)
    const added = []
    for (const [position, file] of [...files].slice(0, 30).entries()) {
      try {
        const result = await uploadFile(file, 'image', { onProgress: (part) => setProgress((position + part) / files.length) })
        added.push(result.file.id)
      } catch (reason) {
        setProblem(reason.message)
        break
      }
    }
    setProgress(null)
    // New pictures join the chosen ones when some were chosen (with none chosen, all show anyway).
    if (added.length && chosen.length) setOption([...chosen, ...added])
    reload()
  }
  return (
    <div className="dash-slides-pick">
      {!data && !error && <Loading lines={2} />}
      {error && <LoadError error={error} onRetry={reload} compact />}
      {data && (
        <ul>
          {data.map((file) => (
            <li key={file.id}>
              <button type="button" aria-pressed={chosen.includes(file.id)} onClick={() => toggle(file.id)} title={file.name}>
                <img src={file.url} alt="" loading="lazy" decoding="async" />
                {chosen.includes(file.id) && <span className="material-symbols-outlined" aria-hidden="true">check_circle</span>}
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="dash-slides-pick__add" onClick={() => input.current?.click()} disabled={progress !== null} aria-label={t('widgets.slideshow.upload')} title={t('widgets.slideshow.upload')}>
              {progress === null ? <span className="material-symbols-outlined">add_photo_alternate</span> : <span>{Math.round(progress * 100)}%</span>}
            </button>
          </li>
        </ul>
      )}
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(event) => (upload(event.target.files), (event.target.value = ''))} />
      <span className="dash-hint">{chosen.length ? t('widgets.slideshow.chosen', { count: chosen.length }) : t('widgets.slideshow.allPictures')}</span>
      {problem && <p className="dash-error">{problem}</p>}
    </div>
  )
}

/* Editor: an album of the chosen Immich integration. */
function AlbumEditor({ value, options, setOption }) {
  const { t } = useTranslation('dash')
  const integration = options.integration
  const { data, error, reload } = useRemote(`int:${integration}:albums`, (signal) => integrationGet(integration, 'albums', {}, signal), { refresh: 10 * 60, private: true, enabled: Boolean(integration) })
  if (!integration) return <span className="dash-hint">{t('widgets.slideshow.pickIntegration')}</span>
  if (error) return <LoadError error={error} onRetry={reload} compact />
  if (!data) return <Loading lines={1} />
  return (
    <select value={value ?? ''} onChange={(event) => setOption(event.target.value)}>
      <option value="">{t('widgets.slideshow.chooseAlbum')}</option>
      {data.map((album) => (
        <option key={album.id} value={album.id}>
          {album.name || '–'} ({album.count ?? 0})
        </option>
      ))}
    </select>
  )
}

export const SLIDESHOW_VIEWS = { SlideshowView }
export { PicturesEditor, AlbumEditor }
