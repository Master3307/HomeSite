import { useEffect } from 'react'

/* The dash's own font: @font-face for a file / link, the Google Fonts stylesheet for a family. */
export function useCustomFont(font) {
  const key = font ? `${font.source}:${font.value}` : ''
  useEffect(() => {
    if (!font) return undefined
    const element = document.createElement(font.source === 'google' ? 'link' : 'style')
    if (font.source === 'google') {
      element.rel = 'stylesheet'
      element.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.value).replace(/%20/g, '+')}:wght@300..800&display=swap`
      document.documentElement.style.setProperty('--dash-custom-font', `"${font.value.replace(/"/g, '')}"`)
    } else {
      element.textContent = `@font-face { font-family: "DashCustomFont"; src: url("${encodeURI(font.value).replace(/"/g, '%22')}"); font-display: swap; }`
      document.documentElement.style.setProperty('--dash-custom-font', '"DashCustomFont"')
    }
    element.dataset.dashFont = ''
    document.head.append(element)
    return () => {
      element.remove()
      document.documentElement.style.removeProperty('--dash-custom-font')
    }
    // the key stands for the font
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
}
