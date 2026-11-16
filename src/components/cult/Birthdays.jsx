import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { apiUrl, keyPath } from '/src/lib/members'
import { birthdayLabel, loadTodaysBirthdays } from '/src/lib/birthdays'
import { catSay } from '/src/lib/lobbyCat'

/* "🎂 9 September" on a profile. */
export function BirthdayLine({ birthday }) {
  const { t, i18n } = useTranslation('birthdays')
  return (
    <p className="birthday-line">
      <span aria-hidden="true">🎂</span>
      {t('profileLine', { date: birthdayLabel(birthday, i18n.language) })}
    </p>
  )
}

/*
 * /cult on someone's birthday celebration: who it is, their birthday dress
 * code, and the lobby cat says it out loud (once per visit). Your own
 * birthday: a happy birthday from the cat.
 */
export function BirthdayBanner() {
  const { t } = useTranslation('birthdays')
  const [today, setToday] = useState(null)

  useEffect(() => {
    let alive = true
    loadTodaysBirthdays()
      .then((data) => {
        if (!alive) return
        setToday(data)
        const first = data.people[0]
        let said = false
        try {
          said = sessionStorage.getItem('homesite:birthday-said') === new Date().toDateString()
          sessionStorage.setItem('homesite:birthday-said', new Date().toDateString())
        } catch {
          // storage blocked: the cat may repeat itself
        }
        if (said) return
        const line = data.ownBirthday ? t('cat.you') : first ? t('cat.other', { name: first.name }) : null
        if (line) setTimeout(() => catSay(line, 7000), 2500)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [t])

  if (!today?.people?.length) return null
  return (
    <section className="birthday-banner" aria-label={t('banner.label')}>
      {today.people.map((person) => (
        <div key={person.key} className="birthday-banner__person">
          <div className="birthday-banner__head">
            <span className="birthday-banner__cake" aria-hidden="true">
              🎂
            </span>
            <div>
              <p className="birthday-banner__eyebrow">{person.self ? t('banner.yours') : t('banner.today')}</p>
              <h2>
                <Link to={keyPath(person.key)}>{person.name}</Link>
              </h2>
            </div>
            {person.avatarUrl && <img className="birthday-banner__avatar" src={apiUrl(person.avatarUrl)} alt="" width="56" height="56" />}
          </div>
          {person.dressCode ? (
            <figure className="birthday-banner__dress">
              <img src={apiUrl(person.dressCode.imageUrl)} alt={person.dressCode.description} />
              <figcaption>
                <strong>{t('banner.dressCode')}</strong>
                {person.dressCode.description && <span>{person.dressCode.description}</span>}
              </figcaption>
            </figure>
          ) : (
            person.self && (
              <p className="birthday-banner__hint">
                <Link to="/cult/birthdays#dress-code">{t('banner.makeOne')}</Link>
              </p>
            )
          )}
        </div>
      ))}
    </section>
  )
}
