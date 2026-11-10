import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { useDashSettings } from '../lib/dashSettings.js'

const STYLE_ID = 'dash-custom-css'

/**
 * Injects the user's custom CSS (from /dash settings) on every page.
 *
 * - Appended as the last <style> in <head>, so it wins over site styles at
 *   equal specificity.
 * - "Replace site CSS" disables every other stylesheet, so the custom CSS is
 *   the entire site's styling.
 * - Escape hatch: add `?nocss` to any URL to skip custom CSS for that page.
 */
export default function CustomCss() {
  const { customCss, customCssEnabled, replaceSiteCss } = useDashSettings()
  const { search } = useLocation()

  const bypass = new URLSearchParams(search).has('nocss')
  const active = customCssEnabled && !bypass
  const css = active ? customCss : ''
  const replace = active && replaceSiteCss

  useEffect(() => {
    let style = document.getElementById(STYLE_ID)

    if (!css.trim()) {
      style?.remove()
      return
    }

    if (!style) {
      style = document.createElement('style')
      style.id = STYLE_ID
    }

    style.textContent = css

    // Always (re-)append so it stays last, even after Vite/HMR adds styles.
    document.head.appendChild(style)
  }, [css])

  useEffect(() => {
    if (!replace) return

    const disabledSheets = new Set()

    function disableForeignSheets() {
      for (const sheet of document.styleSheets) {
        if (sheet.ownerNode?.id === STYLE_ID || sheet.disabled) continue
        sheet.disabled = true
        disabledSheets.add(sheet)
      }
    }

    disableForeignSheets()

    // Catch stylesheets added later (lazy chunks, HMR).
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          // <link> sheets only show up in document.styleSheets once loaded.
          if (node.nodeName === 'LINK') {
            node.addEventListener('load', disableForeignSheets, { once: true })
          }
        }
      }

      disableForeignSheets()
    })
    observer.observe(document.head, { childList: true })

    return () => {
      observer.disconnect()
      for (const sheet of disabledSheets) sheet.disabled = false
    }
  }, [replace])

  return null
}
