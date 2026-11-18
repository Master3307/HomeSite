import { useTranslation } from 'react-i18next'

import { ELEMENTS, elementByNumber, kelvin, valenceElectrons } from '../../../lib/chem.js'
import { formatNumber } from '../../../lib/dashMath.js'
import AtomModel from './AtomModel.jsx'

/*
 * Everything about one element: the atom in 3D, basics, the structure of the
 * atom, its properties (PubChem's values, with their units), links.
 */

const SHELL_NAMES = ['K', 'L', 'M', 'N', 'O', 'P', 'Q']
const superscripts = (config) => String(config).replace(/([spdf])(\d+)/g, (_, letter, count) => `${letter}${[...count].map((digit) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[digit]).join('')}`)

export function useElementName() {
  const { t } = useTranslation('elements')
  return (element) => t(`names.${element.symbol}`, { defaultValue: element.symbol })
}

export function categoryColor(category) {
  return `var(--sci-${category ?? 'unknown'})`
}

function Row({ label, children, hint = null }) {
  return (
    <div className="sci-card__row">
      <dt>{label}</dt>
      <dd>
        {children}
        {hint && <small>{hint}</small>}
      </dd>
    </div>
  )
}

export default function ElementCard({ element, onPick, onClose, onShowInTable = null }) {
  const { t, i18n } = useTranslation('elements')
  const nameOf = useElementName()
  const name = nameOf(element)
  const number = (value, digits = 6) => (value === null || value === undefined || value === '' ? null : formatNumber(Number(value), { digits, locale: i18n.language }))
  const temperature = (value) => {
    const k = kelvin(value)
    if (k === null) return null
    return `${number(k)} K (${number(k - 273.15, 6)} °C)`
  }
  const none = <span className="dash-muted">{t('noData')}</span>
  const valence = valenceElectrons(element)
  const neutrons = element.a - element.z
  const ie = element.ie ? `${number(element.ie)} eV (${number(Number(element.ie) * 96.485, 5)} kJ/mol)` : null
  const ea = element.ea ? `${number(element.ea)} eV (${number(Number(element.ea) * 96.485, 4)} kJ/mol)` : null
  const before = elementByNumber(element.z - 1)
  const after = elementByNumber(element.z + 1)
  const gas = element.state?.startsWith('gas')
  return (
    <article className="sci-card" style={{ '--tone': categoryColor(element.category) }} aria-label={name}>
      <header className="sci-card__head">
        <div className="sci-card__tile">
          <span className="sci-card__z">{element.z}</span>
          <strong>{element.symbol}</strong>
          <span>{number(element.mass)}</span>
        </div>
        <div className="sci-card__title">
          <h2>{name}</h2>
          <p>
            <span className="sci-card__chip">{t(`categories.${element.category}`)}</span>
            {element.group ? `${t('card.group')} ${element.group} · ` : ''}
            {t('card.period')} {element.period} · {t(`blocks.${element.block}`)}
          </p>
        </div>
        <div className="sci-card__nav">
          <button type="button" className="dash-tool" disabled={!before} onClick={() => before && onPick(before)} title={t('card.previous')} aria-label={t('card.previous')}>
            <span className="material-symbols-outlined" aria-hidden="true">
              chevron_left
            </span>
          </button>
          <button type="button" className="dash-tool" disabled={!after} onClick={() => after && onPick(after)} title={t('card.next')} aria-label={t('card.next')}>
            <span className="material-symbols-outlined" aria-hidden="true">
              chevron_right
            </span>
          </button>
          {onShowInTable && (
            <button type="button" className="dash-tool" onClick={onShowInTable} title={t('card.inTable')} aria-label={t('card.inTable')}>
              <span className="material-symbols-outlined" aria-hidden="true">
                grid_view
              </span>
            </button>
          )}
          {onClose && (
            <button type="button" className="dash-tool" onClick={onClose} title={t('close')} aria-label={t('close')}>
              <span className="material-symbols-outlined" aria-hidden="true">
                close
              </span>
            </button>
          )}
        </div>
      </header>
      <div className="sci-card__body">
        <figure className="sci-card__model">
          <AtomModel key={element.z} element={element} size={300} interactive label={t('card.model')} />
          <figcaption>
            <span className="sci-card__legend">
              <i style={{ background: '#e5484d' }} /> {t('card.protons')} {element.z}
              <i style={{ background: '#a7adbb' }} /> {t('card.neutrons')} ≈ {neutrons}
              <i style={{ background: '#4dabf7' }} /> {t('card.electrons')} {element.z}
            </span>
            {t('card.modelNote')}
          </figcaption>
        </figure>
        <div className="sci-card__facts">
          <section>
            <h3>{t('card.basics')}</h3>
            <dl>
              <Row label={t('card.z')}>{element.z}</Row>
              <Row label={t('card.mass')}>{number(element.mass)} u</Row>
              <Row label={t('card.molar')}>{number(element.mass)} g/mol</Row>
              <Row label={t('card.category')}>{t(`categories.${element.category}`)}</Row>
              <Row label={t('card.group')}>{element.group ?? '–'}</Row>
              <Row label={t('card.period')}>{element.period}</Row>
              <Row label={t('card.block')}>{t(`blocks.${element.block}`)}</Row>
              <Row label={t('card.state')}>{element.state ? t(`states.${element.state}`) : none}</Row>
            </dl>
          </section>
          <section>
            <h3>{t('card.structure')}</h3>
            <dl>
              <Row label={t('card.protons')}>{element.z}</Row>
              <Row label={t('card.electrons')}>{element.z}</Row>
              <Row label={t('card.neutrons')} hint={t('card.neutronsHint', { a: element.a })}>
                ≈ {neutrons}
              </Row>
              <Row label={t('card.shells')}>
                <span className="sci-card__shells">
                  {element.shells.map((count, index) => (
                    <span key={SHELL_NAMES[index]}>
                      <small>{SHELL_NAMES[index]}</small>
                      {count}
                    </span>
                  ))}
                </span>
              </Row>
              {valence !== null && <Row label={t('card.valence')}>{valence}</Row>}
              <Row label={t('card.config')}>
                <span className="sci-card__config">{superscripts(element.config)}</span>
              </Row>
              <Row label={t('card.ox')}>{element.ox ?? none}</Row>
            </dl>
          </section>
          <section>
            <h3>{t('card.properties')}</h3>
            <dl>
              <Row label={t('card.en')}>{element.en ? number(element.en) : none}</Row>
              <Row label={t('card.radius')}>{element.radius ? `${number(element.radius)} pm` : none}</Row>
              <Row label={t('card.ie')}>{ie ?? none}</Row>
              <Row label={t('card.ea')}>{ea ?? none}</Row>
              <Row label={t('card.mp')}>{temperature(element.mp) ?? none}</Row>
              <Row label={t('card.bp')}>{temperature(element.bp) ?? none}</Row>
              <Row label={t('card.density')} hint={gas && element.density ? t('card.densityGas') : null}>
                {element.density ? `${number(element.density)} g/cm³` : none}
              </Row>
              <Row label={t('card.year')}>{element.year ? (element.year === 'Ancient' ? t('ancient') : element.year) : none}</Row>
              {element.color && (
                <Row label={t('card.colour')}>
                  <span className="sci-card__swatch" style={{ background: `#${element.color}` }} /> #{element.color}
                </Row>
              )}
            </dl>
          </section>
          <section>
            <h3>{t('card.links')}</h3>
            <p className="sci-card__links">
              <a href={`https://en.wikipedia.org/wiki/${encodeURIComponent(t(`names.${element.symbol}`, { lng: 'en' }))}`} target="_blank" rel="noopener noreferrer">
                {t('card.wikipedia')}
              </a>
              <a href={`https://pubchem.ncbi.nlm.nih.gov/element/${element.z}`} target="_blank" rel="noopener noreferrer">
                {t('card.pubchem')}
              </a>
            </p>
            <p className="dash-muted sci-card__source">{t('card.source')}</p>
          </section>
        </div>
      </div>
    </article>
  )
}

export { ELEMENTS }
