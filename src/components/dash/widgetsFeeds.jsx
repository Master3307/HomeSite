import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAccountSettings } from '../../lib/accountSettings.jsx'
import { integrationById, integrationGet, useIntegrations } from '../../lib/dashIntegrations.js'
import { siteConfig } from '../../lib/siteConfig.js'
import { updateWidgetOptions } from '../../lib/dashSettings.js'
import MarkdownLite from './MarkdownLite.jsx'
import { Empty, Favicon, LoadError, Loading, Num, Sparkline, compactNumber, corsJson, dashboardIconPng, dashboardIconUrl, fetchJson, hostOf, loadFeed, proxyJson, timeAgo, useRemote } from './kit.jsx'

/*
 * Things from elsewhere: releases (GitHub, GitLab, Gitea / Forgejo /
 * Codeberg, npm, PyPI, Docker Hub, crates.io), a repository, RSS / Atom
 * feeds with pictures, Hacker News, crypto prices and a Minecraft server.
 * Each source is cached on its own (kit.jsx useRemote), so a reload shows
 * the last answer at once and only asks again when it's old.
 */

const loggedInOf = (account) => Boolean(account && !account.local && !account.isAdminSession)

/* A picture that hides itself when it can't load (feed images, covers). */
export function SoftImage({ src, className = '', width, height, alt = '' }) {
  const [failed, setFailed] = useState('')
  if (!src || failed === src) return null
  return <img className={className} src={src} alt={alt} width={width} height={height} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(src)} />
}

/* An icon tried in order: the repo's dashboard-icon, then the owner's avatar, then the provider's logo. */
function RepoIcon({ sources, size = 28 }) {
  const [index, setIndex] = useState(0)
  const key = sources.join('|')
  const [shownKey, setShownKey] = useState(key)
  if (shownKey !== key) {
    setShownKey(key)
    setIndex(0)
  }
  const src = sources[index]
  if (!src) return <span className="dash-favicon dash-favicon--letter" style={{ '--size': `${size}px` }} aria-hidden="true" />
  return <img key={src} className="dash-repo-icon" src={src} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setIndex(index + 1)} />
}

/* ---------- releases ---------- */

export const RELEASE_SOURCES = ['github', 'gitlab', 'gitea', 'npm', 'pypi', 'docker', 'crates']
const PROVIDER_ICON = { github: 'github', gitlab: 'gitlab', gitea: 'forgejo', npm: 'npm', pypi: 'python', docker: 'docker', crates: 'rust' }
const REPO_NAME = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/
const PACKAGE_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[A-Za-z0-9-._~]{1,214}$/

function iconsFor(source, name, mode, host = '') {
  if (mode === 'none') return []
  const repo = String(name).split('/').pop().toLowerCase().replace(/[^a-z0-9-]/g, '')
  const owner = String(name).split('/')[0]
  const list = []
  if (mode !== 'owner' && repo) list.push(dashboardIconUrl(repo), dashboardIconPng(repo))
  if (source === 'github' && owner) list.push(`https://github.com/${encodeURIComponent(owner)}.png?size=64`)
  if (source === 'gitea' && owner && host) list.push(`${host}/${encodeURIComponent(owner)}.png`)
  list.push(dashboardIconUrl(PROVIDER_ICON[source] ?? 'git'))
  return list
}

function giteaHost(integration) {
  return (integration?.url ?? 'https://codeberg.org').replace(/\/+$/, '')
}

/* One source's releases, newest first: [{ version, name, date, url, prerelease, notes }]. */
async function loadReleases(row, { integration, loggedIn, perRepo, signal }) {
  const name = String(row.repo ?? '').trim()
  const count = Math.max(1, Math.min(10, perRepo)) + 5 // a few more, in case prereleases are left out
  switch (row.source) {
    case 'gitlab': {
      const project = encodeURIComponent(name)
      const list = integration ? await integrationGet(integration.id, 'api', { path: `/projects/${project}/releases`, per_page: count }, signal) : await fetchJson(`https://gitlab.com/api/v4/projects/${project}/releases?per_page=${count}`, { signal })
      const web = (integration?.url ?? 'https://gitlab.com').replace(/\/+$/, '')
      return list.map((release) => ({ version: release.tag_name, name: release.name, date: release.released_at ?? release.created_at, url: release._links?.self ?? `${web}/${name}/-/releases/${encodeURIComponent(release.tag_name)}`, prerelease: Boolean(release.upcoming_release), notes: release.description ?? '' }))
    }
    case 'gitea': {
      const host = giteaHost(integration)
      const list = integration ? await integrationGet(integration.id, 'api', { path: `/repos/${name}/releases`, limit: count }, signal) : await fetchJson(`${host}/api/v1/repos/${name}/releases?limit=${count}`, { signal })
      return list.filter((release) => !release.draft).map((release) => ({ version: release.tag_name, name: release.name, date: release.published_at ?? release.created_at, url: release.html_url, prerelease: Boolean(release.prerelease), notes: release.body ?? '' }))
    }
    case 'npm': {
      const data = await fetchJson(`https://registry.npmjs.org/${name.replace('/', '%2F')}/latest`, { signal })
      return [{ version: data.version, name: data.name, date: null, url: `https://www.npmjs.com/package/${name}`, prerelease: false, notes: data.description ?? '' }]
    }
    case 'pypi': {
      const data = await fetchJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, { signal })
      const versions = Object.entries(data.releases ?? {})
        .map(([version, files]) => ({ version, date: files?.[0]?.upload_time_iso_8601 ?? null, yanked: files?.every((file) => file.yanked) }))
        .filter((entry) => entry.date && !entry.yanked)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
      return versions.slice(0, count).map((entry) => ({ version: entry.version, name: data.info?.name, date: entry.date, url: `https://pypi.org/project/${data.info?.name ?? name}/${entry.version}/`, prerelease: /[a-z]/i.test(entry.version), notes: entry.version === data.info?.version ? (data.info?.summary ?? '') : '' }))
    }
    case 'docker': {
      const path = name.includes('/') ? name : `library/${name}`
      const data = await proxyJson(`https://hub.docker.com/v2/repositories/${path}/tags?page_size=25&ordering=last_updated`, signal)
      return (data.results ?? [])
        .filter((tag) => tag.name !== 'latest' && !/^(sha256-|.*-(rc|beta|alpha)\b)/i.test(tag.name))
        .map((tag) => ({ version: tag.name, name, date: tag.last_updated, url: `https://hub.docker.com/${name.includes('/') ? `r/${name}` : `_/${name}`}/tags`, prerelease: false, notes: '' }))
    }
    case 'crates': {
      const data = await corsJson(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`, { signal, loggedIn })
      return (data.versions ?? [])
        .filter((version) => !version.yanked)
        .slice(0, count)
        .map((version) => ({ version: version.num, name: data.crate?.name, date: version.created_at, url: `https://crates.io/crates/${data.crate?.name}/${version.num}`, prerelease: /-/.test(version.num), notes: version.num === data.crate?.max_stable_version ? (data.crate?.description ?? '') : '' }))
    }
    default: {
      const list = integration ? await integrationGet(integration.id, 'api', { path: `/repos/${name}/releases`, per_page: count }, signal) : await fetchJson(`https://api.github.com/repos/${name}/releases?per_page=${count}`, { signal })
      return list.filter((release) => !release.draft).map((release) => ({ version: release.tag_name, name: release.name, date: release.published_at ?? release.created_at, url: release.html_url, prerelease: Boolean(release.prerelease), notes: release.body ?? '' }))
    }
  }
}

const validRow = (row) => {
  if (!row || !RELEASE_SOURCES.includes(row.source ?? 'github')) return false
  const name = String(row.repo ?? '').trim()
  return ['github', 'gitlab', 'gitea'].includes(row.source ?? 'github') ? REPO_NAME.test(name) || (row.source === 'gitlab' && /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+){1,4}$/.test(name)) : PACKAGE_NAME.test(name)
}

/* The integration a widget uses for a source (its own choice, else none = public access). */
function integrationFor(widget, source) {
  const id = widget.options[`${source}Integration`]
  const item = id ? integrationById(id) : null
  return item && item.kind === source ? item : null
}

const releaseKey = (row) => `${row.source ?? 'github'}:${String(row.repo ?? '').trim()}`
const firstLine = (notes) => String(notes ?? '').replace(/<[^>]+>/g, ' ').replace(/[#*_`>[\]]/g, '').split('\n').find((line) => line.trim())?.trim().slice(0, 160) ?? ''

/* One project's releases (cached per source; kit.jsx useRemote). */
function useReleases(row, widget, loggedIn) {
  const source = row.source ?? 'github'
  const integration = integrationFor(widget, source)
  const name = String(row.repo).trim()
  const { data, error, reload } = useRemote(
    `rel:${source}:${name}:${integration?.id ?? ''}`,
    (signal) => loadReleases({ ...row, source }, { integration, loggedIn, perRepo: 10, signal }),
    { refresh: integration ? 15 * 60 : 45 * 60, private: Boolean(integration) },
  )
  const all = (data ?? []).filter((release) => widget.options.prereleases || !release.prerelease)
  return { source, name, integration, data, all, error, reload }
}

/*
 * A project in the list. New since you last looked (the version you marked
 * read, synced with the dash): a dot, bold, "new". Click: the details.
 */
function ReleaseRow({ row, widget, loggedIn, onData, onOpen, seen, onFirstSeen }) {
  const { t, i18n } = useTranslation('dash')
  const { perRepo = 1, notes = false, icons = 'auto', dates = 'relative', display = 'list', newDays = 7, unreadOnly = false } = widget.options
  const { source, name, integration, data, all, error, reload } = useReleases(row, widget, loggedIn)
  const shown = all.slice(0, Math.max(1, Math.min(10, perRepo)))
  const newest = all[0]
  const key = releaseKey(row)
  const unread = Boolean(newest && seen !== undefined && seen !== newest.version)
  const latest = newest?.version
  useEffect(() => {
    if (latest !== undefined) onData(key, { date: newest?.date ?? null, unread, latest })
    // newest is followed through its version and date
  }, [key, latest, newest?.date, unread, onData]) // eslint-disable-line react-hooks/exhaustive-deps
  // A project you just added starts as read (only what comes out after that is new).
  useEffect(() => {
    if (latest !== undefined && seen === undefined) onFirstSeen(key, latest)
  }, [key, latest, seen, onFirstSeen])
  if (unreadOnly && data && !unread) return null
  const label = row.label || name
  const fresh = (date) => date && Date.now() - new Date(date).getTime() < Math.max(1, Number(newDays) || 7) * 86_400_000
  const when = (date) => (dates === 'date' ? new Date(date).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' }) : timeAgo(date, i18n.language))
  return (
    <li className={`dash-w-rel__repo dash-w-rel__repo--${display}${unread ? ' is-unread' : ''}`}>
      <button type="button" className="dash-w-rel__open" onClick={() => onOpen(row)} aria-label={`${label}${unread ? `, ${t('widgets.releases.new')}` : ''}`}>
        <span className="dash-w-rel__icon">
          <RepoIcon sources={iconsFor(source, name, icons, giteaHost(integration))} size={display === 'compact' ? 22 : 30} />
          {unread && <span className="dash-w-rel__dot" aria-hidden="true" />}
        </span>
        <span className="dash-w-rel__main">
          <span className="dash-w-rel__name">
            <span>{label}</span>
            {source !== 'github' && display !== 'compact' && <small className="dash-chip">{t(`widgets.releases.sources.${source}`)}</small>}
          </span>
          {!data && !error && <span className="skeleton skeleton--text" style={{ width: '6em' }} />}
          {!data && error && <small className="dash-w-rel__error">{t('widgets.releases.failed')}</small>}
          {data && !shown.length && <small className="dash-muted">{t('widgets.releases.none')}</small>}
          {shown.map((release, index) => (
            <span key={release.version} className="dash-w-rel__version">
              <strong>{release.version}</strong>
              {index === 0 && unread && <small className="dash-chip dash-chip--new">{t('widgets.releases.new')}</small>}
              {index === 0 && !unread && fresh(release.date) && <small className="dash-chip">{t('widgets.releases.recent')}</small>}
              {release.prerelease && <small className="dash-chip dash-chip--warn">{t('widgets.releases.pre')}</small>}
              {release.date && (
                <time dateTime={release.date} title={new Date(release.date).toLocaleString(i18n.language)}>
                  {when(release.date)}
                </time>
              )}
              {notes && display !== 'compact' && firstLine(release.notes) && <span className="dash-w-rel__notes">{firstLine(release.notes)}</span>}
            </span>
          ))}
        </span>
      </button>
      {!data && error && (
        <button type="button" className="dash-tool dash-w-rel__retry" onClick={reload} title={error} aria-label={t('widgets.releases.failed')}>
          <span className="material-symbols-outlined">refresh</span>
        </button>
      )}
    </li>
  )
}

/* The details of one project: every version, the notes, read / unread. */
function ReleaseDetail({ row, widget, loggedIn, seen, onSeen, onClose }) {
  const { t, i18n } = useTranslation('dash')
  const ref = useRef(null)
  const { source, name, integration, data, all, error, reload } = useReleases(row, widget, loggedIn)
  const [open, setOpen] = useState(null)
  const newest = all[0]
  const current = open ?? newest?.version
  const release = all.find((entry) => entry.version === current) ?? newest
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  const unreadIndex = all.findIndex((entry) => entry.version === seen)
  const isNew = (index) => seen !== undefined && (unreadIndex === -1 ? index === 0 : index < unreadIndex)
  return (
    <dialog ref={ref} className="dash-dialog dash-dialog--release" onClose={onClose} aria-labelledby="dash-rel-title" onClick={(event) => event.target === ref.current && ref.current.close()}>
      <header className="dash-dialog__head">
        <RepoIcon sources={iconsFor(source, name, widget.options.icons ?? 'auto', giteaHost(integration))} size={28} />
        <h2 id="dash-rel-title">
          {row.label || name}
          <small>{t(`widgets.releases.sources.${source}`)}</small>
        </h2>
        <button type="button" className="dash-tool" onClick={() => ref.current?.close()} aria-label={t('settings.close')}>
          <span className="material-symbols-outlined">close</span>
        </button>
      </header>
      {!data ? (
        error ? (
          <div className="dash-rel-detail__state">
            <LoadError error={error} onRetry={reload} />
          </div>
        ) : (
          <div className="dash-rel-detail__state">
            <Loading lines={6} />
          </div>
        )
      ) : !all.length ? (
        <p className="dash-rel-detail__state dash-muted">{t('widgets.releases.none')}</p>
      ) : (
        <div className="dash-rel-detail">
          <ol className="dash-rel-detail__versions" aria-label={t('widgets.releases.versions')}>
            {all.map((entry, index) => (
              <li key={entry.version}>
                <button type="button" className={entry.version === release?.version ? 'is-active' : ''} aria-current={entry.version === release?.version} onClick={() => setOpen(entry.version)}>
                  <strong>{entry.version}</strong>
                  {isNew(index) && <small className="dash-chip dash-chip--new">{t('widgets.releases.new')}</small>}
                  {entry.prerelease && <small className="dash-chip dash-chip--warn">{t('widgets.releases.pre')}</small>}
                  {entry.date && <time dateTime={entry.date}>{timeAgo(entry.date, i18n.language)}</time>}
                </button>
              </li>
            ))}
          </ol>
          {release && (
            <article className="dash-rel-detail__body">
              <header>
                <h3>{release.name && release.name !== release.version ? release.name : release.version}</h3>
                <p className="dash-muted">
                  {release.version}
                  {release.date && ` · ${new Date(release.date).toLocaleString(i18n.language, { dateStyle: 'long', timeStyle: 'short' })}`}
                </p>
              </header>
              {release.notes ? <MarkdownLite text={release.notes} max={160} /> : <p className="dash-muted">{t('widgets.releases.noNotes')}</p>}
            </article>
          )}
        </div>
      )}
      <footer className="dash-dialog__foot dash-rel-detail__foot">
        {newest && (
          <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => onSeen(seen === newest.version ? (all[1]?.version ?? '') : newest.version)}>
            <span className="material-symbols-outlined" aria-hidden="true">
              {seen === newest.version ? 'mark_email_unread' : 'done_all'}
            </span>
            {seen === newest.version ? t('widgets.releases.markUnread') : t('widgets.releases.markRead')}
          </button>
        )}
        {release?.url && (
          <a className="dash-button dash-button--small" href={release.url} target="_blank" rel="noopener noreferrer">
            <span className="material-symbols-outlined" aria-hidden="true">
              open_in_new
            </span>
            {t('widgets.releases.openRelease')}
          </a>
        )}
      </footer>
    </dialog>
  )
}

function ReleasesView({ widget }) {
  const { t } = useTranslation('dash')
  const { account } = useAccountSettings()
  useIntegrations() // re-render when the list of integrations arrives
  const rows = (widget.options.repos ?? []).filter(validRow)
  const loggedIn = loggedInOf(account)
  const seen = widget.options.seen && typeof widget.options.seen === 'object' ? widget.options.seen : {}
  const [known, setKnown] = useState({})
  const [detail, setDetail] = useState(null)
  const recordData = useCallback((key, value) => setKnown((current) => (current[key]?.date === value.date && current[key]?.unread === value.unread && current[key]?.latest === value.latest ? current : { ...current, [key]: value })), [])
  // What you've read is kept with the widget (so every device knows it); first sight of a project counts as read.
  const markSeen = useCallback((patch) => updateWidgetOptions(widget.id, (options) => ({ seen: { ...(options.seen ?? {}), ...patch } })), [widget.id])
  const firstSeen = useCallback((key, version) => markSeen({ [key]: version }), [markSeen])
  if (!rows.length) return <Empty icon="new_releases" setup>{t('widgets.releases.empty')}</Empty>
  const { sort = 'date', display = 'list', readOnOpen = true } = widget.options
  const time = (row) => new Date(known[releaseKey(row)]?.date ?? 0).getTime() || 0
  const ordered = sort === 'order' ? rows : [...rows].sort((a, b) => (sort === 'unread' ? Number(Boolean(known[releaseKey(b)]?.unread)) - Number(Boolean(known[releaseKey(a)]?.unread)) : 0) || time(b) - time(a))
  const unread = rows.filter((row) => known[releaseKey(row)]?.unread)
  const open = (row) => {
    setDetail(row)
    if (readOnOpen) {
      const key = releaseKey(row)
      if (known[key]?.unread && known[key]?.latest !== undefined) markSeen({ [key]: known[key].latest })
    }
  }
  return (
    <div className={`dash-w-rel-wrap dash-w-rel-wrap--${display}`}>
      {unread.length > 0 && (
        <div className="dash-w-rel__bar">
          <span>{t('widgets.releases.unread', { count: unread.length })}</span>
          <button type="button" className="dash-link-button" onClick={() => markSeen(Object.fromEntries(unread.map((row) => [releaseKey(row), known[releaseKey(row)].latest])))}>
            {t('widgets.releases.markAllRead')}
          </button>
        </div>
      )}
      <ul className={`dash-w-rel dash-w-rel--${display}`}>
        {ordered.map((row) => (
          <ReleaseRow key={releaseKey(row)} row={row} widget={widget} loggedIn={loggedIn} onData={recordData} onOpen={open} seen={seen[releaseKey(row)]} onFirstSeen={firstSeen} />
        ))}
      </ul>
      {widget.options.unreadOnly && !unread.length && Object.keys(known).length >= rows.length && <Empty icon="done_all">{t('widgets.releases.allRead')}</Empty>}
      {detail && (
        <ReleaseDetail
          row={detail}
          widget={widget}
          loggedIn={loggedIn}
          seen={seen[releaseKey(detail)]}
          onSeen={(version) => markSeen({ [releaseKey(detail)]: version })}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  )
}

/* ---------- one repository ---------- */

async function loadRepo(source, name, integration, { commits, pulls }, signal) {
  const get = (path, params = {}) => {
    if (integration) return integrationGet(integration.id, 'api', { path, ...params }, signal)
    const base = source === 'gitlab' ? 'https://gitlab.com/api/v4' : source === 'gitea' ? `${giteaHost(null)}/api/v1` : 'https://api.github.com'
    return fetchJson(`${base}${path}${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`, { signal })
  }
  if (source === 'gitlab') {
    const project = `/projects/${encodeURIComponent(name)}`
    const [info, commitList, mrList] = await Promise.all([get(project), commits ? get(`${project}/repository/commits`, { per_page: commits }) : [], pulls ? get(`${project}/merge_requests`, { state: 'opened', per_page: pulls }) : []])
    return {
      name: info.path_with_namespace,
      description: info.description,
      url: info.web_url,
      stars: info.star_count,
      forks: info.forks_count,
      issues: info.open_issues_count,
      pushed: info.last_activity_at,
      language: null,
      avatar: info.avatar_url,
      commits: commitList.map((commit) => ({ id: commit.id, title: commit.title, author: commit.author_name, date: commit.created_at, url: commit.web_url })),
      pulls: mrList.map((mr) => ({ id: mr.iid, title: mr.title, author: mr.author?.username, date: mr.created_at, url: mr.web_url })),
    }
  }
  if (source === 'gitea') {
    const repo = `/repos/${name}`
    const [info, commitList, prList] = await Promise.all([get(repo), commits ? get(`${repo}/commits`, { limit: commits }) : [], pulls ? get(`${repo}/pulls`, { state: 'open', limit: pulls }) : []])
    return {
      name: info.full_name,
      description: info.description,
      url: info.html_url,
      stars: info.stars_count,
      forks: info.forks_count,
      issues: info.open_issues_count,
      pushed: info.updated_at,
      language: info.language,
      avatar: info.avatar_url || info.owner?.avatar_url,
      commits: commitList.map((commit) => ({ id: commit.sha, title: String(commit.commit?.message ?? '').split('\n')[0], author: commit.commit?.author?.name, date: commit.commit?.author?.date, url: commit.html_url })),
      pulls: prList.map((pr) => ({ id: pr.number, title: pr.title, author: pr.user?.login, date: pr.created_at, url: pr.html_url })),
    }
  }
  const repo = `/repos/${name}`
  const [info, commitList, prList] = await Promise.all([get(repo), commits ? get(`${repo}/commits`, { per_page: commits }) : [], pulls ? get(`${repo}/pulls`, { state: 'open', per_page: pulls }) : []])
  return {
    name: info.full_name,
    description: info.description,
    url: info.html_url,
    stars: info.stargazers_count,
    forks: info.forks_count,
    issues: info.open_issues_count,
    pushed: info.pushed_at,
    language: info.language,
    avatar: info.owner?.avatar_url,
    private: info.private,
    commits: commitList.map((commit) => ({ id: commit.sha, title: String(commit.commit?.message ?? '').split('\n')[0], author: commit.author?.login ?? commit.commit?.author?.name, date: commit.commit?.author?.date, url: commit.html_url })),
    pulls: prList.map((pr) => ({ id: pr.number, title: pr.title, author: pr.user?.login, date: pr.created_at, url: pr.html_url })),
  }
}

function RepoView({ widget }) {
  const { t, i18n } = useTranslation('dash')
  useIntegrations()
  const source = ['github', 'gitlab', 'gitea'].includes(widget.options.source) ? widget.options.source : 'github'
  const name = String(widget.options.repo ?? '').trim()
  const valid = source === 'gitlab' ? /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+){1,4}$/.test(name) : REPO_NAME.test(name)
  const integration = integrationFor(widget, source)
  const commits = Math.max(0, Math.min(10, Number(widget.options.commits ?? 3)))
  const pulls = Math.max(0, Math.min(10, Number(widget.options.pulls ?? 0)))
  const { data, error, reload } = useRemote(valid ? `repo:${source}:${name}:${integration?.id ?? ''}:${commits}:${pulls}` : null, (signal) => loadRepo(source, name, integration, { commits, pulls }, signal), { refresh: integration ? 10 * 60 : 30 * 60, enabled: valid, private: Boolean(integration) })
  if (!valid) return <Empty icon="folder_code" setup>{t('widgets.repo.empty')}</Empty>
  if (!data) return error ? <LoadError error={error} onRetry={reload} /> : <Loading lines={4} />
  const stats = [
    ['star', data.stars, t('widgets.repo.stars')],
    ['fork_right', data.forks, t('widgets.repo.forks')],
    ['adjust', data.issues, t('widgets.repo.issues')],
  ]
  return (
    <div className="dash-w-repo">
      <a className="dash-w-repo__head" href={data.url} target="_blank" rel="noopener noreferrer">
        <RepoIcon sources={[...iconsFor(source, name, widget.options.icons ?? 'auto').slice(0, 2), ...(data.avatar ? [data.avatar] : []), dashboardIconUrl(PROVIDER_ICON[source])]} size={36} />
        <span>
          <strong>{data.name}</strong>
          {data.description && <small>{data.description}</small>}
        </span>
        {data.private && <span className="dash-chip">{t('widgets.repo.private')}</span>}
      </a>
      <ul className="dash-w-repo__stats">
        {stats.map(([icon, value, label]) => (
          <li key={icon} title={label}>
            <span className="material-symbols-outlined" aria-hidden="true">
              {icon}
            </span>
            <strong>{compactNumber(value, i18n.language)}</strong>
            <span className="sr-only">{label}</span>
          </li>
        ))}
        {data.language && <li className="dash-w-repo__lang">{data.language}</li>}
        {data.pushed && <li className="dash-w-repo__pushed">{t('widgets.repo.updated', { when: timeAgo(data.pushed, i18n.language) })}</li>}
      </ul>
      {[
        ['commits', data.commits, 'commit'],
        ['pulls', data.pulls, 'merge'],
      ].map(([kind, list, icon]) =>
        list.length ? (
          <div key={kind} className="dash-w-repo__list">
            <h3>{t(`widgets.repo.${kind}`)}</h3>
            <ul>
              {list.map((entry) => (
                <li key={entry.id}>
                  <a href={entry.url} target="_blank" rel="noopener noreferrer">
                    <span className="material-symbols-outlined" aria-hidden="true">
                      {icon}
                    </span>
                    <span className="dash-w-repo__title">{entry.title}</span>
                    <small>
                      {entry.author} · {timeAgo(entry.date, i18n.language)}
                    </small>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
      {error && <LoadError error={error} compact />}
    </div>
  )
}

/* ---------- feeds ---------- */

function FeedSource({ url, refresh, onItems }) {
  const { data, error } = useRemote(`feed:${url}`, (signal) => loadFeed(url, signal), { refresh })
  useEffect(() => {
    onItems(url, { data, error })
  }, [url, data, error, onItems])
  return null
}

function FeedView({ widget }) {
  const { t, i18n } = useTranslation('dash')
  const { account } = useAccountSettings()
  const { limit = 15, style = 'list', images = true, summary = false, source = true, newTab = true, refresh = 30, group = 'mixed', perFeed = 5 } = widget.options
  const [tab, setTab] = useState(null)
  const rows = (widget.options.feeds ?? []).filter((row) => /^https?:\/\//i.test(String(row?.url ?? '').trim()))
  const [results, setResults] = useState({})
  const record = useCallback((url, result) => setResults((old) => (old[url]?.data === result.data && old[url]?.error === result.error ? old : { ...old, [url]: result })), [])
  const items = useMemo(() => {
    const seen = new Set()
    const all = []
    for (const row of rows) {
      const data = results[row.url]?.data
      for (const item of data?.items ?? []) {
        const key = item.link || item.id || item.title
        if (!key || seen.has(key)) continue
        seen.add(key)
        all.push({ ...item, source: row.title || data.title || hostOf(row.url), feed: row.url })
      }
    }
    return all.sort((a, b) => (new Date(b.date).getTime() || 0) - (new Date(a.date).getTime() || 0))
  }, [rows, results])
  // Grouped by feed (each with its own limit), as tabs, or all mixed by date.
  const grouping = ['feed', 'tabs'].includes(group) ? group : 'none'
  const groups = useMemo(
    () =>
      rows
        .map((row) => {
          const own = items.filter((item) => item.feed === row.url)
          return { url: row.url, title: row.title || results[row.url]?.data?.title || hostOf(row.url), items: own.slice(0, Math.max(1, Math.min(30, Number(perFeed) || 5))), total: own.length }
        })
        .filter((entry) => entry.items.length),
    [rows, items, results, perFeed],
  )
  const mixed = items.slice(0, Math.max(3, Math.min(60, Number(limit) || 15)))

  if (!siteConfig.dashFeeds) return <Empty icon="rss_feed">{t('widgets.feed.off')}</Empty>
  if (!loggedInOf(account)) return <Empty icon="rss_feed">{t('widgets.feed.login')}</Empty>
  if (!rows.length) return <Empty icon="rss_feed" setup>{t('widgets.feed.empty')}</Empty>

  const settled = rows.filter((row) => results[row.url] && (results[row.url].data || results[row.url].error))
  const errors = rows.filter((row) => results[row.url]?.error && !results[row.url]?.data)
  const refreshSeconds = Math.max(5, Math.min(1440, Number(refresh) || 30)) * 60
  const target = newTab ? '_blank' : undefined
  const layout = ['list', 'cards', 'compact', 'magazine'].includes(style) ? style : 'list'

  // One list of items (all feeds mixed, or one feed's when grouped: its name isn't repeated then).
  const feedList = (list, grouped = false) => (
        <ul>
          {list.map((item, index) => {
            const showImage = images && item.image && (layout !== 'compact')
            return (
              <li key={item.link || item.id || index} className={layout === 'magazine' && index === 0 ? 'is-lead' : undefined}>
                <a href={item.link || undefined} target={target} rel="noopener noreferrer">
                  {showImage && <SoftImage className="dash-w-feed__image" src={item.image} width={layout === 'list' ? 72 : 320} height={layout === 'list' ? 54 : 180} />}
                  <span className="dash-w-feed__text">
                    <span className="dash-w-feed__title">{item.title || t('widgets.feed.untitled')}</span>
                    {summary && item.summary && layout !== 'compact' && <span className="dash-w-feed__summary">{item.summary}</span>}
                    <small>
                      {source && !grouped && <span>{item.source}</span>}
                      {item.date && !Number.isNaN(new Date(item.date).getTime()) && <time dateTime={new Date(item.date).toISOString()}>{timeAgo(item.date, i18n.language)}</time>}
                    </small>
                  </span>
                </a>
              </li>
            )
          })}
        </ul>
      )

  return (
    <div className={`dash-w-feed dash-w-feed--${layout}${grouping !== 'none' ? ' is-grouped' : ''}`}>
      {rows.map((row) => (
        <FeedSource key={row.url} url={row.url} refresh={refreshSeconds} onItems={record} />
      ))}
      {grouping === 'tabs' && groups.length > 1 && (
        <div className="dash-w-feed__tabs" role="tablist" aria-label={t('widgets.feed.feeds')}>
          {groups.map((entry) => {
            const active = (tab ?? groups[0].url) === entry.url
            return (
              <button key={entry.url} type="button" role="tab" aria-selected={active} className={active ? 'is-active' : ''} onClick={() => setTab(entry.url)}>
                <Favicon url={entry.url} size={14} />
                {entry.title}
              </button>
            )
          })}
        </div>
      )}
      {!items.length && settled.length < rows.length && <Loading lines={5} />}
      {!items.length && settled.length === rows.length && (errors.length ? <LoadError error={errors.map((row) => `${hostOf(row.url)}: ${results[row.url].error === 'not-a-feed' ? t('widgets.feed.notAFeed') : results[row.url].error}`).join('\n')} /> : <Empty icon="rss_feed">{t('widgets.feed.nothing')}</Empty>)}
      {items.length > 0 && grouping === 'none' && feedList(mixed)}
      {items.length > 0 && grouping === 'feed' &&
        groups.map((entry) => (
          <section key={entry.url} className="dash-w-feed__group" aria-label={entry.title}>
            <h4 className="dash-w-feed__group-title">
              <Favicon url={entry.url} size={14} />
              <span>{entry.title}</span>
              <small>{entry.total}</small>
            </h4>
            {feedList(entry.items, true)}
          </section>
        ))}
      {items.length > 0 && grouping === 'tabs' && feedList((groups.find((entry) => entry.url === tab) ?? groups[0])?.items ?? [], groups.length > 1)}
      {items.length > 0 && errors.length > 0 && <LoadError error={errors.map((row) => hostOf(row.url)).join(', ')} compact />}
    </div>
  )
}

/* ---------- Hacker News (Algolia's API) ---------- */

const HN_LISTS = {
  top: 'search?tags=front_page',
  new: 'search_by_date?tags=story',
  best: 'search?tags=story&numericFilters=points>250',
  ask: 'search_by_date?tags=ask_hn',
  show: 'search_by_date?tags=show_hn',
}

function HackerNewsView({ widget }) {
  const { t, i18n } = useTranslation('dash')
  const { list = 'top', count = 15, points = true, comments = true, domain = true, newTab = true } = widget.options
  const path = HN_LISTS[list] ?? HN_LISTS.top
  const size = Math.max(3, Math.min(50, Number(count) || 15))
  const { data, error, reload } = useRemote(`hn:${list}:${size}`, (signal) => fetchJson(`https://hn.algolia.com/api/v1/${path}&hitsPerPage=${size}`, { signal }), { refresh: 10 * 60 })
  if (!data) return error ? <LoadError error={error} onRetry={reload} /> : <Loading lines={6} />
  const target = newTab ? '_blank' : undefined
  return (
    <ol className="dash-w-hn">
      {(data.hits ?? []).map((hit) => {
        const discussion = `https://news.ycombinator.com/item?id=${hit.objectID}`
        const link = /^https?:\/\//i.test(hit.url ?? '') ? hit.url : discussion
        return (
          <li key={hit.objectID}>
            <a className="dash-w-hn__title" href={link} target={target} rel="noopener noreferrer">
              {hit.title}
              {domain && hit.url && <small> ({hostOf(hit.url)})</small>}
            </a>
            <small className="dash-w-hn__meta">
              {points && <span>{t('widgets.hackernews.points', { count: hit.points ?? 0 })}</span>}
              {comments && (
                <a href={discussion} target={target} rel="noopener noreferrer">
                  {t('widgets.hackernews.comments', { count: hit.num_comments ?? 0 })}
                </a>
              )}
              <span>{timeAgo(hit.created_at, i18n.language)}</span>
            </small>
          </li>
        )
      })}
    </ol>
  )
}

/* ---------- crypto prices (CoinGecko, no key) ---------- */

function MarketsView({ widget }) {
  const { t, i18n } = useTranslation('dash')
  const { currency = 'usd', sparkline = true, change = true } = widget.options
  const ids = (widget.options.coins ?? [])
    .map((row) => String(row?.coin ?? '').trim().toLowerCase())
    .filter((id) => /^[a-z0-9-]{1,60}$/.test(id))
    .slice(0, 25)
  const key = ids.join(',')
  const { data, error, reload } = useRemote(
    ids.length ? `markets:${currency}:${key}` : null,
    (signal) => fetchJson(`https://api.coingecko.com/api/v3/coins/markets?${new URLSearchParams({ vs_currency: currency, ids: key, sparkline: 'true', price_change_percentage: '24h' })}`, { signal }),
    { refresh: 5 * 60, enabled: ids.length > 0 },
  )
  if (!ids.length) return <Empty icon="monitoring" setup>{t('widgets.markets.empty')}</Empty>
  if (!data) return error ? <LoadError error={error} onRetry={reload} /> : <Loading lines={ids.length} />
  const order = new Map(ids.map((id, index) => [id, index]))
  const money = (value) => {
    try {
      return new Intl.NumberFormat(i18n.language, { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: value < 1 ? 6 : value < 100 ? 2 : 0 }).format(value)
    } catch {
      return String(value)
    }
  }
  return (
    <ul className="dash-w-markets">
      {[...data]
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
        .map((coin) => {
          const delta = Number(coin.price_change_percentage_24h_in_currency ?? coin.price_change_percentage_24h)
          const rising = delta >= 0
          return (
            <li key={coin.id}>
              <a href={`https://www.coingecko.com/en/coins/${coin.id}`} target="_blank" rel="noopener noreferrer">
                <SoftImage className="dash-w-markets__icon" src={coin.image} width={24} height={24} />
                <span className="dash-w-markets__name">
                  <strong>{coin.symbol?.toUpperCase()}</strong>
                  <small>{coin.name}</small>
                </span>
                {sparkline && <Sparkline values={coin.sparkline_in_7d?.price?.filter((_, index) => index % 4 === 0)} rising={rising} />}
                <span className="dash-w-markets__price">
                  <Num>{money(coin.current_price)}</Num>
                  {change && Number.isFinite(delta) && (
                    <small className={rising ? 'is-up' : 'is-down'}>
                      {rising ? '+' : ''}
                      {delta.toFixed(2)}%
                    </small>
                  )}
                </span>
              </a>
            </li>
          )
        })}
      {error && <LoadError error={error} compact />}
    </ul>
  )
}

/* ---------- Minecraft server (mcstatus.io) ---------- */

function MinecraftView({ widget }) {
  const { t } = useTranslation('dash')
  const address = String(widget.options.address ?? '').trim()
  const edition = widget.options.edition === 'bedrock' ? 'bedrock' : 'java'
  const valid = /^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/.test(address)
  const { players = true, motd = true } = widget.options
  const { data, error, reload } = useRemote(valid ? `mc:${edition}:${address}` : null, (signal) => fetchJson(`https://api.mcstatus.io/v2/status/${edition}/${encodeURIComponent(address)}`, { signal }), { refresh: 60, enabled: valid })
  if (!valid) return <Empty icon="dns" setup>{t('widgets.minecraft.empty')}</Empty>
  if (!data) return error ? <LoadError error={error} onRetry={reload} /> : <Loading lines={2} />
  const list = data.players?.list ?? []
  return (
    <div className="dash-w-mc">
      <div className="dash-w-mc__head">
        {data.icon?.startsWith('data:image/png;base64,') ? <img className="dash-w-mc__icon" src={data.icon} alt="" width={40} height={40} /> : <span className="material-symbols-outlined dash-w-mc__icon" aria-hidden="true">dns</span>}
        <span>
          <strong>{widget.options.label || address}</strong>
          <small>
            <span className={`dash-dot dash-dot--${data.online ? 'up' : 'down'}`} aria-hidden="true" /> {data.online ? t('widgets.minecraft.online', { count: data.players?.online ?? 0, max: data.players?.max ?? 0 }) : t('widgets.minecraft.offline')}
            {data.online && data.version?.name_clean && ` · ${data.version.name_clean}`}
          </small>
        </span>
      </div>
      {motd && data.online && data.motd?.clean && <p className="dash-w-mc__motd">{data.motd.clean}</p>}
      {players && list.length > 0 && (
        <ul className="dash-w-mc__players">
          {list.slice(0, 24).map((player) => (
            <li key={player.uuid ?? player.name_clean} title={player.name_clean}>
              {player.uuid && <SoftImage src={`https://mc-heads.net/avatar/${player.uuid}/24`} width={20} height={20} />}
              <span>{player.name_clean}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export const FEED_VIEWS = { ReleasesView, RepoView, FeedView, HackerNewsView, MarketsView, MinecraftView }
