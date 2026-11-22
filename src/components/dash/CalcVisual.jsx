import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

/*
 * What a time or a colour looks like, over the calculator's answers in the
 * search box: a white clock whose hands sweep to the time (and keep going for
 * a live time in a zone), or a swatch with a picker and the screen eyedropper.
 */

function Clock({ clock }) {
  const [now, setNow] = useState(() => Date.now())
  const [shown, setShown] = useState(false)
  useEffect(() => {
    // Start at 12 and sweep to the time (no sweep with reduced motion: the CSS turns the transition off).
    const frame = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  useEffect(() => {
    if (!clock.live) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [clock.live])
  let { h, m, s } = clock
  if (clock.live) {
    const at = new Date(now + (clock.offset ?? 0) * 60000)
    ;[h, m, s] = [at.getUTCHours(), at.getUTCMinutes(), at.getUTCSeconds()]
  }
  const turn = (value) => (shown ? value : 0)
  const hour = turn(((h % 12) + m / 60) * 30)
  const minute = turn((m + s / 60) * 6)
  const second = turn(s * 6)
  return (
    <svg className={`calc-clock${clock.live ? ' is-live' : ''}`} viewBox="0 0 100 100" role="img" aria-label={`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`}>
      <circle cx="50" cy="50" r="47" className="calc-clock__face" />
      {Array.from({ length: 60 }, (_, index) => (
        <line key={index} x1="50" y1={index % 5 ? 7 : 6} x2="50" y2={index % 5 ? 9.5 : 13} className={index % 5 ? 'calc-clock__tick' : 'calc-clock__hour-tick'} transform={`rotate(${index * 6} 50 50)`} />
      ))}
      <line x1="50" y1="55" x2="50" y2="27" className="calc-clock__hour" style={{ transform: `rotate(${hour}deg)` }} />
      <line x1="50" y1="57" x2="50" y2="15" className="calc-clock__minute" style={{ transform: `rotate(${minute}deg)` }} />
      {(clock.live || s) && <line x1="50" y1="60" x2="50" y2="12" className="calc-clock__second" style={{ transform: `rotate(${second}deg)` }} />}
      <circle cx="50" cy="50" r="2.6" className="calc-clock__pin" />
    </svg>
  )
}

function Swatch({ color, onQuery }) {
  const { t } = useTranslation('calc')
  const canDrop = typeof window !== 'undefined' && 'EyeDropper' in window
  return (
    <div className="calc-swatch" style={{ '--swatch': color.hex, '--alpha': color.a }}>
      <span className="calc-swatch__color" aria-hidden="true">
        <span style={{ color: '#fff' }}>Aa</span>
        <span style={{ color: '#000' }}>Aa</span>
      </span>
      <div className="calc-swatch__tools">
        <label className="calc-swatch__pick" title={t('labels.pickColor')}>
          <input type="color" value={color.hex} onChange={(event) => onQuery(event.target.value)} aria-label={t('labels.pickColor')} />
          <span className="material-symbols-outlined" aria-hidden="true">
            palette
          </span>
        </label>
        {canDrop && (
          <button
            type="button"
            className="calc-swatch__pick"
            title={t('labels.eyedropper')}
            aria-label={t('labels.eyedropper')}
            onMouseDown={(event) => event.preventDefault()}
            onClick={async () => {
              try {
                const picked = await new window.EyeDropper().open()
                if (picked?.sRGBHex) onQuery(picked.sRGBHex)
              } catch {
                // cancelled
              }
            }}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              colorize
            </span>
          </button>
        )}
      </div>
    </div>
  )
}

export default function CalcVisual({ result, onQuery }) {
  if (result?.clock) return <Clock key={`${result.clock.h}:${result.clock.m}:${result.clock.live}`} clock={result.clock} />
  if (result?.color) return <Swatch color={result.color} onQuery={onQuery} />
  return null
}
