import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import { catOutfits, DESIGN, designFrames, emptyCat, FRAME_MS, itemById, MAX_CATS, MAX_FIXED, NONE, normalizeDesign, SLOT_LIST, TAP } from '/shared/bongo-design.mjs'
import CatPicker from './CatPicker'
import { BongoCat, DesignPreview, GameIcon, ItemIcon } from './BongoRender'
import '/src/styles/bongo.css'
import PresetGrid from './Presets'
import { loadWardrobe } from '/src/lib/bongo'
import { useBongoTheme } from '/src/lib/bongoTheme'

/*
 * Designing an FDC option with the game's items, like a little scene:
 * add up to four cats, dress each one (item by item or with a saved
 * preset), drag them where they should be, turn them left or right.
 * Each cat has picks (several items per slot, mixed into every combination
 * or in pairs) and fixed looks (complete outfits that are never mixed).
 * The cats go through their looks each on their own, in step, or in every
 * combination; cats can be linked when they belong together. One look
 * stays a PNG, more become a GIF. The server renders exactly this preview.
 */

const BACKGROUNDS = [DESIGN.background, '#000000', '#313338', '#5865f2', '#ffffff']
const SLOTS = [
  { slot: 'skin', label: 'Skin', icon: 'skins', fallback: 'pets', empty: 'Default cat' },
  { slot: 'hat', label: 'Accessory', icon: 'hats', fallback: 'styler', empty: 'None' },
  { slot: 'bongos', label: 'Bongos', icon: 'bongos', fallback: 'album', empty: 'None' },
]

/* The cat's first look, for its chip. */
const firstOutfit = (cat) => catOutfits(cat)[0] ?? { skin: null, hat: null, bongos: null }
const EMPTY_LOOK = { skin: null, hat: null, bongos: null }

function SlotRow({ catalog, entry, picks, active, onOpen, onRemove }) {
  return (
    <div className={`bd-slot${active ? ' is-active' : ''}`}>
      <button type="button" className="bd-slot__head" onClick={onOpen} aria-pressed={active}>
        <GameIcon catalog={catalog} name={entry.icon} fallback={entry.fallback} />
        <span>{entry.label}</span>
        {picks.length > 1 && <small>{picks.length} variations</small>}
      </button>
      <ul className="bd-slot__picks">
        {picks.length === 0 && <li className="bd-slot__empty">{entry.empty}</li>}
        {picks.map((id) => {
          const item = itemById(catalog, id)
          return (
            <li key={id} className="bd-pick" title={id === NONE ? 'Without it' : item?.name}>
              {id === NONE ? (
                <span className="material-symbols-outlined bd-pick__none" aria-hidden="true">
                  block
                </span>
              ) : (
                <ItemIcon catalog={catalog} item={item} size={30} />
              )}
              <span className="bd-pick__name">{id === NONE ? 'None' : item?.name}</span>
              <button type="button" aria-label={`Remove ${id === NONE ? 'None' : item?.name}`} onClick={() => onRemove(id)}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  close
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/*
 * `reference`: `{ src, label }`, a picture to design after (migrating an old
 * picture option): shown next to the preview. `applyLabel` / `extra`: the
 * main button's text and something under the stage (e.g. a note field).
 */
export default function DesignEditor({ catalog, design: initial, title = 'Design the cat', onApply, onCancel, reference = null, applyLabel = 'Use this design', extra = null, busy = false }) {
  const [design, setDesign] = useState(() => normalizeDesign(initial ?? { cats: [emptyCat()] }, catalog))
  const [active, setActive] = useState(0)
  const [tab, setTab] = useState('skin')
  // Per cat: editing its mixed picks or one of its fixed looks (index).
  const [mode, setMode] = useState('picks')
  const [lookIndex, setLookIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [frame, setFrame] = useState(0)
  const [hex, setHex] = useState(design.background)
  const [, , themed] = useBongoTheme(catalog)
  const [presets, setPresets] = useState(null)

  // The lobby cat's presets (FDC editors can read them; nobody else gets the tab).
  useEffect(() => {
    let alive = true
    loadWardrobe()
      .then((data) => alive && setPresets(data.lists ?? []))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && !event.defaultPrevented && onCancel()
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onCancel])

  const { total } = useMemo(() => designFrames(design), [design])
  const index = Math.min(active, design.cats.length - 1)
  const cat = design.cats[index]
  const shown = Math.min(total, DESIGN.maxFrames)

  const updateCat = (catIndex, patch) => setDesign((current) => ({ ...current, cats: current.cats.map((entry, i) => (i === catIndex ? { ...entry, ...patch } : entry)) }))

  function addCat() {
    setDesign((current) => ({ ...current, cats: [...current.cats, emptyCat()] }))
    setActive(design.cats.length)
    setTab('skin')
  }

  function removeCat(catIndex) {
    setDesign((current) => ({ ...current, cats: current.cats.filter((_, i) => i !== catIndex) }))
    setActive((current) => Math.max(0, current > catIndex ? current - 1 : Math.min(current, design.cats.length - 2)))
  }

  function setBackground(color) {
    setHex(color)
    if (/^#?[0-9a-f]{6}$/i.test(color)) setDesign((current) => ({ ...current, background: `#${color.replace('#', '').toLowerCase()}` }))
  }

  const presetTabs = useMemo(
    () =>
      presets
        ? [
            {
              id: 'outfits',
              label: 'Presets',
              icon: 'outfits',
              render: () => (
                <PresetGrid
                  catalog={catalog}
                  lists={presets}
                  pickHint={mode === 'fixed' ? 'Click a preset to make it this fixed look.' : 'Click a preset to dress the selected cat with it.'}
                  onPick={(outfit) =>
                    // Editing a fixed look: the preset becomes that look; otherwise it replaces the picks.
                    mode === 'fixed'
                      ? setDesign((current) => ({
                          ...current,
                          cats: current.cats.map((entry, i) => {
                            if (i !== index) return entry
                            const look = { skin: outfit.skin ?? null, hat: outfit.hat ?? null, bongos: outfit.bongos ?? null }
                            const outfits = entry.outfits[lookIndex] ? entry.outfits.map((item, at) => (at === lookIndex ? look : item)) : [...entry.outfits, look].slice(0, MAX_FIXED)
                            return { ...entry, outfits }
                          }),
                        }))
                      : updateCat(index, { skins: outfit.skin ? [outfit.skin] : [], hats: outfit.hat ? [outfit.hat] : [], bongos: outfit.bongos ? [outfit.bongos] : [] })
                  }
                />
              ),
            },
          ]
        : [],
    // updateCat only sets state; the tab needs the selected cat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [presets, catalog, index, mode, lookIndex],
  )

  const tapping = design.tap?.on
  const result =
    total === 1
      ? tapping
        ? 'A GIF of the cat drumming'
        : 'A picture (PNG)'
      : `A GIF with ${shown} variations${total > DESIGN.maxFrames ? ` (the first ${DESIGN.maxFrames} of ${total})` : ''}${tapping ? ', drumming' : ''}`
  const setOption = (patch) => setDesign((current) => ({ ...current, ...patch }))
  const seconds = (ms) => `${(ms / 1000).toFixed(ms < 1000 ? 2 : 1)} s`

  return createPortal(
    <div className="bongo-modal" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <div className={`bongo-dialog bd${reference ? ' bd--compare' : ''} ${themed.className}`} style={themed.style} role="dialog" aria-modal="true" aria-label={title}>
        <header className="bongo-dialog__head">
          <h2>{title}</h2>
          <button type="button" className="bongo-icon-button" onClick={onCancel} aria-label="Close">
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </header>

        <div className="bd-body">
          <section className="bd-stage" aria-label="Preview">
            {reference && (
              <figure className="bd-reference">
                <img src={reference.src} alt="" />
                <figcaption>
                  <span className="material-symbols-outlined" aria-hidden="true">
                    image
                  </span>
                  {reference.label ?? 'The old picture'}
                </figcaption>
              </figure>
            )}
            <DesignPreview
              catalog={catalog}
              design={design}
              frame={playing ? null : frame}
              play={playing}
              selected={index}
              onSelect={setActive}
              onFrame={playing ? setFrame : undefined}
              onMove={(catIndex, patch) => updateCat(catIndex, patch)}
            />
            <p className="bd-hint">Drag a cat to move it, scroll on it to resize it.</p>

            {total > 1 && (
              <div className="bd-frames">
                <button type="button" className="bongo-icon-button" onClick={() => setPlaying((value) => !value)} aria-label={playing ? 'Pause' : 'Play'}>
                  <span className="material-symbols-outlined" aria-hidden="true">
                    {playing ? 'pause' : 'play_arrow'}
                  </span>
                </button>
                <input
                  type="range"
                  min={0}
                  max={shown - 1}
                  value={Math.min(frame, shown - 1)}
                  aria-label="Frame"
                  onChange={(event) => {
                    setPlaying(false)
                    setFrame(Number(event.target.value))
                  }}
                />
                <span className="bd-frames__count">
                  {Math.min(frame, shown - 1) + 1}/{shown}
                </span>
              </div>
            )}

            <div className="bd-row">
              <span className="bd-label">Background</span>
              <div className="bd-swatches">
                {BACKGROUNDS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`bd-swatch${design.background === color ? ' is-active' : ''}`}
                    style={{ '--swatch': color }}
                    aria-label={color === DESIGN.background ? `Default (${color})` : color}
                    title={color === DESIGN.background ? `Default (${color})` : color}
                    onClick={() => setBackground(color)}
                  />
                ))}
                <label className="bd-swatch bd-swatch--any" title="Any colour">
                  <input type="color" value={design.background} onChange={(event) => setBackground(event.target.value)} aria-label="Pick any colour" />
                </label>
                <input className={`bd-hex${/^#?[0-9a-f]{6}$/i.test(hex) ? '' : ' is-invalid'}`} value={hex} maxLength={7} spellCheck={false} onChange={(event) => setBackground(event.target.value)} aria-label="Hex colour" />
              </div>
            </div>

            {/* How the GIF moves: the order of the variations, their speed, drumming. */}
            <div className="bd-motion">
              {total > 1 && design.cats.length > 1 && (
                <div className="bd-row">
                  <span className="bd-label">Cats</span>
                  <div className="bongo-segment" role="radiogroup" aria-label="How the cats' looks follow each other">
                    {[
                      ['each', 'call_split', 'Each on its own', 'Every cat goes through its own looks; nothing is combined'],
                      ['together', 'sync', 'In step', 'All cats change at the same time and start over together'],
                      ['all', 'grid_view', 'Every combination', 'Each look of each cat with each look of the others'],
                      ['shuffle', 'shuffle', 'Shuffled', 'Every combination, in a mixed order'],
                    ].map(([value, icon, label, hint]) => (
                      <button key={value} type="button" role="radio" aria-checked={design.mix === value} className={design.mix === value ? 'is-active' : ''} title={hint} onClick={() => setOption({ mix: value })}>
                        <span className="material-symbols-outlined" aria-hidden="true">
                          {icon}
                        </span>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {total > 1 && design.cats.length === 1 && (
                <div className="bd-row">
                  <span className="bd-label">Order</span>
                  <div className="bongo-segment" role="radiogroup" aria-label="Order of the looks">
                    {[
                      ['each', 'format_list_numbered', 'In order'],
                      ['shuffle', 'shuffle', 'Shuffled'],
                    ].map(([value, icon, label]) => {
                      const on = (design.mix === 'shuffle' ? 'shuffle' : 'each') === value
                      return (
                        <button key={value} type="button" role="radio" aria-checked={on} className={on ? 'is-active' : ''} onClick={() => setOption({ mix: value })}>
                          <span className="material-symbols-outlined" aria-hidden="true">
                            {icon}
                          </span>
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              {total > 1 && (
                <label className="bd-row bd-slider">
                  <span className="bd-label">Speed</span>
                  <input
                    type="range"
                    min={FRAME_MS.min}
                    max={3000}
                    step={50}
                    value={FRAME_MS.min + 3000 - Math.min(3000, design.frameMs)}
                    aria-label="How fast the variations change"
                    onChange={(event) => setOption({ frameMs: FRAME_MS.min + 3000 - Number(event.target.value) })}
                  />
                  <output>{seconds(design.frameMs)} each</output>
                </label>
              )}
              <div className="bd-row">
                <span className="bd-label">Drumming</span>
                <button type="button" role="switch" aria-checked={Boolean(tapping)} className={`bd-switch${tapping ? ' is-on' : ''}`} onClick={() => setOption({ tap: { ...design.tap, on: !tapping } })}>
                  <span className="bd-switch__knob" aria-hidden="true" />
                  {tapping ? 'The cats tap their bongos' : 'Paws up, no tapping'}
                </button>
              </div>
              {tapping && (
                <label className="bd-row bd-slider">
                  <span className="bd-label">Tap speed</span>
                  <input
                    type="range"
                    min={TAP.min}
                    max={TAP.max}
                    step={10}
                    value={TAP.min + TAP.max - design.tap.ms}
                    aria-label="How fast the cats tap"
                    onChange={(event) => setOption({ tap: { ...design.tap, ms: TAP.min + TAP.max - Number(event.target.value) } })}
                  />
                  <output>{Math.round(60000 / design.tap.ms)} taps/min</output>
                </label>
              )}
            </div>
            {extra}
          </section>

          <section className="bd-edit" aria-label="Cats">
            <div className="bd-cats" role="tablist" aria-label="Cats">
              {design.cats.map((entry, catIndex) => (
                <button
                  key={catIndex}
                  type="button"
                  role="tab"
                  aria-selected={catIndex === index}
                  className={`bd-cat${catIndex === index ? ' is-active' : ''}`}
                  onClick={() => setActive(catIndex)}
                >
                  <BongoCat catalog={catalog} outfit={firstOutfit(entry)} width={44} flip={entry.flip} />
                  <span>Cat {catIndex + 1}</span>
                </button>
              ))}
              {design.cats.length < MAX_CATS && (
                <button type="button" className="bd-cat bd-cat--add" onClick={addCat}>
                  <span className="material-symbols-outlined" aria-hidden="true">
                    add
                  </span>
                  <span>Add a cat</span>
                </button>
              )}
            </div>

            <div className="bd-tools">
              <div className="bongo-segment bd-facing" role="radiogroup" aria-label="Facing">
                {[
                  [false, 'arrow_back', 'Left'],
                  [true, 'arrow_forward', 'Right'],
                ].map(([flip, icon, label]) => (
                  <button key={label} type="button" role="radio" aria-checked={cat.flip === flip} className={cat.flip === flip ? 'is-active' : ''} title={`Face ${label.toLowerCase()}`} onClick={() => updateCat(index, { flip })}>
                    <span className="material-symbols-outlined" aria-hidden="true">
                      {icon}
                    </span>
                    {label}
                  </button>
                ))}
              </div>
              <label className="bd-size">
                <span className="material-symbols-outlined" aria-hidden="true">
                  photo_size_select_small
                </span>
                <input type="range" min={0.3} max={2} step={0.01} value={cat.scale} aria-label="Size" onChange={(event) => updateCat(index, { scale: Number(event.target.value) })} />
              </label>
              <button type="button" className="bd-tool" onClick={() => updateCat(index, { x: 0, y: 0, scale: 1 })} title="Back to its place and size" disabled={!cat.x && !cat.y && cat.scale === 1}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  restart_alt
                </span>
                Reset
              </button>
              {index > 0 && (
                <button
                  type="button"
                  className={`bd-tool${cat.link ? ' is-on' : ''}`}
                  aria-pressed={cat.link}
                  onClick={() => updateCat(index, { link: !cat.link })}
                  title={cat.link ? `Changes in step with cat ${index}: their looks pair up 1:1` : `Link to cat ${index} when they belong together`}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">
                    {cat.link ? 'link' : 'link_off'}
                  </span>
                  {cat.link ? `With cat ${index}` : 'Link'}
                </button>
              )}
              {design.cats.length > 1 && (
                <button type="button" className="bd-tool bd-tool--danger" onClick={() => removeCat(index)} title="Remove this cat" aria-label="Remove this cat">
                  <span className="material-symbols-outlined" aria-hidden="true">
                    delete
                  </span>
                </button>
              )}
            </div>

            <div className="bongo-segment bd-mode" role="tablist" aria-label="What to edit">
              <button type="button" role="tab" aria-selected={mode === 'picks'} className={mode === 'picks' ? 'is-active' : ''} onClick={() => setMode('picks')}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  join
                </span>
                Mixed picks
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'fixed'}
                className={mode === 'fixed' ? 'is-active' : ''}
                onClick={() => {
                  setMode('fixed')
                  setLookIndex(0)
                }}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  lock
                </span>
                Fixed looks{cat.outfits.length ? ` (${cat.outfits.length})` : ''}
              </button>
            </div>

            {mode === 'picks' ? (
              <>
                <div className="bd-slots">
                  {SLOTS.map((entry) => (
                    <SlotRow
                      key={entry.slot}
                      catalog={catalog}
                      entry={entry}
                      picks={cat[SLOT_LIST[entry.slot]]}
                      active={tab === entry.slot}
                      onOpen={() => setTab(entry.slot)}
                      onRemove={(id) => updateCat(index, { [SLOT_LIST[entry.slot]]: cat[SLOT_LIST[entry.slot]].filter((pick) => pick !== id) })}
                    />
                  ))}
                </div>
                {[cat.skins, cat.hats, cat.bongos].filter((list) => list.length > 1).length > 0 && [cat.skins, cat.hats, cat.bongos].filter((list) => list.length).length > 1 && (
                  <div className="bd-row">
                    <span className="bd-label">Mix</span>
                    <div className="bongo-segment" role="radiogroup" aria-label="How the picks mix">
                      {[
                        ['all', 'grid_view', 'Every combination', 'Each skin with each accessory and each bongos'],
                        ['paired', 'view_column', 'In pairs', 'The 1st skin with the 1st accessory and the 1st bongos, then the 2nd …'],
                      ].map(([value, icon, label, hint]) => (
                        <button key={value} type="button" role="radio" aria-checked={cat.combine === value} className={cat.combine === value ? 'is-active' : ''} title={hint} onClick={() => updateCat(index, { combine: value })}>
                          <span className="material-symbols-outlined" aria-hidden="true">
                            {icon}
                          </span>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <CatPicker
                  catalog={catalog}
                  mode="multi"
                  allowNone
                  extraTabs={presetTabs}
                  tab={tab}
                  onTab={setTab}
                  value={cat}
                  onChange={(slot, list) => updateCat(index, { [SLOT_LIST[slot]]: list })}
                />
                <p className="bd-hint">Pick more than one item in a slot for more looks. Complete outfits that should stay exactly as they are go in Fixed looks.</p>
              </>
            ) : (
              <>
                <ul className="bd-looks">
                  {cat.outfits.map((look, lookAt) => (
                    <li key={lookAt} className={lookAt === lookIndex ? 'is-active' : ''}>
                      <button type="button" className="bd-looks__pick" onClick={() => setLookIndex(lookAt)} aria-pressed={lookAt === lookIndex} title={`Fixed look ${lookAt + 1}`}>
                        <BongoCat catalog={catalog} outfit={look} width={56} flip={cat.flip} />
                      </button>
                      <button
                        type="button"
                        className="bd-looks__remove"
                        aria-label={`Remove fixed look ${lookAt + 1}`}
                        onClick={() => {
                          updateCat(index, { outfits: cat.outfits.filter((_, at) => at !== lookAt) })
                          setLookIndex((current) => Math.max(0, current >= lookAt ? current - 1 : current))
                        }}
                      >
                        <span className="material-symbols-outlined" aria-hidden="true">
                          close
                        </span>
                      </button>
                    </li>
                  ))}
                  {cat.outfits.length < MAX_FIXED && (
                    <li>
                      <button
                        type="button"
                        className="bd-looks__add"
                        onClick={() => {
                          updateCat(index, { outfits: [...cat.outfits, { ...EMPTY_LOOK }] })
                          setLookIndex(cat.outfits.length)
                        }}
                      >
                        <span className="material-symbols-outlined" aria-hidden="true">
                          add
                        </span>
                        New look
                      </button>
                    </li>
                  )}
                </ul>
                {cat.outfits[lookIndex] ? (
                  <CatPicker
                    catalog={catalog}
                    mode="single"
                    extraTabs={presetTabs}
                    tab={tab === 'outfits' ? 'skin' : tab}
                    onTab={setTab}
                    value={cat.outfits[lookIndex]}
                    onChange={(slot, id) => updateCat(index, { outfits: cat.outfits.map((look, at) => (at === lookIndex ? { ...look, [slot]: id ?? null } : look)) })}
                  />
                ) : (
                  <p className="bd-hint">A fixed look is a complete outfit that is shown exactly like this, never mixed with the picks. Add one to start.</p>
                )}
              </>
            )}
          </section>
        </div>

        <footer className="bongo-dialog__foot">
          <span className="bd-result">
            <span className="material-symbols-outlined" aria-hidden="true">
              {total === 1 ? 'image' : 'gif_box'}
            </span>
            {result}
          </span>
          <button type="button" className="bongo-button bongo-button--quiet" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="bongo-button" disabled={busy} onClick={() => onApply(normalizeDesign(design, catalog))}>
            {applyLabel}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
