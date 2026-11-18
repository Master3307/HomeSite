import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import Search from '../Search.jsx'
import { hubGet, userPageUrl } from '../../lib/hub.js'
import { buildSearchUrl, resolveSearch, updateDashSettings, useDashSettings, visibleProviders } from '../../lib/dashSettings.js'
import { Favicon } from './kit.jsx'
import MathGraph from './MathGraph.jsx'
import MathView from './MathView.jsx'
import TeX, { latexOf } from './TeX.jsx'
import { analyzeAll } from '../../lib/dashMath.js'
import { faultSpot, useExplosion } from './Explosion.jsx'
import { latexCommands, nextSlot } from './mathSymbols.js'
import { useMathLanguage } from './useMathLanguage.js'

const Reference = lazy(() => import('./science/Reference.jsx'))

/* The typed maths over the calculator's answers: LaTeX as typed (KaTeX), the rest as the calculator read it. */
function SearchPretty({ trees, source, className }) {
  const latex = latexOf(source)
  const fallback = trees?.length ? <MathView trees={trees} className={className} /> : null
  return latex ? <TeX latex={latex} className={className} fallback={fallback} /> : fallback
}

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

  const { i18n } = useTranslation()
  const { t: te } = useTranslation('elements')
  const { t: tf } = useTranslation('formulas')
  // The periodic table, elements and formulas: loaded a moment after the dash, not with it.
  const [science, setScience] = useState(null)
  const [reference, setReference] = useState(null)
  useEffect(() => {
    let alive = true
    const load = () => import('./science/search.jsx').then((module) => alive && setScience(module))
    const timer = window.requestIdleCallback ? window.requestIdleCallback(load, { timeout: 2500 }) : setTimeout(load, 1200)
    return () => {
      alive = false
      if (window.cancelIdleCallback) window.cancelIdleCallback(timer)
      else clearTimeout(timer)
    }
  }, [])
  const extras = useMemo(() => (science ? (query) => science.suggest(query, { t: te, tf, locale: i18n.language, open: setReference }) : null), [science, te, tf, i18n.language])
  const explode = useExplosion()
  const math = useMathLanguage()
  const calc = useMemo(
    () =>
      settings.calculator === false
        ? null
        : {
            analyze: (query) => analyzeAll(query, { angle: settings.calcAngle === 'deg' ? 'deg' : 'rad', locale: i18n.language }),
            Graph: MathGraph,
            Pretty: SearchPretty,
            autoGraph: settings.calcGraph === 'show',
            explode,
            faultSpot,
            latex: (partial) => latexCommands(partial, math.wordsOf),
            nextSlot,
          },
    [settings.calculator, settings.calcAngle, settings.calcGraph, i18n.language, explode, math],
  )

  return (
    <>
    <Search calc={calc} extras={extras} history={settings.searchHistory ? 'dash' : false} className="dash-search" autoFocus={settings.top.autofocus} sitePages={settings.siteResults} web={web} people={owner && settings.discordLookup ? people : null} placeholder={t('search.placeholder', { provider: active?.name ?? '' })}>
      {settings.top.showEngines && providers.length > 1 && (
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
    {reference && (
      <Suspense fallback={null}>
        <Reference start={reference} onClose={() => setReference(null)} />
      </Suspense>
    )}
    </>
  )
}
