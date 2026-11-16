import { useState } from 'react'

import { describeOutfit } from '/shared/bongo-design.mjs'
import { BongoCat } from './BongoRender'

/*
 * The saved outfits ("presets", shared by all FDC editors) as the picker's
 * Presets tab. The wardrobe manages them (`manage`: wear, rename, delete,
 * new lists); the designer only picks one for the selected cat.
 */

const COLLAPSED_KEY = 'homesite:bongoPresetsCollapsed'

function readCollapsed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]'))
  } catch {
    return new Set()
  }
}

function Rename({ value, onDone }) {
  const [name, setName] = useState(value)
  const commit = () => onDone(name.trim() && name.trim() !== value ? name.trim() : null)
  return (
    <input
      className="bongo-input bpr-rename"
      autoFocus
      value={name}
      maxLength={60}
      aria-label="New name"
      onChange={(event) => setName(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit()
        if (event.key === 'Escape') {
          event.preventDefault()
          onDone(null)
        }
      }}
    />
  )
}

/** `lists`: [{ id, name, outfits: [{ id, name, outfit }] }]. `manage`: `{ run(change), busy }` (optional). */
export default function PresetGrid({ catalog, lists, onPick, pickHint, manage = null }) {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [renaming, setRenaming] = useState(null) // list id or outfit id
  const [newList, setNewList] = useState('')

  const toggle = (id) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]))
      } catch {
        // remembered for this visit only
      }
      return next
    })

  const total = lists.reduce((sum, list) => sum + list.outfits.length, 0)

  return (
    <div className="bpr">
      {total === 0 ? (
        <p className="bp-empty">{manage ? 'No presets yet. Dress the cat, then use “Save as preset”.' : 'No presets yet. FDC editors save them while dressing the lobby cat.'}</p>
      ) : (
        pickHint && <p className="bpr-hint">{pickHint}</p>
      )}

      {lists.map((list) => {
        const open = !collapsed.has(list.id)
        if (!manage && !list.outfits.length) return null
        return (
          <section key={list.id} className="bpr-list">
            <header className="bpr-list__head">
              {renaming === list.id ? (
                <Rename
                  value={list.name}
                  onDone={(name) => {
                    if (name) manage.run({ action: 'renameList', id: list.id, name })
                    setRenaming(null)
                  }}
                />
              ) : (
                <button type="button" className="bpr-list__toggle" aria-expanded={open} onClick={() => toggle(list.id)}>
                  <span className="material-symbols-outlined" aria-hidden="true">
                    {open ? 'expand_more' : 'chevron_right'}
                  </span>
                  <strong>{list.name}</strong>
                  <small>{list.outfits.length}</small>
                </button>
              )}
              {manage && renaming !== list.id && (
                <span className="bpr-tools">
                  <button type="button" className="bpr-tool" title="Rename list" aria-label={`Rename ${list.name}`} onClick={() => setRenaming(list.id)}>
                    <span className="material-symbols-outlined" aria-hidden="true">
                      edit
                    </span>
                  </button>
                  <button
                    type="button"
                    className="bpr-tool"
                    title="Delete list"
                    aria-label={`Delete ${list.name}`}
                    disabled={manage.busy}
                    onClick={() => window.confirm(`Delete the list “${list.name}” and its ${list.outfits.length} preset(s)?`) && manage.run({ action: 'deleteList', id: list.id })}
                  >
                    <span className="material-symbols-outlined" aria-hidden="true">
                      delete
                    </span>
                  </button>
                </span>
              )}
            </header>
            {open && (
              <ul className="bpr-grid">
                {list.outfits.map((preset) => (
                  <li key={preset.id} className="bpr-card">
                    <button type="button" className="bpr-card__pick" onClick={() => onPick(preset.outfit)} title={describeOutfit(catalog, preset.outfit)}>
                      <span className="bpr-card__art">
                        <BongoCat catalog={catalog} outfit={preset.outfit} width={78} />
                      </span>
                      {renaming === preset.id ? null : <span className="bpr-card__name">{preset.name}</span>}
                    </button>
                    {renaming === preset.id && (
                      <Rename
                        value={preset.name}
                        onDone={(name) => {
                          if (name) manage.run({ action: 'renameOutfit', listId: list.id, id: preset.id, name })
                          setRenaming(null)
                        }}
                      />
                    )}
                    {manage && renaming !== preset.id && (
                      <span className="bpr-card__tools">
                        <button type="button" className="bpr-tool" title="Rename" aria-label={`Rename ${preset.name}`} onClick={() => setRenaming(preset.id)}>
                          <span className="material-symbols-outlined" aria-hidden="true">
                            edit
                          </span>
                        </button>
                        <button
                          type="button"
                          className="bpr-tool"
                          title="Delete"
                          aria-label={`Delete ${preset.name}`}
                          disabled={manage.busy}
                          onClick={() => window.confirm(`Delete the preset “${preset.name}”?`) && manage.run({ action: 'deleteOutfit', listId: list.id, id: preset.id })}
                        >
                          <span className="material-symbols-outlined" aria-hidden="true">
                            delete
                          </span>
                        </button>
                      </span>
                    )}
                  </li>
                ))}
                {!list.outfits.length && <li className="bpr-empty">Empty list</li>}
              </ul>
            )}
          </section>
        )
      })}

      {manage && (
        <form
          className="bpr-new"
          onSubmit={(event) => {
            event.preventDefault()
            if (!newList.trim()) return
            manage.run({ action: 'addList', name: newList.trim() })
            setNewList('')
          }}
        >
          <input className="bongo-input" placeholder="New list" value={newList} maxLength={60} onChange={(event) => setNewList(event.target.value)} aria-label="Name of a new list" />
          <button type="submit" className="bongo-button bongo-button--quiet" disabled={!newList.trim() || manage.busy}>
            Add list
          </button>
        </form>
      )}
    </div>
  )
}
