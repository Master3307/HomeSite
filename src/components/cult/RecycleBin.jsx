import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { describeEmoji } from '../../lib/emoji'
import {
  candidateImageUrl,
  createRecycleFolder,
  deleteRecycleFolder,
  loadRecycleBin,
  loadRecycleCandidates,
  moveRecycled,
  recycleOptions,
  recycledImageUrl,
  recyclerAvatarUrl,
  removeRecycled,
  renameRecycleFolder,
} from '../../lib/fdcRecycle'

/*
 * The FDC recycling bin, opened like a backpack:
 *
 *   mode="manage"  browse, organise in folders, add / remove options
 *   mode="pick"    the same, and clicking an item puts it into option N
 *
 * Folders: create (button / context menu), rename, delete (items move out).
 * Items: drag onto a folder, or "Move to…" (searchable destinations) from
 * the context menu or the selection bar; multi-select with the checkboxes
 * or Ctrl/Shift+click. "Add from polls" opens the picker of every option
 * of ended polls that isn't in the bin yet.
 */

const ALL = '__all'
const UNSORTED = '__unsorted'

const LAYOUT_KEY = 'homesite:fdcRecycleLayout'

/* Grid or list, remembered per screen in this browser. */
function useLayout(screen, fallback) {
  const [layout, setLayoutState] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}')[screen] ?? fallback
    } catch {
      return fallback
    }
  })

  function setLayout(next) {
    setLayoutState(next)
    try {
      const stored = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}')
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({ ...stored, [screen]: next }))
    } catch {
      // Storage blocked: the switch still works until the page closes.
    }
  }

  return [layout, setLayout]
}

function LayoutSwitch({ layout, onChange }) {
  const { t } = useTranslation('voting')
  return (
    <div className="recycle-layout" role="group" aria-label={t('fdc.recycle.layout', { defaultValue: 'View' })}>
      <button
        type="button"
        className={layout === 'grid' ? 'is-active' : ''}
        aria-pressed={layout === 'grid'}
        title={t('fdc.recycle.gridView', { defaultValue: 'Grid view' })}
        aria-label={t('fdc.recycle.gridView', { defaultValue: 'Grid view' })}
        onClick={() => onChange('grid')}
      >
        <span className="material-symbols-outlined" aria-hidden="true">grid_view</span>
      </button>
      <button
        type="button"
        className={layout === 'list' ? 'is-active' : ''}
        aria-pressed={layout === 'list'}
        title={t('fdc.recycle.listView', { defaultValue: 'List view' })}
        aria-label={t('fdc.recycle.listView', { defaultValue: 'List view' })}
        onClick={() => onChange('list')}
      >
        <span className="material-symbols-outlined" aria-hidden="true">view_list</span>
      </button>
    </div>
  )
}

const pollDate = (date, language) =>
  new Intl.DateTimeFormat(language || undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  )

function Emoji({ emoji, size = 18 }) {
  const info = describeEmoji(emoji?.value)
  if (!info) return null
  return <img className="recycle-emoji" src={info.url} alt={info.label} width={size} height={size} loading="lazy" />
}

function Modal({ className = '', labelledBy, onClose, children }) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    const previous = document.activeElement
    ref.current?.focus()
    function onKey(event) {
      if (event.key === 'Escape' && ref.current?.contains(document.activeElement)) {
        event.stopPropagation()
        closeRef.current?.()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [])

  return createPortal(
    <div
      className="fdc recycle-modal"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}
    >
      <div ref={ref} className={`recycle-modal__dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1}>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/* A small menu at the pointer. `items`: [{ label, icon, onClick, danger, disabled }] */
function ContextMenu({ menu, onClose }) {
  const ref = useRef(null)

  useEffect(() => {
    ref.current?.querySelector('button:not(:disabled)')?.focus()
    function onPointer(event) {
      if (!ref.current?.contains(event.target)) onClose()
    }
    function onKey(event) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  const x = Math.min(menu.x, window.innerWidth - 230)
  const y = Math.min(menu.y, window.innerHeight - 40 * menu.items.length - 20)

  return createPortal(
    <div ref={ref} className="fdc recycle-menu" role="menu" style={{ left: Math.max(8, x), top: Math.max(8, y) }}>
      {menu.title && <div className="recycle-menu__title">{menu.title}</div>}
      {menu.items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={item.danger ? 'is-danger' : ''}
          disabled={item.disabled}
          onClick={() => {
            onClose()
            item.onClick()
          }}
        >
          <span className="material-symbols-outlined" aria-hidden="true">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}

/* "Move to…": search the folders, pick one (or make a new one). */
function MoveDialog({ folders, count, currentFolderId, onMove, onCreate, onClose }) {
  const { t } = useTranslation('voting')
  const titleId = useId()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const destinations = [
    { id: null, name: t('fdc.recycle.unsorted', { defaultValue: 'Unsorted' }), icon: 'inbox' },
    ...folders.map((folder) => ({ ...folder, icon: 'folder' })),
  ].filter((entry) => entry.name.toLowerCase().includes(query.trim().toLowerCase()))

  const exact = folders.some((folder) => folder.name.toLowerCase() === query.trim().toLowerCase())

  async function go(run) {
    setBusy(true)
    setError(null)
    try {
      await run()
      onClose()
    } catch (moveError) {
      setError(moveError.message)
      setBusy(false)
    }
  }

  return (
    <Modal className="recycle-move" labelledBy={titleId} onClose={onClose}>
      <header className="recycle-modal__header">
        <h3 id={titleId}>
          {t('fdc.recycle.moveTitle', { defaultValue: 'Move {{count}} item(s) to…', count })}
        </h3>
        <button type="button" className="fdc-link" onClick={onClose} aria-label={t('fdc.create.cancel', { defaultValue: 'Cancel' })}>
          <span className="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </header>
      <div className="recycle-search">
        <span className="material-symbols-outlined" aria-hidden="true">search</span>
        <input
          autoFocus
          type="search"
          value={query}
          placeholder={t('fdc.recycle.searchFolders', { defaultValue: 'Search folders' })}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <ul className="recycle-move__list">
        {destinations.map((entry) => (
          <li key={entry.id ?? 'unsorted'}>
            <button
              type="button"
              disabled={busy || entry.id === currentFolderId}
              onClick={() => go(() => onMove(entry.id))}
            >
              <span className="material-symbols-outlined" aria-hidden="true">{entry.icon}</span>
              {entry.name}
              {entry.id === currentFolderId && (
                <small>{t('fdc.recycle.here', { defaultValue: 'already here' })}</small>
              )}
            </button>
          </li>
        ))}
        {query.trim() && !exact && (
          <li>
            <button type="button" disabled={busy} onClick={() => go(() => onCreate(query.trim()))}>
              <span className="material-symbols-outlined" aria-hidden="true">create_new_folder</span>
              {t('fdc.recycle.createAndMove', { defaultValue: 'New folder "{{name}}"', name: query.trim() })}
            </button>
          </li>
        )}
      </ul>
      {error && <p className="fdc-error">{error}</p>}
    </Modal>
  )
}

/* Asks for a folder name (create / rename). */
function NameDialog({ title, initial = '', onSubmit, onClose }) {
  const { t } = useTranslation('voting')
  const titleId = useId()
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function submit(event) {
    event.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      await onSubmit(name.trim())
      onClose()
    } catch (submitError) {
      setError(submitError.message)
      setBusy(false)
    }
  }

  return (
    <Modal className="recycle-name" labelledBy={titleId} onClose={onClose}>
      <form onSubmit={submit}>
        <header className="recycle-modal__header">
          <h3 id={titleId}>{title}</h3>
        </header>
        <input
          autoFocus
          className="fdc-input"
          value={name}
          maxLength={40}
          placeholder={t('fdc.recycle.folderName', { defaultValue: 'Folder name' })}
          onChange={(event) => setName(event.target.value)}
        />
        {error && <p className="fdc-error">{error}</p>}
        <div className="recycle-modal__actions">
          <button type="button" className="fdc-button fdc-button--ghost" onClick={onClose} disabled={busy}>
            {t('fdc.create.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button type="submit" className="fdc-button" disabled={busy || !name.trim()}>
            {t('fdc.recycle.save', { defaultValue: 'Save' })}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/* Every option of ended polls that isn't in the bin; search, filter, sort, group, multi-select. */
function CandidatePicker({ folders, folderId, onAdded, onClose }) {
  const { t, i18n } = useTranslation('voting')
  const titleId = useId()
  const [candidates, setCandidates] = useState(null)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all') // all | won | lost
  const [sort, setSort] = useState('newest') // newest | oldest | votes | position | name
  const [group, setGroup] = useState('poll') // poll | result | none
  const [selected, setSelected] = useState(() => new Set())
  const [destination, setDestination] = useState(folderId ?? '')
  const [busy, setBusy] = useState(false)
  const [layout, setLayout] = useLayout('candidates', 'list')

  useEffect(() => {
    let active = true
    loadRecycleCandidates()
      .then((list) => active && setCandidates(list))
      .catch((loadError) => active && setError(loadError.message))
    return () => {
      active = false
    }
  }, [])

  const visible = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const list = (candidates ?? []).filter((candidate) => {
      if (filter === 'won' && !candidate.won) return false
      if (filter === 'lost' && candidate.won) return false
      const text = `${candidate.description} ${candidate.date} ${candidate.emoji?.name ?? ''} #${candidate.optionNumber}`.toLowerCase()
      return words.every((word) => text.includes(word))
    })

    const sorters = {
      newest: (a, b) => b.date.localeCompare(a.date) || a.optionNumber - b.optionNumber,
      oldest: (a, b) => a.date.localeCompare(b.date) || a.optionNumber - b.optionNumber,
      votes: (a, b) => b.votes - a.votes || b.date.localeCompare(a.date),
      position: (a, b) => a.optionNumber - b.optionNumber || b.date.localeCompare(a.date),
      name: (a, b) => a.description.localeCompare(b.description),
    }
    return list.sort(sorters[sort])
  }, [candidates, query, filter, sort])

  const groups = useMemo(() => {
    if (group === 'none') return [{ id: 'all', title: null, items: visible }]
    const map = new Map()
    for (const candidate of visible) {
      const id = group === 'poll' ? candidate.date : candidate.won ? 'won' : 'lost'
      if (!map.has(id)) map.set(id, [])
      map.get(id).push(candidate)
    }
    return [...map].map(([id, items]) => ({
      id,
      title:
        group === 'poll'
          ? t('fdc.recycle.pollOf', { defaultValue: 'FDC of {{date}}', date: pollDate(id, i18n.language) })
          : id === 'won'
            ? t('fdc.recycle.winners', { defaultValue: 'Winners' })
            : t('fdc.recycle.others', { defaultValue: 'Other options' }),
      items,
    }))
  }, [visible, group, t, i18n.language])

  function toggle(key, on) {
    setSelected((current) => {
      const next = new Set(current)
      if (on ?? !next.has(key)) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const allVisibleSelected = visible.length > 0 && visible.every((candidate) => selected.has(candidate.key))

  async function add() {
    if (!selected.size || busy) return
    setBusy(true)
    setError(null)
    try {
      const options = (candidates ?? [])
        .filter((candidate) => selected.has(candidate.key))
        .map((candidate) => ({ date: candidate.date, optionNumber: candidate.optionNumber }))
      await recycleOptions(options, destination || null)
      onAdded()
      onClose()
    } catch (addError) {
      setError(addError.message)
      setBusy(false)
    }
  }

  return (
    <Modal className="recycle-candidates" labelledBy={titleId} onClose={onClose}>
      <header className="recycle-modal__header">
        <h3 id={titleId}>
          <span className="material-symbols-outlined" aria-hidden="true">recycling</span>
          {t('fdc.recycle.chooseTitle', { defaultValue: 'Choose options to recycle' })}
        </h3>
        <button type="button" className="fdc-link" onClick={onClose} aria-label={t('fdc.create.cancel', { defaultValue: 'Cancel' })}>
          <span className="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </header>

      <div className="recycle-toolbar">
        <div className="recycle-search">
          <span className="material-symbols-outlined" aria-hidden="true">search</span>
          <input
            type="search"
            value={query}
            placeholder={t('fdc.recycle.searchOptions', { defaultValue: 'Search name, date, emoji…' })}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <label className="recycle-select">
          <span>{t('fdc.recycle.show', { defaultValue: 'Show' })}</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="all">{t('fdc.recycle.filterAll', { defaultValue: 'All options' })}</option>
            <option value="won">{t('fdc.recycle.filterWon', { defaultValue: 'Winners only' })}</option>
            <option value="lost">{t('fdc.recycle.filterLost', { defaultValue: 'Non-winners only' })}</option>
          </select>
        </label>
        <label className="recycle-select">
          <span>{t('fdc.recycle.sort', { defaultValue: 'Sort' })}</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="newest">{t('fdc.recycle.sortNewest', { defaultValue: 'Newest poll' })}</option>
            <option value="oldest">{t('fdc.recycle.sortOldest', { defaultValue: 'Oldest poll' })}</option>
            <option value="votes">{t('fdc.recycle.sortVotes', { defaultValue: 'Most votes' })}</option>
            <option value="position">{t('fdc.recycle.sortPosition', { defaultValue: 'Position' })}</option>
            <option value="name">{t('fdc.recycle.sortName', { defaultValue: 'Name (A–Z)' })}</option>
          </select>
        </label>
        <label className="recycle-select">
          <span>{t('fdc.recycle.group', { defaultValue: 'Group' })}</span>
          <select value={group} onChange={(event) => setGroup(event.target.value)}>
            <option value="poll">{t('fdc.recycle.groupPoll', { defaultValue: 'By poll' })}</option>
            <option value="result">{t('fdc.recycle.groupResult', { defaultValue: 'By result' })}</option>
            <option value="none">{t('fdc.recycle.groupNone', { defaultValue: 'No groups' })}</option>
          </select>
        </label>
        <LayoutSwitch layout={layout} onChange={setLayout} />
      </div>

      <div className="recycle-candidates__bar">
        <label className="recycle-check">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={(event) => visible.forEach((candidate) => toggle(candidate.key, event.target.checked))}
            disabled={!visible.length}
          />
          {t('fdc.recycle.selectVisible', { defaultValue: 'Select all shown ({{count}})', count: visible.length })}
        </label>
        <span>{t('fdc.recycle.selectedCount', { defaultValue: '{{count}} selected', count: selected.size })}</span>
      </div>

      <div className={`recycle-candidates__list is-${layout}`}>
        {!candidates && !error && <p className="recycle-empty">{t('fdc.recycle.loading', { defaultValue: 'Loading…' })}</p>}
        {candidates && !visible.length && (
          <p className="recycle-empty">
            {candidates.length
              ? t('fdc.recycle.noMatches', { defaultValue: 'Nothing matches.' })
              : t('fdc.recycle.noCandidates', { defaultValue: 'Every option of every ended poll is already in the bin.' })}
          </p>
        )}
        {groups.map((section) =>
          section.items.length ? (
            <section key={section.id}>
              {section.title && <h4 className="recycle-group-title">{section.title}</h4>}
              <ul>
                {section.items.map((candidate) => (
                  <li key={candidate.key}>
                    <label className={`recycle-row${selected.has(candidate.key) ? ' is-selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={selected.has(candidate.key)}
                        onChange={(event) => toggle(candidate.key, event.target.checked)}
                      />
                      <img className="recycle-row__thumb" src={candidateImageUrl(candidate)} alt="" loading="lazy" />
                      <span className="recycle-row__position" title={t('fdc.recycle.position', { defaultValue: 'Position' })}>
                        {candidate.optionNumber}
                      </span>
                      <Emoji emoji={candidate.emoji} />
                      <span className="recycle-row__text">
                        <strong>{candidate.description}</strong>
                        <small>
                          {pollDate(candidate.date, i18n.language)} ·{' '}
                          {t('fdc.votes', {
                            count: candidate.votes,
                            defaultValue: '{{count}} vote',
                            defaultValue_other: '{{count}} votes',
                          })}
                        </small>
                      </span>
                      {candidate.won && (
                        <span className="recycle-won" title={t('fdc.winner', { defaultValue: 'Winner' })}>
                          <span className="material-symbols-outlined" aria-hidden="true">trophy</span>
                        </span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          ) : null,
        )}
      </div>

      {error && <p className="fdc-error">{error}</p>}

      <footer className="recycle-modal__actions">
        <label className="recycle-select">
          <span>{t('fdc.recycle.into', { defaultValue: 'Into' })}</span>
          <select value={destination} onChange={(event) => setDestination(event.target.value)}>
            <option value="">{t('fdc.recycle.unsorted', { defaultValue: 'Unsorted' })}</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="fdc-button fdc-button--ghost" onClick={onClose} disabled={busy}>
          {t('fdc.create.cancel', { defaultValue: 'Cancel' })}
        </button>
        <button type="button" className="fdc-button" onClick={add} disabled={!selected.size || busy}>
          <span className="material-symbols-outlined" aria-hidden="true">recycling</span>
          {busy
            ? t('fdc.manage.working', { defaultValue: 'Working…' })
            : t('fdc.recycle.addSelected', { defaultValue: 'Recycle {{count}}', count: selected.size })}
        </button>
      </footer>
    </Modal>
  )
}

function ItemCard({ item, viewerDiscordId, selected, picking, onActivate, onToggle, onMenu, onDragStart, onDragEnd }) {
  const { t, i18n } = useTranslation('voting')
  const mine = item.recycledBy?.discordId && item.recycledBy.discordId === viewerDiscordId
  const avatar = recyclerAvatarUrl(item)

  return (
    <li
      className={`recycle-item${selected ? ' is-selected' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onContextMenu={(event) => {
        event.preventDefault()
        onMenu(event.clientX, event.clientY)
      }}
    >
      <button
        type="button"
        className="recycle-item__main"
        onClick={(event) => (event.ctrlKey || event.metaKey || event.shiftKey ? onToggle() : onActivate())}
        onKeyDown={(event) => {
          if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
            event.preventDefault()
            const rect = event.currentTarget.getBoundingClientRect()
            onMenu(rect.left + 20, rect.top + 20)
          }
        }}
        title={picking ? t('fdc.recycle.useThis', { defaultValue: 'Use this option' }) : undefined}
      >
        <span className="recycle-item__image">
          <img src={recycledImageUrl(item)} alt="" loading="lazy" draggable="false" />
          {item.won && (
            <span className="recycle-won recycle-item__won" title={t('fdc.winner', { defaultValue: 'Winner' })}>
              <span className="material-symbols-outlined" aria-hidden="true">trophy</span>
            </span>
          )}
          {!mine && item.recycledBy?.name && (
            <span
              className="recycle-item__by"
              title={t('fdc.recycle.recycledBy', { defaultValue: 'Recycled by {{name}}', name: item.recycledBy.name })}
            >
              {avatar ? <img src={avatar} alt="" /> : <span className="material-symbols-outlined" aria-hidden="true">person</span>}
              <span>{item.recycledBy.name}</span>
            </span>
          )}
        </span>
        <span className="recycle-item__text">
          <span className="recycle-item__title">
            <Emoji emoji={item.emoji} />
            <strong>{item.description}</strong>
          </span>
          <small>
            {pollDate(item.date, i18n.language)} · #{item.optionNumber}
          </small>
        </span>
      </button>
      <label className="recycle-item__check" title={t('fdc.recycle.select', { defaultValue: 'Select' })}>
        <input type="checkbox" checked={selected} onChange={onToggle} />
      </label>
    </li>
  )
}

export default function RecycleBin({ mode = 'manage', optionNumber, viewerDiscordId, onPick, onClose }) {
  const { t } = useTranslation('voting')
  const titleId = useId()

  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [view, setView] = useState(ALL)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [menu, setMenu] = useState(null)
  const [dialog, setDialog] = useState(null) // { type, … }
  const [dropTarget, setDropTarget] = useState(null)
  const [picking, setPicking] = useState(null)
  const [layout, setLayout] = useLayout('bin', 'grid')
  const dragged = useRef(null)

  const reload = useCallback(async () => {
    try {
      const next = await loadRecycleBin()
      setData(next)
      setError(null)
      setSelected((current) => new Set([...current].filter((id) => next.items.some((item) => item.id === id))))
      return next
    } catch (loadError) {
      setError(loadError.message)
      return null
    }
  }, [])

  useEffect(() => {
    let active = true
    loadRecycleBin()
      .then((next) => active && setData(next))
      .catch((loadError) => active && setError(loadError.message))
    return () => {
      active = false
    }
  }, [])

  const folders = useMemo(
    () => [...(data?.folders ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  )
  const currentFolder = folders.find((folder) => folder.id === view) ?? null

  const items = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return (data?.items ?? [])
      .filter((item) => view === ALL || (view === UNSORTED ? !item.folderId : item.folderId === view))
      .filter((item) => {
        const text = `${item.description} ${item.date} ${item.emoji?.name ?? ''}`.toLowerCase()
        return words.every((word) => text.includes(word))
      })
      .sort((a, b) => b.recycledAt.localeCompare(a.recycledAt))
  }, [data, view, query])

  const countIn = (id) =>
    (data?.items ?? []).filter((item) => (id === UNSORTED ? !item.folderId : id === ALL || item.folderId === id)).length

  async function act(run) {
    setError(null)
    try {
      await run()
    } catch (actionError) {
      setError(actionError.message)
    }
    await reload()
  }

  function toggle(id) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function pick(item) {
    if (mode !== 'pick' || picking) return
    setPicking(item.id)
    try {
      await onPick(item)
      onClose()
    } catch (pickError) {
      setError(pickError.message)
      setPicking(null)
    }
  }

  const targetIds = (item) => (selected.has(item.id) ? [...selected] : [item.id])

  function moveDialog(ids) {
    setDialog({ type: 'move', ids })
  }

  function confirmRemove(ids) {
    setDialog({ type: 'remove', ids })
  }

  function itemMenu(item, x, y) {
    const ids = targetIds(item)
    setMenu({
      x,
      y,
      title: ids.length > 1 ? t('fdc.recycle.nSelected', { defaultValue: '{{count}} items', count: ids.length }) : item.description,
      items: [
        ...(mode === 'pick'
          ? [{ label: t('fdc.recycle.useFor', { defaultValue: 'Use for option {{number}}', number: optionNumber }), icon: 'input', onClick: () => pick(item) }]
          : []),
        { label: t('fdc.recycle.moveTo', { defaultValue: 'Move to…' }), icon: 'drive_file_move', onClick: () => moveDialog(ids) },
        {
          label: selected.has(item.id) ? t('fdc.recycle.deselect', { defaultValue: 'Deselect' }) : t('fdc.recycle.select', { defaultValue: 'Select' }),
          icon: 'check_box',
          onClick: () => toggle(item.id),
        },
        { label: t('fdc.recycle.remove', { defaultValue: 'Remove from bin' }), icon: 'delete', danger: true, onClick: () => confirmRemove(ids) },
      ],
    })
  }

  function folderMenu(folder, x, y) {
    setMenu({
      x,
      y,
      title: folder.name,
      items: [
        { label: t('fdc.recycle.open', { defaultValue: 'Open' }), icon: 'folder_open', onClick: () => setView(folder.id) },
        { label: t('fdc.recycle.rename', { defaultValue: 'Rename' }), icon: 'edit', onClick: () => setDialog({ type: 'rename', folder }) },
        { label: t('fdc.recycle.newFolder', { defaultValue: 'New folder' }), icon: 'create_new_folder', onClick: () => setDialog({ type: 'create' }) },
        { label: t('fdc.recycle.deleteFolder', { defaultValue: 'Delete folder' }), icon: 'folder_delete', danger: true, onClick: () => setDialog({ type: 'deleteFolder', folder }) },
      ],
    })
  }

  function backgroundMenu(event) {
    if (event.target.closest('.recycle-item, .recycle-folder')) return
    event.preventDefault()
    setMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { label: t('fdc.recycle.newFolder', { defaultValue: 'New folder' }), icon: 'create_new_folder', onClick: () => setDialog({ type: 'create' }) },
        { label: t('fdc.recycle.addFromPolls', { defaultValue: 'Choose to recycle' }), icon: 'recycling', onClick: () => setDialog({ type: 'candidates' }) },
      ],
    })
  }

  function dropProps(folderId) {
    const key = folderId ?? UNSORTED
    return {
      onDragOver: (event) => {
        if (!dragged.current) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setDropTarget(key)
      },
      onDragLeave: () => setDropTarget((current) => (current === key ? null : current)),
      onDrop: (event) => {
        event.preventDefault()
        const ids = dragged.current
        dragged.current = null
        setDropTarget(null)
        if (ids?.length) act(() => moveRecycled(ids, folderId))
      },
    }
  }

  const folderEntries = [
    { id: ALL, name: t('fdc.recycle.all', { defaultValue: 'Everything' }), icon: 'inventory_2', drop: false },
    { id: UNSORTED, name: t('fdc.recycle.unsorted', { defaultValue: 'Unsorted' }), icon: 'inbox', drop: true },
    ...folders.map((folder) => ({ ...folder, icon: view === folder.id ? 'folder_open' : 'folder', drop: true, real: true })),
  ]

  return (
    <Modal className="recycle-bin" labelledBy={titleId} onClose={onClose}>
      <header className="recycle-modal__header">
        <h3 id={titleId}>
          <span className="material-symbols-outlined" aria-hidden="true">backpack</span>
          {mode === 'pick'
            ? t('fdc.recycle.pickTitle', { defaultValue: 'Recycling bin · pick for option {{number}}', number: optionNumber })
            : t('fdc.recycle.title', { defaultValue: 'Recycling bin' })}
        </h3>
        <button type="button" className="fdc-link" onClick={onClose} aria-label={t('fdc.create.cancel', { defaultValue: 'Close' })}>
          <span className="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </header>

      <div className="recycle-bin__body" onContextMenu={backgroundMenu}>
        <nav className="recycle-bin__folders" aria-label={t('fdc.recycle.folders', { defaultValue: 'Folders' })}>
          {folderEntries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={[
                'recycle-folder',
                view === entry.id && 'is-active',
                dropTarget === (entry.id === UNSORTED ? UNSORTED : entry.id) && entry.drop && 'is-drop-target',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => setView(entry.id)}
              onContextMenu={(event) => {
                if (!entry.real) return
                event.preventDefault()
                event.stopPropagation()
                folderMenu(entry, event.clientX, event.clientY)
              }}
              {...(entry.drop ? dropProps(entry.id === UNSORTED ? null : entry.id) : {})}
            >
              <span className="material-symbols-outlined" aria-hidden="true">{entry.icon}</span>
              <span className="recycle-folder__name">{entry.name}</span>
              <small>{data ? countIn(entry.id) : ''}</small>
            </button>
          ))}
          <button type="button" className="fdc-link recycle-bin__new-folder" onClick={() => setDialog({ type: 'create' })}>
            <span className="material-symbols-outlined" aria-hidden="true">create_new_folder</span>
            {t('fdc.recycle.newFolder', { defaultValue: 'New folder' })}
          </button>
        </nav>

        <div className="recycle-bin__main">
          <div className="recycle-toolbar">
            <div className="recycle-search">
              <span className="material-symbols-outlined" aria-hidden="true">search</span>
              <input
                type="search"
                value={query}
                placeholder={t('fdc.recycle.searchItems', { defaultValue: 'Search the bin' })}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {currentFolder && (
              <button type="button" className="fdc-link" onClick={(event) => folderMenu(currentFolder, event.clientX, event.clientY)}>
                <span className="material-symbols-outlined" aria-hidden="true">more_horiz</span>
                {t('fdc.recycle.folderActions', { defaultValue: 'Folder' })}
              </button>
            )}
            <LayoutSwitch layout={layout} onChange={setLayout} />
            <button type="button" className="fdc-button fdc-button--small" onClick={() => setDialog({ type: 'candidates' })}>
              <span className="material-symbols-outlined" aria-hidden="true">recycling</span>
              {t('fdc.recycle.addFromPolls', { defaultValue: 'Choose to recycle' })}
            </button>
          </div>

          {selected.size > 0 && (
            <div className="recycle-selection" role="region" aria-label={t('fdc.recycle.selection', { defaultValue: 'Selection' })}>
              <strong>{t('fdc.recycle.selectedCount', { defaultValue: '{{count}} selected', count: selected.size })}</strong>
              <button type="button" className="fdc-link" onClick={() => moveDialog([...selected])}>
                <span className="material-symbols-outlined" aria-hidden="true">drive_file_move</span>
                {t('fdc.recycle.moveTo', { defaultValue: 'Move to…' })}
              </button>
              <button type="button" className="fdc-link recycle-danger" onClick={() => confirmRemove([...selected])}>
                <span className="material-symbols-outlined" aria-hidden="true">delete</span>
                {t('fdc.recycle.remove', { defaultValue: 'Remove from bin' })}
              </button>
              <button type="button" className="fdc-link" onClick={() => setSelected(new Set())}>
                {t('fdc.recycle.clearSelection', { defaultValue: 'Clear' })}
              </button>
            </div>
          )}

          {mode === 'pick' && (
            <p className="fdc-note recycle-hint">
              {t('fdc.recycle.pickHint', {
                defaultValue: 'Click an option to put it into option {{number}}. Its name and emoji become suggestions you can keep or change.',
                number: optionNumber,
              })}
            </p>
          )}

          {error && <p className="fdc-error" role="alert">{error}</p>}
          {!data && !error && <p className="recycle-empty">{t('fdc.recycle.loading', { defaultValue: 'Loading…' })}</p>}
          {data && !items.length && (
            <div className="recycle-empty">
              <span className="material-symbols-outlined" aria-hidden="true">recycling</span>
              <p>
                {query
                  ? t('fdc.recycle.noMatches', { defaultValue: 'Nothing matches.' })
                  : t('fdc.recycle.empty', { defaultValue: 'Nothing here yet. Recycle options from ended polls to reuse them later.' })}
              </p>
            </div>
          )}

          <ul className={`recycle-grid${layout === 'list' ? ' is-list' : ''}`}>
            {items.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                viewerDiscordId={viewerDiscordId}
                selected={selected.has(item.id)}
                picking={mode === 'pick'}
                onActivate={() => (mode === 'pick' ? pick(item) : toggle(item.id))}
                onToggle={() => toggle(item.id)}
                onMenu={(x, y) => itemMenu(item, x, y)}
                onDragStart={(event) => {
                  dragged.current = targetIds(item)
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', item.id)
                }}
                onDragEnd={() => {
                  dragged.current = null
                  setDropTarget(null)
                }}
              />
            ))}
          </ul>
          {picking && <p className="recycle-empty">{t('fdc.recycle.loadingImage', { defaultValue: 'Loading image…' })}</p>}
        </div>
      </div>

      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}

      {dialog?.type === 'move' && (
        <MoveDialog
          folders={folders}
          count={dialog.ids.length}
          currentFolderId={
            dialog.ids.length === 1 ? (data?.items.find((item) => item.id === dialog.ids[0])?.folderId ?? null) : undefined
          }
          onMove={async (folderId) => {
            await moveRecycled(dialog.ids, folderId)
            setSelected(new Set())
            await reload()
          }}
          onCreate={async (name) => {
            const folder = await createRecycleFolder(name)
            await moveRecycled(dialog.ids, folder.id)
            setSelected(new Set())
            await reload()
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {(dialog?.type === 'create' || dialog?.type === 'rename') && (
        <NameDialog
          title={
            dialog.type === 'create'
              ? t('fdc.recycle.newFolder', { defaultValue: 'New folder' })
              : t('fdc.recycle.renameFolder', { defaultValue: 'Rename folder' })
          }
          initial={dialog.folder?.name}
          onSubmit={async (name) => {
            if (dialog.type === 'create') {
              const folder = await createRecycleFolder(name)
              await reload()
              setView(folder.id)
            } else {
              await renameRecycleFolder(dialog.folder.id, name)
              await reload()
            }
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {(dialog?.type === 'remove' || dialog?.type === 'deleteFolder') && (
        <Modal className="recycle-confirm" labelledBy={`${titleId}-confirm`} onClose={() => setDialog(null)}>
          <h3 id={`${titleId}-confirm`}>
            {dialog.type === 'remove'
              ? t('fdc.recycle.removeTitle', { defaultValue: 'Remove {{count}} item(s) from the bin?', count: dialog.ids.length })
              : t('fdc.recycle.deleteFolderTitle', { defaultValue: 'Delete the folder "{{name}}"?', name: dialog.folder.name })}
          </h3>
          <p className="fdc-note">
            {dialog.type === 'remove'
              ? t('fdc.recycle.removeText', { defaultValue: 'They can be recycled again later from "Choose to recycle".' })
              : t('fdc.recycle.deleteFolderText', { defaultValue: 'The items inside move to "Unsorted"; nothing is lost.' })}
          </p>
          <div className="recycle-modal__actions">
            <button type="button" className="fdc-button fdc-button--ghost" onClick={() => setDialog(null)}>
              {t('fdc.create.cancel', { defaultValue: 'Cancel' })}
            </button>
            <button
              type="button"
              className="fdc-button fdc-button--danger"
              autoFocus
              onClick={() => {
                const current = dialog
                setDialog(null)
                if (current.type === 'remove') {
                  setSelected(new Set())
                  act(() => removeRecycled(current.ids))
                } else {
                  if (view === current.folder.id) setView(UNSORTED)
                  act(() => deleteRecycleFolder(current.folder.id))
                }
              }}
            >
              {dialog.type === 'remove'
                ? t('fdc.recycle.remove', { defaultValue: 'Remove from bin' })
                : t('fdc.recycle.deleteFolder', { defaultValue: 'Delete folder' })}
            </button>
          </div>
        </Modal>
      )}

      {dialog?.type === 'candidates' && (
        <CandidatePicker
          folders={folders}
          folderId={currentFolder?.id ?? null}
          onAdded={reload}
          onClose={() => setDialog(null)}
        />
      )}
    </Modal>
  )
}

/** After a poll with recycled options was sent: offer to take them out of the bin. */
export function RecycledCleanup({ items, onDone }) {
  const { t } = useTranslation('voting')
  const [step, setStep] = useState('ask') // ask | select
  const [selected, setSelected] = useState(() => new Set(items.map((item) => item.id)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function remove() {
    if (!selected.size) {
      onDone()
      return
    }
    setBusy(true)
    try {
      await removeRecycled([...selected])
      onDone({ removed: selected.size })
    } catch (removeError) {
      setError(removeError.message)
      setBusy(false)
    }
  }

  return (
    <div className="recycle-cleanup" role="region" aria-live="polite">
      <span className="material-symbols-outlined" aria-hidden="true">recycling</span>
      {step === 'ask' ? (
        <>
          <p>
            {t('fdc.recycle.cleanupAsk', {
              defaultValue: 'This poll used {{count}} recycled option(s). Remove them from the recycling bin?',
              count: items.length,
            })}
          </p>
          <div className="recycle-modal__actions">
            <button type="button" className="fdc-button fdc-button--ghost" onClick={() => onDone()}>
              {t('fdc.recycle.keep', { defaultValue: 'Keep them' })}
            </button>
            <button type="button" className="fdc-button" onClick={() => setStep('select')}>
              {t('fdc.recycle.yesRemove', { defaultValue: 'Yes, remove…' })}
            </button>
          </div>
        </>
      ) : (
        <>
          <p>{t('fdc.recycle.cleanupSelect', { defaultValue: 'Which ones should leave the bin?' })}</p>
          <ul className="recycle-cleanup__list">
            {items.map((item) => (
              <li key={item.id}>
                <label className={`recycle-row${selected.has(item.id) ? ' is-selected' : ''}`}>
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() =>
                      setSelected((current) => {
                        const next = new Set(current)
                        if (next.has(item.id)) next.delete(item.id)
                        else next.add(item.id)
                        return next
                      })
                    }
                  />
                  <img className="recycle-row__thumb" src={recycledImageUrl(item)} alt="" />
                  <Emoji emoji={item.emoji} />
                  <span className="recycle-row__text">
                    <strong>{item.description}</strong>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {error && <p className="fdc-error">{error}</p>}
          <div className="recycle-modal__actions">
            <button type="button" className="fdc-button fdc-button--ghost" onClick={() => onDone()} disabled={busy}>
              {t('fdc.create.cancel', { defaultValue: 'Cancel' })}
            </button>
            <button type="button" className="fdc-button fdc-button--danger" onClick={remove} disabled={busy}>
              {busy
                ? t('fdc.manage.working', { defaultValue: 'Working…' })
                : t('fdc.recycle.removeCount', { defaultValue: 'Remove {{count}}', count: selected.size })}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
