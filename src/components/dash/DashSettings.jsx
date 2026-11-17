import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import DashIntegrations from './DashIntegrations.jsx'
import { clearDashCache } from './kit.jsx'
import {
  LOOK_CHOICES,
  LOOK_DEFAULTS,
  MAX_PAGES,
  TOP_CHOICES,
  TOP_DEFAULTS,
  addPage,
  DASH_SYNC_LIMIT,
  buildSearchUrl,
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
 *   Layout        the grid (columns, row height, gap, width, gravity) and
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
      </Section>

      <Section title={t('settings.look.type')}>
        <Segment label={t('settings.look.font')} value={look.font} options={LOOK_CHOICES.font} onChange={(font) => updateLook({ font })} />
        <Range label={t('settings.look.fontScale')} value={look.fontScale} min={80} max={130} step={5} unit="%" onChange={(fontScale) => updateLook({ fontScale })} />
        <ColorInput label={t('settings.look.accent')} value={look.accent} fallback="#8b5cf6" onChange={(accent) => updateLook({ accent })} onReset={() => updateLook({ accent: '' })} resetLabel={t('settings.look.accentReset')} />
        <p className="dash-hint">{t('settings.look.accentHint')}</p>
      </Section>

      <Section title={t('settings.look.background')}>
        <Segment label={t('settings.look.backgroundKind')} value={look.background} options={LOOK_CHOICES.background} onChange={(background) => updateLook({ background })} />
        {look.background === 'color' && <ColorInput label={t('settings.look.color')} value={look.backgroundValue} fallback="#1a1030" onChange={(backgroundValue) => updateLook({ backgroundValue })} />}
        {look.background === 'gradient' && (
          <>
            <ColorInput label={t('settings.look.from')} value={look.gradientFrom} fallback={LOOK_DEFAULTS.gradientFrom} onChange={(gradientFrom) => updateLook({ gradientFrom })} />
            <ColorInput label={t('settings.look.to')} value={look.gradientTo} fallback={LOOK_DEFAULTS.gradientTo} onChange={(gradientTo) => updateLook({ gradientTo })} />
            <Range label={t('settings.look.angle')} value={look.gradientAngle} min={0} max={360} step={5} unit="°" onChange={(gradientAngle) => updateLook({ gradientAngle })} />
          </>
        )}
        {look.background === 'image' && (
          <>
            <label className="dash-field">
              <span className="dash-field__label">{t('settings.look.imageUrl')}</span>
              <input type="url" value={look.backgroundValue} placeholder="https://…" onChange={(event) => updateLook({ backgroundValue: event.target.value })} />
              <span className="dash-hint">{t('settings.look.imageHint')}</span>
            </label>
            <Segment label={t('settings.look.fit')} value={look.backgroundFit} options={LOOK_CHOICES.backgroundFit} onChange={(backgroundFit) => updateLook({ backgroundFit })} />
            <Range label={t('settings.look.dim')} value={look.dim} min={0} max={80} unit="%" onChange={(dim) => updateLook({ dim })} />
            <Range label={t('settings.look.backgroundBlur')} value={look.backgroundBlur} min={0} max={30} unit="px" onChange={(backgroundBlur) => updateLook({ backgroundBlur })} />
          </>
        )}
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
  const { look, pages, widgets } = useDashSettings()
  const phoneArranged = widgets.some((widget) => widget.sm)
  return (
    <div className="dash-panel">
      <Section title={t('settings.layout.grid')}>
        <Range label={t('settings.layout.columns')} value={look.columns} min={4} max={24} onChange={(columns) => updateLook({ columns })} />
        <p className="dash-hint">{t('settings.layout.columnsHint')}</p>
        <Range label={t('settings.layout.rowHeight')} value={look.rowHeight} min={32} max={200} step={4} unit="px" onChange={(rowHeight) => updateLook({ rowHeight })} />
        <Range label={t('settings.layout.gap')} value={look.gap} min={0} max={40} unit="px" onChange={(gap) => updateLook({ gap })} />
        <Segment label={t('settings.layout.width')} value={look.width} options={LOOK_CHOICES.width} onChange={(width) => updateLook({ width })} />
        <Toggle label={t('settings.layout.gravity')} hint={t('settings.layout.gravityHint')} checked={look.gravity} onChange={(gravity) => updateLook({ gravity })} />
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
      <Section title={t('settings.layout.board')}>
        <p className="dash-hint">{t('settings.layout.boardHelp', { count: widgets.length, pages: pages.length })}</p>
        <button type="button" className="dash-button" onClick={onEditBoard}>
          <span className="material-symbols-outlined" aria-hidden="true">
            edit
          </span>
          {t('settings.layout.editOnPage')}
        </button>
      </Section>
      <button type="button" className="dash-link-button" onClick={() => updateLook({ columns: LOOK_DEFAULTS.columns, rowHeight: LOOK_DEFAULTS.rowHeight, gap: LOOK_DEFAULTS.gap, width: LOOK_DEFAULTS.width, phoneColumns: LOOK_DEFAULTS.phoneColumns, gravity: LOOK_DEFAULTS.gravity })}>
        {t('settings.resetPart')}
      </button>
    </div>
  )
}

/* ---------- Top ---------- */

/* A picture file -> a small square PNG (data: URL) for the tab icon; it syncs with the dash. */
async function iconFromFile(file) {
  if (!file.type.startsWith('image/') || file.size > 8_000_000) throw new Error('not-an-image')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
    await image.decode()
    for (const size of [64, 48, 32]) {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const context = canvas.getContext('2d')
      const scale = Math.min(size / (image.naturalWidth || size), size / (image.naturalHeight || size))
      const w = (image.naturalWidth || size) * scale
      const h = (image.naturalHeight || size) * scale
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, (size - w) / 2, (size - h) / 2, w, h)
      const data = canvas.toDataURL('image/png')
      if (data.length <= 40_000) return data
    }
    throw new Error('too-big')
  } finally {
    URL.revokeObjectURL(url)
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
              const data = await iconFromFile(file)
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

function TopSettings() {
  const { t } = useTranslation('dash')
  const { top } = useDashSettings()
  return (
    <div className="dash-panel">
      <Section title={t('settings.top.page')}>
        <Toggle label={t('settings.top.showHeader')} checked={top.showHeader} onChange={(showHeader) => updateTop({ showHeader })} />
        <label className="dash-field">
          <span className="dash-field__label">{t('settings.top.tabTitle')}</span>
          <input value={top.tabTitle} maxLength={80} placeholder="Dash – MrKoby07" onChange={(event) => updateTop({ tabTitle: event.target.value })} />
        </label>
        <TabIconField value={top.tabIcon} />
        <Segment label={t('settings.top.align')} value={top.align} options={TOP_CHOICES.align} onChange={(align) => updateTop({ align })} />
        <Segment label={t('settings.top.size')} value={top.size} options={TOP_CHOICES.size} onChange={(size) => updateTop({ size })} />
        <Segment label={t('settings.top.actions')} value={top.actions} options={TOP_CHOICES.actions} onChange={(actions) => updateTop({ actions })} />
      </Section>
      <Section title={t('settings.top.clock')}>
        <Segment label={t('settings.top.clockShow')} value={top.clock} options={TOP_CHOICES.clock} onChange={(clock) => updateTop({ clock })} />
        {top.clock !== 'off' && <Segment label={t('settings.top.hourFormat')} value={top.hourFormat} options={TOP_CHOICES.hourFormat} prefix="fields.choices" onChange={(hourFormat) => updateTop({ hourFormat })} />}
        <Segment label={t('settings.top.date')} value={top.date} options={TOP_CHOICES.date} onChange={(date) => updateTop({ date })} />
        <p className="dash-hint">
          {t('settings.top.zoneHint')} <Link to="/cult/settings">{t('settings.top.zoneLink')}</Link>
        </p>
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

function SearchSettings({ owner }) {
  const { t } = useTranslation('dash')
  const settings = useDashSettings()
  const [editing, setEditing] = useState(null) // provider being edited, or EMPTY_PROVIDER
  const list = settings.providers

  const setList = (providers) => updateDashSettings({ providers })
  const move = (index, offset) => {
    const target = index + offset
    if (target < 0 || target >= list.length) return
    const next = [...list]
    ;[next[index], next[target]] = [next[target], next[index]]
    setList(next)
  }

  return (
    <div className="dash-panel">
      <Section title={t('settings.search.providers')}>
        <p className="dash-hint">{t('settings.search.providersHelp')}</p>
        <ul className="dash-list">
          {list.map((provider, index) => {
            const active = provider.id === settings.activeProviderId
            return (
              <li key={provider.id} className={provider.hidden ? 'is-hidden' : ''}>
                <button
                  type="button"
                  className={`dash-radio${active ? ' is-active' : ''}`}
                  onClick={() => updateDashSettings({ activeProviderId: provider.id, providers: list.map((item) => (item.id === provider.id ? { ...item, hidden: false } : item)) })}
                  title={t('settings.search.makeDefault')}
                  aria-label={t('settings.search.makeDefault')}
                  aria-pressed={active}
                />
                <span className="dash-list__name">
                  <strong>{provider.name}</strong>
                  <small>
                    {provider.keyword && <code>!{provider.keyword}</code>} {provider.builtin ? t('settings.search.builtin') : ''}
                  </small>
                </span>
                <button type="button" className="dash-tool" onClick={() => move(index, -1)} disabled={index === 0} aria-label={t('settings.moveUp')} title={t('settings.moveUp')}>
                  <span className="material-symbols-outlined">arrow_upward</span>
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
                {!provider.builtin && (
                  <button type="button" className="dash-tool dash-tool--danger" disabled={active} onClick={() => setList(list.filter((item) => item.id !== provider.id))} aria-label={t('settings.delete')} title={t('settings.delete')}>
                    <span className="material-symbols-outlined">delete</span>
                  </button>
                )}
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
        ) : (
          <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => setEditing(EMPTY_PROVIDER)}>
            <span className="material-symbols-outlined" aria-hidden="true">
              add
            </span>
            {t('settings.search.addProvider')}
          </button>
        )}
      </Section>

      <Section title={t('settings.search.behaviour')}>
        <Toggle label={t('settings.search.newTab')} checked={settings.openInNewTab} onChange={(openInNewTab) => updateDashSettings({ openInNewTab })} />
        <Toggle label={t('settings.search.siteResults')} hint={t('settings.search.siteResultsHint')} checked={settings.siteResults} onChange={(siteResults) => updateDashSettings({ siteResults })} />
        {owner && <Toggle label={t('settings.search.discordLookup')} hint={t('settings.search.discordLookupHint')} checked={settings.discordLookup} onChange={(discordLookup) => updateDashSettings({ discordLookup })} />}
        {!visibleProviders(settings).length && <p className="dash-error">{t('settings.search.noneVisible')}</p>}
        <p className="dash-hint">{t('settings.search.keys')}</p>
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
        <span className="material-symbols-outlined">{page.icon}</span>
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
          {t('settings.backup.css')} <Link to="/cult/settings#css">{t('settings.backup.cssLink')}</Link>
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

export default function DashSettings({ account, owner, loggedIn, initialTab = 'look', onClose, onEditBoard }) {
  const { t } = useTranslation('dash')
  const [tab, setTab] = useState(TABS.some((entry) => entry.id === initialTab) ? initialTab : 'look')
  const ref = useRef(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])

  return (
    <dialog ref={ref} className="dash-dialog dash-sheet" onClose={onClose} aria-labelledby="dash-settings-title" onClick={(event) => event.target === ref.current && ref.current.close()}>
      <header className="dash-dialog__head">
        <span className="material-symbols-outlined" aria-hidden="true">
          tune
        </span>
        <h2 id="dash-settings-title">{t('settings.title')}</h2>
        <button type="button" className="dash-tool" onClick={() => ref.current?.close()} aria-label={t('settings.close')}>
          <span className="material-symbols-outlined">close</span>
        </button>
      </header>
      <div className="dash-tabs" role="tablist" aria-label={t('settings.title')}>
        {TABS.map((entry) => (
          <button key={entry.id} type="button" role="tab" id={`dash-tab-${entry.id}`} aria-selected={tab === entry.id} aria-controls="dash-tabpanel" className={tab === entry.id ? 'is-active' : ''} onClick={() => setTab(entry.id)}>
            <span className="material-symbols-outlined" aria-hidden="true">
              {entry.icon}
            </span>
            <span>{t(`settings.tabs.${entry.id}`)}</span>
          </button>
        ))}
      </div>
      <div className="dash-dialog__body" role="tabpanel" id="dash-tabpanel" aria-labelledby={`dash-tab-${tab}`}>
        {tab === 'look' && <LookSettings />}
        {tab === 'layout' && (
          <LayoutSettings
            onEditBoard={() => {
              ref.current?.close()
              onEditBoard()
            }}
          />
        )}
        {tab === 'top' && <TopSettings />}
        {tab === 'search' && <SearchSettings owner={owner} />}
        {tab === 'pages' && <PagesSettings />}
        {tab === 'integrations' && <DashIntegrations loggedIn={loggedIn} />}
        {tab === 'backup' && <BackupSettings account={account} owner={owner} />}
      </div>
    </dialog>
  )
}
