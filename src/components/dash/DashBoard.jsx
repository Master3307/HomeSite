import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { WIDGETS, newWidget, useWidgetTitle } from './widgets.jsx'
import DashWidgetEditor from './DashWidgetEditor.jsx'
import { MAX_WIDGETS, createId, updateDashSettings, useDashSettings } from '../../lib/dashSettings.js'

/*
 * The /dash board: widgets on a grid (columns from the look settings, fewer
 * on small screens). In edit mode every widget gets a bar: drag to move
 * (or the arrows), make it wider / narrower / taller / shorter, edit,
 * remove; the last tile adds a widget.
 */

const MIN_COLUMN = 220 // px: below this a column is dropped

function useColumns(ref, wanted) {
  const [columns, setColumns] = useState(wanted)
  useEffect(() => {
    const element = ref.current
    if (!element) return undefined
    const measure = () => setColumns(Math.max(1, Math.min(wanted, Math.floor((element.clientWidth + 14) / MIN_COLUMN))))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, wanted])
  return columns
}

function Tool({ icon, label, onClick, disabled = false, danger = false }) {
  return (
    <button type="button" className={`dash-tool${danger ? ' dash-tool--danger' : ''}`} onClick={onClick} disabled={disabled} title={label} aria-label={label}>
      <span className="material-symbols-outlined" aria-hidden="true">
        {icon}
      </span>
    </button>
  )
}

function Widget({ widget, index, count, columns, editing, onEdit, dragging, setDragging }) {
  const { t } = useTranslation('dash')
  const spec = WIDGETS[widget.type]
  const title = useWidgetTitle(widget)
  const [over, setOver] = useState(false)
  const View = spec.View
  const w = Math.min(widget.w, columns)

  const change = (patch) => updateDashSettings((current) => ({ widgets: current.widgets.map((item) => (item.id === widget.id ? { ...item, ...patch } : item)) }))
  const moveTo = (target) =>
    updateDashSettings((current) => {
      const list = [...current.widgets]
      const from = list.findIndex((item) => item.id === widget.id)
      const [item] = list.splice(from, 1)
      list.splice(Math.max(0, Math.min(list.length, target)), 0, item)
      return { widgets: list }
    })

  return (
    <section
      className={`dash-widget dash-widget--${widget.type}${editing ? ' is-editing' : ''}${over ? ' is-drop' : ''}${dragging === widget.id ? ' is-dragging' : ''}`}
      style={{ gridColumn: `span ${w}`, gridRow: `span ${widget.h}` }}
      aria-label={title || t(`widgets.${widget.type}.name`)}
      draggable={editing}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', widget.id)
        setDragging(widget.id)
      }}
      onDragEnd={() => setDragging(null)}
      onDragOver={(event) => {
        if (!editing || !dragging || dragging === widget.id) return
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setOver(false)
        const id = event.dataTransfer.getData('text/plain')
        if (!id || id === widget.id) return
        updateDashSettings((current) => {
          const list = [...current.widgets]
          const from = list.findIndex((item) => item.id === id)
          if (from < 0) return {}
          const [item] = list.splice(from, 1)
          list.splice(list.findIndex((entry) => entry.id === widget.id), 0, item)
          return { widgets: list }
        })
      }}
    >
      {editing && (
        <div className="dash-widget__tools">
          <span className="material-symbols-outlined dash-widget__grip" aria-hidden="true">
            drag_indicator
          </span>
          <span className="dash-widget__type">{t(`widgets.${widget.type}.name`)}</span>
          <Tool icon="arrow_back" label={t('board.earlier')} onClick={() => moveTo(index - 1)} disabled={index === 0} />
          <Tool icon="arrow_forward" label={t('board.later')} onClick={() => moveTo(index + 1)} disabled={index === count - 1} />
          <Tool icon="remove" label={t('board.narrower')} onClick={() => change({ w: Math.max(1, Math.min(widget.w, columns) - 1) })} disabled={w <= 1} />
          <Tool icon="add" label={t('board.wider')} onClick={() => change({ w: Math.min(columns, widget.w + 1) })} disabled={w >= columns} />
          <Tool icon="vertical_align_center" label={t('board.shorter')} onClick={() => change({ h: Math.max(1, widget.h - 1) })} disabled={widget.h <= 1} />
          <Tool icon="height" label={t('board.taller')} onClick={() => change({ h: Math.min(6, widget.h + 1) })} disabled={widget.h >= 6} />
          <Tool icon="tune" label={t('board.edit')} onClick={() => onEdit(widget.id)} />
          <Tool icon="delete" label={t('board.remove')} danger onClick={() => updateDashSettings((current) => ({ widgets: current.widgets.filter((item) => item.id !== widget.id) }))} />
        </div>
      )}
      {title && <h2 className="dash-widget__title">{title}</h2>}
      <div className="dash-widget__body" inert={editing ? true : undefined}>
        <View widget={widget} editing={editing} />
      </div>
    </section>
  )
}

/* Pick a widget type to add. */
function AddWidget({ onPick, onClose }) {
  const { t } = useTranslation('dash')
  const ref = useRef(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog ref={ref} className="dash-dialog" onClose={onClose} aria-labelledby="dash-add-title">
      <header className="dash-dialog__head">
        <h2 id="dash-add-title">{t('board.addTitle')}</h2>
        <button type="button" className="dash-tool" onClick={() => ref.current?.close()} aria-label={t('settings.close')}>
          <span className="material-symbols-outlined">close</span>
        </button>
      </header>
      <ul className="dash-picker">
        {Object.entries(WIDGETS).map(([type, spec]) => (
          <li key={type}>
            <button type="button" onClick={() => onPick(type)}>
              <span className="material-symbols-outlined" aria-hidden="true">
                {spec.icon}
              </span>
              <strong>{t(`widgets.${type}.name`)}</strong>
              <span>{t(`widgets.${type}.text`)}</span>
            </button>
          </li>
        ))}
      </ul>
    </dialog>
  )
}

export default function DashBoard({ editing }) {
  const { t } = useTranslation('dash')
  const { widgets, look } = useDashSettings()
  const ref = useRef(null)
  const columns = useColumns(ref, look.columns)
  const [editId, setEditId] = useState(null)
  const [adding, setAdding] = useState(false)
  const [dragging, setDragging] = useState(null)
  const editingWidget = widgets.find((widget) => widget.id === editId) ?? null

  return (
    <>
      <div ref={ref} className="dash-board" style={{ '--cols': columns }}>
        {widgets.map((widget, index) => (
          <Widget key={widget.id} widget={widget} index={index} count={widgets.length} columns={columns} editing={editing} onEdit={setEditId} dragging={dragging} setDragging={setDragging} />
        ))}
        {editing && widgets.length < MAX_WIDGETS && (
          <button type="button" className="dash-widget dash-widget--add" onClick={() => setAdding(true)}>
            <span className="material-symbols-outlined" aria-hidden="true">
              add
            </span>
            {t('board.add')}
          </button>
        )}
        {!widgets.length && !editing && <p className="dash-board__empty">{t('board.empty')}</p>}
      </div>

      {adding && (
        <AddWidget
          onClose={() => setAdding(false)}
          onPick={(type) => {
            const widget = newWidget(type, createId('widget'))
            updateDashSettings((current) => ({ widgets: [...current.widgets, widget] }))
            setAdding(false)
            // Widgets that need something to show open their editor right away.
            if (WIDGETS[type].fields.length) setEditId(widget.id)
          }}
        />
      )}
      {editingWidget && <DashWidgetEditor key={editingWidget.id} widget={editingWidget} onClose={() => setEditId(null)} />}
    </>
  )
}
