import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { updateMapsSettings, useMapsSettings } from '../../lib/maps/mapsSettings.js'
import { osmElementUrl, setOsmTag, useOsmAuth } from '../../lib/maps/osm.js'
import {
  getCommonsPhotosNear,
  getMapillaryPhotos,
  getPanoramaxPhotos,
  getTaggedPhotos,
  isMapillaryConfigured,
  uploadPanoramaxPhoto,
  usePanoramaxToken,
} from '../../lib/maps/photos.js'
import {
  COMMONS_FILE_TYPES,
  COMMONS_LICENSES,
  isWikimediaLoginConfigured,
  startWikimediaLogin,
  suggestFileName,
  uploadToCommons,
  useWikimediaAuth,
} from '../../lib/maps/wikimedia.js'
import { ExternalLink, MapsIcon, MapsIconButton, MapsSpinner } from './ui.jsx'

const SOURCE_LABELS = { mapillary: 'Mapillary', panoramax: 'Panoramax', commons: 'Wikimedia Commons', tag: 'OSM' }

function dedupe(photos) {
  const seen = new Set()
  return photos.filter((photo) => {
    const key = photo.imageId ? `mapillary:${photo.imageId}` : photo.full || photo.id
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function FilePicker({ file, accept, onChange, inputRef }) {
  const { t } = useTranslation('maps')
  return (
    <label className="maps-file">
      <input ref={inputRef} type="file" accept={accept} onChange={(event) => onChange(event.target.files?.[0] || null)} />
      <MapsIcon>add_a_photo</MapsIcon>
      <span>{file ? file.name : t('photos.choose')}</span>
    </label>
  )
}

/* ---------- Wikimedia Commons upload ---------- */

function CommonsUpload({ place, onUploaded }) {
  const { t, i18n } = useTranslation('maps')
  const settings = useMapsSettings()
  const auth = useWikimediaAuth()
  const osmAuth = useOsmAuth(settings.osmServer)
  const fileRef = useRef(null)

  const [file, setFile] = useState(null)
  const [fileName, setFileName] = useState('')
  const [description, setDescription] = useState('')
  const [license, setLicense] = useState(COMMONS_LICENSES[0])
  const [categories, setCategories] = useState('')
  const [ownWork, setOwnWork] = useState(false)
  const [linkOsm, setLinkOsm] = useState(true)
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  const isOsm = Boolean(place.osmType && place.osmId)
  const canLinkOsm = isOsm && osmAuth && !place.tags?.wikimedia_commons && settings.osmServer === 'production'
  const title = place.name || t('photos.untitled')

  if (!auth || auth.expired) {
    return (
      <div className="maps-photos__upload">
        <p className="maps-hint">{auth?.expired ? t('photos.commons.expired') : t('photos.commons.loginHint')}</p>
        {isWikimediaLoginConfigured()
          ? (
            <button type="button" className="maps-btn" onClick={() => startWikimediaLogin().catch((loginError) => setError(loginError.message))}>
              <MapsIcon>login</MapsIcon>
              {t('photos.commons.login')}
            </button>
          )
          : <p className="maps-warning">{t('photos.commons.notConfigured')}</p>}
        {error && <p className="maps-error">{error}</p>}
      </div>
    )
  }

  function pick(next) {
    setFile(next)
    setError(null)
    setResult(null)
    setStatus(null)
    if (next) {
      setFileName(suggestFileName([title, place.address?.split(',').at(-2)?.trim()].filter(Boolean).join(' – '), next))
      if (!description) setDescription(place.name ? t('photos.commons.defaultDescription', { name: place.name }) : '')
    }
  }

  async function upload(event) {
    event.preventDefault()
    if (!file || !ownWork) return
    setError(null)

    try {
      const uploaded = await uploadToCommons(file, {
        fileName: fileName.trim(),
        description: description.trim() || title,
        language: i18n.language.split('-')[0],
        lat: place.lat,
        lon: place.lon,
        osmUrl: isOsm ? osmElementUrl('production', place.osmType, place.osmId) : null,
        osmLabel: isOsm ? `${place.osmType} ${place.osmId}` : null,
        license,
        categories: categories.split(',').map((entry) => entry.trim()).filter(Boolean),
        onStatus: setStatus,
      })

      let osmLinked = false
      if (canLinkOsm && linkOsm) {
        setStatus('linking')
        await setOsmTag(
          settings.osmServer,
          place.osmType,
          place.osmId,
          'wikimedia_commons',
          `File:${uploaded.fileName}`,
          t('photos.commons.osmComment', { name: title }),
        ).then(() => { osmLinked = true }).catch((linkError) => console.error('[maps] linking photo failed', linkError))
      }

      setResult({ ...uploaded, osmLinked })
      setStatus('done')
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      onUploaded?.()
    } catch (uploadError) {
      console.error('[maps] commons upload failed', uploadError)
      setStatus(null)
      const known = ['commons_unauthorized', 'commons_bad_type', 'commons_exists', 'commons_duplicate', 'commons_no_token']
      setError(known.includes(uploadError.message) ? t(`photos.errors.${uploadError.message}`) : uploadError.message)
    }
  }

  const busy = status && status !== 'done'

  return (
    <form className="maps-photos__upload maps-form" onSubmit={upload}>
      <FilePicker file={file} accept={COMMONS_FILE_TYPES.join(',')} onChange={pick} inputRef={fileRef} />

      {file && (
        <>
          <label className="maps-field">
            <span>{t('photos.commons.fileName')}</span>
            <input value={fileName} onChange={(event) => setFileName(event.target.value)} maxLength={230} required />
          </label>
          <label className="maps-field">
            <span>{t('photos.commons.description')}</span>
            <textarea
              className="maps-textarea"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('photos.commons.descriptionPlaceholder')}
              maxLength={1000}
            />
          </label>
          <div className="maps-form-grid">
            <label className="maps-field">
              <span>{t('photos.commons.license')}</span>
              <select value={license} onChange={(event) => setLicense(event.target.value)}>
                {COMMONS_LICENSES.map((entry) => <option key={entry} value={entry}>{t(`photos.commons.licenses.${entry.replaceAll('.', '')}`)}</option>)}
              </select>
            </label>
            <label className="maps-field">
              <span>{t('photos.commons.categories')}</span>
              <input value={categories} onChange={(event) => setCategories(event.target.value)} placeholder={t('photos.commons.categoriesPlaceholder')} />
            </label>
          </div>

          <label className="maps-check">
            <input type="checkbox" checked={ownWork} onChange={(event) => setOwnWork(event.target.checked)} required />
            <span>{t('photos.commons.ownWork')}</span>
          </label>
          {canLinkOsm && (
            <label className="maps-check">
              <input type="checkbox" checked={linkOsm} onChange={(event) => setLinkOsm(event.target.checked)} />
              <span>{t('photos.commons.linkOsm')}</span>
            </label>
          )}
        </>
      )}

      <button type="submit" className="maps-btn" disabled={!file || !ownWork || busy || !fileName.trim()}>
        {busy ? <MapsSpinner label={t(`photos.status.${status}`)} /> : <MapsIcon>cloud_upload</MapsIcon>}
        {busy ? t(`photos.status.${status}`) : t('photos.commons.upload')}
      </button>

      <p className="maps-hint">{t('photos.commons.hint', { user: auth.user?.name || '' })}</p>

      {result && (
        <p className="maps-success" role="status">
          {t('photos.commons.done')}{' '}
          <ExternalLink href={result.url}>{t('photos.commons.viewFile')} <MapsIcon>open_in_new</MapsIcon></ExternalLink>
          {result.osmLinked && <> · {t('photos.commons.linked')}</>}
        </p>
      )}
      {error && <p className="maps-error" role="alert">{error}</p>}
    </form>
  )
}

/* ---------- Panoramax upload ---------- */

function PanoramaxUpload({ place, instance, onOpenAccounts, onUploaded }) {
  const { t } = useTranslation('maps')
  const token = usePanoramaxToken(instance)
  const fileRef = useRef(null)
  const [file, setFile] = useState(null)
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)

  if (!token?.claimed) {
    return (
      <div className="maps-photos__upload">
        <p className="maps-hint">{t('photos.connectHint')}</p>
        <button type="button" className="maps-btn maps-btn--secondary" onClick={onOpenAccounts}>
          <MapsIcon>link</MapsIcon>
          {t('photos.connect')}
        </button>
      </div>
    )
  }

  async function upload() {
    if (!file) return
    setError(null)

    try {
      await uploadPanoramaxPhoto(instance, file, {
        lat: place.lat,
        lon: place.lon,
        title: place.name || t('photos.untitled'),
        capturedAt: file.lastModified,
        onStatus: setStatus,
      })
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      onUploaded?.()
    } catch (uploadError) {
      console.error('[maps] upload failed', uploadError)
      setStatus(null)
      const known = ['panoramax_jpeg_only', 'panoramax_unauthorized', 'panoramax_no_token']
      setError(known.includes(uploadError.message) ? t(`photos.errors.${uploadError.message}`) : uploadError.message)
    }
  }

  const busy = status && status !== 'done'

  return (
    <div className="maps-photos__upload">
      <FilePicker
        file={file}
        accept="image/jpeg"
        inputRef={fileRef}
        onChange={(next) => {
          setFile(next)
          setStatus(null)
          setError(null)
        }}
      />

      <button type="button" className="maps-btn" disabled={!file || busy} onClick={upload}>
        {busy ? <MapsSpinner label={t(`photos.status.${status}`)} /> : <MapsIcon>cloud_upload</MapsIcon>}
        {busy ? t(`photos.status.${status}`) : t('photos.upload')}
      </button>

      <p className="maps-hint">{t('photos.uploadHint', { user: token.user?.name || '' })}</p>
      {status === 'done' && <p className="maps-success" role="status">{t('photos.status.panoramaxDone')}</p>}
      {error && <p className="maps-error" role="alert">{error}</p>}
    </div>
  )
}

/* ---------- Viewer ---------- */

function Lightbox({ photos, index, onIndex, onClose }) {
  const { t } = useTranslation('maps')
  const [interactive, setInteractive] = useState(false)
  const photo = photos[index]

  return (
    <div className="maps-lightbox" role="dialog" aria-modal="true" aria-label={t('photos.title')} onClick={onClose}>
      <figure onClick={(event) => event.stopPropagation()}>
        {interactive && photo.embed
          ? <iframe className="maps-lightbox__embed" src={photo.embed} title={t('photos.streetView')} allowFullScreen />
          : <img src={photo.full || photo.thumb} alt={photo.title || ''} referrerPolicy="no-referrer" />}
        <figcaption>
          <span>
            {SOURCE_LABELS[photo.source]}
            {photo.author && ` · ${photo.author}`}
            {photo.date && ` · ${photo.date}`}
            {photo.license && ` · ${photo.license}`}
          </span>
          {photo.page && (
            <ExternalLink href={photo.page}>
              {t('photos.source')} <MapsIcon>open_in_new</MapsIcon>
            </ExternalLink>
          )}
        </figcaption>
        <div className="maps-lightbox__nav">
          <MapsIconButton
            icon="chevron_left"
            label={t('photos.previous')}
            disabled={index === 0}
            onClick={() => { setInteractive(false); onIndex(index - 1) }}
          />
          {photo.embed && (
            <button type="button" className="maps-btn maps-btn--secondary maps-btn--small" onClick={() => setInteractive((value) => !value)}>
              <MapsIcon>{interactive ? 'image' : '360'}</MapsIcon>
              {interactive ? t('photos.photoView') : t('photos.streetView')}
            </button>
          )}
          <MapsIconButton icon="close" label={t('common.close')} onClick={onClose} />
          <MapsIconButton
            icon="chevron_right"
            label={t('photos.next')}
            disabled={index === photos.length - 1}
            onClick={() => { setInteractive(false); onIndex(index + 1) }}
          />
        </div>
      </figure>
    </div>
  )
}

/**
 * Photos of a place: its own OSM image tags, Mapillary street-level imagery
 * (main source), geotagged Wikimedia Commons files and optionally Panoramax.
 * Uploads go to Wikimedia Commons (default) or Panoramax.
 */
export default function PlacePhotos({ place, onOpenAccounts, onPhotoPositions }) {
  const { t } = useTranslation('maps')
  const settings = useMapsSettings()
  const instance = settings.panoramaxInstance
  const sources = settings.photoSources
  const [photos, setPhotos] = useState([])
  const [status, setStatus] = useState('loading')
  const [viewer, setViewer] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const sourcesKey = sources.join(',')

  useEffect(() => {
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20000)])
    const enabled = sourcesKey.split(',')

    const requests = [
      getTaggedPhotos(place.tags, { signal }),
      enabled.includes('mapillary') ? getMapillaryPhotos(place.lat, place.lon, { signal }) : Promise.resolve([]),
      enabled.includes('commons') ? getCommonsPhotosNear(place.lat, place.lon, { signal }) : Promise.resolve([]),
      enabled.includes('panoramax') ? getPanoramaxPhotos(instance, place.lat, place.lon, { signal }) : Promise.resolve([]),
    ]

    // Show each source as soon as it answers, in the order above.
    const found = requests.map(() => [])
    let settled = 0
    let failed = 0

    requests.forEach((request, index) => {
      request
        .then((list) => { found[index] = list })
        .catch(() => { failed += 1 })
        .finally(() => {
          if (controller.signal.aborted) return
          settled += 1
          const merged = dedupe(found.flat())
          setPhotos(merged)
          onPhotoPositions?.(merged.filter((photo) => Number.isFinite(photo.lat) && Number.isFinite(photo.lon)))
          if (settled === requests.length) setStatus(failed === requests.length ? 'error' : 'done')
        })
    })

    return () => {
      controller.abort()
      onPhotoPositions?.([])
    }
    // onPhotoPositions is a stable setter from the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place.key, place.lat, place.lon, instance, reloadKey, sourcesKey])

  const target = settings.uploadTarget

  return (
    <section className="maps-section maps-photos">
      <h3>
        <MapsIcon>photo_library</MapsIcon>
        {t('photos.title')}
        {status === 'loading' && <MapsSpinner label={t('photos.loading')} />}
      </h3>

      {status === 'done' && photos.length === 0 && <p className="maps-hint">{t('photos.empty')}</p>}
      {status === 'error' && <p className="maps-error">{t('photos.error')}</p>}
      {sources.includes('mapillary') && !isMapillaryConfigured() && (
        <p className="maps-hint">{t('photos.mapillaryMissing')}</p>
      )}

      {photos.length > 0 && (
        <ul className="maps-photos__grid">
          {photos.map((photo, index) => (
            <li key={photo.id}>
              <button
                type="button"
                className="maps-photos__thumb"
                onClick={() => setViewer(index)}
                aria-label={t('photos.open', { source: SOURCE_LABELS[photo.source] })}
              >
                <img src={photo.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />
                <span className={`maps-photos__badge maps-photos__badge--${photo.source}`}>
                  {SOURCE_LABELS[photo.source]}
                </span>
                {photo.pano && <span className="maps-photos__pano"><MapsIcon>360</MapsIcon></span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="maps-photos__add">
        <div className="maps-segmented maps-segmented--small" role="radiogroup" aria-label={t('photos.uploadTo')}>
          {['commons', 'panoramax'].map((entry) => (
            <button
              key={entry}
              type="button"
              role="radio"
              aria-checked={target === entry}
              className={target === entry ? 'maps-segmented--active' : ''}
              onClick={() => updateMapsSettings({ uploadTarget: entry })}
            >
              {SOURCE_LABELS[entry]}
            </button>
          ))}
        </div>

        {target === 'commons'
          ? <CommonsUpload key={place.key} place={place} onUploaded={() => setReloadKey((key) => key + 1)} />
          : (
            <PanoramaxUpload
              place={place}
              instance={instance}
              onOpenAccounts={onOpenAccounts}
              onUploaded={() => setReloadKey((key) => key + 1)}
            />
          )}
      </div>

      {viewer !== null && photos[viewer] && (
        <Lightbox photos={photos} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />
      )}
    </section>
  )
}
