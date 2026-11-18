import { useEffect, useMemo, useState } from 'react'

/*
 * LaTeX drawn with KaTeX, for showing what was typed exactly (notes, \mathbb{R},
 * intervals, half-finished lines the calculator can't work out). KaTeX and
 * its fonts load the first time something is shown. `trust: false` keeps
 * \href, \url and the like out, so typed text can't become links or HTML.
 * While it loads, or when the LaTeX isn't valid (yet), `fallback` is shown.
 */

let loading = null
const loadKatex = () => {
  loading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([module]) => module.default ?? module)
  return loading
}

export function useKatex() {
  const [katex, setKatex] = useState(null)
  useEffect(() => {
    let alive = true
    loadKatex()
      .then((module) => alive && setKatex(() => module))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return katex
}

/** The maths of a line of notes as one LaTeX string ($…$ parts joined), or null when it has no LaTeX. */
export function latexOf(text) {
  const source = String(text ?? '').trim()
  if (!source) return null
  if (source.includes('$')) {
    const parts = [...source.matchAll(/\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g)].map((match) => (match[1] ?? match[2]).trim()).filter(Boolean)
    return parts.length ? parts.join(' \\qquad ') : null
  }
  return source.includes('\\') ? source : null
}

/* 0,5 is a decimal comma (no space after it), but not in sets: \{-2,2\} lists two numbers. */
function decimalCommas(latex) {
  let depth = 0
  let out = ''
  for (let index = 0; index < latex.length; index++) {
    if (latex.startsWith('\\{', index)) depth++
    if (latex.startsWith('\\}', index)) depth = Math.max(0, depth - 1)
    const char = latex[index]
    if (char === ',' && !depth && /\d/.test(latex[index - 1] ?? '') && /\d/.test(latex[index + 1] ?? '')) out += '{,}'
    else out += char
  }
  return out
}

export default function TeX({ latex, display = false, className = '', fallback = null }) {
  const katex = useKatex()
  const html = useMemo(() => {
    if (!katex || !latex) return null
    try {
      // \displaystyle: fractions full size in a line too, as written in a notebook.
      return katex.renderToString(display ? decimalCommas(latex) : `\\displaystyle ${decimalCommas(latex)}`, { displayMode: display, throwOnError: true, strict: 'ignore', trust: false, maxSize: 20, maxExpand: 300, output: 'htmlAndMathml' })
    } catch {
      return null
    }
  }, [katex, latex, display])
  if (!html) return fallback
  // KaTeX's own markup (with trust off it holds no links, scripts or styles from the input).
  return <span className={`dash-tex ${className}`.trim()} dangerouslySetInnerHTML={{ __html: html }} />
}
