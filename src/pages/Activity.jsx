import { useCallback, useEffect, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'

import { loadActivity } from '/src/lib/fdc'
import '/src/styles/activity.css'

/*
 * Site-wide activity log for editors (server/services/activityLog.cjs):
 * logins and everything editors do. Read only: nobody can edit or delete
 * entries, and the page shows whether the log's hash chain is intact.
 *
 *   Risky    deleting, creating polls, editing ended polls, …
 *   Normal   everything, short
 *   Verbose  everything, with the exact changes
 */

const VIEWS = ['risky', 'normal', 'verbose']

function dayLabel(iso, language) {
  return new Intl.DateTimeFormat(language || undefined, { dateStyle: 'full' }).format(new Date(iso))
}

function timeLabel(iso, language) {
  return new Intl.DateTimeFormat(language || undefined, { timeStyle: 'short' }).format(new Date(iso))
}

/* Human readable details: option changes as "from → to", the rest as a small table. */
function Details({ details }) {
  const { t } = useTranslation('activity')
  if (!details) return null

  if (Array.isArray(details.changes)) {
    return (
      <ul className="activity-details">
        {details.changes.map((change) => (
          <li key={change.number}>
            <strong>{t('option', { defaultValue: 'Option {{number}}', number: change.number })}</strong>
            {['description', 'emoji', 'image'].map((field) =>
              change[field] ? (
                <span key={field} className="activity-change">
                  {t(`field.${field}`, { defaultValue: field })}: <del>{String(change[field].from ?? '—')}</del> →{' '}
                  <ins>{String(change[field].to ?? '—')}</ins>
                </span>
              ) : null,
            )}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <dl className="activity-details activity-details--table">
      {Object.entries(details).map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>
            {value === null || value === undefined ? (
              '—'
            ) : Array.isArray(value) && value.every((item) => item && typeof item === 'object' && 'description' in item) ? (
              // Options (recycled items, poll options): one readable line each.
              <ul className="activity-items">
                {value.map((item, index) => (
                  <li key={index}>
                    {item.key ? `${item.key.replace(/:(\d+)$/, ' #$1')} · ` : item.number ? `${item.number}. ` : ''}
                    {item.emoji ? `${item.emoji} ` : ''}
                    {item.description}
                  </li>
                ))}
              </ul>
            ) : typeof value === 'object' ? (
              <code>{JSON.stringify(value)}</code>
            ) : (
              String(value)
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export default function Activity() {
  const { t, i18n } = useTranslation('activity')
  const [view, setView] = useState('normal')
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [state, setState] = useState({ entries: [], next: null, loading: true, error: null, integrity: null })

  // Search after typing stops.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    let active = true
    loadActivity({ view, q: search })
      .then((data) => active && setState({ entries: data.entries, next: data.next, loading: false, error: null, integrity: data.integrity }))
      .catch((error) => active && setState({ entries: [], next: null, loading: false, error, integrity: null }))
    return () => {
      active = false
    }
  }, [view, search])

  const loadMore = useCallback(async () => {
    if (!state.next) return
    try {
      const data = await loadActivity({ view, q: search, before: state.next })
      setState((current) => ({ ...current, entries: [...current.entries, ...data.entries], next: data.next }))
    } catch (error) {
      setState((current) => ({ ...current, error }))
    }
  }, [state.next, view, search])

  return (
    <main className="activity-page">
      <Helmet>
        <title>{t('title', { defaultValue: 'Activity log' })}</title>
        <meta name="robots" content="noindex" />
      </Helmet>

      <header className="activity-header">
        <Link to="/cult#fdc" className="activity-back">
          <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
          {t('back', { defaultValue: 'Back to the cult' })}
        </Link>
        <h1>{t('title', { defaultValue: 'Activity log' })}</h1>
        <p>
          {t('intro', {
            defaultValue:
              'Who logged in and what editors did on the site. Read only: nobody can change or delete entries.',
          })}
        </p>
        {state.integrity && (
          <p className={`activity-integrity${state.integrity.intact ? '' : ' is-broken'}`}>
            <span className="material-symbols-outlined" aria-hidden="true">
              {state.integrity.intact ? 'verified' : 'warning'}
            </span>
            {state.integrity.intact
              ? t('intact', { defaultValue: 'Log intact ({{count}} entries, unchanged since they were written)', count: state.integrity.entries })
              : t('broken', {
                  defaultValue: 'Warning: entry {{seq}} was changed or removed outside the site.',
                  seq: state.integrity.problemAt,
                })}
          </p>
        )}
      </header>

      <div className="activity-controls">
        <div className="activity-views" role="radiogroup" aria-label={t('level', { defaultValue: 'Level' })}>
          {VIEWS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={view === value}
              className={view === value ? 'is-active' : ''}
              onClick={() => setView(value)}
            >
              <strong>{t(`views.${value}.label`, { defaultValue: value })}</strong>
              <small>
                {t(`views.${value}.hint`, {
                  defaultValue:
                    value === 'risky'
                      ? 'Deleting, creating polls, editing ended polls'
                      : value === 'normal'
                        ? 'Everything, short'
                        : 'Everything, with exact changes',
                })}
              </small>
            </button>
          ))}
        </div>
        <label className="activity-search">
          <span className="material-symbols-outlined" aria-hidden="true">search</span>
          <input
            type="search"
            value={query}
            placeholder={t('search', { defaultValue: 'Search people, actions, dates…' })}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {state.loading && <p className="activity-empty">{t('loading', { defaultValue: 'Loading…' })}</p>}
      {state.error && (
        <p className="activity-empty activity-error" role="alert">
          {state.error.status === 401
            ? t('loginNeeded', { defaultValue: 'Log in as an editor to see the activity log.' })
            : state.error.status === 403
              ? t('editorsOnly', { defaultValue: 'Only editors can see the activity log.' })
              : state.error.message}
        </p>
      )}
      {!state.loading && !state.error && !state.entries.length && (
        <p className="activity-empty">{t('empty', { defaultValue: 'Nothing logged yet.' })}</p>
      )}

      <ol className="activity-list">
        {state.entries.map((entry, index) => {
          // A day heading before the first entry of each day.
          const showDay = entry.at.slice(0, 10) !== state.entries[index - 1]?.at.slice(0, 10)
          return (
            <li key={entry.seq} className={`activity-entry activity-entry--${entry.level}`}>
              {showDay && <h2 className="activity-day">{dayLabel(entry.at, i18n.language)}</h2>}
              <div className="activity-row">
                <time dateTime={entry.at}>{timeLabel(entry.at, i18n.language)}</time>
                <span className={`activity-level activity-level--${entry.level}`}>
                  {t(`levels.${entry.level}`, { defaultValue: entry.level })}
                </span>
                <p>
                  <strong>{entry.actor?.name ?? t('someone', { defaultValue: 'Someone' })}</strong> {entry.summary}
                </p>
              </div>
              {view === 'verbose' && <Details details={entry.details} />}
            </li>
          )
        })}
      </ol>

      {state.next && (
        <button type="button" className="activity-more" onClick={loadMore}>
          {t('more', { defaultValue: 'Show older entries' })}
        </button>
      )}
    </main>
  )
}
