import { useEffect, useId, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import LanguageSwitch from '/src/components/LanguageSwitch'
import TimeZonePicker from '/src/components/TimeZonePicker'

import CultShell from '/src/components/cult/CultShell'
import { DISCORD_LOGIN_URL } from '/src/lib/account'
import { useAccountSettings } from '/src/lib/accountSettings'
import { useDashSettings, updateDashSettings } from '/src/lib/dashSettings'
import { deleteAccount, forgetThisBrowser, GOODBYE_KEY, loadProfile, profilePath, updateProfile } from '/src/lib/members'
import SecuritySettings from '/src/components/cult/SecuritySettings'
import PushSettings from '/src/components/cult/PushSettings'
import VisibilityChoice from '/src/components/cult/VisibilityChoice'
import { loadStaff } from '/src/lib/moderation'
import { timeOptions } from '/src/lib/prefs'

/*
 * /cult/settings: everything a member can change, synced with the account
 * (and kept in this browser when logged out). Sections: look, language &
 * time, profile & privacy, email, custom CSS, deleting the account.
 */

// The site's own colour comes first ("Default"); these are the others.
const ACCENTS = ['#c2410c', '#a16207', '#4d7c0f', '#0f766e', '#1d4ed8', '#6d28d9', '#be185d', '#57534e']

function Section({ icon, title, text, children, danger = false }) {
  return (
    <section className={`settings-card${danger ? ' settings-card--danger' : ''}`}>
      <header>
        <span className="material-symbols-outlined" aria-hidden="true">
          {icon}
        </span>
        <div>
          <h2>{title}</h2>
          {text && <p>{text}</p>}
        </div>
      </header>
      <div className="settings-card__body">{children}</div>
    </section>
  )
}

function Segment({ label, value, options, onChange }) {
  return (
    <div className="settings-row">
      <span className="settings-row__label">{label}</span>
      <div className="members-segment" role="radiogroup" aria-label={label}>
        {options.map(([id, text, icon]) => (
          <button key={id} type="button" role="radio" aria-checked={value === id} className={value === id ? 'is-active' : ''} onClick={() => onChange(id)}>
            {icon && (
              <span className="material-symbols-outlined" aria-hidden="true">
                {icon}
              </span>
            )}
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

function DeleteAccount() {
  const { t } = useTranslation('settings')
  const id = useId()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      await deleteAccount()
      forgetThisBrowser()
      try {
        sessionStorage.setItem(GOODBYE_KEY, '1')
      } catch {
        // storage blocked: no goodbye
      }
      window.location.replace('/cult')
    } catch (reason) {
      setError(reason.message)
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button type="button" className="members-button members-button--danger" onClick={() => setOpen(true)}>
        <span className="material-symbols-outlined" aria-hidden="true">
          delete_forever
        </span>
        {t('delete.open')}
      </button>
    )
  }

  return (
    <div className="settings-delete" role="alertdialog" aria-labelledby={`${id}-title`}>
      <p id={`${id}-title`}>
        <strong>{t('delete.title')}</strong>
      </p>
      <ul>
        <li>{t('delete.profile')}</li>
        <li>{t('delete.stats')}</li>
        <li>{t('delete.mentions')}</li>
        <li>{t('delete.log')}</li>
      </ul>
      <p>
        <Trans t={t} i18nKey="delete.final" components={{ privacy: <Link to="/cult/privacy#deleting" /> }} />
      </p>
      <label className="members-label" htmlFor={`${id}-confirm`}>
        <Trans t={t} i18nKey="delete.type" components={{ word: <strong /> }} />
      </label>
      <input id={`${id}-confirm`} className="members-input" value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" spellCheck={false} />
      {error && (
        <p className="members-error" role="alert">
          {error}
        </p>
      )}
      <div className="settings-delete__actions">
        <button type="button" className="members-button members-button--quiet" onClick={() => setOpen(false)} disabled={busy}>
          {t('delete.keep')}
        </button>
        <button type="button" className="members-button members-button--danger" disabled={typed !== 'DELETE' || busy} onClick={run}>
          {busy ? t('delete.deleting') : t('delete.confirm')}
        </button>
      </div>
    </div>
  )
}

export default function CultSettings() {
  const { t } = useTranslation('settings')
  const { account, isAccountLoading, themeChoice, setTheme, prefs, setPrefs } = useAccountSettings()
  const dash = useDashSettings()
  const [profile, setProfile] = useState(null)
  const [css, setCss] = useState(dash.customCss ?? '')
  const [now] = useState(() => new Date())
  const [insightsChanged, setInsightsChanged] = useState(false)
  const [staff, setStaff] = useState(false)
  const loggedIn = Boolean(account && !account.local && !account.isAdminSession)

  useEffect(() => {
    if (!loggedIn) return
    loadStaff().then((role) => setStaff(role.staff))
    loadProfile(`@${account.username}`)
      .then(setProfile)
      .catch(() => {})
  }, [loggedIn, account?.username])

  const example = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', ...timeOptions(prefs) })
  const notifyCategories = [
    ['moderation', t('notify.moderation'), t('notify.moderationText')],
    ['fdc', t('notify.fdc'), t('notify.fdcText')],
    ['birthdays', t('notify.birthdays'), t('notify.birthdaysText')],
    ...(staff ? [['reports', t('notify.reports'), t('notify.reportsText')]] : []),
  ]

  return (
    <CultShell title={t('title')}>
      <header className="members-head">
        <h1>{t('title')}</h1>
        <p>{loggedIn ? t('savedAccount') : t('savedBrowser')}</p>
      </header>

      <div className="settings-grid">
        <Section icon="palette" title={t('look.title')} text={t('look.text')}>
          {/* Same order as the switch in the corner: light on the left, dark on the right. */}
          <Segment
            label={t('look.theme')}
            value={themeChoice}
            onChange={setTheme}
            options={[
              ['light', t('look.light'), 'light_mode'],
              ['dark', t('look.dark'), 'dark_mode'],
              ['system', t('look.system'), 'contrast'],
            ]}
          />
          <div className="settings-row">
            <span className="settings-row__label">{t('look.colour')}</span>
            <div className="settings-swatches" role="radiogroup" aria-label={t('look.colour')}>
              <button type="button" role="radio" aria-checked={!prefs.accent} className={`settings-swatch settings-swatch--default${!prefs.accent ? ' is-active' : ''}`} onClick={() => setPrefs({ accent: null })} title={t('look.defaultColour')} aria-label={t('look.defaultColour')} />
              {ACCENTS.map((color) => (
                <button key={color} type="button" role="radio" aria-checked={prefs.accent === color} className={`settings-swatch${prefs.accent === color ? ' is-active' : ''}`} style={{ '--swatch': color }} onClick={() => setPrefs({ accent: color })} aria-label={color} />
              ))}
              <label className={`settings-swatch settings-swatch--any${prefs.accent && !ACCENTS.includes(prefs.accent) ? ' is-active' : ''}`} title={t('look.anyColour')} style={prefs.accent && !ACCENTS.includes(prefs.accent) ? { '--swatch': prefs.accent } : undefined}>
                <input type="color" value={prefs.accent ?? '#b60b0b'} onChange={(event) => setPrefs({ accent: event.target.value })} aria-label={t('look.anyColour')} />
              </label>
            </div>
          </div>
          <Segment
            label={t('look.motion')}
            value={prefs.motion}
            onChange={(motion) => setPrefs({ motion })}
            options={[
              ['full', t('look.motionAll'), 'animation'],
              ['reduce', t('look.motionFewer'), 'motion_mode'],
              ['none', t('look.motionNone'), 'block'],
            ]}
          />
          <p className="members-hint settings-hint">{t(`look.motionHint.${prefs.motion}`)}</p>
        </Section>

        <Section icon="translate" title={t('time.title')}>
          <div className="settings-row">
            <span className="settings-row__label">{t('time.language')}</span>
            <LanguageSwitch inline />
          </div>
          <Segment
            label={t('time.clock', { time: example })}
            value={prefs.clock}
            onChange={(clock) => setPrefs({ clock })}
            options={[
              ['auto', t('time.clockAuto')],
              ['12', t('time.clock12')],
              ['24', t('time.clock24')],
            ]}
          />
          <div className="settings-row">
            <span className="settings-row__label">{t('time.zone')}</span>
            <TimeZonePicker value={prefs.timeZone ?? 'auto'} onChange={(timeZone) => setPrefs({ timeZone })} />
          </div>
        </Section>

        <Section icon="visibility_off" title={t('analytics.title')} text={t('analytics.text')}>
          <label className="members-switch">
            <input
              type="checkbox"
              checked={prefs.blockInsights === true}
              onChange={(event) => {
                setPrefs({ blockInsights: event.target.checked })
                setInsightsChanged(true)
              }}
            />
            <span>
              <strong>{t('analytics.block')}</strong>
              <small>
                {t('analytics.blockText')} <Link to="/cult/privacy#analytics">{t('analytics.what')}</Link>
              </small>
            </span>
          </label>
          {insightsChanged && (
            <button type="button" className="members-button members-button--quiet" onClick={() => window.location.reload()}>
              <span className="material-symbols-outlined" aria-hidden="true">
                refresh
              </span>
              {t('analytics.reload')}
            </button>
          )}
        </Section>

        {loggedIn ? (
          <>
            <Section icon="shield_person" title={t('profile.title')} text={t('profile.text')}>
              <VisibilityChoice
                value={profile?.visibility ?? 'members'}
                disabled={!profile}
                onChange={async (visibility) => {
                  const result = await updateProfile({ visibility })
                  setProfile((current) => ({ ...current, public: result.public, visibility: result.visibility }))
                }}
              />
              <div className="settings-links">
                <Link className="members-button members-button--quiet" to={profilePath(account)}>
                  <span className="material-symbols-outlined" aria-hidden="true">
                    account_circle
                  </span>
                  {t('profile.mine')}
                </Link>
                <Link className="members-button members-button--quiet" to={`${profilePath(account)}?edit=avatar`}>
                  <span className="material-symbols-outlined" aria-hidden="true">
                    pets
                  </span>
                  {t('profile.avatar')}
                </Link>
                <Link className="members-button members-button--quiet" to="/cult/privacy">
                  <span className="material-symbols-outlined" aria-hidden="true">
                    policy
                  </span>
                  {t('profile.privacy')}
                </Link>
              </div>
            </Section>

            <Section icon="notifications" title={t('notify.title')} text={t('notify.text')}>
              <div id="notifications" className="notify-prefs">
                <PushSettings />
                {notifyCategories.map(([category, label, text]) => {
                  const choice = { site: true, email: false, push: true, ...(prefs.notify?.[category] ?? {}) }
                  const change = (patch) => setPrefs({ notify: { ...(prefs.notify ?? {}), [category]: { ...choice, ...patch } } })
                  return (
                    <div key={category} className="notify-pref">
                      <span>
                        <strong>{label}</strong>
                        <small>{text}</small>
                      </span>
                      <span className="notify-pref__toggles">
                        <label className="notify-pref__toggle">
                          <input type="checkbox" checked={choice.site} onChange={(event) => change({ site: event.target.checked })} />
                          {t('notify.site')}
                        </label>
                        <label className="notify-pref__toggle">
                          <input type="checkbox" checked={choice.email} onChange={(event) => change({ email: event.target.checked })} />
                          {t('notify.email')}
                        </label>
                        <label className="notify-pref__toggle">
                          <input type="checkbox" checked={choice.push} onChange={(event) => change({ push: event.target.checked })} />
                          {t('notify.push')}
                        </label>
                      </span>
                    </div>
                  )
                })}
              </div>
            </Section>

            <Section icon="lock" title={t('login.title')} text={t('login.text')}>
              <SecuritySettings />
            </Section>
          </>
        ) : (
          !isAccountLoading && (
            <Section icon="login" title={t('account.title')} text={t('account.text')}>
              <a className="members-button" href={DISCORD_LOGIN_URL}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  login
                </span>
                {t('account.login')}
              </a>
            </Section>
          )
        )}

        <Section icon="code" title={t('css.title')} text={t('css.text')}>
          <label className="members-switch">
            <input
              type="checkbox"
              checked={dash.customCssEnabled !== false}
              onChange={(event) => (loggedIn ? setPrefs({ customCssEnabled: event.target.checked }) : updateDashSettings({ customCssEnabled: event.target.checked }))}
            />
            <span>
              <strong>{t('css.use')}</strong>
            </span>
          </label>
          <textarea className="members-input settings-css" rows={8} spellCheck={false} value={css} maxLength={20000} onChange={(event) => setCss(event.target.value)} placeholder={'body {\n  /* … */\n}'} aria-label={t('css.title')} />
          <div className="settings-inline">
            <button type="button" className="members-button" disabled={css === (dash.customCss ?? '')} onClick={() => (loggedIn ? setPrefs({ customCss: css }) : updateDashSettings({ customCss: css }))}>
              {t('css.apply')}
            </button>
            <span className="members-hint">{t('css.count', { count: css.length.toLocaleString(), max: '20,000' })}</span>
          </div>
        </Section>

        {loggedIn && (
          <Section icon="warning" title={t('delete.section')} text={t('delete.sectionText')} danger>
            <DeleteAccount />
          </Section>
        )}
      </div>
    </CultShell>
  )
}
