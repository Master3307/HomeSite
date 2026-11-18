/*
 * What the calculator's keypad and symbol search insert, in each input
 * style: plain (what you'd type), LaTeX and Unicode. `§` is where the cursor
 * goes; empty () / {} are slots that Tab jumps to. With text selected, the
 * selection goes into the first slot. What each is called (for the search)
 * is in the locale file calc.json, `symbols.<id>`, in every language.
 */

export const INPUT_STYLES = ['plain', 'latex', 'unicode']

const fn = (name, latex = `\\${name}`) => ({ id: name, group: 'functions', show: name, plain: `${name}(§)`, latex: `${latex}(§)`, unicode: `${name}(§)` })

export const MATH_SYMBOLS = [
  // building blocks
  { id: 'frac', group: 'structure', show: 'a⁄b', plain: '(§)/()', latex: '\\frac{§}{}', unicode: '(§)⁄()', template: true },
  { id: 'pow', group: 'structure', show: 'xⁿ', plain: '^(§)', latex: '^{§}', unicode: '^(§)', template: true },
  { id: 'sq', group: 'structure', show: 'x²', plain: '^2', latex: '^{2}', unicode: '²' },
  { id: 'cube', group: 'structure', show: 'x³', plain: '^3', latex: '^{3}', unicode: '³' },
  { id: 'sqrt', group: 'structure', show: '√x', plain: 'sqrt(§)', latex: '\\sqrt{§}', unicode: '√(§)', template: true },
  { id: 'cbrt', group: 'structure', show: '∛x', plain: 'cbrt(§)', latex: '\\sqrt[3]{§}', unicode: '∛(§)', template: true },
  { id: 'root', group: 'structure', show: 'ⁿ√x', plain: 'root(§, )', latex: '\\sqrt[]{§}', unicode: 'root(§, )', template: true },
  { id: 'abs', group: 'structure', show: '|x|', plain: 'abs(§)', latex: '\\left|§\\right|', unicode: '|§|', template: true },
  { id: 'paren', group: 'structure', show: '( )', plain: '(§)', latex: '\\left(§\\right)', unicode: '(§)', template: true },
  { id: 'exp', group: 'structure', show: 'eˣ', plain: 'e^(§)', latex: 'e^{§}', unicode: 'e^(§)', template: true },
  { id: 'logb', group: 'structure', show: 'logₐx', plain: 'log(§, )', latex: '\\log_{}{§}', unicode: 'log(§, )', template: true },
  { id: 'fact', group: 'structure', show: 'n!', plain: '!', latex: '!', unicode: '!' },
  { id: 'pct', group: 'structure', show: '%', plain: '%', latex: '\\%', unicode: '%' },
  { id: 'deg', group: 'structure', show: '°', plain: '°', latex: '^{\\circ}', unicode: '°' },
  // operators
  { id: 'plus', group: 'operators', show: '+', plain: ' + ', latex: ' + ', unicode: ' + ' },
  { id: 'minus', group: 'operators', show: '−', plain: ' - ', latex: ' - ', unicode: ' − ' },
  { id: 'times', group: 'operators', show: '×', plain: ' * ', latex: ' \\cdot ', unicode: ' × ' },
  { id: 'div', group: 'operators', show: '÷', plain: ' / ', latex: ' \\div ', unicode: ' ÷ ' },
  { id: 'eq', group: 'operators', show: '=', plain: ' = ', latex: ' = ', unicode: ' = ' },
  { id: 'mod', group: 'operators', show: 'mod', plain: ' mod ', latex: ' \\bmod ', unicode: ' mod ' },
  { id: 'to', group: 'operators', show: '→', plain: ' to ', latex: ' \\to ', unicode: ' → ' },
  { id: 'x', group: 'operators', show: 'x', plain: 'x', latex: 'x', unicode: 'x' },
  { id: 'y', group: 'operators', show: 'y =', plain: 'y = ', latex: 'y = ', unicode: 'y = ' },
  // constants and letters
  { id: 'pi', group: 'constants', show: 'π', plain: 'pi', latex: '\\pi', unicode: 'π' },
  { id: 'e', group: 'constants', show: 'e', plain: 'e', latex: 'e', unicode: 'e' },
  { id: 'tau', group: 'constants', show: 'τ', plain: 'tau', latex: '\\tau', unicode: 'τ' },
  { id: 'phi', group: 'constants', show: 'φ', plain: 'phi', latex: '\\phi', unicode: 'φ' },
  { id: 'inf', group: 'constants', show: '∞', plain: 'Infinity', latex: '\\infty', unicode: '∞' },
  { id: 'theta', group: 'constants', show: 'θ', plain: 'theta', latex: '\\theta', unicode: 'θ' },
  { id: 'ans', group: 'constants', show: 'ans', plain: 'ans', latex: 'ans', unicode: 'ans' },
  { id: 'half', group: 'constants', show: '½', plain: '1/2', latex: '\\frac{1}{2}', unicode: '½' },
  // functions
  fn('sin'),
  fn('cos'),
  fn('tan'),
  { ...fn('asin', '\\arcsin'), show: 'arcsin' },
  { ...fn('acos', '\\arccos'), show: 'arccos' },
  { ...fn('atan', '\\arctan'), show: 'arctan' },
  fn('sinh'),
  fn('cosh'),
  fn('tanh'),
  fn('ln'),
  fn('log'),
  { ...fn('log2', '\\log_{2}'), show: 'log₂' },
  fn('exp'),
  { ...fn('floor', '\\operatorname{floor}'), show: '⌊x⌋' },
  { ...fn('ceil', '\\operatorname{ceil}'), show: '⌈x⌉' },
  { ...fn('round', '\\operatorname{round}') },
  { id: 'min', group: 'functions', show: 'min', plain: 'min(§, )', latex: '\\min(§, )', unicode: 'min(§, )' },
  { id: 'max', group: 'functions', show: 'max', plain: 'max(§, )', latex: '\\max(§, )', unicode: 'max(§, )' },
  { id: 'gcd', group: 'functions', show: 'gcd', plain: 'gcd(§, )', latex: '\\gcd(§, )', unicode: 'gcd(§, )' },
  { id: 'lcm', group: 'functions', show: 'lcm', plain: 'lcm(§, )', latex: '\\operatorname{lcm}(§, )', unicode: 'lcm(§, )' },
  { id: 'ncr', group: 'functions', show: 'nCr', plain: 'nCr(§, )', latex: '\\operatorname{nCr}(§, )', unicode: 'nCr(§, )' },
  { id: 'avg', group: 'functions', show: 'avg', plain: 'avg(§, )', latex: '\\operatorname{avg}(§, )', unicode: 'avg(§, )' },
]

/* The keys always on the keypad. */
export const KEYPAD = ['frac', 'pow', 'sq', 'sqrt', 'paren', 'pi', 'times', 'div', 'eq', 'x']

export const SYMBOL_GROUPS = ['structure', 'operators', 'constants', 'functions']

/** `wordsOf(id)`: the names of a symbol in the visitor's languages (calc.json). */
export function findSymbols(query, wordsOf = () => '') {
  const words = String(query ?? '').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  if (!words.length) return MATH_SYMBOLS
  return MATH_SYMBOLS.filter((symbol) => {
    const haystack = `${symbol.id} ${symbol.show} ${wordsOf(symbol.id)} ${symbol.plain} ${symbol.latex} ${symbol.unicode}`.toLocaleLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

/* The LaTeX a symbol stands for, without its slots: "\frac", "\sqrt", "\operatorname{floor}", "\frac{1}{2}". Null when it isn't a command. */
const latexHead = (symbol, { brackets = false } = {}) => {
  if (!/^\\[a-zA-Z]/.test(symbol.latex) || (!brackets && symbol.latex.startsWith('\\left'))) return null
  return symbol.latex.includes('§') ? symbol.latex.split('§')[0].replace(/[({]$/, '') : symbol.latex
}
/* A symbol's names as command words: "square root" -> "squareroot". */
const aliasesOf = (symbol, wordsOf) =>
  String(wordsOf(symbol.id) ?? '')
    .split(',')
    .map((word) => word.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''))
    .filter((word) => word.length > 1)

/**
 * LaTeX commands for what's typed after a backslash ("\fr"): by the command
 * itself, or by any name of the symbol in the visitor's languages ("\root",
 * "\fraction"), so nobody has to know the real command.
 */
export function latexCommands(partial, wordsOf = () => '') {
  const typed = String(partial ?? '').replace(/^\\/, '').toLocaleLowerCase()
  const found = new Map()
  for (const symbol of MATH_SYMBOLS) {
    // In the list \left|…\right| counts too (found by "abs"); it has no single command to stand for.
    const head = latexHead(symbol, { brackets: true })
    if (!head || found.has(symbol.latex)) continue
    const command = /^\\([a-zA-Z]+)/.exec(head)[1].toLowerCase()
    const alias = command.startsWith(typed) ? null : aliasesOf(symbol, wordsOf).find((word) => word.startsWith(typed))
    if (!command.startsWith(typed) && !alias) continue
    found.set(symbol.latex, { rank: alias ? 1 : 0, symbol, alias })
  }
  return [...found.values()]
    .sort((a, b) => a.rank - b.rank || a.symbol.latex.length - b.symbol.latex.length)
    .slice(0, 6)
    .map(({ symbol, alias }) => ({ id: symbol.id, show: symbol.show, template: symbol.latex, command: /^\\[a-zA-Z]+/.exec(symbol.latex)[0], alias, words: wordsOf(symbol.id) }))
}

/** Every name a command may be written as ("squareroot" -> "\sqrt"), for lib/dashMath.js to understand them. */
export function latexAliases(wordsOf = () => '') {
  const map = {}
  for (const symbol of MATH_SYMBOLS) {
    const head = latexHead(symbol)
    if (!head) continue
    for (const alias of aliasesOf(symbol, wordsOf)) map[alias] ??= head
  }
  return map
}

/**
 * Puts `symbol` (in `style`) into `text` at the selection; returns the new
 * text and where the cursor goes.
 */
export function insertSymbol(text, start, end, symbol, style = 'plain') {
  const template = symbol[style] ?? symbol.plain
  const selected = text.slice(start, end)
  const at = template.indexOf('§')
  let piece = template.replace('§', selected)
  let cursor = at === -1 ? piece.length : at + selected.length
  // With a selection: it filled the first slot, go on to the next one.
  if (selected && at !== -1) {
    const next = nextSlot(piece, at + selected.length)
    cursor = next ?? piece.length
  }
  // No space doubled up next to an operator.
  if (piece.startsWith(' ') && /\s$/.test(text.slice(0, start))) {
    piece = piece.slice(1)
    cursor -= 1
  }
  return { text: text.slice(0, start) + piece + text.slice(end), cursor: start + cursor }
}

/** The inside of the next empty slot (), {}, [] or ", )" after `from`, or null. */
export function nextSlot(text, from) {
  const pattern = /\(\)|\{\}|\[\]|, \)|\|\|/g
  pattern.lastIndex = from
  const match = pattern.exec(text)
  if (!match) return null
  return match[0] === ', )' ? match.index + 2 : match.index + 1
}
