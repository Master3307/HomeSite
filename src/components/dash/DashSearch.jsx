import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import Search from '../Search.jsx'
import { hubGet, userPageUrl } from '../../lib/hub.js'
import { buildSearchUrl, resolveSearch, updateDashSettings, useDashSettings, visibleProviders } from '../../lib/dashSettings.js'
import { Favicon } from './widgets.jsx'

/*
 * The /dash search: the site's own search bar (same look as on the home
 * page). Enter searches the web with the chosen engine (or !keyword), the
 * list under it also finds pages of this site, and for the site owner
 * people on Discord (the hub's member search, needs the hub unlocked).
 */

export default function DashSearch({ owner }) {
  const { t } = useTranslation('dash')
  const settings = useDashSettings()
  const providers = visibleProviders(settings)
  const active = settings.providers.find((provider) => provider.id === settings.activeProviderId)

  const web = useMemo(
    () => ({
      label: (query) => {
        const resolved = resolveSearch(settings, query)
        return t('search.webOption', { query: resolved.query || query, provider: resolved.provider?.name ?? '' })
      },
      run: (query) => {
        const resolved = resolveSearch(settings, query)
        if (!resolved.provider || !resolved.query) return
        const url = buildSearchUrl(resolved.provider.url, resolved.query)
        if (settings.openInNewTab) window.open(url, '_blank', 'noopener,noreferrer')
        else window.location.assign(url)
      },
    }),
    [settings, t],
  )

  const people = useCallback(async (query, signal) => {
    if (signal.aborted) return []
    const data = await hubGet('/hub/members', { q: query.replace(/^@/, ''), limit: 6 }).catch((error) => {
      throw new Error(error.status === 401 || error.locked ? t('search.hubLocked') : error.message)
    })
    return (data.members ?? []).map((member) => ({
      id: member.id,
      name: member.displayName || member.globalName || member.username,
      handle: member.username,
      avatarUrl: member.avatar ?? null,
      open: () => window.open(userPageUrl(member.id), '_blank', 'noopener'),
    }))
  }, [t])

  return (
    <Search className="dash-search" autoFocus sitePages={settings.siteResults} web={web} people={owner && settings.discordLookup ? people : null} placeholder={t('search.placeholder', { provider: active?.name ?? '' })}>
      {providers.length > 1 && (
        <div className="dash-engines" role="radiogroup" aria-label={t('search.providers')}>
          {providers.map((provider) => (
            <button key={provider.id} type="button" role="radio" aria-checked={provider.id === settings.activeProviderId} className={provider.id === settings.activeProviderId ? 'is-active' : ''} onClick={() => updateDashSettings({ activeProviderId: provider.id })} title={provider.keyword ? `!${provider.keyword}` : undefined}>
              <Favicon url={provider.url.replaceAll('%s', '')} size={16} />
              {provider.name}
            </button>
          ))}
        </div>
      )}
    </Search>
  )
}
