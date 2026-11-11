import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CssSettings } from '../dash/DashSettings.jsx'
import { BASE_LAYERS } from '../../lib/maps/layers.js'
import {
  MAP_THEMES,
  OSM_SERVERS,
  PHOTO_SOURCES,
  ROUTE_PROFILES,
  TILE_FILTERS,
  UNITS,
  isMapsAccountSyncAvailable,
  normalizeMapsSettings,
  replaceMapsSettings,
  resetMapsSettings,
  updateMapsSettings,
  useMapsSettings,
} from '../../lib/maps/mapsSettings.js'
import {
  getOsmServer,
  isOsmLoginConfigured,
  logoutOsm,
  startOsmLogin,
  useOsmAuth,
} from '../../lib/maps/osm.js'
import {
  isMapillaryConfigured,
  forgetPanoramaxToken,
  panoramaxUploadsUrl,
  requestPanoramaxToken,
  usePanoramaxToken,
  verifyPanoramaxToken,
} from '../../lib/maps/photos.js'
import { PROFILE_ICONS } from '../../lib/maps/routing.js'
import {
  isWikimediaLoginConfigured,
  logoutWikimedia,
  startWikimediaLogin,
  useWikimediaAuth,
} from '../../lib/maps/wikimedia.js'
import { ExternalLink, MapsIcon, MapsIconButton, MapsSpinner } from './ui.jsx'

const TABS = [
  { id: 'appearance', icon: 'palette' },
  { id: 'map', icon: 'map' },
  { id: 'accounts', icon: 'account_circle' },
  { id: 'css', icon: 'format_paint' },
  { id: 'data', icon: 'save' },
]

function Check({ checked, onChange, children }) {
  return (
    <label className="maps-check">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{children}</span>
    </label>
  )
}

/* ---------- appearance ---------- */

function AppearanceSettings() {
  const { t } = useTranslation('maps')
  const settings = useMapsSettings()

  return (
    <div className="maps-settings__panel">
      <h3>{t('settings.appearance.theme')}</h3>
      <div className="maps-themes" role="radiogroup" aria-label={t('settings.appearance.theme')}>
        {MAP_THEMES.map((theme) => (
          <button
            key={theme}
            type="button"
            role="radio"
            aria-checked={settings.theme === theme}
            className={`maps-theme-card maps-theme--${theme}${settings.theme === theme ? ' maps-theme-card--active' : ''}`}
            onClick={() => updateMapsSettings({ theme })}
          >
            <span className="maps-theme-card__preview">
              <span />
              <span />
              <span />
            </span>
            <span>{t(`settings.appearance.themes.${theme}`)}</span>
          </button>
        ))}
      </div>
      <p className="maps-hint">{t('settings.appearance.themeHint')}</p>

      <h3>{t('settings.appearance.tiles')}</h3>
      <div className="maps-segmented" role="radiogroup" aria-label={t('settings.appearance.tiles')}>
        {TILE_FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            role="radio"
            aria-checked={settings.tileFilter === filter}
            className={settings.tileFilter === filter ? 'maps-segmented--active' : ''}
            onClick={() => updateMapsSettings({ tileFilter: filter })}
          >
            {t(`settings.appearance.tileFilters.${filter}`)}
          </button>
        ))}
      </div>
      <p className="maps-hint">{t('settings.appearance.tilesHint')}</p>
    </div>
  )
}

/* ---------- map & routing ---------- */

function MapSettings() {
  const { t } = useTranslation('maps')
  const settings = useMapsSettings()

  return (
    <div className="maps-settings__panel">
      <div className="maps-form-grid">
        <label className="maps-field">
          <span>{t('settings.map.baseLayer')}</span>
          <select value={settings.baseLayer} onChange={(event) => updateMapsSettings({ baseLayer: event.target.value })}>
            {BASE_LAYERS.map((layer) => (
              <option key={layer.id} value={layer.id}>{t(`layers.names.${layer.id}`)}</option>
            ))}
          </select>
        </label>

        <label className="maps-field">
          <span>{t('settings.map.units')}</span>
          <select value={settings.units} onChange={(event) => updateMapsSettings({ units: event.target.value })}>
            {UNITS.map((unit) => <option key={unit} value={unit}>{t(`settings.map.unitNames.${unit}`)}</option>)}
          </select>
        </label>

        <label className="maps-field">
          <span>{t('settings.map.routeProfile')}</span>
          <select value={settings.routeProfile} onChange={(event) => updateMapsSettings({ routeProfile: event.target.value })}>
            {ROUTE_PROFILES.map((profile) => (
              <option key={profile} value={profile}>{t(`route.profiles.${profile}`)}</option>
            ))}
          </select>
        </label>
      </div>

      <Check checked={settings.showScale} onChange={(showScale) => updateMapsSettings({ showScale })}>
        {t('settings.map.showScale')}
      </Check>
      <Check checked={settings.showFavorites} onChange={(showFavorites) => updateMapsSettings({ showFavorites })}>
        {t('saved.showOnMap')}
      </Check>
      <Check checked={settings.showPhotos} onChange={(showPhotos) => updateMapsSettings({ showPhotos })}>
        {t('settings.map.showPhotos')}
      </Check>
      {settings.showPhotos && (
        <div className="maps-subchecks">
          <p className="maps-hint">{t('settings.map.photoSources')}</p>
          {PHOTO_SOURCES.map((source) => (
            <Check
              key={source}
              checked={settings.photoSources.includes(source)}
              onChange={(on) => updateMapsSettings((current) => ({
                photoSources: on
                  ? [...current.photoSources, source]
                  : current.photoSources.filter((entry) => entry !== source),
              }))}
            >
              {t(`settings.map.sources.${source}`)}
            </Check>
          ))}
        </div>
      )}
      <Check checked={settings.rememberView} onChange={(rememberView) => updateMapsSettings({ rememberView, lastView: rememberView ? settings.lastView : null })}>
        {t('settings.map.rememberView')}
      </Check>
      <Check checked={settings.routeAlternatives} onChange={(routeAlternatives) => updateMapsSettings({ routeAlternatives })}>
        {t('settings.map.alternatives')}
      </Check>
      <p className="maps-hint">
        <MapsIcon>{PROFILE_ICONS[settings.routeProfile]}</MapsIcon> {t('route.attribution')}
      </p>
    </div>
  )
}

/* ---------- accounts ---------- */

function HomeSiteAccount({ account }) {
  const { t } = useTranslation('maps')

  return (
    <section className="maps-account-card">
      <div className="maps-account-card__head">
        <MapsIcon>home</MapsIcon>
        <div>
          <strong>{t('settings.accounts.homesite')}</strong>
          <small>{t('settings.accounts.homesiteHelp')}</small>
        </div>
        <span className="maps-badge maps-badge--muted">{t('settings.accounts.soon')}</span>
      </div>
      <p className="maps-hint">
        {account
          ? t('saved.syncSoon', { name: account.displayName || account.username })
          : t('settings.accounts.homesiteOffline')}
      </p>
      {/* PLACEHOLDER: wire this to the HomeSite account login once the account server works. */}
      <button type="button" className="maps-btn maps-btn--secondary" disabled={!isMapsAccountSyncAvailable()}>
        <MapsIcon>login</MapsIcon>
        {t('settings.accounts.homesiteLogin')}
      </button>
    </section>
  )
}

function OsmAccount() {
  const { t } = useTranslation('maps')
  const settings = useMapsSettings()
  const auth = useOsmAuth(settings.osmServer)
  const server = getOsmServer(settings.osmServer)
  const [error, setError] = useState(null)

  return (
    <section className="maps-account-card">
      <div className="maps-account-card__head">
        {auth?.user?.avatar
          ? <img className="maps-avatar" src={auth.user.avatar} alt="" width="36" height="36" referrerPolicy="no-referrer" />
          : <MapsIcon>public</MapsIcon>}
        <div>
          <strong>OpenStreetMap</strong>
          <small>
            {auth
              ? t('settings.accounts.osmSignedIn', { name: auth.user?.name, count: auth.user?.changesets ?? 0 })
              : t('settings.accounts.osmHelp')}
          </small>
        </div>
        {auth && <span className="maps-badge">{t('settings.accounts.connected')}</span>}
      </div>

      <label className="maps-field">
        <span>{t('settings.accounts.osmServer')}</span>
        <select value={settings.osmServer} onChange={(event) => updateMapsSettings({ osmServer: event.target.value })}>
          {OSM_SERVERS.map((id) => (
            <option key={id} value={id}>{t(`settings.accounts.servers.${id}`)} ({getOsmServer(id).url.replace('https://', '')})</option>
          ))}
        </select>
        <small>{t('settings.accounts.osmServerHelp')}</small>
      </label>

      {!isOsmLoginConfigured(settings.osmServer) && <p className="maps-warning">{t('osm.notConfigured')}</p>}

      <div className="maps-actions">
        {auth ? (
          <>
            <ExternalLink className="maps-btn maps-btn--secondary" href={`${server.url}/user/${encodeURIComponent(auth.user?.name || '')}`}>
              <MapsIcon>person</MapsIcon>
              {t('settings.accounts.profile')}
            </ExternalLink>
            <button type="button" className="maps-btn maps-btn--danger" onClick={() => logoutOsm(settings.osmServer)}>
              <MapsIcon>logout</MapsIcon>
              {t('osm.logout')}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="maps-btn"
            disabled={!isOsmLoginConfigured(settings.osmServer)}
            onClick={() => startOsmLogin(settings.osmServer).catch((loginError) => setError(loginError.message))}
          >
            <MapsIcon>login</MapsIcon>
            {t('osm.login')}
          </button>
        )}
      </div>
      {error && <p className="maps-error">{error}</p>}
    </section>
  )
}

function WikimediaAccount() {
  const { t } = useTranslation('maps')
  const auth = useWikimediaAuth()
  const [error, setError] = useState(null)
  const signedIn = auth && !auth.expired

  return (
    <section className="maps-account-card">
      <div className="maps-account-card__head">
        <MapsIcon>photo_library</MapsIcon>
        <div>
          <strong>Wikimedia Commons</strong>
          <small>
            {signedIn
              ? t('settings.accounts.commonsSignedIn', { name: auth.user?.name || '' })
              : auth?.expired ? t('photos.commons.expired') : t('settings.accounts.commonsHelp')}
          </small>
        </div>
        {signedIn && <span className="maps-badge">{t('settings.accounts.connected')}</span>}
      </div>

      {!isWikimediaLoginConfigured() && <p className="maps-warning">{t('photos.commons.notConfigured')}</p>}

      <div className="maps-actions">
        {signedIn ? (
          <>
            <ExternalLink
              className="maps-btn maps-btn--secondary"
              href={`https://commons.wikimedia.org/wiki/Special:ListFiles/${encodeURIComponent(auth.user?.name || '')}`}
            >
              <MapsIcon>photo_library</MapsIcon>
              {t('settings.accounts.commonsUploads')}
            </ExternalLink>
            <button type="button" className="maps-btn maps-btn--danger" onClick={logoutWikimedia}>
              <MapsIcon>logout</MapsIcon>
              {t('osm.logout')}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="maps-btn"
            disabled={!isWikimediaLoginConfigured()}
            onClick={() => startWikimediaLogin().catch((loginError) => setError(loginError.message))}
          >
            <MapsIcon>login</MapsIcon>
            {t('photos.commons.login')}
          </button>
        )}
      </div>
      {error && <p className="maps-error">{error}</p>}
    </section>
  )
}

function MapillaryInfo() {
  const { t } = useTranslation('maps')

  return (
    <section className="maps-account-card">
      <div className="maps-account-card__head">
        <MapsIcon>360</MapsIcon>
        <div>
          <strong>Mapillary</strong>
          <small>{t('settings.accounts.mapillaryHelp')}</small>
        </div>
        <span className={`maps-badge${isMapillaryConfigured() ? '' : ' maps-badge--muted'}`}>
          {isMapillaryConfigured() ? t('settings.accounts.active') : t('settings.accounts.inactive')}
        </span>
      </div>
      {!isMapillaryConfigured() && <p className="maps-warning">{t('photos.mapillaryMissing')}</p>}
      <p className="maps-hint">
        {t('settings.accounts.mapillaryUpload')}{' '}
        <ExternalLink href="https://www.mapillary.com/mobile-apps">
          {t('settings.accounts.mapillaryApps')} <MapsIcon>open_in_new</MapsIcon>
        </ExternalLink>
      </p>
    </section>
  )
}

function PanoramaxAccount() {
  const { t } = useTranslation('maps')
  const settings = useMapsSettings()
  const instance = settings.panoramaxInstance
  const token = usePanoramaxToken(instance)
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)
  const [instanceDraft, setInstanceDraft] = useState(instance)
  const checkedRef = useRef(null)

  // Re-check once per instance whether a pending token has been claimed.
  useEffect(() => {
    if (!token?.jwt || checkedRef.current === instance) return
    checkedRef.current = instance
    verifyPanoramaxToken(instance).catch(() => {})
  }, [token?.jwt, instance])

  async function connect() {
    setError(null)
    setStatus('requesting')
    try {
      const next = await requestPanoramaxToken(instance)
      if (next.claimUrl) window.open(next.claimUrl, '_blank', 'noopener')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setStatus(null)
    }
  }

  async function verify() {
    setError(null)
    setStatus('verifying')
    try {
      const next = await verifyPanoramaxToken(instance)
      if (!next?.claimed) setError(t('settings.accounts.panoramaxNotClaimed'))
    } catch (verifyError) {
      setError(verifyError.message)
    } finally {
      setStatus(null)
    }
  }

  return (
    <section className="maps-account-card">
      <div className="maps-account-card__head">
        <MapsIcon>photo_camera</MapsIcon>
        <div>
          <strong>Panoramax <span className="maps-badge maps-badge--muted">{t('settings.accounts.optional')}</span></strong>
          <small>
            {token?.claimed
              ? t('settings.accounts.panoramaxConnected', { name: token.user?.name || '' })
              : t('settings.accounts.panoramaxHelp')}
          </small>
        </div>
        {token?.claimed && <span className="maps-badge">{t('settings.accounts.connected')}</span>}
      </div>

      <form
        className="maps-inline-form"
        onSubmit={(event) => {
          event.preventDefault()
          updateMapsSettings({ panoramaxInstance: instanceDraft })
        }}
      >
        <input
          value={instanceDraft}
          onChange={(event) => setInstanceDraft(event.target.value)}
          aria-label={t('settings.accounts.panoramaxInstance')}
          inputMode="url"
          spellCheck={false}
        />
        <MapsIconButton icon="check" type="submit" label={t('common.save')} disabled={instanceDraft === instance} />
      </form>

      {!token && (
        <div className="maps-actions">
          <button type="button" className="maps-btn" onClick={connect} disabled={status === 'requesting'}>
            {status === 'requesting' ? <MapsSpinner label={t('common.loading')} /> : <MapsIcon>link</MapsIcon>}
            {t('settings.accounts.panoramaxConnect')}
          </button>
        </div>
      )}

      {token && !token.claimed && (
        <>
          <ol className="maps-steps-help">
            <li>
              {t('settings.accounts.panoramaxStep1')}{' '}
              {token.claimUrl && (
                <ExternalLink href={token.claimUrl}>{t('settings.accounts.panoramaxClaim')} <MapsIcon>open_in_new</MapsIcon></ExternalLink>
              )}
            </li>
            <li>{t('settings.accounts.panoramaxStep2')}</li>
          </ol>
          <div className="maps-actions">
            <button type="button" className="maps-btn" onClick={verify} disabled={status === 'verifying'}>
              {status === 'verifying' ? <MapsSpinner label={t('common.loading')} /> : <MapsIcon>verified</MapsIcon>}
              {t('settings.accounts.panoramaxVerify')}
            </button>
            <button type="button" className="maps-btn maps-btn--secondary" onClick={() => forgetPanoramaxToken(instance)}>
              {t('common.cancel')}
            </button>
          </div>
        </>
      )}

      {token?.claimed && (
        <div className="maps-actions">
          <ExternalLink className="maps-btn maps-btn--secondary" href={panoramaxUploadsUrl(instance)}>
            <MapsIcon>photo_library</MapsIcon>
            {t('settings.accounts.panoramaxOpen')}
          </ExternalLink>
          <button type="button" className="maps-btn maps-btn--danger" onClick={() => forgetPanoramaxToken(instance)}>
            <MapsIcon>link_off</MapsIcon>
            {t('settings.accounts.disconnect')}
          </button>
        </div>
      )}

      {error && <p className="maps-error" role="alert">{error}</p>}
    </section>
  )
}

/* ---------- data ---------- */

function DataSettings() {
  const { t } = useTranslation('maps')
  const settings = useMapsSettings()
  const fileRef = useRef(null)
  const [message, setMessage] = useState(null)

  function exportSettings() {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `maps-settings-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function importSettings(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      replaceMapsSettings(normalizeMapsSettings(JSON.parse(await file.text())))
      setMessage({ type: 'ok', key: 'settings.data.imported' })
    } catch (error) {
      console.error('[maps] import failed', error)
      setMessage({ type: 'error', key: 'settings.data.importFailed' })
    }
  }

  return (
    <div className="maps-settings__panel">
      <p className="maps-hint">
        {t('settings.data.summary', {
          favorites: settings.favorites.length,
          lists: settings.lists.length,
        })}
      </p>
      <p className="maps-hint">{t('settings.data.help')}</p>

      <div className="maps-actions">
        <button type="button" className="maps-btn" onClick={exportSettings}>
          <MapsIcon>download</MapsIcon>
          {t('settings.data.export')}
        </button>
        <button type="button" className="maps-btn maps-btn--secondary" onClick={() => fileRef.current?.click()}>
          <MapsIcon>upload</MapsIcon>
          {t('settings.data.import')}
        </button>
        <button
          type="button"
          className="maps-btn maps-btn--danger"
          onClick={() => {
            if (!window.confirm(t('settings.data.resetConfirm'))) return
            resetMapsSettings()
            setMessage({ type: 'ok', key: 'settings.data.resetDone' })
          }}
        >
          <MapsIcon>restart_alt</MapsIcon>
          {t('settings.data.reset')}
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importSettings} />
      </div>

      {message && <p className={message.type === 'error' ? 'maps-error' : 'maps-success'} role="status">{t(message.key)}</p>}
    </div>
  )
}

/* ---------- modal ---------- */

export default function MapsSettings({ account, initialTab = 'appearance', onClose }) {
  const { t } = useTranslation('maps')
  const [tab, setTab] = useState(initialTab)
  const dialogRef = useRef(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()

    return () => {
      if (dialog?.open) dialog.close()
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="maps-modal"
      aria-label={t('settings.title')}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose()
      }}
    >
      <div className="maps-modal__card card">
        <div className="maps-modal__head">
          <h2><MapsIcon>tune</MapsIcon>{t('settings.title')}</h2>
          <MapsIconButton icon="close" label={t('common.close')} onClick={onClose} />
        </div>

        <div className="maps-tabs" role="tablist">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className={`maps-tab${tab === entry.id ? ' maps-tab--active' : ''}`}
              onClick={() => setTab(entry.id)}
            >
              <MapsIcon>{entry.icon}</MapsIcon>
              <span>{t(`settings.tabs.${entry.id}`)}</span>
            </button>
          ))}
        </div>

        <div role="tabpanel" className="maps-modal__body">
          {tab === 'appearance' && <AppearanceSettings />}
          {tab === 'map' && <MapSettings />}
          {tab === 'accounts' && (
            <div className="maps-settings__panel maps-accounts">
              <HomeSiteAccount account={account} />
              <OsmAccount />
              <WikimediaAccount />
              <MapillaryInfo />
              <PanoramaxAccount />
            </div>
          )}
          {tab === 'css' && (
            <div className="maps-settings__panel maps-settings__css">
              <CssSettings />
            </div>
          )}
          {tab === 'data' && <DataSettings />}
        </div>
      </div>
    </dialog>
  )
}
