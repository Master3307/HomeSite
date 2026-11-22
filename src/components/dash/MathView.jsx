import { Fragment, createContext, useContext, useEffect, useRef, useState } from 'react'

import { normalizeMath, parseMath } from '../../lib/dashMath.js'

/*
 * Typeset maths from the calculator's tree (lib/dashMath.js): stacked
 * fractions, roots with a bar, raised powers, |abs|, upright function names
 * and italic variables. Plain HTML + CSS (dash.css, .dash-math), no library.
 */

const GREEK = { theta: 'ϑ', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', eta: 'η', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', rho: 'ρ', sigma: 'σ', omega: 'ω', phi: 'φ', tau: 'τ' }
const CONST = { pi: 'π', e: 'e', tau: 'τ', phi: 'φ', infinity: '∞' }
const FUNCTION_NAMES = { asin: 'arcsin', acos: 'arccos', atan: 'arctan', lg: 'lg', ncr: 'nCr', npr: 'nPr', sgn: 'sgn' }

const PREC = { pm: 1, chain: 0, eq: 0, unit: 8, ucall: 7, add: 1, sub: 1, mul: 2, mod: 2, div: 4, neg: 3, pow: 5, pct: 6, deg: 6, call: 7, num: 8, const: 8, var: 8 }
const precOf = (node) => (node.type === 'num' && node.value < 0 ? 3 : PREC[node.type] ?? 8)

const Paren = ({ children }) => (
  <span className="dash-math__group">
    <span className="dash-math__paren">(</span>
    {children}
    <span className="dash-math__paren">)</span>
  </span>
)

const numberText = (value) => {
  if (!Number.isFinite(value)) return '∞'
  const text = String(value)
  if (!text.includes('e')) return text
  const [m, e] = text.split('e')
  return (
    <>
      {m}·10<sup>{Number(e)}</sup>
    </>
  )
}

/* Products that read without a dot: 2x, 3π, 2 sin x, x y, 2(…). */
const juxtaposes = (left, right) => {
  const r = right.type === 'pow' ? right.base : right
  if (r.type === 'num') return false
  if (r.type === 'unit' && ['num', 'neg', 'div', 'mul'].includes(left.type)) return true
  if (left.type === 'num' || left.type === 'var' || left.type === 'const' || left.type === 'pow') return ['var', 'const', 'call', 'ucall', 'add', 'sub'].includes(r.type) || (r.type === 'pow' && r.base.type !== 'num')
  return false
}

function render(node, parent = 0) {
  const wrap = (child, minimum) => (precOf(child) < minimum ? <Paren>{render(child)}</Paren> : render(child, minimum))
  let out
  switch (node.type) {
    case 'num':
      out = <span className="dash-math__num">{numberText(node.value)}</span>
      break
    case 'const':
      out = <span className={node.name === 'e' ? 'dash-math__var' : 'dash-math__const'}>{CONST[node.name] ?? node.name}</span>
      break
    case 'var':
      out = <Slot name={node.name} />
      break
    case 'add':
      out = (
        <>
          {wrap(node.left, 1)}
          <span className="dash-math__op">+</span>
          {node.right.type === 'neg' ? <Paren>{render(node.right)}</Paren> : wrap(node.right, 1)}
        </>
      )
      break
    case 'pm':
      out = (
        <>
          {node.left && wrap(node.left, 1)}
          <span className={node.left ? 'dash-math__op' : 'dash-math__sign'}>±</span>
          {wrap(node.right, 2)}
        </>
      )
      break
    case 'sub':
      out = (
        <>
          {wrap(node.left, 1)}
          <span className="dash-math__op">−</span>
          {wrap(node.right, 2)}
        </>
      )
      break
    case 'mul':
      // Written with brackets: f(x), 2(3 + 4).
      if (node.bracket) {
        out = (
          <>
            {wrap(node.left, 2)}
            <Paren>{render(node.right)}</Paren>
          </>
        )
        break
      }
      out = juxtaposes(node.left, node.right) ? (
        <>
          {wrap(node.left, 2)}
          <span className="dash-math__thin" />
          {wrap(node.right, 3)}
        </>
      ) : (
        <>
          {wrap(node.left, 2)}
          <span className="dash-math__op">·</span>
          {wrap(node.right, 3)}
        </>
      )
      break
    case 'mod':
      out = (
        <>
          {wrap(node.left, 2)}
          <span className="dash-math__op dash-math__fn">mod</span>
          {wrap(node.right, 3)}
        </>
      )
      break
    case 'div':
      out = (
        <span className="dash-math__frac">
          <span className="dash-math__num-part">{render(node.left)}</span>
          <span className="dash-math__den">{render(node.right)}</span>
        </span>
      )
      break
    case 'neg':
      out = (
        <>
          <span className="dash-math__sign">−</span>
          {wrap(node.value, 3)}
        </>
      )
      break
    case 'pct':
      out = <>{wrap(node.value, 6)}%</>
      break
    case 'deg':
      out = <>{wrap(node.value, 6)}°</>
      break
    case 'pow': {
      const base = node.base
      // sin²x reads better than (sin x)²
      if (base.type === 'call' && base.args.length === 1 && !['sqrt', 'cbrt', 'root4', 'abs', 'fact', 'root', 'nthroot'].includes(base.name)) {
        out = (
          <>
            <span className="dash-math__fn">{FUNCTION_NAMES[base.name] ?? base.name}</span>
            <sup className="dash-math__sup">{render(node.exp)}</sup>
            {argument(base.args[0])}
          </>
        )
        break
      }
      out = (
        <>
          {precOf(base) < 7 || (base.type === 'num' && base.value < 0) ? <Paren>{render(base)}</Paren> : render(base)}
          <sup className="dash-math__sup">{render(node.exp)}</sup>
        </>
      )
      break
    }
    case 'call':
      out = call(node)
      break
    case 'chain':
      out = node.parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && <span className="dash-math__op">{node.ops?.[index - 1] ?? '='}</span>}
          {render(part)}
        </Fragment>
      ))
      break
    case 'unit':
      out = <span className="dash-math__unit">{node.unit.label}</span>
      break
    case 'ucall':
      out = (
        <>
          <var className="dash-math__var">{node.name}</var>
          <Paren>
            {node.args.map((arg, index) => (
              <Fragment key={index}>
                {index > 0 && <span className="dash-math__comma">, </span>}
                {render(arg)}
              </Fragment>
            ))}
          </Paren>
        </>
      )
      break
    case 'eq':
      out = (
        <>
          {render(node.left)}
          <span className="dash-math__op">=</span>
          {render(node.right)}
        </>
      )
      break
    default:
      out = null
  }
  return parent > precOf(node) && node.type !== 'div' ? <Paren>{out}</Paren> : out
}

/* sin x without brackets when the argument is short, sin(…) otherwise. */
function argument(arg) {
  const simple = ['num', 'var', 'const'].includes(arg.type) || (arg.type === 'mul' && ['num'].includes(arg.left.type) && ['var', 'const'].includes(arg.right.type))
  return simple ? (
    <>
      <span className="dash-math__thin" />
      {render(arg)}
    </>
  ) : (
    <Paren>{render(arg)}</Paren>
  )
}

function Root({ index = null, children }) {
  return (
    <span className="dash-math__root">
      {index && <span className="dash-math__index">{index}</span>}
      <span className="dash-math__radical" aria-hidden="true">
        √
      </span>
      <span className="dash-math__radicand">{children}</span>
    </span>
  )
}

function call(node) {
  const [a, b] = node.args
  switch (node.name) {
    case 'sqrt':
      return <Root>{render(a)}</Root>
    case 'cbrt':
      return <Root index="3">{render(a)}</Root>
    case 'root4':
      return <Root index="4">{render(a)}</Root>
    case 'root':
    case 'nthroot':
      return <Root index={b ? render(b) : null}>{render(a)}</Root>
    case 'abs':
      return (
        <span className="dash-math__group">
          <span className="dash-math__bar">|</span>
          {render(a)}
          <span className="dash-math__bar">|</span>
        </span>
      )
    case 'fact':
      return <>{precOf(a) < 7 ? <Paren>{render(a)}</Paren> : render(a)}!</>
    case 'exp':
      return (
        <>
          <span className="dash-math__var">e</span>
          <sup className="dash-math__sup">{render(a)}</sup>
        </>
      )
    case 'log':
      if (b)
        return (
          <>
            <span className="dash-math__fn">log</span>
            <sub className="dash-math__sub">{render(b)}</sub>
            {argument(a)}
          </>
        )
      break
    case 'log2':
    case 'log10':
      return (
        <>
          <span className="dash-math__fn">log</span>
          <sub className="dash-math__sub">{node.name.slice(3)}</sub>
          {argument(a)}
        </>
      )
    default:
  }
  if (node.args.length === 1 && !['floor', 'ceil', 'round', 'trunc', 'min', 'max', 'gcd', 'lcm', 'sum', 'avg', 'mean', 'hypot'].includes(node.name)) {
    return (
      <>
        <span className="dash-math__fn">{FUNCTION_NAMES[node.name] ?? node.name}</span>
        {argument(a)}
      </>
    )
  }
  if (node.name === 'floor' || node.name === 'ceil') {
    const [open, close] = node.name === 'floor' ? ['⌊', '⌋'] : ['⌈', '⌉']
    return (
      <span className="dash-math__group">
        <span className="dash-math__paren">{open}</span>
        {render(a)}
        <span className="dash-math__paren">{close}</span>
      </span>
    )
  }
  return (
    <>
      <span className="dash-math__fn">{FUNCTION_NAMES[node.name] ?? node.name}</span>
      <Paren>
        {node.args.map((arg, index) => (
          <Fragment key={index}>
            {index > 0 && <span className="dash-math__comma">, </span>}
            {render(arg)}
          </Fragment>
        ))}
      </Paren>
    </>
  )
}

/* A letter: x_2, v_max (after _ as a subscript), Δs, Greek names as letters. */
function Letter({ name }) {
  const [base, ...sub] = name.split('_')
  return (
    <var className="dash-math__var">
      {GREEK[base.toLowerCase()] ?? (base === 'pH' || base === 'pOH' ? <span className="dash-math__upright">{base}</span> : base)}
      {sub.length > 0 && <sub className="dash-math__sub">{sub.join(',')}</sub>}
    </var>
  )
}

/*
 * The formula calculator (components/dash/science/Formulas.jsx) makes the
 * letters buttons: click one and type its value right there; the value (or
 * the result) sits under the letter. { names, values, results, onChange, alias }
 */
export const SlotContext = createContext(null)

function Slot({ name }) {
  const context = useContext(SlotContext)
  const [editing, setEditing] = useState(false)
  const input = useRef(null)
  useEffect(() => {
    if (editing) input.current?.focus()
  }, [editing])
  const key = context?.alias?.[name] ?? name
  if (!context || !context.names.includes(key)) return <Letter name={name} />
  const value = context.values[key] ?? ''
  const result = context.results?.[key]
  const label = context.label?.(key) ?? key
  return (
    <span className={`dash-math__slot${value !== '' ? ' is-set' : ''}${result ? ' is-result' : ''}`}>
      {editing ? (
        <input
          ref={input}
          className="dash-math__slot-input"
          value={value}
          inputMode="decimal"
          aria-label={context.inputLabel?.(key) ?? label}
          onChange={(event) => context.onChange(key, event.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'Escape') {
              event.preventDefault()
              setEditing(false)
            }
          }}
          style={{ width: `${Math.max(3, String(value).length + 1)}ch` }}
        />
      ) : (
        <button type="button" className="dash-math__slot-button" onClick={() => setEditing(true)} title={label} aria-label={`${label}${value !== '' ? `: ${value}` : result ? `: ${result}` : ''}`}>
          <Letter name={name} />
        </button>
      )}
      {(value !== '' || result) && !editing && (
        <span className="dash-math__slot-value" aria-hidden="true">
          {value !== '' ? value : result}
        </span>
      )}
    </span>
  )
}

/** `tree` / `trees` from analyze(), or `text` to parse here. Nothing when it isn't maths. */
export default function MathView({ tree = null, trees = null, text = '', names = [], className = '' }) {
  if (trees?.length > 1)
    return (
      <span className={`dash-math dash-math--several ${className}`.trim()}>
        {trees.map((entry, index) => (
          <span key={index} className="dash-math__statement">
            {render(entry)}
          </span>
        ))}
      </span>
    )
  let node = tree ?? trees?.[0] ?? null
  if (!node && text) {
    try {
      node = parseMath(normalizeMath(text), { names, words: true })
    } catch {
      node = null
    }
  }
  if (!node) return null
  return <span className={`dash-math ${className}`.trim()}>{render(node)}</span>
}
