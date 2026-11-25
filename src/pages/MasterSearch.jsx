import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'

import { PageTitle } from '../components/SiteLogo.jsx'
import { ACCOUNT_API_URL, accountFetch } from '../lib/account.js'
import { useAccountSettings } from '../lib/accountSettings.jsx'
import { findContacts, useContacts } from '../lib/dashContacts.js'
import { INTEGRATION_KINDS, integrationGet, integrationImage, loadIntegrations } from '../lib/dashIntegrations.js'
import { getDashSettings } from '../lib/dashSettings.js'
import { SEARCH_DEFAULTS } from '../lib/prefs.js'
import { loadSearchIndex, normalize, searchPages } from '../lib/search.js'
import { siteConfig } from '../lib/siteConfig.js'
import '../styles/master-search.css'

/*
 * Master Search (/search): the site's own search, answered by the owner's
 * SearXNG through the account API (server/services/masterSearch.cjs, which
 * is also the open JSON API at /search/api). Everything is in the address
 * (?q=&c=&p=&t=), so a search can be shared. Preferences (safe search,
 * language, new tab, suggestions, infobox, pictures) are `prefs.search`,
 * synced with the account; safe search is strict unless chosen otherwise.
 * Above the web results: what only this site knows (OwnResults): its own
 * pages, and for the person searching their bookmarks, contacts and services
 * (Navidrome, Immich, Jellyfin, Plex, Paperless, …: their `search` actions).
 */

const CATEGORIES = [
  ['general', 'search'],
  ['images', 'image'],
  ['videos', 'smart_display'],
  ['news', 'newspaper'],
  ['maps', 'map'],
  ['music', 'music_note'],
  ['science', 'science'],
  ['it', 'terminal'],
  ['files', 'folder_zip'],
  ['social', 'forum'],
]
/* The first five are always tabs; the rest sit behind "More" (unless one of them is open). */
const PRIMARY = 5
const TIMES = ['', 'day', 'week', 'month', 'year']
const LANGUAGES = ['auto', 'all', 'en', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'ja', 'zh']

function useMasterSearch({ q, category, page, time, prefs }) {
  const [state, setState] = useState({ status: 'idle' })
  useEffect(() => {
    if (!q) return setState({ status: 'idle' })
    const controller = new AbortController()
    setState((current) => ({ ...current, status: 'loading' }))
    const params = new URLSearchParams({ q, category, page: String(page), safesearch: prefs.safesearch, language: prefs.language })
    if (time) params.set('time', time)
    accountFetch(`/search/api?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { fallback: data.fallback })
        setState({ status: 'done', data })
      })
      .catch((error) => error.name !== 'AbortError' && setState({ status: 'error', error: error.message, fallback: error.fallback ?? null }))
    return () => controller.abort()
  }, [q, category, page, time, prefs.safesearch, prefs.language])
  return state
}

function Suggestions({ query, enabled, onPick, open }) {
  const [list, setList] = useState([])
  useEffect(() => {
    if (!enabled || !open || query.trim().length < 2) return setList([])
    const controller = new AbortController()
    const timer = setTimeout(() => {
      accountFetch(`/search/suggest?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
        .then((response) => response.json())
        .then((data) => setList(data.suggestions ?? []))
        .catch(() => {})
    }, 180)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, enabled, open])
  if (!open || !list.length) return null
  return (
    <ul className="ms-suggest" role="listbox">
      {list.map((entry) => (
        <li key={entry} role="option" aria-selected="false">
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onPick(entry)}>
            <span className="material-symbols-outlined" aria-hidden="true">
              search
            </span>
            {entry}
          </button>
        </li>
      ))}
    </ul>
  )
}

const target = (newTab) => (newTab ? { target: '_blank', rel: 'noopener noreferrer' } : { rel: 'noreferrer' })
const favicon = (host) => `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`
function dateText(value, language) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(language, { day: 'numeric', month: 'short', year: 'numeric' })
}

function ResultList({ results, prefs, language, t }) {
  return (
    <ol className="ms-results">
      {results.map((result) => (
        <li key={result.url} className="ms-result">
          <a className="ms-result__link" href={result.url} {...target(prefs.newTab)}>
            <span className="ms-result__site">
              <img src={favicon(result.host)} alt="" width="16" height="16" loading="lazy" referrerPolicy="no-referrer" onError={(event) => (event.currentTarget.style.visibility = 'hidden')} />
              <span className="ms-result__host">{result.host}</span>
              <span className="ms-result__path">{decodeURIComponent(result.url.replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '')).slice(0, 60)}</span>
            </span>
            <span className="ms-result__title">{result.title}</span>
          </a>
          <div className="ms-result__body">
            {prefs.thumbnails && result.thumbnail && <img className="ms-result__thumb" src={result.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => event.currentTarget.remove()} />}
            <p>
              {result.published && <span className="ms-result__date">{dateText(result.published, language)} · </span>}
              {result.content}
            </p>
          </div>
          {(result.engines.length > 0 || (result.latitude !== null && result.longitude !== null)) && (
            <p className="ms-result__meta">
              {result.address && <span>{result.address}</span>}
              {result.latitude !== null && result.longitude !== null && (
                <a href={`https://www.openstreetmap.org/?mlat=${result.latitude}&mlon=${result.longitude}#map=16/${result.latitude}/${result.longitude}`} {...target(prefs.newTab)}>
                  {t('master.onMap')}
                </a>
              )}
              {result.engines.length > 0 && <span className="ms-result__engines">{result.engines.join(', ')}</span>}
            </p>
          )}
        </li>
      ))}
    </ol>
  )
}

function ImageGrid({ results, prefs, t }) {
  const [open, setOpen] = useState(null)
  const ref = useRef(null)
  useEffect(() => {
    if (open) ref.current?.showModal()
  }, [open])
  const pictures = results.filter((result) => result.image || result.thumbnail)
  const index = open ? pictures.indexOf(open) : -1
  return (
    <>
      <ul className="ms-images">
        {pictures.map((result) => (
          <li key={result.url}>
            <button type="button" onClick={() => setOpen(result)} title={result.title}>
              <img src={result.thumbnail || result.image} alt={result.title} loading="lazy" referrerPolicy="no-referrer" onError={(event) => event.currentTarget.closest('li')?.remove()} />
              <span>{result.host}</span>
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <dialog
          ref={ref}
          className="ms-lightbox"
          onClose={() => setOpen(null)}
          onClick={(event) => event.target === ref.current && ref.current.close()}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight' && index < pictures.length - 1) setOpen(pictures[index + 1])
            if (event.key === 'ArrowLeft' && index > 0) setOpen(pictures[index - 1])
          }}
        >
          <img src={open.image || open.thumbnail} alt={open.title} referrerPolicy="no-referrer" />
          <div className="ms-lightbox__info">
            <strong>{open.title}</strong>
            <span>{[open.host, open.resolution].filter(Boolean).join(' · ')}</span>
            <span className="ms-lightbox__actions">
              <a className="ms-button" href={open.url} {...target(true)}>
                {t('master.visit')}
              </a>
              {open.image && (
                <a className="ms-button ms-button--quiet" href={open.image} {...target(true)}>
                  {t('master.fullImage')}
                </a>
              )}
              <button type="button" className="ms-button ms-button--quiet" onClick={() => ref.current?.close()}>
                {t('master.close')}
              </button>
            </span>
          </div>
          {index > 0 && (
            <button type="button" className="ms-lightbox__nav ms-lightbox__nav--prev" onClick={() => setOpen(pictures[index - 1])} aria-label={t('master.previous')}>
              <span className="material-symbols-outlined">chevron_left</span>
            </button>
          )}
          {index < pictures.length - 1 && (
            <button type="button" className="ms-lightbox__nav ms-lightbox__nav--next" onClick={() => setOpen(pictures[index + 1])} aria-label={t('master.next')}>
              <span className="material-symbols-outlined">chevron_right</span>
            </button>
          )}
        </dialog>
      )}
      {!prefs.thumbnails && <p className="ms-hint">{t('master.picturesAnyway')}</p>}
    </>
  )
}

function VideoGrid({ results, prefs, language }) {
  return (
    <ul className="ms-videos">
      {results.map((result) => (
        <li key={result.url}>
          <a href={result.url} {...target(prefs.newTab)}>
            <span className="ms-videos__thumb">
              {result.thumbnail ? <img src={result.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="material-symbols-outlined">smart_display</span>}
              {result.duration && <span className="ms-videos__time">{result.duration}</span>}
            </span>
            <strong>{result.title}</strong>
            <small>{[result.author || result.host, result.published && dateText(result.published, language)].filter(Boolean).join(' · ')}</small>
          </a>
        </li>
      ))}
    </ul>
  )
}

function Infobox({ box, prefs }) {
  return (
    <aside className="ms-infobox">
      {box.image && <img src={box.image} alt="" referrerPolicy="no-referrer" onError={(event) => event.currentTarget.remove()} />}
      <h2>{box.title}</h2>
      {box.content && <p>{box.content}</p>}
      {box.attributes.length > 0 && (
        <dl>
          {box.attributes.map((entry) => (
            <div key={entry.label}>
              <dt>{entry.label}</dt>
              <dd>{entry.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {box.links.length > 0 && (
        <p className="ms-infobox__links">
          {box.links.map((entry) => (
            <a key={entry.url} href={entry.url} {...target(prefs.newTab)}>
              {entry.title || new URL(entry.url).hostname}
            </a>
          ))}
        </p>
      )}
      {box.engine && <small>{box.engine}</small>}
    </aside>
  )
}

/* A strong hit only: a matching title, heading or keyword, not one word somewhere in a text. */
const PAGE_MIN_SCORE = 6

/* Every link in the dash's bookmarks / status widgets (this browser's copy of the synced dash). */
function dashLinks() {
  const seen = new Set()
  const links = []
  for (const widget of getDashSettings().widgets ?? []) {
    for (const item of Array.isArray(widget.options?.items) ? widget.options.items : []) {
      if (!item?.url || seen.has(item.url)) continue
      seen.add(item.url)
      links.push(item)
    }
  }
  return links
}

function findLinks(query) {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  return dashLinks()
    .filter((link) => {
      const text = normalize(`${link.title ?? ''} ${link.url.replace(/^https?:\/\/(www\.)?/, '')} ${link.description ?? ''}`)
      return words.every((word) => text.includes(word))
    })
    .slice(0, 4)
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/* What each kind of integration result looks like when it has no cover. */
const OWN_ICONS = { song: 'music_note', album: 'album', video: 'movie', book: 'menu_book', document: 'description', device: 'sensors', file: 'draft', photo: 'image' }
const OWN_MAX = 8
const PER_SERVICE = 2

/* Your services that can search (shared/dash-integrations.json `provides: search`), asked together; slow or broken ones are left out. */
function useServiceResults(q, loggedIn) {
  const [found, setFound] = useState({ q: '', items: [] })
  useEffect(() => {
    if (!loggedIn || q.trim().length < 2) return
    const controller = new AbortController()
    loadIntegrations().then((state) => {
      const services = state.items.filter((item) => INTEGRATION_KINDS[item.kind]?.provides.includes('search')).slice(0, 8)
      Promise.all(
        services.map((service) =>
          integrationGet(service.id, 'search', { q, size: PER_SERVICE }, controller.signal)
            .then((list) =>
              (Array.isArray(list) ? list : []).slice(0, PER_SERVICE).map((entry) => ({
                key: `i:${service.id}:${entry.id}`,
                label: entry.title || entry.subtitle,
                source: service.name || INTEGRATION_KINDS[service.kind].name,
                detail: [entry.subtitle, service.name || INTEGRATION_KINDS[service.kind].name].filter(Boolean).join(' · '),
                href: entry.link,
                // Immich answers pictures: their own thumbnail is the cover.
                cover: service.kind === 'immich' ? integrationImage(service.id, entry.id, 96) : entry.cover ? integrationImage(service.id, entry.cover, 96) : null,
                icon: OWN_ICONS[service.kind === 'immich' ? 'photo' : entry.type] ?? 'apps',
                photo: service.kind === 'immich',
              })),
            )
            .catch(() => []),
        ),
      ).then((lists) => !controller.signal.aborted && setFound({ q, items: lists.flat().filter((item) => item.label && /^https?:\/\//.test(item.href ?? '')) }))
    })
    return () => controller.abort()
  }, [q, loggedIn])
  return found.q === q ? found.items : []
}

/*
 * What only this site knows, kept small: one quiet row of chips above the
 * web results. Bookmarks, contacts and your services (music, photos, films,
 * documents, devices, files) when logged in; the site's own pages for everyone.
 */
function OwnResults({ q, loggedIn, prefs, language, t }) {
  const [index, setIndex] = useState(null)
  useEffect(() => {
    loadSearchIndex()
      .then(setIndex)
      .catch(() => {})
  }, [])
  const contacts = useContacts({ enabled: loggedIn })
  const services = useServiceResults(q, loggedIn)
  const chips = useMemo(() => {
    const tokens = normalize(q).split(/\s+/).filter(Boolean)
    const pages = index
      ? searchPages(index, q, language)
          .filter((page) => page.score >= PAGE_MIN_SCORE)
          .slice(0, 2)
          .map((page) => ({ key: `p:${page.id}`, icon: 'article', label: page.title, detail: page.path, to: page.path, state: { searchHighlight: { id: page.id, text: page.matches[0]?.text ?? null, tokens } } }))
      : []
    const links = loggedIn ? findLinks(q).slice(0, 2).map((link) => ({ key: `l:${link.url}`, favicon: hostOf(link.url), label: link.title || hostOf(link.url), detail: hostOf(link.url), href: link.url })) : []
    const people = loggedIn
      ? findContacts(contacts.contacts, q, 2).flatMap((contact) => {
          const phone = contact.phones?.[0]?.value
          const email = contact.emails?.[0]?.value
          const href = phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : email ? `mailto:${email}` : null
          return href ? [{ key: `c:${contact.id}`, icon: phone ? 'call' : 'mail', label: contact.name, detail: phone || email, href }] : []
        })
      : []
    // What the person put there first, then their services, then the site's pages.
    return [...links, ...people, ...services, ...pages].slice(0, OWN_MAX)
  }, [index, q, language, loggedIn, contacts.contacts, services])
  if (!chips.length) return null
  return (
    <nav className="ms-own" aria-label={t('master.own.label')}>
      {chips.map((chip) => {
        const inside = (
          <>
            {chip.cover ? (
              <img className={`ms-own__cover${chip.photo ? ' is-photo' : ''}`} src={chip.cover} alt="" width="20" height="20" loading="lazy" onError={(event) => event.currentTarget.replaceWith(Object.assign(document.createElement('span'), { className: 'material-symbols-outlined', textContent: chip.icon }))} />
            ) : chip.favicon ? (
              <img src={favicon(chip.favicon)} alt="" width="16" height="16" loading="lazy" referrerPolicy="no-referrer" onError={(event) => (event.currentTarget.style.visibility = 'hidden')} />
            ) : (
              <span className="material-symbols-outlined" aria-hidden="true">
                {chip.icon}
              </span>
            )}
            <span className="ms-own__label">{chip.label}</span>
            {chip.source && <small className="ms-own__source">{chip.source}</small>}
          </>
        )
        return chip.to ? (
          <Link key={chip.key} to={chip.to} state={chip.state} title={chip.detail}>
            {inside}
          </Link>
        ) : (
          <a key={chip.key} href={chip.href} title={chip.detail} {...(chip.href.startsWith('http') ? target(prefs.newTab) : {})}>
            {inside}
          </a>
        )
      })}
    </nav>
  )
}

/* Why the backup engine answered, or why it couldn't help. */
function FallbackNote({ source, fallback, t }) {
  const key = source === 'brave' ? 'brave' : fallback && fallback !== 'nothing' ? fallback : null
  if (!key) return null
  return (
    <p className="ms-hint ms-fallback">
      <span className="material-symbols-outlined" aria-hidden="true">
        {key === 'brave' ? 'swap_horiz' : 'info'}
      </span>
      {t(`master.fallback.${key}`)}
    </p>
  )
}

/* All, Images, Videos, News, Maps as tabs; the rest in a small menu, so the row fits the centred column. */
function Tabs({ category, go, t, hidden }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = (event) => !wrap.current?.contains(event.target) && setOpen(false)
    const key = (event) => event.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  const shown = CATEGORIES.filter(([id]) => id === 'general' || !hidden.includes(id))
  const primary = shown.slice(0, PRIMARY)
  const more = shown.slice(PRIMARY)
  // A hidden tab that is open (an old link) still shows, so it's clear where you are.
  const stray = CATEGORIES.find(([id]) => id === category && !shown.some(([other]) => other === id))
  const current = more.find(([id]) => id === category)
  const tab = ([id, icon]) => (
    <button key={id} type="button" className={category === id ? 'is-active' : ''} aria-current={category === id ? 'page' : undefined} onClick={() => go({ c: id, p: 1 })}>
      <span className="material-symbols-outlined" aria-hidden="true">
        {icon}
      </span>
      {t(`master.category.${id}`)}
    </button>
  )
  return (
    <nav className="ms-tabs" aria-label={t('master.categories')}>
      {primary.map(tab)}
      {current && tab(current)}
      {stray && tab(stray)}
      {more.length > 0 && (
        <div className="ms-tabs__more" ref={wrap}>
          <button type="button" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
            {t('master.more')}
            <span className="material-symbols-outlined" aria-hidden="true">
              expand_more
            </span>
          </button>
          {open && (
            <div className="ms-menu" role="menu">
              {more.map(([id, icon]) => (
                <button key={id} type="button" role="menuitemradio" aria-checked={category === id} onClick={() => (setOpen(false), go({ c: id, p: 1 }))}>
                  <span className="material-symbols-outlined" aria-hidden="true">
                    {icon}
                  </span>
                  {t(`master.category.${id}`)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </nav>
  )
}

function Related({ list, go, t, className = '' }) {
  return (
    <section className={`ms-related ${className}`}>
      <h2>{t('master.related')}</h2>
      <ul>
        {list.map((entry) => (
          <li key={entry}>
            <button type="button" onClick={() => go({ q: entry, p: 1 })}>
              <span className="material-symbols-outlined" aria-hidden="true">
                search
              </span>
              {entry}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Preferences({ prefs, setPrefs, t, onClose, language: siteLanguage }) {
  const set = (patch) => setPrefs({ search: { ...prefs, ...patch } })
  return (
    <div className="ms-prefs" role="dialog" aria-label={t('master.preferences')}>
      <fieldset>
        <legend>{t('master.safesearch')}</legend>
        <div className="ms-segment">
          {['strict', 'moderate', 'off'].map((choice) => (
            <button key={choice} type="button" aria-pressed={prefs.safesearch === choice} onClick={() => set({ safesearch: choice })}>
              {t(`master.safe.${choice}`)}
            </button>
          ))}
        </div>
        <small>{t(`master.safeHint.${prefs.safesearch}`)}</small>
      </fieldset>
      <label>
        <span>{t('master.language')}</span>
        <select value={prefs.language} onChange={(event) => set({ language: event.target.value })}>
          {LANGUAGES.map((code) => (
            <option key={code} value={code}>
              {code === 'auto' || code === 'all' ? t(`master.languages.${code}`) : (new Intl.DisplayNames([siteLanguage], { type: 'language' }).of(code) ?? code)}
            </option>
          ))}
        </select>
      </label>
      {[
        ['newTab', 'master.newTab'],
        ['suggest', 'master.suggest'],
        ['infobox', 'master.infoboxPref'],
        ['thumbnails', 'master.thumbnails'],
      ].map(([key, label]) => (
        <label key={key} className="ms-check">
          <input type="checkbox" checked={Boolean(prefs[key])} onChange={(event) => set({ [key]: event.target.checked })} />
          <span>{t(label)}</span>
        </label>
      ))}
      <fieldset>
        <legend>{t('master.tabsPref')}</legend>
        <div className="ms-tab-picks">
          {CATEGORIES.map(([id, icon]) => {
            const on = id === 'general' || !prefs.hiddenTabs.includes(id)
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                disabled={id === 'general'}
                onClick={() => set({ hiddenTabs: on ? [...prefs.hiddenTabs, id] : prefs.hiddenTabs.filter((other) => other !== id) })}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  {on ? 'check' : icon}
                </span>
                {t(`master.category.${id}`)}
              </button>
            )
          })}
        </div>
        <small>{t('master.tabsHint')}</small>
      </fieldset>
      <p className="ms-hint">{t('master.prefsSaved')}</p>
      <button type="button" className="ms-button ms-button--quiet" onClick={onClose}>
        {t('master.done')}
      </button>
    </div>
  )
}

export default function MasterSearch() {
  const { t, i18n } = useTranslation('search')
  const { prefs: allPrefs, setPrefs, account } = useAccountSettings()
  const loggedIn = Boolean(account && !account.local && !account.isAdminSession)
  const prefs = { ...SEARCH_DEFAULTS, ...(allPrefs.search ?? {}) }
  if (!Array.isArray(prefs.hiddenTabs)) prefs.hiddenTabs = []
  const [params, setParams] = useSearchParams()
  const q = (params.get('q') ?? '').trim().slice(0, 400)
  const category = CATEGORIES.some(([id]) => id === params.get('c')) ? params.get('c') : 'general'
  const page = Math.min(20, Math.max(1, Number(params.get('p')) || 1))
  const time = TIMES.includes(params.get('t') ?? '') ? (params.get('t') ?? '') : ''
  const [draft, setDraft] = useState(q)
  const [focused, setFocused] = useState(false)
  const [showPrefs, setShowPrefs] = useState(false)
  const input = useRef(null)
  const state = useMasterSearch({ q, category, page, time, prefs })
  const data = state.data
  useEffect(() => setDraft(q), [q])
  // "/" focuses the box from anywhere on the page.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === '/' && !event.target.closest?.('input, textarea, select, [contenteditable]')) {
        event.preventDefault()
        input.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const go = (next) => {
    const merged = { q, c: category, p: 1, t: time, ...next }
    const clean = Object.fromEntries(Object.entries(merged).filter(([key, value]) => value && !(key === 'c' && value === 'general') && !(key === 'p' && Number(value) === 1)))
    setParams(clean)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const submit = (event) => {
    event?.preventDefault()
    const text = draft.trim()
    if (text) go({ q: text, p: 1 })
    input.current?.blur()
  }
  const title = q ? `${q} – ${t('title:search')}` : t('title:search')
  const isGrid = category === 'images' || category === 'videos'
  const results = useMemo(() => data?.results ?? [], [data])

  if (!siteConfig.masterSearch)
    return (
      <main className="ms-page">
        <p className="ms-hint">{t('master.off')}</p>
      </main>
    )

  return (
    <>
      <title>{title}</title>
      <header className="head">
        <PageTitle text={t('title:search')} />
      </header>
      <main className={`ms-page${q ? ' has-query' : ''}`}>
        <div className="ms-head">
          <form className="ms-box" role="search" onSubmit={submit}>
            <span className="material-symbols-outlined" aria-hidden="true">
              search
            </span>
            <input
              ref={input}
              type="search"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={t('master.placeholder')}
              aria-label={t('master.placeholder')}
              autoFocus={!q}
              enterKeyHint="search"
              maxLength={400}
            />
            {draft && (
              <button type="button" className="ms-box__clear" onClick={() => (setDraft(''), input.current?.focus())} aria-label={t('clear')}>
                <span className="material-symbols-outlined">close</span>
              </button>
            )}
            <button type="submit" className="ms-box__go" aria-label={t('master.search')}>
              <span className="material-symbols-outlined">arrow_forward</span>
            </button>
            <Suggestions query={draft} enabled={prefs.suggest} open={focused && draft !== q} onPick={(entry) => (setDraft(entry), go({ q: entry, p: 1 }), input.current?.blur())} />
          </form>

          {q && <Tabs category={category} go={go} t={t} hidden={prefs.hiddenTabs} />}

          {q && (
            <div className="ms-toolbar">
              <label className="ms-select">
                <span className="material-symbols-outlined" aria-hidden="true">
                  schedule
                </span>
                <select value={time} onChange={(event) => go({ t: event.target.value, p: 1 })} aria-label={t('master.time')}>
                  {TIMES.map((choice) => (
                    <option key={choice || 'any'} value={choice}>
                      {t(`master.times.${choice || 'any'}`)}
                    </option>
                  ))}
                </select>
              </label>
              <span className={`ms-chip${prefs.safesearch === 'off' ? ' is-off' : ''}`} title={t(`master.safeHint.${prefs.safesearch}`)}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  {prefs.safesearch === 'off' ? 'shield_question' : 'verified_user'}
                </span>
                {t('master.safeShort', { level: t(`master.safe.${prefs.safesearch}`) })}
              </span>
              <span className="ms-toolbar__space" />
              {data?.total > 0 && category === 'general' && <span className="ms-count">{t('master.about', { count: data.total, formatted: data.total.toLocaleString(i18n.language) })}</span>}
              <div className="ms-prefs-wrap">
                <button type="button" className="ms-icon-button" aria-expanded={showPrefs} onClick={() => setShowPrefs(!showPrefs)} aria-label={t('master.preferences')} title={t('master.preferences')}>
                  <span className="material-symbols-outlined" aria-hidden="true">
                    tune
                  </span>
                </button>
                {showPrefs && <Preferences prefs={prefs} setPrefs={setPrefs} t={t} language={i18n.language} onClose={() => setShowPrefs(false)} />}
              </div>
            </div>
          )}
        </div>

        {!q && (
          <section className="ms-start">
            <p>{t('master.intro')}</p>
            <p className="ms-hint">
              {t('master.apiHint')} <a href={`${ACCOUNT_API_URL}/search/api`}>/search/api</a>
            </p>
            <button type="button" className="ms-button ms-button--quiet" onClick={() => setShowPrefs(!showPrefs)}>
              <span className="material-symbols-outlined" aria-hidden="true">
                tune
              </span>
              {t('master.preferences')}
            </button>
            {showPrefs && <Preferences prefs={prefs} setPrefs={setPrefs} t={t} language={i18n.language} onClose={() => setShowPrefs(false)} />}
          </section>
        )}

        {q && (state.status === 'error' || (category === 'general' && page === 1)) && (
          <div className="ms-column">
            {state.status === 'error' && (
              <p className="ms-error" role="alert">
                <span className="material-symbols-outlined" aria-hidden="true">
                  cloud_off
                </span>
                {state.error}
              </p>
            )}
            {state.status === 'error' && <FallbackNote fallback={state.fallback} t={t} />}
            {category === 'general' && page === 1 && <OwnResults q={q} loggedIn={loggedIn} prefs={prefs} language={i18n.language} t={t} />}
          </div>
        )}

        {q && data && (
          <div className={`ms-body${isGrid ? ' is-grid' : ''}`} aria-busy={state.status === 'loading'}>
            <div className="ms-main">
              {data.corrections.length > 0 && (
                <p className="ms-correction">
                  {t('master.didYouMean')}{' '}
                  {data.corrections.map((entry) => (
                    <button key={entry} type="button" className="ms-link" onClick={() => go({ q: entry, p: 1 })}>
                      {entry}
                    </button>
                  ))}
                </p>
              )}
              {data.answers.map((answer, index) => (
                <p key={index} className="ms-answer">
                  {answer.text}
                  {answer.url && (
                    <a href={answer.url} {...target(prefs.newTab)}>
                      {new URL(answer.url).hostname}
                    </a>
                  )}
                </p>
              ))}
              <FallbackNote source={data.source} fallback={data.fallback} t={t} />
              {!results.length && state.status === 'done' && <p className="ms-hint ms-empty">{t('master.nothing')}</p>}
              {category === 'images' ? <ImageGrid results={results} prefs={prefs} t={t} /> : category === 'videos' ? <VideoGrid results={results} prefs={prefs} language={i18n.language} /> : <ResultList results={results} prefs={prefs} language={i18n.language} t={t} />}
              {results.length > 0 && (
                <nav className="ms-pages" aria-label={t('master.pagesLabel')}>
                  <button type="button" className="ms-button ms-button--quiet" disabled={page <= 1} onClick={() => go({ p: page - 1 })}>
                    <span className="material-symbols-outlined" aria-hidden="true">
                      chevron_left
                    </span>
                    {t('master.previous')}
                  </button>
                  <span>{t('master.page', { page })}</span>
                  <button type="button" className="ms-button ms-button--quiet" disabled={page >= 20} onClick={() => go({ p: page + 1 })}>
                    {t('master.next')}
                    <span className="material-symbols-outlined" aria-hidden="true">
                      chevron_right
                    </span>
                  </button>
                </nav>
              )}
              {!isGrid && data.suggestions.length > 0 && <Related list={data.suggestions} go={go} t={t} className="ms-related--end" />}
              {data.unresponsive.length > 0 && <p className="ms-hint ms-unresponsive">{t('master.unresponsive', { list: data.unresponsive.join(', ') })}</p>}
            </div>
            {!isGrid && ((prefs.infobox && data.infobox) || data.suggestions.length > 0) && (
              <aside className="ms-side">
                {prefs.infobox && data.infobox && <Infobox box={data.infobox} prefs={prefs} />}
                {data.suggestions.length > 0 && <Related list={data.suggestions} go={go} t={t} />}
              </aside>
            )}
          </div>
        )}
        {q && !data && state.status === 'loading' && (
          <div className="ms-loading ms-column" aria-label={t('loading')}>
            {Array.from({ length: 6 }, (_, index) => (
              <span key={index} className="skeleton skeleton--text" />
            ))}
          </div>
        )}
        <p className="ms-foot">
          {t('master.powered')} · <a href={`${ACCOUNT_API_URL}/search/api`}>{t('master.api')}</a> · <Link to="/privacy">{t('master.privacy')}</Link>
        </p>
      </main>
    </>
  )
}
