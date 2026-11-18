import { useEffect, useReducer } from 'react'
import { useTranslation } from 'react-i18next'

import { loadTaps, PENDING_EVENT, sending, TAPS_EVENT, unconfirmed } from '/src/lib/members'
import RollingNumber from './RollingNumber'

/*
 * How often the lobby cat tapped and was petted, everyone together (and you,
 * when logged in). Your own taps and pets show up at once (optimistically:
 * the server's totals + what is still on its way); the numbers never step
 * back while the server catches up.
 */

const grow = (previous, next) => (previous === undefined || next > previous ? next : previous)

/* Server totals + unconfirmed own counts; shown values only ever grow (a batch is counted once, either side). */
function reduce(state, action) {
  const server = action.server ?? state.server
  const extra = action.extra ?? state.extra
  if (!server) return { ...state, extra }
  const pets = server.pets ?? { total: 0 }
  const loggedIn = server.mine !== null && server.mine !== undefined
  const shown = {
    taps: grow(state.shown.taps, server.total + extra.tap),
    pets: grow(state.shown.pets, pets.total + extra.pet),
    myTaps: loggedIn ? grow(state.shown.myTaps, server.mine + extra.tap) : null,
    myPets: loggedIn ? grow(state.shown.myPets, (server.myPets ?? 0) + extra.pet) : null,
  }
  return { server, extra, shown }
}

/** `variant`: full (/cult) | compact (one short line, the dash) | mine (only your own, when logged in). */
export default function TapCounter({ variant = 'full', className = '' }) {
  const { t } = useTranslation('cult')
  const [{ server, shown }, dispatch] = useReducer(reduce, { server: null, extra: { ...unconfirmed }, shown: {} })

  useEffect(() => {
    let alive = true
    loadTaps()
      .then((data) => alive && dispatch({ server: data }))
      .catch(() => {})
    // Everyone's taps and pets too: the totals are checked every few seconds while the page is visible.
    const poll = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      loadTaps()
        // Skipped while own taps are on their way: the totals may already contain them.
        .then((data) => alive && !sending() && dispatch({ server: data }))
        .catch(() => {})
    }, 5000)
    const onTaps = (event) => dispatch({ server: event.detail, extra: event.detail.pending })
    const onPending = (event) => dispatch({ extra: event.detail })
    window.addEventListener(TAPS_EVENT, onTaps)
    window.addEventListener(PENDING_EVENT, onPending)
    return () => {
      alive = false
      clearInterval(poll)
      window.removeEventListener(TAPS_EVENT, onTaps)
      window.removeEventListener(PENDING_EVENT, onPending)
    }
  }, [])

  if (!server) return null
  const pets = server.pets ?? { total: 0, members: 0, guests: 0 }
  const loggedIn = shown.myTaps !== null && shown.myTaps !== undefined
  const taps = shown.taps
  const petsTotal = shown.pets
  const myTaps = shown.myTaps
  const myPets = shown.myPets

  const row = (icon, total, mine, split, label) => (
    <p title={t('taps.split', { members: split.members.toLocaleString(), guests: split.guests.toLocaleString() })}>
      <span className="material-symbols-outlined" aria-hidden="true">
        {icon}
      </span>
      <strong>
        <RollingNumber value={total} />
      </strong>
      <span className="tap-counter__what">{label}</span>
      {loggedIn && (
        <span className="tap-counter__mine">
          <RollingNumber value={mine} /> {t('taps.byYou')}
        </span>
      )}
    </p>
  )

  if (variant !== 'full') {
    const showMine = variant === 'mine' && loggedIn
    return (
      <p className={`tap-counter tap-counter--compact ${className}`.trim()} aria-label={t('taps.label')}>
        <span title={t('taps.taps')}>
          <span className="material-symbols-outlined" aria-hidden="true">
            touch_app
          </span>
          <RollingNumber value={showMine ? myTaps : taps} />
        </span>
        <span title={t('taps.pets')}>
          <span className="material-symbols-outlined" aria-hidden="true">
            pets
          </span>
          <RollingNumber value={showMine ? myPets : petsTotal} />
        </span>
      </p>
    )
  }

  // Sits under the lobby cat, on the line it stands on (cult.css).
  return (
    <div className="tap-counter" aria-label={t('taps.label')} role="group">
      {row('touch_app', taps, myTaps, server, t('taps.taps'))}
      {row('pets', petsTotal, myPets, pets, t('taps.pets'))}
    </div>
  )
}
