import { useEffect } from 'react'
import { getFaviconSrc } from '../lib/seasonalAssets'

export default function SeasonalFavicon() {
  useEffect(() => {
    const faviconSrc = getFaviconSrc()

    let favicon = document.querySelector('link[rel="icon"]')

    if (!favicon) {
      favicon = document.createElement('link')
      favicon.rel = 'icon'
      document.head.appendChild(favicon)
    }

    favicon.type = 'image/webp'
    favicon.href = faviconSrc
  }, [])

  return null
}
