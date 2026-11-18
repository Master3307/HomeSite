import DATA from '../data/elements.json'

/*
 * The elements (src/data/elements.json, from PubChem, built by
 * scripts/elements.mjs) and chemical formulas for /dash: look elements up by
 * symbol, name ("iron", "Eisen" when the language file has it) or "element
 * 26"; work out molar masses of formulas (H2O, Ca(OH)2, CuSO4·5H2O).
 */

export const ELEMENTS = DATA.elements
export const ELEMENT_UNITS = DATA.units
export const ELEMENT_SOURCE = DATA.source
const BY_SYMBOL = new Map(ELEMENTS.map((element) => [element.symbol, element]))
export const elementBySymbol = (symbol) => BY_SYMBOL.get(symbol) ?? null
export const elementByNumber = (z) => ELEMENTS[z - 1] ?? null

export const CATEGORIES = ['alkali', 'alkaline', 'transition', 'post', 'metalloid', 'nonmetal', 'halogen', 'noble', 'lanthanide', 'actinide']

/** Kelvin from the data, as numbers (null when unknown). */
export const kelvin = (value) => (value === null || value === undefined || value === '' ? null : Number(value))

/* The state at a temperature (K), from the melting and boiling points at normal pressure; null when they aren't known. */
export function stateAt(element, temperature) {
  const melt = kelvin(element.mp)
  const boil = kelvin(element.bp)
  if (melt === null && boil === null) return null
  if (boil !== null && temperature >= boil) return 'gas'
  if (melt !== null && temperature >= melt) return 'liquid'
  if (melt === null && boil !== null) return temperature < boil ? null : 'gas'
  return 'solid'
}

/* Valence electrons of main group elements (groups 1, 2, 13–18; He has 2). */
export function valenceElectrons(element) {
  if (element.z === 2) return 2
  if (element.group === 1 || element.group === 2) return element.group
  if (element.group >= 13) return element.group - 10
  return null
}

const normalizeName = (text) =>
  String(text ?? '')
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * The element a query means, or null: its symbol (as written: "Fe", "He", "C"),
 * its name in any of `names` (maps symbol -> name, English + the visitor's
 * language), "element 26" / "Z = 26".
 */
export function findElement(query, names = []) {
  const text = String(query ?? '').trim()
  if (!text || text.length > 40) return null
  if (BY_SYMBOL.has(text)) return BY_SYMBOL.get(text)
  const number = /^(?:element|elem\.?|z\s*=?|ordnungszahl|atomic number)\s*#?\s*(\d{1,3})$/i.exec(text)
  if (number) return elementByNumber(Number(number[1]))
  const wanted = normalizeName(text.replace(/^(?:element|the element)\s+/i, ''))
  if (wanted.length < 3) return null
  for (const map of names) {
    for (const [symbol, name] of Object.entries(map ?? {})) {
      for (const alias of String(name).split(',')) if (normalizeName(alias) === wanted) return BY_SYMBOL.get(symbol) ?? null
    }
  }
  return null
}

/* ---------- chemical formulas ---------- */

/**
 * "H2O", "Ca(OH)2", "Fe2(SO4)3", "CuSO4·5H2O", "[Cu(NH3)4]SO4", "2H2O":
 * { counts: Map(symbol -> count), mass (g/mol), formula (with subscripts) },
 * or null when it isn't one.
 */
export function parseFormula(input) {
  const text = String(input ?? '')
    .trim()
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (char) => String('₀₁₂₃₄₅₆₇₈₉'.indexOf(char)))
    .replace(/\s+/g, '')
  if (!text || text.length > 60 || !/^[A-Z(\[\d]/.test(text)) return null
  // Hydrates and adducts: CuSO4·5H2O, CuSO4*5H2O
  const parts = text.split(/[·•*.]/)
  const total = new Map()
  for (const part of parts) {
    const lead = /^(\d+)(?=[A-Z([])/.exec(part)
    const factor = lead ? Number(lead[1]) : 1
    const counts = parseGroup(lead ? part.slice(lead[0].length) : part)
    if (!counts) return null
    for (const [symbol, count] of counts) total.set(symbol, (total.get(symbol) ?? 0) + count * factor)
  }
  if (!total.size) return null
  let mass = 0
  for (const [symbol, count] of total) mass += Number(BY_SYMBOL.get(symbol).mass) * count
  return { counts: total, mass, formula: text.replace(/(?<=[A-Za-z)\]])(\d+)/g, (digits) => [...digits].map((d) => '₀₁₂₃₄₅₆₇₈₉'[d]).join('')).replace(/[*.]/g, '·') }
}

function parseGroup(text) {
  const stack = [new Map()]
  let index = 0
  const add = (map, symbol, count) => map.set(symbol, (map.get(symbol) ?? 0) + count)
  while (index < text.length) {
    const char = text[index]
    if (char === '(' || char === '[') {
      stack.push(new Map())
      index++
      continue
    }
    if (char === ')' || char === ']') {
      if (stack.length < 2) return null
      const group = stack.pop()
      const digits = /^\d+/.exec(text.slice(index + 1))
      const count = digits ? Number(digits[0]) : 1
      for (const [symbol, n] of group) add(stack.at(-1), symbol, n * count)
      index += 1 + (digits ? digits[0].length : 0)
      continue
    }
    const element = /^([A-Z][a-z]?)(\d*)/.exec(text.slice(index))
    if (!element || !BY_SYMBOL.has(element[1])) return null
    add(stack.at(-1), element[1], element[2] ? Number(element[2]) : 1)
    index += element[0].length
  }
  return stack.length === 1 ? stack[0] : null
}

/**
 * A formula worth showing in the search: something chemistry-like, not any
 * capitalised word (CNN, USA): with a number, brackets or a hydrate dot, or
 * at least two element symbols one of which has two letters (NaCl, HCl).
 */
export function looksLikeFormula(text, parsed) {
  if (!parsed) return false
  const clean = String(text).trim()
  if (/[\d()[\]·•*]/.test(clean)) return parsed.counts.size >= 1 && !/^\d+$/.test(clean)
  const tokens = clean.match(/[A-Z][a-z]?/g) ?? []
  return tokens.length >= 2 && tokens.some((token) => token.length === 2)
}

/* Mass fraction of each element in a formula, in %. */
export function composition(parsed) {
  return [...parsed.counts].map(([symbol, count]) => {
    const part = Number(BY_SYMBOL.get(symbol).mass) * count
    return { symbol, count, mass: part, percent: (part / parsed.mass) * 100 }
  })
}
