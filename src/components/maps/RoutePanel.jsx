import { useTranslation } from 'react-i18next'
import { formatDistance, formatDuration } from '../../lib/maps/geo.js'
import { ROUTE_PROFILES, updateMapsSettings, useMapsSettings } from '../../lib/maps/mapsSettings.js'
import { PROFILE_ICONS, externalRouteUrl, stepIcon, stepInstruction } from '../../lib/maps/routing.js'
import MapsSearch from './MapsSearch.jsx'
import { ExternalLink, MapsIcon, MapsIconButton, MapsSpinner } from './ui.jsx'

function waypointLabel(point, t) {
  if (!point) return ''
  if (point.isUserLocation) return t('route.yourLocation')
  return point.name || point.address || `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`
}

function StepText({ step }) {
  const { t } = useTranslation('maps')
  const instruction = stepInstruction(step)
  return t(instruction.key, {
    direction: t(`route.directions.${instruction.modifier}`),
    name: instruction.name,
    exit: instruction.exit,
  })
}

/**
 * Directions: start + destination (search, your location, or pick on map),
 * travel mode, alternative routes and turn-by-turn steps.
 */
export default function RoutePanel({
  waypoints,
  routes,
  activeIndex,
  status,
  error,
  near,
  pickTarget,
  onChangeWaypoint,
  onPick,
  onUseLocation,
  onSwap,
  onSelectRoute,
  onFocusStep,
  onClose,
}) {
  const { t } = useTranslation('maps')
  const settings = useMapsSettings()
  const profile = settings.routeProfile
  const active = routes[activeIndex]
  const [from, to] = waypoints

  const quickOptions = (index) => [
    {
      id: 'location',
      icon: 'my_location',
      label: t('route.yourLocation'),
      sublabel: '',
      onSelect: () => onUseLocation(index),
    },
    {
      id: 'pick',
      icon: 'ads_click',
      label: t('route.pickOnMap'),
      sublabel: '',
      onSelect: () => onPick(index),
    },
    ...settings.favorites.slice(0, 5).map((place) => ({
      id: `fav-${place.key}`,
      icon: 'favorite',
      place,
    })),
  ]

  return (
    <div className="maps-route-panel">
      <header className="maps-place__head">
        <h2>{t('route.title')}</h2>
        <MapsIconButton icon="close" label={t('common.close')} onClick={onClose} />
      </header>

      <div className="maps-profiles" role="radiogroup" aria-label={t('route.mode')}>
        {ROUTE_PROFILES.map((entry) => (
          <button
            key={entry}
            type="button"
            role="radio"
            aria-checked={profile === entry}
            className={`maps-profile${profile === entry ? ' maps-profile--active' : ''}`}
            onClick={() => updateMapsSettings({ routeProfile: entry })}
            title={t(`route.profiles.${entry}`)}
          >
            <MapsIcon>{PROFILE_ICONS[entry]}</MapsIcon>
            <span>{t(`route.profiles.${entry}`)}</span>
          </button>
        ))}
      </div>

      <div className="maps-waypoints">
        <div className="maps-waypoints__fields">
          <div className={`maps-waypoint${pickTarget === 0 ? ' maps-waypoint--picking' : ''}`}>
            <MapsSearch
              compact
              icon="trip_origin"
              value={waypointLabel(from, t)}
              placeholder={pickTarget === 0 ? t('route.clickMap') : t('route.from')}
              near={near}
              extraOptions={quickOptions(0)}
              onSelect={(place) => onChangeWaypoint(0, place)}
              onClear={() => onChangeWaypoint(0, null)}
            />
          </div>
          <div className={`maps-waypoint${pickTarget === 1 ? ' maps-waypoint--picking' : ''}`}>
            <MapsSearch
              compact
              icon="location_on"
              value={waypointLabel(to, t)}
              placeholder={pickTarget === 1 ? t('route.clickMap') : t('route.to')}
              near={near}
              extraOptions={quickOptions(1)}
              onSelect={(place) => onChangeWaypoint(1, place)}
              onClear={() => onChangeWaypoint(1, null)}
            />
          </div>
        </div>
        <MapsIconButton icon="swap_vert" label={t('route.swap')} onClick={onSwap} />
      </div>

      {status === 'loading' && <p className="maps-hint"><MapsSpinner label={t('route.loading')} /> {t('route.loading')}</p>}
      {status === 'error' && (
        <p className="maps-error" role="alert">{error === 'no_route' ? t('route.noRoute') : t('route.error')}</p>
      )}
      {status === 'idle' && (!from || !to) && <p className="maps-hint">{t('route.hint')}</p>}

      {routes.length > 0 && (
        <ul className="maps-route-options">
          {routes.map((route, index) => (
            <li key={index}>
              <button
                type="button"
                className={`maps-route-option${index === activeIndex ? ' maps-route-option--active' : ''}`}
                onClick={() => onSelectRoute(index)}
              >
                <MapsIcon>{PROFILE_ICONS[profile]}</MapsIcon>
                <strong>{formatDuration(route.duration)}</strong>
                <span>{formatDistance(route.distance, settings.units)}</span>
                {index === 0 && routes.length > 1 && <small>{t('route.fastest')}</small>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {active && (
        <>
          <ol className="maps-steps">
            {active.steps.map((step, index) => (
              <li key={index}>
                <button type="button" onClick={() => onFocusStep(step)}>
                  <MapsIcon>{stepIcon(step)}</MapsIcon>
                  <span className="maps-steps__text"><StepText step={step} /></span>
                  {step.distance > 0 && <small>{formatDistance(step.distance, settings.units)}</small>}
                </button>
              </li>
            ))}
          </ol>

          <p className="maps-hint">
            {t('route.attribution')}{' '}
            {from && to && (
              <ExternalLink href={externalRouteUrl(from, to, profile)}>
                {t('route.openOsm')} <MapsIcon>open_in_new</MapsIcon>
              </ExternalLink>
            )}
          </p>
        </>
      )}
    </div>
  )
}
