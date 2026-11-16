import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
  } from 'react'
  import i18n, {
    LANGUAGE_KEY,
    supportedLngs,
  } from './i18n'
  import {
    getCurrentAccount,
    updateAccountSettings,
  } from './account'
  import { getDashSettings, updateDashSettings } from './dashSettings'
  import { applyPrefs, PREF_KEYS, readPrefs, writePrefs } from './prefs'

  const THEME_KEY = 'preferredTheme'
  const SETTINGS_AT_KEY = 'homesite:settingsAt'
  const PENDING_KEY = 'homesite:settingsPending'

  function readPending() {
    try {
      return JSON.parse(localStorage.getItem(PENDING_KEY) || 'null') ?? {}
    } catch {
      return {}
    }
  }

  function writePending(value) {
    try {
      if (value) localStorage.setItem(PENDING_KEY, JSON.stringify(value))
      else localStorage.removeItem(PENDING_KEY)
    } catch {
      // storage blocked
    }
  }

  function localSettingsAt() {
    try {
      return Number(localStorage.getItem(SETTINGS_AT_KEY)) || 0
    } catch {
      return 0
    }
  }
  const DEFAULT_LANGUAGE = 'en'

  const AccountSettingsContext = createContext(null)

  /* The stored choice: light | dark | system (follows the device). */
  function normalizeTheme(value) {
    return value === 'light' || value === 'system' ? value : 'dark'
  }

  const SYSTEM_LIGHT = '(prefers-color-scheme: light)'

  /* What the page shows for a choice. */
  function resolveTheme(choice) {
    if (choice !== 'system') return choice
    return typeof window !== 'undefined' && window.matchMedia?.(SYSTEM_LIGHT).matches ? 'light' : 'dark'
  }

  function normalizeLanguage(value) {
    if (!value) {
      return null
    }

    if (supportedLngs.includes(value)) {
      return value
    }

    const baseLanguage = String(value).split('-')[0]

    if (supportedLngs.includes(baseLanguage)) {
      return baseLanguage
    }

    return null
  }

  function getLocalTheme() {
    return normalizeTheme(localStorage.getItem(THEME_KEY))
  }

  function getLocalLanguage() {
    return (
      normalizeLanguage(localStorage.getItem(LANGUAGE_KEY)) ||
      normalizeLanguage(i18n.resolvedLanguage) ||
      normalizeLanguage(i18n.language) ||
      DEFAULT_LANGUAGE
    )
  }

  function getLocalSettings() {
    return {
      theme: getLocalTheme(),
      language: getLocalLanguage(),
    }
  }

  function applyTheme(choice) {
    document.documentElement.setAttribute('data-theme', resolveTheme(choice))
    try {
      localStorage.setItem(THEME_KEY, choice)
    } catch {
      // storage blocked: this visit only
    }
  }

  async function applyLanguage(language) {
    localStorage.setItem(LANGUAGE_KEY, language)

    if (i18n.resolvedLanguage !== language) {
      await i18n.changeLanguage(language)
    }
  }

  export function AccountSettingsProvider({ children }) {
    // `themeChoice`: what was picked (light | dark | system); `theme`: what shows (light | dark).
    const [themeChoice, setThemeState] = useState(getLocalTheme)
    const [systemTheme, setSystemTheme] = useState(() => resolveTheme('system'))
    const theme = themeChoice === 'system' ? systemTheme : themeChoice
    const [language, setLanguageState] = useState(getLocalLanguage)
    const [prefs, setPrefsState] = useState(readPrefs)
    const [account, setAccount] = useState(null)
    const [isAccountLoading, setIsAccountLoading] = useState(true)

    /*
     * Every change is stamped (homesite:settingsAt) and kept as pending until
     * the account has it, so a save that fails (offline, server restarting)
     * is sent again on the next load instead of being lost or overwritten.
     */
    const syncSettingsToAccount = useCallback(async (settings) => {
      const at = Date.now()
      const pending = { ...readPending(), ...settings, _at: at }
      writePending(pending)
      try {
        localStorage.setItem(SETTINGS_AT_KEY, String(at))
      } catch {
        // storage blocked
      }
      try {
        const savedSettings = await updateAccountSettings(pending)
        writePending(null)

        if (savedSettings) {
          setAccount((currentAccount) => (
            currentAccount
              ? {
                  ...currentAccount,
                  settings: savedSettings,
                }
              : currentAccount
          ))
        }

        return savedSettings
      } catch (error) {
        console.error('Could not sync account settings:', error)
        return null
      }
    }, [])

    const setTheme = useCallback((nextTheme) => {
      const normalizedTheme = normalizeTheme(nextTheme)

      setThemeState(normalizedTheme)
      applyTheme(normalizedTheme)

      syncSettingsToAccount({
        theme: normalizedTheme,
      })
    }, [syncSettingsToAccount])

    const setLanguage = useCallback((nextLanguage) => {
      const normalizedLanguage = normalizeLanguage(nextLanguage)

      if (!normalizedLanguage) {
        return
      }

      setLanguageState(normalizedLanguage)

      applyLanguage(normalizedLanguage).catch((error) => {
        console.error('Could not apply language:', error)
      })

      syncSettingsToAccount({
        language: normalizedLanguage,
      })
    }, [syncSettingsToAccount])

    useEffect(() => {
      applyTheme(themeChoice)
    }, [themeChoice, systemTheme])

    // The device switches between light and dark (or another tab changes a setting): follow it.
    useEffect(() => {
      const media = window.matchMedia?.(SYSTEM_LIGHT)
      const onSystem = () => setSystemTheme(media.matches ? 'light' : 'dark')
      const onStorage = (event) => {
        if (event.key === THEME_KEY) setThemeState(normalizeTheme(event.newValue))
        if (event.key === LANGUAGE_KEY && normalizeLanguage(event.newValue)) {
          setLanguageState(normalizeLanguage(event.newValue))
          applyLanguage(normalizeLanguage(event.newValue)).catch(() => {})
        }
        if (event.key === 'homesite:prefs') setPrefsState(readPrefs())
      }
      media?.addEventListener?.('change', onSystem)
      window.addEventListener('storage', onStorage)
      return () => {
        media?.removeEventListener?.('change', onSystem)
        window.removeEventListener('storage', onStorage)
      }
    }, [])

    useEffect(() => {
      applyPrefs(prefs)
    }, [prefs])

    /* Clock, time zone, accent, motion and custom CSS (lib/prefs.js); custom CSS also lives in /dash settings. */
    const setPrefs = useCallback((patch) => {
      setPrefsState((current) => {
        const next = { ...current, ...patch }
        writePrefs(next)
        return next
      })
      const sync = {}
      for (const key of PREF_KEYS) if (key in patch) sync[key] = patch[key]
      if ('customCss' in patch || 'customCssEnabled' in patch) {
        updateDashSettings({
          ...('customCss' in patch ? { customCss: patch.customCss } : {}),
          ...('customCssEnabled' in patch ? { customCssEnabled: patch.customCssEnabled } : {}),
        })
        if ('customCss' in patch) sync.customCss = patch.customCss
        if ('customCssEnabled' in patch) sync.customCssEnabled = patch.customCssEnabled
      }
      if (Object.keys(sync).length) syncSettingsToAccount(sync)
    }, [syncSettingsToAccount])

    useEffect(() => {
      let isActive = true

      async function loadAccountSettings() {
        const localSettings = getLocalSettings()

        try {
          const currentAccount = await getCurrentAccount()

          if (!isActive) {
            return
          }

          if (!currentAccount) {
            setAccount(null)
            return
          }

          // Changes this browser couldn't save yet go first; then the newer side wins.
          const pending = readPending()
          if (Object.keys(pending).length) {
            const saved = await syncSettingsToAccount(pending)
            if (!isActive) return
            if (saved) currentAccount.settings = saved
          }
          const remoteAt = Number(currentAccount.settings?._at) || 0
          if (localSettingsAt() > remoteAt) {
            const local = { ...getLocalSettings(), ...readPrefs() }
            const dash = getDashSettings()
            const saved = await syncSettingsToAccount({ ...local, customCss: dash.customCss ?? '', customCssEnabled: dash.customCssEnabled !== false })
            if (!isActive) return
            if (saved) currentAccount.settings = saved
          } else if (remoteAt) {
            try {
              localStorage.setItem(SETTINGS_AT_KEY, String(remoteAt))
            } catch {
              // storage blocked
            }
          }

          const remoteSettings = currentAccount.settings || {}
          const hasRemoteTheme = ['dark', 'light', 'system'].includes(remoteSettings.theme)

          const remoteLanguage = normalizeLanguage(remoteSettings.language)
          const hasRemoteLanguage = Boolean(remoteLanguage)

          if (!hasRemoteTheme && !hasRemoteLanguage) {
            const importedSettings = await syncSettingsToAccount(localSettings)

            if (!isActive) {
              return
            }

            setAccount({
              ...currentAccount,
              settings: importedSettings || localSettings,
            })

            return
          }

          // The account's other settings win over this browser's.
          const remotePrefs = {}
          for (const key of PREF_KEYS) if (key in remoteSettings) remotePrefs[key] = remoteSettings[key]
          if (Object.keys(remotePrefs).length) {
            const merged = { ...readPrefs(), ...remotePrefs }
            writePrefs(merged)
            setPrefsState(merged)
          }
          if (typeof remoteSettings.customCss === 'string' || typeof remoteSettings.customCssEnabled === 'boolean') {
            const dash = getDashSettings()
            updateDashSettings({
              customCss: typeof remoteSettings.customCss === 'string' ? remoteSettings.customCss : dash.customCss,
              customCssEnabled: typeof remoteSettings.customCssEnabled === 'boolean' ? remoteSettings.customCssEnabled : dash.customCssEnabled,
            })
          }

          const nextTheme = hasRemoteTheme
            ? remoteSettings.theme
            : localSettings.theme

          const nextLanguage = remoteLanguage || localSettings.language

          setThemeState(nextTheme)
          applyTheme(nextTheme)

          setLanguageState(nextLanguage)
          await applyLanguage(nextLanguage)

          setAccount({
            ...currentAccount,
            settings: {
              ...remoteSettings,
              theme: nextTheme,
              language: nextLanguage,
            },
          })

          if (!hasRemoteTheme || !hasRemoteLanguage) {
            const missingSettings = {}

            if (!hasRemoteTheme) {
              missingSettings.theme = nextTheme
            }

            if (!hasRemoteLanguage) {
              missingSettings.language = nextLanguage
            }

            await syncSettingsToAccount(missingSettings)
          }
        } catch (error) {
          console.error('Could not load account settings:', error)

          if (isActive) {
            setAccount(null)
          }
        } finally {
          if (isActive) {
            setIsAccountLoading(false)
          }
        }
      }

      loadAccountSettings()

      return () => {
        isActive = false
      }
    }, [syncSettingsToAccount])

    const value = useMemo(() => ({
      account,
      isAccountLoading,
      theme,
      themeChoice,
      language,
      setTheme,
      setLanguage,
      prefs,
      setPrefs,
    }), [
      prefs,
      setPrefs,
      account,
      isAccountLoading,
      theme,
      themeChoice,
      language,
      setTheme,
      setLanguage,
    ])

    return (
      <AccountSettingsContext.Provider value={value}>
        {children}
      </AccountSettingsContext.Provider>
    )
  }

  export function useAccountSettings() {
    const context = useContext(AccountSettingsContext)

    if (!context) {
      throw new Error(
        'useAccountSettings must be used inside AccountSettingsProvider.',
      )
    }

    return context
  }
