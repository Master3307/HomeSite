import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ACCOUNT_API_URL } from '../lib/account'
import { getFaviconSrc } from '../lib/seasonalAssets'
import { discordInviteUrl, siteConfig } from '../lib/siteConfig'

import '../styles/discord-widget.css'

const INVITE_CODE = siteConfig.inviteCode
const GUILD_ID = siteConfig.guildId
const DISCORD_API = 'https://discord.com/api/v10'
const CDN = 'https://cdn.discordapp.com'

export const DISCORD_INVITE_URL = discordInviteUrl

/*
 * Serverless fallback: Discord's public invite and widget endpoints allow
 * browser requests, so the widget still works when the account API (and
 * the bot behind it) is unreachable. The widget.json part needs "Enable
 * Server Widget" in the server settings; without it only counts are shown.
 */
async function loadFromDiscord(signal) {
  const [inviteResult, widgetResult] = await Promise.allSettled([
    fetch(`${DISCORD_API}/invites/${INVITE_CODE}?with_counts=true`, { signal }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Invite ${r.status}`)))),
    fetch(`${DISCORD_API}/guilds/${GUILD_ID}/widget.json`, { signal }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Widget ${r.status}`)))),
  ])

  const invite = inviteResult.status === 'fulfilled' ? inviteResult.value : null
  const widget = widgetResult.status === 'fulfilled' ? widgetResult.value : null
  if (!invite && !widget) throw new Error('Discord is unreachable.')

  const guild = invite?.guild ?? {}
  const members = (widget?.members ?? []).map((member) => ({
    id: `w${member.id}`,
    displayName: member.username,
    avatarUrl: member.avatar_url ?? null,
    status: member.status,
    activity: member.game?.name ?? null,
    channelId: member.channel_id ?? null,
  }))

  return {
    id: guild.id ?? widget?.id ?? GUILD_ID,
    name: guild.name ?? widget?.name,
    description: guild.description ?? null,
    iconUrl: guild.icon ? `${CDN}/icons/${guild.id}/${guild.icon}.webp?size=128` : null,
    bannerUrl: guild.banner
      ? `${CDN}/banners/${guild.id}/${guild.banner}.webp?size=960`
      : guild.splash
        ? `${CDN}/splashes/${guild.id}/${guild.splash}.webp?size=960`
        : null,
    memberCount: invite?.approximate_member_count ?? null,
    onlineCount: invite?.approximate_presence_count ?? widget?.presence_count ?? null,
    boostCount: guild.premium_subscription_count ?? 0,
    members,
    voice: (widget?.channels ?? [])
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        members: members.filter((member) => member.channelId === channel.id),
      }))
      .filter((channel) => channel.members.length),
    inviteUrl: DISCORD_INVITE_URL,
    source: 'discord',
  }
}

const REFRESH_MS = 60_000
const VISIBLE_MEMBERS = 8

function useWidget() {
  const [state, setState] = useState({ data: null, loading: true, error: false })

  useEffect(() => {
    let controller

    async function load() {
      controller?.abort()
      controller = new AbortController()

      try {
        let data

        try {
          const response = await fetch(`${ACCOUNT_API_URL}/discord/widget`, {
            signal: controller.signal,
          })
          if (!response.ok) throw new Error(`Widget ${response.status}`)
          data = await response.json()
        } catch (serverError) {
          if (serverError.name === 'AbortError') throw serverError
          data = await loadFromDiscord(controller.signal)
        }

        setState({ data, loading: false, error: false })
      } catch (error) {
        if (error.name === 'AbortError') return
        setState((current) => ({ data: current.data, loading: false, error: !current.data }))
      }
    }

    load()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, REFRESH_MS)

    return () => {
      window.clearInterval(timer)
      controller?.abort()
    }
  }, [])

  return state
}

function formatCount(value, language) {
  return value === null || value === undefined
    ? '–'
    : Number(value).toLocaleString(language)
}

/** Live card for the Cult Discord server, fed by the bot via the account API. */
export default function DiscordWidget() {
  const { t, i18n } = useTranslation('discord')
  const { data, loading, error } = useWidget()

  const inviteUrl = data?.inviteUrl || DISCORD_INVITE_URL
  const members = data?.members ?? []
  const shown = members.slice(0, VISIBLE_MEMBERS)
  const hidden = Math.max(0, (data?.onlineCount ?? members.length) - shown.length)

  return (
    <section
      className={`discord-widget${loading ? ' discord-widget--loading' : ''}`}
      aria-label={t('widget.label', { defaultValue: 'Discord server' })}
      aria-busy={loading}
    >
      <header className="dw-head">
        {/* The site's own (seasonal) icon, same as the favicon. */}
        <span className="dw-icon">
          <img src={getFaviconSrc()} alt="" width="56" height="56" />
        </span>

        <div className="dw-title">
          <p className="dw-kicker">
            {t('widget.label', { defaultValue: 'Discord server' })}
          </p>
          <h2>{data?.name || t('widget.fallbackName', { defaultValue: 'Cult of Black Cats' })}</h2>
        </div>
      </header>

      <dl className="dw-stats">
        <div className="dw-stat">
          <dt>
            <span className="dw-dot" aria-hidden="true" />
            {t('widget.onlineNow', { defaultValue: 'Online now' })}
          </dt>
          <dd>{formatCount(data?.onlineCount, i18n.language)}</dd>
        </div>

        <div className="dw-stat">
          <dt>{t('widget.totalMembers', { defaultValue: 'Members' })}</dt>
          <dd>{formatCount(data?.memberCount, i18n.language)}</dd>
        </div>
      </dl>

      {shown.length > 0 && (
        <ul className="dw-faces" aria-label={t('widget.onlineNow', { defaultValue: 'Online now' })}>
          {shown.map((member) => (
            <li key={member.id} title={member.activity ? `${member.displayName} · ${member.activity}` : member.displayName}>
              {member.avatarUrl ? (
                <img src={member.avatarUrl} alt={member.displayName} width="34" height="34" loading="lazy" />
              ) : (
                <span className="dw-faces__fallback" aria-label={member.displayName}>
                  {Array.from(member.displayName ?? '?')[0]}
                </span>
              )}
            </li>
          ))}
          {hidden > 0 && (
            <li className="dw-faces__more">
              {t('widget.more', { defaultValue: '+{{count}} more', count: hidden })}
            </li>
          )}
        </ul>
      )}

      {error && (
        <p className="dw-note">
          {t('widget.unavailable', { defaultValue: 'Live server info is unavailable right now.' })}
        </p>
      )}

      <a className="dw-join" href={inviteUrl} target="_blank" rel="noopener noreferrer">
        {t('widget.join', { defaultValue: 'Join the server' })}
        <span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
      </a>
    </section>
  )
}
