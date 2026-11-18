import { ELEMENTS, composition, findElement, looksLikeFormula, parseFormula } from '../../../lib/chem.js'
import { formatNumber } from '../../../lib/dashMath.js'
import { FORMULAS } from '../../../data/formulas.js'
import MathView from '../MathView.jsx'
import AtomModel from './AtomModel.jsx'
import { matchFormulas } from './Formulas.jsx'
import '../../../styles/science.css'

/*
 * What the /dash search suggests for science: the periodic table and the
 * formula collection (by keyword), an element (symbol, name, "element 26",
 * with its atom in 3D), the molar mass of a chemical formula (H2O, Ca(OH)2)
 * and formulas by name. Loaded only when the dash has been open a moment.
 */

const TABLE_WORDS = /^(?:periodic(?:\s+table)?(?:\s+of\s+(?:the\s+)?elements)?|pse|ptable|periodensystem(?:\s+der\s+elemente)?|elements?|table of elements)$/i
const FORMULA_WORDS = /^(?:formulas?|formulae|formula collection|formelsammlung|formeln?|equations?)$/i
const CONSTANT_WORDS = /^(?:constants?|konstanten|naturkonstanten|physical constants)$/i

export function suggest(query, { t, tf, locale, open }) {
  const text = String(query ?? '').trim()
  if (!text) return []
  const items = []
  if (TABLE_WORDS.test(text)) items.push({ key: 'sci:table', group: 'top', icon: 'grid_view', title: t('search_.table'), subtitle: t('search_.tableHint'), hint: t('title'), open: () => open({ tab: 'table' }) })
  if (FORMULA_WORDS.test(text)) items.push({ key: 'sci:formulas', group: 'top', icon: 'function', title: t('search_.formulas'), subtitle: t('search_.formulasHint'), hint: tf('title'), open: () => open({ tab: 'formulas' }) })
  if (CONSTANT_WORDS.test(text)) items.push({ key: 'sci:constants', group: 'top', icon: 'pin', title: tf('constants'), subtitle: '', hint: tf('title'), open: () => open({ tab: 'constants' }) })

  const names = [Object.fromEntries(ELEMENTS.map((element) => [element.symbol, t(`names.${element.symbol}`)])), Object.fromEntries(ELEMENTS.map((element) => [element.symbol, t(`names.${element.symbol}`, { lng: 'en' })]))]
  const element = findElement(text, names)
  if (element) {
    const name = t(`names.${element.symbol}`)
    items.push({
      key: `sci:element:${element.z}`,
      group: 'top',
      visual: <AtomModel element={element} size={52} label={name} />,
      title: `${element.symbol} · ${name}`,
      subtitle: `${element.z} · ${formatNumber(Number(element.mass), { digits: 6, locale })} u · ${t(`categories.${element.category}`)} · ${String(element.config).replace(/([spdf])(\d+)/g, (_, letter, count) => `${letter}${[...count].map((digit) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[digit]).join('')}`)}`,
      hint: t('search_.element'),
      open: () => open({ tab: 'table', element }),
    })
  }
  const parsed = element ? null : parseFormula(text)
  if (parsed && looksLikeFormula(text, parsed)) {
    const mass = formatNumber(parsed.mass, { digits: 6, locale })
    items.push({
      key: 'sci:molar',
      group: 'top',
      icon: 'science',
      title: `M(${parsed.formula}) = ${mass} g/mol`,
      subtitle: composition(parsed)
        .map((part) => `${part.symbol}${part.count > 1 ? `×${part.count}` : ''} ${formatNumber(part.percent, { digits: 4, locale })} %`)
        .join(' · '),
      hint: t('search_.molar'),
      copy: formatNumber(parsed.mass, { digits: 6, plain: true }),
    })
  }
  for (const formula of matchFormulas(text, tf, element || parsed ? 2 : 4)) {
    items.push({
      key: `sci:formula:${formula.id}`,
      group: 'after',
      icon: 'function',
      title: tf(`items.${formula.id}.name`),
      visual: null,
      math: <MathView text={formula.show} names={Object.keys(formula.vars ?? {})} className="site-search__math" />,
      subtitle: '',
      hint: t('search_.formula'),
      open: () => open({ tab: 'formulas', formula: formula.id }),
    })
  }
  return items
}

export { FORMULAS }
