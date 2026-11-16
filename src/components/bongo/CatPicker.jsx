import { useEffect, useMemo, useRef, useState } from 'react'

import { changeAlias, loadFavorites, setFavorite, textureUrl } from '/src/lib/bongo'
import { NONE, RARITY_COLORS, matchScore, rarityRank } from '/shared/bongo-design.mjs'
import { GameIcon, ItemIcon, ThemeMenu } from './BongoRender'
import '/src/styles/bongo.css'
import { useBongoTheme } from '/src/lib/bongoTheme'

/*
 * The item picker, laid out like the game's own wardrobe: a rail of tabs
 * (skins, accessories, bongos, extra tabs like presets, search) next to a
 * compact panel of square tiles framed in their rarity colour.
 *
 * - Search is its own tab and searches every type at once (names and
 *   single-word aliases, most relevant first).
 * - Grid view shows names on hover, list view shows them in full.
 * - Right-click (or long-press) an item: favourite it (favourites sit at
 *   the top, synced per account), wear it, see and edit its search words.
 *
 * mode "single": value `{ skin, hat, bongos }`; picking the selected item
 *   takes it off (no skin = the default cat, which isn't listed).
 * mode "multi": value `{ skins: [], hats: [], bongos: [] }`; every picked
 *   item is a variation; "None" is a variation without that slot.
 * `tab` / `onTab`: control the open tab from outside (optional).
 */

const TABS = [
  { id: 'skin', list: 'skins', label: 'Skins', icon: 'skins', fallback: 'pets', none: 'Default cat' },
  { id: 'hat', list: 'hats', label: 'Accessories', icon: 'hats', fallback: 'styler', none: 'No accessory' },
  { id: 'bongos', list: 'bongos', label: 'Bongos', icon: 'bongos', fallback: 'album', none: 'No bongos' },
]
const TAB_OF = Object.fromEntries(TABS.map((entry) => [entry.id, entry]))

const SORTS = [
  { id: 'rarity', label: 'Rarity' },
  { id: 'name', label: 'Name' },
  { id: 'newest', label: 'Newest' },
]

const VIEW_KEY = 'homesite:bongoPickerView'
const readView = () => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

function compare(sort) {
  if (sort === 'name') return (a, b) => a.name.localeCompare(b.name)
  if (sort === 'newest') return (a, b) => Number(b.id) - Number(a.id)
  return (a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || a.name.localeCompare(b.name)
}

const rarityColor = (rarity) => RARITY_COLORS[rarity] ?? '#8a8a8a'

/* An item with the search words the server answered after an edit. */
const withAliases = (item, words) => ({ ...item, aliases: words.aliases, customAliases: words.customAliases })

/* ---------- one item ---------- */

function Check({ catalog }) {
  return (
    <span className="bp-check" aria-hidden="true">
      {catalog.ui?.check ? <img src={textureUrl(catalog, catalog.ui.check)} alt="" draggable={false} /> : <span className="material-symbols-outlined">check</span>}
    </span>
  )
}

/* A tile (grid) or a row (list). `item` null = the "nothing in this slot" entry. */
function Entry({ catalog, view, item, art, name, meta, color, selected, favorite, slotIcon, onPick, onMenu, onHover }) {
  const pressRef = useRef(null)
  return (
    <li>
      <button
        type="button"
        className={`bp-item bp-item--${view}${selected ? ' is-selected' : ''}${item ? '' : ' bp-item--none'}`}
        style={{ '--rarity': color }}
        aria-pressed={selected}
        aria-label={name}
        onClick={onPick}
        onContextMenu={(event) => {
          event.preventDefault()
          if (item) onMenu(item, event.clientX, event.clientY)
        }}
        onPointerEnter={(event) => view === 'grid' && event.pointerType === 'mouse' && onHover({ name, color, rect: event.currentTarget.getBoundingClientRect() })}
        onPointerLeave={() => {
          onHover(null)
          clearTimeout(pressRef.current)
        }}
        onPointerDown={(event) => {
          if (event.pointerType !== 'touch' || !item) return
          const { clientX, clientY } = event
          pressRef.current = setTimeout(() => onMenu(item, clientX, clientY), 480)
        }}
        onPointerUp={() => clearTimeout(pressRef.current)}
        onPointerCancel={() => clearTimeout(pressRef.current)}
      >
        <span className="bp-item__art">{art}</span>
        {view === 'list' && (
          <span className="bp-item__text">
            <span className="bp-item__name">{name}</span>
            {meta && <span className="bp-item__meta">{meta}</span>}
          </span>
        )}
        {view === 'grid' && slotIcon && <span className="bp-item__slot">{slotIcon}</span>}
        {favorite && (
          <span className="bp-item__star material-symbols-outlined" aria-label="Favourite">
            star
          </span>
        )}
        {selected && <Check catalog={catalog} />}
      </button>
    </li>
  )
}

/* ---------- the right-click menu ---------- */

function ItemMenu({ catalog, menu, favorite, selected, mode, editor, onFavorite, onPick, onClose, onAliases }) {
  const { item } = menu
  const [word, setWord] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const custom = new Set(item.customAliases ?? [])
  const ref = useRef(null)
  const [position, setPosition] = useState({ left: menu.x, top: menu.y })

  useEffect(() => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    // Kept on screen (measured after the first paint).
    const left = Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8))
    const top = Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8))
    if (left !== menu.x || top !== menu.y) requestAnimationFrame(() => setPosition({ left, top }))
  }, [menu])

  async function edit(change) {
    setBusy(true)
    setError(null)
    try {
      const result = await changeAlias(item.id, change)
      onAliases(item.id, result)
      setWord('')
    } catch (reason) {
      setError(reason.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={ref} className="bp-menu" style={position} role="menu" onPointerDown={(event) => event.stopPropagation()}>
      <div className="bp-menu__head">
        <ItemIcon catalog={catalog} item={item} size={40} />
        <div>
          <p className="bp-menu__name">{item.name}</p>
          <p className="bp-menu__meta">
            {TAB_OF[item.slot]?.label}
            {item.rarity && (
              <>
                {', '}
                <span style={{ color: rarityColor(item.rarity) }}>{item.rarity}</span>
              </>
            )}
          </p>
        </div>
      </div>
      <button type="button" role="menuitem" onClick={() => onFavorite(item)}>
        <span className="material-symbols-outlined" aria-hidden="true">
          {favorite ? 'star' : 'star_outline'}
        </span>
        {favorite ? 'Remove from favourites' : 'Add to favourites'}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onPick(item)
          onClose()
        }}
      >
        <span className="material-symbols-outlined" aria-hidden="true">
          {selected ? 'remove_done' : 'check'}
        </span>
        {selected ? (mode === 'multi' ? 'Remove variation' : 'Take off') : mode === 'multi' ? 'Add as variation' : 'Wear'}
      </button>
      <div className="bp-menu__words">
        <p>Search words</p>
        <ul>
          {item.aliases?.map((alias) => (
            <li key={alias} className={custom.has(alias) ? 'is-custom' : ''}>
              {alias}
              {editor && (
                <button type="button" aria-label={`Remove the search word ${alias}`} title="Remove" disabled={busy} onClick={() => edit({ remove: alias })}>
                  <span className="material-symbols-outlined" aria-hidden="true">
                    close
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
        {editor && (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (word.trim()) edit({ add: word.trim() })
            }}
          >
            <input value={word} maxLength={24} placeholder="Add a word" aria-label="Add a search word" onChange={(event) => setWord(event.target.value.replace(/\s/g, ''))} />
            <button type="submit" disabled={busy || !word.trim()}>
              Add
            </button>
          </form>
        )}
        {error && <p className="bp-menu__error">{error}</p>}
      </div>
    </div>
  )
}

/* ---------- the picker ---------- */

export default function CatPicker({ catalog, mode = 'single', value, onChange, extraTabs = [], initialTab = 'skin', tab: controlledTab, onTab, allowNone = false, editor = true, className = '' }) {
  const [theme, changeTheme, themed] = useBongoTheme(catalog)
  const [ownTab, setOwnTab] = useState(initialTab)
  const tab = controlledTab ?? ownTab
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('rarity')
  const [view, setViewState] = useState(readView)
  const [favorites, setFavorites] = useState({ synced: false, skin: [], hat: [], bongos: [] })
  const [menu, setMenu] = useState(null) // { item, x, y }
  const [hover, setHover] = useState(null)
  const [aliasEdits, setAliasEdits] = useState({}) // id -> { aliases, customAliases }
  const searchRef = useRef(null)
  const scrollRef = useRef(null)

  function setTab(id) {
    setOwnTab(id)
    onTab?.(id)
    setHover(null)
    scrollRef.current?.scrollTo(0, 0)
    if (id === 'search') requestAnimationFrame(() => searchRef.current?.focus())
  }

  function setView(next) {
    setViewState(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // only for this visit
    }
  }

  useEffect(() => {
    let alive = true
    loadFavorites().then((data) => alive && setFavorites(data))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close()
    }
    const scroller = scrollRef.current
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    scroller?.addEventListener('scroll', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
      scroller?.removeEventListener('scroll', close)
    }
  }, [menu])

  // Items (of the slots the picker knows), with search words editors just changed.
  const items = useMemo(
    () => catalog.items.filter((item) => TAB_OF[item.slot]).map((item) => (aliasEdits[item.id] ? withAliases(item, aliasEdits[item.id]) : item)),
    [catalog, aliasEdits],
  )

  const current = TAB_OF[tab]
  const extra = extraTabs.find((entry) => entry.id === tab)
  const listOf = (slot) => TAB_OF[slot].list
  const isSelected = (slot, id) => (mode === 'single' ? value?.[slot] === id : (value?.[listOf(slot)] ?? []).includes(id))
  const favoriteIds = (slot) => favorites[slot] ?? []

  function pick(slot, id) {
    if (mode === 'single') {
      onChange(slot, value?.[slot] === id ? null : id)
      return
    }
    const list = value?.[listOf(slot)] ?? []
    onChange(slot, list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id])
  }

  async function toggleFavorite(item) {
    const slot = item.slot
    const on = !favoriteIds(slot).includes(item.id)
    setFavorites((state) => ({ ...state, [slot]: on ? [item.id, ...(state[slot] ?? [])] : (state[slot] ?? []).filter((id) => id !== item.id) }))
    try {
      const saved = await setFavorite(slot, item.id, on, favorites.synced)
      setFavorites((state) => ({ ...state, ...saved }))
    } catch {
      // keeps the optimistic state; the next load fixes it
    }
  }

  const { favoriteItems, otherItems } = useMemo(() => {
    if (!current) return { favoriteItems: [], otherItems: [] }
    const ofTab = items.filter((item) => item.slot === current.id)
    const order = favorites[current.id] ?? []
    const favoriteSet = new Set(order)
    return {
      favoriteItems: order.map((id) => ofTab.find((item) => item.id === id)).filter(Boolean),
      otherItems: ofTab.filter((item) => !favoriteSet.has(item.id)).sort(compare(sort)),
    }
  }, [items, current, favorites, sort])

  const results = useMemo(() => {
    if (tab !== 'search' || !query.trim()) return null
    return items
      .map((item) => ({ item, score: matchScore(item, query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || rarityRank(b.item.rarity) - rarityRank(a.item.rarity) || a.item.name.localeCompare(b.item.name))
      .slice(0, 200)
      .map((entry) => entry.item)
  }, [items, query, tab])

  function random() {
    const pool = items.filter((item) => item.slot === current.id && !item.retired && !isSelected(item.slot, item.id))
    const item = pool[Math.floor(Math.random() * pool.length)]
    if (item) pick(item.slot, item.id)
  }

  const iconSize = view === 'grid' ? 48 : 36
  const entry = (item, showSlot = false) => (
    <Entry
      key={item.id}
      catalog={catalog}
      view={view}
      item={item}
      art={<ItemIcon catalog={catalog} item={item} size={iconSize} />}
      name={item.name + (item.retired ? ' (no longer in the game)' : '')}
      meta={
        <>
          {showSlot && <span>{TAB_OF[item.slot].label}</span>}
          {item.rarity && <span style={{ color: rarityColor(item.rarity) }}>{item.rarity}</span>}
        </>
      }
      color={rarityColor(item.rarity)}
      selected={isSelected(item.slot, item.id)}
      favorite={favoriteIds(item.slot).includes(item.id)}
      slotIcon={showSlot ? <GameIcon catalog={catalog} name={TAB_OF[item.slot].icon} fallback={TAB_OF[item.slot].fallback} /> : null}
      onPick={() => pick(item.slot, item.id)}
      onMenu={(target, x, y) => setMenu({ item: target, x, y })}
      onHover={setHover}
    />
  )

  // "Nothing in this slot": the default cat, or no accessory / bongos ("None" variation in multi mode).
  const noneSelected = current && (mode === 'single' ? !value?.[current.id] : (value?.[current.list] ?? []).includes(NONE))
  const noneEntry = current && (mode === 'single' || allowNone) && (
    <Entry
      key="none"
      catalog={catalog}
      view={view}
      item={null}
      art={
        current.id === 'skin' ? (
          <ItemIcon catalog={catalog} item={catalog.defaultSkin} size={iconSize} />
        ) : (
          <span className="material-symbols-outlined bp-item__none" aria-hidden="true">
            block
          </span>
        )
      }
      name={mode === 'multi' ? `${current.none} (a variation without it)` : current.none}
      color="#8a8a8a"
      selected={noneSelected}
      onPick={() => {
        if (mode === 'single') onChange(current.id, null)
        else {
          const list = value?.[current.list] ?? []
          onChange(current.id, list.includes(NONE) ? list.filter((id) => id !== NONE) : [...list, NONE])
        }
      }}
      onMenu={() => {}}
      onHover={setHover}
    />
  )

  const count = (slot) => (mode === 'single' ? (value?.[slot] ? 1 : 0) : (value?.[listOf(slot)] ?? []).length)
  const rail = [
    ...TABS.map((tabEntry) => ({ ...tabEntry, badge: count(tabEntry.id) })),
    ...extraTabs.map((tabEntry) => ({ ...tabEntry, fallback: tabEntry.materialIcon ?? 'apps' })),
    { id: 'search', label: 'Search', icon: 'search', fallback: 'search' },
  ]

  return (
    <div className={`bp ${themed.className} ${className}`} style={themed.style}>
      <nav className="bp-rail" role="tablist" aria-label="Item types">
        {rail.map((tabEntry) => (
          <button
            key={tabEntry.id}
            type="button"
            role="tab"
            aria-selected={tab === tabEntry.id}
            aria-label={tabEntry.label}
            title={tabEntry.label}
            className={`bp-rail__tab${tab === tabEntry.id ? ' is-active' : ''}`}
            onClick={() => setTab(tabEntry.id)}
          >
            {catalog.ui?.[tabEntry.icon] ? (
              <img src={textureUrl(catalog, catalog.ui[tabEntry.icon])} alt="" draggable={false} />
            ) : (
              <span className="material-symbols-outlined" aria-hidden="true">
                {tabEntry.fallback}
              </span>
            )}
            {tabEntry.badge > 0 && <span className="bp-rail__badge">{tabEntry.badge}</span>}
          </button>
        ))}
      </nav>

      <div className="bp-panel" role="tabpanel" aria-label={current?.label ?? extra?.label ?? 'Search'}>
        <div className="bp-bar">
          {tab === 'search' ? (
            <label className="bp-search">
              <span className="material-symbols-outlined" aria-hidden="true">search</span>
              <input ref={searchRef} type="search" placeholder="Search all items…" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
          ) : (
            <span className="bp-bar__title">
              {current?.label ?? extra?.label}
              {current && <small>{favoriteItems.length + otherItems.length}</small>}
            </span>
          )}
          {!extra && (
            <div className="bp-bar__tools">
              {current && (
                <label className="bp-tool bp-sort" title="Sort">
                  <span className="material-symbols-outlined" aria-hidden="true">filter_list</span>
                  <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort by">
                    {SORTS.map((sortEntry) => (
                      <option key={sortEntry.id} value={sortEntry.id}>
                        {sortEntry.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button type="button" className="bp-tool" title={view === 'grid' ? 'List with names' : 'Grid'} aria-label={view === 'grid' ? 'Show as list' : 'Show as grid'} onClick={() => setView(view === 'grid' ? 'list' : 'grid')}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  {view === 'grid' ? 'view_list' : 'grid_view'}
                </span>
              </button>
            </div>
          )}
        </div>

        <div className="bp-scroll" ref={scrollRef}>
          {extra ? (
            extra.render()
          ) : tab === 'search' ? (
            !query.trim() ? (
              <p className="bp-empty">Search skins, accessories and bongos at once: a name, or a word like “crown”, “winter”, “music” or “legendary”.</p>
            ) : results.length ? (
              <ul className={`bp-list bp-list--${view}`}>{results.map((item) => entry(item, true))}</ul>
            ) : (
              <p className="bp-empty">Nothing matches “{query.trim()}”.</p>
            )
          ) : (
            <>
              {favoriteItems.length > 0 && (
                <>
                  <ul className={`bp-list bp-list--${view}`} aria-label="Favourites">
                    {favoriteItems.map((item) => entry(item))}
                  </ul>
                  <hr className="bp-divider" />
                </>
              )}
              <ul className={`bp-list bp-list--${view}`}>
                {noneEntry}
                {otherItems.map((item) => entry(item))}
              </ul>
            </>
          )}
        </div>

        <div className="bp-foot">
          <ThemeMenu catalog={catalog} theme={theme} onChange={changeTheme} />
          <span className="bp-foot__hint">{extra ? '' : 'Right-click an item for favourites and search words'}</span>
          {current && (
            <button type="button" className="bp-tool" title={mode === 'multi' ? 'Add a random one' : 'Random'} aria-label="Pick a random item" onClick={random}>
              <span className="material-symbols-outlined" aria-hidden="true">casino</span>
            </button>
          )}
        </div>
      </div>

      {hover && (
        <span className="bp-tooltip" style={{ left: hover.rect.left + hover.rect.width / 2, top: hover.rect.top, '--rarity': hover.color }} role="tooltip">
          {hover.name}
        </span>
      )}

      {menu && (
        <ItemMenu
          catalog={catalog}
          menu={menu}
          mode={mode}
          editor={editor}
          favorite={favoriteIds(menu.item.slot).includes(menu.item.id)}
          selected={isSelected(menu.item.slot, menu.item.id)}
          onFavorite={toggleFavorite}
          onPick={(item) => pick(item.slot, item.id)}
          onClose={() => setMenu(null)}
          onAliases={(id, words) => {
            setAliasEdits((state) => ({ ...state, [id]: words }))
            setMenu((state) => (state ? { ...state, item: withAliases(state.item, words) } : state))
          }}
        />
      )}
    </div>
  )
}
