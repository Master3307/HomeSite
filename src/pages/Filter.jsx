import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

function matchesMedia(query) {
  return window.matchMedia?.(query).matches ?? null
}

async function getPermissionStates() {
  if (!navigator.permissions?.query) return {}

  const permissions = [
    'geolocation',
    'notifications',
    'camera',
    'microphone',
    'clipboard-read',
    'clipboard-write',
    'persistent-storage',
    'accelerometer',
    'gyroscope',
    'magnetometer',
  ]

  const results = await Promise.all(
    permissions.map(async (name) => {
      try {
        const result = await navigator.permissions.query({ name })
        return [name, result.state]
      } catch {
        return [name, 'unsupported']
      }
    }),
  )

  return Object.fromEntries(results)
}

async function getMediaSummary() {
  try {
    const devices = await navigator.mediaDevices?.enumerateDevices?.()

    if (!devices) return null

    return {
      cameras: devices.filter((device) => device.kind === 'videoinput').length,
      microphones: devices.filter((device) => device.kind === 'audioinput').length,
      audioOutputs: devices.filter((device) => device.kind === 'audiooutput').length,
    }
  } catch {
    return null
  }
}

function getStorageStatus(storage) {
  try {
    const key = '__storage_test__'
    storage.setItem(key, '1')
    storage.removeItem(key)
    return true
  } catch {
    return false
  }
}

async function collectBrowserInfo(redirectUrl) {
  const nav = navigator
  const connection = nav.connection
  const uaData = nav.userAgentData

  const [permissions, media] = await Promise.all([
    getPermissionStates(),
    getMediaSummary(),
  ])

  return {
    collectedAt: new Date().toISOString(),

    page: {
      url: window.location.href,
      origin: window.location.origin,
      path: window.location.pathname,
      query: window.location.search,
      redirectTo: redirectUrl,
      referrer: document.referrer || null,
      secureContext: window.isSecureContext,
      visibility: document.visibilityState,
    },

    browser: {
      userAgent: nav.userAgent,
      platform: uaData?.platform ?? nav.platform ?? null,
      brands: uaData?.brands ?? null,
      mobile: uaData?.mobile ?? null,
      vendor: nav.vendor || null,
      language: nav.language ?? null,
      languages: nav.languages ?? [],
      cookiesEnabled: nav.cookieEnabled,
      pdfViewerEnabled: nav.pdfViewerEnabled ?? null,
      doNotTrack: nav.doNotTrack ?? null,
      webdriver: nav.webdriver,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    },

    display: {
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      availableWidth: window.screen.availWidth,
      availableHeight: window.screen.availHeight,
      colorDepth: window.screen.colorDepth,
      pixelDepth: window.screen.pixelDepth,
      orientation: window.screen.orientation?.type ?? null,
      orientationAngle: window.screen.orientation?.angle ?? null,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      maxTouchPoints: nav.maxTouchPoints ?? 0,
      coarsePointer: matchesMedia('(pointer: coarse)'),
      finePointer: matchesMedia('(pointer: fine)'),
      hover: matchesMedia('(hover: hover)'),
      anyHover: matchesMedia('(any-hover: hover)'),
    },

    systemHints: {
      logicalCores: nav.hardwareConcurrency ?? null,
      approximateMemoryGiB: nav.deviceMemory ?? null,
    },

    networkHints: {
      online: nav.onLine,
      effectiveType: connection?.effectiveType ?? null,
      downlinkMbps: connection?.downlink ?? null,
      rttMs: connection?.rtt ?? null,
      saveData: connection?.saveData ?? null,
    },

    preferences: {
      colorScheme: matchesMedia('(prefers-color-scheme: dark)')
        ? 'dark'
        : matchesMedia('(prefers-color-scheme: light)')
          ? 'light'
          : 'no-preference',
      reducedMotion: matchesMedia('(prefers-reduced-motion: reduce)'),
      reducedTransparency: matchesMedia('(prefers-reduced-transparency: reduce)'),
      increasedContrast: matchesMedia('(prefers-contrast: more)'),
      forcedColors: matchesMedia('(forced-colors: active)'),
      invertedColors: matchesMedia('(inverted-colors: inverted)'),
      monochrome: matchesMedia('(monochrome)'),
    },

    storage: {
      localStorage: getStorageStatus(window.localStorage),
      sessionStorage: getStorageStatus(window.sessionStorage),
      indexedDB: Boolean(window.indexedDB),
      serviceWorker: 'serviceWorker' in nav,
    },

    permissions,
    media,
  }
}

export default function Home() {
  const { t } = useTranslation(['title', 'filter'])
  const [secondsLeft, setSecondsLeft] = useState(3)

  const redirectUrl = useMemo(() => {
    const rawLink = new URLSearchParams(window.location.search).get('link')

    if (!rawLink) return null

    const link = rawLink.replace(/^["']|["']$/g, '')

    try {
      const url = new URL(link)

      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        return null
      }

      return url.href
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    if (!redirectUrl) return

    let cancelled = false

    async function sendReport() {
      try {
        const report = await collectBrowserInfo(redirectUrl)

        if (cancelled) return

        await fetch('/api/visit', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(report),
          keepalive: true,
        })
      } catch {
        // Reporting must never prevent the redirect.
      }
    }

    sendReport()

    return () => {
      cancelled = true
    }
  }, [redirectUrl])

  useEffect(() => {
    if (!redirectUrl) return

    const countdown = window.setInterval(() => {
      setSecondsLeft((current) => Math.max(current - 1, 0))
    }, 1000)

    const redirect = window.setTimeout(() => {
      window.location.replace(redirectUrl)
    }, 3000)

    return () => {
      window.clearInterval(countdown)
      window.clearTimeout(redirect)
    }
  }, [redirectUrl])

  return (
    <>
      <title>Filter – MrKoby07</title>

      <header className="head">
        <h1 className="tit">
          {t('filter')} <strong>&nbsp;MrKoby07</strong>
        </h1>
      </header>

      <p
        className="tracked-notice"
        style={{
          position: 'fixed',
          top: '2.6rem',
          right: '1rem',
          zIndex: 9999,
          maxWidth: '320px',
          margin: 0,
          color: 'red',
          textAlign: 'right',
          lineHeight: 1,
          display: 'block',
          visibility: 'visible',
          opacity: 1,
        }}
      >
        {t('tracked', { ns: 'filter' })}
      </p>

      <a
        className="tracked-notice"
        style={{
          position: 'fixed',
          top: '3.6rem',
          right: '1rem',
          zIndex: 9999,
          maxWidth: '320px',
          margin: 0,
          color: '#00d5ff',
          textAlign: 'right',
          lineHeight: 1,
          display: 'block',
          visibility: 'visible',
          opacity: 1,
        }}
        href="../collect"
      >
        <u>{t('collect', { ns: 'filter' })}</u>
      </a>

      <div id="card" className="card">
        {redirectUrl ? (
          <>
            <h2>
              {t('redirecting', {
                ns: 'filter',
                secondsLeft,
              })}
            </h2>

            <small className="redirect-info">
              Redirecting to:{' '}
              <a href={redirectUrl} rel="noopener noreferrer">
                {redirectUrl}
              </a>
            </small>
          </>
        ) : (
          <h2>{t('noRedirect', { ns: 'filter'})}</h2>
        )}
      </div>
    </>
  )
}
