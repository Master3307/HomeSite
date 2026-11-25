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
import { useQuick } from './quick/useQuick.js'
import QuickAnswer from './quick/QuickAnswer.jsx'
import '../styles/search.css'

/* Tool cards that act on Enter (copy the password, open the link …). */
const ENTER_CARDS = new Set(['password', 'currency', 'random', 'color', 'link', 'age', 'elapsed', 'clock', 'ip', 'qr', 'count'])

const HIGHLIGHT_NAME = 'search-result'

/* Recent searches: only in this browser (localStorage), never sent anywhere. */
const HISTORY_LIMIT = 20
const historyStorage = (name) => `homesite:search-history:${name}`
function readHistory(name) {
  if (!name) return []
  try {
    const list = JSON.parse(localStorage.getItem(historyStorage(name)))
    return Array.isArray(list) ? list.filter((entry) => typeof entry === 'string' && entry.trim()).slice(0, HISTORY_LIMIT) : []
  } catch {
    return []
  }
}
function writeHistory(name, list) {
  try {
    if (list.length) localStorage.setItem(historyStorage(name), JSON.stringify(list))
    else localStorage.removeItem(historyStorage(name))
  } catch {
    // storage blocked: this visit only
  }
}
export function clearSearchHistory(name) {
  writeHistory(name, [])
}

function Highlighted({ text, tokens }) {
  return highlightParts(text, tokens).map((part, index) =>
    part.match ? <mark key={index}>{part.text}</mark> : part.text,
  )
}

/**
 * Bare site search bar (input + results panel), with no card around it;
 * use `SearchCard` for the card-wrapped version. Searches the generated page
 * index (`pnpm search:index`) plus a placeholder profile search, ranked by relevance.
 *
 * /dash adds to it (same look):
 *   `web`      `{ label(query) -> string, icon?, run(query) }`: a first option
 *              that searches the web (Enter picks it unless you arrow away)
 *   `people`   `async (query, signal) -> [{ id, name, handle, avatarUrl, open() }]`:
 *              a Discord lookup group (the site owner's)
 *   `sitePages` false: no page results (web only)
 *   `calc`     { analyze, Graph, Pretty, autoGraph } (/dash): sums, equations,
 *              conversions and graphs on top. Enter / click copies a result;
 *              on a graph Enter draws it, Enter again copies it as a picture;
 *              impossible maths (÷ 0) calls `explode(spot, { url, onStart })`
 *              `latex(partial)` suggests LaTeX commands while one is typed ("\\fr")
 *   `extras`   (query) => [{ key, group: 'top' | 'after', icon | visual, title,
 *              subtitle, hint, math, open() | copy }]: more suggestions (the
 *              dash's periodic table, elements, formulas); 'top' ones come
 *              before the web search, 'after' ones after it
 *   `voice`    a microphone button for speaking the search (the browser's speech
 *              recognition, only shown where it exists)
 *   `onImage`  (file) => …: images pasted, dropped or taken with the camera button
 *   `history`  where recent searches are kept ('site', 'dash'; false: none). They
 *              open on an empty bar the person clicked into (not on autofocus,
 *              until it's clicked or typed in), and matching ones join the
 *              suggestions, marked as recent
 *   `quick`    { disabled: Set, links, newTab } (/dash): the tools (components/quick):
 *              encodings, hashes, currencies, weather, IP, QR, passwords …,
 *              as rows (Enter copies) and cards above the calculator
 *   `placeholder`, `children` (rendered under the bar, e.g. engine chips)
 *
 * `web.run(query)` may return 'tab' when it opened a new tab: the bar is then cleared.
 */
export default function Search({ className = '', autoFocus = false, web = null, people = null, placeholder = null, sitePages = true, calc = null, extras = null, quick = null, history = 'site', voice = false, onImage = null, imageButton = true, children = null }) {
  const { t, i18n } = useTranslation('search')
  const { t: tTools } = useTranslation('tools')
  const navigate = useNavigate()
  const listId = useId()
  const rootRef = useRef(null)
  const inputRef = useRef(null)

  const [query, setQuery] = useState('')
  const [dragging, setDragging] = useState(false)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [index, setIndex] = useState(null)
  const [status, setStatus] = useState('idle') // idle | loading | ready | error
  const [profileResult, setProfileResult] = useState({ phrase: '', profiles: [] })
  const [peopleResult, setPeopleResult] = useState({ phrase: '', people: [], error: null })

  const deferredQuery = useDeferredValue(query)
  // Speaking the search (Web Speech API; Chrome / Edge send the audio to their speech service).
  const [listening, setListening] = useState(false)
  const recognition = useRef(null)
  const Recognition = typeof window !== 'undefined' ? (window.SpeechRecognition ?? window.webkitSpeechRecognition) : null
  const dictate = () => {
    if (listening) {
      recognition.current?.stop()
      return
    }
    if (!Recognition) return
    const listener = new Recognition()
    listener.lang = i18n.language
    listener.interimResults = true
    listener.continuous = false
    const before = query.trim()
    listener.onresult = (event) => {
      const spoken = [...event.results].map((result) => result[0].transcript).join('')
      setQuery(before ? `${before} ${spoken}` : spoken)
      setActiveIndex(0)
      setOpen(true)
      setHistoryArmed(true)
    }
    listener.onend = () => {
      setListening(false)
      recognition.current = null
      inputRef.current?.focus()
    }
    listener.onerror = () => setListening(false)
    recognition.current = listener
    setListening(true)
    listener.start()
  }
  useEffect(() => () => recognition.current?.abort(), [])
  // With the calculator the box takes several lines (Shift + Enter, or pasted).
  const multiline = Boolean(calc)
  useEffect(() => {
    const field = inputRef.current
    if (!multiline || !field) return
    field.style.height = 'auto'
    field.style.height = `${Math.min(field.scrollHeight, 260)}px`
  }, [query, multiline])
  const [recent, setRecent] = useState(() => readHistory(history))
  // Autofocus alone doesn't open the history; a click into the bar or typing does.
  const [historyArmed, setHistoryArmed] = useState(!autoFocus)
  const [caret, setCaret] = useState(0)
  const pendingCaret = useRef(null)
  const remember = (text) => {
    const entry = String(text ?? '').trim().slice(0, 200)
    if (!history || !entry) return
    const next = [entry, ...readHistory(history).filter((item) => item.toLocaleLowerCase() !== entry.toLocaleLowerCase())].slice(0, HISTORY_LIMIT)
    writeHistory(history, next)
    setRecent(next)
  }
  const forget = (text) => {
    const next = readHistory(history).filter((item) => item !== text)
    writeHistory(history, next)
    setRecent(next)
    inputRef.current?.focus()
  }
  const forgetAll = () => {
    writeHistory(history, [])
    setRecent([])
    inputRef.current?.focus()
  }
  useEffect(() => setRecent(readHistory(history)), [history])
  // After a LaTeX command was put in: the cursor into its first slot.
  useEffect(() => {
    if (pendingCaret.current === null || !inputRef.current) return
    inputRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current)
    setCaret(pendingCaret.current)
    pendingCaret.current = null
  })
  const latexPartial = calc?.latex ? (/\\[a-zA-Z]*$/.exec(query.slice(0, caret))?.[0] ?? null) : null
  const latexSuggestions = useMemo(() => (latexPartial ? calc.latex(latexPartial).filter((entry) => entry.command !== latexPartial || entry.template.includes('§')) : []), [calc, latexPartial])
  const recentShown = useMemo(() => {
    if (!history) return []
    const typed = query.trim().toLocaleLowerCase()
    if (!typed) return recent.slice(0, 8)
    return recent.filter((item) => item.toLocaleLowerCase() !== typed && item.toLocaleLowerCase().includes(typed)).slice(0, 3)
  }, [history, recent, query])
  const graphRef = useRef(null)
  const [graphFor, setGraphFor] = useState('')
  const [copiedKey, setCopiedKey] = useState('')
  const rawCalc = useMemo(() => {
    if (!calc || !deferredQuery.trim()) return null
    try {
      return calc.analyze(deferredQuery)
    } catch {
      return null
    }
  }, [calc, deferredQuery])
  // The tools (lib/quick): when one answers it better ("255 to hex", "16:9 1440 wide"), the calculator's guess steps back.
  const isColor = useMemo(() => (calc ? (text) => Boolean(calc.analyze(text)?.color) : null), [calc])
  const { answers: quickAnswers } = useQuick(deferredQuery, { enabled: Boolean(quick), disabled: quick?.disabled ?? null, links: quick?.links !== false, color: isColor })
  const calcResult = rawCalc && !quickAnswers.some((answer) => answer.replacesCalc) ? rawCalc : null
  const enterActions = useRef(new Map())
  const quickApi = useMemo(
    () => ({
      newTab: Boolean(quick?.newTab),
      copy: (text) => navigator.clipboard?.writeText(String(text ?? '')).catch(() => {}),
      setQuery: (text) => {
        setQuery(text)
        setActiveIndex(0)
        setOpen(true)
        inputRef.current?.focus()
      },
      open: (url) => {
        remember(url)
        if (quick?.newTab) {
          window.open(url, '_blank', 'noopener,noreferrer')
          setQuery('')
          setOpen(false)
        } else window.location.assign(url)
      },
      onEnter: (key, action) => {
        enterActions.current.set(key, action)
        return () => {
          if (enterActions.current.get(key) === action) enterActions.current.delete(key)
        }
      },
    }),
    [quick?.newTab], // eslint-disable-line react-hooks/exhaustive-deps
  )
  // Impossible maths (÷ 0): it blows up right away, centred on what broke; the box is cleared once the video plays.
  const boom = () => {
    const input = inputRef.current
    const clear = () => {
      setQuery('')
      setOpen(false)
    }
    if (calc?.explode && input) calc.explode(calc.faultSpot(input, calcResult?.error?.kind), { url: calcResult?.error?.url, onStart: clear })
    else clear()
  }
  const boomRef = useRef(boom)
  boomRef.current = boom
  useEffect(() => {
    if (calcResult?.illegal && query === deferredQuery) boomRef.current()
  }, [calcResult, query, deferredQuery])
  const extraItems = useMemo(() => {
    if (!extras || !deferredQuery.trim()) return []
    try {
      return extras(deferredQuery) ?? []
    } catch {
      return []
    }
  }, [extras, deferredQuery])
  const extrasTop = extraItems.filter((item) => item.group !== 'after')
  const extrasAfter = extraItems.filter((item) => item.group === 'after')
  const graphShown = Boolean(calcResult?.graph) && (calc?.autoGraph || graphFor === deferredQuery)
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

  // A tool or the calculator answered: the site's pages would only be noise ("10€ to $" matches every "to").
  const answered = quickAnswers.length > 0 || Boolean(calcResult)
  const pages = useMemo(
    () => (index && sitePages && !answered ? searchPages(index, parsed, i18n.language) : []),
    [index, sitePages, parsed, i18n.language, answered],
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
    () => (hasQuery && !people && profileResult.phrase === parsed.phrase ? profileResult.profiles : []),
    [hasQuery, people, profileResult, parsed.phrase],
  )

  // People (/dash: your contacts; the owner also Discord): debounced, stale replies dropped.
  useEffect(() => {
    if (!people || !hasQuery) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      people(deferredQuery.trim(), controller.signal)
        .then((list) => {
          if (!controller.signal.aborted) setPeopleResult({ phrase: parsed.phrase, people: list.slice(0, 10), error: null })
        })
        .catch((error) => {
          if (!controller.signal.aborted) setPeopleResult({ phrase: parsed.phrase, people: [], error: error.message })
        })
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [people, hasQuery, deferredQuery, parsed.phrase])
  const found = hasQuery && people && peopleResult.phrase === parsed.phrase ? peopleResult : { people: [], error: null }

  // One flat list of everything selectable, for keyboard navigation.
  const options = useMemo(() => {
    const list = []
    for (const entry of latexSuggestions) list.push({ key: `latex:${entry.template}`, kind: 'latex', entry })
    if (!query.trim()) {
      for (const text of recentShown) list.push({ key: `recent:${text}`, kind: 'recent', text })
      return list
    }
    for (const answer of quickAnswers) {
      if (answer.card && ENTER_CARDS.has(answer.card.type)) list.push({ key: `quickcard:${answer.key}`, kind: 'quickcard', answer })
      for (const row of answer.rows) list.push({ key: `quick:${answer.key}:${row.id}`, kind: 'quick', row, answer })
    }
    if (calcResult) {
      for (const row of calcResult.rows.slice(0, 8)) list.push({ key: `calc:${row.id}`, kind: 'calc', row })
      if (calcResult.graph) list.push({ key: 'calc:graph', kind: 'graph' })
    }
    for (const item of extrasTop) list.push({ key: item.key, kind: 'extra', item })
    if (web && query.trim()) list.push({ key: '__web', kind: 'web' })
    for (const item of extrasAfter) list.push({ key: item.key, kind: 'extra', item })
    for (const text of recentShown) list.push({ key: `recent:${text}`, kind: 'recent', text })
    for (const page of pages) {
      list.push({ key: page.id, kind: 'page', page })
      for (const match of page.matches) {
        list.push({ key: `${page.id}#${match.id}`, kind: 'match', page, match })
      }
    }
    for (const profile of profiles) list.push({ key: profile.id, kind: 'profile', profile })
    for (const person of found.people) list.push({ key: `person:${person.id}`, kind: 'person', person })
    return list
  }, [latexSuggestions, recentShown, quickAnswers, calcResult, extrasTop, extrasAfter, web, query, pages, profiles, found.people])

  const optionIndex = useMemo(
    () => new Map(options.map((option, position) => [option.key, position])),
    [options],
  )

  const clampedActive = Math.min(activeIndex, Math.max(options.length - 1, 0))
  const showHistory = open && !query.trim() && historyArmed && recentShown.length > 0
  const showPanel = open && (query.trim().length > 0 || showHistory)

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

  const flash = (key) => {
    setCopiedKey(key)
    setTimeout(() => setCopiedKey((current) => (current === key ? '' : current)), 1500)
  }
  const putLatex = (entry) => {
    const start = caret - latexPartial.length
    const at = entry.template.indexOf('§')
    const piece = entry.template.replace('§', '')
    setQuery(query.slice(0, start) + piece + query.slice(caret))
    pendingCaret.current = start + (at === -1 ? piece.length : at)
    setActiveIndex(0)
    inputRef.current?.focus()
  }
  const openOption = (option) => {
    if (!option) return
    if (option.kind === 'latex') {
      putLatex(option.entry)
      return
    }
    if (option.kind === 'recent') {
      setQuery(option.text)
      setActiveIndex(0)
      setCaret(option.text.length)
      // Maths (from before this rule) just shows its answer again; only real searches go to the search engine.
      let maths = false
      try {
        maths = Boolean(calc?.analyze(option.text))
      } catch {
        maths = false
      }
      if (web && !maths) {
        remember(option.text)
        web.run(option.text)
      } else inputRef.current?.focus()
      return
    }
    // Calculations, graphs and LaTeX aren't searches: they stay out of the history.
    if (!['calc', 'graph', 'latex', 'quick', 'quickcard'].includes(option.kind) && !(option.kind === 'extra' && option.item?.copy)) remember(query)
    if (option.kind === 'quick') {
      if (!option.row.copy) return
      const shown = document.getElementById(`${listId}-${optionIndex.get(option.key)}`)?.querySelector('.quick__value')?.textContent
      navigator.clipboard
        ?.writeText(option.row.id.startsWith('age:') || option.row.id.startsWith('span:') ? (shown ?? option.row.copy) : option.row.copy)
        .then(() => flash(option.key))
        .catch(() => {})
      return
    }
    if (option.kind === 'quickcard') {
      enterActions.current.get(option.answer.key)?.()
      if (option.answer.card.type !== 'link') flash(option.key)
      return
    }
    if (option.kind === 'calc') {
      if (!option.row.copy) return
      navigator.clipboard
        ?.writeText(option.row.copy)
        .then(() => flash(option.key))
        .catch(() => {})
      return
    }
    if (option.kind === 'extra') {
      if (option.item.copy) {
        navigator.clipboard
          ?.writeText(option.item.copy)
          .then(() => flash(option.key))
          .catch(() => {})
      } else {
        setOpen(false)
        option.item.open?.()
      }
      return
    }
    if (option.kind === 'graph') {
      if (!graphShown) setGraphFor(deferredQuery)
      else graphRef.current?.copy().then((done) => done && flash(option.key))
      return
    }
    if (option.kind === 'web') {
      // Opened in a new tab: this tab's bar starts empty again.
      if (web.run(query.trim().replace(/\s*\n\s*/g, ' ')) === 'tab') {
        setQuery('')
        setOpen(false)
        setActiveIndex(0)
      }
      return
    }
    if (option.kind === 'person') {
      setOpen(false)
      option.person.open()
      return
    }

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
    // Several lines (the calculator): ↑ / ↓ move between them, and only leave the text at its first / last line.
    const field = event.currentTarget
    const moveInText =
      (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
      field.value.includes('\n') &&
      (event.key === 'ArrowUp' ? field.value.slice(0, field.selectionStart).includes('\n') : field.value.slice(field.selectionEnd).includes('\n'))
    if (moveInText) return
    if (event.key === 'Enter' && event.shiftKey && multiline) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      if (!options.length) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((clampedActive + step + options.length) % options.length)
    } else if (event.key === 'Tab' && !event.shiftKey && latexSuggestions.length) {
      // Tab takes the highlighted (or first) LaTeX command.
      event.preventDefault()
      const active = options[clampedActive]
      putLatex(active?.kind === 'latex' ? active.entry : latexSuggestions[0])
    } else if (event.key === 'Tab' && !event.shiftKey && calc?.nextSlot) {
      // Tab jumps into the next empty {} / () of a fraction, root or power.
      const input = event.currentTarget
      const slot = calc.nextSlot(input.value, input.selectionEnd ?? 0)
      if (slot !== null) {
        event.preventDefault()
        input.setSelectionRange(slot, slot)
        setCaret(slot)
      }
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (calcResult?.illegal && calc?.analyze(query)?.illegal) boom()
      else openOption(options[clampedActive])
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

  const resultCount = pages.length + profiles.length + found.people.length
  const isTyping = query !== deferredQuery

  return (
    <div ref={rootRef} className={`site-search ${className}`.trim()}>
      <form
        role="search"
        onSubmit={(event) => event.preventDefault()}
        onPaste={(event) => {
          const image = onImage && [...(event.clipboardData?.files ?? [])].find((entry) => entry.type.startsWith('image/'))
          if (image) {
            event.preventDefault()
            onImage(image)
          }
        }}
        className={`site-search__form${dragging ? ' is-dropping' : ''}`}
        onDragOver={(event) => {
          if (onImage && [...(event.dataTransfer?.items ?? [])].some((item) => item.type.startsWith('image/'))) {
            event.preventDefault()
            if (!dragging) setDragging(true)
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false)
        }}
        onDrop={(event) => {
          setDragging(false)
          const image = onImage && [...(event.dataTransfer?.files ?? [])].find((entry) => entry.type.startsWith('image/'))
          if (image) {
            event.preventDefault()
            onImage(image)
          }
        }}
      >
        <span className="material-symbols-outlined site-search__icon" aria-hidden="true">search</span>
        {dragging && (
          <span className="site-search__drop" aria-hidden="true">
            <span className="material-symbols-outlined">add_photo_alternate</span>
            {tTools('image.drop')}
          </span>
        )}
        <Field
          multiline={multiline}
          ref={inputRef}
          className={`site-search__input${query.includes('\n') ? ' is-lines' : ''}`}
          role="combobox"
          aria-label={t('label')}
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showPanel && options.length ? `${listId}-${clampedActive}` : undefined}
          placeholder={placeholder ?? t('placeholder')}
          value={query}
          autoComplete="off"
          spellCheck="false"
          enterKeyHint="search"
          autoFocus={autoFocus}
          onFocus={() => {
            ensureIndex()
            setOpen(true)
          }}
          onPointerDown={() => {
            setHistoryArmed(true)
            setOpen(true)
          }}
          onChange={(event) => {
            ensureIndex()
            setQuery(event.target.value)
            setCaret(event.target.selectionEnd ?? event.target.value.length)
            setHistoryArmed(true)
            setActiveIndex(0)
            setOpen(true)
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionEnd ?? 0)}
          onKeyDown={onKeyDown}
        />
        {onImage && imageButton && (
          <label className="site-search__clear site-search__camera" title={t('image')} aria-label={t('image')}>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => {
                const image = event.target.files?.[0]
                if (image) onImage(image)
                event.target.value = ''
              }}
            />
            <span className="material-symbols-outlined" aria-hidden="true">
              photo_camera
            </span>
          </label>
        )}
        {voice && Recognition && (
          <button type="button" className={`site-search__clear site-search__voice${listening ? ' is-listening' : ''}`} aria-label={listening ? t('voiceStop') : t('voice')} title={listening ? t('voiceStop') : t('voice')} aria-pressed={listening} onClick={dictate}>
            <span className="material-symbols-outlined" aria-hidden="true">
              {listening ? 'graphic_eq' : 'mic'}
            </span>
          </button>
        )}
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

      {children}

      {showPanel && (
        <div className="site-search__panel">
          {status === 'loading' && <p className="site-search__status">{t('loading')}</p>}
          {status === 'error' && <p className="site-search__status site-search__status--error">{t('loadError')}</p>}

          {status === 'ready' && hasQuery && resultCount === 0 && !isTyping && !web && (
            <p className="site-search__status">{t('noResults', { query: query.trim() })}</p>
          )}

          <div id={listId} role="listbox" aria-label={t('label')} className="site-search__results">
            {latexSuggestions.length > 0 && (
              <div role="group" aria-label={t('latex')} className="site-search__group">
                <p className="site-search__group-title" aria-hidden="true">
                  {t('latex')}
                  <span className="site-search__badge">{t('latexHint')}</span>
                </p>
                {latexSuggestions.map((entry) => (
                  <div key={entry.template} className="site-search__option site-search__option--latex" {...optionProps({ key: `latex:${entry.template}`, kind: 'latex', entry })}>
                    <span className="site-search__avatar site-search__latex-glyph" aria-hidden="true">
                      {entry.show}
                    </span>
                    <div className="site-search__option-main">
                      <span className="site-search__title">
                        <code className="site-search__latex">{entry.template.replace('§', '…')}</code>
                      </span>
                      {entry.alias ? <p className="site-search__description">{t('latexAlias', { alias: `\\${entry.alias}` })}</p> : entry.words && <p className="site-search__description">{entry.words.split(',').slice(0, 4).join(',')}</p>}
                    </div>
                    <kbd className="site-search__kbd" aria-hidden="true">
                      Tab
                    </kbd>
                  </div>
                ))}
              </div>
            )}
            {!query.trim() && recentShown.length > 0 && (
              <div role="group" aria-label={t('recent')} className="site-search__group">
                <p className="site-search__group-title site-search__recent-title">
                  <span aria-hidden="true">{t('recent')}</span>
                  <button type="button" className="site-search__recent-clear" onMouseDown={(event) => event.preventDefault()} onClick={forgetAll}>
                    {t('clearRecent')}
                  </button>
                </p>
                {recentShown.map((text) => (
                  <RecentOption key={text} text={text} t={t} onForget={forget} {...optionProps({ key: `recent:${text}`, kind: 'recent', text })} />
                ))}
              </div>
            )}
            {quickAnswers.map((answer) => (
              <QuickAnswer key={answer.key} answer={answer} t={tTools} locale={i18n.language} optionProps={optionProps} copiedKey={copiedKey} api={quickApi} enterable={Boolean(answer.card && ENTER_CARDS.has(answer.card.type))} />
            ))}
            {calcResult && (
              <div role="group" aria-label={t('calc.title')} className="site-search__group site-search__calc">
                <p className="site-search__group-title" aria-hidden="true">
                  {t('calc.title')}
                  {calc.Pretty && calcResult.trees?.length > 0 && /[/^\\√∛⁄½²³$]|sqrt|root|frac/.test(deferredQuery) && <calc.Pretty trees={calcResult.trees} source={deferredQuery} className={`site-search__math${deferredQuery.includes('\n') ? ' is-lines' : ''}`} />}
                </p>
                {calc.Visual && (calcResult.clock || calcResult.color) && (
                  <div className="site-search__visual-row" onMouseDown={(event) => event.target.closest('input, button') || event.preventDefault()}>
                    <calc.Visual
                      result={calcResult}
                      onQuery={(text) => {
                        setQuery(text)
                        setActiveIndex(0)
                      }}
                    />
                  </div>
                )}
                {calcResult.rows.slice(0, 8).map((row) => {
                  const key = `calc:${row.id}`
                  return (
                    <div key={key} className="site-search__option site-search__option--calc" {...optionProps({ key, kind: 'calc', row })}>
                      <span className="material-symbols-outlined site-search__avatar" aria-hidden="true">
                        {{ convert: 'swap_horiz', solve: 'function', time: 'schedule', color: 'palette', point: 'scatter_plot' }[row.kind] ?? 'calculate'}
                      </span>
                      <div className="site-search__option-main">
                        <span className="site-search__title site-search__calc-value">{row.text}</span>
                      </div>
                      <span className="site-search__calc-hint">{copiedKey === key ? t('calc.copied') : row.hint}</span>
                      <span className="material-symbols-outlined site-search__chevron" aria-hidden="true">
                        {copiedKey === key ? 'check' : 'content_copy'}
                      </span>
                    </div>
                  )
                })}
                {calcResult.graph && (
                  <div className="site-search__option site-search__option--calc" {...optionProps({ key: 'calc:graph', kind: 'graph' })}>
                    <span className="material-symbols-outlined site-search__avatar" aria-hidden="true">
                      show_chart
                    </span>
                    <div className="site-search__option-main">
                      <span className="site-search__title">{graphShown ? t('calc.copyGraph') : t('calc.drawGraph', { what: calcResult.graph.map((line) => line.label).join(calcResult.trees?.length > 1 ? ', ' : ' = ') })}</span>
                    </div>
                    <span className="site-search__calc-hint">{copiedKey === 'calc:graph' ? t('calc.copied') : t('calc.graph')}</span>
                    <span className="material-symbols-outlined site-search__chevron" aria-hidden="true">
                      {copiedKey === 'calc:graph' ? 'check' : graphShown ? 'image' : 'add_chart'}
                    </span>
                  </div>
                )}
                {graphShown && calc.Graph && (
                  <div className="site-search__graph" onMouseDown={(event) => event.stopPropagation()}>
                    <calc.Graph ref={graphRef} lines={calcResult.graph} points={calcResult.points ?? []} height={260} />
                  </div>
                )}
              </div>
            )}
            {extrasTop.length > 0 && <ExtraGroup items={extrasTop} optionProps={optionProps} copiedKey={copiedKey} t={t} />}
            {web && query.trim() && (
              <div role="group" aria-label={t('web')} className="site-search__group">
                <div className="site-search__option site-search__option--web" {...optionProps({ key: '__web', kind: 'web' })}>
                  <span className="material-symbols-outlined site-search__avatar" aria-hidden="true">
                    {web.icon ?? 'travel_explore'}
                  </span>
                  <div className="site-search__option-main">
                    <span className="site-search__title">{web.label(query.trim())}</span>
                  </div>
                  <kbd className="site-search__kbd" aria-hidden="true">
                    ↵
                  </kbd>
                </div>
              </div>
            )}
            {extrasAfter.length > 0 && <ExtraGroup items={extrasAfter} optionProps={optionProps} copiedKey={copiedKey} t={t} />}
            {query.trim() && recentShown.length > 0 && (
              <div role="group" aria-label={t('recent')} className="site-search__group">
                {recentShown.map((text) => (
                  <RecentOption key={text} text={text} t={t} onForget={forget} {...optionProps({ key: `recent:${text}`, kind: 'recent', text })} />
                ))}
              </div>
            )}
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
            {/* People: your contacts (group "contacts") and the owner's Discord lookup, each under its own title. */}
            {people &&
              hasQuery &&
              ['contacts', 'discord'].map((group) => {
                const list = found.people.filter((person) => (person.group ?? 'discord') === group)
                const error = group === 'discord' ? found.error : null
                if (!list.length && !error) return null
                return (
                  <div key={group} role="group" aria-label={t(group)} className="site-search__group">
                    <p className="site-search__group-title" aria-hidden="true">
                      {t(group)}
                      <span className="site-search__badge">{t('onlyYou')}</span>
                    </p>
                    {error && <p className="site-search__status">{error}</p>}
                    {list.map((person) => (
                      <div key={`${group}:${person.id}`} className="site-search__option site-search__option--profile" {...optionProps({ key: `person:${group}:${person.id}`, kind: 'person', person })}>
                        {person.avatarUrl ? <img className="site-search__face" src={person.avatarUrl} alt="" width="32" height="32" loading="lazy" /> : <span className="material-symbols-outlined site-search__avatar" aria-hidden="true">person</span>}
                        <div className="site-search__option-main">
                          <span className="site-search__title">
                            <Highlighted text={person.name} tokens={parsed.tokens} />
                            {person.handle && <span className="site-search__handle">@{person.handle}</span>}
                          </span>
                          {person.detail && <p className="site-search__description">{person.detail}</p>}
                        </div>
                        {group === 'discord' && <code className="site-search__id">{person.id}</code>}
                      </div>
                    ))}
                  </div>
                )
              })}
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

/* The search field: an input, or a growing text area when it takes several lines. */
function Field({ multiline, ref, ...props }) {
  if (!multiline) return <input ref={ref} type="search" {...props} />
  return <textarea ref={ref} rows={1} {...props} />
}

/* More suggestions from the page using the search (the dash's science reference). */
function ExtraGroup({ items, optionProps, copiedKey, t }) {
  return (
    <div role="group" className="site-search__group">
      {items.map((item) => (
        <div key={item.key} className={`site-search__option site-search__option--extra${item.visual ? ' has-visual' : ''}`} {...optionProps({ key: item.key, kind: 'extra', item })}>
          {item.visual ? (
            <span className="site-search__visual" aria-hidden="true">
              {item.visual}
            </span>
          ) : (
            <span className="material-symbols-outlined site-search__avatar" aria-hidden="true">
              {item.icon ?? 'science'}
            </span>
          )}
          <div className="site-search__option-main">
            <span className="site-search__title">
              {item.title}
              {item.math}
            </span>
            {item.subtitle && <p className="site-search__description">{item.subtitle}</p>}
          </div>
          <span className="site-search__calc-hint">{copiedKey === item.key ? t('calc.copied') : item.hint}</span>
          <span className="material-symbols-outlined site-search__chevron" aria-hidden="true">
            {copiedKey === item.key ? 'check' : item.copy ? 'content_copy' : 'open_in_full'}
          </span>
        </div>
      ))}
    </div>
  )
}

/* One recent search: a clock, the text, a "Recent" mark and a button to forget it. */
function RecentOption({ text, t, onForget, ...props }) {
  return (
    <div className="site-search__option site-search__option--recent" {...props}>
      <span className="material-symbols-outlined site-search__avatar" aria-hidden="true">
        history
      </span>
      <div className="site-search__option-main">
        <span className="site-search__title">{text}</span>
      </div>
      <span className="site-search__badge site-search__badge--recent">{t('recentBadge')}</span>
      <button
        type="button"
        className="site-search__forget"
        aria-label={t('removeRecent', { text })}
        title={t('removeRecent', { text })}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation()
          onForget(text)
        }}
      >
        <span className="material-symbols-outlined" aria-hidden="true">
          close
        </span>
      </button>
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
