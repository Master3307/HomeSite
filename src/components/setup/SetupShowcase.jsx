import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SETUP, SOFTWARE } from '../../data/links.js'
import { ACCOUNT_API_URL } from '../../lib/account'
import cachyLogoUrl from './cachyos.svg'
import '../../styles/setup.css'

/*
 * "My setup" on /card, in 3D: first the whole desk (screens, keyboard,
 * mouse, microphone, the PC beside it), then every part on its own. Drag to
 * turn, right-drag / two fingers to move, pinch or Ctrl + scroll to zoom.
 * Parts open with a click, or with the dots that follow them (big enough
 * for fingers); "Details" lists their specs; "Cables" shows the wiring. The
 * software tab is Plasma's own "About this System". three.js loads only
 * when the section comes near; without WebGL it is a plain list.
 */

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('motion-reduce') || document.documentElement.classList.contains('motion-none')

/* The Info Center's pages; the sidebar switches between them. */
const INFO_CENTER = ['about', 'energy', 'devices', 'graphics', 'network']

/* Rows like Plasma's: the label right-aligned, the value next to it. */
function InfoRows({ heading, rows }) {
  return (
    <dl className="setup-about__group">
      {heading && <dt className="setup-about__heading">{heading}</dt>}
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}:</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/* "About this System" (kinfo) as the system shows it. */
function AboutPage() {
  const { t, i18n } = useTranslation('card')
  const [serial, setSerial] = useState(false)
  const usable = SOFTWARE.memory.usable.toLocaleString(i18n.language)
  return (
    <>
      <div className="setup-about__head">
        <img src={cachyLogoUrl} alt="" width="84" height="84" />
        <div>
          <p>{SOFTWARE.os}</p>
          <a href="https://cachyos.org/" target="_blank" rel="noopener noreferrer">
            https://cachyos.org/
          </a>
        </div>
      </div>
      <InfoRows
        heading={t('setup.about.software')}
        rows={[
          [t('setup.about.plasma'), SOFTWARE.plasma],
          [t('setup.about.frameworks'), SOFTWARE.frameworks],
          [t('setup.about.qt'), SOFTWARE.qt],
          [t('setup.about.kernel'), t('setup.about.kernelValue', { kernel: SOFTWARE.kernel })],
          [t('setup.about.platform'), SOFTWARE.platform],
        ]}
      />
      <InfoRows
        heading={t('setup.about.hardware')}
        rows={[
          [t('setup.about.processors'), SOFTWARE.processors],
          [
            t('setup.about.memory'),
            <span key="memory">
              {t('setup.about.memoryValue', { total: SOFTWARE.memory.total, usable })}
              <button type="button" className="setup-about__help" aria-describedby="setup-memory-help">
                ?
                <span id="setup-memory-help" role="tooltip" className="setup-about__tooltip">
                  {t('setup.about.memoryHelp')}
                </span>
              </button>
            </span>,
          ],
          [
            t('setup.about.gpu'),
            <span key="graphics">
              {SOFTWARE.graphics} <span className="setup-about__pill">{t('setup.about.discrete')}</span>
            </span>,
          ],
          [t('setup.about.manufacturer'), SOFTWARE.manufacturer],
          [t('setup.about.product'), SOFTWARE.product],
          [t('setup.about.systemVersion'), SOFTWARE.version],
          [
            t('setup.about.serial'),
            serial ? (
              <span key="serial" className="setup-about__muted">
                {t('setup.about.serialHidden')}
              </span>
            ) : (
              <button key="serial" type="button" className="setup-about__show" onClick={() => setSerial(true)}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  visibility
                </span>
                {t('setup.about.show')}
              </button>
            ),
          ],
        ]}
      />
    </>
  )
}

/* Energy: what Plasma shows on a desktop, and one quiet line. */
function EnergyPage() {
  const { t } = useTranslation('card')
  const e = (key) => t(`setup.about.energy.${key}`)
  return (
    <>
      <p className="setup-about__page-title">{e('title')}</p>
      <InfoRows rows={['power', 'battery', 'profile'].map((key) => [e(key), e(`${key}Value`)])} />
      <p className="setup-about__muted setup-about__note">{e('note')}</p>
    </>
  )
}

/* Devices: what is plugged in. */
function DevicesPage() {
  const { t } = useTranslation('card')
  const d = (key) => t(`setup.about.devices.${key}`)
  return (
    <>
      <p className="setup-about__page-title">{d('title')}</p>
      <InfoRows rows={['keyboard', 'mouse', 'mic', 'displays'].map((key) => [d(key), d(`${key}Value`)])} />
    </>
  )
}

/* The visitor's own GPU, as their browser names it to WebGL. */
function webglRenderer() {
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    if (!gl) return null
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return typeof name === 'string' && name ? name.slice(0, 120) : null
  } catch {
    return null
  }
}

/* Graphics: the PC's GPU, then the visitor's, and a live count of the frames this page drew. */
function GraphicsPage({ frames }) {
  const { t, i18n } = useTranslation('card')
  const g = (key) => t(`setup.about.graphics.${key}`)
  const [renderer] = useState(webglRenderer)
  const [count, setCount] = useState(() => frames?.() ?? 0)
  useEffect(() => {
    const timer = setInterval(() => setCount(frames?.() ?? 0), 500)
    return () => clearInterval(timer)
  }, [frames])
  return (
    <>
      <p className="setup-about__page-title">{g('title')}</p>
      <InfoRows
        heading={g('opengl')}
        rows={[
          [g('vendor'), 'NVIDIA Corporation'],
          [g('renderer'), `${SOFTWARE.graphics}/PCIe/SSE2`],
        ]}
      />
      <InfoRows
        heading={g('thisPage')}
        rows={[
          [g('webgl'), renderer ?? g('webglUnknown')],
          [g('frames'), count.toLocaleString(i18n.language)],
        ]}
      />
    </>
  )
}

/*
 * Network: looks like the PC's own connection, but the address and place
 * are the visitor's (server/services/setupWeb.cjs echoes what Cloudflare
 * knows about their request; nothing is stored).
 */
function NetworkPage() {
  const { t, i18n } = useTranslation('card')
  const n = (key) => t(`setup.about.network.${key}`)
  const [info, setInfo] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let alive = true
    fetch(`${ACCOUNT_API_URL}/setup/network`, { credentials: 'omit' })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)
      .then((data) => alive && setInfo(data ?? {}))
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  const zone = info?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  let country = info?.country ?? null
  try {
    if (country && /^[A-Z]{2}$/.test(country)) country = new Intl.DisplayNames([i18n.language], { type: 'region' }).of(country)
  } catch {
    // Unknown code: keep it.
  }
  const place = [info?.city, info?.region, country].filter(Boolean).filter((value, index, list) => list.indexOf(value) === index).join(', ')
  let time = ''
  try {
    time = new Date(now).toLocaleTimeString(i18n.language, { timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    time = new Date(now).toLocaleTimeString(i18n.language)
  }
  const address = info ? (info.ip ?? n('unknown')) : n('loading')
  return (
    <>
      <p className="setup-about__page-title">{n('title')}</p>
      <table className="setup-about__table">
        <thead>
          <tr>
            <th>{n('name')}</th>
            <th>{n('address')}</th>
            <th>{n('type')}</th>
            <th>{n('state')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>enp5s0</td>
            <td className="setup-about__mono">{address}</td>
            <td>{n('ethernet')}</td>
            <td>{n('up')}</td>
          </tr>
          <tr>
            <td>wlp6s0</td>
            <td>–</td>
            <td>{n('wireless')}</td>
            <td>{n('down')}</td>
          </tr>
          <tr>
            <td>lo</td>
            <td className="setup-about__mono">127.0.0.1</td>
            <td>{n('loopback')}</td>
            <td>{n('up')}</td>
          </tr>
        </tbody>
      </table>
      <InfoRows
        heading={n('connection')}
        rows={[
          [n('public'), <span key="ip" className="setup-about__mono">{address}</span>],
          [n('location'), info ? place || n('unknown') : n('loading')],
          [n('timezone'), zone],
          [n('localTime'), time],
          [n('language'), navigator.language || n('unknown')],
        ]}
      />
      <p className="setup-about__muted setup-about__note">{n('note')}</p>
    </>
  )
}

/* Plasma 6's Info Center (Darkly), its pages clickable in the sidebar. */
function AboutSystem({ frames }) {
  const { t } = useTranslation('card')
  const [page, setPage] = useState('about')
  return (
    <div className="setup-about" role="group" aria-label={t('setup.about.title')}>
      <div className="setup-about__bar">
        <span className="setup-about__app" aria-hidden="true" />
        <span className="setup-about__title">
          {t(`setup.about.side.${page}`)} — {t('setup.about.infoCenter')}
        </span>
        <span className="setup-about__buttons" aria-hidden="true">
          <i />
          <i />
          <i className="is-close" />
        </span>
      </div>
      <div className="setup-about__window">
        <div className="setup-about__side" role="tablist" aria-label={t('setup.about.infoCenter')}>
          {INFO_CENTER.map((entry) => (
            <button key={entry} type="button" role="tab" aria-selected={entry === page} className={entry === page ? 'is-active' : ''} onClick={() => setPage(entry)}>
              {t(`setup.about.side.${entry}`)}
            </button>
          ))}
        </div>
        <div className="setup-about__body" role="tabpanel">
          {page === 'about' && <AboutPage />}
          {page === 'energy' && <EnergyPage />}
          {page === 'devices' && <DevicesPage />}
          {page === 'graphics' && <GraphicsPage frames={frames} />}
          {page === 'network' && <NetworkPage />}
        </div>
      </div>
    </div>
  )
}

/* What is inside the PC (the PC on its own focuses these too). */
const PC_PARTS = new Set(['cpu', 'gpu', 'ram', 'board'])

export default function SetupShowcase() {
  const { t } = useTranslation('card')
  const sectionRef = useRef(null)
  const canvasRef = useRef(null)
  const viewerRef = useRef(null)
  // `selected`: the part in the panel (and in focus); `view`: the model on the stage (the whole setup, or one part on its own).
  const [selected, setSelected] = useState('setup')
  const [view, setView] = useState('setup')
  const [state, setState] = useState('waiting') // waiting | loading | ready | failed
  const [zoom, setZoom] = useState(1)
  const [cables, setCables] = useState(false)
  // The part under the mouse: { id, x, y } on the canvas.
  const [hover, setHover] = useState(null)
  const part = SETUP.find((entry) => entry.id === selected)
  const name = (entry) => (entry.nameKey ? t(entry.nameKey) : entry.name)
  const viewRef = useRef(view)
  useEffect(() => {
    viewRef.current = view
  }, [view])

  // A part from the list or the scene: focus it in the whole setup (or in the PC on its own).
  const select = useCallback((id) => {
    if (!SETUP.some((entry) => entry.id === id)) return
    setSelected(id)
    setHover(null)
    const current = viewRef.current
    if (id !== 'software' && current !== 'setup' && !(current === 'pc' && PC_PARTS.has(id))) setView('setup')
  }, [])

  // Load three.js once the section is close to the screen.
  useEffect(() => {
    const section = sectionRef.current
    if (!section) return undefined
    let cancelled = false
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || viewerRef.current || cancelled) return
        observer.disconnect()
        setState('loading')
        import('./scene.js')
          .then(({ createViewer }) => {
            if (cancelled || !canvasRef.current) return
            viewerRef.current = createViewer(canvasRef.current, {
              reducedMotion: prefersReducedMotion(),
              // What fastfetch prints on the left screen.
              info: [
                ['OS', 'CachyOS x86_64'],
                ['Kernel', `Linux ${SOFTWARE.kernel}`],
                ['DE', `${SOFTWARE.desktop} ${SOFTWARE.plasma}`],
                ['WM', SOFTWARE.wm],
                ['Theme', `${SOFTWARE.theme} (${SOFTWARE.colors})`],
                ['Icons', SOFTWARE.icons],
                ['Font', SOFTWARE.font],
                ['CPU', 'AMD Ryzen 5 5600X (12) @ 4.65 GHz'],
                ['GPU', `${SOFTWARE.graphics} [Discrete]`],
                ['Memory', '11.42 GiB / 31.26 GiB (37%)'],
              ],
              onReady: () => setState('ready'),
              onZoom: (value) => setZoom(value),
              onPick: (id) => select(id),
              onHover: (value) => setHover(value),
            })
            viewerRef.current.show(viewRef.current)
          })
          .catch(() => setState('failed'))
      },
      { rootMargin: '300px' },
    )
    observer.observe(section)
    return () => {
      cancelled = true
      observer.disconnect()
      viewerRef.current?.dispose()
      viewerRef.current = null
    }
  }, [select])

  // The model on the stage.
  useEffect(() => {
    if (state === 'ready' || state === 'loading') viewerRef.current?.show(view)
  }, [view, state])

  // Focus the picked part (the whole thing for the overview or the model itself).
  useEffect(() => {
    if (state !== 'ready' || selected === 'software' || !(view === 'setup' || view === 'pc')) return
    viewerRef.current?.focus(selected === 'setup' || selected === view ? null : selected)
  }, [selected, view, state])

  useEffect(() => {
    viewerRef.current?.setOption('cables', cables)
  }, [cables, state])

  // WebGL missing or broken: the plain list.
  if (state === 'failed') {
    return (
      <section className="me-block" aria-labelledby="me-setup">
        <h3 id="me-setup">{t('setup.title')}</h3>
        <dl className="me-specs">
          {SETUP.filter((entry) => entry.id !== 'setup').map((entry) => (
            <div key={entry.id}>
              <dt>{t(`setup.${entry.id}`)}</dt>
              <dd>{name(entry)}</dd>
            </div>
          ))}
        </dl>
      </section>
    )
  }

  const zoomed = Math.abs(zoom - 1) > 0.04
  const specs = t(`setup.specs.${part.id}`, { returnObjects: true, defaultValue: null })
  const software = selected === 'software'
  const alone = view !== 'setup'
  const canStandAlone = part.model && part.id !== 'setup' && !alone

  return (
    <section ref={sectionRef} className="me-block setup" aria-labelledby="me-setup">
      <h3 id="me-setup">
        <span className="me-glyph" aria-hidden="true">
          {''}
        </span>
        {t('setup.title')}
      </h3>

      <div className="setup__layout">
        <div className={`setup__stage${software ? ' is-software' : ''}`}>
          <canvas ref={canvasRef} className={`setup__canvas${state === 'ready' ? ' is-ready' : ''}`} aria-label={t('setup.canvasLabel', { name: name(part) })} role="img" />
          {software && <AboutSystem frames={() => viewerRef.current?.frames?.() ?? 0} />}
          {hover && !software && (
            <span className="setup__tip" style={{ left: hover.x, top: hover.y }} aria-hidden="true">
              {name(SETUP.find((entry) => entry.id === hover.id) ?? part)}
            </span>
          )}
          {!software && state !== 'ready' && <p className="setup__status">{t('setup.loading')}</p>}
          {!software && state === 'ready' && (
            <>
              <p className="setup__hint" aria-hidden="true">
                <span className="setup__hint-mouse">{t('setup.drag')}</span>
                <span className="setup__hint-touch">{t('setup.dragTouch')}</span>
              </p>
              <div className="setup__zoom">
                {(view === 'setup' || view === 'pc') && (
                  <button type="button" className={cables ? 'is-on' : ''} onClick={() => setCables((value) => !value)} title={t('setup.cablesOn')} aria-label={t('setup.cablesOn')} aria-pressed={cables}>
                    <span className="material-symbols-outlined" aria-hidden="true">
                      cable
                    </span>
                  </button>
                )}
                {(zoomed || (selected !== 'setup' && !alone)) && (
                  <button type="button" onClick={() => viewerRef.current?.reset()} title={t('setup.reset')} aria-label={t('setup.reset')}>
                    <span className="material-symbols-outlined" aria-hidden="true">
                      restart_alt
                    </span>
                  </button>
                )}
                <button type="button" onClick={() => viewerRef.current?.zoom(1 / 1.25)} title={t('setup.zoomOut')} aria-label={t('setup.zoomOut')}>
                  <span className="material-symbols-outlined" aria-hidden="true">
                    zoom_out
                  </span>
                </button>
                <button type="button" onClick={() => viewerRef.current?.zoom(1.25)} title={t('setup.zoomIn')} aria-label={t('setup.zoomIn')}>
                  <span className="material-symbols-outlined" aria-hidden="true">
                    zoom_in
                  </span>
                </button>
              </div>
            </>
          )}
        </div>

        <aside className="setup__panel">
          <div className="setup__parts" role="tablist" aria-label={t('setup.parts')}>
            {SETUP.map((entry) => (
              <button key={entry.id} type="button" role="tab" aria-selected={entry.id === selected} className={entry.id === selected ? 'is-active' : ''} onClick={() => select(entry.id)}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  {entry.icon}
                </span>
                {t(`setup.${entry.id}`)}
              </button>
            ))}
          </div>

          <div className="setup__info" aria-live="polite">
            <span className="setup__kind">{t(`setup.${part.id}`)}</span>
            <strong>{name(part)}</strong>
            {part.facts.length > 0 && <p className="setup__facts">{part.facts.map((key) => t(`setup.facts.${key}`)).join(' · ')}</p>}
            {specs && typeof specs === 'object' && (
              <dl className="setup__specs">
                {Object.entries(specs).map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {(canStandAlone || alone) && (
              <button type="button" className="setup__alone" onClick={() => setView(alone ? 'setup' : part.model)}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  {alone ? 'arrow_back' : 'open_in_full'}
                </span>
                {alone ? t('setup.backToDesk') : t('setup.onItsOwn')}
              </button>
            )}
          </div>
        </aside>
      </div>
    </section>
  )
}
