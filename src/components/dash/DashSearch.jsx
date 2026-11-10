import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  buildSearchUrl,
  getAllProviders,
  resolveSearch,
  updateDashSettings,
  useDashSettings,
} from '../../lib/dashSettings.js'

function isEditable(target) {
  if (!target) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export default function DashSearch() {
  const { t } = useTranslation('dash')
  const settings = useDashSettings()
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)

  const providers = getAllProviders(settings)
  const resolved = resolveSearch(settings, query)
  const isBangOverride = resolved.provider.id !== settings.activeProviderId

  // Focus the search bar as soon as the page loads (autoFocus alone can be
  // lost to other mount-time work like twemoji parsing).
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true })
    })

    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return
      if (isEditable(event.target)) return

      event.preventDefault()
      inputRef.current?.focus()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  function handleSubmit(event) {
    event.preventDefault()

    if (!resolved.query) {
      inputRef.current?.focus()
      return
    }

    const url = buildSearchUrl(resolved.provider.url, resolved.query)

    if (settings.openInNewTab) {
      window.open(url, '_blank', 'noopener,noreferrer')
      setQuery('')
    } else {
      window.location.assign(url)
    }
  }

  return (
    <section className="card dash-search" aria-label={t('search.label')}>
      <form className="dash-search__form" role="search" onSubmit={handleSubmit}>
        <span className="material-symbols-outlined dash-search__icon" aria-hidden="true">
          search
        </span>
        <input
          ref={inputRef}
          className="dash-search__input"
          type="search"
          name="q"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('search.placeholder', { provider: resolved.provider.name })}
          aria-label={t('search.label')}
          autoComplete="off"
          autoFocus
          enterKeyHint="search"
        />
        <button className="dash-search__submit" type="submit" aria-label={t('search.submit')}>
          <span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
        </button>
      </form>

      <div className="dash-providers" role="radiogroup" aria-label={t('search.providers')}>
        {providers.map((provider) => {
          const isActive = provider.id === settings.activeProviderId
          const isTarget = provider.id === resolved.provider.id

          return (
            <button
              key={provider.id}
              type="button"
              role="radio"
              aria-checked={isActive}
              className={[
                'dash-chip',
                isActive && 'dash-chip--active',
                isBangOverride && isTarget && 'dash-chip--target',
              ].filter(Boolean).join(' ')}
              onClick={() => {
                updateDashSettings({ activeProviderId: provider.id })
                inputRef.current?.focus()
              }}
              title={provider.keyword ? `!${provider.keyword}` : undefined}
            >
              {provider.name}
              {provider.keyword && <span className="dash-chip__kw">!{provider.keyword}</span>}
            </button>
          )
        })}
      </div>

      <p className="dash-hint">
        {isBangOverride
          ? t('search.bangActive', { provider: resolved.provider.name })
          : t('search.hint')}
      </p>
    </section>
  )
}
