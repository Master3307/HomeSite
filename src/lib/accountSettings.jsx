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

  const THEME_KEY = 'preferredTheme'
  const DEFAULT_THEME = 'dark'
  const DEFAULT_LANGUAGE = 'en'

  const AccountSettingsContext = createContext(null)

  function normalizeTheme(value) {
    return value === 'light' ? 'light' : 'dark'
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

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(THEME_KEY, theme)
  }

  async function applyLanguage(language) {
    localStorage.setItem(LANGUAGE_KEY, language)

    if (i18n.resolvedLanguage !== language) {
      await i18n.changeLanguage(language)
    }
  }

  export function AccountSettingsProvider({ children }) {
    const [theme, setThemeState] = useState(getLocalTheme)
    const [language, setLanguageState] = useState(getLocalLanguage)
    const [account, setAccount] = useState(null)
    const [isAccountLoading, setIsAccountLoading] = useState(true)

    const syncSettingsToAccount = useCallback(async (settings) => {
      try {
        const savedSettings = await updateAccountSettings(settings)

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
      applyTheme(theme)
    }, [theme])

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

          const remoteSettings = currentAccount.settings || {}
          const hasRemoteTheme = remoteSettings.theme === 'dark'
            || remoteSettings.theme === 'light'

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
      language,
      setTheme,
      setLanguage,
    }), [
      account,
      isAccountLoading,
      theme,
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
