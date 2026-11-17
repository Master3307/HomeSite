import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'

import CultShell from '/src/components/cult/CultShell'
import { apiUrl, profilePath } from '/src/lib/members'
import { loadLobbyStats, loadMigrationStats } from '/src/lib/stats'
import { whenLoggedIn } from '/src/lib/account'
import { useUrlParam } from '/src/lib/urlState'
import '/src/styles/stats.css'

/*
 * /cult/stats: statistics for FDC editors (account menu → Stats).
 * Migration: who designed how many cats, from the exact migration log.
 * Lobby cat: taps and pets of guests and members. The period (?from, ?to,
 * UTC days) applies to both; tables sort by any column (?sort=column:dir).
 * Private profiles are counted but never named.
 */

const TABS = ['migration', 'lobby']
const DAY = /^\d{4}-\d{2}-\d{2}$/
const utcDay = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

/* ---------- small pieces ---------- */

function Person({ person }) {
  const { t } = useTranslation('stats')
  if (!person) return <span className="stats-person stats-person--none">{t('someone')}</span>
  if (person.private)
    return (
      <span className="stats-person stats-person--private" title={t('privateHint')}>
        <span className="material-symbols-outlined" aria-hidden="true">
          visibility_off
        </span>
        {t('private')}
      </span>
    )
  const face = person.avatarUrl ? (
    <img src={apiUrl(person.avatarUrl)} alt="" width="22" height="22" loading="lazy" />
  ) : (
    <span className="material-symbols-outlined" aria-hidden="true">
      person
    </span>
  )
  return person.username ? (
    <Link className="stats-person" to={profilePath(person)}>
      {face}
      {person.name}
    </Link>
  ) : (
    <span className="stats-person">
      {face}
      {person.name ?? t('someone')}
    </span>
  )
}

function Tile({ label, value, hint, children }) {
  return (
    <div className="stats-tile">
      <span className="stats-tile__label">{label}</span>
      <strong className="stats-tile__value">{value}</strong>
      {hint && <span className="stats-tile__hint">{hint}</span>}
      {children}
    </div>
  )
}

/* A bar split into parts: [{ value, tone, label }]. */
function Split({ parts, label }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0)
  return (
    <div className="stats-split" role="img" aria-label={label ?? parts.map((part) => `${part.label}: ${part.value}`).join(', ')}>
      {parts.map((part) => (
        <span key={part.label} className={`stats-tone--${part.tone}`} style={{ flexGrow: total ? part.value : 0 }} title={`${part.label}: ${part.value}`} />
      ))}
    </div>
  )
}

function Legend({ items }) {
  return (
    <ul className="stats-legend">
      {items.map((item) => (
        <li key={item.label}>
          <span className={`stats-swatch stats-tone--${item.tone}`} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

/* Horizontal bars, one per person, split into parts. */
function Ranking({ rows, parts, empty }) {
  const { i18n } = useTranslation('stats')
  const number = (value) => value.toLocaleString(i18n.language)
  const max = Math.max(1, ...rows.map((row) => parts.reduce((sum, part) => sum + (row[part.key] ?? 0), 0)))
  if (!rows.length) return <p className="members-hint">{empty}</p>
  return (
    <ol className="stats-ranking">
      {rows.map((row, index) => {
        const total = parts.reduce((sum, part) => sum + (row[part.key] ?? 0), 0)
        return (
          <li key={row.key}>
            <span className="stats-ranking__place">{index + 1}</span>
            <Person person={row} />
            <span className="stats-ranking__bar" role="img" aria-label={parts.map((part) => `${part.label}: ${row[part.key] ?? 0}`).join(', ')}>
              {parts.map((part) =>
                row[part.key] ? <span key={part.key} className={`stats-tone--${part.tone}`} style={{ width: `${(row[part.key] / max) * 100}%` }} title={`${part.label}: ${number(row[part.key])}`} /> : null,
              )}
            </span>
            <strong className="stats-ranking__total">{number(total)}</strong>
          </li>
        )
      })}
    </ol>
  )
}

/* Columns per day, each split into parts. */
function Days({ days, parts, label }) {
  const { t, i18n } = useTranslation('stats')
  const max = Math.max(1, ...days.map((day) => parts.reduce((sum, part) => sum + (day[part.key] ?? 0), 0)))
  const format = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', timeZone: 'UTC' })
  if (!days.length) return <p className="members-hint">{t('noDays')}</p>
  // Few labels, so they fit on phones too.
  const every = Math.max(1, Math.ceil(days.length / 5))
  return (
    <figure className="stats-days" aria-label={label}>
      <div className="stats-days__plot">
        {days.map((day) => {
          const total = parts.reduce((sum, part) => sum + (day[part.key] ?? 0), 0)
          return (
            <div key={day.day} className="stats-days__column" title={`${format(day.day)}: ${parts.map((part) => `${part.label} ${day[part.key] ?? 0}`).join(', ')}`}>
              {parts.map((part) => (day[part.key] ? <span key={part.key} className={`stats-tone--${part.tone}`} style={{ height: `${(day[part.key] / max) * 100}%` }} /> : null))}
              {total === 0 && <span className="stats-days__zero" />}
            </div>
          )
        })}
      </div>
      <div className="stats-days__axis" aria-hidden="true">
        {days.map((day, index) => (
          <span key={day.day}>{index % every === 0 ? format(day.day) : ''}</span>
        ))}
      </div>
      <figcaption className="stats-days__max">{t('max', { count: max })}</figcaption>
    </figure>
  )
}

/* A table that sorts by any column (the choice stays in the address). */
function SortTable({ columns, rows, param, initial, empty }) {
  const { t } = useTranslation('stats')
  const [sortParam, setSort] = useUrlParam(param)
  const [key, dir] = String(sortParam ?? initial).split(':')
  const column = columns.find((entry) => entry.id === key) ?? columns.find((entry) => entry.id === initial.split(':')[0])
  const descending = (dir ?? 'desc') !== 'asc'
  const sorted = useMemo(() => {
    const value = (row) => column.sort?.(row) ?? row[column.id]
    return [...rows].sort((a, b) => {
      const x = value(a)
      const y = value(b)
      const order = typeof x === 'string' || typeof y === 'string' ? String(x ?? '').localeCompare(String(y ?? '')) : (x ?? -Infinity) - (y ?? -Infinity)
      return descending ? -order : order
    })
  }, [rows, column, descending])
  const choose = (id) => {
    const next = id === column.id ? (descending ? 'asc' : 'desc') : columns.find((entry) => entry.id === id)?.text ? 'asc' : 'desc'
    setSort(`${id}:${next}`)
  }
  if (!rows.length) return <p className="members-hint">{empty}</p>
  return (
    <div className="stats-table-wrap">
      <table className="stats-table">
        <thead>
          <tr>
            <th scope="col" className="stats-table__place">
              #
            </th>
            {columns.map((entry) => (
              <th key={entry.id} scope="col" aria-sort={entry.id === column.id ? (descending ? 'descending' : 'ascending') : 'none'} className={entry.text ? 'is-text' : ''}>
                <button type="button" onClick={() => choose(entry.id)} title={entry.hint ?? t('sortBy', { column: entry.label })}>
                  {entry.label}
                  <span className="material-symbols-outlined" aria-hidden="true">
                    {entry.id === column.id ? (descending ? 'arrow_downward' : 'arrow_upward') : 'unfold_more'}
                  </span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, index) => (
            <tr key={row.key}>
              <td className="stats-table__place">{index + 1}</td>
              {columns.map((entry) => (
                <td key={entry.id} className={entry.text ? 'is-text' : ''}>
                  {entry.render ? entry.render(row) : row[entry.id]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ---------- the period ---------- */

function Period({ from, to, setRange }) {
  const { t } = useTranslation('stats')
  const presets = [
    ['all', t('period.all'), null, null],
    ['today', t('period.today'), utcDay(), utcDay()],
    ['7', t('period.week'), utcDay(-6), utcDay()],
    ['30', t('period.month'), utcDay(-29), utcDay()],
  ]
  const active = presets.find(([, , start, end]) => (start ?? null) === (from ?? null) && (end ?? null) === (to ?? null))?.[0] ?? 'custom'
  return (
    <div className="stats-period">
      <div className="members-segment" role="radiogroup" aria-label={t('period.label')}>
        {presets.map(([id, label, start, end]) => (
          <button key={id} type="button" role="radio" aria-checked={active === id} className={active === id ? 'is-active' : ''} onClick={() => setRange(start, end)}>
            {label}
          </button>
        ))}
      </div>
      <label className="stats-period__date">
        <span>{t('period.from')}</span>
        <input className="members-input" type="date" value={from ?? ''} max={to ?? undefined} onChange={(event) => setRange(event.target.value || null, to)} />
      </label>
      <label className="stats-period__date">
        <span>{t('period.to')}</span>
        <input className="members-input" type="date" value={to ?? ''} min={from ?? undefined} onChange={(event) => setRange(from, event.target.value || null)} />
      </label>
      <span className="members-hint">{t('period.utc')}</span>
    </div>
  )
}

/* ---------- migration ---------- */

const LOG_FILTERS = ['all', 'migrate', 'suggest', 'review', 'redesign']

function MigrationTab({ range }) {
  const { t, i18n } = useTranslation('stats')
  const [state, setState] = useState({ loading: true })
  const [logFilter, setLogFilter] = useUrlParam('log')
  const [personFilter, setPersonFilter] = useUrlParam('who')
  const number = (value) => (value ?? 0).toLocaleString(i18n.language)
  const when = (at) => (at ? new Date(at).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }) : t('noDate'))

  useEffect(() => {
    let alive = true
    whenLoggedIn(() => loadMigrationStats(range))
      .then((data) => alive && setState({ data }))
      .catch((error) => alive && setState({ error }))
    return () => {
      alive = false
    }
  }, [range])

  if (state.error) return <p className="members-error" role="alert">{state.error.message}</p>
  const data = state.data
  if (!data)
    return (
      <p className="members-status" role="status">
        {t('loading')}
      </p>
    )

  const { counts, totals, people } = data
  const ranked = [...people].filter((row) => row.migrated).sort((a, b) => b.migrated - a.migrated || String(a.name ?? '').localeCompare(String(b.name ?? ''))).slice(0, 12)
  const progress = counts.total ? Math.round((counts.migrated / counts.total) * 100) : 0
  const how = [
    { key: 'direct', tone: 'a', label: t('via.direct') },
    { key: 'viaSuggestion', tone: 'b', label: t('via.suggestion') },
    { key: 'viaManage', tone: 'c', label: t('via.manage') },
    { key: 'earlier', tone: 'd', label: t('via.earlier') },
  ]
  const hours = (ms) => (ms === null || ms === undefined ? '–' : ms < 3_600_000 ? t('minutes', { count: Math.max(1, Math.round(ms / 60_000)) }) : t('hours', { count: Math.round(ms / 3_600_000) }))

  const columns = [
    { id: 'name', label: t('col.person'), text: true, sort: (row) => (row.private ? '~' : (row.name ?? '').toLowerCase()), render: (row) => <Person person={row} /> },
    { id: 'migrated', label: t('col.migrated'), render: (row) => <strong>{number(row.migrated)}</strong> },
    { id: 'direct', label: t('col.direct'), hint: t('via.direct'), render: (row) => number(row.direct) },
    { id: 'viaSuggestion', label: t('col.viaSuggestion'), hint: t('via.suggestion'), render: (row) => number(row.viaSuggestion) },
    { id: 'viaManage', label: t('col.viaManage'), hint: t('via.manage'), render: (row) => number(row.viaManage) },
    { id: 'suggested', label: t('col.suggested'), render: (row) => number(row.suggested) },
    {
      id: 'rate',
      label: t('col.rate'),
      hint: t('col.rateHint'),
      sort: (row) => (row.suggestionsApproved + row.suggestionsRejected ? row.suggestionsApproved / (row.suggestionsApproved + row.suggestionsRejected) : -1),
      render: (row) => (row.suggestionsApproved + row.suggestionsRejected ? `${Math.round((row.suggestionsApproved / (row.suggestionsApproved + row.suggestionsRejected)) * 100)} %` : '–'),
    },
    { id: 'reviewed', label: t('col.reviewed'), hint: t('col.reviewedHint'), render: (row) => number(row.reviewed) },
    { id: 'redesigns', label: t('col.redesigns'), render: (row) => number(row.redesigns) },
    { id: 'activeDays', label: t('col.activeDays'), render: (row) => number(row.activeDays) },
    { id: 'last', label: t('col.last'), sort: (row) => (row.last ? Date.parse(row.last) : -1), render: (row) => (row.last ? when(row.last) : '–') },
  ]

  const reviewActions = new Set(['approve', 'reject'])
  const filter = LOG_FILTERS.includes(logFilter) ? logFilter : 'all'
  const events = data.events.filter(
    (event) =>
      (filter === 'all' || (filter === 'review' ? reviewActions.has(event.action) : event.action === filter)) &&
      (!personFilter || [event.by, event.suggestedBy, event.reviewedBy].some((who) => who?.key === personFilter)),
  )
  const filteredPerson = personFilter ? people.find((row) => row.key === personFilter) : null
  const catName = (event) => [event.description ? `“${event.description}”` : t('aCat'), event.date ? t('fdcOf', { date: event.date, number: event.optionNumber }) : null].filter(Boolean).join(' · ')

  return (
    <>
      <div className="stats-tiles">
        <Tile label={t('tile.migrated')} value={`${number(counts.migrated)} / ${number(counts.total)}`} hint={t('tile.left', { count: counts.remaining })}>
          <div className="stats-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${progress}%` }} />
          </div>
        </Tile>
        <Tile label={range.from || range.to ? t('tile.inPeriod') : t('tile.logged')} value={number(totals.migrated)} hint={t('tile.people', { count: totals.people })} />
        <Tile label={t('tile.suggestions')} value={number(totals.suggestions)} hint={t('tile.decided', { approved: totals.approved, rejected: totals.rejected })} />
        <Tile label={t('tile.wait')} value={hours(totals.averageWaitMs)} hint={t('tile.waitHint')} />
      </div>

      <section className="stats-card">
        <header>
          <h2>{t('mostMigrations')}</h2>
          <Legend items={how} />
        </header>
        <Ranking rows={ranked} parts={how} empty={t('nobodyYet')} />
      </section>

      <section className="stats-card">
        <header>
          <h2>{t('perDay')}</h2>
          <Legend
            items={[
              { tone: 'a', label: t('migrated') },
              { tone: 'c', label: t('suggestedLabel') },
            ]}
          />
        </header>
        <Days
          days={data.daily.map((day) => ({ ...day }))}
          parts={[
            { key: 'migrated', tone: 'a', label: t('migrated') },
            { key: 'suggested', tone: 'c', label: t('suggestedLabel') },
          ]}
          label={t('perDay')}
        />
      </section>

      <section className="stats-card">
        <header>
          <h2>{t('everyone')}</h2>
          <span className="members-hint">{t('sortHint')}</span>
        </header>
        <SortTable columns={columns} rows={people} param="msort" initial="migrated:desc" empty={t('nobodyYet')} />
      </section>

      <section className="stats-card">
        <header>
          <h2>{t('log.title')}</h2>
          <div className="members-segment" role="radiogroup" aria-label={t('log.show')}>
            {LOG_FILTERS.map((id) => (
              <button key={id} type="button" role="radio" aria-checked={filter === id} className={filter === id ? 'is-active' : ''} onClick={() => setLogFilter(id === 'all' ? null : id)}>
                {t(`log.filter.${id}`)}
              </button>
            ))}
          </div>
        </header>
        <div className="stats-log__people">
          <label>
            <span className="members-hint">{t('log.person')}</span>
            <select className="members-input" value={personFilter ?? ''} onChange={(event) => setPersonFilter(event.target.value || null)}>
              <option value="">{t('log.everyone')}</option>
              {[...people]
                .filter((row) => !row.private)
                .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
                .map((row) => (
                  <option key={row.key} value={row.key}>
                    {row.name}
                  </option>
                ))}
            </select>
          </label>
          {filteredPerson && <span className="members-hint">{t('log.only', { name: filteredPerson.name })}</span>}
        </div>
        {events.length ? (
          <ol className="stats-log">
            {events.map((event) => (
              <li key={event.id ?? `${event.at}-${event.action}`} className={`stats-log__item stats-log__item--${event.action}`}>
                <span className="material-symbols-outlined stats-log__icon" aria-hidden="true">
                  {{ migrate: 'pets', redesign: 'brush', suggest: 'lightbulb', approve: 'check_circle', reject: 'cancel' }[event.action] ?? 'history'}
                </span>
                <div>
                  <p>
                    <Person person={event.by} /> {t(`log.${event.action}${event.action === 'migrate' ? `.${event.via ?? 'unknown'}` : ''}`)}{' '}
                    <span className="stats-log__cat">{catName(event)}</span>
                  </p>
                  <p className="stats-log__meta">
                    <time dateTime={event.at ?? undefined}>{when(event.at)}</time>
                    {event.suggestedBy && (
                      <>
                        {' · '}
                        {t('log.suggestedBy')} <Person person={event.suggestedBy} />
                      </>
                    )}
                    {event.reviewedBy && (
                      <>
                        {' · '}
                        {t('log.reviewedBy')} <Person person={event.reviewedBy} />
                      </>
                    )}
                    {event.adjusted && ` · ${t('log.adjusted')}`}
                    {event.backfilled && ` · ${t('log.backfilled')}`}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="members-hint">{t('log.empty')}</p>
        )}
        <p className="members-hint">
          {data.logSince ? t('log.since', { date: when(data.logSince) }) : t('log.notYet')} {totals.unknown ? t('log.unknown', { count: totals.unknown }) : ''}
        </p>
      </section>
    </>
  )
}

/* ---------- lobby cat ---------- */

function LobbyTab({ range }) {
  const { t, i18n } = useTranslation('stats')
  const [state, setState] = useState({ loading: true })
  const [kind, setKind] = useUrlParam('chart')
  const chart = kind === 'pets' ? 'pets' : 'taps'
  const number = (value) => (value ?? 0).toLocaleString(i18n.language)
  const day = (value) => (value ? new Date(`${value}T12:00:00Z`).toLocaleDateString(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' }) : '–')
  const periodOn = Boolean(range.from || range.to)

  useEffect(() => {
    let alive = true
    loadLobbyStats(range)
      .then((data) => alive && setState({ data }))
      .catch((error) => alive && setState({ error }))
    return () => {
      alive = false
    }
  }, [range])

  if (state.error) return <p className="members-error" role="alert">{state.error.message}</p>
  const data = state.data
  if (!data)
    return (
      <p className="members-status" role="status">
        {t('loading')}
      </p>
    )

  const { totals, period, summary, members } = data
  const shown = periodOn ? period : totals
  const named = members.filter((row) => (periodOn ? row.periodTaps || row.periodPets : row.taps || row.pets))
  const top = [...named].sort((a, b) => (periodOn ? b.periodTaps + b.periodPets - (a.periodTaps + a.periodPets) : b.taps + b.pets - (a.taps + a.pets))).slice(0, 12)
  const levelMax = Math.max(1, ...data.levels.map((entry) => entry.count))

  const columns = [
    { id: 'name', label: t('col.person'), text: true, sort: (row) => (row.private ? '~' : (row.name ?? '').toLowerCase()), render: (row) => <Person person={row} /> },
    ...(periodOn
      ? [
          { id: 'periodTaps', label: t('col.periodTaps'), render: (row) => <strong>{number(row.periodTaps)}</strong> },
          { id: 'periodPets', label: t('col.periodPets'), render: (row) => <strong>{number(row.periodPets)}</strong> },
          { id: 'periodDays', label: t('col.periodDays'), render: (row) => number(row.periodDays) },
        ]
      : []),
    { id: 'taps', label: t('col.taps'), render: (row) => number(row.taps) },
    { id: 'pets', label: t('col.pets'), render: (row) => number(row.pets) },
    { id: 'level', label: t('col.level'), sort: (row) => row.points, render: (row) => number(row.level) },
    { id: 'points', label: t('col.points'), render: (row) => number(row.points) },
    { id: 'streak', label: t('col.streak'), render: (row) => number(row.streak) },
    { id: 'bestStreak', label: t('col.bestStreak'), render: (row) => number(row.bestStreak) },
    { id: 'lastPetDay', label: t('col.lastPet'), sort: (row) => row.lastPetDay ?? '', render: (row) => day(row.lastPetDay) },
  ]

  return (
    <>
      <div className="stats-tiles">
        <Tile label={periodOn ? t('tile.tapsPeriod') : t('tile.taps')} value={number(shown.taps.guests + shown.taps.members)}>
          <Split
            parts={[
              { value: shown.taps.members, tone: 'a', label: t('members') },
              { value: shown.taps.guests, tone: 'd', label: t('guests') },
            ]}
          />
          <span className="stats-tile__hint">{t('split', { members: number(shown.taps.members), guests: number(shown.taps.guests) })}</span>
        </Tile>
        <Tile label={periodOn ? t('tile.petsPeriod') : t('tile.pets')} value={number(shown.pets.guests + shown.pets.members)}>
          <Split
            parts={[
              { value: shown.pets.members, tone: 'b', label: t('members') },
              { value: shown.pets.guests, tone: 'd', label: t('guests') },
            ]}
          />
          <span className="stats-tile__hint">{t('split', { members: number(shown.pets.members), guests: number(shown.pets.guests) })}</span>
        </Tile>
        <Tile label={t('tile.members')} value={number(periodOn ? summary.activeInPeriod : Math.max(summary.tapping, summary.petting))} hint={t('tile.membersHint', { tapping: summary.tapping, petting: summary.petting })} />
        <Tile label={t('tile.pettedToday')} value={number(summary.pettedToday)} hint={t('tile.pettedWeek', { count: summary.pettedThisWeek })} />
      </div>

      <section className="stats-card">
        <header>
          <h2>{t('mostLobby')}</h2>
          <Legend
            items={[
              { tone: 'a', label: t('col.taps') },
              { tone: 'b', label: t('col.pets') },
            ]}
          />
        </header>
        <Ranking
          rows={top}
          parts={
            periodOn
              ? [
                  { key: 'periodTaps', tone: 'a', label: t('col.taps') },
                  { key: 'periodPets', tone: 'b', label: t('col.pets') },
                ]
              : [
                  { key: 'taps', tone: 'a', label: t('col.taps') },
                  { key: 'pets', tone: 'b', label: t('col.pets') },
                ]
          }
          empty={t('nobodyLobby')}
        />
      </section>

      <section className="stats-card">
        <header>
          <h2>{periodOn ? t('perDay') : t('last60')}</h2>
          <div className="members-segment" role="radiogroup" aria-label={t('chartKind')}>
            {['taps', 'pets'].map((id) => (
              <button key={id} type="button" role="radio" aria-checked={chart === id} className={chart === id ? 'is-active' : ''} onClick={() => setKind(id === 'taps' ? null : id)}>
                {t(`col.${id}`)}
              </button>
            ))}
          </div>
        </header>
        <Legend
          items={[
            { tone: chart === 'taps' ? 'a' : 'b', label: t('members') },
            { tone: 'd', label: t('guests') },
          ]}
        />
        <Days
          days={data.daily.map((entry) => ({ day: entry.day, members: entry[chart].members, guests: entry[chart].guests }))}
          parts={[
            { key: 'members', tone: chart === 'taps' ? 'a' : 'b', label: t('members') },
            { key: 'guests', tone: 'd', label: t('guests') },
          ]}
          label={t('perDay')}
        />
        {data.since && <p className="members-hint">{t('dailySince', { date: day(data.since) })}</p>}
      </section>

      <section className="stats-card">
        <header>
          <h2>{t('levels')}</h2>
          <span className="members-hint">{t('levelsHint')}</span>
        </header>
        <ol className="stats-levels">
          {data.levels.map((entry) => (
            <li key={entry.level} title={t('levelFrom', { points: entry.from })}>
              <span className="stats-levels__bar">
                <span className="stats-tone--b" style={{ height: `${(entry.count / levelMax) * 100}%` }} />
              </span>
              <strong>{number(entry.count)}</strong>
              <span>{entry.level}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="stats-card">
        <header>
          <h2>{t('everyone')}</h2>
          <span className="members-hint">{t('sortHint')}</span>
        </header>
        <SortTable columns={columns} rows={members} param="lsort" initial={periodOn ? 'periodTaps:desc' : 'taps:desc'} empty={t('nobodyLobby')} />
        <p className="members-hint">{t('lobbyNote')}</p>
      </section>
    </>
  )
}

/* ---------- the page ---------- */

export default function CultStats() {
  const { t } = useTranslation('stats')
  const [tabParam, setTab] = useUrlParam('tab')
  const [params, setParams] = useSearchParams()
  const fromParam = params.get('from')
  const toParam = params.get('to')
  const tab = TABS.includes(tabParam) ? tabParam : 'migration'
  const from = DAY.test(fromParam ?? '') ? fromParam : null
  const to = DAY.test(toParam ?? '') ? toParam : null
  const range = useMemo(() => ({ from, to }), [from, to])
  // Both ends in one change of the address.
  const setRange = (start, end) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        for (const [key, value] of [
          ['from', start],
          ['to', end],
        ])
          if (value) next.set(key, value)
          else next.delete(key)
        return next
      },
      { replace: true, preventScrollReset: true },
    )

  return (
    <CultShell title={t('title')} wide>
      <header className="members-head">
        <h1>{t('title')}</h1>
        <p>{t('intro')}</p>
      </header>
      <div className="stats-bar">
        <div className="members-segment" role="tablist" aria-label={t('title')}>
          {TABS.map((id) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id === 'migration' ? null : id, { clear: ['msort', 'lsort', 'log', 'who', 'chart'] })}>
              <span className="material-symbols-outlined" aria-hidden="true">
                {id === 'migration' ? 'palette' : 'pets'}
              </span>
              {t(`tab.${id}`)}
            </button>
          ))}
        </div>
        <Period from={from} to={to} setRange={setRange} />
      </div>
      {tab === 'migration' ? <MigrationTab range={range} /> : <LobbyTab range={range} />}
    </CultShell>
  )
}
