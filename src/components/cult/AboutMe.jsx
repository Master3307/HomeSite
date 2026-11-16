import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import OPTIONS from '/shared/profile-options.json'
import { updateProfile } from '/src/lib/members'

/*
 * Gender and hobbies on a profile (they used to be Discord roles from the
 * server's onboarding; the bot moves those here, services/profileRoles.cjs).
 * `AboutChips` shows them, `AboutForm` edits them (own profile).
 */

export function AboutChips({ about }) {
  const { t } = useTranslation('members')
  const gender = OPTIONS.gender.find((entry) => entry.id === about?.gender && entry.id !== 'unsaid')
  const hobbies = OPTIONS.hobbies.filter((entry) => about?.hobbies?.includes(entry.id))
  if (!gender && !hobbies.length) return null
  return (
    <ul className="member-about" aria-label={t('about.title')}>
      {gender && (
        <li className="member-about__gender">
          <span aria-hidden="true">{gender.emoji}</span>
          {t(`about.gender.${gender.id}`)}
        </li>
      )}
      {hobbies.map((entry) => (
        <li key={entry.id}>
          <span aria-hidden="true">{entry.emoji}</span>
          {t(`about.hobbies.${entry.id}`)}
        </li>
      ))}
    </ul>
  )
}

export function AboutForm({ about, onSaved }) {
  const { t } = useTranslation('members')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function save(change) {
    setBusy(true)
    setError(null)
    try {
      const result = await updateProfile(change)
      onSaved(result.about)
    } catch (reason) {
      setError(reason.message)
    } finally {
      setBusy(false)
    }
  }

  const hobbies = about?.hobbies ?? []
  return (
    <div className="member-about-form">
      <div>
        <p className="members-label">{t('about.hobbiesLabel')}</p>
        <div className="member-about-form__options">
          {OPTIONS.hobbies.map((entry) => {
            const on = hobbies.includes(entry.id)
            return (
              <button
                key={entry.id}
                type="button"
                className={`member-choice${on ? ' is-active' : ''}`}
                aria-pressed={on}
                disabled={busy}
                onClick={() => save({ hobbies: on ? hobbies.filter((id) => id !== entry.id) : [...hobbies, entry.id] })}
              >
                <span className="member-choice__emoji" aria-hidden="true">
                  {entry.emoji}
                </span>
                <span>
                  <strong>{t(`about.hobbies.${entry.id}`)}</strong>
                  <small>{t(`about.hobbyText.${entry.id}`)}</small>
                </span>
              </button>
            )
          })}
        </div>
        <p className="members-hint">{t('about.hobbiesHint')}</p>
      </div>
      <div>
        <p className="members-label">{t('about.genderLabel')}</p>
        <div className="member-about-form__options" role="radiogroup" aria-label={t('about.genderLabel')}>
          {OPTIONS.gender.map((entry) => {
            const on = (about?.gender ?? null) === entry.id
            return (
              <button key={entry.id} type="button" role="radio" aria-checked={on} className={`member-choice${on ? ' is-active' : ''}`} disabled={busy} onClick={() => save({ gender: on ? null : entry.id })}>
                <span className="member-choice__emoji" aria-hidden="true">
                  {entry.emoji}
                </span>
                <span>
                  <strong>{t(`about.gender.${entry.id}`)}</strong>
                </span>
              </button>
            )
          })}
        </div>
        <p className="members-hint">{t('about.genderHint')}</p>
      </div>
      {error && (
        <p className="members-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
