import { useEffect, useLayoutEffect, useRef } from 'react'

/*
 * A number whose digits roll like an odometer (up when it grows, down when
 * it shrinks). Every changed digit slides to its place in the same short
 * time, so a jump of thousands is as quick as +1.
 *
 * At rest it is just the plain number (normal text, exactly like the
 * text around it). Only while it changes, the plain number is hidden and
 * the rolling digits laid over it slide to the new value. No hop or
 * bounce: each digit glides (a soft ease-out, faded at the edges of its
 * window), the ones first and the higher digits a moment later, like a
 * mechanical counter.
 */

const DIGITS = '0123456789'
const ROLL_MS = 620
const STAGGER_MS = 28

export default function RollingNumber({ value, locale = undefined, className = '' }) {
  const text = Math.max(0, Math.round(Number(value) || 0)).toLocaleString(locale)
  const root = useRef(null)
  const timer = useRef(null)
  const previous = useRef(text)

  // Before the paint: the frame with the new number already shows the rolling digits (no flash of the plain one).
  useLayoutEffect(() => {
    if (previous.current === text) return
    previous.current = text
    // The rolling digits show only while they move.
    root.current?.classList.add('is-rolling')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => root.current?.classList.remove('is-rolling'), ROLL_MS + STAGGER_MS * 6)
  }, [text])

  useEffect(() => () => clearTimeout(timer.current), [])

  const characters = [...text]
  return (
    <span ref={root} className={`rolling-number ${className}`} aria-label={text} role="text">
      <span className="rolling-number__ghost" aria-hidden="true">
        {text}
      </span>
      <span className="rolling-number__roll" aria-hidden="true">
        {characters.map((character, index) => {
          // Keyed from the right, so the ones stay the ones when a digit is added in front.
          const key = characters.length - index
          if (!DIGITS.includes(character)) {
            return (
              <span key={`s${key}`} className="rolling-number__separator">
                {character}
              </span>
            )
          }
          return (
            <span key={`d${key}`} className="rolling-number__digit">
              <span className="rolling-number__strip" style={{ '--digit': Number(character), transitionDelay: `${Math.min(key - 1, 6) * STAGGER_MS}ms` }}>
                {DIGITS.split('').map((digit) => (
                  <span key={digit}>{digit}</span>
                ))}
              </span>
            </span>
          )
        })}
      </span>
    </span>
  )
}
