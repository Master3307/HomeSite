import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { clearSearchHistory } from '../Search.jsx'
import { siteConfig } from '../../lib/siteConfig.js'
import { SWITCHABLE_TOOL_IDS as QUICK_TOOL_IDS } from '../../lib/quick/toolIds.js'
import '../../styles/dash.css'
import DashIntegrations from './DashIntegrations.jsx'
import DashboardImport from './DashboardImport.jsx'
import { PlaceField } from './DashWidgetEditor.jsx'
import { BackgroundSettings, CustomFontSettings } from './BackgroundSettings.jsx'
import MusicSettings from './music/MusicSettings.jsx'
import EmojiIconButton from './EmojiIconButton.jsx'
import { Favicon, Glyph, clearDashCache, emojiIconUrl } from './kit.jsx'
import { PROVIDER_CATALOG, PROVIDER_CATEGORIES } from '../../data/searchProviders.js'
import {
  LOOK_CHOICES,
  LOOK_DEFAULTS,
  MAX_PAGES,
  TOP_CHOICES,
  TOP_DEFAULTS,
  addPage,
  DASH_SYNC_LIMIT,
  buildSearchUrl,
  MAX_PROVIDERS,
  createId,
  isColor,
  isDashAccountSyncAvailable,
  movePage,
  normalizeKeyword,
  removePage,
  replaceDashSettings,
  resetDashSettings,
  resetPhoneLayout,
  showPage,
  syncedSize,
  updateDashSettings,
  updateLook,
  updatePage,
  updateTop,
  useDashSettings,
  validateSearchTemplate,
  visibleProviders,
} from '../../lib/dashSettings.js'

/*
 * /dash settings: a side sheet. Every change shows on the page behind it
 * right away (and syncs with the account).
 *   Look          presets, cards (style, fill, blur, corners, shadow,
 *                 border, padding, titles), type and colour, background
 *   Layout        the grid (columns, row height, gap, width, float up) and
 *                 the phone layout
 *   Top           title bar, tab title, greeting, the big clock, the search
 *                 bar, the buttons
 *   Search        engines (the site's too): show / hide, order, default,
 *                 name / URL / !keyword, your own; site results, Discord
 *   Pages         the board's tabs: names, icons, order, start page
 *   Integrations  connections to your services (DashIntegrations.jsx)
 *   Sync & backup sync status, export / import / reset, cached data, how
 *                 to make it your new tab page
 * Custom CSS is in the account settings (one place for the whole site).
 */

const TABS = [
  { id: 'look', icon: 'palette' },
  { id: 'layout', icon: 'grid_on' },
  { id: 'top', icon: 'vertical_align_top' },
  { id: 'search', icon: 'travel_explore' },
  { id: 'pages', icon: 'tab' },
  { id: 'integrations', icon: 'hub' },
  ...(siteConfig.dashMusic ? [{ id: 'music', icon: 'library_music' }] : []),
  { id: 'backup', icon: 'cloud_sync' },
]

export const PAGE_ICONS = ['home', 'dashboard', 'work', 'code', 'terminal', 'music_note', 'movie', 'sports_esports', 'school', 'newspaper', 'monitoring', 'dns', 'cloud', 'favorite', 'star', 'bolt', 'pets', 'travel_explore', 'shopping_cart', 'science', 'build', 'home_iot_device', 'photo_library', 'chat']

const PRESETS = {
  standard: { icon: 'grid_view', look: { ...LOOK_DEFAULTS }, top: { ...TOP_DEFAULTS } },
  minimal: { icon: 'crop_square', look: { style: 'bare', shadow: 'none', titles: 'hidden', width: 'normal' }, top: { showHeader: false, showGreeting: false, clock: 'time', date: 'off', align: 'center', size: 'large', showEngines: false, actions: 'hover' } },
  compact: { icon: 'view_compact', look: { rowHeight: 48, gap: 8, padding: 10, radius: 10, titles: 'small', style: 'solid', shadow: 'none' }, top: { size: 'small', date: 'short' } },
  calm: { icon: 'self_improvement', look: { style: 'glass', radius: 26, blur: 24, opacity: 70, shadow: 'soft', titles: 'caps', gap: 20, padding: 20 }, top: { align: 'center', size: 'large' } },
}

/* ---------- inputs ---------- */

function Segment({ label, value, options, onChange, prefix = 'settings.choices' }) {
  const { t } = useTranslation('dash')
  return (
    <div className="dash-field">
      <span className="dash-field__label">{label}</span>
      <div className="dash-segment" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button key={option} type="button" role="radio" aria-checked={value === option} className={value === option ? 'is-active' : ''} onClick={() => onChange(option)}>
            {t(`${prefix}.${option}`, { defaultValue: option })}
          </button>
        ))}
      </div>
    </div>
  )
}

function Toggle({ label, checked, onChange, hint = null, disabled = false }) {
  return (
    <label className="dash-check">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  )
}

function Range({ label, value, min, max, step = 1, unit = '', onChange, format = null }) {
  return (
    <label className="dash-field dash-range">
      <span className="dash-field__label">
        {label}
        <output>{format ? format(value) : `${value}${unit}`}</output>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  )
}

function ColorInput({ label, value, fallback, onChange, onReset = null, resetLabel = '' }) {
  return (
    <div className="dash-field dash-field--inline">
      <span className="dash-field__label">{label}</span>
      <span className="dash-row">
        <input type="color" value={isColor(value) ? value : fallback} onChange={(event) => onChange(event.target.value)} aria-label={label} />
        {onReset && isColor(value) && (
          <button type="button" className="dash-link-button" onClick={onReset}>
            {resetLabel}
          </button>
        )}
      </span>
    </div>
  )
}

function Section({ title, children, action = null }) {
  return (
    <section className="dash-section">
      <div className="dash-section__head">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

/* ---------- Look ---------- */

function LookSettings() {
  const { t } = useTranslation('dash')
  const { look } = useDashSettings()
  return (
    <div className="dash-panel">
      <div className="dash-presets">
        {Object.entries(PRESETS).map(([id, preset]) => (
          <button key={id} type="button" className="dash-preset" onClick={() => updateDashSettings((current) => ({ look: { ...current.look, ...preset.look }, top: { ...current.top, ...preset.top } }))}>
            <span className="material-symbols-outlined" aria-hidden="true">
              {preset.icon}
            </span>
            <strong>{t(`settings.look.presets.${id}`)}</strong>
            <small>{t(`settings.look.presets.${id}Text`)}</small>
          </button>
        ))}
      </div>

      <Section title={t('settings.look.cards')}>
        <Segment label={t('settings.look.style')} value={look.style} options={LOOK_CHOICES.style} onChange={(style) => updateLook({ style })} />
        {look.style !== 'bare' && <Range label={t('settings.look.opacity')} value={look.opacity} min={0} max={100} unit="%" onChange={(opacity) => updateLook({ opacity })} />}
        {look.style === 'glass' && <Range label={t('settings.look.blur')} value={look.blur} min={0} max={40} unit="px" onChange={(blur) => updateLook({ blur })} />}
        <Range label={t('settings.look.radius')} value={look.radius} min={0} max={40} unit="px" onChange={(radius) => updateLook({ radius })} />
        <Range label={t('settings.look.padding')} value={look.padding} min={4} max={32} unit="px" onChange={(padding) => updateLook({ padding })} />
        <Segment label={t('settings.look.shadow')} value={look.shadow} options={LOOK_CHOICES.shadow} onChange={(shadow) => updateLook({ shadow })} />
        <Segment label={t('settings.look.titles')} value={look.titles} options={LOOK_CHOICES.titles} onChange={(titles) => updateLook({ titles })} />
        <Toggle label={t('settings.look.border')} checked={look.border} onChange={(border) => updateLook({ border })} />
        <Toggle label={t('settings.look.animate')} hint={t('settings.look.animateHint')} checked={look.animate} onChange={(animate) => updateLook({ animate })} />
        <Toggle label={t('settings.look.rolling')} hint={t('settings.look.rollingHint')} checked={look.rolling} onChange={(rolling) => updateLook({ rolling })} />
        <Segment label={t('settings.look.selectable')} value={look.selectable} options={LOOK_CHOICES.selectable} prefix="settings.look.selectables" onChange={(selectable) => updateLook({ selectable })} />
      </Section>

      <Section title={t('settings.look.type')}>
        <Segment label={t('settings.look.font')} value={look.font} options={LOOK_CHOICES.font} onChange={(font) => updateLook({ font })} />
        {look.font === 'custom' && <CustomFontSettings />}
        <Range label={t('settings.look.fontScale')} value={look.fontScale} min={80} max={130} step={5} unit="%" onChange={(fontScale) => updateLook({ fontScale })} />
        <ColorInput label={t('settings.look.accent')} value={look.accent} fallback="#8b5cf6" onChange={(accent) => updateLook({ accent })} onReset={() => updateLook({ accent: '' })} resetLabel={t('settings.look.accentReset')} />
        <p className="dash-hint">{t('settings.look.accentHint')}</p>
      </Section>

      <Section title={t('settings.look.background')}>
        <BackgroundSettings />
      </Section>
      <button type="button" className="dash-link-button" onClick={() => resetDashSettings('look')}>
        {t('settings.resetPart')}
      </button>
    </div>
  )
}

/* ---------- Layout ---------- */

function LayoutSettings({ onEditBoard }) {
  const { t } = useTranslation('dash')
  const { look, pages, widgets, refresh, shortcuts } = useDashSettings()
  const phoneArranged = widgets.some((widget) => widget.sm)
  return (
    <div className="dash-panel">
      <Section title={t('settings.layout.grid')}>
        <Range label={t('settings.layout.columns')} value={look.columns} min={4} max={24} onChange={(columns) => updateLook({ columns })} />
        <p className="dash-hint">{t('settings.layout.columnsHint')}</p>
        <Range label={t('settings.layout.rowHeight')} value={look.rowHeight} min={32} max={200} step={4} unit="px" onChange={(rowHeight) => updateLook({ rowHeight })} />
        <Range label={t('settings.layout.gap')} value={look.gap} min={0} max={40} unit="px" onChange={(gap) => updateLook({ gap })} />
        <Segment label={t('settings.layout.width')} value={look.width} options={LOOK_CHOICES.width} onChange={(width) => updateLook({ width })} />
        {look.width === 'custom' && <Range label={t('settings.layout.maxWidth')} value={look.maxWidth} min={480} max={3200} step={20} unit=" px" onChange={(maxWidth) => updateLook({ maxWidth })} />}
        <Range label={t('settings.layout.gutter')} value={look.gutter} min={0} max={240} step={2} unit=" px" onChange={(gutter) => updateLook({ gutter })} />
        <Toggle label={t('settings.layout.gravity')} hint={t('settings.layout.gravityHint')} checked={look.float} onChange={(float) => updateLook({ float })} />
      </Section>
      <Section title={t('settings.layout.phone')}>
        <Range label={t('settings.layout.phoneColumns')} value={look.phoneColumns} min={2} max={6} onChange={(phoneColumns) => updateLook({ phoneColumns })} />
        <p className="dash-hint">{phoneArranged ? t('settings.layout.phoneOwn') : t('settings.layout.phoneAuto')}</p>
        {phoneArranged && (
          <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => resetPhoneLayout(null)}>
            <span className="material-symbols-outlined" aria-hidden="true">
              restart_alt
            </span>
            {t('settings.layout.phoneReset')}
          </button>
        )}
      </Section>
      <Section title={t('settings.layout.behaviour')}>
        <Segment label={t('settings.layout.refresh')} value={refresh} options={['normal', 'slow', 'open']} prefix="settings.layout.refreshChoices" onChange={(value) => updateDashSettings({ refresh: value })} />
        <p className="dash-hint">{t(`settings.layout.refreshHint_${refresh}`)}</p>
        <Toggle label={t('settings.layout.shortcuts')} hint={t('settings.layout.shortcutsHint')} checked={shortcuts} onChange={(value) => updateDashSettings({ shortcuts: value })} />
      </Section>
      <Section title={t('settings.layout.board')}>
        <p className="dash-hint">{t('settings.layout.boardHelp', { count: widgets.length, pages: pages.length })}</p>
        <button type="button" className="dash-button" onClick={onEditBoard}>
          <span className="material-symbols-outlined" aria-hidden="true">
            edit
          </span>
          {t('settings.layout.editOnPage')}
        </button>
      </Section>
      <button type="button" className="dash-link-button" onClick={() => updateLook({ columns: LOOK_DEFAULTS.columns, rowHeight: LOOK_DEFAULTS.rowHeight, gap: LOOK_DEFAULTS.gap, width: LOOK_DEFAULTS.width, phoneColumns: LOOK_DEFAULTS.phoneColumns, float: LOOK_DEFAULTS.float })}>
        {t('settings.resetPart')}
      </button>
    </div>
  )
}

/* ---------- Top ---------- */

/* A picture (file or address) -> a small square PNG (data: URL) for the tab icon; it syncs with the dash. */
async function iconFromSource(source) {
  const isFile = typeof source !== 'string'
  if (isFile && (!source.type.startsWith('image/') || source.size > 8_000_000)) throw new Error('not-an-image')
  const url = isFile ? URL.createObjectURL(source) : source
  try {
    const image = new Image()
    image.crossOrigin = 'anonymous' // Discord's emoji CDN allows it; the canvas stays readable
    image.decoding = 'async'
    image.src = url
    await image.decode()
    for (const size of [64, 48, 32]) {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const context = canvas.getContext('2d')
      const natural = { w: image.naturalWidth || size, h: image.naturalHeight || size }
      const scale = Math.min(size / natural.w, size / natural.h)
      const w = natural.w * scale
      const h = natural.h * scale
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, (size - w) / 2, (size - h) / 2, w, h)
      const data = canvas.toDataURL('image/png')
      if (data.length <= 40_000) return data
    }
    throw new Error('too-big')
  } finally {
    if (isFile) URL.revokeObjectURL(url)
  }
}

function TabIconField({ value }) {
  const { t } = useTranslation('dash')
  const fileRef = useRef(null)
  const [error, setError] = useState(null)
  const uploaded = value.startsWith('data:')
  const [link, setLink] = useState(uploaded ? '' : value)
  return (
    <div className="dash-field">
      <span className="dash-field__label">{t('settings.top.tabIcon')}</span>
      <div className="dash-tabicon">
        <span className="dash-tabicon__preview">{value ? <img src={value} alt="" width={32} height={32} onError={() => setError(t('settings.top.tabIconBroken'))} /> : <img src="/favicon.svg" alt="" width={32} height={32} />}</span>
        <input
          type="url"
          value={link}
          placeholder={uploaded ? t('settings.top.tabIconUploaded') : 'https://…/icon.png'}
          aria-label={t('settings.top.tabIconLink')}
          onChange={(event) => {
            setLink(event.target.value)
            setError(null)
            updateTop({ tabIcon: event.target.value })
          }}
        />
        <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => fileRef.current?.click()}>
          <span className="material-symbols-outlined" aria-hidden="true">
            upload
          </span>
          {t('settings.top.tabIconUpload')}
        </button>
        <EmojiIconButton
          label={t('settings.top.tabIconEmoji')}
          onPick={async (icon) => {
            try {
              const data = await iconFromSource(emojiIconUrl(icon, 128))
              setLink('')
              setError(null)
              updateTop({ tabIcon: data })
            } catch {
              setError(t('settings.top.tabIconFailed'))
            }
          }}
        />
        {value && (
          <button
            type="button"
            className="dash-tool"
            onClick={() => {
              setLink('')
              setError(null)
              updateTop({ tabIcon: '' })
            }}
            aria-label={t('settings.top.tabIconReset')}
            title={t('settings.top.tabIconReset')}
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon"
          hidden
          onChange={async (event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            try {
              const data = await iconFromSource(file)
              setLink('')
              setError(null)
              updateTop({ tabIcon: data })
            } catch {
              setError(t('settings.top.tabIconFailed'))
            }
          }}
        />
      </div>
      <span className="dash-hint">{t('settings.top.tabIconHint')}</span>
      {error && <span className="dash-error">{error}</span>}
    </div>
  )
}

/* The tab's title: one text, or frames shown in turn, with live parts to drop in. */
const TITLE_TOKENS = ['time', 'seconds', 'date', 'weekday', 'page', 'music', 'weather', 'greeting']
function TabTitleField({ top }) {
  const { t } = useTranslation('dash')
  const animated = top.tabTitleFrames.length > 0
  const focused = useRef(null)
  const insert = (token) => {
    const target = focused.current
    const piece = `{${token}}`
    if (target?.kind === 'frame') {
      const frames = [...top.tabTitleFrames]
      frames[target.index] = `${frames[target.index] ?? ''}${piece}`
      updateTop({ tabTitleFrames: frames })
    } else updateTop({ tabTitle: `${top.tabTitle}${top.tabTitle && !top.tabTitle.endsWith(' ') ? ' ' : ''}${piece}`.slice(0, 80) })
  }
  return (
    <div className="dash-field dash-title-field">
      <span className="dash-field__label">{t('settings.top.tabTitle')}</span>
      {!animated ? (
        <input value={top.tabTitle} maxLength={80} placeholder="Dash – MrKoby07" onFocus={() => (focused.current = { kind: 'title' })} onChange={(event) => updateTop({ tabTitle: event.target.value })} />
      ) : (
        <ol className="dash-title-frames">
          {top.tabTitleFrames.map((frame, index) => (
            <li key={index}>
              <span className="dash-muted">{index + 1}</span>
              <input value={frame} maxLength={80} onFocus={() => (focused.current = { kind: 'frame', index })} onChange={(event) => updateTop({ tabTitleFrames: top.tabTitleFrames.map((entry, position) => (position === index ? event.target.value : entry)) })} aria-label={t('settings.top.frame', { n: index + 1 })} />
              <button type="button" className="dash-tool" onClick={() => updateTop({ tabTitleFrames: top.tabTitleFrames.filter((_, position) => position !== index) })} aria-label={t('settings.top.removeFrame')} title={t('settings.top.removeFrame')}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="dash-title-tokens" role="group" aria-label={t('settings.top.tokens')}>
        {TITLE_TOKENS.map((token) => (
          <button key={token} type="button" className="dash-chip-button" onMouseDown={(event) => event.preventDefault()} onClick={() => insert(token)} title={t(`settings.top.token.${token}`)}>
            {`{${token}}`}
          </button>
        ))}
      </div>
      <div className="dash-row">
        {animated ? (
          <>
            {top.tabTitleFrames.length < 20 && (
              <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => updateTop({ tabTitleFrames: [...top.tabTitleFrames, ''] })}>
                {t('settings.top.addFrame')}
              </button>
            )}
            <button type="button" className="dash-link-button" onClick={() => updateTop({ tabTitleFrames: [] })}>
              {t('settings.top.stopAnimating')}
            </button>
          </>
        ) : (
          <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => updateTop({ tabTitleFrames: [top.tabTitle || 'Dash', '{time}'] })}>
            <span className="material-symbols-outlined" aria-hidden="true">
              animation
            </span>
            {t('settings.top.animate')}
          </button>
        )}
      </div>
      {animated && (
        <label className="dash-field dash-range">
          <span className="dash-field__label">
            {t('settings.top.frameSpeed')}
            <output>{(top.tabTitleSpeed / 1000).toFixed(top.tabTitleSpeed < 1000 ? 2 : 1)} s</output>
          </span>
          <input type="range" min="200" max="10000" step="100" value={top.tabTitleSpeed} onChange={(event) => updateTop({ tabTitleSpeed: Number(event.target.value) })} />
        </label>
      )}
      <span className="dash-hint">{t('settings.top.tabTitleHint')}</span>
    </div>
  )
}

function TopSettings() {
  const { t } = useTranslation('dash')
  const { top } = useDashSettings()
  return (
    <div className="dash-panel">
      <Section title={t('settings.top.page')}>
        <Toggle label={t('settings.top.showHeader')} checked={top.showHeader} onChange={(showHeader) => updateTop({ showHeader })} />
        <TabTitleField top={top} />
        <TabIconField value={top.tabIcon} />
        <Segment label={t('settings.top.align')} value={top.align} options={TOP_CHOICES.align} onChange={(align) => updateTop({ align })} />
        <Segment label={t('settings.top.size')} value={top.size} options={TOP_CHOICES.size} onChange={(size) => updateTop({ size })} />
        <Segment label={t('settings.top.actions')} value={top.actions} options={TOP_CHOICES.actions} onChange={(actions) => updateTop({ actions })} />
      </Section>
      <Section title={t('settings.top.clock')}>
        <Segment label={t('settings.top.clockShow')} value={top.clock} options={TOP_CHOICES.clock} onChange={(clock) => updateTop({ clock })} />
        {top.clock !== 'off' && <Segment label={t('settings.top.hourFormat')} value={top.hourFormat} options={TOP_CHOICES.hourFormat} prefix="fields.choices" onChange={(hourFormat) => updateTop({ hourFormat })} />}
        <Segment label={t('settings.top.date')} value={top.date} options={TOP_CHOICES.date} onChange={(date) => updateTop({ date })} />
        {top.clock !== 'off' && (
          <>
            <ColorInput label={t('settings.top.clockColor')} value={top.clockColor} fallback="#eeeeee" onChange={(clockColor) => updateTop({ clockColor })} onReset={() => updateTop({ clockColor: '' })} resetLabel={t('fields.colorReset')} />
            {top.clock === 'seconds' && <ColorInput label={t('settings.top.secondsColor')} value={top.secondsColor} fallback="#a78bfa" onChange={(secondsColor) => updateTop({ secondsColor })} onReset={() => updateTop({ secondsColor: '' })} resetLabel={t('fields.colorReset')} />}
            <Segment label={t('settings.top.rolling')} value={top.rolling} options={['inherit', 'on', 'off']} prefix="editor.rollings" onChange={(rolling) => updateTop({ rolling })} />
          </>
        )}
        <p className="dash-hint">
          {t('settings.top.zoneHint')} <Link to="/settings">{t('settings.top.zoneLink')}</Link>
        </p>
      </Section>
      <Section title={t('settings.top.weather')}>
        <Toggle label={t('settings.top.weatherShow')} hint={t('settings.top.weatherHint')} checked={top.weather} onChange={(weather) => updateTop({ weather })} />
        {top.weather && (
          <>
            <div className="dash-field">
              <span className="dash-field__label">{t('fields.place')}</span>
              <PlaceField options={{ place: top.weatherPlace, lat: top.weatherLat, lon: top.weatherLon }} onChange={(next) => updateTop({ weatherPlace: next.place ?? '', weatherLat: String(next.lat ?? ''), weatherLon: String(next.lon ?? '') })} />
            </div>
            <Segment label={t('fields.unit')} value={top.weatherUnit} options={['c', 'f']} prefix="fields.choices" onChange={(weatherUnit) => updateTop({ weatherUnit })} />
          </>
        )}
      </Section>
      <Section title={t('settings.top.greeting')}>
        <Toggle label={t('settings.top.showGreeting')} checked={top.showGreeting} onChange={(showGreeting) => updateTop({ showGreeting })} />
        {top.showGreeting && (
          <>
            <Toggle label={t('settings.top.showName')} checked={top.showName} onChange={(showName) => updateTop({ showName })} />
            <label className="dash-field">
              <span className="dash-field__label">{t('settings.top.greetingText')}</span>
              <input value={top.greetingText} maxLength={120} placeholder={t('settings.top.greetingPlaceholder')} onChange={(event) => updateTop({ greetingText: event.target.value })} />
              <span className="dash-hint">{t('settings.top.greetingHint')}</span>
            </label>
          </>
        )}
      </Section>
      <Section title={t('settings.top.search')}>
        <Toggle label={t('settings.top.showSearch')} checked={top.showSearch} onChange={(showSearch) => updateTop({ showSearch })} />
        {top.showSearch && (
          <>
            <Segment label={t('settings.top.searchSize')} value={top.searchSize} options={TOP_CHOICES.searchSize} onChange={(searchSize) => updateTop({ searchSize })} />
            <Toggle label={t('settings.top.showEngines')} checked={top.showEngines} onChange={(showEngines) => updateTop({ showEngines })} />
            <Toggle label={t('settings.top.autofocus')} hint={t('settings.top.autofocusHint')} checked={top.autofocus} onChange={(autofocus) => updateTop({ autofocus })} />
          </>
        )}
      </Section>
      <button type="button" className="dash-link-button" onClick={() => resetDashSettings('top')}>
        {t('settings.resetPart')}
      </button>
    </div>
  )
}

/* ---------- Search ---------- */

const EMPTY_PROVIDER = { id: null, name: '', url: '', keyword: '' }

function ProviderForm({ initial, onSave, onCancel, providers }) {
  const { t } = useTranslation('dash')
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState(null)
  function save(event) {
    event.preventDefault()
    const problem = validateSearchTemplate(draft.url)
    if (problem) return setError(t(problem))
    const keyword = normalizeKeyword(draft.keyword)
    if (keyword && providers.some((provider) => provider.keyword === keyword && provider.id !== draft.id)) return setError(t('errors.keywordTaken'))
    onSave({ ...draft, keyword, name: draft.name.trim() })
  }
  return (
    <form className="dash-provider-form" onSubmit={save}>
      <label className="dash-field">
        <span className="dash-field__label">{t('settings.search.name')}</span>
        <input value={draft.name} maxLength={64} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      </label>
      <label className="dash-field">
        <span className="dash-field__label">{t('settings.search.url')}</span>
        <input value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder="https://example.com/search?q=%s" />
        <span className="dash-hint">{t('settings.search.urlHelp')}</span>
      </label>
      <label className="dash-field">
        <span className="dash-field__label">{t('settings.search.keyword')}</span>
        <input value={draft.keyword} maxLength={24} onChange={(event) => setDraft({ ...draft, keyword: event.target.value })} placeholder="ddg" />
        <span className="dash-hint">{t('settings.search.keywordHelp')}</span>
      </label>
      {!validateSearchTemplate(draft.url) && (
        <p className="dash-hint">
          {t('settings.search.preview')} <code>{buildSearchUrl(draft.url, 'cats')}</code>
        </p>
      )}
      {error && <p className="dash-error">{error}</p>}
      <div className="dash-row">
        <button type="button" className="dash-button dash-button--quiet" onClick={onCancel}>
          {t('settings.cancel')}
        </button>
        <button type="submit" className="dash-button">
          {t('settings.save')}
        </button>
      </div>
    </form>
  )
}

/* The catalog: search, categories, everything not already on the dash; one click adds it. */
function ProviderCatalog({ list, onAdd, onClose }) {
  const { t } = useTranslation('dash')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const searchRef = useRef(null)
  useEffect(() => searchRef.current?.focus({ preventScroll: true }), [])
  const present = (entry) => list.some((item) => item.id === entry.id || item.catalog === entry.id || item.url === entry.url)
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  const shown = PROVIDER_CATALOG.filter((entry) => !present(entry) && (category === 'all' || entry.category === category) && words.every((word) => `${entry.name} ${entry.keyword} ${new URL(entry.url.replaceAll('%s', '')).hostname} ${t(`settings.search.categories.${entry.category}`)}`.toLocaleLowerCase().includes(word)))
  return (
    <div className="dash-catalog" role="dialog" aria-label={t('settings.search.fromList')}>
      <div className="dash-catalog__head">
        <label className="dash-catalog__search">
          <span className="material-symbols-outlined" aria-hidden="true">
            search
          </span>
          <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('settings.search.catalogSearch')} aria-label={t('settings.search.catalogSearch')} />
        </label>
        <button type="button" className="dash-tool" onClick={onClose} aria-label={t('settings.close')} title={t('settings.close')}>
          <span className="material-symbols-outlined" aria-hidden="true">
            close
          </span>
        </button>
      </div>
      <div className="dash-chips" role="radiogroup" aria-label={t('settings.search.category')}>
        {['all', ...PROVIDER_CATEGORIES].map((name) => (
          <button key={name} type="button" role="radio" aria-checked={category === name} className={category === name ? 'is-active' : ''} onClick={() => setCategory(name)}>
            {name === 'all' ? t('settings.search.categories.all') : t(`settings.search.categories.${name}`)}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="dash-hint">{t('settings.search.catalogEmpty')}</p>
      ) : (
        <ul className="dash-catalog__list">
          {shown.map((entry) => (
            <li key={entry.id}>
              <Favicon url={entry.url.replaceAll('%s', '')} size={18} />
              <span className="dash-list__name">
                <strong>{entry.name}</strong>
                <small>
                  <code>!{entry.keyword}</code> {t(`settings.search.categories.${entry.category}`)}
                </small>
              </span>
              <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => onAdd(entry)}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  add
                </span>
                {t('settings.add')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SearchSettings({ owner }) {
  const { t } = useTranslation('dash')
  const { t: tt } = useTranslation('tools')
  const settings = useDashSettings()
  const [editing, setEditing] = useState(null) // provider being edited, or EMPTY_PROVIDER
  const [catalog, setCatalog] = useState(false)
  const [dragging, setDragging] = useState(null)
  const list = settings.providers

  const setList = (providers) => updateDashSettings({ providers })
  const moveTo = (from, to) => {
    if (to < 0 || to >= list.length || from === to) return
    const next = [...list]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    setList(next)
  }
  // Removing a built-in or catalog engine puts it back into "Add from list" (adding it again resets your changes).
  const remove = (provider) => {
    const providers = list.filter((item) => item.id !== provider.id)
    const removedProviders = provider.builtin ? [...new Set([...settings.removedProviders, provider.id])] : settings.removedProviders
    updateDashSettings({ providers, removedProviders, activeProviderId: settings.activeProviderId === provider.id ? (providers.find((item) => !item.hidden)?.id ?? null) : settings.activeProviderId })
  }
  const addFromCatalog = (entry) => {
    if (list.length >= MAX_PROVIDERS) return
    const fresh = { id: entry.start ? entry.id : `cat-${entry.id}`, name: entry.name, url: entry.url, keyword: list.some((item) => item.keyword === entry.keyword) ? '' : entry.keyword, catalog: entry.id, ...(entry.start ? { builtin: true } : {}), ...(entry.minecraft ? { minecraft: entry.minecraft } : {}) }
    updateDashSettings({ providers: [...list, fresh], removedProviders: settings.removedProviders.filter((id) => id !== entry.id) })
  }
  const minecraftChoices = [...list.filter((item) => item.minecraft), ...PROVIDER_CATALOG.filter((entry) => entry.minecraft && !list.some((item) => item.catalog === entry.id || item.id === entry.id))]

  return (
    <div className="dash-panel">
      <Section title={t('settings.search.providers')}>
        <p className="dash-hint">{t('settings.search.providersHelp')}</p>
        <ul className="dash-list dash-list--sortable">
          {list.map((provider, index) => {
            const active = provider.id === settings.activeProviderId
            return (
              <li
                key={provider.id}
                className={`${provider.hidden ? 'is-hidden' : ''}${dragging === index ? ' is-dragging' : ''}`}
                draggable
                onDragStart={(event) => {
                  setDragging(index)
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', provider.id)
                }}
                onDragOver={(event) => {
                  if (dragging === null) return
                  event.preventDefault()
                  if (dragging !== index) {
                    moveTo(dragging, index)
                    setDragging(index)
                  }
                }}
                onDragEnd={() => setDragging(null)}
                onDrop={(event) => event.preventDefault()}
              >
                <span className="material-symbols-outlined dash-list__grip" aria-hidden="true">
                  drag_indicator
                </span>
                <button
                  type="button"
                  className={`dash-radio${active ? ' is-active' : ''}`}
                  onClick={() => updateDashSettings({ activeProviderId: provider.id, providers: list.map((item) => (item.id === provider.id ? { ...item, hidden: false } : item)) })}
                  title={t('settings.search.makeDefault')}
                  aria-label={t('settings.search.makeDefault')}
                  aria-pressed={active}
                />
                <Favicon url={provider.url.replaceAll('%s', '')} size={16} />
                <span className="dash-list__name">
                  <strong>{provider.name}</strong>
                  <small title={provider.hidden ? t('settings.search.hiddenNote') : undefined}>
                    {provider.keyword && <code>!{provider.keyword}</code>}
                    {provider.hidden ? ` · ${t('settings.search.hiddenShort')}` : ''}
                  </small>
                </span>
                <button type="button" className="dash-tool" onClick={() => moveTo(index, index - 1)} disabled={index === 0} aria-label={t('settings.moveUp')} title={t('settings.moveUp')}>
                  <span className="material-symbols-outlined">arrow_upward</span>
                </button>
                <button type="button" className="dash-tool" onClick={() => moveTo(index, index + 1)} disabled={index === list.length - 1} aria-label={t('settings.moveDown')} title={t('settings.moveDown')}>
                  <span className="material-symbols-outlined">arrow_downward</span>
                </button>
                <button
                  type="button"
                  className="dash-tool"
                  disabled={active}
                  onClick={() => setList(list.map((item) => (item.id === provider.id ? { ...item, hidden: !item.hidden } : item)))}
                  aria-label={provider.hidden ? t('settings.search.show') : t('settings.search.hide')}
                  title={provider.hidden ? t('settings.search.show') : t('settings.search.hide')}
                >
                  <span className="material-symbols-outlined">{provider.hidden ? 'visibility_off' : 'visibility'}</span>
                </button>
                <button type="button" className="dash-tool" onClick={() => setEditing(provider)} aria-label={t('settings.edit')} title={t('settings.edit')}>
                  <span className="material-symbols-outlined">edit</span>
                </button>
                <button
                  type="button"
                  className="dash-tool dash-tool--danger"
                  disabled={active}
                  onClick={() => remove(provider)}
                  aria-label={provider.builtin || provider.catalog ? t('settings.search.removeToList') : t('settings.delete')}
                  title={provider.builtin || provider.catalog ? t('settings.search.removeToList') : t('settings.delete')}
                >
                  <span className="material-symbols-outlined">{provider.builtin || provider.catalog ? 'playlist_remove' : 'delete'}</span>
                </button>
              </li>
            )
          })}
        </ul>
        {editing ? (
          <ProviderForm
            key={editing.id ?? 'new'}
            initial={{ ...EMPTY_PROVIDER, ...editing }}
            providers={list}
            onCancel={() => setEditing(null)}
            onSave={(provider) => {
              if (provider.id) setList(list.map((item) => (item.id === provider.id ? { ...item, ...provider } : item)))
              else setList([...list, { ...provider, id: createId('provider') }])
              setEditing(null)
            }}
          />
        ) : catalog ? (
          <ProviderCatalog list={list} onAdd={addFromCatalog} onClose={() => setCatalog(false)} />
        ) : (
          <div className="dash-row">
            <button type="button" className="dash-button dash-button--small" onClick={() => setCatalog(true)} disabled={list.length >= MAX_PROVIDERS}>
              <span className="material-symbols-outlined" aria-hidden="true">
                playlist_add
              </span>
              {t('settings.search.fromList')}
            </button>
            <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => setEditing(EMPTY_PROVIDER)} disabled={list.length >= MAX_PROVIDERS}>
              <span className="material-symbols-outlined" aria-hidden="true">
                add
              </span>
              {t('settings.search.addProvider')}
            </button>
          </div>
        )}
      </Section>

      <Section title={t('settings.search.minecraft')}>
        <label className="dash-field">
          <span className="dash-field__label">{t('settings.search.minecraftOpen')}</span>
          <select value={settings.minecraftProvider} onChange={(event) => updateDashSettings({ minecraftProvider: event.target.value })}>
            {minecraftChoices.map((entry) => (
              <option key={entry.catalog ?? entry.id} value={entry.catalog ?? entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <p className="dash-hint">{t('settings.search.minecraftHint')}</p>
      </Section>

      <Section title={t('settings.search.behaviour')}>
        <Toggle label={t('settings.search.newTab')} checked={settings.openInNewTab} onChange={(openInNewTab) => updateDashSettings({ openInNewTab })} />
        <Toggle label={t('settings.search.siteResults')} hint={t('settings.search.siteResultsHint')} checked={settings.siteResults} onChange={(siteResults) => updateDashSettings({ siteResults })} />
        <Toggle label={t('settings.search.camera')} hint={t('settings.search.cameraHint')} checked={settings.imageButton} onChange={(imageButton) => updateDashSettings({ imageButton })} />
        <Toggle label={t('settings.search.voice')} hint={t('settings.search.voiceHint')} checked={settings.voiceSearch} onChange={(voiceSearch) => updateDashSettings({ voiceSearch })} />
        <Toggle
          label={t('settings.search.history')}
          hint={t('settings.search.historyHint')}
          checked={settings.searchHistory}
          onChange={(searchHistory) => {
            // Off forgets what was kept.
            if (!searchHistory) clearSearchHistory('dash')
            updateDashSettings({ searchHistory })
          }}
        />
        {owner && <Toggle label={t('settings.search.discordLookup')} hint={t('settings.search.discordLookupHint')} checked={settings.discordLookup} onChange={(discordLookup) => updateDashSettings({ discordLookup })} />}
        {!visibleProviders(settings).length && <p className="dash-error">{t('settings.search.noneVisible')}</p>}
        <p className="dash-hint">{t('settings.search.keys')}</p>
      </Section>

      <Section title={t('settings.search.calculator')}>
        <Toggle label={t('settings.search.calcOn')} hint={t('settings.search.calcOnHint')} checked={settings.calculator} onChange={(calculator) => updateDashSettings({ calculator })} />
        {settings.calculator && (
          <>
            <Segment label={t('settings.search.calcAngle')} value={settings.calcAngle} options={['rad', 'deg']} onChange={(calcAngle) => updateDashSettings({ calcAngle })} />
            <Segment label={t('settings.search.calcGraph')} value={settings.calcGraph} options={['ask', 'show']} onChange={(calcGraph) => updateDashSettings({ calcGraph })} />
          </>
        )}
      </Section>

      <Section title={t('settings.search.tools')}>
        <Toggle label={t('settings.search.toolsOn')} hint={t('settings.search.toolsOnHint')} checked={settings.quickTools} onChange={(quickTools) => updateDashSettings({ quickTools })} />
        {settings.quickTools && (
          <>
            {siteConfig.dashLinkPreview && <Toggle label={t('settings.search.linkPreview')} hint={t('settings.search.linkPreviewHint')} checked={settings.linkPreview} onChange={(linkPreview) => updateDashSettings({ linkPreview })} />}
            <div className="dash-field">
              <span className="dash-field__label">{t('settings.search.toolsEach')}</span>
              <div className="dash-chips" role="group" aria-label={t('settings.search.toolsEach')}>
                {QUICK_TOOL_IDS.map((id) => {
                  const on = !settings.quickDisabled.includes(id)
                  return (
                    <button key={id} type="button" className={`dash-chip${on ? ' is-active' : ''}`} aria-pressed={on} onClick={() => updateDashSettings({ quickDisabled: on ? [...settings.quickDisabled, id] : settings.quickDisabled.filter((entry) => entry !== id) })}>
                      {tt(`tools.${id}.name`)}
                    </button>
                  )
                })}
              </div>
            </div>
            <p className="dash-hint">{t('settings.search.toolsHelp')}</p>
          </>
        )}
      </Section>

      <Section title={t('settings.search.icons')}>
        <label className="dash-field">
          <span className="dash-field__label">{t('settings.search.iconProvider')}</span>
          <select value={settings.iconProvider} onChange={(event) => updateDashSettings({ iconProvider: event.target.value })}>
            {['auto', 'duckduckgo', 'google', 'iconhorse', 'site', 'custom', 'none'].map((id) => (
              <option key={id} value={id}>
                {t(`settings.search.iconProviders.${id}`)}
              </option>
            ))}
          </select>
        </label>
        {settings.iconProvider === 'custom' && (
          <label className="dash-field">
            <span className="dash-field__label">{t('settings.search.iconTemplate')}</span>
            <input className="dash-input" defaultValue={settings.iconTemplate} placeholder="https://icons.example.com/{host}.png" spellCheck="false" onBlur={(event) => updateDashSettings({ iconTemplate: event.target.value.trim() })} />
          </label>
        )}
        <p className="dash-hint">{t(`settings.search.iconProviderHints.${settings.iconProvider}`)}</p>
      </Section>
    </div>
  )
}

/* ---------- Pages ---------- */

function PageRow({ page, index, count, active, widgets }) {
  const { t } = useTranslation('dash')
  const [confirm, setConfirm] = useState(false)
  const [icons, setIcons] = useState(false)
  return (
    <li className={active ? 'is-active' : ''}>
      <button type="button" className="dash-tool" onClick={() => setIcons(!icons)} aria-label={t('pages.icon')} title={t('pages.icon')} aria-expanded={icons}>
        <Glyph icon={page.icon} />
      </button>
      <input className="dash-list__input" value={page.name} maxLength={40} placeholder={t('pages.untitled', { number: index + 1 })} aria-label={t('pages.name')} onChange={(event) => updatePage(page.id, { name: event.target.value })} />
      <small className="dash-muted">{t('pages.widgets', { count: widgets })}</small>
      <button type="button" className="dash-tool" onClick={() => movePage(page.id, -1)} disabled={index === 0} aria-label={t('settings.moveUp')} title={t('settings.moveUp')}>
        <span className="material-symbols-outlined">arrow_upward</span>
      </button>
      <button type="button" className="dash-tool" onClick={() => showPage(page.id)} disabled={active} aria-label={t('pages.open')} title={t('pages.open')}>
        <span className="material-symbols-outlined">visibility</span>
      </button>
      {count > 1 &&
        (confirm ? (
          <button type="button" className="dash-button dash-button--danger dash-button--small" onClick={() => removePage(page.id)}>
            {t('pages.removeYes', { count: widgets })}
          </button>
        ) : (
          <button type="button" className="dash-tool dash-tool--danger" onClick={() => (widgets ? setConfirm(true) : removePage(page.id))} aria-label={t('pages.remove')} title={t('pages.remove')}>
            <span className="material-symbols-outlined">delete</span>
          </button>
        ))}
      {icons && (
        <div className="dash-iconrow" role="radiogroup" aria-label={t('pages.icon')}>
          {PAGE_ICONS.map((icon) => (
            <button
              key={icon}
              type="button"
              role="radio"
              aria-checked={page.icon === icon}
              className={page.icon === icon ? 'is-active' : ''}
              onClick={() => {
                updatePage(page.id, { icon })
                setIcons(false)
              }}
              aria-label={icon}
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                {icon}
              </span>
            </button>
          ))}
          <EmojiIconButton
            label={t('pages.emoji')}
            onPick={(icon) => {
              updatePage(page.id, { icon })
              setIcons(false)
            }}
          />
        </div>
      )}
    </li>
  )
}

function PagesSettings() {
  const { t } = useTranslation('dash')
  const { pages, widgets, activePage, startPage } = useDashSettings()
  return (
    <div className="dash-panel">
      <Section title={t('pages.title')}>
        <p className="dash-hint">{t('pages.help')}</p>
        <ul className="dash-list dash-list--pages">
          {pages.map((page, index) => (
            <PageRow key={page.id} page={page} index={index} count={pages.length} active={page.id === activePage} widgets={widgets.filter((widget) => widget.page === page.id).length} />
          ))}
        </ul>
        <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => addPage('', PAGE_ICONS[pages.length % PAGE_ICONS.length])} disabled={pages.length >= MAX_PAGES}>
          <span className="material-symbols-outlined" aria-hidden="true">
            add
          </span>
          {t('pages.add')}
        </button>
      </Section>
      <Section title={t('pages.start')}>
        <Segment label={t('pages.startLabel')} value={startPage} options={['last', 'first']} prefix="pages.startChoices" onChange={(value) => updateDashSettings({ startPage: value })} />
      </Section>
    </div>
  )
}

/* ---------- Sync & backup ---------- */

const kb = (bytes) => `${Math.max(1, Math.ceil(bytes / 1000))} KB`

function BackupSettings({ account, owner }) {
  const { t } = useTranslation('dash')
  const settings = useDashSettings()
  const fileRef = useRef(null)
  const [message, setMessage] = useState(null)
  const [confirmReset, setConfirmReset] = useState(null)
  const synced = isDashAccountSyncAvailable()
  const size = syncedSize(settings)

  function exportSettings() {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `dash-settings-${new Date().toISOString().slice(0, 10)}.json`
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function importSettings(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      if (file.size > 2_000_000) throw new Error('too big')
      replaceDashSettings(JSON.parse(await file.text()))
      setMessage({ type: 'ok', key: 'settings.backup.imported' })
    } catch {
      setMessage({ type: 'error', key: 'settings.backup.importFailed' })
    }
  }

  return (
    <div className="dash-panel">
      <Section title={t('settings.backup.sync')}>
        <p className="dash-sync">
          <span className="material-symbols-outlined" aria-hidden="true">
            {synced ? 'cloud_done' : 'computer'}
          </span>
          {t(synced ? 'settings.backup.syncOn' : 'settings.backup.syncLocal', { name: account?.displayName || account?.username || '' })}
        </p>
        {synced && (
          <div className="dash-meter dash-meter--wide">
            <span className="dash-meter__label">{t('settings.backup.size')}</span>
            <span className="dash-meter__bar" role="meter" aria-valuemin={0} aria-valuemax={owner ? size : DASH_SYNC_LIMIT} aria-valuenow={size} aria-label={t('settings.backup.size')}>
              <span style={{ width: owner ? '100%' : `${Math.min(100, (size / DASH_SYNC_LIMIT) * 100)}%`, ...(owner ? { opacity: 0.35 } : {}) }} />
            </span>
            <strong>{owner ? t('settings.backup.usedUnlimited', { used: kb(size) }) : t('settings.backup.used', { used: kb(size), limit: kb(DASH_SYNC_LIMIT) })}</strong>
          </div>
        )}
        {synced && owner && <p className="dash-hint">{t('settings.backup.ownerUnlimited')}</p>}
        {synced && !owner && size > DASH_SYNC_LIMIT && <p className="dash-error">{t('settings.backup.tooBig', { limit: kb(DASH_SYNC_LIMIT) })}</p>}
        <p className="dash-hint">{t('settings.backup.syncWhat')}</p>
      </Section>

      <Section title={t('settings.backup.title')}>
        <p className="dash-hint">{t('settings.backup.help')}</p>
        <div className="dash-row">
          <button type="button" className="dash-button" onClick={exportSettings}>
            <span className="material-symbols-outlined" aria-hidden="true">
              download
            </span>
            {t('settings.backup.export')}
          </button>
          <button type="button" className="dash-button dash-button--quiet" onClick={() => fileRef.current?.click()}>
            <span className="material-symbols-outlined" aria-hidden="true">
              upload
            </span>
            {t('settings.backup.import')}
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importSettings} />
        </div>
      </Section>

      <Section title={t('settings.import.title')}>
        <DashboardImport />
      </Section>

      <Section title={t('settings.backup.newTab')}>
        <p className="dash-hint">{t('settings.backup.newTabHelp')}</p>
        <p className="dash-copy">
          <code>{`${siteOrigin()}/dash`}</code>
          <button
            type="button"
            className="dash-tool"
            onClick={() => navigator.clipboard?.writeText(`${siteOrigin()}/dash`).then(() => setMessage({ type: 'ok', key: 'settings.backup.copied' }))}
            aria-label={t('settings.backup.copy')}
            title={t('settings.backup.copy')}
          >
            <span className="material-symbols-outlined">content_copy</span>
          </button>
        </p>
      </Section>

      <Section title={t('settings.backup.reset')}>
        <div className="dash-row dash-row--wrap">
          {['board', 'all'].map((part) =>
            confirmReset === part ? (
              <span key={part} className="dash-row">
                <button
                  type="button"
                  className="dash-button dash-button--danger dash-button--small"
                  onClick={() => {
                    resetDashSettings(part)
                    setConfirmReset(null)
                    setMessage({ type: 'ok', key: 'settings.backup.resetDone' })
                  }}
                >
                  {t(`settings.backup.resetYes_${part}`)}
                </button>
                <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => setConfirmReset(null)}>
                  {t('settings.cancel')}
                </button>
              </span>
            ) : (
              <button key={part} type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => setConfirmReset(part)}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  restart_alt
                </span>
                {t(`settings.backup.reset_${part}`)}
              </button>
            ),
          )}
          <button
            type="button"
            className="dash-button dash-button--quiet dash-button--small"
            onClick={() => {
              clearDashCache()
              setMessage({ type: 'ok', key: 'settings.backup.cacheCleared' })
            }}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              mop
            </span>
            {t('settings.backup.clearCache')}
          </button>
        </div>
        <p className="dash-hint">
          {t('settings.backup.css')} <Link to="/settings">{t('settings.backup.cssLink')}</Link>
        </p>
      </Section>
      {message && (
        <p className={message.type === 'error' ? 'dash-error' : 'dash-hint dash-ok'} role="status">
          {t(message.key)}
        </p>
      )}
    </div>
  )
}

const siteOrigin = () => (typeof window !== 'undefined' ? window.location.origin : '')

/* ---------- the sheet ---------- */

/* The dash's settings without a dialog: /settings → Dash (pages/Settings.jsx). Search has its own tab there. */
export const CUSTOMIZE_TABS = TABS.filter((entry) => entry.id !== 'search')
export function DashCustomize({ account, owner, loggedIn, tab, onTab, onEditBoard }) {
  const { t } = useTranslation('dash')
  const current = CUSTOMIZE_TABS.some((entry) => entry.id === tab) ? tab : 'look'
  return (
    <div className="dash-embedded">
      <div className="dash-tabs" role="tablist" aria-label={t('settings.title')}>
        {CUSTOMIZE_TABS.map((entry) => (
          <button key={entry.id} type="button" role="tab" id={`dash-tab-${entry.id}`} aria-selected={current === entry.id} aria-controls="dash-tabpanel" className={current === entry.id ? 'is-active' : ''} onClick={() => onTab(entry.id)}>
            <span className="material-symbols-outlined" aria-hidden="true">
              {entry.icon}
            </span>
            <span>{t(`settings.tabs.${entry.id}`)}</span>
          </button>
        ))}
      </div>
      <div className="dash-dialog__body" role="tabpanel" id="dash-tabpanel" aria-labelledby={`dash-tab-${current}`}>
        {current === 'look' && <LookSettings />}
        {current === 'layout' && <LayoutSettings onEditBoard={onEditBoard} />}
        {current === 'top' && <TopSettings />}
        {current === 'pages' && <PagesSettings />}
        {current === 'integrations' && <DashIntegrations loggedIn={loggedIn} />}
        {current === 'music' && (loggedIn ? <MusicSettings /> : <p className="dash-hint">{t('music.login')}</p>)}
        {current === 'backup' && <BackupSettings account={account} owner={owner} />}
      </div>
    </div>
  )
}

/* The dash's search bar: engines, tools, icons (/settings → Search). */
export function DashSearchSettings({ owner }) {
  return (
    <div className="dash-embedded">
      <SearchSettings owner={owner} />
    </div>
  )
}
