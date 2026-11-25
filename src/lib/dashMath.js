/*
 * The dash's calculator (the search box, the calculator widget): plain
 * maths, equations, unit conversions and functions to graph. No eval: an
 * own tokenizer + Pratt parser builds a tree that is compiled to closures.
 *
 * Input in any form people use:
 *   LaTeX     \frac{1}{2}, \sqrt[3]{8}, 2\cdot3, x^{2}, \pi, \sin(x), \left( \right)
 *   Unicode   2×3, 6÷2, 2·3, −4, √9, ∛27, π, x², ½, 30°, ≤ / ≥ are ignored
 *   typed     "2 /2", "4 : 2", "3 x 4", "5 plus 3", "2 to the power of 8",
 *             "9 squared", "square root of 16", "20% of 50", "50 + 10%",
 *             2x, 3(4+1), 2π, sin x, 1,5 (decimal comma)
 *   equations "x^2 = 2", "2x + 1 = 7", "sin(x) = 0.5" (one unknown, numeric)
 *   graphs    "sin x", "x^2 - 3", "y = 2x + 1", "f(x) = e^-x"
 *   units     "1m" (metres and minutes), "5 ft in cm", "1h 30min → s",
 *             "100 km/h to mph", "20 °C in F", "2 GiB as MB"; arrows, ->,
 *             =>, in, to, into, as, whatever the spacing
 *
 * analyze(input, { angle: 'rad' | 'deg' }) -> null (not maths) or
 *   { rows: [{ id, kind, text, copy, hint }], graph: [{ id, label, fn }] | null }
 * rows[0] is the most exact answer.
 */

import { analyzeColor } from './dashColor.js'
import { analyzeTime } from './dashTime.js'

/* CSS colour names (red, rebeccapurple), resolved by the browser. */
let colorCanvas = null
function namedColor(name) {
  if (typeof document === 'undefined' || !globalThis.CSS?.supports?.('color', name)) return null
  colorCanvas ??= document.createElement('canvas').getContext('2d')
  colorCanvas.fillStyle = '#000'
  colorCanvas.fillStyle = name
  const value = colorCanvas.fillStyle
  const hex = /^#([0-9a-f]{6})$/i.exec(value)
  if (hex) return { r: parseInt(hex[1].slice(0, 2), 16), g: parseInt(hex[1].slice(2, 4), 16), b: parseInt(hex[1].slice(4, 6), 16), a: 1 }
  const rgba = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(value)
  return rgba ? { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]), a: rgba[4] === undefined ? 1 : Number(rgba[4]) } : null
}

/* ---------- numbers ---------- */

export function formatNumber(value, { digits = 12, locale = undefined, plain = false } = {}) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '–'
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '−∞'
  if (Object.is(value, -0) || Math.abs(value) < 1e-300) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e15 || abs < 1e-6) {
    const [mantissa, exponent] = value.toExponential(Math.min(digits, 15) - 1).split('e')
    const m = String(Number(mantissa))
    return plain ? `${m}e${Number(exponent)}` : `${m} × 10${superscript(Number(exponent))}`
  }
  const rounded = Number(value.toPrecision(Math.min(digits, 15)))
  if (plain) return String(rounded)
  return rounded.toLocaleString(locale, { maximumFractionDigits: 12 })
}

const SUPERSCRIPTS = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻', '+': '⁺' }
export function scientific(value) {
  const [mantissa, exponent] = value.toExponential(8).split('e')
  return `${Number(mantissa)} × 10${superscript(Number(exponent))}`
}
const superscript = (number) => [...String(number)].map((char) => SUPERSCRIPTS[char] ?? char).join('')

/* A simple fraction close to `value` (denominator up to 1000), or null. */
function asFraction(value) {
  if (!Number.isFinite(value) || Number.isInteger(value) || Math.abs(value) > 1e6) return null
  let [h1, h0, k1, k0] = [1, 0, 0, 1]
  let x = Math.abs(value)
  for (let i = 0; i < 20; i++) {
    const a = Math.floor(x)
    ;[h1, h0] = [a * h1 + h0, h1]
    ;[k1, k0] = [a * k1 + k0, k1]
    if (k1 > 1000) return null
    if (Math.abs(Math.abs(value) - h1 / k1) < 1e-12 * Math.max(1, Math.abs(value))) return k1 === 1 ? null : `${value < 0 ? '−' : ''}${h1}/${k1}`
    const rest = x - a
    if (rest < 1e-12) break
    x = 1 / rest
  }
  return null
}

/* ---------- reading any notation ---------- */

const UNICODE_FRACTIONS = { '½': '(1/2)', '⅓': '(1/3)', '⅔': '(2/3)', '¼': '(1/4)', '¾': '(3/4)', '⅕': '(1/5)', '⅖': '(2/5)', '⅗': '(3/5)', '⅘': '(4/5)', '⅙': '(1/6)', '⅚': '(5/6)', '⅛': '(1/8)', '⅜': '(3/8)', '⅝': '(5/8)', '⅞': '(7/8)', '⅐': '(1/7)', '⅑': '(1/9)', '⅒': '(1/10)' }
const SUPER_IN = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+', '⁽': '(', '⁾': ')', ˣ: 'x', 'ⁿ': 'n' }
const SUB_IN = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' }

/* The innermost {…} after a LaTeX command, as text. */
function latexGroups(text) {
  let out = text
  // The commands first, innermost out (nested \frac), and plain {…} only when no command can go on.
  const commands = (value) =>
    value
    .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '(($1)/($2))')
    .replace(/\\sqrt\s*\[([^[\]]*)\]\s*\{([^{}]*)\}/g, 'root(($2),($1))')
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, 'sqrt($1)')
    .replace(/\\log_\{?([^{}\s]+?)\}?\s*\{([^{}]*)\}/g, 'log(($2),($1))')
    .replace(/\\(?:operatorname|mathit|mathbf)\s*\{([^{}]*)\}/g, '$1')
    .replace(/\\(?:mathrm|text|textrm|rm)\s*\{([^{}]*)\}/g, (_, inner) => (unitExpression(inner) ? `⟦${inner}⟧` : /^[A-Za-z]{1,3}$/.test(inner.trim()) ? inner : ' '))
    .replace(/\^\s*\{([^{}]*)\}/g, '^($1)')
    .replace(/_\s*\{([^{}]*)\}/g, (_, inner) => `_${inner.replace(/[^A-Za-z0-9]/g, '')}`)
  for (let guard = 0; guard < 60; guard++) {
    const before = out
    out = commands(out)
    if (out === before) out = out.replace(/\{([^{}]*)\}/g, '($1)')
    if (out === before) break
  }
  return out
}

/*
 * The words people write maths with, per language (src/locales/<lang>/calc.json,
 * English always included): unit names, "plus", "squared", "in" / "to" for
 * conversions, and the labels of the answers. setMathLanguage(...packs)
 * merges them (lists are comma separated); the symbols stay in the code.
 */
const OPERATOR_WORDS = { power: '^', squared: '^2', cubed: '^3', sqrtOf: ' sqrt ', cbrtOf: ' cbrt ', times: '*', dividedBy: '/', plus: '+', minus: '-', mod: ' mod ' }
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const wordPattern = (list, flags = 'giu') => (list.length ? new RegExp(`(?<![\\p{L}\\p{N}_])(?:${[...list].sort((a, b) => b.length - a.length).map((word) => escapeRegex(word).replace(/ +/g, '\\s+')).join('|')})(?![\\p{L}\\p{N}_])`, flags) : null)
const listOf = (value) =>
  String(value ?? '')
    .split(',')
    .map((word) => word.trim().toLocaleLowerCase())
    .filter(Boolean)

let LANGUAGE = { words: [], percentOf: null, and: [], convert: [], labels: {}, dimensions: {}, zones: {}, phrases: { ask: [], convert: [], howMany: [], color: [] } }

/*
 * Other names for LaTeX commands ("\squareroot", "\fraction"), from the
 * symbol names in calc.json (components/dash/mathSymbols.js latexAliases).
 * Real commands always win.
 */
const LATEX_KNOWN = new Set('frac dfrac tfrac sqrt cdot times ast div pm infty pi tau phi varphi theta alpha beta lambda mu sigma omega arcsin arccos arctan sinh cosh tanh sin cos tan cot sec csc ln log exp min max abs gcd left right big Big bigg displaystyle quad qquad lvert rvert vert circ text mathrm operatorname mathit mathbf to rightarrow Rightarrow mapsto bmod pmod'.split(' '))
let LATEX_ALIASES = {}
export function setLatexAliases(map) {
  LATEX_ALIASES = Object.fromEntries(Object.entries(map ?? {}).filter(([alias]) => !LATEX_KNOWN.has(alias)))
}

/** Packs: the calc.json of each language to read (English first, then the visitor's). */
export function setMathLanguage(...packs) {
  const merged = { units: {}, words: {}, convert: [], and: [], labels: {}, dimensions: {}, zones: {}, phrases: { ask: [], convert: [], howMany: [], color: [] } }
  for (const pack of packs.filter(Boolean)) {
    for (const [dimension, ids] of Object.entries(pack.units ?? {})) {
      merged.units[dimension] ??= {}
      for (const [id, words] of Object.entries(ids ?? {})) merged.units[dimension][id] = [...(merged.units[dimension][id] ?? []), ...listOf(words)]
    }
    for (const [key, words] of Object.entries(pack.words ?? {})) merged.words[key] = [...(merged.words[key] ?? []), ...listOf(words)]
    merged.convert.push(...listOf(pack.convert))
    merged.and.push(...listOf(pack.and))
    // Labels: the visitor's language wins.
    Object.assign(merged.labels, pack.labels ?? {})
    Object.assign(merged.dimensions, pack.dimensions ?? {})
    Object.assign(merged.zones, pack.zones ?? {})
    for (const key of Object.keys(merged.phrases)) merged.phrases[key].push(...listOf(pack.phrases?.[key]))
  }
  indexUnits(merged.units)
  LANGUAGE = {
    words: Object.entries(OPERATOR_WORDS)
      .map(([key, token]) => [wordPattern(merged.words[key] ?? []), token])
      .filter(([pattern]) => pattern),
    percentOf: wordPattern(merged.words.percentOf ?? [], 'iu'),
    and: merged.and,
    convert: merged.convert,
    labels: merged.labels,
    dimensions: merged.dimensions,
    zones: merged.zones,
    phrases: merged.phrases,
  }
  CONVERT_WORDS = convertPattern(merged.convert)
}

const label = (key, values = {}) => String(LANGUAGE.labels[key] ?? key).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => values[name] ?? '')

/*
 * Units in the maths get ⟦…⟧ so they aren't taken for variables: right after
 * a number (300m, 0,3 s, 2,04km, 25\frac{m}{s}, 22\frac{1}{1000}km), and
 * statements of units alone (N = kg \cdot \frac{m}{s^2}). A single letter
 * that is also used as a variable in the same statement (s = v·t) stays one.
 */
const UNIT_SINGLES = new Set(['m', 's', 'h', 'g', 'N', 'J', 'W', 'K', 'A', 'V', 'L'])
const COMMON_UNITS = new Set('km cm mm nm µm um dm kg mg µg min ms ns µs Hz kHz MHz GHz kJ MJ kW MW kWh Wh Pa hPa kPa MPa bar kN mA kV mV mol mmol eV mL ml dl cl ha MB GB kB TB mph kmh lb oz ft yd mi °C °F'.split(' '))
const UNIT_PIECE = String.raw`[A-Za-zµμΩ°]+(?:\^\{?-?\d+\}?|[²³])?`
const plainUnit = (piece) => piece.replace(/\^\{?-?\d+\}?|[²³]|[(){}]/g, '').trim()
const knownUnitText = (text) => {
  const pieces = text.split(/\s*(?:\/|\*|·|\\cdot)\s*|\s+/).map(plainUnit).filter(Boolean)
  return pieces.length > 0 && pieces.every((piece) => UNIT_SINGLES.has(piece) || COMMON_UNITS.has(piece)) && Boolean(unitExpression(text.replace(/\\cdot/g, '*')))
}

function markUnits(input) {
  let text = input
  // Only units, no numbers.
  if (!/\d/.test(text.replace(/\^\s*\{?\s*-?\d+\s*\}?/g, ''))) {
    const names = text.replace(/\\(?:frac|cdot|left|right|quad|mathrm|text)/g, ' ').match(/[A-Za-zµμΩ°]+/g) ?? []
    // (At least one unit of more than one letter, kg in N = kg·m/s²: "A = g·h" is a formula, not amperes = grams times hours.)
    if (names.length >= 2 && names.every((name) => UNIT_SINGLES.has(name) || COMMON_UNITS.has(name)) && names.some((name) => name.length > 1)) {
      return text.replace(/\\[A-Za-z]+|([A-Za-zµμΩ°]+)/g, (whole, name) => (name ? `⟦${name}⟧` : whole))
    }
  }
  // A number followed by \frac{unit}{unit}.
  text = text.replace(/([\d)}])\s*\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, (whole, before, top, bottom) => (knownUnitText(`${top}/(${bottom})`) ? `${before}⟦${top}/(${bottom})⟧` : whole))
  // A number followed by a unit (or units: km/h, kg·m/s^2).
  const pattern = new RegExp(String.raw`([\d)}])\s*(${UNIT_PIECE}(?:\s*(?:\/|\\cdot|·|\*)\s*${UNIT_PIECE})*)(?![A-Za-z_(\d{])`, 'g')
  const found = [...text.matchAll(pattern)].filter((match) => knownUnitText(match[2]))
  const singles = new Map()
  for (const match of found) {
    const unit = plainUnit(match[2])
    if (unit.length === 1) singles.set(unit, (singles.get(unit) ?? 0) + 1)
  }
  const variable = new Set()
  for (const [letter, count] of singles) {
    // Units already marked (⟦m/(s)⟧) don't count.
    const standalone = text.replace(/⟦[^⟧]*⟧/g, ' ').match(new RegExp(String.raw`(?<![A-Za-z_\\])${letter}(?![A-Za-z_])`, 'g'))?.length ?? 0
    if (standalone > count) variable.add(letter)
  }
  for (const match of found.reverse()) {
    if (variable.has(plainUnit(match[2]))) continue
    const start = match.index + match[0].length - match[2].length
    text = `${text.slice(0, start)}⟦${match[2]}⟧${text.slice(start + match[2].length)}`
  }
  return text
}

/** Any notation -> the parser's (ASCII) notation. */
export function normalizeMath(input, { decimalComma = false } = {}) {
  let text = String(input ?? '')
  if (text.length > 800) return ''
  // LaTeX: delimiters, spacing commands, operators, names.
  text = text.replace(/\\([\p{L}]+)/gu, (whole, name) => LATEX_ALIASES[name.toLocaleLowerCase()] ?? whole)
  text = text.replace(/^\s*\$+|\$+\s*$/g, '').replace(/\\\(|\\\)|\\\[|\\\]/g, '')
  text = text.replace(/[\u{1D400}-\u{1D7FF}]/gu, (char) => char.normalize('NFKC'))
  // German notes: 5{,}0, \dots, \approx, \leq; decorations (\bar{v}, \vec{v}) and Δ (\Delta t, \delta s).
  text = text.replace(/\{,\}/g, ',').replace(/\\(?:dots|ldots|cdots)\b/g, '…').replace(/\\ /g, ' ')
  text = text.replace(/\\(?:approx|simeq|sim)\b/g, '≈').replace(/\\(?:leq|le|leqslant)\b/g, '≤').replace(/\\(?:geq|ge|geqslant)\b/g, '≥').replace(/\\(?:neq|ne)\b/g, '≠').replace(/\\lt\b/g, '<').replace(/\\gt\b/g, '>').replace(/≅/g, '≈')
  text = text.replace(/\\(?:bar|vec|hat|overline|tilde|dot|ddot|overrightarrow|mathbf|boldsymbol|mathit)\s*\{([^{}]*)\}/g, '$1').replace(/\\(?:bar|vec|hat|tilde|dot)\s+([A-Za-z])/g, '$1')
  text = text.replace(/\\[dD]elta\s*\{?\s*([A-Za-z])\s*\}?/g, 'Δ$1').replace(/[Δδ]\s*([A-Za-z])/g, 'Δ$1')
  // f_{(x)} is f(x); x_{2}, v_{max} keep their subscript in the name.
  text = text.replace(/([A-Za-z])\s*_\s*\{\s*\(([^{}()]*)\)\s*\}/g, '$1($2)')
  text = text.replace(/_\s*\{\s*([A-Za-z0-9]+)\s*\}/g, '_$1')
  text = markUnits(text)
  text = text.replace(/\\left|\\right|\\big|\\Big|\\bigg|\\displaystyle/g, '').replace(/\\[,;:!]|\\quad|\\qquad|~/g, ' ')
  text = text.replace(/\^\s*\{?\s*\\circ\s*\}?/g, '°').replace(/\\[bp]mod\b/g, ' mod ').replace(/\\(?:to|rightarrow|Rightarrow|mapsto)\b/g, ' to ')
  text = text.replace(/\\cdot|\\times|\\ast/g, '*').replace(/\\div/g, '/').replace(/\\pm/g, '+').replace(/\\infty/g, 'Infinity')
  text = text.replace(/\\(pi|tau|phi|varphi|theta|alpha|beta|lambda|mu|sigma|omega)\b/g, (_, name) => (name === 'varphi' ? 'phi' : name))
  text = text.replace(/\\(arcsin|arccos|arctan|sinh|cosh|tanh|sin|cos|tan|cot|sec|csc|ln|log|exp|min|max|abs)\b/g, '$1')
  text = text.replace(/\\(?:lvert|rvert|vert)/g, '|').replace(/\\%/g, '%').replace(/\\circ/g, '°')
  if (text.includes('{')) text = latexGroups(text)
  // Unicode.
  text = text.replace(/[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞⅐⅑⅒]/g, (char) => UNICODE_FRACTIONS[char])
  text = text.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺⁽⁾ˣⁿ]+/g, (run) => `^(${[...run].map((char) => SUPER_IN[char]).join('')})`)
  text = text.replace(/([A-Za-z])([₀₁₂₃₄₅₆₇₈₉]+)/g, (_, letter, run) => `${letter}_${[...run].map((char) => SUB_IN[char]).join('')}`).replace(/[₀₁₂₃₄₅₆₇₈₉]+/g, (run) => [...run].map((char) => SUB_IN[char]).join(''))
  text = text.replace(/[×✕✖⨯∙⋅·•]/g, '*').replace(/[÷∶⁄∕]/g, '/').replace(/[−–—‒]/g, '-').replace(/[＋]/g, '+')
  text = text.replace(/√/g, ' sqrt ').replace(/∛/g, ' cbrt ').replace(/∜/g, ' root4 ').replace(/π/g, 'pi').replace(/τ/g, 'tau').replace(/[φϕ]/g, 'phi').replace(/ℯ/g, 'e').replace(/∞/g, 'Infinity').replace(/θ/g, 'theta')
  text = text.replace(/\*\*/g, '^')
  // Words (the language packs': "plus", "squared", "divided by" …), and "to the 3rd power".
  text = text.replace(/\bto the\s+(\d+)(?:st|nd|rd|th)?\s+power\b/gi, '^$1')
  for (const [pattern, replacement] of LANGUAGE.words) text = text.replace(pattern, replacement)
  // "3 x 4" is a product when numbers stand on both sides; "20% of 50".
  text = text.replace(/(\d|\))\s+[x×]\s+(?=[\d(])/gi, '$1 * ')
  if (LANGUAGE.percentOf) text = text.replace(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*%\\s*(?:${LANGUAGE.percentOf.source})`, 'giu'), '($1/100)*')
  // "2x4": a product too.
  text = text.replace(/(\d)\s*[x×]\s*(?=\d)/gi, '$1*')
  // Thousands separators: 1,000,000 (a single comma + 1-2 digits stays a decimal comma).
  // (Not in notes with LaTeX or $…$, where 25,175 is twenty-five point one seven five.)
  if (!decimalComma) text = text.replace(/\b\d{1,3}(?:,\d{3})+(?![\d,])/g, (run) => run.replaceAll(',', ''))
  return text.replace(/\s+/g, ' ').trim()
}

/* ---------- tokens and the parser ---------- */

const FUNCTIONS = {
  sin: 1, cos: 1, tan: 1, cot: 1, sec: 1, csc: 1, asin: 1, acos: 1, atan: 1, arcsin: 1, arccos: 1, arctan: 1, sinh: 1, cosh: 1, tanh: 1, asinh: 1, acosh: 1, atanh: 1,
  sqrt: 1, cbrt: 1, root4: 1, abs: 1, ln: 1, log: 2, lg: 1, log2: 1, log10: 1, exp: 1, floor: 1, ceil: 1, round: 2, trunc: 1, sign: 1, sgn: 1, fact: 1,
  min: 9, max: 9, root: 2, nthroot: 2, gcd: 9, lcm: 9, ncr: 2, npr: 2, hypot: 9, atan2: 2, mod: 2, avg: 9, mean: 9, sum: 9,
}
// Greek letters written out that are variables (tau, phi and pi are constants unless they have a subscript: tau_a).
const GREEK_VARIABLES = ['theta', 'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'eta', 'kappa', 'lambda', 'mu', 'nu', 'rho', 'sigma', 'omega']
const FUNCTION_NAMES = Object.keys(FUNCTIONS).sort((a, b) => b.length - a.length)
const CONSTANTS = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI, phi: (1 + Math.sqrt(5)) / 2, infinity: Infinity }
const ANGLE_FUNCTIONS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc'])
const INVERSE_ANGLE = new Set(['asin', 'acos', 'atan', 'arcsin', 'arccos', 'arctan', 'atan2'])

function tokenize(text) {
  const tokens = []
  let i = 0
  let depthArgs = [] // per open bracket: does a comma separate arguments here?
  while (i < text.length) {
    const char = text[i]
    if (char === ' ') {
      i++
      continue
    }
    if (char === '⟦') {
      // A unit (normalizeMath marked it): ⟦m/s^2⟧
      const end = text.indexOf('⟧', i)
      const unit = end === -1 ? null : unitExpression(text.slice(i + 1, end))
      if (!unit) throw new Error('unit')
      tokens.push({ type: 'unit', unit })
      i = end + 1
      continue
    }
    const number = /^(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:e[-+]?\d+)?/i.exec(text.slice(i))
    if (number && !(number[0].includes(',') && depthArgs.at(-1))) {
      // How many decimals were written (3,997: 3), for rounding checks.
      const decimals = (/[.,](\d+)/.exec(number[0].replace(/e.*$/i, ''))?.[1] ?? '').length
      tokens.push({ type: 'num', value: Number(number[0].replace(',', '.')), decimals })
      i += number[0].length
      continue
    }
    if (/\d/.test(char)) {
      // "max(1,5)": the digit before the comma alone.
      const digits = /^\d+(?:\.\d+)?/.exec(text.slice(i))
      tokens.push({ type: 'num', value: Number(digits[0]), decimals: (digits[0].split('.')[1] ?? '').length })
      i += digits[0].length
      continue
    }
    const word = /^[A-Za-zΔ_][A-Za-z0-9_]*/.exec(text.slice(i))
    if (word) {
      const lower = word[0].toLowerCase()
      // "sinx", "lnx", "sqrtx": a function name glued to its argument.
      const glued = !FUNCTIONS[lower] && CONSTANTS[lower] === undefined && FUNCTION_NAMES.find((name) => lower.startsWith(name) && lower.length > name.length)
      const take = glued ? glued.length : word[0].length
      tokens.push({ type: 'id', value: word[0].slice(0, take) })
      i += take
      continue
    }
    if (char === '(' || char === '[') {
      const before = tokens.at(-1)
      depthArgs.push(Boolean(before?.type === 'id' && FUNCTIONS[before.value.toLowerCase()] > 1))
      tokens.push({ type: '(' })
      i++
      continue
    }
    if (char === ')' || char === ']') {
      depthArgs.pop()
      tokens.push({ type: ')' })
      i++
      continue
    }
    if (char === '±' || char === '∓') {
      tokens.push({ type: 'op', value: '±' })
      i++
      continue
    }
    if ('≈≤≥<>≠'.includes(char)) {
      tokens.push({ type: 'op', value: char })
      i++
      continue
    }
    if ('+-*/^%!=,|°\''.includes(char)) {
      tokens.push({ type: 'op', value: char === "'" ? '°' : char })
      i++
      continue
    }
    throw new Error(`char:${char}`)
  }
  return tokens
}

/*
 * Pratt parser. Implicit multiplication: 2x, 2(3), (1)(2), 2pi, x y.
 * Functions take a bracket or the next factor: sin x, sqrt 2, sin 2x.
 */
function parse(tokens, { names = [], functions = [], words = false } = {}) {
  const named = new Set(names)
  const userFunctions = new Set(functions)
  let index = 0
  const peek = () => tokens[index]
  const next = () => tokens[index++]
  const isOp = (token, value) => token?.type === 'op' && token.value === value

  const startsFactor = (token) => token && (token.type === 'num' || token.type === 'unit' || (token.type === 'id' && token.value.toLowerCase() !== 'mod') || token.type === '(' || (token.type === 'op' && token.value === '|'))

  function primary() {
    const token = next()
    if (!token) throw new Error('end')
    if (token.type === 'num') return { type: 'num', value: token.value, decimals: token.decimals }
    if (token.type === 'unit') return { type: 'unit', unit: token.unit }
    if (token.type === '(') {
      const inner = expression(0)
      if (next()?.type !== ')') throw new Error('bracket')
      return inner
    }
    if (isOp(token, '|')) {
      const inner = expression(0)
      if (!isOp(next(), '|')) throw new Error('bar')
      return { type: 'call', name: 'abs', args: [inner] }
    }
    if (isOp(token, '-')) return { type: 'neg', value: unaryOperand() }
    if (isOp(token, '+')) return unaryOperand()
    if (isOp(token, '±')) return { type: 'pm', left: null, right: unaryOperand() }
    if (token.type === 'id') {
      const name = token.value
      const lower = name.toLowerCase()
      // A function defined earlier: f(2), g(x + 1).
      if (userFunctions.has(name) && peek()?.type === '(') {
        next()
        const args = []
        if (peek()?.type !== ')') {
          args.push(expression(0))
          while (isOp(peek(), ',')) {
            next()
            args.push(expression(0))
          }
        }
        if (next()?.type !== ')') throw new Error('bracket')
        return { type: 'ucall', name, args }
      }
      if (FUNCTIONS[lower]) {
        // sin^2 x = (sin x)^2
        let power = null
        if (isOp(peek(), '^') && tokens[index + 1]?.type === 'num') {
          next()
          power = { type: 'num', value: next().value }
        }
        let args
        if (peek()?.type === '(') {
          next()
          args = []
          if (peek()?.type !== ')') {
            args.push(expression(0))
            while (isOp(peek(), ',')) {
              next()
              args.push(expression(0))
            }
          }
          if (next()?.type !== ')') throw new Error('bracket')
        } else {
          // Without brackets: the next term (sin 2x, sqrt 9, ln x).
          args = [termNoAdd()]
        }
        const call = { type: 'call', name: lower, args }
        return power ? { type: 'pow', base: call, exp: power } : call
      }
      // A letter named as a variable (e in the kite's A = ½·e·f) is one, even if it's a constant's name.
      if (named.has(name)) return { type: 'var', name }
      // Euler's e is the small one (E is energy in physics).
      if (CONSTANTS[lower] !== undefined && name.length > 1) return { type: 'const', name: lower }
      if (name === 'e') return { type: 'const', name: 'e' }
      // Variables: single letters (x, y, t …) and a few names.
      if (/^[A-Za-z]$/.test(name) || named.has(name) || GREEK_VARIABLES.includes(lower) || lower === 'ans' || name === 'pH' || name === 'pOH') return { type: 'var', name }
      // With a subscript or a Δ: x_2, v_max, G_f, Δs, Δt_m.
      if (/^Δ?[A-Za-z](?:_[A-Za-z0-9]+)*$/.test(name) || new RegExp(`^(?:${GREEK_VARIABLES.join('|')}|tau|phi)(?:_[A-Za-z0-9]+)+$`, 'i').test(name)) return { type: 'var', name }
      // The calculator widget: any longer word is a value's name ("rate = 5").
      if (words && name.length > 3) return { type: 'var', name }
      // "xy" / "2ab": a product of single-letter variables.
      if (/^[a-z]{2,3}$/.test(name) && ![...name].some((letter) => CONSTANTS[letter] !== undefined && letter !== 'e')) return [...name].map((letter) => ({ type: 'var', name: letter })).reduce((a, b) => ({ type: 'mul', left: a, right: b }))
      throw new Error(`name:${name}`)
    }
    throw new Error('token')
  }

  function postfix(node) {
    let result = node
    for (;;) {
      if (isOp(peek(), '!')) {
        next()
        result = { type: 'call', name: 'fact', args: [result] }
      } else if (isOp(peek(), '°')) {
        next()
        result = { type: 'deg', value: result }
      } else if (isOp(peek(), '%') && !startsFactor(tokens[index + 1])) {
        next()
        result = { type: 'pct', value: result }
      } else return result
    }
  }

  function unaryOperand() {
    // -2^2 = -(2^2)
    return power()
  }

  function power() {
    let base = postfix(primary())
    // A unit sticks to its number before anything else: 300 m / 12 s is (300 m) / (12 s); 9,81 m/s^2 keeps its ^2 on the s.
    while (peek()?.type === 'unit' && base.type !== 'unit') {
      let unit = { type: 'unit', unit: next().unit }
      if (isOp(peek(), '^') && tokens[index + 1]?.type === 'num') {
        next()
        unit = { type: 'pow', base: unit, exp: { type: 'num', value: next().value } }
      }
      base = { type: 'mul', left: base, right: unit }
    }
    if (isOp(peek(), '^')) {
      next()
      const exponent = isOp(peek(), '-') ? (next(), { type: 'neg', value: power() }) : power()
      return { type: 'pow', base, exp: exponent }
    }
    return base
  }

  // A product without + / - (the argument of "sin 2x").
  function termNoAdd() {
    let left = power()
    while (startsFactor(peek()) && !(peek().type === 'id' && FUNCTIONS[peek().value.toLowerCase()])) left = { type: 'mul', left, right: power() }
    return left
  }

  const BINARY = { '+': 10, '-': 10, '±': 10, '*': 20, '/': 20, '%': 20, mod: 20 }
  function expression(min) {
    let left = power()
    for (;;) {
      const token = peek()
      if (!token) break
      // Implicit multiplication binds like *.
      if (startsFactor(token) && !isOp(token, '|')) {
        if (20 < min) break
        // (Brackets remembered for showing it: g(x), 2(3 + 4).)
        const bracket = token.type === '('
        left = { type: 'mul', left, right: expression(21), ...(bracket ? { bracket: true } : {}) }
        continue
      }
      const op = token.type === 'op' ? token.value : token.type === 'id' && token.value.toLowerCase() === 'mod' ? 'mod' : null
      if (!op || BINARY[op] === undefined || BINARY[op] < min) break
      next()
      // "50 + 10%": 50 * 1.1 (calculator style).
      const right = expression(BINARY[op] + 1)
      if ((op === '+' || op === '-') && right.type === 'pct') left = { type: 'mul', left, right: { type: 'add', left: { type: 'num', value: 1 }, right: op === '+' ? right : { type: 'neg', value: right } } }
      else left = { type: { '+': 'add', '-': 'sub', '±': 'pm', '*': 'mul', '/': 'div', '%': 'mod', mod: 'mod' }[op], left, right }
    }
    return left
  }

  // equation: a = b; a chain: m = (8 - 4) / (5 - 2) = 4/3, 4,5 km ≤ l < 5,5 km
  const RELATIONS = new Set(['=', '≈', '≤', '≥', '<', '>', '≠'])
  const left = expression(0)
  if (peek()?.type === 'op' && RELATIONS.has(peek().value)) {
    const parts = [left]
    const ops = []
    while (peek()?.type === 'op' && RELATIONS.has(peek().value)) {
      ops.push(next().value)
      parts.push(expression(0))
    }
    if (index < tokens.length) throw new Error('rest')
    return parts.length === 2 && ops[0] === '=' ? { type: 'eq', left, right: parts[1] } : { type: 'chain', parts, ops }
  }
  if (index < tokens.length) throw new Error('rest')
  return left
}

/* ---------- compiling ---------- */

function factorial(n) {
  if (!Number.isFinite(n) || n < 0) return NaN
  if (Number.isInteger(n)) {
    if (n > 170) return Infinity
    let result = 1
    for (let i = 2; i <= n; i++) result *= i
    return result
  }
  // Γ(n + 1), Lanczos.
  const g = 7
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61503916999185, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]
  const x = n
  let a = c[0]
  const t = x + g + 0.5
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i)
  return Math.sqrt(2 * Math.PI) * t ** (x + 0.5) * Math.exp(-t) * a
}
const gcd2 = (a, b) => {
  let [x, y] = [Math.abs(Math.round(a)), Math.abs(Math.round(b))]
  while (y) [x, y] = [y, x % y]
  return x
}

function compile(node, options) {
  const toRad = options.angle === 'deg' ? (v) => (v * Math.PI) / 180 : (v) => v
  const fromRad = options.angle === 'deg' ? (v) => (v * 180) / Math.PI : (v) => v
  const c = (n) => compile(n, options)
  switch (node.type) {
    case 'num': {
      const value = node.value
      return () => value
    }
    case 'const': {
      const value = CONSTANTS[node.name]
      return () => value
    }
    case 'var': {
      const name = node.name
      return (env) => {
        const found = env && name in env ? env[name] : NaN
        return isQuantity(found) ? found.v : found
      }
    }
    case 'unit': {
      const factor = node.unit.factor
      return () => factor
    }
    case 'ucall': {
      const args = node.args.map(c)
      const name = node.name
      return (env) => {
        const fn = options.functions?.[name]
        return fn ? fn(...args.map((f) => f(env))) : NaN
      }
    }
    case 'neg': {
      const f = c(node.value)
      return (env) => -f(env)
    }
    case 'pct': {
      const f = c(node.value)
      return (env) => f(env) / 100
    }
    case 'deg': {
      // 30° is 30 degrees, whatever the angle mode (in radians for the maths).
      const f = c(node.value)
      return options.angle === 'deg' ? f : (env) => (f(env) * Math.PI) / 180
    }
    case 'pm': {
      const a = node.left ? c(node.left) : () => 0
      const b = c(node.right)
      return (env) => a(env) + b(env)
    }
    case 'add':
    case 'sub':
    case 'mul':
    case 'div':
    case 'mod':
    case 'pow': {
      const a = c(node.left ?? node.base)
      const b = c(node.right ?? node.exp)
      if (node.type === 'add') return (env) => a(env) + b(env)
      if (node.type === 'sub') return (env) => a(env) - b(env)
      if (node.type === 'mul') return (env) => a(env) * b(env)
      if (node.type === 'div') return (env) => a(env) / b(env)
      if (node.type === 'mod') return (env) => ((a(env) % b(env)) + b(env)) % b(env)
      return (env) => {
        const base = a(env)
        const exponent = b(env)
        // Odd roots of negatives: (-8)^(1/3) = -2.
        if (base < 0 && !Number.isInteger(exponent)) {
          const inverse = 1 / exponent
          if (Number.isInteger(Math.round(inverse)) && Math.abs(inverse - Math.round(inverse)) < 1e-9 && Math.round(inverse) % 2) return -((-base) ** exponent)
        }
        return base ** exponent
      }
    }
    case 'call': {
      const args = node.args.map(c)
      const arg = (env, i = 0) => (args[i] ? args[i](env) : NaN)
      const all = (env) => args.map((f) => f(env))
      const name = node.name
      const angle = ANGLE_FUNCTIONS.has(name)
      const inverse = INVERSE_ANGLE.has(name)
      const table = {
        sin: Math.sin, cos: Math.cos, tan: Math.tan, cot: (v) => 1 / Math.tan(v), sec: (v) => 1 / Math.cos(v), csc: (v) => 1 / Math.sin(v),
        asin: Math.asin, acos: Math.acos, atan: Math.atan, arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan,
        sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
        sqrt: Math.sqrt, cbrt: Math.cbrt, root4: (v) => v ** 0.25, abs: Math.abs, ln: Math.log, lg: Math.log10, log2: Math.log2, log10: Math.log10, exp: Math.exp,
        floor: Math.floor, ceil: Math.ceil, trunc: Math.trunc, sign: Math.sign, sgn: Math.sign, fact: factorial,
      }
      if (table[name]) {
        const f = table[name]
        if (angle) return (env) => f(toRad(arg(env)))
        if (inverse) return (env) => fromRad(f(arg(env)))
        return (env) => f(arg(env))
      }
      if (name === 'log') return (env) => (args.length > 1 ? Math.log(arg(env)) / Math.log(arg(env, 1)) : Math.log10(arg(env)))
      if (name === 'round') return (env) => (args.length > 1 ? Math.round(arg(env) * 10 ** arg(env, 1)) / 10 ** arg(env, 1) : Math.round(arg(env)))
      if (name === 'root' || name === 'nthroot') {
        return (env) => {
          const v = arg(env)
          const n = arg(env, 1)
          return v < 0 && Math.round(n) % 2 ? -((-v) ** (1 / n)) : v ** (1 / n)
        }
      }
      if (name === 'atan2') return (env) => fromRad(Math.atan2(arg(env), arg(env, 1)))
      if (name === 'mod') return (env) => ((arg(env) % arg(env, 1)) + arg(env, 1)) % arg(env, 1)
      if (name === 'min') return (env) => Math.min(...all(env))
      if (name === 'max') return (env) => Math.max(...all(env))
      if (name === 'hypot') return (env) => Math.hypot(...all(env))
      if (name === 'sum') return (env) => all(env).reduce((a, b) => a + b, 0)
      if (name === 'avg' || name === 'mean') return (env) => all(env).reduce((a, b) => a + b, 0) / args.length
      if (name === 'gcd') return (env) => all(env).reduce(gcd2)
      if (name === 'lcm') return (env) => all(env).reduce((a, b) => Math.abs(Math.round(a) * Math.round(b)) / gcd2(a, b))
      if (name === 'ncr') return (env) => factorial(arg(env)) / (factorial(arg(env, 1)) * factorial(arg(env) - arg(env, 1)))
      if (name === 'npr') return (env) => factorial(arg(env)) / factorial(arg(env) - arg(env, 1))
      throw new Error(`fn:${name}`)
    }
    default:
      throw new Error(`node:${node.type}`)
  }
}

function freeVariables(node, found = new Set()) {
  if (!node || typeof node !== 'object') return found
  if (node.type === 'var') found.add(node.name)
  for (const key of ['left', 'right', 'base', 'exp', 'value']) if (node[key] && typeof node[key] === 'object') freeVariables(node[key], found)
  if (node.args) node.args.forEach((arg) => freeVariables(arg, found))
  if (node.parts) node.parts.forEach((part) => freeVariables(part, found))
  return found
}

const hasOperation = (node) => node && !['num', 'var', 'const', 'unit'].includes(node.type) && !(node.type === 'neg' && node.value.type === 'num')

/** Parses already normalised text; throws when it isn't maths. */
export function parseMath(text, options) {
  return parse(tokenize(text), options)
}

/** A compiled function of one variable, for graphs: `fn(x)`. */
export function compileFunction(text, { angle = 'rad', variable = null } = {}) {
  const tree = parseMath(normalizeMath(text))
  const body = tree.type === 'eq' ? graphBody(tree) : { node: tree, variable: [...freeVariables(tree)][0] ?? 'x' }
  if (!body) return null
  const f = compile(body.node, { angle })
  const name = variable ?? body.variable
  return (x) => f({ [name]: x })
}

/* "y = …", "f(x) = …": the right side as a function of its one variable. */
function graphBody(tree, known = {}) {
  const left = tree.left
  const right = tree.right
  const rightVars = [...freeVariables(right)].filter((name) => !(name in known))
  // y = f(x)
  if (left.type === 'var' && !(left.name in known) && rightVars.length <= 1 && !rightVars.includes(left.name)) return { node: right, variable: rightVars[0] ?? 'x', label: left.name }
  // f(x) = … where f is known: an equation (f(x) = 0), not a new f.
  if (left.type === 'ucall') return null
  // f(x) = …: parsed as f * x
  if (left.type === 'mul' && left.left.type === 'var' && left.right.type === 'var' && !(left.left.name in known) && !(left.right.name in known) && rightVars.length <= 1 && (rightVars[0] ?? left.right.name) === left.right.name) return { node: right, variable: left.right.name, label: `${left.left.name}(${left.right.name})` }
  return null
}

/* ---------- what went wrong (impossible maths) ---------- */

const WIKI = 'https://en.wikipedia.org/wiki/'
/* Each kind of impossible maths and the page that explains it (opened after the explosion). */
export const MATH_ERRORS = {
  'divide-by-zero': `${WIKI}Division_by_zero`,
  'zero-by-zero': `${WIKI}Indeterminate_form`,
  'root-negative': `${WIKI}Square_root#Square_roots_of_negative_and_complex_numbers`,
  'log-domain': `${WIKI}Logarithm#Definition`,
  'arc-domain': `${WIKI}Inverse_trigonometric_functions#Principal_values`,
  'hyperbolic-domain': `${WIKI}Inverse_hyperbolic_functions`,
  'factorial-negative': `${WIKI}Gamma_function#Properties`,
  overflow: `${WIKI}Arithmetic_overflow`,
  undefined: `${WIKI}Defined_and_undefined`,
}

/* The innermost step that can't be done, so the page fits what was typed. */
function diagnose(node, options, env) {
  if (!node || typeof node !== 'object') return null
  for (const key of ['left', 'right', 'base', 'exp', 'value']) {
    const found = node[key] && typeof node[key] === 'object' ? diagnose(node[key], options, env) : null
    if (found) return found
  }
  for (const arg of [...(node.args ?? []), ...(node.parts ?? [])]) {
    const found = diagnose(arg, options, env)
    if (found) return found
  }
  const at = (child) => {
    try {
      return compile(child, options)(env)
    } catch {
      return NaN
    }
  }
  if (node.type === 'div' || node.type === 'mod') {
    if (at(node.right) === 0) return at(node.left) === 0 && node.type === 'div' ? 'zero-by-zero' : 'divide-by-zero'
  }
  if (node.type === 'pow') {
    const base = at(node.base)
    const exponent = at(node.exp)
    if (base === 0 && exponent < 0) return 'divide-by-zero'
    if (base < 0 && !Number.isInteger(exponent) && Number.isNaN(compile(node, options)(env))) return 'root-negative'
  }
  if (node.type === 'call') {
    const a = at(node.args[0])
    const b = node.args[1] ? at(node.args[1]) : null
    if (['sqrt', 'root4'].includes(node.name) && a < 0) return 'root-negative'
    if (['root', 'nthroot'].includes(node.name) && a < 0 && Math.round(b) % 2 === 0) return 'root-negative'
    if (['ln', 'log', 'log2', 'log10', 'lg'].includes(node.name) && (a <= 0 || (b !== null && (b <= 0 || b === 1)))) return b === 1 ? 'divide-by-zero' : 'log-domain'
    if (['asin', 'acos', 'arcsin', 'arccos'].includes(node.name) && Math.abs(options.angle === 'deg' ? a : a) > 1) return 'arc-domain'
    if ((node.name === 'acosh' && a < 1) || (node.name === 'atanh' && Math.abs(a) >= 1)) return 'hyperbolic-domain'
    if (node.name === 'fact' && a < 0 && Number.isInteger(a)) return 'factorial-negative'
    if (['cot', 'csc'].includes(node.name) && Math.abs(Math.sin(options.angle === 'deg' ? (a * Math.PI) / 180 : a)) < 1e-300) return 'divide-by-zero'
  }
  return null
}

/*
 * Where in the typed text the maths broke, as [start, end), for putting the
 * explosion right there: the last (most recently typed) place that matches
 * the kind of fault, or null.
 */
const FAULTS = {
  'divide-by-zero': [/\\frac\s*\{[^{}]*\}\s*\{\s*0+\s*\}/g, /(?:\/|÷|∶|⁄|\div|\bmod|\bmod(?:ulo)?\b|\bdivided\s+by\b|\bover\b)\s*\(?\s*0+(?:[.,]0+)?(?![.,]?\d)/gi, /\b0+\s*\^\s*[({]?\s*-/g],
  'zero-by-zero': [/\\frac\s*\{\s*0+\s*\}\s*\{\s*0+\s*\}/g, /\b0+\s*(?:\/|÷|∶|⁄|\div)\s*\(?\s*0+(?![.,]?\d)/g],
  'root-negative': [/(?:√|∛|∜|\bsqrt|\bcbrt|\broot|\\sqrt(?:\[[^\]]*\])?)\s*[({[]?\s*[-−]\s*[\d.,]*/gi, /\(\s*[-−][^()]*\)\s*\^\s*[({]?\s*[\d.,]*\s*[/.,]\s*\d*/g],
  'log-domain': [/\\?(?:ln|log(?:2|10|_\{?\d+\}?)?|lg)\s*[({]?\s*[-−]?\s*[\d.,]*/gi],
  'arc-domain': [/\\?(?:arc(?:sin|cos)|a(?:sin|cos))\s*[({]?\s*[-−]?\s*[\d.,]*/gi],
  'hyperbolic-domain': [/\\?(?:arc(?:cosh|tanh)|a(?:cosh|tanh))\s*[({]?\s*[-−]?\s*[\d.,]*/gi],
  'factorial-negative': [/\(\s*[-−]\s*[\d.,]+\s*\)\s*!/g, /[-−]\s*\d+\s*!/g],
}
export function faultSpan(text, kind) {
  let best = null
  for (const pattern of FAULTS[kind] ?? []) {
    for (const match of String(text).matchAll(pattern)) {
      const span = [match.index, match.index + match[0].trimEnd().length]
      if (!best || span[0] >= best[0]) best = span
    }
  }
  return best
}

function errorOf(tree, options, env, value) {
  const kind = diagnose(tree, options, env) ?? (value === Infinity || value === -Infinity ? 'overflow' : 'undefined')
  return { kind, url: MATH_ERRORS[kind] }
}

/* ---------- equations ---------- */

function solve(f) {
  const roots = []
  const add = (found, polish = true) => {
    // A few secant steps make the last digits right (bisection alone can stop a little off); not for roots that only touch 0 (x² = 0).
    let x = found
    for (let step = 0, h = 1e-7 * Math.max(1, Math.abs(x)); polish && step < 6; step++) {
      const fx = f(x)
      if (!Number.isFinite(fx) || fx === 0) break
      const slope = (f(x + h) - fx) / h
      if (!Number.isFinite(slope) || slope === 0) break
      const next = x - fx / slope
      if (!Number.isFinite(next) || Math.abs(f(next)) >= Math.abs(fx)) break
      x = next
    }
    if (!Number.isFinite(x)) return
    const fx = f(x)
    if (!Number.isFinite(fx) || Math.abs(fx) > 1e-7 * Math.max(1, Math.abs(x))) return
    if (roots.some((root) => Math.abs(root - x) < 1e-7 * Math.max(1, Math.abs(x)))) return
    roots.push(Math.abs(x) < 1e-12 ? 0 : x)
  }
  const refine = (a, b) => {
    let fa = f(a)
    for (let i = 0; i < 200; i++) {
      const m = (a + b) / 2
      const fm = f(m)
      if (!Number.isFinite(fm)) return null
      if (fm === 0 || b - a < 1e-14 * Math.max(1, Math.abs(m))) return m
      if (Math.sign(fm) === Math.sign(fa)) [a, fa] = [m, fm]
      else b = m
    }
    return (a + b) / 2
  }
  // Several scales: fine near 0, coarse far out.
  for (const [from, to, steps] of [
    [-10, 10, 4000],
    [-100, 100, 4000],
    [-1e4, 1e4, 4000],
  ]) {
    let px = from
    let py = f(px)
    for (let i = 1; i <= steps; i++) {
      const x = from + ((to - from) * i) / steps
      const y = f(x)
      if (Number.isFinite(py) && Number.isFinite(y)) {
        if (py === 0) add(px)
        else if (Math.sign(py) !== Math.sign(y)) {
          const root = refine(px, x)
          if (root !== null) add(root)
        } else if (Math.abs(y) < 1e-3 && Math.abs(y) < Math.abs(py)) {
          // Touching zero without crossing (x² = 0): look closer around the dip.
          let a = px
          let b = x + (to - from) / steps
          for (let k = 0; k < 80; k++) {
            const m1 = a + (b - a) / 3
            const m2 = b - (b - a) / 3
            if (Math.abs(f(m1)) < Math.abs(f(m2))) b = m2
            else a = m1
          }
          add((a + b) / 2, false)
        }
      }
      px = x
      py = y
    }
    if (roots.length) break
  }
  // Periodic ones: the solutions closest to 0.
  return roots.sort((a, b) => Math.abs(a) - Math.abs(b) || a - b).slice(0, 6).sort((a, b) => a - b)
}

/* ---------- units ---------- */

/*
 * Each unit: dimension, id, factor to the base unit (temperatures: offset),
 * symbols and abbreviations (the same in every language; the first one is
 * shown). Its names in words ("kilometre, kilometres") come from the locale
 * file calc.json (`units.<dimension>.<id>`), English plus the visitor's
 * language, so every language can add its own. Names are matched exactly
 * first (MB vs Mb), then without case.
 */
const UNIT_LIST = [
  ['length', 'nm', 1e-09, ['nm']],
  ['length', 'um', 1e-06, ['µm', 'μm', 'um']],
  ['length', 'mm', 0.001, ['mm']],
  ['length', 'cm', 0.01, ['cm']],
  ['length', 'dm', 0.1, ['dm']],
  ['length', 'm', 1, ['m', 'mtr', 'mtrs']],
  ['length', 'km', 1000, ['km', 'kms']],
  ['length', 'in', 0.0254, ['in', '"', '″']],
  ['length', 'ft', 0.3048, ['ft', '\'', '′']],
  ['length', 'yd', 0.9144, ['yd']],
  ['length', 'mi', 1609.344, ['mi']],
  ['length', 'nmi', 1852, ['nmi']],
  ['length', 'au', 149597870700, ['au']],
  ['length', 'ly', 9460730472580800, ['ly']],
  ['length', 'pc', 30856775814913670, ['pc']],
  ['time', 'ns', 1e-09, ['ns']],
  ['time', 'us', 1e-06, ['µs', 'μs', 'us']],
  ['time', 'ms', 0.001, ['ms', 'msec', 'msecs']],
  ['time', 's', 1, ['s', 'sec', 'secs']],
  ['time', 'min', 60, ['min', 'mins']],
  ['time', 'h', 3600, ['h', 'hr', 'hrs']],
  ['time', 'd', 86400, ['d', 'day']],
  ['time', 'wk', 604800, ['wk', 'wks']],
  ['time', 'mo', 2629800, ['mo', 'mon']],
  ['time', 'y', 31557600, ['y', 'yr', 'yrs', 'a']],
  ['time', 'decade', 315576000, ['decade']],
  ['time', 'century', 3155760000, ['century']],
  ['mass', 'ug', 1e-09, ['µg', 'μg', 'ug']],
  ['mass', 'mg', 1e-06, ['mg']],
  ['mass', 'g', 0.001, ['g', 'gr']],
  ['mass', 'kg', 1, ['kg', 'kgs']],
  ['mass', 't', 1000, ['t', 'ton']],
  ['mass', 'oz', 0.028349523125, ['oz']],
  ['mass', 'lb', 0.45359237, ['lb', 'lbs']],
  ['mass', 'st', 6.35029318, ['st']],
  ['temperature', 'degc', [1, 273.15], ['°c', 'c', 'degc', '℃']],
  ['temperature', 'degf', [0.5555555555555556, 255.3722222222222], ['°f', 'f', 'degf', '℉']],
  ['temperature', 'k', [1, 0], ['k']],
  ['area', 'mm2', 1e-06, ['mm²', 'mm2', 'mm^2', 'sq mm']],
  ['area', 'cm2', 0.0001, ['cm²', 'cm2', 'cm^2', 'sq cm']],
  ['area', 'm2', 1, ['m²', 'm2', 'm^2', 'sqm', 'sq m']],
  ['area', 'km2', 1000000, ['km²', 'km2', 'km^2', 'sq km']],
  ['area', 'ha', 10000, ['ha']],
  ['area', 'are', 100, ['are']],
  ['area', 'ac', 4046.8564224, ['ac']],
  ['area', 'ft2', 0.09290304, ['ft²', 'ft2', 'ft^2', 'sq ft', 'sqft']],
  ['area', 'in2', 0.00064516, ['in²', 'in2', 'in^2', 'sq in']],
  ['area', 'mi2', 2589988.110336, ['mi²', 'mi2', 'mi^2', 'sq mi']],
  ['volume', 'ml', 1e-06, ['ml', 'mL', 'cm³', 'cm3', 'cc']],
  ['volume', 'cl', 1e-05, ['cl']],
  ['volume', 'dl', 0.0001, ['dl']],
  ['volume', 'l', 0.001, ['l', 'L', 'ltr', 'dm³', 'dm3']],
  ['volume', 'm3', 1, ['m³', 'm3', 'm^3', 'cbm']],
  ['volume', 'gal', 0.003785411784, ['gal']],
  ['volume', 'imperial_gallon', 0.00454609, ['imperial gallon']],
  ['volume', 'qt', 0.000946352946, ['qt']],
  ['volume', 'pt', 0.000473176473, ['pt']],
  ['volume', 'cup', 0.0002365882365, ['cup']],
  ['volume', 'fl_oz', 2.95735295625e-05, ['fl oz', 'floz']],
  ['volume', 'tbsp', 1.478676478125e-05, ['tbsp']],
  ['volume', 'tsp', 4.92892159375e-06, ['tsp']],
  ['volume', 'in3', 1.6387064e-05, ['in³', 'in3']],
  ['volume', 'ft3', 0.028316846592, ['ft³', 'ft3']],
  ['speed', 'm_per_s', 1, ['m/s', 'mps']],
  ['speed', 'km_per_h', 0.2777777777777778, ['km/h', 'kmh', 'kph', 'kmph', 'km/hr', 'kmh']],
  ['speed', 'mph', 0.44704, ['mph', 'mi/h']],
  ['speed', 'kn', 0.514444444, ['kn', 'kt', 'kts']],
  ['speed', 'ft_per_s', 0.3048, ['ft/s', 'fps']],
  ['speed', 'c', 299792458, ['c']],
  ['speed', 'mach', 343, ['mach']],
  ['data', 'bit', 1, ['bit', 'b']],
  ['data', 'B', 8, ['B']],
  ['data', 'kbit', 1000, ['kbit', 'kb', 'kbits']],
  ['data', 'Mbit', 1000000, ['Mbit', 'Mb', 'mbit', 'mbits']],
  ['data', 'Gbit', 1000000000, ['Gbit', 'Gb', 'gbit', 'gbits']],
  ['data', 'kB', 8000, ['kB', 'KB', 'kbyte', 'kbytes']],
  ['data', 'MB', 8000000, ['MB', 'mbyte', 'mbytes']],
  ['data', 'GB', 8000000000, ['GB', 'gbyte', 'gbytes']],
  ['data', 'TB', 8000000000000, ['TB']],
  ['data', 'PB', 8000000000000000, ['PB']],
  ['data', 'KiB', 8192, ['KiB', 'kib']],
  ['data', 'MiB', 8388608, ['MiB', 'mib']],
  ['data', 'GiB', 8589934592, ['GiB', 'gib']],
  ['data', 'TiB', 8796093022208, ['TiB', 'tib']],
  ['rate', 'bit_per_s', 1, ['bit/s', 'bps']],
  ['rate', 'kbit_per_s', 1000, ['kbit/s', 'kbps', 'kb/s']],
  ['rate', 'Mbit_per_s', 1000000, ['Mbit/s', 'mbit/s', 'mbps', 'Mbps', 'Mb/s']],
  ['rate', 'Gbit_per_s', 1000000000, ['Gbit/s', 'gbit/s', 'gbps', 'Gbps', 'Gb/s']],
  ['rate', 'MB_per_s', 8000000, ['MB/s', 'mbyte/s']],
  ['rate', 'kB_per_s', 8000, ['kB/s', 'KB/s']],
  ['rate', 'GB_per_s', 8000000000, ['GB/s']],
  ['angle', 'deg', 0.017453292519943295, ['°', 'deg']],
  ['angle', 'rad', 1, ['rad']],
  ['angle', 'gon', 0.015707963267948967, ['gon']],
  ['angle', 'turn', 6.283185307179586, ['turn', 'rev']],
  ['angle', 'arcmin', 0.0002908882086657216, ['arcmin']],
  ['angle', 'arcsec', 4.84813681109536e-06, ['arcsec']],
  ['pressure', 'pa', 1, ['pa', 'Pa']],
  ['pressure', 'hpa', 100, ['hpa', 'hPa']],
  ['pressure', 'kpa', 1000, ['kpa', 'kPa']],
  ['pressure', 'bar', 100000, ['bar']],
  ['pressure', 'atm', 101325, ['atm']],
  ['pressure', 'psi', 6894.757293168, ['psi', 'lbf/in²']],
  ['pressure', 'mmhg', 133.322387415, ['mmhg', 'mmHg']],
  ['energy', 'j', 1, ['j', 'J']],
  ['energy', 'kj', 1000, ['kj', 'kJ']],
  ['energy', 'cal', 4.184, ['cal']],
  ['energy', 'kcal', 4184, ['kcal', 'Cal']],
  ['energy', 'wh', 3600, ['wh', 'Wh']],
  ['energy', 'kwh', 3600000, ['kwh', 'kWh']],
  ['energy', 'ev', 1.602176634e-19, ['ev', 'eV']],
  ['energy', 'btu', 1055.05585262, ['btu', 'BTU']],
  ['power', 'w', 1, ['w', 'W']],
  ['power', 'kw', 1000, ['kw', 'kW']],
  ['power', 'mw', 1000000, ['mw', 'MW']],
  ['power', 'hp', 745.69987158227, ['hp']],
  ['power', 'ps', 735.49875, ['ps', 'PS']],
  ['frequency', 'hz', 1, ['hz', 'Hz']],
  ['frequency', 'khz', 1000, ['khz', 'kHz']],
  ['frequency', 'mhz', 1000000, ['mhz', 'MHz']],
  ['frequency', 'ghz', 1000000000, ['ghz', 'GHz']],
  ['frequency', 'rpm', 0.016666666666666666, ['rpm']],
  ['force', 'n', 1, ['n', 'N']],
  ['force', 'kn', 1000, ['kn', 'kN']],
  ['force', 'lbf', 4.4482216152605, ['lbf']],
  ['current', 'A', 1, ['A']],
  ['current', 'mA', 1e-3, ['mA']],
  ['voltage', 'V', 1, ['V']],
  ['voltage', 'kV', 1e3, ['kV']],
  ['voltage', 'mV', 1e-3, ['mV']],
  ['amount', 'mol', 1, ['mol']],
  ['amount', 'mmol', 1e-3, ['mmol']],
  ['torque', 'nm', 1, ['N·m', 'Nm', 'N*m', 'N-m', 'N m']],
  ['torque', 'knm', 1000, ['kN·m', 'kNm', 'kN*m', 'kN-m']],
  ['torque', 'lbft', 1.3558179483314004, ['lb·ft', 'lbft', 'lb-ft', 'lb*ft', 'lbf·ft', 'lbfft', 'lbf-ft', 'ft·lb', 'ftlb', 'ft-lb', 'ft·lbf', 'ft-lbf']],
  ['torque', 'lbin', 0.1129848290276167, ['lb·in', 'lbin', 'lb-in', 'lbf·in', 'lbf-in', 'in·lb', 'inlb', 'in-lb']],
  ['torque', 'kgfm', 9.80665, ['kgf·m', 'kgfm', 'kgf-m', 'kp·m', 'kpm']],
  ['density', 'kgm3', 1, ['kg/m³', 'kg/m3', 'kg/m^3']],
  ['density', 'gcm3', 1000, ['g/cm³', 'g/cm3', 'g/cm^3', 'g/cc', 'g/ml', 'g/mL']],
  ['density', 'gl', 1, ['g/l', 'g/L']],
  ['density', 'kgl', 1000, ['kg/l', 'kg/L', 'kg/dm³', 'kg/dm3']],
  ['density', 'lbft3', 16.018463373960138, ['lb/ft³', 'lb/ft3', 'lb/ft^3', 'lb/cu ft']],
  ['density', 'lbin3', 27679.904710203125, ['lb/in³', 'lb/in3', 'lb/in^3']],
  ['density', 'lbgal', 119.82642731689663, ['lb/gal']],
  // CSS: 1in = 96px = 72pt; em / rem at the browser's 16px.
  ['typography', 'px', 1, ['px', 'pixel', 'pixels']],
  ['typography', 'point', 4 / 3, ['typo-pt']],
  ['typography', 'pica', 16, ['pica', 'picas']],
  ['typography', 'rem', 16, ['rem']],
  ['typography', 'em', 16, ['em']],
]

/* A few names stand for two units (1m: metres or minutes). Shown both ways. */
const AMBIGUOUS = { m: ['m', 'min'], b: ['bit', 'B'], c: ['°c', 'c'], kn: ['kn', 'kN'], t: ['t', 'tonne'], mb: ['MB', 'Mbit'], gb: ['GB', 'Gbit'], kb: ['kB', 'kbit'], grad: ['°', 'gon'], pt: ['pt', 'typo-pt'], pts: ['pt', 'typo-pt'] }

const UNITS = UNIT_LIST.map(([dimension, id, factor, names]) => ({ dimension, id, factor: Array.isArray(factor) ? factor[0] : factor, offset: Array.isArray(factor) ? factor[1] : 0, names, symbol: names[0] }))
let EXACT = new Map()
let LOWER = new Map()
function indexUnits(words = {}) {
  EXACT = new Map()
  LOWER = new Map()
  const add = (name, unit) => {
    if (!name) return
    if (!EXACT.has(name)) EXACT.set(name, unit)
    const lower = name.toLocaleLowerCase()
    if (!LOWER.has(lower)) LOWER.set(lower, unit)
  }
  // Symbols first (they win a clash), then the words of each language.
  for (const unit of UNITS) for (const name of unit.names) add(name, unit)
  for (const unit of UNITS) for (const name of words[unit.dimension]?.[unit.id] ?? []) add(name, unit)
}
indexUnits()
// Symbols shown in results (nicer than the first alias in some cases).
const SHOW = { 'typo-pt': 'pt', '°c': '°C', '°f': '°F', k: 'K', '°': '°', l: 'L', B: 'B', bit: 'bit', 'm²': 'm²', 'm³': 'm³', j: 'J', w: 'W', hz: 'Hz', n: 'N', pa: 'Pa', ev: 'eV', wh: 'Wh', kwh: 'kWh', kj: 'kJ', kw: 'kW', mw: 'MW', khz: 'kHz', mhz: 'MHz', ghz: 'GHz', hpa: 'hPa', kpa: 'kPa', mmhg: 'mmHg', btu: 'BTU' }
// The proper spelling to show: kN (not kn, which is knots), Pa, Hz.
const symbolOf = (unit) => SHOW[unit.symbol] ?? unit.names.find((name) => name !== unit.symbol && name.toLowerCase() === unit.symbol.toLowerCase() && /[A-Z]/.test(name)) ?? unit.symbol
const unitGap = (unit) => (['°', "'", '"', '′', '″'].includes(symbolOf(unit)) ? '' : ' ')

/** The units a name may mean (most likely first), [] when none. */
function unitsFor(raw) {
  const name = String(raw ?? '').trim().replace(/\.$/, '').replace(/\s+/g, ' ')
  if (!name) return []
  const lower = name.toLocaleLowerCase()
  const found = []
  const push = (unit) => unit && !found.includes(unit) && found.push(unit)
  if (AMBIGUOUS[lower] && !(lower === 'mb' && name === 'MB') && !(lower === 'b' && name === 'B') && !(lower === 'gb' && name === 'GB') && !(lower === 'kb' && (name === 'kB' || name === 'KB'))) for (const alias of AMBIGUOUS[lower]) push(EXACT.get(alias) ?? LOWER.get(alias))
  push(EXACT.get(name))
  // Written exactly (KB, MB, Pa): that unit, not others that only match without case (kbit).
  if (!found.length) push(LOWER.get(lower))
  // "degrees celsius", "2 kilometers" plural / spelling slips: drop a final s.
  if (!found.length && lower.endsWith('s')) push(LOWER.get(lower.slice(0, -1)))
  return found
}

function convert(value, from, to) {
  if (from.dimension === 'temperature') {
    const kelvin = from.symbol === '°c' ? value + 273.15 : from.symbol === '°f' ? ((value - 32) * 5) / 9 + 273.15 : value
    return to.symbol === '°c' ? kelvin - 273.15 : to.symbol === '°f' ? ((kelvin - 273.15) * 9) / 5 + 32 : kelvin
  }
  return (value * from.factor) / to.factor
}

/* What a dimension is shown in when no target was given (the ones that fit best first). */
const SUGGEST = {
  length: ['mm', 'cm', 'm', 'km', 'in', 'ft', 'yd', 'mi'],
  time: ['ms', 's', 'min', 'h', 'd', 'wk', 'mo', 'y'],
  mass: ['mg', 'g', 'kg', 't', 'oz', 'lb', 'st'],
  temperature: ['°c', '°f', 'k'],
  area: ['cm²', 'm²', 'ha', 'km²', 'ft²', 'ac', 'mi²'],
  volume: ['ml', 'l', 'm³', 'tsp', 'tbsp', 'cup', 'fl oz', 'gal'],
  speed: ['m/s', 'km/h', 'mph', 'kn'],
  data: ['bit', 'B', 'kB', 'MB', 'GB', 'TB', 'KiB', 'MiB', 'GiB', 'Mbit'],
  rate: ['kbit/s', 'Mbit/s', 'Gbit/s', 'MB/s'],
  angle: ['°', 'rad', 'gon', 'turn'],
  pressure: ['Pa', 'hPa', 'bar', 'psi', 'atm', 'mmHg'],
  energy: ['J', 'kJ', 'cal', 'kcal', 'Wh', 'kWh'],
  power: ['W', 'kW', 'hp', 'PS'],
  frequency: ['Hz', 'kHz', 'MHz', 'GHz', 'rpm'],
  force: ['N', 'kN', 'lbf'],
  current: ['mA', 'A'],
  voltage: ['mV', 'V', 'kV'],
  amount: ['mmol', 'mol'],
  torque: ['N·m', 'lb·ft', 'lb·in', 'kgf·m'],
  density: ['kg/m³', 'g/cm³', 'g/l', 'lb/ft³'],
  typography: ['px', 'typo-pt', 'rem', 'pica'],
}

// Arrows and LaTeX arrows work in every language; the words ("in", "to") come from the language packs.
const CONVERT_ARROWS = String.raw`\\to\b|\\rightarrow\b|\\Rightarrow\b|\\mapsto\b|->|=>|-->|==>|→|⟶|⇒|⟹|➔|➜|➝|➞|➡|⇨|⇾|↦|⟼|⇢|⤍|⤏|↠|»`
const convertPattern = (words) => {
  const named = wordPattern(words)
  return new RegExp(String.raw`\s*(?:${CONVERT_ARROWS}${named ? `|${named.source}` : ''})\s*`, 'giu')
}
let CONVERT_WORDS = convertPattern([])

/* "1h 30min", "5'11\"", "3 km", "(2+3) kg": a sum of value-unit parts of one dimension. */
function readQuantity(text, options) {
  const source = text.trim()
  if (!source) return null
  // Compound: number unit number unit …
  const parts = [...source.matchAll(/(-?\d+(?:[.,]\d+)?(?:e[-+]?\d+)?)\s*([A-Za-zµμ°'"″′²³/^\d ]*?[A-Za-zµμ°'"″′²³])(?=\s*-?\d|\s*$)/g)]
  if (parts.length > 1 && parts.map((part) => part[0]).join('').replace(/\s/g, '') === source.replace(/\s/g, '')) {
    const readings = parts.map((part) => unitsFor(part[2]))
    if (readings.every((list) => list.length)) {
      for (const first of readings[0]) {
        const units = readings.map((list) => list.find((unit) => unit.dimension === first.dimension && unit.dimension !== 'temperature'))
        if (units.every(Boolean)) {
          const base = parts.reduce((sum, part, index) => sum + Number(part[1].replace(',', '.')) * units[index].factor, 0)
          return [{ value: base / units[0].factor, unit: units[0], label: source }]
        }
      }
    }
  }
  // value + unit: the longest ending that is a unit, the rest a number expression.
  const match = /^(.*?)\s*((?:[A-Za-zµμ°℃℉'"″′][A-Za-zµμ°'"″′²³/^ \d·*-]*?)|[°'"″′])\s*$/.exec(source)
  if (!match) return null
  let [, amount, name] = match
  // Try shorter unit names (the end of "2 square meters", "5 sq ft").
  const candidates = [name]
  const words = name.split(' ')
  for (let i = 1; i < words.length; i++) candidates.push(words.slice(i).join(' '))
  for (const candidate of candidates) {
    const units = unitsFor(candidate)
    if (!units.length) continue
    const rest = `${amount} ${name.slice(0, name.length - candidate.length)}`.trim()
    let value = 1
    if (rest) {
      try {
        const tree = parseMath(normalizeMath(rest))
        if (freeVariables(tree).size || tree.type === 'eq') continue
        value = compile(tree, options)()
      } catch {
        continue
      }
    }
    if (!Number.isFinite(value)) continue
    return units.map((unit) => ({ value, unit, label: `${formatNumber(value, { locale: options.locale })}${unitGap(unit)}${symbolOf(unit)}` }))
  }
  return null
}

function conversions(input, options) {
  const text = String(input ?? '')
    .replace(/\^\s*\{?\s*\\circ\s*\}?/g, '°')
    .replace(/\\(?:text|mathrm|operatorname)\s*\{([^{}]*)\}/g, '$1')
    .replace(/\\[,;:!]|~/g, ' ')
    .trim()
  if (!/[A-Za-zµμ°℃℉'"″′]/.test(text) || !/\d/.test(text) || text.length > 120) return null
  // "x to y": the last keyword whose right side is a unit (or a list of units).
  const splits = [...text.matchAll(CONVERT_WORDS)]
  for (let i = splits.length - 1; i >= 0; i--) {
    const at = splits[i].index
    const left = text.slice(0, at)
    const right = text.slice(at + splits[i][0].length)
    const and = wordPattern(LANGUAGE.and)
    const targets = right.split(new RegExp(String.raw`\s*(?:,|&|\+${and ? `|${and.source}` : ''})\s*`, 'iu')).map((name) => unitsFor(name))
    if (!left.trim() || !targets.length || targets.some((list) => !list.length)) continue
    const quantities = readQuantity(left, options)
    if (!quantities) continue
    const rows = []
    for (const quantity of quantities) {
      for (const list of targets) {
        const target = list.find((unit) => unit.dimension === quantity.unit.dimension)
        if (!target) continue
        const value = convert(quantity.value, quantity.unit, target)
        rows.push({ value, text: `${quantity.label} = ${formatNumber(value, { locale: options.locale })}${unitGap(target)}${symbolOf(target)}`, copy: formatNumber(value, { plain: true }), hint: dimensionName(quantity.unit.dimension) })
      }
    }
    if (rows.length) return rows
  }
  // No target: everything that fits, in sizes that read well.
  const quantities = readQuantity(text, options)
  if (!quantities) return null
  const rows = []
  const groups = []
  for (const quantity of quantities) {
    const list = (SUGGEST[quantity.unit.dimension] ?? [])
      .map((name) => EXACT.get(name) ?? LOWER.get(name.toLowerCase()))
      .filter((unit) => unit && unit !== quantity.unit)
      .map((unit) => ({ unit, value: convert(quantity.value, quantity.unit, unit) }))
    // Numbers between 0.01 and 100 000 read best; the others go to the end.
    const fit = (value) => {
      const abs = Math.abs(value)
      return quantity.unit.dimension === 'temperature' || (abs >= 0.01 && abs < 1e5) ? 0 : 1
    }
    const good = list.filter((entry) => !fit(entry.value))
    const shown = (good.length >= 2 ? good : list).slice(0, quantities.length > 1 ? 4 : 7)
    groups.push(shown.map(({ unit, value }) => ({ value, text: `${quantity.label} = ${formatNumber(value, { locale: options.locale })}${unitGap(unit)}${symbolOf(unit)}`, copy: formatNumber(value, { plain: true }), hint: dimensionName(quantity.unit.dimension) })))
  }
  // "1m": metres and minutes take turns, so both readings are on top.
  for (let i = 0; i < Math.max(0, ...groups.map((group) => group.length)); i++) for (const group of groups) if (group[i]) rows.push(group[i])
  return rows.length ? rows : null
}

const dimensionName = (dimension) => LANGUAGE.dimensions[dimension] ?? dimension

/* ---------- physical quantities: 300 m / 12 s = 25 m/s ---------- */

/*
 * A quantity is { v (in SI units), d (exponents of the base dimensions
 * below), unit (how it was written, for showing it the same way) }. Only used
 * when a statement has units in it (⟦…⟧ after normalizeMath).
 */
const BASE = ['m', 's', 'kg', 'K', 'A', 'mol', 'bit']
const ZERO = [0, 0, 0, 0, 0, 0, 0]
const vec = (entries) => BASE.map((_, index) => entries[index] ?? 0)
const DIMENSION_VECTORS = {
  length: vec([1]),
  time: vec([0, 1]),
  mass: vec([0, 0, 1]),
  temperature: vec([0, 0, 0, 1]),
  current: vec([0, 0, 0, 0, 1]),
  amount: vec([0, 0, 0, 0, 0, 1]),
  data: vec([0, 0, 0, 0, 0, 0, 1]),
  area: vec([2]),
  volume: vec([3]),
  speed: vec([1, -1]),
  rate: vec([0, -1, 0, 0, 0, 0, 1]),
  angle: ZERO,
  pressure: vec([-1, -2, 1]),
  energy: vec([2, -2, 1]),
  power: vec([2, -3, 1]),
  frequency: vec([0, -1]),
  force: vec([1, -2, 1]),
  voltage: vec([2, -3, 1, 0, -1]),
}
class DimError extends Error {}
const quantityOf = (v, d = ZERO, unit = null) => ({ v, d, unit })
export const isQuantity = (value) => Boolean(value && typeof value === 'object' && Array.isArray(value.d))
const asQuantity = (value) => (isQuantity(value) ? value : quantityOf(Number(value)))
const sameDims = (a, b) => a.every((n, index) => Math.abs(n - b[index]) < 1e-9)
const dimless = (d) => d.every((n) => Math.abs(n) < 1e-9)
const addDims = (a, b, times = 1) => a.map((n, index) => n + b[index] * times)

const SUPER = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '.': '·' }
const sup = (n) => [...String(n)].map((char) => SUPER[char] ?? char).join('')

/** "m/s^2", "kg \cdot m^2/s^2", "km/h", "m²": { factor (to SI), dims, label }, or null. */
function unitExpression(raw) {
  const text = String(raw ?? '')
    .replace(/\\cdot|·|\*|\\,|\\ /g, ' ')
    .replace(/\^\s*\{?\s*(-?\d+)\s*\}?/g, '^$1')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/[{}]/g, '')
    .trim()
  if (!text || text.length > 40) return null
  const [top, ...bottoms] = text.split('/')
  let factor = 1
  let dims = ZERO
  const labels = { top: [], bottom: [] }
  const apply = (side, sign) => {
    const pieces = side.replace(/[()]/g, ' ').trim().split(/\s+/).filter(Boolean)
    if (!pieces.length) return sign > 0 && top.trim() === ''
    for (const piece of pieces) {
      if (piece === '1') continue
      const match = /^([A-Za-zµμΩ°]+)(?:\^(-?\d+))?$/.exec(piece)
      if (!match) return false
      const unit = (EXACT.get(match[1]) && [EXACT.get(match[1])]) || unitsFor(match[1])
      const found = (Array.isArray(unit) ? unit : [unit]).find((entry) => entry && DIMENSION_VECTORS[entry.dimension])
      if (!found) return false
      const power = Number(match[2] ?? 1) * sign
      factor *= found.factor ** power
      dims = addDims(dims, DIMENSION_VECTORS[found.dimension], power)
      const shown = `${symbolOf(found)}${Math.abs(power) === 1 ? '' : sup(Math.abs(power))}`
      ;(power > 0 ? labels.top : labels.bottom).push(shown)
    }
    return true
  }
  if (!apply(top, 1)) return null
  for (const bottom of bottoms) if (!apply(bottom, -1)) return null
  const label = `${labels.top.join('·') || '1'}${labels.bottom.length ? `/${labels.bottom.length > 1 ? `(${labels.bottom.join('·')})` : labels.bottom[0]}` : ''}`
  return { factor, dims, label }
}

let NAMED = null
const namedUnits = () => (NAMED ??= ['m', 's', 'kg', 'K', 'A', 'mol', 'bit', 'm^2', 'm^3', 'm/s', 'm/s^2', 'N', 'J', 'W', 'Pa', 'Hz', 'V', 'kg/m^3'].map(unitExpression).filter(Boolean))
function composedUnit(d) {
  const top = []
  const bottom = []
  // kg·m/s², the usual order.
  ;[2, 0, 1, 3, 4, 5, 6].forEach((index) => {
    const n = d[index]
    if (Math.abs(n) < 1e-9) return
    const power = Math.round(Math.abs(n) * 100) / 100
    ;(n > 0 ? top : bottom).push(`${BASE[index]}${power === 1 ? '' : sup(power)}`)
  })
  return { factor: 1, dims: d, label: `${top.join('·') || '1'}${bottom.length ? `/${bottom.length > 1 ? `(${bottom.join('·')})` : bottom[0]}` : ''}` }
}
function pickUnit(q, literals) {
  if (q.unit && sameDims(q.unit.dims, q.d)) return q.unit
  const literal = [...literals].reverse().find((unit) => sameDims(unit.dims, q.d))
  return literal ?? namedUnits().find((unit) => sameDims(unit.dims, q.d)) ?? composedUnit(q.d)
}

function qcompile(node, options) {
  const c = (child) => qcompile(child, options)
  switch (node.type) {
    case 'num':
      return () => quantityOf(node.value)
    case 'const':
      return () => quantityOf(CONSTANTS[node.name])
    case 'var':
      return (env) => asQuantity(env && node.name in env ? env[node.name] : NaN)
    case 'unit':
      return () => quantityOf(node.unit.factor, node.unit.dims, node.unit)
    case 'neg': {
      const f = c(node.value)
      return (env) => {
        const q = f(env)
        return quantityOf(-q.v, q.d, q.unit)
      }
    }
    case 'pct': {
      const f = c(node.value)
      return (env) => {
        const q = f(env)
        return quantityOf(q.v / 100, q.d, q.unit)
      }
    }
    case 'deg': {
      const f = c(node.value)
      return (env) => {
        const q = f(env)
        return quantityOf(options.angle === 'deg' ? q.v : (q.v * Math.PI) / 180, q.d)
      }
    }
    case 'add':
    case 'sub': {
      const a = c(node.left)
      const b = c(node.right)
      return (env) => {
        let x = a(env)
        let y = b(env)
        // "1,3 m + 1,2": a bare number next to a quantity is taken in its unit.
        if (dimless(x.d) && !dimless(y.d)) x = quantityOf(x.v * (y.unit?.factor ?? 1), y.d)
        if (dimless(y.d) && !dimless(x.d)) y = quantityOf(y.v * (x.unit?.factor ?? 1), x.d)
        if (!sameDims(x.d, y.d)) throw new DimError()
        return quantityOf(node.type === 'add' ? x.v + y.v : x.v - y.v, x.d, x.unit ?? y.unit)
      }
    }
    case 'mul':
    case 'div': {
      const a = c(node.left)
      const b = c(node.right)
      return (env) => {
        const x = a(env)
        const y = b(env)
        const times = node.type === 'mul' ? 1 : -1
        const d = addDims(x.d, y.d, times)
        const unit = dimless(y.d) ? x.unit : dimless(x.d) && node.type === 'mul' ? y.unit : null
        return quantityOf(node.type === 'mul' ? x.v * y.v : x.v / y.v, d, unit && sameDims(unit.dims, d) ? unit : null)
      }
    }
    case 'mod': {
      const a = c(node.left)
      const b = c(node.right)
      return (env) => {
        const x = a(env)
        const y = b(env)
        if (!sameDims(x.d, y.d)) throw new DimError()
        return quantityOf(((x.v % y.v) + y.v) % y.v, x.d, x.unit)
      }
    }
    case 'pow': {
      const a = c(node.base)
      const b = c(node.exp)
      const scalar = compile({ type: 'pow', base: { type: 'var', name: '__a' }, exp: { type: 'var', name: '__b' } }, options)
      return (env) => {
        const x = a(env)
        const y = b(env)
        if (!dimless(y.d)) throw new DimError()
        return quantityOf(scalar({ __a: x.v, __b: y.v }), x.d.map((n) => n * y.v))
      }
    }
    case 'call': {
      const args = node.args.map(c)
      const scalar = compile({ type: 'call', name: node.name, args: node.args.map((_, index) => ({ type: 'var', name: `__a${index}` })) }, options)
      const root = { sqrt: 2, cbrt: 3, root4: 4 }[node.name]
      return (env) => {
        const values = args.map((f) => f(env))
        const inputs = Object.fromEntries(values.map((q, index) => [`__a${index}`, q.v]))
        if (root) return quantityOf(scalar(inputs), values[0].d.map((n) => n / root))
        if ((node.name === 'root' || node.name === 'nthroot') && dimless(values[1]?.d ?? ZERO)) return quantityOf(scalar(inputs), values[0].d.map((n) => n / values[1].v))
        if (node.name === 'abs') return quantityOf(Math.abs(values[0].v), values[0].d, values[0].unit)
        if (['min', 'max', 'avg', 'mean', 'sum'].includes(node.name) && values.every((q) => sameDims(q.d, values[0].d))) return quantityOf(scalar(inputs), values[0].d, values[0].unit)
        if (values.some((q) => !dimless(q.d))) throw new DimError()
        return quantityOf(scalar(inputs))
      }
    }
    case 'ucall': {
      const args = node.args.map(c)
      const fn = options.functions?.[node.name]
      return (env) => {
        const values = args.map((f) => f(env))
        if (!fn || values.some((q) => !dimless(q.d))) throw new DimError()
        return quantityOf(fn(...values.map((q) => q.v)))
      }
    }
    default:
      throw new DimError()
  }
}

function unitLiterals(node, found = []) {
  if (!node || typeof node !== 'object') return found
  if (node.type === 'unit') found.push(node.unit)
  for (const key of ['left', 'right', 'base', 'exp', 'value']) if (node[key] && typeof node[key] === 'object') unitLiterals(node[key], found)
  for (const child of [...(node.args ?? []), ...(node.parts ?? [])]) unitLiterals(child, found)
  return found
}
const hasUnits = (node) => unitLiterals(node).length > 0
function numbersIn(node) {
  if (!node || typeof node !== 'object') return false
  if (node.type === 'num' || node.type === 'const') return true
  // (Exponents don't count: s^2 in a unit.)
  return ['left', 'right', 'base', 'value'].some((key) => node[key] && typeof node[key] === 'object' && numbersIn(node[key])) || [...(node.args ?? []), ...(node.parts ?? [])].some(numbersIn)
}

/* How exact a written number is: 3,997 is ±0.0005, 25 m² ±0.5 m² (in SI). */
function literalTolerance(node) {
  if (!node) return null
  if (node.type === 'num') return node.decimals === undefined ? null : 0.5 * 10 ** -node.decimals
  if (node.type === 'neg') return literalTolerance(node.value)
  if (node.type === 'mul' && node.left.type === 'num' && node.right.type === 'unit') return literalTolerance(node.left) * node.right.unit.factor
  if (node.type === 'mul' && node.left.type === 'num' && node.right.type === 'pow' && node.right.base.type === 'unit' && node.right.exp.type === 'num') return literalTolerance(node.left) * node.right.base.unit.factor ** node.right.exp.value
  return null
}

const NEGATED = { '=': '≠', '≈': '≉', '<': '≮', '>': '≯', '≤': '≰', '≥': '≱', '≠': '=' }

/* Does `a op b` hold? Written numbers count as rounded to their last digit (3,997 = 3,99726… ✓, 25 ≈ 25,175 ✓). */
function relationHolds(op, a, b, nodeA, nodeB, literals) {
  let x = a
  let y = b
  if (!sameDims(a.d, b.d)) {
    if (dimless(a.d)) x = quantityOf(a.v * pickUnit(b, literals).factor, b.d)
    else if (dimless(b.d)) y = quantityOf(b.v * pickUnit(a, literals).factor, a.d)
    else return { ok: op === '≠' }
  }
  const decimalsOf = (node) => (node?.type === 'num' ? node.decimals : node?.type === 'mul' && node.left.type === 'num' ? node.left.decimals : node?.type === 'neg' ? decimalsOf(node.value) : undefined)
  // "=" only forgives rounding of numbers written with decimals; "≈" also of whole ones.
  const tolerance = Math.max(...[nodeA, nodeB].map((node) => (op === '≈' || decimalsOf(node) > 0 ? (literalTolerance(node) ?? 0) : 0)))
  const diff = x.v - y.v
  const exact = Math.abs(diff) <= 1e-9 * Math.max(1, Math.abs(x.v), Math.abs(y.v))
  const within = tolerance > 0 && Math.abs(diff) <= tolerance * (1 + 1e-9)
  switch (op) {
    case '=':
      return { ok: exact || within, rounded: !exact && within }
    case '≈':
      return { ok: exact || within || (tolerance === 0 && Math.abs(diff) <= 0.01 * Math.max(Math.abs(x.v), Math.abs(y.v))), rounded: true }
    case '≠':
      return { ok: !exact }
    case '<':
      return { ok: diff < 0 && !exact }
    case '>':
      return { ok: diff > 0 && !exact }
    case '≤':
      return { ok: diff < 0 || exact }
    case '≥':
      return { ok: diff > 0 || exact }
    default:
      return { ok: false }
  }
}

/* A few well-sized other units for a quantity (25 m/s -> 90 km/h, 55.9 mph). */
function quantityConversions(q, shownUnit, fmt, plain) {
  const dimension = Object.keys(SUGGEST).find((name) => DIMENSION_VECTORS[name] && !dimless(DIMENSION_VECTORS[name]) && sameDims(DIMENSION_VECTORS[name], q.d))
  if (!dimension || q.d[3]) return []
  return (SUGGEST[dimension] ?? [])
    .map((name) => EXACT.get(name) ?? LOWER.get(name.toLowerCase()))
    .filter((unit) => unit && symbolOf(unit) !== shownUnit?.label)
    .map((unit) => ({ unit, value: q.v / unit.factor }))
    .filter(({ value }) => Math.abs(value) >= 0.01 && Math.abs(value) < 1e5)
    .slice(0, 3)
    .map(({ unit, value }, index) => ({ id: `qc${index}`, kind: 'convert', text: `= ${fmt(value)}${unitGap(unit)}${symbolOf(unit)}`, copy: plain(value), hint: dimensionName(dimension) }))
}


/* ---------- putting it together ---------- */

const GRAPH_VARIABLES = new Set(['x', 't', 'theta'])

/**
 * The calculator's answer for `input`, or null when it isn't maths (so a
 * normal search stays a normal search).
 */
/* ---------- notes: statements, points, functions ---------- */

/*
 * School notes as people write them: prose with $…$ / $$…$$ maths, several
 * statements per line, \begin{aligned} blocks (a row starting with "=" or
 * "\approx" goes on from the row above; "&&\big|\ :b" notes about the step
 * are left out), \implies and ";" between statements.
 */
const ENVIRONMENTS = /\\(?:begin|end)\s*\{(?:aligned|align\*?|gathered|gather\*?|split|eqnarray\*?|array|equation\*?)\}(?:\{[^{}]*\})?/g

/* Leaves out "| : b" / "&&\big|\cdot x" (what is done to both sides), but not the bars of |x|. */
function stripStepNote(row) {
  const marked = /(?:&+\s*)?\\(?:big|Big|bigg|Bigg)l?\s*\|.*$|&+\s*\|.*$/.exec(row)
  if (marked) return row.slice(0, marked.index)
  let bars = 0
  for (let index = 0; index < row.length; index++) {
    if (row[index] !== '|') continue
    const after = row.slice(index + 1).replace(/^(?:\s|\\[,;:! ]|\\quad)+/, '')
    if (bars % 2 === 0 && /^(?::|\\cdot|·|\*|\/|\+|-|−|÷|\\div|\\times)/.test(after) && !after.slice(1).includes('|')) return row.slice(0, index)
    bars++
  }
  return row
}

export function splitStatements(input) {
  let text = String(input ?? '').slice(0, 6000)
  // 𝑎, 𝑥 (mathematical italic letters) are a and x.
  text = text.replace(/[\u{1D400}-\u{1D7FF}]/gu, (char) => char.normalize('NFKC'))
  const segments = /\$/.test(text) ? [...text.matchAll(/\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g)].map((match) => match[1] ?? match[2]) : [text]
  const statements = []
  for (const segment of segments) {
    const rows = segment.replace(ENVIRONMENTS, '\n').split(/\\\\|\n/)
    let current = null
    for (let row of rows) {
      row = stripStepNote(row)
        // Prose labels inside the maths ("\text{Korrektes Ergebnis:}") and alignment marks.
        .replace(/\\text\s*\{[^{}]*[:\s][^{}]*\}/g, ' ')
        .replace(/&/g, ' ')
        .trim()
      if (!row) continue
      if (current !== null && /^(?:=|≈|≤|≥|<|>|≠|\\approx|\\leq?|\\geq?|\\neq?|\\simeq)/.test(row)) {
        current += ` ${row}`
        continue
      }
      if (current !== null) statements.push(current)
      current = row
    }
    if (current !== null) statements.push(current)
  }
  return statements
    .flatMap((statement) => statement.split(/\\(?:implies|iff|Leftrightarrow|Longrightarrow|Longleftrightarrow)\b|⟹|⟺|;(?![^([{]*[\])}])/))
    .map((statement) =>
      statement
        .replace(/^\s*[\p{L}.]{2,}\s*:\s+(?=\S)/u, '')
        .replace(/^\s*(?:=|\\approx|≈)\s*/, '')
        .replace(/(?:\s*(?:=|≈|\\approx|\\cdot|\*|\+|-|·|\\dots|…))+\s*$/, '')
        .trim(),
    )
    .filter(Boolean)
    .slice(0, 60)
}

/* P(2|7), A(-1,5 | 1), S_{y}(0|3), and P_1=(1,25) (Desmos style, with "="). */
const POINT = /([A-Z][A-Za-z0-9']*(?:_\{?[A-Za-z0-9]+\}?)?)?\s*(=\s*)?\(\s*([^()|;]+?)\s*\|\s*([^()|;]+?)\s*\)/g
const NAMED_POINT = /^\s*([A-Z][A-Za-z0-9']*(?:_\{?[A-Za-z0-9]+\}?)?)\s*=\s*\(\s*([^(),]+?)\s*,\s*([^(),]+?)\s*\)\s*$/

function pointStatement(statement, { functions, fmt, locale, angle }) {
  let found = [...statement.matchAll(POINT)].map((match) => ({ name: match[1] ?? '', x: match[3], y: match[4] }))
  if (found.length) {
    const rest = statement.replace(POINT, '').replace(/[\s,;]|\\quad|\\,|und|and/g, '')
    if (rest) return null
  } else {
    const named = NAMED_POINT.exec(statement)
    if (!named) return null
    found = [{ name: named[1], x: named[2], y: named[3] }]
  }
  const number = (text) => {
    try {
      const tree = parseMath(normalizeMath(text, { decimalComma: true }))
      if (freeVariables(tree).size) return NaN
      return compile(tree, { angle })()
    } catch {
      return NaN
    }
  }
  const rows = []
  const points = []
  found.forEach((point, index) => {
    const x = number(point.x)
    const y = number(point.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    const name = point.name.replace(/[{}]/g, '')
    const shown = `${name}(${formatNumber(x, { digits: 6, locale })} | ${formatNumber(y, { digits: 6, locale })})`
    points.push({ x, y, label: shown })
    const names = Object.keys(functions)
    if (!names.length) {
      rows.push({ id: `p${index}`, kind: 'point', text: shown, copy: `${x}|${y}`, hint: label('point') })
      return
    }
    // The point test: put x into each function and compare with y.
    for (const fn of names) {
      const value = functions[fn].fn(x)
      const decimals = (String(point.y).split(/[.,]/)[1] ?? '').replace(/\D.*$/, '').length
      const tolerance = decimals ? 0.5 * 10 ** -decimals : 0
      const on = Number.isFinite(value) && Math.abs(value - y) <= Math.max(tolerance, 1e-9 * Math.max(1, Math.abs(y)))
      rows.push({
        id: `p${index}:${fn}`,
        kind: 'point',
        text: on ? label('onGraph', { point: shown, f: fn }) : label('offGraph', { point: shown, f: fn, x: formatNumber(x, { digits: 6, locale }), y: fmt(value) }),
        copy: on ? 'true' : 'false',
        hint: label('pointTest'),
      })
    }
  })
  if (!points.length) return null
  return { rows, graph: null, points, define: null, tree: null, illegal: false, error: null }
}

/* f(x) (or a known function f called with one variable): { name, variable }. */
function functionHead(node, known) {
  if (node.type === 'mul' && node.left.type === 'var' && node.right.type === 'var' && !(node.left.name in known) && !(node.right.name in known)) return { name: node.left.name, variable: node.right.name }
  if (node.type === 'ucall' && node.args.length === 1 && node.args[0].type === 'var') return { name: node.name, variable: node.args[0].name, known: true }
  return null
}
const freeOf = (node, known) => [...freeVariables(node)].filter((name) => !(name in known))

/*
 * How people ask: "convert 4:50pm to 24h", "what is 2+2", "how many seconds in a day"
 * (words from the language packs: phrases.ask, phrases.convert, phrases.howMany).
 */
function plainQuestion(text) {
  // ("10!" is a factorial: only a ! after a word is punctuation.)
  let out = String(text ?? '').trim().replace(/\?+$/, '').replace(/(?<=[A-Za-z\s])!+$/, '').trim()
  const ask = wordPattern(LANGUAGE.phrases.ask, 'iu')
  if (ask) out = out.replace(new RegExp(`^(?:${ask.source})\\s+`, 'iu'), '')
  const convert = wordPattern(LANGUAGE.phrases.convert, 'iu')
  if (convert) out = out.replace(new RegExp(`^(?:${convert.source})\\s+(?:from\\s+)?`, 'iu'), '')
  const many = wordPattern(LANGUAGE.phrases.howMany, 'iu')
  if (many) {
    const match = new RegExp(`^(?:${many.source})\\s+(.+?)\\s+(?:are\\s+|is\\s+)?(?:in|per)\\s+(?:an?\\s+|one\\s+)?(.+)$`, 'iu').exec(out)
    if (match) out = `1 ${match[2]} in ${match[1]}`
  }
  return out
}

export function analyze(input, { angle = 'rad', locale = undefined, digits = 12, vars = null, functions = null, soft = [], names = [], assign = false, graphAny = false, decimalComma = false } = {}) {
  const raw = plainQuestion(input)
  if (!raw || raw.length > 600) return null
  const fns = functions ?? {}
  const options = { angle, locale, functions: Object.fromEntries(Object.entries(fns).map(([name, entry]) => [name, entry.fn])) }
  const known = vars ?? {}
  const fmt = (value) => formatNumber(value, { digits, locale })
  const plain = (value) => formatNumber(value, { digits: 15, plain: true })
  const env = (name, x) => (name ? { ...known, [name]: x } : known)
  const rows = []
  let graph = null
  let points = []
  let define = null
  let defineFunctions = []
  let illegal = false
  // ÷ 0, √ of a negative, log 0, asin 2, (−1)!: maths that can't be done (∞ typed on purpose is fine).
  const impossible = (number) => !Number.isFinite(number) && !/inf|∞/i.test(raw)

  // Colours: #8b7bff, rgb(…), hsl(…), "teal color", "red to hex" (lib/dashColor.js).
  const colored = analyzeColor(raw, { label, named: namedColor, colorWords: LANGUAGE.phrases.color })
  if (colored) return colored
  // Times, dates, time zones, timestamps, timecodes (lib/dashTime.js).
  if (!Object.keys(known).length || !/[A-Za-z]/.test(raw.replace(/\b(?:am|pm|in|to|h|min|s|utc|gmt)\b/gi, ''))) {
    const timed = analyzeTime(raw, { fmt, plain, locale, label, countries: LANGUAGE.zones })
    if (timed) return timed
  }
  // "km in m", "km/h to m/s", "°C in °F": the general rule, no number needed.
  const rule = unitRule(raw, { fmt, plain })
  if (rule) return rule
  // "v in km/h", "Δs/Δt to km/h", "300 m / 12 s in km/h": maths with units, then converted.
  const converted = convertExpression(raw, { known, fns, options, fmt, plain, decimalComma })
  if (converted) return converted
  // Unit conversions first (they read letters the maths would reject).
  const units = conversions(raw, options)
  if (units) units.forEach((row, index) => rows.push({ id: `u${index}`, kind: 'convert', text: row.text, copy: row.copy, hint: row.hint }))

  let tree = null
  try {
    tree = parseMath(normalizeMath(raw, { decimalComma: decimalComma || /\\/.test(raw) }), { names: [...Object.keys(known), ...names], functions: Object.keys(fns), words: assign })
  } catch {
    tree = null
  }
  const value = (node) => compile(node, options)(known)
  const quantity = (node) => {
    try {
      return qcompile(node, options)(known)
    } catch (error) {
      if (error instanceof DimError) return null
      throw error
    }
  }
  const literals = tree ? unitLiterals(tree) : []
  // Real maths with units (300 m / 12 s): the simple converter's guesses ("25 s") don't apply.
  if (tree && literals.length && hasOperation(tree) && !(tree.type === 'mul' && tree.left.type === 'num' && tree.right.type === 'unit')) {
    for (let index = rows.length - 1; index >= 0; index--) if (/^u\d/.test(rows[index].id)) rows.splice(index, 1)
  }
  const show = (q) => {
    if (dimless(q.d)) return { text: fmt(q.v), copy: plain(q.v), unit: null }
    const unit = pickUnit(q, literals)
    const shown = q.v / unit.factor
    return { text: `${fmt(shown)} ${unit.label}`, copy: plain(shown), unit }
  }
  // A function from a body: graphed, and remembered under its names (f, G_f) for later statements.
  const defineFunction = (heads, body, variable, text) => {
    const f = compile(body, options)
    const fn = (x) => f(env(variable, x))
    graph = [{ id: 'f', label: shortLabel(text), fn }]
    points = solve(fn)
      .slice(0, 6)
      .map((root) => ({ x: root, y: 0, label: `${variable} = ${formatNumber(root, { digits: 6, locale })}` }))
    defineFunctions = heads.map((name) => ({ name, variable, fn, label: shortLabel(text) }))
  }

  if (tree) {
    // Values that came from solving an earlier equation (t = -7) are unknown again in a new equation.
    const softNames = new Set(soft)
    const hard = Object.fromEntries(Object.entries(known).filter(([name]) => !softNames.has(name)))
    const free = freeOf(tree, tree.type === 'eq' ? hard : known)
    // Units: in this statement, or in a value it uses (not just any quantity defined before).
    const withUnits = hasUnits(tree) || [...freeVariables(tree)].some((name) => isQuantity(known[name]))
    const relationTree = tree.type === 'chain' || tree.type === 'eq'
    const parts = tree.type === 'chain' ? tree.parts : tree.type === 'eq' ? [tree.left, tree.right] : []
    const ops = tree.type === 'chain' ? tree.ops : ['=']

    // f(x) = 2x + 3, G_f = f(x) = x/4 + 3: a function (not when f is known and this asks where f(x) = 0).
    let defined = false
    if (relationTree && ops.every((op) => op === '=')) {
      const body = parts.at(-1)
      const heads = parts.slice(0, -1).map((part) => functionHead(part, known) ?? (part.type === 'var' ? { name: part.name, variable: null } : null))
      const head = heads.find((entry) => entry?.variable)
      if (head && heads.every(Boolean) && !(head.known && !freeOf(body, known).includes(head.variable)) && freeOf(body, known).every((name) => name === head.variable)) {
        defineFunction(
          heads.filter((entry) => entry.name !== head.variable).map((entry) => entry.name),
          body,
          head.variable,
          raw,
        )
        defined = true
      }
    }

    // "m = …" names (or names again) whatever m was before: notes go on with the next exercise.
    const lead = relationTree && ops[0] === '=' && parts[0].type === 'var' && !(parts[0].name in CONSTANTS) && (assign || !(parts[0].name in known)) ? parts[0].name : null
    const constantParts = parts.map((part, index) => ({ part, index })).filter(({ part, index }) => !(lead && index === 0) && !freeOf(part, tree.type === 'eq' && !lead ? hard : known).length)
    const checkable = relationTree && !defined && (tree.type === 'chain' || withUnits || free.length === 0 || (lead && freeOf(parts[1], known).length === 0)) && !(tree.type === 'eq' && !lead && free.length === 1 && !withUnits)

    if (checkable && constantParts.length) {
      // Every part that can be worked out, checked against the one before it; a name in front gets the value.
      const values = constantParts.map(({ part }) => (withUnits ? quantity(part) : asQuantity(value(part))))
      if (values.every(Boolean)) {
        illegal = values.some((q) => impossible(q.v))
        const steps = []
        let ok = true
        let rounded = false
        for (let index = 1; index < values.length; index++) {
          const op = ops[constantParts[index].index - 1]
          const check = relationHolds(op, values[index - 1], values[index], constantParts[index - 1].part, constantParts[index].part, literals)
          steps.push({ op, ok: check.ok })
          ok &&= check.ok
          rounded ||= Boolean(check.rounded && check.ok)
        }
        // Units only (N = kg·m/s²): the units, not "1 N".
        const unitsOnly = !numbersIn(tree) && freeVariables(tree).size === 0
        const shown = values.map((q, index) => (unitsOnly && !dimless(q.d) ? { text: constantParts[index].part.type === 'unit' ? constantParts[index].part.unit.label : composedUnit(q.d).label, copy: '', unit: null } : show(q)))
        // Equal neighbours shown once: m = 1.333 = 4/3 ✓ (not 1.333 = 1.333).
        let text = shown[0].text
        steps.forEach((step, index) => {
          if (step.ok && step.op === '=' && shown[index + 1].text === shown[index].text) return
          text += ` ${step.ok ? step.op : NEGATED[step.op]} ${shown[index + 1].text}`
        })
        const fraction = !withUnits && ok ? asFraction(values[0].v) : null
        if (fraction && !text.includes(fraction)) text += ` = ${fraction}`
        if (values.length > 1 && ok) text += ' ✓'
        if (lead) text = `${lead} = ${text}`
        else if (values.length === 1) text = `= ${text}`
        rows.push({ id: 'chain', kind: ok && lead ? 'define' : values.length > 1 ? 'check' : 'result', text, copy: ok ? shown[0].copy : 'false', hint: label(rounded ? 'rounded' : lead ? 'value' : values.length > 1 ? 'check' : 'result') })
        if (ok) {
          define = { name: lead && assign ? lead : 'ans', value: withUnits ? values[0] : values[0].v }
          if (withUnits && !unitsOnly) rows.push(...quantityConversions(values[0], shown[0].unit, fmt, plain))
        }
      }
    } else if (tree.type === 'eq' && !defined) {
      const body = graphBody(tree, known)
      if (free.length === 1 && !body) {
        const name = free[0]
        const l = compile(tree.left, options)
        const r = compile(tree.right, options)
        const f = (x) => l(env(name, x)) - r(env(name, x))
        // (solving for a value that was found before: it's free here)
        const roots = solve(f)
        if (roots.length) roots.forEach((root, index) => rows.push({ id: `r${index}`, kind: 'solve', text: `${name} = ${fmt(root)}${asFraction(root) ? ` = ${asFraction(root)}` : ''}`, copy: plain(root), hint: roots.length > 1 ? label('solutionN', { n: index + 1 }) : label('solution') }))
        else rows.push({ id: 'none', kind: 'solve', text: label('noSolution', { name }), copy: '', hint: label('equation') })
        // Both sides as graphs: where they meet are the solutions.
        graph = [
          { id: 'l', label: shortLabel(raw.split('=')[0]), fn: (x) => l(env(name, x)) },
          { id: 'r', label: shortLabel(raw.split('=').slice(1).join('=')), fn: (x) => r(env(name, x)), dashed: true },
        ]
        points = roots.map((root) => ({ x: root, y: l(env(name, root)), label: `${name} = ${formatNumber(root, { digits: 6, locale })}` }))
        // One answer: later lines know it ("-7 = t" -> t).
        if (roots.length === 1) define = { name: assign ? name : 'ans', value: roots[0], soft: true }
        else if (roots.length) define = { name: 'ans', value: roots[0] }
      } else if (body && ![...freeVariables(body.node)].some((name) => isQuantity(known[name]))) {
        const f = compile(body.node, options)
        graph = [{ id: 'f', label: shortLabel(raw), fn: (x) => f(env(body.variable, x)) }]
      }
    } else if (!relationTree && free.length === 0) {
      if (hasOperation(tree) || (assign && tree.type === 'var') || tree.type === 'unit') {
        // "5 km" alone: the conversions say it all.
        const literalOnly = tree.type === 'unit' || (tree.type === 'mul' && tree.left.type === 'num' && tree.right.type === 'unit')
        if (withUnits && literalOnly && rows.length) {
          // nothing more to add
        } else if (withUnits) {
          const result = quantity(tree)
          if (result) {
            illegal = impossible(result.v)
            const shown = show(result)
            define = { name: 'ans', value: result }
            rows.unshift({ id: 'v', kind: 'result', text: `= ${shown.text}`, copy: shown.copy, hint: label('quantity') })
            rows.push(...quantityConversions(result, shown.unit, fmt, plain))
          }
        } else {
          const result = value(tree)
          illegal = impossible(result)
          if (!Number.isNaN(result)) {
            define = { name: 'ans', value: result }
            rows.unshift({ id: 'v', kind: 'result', text: `= ${fmt(result)}`, copy: plain(result), hint: label('result') })
            const fraction = asFraction(result)
            if (fraction) rows.splice(1, 0, { id: 'q', kind: 'fraction', text: `= ${fraction}`, copy: fraction.replace('−', '-'), hint: label('fraction') })
            if (Number.isFinite(result) && Math.abs(result) >= 1e6 && Math.abs(result) < 1e15) rows.splice(fraction ? 2 : 1, 0, { id: 'e', kind: 'result', text: `= ${scientific(result)}`, copy: result.toExponential(), hint: label('scientific') })
          }
        }
      }
    } else if (!relationTree && free.length === 1 && (GRAPH_VARIABLES.has(free[0]) || (graphAny && hasOperation(tree))) && (hasOperation(tree) || graphAny)) {
      const name = free[0]
      const f = compile(tree, options)
      graph = [{ id: 'f', label: shortLabel(raw), fn: (x) => f(env(name, x)) }]
      // Where it crosses the x axis.
      points = solve((x) => f(env(name, x)))
        .slice(0, 6)
        .map((root) => ({ x: root, y: 0, label: `${name} = ${formatNumber(root, { digits: 6, locale })}` }))
    }
  }
  if (!rows.length && !graph && !illegal) return null
  const error = illegal ? errorOf(tree, options, known, tree.type === 'eq' || tree.type === 'chain' ? NaN : (() => { try { return compile(tree, options)(known) } catch { return NaN } })()) : null
  return { rows, graph, points, define, defineFunctions, tree, illegal, error }
}

/* Temperatures have an offset, so their rule is a formula, not a factor. */
const TEMPERATURE_RULES = {
  '°c>°f': '°F = °C · 9/5 + 32',
  '°f>°c': '°C = (°F − 32) · 5/9',
  '°c>k': 'K = °C + 273.15',
  'k>°c': '°C = K − 273.15',
  '°f>k': 'K = (°F − 32) · 5/9 + 273.15',
  'k>°f': '°F = (K − 273.15) · 9/5 + 32',
}

/* A unit as written (km, km/h, m/s^2, kilometres): what it can mean, as { factor, dims, label, unit? }. */
function unitReadings(text) {
  const name = String(text ?? '').trim()
  if (!name || /\d/.test(name.replace(/\^\s*-?\d+|[²³]/g, ''))) return []
  const readings = unitsFor(name)
    .filter((unit) => DIMENSION_VECTORS[unit.dimension])
    .map((unit) => ({ factor: unit.factor, dims: DIMENSION_VECTORS[unit.dimension], label: symbolOf(unit), unit }))
  const composite = /[/*·^²³]/.test(name) ? unitExpression(name) : null
  if (composite) readings.push(composite)
  return readings
}

/* "km in m": 1 km = 1 000 m, × 1 000, and the other way round. */
function unitRule(raw, { fmt, plain }) {
  const splits = [...raw.matchAll(CONVERT_WORDS)]
  for (let index = splits.length - 1; index >= 0; index--) {
    const from = unitReadings(raw.slice(0, splits[index].index))
    const to = unitReadings(raw.slice(splits[index].index + splits[index][0].length))
    for (const a of from) {
      for (const b of to) {
        if (!sameDims(a.dims, b.dims) || a.label === b.label) continue
        const hint = label('rule')
        if (a.unit?.dimension === 'temperature' || b.unit?.dimension === 'temperature') {
          const formula = TEMPERATURE_RULES[`${a.unit?.symbol}>${b.unit?.symbol}`]
          if (!formula) continue
          return { rows: [{ id: 'rule', kind: 'convert', text: formula, copy: formula, hint }], graph: null, points: [], define: null, defineFunctions: [], tree: null, illegal: false, error: null }
        }
        const factor = a.factor / b.factor
        const inverse = 1 / factor
        // "÷ 3.6" reads better than "× 0.2777…"; "× 1000" better than "÷ 0.001".
        const nice = (value) => Math.abs(value - Math.round(value * 1000) / 1000) < 1e-9 * Math.max(1, value)
        const step = factor < 1 && nice(inverse) ? `÷ ${fmt(inverse)}` : `× ${fmt(factor)}`
        return {
          rows: [
            { id: 'rule', kind: 'convert', text: `1 ${a.label} = ${fmt(factor)} ${b.label}`, copy: plain(factor), hint },
            { id: 'step', kind: 'convert', text: `${a.label} → ${b.label}: ${step}`, copy: step, hint },
            { id: 'back', kind: 'convert', text: `1 ${b.label} = ${fmt(inverse)} ${a.label}`, copy: plain(inverse), hint: label('ruleBack') },
          ],
          graph: null,
          points: [],
          define: null,
          defineFunctions: [],
          tree: null,
          illegal: false,
          error: null,
        }
      }
    }
  }
  return null
}

/* A quantity worked out (with the values known so far) and shown in the units asked for. */
function convertExpression(raw, { known, fns, options, fmt, plain, decimalComma }) {
  const splits = [...raw.matchAll(CONVERT_WORDS)]
  for (let index = splits.length - 1; index >= 0; index--) {
    const left = raw.slice(0, splits[index].index).trim()
    const right = raw.slice(splits[index].index + splits[index][0].length).trim()
    if (!left || !right) continue
    const targets = right.split(/\s*(?:,|&|\+)\s*/).map((name) => {
      const unit = unitExpression(name)
      if (unit) return unit
      const named = unitsFor(name).find((entry) => DIMENSION_VECTORS[entry.dimension])
      return named ? { factor: named.factor, dims: DIMENSION_VECTORS[named.dimension], label: symbolOf(named) } : null
    })
    if (targets.some((target) => !target)) continue
    let tree
    try {
      tree = parseMath(normalizeMath(left, { decimalComma: decimalComma || /\\/.test(left) }), { names: Object.keys(known), functions: Object.keys(fns) })
    } catch {
      continue
    }
    // Only when there's something to work out or a value to use (plain "5 km to mi" is for the unit converter).
    const usesValues = [...freeVariables(tree)].length > 0
    // "5 ft", "20°C": a number and its unit is the plain converter's (temperatures keep their offset there).
    const single = tree.type === 'unit' || (tree.type === 'mul' && tree.left.type === 'num' && tree.right.type === 'unit') || (tree.type === 'neg' && tree.value.type === 'mul' && tree.value.left.type === 'num' && tree.value.right.type === 'unit') || (tree.type === 'deg' && tree.value.type === 'num')
    if (!usesValues && single) {
      const plainRows = conversions(raw, options)
      if (plainRows?.length) return { rows: plainRows.map((row, index) => ({ id: `u${index}`, kind: 'convert', text: row.text, copy: row.copy, hint: row.hint })), graph: null, points: [], define: null, defineFunctions: [], tree, illegal: false, error: null }
    }
    if (!usesValues && !hasOperation(tree)) continue
    if ([...freeVariables(tree)].some((name) => !(name in known))) continue
    let q
    try {
      q = qcompile(tree, options)(known)
    } catch {
      continue
    }
    if (!Number.isFinite(q.v)) continue
    const rows = targets
      .filter((target) => sameDims(target.dims, q.d) && target.factor)
      .map((target, row) => ({ id: `x${row}`, kind: 'convert', text: `${shortLabel(left)} = ${fmt(q.v / target.factor)} ${target.label}`, copy: plain(q.v / target.factor), hint: label('quantity') }))
    if (rows.length) return { rows, graph: null, points: [], define: { name: 'ans', value: q }, defineFunctions: [], tree, illegal: false, error: null }
  }
  return null
}

/**
 * Everything in a line of notes, statement by statement (values, functions
 * and points carry on): { rows, graph, points, trees, illegal, error, env }.
 * env = { vars, functions } to hand to the next line.
 */
export function analyzeAll(input, options = {}) {
  const statements = splitStatements(input)
  if (!statements.length) return null
  let vars = { ...(options.vars ?? {}) }
  let functions = { ...(options.functions ?? {}) }
  let soft = [...(options.soft ?? [])]
  const several = statements.length > 1
  const decimalComma = options.decimalComma || /\$|\\/.test(String(input))
  const results = []
  const fmt = (value) => formatNumber(value, { digits: options.digits ?? 12, locale: options.locale })
  for (const statement of statements) {
    const latest = Object.keys(functions).at(-1)
    const result = pointStatement(statement, { functions: latest ? { [latest]: functions[latest] } : {}, fmt, locale: options.locale, angle: options.angle }) ?? analyze(statement, { ...options, vars, functions, soft, decimalComma, assign: options.assign || several })
    if (!result) continue
    if (result.define) {
      vars = { ...vars, [result.define.name]: result.define.value }
      soft = result.define.soft ? [...soft.filter((name) => name !== result.define.name), result.define.name] : soft.filter((name) => name !== result.define.name)
    }
    for (const entry of result.defineFunctions ?? []) {
      // Defined again: it moves to the end (the latest one is what points are tested against).
      const { [entry.name]: _, ...rest } = functions
      functions = { ...rest, [entry.name]: entry }
    }
    results.push(result)
  }
  if (!results.length) return null
  const env = { vars, functions, soft }
  if (results.length === 1) return { ...results[0], trees: results[0].tree ? [results[0].tree] : [], env }
  const first = results.find((result) => result.illegal)
  const graphs = results.flatMap((result) => result.graph ?? [])
  return {
    // Several statements: their own answers, without the extra conversions of each.
    rows: results.flatMap((result, index) => result.rows.filter((row) => !/^(?:qc|u)\d/.test(String(row.id))).map((row) => ({ ...row, id: `${index}:${row.id}` }))).slice(0, 40),
    graph: graphs.length ? graphs : null,
    points: results.flatMap((result) => result.points ?? []),
    trees: results.map((result) => result.tree).filter(Boolean),
    tree: null,
    define: results.at(-1).define,
    illegal: Boolean(first),
    error: first?.error ?? null,
    env,
  }
}

const shortLabel = (text) => String(text).trim().replace(/\s+/g, ' ').slice(0, 60)

/* Every unit name, for the docs / hints. */
export const UNIT_COUNT = UNITS.length
