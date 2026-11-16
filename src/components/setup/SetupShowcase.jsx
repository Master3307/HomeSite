import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SETUP, SOFTWARE } from '../../data/links.js'
import cachyLogoUrl from './cachyos.svg'
import '../../styles/setup.css'

/*
 * "My setup" on /card: every part in 3D (drag to turn it, pinch or Ctrl +
 * scroll to zoom), one at a time, with a few facts. The screens show the
 * desktop as it is set up; the software tab is Plasma's own "About this
 * System" page in the Info Center (Darkly, MateriaDark colours). three.js
 * loads only when the section comes near the screen; without WebGL it is a
 * plain list.
 */

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('motion-reduce') || document.documentElement.classList.contains('motion-none')

/* The Info Center's sidebar (shown on wide stages). */
const INFO_CENTER = ['about', 'energy', 'devices', 'graphics', 'network']

/* Plasma 6 "About this System" (kinfo), in the Info Center, Darkly window. */
function AboutSystem() {
  const { t } = useTranslation('card')
  const rows = [
    [
      'software',
      [
        [t('setup.about.plasma'), SOFTWARE.plasma],
        [t('setup.about.frameworks'), SOFTWARE.frameworks],
        [t('setup.about.qt'), SOFTWARE.qt],
        [t('setup.about.kernel'), t('setup.about.kernelValue', { kernel: SOFTWARE.kernel })],
        [t('setup.about.platform'), SOFTWARE.platform],
      ],
    ],
    [
      'hardware',
      [
        [t('setup.about.processors'), SOFTWARE.processors],
        [t('setup.about.memory'), t('setup.about.memoryValue', SOFTWARE.memory)],
        [t('setup.about.graphics'), SOFTWARE.graphics],
        [t('setup.about.manufacturer'), SOFTWARE.manufacturer],
        [t('setup.about.product'), SOFTWARE.product],
      ],
    ],
  ]
  return (
    <div className="setup-about" role="group" aria-label={t('setup.about.title')}>
      <div className="setup-about__bar">
        <span className="setup-about__app" aria-hidden="true" />
        <span className="setup-about__title">{t('setup.about.title')}</span>
        <span className="setup-about__buttons" aria-hidden="true">
          <i />
          <i />
          <i className="is-close" />
        </span>
      </div>
      <div className="setup-about__window">
        <ul className="setup-about__side" aria-hidden="true">
          {INFO_CENTER.map((entry) => (
            <li key={entry} className={entry === 'about' ? 'is-active' : ''}>
              {t(`setup.about.side.${entry}`)}
            </li>
          ))}
        </ul>
        <div className="setup-about__body">
          <div className="setup-about__head">
            <img src={cachyLogoUrl} alt="" width="84" height="84" />
            <p>{SOFTWARE.os}</p>
            <span>cachyos.org</span>
          </div>
          {rows.map(([group, entries]) => (
            <dl key={group} className="setup-about__group">
              <dt className="setup-about__heading">{t(`setup.about.${group}`)}</dt>
              {entries.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}:</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function SetupShowcase() {
  const { t } = useTranslation('card')
  const sectionRef = useRef(null)
  const canvasRef = useRef(null)
  const viewerRef = useRef(null)
  const [selected, setSelected] = useState(SETUP[0].id)
  const [state, setState] = useState('waiting') // waiting | loading | ready | failed
  const [zoom, setZoom] = useState(1)
  const part = SETUP.find((entry) => entry.id === selected)
  // The part to show once the viewer exists (it loads after the first render).
  const modelRef = useRef(part.model)
  useEffect(() => {
    modelRef.current = part.model
  }, [part])
  const name = (entry) => (entry.nameKey ? t(entry.nameKey) : entry.name)

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
            })
            viewerRef.current.show(modelRef.current ?? 'cpu')
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
  }, [])

  // Show the picked part (the software tab has no model).
  useEffect(() => {
    if (part?.model && viewerRef.current) viewerRef.current.show(part.model)
  }, [part, state])

  // WebGL missing or broken: the plain list.
  if (state === 'failed') {
    return (
      <section className="me-block" aria-labelledby="me-setup">
        <h3 id="me-setup">{t('setup.title')}</h3>
        <dl className="me-specs">
          {SETUP.map((entry) => (
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

  return (
    <section ref={sectionRef} className="me-block setup" aria-labelledby="me-setup">
      <h3 id="me-setup">{t('setup.title')}</h3>

      <div className={`setup__view${part.model ? '' : ' is-software'}`}>
        <div className="setup__stage">
          <canvas ref={canvasRef} className={`setup__canvas${state === 'ready' ? ' is-ready' : ''}`} aria-label={t('setup.canvasLabel', { name: name(part) })} role="img" />
          {!part.model && <AboutSystem />}
          {part.model && state !== 'ready' && <p className="setup__status">{t('setup.loading')}</p>}
          {part.model && state === 'ready' && (
            <>
              <p className="setup__hint" aria-hidden="true">
                <span className="material-symbols-outlined">360</span>
                <span className="setup__hint-mouse">{t('setup.drag')}</span>
                <span className="setup__hint-touch">{t('setup.dragTouch')}</span>
              </p>
              <div className="setup__zoom">
                {zoomed && (
                  <button type="button" onClick={() => viewerRef.current?.reset()} title={t('setup.reset')} aria-label={t('setup.reset')}>
                    <span className="material-symbols-outlined" aria-hidden="true">
                      restart_alt
                    </span>
                  </button>
                )}
                <button type="button" onClick={() => viewerRef.current?.zoom(1 / 1.25)} title={t('setup.zoomOut')} aria-label={t('setup.zoomOut')} disabled={zoom <= 0.64}>
                  <span className="material-symbols-outlined" aria-hidden="true">
                    zoom_out
                  </span>
                </button>
                <button type="button" onClick={() => viewerRef.current?.zoom(1.25)} title={t('setup.zoomIn')} aria-label={t('setup.zoomIn')} disabled={zoom >= 2.1}>
                  <span className="material-symbols-outlined" aria-hidden="true">
                    zoom_in
                  </span>
                </button>
              </div>
            </>
          )}
        </div>
        <div className="setup__caption">
          <span className="setup__kind">{t(`setup.${part.id}`)}</span>
          <strong>{name(part)}</strong>
          {part.facts.length > 0 && (
            <ul>
              {part.facts.map((fact) => (
                <li key={fact}>{t(`setup.facts.${fact}`)}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="setup__parts" role="tablist" aria-label={t('setup.title')}>
        {SETUP.map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={entry.id === selected} className={entry.id === selected ? 'is-active' : ''} onClick={() => setSelected(entry.id)}>
            <span className="material-symbols-outlined" aria-hidden="true">
              {entry.icon}
            </span>
            {t(`setup.${entry.id}`)}
          </button>
        ))}
      </div>
    </section>
  )
}
