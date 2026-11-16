import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  customEmojiUrl,
  deleteCustomEmoji,
  describeEmoji,
  emojiNameFromFile,
  forgetRecentEmoji,
  getFavoriteEmojis,
  getRecentEmojis,
  loadCustomEmojis,
  loadUnicodeEmojis,
  rememberEmoji,
  saveFavoriteEmojis,
  twemojiUrl,
  uploadCustomEmoji,
} from '../../lib/emoji'

/*
 * Reaction emoji picker for FDC options: Twemoji-style Unicode emoji, the
 * server's emojis and the bot's own emojis, with favorites (reorder by
 * dragging or from the context menu) and recently used ones.
 *
 * Editors can upload new emojis (animated or not) to the bot, which can
 * react with them in the server, and delete the bot's own emojis from the
 * context menu (right-click, long-press, or the menu key).
 *
 *   <EmojiPicker value="🎀" fallback="1️⃣" onChange={(value) => …} />
 */

/*
 * Categories in Discord's order (Discord puts "Smileys & Emotion" and
 * "People & Body" together as People, and Activities before Travel).
 */
const CATEGORIES = [
  { id: 'people', groups: ['smileys_emotion', 'people_body'], icon: '😀', name: 'People' },
  { id: 'nature', groups: ['animals_nature'], icon: '🐱', name: 'Nature' },
  { id: 'food', groups: ['food_drink'], icon: '🍓', name: 'Food' },
  { id: 'activities', groups: ['activities'], icon: '⚽', name: 'Activities' },
  { id: 'travel', groups: ['travel_places'], icon: '🚗', name: 'Travel' },
  { id: 'objects', groups: ['objects'], icon: '💡', name: 'Objects' },
  { id: 'symbols', groups: ['symbols'], icon: '❤️', name: 'Symbols' },
  { id: 'flags', groups: ['flags'], icon: '🏳️', name: 'Flags' },
]

const SEARCH_LIMIT = 160
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024
const LONG_PRESS_MS = 480

/* Shows a soft shimmer until the image has loaded (no alt text flash). */
function EmojiImage({ url, size = 28 }) {
  const [state, setState] = useState('loading') // loading | ready | failed
  const [shownUrl, setShownUrl] = useState(url)

  if (shownUrl !== url) {
    setShownUrl(url)
    setState('loading')
  }

  return (
    <span className={`emoji-image emoji-image--${state}`} style={{ width: size, height: size }} aria-hidden="true">
      {state !== 'failed' && (
        <img
          src={url}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          draggable="false"
          onLoad={() => setState('ready')}
          onError={() => setState('failed')}
        />
      )}
    </span>
  )
}

function UploadForm({ onUploaded, onCancel }) {
  const { t } = useTranslation('voting')
  const nameId = useId()
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview])

  function pick(next) {
    if (!next) return
    setError(null)

    if (!next.type.startsWith('image/')) {
      setError(t('fdc.emoji.notImage', { defaultValue: 'Pick an image or GIF.' }))
      return
    }
    if (next.size > UPLOAD_MAX_BYTES) {
      setError(t('fdc.emoji.tooBig', { defaultValue: 'The file is larger than 10 MB.' }))
      return
    }

    setFile(next)
    setPreview(URL.createObjectURL(next))
    if (!name) setName(emojiNameFromFile(next.name))
  }

  async function upload(event) {
    event.preventDefault()
    if (!file || busy) return

    if (!/^[A-Za-z0-9_]{2,32}$/.test(name)) {
      setError(t('fdc.emoji.badName', { defaultValue: 'Use 2–32 letters, numbers or underscores.' }))
      return
    }

    setBusy(true)
    setError(null)

    try {
      onUploaded(await uploadCustomEmoji(name, file))
    } catch (uploadError) {
      setError(uploadError.message)
      setBusy(false)
    }
  }

  return (
    <div className="emoji-picker__upload">
      <div className="emoji-picker__upload-row">
        <label className="emoji-picker__upload-drop">
          <input type="file" accept="image/png,image/gif,image/webp,image/jpeg" onChange={(event) => pick(event.target.files?.[0])} />
          {preview ? (
            <img src={preview} alt="" />
          ) : (
            <span className="material-symbols-outlined" aria-hidden="true">add_photo_alternate</span>
          )}
        </label>

        <div className="emoji-picker__upload-fields">
          <label className="fdc-create__label" htmlFor={nameId}>
            {t('fdc.emoji.name', { defaultValue: 'Emoji name' })}
          </label>
          <input
            id={nameId}
            className="fdc-input"
            value={name}
            maxLength={32}
            placeholder="party_cat"
            onChange={(event) => setName(event.target.value.replace(/[^A-Za-z0-9_]/g, '_'))}
          />
        </div>
      </div>

      <p className="fdc-note">
        {t('fdc.emoji.uploadNote', {
          defaultValue: 'Saved to the bot’s own emojis, so it can react with it in the server. GIFs stay animated.',
        })}
      </p>

      {error && <p className="fdc-error" role="alert">{error}</p>}

      <div className="emoji-picker__upload-actions">
        <button type="button" className="fdc-link" onClick={onCancel} disabled={busy}>
          {t('fdc.create.cancel', { defaultValue: 'Cancel' })}
        </button>
        <button type="button" className="fdc-button fdc-button--small" onClick={upload} disabled={!file || busy}>
          <span className="material-symbols-outlined" aria-hidden="true">upload</span>
          {busy
            ? t('fdc.emoji.uploading', { defaultValue: 'Uploading…' })
            : t('fdc.emoji.upload', { defaultValue: 'Upload' })}
        </button>
      </div>
    </div>
  )
}

/* Right-click / long-press menu for one emoji. */
function ContextMenu({ menu, favorites, onFavorite, onMove, onForget, onDelete, onClose }) {
  const { t } = useTranslation('voting')
  const ref = useRef(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const { item, section } = menu
  const favoriteIndex = favorites.indexOf(item.value)
  const isFavorite = favoriteIndex !== -1
  const canDelete = item.source === 'bot' && item.id

  useEffect(() => {
    ref.current?.querySelector('button')?.focus()
  }, [confirming])

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await onDelete(item)
      onClose()
    } catch (deleteError) {
      setError(deleteError.message)
      setBusy(false)
    }
  }

  return (
    <div
      ref={ref}
      className="emoji-menu"
      role="menu"
      style={{ left: menu.x, top: menu.y }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="emoji-menu__head">
        <EmojiImage url={item.url} size={22} />
        <span>{item.name}</span>
      </div>

      {confirming ? (
        <div className="emoji-menu__confirm">
          <p>
            {t('fdc.emoji.deleteConfirm', {
              defaultValue: 'Delete {{name}} from the bot? This can’t be undone.',
              name: item.name,
            })}
          </p>
          {error && <p className="fdc-error">{error}</p>}
          <div>
            <button type="button" className="fdc-link" onClick={() => setConfirming(false)} disabled={busy}>
              {t('fdc.create.cancel', { defaultValue: 'Cancel' })}
            </button>
            <button type="button" className="fdc-button fdc-button--small fdc-button--danger" onClick={remove} disabled={busy}>
              {busy ? t('fdc.manage.working', { defaultValue: 'Working…' }) : t('fdc.emoji.delete', { defaultValue: 'Delete' })}
            </button>
          </div>
        </div>
      ) : (
        <>
          <button type="button" role="menuitem" onClick={() => onFavorite(item)}>
            <span className="material-symbols-outlined" aria-hidden="true">{isFavorite ? 'star' : 'star_outline'}</span>
            {isFavorite
              ? t('fdc.emoji.unfavorite', { defaultValue: 'Remove from favorites' })
              : t('fdc.emoji.favorite', { defaultValue: 'Add to favorites' })}
          </button>

          {isFavorite && (
            <>
              <button type="button" role="menuitem" onClick={() => onMove(item, -1)} disabled={favoriteIndex === 0}>
                <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
                {t('fdc.emoji.moveEarlier', { defaultValue: 'Move earlier' })}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => onMove(item, 1)}
                disabled={favoriteIndex === favorites.length - 1}
              >
                <span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
                {t('fdc.emoji.moveLater', { defaultValue: 'Move later' })}
              </button>
            </>
          )}

          {section === 'recent' && (
            <button type="button" role="menuitem" onClick={() => onForget(item)}>
              <span className="material-symbols-outlined" aria-hidden="true">history</span>
              {t('fdc.emoji.forget', { defaultValue: 'Remove from recent' })}
            </button>
          )}

          {canDelete && (
            <button type="button" role="menuitem" className="emoji-menu__danger" onClick={() => setConfirming(true)}>
              <span className="material-symbols-outlined" aria-hidden="true">delete</span>
              {t('fdc.emoji.deleteEmoji', { defaultValue: 'Delete emoji' })}
            </button>
          )}
        </>
      )}
    </div>
  )
}

/*
 * `variant`: "field" (the reaction emoji of an FDC option: shows the chosen
 * one) or "insert" (a small button next to a text field: every pick is
 * handed to `onChange` to insert, nothing stays selected).
 */
export default function EmojiPicker({ value = '', fallback, onChange, labelledBy, emptyLabel, variant = 'field', label }) {
  const inserting = variant === 'insert'
  const { t } = useTranslation('voting')
  const panelId = useId()
  const rootRef = useRef(null)
  const panelRef = useRef(null)
  const searchRef = useRef(null)
  const pressRef = useRef(null)
  const dragRef = useRef(null)

  const [open, setOpen] = useState(false)
  const [favorites, setFavorites] = useState(getFavoriteEmojis)
  const [recent, setRecent] = useState(getRecentEmojis)
  const [tab, setTab] = useState(() => (getFavoriteEmojis().length ? 'favorites' : 'recent'))
  const bodyRef = useRef(null)
  const [query, setQuery] = useState('')
  const [groups, setGroups] = useState(null)
  const [custom, setCustom] = useState(null) // { guild, bot } | { error }
  const [hovered, setHovered] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [menu, setMenu] = useState(null) // { item, section, x, y }
  const [dropTarget, setDropTarget] = useState(null)

  const current = describeEmoji(value || fallback)

  // Load the lists the first time the picker opens.
  useEffect(() => {
    if (!open) return undefined
    let active = true

    if (!groups) loadUnicodeEmojis().then((loaded) => active && setGroups(loaded))
    if (!custom) {
      loadCustomEmojis()
        .then((loaded) => active && setCustom(loaded))
        .catch((error) => active && setCustom({ guild: [], bot: [], error: error.message }))
    }

    return () => {
      active = false
    }
  }, [open, groups, custom])

  // Close on outside click / Escape; focus the search box when opening.
  useEffect(() => {
    if (!open) return undefined
    searchRef.current?.focus()

    function onPointer(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false)
        setMenu(null)
      }
    }
    function onKey(event) {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setMenu((state) => {
        if (!state) setOpen(false)
        return null
      })
    }

    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  /* Every known emoji by value, so favorites / recents can show name and image. */
  const lookup = useMemo(() => {
    const map = new Map()
    for (const group of groups ?? []) for (const emoji of group.emojis) map.set(emoji.value, emoji)
    for (const [source, list] of [['guild', custom?.guild], ['bot', custom?.bot]]) {
      for (const emoji of list ?? []) {
        map.set(emoji.markup, {
          value: emoji.markup,
          id: emoji.id,
          source,
          name: `:${emoji.name}:`,
          keywords: emoji.name.toLowerCase(),
          url: customEmojiUrl(emoji),
        })
      }
    }
    return map
  }, [groups, custom])

  const itemFor = (entry) => {
    const known = lookup.get(entry)
    if (known) return known
    const info = describeEmoji(entry)
    return { value: entry, name: info?.label ?? entry, url: info?.url ?? twemojiUrl(entry) }
  }

  const customItems = useMemo(
    () => ({
      guild: (custom?.guild ?? []).map((emoji) => lookup.get(emoji.markup)).filter(Boolean),
      bot: (custom?.bot ?? []).map((emoji) => lookup.get(emoji.markup)).filter(Boolean),
    }),
    [custom, lookup],
  )

  const search = query.trim().toLowerCase()
  let sections

  if (search) {
    const words = search.split(/\s+/)
    const hits = [...lookup.values()].filter((item) => words.every((word) => item.keywords?.includes(word)))
    sections = [{ id: 'search', title: t('fdc.emoji.results', { defaultValue: 'Results' }), items: hits.slice(0, SEARCH_LIMIT) }]
  } else {
    // Everything in one list, top to bottom; the rail on the left jumps to a part.
    sections = [
      ...(favorites.length ? [{ id: 'favorites', title: t('fdc.emoji.favorites', { defaultValue: 'Favorites' }), items: favorites.map(itemFor), sortable: true }] : []),
      ...(recent.length ? [{ id: 'recent', title: t('fdc.emoji.recent', { defaultValue: 'Frequently used' }), items: recent.map(itemFor) }] : []),
      { id: 'guild', tab: 'custom', title: t('fdc.emoji.server', { defaultValue: 'Server emojis' }), items: customItems.guild },
      { id: 'bot', tab: 'custom', title: t('fdc.emoji.bot', { defaultValue: 'Cultbot’s emojis' }), items: customItems.bot },
      ...CATEGORIES.map((category) => ({
        id: category.id,
        title: t(`fdc.emoji.categories.${category.id}`, { defaultValue: category.name }),
        items: (groups ?? []).filter((group) => category.groups.includes(group.slug)).flatMap((group) => group.emojis),
      })),
    ]
  }

  /* The rail: jump to a part of the list. */
  function jump(id) {
    const body = bodyRef.current
    const target = body?.querySelector(`[data-section="${id === 'custom' ? 'guild' : id}"]`)
    setTab(id)
    setUploading(false)
    setMenu(null)
    if (body && target) body.scrollTo({ top: target.offsetTop - body.offsetTop, behavior: document.documentElement.classList.contains('motion-reduce') ? 'auto' : 'smooth' })
  }

  /* The part at the top of the list lights up in the rail. */
  function onBodyScroll() {
    setMenu(null)
    const body = bodyRef.current
    if (!body || search) return
    let current = null
    for (const element of body.querySelectorAll('[data-section]')) {
      if (element.offsetTop - body.offsetTop <= body.scrollTop + 12) current = element.dataset.tab || element.dataset.section
    }
    if (current && current !== tab) setTab(current)
  }

  function choose(item) {
    onChange(item.value)
    if (inserting) {
      rememberEmoji(item.value)
      setRecent(getRecentEmojis())
      setOpen(false)
      setMenu(null)
      setQuery('')
      return
    }
    rememberEmoji(item.value)
    setRecent(getRecentEmojis())
    setOpen(false)
    setMenu(null)
    setQuery('')
  }

  function updateFavorites(list) {
    setFavorites(saveFavoriteEmojis(list))
  }

  function toggleFavorite(item) {
    updateFavorites(
      favorites.includes(item.value) ? favorites.filter((entry) => entry !== item.value) : [...favorites, item.value],
    )
    setMenu(null)
  }

  function moveFavorite(item, step) {
    const index = favorites.indexOf(item.value)
    const target = index + step
    if (index === -1 || target < 0 || target >= favorites.length) return
    const next = [...favorites]
    ;[next[index], next[target]] = [next[target], next[index]]
    updateFavorites(next)
    setMenu((state) => (state ? { ...state } : state))
  }

  function dropFavorite(fromValue, toValue) {
    if (!fromValue || fromValue === toValue) return
    const next = favorites.filter((entry) => entry !== fromValue)
    const index = toValue ? next.indexOf(toValue) : next.length
    next.splice(index === -1 ? next.length : index, 0, fromValue)
    updateFavorites(next)
  }

  async function removeEmoji(item) {
    await deleteCustomEmoji(item.id)
    setCustom((state) => ({ ...state, bot: (state?.bot ?? []).filter((emoji) => emoji.id !== item.id) }))
    updateFavorites(favorites.filter((entry) => entry !== item.value))
    forgetRecentEmoji(item.value)
    setRecent(getRecentEmojis())
    if (value === item.value) onChange('')
  }

  function openMenu(item, section, x, y) {
    const box = panelRef.current?.getBoundingClientRect()
    if (!box) return
    // Keep the menu inside the panel.
    const left = Math.min(Math.max(8, x - box.left), box.width - 216)
    const top = Math.min(Math.max(8, y - box.top), box.height - 190)
    setMenu({ item, section, x: Math.max(8, left), y: Math.max(8, top) })
  }

  function itemHandlers(item, section) {
    return {
      onContextMenu: (event) => {
        event.preventDefault()
        openMenu(item, section, event.clientX, event.clientY)
      },
      onKeyDown: (event) => {
        if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
          event.preventDefault()
          const rect = event.currentTarget.getBoundingClientRect()
          openMenu(item, section, rect.left + rect.width / 2, rect.bottom)
        }
      },
      // Long press on touch screens.
      onPointerDown: (event) => {
        if (event.pointerType !== 'touch') return
        const { clientX, clientY } = event
        pressRef.current = window.setTimeout(() => {
          pressRef.current = 'opened'
          openMenu(item, section, clientX, clientY)
        }, LONG_PRESS_MS)
      },
      onPointerUp: () => {
        if (typeof pressRef.current === 'number') window.clearTimeout(pressRef.current)
      },
      onPointerLeave: () => {
        if (typeof pressRef.current === 'number') window.clearTimeout(pressRef.current)
      },
      onClick: () => {
        if (pressRef.current === 'opened') {
          pressRef.current = null
          return
        }
        choose(item)
      },
    }
  }

  function dragHandlers(item) {
    return {
      draggable: true,
      onDragStart: (event) => {
        dragRef.current = item.value
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', item.value)
      },
      onDragOver: (event) => {
        if (!dragRef.current) return
        event.preventDefault()
        setDropTarget(item.value)
      },
      onDragLeave: () => setDropTarget((state) => (state === item.value ? null : state)),
      onDrop: (event) => {
        event.preventDefault()
        dropFavorite(dragRef.current, item.value)
        dragRef.current = null
        setDropTarget(null)
      },
      onDragEnd: () => {
        dragRef.current = null
        setDropTarget(null)
      },
    }
  }

  const tabs = [
    ...(favorites.length ? [{ id: 'favorites', icon: <span className="material-symbols-outlined">star</span>, label: t('fdc.emoji.favorites', { defaultValue: 'Favorites' }) }] : []),
    ...(recent.length ? [{ id: 'recent', icon: <span className="material-symbols-outlined">schedule</span>, label: t('fdc.emoji.recent', { defaultValue: 'Frequently used' }) }] : []),
    { id: 'custom', icon: <span className="material-symbols-outlined">diamond</span>, label: t('fdc.emoji.custom', { defaultValue: 'Server & bot emojis' }) },
    ...CATEGORIES.map((category) => ({
      id: category.id,
      icon: <EmojiImage url={twemojiUrl(category.icon)} size={20} />,
      label: t(`fdc.emoji.categories.${category.id}`, { defaultValue: category.name }),
    })),
  ]

  const loadingList = !search && !groups
  const empty = Boolean(search) && !sections[0].items.length

  const emptyText = t('fdc.emoji.none', { defaultValue: 'No emojis found.' })

  return (
    <div className={`emoji-picker${inserting ? ' emoji-picker--insert' : ''}`} ref={rootRef}>
      {inserting ? (
        <button
          type="button"
          className="emoji-picker__insert"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          title={label ?? t('fdc.emoji.insert', { defaultValue: 'Add an emoji' })}
          aria-label={label ?? t('fdc.emoji.insert', { defaultValue: 'Add an emoji' })}
          onClick={() => {
            setOpen((state) => !state)
            setMenu(null)
          }}
        >
          <span className="material-symbols-outlined" aria-hidden="true">add_reaction</span>
        </button>
      ) : (
      <div className="emoji-picker__field">
        <button
          type="button"
          className={`emoji-picker__trigger${value ? '' : ' emoji-picker__trigger--default'}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-labelledby={labelledBy}
          onClick={() => {
            setOpen((state) => !state)
            setMenu(null)
          }}
        >
          {current && <EmojiImage url={current.url} size={26} />}
          {/* Custom emoji show their name; Unicode ones only the image. */}
          {(!value || current?.custom) && (
            <span className="emoji-picker__value">
              {value ? current.label : emptyLabel ?? t('fdc.emoji.default', { defaultValue: 'Default' })}
            </span>
          )}
          <span className="material-symbols-outlined" aria-hidden="true">expand_more</span>
        </button>

        {value && (
          <button
            type="button"
            className="fdc-link emoji-picker__clear"
            onClick={() => onChange('')}
            aria-label={t('fdc.emoji.clear', { defaultValue: 'Use the default emoji' })}
          >
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        )}
      </div>
      )}

      {open && (
        <div
          ref={panelRef}
          className="emoji-picker__panel"
          id={panelId}
          role="dialog"
          aria-label={t('fdc.emoji.title', { defaultValue: 'Choose an emoji' })}
        >
          <div className="emoji-picker__search">
            <span className="material-symbols-outlined" aria-hidden="true">search</span>
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder={t('fdc.emoji.search', { defaultValue: 'Search emojis' })}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <div className="emoji-picker__main">
          {!search && (
            <nav className="emoji-picker__tabs" aria-label={t('fdc.emoji.categoriesLabel', { defaultValue: 'Categories' })}>
              {tabs.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  aria-current={tab === entry.id ? 'true' : undefined}
                  className={tab === entry.id ? 'is-active' : ''}
                  title={entry.label}
                  aria-label={entry.label}
                  onClick={() => jump(entry.id)}
                >
                  {entry.icon}
                </button>
              ))}
            </nav>
          )}

          <div className="emoji-picker__body" ref={bodyRef} onScroll={onBodyScroll}>
            {uploading ? (
              <UploadForm
                onCancel={() => setUploading(false)}
                onUploaded={(emoji) => {
                  setCustom((state) => ({ ...state, bot: [...(state?.bot ?? []), emoji] }))
                  setUploading(false)
                  choose({ value: emoji.markup })
                }}
              />
            ) : (
              <>
                {loadingList && (
                  <div className="emoji-picker__grid" aria-hidden="true">
                    {Array.from({ length: 24 }, (_, index) => (
                      <span key={index} className="emoji-picker__placeholder">
                        <span className="emoji-image emoji-image--loading" />
                      </span>
                    ))}
                  </div>
                )}

                {sections.map((section) =>
                  section.items.length ? (
                    <section key={section.id} className="emoji-picker__section" data-section={section.id} data-tab={section.tab}>
                      <h5>
                        {section.title}
                        {section.sortable && section.items.length > 1 && (
                          <span className="emoji-picker__section-hint">
                            {t('fdc.emoji.dragHint', { defaultValue: 'drag to reorder' })}
                          </span>
                        )}
                      </h5>
                      <div className="emoji-picker__grid">
                        {section.items.map((item) => (
                          <button
                            key={item.value}
                            type="button"
                            className={[
                              item.value === value && 'is-selected',
                              favorites.includes(item.value) && section.id !== 'favorites' && 'is-favorite',
                              dropTarget === item.value && 'is-drop-target',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            title={item.name}
                            aria-label={item.name}
                            onMouseEnter={() => setHovered(item)}
                            onFocus={() => setHovered(item)}
                            {...itemHandlers(item, section.id)}
                            {...(section.sortable ? dragHandlers(item) : {})}
                          >
                            <EmojiImage url={item.url} />
                          </button>
                        ))}
                      </div>
                    </section>
                  ) : null,
                )}

                {empty && <p className="emoji-picker__empty">{emptyText}</p>}
              </>
            )}
          </div>

          </div>

          {!uploading && (
            <footer className="emoji-picker__footer">
              <span className="emoji-picker__hovered">
                {hovered && (
                  <>
                    <EmojiImage url={hovered.url} size={22} />
                    <span>{hovered.name}</span>
                  </>
                )}
              </span>

              {custom && !custom.error && (
                <button
                  type="button"
                  className="fdc-link"
                  onClick={() => {
                    setTab('custom')
                    setUploading(true)
                    setMenu(null)
                  }}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">add_reaction</span>
                  {t('fdc.emoji.add', { defaultValue: 'Upload emoji' })}
                </button>
              )}
            </footer>
          )}

          {menu && (
            <ContextMenu
              menu={menu}
              favorites={favorites}
              onFavorite={toggleFavorite}
              onMove={moveFavorite}
              onForget={(item) => {
                forgetRecentEmoji(item.value)
                setRecent(getRecentEmojis())
                setMenu(null)
              }}
              onDelete={removeEmoji}
              onClose={() => setMenu(null)}
            />
          )}
        </div>
      )}
    </div>
  )
}
