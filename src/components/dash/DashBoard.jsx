import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CATEGORIES, WIDGETS, availableTypes, defaultOptions, useWidgetTitle } from './widgets.jsx'
import { DashLobbyCat } from './widgetsSite.jsx'
import DashWidgetEditor from './DashWidgetEditor.jsx'
import { Glyph, RefreshContext, RollingContext, WidgetSetupContext, isMaterialIcon, useFitScroll, useSeen } from './kit.jsx'
import { DashMenu, mergeHandlers, useMenuTrigger } from './menus.jsx'
import { place } from '../../lib/dashGrid.js'

// Room a drag or resize may use below the lowest widget (the next drag gets more), and the board's limit.
const DRAG_ROOM = 6
const MAX_BOARD_ROWS = 400
import { MAX_ROWS, MAX_WIDGETS, addWidget, duplicateWidget, getDashSettings, isColor, moveWidgetToPage, phoneLayout, removeWidget, scaledSize, setLayout, updateDashSettings, updateWidget, useDashSettings } from '../../lib/dashSettings.js'

/*
 * The /dash board: a grid of `look.columns` cells (`look.phoneColumns` on
 * phones, with its own layout), rows of `look.rowHeight` px, `look.gap`
 * between. Widgets sit where you put them (x / y / w / h).
 *
 * Edit mode: drag a widget to move it (others make room, same-size ones
 * swap), drag its right / bottom edge or corner to resize, or use the
 * keyboard on a focused widget (arrows move, Shift + arrows resize, Delete
 * removes); Ctrl + Z undoes. Widget contents load when they come near the
 * screen; one broken widget never takes the board down.
 */

const PHONE_WIDTH = 640 // px of board: below this, the phone layout

/* ---------- measuring ---------- */

function useWidth(ref) {
  const [width, setWidth] = useState(0)
  // Measured before the first paint, so the board never shows the wrong layout for a moment.
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined
    const measure = () => setWidth(element.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return width
}

/* The live frame while resizing from `axis` (n / s / e / w and the corners): the opposite sides stay put. */
function resizeFrame(start, axis, dx, dy, cell, row) {
  let { left, top, width, height } = start
  if (axis.includes('e')) width = Math.max(cell, start.width + dx)
  if (axis.includes('s')) height = Math.max(row, start.height + dy)
  if (axis.includes('w')) {
    width = Math.max(cell, start.width - dx)
    left = Math.max(0, start.left + start.width - width)
    width = start.left + start.width - left
  }
  if (axis.includes('n')) {
    height = Math.max(row, start.height - dy)
    top = Math.max(0, start.top + start.height - height)
    height = start.top + start.height - top
  }
  return { left, top, width, height }
}

/* ---------- one widget ---------- */

class WidgetBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error) {
    console.error('[dash] a widget failed:', error)
  }
  // New options after a crash: a fresh try (without remounting a working widget, which would lose focus and state).
  componentDidUpdate(previous) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function Tool({ icon, label, onClick, danger = false, ...rest }) {
  return (
    <button type="button" className={`dash-tool${danger ? ' dash-tool--danger' : ''}`} onClick={onClick} title={label} aria-label={label} {...rest}>
      <span className="material-symbols-outlined" aria-hidden="true">
        {icon}
      </span>
    </button>
  )
}

function WidgetBody({ widget, editing, rolling }) {
  const { t } = useTranslation('dash')
  const setup = useCallback(() => window.dispatchEvent(new CustomEvent('dash:edit-widget', { detail: widget.id })), [widget.id])
  const [refreshed, setRefreshed] = useState(0)
  useEffect(() => {
    const refresh = (event) => event.detail === widget.id && setRefreshed((value) => value + 1)
    window.addEventListener('dash:refresh-widget', refresh)
    return () => window.removeEventListener('dash:refresh-widget', refresh)
  }, [widget.id])
  const ref = useRef(null)
  const seen = useSeen(ref)
  useFitScroll(ref)
  const View = WIDGETS[widget.type].View
  return (
    <div ref={ref} className="dash-widget__body" inert={editing ? true : undefined}>
      {seen ? (
        <WidgetBoundary
          resetKey={JSON.stringify(widget.options)}
          fallback={
            <div className="dash-empty">
              <span className="material-symbols-outlined" aria-hidden="true">
                error
              </span>
              <p>{t('widgets.crashed')}</p>
            </div>
          }
        >
          <RollingContext.Provider value={rolling}>
            <WidgetSetupContext.Provider value={setup}>
              <RefreshContext.Provider value={refreshed}>
                <View widget={widget} editing={editing} />
              </RefreshContext.Provider>
            </WidgetSetupContext.Provider>
          </RollingContext.Provider>
        </WidgetBoundary>
      ) : null}
    </div>
  )
}

/* The title typed in place (the widget menu's "Rename"): Enter or leaving the field saves, Escape cancels. */
function RenameField({ widget, placeholder, onDone }) {
  const { t } = useTranslation('dash')
  const [value, setValue] = useState(widget.title ?? '')
  const done = useRef(false)
  const finish = (save) => {
    if (done.current) return
    done.current = true
    if (save) updateWidget(widget.id, { title: value.trim().slice(0, 60) })
    onDone()
  }
  return (
    <input
      className="dash-widget__rename"
      autoFocus
      value={value}
      maxLength={60}
      placeholder={placeholder}
      aria-label={t('menu.rename')}
      onFocus={(event) => event.target.select()}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') finish(true)
        if (event.key === 'Escape') finish(false)
      }}
      onBlur={() => finish(true)}
      onPointerDown={(event) => event.stopPropagation()}
    />
  )
}

/* A widget's own CSS, nested under its card (`&` is the card), strong enough to beat the dash's card styles; `</style` can't end the element early. */
const widgetCss = (id, css) => `.dash-widget.dash-widget[data-widget="${id}"] {\n${String(css).replaceAll('</', '<\\/')}\n}`

function Widget({ widget, box, frame, editing, dragging, onPointerDown, onResizeStart, onKey, onEdit, onRemove, onDuplicate, onMenu, renaming, onRenamed, hiddenOnPhone, rollingAll }) {
  const { t } = useTranslation('dash')
  const trigger = useMenuTrigger((at) => onMenu(at, widget))
  const spec = WIDGETS[widget.type]
  const title = useWidgetTitle(widget)
  const look = widget.look ?? {}
  const style = {
    transform: `translate(${frame.left}px, ${frame.top}px)`,
    width: frame.width,
    height: frame.height,
    ...(isColor(look.accent) ? { '--dash-accent': look.accent } : {}),
  }
  const label = title || t(`widgets.${widget.type}.name`)
  return (
    <section
      className={[
        'dash-widget',
        `dash-widget--${widget.type}`,
        look.style && look.style !== 'inherit' ? `dash-widget--style-${look.style}` : '',
        look.padding === 'none' ? 'dash-widget--flush' : '',
        look.font && look.font !== 'inherit' ? `dash-widget--font-${look.font}` : '',
        editing ? 'is-editing' : '',
        dragging ? 'is-dragging' : '',
        hiddenOnPhone ? 'is-phone-hidden' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
      aria-label={label}
      data-widget={widget.id}
      tabIndex={editing ? 0 : undefined}
      {...mergeHandlers({ onPointerDown: editing ? onPointerDown : undefined, onKeyDown: editing ? onKey : undefined }, trigger)}
      aria-roledescription={editing ? t('board.movable') : undefined}
      aria-description={editing ? t('board.keys', { w: box.w, h: box.h }) : undefined}
    >
      {editing && (
        <div className="dash-widget__tools" data-drag-handle>
          <span className="material-symbols-outlined dash-widget__grip" aria-hidden="true">
            drag_indicator
          </span>
          <span className="dash-widget__type">
            {label}
            <small>
              {box.w}×{box.h}
            </small>
          </span>
          <Tool icon="tune" label={t('board.edit')} onClick={() => onEdit(widget.id)} data-no-drag />
          {!spec.single && <Tool icon="content_copy" label={t('board.duplicate')} onClick={() => onDuplicate(widget.id)} data-no-drag />}
          <Tool icon="delete" label={t('board.remove')} danger onClick={() => onRemove(widget.id)} data-no-drag />
        </div>
      )}
      {renaming ? (
        <RenameField widget={widget} placeholder={t(`widgets.${widget.type}.name`)} onDone={onRenamed} />
      ) : title && (
        <h2 className="dash-widget__title">
          {look.titleIcon !== false && <Glyph icon={look.icon} fallback={spec.icon} />}
          {title}
        </h2>
      )}
      {look.css?.trim() && <style>{widgetCss(widget.id, look.css)}</style>}
      <WidgetBody widget={widget} editing={editing} rolling={look.rolling === 'on' || (look.rolling !== 'off' && rollingAll)} />
      {editing && (
        <>
          {['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((side) => (
            <span key={side} className={`dash-resize dash-resize--${side}`} data-no-drag onPointerDown={(event) => onResizeStart(event, side)} aria-hidden="true" />
          ))}
        </>
      )}
    </section>
  )
}

/* ---------- picking a widget to add ---------- */

const NEEDS_SETUP = new Set(['rows', 'url', 'integration', 'place', 'datetime', 'code', 'entities'])

export function AddWidget({ onPick, onClose }) {
  const { t } = useTranslation('dash')
  const ref = useRef(null)
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const types = availableTypes().filter((type) => (category === 'all' || WIDGETS[type].category === category) && words.every((word) => `${type} ${t(`widgets.${type}.name`)} ${t(`widgets.${type}.text`)}`.toLowerCase().includes(word)))
  return (
    <dialog ref={ref} className="dash-dialog dash-dialog--picker" onClose={onClose} aria-labelledby="dash-add-title" onClick={(event) => event.target === ref.current && ref.current.close()}>
      <header className="dash-dialog__head">
        <span className="material-symbols-outlined" aria-hidden="true">
          add_box
        </span>
        <h2 id="dash-add-title">{t('board.addTitle')}</h2>
        <button type="button" className="dash-tool" onClick={() => ref.current?.close()} aria-label={t('settings.close')}>
          <span className="material-symbols-outlined">close</span>
        </button>
      </header>
      <div className="dash-picker__bar">
        <input type="search" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('board.findWidget')} aria-label={t('board.findWidget')} />
        <div className="dash-chips" role="tablist" aria-label={t('board.categories')}>
          {['all', ...CATEGORIES].map((id) => (
            <button key={id} type="button" role="tab" aria-selected={category === id} className={category === id ? 'is-active' : ''} onClick={() => setCategory(id)}>
              {t(`board.category.${id}`)}
            </button>
          ))}
        </div>
      </div>
      <ul className="dash-picker">
        {types.map((type) => {
          const spec = WIDGETS[type]
          const taken = spec.single && getDashSettings().widgets.some((widget) => widget.type === type)
          return (
            <li key={type}>
              <button type="button" onClick={() => onPick(type)} disabled={taken} title={taken ? t('board.onlyOnce') : undefined}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  {spec.icon}
                </span>
                <strong>
                  {t(`widgets.${type}.name`)}
                  {spec.needs && <small className="dash-chip">{t(`board.needs.${spec.needs}`)}</small>}
                  {taken && <small className="dash-chip">{t('board.onlyOnce')}</small>}
                </strong>
                <span>{t(`widgets.${type}.text`)}</span>
              </button>
            </li>
          )
        })}
        {!types.length && <li className="dash-hint">{t('board.noWidget')}</li>}
      </ul>
    </dialog>
  )
}

/* ---------- the board ---------- */

export default function DashBoard({ editing, setEditing, page, adding, setAdding, undoRef, openSettings }) {
  const { t } = useTranslation('dash')
  const { widgets: allWidgets, look, pages } = useDashSettings()
  const [menu, setMenu] = useState(null) // { x, y, items, label }
  const [renaming, setRenaming] = useState(null)
  const ref = useRef(null)
  const width = useWidth(ref)
  const [editId, setEditId] = useState(null)
  // "Set up" on an empty widget opens its editor.
  useEffect(() => {
    const open = (event) => typeof event.detail === 'string' && setEditId(event.detail)
    window.addEventListener('dash:edit-widget', open)
    return () => window.removeEventListener('dash:edit-widget', open)
  }, [])
  const [action, setAction] = useState(null) // { id, kind: 'move' | 'resize', axis, start, preview, pointer, startFrame }
  const actionRef = useRef(null)
  useEffect(() => {
    actionRef.current = action
  }, [action])
  const history = useRef([])

  const widgets = useMemo(() => allWidgets.filter((widget) => widget.page === page), [allWidgets, page])
  const phone = width > 0 && width < PHONE_WIDTH
  const columns = phone ? look.phoneColumns : look.columns
  const layout = useMemo(() => (phone ? phoneLayout(widgets, look) : widgets.map(({ id, x, y, w, h }) => ({ id, x, y, w, h }))), [phone, widgets, look])
  const shown = phone && !editing ? layout.filter((box) => !widgets.find((widget) => widget.id === box.id)?.look?.hideOnPhone) : layout
  // Hidden widgets on a phone leave no hole: the rest closes up.
  const visibleLayout = useMemo(() => (phone && !editing && shown.length !== layout.length ? place(shown, null, {}, columns, true) : shown), [phone, editing, shown, layout.length, columns])

  const gap = look.gap
  const row = look.rowHeight
  const cell = width > 0 ? (width - gap * (columns - 1)) / columns : 0
  const frameOf = useCallback((box) => ({ left: box.x * (cell + gap), top: box.y * (row + gap), width: box.w * cell + (box.w - 1) * gap, height: box.h * row + (box.h - 1) * gap }), [cell, gap, row])

  const current = action?.preview ?? visibleLayout
  const rows = current.reduce((max, box) => Math.max(max, box.y + box.h), 0)
  // While editing there's room below to drop into. A drag or resize gets a fixed room (DRAG_ROOM rows under the
  // lowest widget when it starts): the board doesn't grow while dragging, or scrolling near the edge would move the
  // widget down, grow the board, scroll again … and never let go. The next drag gets more room.
  const height = action ? (action.limitRows + 3) * (row + gap) : Math.max(0, rows * (row + gap) - gap) + (editing ? (row + gap) * 3 : 0)

  /* Remembered for undo (Ctrl + Z, the Undo button, menus), this visit only: widgets and pages. */
  const remember = useCallback(() => {
    const { widgets: savedWidgets, pages: savedPages, activePage } = getDashSettings()
    history.current = [...history.current.slice(-30), { widgets: savedWidgets, pages: savedPages, activePage }]
  }, [])
  useEffect(() => {
    if (!undoRef) return
    undoRef.current = {
      remember,
      canUndo: () => history.current.length > 0,
      undo: () => {
        const previous = history.current.pop()
        if (previous) updateDashSettings(previous)
      },
    }
  }, [undoRef, remember])
  const remove = (id) => {
    remember()
    removeWidget(id)
  }
  const duplicate = (id) => {
    remember()
    duplicateWidget(id)
  }

  /* ---------- right-click menus ---------- */

  const widgetMenu = ({ x, y, target }, widget) => {
    const link = target instanceof Element ? target.closest('a[href]') : null
    const href = link?.href && /^https?:/.test(link.href) ? link.href : null
    const box = layout.find((item) => item.id === widget.id)
    const others = pages.filter((entry) => entry.id !== widget.page)
    setMenu({
      x,
      y,
      label: t('menu.widget'),
      items: [
        href && { label: t('menu.openLink'), icon: 'open_in_new', onSelect: () => window.open(href, '_blank', 'noopener,noreferrer') },
        href && { label: t('menu.copyLink'), icon: 'link', onSelect: () => navigator.clipboard?.writeText(href) },
        href && '-',
        { label: t('board.edit'), icon: 'tune', hint: editing ? 'Enter' : undefined, onSelect: () => setEditId(widget.id) },
        { label: t('menu.refresh'), icon: 'refresh', onSelect: () => window.dispatchEvent(new CustomEvent('dash:refresh-widget', { detail: widget.id })) },
        { label: t('menu.rename'), icon: 'edit', onSelect: () => setRenaming(widget.id) },
        { label: t('board.duplicate'), icon: 'content_copy', onSelect: () => duplicate(widget.id), disabled: allWidgets.length >= MAX_WIDGETS || Boolean(WIDGETS[widget.type].single) },
        box && box.y > 0 && { label: t('menu.toTop'), icon: 'vertical_align_top', onSelect: () => commit(place(layout, widget.id, { y: 0 }, columns, false)) },
        {
          label: widget.look?.hideOnPhone ? t('menu.showOnPhone') : t('menu.hideOnPhone'),
          icon: widget.look?.hideOnPhone ? 'visibility' : 'visibility_off',
          onSelect: () => {
            remember()
            updateWidget(widget.id, { look: { ...widget.look, hideOnPhone: !widget.look?.hideOnPhone } })
          },
        },
        ...(others.length ? ['-'] : []),
        ...others.slice(0, 8).map((entry) => ({
          label: t('menu.moveTo', { page: entry.name || t('pages.untitled', { number: pages.indexOf(entry) + 1 }) }),
          icon: isMaterialIcon(entry.icon) ? entry.icon : 'tab',
          onSelect: () => {
            remember()
            moveWidgetToPage(widget.id, entry.id)
          },
        })),
        '-',
        !editing && { label: t('menu.editBoard'), icon: 'open_with', hint: 'E', onSelect: () => setEditing(true) },
        { label: t('board.remove'), icon: 'delete', danger: true, hint: editing ? 'Del' : undefined, onSelect: () => remove(widget.id) },
      ],
    })
  }

  const boardTrigger = useMenuTrigger(({ x, y, target }) => {
    // Only the board's empty space (widgets have their own menu).
    if (target instanceof Element && target.closest('.dash-widget')) return
    setMenu({
      x,
      y,
      label: t('menu.board'),
      items: [
        { label: t('board.add'), icon: 'add_box', onSelect: () => setAdding(true) },
        { label: editing ? t('board.done') : t('menu.editBoard'), icon: editing ? 'check' : 'open_with', hint: 'E', onSelect: () => setEditing(!editing) },
        { label: t('board.undo'), icon: 'undo', hint: 'Ctrl+Z', disabled: !history.current.length, onSelect: () => undoRef.current?.undo() },
        '-',
        { label: t('board.grid'), icon: 'grid_on', onSelect: () => openSettings('layout') },
        { label: t('settings.title'), icon: 'tune', hint: 'Ctrl+,', onSelect: () => openSettings('look') },
      ],
    })
  })

  const commit = useCallback(
    (boxes) => {
      remember()
      setLayout(page, boxes, phone)
    },
    [page, phone, remember],
  )

  const limits = useCallback(
    (id) => {
      const widget = widgets.find((item) => item.id === id)
      const size = scaledSize(widget?.type, columns)
      return { minW: Math.min(columns, size.minW), minH: size.minH }
    },
    [widgets, columns],
  )

  /* ---------- pointer: move and resize ---------- */

  const begin = (event, id, kind, axis = null) => {
    if (event.button !== 0) return
    const box = layout.find((item) => item.id === id)
    if (!box) return
    if (kind === 'move') {
      // The whole card with a mouse; on touch only the bar (so the page still scrolls).
      const handle = event.target.closest('[data-drag-handle]')
      if (event.target.closest('[data-no-drag]') || (event.pointerType !== 'mouse' && !handle)) return
    }
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    // Page coordinates: scrolling while dragging (by hand or near the window's edge) moves the widget along.
    const at = { x: event.clientX + window.scrollX, y: event.clientY + window.scrollY }
    const limitRows = Math.min(MAX_BOARD_ROWS, layout.reduce((max, item) => Math.max(max, item.y + item.h), 0) + DRAG_ROOM)
    setAction({ id, kind, axis, start: at, pointer: at, client: { x: event.clientX, y: event.clientY }, startBox: box, startFrame: frameOf(box), preview: null, moved: false, limitRows })
  }

  /* The box an action aims at, from how far the pointer has gone (page px). */
  const targetOf = useCallback(
    (state, dx, dy) => {
      const stepX = cell + gap
      const stepY = row + gap
      const { startBox: b, startFrame: f } = state
      if (state.kind === 'move') return { x: Math.round((f.left + dx) / stepX), y: Math.max(0, Math.min(state.limitRows - b.h, Math.round((f.top + dy) / stepY))) }
      const { minW, minH } = limits(state.id)
      const axis = state.axis
      let { x, y, w, h } = b
      if (axis.includes('e')) w = Math.max(minW, Math.min(columns - b.x, Math.round((f.width + dx + gap) / stepX)))
      if (axis.includes('s')) h = Math.max(minH, Math.min(MAX_ROWS, state.limitRows - b.y, Math.round((f.height + dy + gap) / stepY)))
      if (axis.includes('w')) {
        x = Math.max(0, Math.min(b.x + b.w - minW, Math.round((f.left + dx) / stepX)))
        w = b.x + b.w - x
      }
      if (axis.includes('n')) {
        y = Math.max(0, Math.max(b.y + b.h - MAX_ROWS, Math.min(b.y + b.h - minH, Math.round((f.top + dy) / stepY))))
        h = b.y + b.h - y
      }
      return { x, y, w, h }
    },
    [cell, gap, row, columns, limits],
  )

  useEffect(() => {
    if (!action) return undefined
    let scrollTimer = null
    const update = (client) =>
      setAction((state) => {
        if (!state) return state
        const pointer = { x: client.x + window.scrollX, y: client.y + window.scrollY }
        const dx = pointer.x - state.start.x
        const dy = pointer.y - state.start.y
        const moved = state.moved || Math.abs(dx) + Math.abs(dy) > 4
        if (!moved) return { ...state, client }
        const preview = place(layout, state.id, targetOf(state, dx, dy), columns, look.float)
        return { ...state, moved: true, pointer, client, preview }
      })
    // Near the window's top or bottom edge the page scrolls (faster the closer), so a widget can go anywhere.
    const autoScroll = () => {
      const state = actionRef.current
      scrollTimer = null
      if (!state?.client) return
      const edge = 70
      const { y } = state.client
      const depth = y > window.innerHeight - edge ? y - (window.innerHeight - edge) : y < edge ? -(edge - y) : 0
      // Capped speed; and it stops by itself where the page (with the drag's fixed room) ends.
      const speed = Math.sign(depth) * Math.min(18, Math.abs(depth) / 3)
      if (!speed) return
      const before = window.scrollY
      window.scrollBy(0, Math.round(speed) || Math.sign(speed))
      if (window.scrollY === before) return
      update(state.client)
      scrollTimer = requestAnimationFrame(autoScroll)
    }
    const onMove = (event) => {
      update({ x: event.clientX, y: event.clientY })
      if (!scrollTimer) scrollTimer = requestAnimationFrame(autoScroll)
    }
    const onScroll = () => actionRef.current?.client && update(actionRef.current.client)
    const onUp = () => {
      const state = actionRef.current
      cancelAnimationFrame(scrollTimer)
      scrollTimer = null
      actionRef.current = null
      setAction(null)
      if (state?.moved && state.preview) commit(state.preview)
    }
    const onKey = (event) => event.key === 'Escape' && setAction(null)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(scrollTimer)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll)
    }
    // Only (re)attach when an action starts or ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(action), layout, columns, look.float, commit, targetOf])

  /* ---------- keyboard ---------- */

  const onKey = (event, id) => {
    if (event.target !== event.currentTarget) return
    const box = layout.find((item) => item.id === id)
    if (!box) return
    const keys = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      remove(id)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      setEditId(id)
      return
    }
    const step = keys[event.key]
    if (!step) return
    event.preventDefault()
    const { minW, minH } = limits(id)
    const target = event.shiftKey ? { w: Math.max(minW, Math.min(columns - box.x, box.w + step[0])), h: Math.max(minH, Math.min(MAX_ROWS, box.h + step[1])) } : { x: Math.max(0, Math.min(columns - box.w, box.x + step[0])), y: Math.max(0, box.y + step[1]) }
    commit(place(layout, id, target, columns, look.float))
    // Keep the focus on the widget after it moved.
    requestAnimationFrame(() => ref.current?.querySelector(`[data-widget="${id}"]`)?.focus())
  }

  const editingWidget = allWidgets.find((widget) => widget.id === editId) ?? null

  /* The lobby cat: sitting on its own cell's bottom edge (on the card below, if wanted) or on a search box widget. */
  const lobby = allWidgets.find((widget) => widget.type === 'lobbycat' && widget.page === page)
  let lobbyOverlay = null
  if (lobby && width > 0 && !(phone && lobby.look?.hideOnPhone && !editing)) {
    const where = lobby.options.placement ?? 'widget'
    const anchorBox = where === 'widget' ? current.find((box) => box.id === lobby.id) : where === 'searchbox' ? current.find((box) => box.id === lobby.options.searchbox && widgets.find((item) => item.id === box.id)?.type === 'search') : null
    if (anchorBox) {
      const f = frameOf(anchorBox)
      const bottom = where === 'widget' ? f.top + f.height + (lobby.options.sitOnCard === false ? 0 : gap) : f.top
      lobbyOverlay = (
        <div className={`dash-board__lobbycat${editing ? ' is-editing' : ''}`} style={{ left: f.left, width: f.width, top: bottom }}>
          <DashLobbyCat options={lobby.options} />
        </div>
      )
    }
  }
  const byId = new Map(widgets.map((widget) => [widget.id, widget]))
  const placeholder = action?.moved && action.preview ? action.preview.find((box) => box.id === action.id) : null

  return (
    <>
      <div
        ref={ref}
        {...boardTrigger}
        className={`dash-board${editing ? ' is-editing' : ''}${action?.moved ? ' is-acting' : ''}${look.animate ? ' is-animated' : ''}`}
        style={{ height, '--cols': columns, '--cell': `${cell}px`, '--row': `${row}px`, '--gap': `${gap}px` }}
      >
        {editing && width > 0 && <div className="dash-board__grid" aria-hidden="true" />}
        {placeholder && <div className="dash-board__ghost" style={{ transform: `translate(${frameOf(placeholder).left}px, ${frameOf(placeholder).top}px)`, width: frameOf(placeholder).width, height: frameOf(placeholder).height }} aria-hidden="true" />}
        {width > 0 &&
          current.map((box) => {
            const widget = byId.get(box.id)
            if (!widget || !WIDGETS[widget.type]) return null
            // The lobby cat is an overlay (below); its cell only shows while editing.
            if (widget.type === 'lobbycat' && !editing) return null
            const active = action?.moved && action.id === box.id
            let frame = frameOf(box)
            if (active) {
              const dx = action.pointer.x - action.start.x
              const dy = action.pointer.y - action.start.y
              frame = action.kind === 'move' ? { ...action.startFrame, left: action.startFrame.left + dx, top: action.startFrame.top + dy } : resizeFrame(action.startFrame, action.axis, dx, dy, cell, row)
              // Kept inside the drag's room: drawn beyond it, the page would grow and the edge scrolling never stop.
              const roomBottom = action.limitRows * (row + gap) - gap
              if (frame.top + frame.height > roomBottom) frame = action.kind === 'move' ? { ...frame, top: Math.max(0, roomBottom - frame.height) } : { ...frame, height: Math.max(row, roomBottom - frame.top) }
            }
            return (
              <Widget
                key={widget.id}
                widget={widget}
                box={active && action.preview ? (action.preview.find((item) => item.id === box.id) ?? box) : box}
                frame={frame}
                editing={editing}
                dragging={active}
                hiddenOnPhone={phone && editing && widget.look?.hideOnPhone}
                onPointerDown={(event) => begin(event, widget.id, 'move')}
                onResizeStart={(event, axis) => begin(event, widget.id, 'resize', axis)}
                onKey={(event) => onKey(event, widget.id)}
                onEdit={setEditId}
                onRemove={remove}
                onDuplicate={duplicate}
                onMenu={widgetMenu}
                rollingAll={look.rolling}
                renaming={renaming === widget.id}
                onRenamed={() => setRenaming(null)}
              />
            )
          })}
        {lobbyOverlay}
        {!widgets.length && !editing && <p className="dash-board__empty">{t('board.empty')}</p>}
        {!widgets.length && editing && (
          <button type="button" className="dash-board__first" onClick={() => setAdding(true)}>
            <span className="material-symbols-outlined" aria-hidden="true">
              add
            </span>
            {t('board.add')}
          </button>
        )}
      </div>
      {editing && phone && <p className="dash-hint dash-board__note">{t('board.phoneLayout')}</p>}

      {adding && (
        <AddWidget
          onClose={() => setAdding(false)}
          onPick={(type) => {
            if (allWidgets.length >= MAX_WIDGETS) return
            remember()
            const widget = addWidget(type, page, defaultOptions(type))
            setAdding(false)
            if (!widget) return
            // Widgets that need something to show open their editor right away.
            if (WIDGETS[type].fields.some((field) => NEEDS_SETUP.has(field.type) && !field.optional)) setEditId(widget.id)
            requestAnimationFrame(() => ref.current?.querySelector(`[data-widget="${widget.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
          }}
        />
      )}
      <DashMenu menu={menu} onClose={() => setMenu(null)} />
      {editingWidget && <DashWidgetEditor key={editingWidget.id} widget={editingWidget} onClose={() => setEditId(null)} />}
    </>
  )
}
