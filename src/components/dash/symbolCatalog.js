/*
 * Every symbol the calculator's symbol search offers beyond its own
 * building blocks (mathSymbols.js): letters, relations, arrows, sets and
 * logic, big operators, accents, fonts, super- and subscripts, fractions …
 * Each with its LaTeX command, its Unicode character and the names it's
 * found by (English here; calc.json `symbols.<id>` adds every language for
 * the building blocks). Loaded the first time the search opens.
 *
 * Entry: [latex, unicode, names, group]; latex may be '' (no command) and
 * unicode '' (no single character). A `§` in latex is where the cursor goes.
 */

const greek = [
  ['alpha', 'α', 'Α'], ['beta', 'β', 'Β'], ['gamma', 'γ', 'Γ'], ['delta', 'δ', 'Δ'], ['epsilon', 'ε', 'Ε'], ['zeta', 'ζ', 'Ζ'], ['eta', 'η', 'Η'], ['theta', 'θ', 'Θ'],
  ['iota', 'ι', 'Ι'], ['kappa', 'κ', 'Κ'], ['lambda', 'λ', 'Λ'], ['mu', 'μ', 'Μ'], ['nu', 'ν', 'Ν'], ['xi', 'ξ', 'Ξ'], ['omicron', 'ο', 'Ο'], ['pi', 'π', 'Π'],
  ['rho', 'ρ', 'Ρ'], ['sigma', 'σ', 'Σ'], ['tau', 'τ', 'Τ'], ['upsilon', 'υ', 'Υ'], ['phi', 'φ', 'Φ'], ['chi', 'χ', 'Χ'], ['psi', 'ψ', 'Ψ'], ['omega', 'ω', 'Ω'],
]
// LaTeX has capitals only for the letters that differ from Latin ones.
const LATEX_CAPITALS = new Set(['Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega'])

const RAW = [
  ...greek.flatMap(([name, small, capital]) => {
    const Cap = name[0].toUpperCase() + name.slice(1)
    return [
      [name === 'omicron' ? 'o' : `\\${name}`, small, `${name}, greek ${name}, small ${name}`, 'greek'],
      [LATEX_CAPITALS.has(Cap) ? `\\${Cap}` : Cap === 'Omicron' ? 'O' : `\\mathrm{${capital}}`, capital, `${Cap}, capital ${name}, greek capital ${name}`, 'greek'],
    ]
  }),
  ['\\varepsilon', 'ϵ', 'varepsilon, epsilon variant, lunate epsilon', 'greek'],
  ['\\vartheta', 'ϑ', 'vartheta, theta variant, script theta', 'greek'],
  ['\\varpi', 'ϖ', 'varpi, pi variant', 'greek'],
  ['\\varrho', 'ϱ', 'varrho, rho variant', 'greek'],
  ['\\varsigma', 'ς', 'varsigma, final sigma', 'greek'],
  ['\\varphi', 'ϕ', 'varphi, phi variant, straight phi', 'greek'],
  ['\\digamma', 'ϝ', 'digamma', 'greek'],
  ['\\varkappa', 'ϰ', 'varkappa, kappa variant', 'greek'],

  // relations
  ['=', '=', 'equals, equal sign', 'relations'],
  ['\\neq', '≠', 'not equal, unequal, ne', 'relations'],
  ['<', '<', 'less than', 'relations'],
  ['>', '>', 'greater than, more than', 'relations'],
  ['\\leq', '≤', 'less than or equal, le, at most', 'relations'],
  ['\\geq', '≥', 'greater than or equal, ge, at least', 'relations'],
  ['\\leqslant', '⩽', 'leqslant, less or equal slanted', 'relations'],
  ['\\geqslant', '⩾', 'geqslant, greater or equal slanted', 'relations'],
  ['\\ll', '≪', 'much less than', 'relations'],
  ['\\gg', '≫', 'much greater than', 'relations'],
  ['\\approx', '≈', 'approximately, almost equal, approx', 'relations'],
  ['\\sim', '∼', 'similar, tilde operator, sim', 'relations'],
  ['\\simeq', '≃', 'asymptotically equal, simeq', 'relations'],
  ['\\cong', '≅', 'congruent, isomorphic, cong', 'relations'],
  ['\\equiv', '≡', 'identical, equivalent, congruent modulo, equiv', 'relations'],
  ['\\not\\equiv', '≢', 'not identical, not equivalent', 'relations'],
  ['\\propto', '∝', 'proportional to, propto', 'relations'],
  ['\\doteq', '≐', 'approaches the limit, doteq', 'relations'],
  ['\\triangleq', '≜', 'defined as, delta equal', 'relations'],
  ['\\coloneqq', '≔', 'colon equals, defined as, assign', 'relations'],
  ['\\prec', '≺', 'precedes', 'relations'],
  ['\\succ', '≻', 'succeeds', 'relations'],
  ['\\preceq', '⪯', 'precedes or equal', 'relations'],
  ['\\succeq', '⪰', 'succeeds or equal', 'relations'],
  ['\\parallel', '∥', 'parallel', 'relations'],
  ['\\nparallel', '∦', 'not parallel', 'relations'],
  ['\\perp', '⊥', 'perpendicular, orthogonal, perp, up tack', 'relations'],
  ['\\mid', '∣', 'divides, mid', 'relations'],
  ['\\nmid', '∤', 'does not divide', 'relations'],
  ['\\models', '⊨', 'models, entails', 'relations'],
  ['\\vdash', '⊢', 'proves, turnstile, vdash', 'relations'],
  ['\\dashv', '⊣', 'dashv, left tack', 'relations'],
  ['\\asymp', '≍', 'asymp, equivalent to', 'relations'],
  ['\\bowtie', '⋈', 'bowtie, natural join', 'relations'],

  // operators
  ['+', '+', 'plus, add', 'signs'],
  ['-', '−', 'minus, subtract', 'signs'],
  ['\\pm', '±', 'plus minus, plus or minus, pm', 'signs'],
  ['\\mp', '∓', 'minus plus, mp', 'signs'],
  ['\\times', '×', 'times, multiply, cross', 'signs'],
  ['\\cdot', '⋅', 'dot, cdot, multiply dot', 'signs'],
  ['\\div', '÷', 'divide, division, obelus', 'signs'],
  ['/', '∕', 'slash, divide', 'signs'],
  ['\\ast', '∗', 'asterisk, star operator, convolution', 'signs'],
  ['\\star', '⋆', 'star', 'signs'],
  ['\\circ', '∘', 'compose, ring, circ, composition', 'signs'],
  ['\\bullet', '∙', 'bullet', 'signs'],
  ['\\oplus', '⊕', 'direct sum, oplus, xor', 'signs'],
  ['\\ominus', '⊖', 'ominus, circled minus', 'signs'],
  ['\\otimes', '⊗', 'tensor product, otimes', 'signs'],
  ['\\oslash', '⊘', 'oslash, circled slash', 'signs'],
  ['\\odot', '⊙', 'odot, circled dot, hadamard', 'signs'],
  ['\\wr', '≀', 'wreath product', 'signs'],
  ['\\dagger', '†', 'dagger, adjoint', 'signs'],
  ['\\ddagger', '‡', 'double dagger', 'signs'],
  ['\\amalg', '⨿', 'amalgamation, coproduct', 'signs'],
  ['!', '!', 'factorial', 'signs'],
  ['\\%', '%', 'percent', 'signs'],
  ['\\permil', '‰', 'per mille, per thousand', 'signs'],
  ['^{\\circ}', '°', 'degree, degrees', 'signs'],
  ["'", '′', 'prime, minutes, derivative', 'signs'],
  ["''", '″', 'double prime, seconds, second derivative', 'signs'],
  ['\\sqrt{§}', '√', 'square root, sqrt, radical', 'signs'],
  ['\\sqrt[3]{§}', '∛', 'cube root', 'signs'],
  ['\\sqrt[4]{§}', '∜', 'fourth root', 'signs'],

  // arrows
  ['\\to', '→', 'to, right arrow, maps to, tends to, implies', 'arrows'],
  ['\\leftarrow', '←', 'left arrow, gets', 'arrows'],
  ['\\leftrightarrow', '↔', 'left right arrow, both ways', 'arrows'],
  ['\\uparrow', '↑', 'up arrow', 'arrows'],
  ['\\downarrow', '↓', 'down arrow', 'arrows'],
  ['\\updownarrow', '↕', 'up down arrow', 'arrows'],
  ['\\Rightarrow', '⇒', 'implies, double right arrow, therefore', 'arrows'],
  ['\\Leftarrow', '⇐', 'is implied by, double left arrow', 'arrows'],
  ['\\Leftrightarrow', '⇔', 'if and only if, iff, equivalent, double arrow', 'arrows'],
  ['\\implies', '⟹', 'implies, long double arrow', 'arrows'],
  ['\\impliedby', '⟸', 'implied by', 'arrows'],
  ['\\iff', '⟺', 'iff, if and only if', 'arrows'],
  ['\\Uparrow', '⇑', 'double up arrow', 'arrows'],
  ['\\Downarrow', '⇓', 'double down arrow', 'arrows'],
  ['\\mapsto', '↦', 'maps to, mapsto', 'arrows'],
  ['\\longrightarrow', '⟶', 'long right arrow', 'arrows'],
  ['\\longleftarrow', '⟵', 'long left arrow', 'arrows'],
  ['\\longmapsto', '⟼', 'long maps to', 'arrows'],
  ['\\hookrightarrow', '↪', 'hook right arrow, injection, embedding', 'arrows'],
  ['\\hookleftarrow', '↩', 'hook left arrow', 'arrows'],
  ['\\twoheadrightarrow', '↠', 'surjection, two head arrow', 'arrows'],
  ['\\rightharpoonup', '⇀', 'right harpoon, vector', 'arrows'],
  ['\\rightleftharpoons', '⇌', 'equilibrium, reversible reaction, harpoons', 'arrows'],
  ['\\nearrow', '↗', 'north east arrow, up right', 'arrows'],
  ['\\searrow', '↘', 'south east arrow, down right', 'arrows'],
  ['\\swarrow', '↙', 'south west arrow, down left', 'arrows'],
  ['\\nwarrow', '↖', 'north west arrow, up left', 'arrows'],
  ['\\circlearrowleft', '↺', 'counterclockwise, anticlockwise', 'arrows'],
  ['\\circlearrowright', '↻', 'clockwise', 'arrows'],
  ['\\leadsto', '⇝', 'leads to, squiggly arrow', 'arrows'],

  // sets and logic
  ['\\in', '∈', 'element of, in, belongs to, is in', 'sets'],
  ['\\notin', '∉', 'not element of, not in', 'sets'],
  ['\\ni', '∋', 'contains as member, ni', 'sets'],
  ['\\subset', '⊂', 'subset, proper subset', 'sets'],
  ['\\supset', '⊃', 'superset', 'sets'],
  ['\\subseteq', '⊆', 'subset or equal, subseteq', 'sets'],
  ['\\supseteq', '⊇', 'superset or equal, supseteq', 'sets'],
  ['\\subsetneq', '⊊', 'proper subset, subsetneq', 'sets'],
  ['\\not\\subset', '⊄', 'not subset', 'sets'],
  ['\\cup', '∪', 'union, cup', 'sets'],
  ['\\cap', '∩', 'intersection, cap', 'sets'],
  ['\\setminus', '∖', 'set minus, difference, without', 'sets'],
  ['\\complement', '∁', 'complement', 'sets'],
  ['\\emptyset', '∅', 'empty set, null set', 'sets'],
  ['\\varnothing', '⌀', 'empty set, varnothing', 'sets'],
  ['\\triangle', '△', 'symmetric difference, triangle', 'sets'],
  ['\\forall', '∀', 'for all, for every, forall', 'logic'],
  ['\\exists', '∃', 'there exists, exists', 'logic'],
  ['\\nexists', '∄', 'there does not exist, nexists', 'logic'],
  ['\\land', '∧', 'and, logical and, wedge', 'logic'],
  ['\\lor', '∨', 'or, logical or, vee', 'logic'],
  ['\\lnot', '¬', 'not, negation, lnot', 'logic'],
  ['\\oplus', '⊻', 'exclusive or, xor', 'logic'],
  ['\\top', '⊤', 'true, top', 'logic'],
  ['\\bot', '⊥', 'false, bottom, contradiction', 'logic'],
  ['\\therefore', '∴', 'therefore, hence', 'logic'],
  ['\\because', '∵', 'because, since', 'logic'],
  ['\\square', '□', 'qed, end of proof, square', 'logic'],
  ['\\blacksquare', '■', 'qed, tombstone, black square', 'logic'],
  ['\\mathbb{N}', 'ℕ', 'natural numbers, N', 'sets'],
  ['\\mathbb{Z}', 'ℤ', 'integers, Z', 'sets'],
  ['\\mathbb{Q}', 'ℚ', 'rational numbers, Q', 'sets'],
  ['\\mathbb{R}', 'ℝ', 'real numbers, reals, R', 'sets'],
  ['\\mathbb{C}', 'ℂ', 'complex numbers, C', 'sets'],
  ['\\mathbb{P}', 'ℙ', 'prime numbers, probability, P', 'sets'],
  ['\\mathbb{H}', 'ℍ', 'quaternions, H', 'sets'],

  // big operators and calculus
  ['\\sum_{§}^{}', '∑', 'sum, sigma sum, summation, series', 'calculus'],
  ['\\prod_{§}^{}', '∏', 'product, pi product', 'calculus'],
  ['\\coprod_{§}^{}', '∐', 'coproduct', 'calculus'],
  ['\\int_{§}^{}', '∫', 'integral, integrate', 'calculus'],
  ['\\iint', '∬', 'double integral', 'calculus'],
  ['\\iiint', '∭', 'triple integral', 'calculus'],
  ['\\oint', '∮', 'contour integral, line integral, closed integral', 'calculus'],
  ['\\partial', '∂', 'partial derivative, partial, del', 'calculus'],
  ['\\nabla', '∇', 'nabla, gradient, del', 'calculus'],
  ['\\Delta', '∆', 'increment, change, laplacian, delta', 'calculus'],
  ['\\infty', '∞', 'infinity, infinite', 'calculus'],
  ['\\lim_{§ \\to }', 'lim', 'limit, lim', 'calculus'],
  ['\\frac{d}{d§}', 'd/dx', 'derivative, d by dx', 'calculus'],
  ['\\frac{\\partial}{\\partial §}', '∂/∂x', 'partial derivative operator', 'calculus'],
  ['\\bigcup_{§}', '⋃', 'big union, union of', 'calculus'],
  ['\\bigcap_{§}', '⋂', 'big intersection', 'calculus'],
  ['\\bigoplus_{§}', '⨁', 'big direct sum', 'calculus'],
  ['\\bigotimes_{§}', '⨂', 'big tensor product', 'calculus'],
  ['\\binom{§}{}', '(ⁿₖ)', 'binomial coefficient, choose, n choose k', 'calculus'],
  ['\\begin{pmatrix} § & \\\\  & \\end{pmatrix}', '', 'matrix, 2x2 matrix, pmatrix', 'calculus'],
  ['\\begin{vmatrix} § & \\\\  & \\end{vmatrix}', '', 'determinant, vmatrix', 'calculus'],
  ['\\begin{cases} § & \\\\  & \\end{cases}', '', 'cases, piecewise', 'calculus'],

  // brackets
  ['\\langle § \\rangle', '⟨⟩', 'angle brackets, inner product, langle', 'brackets'],
  ['\\lfloor § \\rfloor', '⌊⌋', 'floor', 'brackets'],
  ['\\lceil § \\rceil', '⌈⌉', 'ceiling, ceil', 'brackets'],
  ['\\left\\| § \\right\\|', '‖', 'norm, double bar', 'brackets'],
  ['\\{ § \\}', '{}', 'braces, set', 'brackets'],
  ['[ § ]', '[]', 'square brackets', 'brackets'],
  ['\\llbracket § \\rrbracket', '⟦⟧', 'double brackets, semantic brackets', 'brackets'],

  // accents
  ['\\hat{§}', 'x̂', 'hat, estimator, unit vector', 'accents'],
  ['\\bar{§}', 'x̄', 'bar, mean, average, overline', 'accents'],
  ['\\overline{§}', 'x̅', 'overline, conjugate', 'accents'],
  ['\\underline{§}', 'x̲', 'underline', 'accents'],
  ['\\vec{§}', 'x⃗', 'vector, arrow over', 'accents'],
  ['\\dot{§}', 'ẋ', 'dot, time derivative', 'accents'],
  ['\\ddot{§}', 'ẍ', 'double dot, second time derivative', 'accents'],
  ['\\tilde{§}', 'x̃', 'tilde', 'accents'],
  ['\\widehat{§}', '', 'wide hat, fourier transform', 'accents'],
  ['\\overrightarrow{§}', '', 'over right arrow, vector AB', 'accents'],
  ['\\overbrace{§}^{}', '⏞', 'overbrace', 'accents'],
  ['\\underbrace{§}_{}', '⏟', 'underbrace', 'accents'],
  ['\\mathbf{§}', '𝐱', 'bold, mathbf, vector bold', 'fonts'],
  ['\\mathit{§}', '𝑥', 'italic, mathit', 'fonts'],
  ['\\mathrm{§}', 'x', 'roman, upright, mathrm', 'fonts'],
  ['\\mathcal{§}', '𝒳', 'calligraphic, mathcal', 'fonts'],
  ['\\mathscr{§}', '𝓍', 'script, mathscr', 'fonts'],
  ['\\mathfrak{§}', '𝔵', 'fraktur, gothic, mathfrak', 'fonts'],
  ['\\mathbb{§}', '𝕩', 'blackboard bold, double struck, mathbb', 'fonts'],
  ['\\text{§}', 'Aa', 'text, words', 'fonts'],

  // letters and constants
  ['\\hbar', 'ℏ', 'h bar, reduced planck constant, dirac constant', 'letters'],
  ['\\ell', 'ℓ', 'script l, ell, length', 'letters'],
  ['\\aleph', 'ℵ', 'aleph, cardinality', 'letters'],
  ['\\beth', 'ℶ', 'beth', 'letters'],
  ['\\wp', '℘', 'weierstrass p', 'letters'],
  ['\\Re', 'ℜ', 'real part', 'letters'],
  ['\\Im', 'ℑ', 'imaginary part', 'letters'],
  ['i', 'i', 'imaginary unit', 'letters'],
  ['e', 'e', 'euler number, e', 'letters'],
  ['\\AA', 'Å', 'angstrom', 'letters'],
  ['\\mho', '℧', 'mho, siemens', 'letters'],
  ['\\Omega', 'Ω', 'ohm, omega', 'letters'],
  ['\\mu', 'µ', 'micro, mu', 'letters'],
  ['\\degree C', '℃', 'degrees celsius', 'letters'],
  ['\\degree F', '℉', 'degrees fahrenheit', 'letters'],

  // dots, misc
  ['\\dots', '…', 'dots, ellipsis, and so on', 'misc'],
  ['\\cdots', '⋯', 'center dots, cdots', 'misc'],
  ['\\vdots', '⋮', 'vertical dots', 'misc'],
  ['\\ddots', '⋱', 'diagonal dots', 'misc'],
  ['\\angle', '∠', 'angle', 'misc'],
  ['\\measuredangle', '∡', 'measured angle', 'misc'],
  ['\\triangle', '△', 'triangle', 'misc'],
  ['\\diamond', '⋄', 'diamond', 'misc'],
  ['\\clubsuit', '♣', 'clubs', 'misc'],
  ['\\heartsuit', '♡', 'hearts', 'misc'],
  ['\\spadesuit', '♠', 'spades', 'misc'],
  ['\\diamondsuit', '♢', 'diamonds', 'misc'],
  ['\\checkmark', '✓', 'check, tick, checkmark', 'misc'],
  ['\\S', '§', 'section sign, paragraph', 'misc'],
  ['\\P', '¶', 'pilcrow, paragraph mark', 'misc'],
  ['\\copyright', '©', 'copyright', 'misc'],
  ['\\pounds', '£', 'pound sign', 'misc'],
  ['\\euro', '€', 'euro sign', 'misc'],
  ['\\$', '$', 'dollar sign', 'misc'],
  ['\\yen', '¥', 'yen sign', 'misc'],
  ['\\quad', ' ', 'space, quad', 'misc'],
  ['\\,', ' ', 'thin space', 'misc'],
]

/* Super- and subscripts, and fractions with a single character (Unicode only; LaTeX writes them with ^ _ \frac). */
const SUPERS = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', x: 'ˣ' }
const SUBS = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', o: 'ₒ', x: 'ₓ', n: 'ₙ', i: 'ᵢ', k: 'ₖ' }
const FRACTIONS = [['1', '2', '½'], ['1', '3', '⅓'], ['2', '3', '⅔'], ['1', '4', '¼'], ['3', '4', '¾'], ['1', '5', '⅕'], ['2', '5', '⅖'], ['3', '5', '⅗'], ['4', '5', '⅘'], ['1', '6', '⅙'], ['5', '6', '⅚'], ['1', '7', '⅐'], ['1', '8', '⅛'], ['3', '8', '⅜'], ['5', '8', '⅝'], ['7', '8', '⅞'], ['1', '9', '⅑'], ['1', '10', '⅒']]
const SUPER_NAMES = { '+': 'plus', '-': 'minus', '=': 'equals', '(': 'open bracket', ')': 'close bracket' }
for (const [key, char] of Object.entries(SUPERS)) RAW.push([`^{${key}}`, char, `superscript ${SUPER_NAMES[key] ?? key}, power ${key}, to the ${key}`, 'scripts'])
for (const [key, char] of Object.entries(SUBS)) RAW.push([`_{${key}}`, char, `subscript ${SUPER_NAMES[key] ?? key}, index ${key}, sub ${key}`, 'scripts'])
for (const [top, bottom, char] of FRACTIONS) RAW.push([`\\frac{${top}}{${bottom}}`, char, `${top}/${bottom}, fraction ${top} over ${bottom}`, 'scripts'])

export const CATALOG_GROUPS = ['greek', 'relations', 'signs', 'arrows', 'sets', 'logic', 'calculus', 'brackets', 'accents', 'fonts', 'letters', 'scripts', 'misc']

/* As the symbol panel uses them: { id, group, show, plain, latex, unicode, names }. */
export const SYMBOL_CATALOG = RAW.map(([latex, unicode, names, group], index) => {
  const command = latex.includes('§') ? latex : latex && /^\\[a-zA-Z]+$/.test(latex) ? `${latex} ` : latex
  return {
    id: `c${index}`,
    group,
    show: unicode || latex.replace(/§/g, '').replace(/\\(begin|end)\{(\w+)\}/g, '$2'),
    latex: command || unicode,
    unicode: unicode || latex,
    // What the calculator reads: the character where it knows it, else the LaTeX.
    plain: unicode && !/[̀-ͯ⃗]/.test(unicode) && unicode.length <= 2 ? unicode : command || unicode,
    names,
  }
})

/** Catalog entries for a query (every word must match a name, the command or the character). */
export function searchCatalog(query) {
  const words = String(query ?? '').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  if (!words.length) return SYMBOL_CATALOG
  return SYMBOL_CATALOG.filter((symbol) => {
    const haystack = `${symbol.names} ${symbol.latex} ${symbol.unicode}`.toLocaleLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}
