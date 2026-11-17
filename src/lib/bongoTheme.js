import { useEffect, useState } from 'react'

import { loadFavorites, localTheme, setTheme, THEME_EVENT } from './bongo'

/*
 * The game's UI themes in the cat designer: each viewer picks one (synced
 * per account). Themes and their pieces come from the imported assets
 * (catalog.themes), so new themes of a game update just show up.
 */

/**
 * A theme as colour tokens on the site's own layout: `--b-surface`,
 * `--b-panel`, `--b-accent`, `--b-ink`… from the palette the import took from
 * the theme's textures. Null theme (or one without a palette) = the site's look.
 */
function themeVars(catalog, themeId) {
  const theme = themeId && catalog?.themes?.find((entry) => entry.id === themeId)
  const palette = theme?.palette
  if (!palette) return { className: '', style: undefined }
  return {
    className: `bongo-themed bongo-themed--${palette.tone}`,
    style: {
      '--b-surface': palette.surface,
      '--b-panel': `color-mix(in srgb, ${palette.panel} 32%, ${palette.surface})`,
      '--b-accent': palette.accent,
      '--b-accent-ink': palette.accentInk,
      '--b-ink': palette.ink,
      '--b-muted': palette.muted,
      colorScheme: palette.tone,
    },
  }
}

/** The viewer's theme (synced per account, this browser when logged out) and a setter. */
export function useBongoTheme(catalog) {
  const [theme, setThemeState] = useState(() => localTheme())
  const [synced, setSynced] = useState(false)
  useEffect(() => {
    let alive = true
    loadFavorites().then((data) => {
      if (!alive) return
      setSynced(data.synced)
      if (data.synced) setThemeState(data.theme ?? null)
    })
    const onChange = (event) => setThemeState(event.detail.theme ?? null)
    window.addEventListener(THEME_EVENT, onChange)
    return () => {
      alive = false
      window.removeEventListener(THEME_EVENT, onChange)
    }
  }, [])
  const valid = theme && catalog?.themes?.some((entry) => entry.id === theme) ? theme : null
  const change = (id) => {
    setThemeState(id)
    setTheme(id, synced).catch(() => {})
  }
  return [valid, change, themeVars(catalog, valid)]
}

