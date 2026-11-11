import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import {
  highlightParts,
  loadSearchIndex,
  normalize,
  parseQuery,
  searchPages,
  searchProfiles,
} from '../lib/search.js'
import '../styles/search.css'

const HIGHLIGHT_NAME = 'search-result'

function Highlighted({ text, tokens }) {
  return highlightParts(text, tokens).map((part, index) =>
    part.match ? <mark key={index}>{part.text}</mark> : part.text,
  )
}

/**
 * Bare site search bar (input + results panel), with no card around it;
 * use `SearchCard` for the card-wrapped version. Searches the generated page
 * index (`pnpm search:index`) plus a placeholder profile search, ranked by relevance.
 */
export default function Search({ className = '', autoFocus = false }) {
  const { t, i18n } = useTranslation('search')
  const navigate = useNavigate()
  const listId = useId()
  const rootRef = useRef(null)
  const inputRef = useRef(null)

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [index, setIndex] = useState(null)
  const [status, setStatus] = useState('idle') // idle | loading | ready | error
  const [profileResult, setProfileResult] = useState({ phrase: '', profiles: [] })

  const deferredQuery = useDeferredValue(query)
  const parsed = useMemo(() => parseQuery(deferredQuery), [deferredQuery])
  const hasQuery = parsed.tokens.length > 0

  const ensureIndex = () => {
    if (index || status === 'loading') return
    setStatus('loading')
    loadSearchIndex()
      .then((data) => {
        setIndex(data)
        setStatus('ready')
      })
      .catch((error) => {
        console.error('[search]', error)
        setStatus('error')
      })
  }

  const pages = useMemo(
    () => (index ? searchPages(index, parsed, i18n.language) : []),
    [index, parsed, i18n.language],
  )

  // Profile search is async (a real API later), so guard against stale replies.
  useEffect(() => {
    if (!hasQuery) return

    const controller = new AbortController()
    searchProfiles(parsed, { signal: controller.signal })
      .then((profiles) => {
        if (!controller.signal.aborted) setProfileResult({ phrase: parsed.phrase, profiles })
      })
      .catch(() => {})

    return () => controller.abort()
  }, [parsed, hasQuery])

  const profiles = useMemo(
    () => (hasQuery && profileResult.phrase === parsed.phrase ? profileResult.profiles : []),
    [hasQuery, profileResult, parsed.phrase],
  )

  // One flat list of everything selectable, for keyboard navigation.
  const options = useMemo(() => {
    const list = []
    for (const page of pages) {
      list.push({ key: page.id, kind: 'page', page })
      for (const match of page.matches) {
        list.push({ key: `${page.id}#${match.id}`, kind: 'match', page, match })
      }
    }
    for (const profile of profiles) list.push({ key: profile.id, kind: 'profile', profile })
    return list
  }, [pages, profiles])

  const optionIndex = useMemo(
    () => new Map(options.map((option, position) => [option.key, position])),
    [options],
  )

  const clampedActive = Math.min(activeIndex, Math.max(options.length - 1, 0))
  const showPanel = open && query.trim().length > 0

  // Ctrl/Cmd + K focuses the search from anywhere.
  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // Keep the active option visible while arrowing through the list.
  useEffect(() => {
    if (!showPanel) return
    document.getElementById(`${listId}-${clampedActive}`)?.scrollIntoView({ block: 'nearest' })
  }, [clampedActive, showPanel, listId])

  const openOption = (option) => {
    if (!option) return

    const path = option.kind === 'profile' ? option.profile.path : option.page.path
    const highlight =
      option.kind === 'match'
        ? { id: option.match.id, text: option.match.text, tokens: parsed.tokens }
        : option.kind === 'page'
          ? { id: option.page.id, text: option.page.matches[0]?.text ?? null, tokens: parsed.tokens }
          : null

    setOpen(false)
    inputRef.current?.blur()
    navigate(path, { state: highlight ? { searchHighlight: highlight } : undefined })
  }

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      if (!options.length) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((clampedActive + step + options.length) % options.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      openOption(options[clampedActive])
    } else if (event.key === 'Escape') {
      if (showPanel) setOpen(false)
      else setQuery('')
    }
  }

  const optionProps = (option) => {
    const position = optionIndex.get(option.key)
    return {
      id: `${listId}-${position}`,
      role: 'option',
      'aria-selected': position === clampedActive,
      onMouseEnter: () => setActiveIndex(position),
      onMouseDown: (event) => event.preventDefault(), // keep input focus
      onClick: () => openOption(option),
    }
  }

  const resultCount = pages.length + profiles.length
  const isTyping = query !== deferredQuery

  return (
    <div ref={rootRef} className={`site-search ${className}`.trim()}>
      <form className="site-search__form" role="search" onSubmit={(event) => event.preventDefault()}>
        <span className="material-symbols-outlined site-search__icon" aria-hidden="true">search</span>
        <input
          ref={inputRef}
          className="site-search__input"
          type="search"
          role="combobox"
          aria-label={t('label')}
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showPanel && options.length ? `${listId}-${clampedActive}` : undefined}
          placeholder={t('placeholder')}
          value={query}
          autoComplete="off"
          spellCheck="false"
          enterKeyHint="search"
          autoFocus={autoFocus}
          onFocus={() => {
            ensureIndex()
            setOpen(true)
          }}
          onChange={(event) => {
            ensureIndex()
            setQuery(event.target.value)
            setActiveIndex(0)
            setOpen(true)
          }}
          onKeyDown={onKeyDown}
        />
        {query ? (
          <button
            type="button"
            className="site-search__clear"
            aria-label={t('clear')}
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
          >
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        ) : (
          <kbd className="site-search__kbd" aria-hidden="true">{t('shortcut')}</kbd>
        )}
      </form>

      {showPanel && (
        <div className="site-search__panel">
          {status === 'loading' && <p className="site-search__status">{t('loading')}</p>}
          {status === 'error' && <p className="site-search__status site-search__status--error">{t('loadError')}</p>}

          {status === 'ready' && hasQuery && resultCount === 0 && !isTyping && (
            <p className="site-search__status">{t('noResults', { query: query.trim() })}</p>
          )}

          <div id={listId} role="listbox" aria-label={t('label')} className="site-search__results">
            {pages.length > 0 && (
              <div role="group" aria-label={t('pages')} className="site-search__group">
                <p className="site-search__group-title" aria-hidden="true">{t('pages')}</p>

                {pages.map((page) => (
                  <div key={page.id} className="site-search__page">
                    <div className="site-search__option site-search__option--page" {...optionProps({ key: page.id, kind: 'page', page })}>
                      <div className="site-search__option-main">
                        <span className="site-search__title">
                          <Highlighted text={page.title} tokens={parsed.tokens} />
                        </span>
                        <code className="site-search__path">{page.path}</code>
                      </div>
                      {page.matches.length === 0 && page.description && (
                        <p className="site-search__description">{page.description}</p>
                      )}
                      {page.aliases.length > 0 && (
                        <p className="site-search__aliases">{t('alsoAt', { paths: page.aliases.join(', ') })}</p>
                      )}
                      <span className="material-symbols-outlined site-search__chevron" aria-hidden="true">chevron_right</span>
                    </div>

                    {page.matches.length > 0 && (
                      <ul className="site-search__matches">
                        {page.matches.map((match) => {
                          const option = { key: `${page.id}#${match.id}`, kind: 'match', page, match }
                          return (
                            <li
                              key={match.id}
                              className={`site-search__option site-search__option--match site-search__option--${match.type}`}
                              data-search-id={match.id}
                              title={match.source}
                              {...optionProps(option)}
                            >
                              <span className="site-search__snippet">
                                <Highlighted text={match.text} tokens={parsed.tokens} />
                              </span>
                              <code className="site-search__id">{match.id}</code>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}

            {profiles.length > 0 && (
              <div role="group" aria-label={t('profiles')} className="site-search__group">
                <p className="site-search__group-title" aria-hidden="true">
                  {t('profiles')}
                  <span className="site-search__badge">{t('placeholderBadge')}</span>
                </p>

                {profiles.map((profile) => (
                  <div
                    key={profile.id}
                    className="site-search__option site-search__option--profile"
                    {...optionProps({ key: profile.id, kind: 'profile', profile })}
                  >
                    <span className="material-symbols-outlined site-search__avatar" aria-hidden="true">id_card</span>
                    <div className="site-search__option-main">
                      <span className="site-search__title">
                        <Highlighted text={profile.name} tokens={parsed.tokens} />
                        <span className="site-search__handle">@{profile.handle}</span>
                      </span>
                      <p className="site-search__description">{profile.description}</p>
                    </div>
                    <code className="site-search__id">{profile.id}</code>
                  </div>
                ))}
              </div>
            )}
          </div>

          {resultCount > 0 && (
            <p className="site-search__footer">
              <span>{t('results', { count: resultCount })}</span>
              <span className="site-search__hint">{t('hint')}</span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Highlight the found text after navigating from a search result.
// ---------------------------------------------------------------------------

function findHighlightRange(target) {
  const root = document.getElementById('root') ?? document.body
  const tokens = target.tokens ?? []
  const anchor = target.text ? normalize(target.text).slice(0, 40) : null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)

  let fallback = null

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement
    if (!parent || parent.closest('.site-search, script, style, title')) continue

    const nodeText = normalize(node.data)
    const token = tokens.find((candidate) => nodeText.includes(candidate))
    const blockText = normalize(parent.closest('p, h1, h2, h3, h4, li, button, a, label, span, div')?.textContent ?? '')
    const inAnchor = anchor ? blockText.includes(anchor) || nodeText.includes(anchor) : false

    if (!token && !inAnchor) continue

    const range = document.createRange()
    const start = token ? node.data.toLowerCase().indexOf(token) : -1
    if (start >= 0) {
      range.setStart(node, start)
      range.setEnd(node, start + token.length)
    } else {
      range.selectNodeContents(node)
    }

    if (inAnchor || !anchor) return range
    fallback ??= range
  }

  return fallback
}

/**
 * Mount once (in Root). When a page is opened from a search result, it scrolls
 * to the matching text and highlights it briefly.
 */
export function SearchHighlight() {
  const location = useLocation()
  const target = location.state?.searchHighlight

  useEffect(() => {
    if (!target) return

    const timers = []
    let flashed = null

    const apply = (attempt) => {
      const range = findHighlightRange(target)
      if (!range) {
        // Content may still be loading (translations, API data) – retry a bit.
        if (attempt < 12) timers.push(setTimeout(() => apply(attempt + 1), 150))
        return
      }

      const element = range.startContainer.parentElement
      element?.scrollIntoView({ block: 'center', behavior: 'smooth' })

      if (typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined') {
        CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(range))
      }
      flashed = element
      flashed?.classList.add('search-flash')

      timers.push(
        setTimeout(() => {
          CSS.highlights?.delete(HIGHLIGHT_NAME)
          flashed?.classList.remove('search-flash')
        }, 4000),
      )
    }

    timers.push(setTimeout(() => apply(0), 60))

    return () => {
      timers.forEach(clearTimeout)
      if (typeof CSS !== 'undefined') CSS.highlights?.delete(HIGHLIGHT_NAME)
      flashed?.classList.remove('search-flash')
    }
  }, [location.key, target])

  return null
}
