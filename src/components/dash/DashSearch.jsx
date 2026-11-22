import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import Search from '../Search.jsx'
import { hubGet, userPageUrl } from '../../lib/hub.js'
import { buildSearchUrl, resolveSearch, updateDashSettings, useDashSettings, visibleProviders } from '../../lib/dashSettings.js'
import { Favicon } from './kit.jsx'
import MathGraph from './MathGraph.jsx'
import MathView from './MathView.jsx'
import TeX, { latexOf } from './TeX.jsx'
import CalcVisual from './CalcVisual.jsx'
import ImageTools from './ImageTools.jsx'
import { analyzeAll } from '../../lib/dashMath.js'
import { faultSpot, useExplosion } from './Explosion.jsx'
import { latexCommands, nextSlot } from './mathSymbols.js'
import { catalogEntry } from '../../data/searchProviders.js'
import { languageName, languageNames, languageOf, translateText, translationQuery } from '../../lib/translate.js'
import { useMathLanguage } from './useMathLanguage.js'

const Reference = lazy(() => import('./science/Reference.jsx'))

/*
 * "minecraft Notch", "minecraft user Notch", "mc player …", or a UUID: the
 * player from playerdb.co (only what was typed is sent), their face from
 * mc-heads.net, a click opens the profile site chosen in the settings.
 */
const MINECRAFT = /^(?:minecraft|mc)(?:\s+(?:user|player|profile|name|account|uuid))?\s+([A-Za-z0-9_]{2,16}|[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
const minecraftCache = new Map()

/*
 * "house in German", '"house" in German', "translate … to …": the site's own
 * LibreTranslate (the text goes to our server only), shortly after typing stops.
 */
const translations = new Map()
function useTranslationAnswer(query, locale) {
  const asked = translationQuery(query)
  const [languagesReady, setReady] = useState(false)
  const [, setVersion] = useState(0)
  useEffect(() => {
    if (!asked || languagesReady) return
    languageNames(locale).then(() => setReady(true))
  }, [asked, languagesReady, locale])
  const target = asked && languagesReady ? languageOf(asked.language) : null
  const key = target ? `${target}:${asked.text}` : null
  useEffect(() => {
    if (!key || translations.has(key)) return undefined
    const timer = setTimeout(() => {
      translations.set(key, { state: 'loading' })
      setVersion((n) => n + 1)
      translateText(asked.text, target)
        .then((result) => translations.set(key, { state: 'done', ...result }))
        .catch((error) => translations.set(key, { state: 'error', error: error.message }))
        .finally(() => setVersion((n) => n + 1))
    }, 400)
    return () => clearTimeout(timer)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return key ? { text: asked.text, target, ...(translations.get(key) ?? { state: 'loading' }) } : null
}

/* The player's face (with the hat layer): crafthead (playerdb's own address), then mc-heads, then Minotar, else an icon. */
function MinecraftHead({ raw, name, avatar }) {
  const sources = [/^https:\/\/crafthead\.net\//.test(avatar ?? '') ? `${avatar}/64` : `https://crafthead.net/avatar/${raw}/64`, `https://mc-heads.net/avatar/${raw}/64`, `https://minotar.net/helm/${encodeURIComponent(name)}/64`]
  const [index, setIndex] = useState(0)
  if (index >= sources.length)
    return (
      <span className="material-symbols-outlined site-search__avatar" aria-hidden="true">
        person
      </span>
    )
  return <img key={sources[index]} className="site-search__mc-head" src={sources[index]} width="52" height="52" alt="" referrerPolicy="no-referrer" onError={() => setIndex((current) => current + 1)} />
}
function useMinecraft(query) {
  const name = MINECRAFT.exec(query.trim())?.[1] ?? null
  const key = name?.toLowerCase() ?? null
  const [, setVersion] = useState(0)
  useEffect(() => {
    if (!key || minecraftCache.has(key)) return undefined
    const controller = new AbortController()
    const timer = setTimeout(() => {
      minecraftCache.set(key, { state: 'loading' })
      setVersion((n) => n + 1)
      fetch(`https://playerdb.co/api/player/minecraft/${encodeURIComponent(name)}`, { signal: controller.signal })
        .then((response) => response.json())
        .then((data) => minecraftCache.set(key, data?.data?.player ? { state: 'found', player: data.data.player } : { state: 'missing' }))
        .catch((error) => {
          if (error.name === 'AbortError') minecraftCache.delete(key)
          else minecraftCache.set(key, { state: 'error' })
        })
        .finally(() => setVersion((n) => n + 1))
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [key, name])
  return key ? { name, ...(minecraftCache.get(key) ?? { state: 'loading' }) } : null
}

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
  const [typed, setTyped] = useState('')
  const [image, setImage] = useState(null)
  const minecraft = useMinecraft(typed)
  const translated = useTranslationAnswer(typed, i18n.language)
  const profileUrl = useMemo(() => {
    const chosen = settings.providers.find((provider) => provider.minecraft && (provider.catalog === settings.minecraftProvider || provider.id === settings.minecraftProvider)) ?? catalogEntry(settings.minecraftProvider)
    return chosen?.minecraft ?? 'https://namemc.com/profile/%s'
  }, [settings.providers, settings.minecraftProvider])
  const extras = useMemo(() => {
    const player = (query) => {
      if (!minecraft || MINECRAFT.exec(query.trim())?.[1]?.toLowerCase() !== minecraft.name.toLowerCase()) return []
      if (minecraft.state === 'found') {
        const { username, id, raw_id: raw } = minecraft.player
        return [
          { key: `mc:${raw}`, group: 'top', visual: <MinecraftHead raw={raw} name={username} avatar={minecraft.player.avatar} />, title: username, subtitle: `UUID ${id}`, hint: 'Minecraft', open: () => window.open(profileUrl.replace('%s', encodeURIComponent(username)), '_blank', 'noopener,noreferrer') },
          { key: `mc:uuid:${raw}`, group: 'top', icon: 'fingerprint', title: t('search.mc.copyUuid'), subtitle: id, hint: 'UUID', copy: id },
        ]
      }
      return [{ key: `mc:${minecraft.state}`, group: 'top', icon: minecraft.state === 'loading' ? 'hourglass_top' : 'person_off', title: minecraft.state === 'loading' ? t('search.mc.looking', { name: minecraft.name }) : minecraft.state === 'missing' ? t('search.mc.missing', { name: minecraft.name }) : t('search.mc.error'), subtitle: '', hint: 'Minecraft' }]
    }
    const translation = (query) => {
      if (!translated || translationQuery(query)?.text !== translated.text) return []
      const where = `${translated.detected?.code ? `${languageName(translated.detected.code, i18n.language)} → ` : ''}${languageName(translated.target, i18n.language)}`
      if (translated.state === 'done') return [{ key: `tr:${translated.target}`, group: 'top', icon: 'translate', title: translated.text === '' ? '…' : `${translated.text}`, subtitle: `${where} · LibreTranslate`, hint: t('search.translation'), copy: translated.text }]
      if (translated.state === 'error') return [{ key: 'tr:error', group: 'after', icon: 'translate', title: translated.error, subtitle: where, hint: t('search.translation') }]
      return [{ key: 'tr:loading', group: 'top', icon: 'translate', title: t('search.translating', { language: languageName(translated.target, i18n.language) }), subtitle: '', hint: t('search.translation') }]
    }
    return (query) => {
      if (query !== typed) queueMicrotask(() => setTyped(query))
      return [...translation(query), ...player(query), ...(science ? science.suggest(query, { t: te, tf, locale: i18n.language, open: setReference }) : [])]
    }
  }, [science, te, tf, i18n.language, minecraft, translated, profileUrl, t, typed])
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
            Visual: CalcVisual,
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
    <Search calc={calc} extras={extras} voice={settings.voiceSearch} onImage={setImage} imageButton={settings.imageButton} history={settings.searchHistory ? 'dash' : false} className="dash-search" autoFocus={settings.top.autofocus} sitePages={settings.siteResults} web={web} people={owner && settings.discordLookup ? people : null} placeholder={t('search.placeholder', { provider: active?.name ?? '' })}>
      {image && (
        <ImageTools
          file={image}
          onClose={() => setImage(null)}
          onQuery={(text) => {
            // Into the search box (colours, codes): the answers show up there.
            const input = document.querySelector('.dash-search .site-search__input')
            if (!input) return
            const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set
            setter.call(input, text)
            input.dispatchEvent(new Event('input', { bubbles: true }))
            input.focus()
          }}
        />
      )}
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
