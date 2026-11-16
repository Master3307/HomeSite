import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import { changeWardrobe, loadWardrobe } from '/src/lib/bongo'
import { tomorrowAt } from '/src/lib/fdcTime'
import DateTimePicker from '/src/components/cult/DateTimePicker'
import '/src/styles/fdc.css'
import CatPicker from './CatPicker'
import { BongoCat } from './BongoRender'
import '/src/styles/bongo.css'
import PresetGrid from './Presets'
import { describeOutfit } from '/shared/bongo-design.mjs'
import { useBongoTheme } from '/src/lib/bongoTheme'
import { useUrlParam } from '/src/lib/urlState'

/*
 * Dressing the lobby cat (FDC editors). "Dress": pick an outfit, wear it
 * for everyone (now, or only until a time), save it as a preset (shared,
 * named lists in the picker's Presets tab). "Automatic changes": what it
 * wears when nobody dresses it (random looks / presets, the FDC winner).
 */

const INTERVALS = [5, 10, 15, 30, 60]
const MODES = [
  { id: 'outfit', icon: 'checkroom', label: 'Keep its outfit', text: 'Wears what you put on it until someone changes it.' },
  { id: 'random', icon: 'casino', label: 'Random looks', text: 'A random skin, accessory and bongos every few minutes.' },
  { id: 'randomOutfits', icon: 'shuffle', label: 'Random presets', text: 'Cycles through saved presets.' },
]

const sourceText = (current) => {
  if (!current) return ''
  const until = current.until ? new Date(current.until).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : null
  switch (current.source) {
    case 'temporary':
      return `a temporary outfit until ${until}`
    case 'winner':
      return `the FDC winner (${current.label}) until midnight`
    case 'random':
      return `a random look, next change ${until}`
    case 'randomOutfits':
      return `“${current.label}”, next preset ${until}`
    default:
      return 'its outfit'
  }
}

export default function LobbyWardrobe({ catalog, onClose, onChanged }) {
  const [, , themed] = useBongoTheme(catalog)
  const [wardrobe, setWardrobe] = useState(null)
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [untilOn, setUntilOn] = useState(false)
  const [until, setUntil] = useState(() => tomorrowAt(0))
  const [customInterval, setCustomInterval] = useState('')
  const [outfitName, setOutfitName] = useState('')
  const [outfitList, setOutfitList] = useState('')
  const [pose, setPose] = useState('up')
  // The tab is part of the address (?lobby=wardrobe / wardrobe-auto, set by the lobby cat).
  const [lobbyParam, setLobbyParam] = useUrlParam('lobby')
  const section = lobbyParam === 'wardrobe-auto' ? 'auto' : 'dress'
  const setSection = (next) => setLobbyParam(next === 'auto' ? 'wardrobe-auto' : 'wardrobe')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    loadWardrobe()
      .then((data) => {
        if (!alive) return
        setWardrobe(data)
        setDraft(data.current?.outfit ?? data.outfit)
        setOutfitList(data.lists[0]?.id ?? '')
      })
      .catch((loadError) => alive && setError(loadError.message))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  async function run(change) {
    setBusy(true)
    setError(null)
    try {
      const next = await changeWardrobe(change)
      setWardrobe(next)
      onChanged?.(next.current)
      return next
    } catch (runError) {
      setError(runError.message)
      return null
    } finally {
      setBusy(false)
    }
  }

  const extraTabs = useMemo(
    () =>
      wardrobe
        ? [{ id: 'outfits', label: 'Presets', icon: 'outfits', render: () => <PresetGrid catalog={catalog} lists={wardrobe.lists} onPick={setDraft} pickHint="Click a preset to put it on the preview." manage={{ run, busy }} /> }]
        : [],
    // run only changes state; the grid re-renders with the wardrobe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wardrobe, catalog, busy],
  )

  const interval = wardrobe?.intervalMinutes ?? 15
  const temporary = wardrobe?.temporary && Date.parse(wardrobe.temporary.until) > Date.now()

  async function savePreset(event) {
    event.preventDefault()
    const next = await run({ action: 'addOutfit', listId: outfitList || undefined, name: outfitName.trim() || describeOutfit(catalog, draft), outfit: draft })
    if (next) {
      setOutfitName('')
      setOutfitList(outfitList || next.lists[0]?.id || '')
      setSaving(false)
    }
  }

  return createPortal(
    <div className="bongo-modal" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`bongo-dialog bongo-dialog--wardrobe ${themed.className}`} style={themed.style} role="dialog" aria-modal="true" aria-label="Dress the lobby cat">
        <header className="bongo-dialog__head">
          <h2>Lobby cat</h2>
          {wardrobe && (
            <div className="bongo-segment bw-tabs" role="tablist" aria-label="Section">
              {[
                ['dress', 'Dress'],
                ['auto', 'Automatic changes'],
              ].map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={section === id} className={section === id ? 'is-active' : ''} onClick={() => setSection(id)}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="bongo-icon-button" onClick={onClose} aria-label="Close">
            <span className="material-symbols-outlined" aria-hidden="true">
              close
            </span>
          </button>
        </header>

        {wardrobe && (
          <p className="bw-now">
            <span className="material-symbols-outlined" aria-hidden="true">
              visibility
            </span>
            <span>
              Everyone sees <strong>{sourceText(wardrobe.current)}</strong>
            </span>
            {temporary && (
              <button type="button" className="bongo-link" disabled={busy} onClick={() => run({ action: 'endTemporary' })}>
                End early
              </button>
            )}
          </p>
        )}

        {!wardrobe || !draft ? (
          <p className="bongo-dialog__status">{error ?? 'Loading…'}</p>
        ) : section === 'dress' ? (
          <div className="bw">
            <aside className="bw-side">
              <button
                type="button"
                className="bw-stage"
                title="Click to make it tap"
                onClick={() => {
                  setPose((current) => (current === 'left' ? 'right' : 'left'))
                  setTimeout(() => setPose('up'), 150)
                }}
              >
                <BongoCat catalog={catalog} outfit={draft} pose={pose} width={176} />
              </button>
              <p className="bw-desc">{describeOutfit(catalog, draft)}</p>

              <button
                type="button"
                className="bongo-button bw-wear"
                disabled={busy}
                onClick={() => run(untilOn ? { action: 'wear', outfit: draft, until: until.toISOString() } : { action: 'wear', outfit: draft })}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  checkroom
                </span>
                {untilOn ? 'Wear it until then' : 'Wear it now'}
              </button>
              <label className="bongo-switch-row">
                <input type="checkbox" checked={untilOn} onChange={(event) => setUntilOn(event.target.checked)} />
                Only until a certain time
              </label>

              {saving ? (
                <form className="bw-save" onSubmit={savePreset}>
                  <input className="bongo-input" autoFocus placeholder={describeOutfit(catalog, draft)} value={outfitName} onChange={(event) => setOutfitName(event.target.value)} maxLength={60} aria-label="Preset name" />
                  {wardrobe.lists.length > 1 && (
                    <select className="bongo-input" value={outfitList} onChange={(event) => setOutfitList(event.target.value)} aria-label="List">
                      {wardrobe.lists.map((list) => (
                        <option key={list.id} value={list.id}>
                          {list.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <span className="bw-save__actions">
                    <button type="button" className="bongo-button bongo-button--quiet" onClick={() => setSaving(false)}>
                      Cancel
                    </button>
                    <button type="submit" className="bongo-button" disabled={busy}>
                      Save
                    </button>
                  </span>
                </form>
              ) : (
                <button type="button" className="bongo-button bongo-button--quiet bw-wear" onClick={() => setSaving(true)}>
                  <span className="material-symbols-outlined" aria-hidden="true">
                    bookmark_add
                  </span>
                  Save as preset
                </button>
              )}
            </aside>

            <CatPicker catalog={catalog} mode="single" value={draft} onChange={(slot, id) => setDraft((current) => ({ ...current, [slot]: id }))} extraTabs={extraTabs} />

            {untilOn && (
              <section className="fdc bw-time" aria-label="Wear it until">
                <p className="bongo-label">Wear it until</p>
                <DateTimePicker value={until} onChange={setUntil} />
              </section>
            )}
          </div>
        ) : (
          <div className="bw-auto">
            <p className="bongo-label">When nobody dresses it, the lobby cat…</p>
            <div className="bongo-modes" role="radiogroup" aria-label="When nobody dresses it">
              {MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  role="radio"
                  aria-checked={wardrobe.mode === mode.id}
                  className={`bongo-mode${wardrobe.mode === mode.id ? ' is-active' : ''}`}
                  disabled={busy}
                  onClick={() => run({ action: 'mode', mode: mode.id })}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">
                    {mode.icon}
                  </span>
                  <span>
                    <strong>{mode.label}</strong>
                    <small>{mode.text}</small>
                  </span>
                </button>
              ))}
            </div>

            {wardrobe.mode !== 'outfit' && (
              <div className="bw-field">
                <span className="bongo-label">Change every</span>
                <div className="bongo-chips">
                  {INTERVALS.map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      className={`bongo-chip${interval === minutes ? ' is-active' : ''}`}
                      disabled={busy}
                      onClick={() => run({ action: 'mode', mode: wardrobe.mode, intervalMinutes: minutes })}
                    >
                      {minutes} min
                    </button>
                  ))}
                  <form
                    className="bongo-custom-interval"
                    onSubmit={(event) => {
                      event.preventDefault()
                      if (Number(customInterval) >= 1) run({ action: 'mode', mode: wardrobe.mode, intervalMinutes: Number(customInterval) })
                    }}
                  >
                    <input
                      className={`bongo-input${!INTERVALS.includes(interval) ? ' is-active' : ''}`}
                      type="number"
                      min="1"
                      max="10080"
                      placeholder={!INTERVALS.includes(interval) ? String(interval) : 'Other'}
                      value={customInterval}
                      onChange={(event) => setCustomInterval(event.target.value)}
                      aria-label="Other interval in minutes"
                    />
                    <button type="submit" className="bongo-chip" disabled={busy || !(Number(customInterval) >= 1)}>
                      Set
                    </button>
                  </form>
                </div>
              </div>
            )}

            {wardrobe.mode === 'randomOutfits' && (
              <div className="bw-field">
                <span className="bongo-label">From these lists {wardrobe.randomLists.length ? '' : '(none ticked = all)'}</span>
                <div className="bongo-checks">
                  {wardrobe.lists.map((list) => (
                    <label key={list.id} className="bongo-check">
                      <input
                        type="checkbox"
                        checked={wardrobe.randomLists.includes(list.id)}
                        disabled={busy}
                        onChange={(event) =>
                          run({
                            action: 'mode',
                            mode: 'randomOutfits',
                            randomLists: event.target.checked ? [...wardrobe.randomLists, list.id] : wardrobe.randomLists.filter((id) => id !== list.id),
                          })
                        }
                      />
                      {list.name} <small>({list.outfits.length})</small>
                    </label>
                  ))}
                  {!wardrobe.lists.length && <p className="bongo-label">Save some presets first.</p>}
                </div>
              </div>
            )}

            <label className="bongo-switch-row bw-winner">
              <input type="checkbox" checked={wardrobe.wearWinner} disabled={busy} onChange={(event) => run({ action: 'winner', enabled: event.target.checked })} />
              <span>
                <strong>Wear the FDC winner</strong>
                <small>From 10:00 to midnight on result day, the winning design is worn.</small>
              </span>
            </label>
          </div>
        )}

        {error && wardrobe && (
          <p className="bongo-error bw-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>,
    document.body,
  )
}
