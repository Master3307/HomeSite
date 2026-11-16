import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import CultShell from '/src/components/cult/CultShell'
import { DesignPreview } from '/src/components/bongo/BongoRender'
import { useCatalog } from '/src/lib/bongo'
import { birthdayLabel, daysUntil, loadBirthdays, loadMyBirthday, removeDressCode, saveDressCode, saveMyBirthday, setReminder } from '/src/lib/birthdays'
import { apiUrl, keyPath } from '/src/lib/members'
import { DISCORD_LOGIN_URL } from '/src/lib/account'

const DesignEditor = lazy(() => import('/src/components/bongo/DesignEditor'))

/*
 * /cult/birthdays: everyone's birthday (day and month, people with a
 * profile you may see), reminders by the bot, and your own birthday with
 * your birthday dress code. The same data as the bot's /birthday.
 */

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1)
const daysIn = (month, year) => new Date(Date.UTC(year || 2024, month, 0)).getUTCDate()
const formatDay = (key, language) => new Date(`${key}T12:00:00`).toLocaleDateString(language, { day: 'numeric', month: 'long' })

/* A little tear-off calendar page: the month on top, the day big below. */
function DateTile({ birthday, language }) {
  const month = birthday ? new Intl.DateTimeFormat(language, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, birthday.month - 1, 1))) : null
  return (
    <span className={`birthday-tile${birthday ? '' : ' is-empty'}`} aria-hidden="true">
      <span className="birthday-tile__month">{month ?? '·'}</span>
      <span className="birthday-tile__day">{birthday ? birthday.day : '?'}</span>
    </span>
  )
}

/* Month chips, then the days of that month, then the (optional) year. */
function BirthdayPicker({ initial, busy, onCancel, onSave }) {
  const { t, i18n } = useTranslation('birthdays')
  const [month, setMonth] = useState(initial?.month ?? null)
  const [day, setDay] = useState(initial?.day ?? null)
  const [year, setYear] = useState(initial?.year ? String(initial.year) : '')
  const thisYear = new Date().getFullYear()
  const yearNumber = /^\d{4}$/.test(year) ? Number(year) : null
  const yearValid = !year || (yearNumber && yearNumber >= thisYear - 120 && yearNumber <= thisYear)
  const last = month ? daysIn(month, yearNumber) : 31
  const shortMonth = (value) => new Intl.DateTimeFormat(i18n.language, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, value - 1, 1)))
  const ready = month && day && day <= last && yearValid
  const unchanged = initial && initial.month === month && initial.day === day && String(initial.year ?? '') === year

  return (
    <form
      className="birthday-picker"
      onSubmit={(event) => {
        event.preventDefault()
        if (ready) onSave({ day, month, year: yearNumber })
      }}
    >
      <fieldset className="birthday-picker__months" disabled={busy}>
        <legend>{t('mine.month')}</legend>
        {MONTHS.map((value) => (
          <button key={value} type="button" className={month === value ? 'is-active' : ''} aria-pressed={month === value} onClick={() => setMonth(value)}>
            {shortMonth(value)}
          </button>
        ))}
      </fieldset>
      <fieldset className="birthday-picker__days" disabled={busy || !month}>
        <legend>{t('mine.day')}</legend>
        {Array.from({ length: 31 }, (_, index) => index + 1).map((value) => (
          <button key={value} type="button" className={day === value ? 'is-active' : ''} aria-pressed={day === value} disabled={value > last} onClick={() => setDay(value)}>
            {value}
          </button>
        ))}
      </fieldset>
      <label className="birthday-picker__year">
        <span>
          {t('mine.year')} <small>{t('mine.optional')}</small>
        </span>
        <input className="members-input" inputMode="numeric" maxLength={4} value={year} onChange={(event) => setYear(event.target.value.replace(/\D/g, ''))} disabled={busy} placeholder="—" aria-invalid={!yearValid} />
      </label>
      <div className="birthday-picker__foot">
        <p className="members-hint">
          {ready ? <strong>{birthdayLabel({ day, month }, i18n.language)}</strong> : t('mine.pickDate')}
          {initial && ` · ${t('mine.lockWarning')}`}
        </p>
        <div className="settings-inline">
          {onCancel && (
            <button type="button" className="members-button members-button--quiet" onClick={onCancel} disabled={busy}>
              {t('mine.cancel')}
            </button>
          )}
          <button type="submit" className="members-button" disabled={busy || !ready || unchanged}>
            {busy ? t('mine.saving') : t('mine.save')}
          </button>
        </div>
      </div>
    </form>
  )
}

function DressCode({ data, busy, setBusy, setError, reload }) {
  const { t, i18n } = useTranslation('birthdays')
  const { catalog } = useCatalog()
  const [designing, setDesigning] = useState(false)
  const [description, setDescription] = useState(data.dressCode?.description ?? '')

  // Picked new on the celebration day itself.
  if (!data.celebratingToday) {
    return (
      <div className="birthday-dress birthday-dress--later" id="dress-code">
        <span className="material-symbols-outlined" aria-hidden="true">
          checkroom
        </span>
        <div>
          <h3>{t('dress.title')}</h3>
          <p className="members-hint">{data.celebration ? t('dress.later', { date: formatDay(data.celebration.date, i18n.language) }) : t('dress.laterNoDate')}</p>
        </div>
      </div>
    )
  }

  async function act(task) {
    setBusy(true)
    try {
      await task()
      await reload()
    } catch (reason) {
      setError(reason.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="birthday-dress" id="dress-code">
      <h3>{t('dress.title')}</h3>
      <p className="members-hint">{t('dress.text')}</p>
      <div className="birthday-dress__row">
        <div className="birthday-dress__preview">
          {data.dressCode ? (
            catalog && data.dressCode.design ? <DesignPreview catalog={catalog} design={data.dressCode.design} play /> : <img src={apiUrl(data.dressCode.imageUrl)} alt="" />
          ) : (
            <span className="birthday-dress__empty">
              <span aria-hidden="true">🎉</span>
              {t('dress.none')}
            </span>
          )}
        </div>
        <div className="birthday-dress__side">
          <label className="members-label" htmlFor="dress-description">
            {t('dress.description')}
          </label>
          <input id="dress-description" className="members-input" maxLength={200} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t('dress.placeholder')} />
          <div className="settings-inline">
            <button type="button" className="members-button" onClick={() => setDesigning(true)} disabled={!catalog || busy}>
              <span className="material-symbols-outlined" aria-hidden="true">
                pets
              </span>
              {data.dressCode ? t('dress.edit') : t('dress.design')}
            </button>
            {data.dressCode && description !== (data.dressCode.description ?? '') && (
              <button type="button" className="members-button members-button--quiet" disabled={busy} onClick={() => act(() => saveDressCode(data.dressCode.design, description))}>
                {t('dress.saveText')}
              </button>
            )}
            {data.dressCode && (
              <button type="button" className="members-button members-button--quiet" disabled={busy} onClick={() => act(() => removeDressCode())}>
                {t('dress.remove')}
              </button>
            )}
          </div>
        </div>
      </div>
      {designing && catalog && (
        <Suspense fallback={null}>
          <DesignEditor
            catalog={catalog}
            design={data.dressCode?.design ?? null}
            title={t('dress.editorTitle')}
            applyLabel={t('dress.use')}
            busy={busy}
            onCancel={() => setDesigning(false)}
            onApply={(design) =>
              act(async () => {
                await saveDressCode(design, description)
                setDesigning(false)
              })
            }
          />
        </Suspense>
      )}
    </div>
  )
}

function MyBirthday({ onSaved }) {
  const { t, i18n } = useTranslation('birthdays')
  const [data, setData] = useState(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)

  const load = useCallback(
    () =>
      loadMyBirthday()
        .then(setData)
        .catch((reason) => setError(reason.message)),
    [],
  )
  useEffect(() => {
    load()
  }, [load])

  if (!data) return <p className="members-status">{error ?? t('loading')}</p>
  const locked = Boolean(data.changeAllowedAt && data.changeAllowedAt > Date.now())

  async function save(birthday) {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      await saveMyBirthday(birthday)
      setNote(t('mine.saved'))
      setEditing(false)
      await load()
      onSaved()
    } catch (reason) {
      setError(reason.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="member-card birthday-mine" aria-labelledby="birthday-mine">
      <div className="birthday-mine__head">
        <DateTile birthday={data.birthday} language={i18n.language} />
        <div className="birthday-mine__text">
          <h2 id="birthday-mine">{t('mine.title')}</h2>
          {data.birthday ? (
            <>
              <p className="birthday-mine__date">{birthdayLabel(data.birthday, i18n.language)}</p>
              <p className="members-hint">
                {data.celebratingToday ? t('mine.today') : data.celebration ? t('mine.next', { date: formatDay(data.celebration.date, i18n.language) }) : null}
              </p>
            </>
          ) : (
            <p className="members-hint">{t('mine.empty')}</p>
          )}
        </div>
        {!editing && (
          <button type="button" className="members-button birthday-mine__edit" onClick={() => setEditing(true)} disabled={locked}>
            <span className="material-symbols-outlined" aria-hidden="true">
              {locked ? 'lock_clock' : data.birthday ? 'edit_calendar' : 'cake'}
            </span>
            {data.birthday ? t('mine.change') : t('mine.add')}
          </button>
        )}
      </div>

      {editing && <BirthdayPicker initial={data.birthday} busy={busy} onCancel={() => setEditing(false)} onSave={save} />}

      {locked ? (
        <p className="members-hint birthday-lock">
          <span className="material-symbols-outlined" aria-hidden="true">
            lock_clock
          </span>
          <span>
            <Trans
              t={t}
              i18nKey="mine.locked"
              values={{ date: new Date(data.changeAllowedAt).toLocaleDateString(i18n.language, { dateStyle: 'long' }) }}
              components={{ contact: data.contact ? <Link to={keyPath(data.contact)} /> : <span /> }}
            />
          </span>
        </p>
      ) : (
        <p className="members-hint">{t('mine.private')}</p>
      )}
      {data.celebration?.moved > 0 && <p className="members-notice birthday-moved">{t('mine.moved', { date: formatDay(data.celebration.date, i18n.language) })}</p>}
      {error && (
        <p className="members-error" role="alert">
          {error}
        </p>
      )}
      {note && <p className="members-ok">{note}</p>}

      {data.birthday && <DressCode key={data.dressCode?.description ?? ''} data={data} busy={busy} setBusy={setBusy} setError={setError} reload={load} />}
    </section>
  )
}

/* A profile link, or (no account here) their user card on Discord. */
function PersonLink({ person, children }) {
  const { t } = useTranslation('birthdays')
  if (person.account) {
    return (
      <Link className="birthday-person" to={keyPath(person.key)}>
        {children}
      </Link>
    )
  }
  return (
    <a className="birthday-person" href={`https://discord.com/users/${person.discordId}`} target="_blank" rel="noopener noreferrer" title={t('openDiscord')}>
      {children}
    </a>
  )
}

export default function CultBirthdays() {
  const { t, i18n } = useTranslation('birthdays')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)

  const load = useCallback(
    () =>
      loadBirthdays()
        .then(setData)
        .catch((reason) => setError(reason.message)),
    [],
  )
  useEffect(() => {
    load()
  }, [load])

  async function toggle(person) {
    setBusy(person.key)
    try {
      const result = await setReminder(person.key, !person.reminder)
      setData((current) => ({ ...current, people: current.people.map((entry) => (entry.key === person.key ? { ...entry, reminder: result.reminder } : entry)) }))
    } catch (reason) {
      setError(reason.message)
    } finally {
      setBusy(null)
    }
  }

  // Grouped by month, starting with the current one.
  const now = new Date()
  const groups = MONTHS.map((offset) => ((now.getMonth() + offset - 1) % 12) + 1).map((month) => ({ month, people: (data?.people ?? []).filter((person) => person.month === month) }))
  const monthName = (month) => new Intl.DateTimeFormat(i18n.language, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, month - 1, 1)))

  return (
    <CultShell title={t('title')} wide>
      <header className="members-head">
        <h1>{t('title')}</h1>
        <p>{t('intro')}</p>
      </header>

      {data?.loggedIn ? (
        <MyBirthday onSaved={load} />
      ) : (
        data && (
          <section className="member-card">
            <p>{t('loginText')}</p>
            <a className="members-button" href={DISCORD_LOGIN_URL}>
              <span className="material-symbols-outlined" aria-hidden="true">
                login
              </span>
              {t('login')}
            </a>
          </section>
        )
      )}

      {error && (
        <p className="members-error" role="alert">
          {error}
        </p>
      )}
      {!data ? (
        <p className="members-status">{t('loading')}</p>
      ) : !data.people.length ? (
        <p className="members-status">{t('empty')}</p>
      ) : (
        <div className="birthday-months">
          {groups
            .filter((group) => group.people.length)
            .map((group) => (
              <section key={group.month} className="birthday-month" aria-label={monthName(group.month)}>
                <h2>{monthName(group.month)}</h2>
                <ul>
                  {group.people.map((person) => {
                    const days = daysUntil(person)
                    return (
                      <li key={person.key} className={days === 0 ? 'is-today' : ''}>
                        <PersonLink person={person}>
                          {person.avatarUrl ? <img src={apiUrl(person.avatarUrl)} alt="" width="36" height="36" loading="lazy" /> : <span className="material-symbols-outlined">person</span>}
                          <span>
                            <strong>
                              {person.name}
                              {!person.account && (
                                <span className="material-symbols-outlined birthday-person__noaccount" title={t('noAccount')} aria-label={t('noAccount')}>
                                  person_off
                                </span>
                              )}
                            </strong>
                            <small>
                              {birthdayLabel(person, i18n.language)}
                              {days === 0 ? ` · ${t('today')}` : days === 1 ? ` · ${t('tomorrow')}` : days <= 30 ? ` · ${t('inDays', { count: days })}` : ''}
                              {person.celebration && ` · ${t('celebratesOn', { date: new Date(`${person.celebration}T12:00:00`).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long' }) })}`}
                            </small>
                          </span>
                        </PersonLink>
                        {data.loggedIn && !person.self && (
                          <button
                            type="button"
                            className={`members-icon-button birthday-bell${person.reminder ? ' is-on' : ''}`}
                            aria-pressed={person.reminder}
                            disabled={busy === person.key}
                            onClick={() => toggle(person)}
                            title={person.reminder ? t('reminderOff') : t('reminderOn')}
                            aria-label={person.reminder ? t('reminderOff') : t('reminderOn')}
                          >
                            <span className="material-symbols-outlined" aria-hidden="true">
                              {person.reminder ? 'notifications_active' : 'notification_add'}
                            </span>
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
        </div>
      )}
      {data?.loggedIn && <p className="members-hint birthday-footnote">{t('reminderHint')}</p>}
    </CultShell>
  )
}
