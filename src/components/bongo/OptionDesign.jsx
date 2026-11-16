import { lazy, Suspense, useState } from 'react'

import { DesignPreview } from './BongoRender'
import '/src/styles/bongo.css'

const DesignEditor = lazy(() => import('./DesignEditor'))

/*
 * The designed cat of an FDC option (create and manage): a preview and a
 * button into the designer. An old option that is still a picture shows it
 * faded behind a red "!", and the designer opens with it side by side.
 */

/** `open` / `onOpenChange`: keep the designer's open state outside (e.g. in the address), optional. */
/** `reference`: `{ src, label }` shown next to the designer; `migrate`: a label when the option is still only a picture. */
export function DesignSlot({ catalog, design, onChange, required = false, disabled = false, open: openProp, onOpenChange, reference = null, migrate = null }) {
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const setOpen = onOpenChange ?? setOpenState
  return (
    <div className="bongo-option-design bongo-ui">
      {design ? (
        <button type="button" className="bongo-option-design__preview" onClick={() => setOpen(true)} disabled={disabled} title="Edit the design">
          <DesignPreview catalog={catalog} design={design} play />
        </button>
      ) : (
        <button type="button" className={`bongo-option-design__empty${migrate ? ' is-migrate' : ''}`} onClick={() => setOpen(true)} disabled={disabled}>
          {migrate && reference && <img className="bongo-option-design__old" src={reference.src} alt="" loading="lazy" />}
          {migrate && (
            <span className="bongo-option-design__todo" aria-hidden="true">
              !
            </span>
          )}
          <span className="material-symbols-outlined" aria-hidden="true">
            pets
          </span>
          Design the cat
          {migrate ? <small>{migrate}</small> : required ? <small>needed for every new option</small> : <small>optional</small>}
        </button>
      )}
      {design && (
        <div className="bongo-option-design__actions">
          <button type="button" className="fdc-link" onClick={() => setOpen(true)} disabled={disabled}>
            <span className="material-symbols-outlined" aria-hidden="true">
              edit
            </span>
            Edit design
          </button>
          {!required && (
            <button type="button" className="fdc-link" onClick={() => onChange(null)} disabled={disabled}>
              <span className="material-symbols-outlined" aria-hidden="true">
                delete
              </span>
              Remove design
            </button>
          )}
        </div>
      )}
      {open && (
        <Suspense fallback={null}>
          <DesignEditor
            catalog={catalog}
            design={design}
            title="Design the option's cat"
            reference={reference}
            onCancel={() => setOpen(false)}
            onApply={(spec) => {
              onChange(spec)
              setOpen(false)
            }}
          />
        </Suspense>
      )}
    </div>
  )
}
