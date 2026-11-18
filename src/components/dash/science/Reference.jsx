import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import ElementCard from './ElementCard.jsx'
import Formulas, { Constants } from './Formulas.jsx'
import PeriodicTable from './PeriodicTable.jsx'
import '../../../styles/science.css'

/*
 * The science reference opened from the /dash search: the periodic table,
 * the formula collection and constants, and an element's card on top.
 * `start`: { tab: 'table' | 'formulas' | 'constants', element?, formula? }.
 */
export default function Reference({ start, onClose }) {
  const { t } = useTranslation('elements')
  const [tab, setTab] = useState(start?.tab ?? 'table')
  const [element, setElement] = useState(start?.element ?? null)
  const [focus, setFocus] = useState(start?.element ?? null)
  const dialog = useRef(null)
  const returnFocus = useRef(typeof document !== 'undefined' ? document.activeElement : null)

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (element) setElement(null)
      else onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [element, onClose])
  useEffect(() => {
    dialog.current?.focus({ preventScroll: true })
    const previous = returnFocus.current
    const overflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = overflow
      previous?.focus?.({ preventScroll: true })
    }
  }, [])

  return createPortal(
    <div className="sci-shade" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={dialog} className="sci-dialog" role="dialog" aria-modal="true" aria-label={t(`tabs.${tab}`)} tabIndex={-1}>
        <header className="sci-dialog__head">
          <div className="dash-segment sci-dialog__tabs" role="tablist">
            {['table', 'formulas', 'constants'].map((name) => (
              <button key={name} type="button" role="tab" aria-selected={tab === name} className={tab === name ? 'is-active' : ''} onClick={() => setTab(name)}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  {name === 'table' ? 'grid_view' : name === 'formulas' ? 'function' : 'pin'}
                </span>
                {t(`tabs.${name}`)}
              </button>
            ))}
          </div>
          <button type="button" className="dash-tool" onClick={onClose} aria-label={t('close')} title={t('close')}>
            <span className="material-symbols-outlined" aria-hidden="true">
              close
            </span>
          </button>
        </header>
        <div className="sci-dialog__body">
          {tab === 'table' && <PeriodicTable focus={focus} onOpen={(picked) => setElement(picked)} />}
          {tab === 'formulas' && <Formulas focus={start?.formula ?? null} />}
          {tab === 'constants' && <Constants />}
        </div>
        {element && (
          <div className="sci-dialog__card" onMouseDown={(event) => event.target === event.currentTarget && setElement(null)}>
            <ElementCard
              element={element}
              onPick={setElement}
              onClose={() => setElement(null)}
              onShowInTable={() => {
                setFocus(element)
                setTab('table')
                setElement(null)
              }}
            />
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
