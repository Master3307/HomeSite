import { Suspense, lazy, useEffect, useId, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router'

import LanguageSwitch from '../components/LanguageSwitch.jsx'
import TimeZonePicker from '../components/TimeZonePicker.jsx'
import OriginShell from '../components/OriginShell.jsx'
import AvatarEditor from '../components/AvatarEditor.jsx'
import SecuritySettings from '../components/cult/SecuritySettings.jsx'
import PushSettings from '../components/cult/PushSettings.jsx'
import VisibilityChoice from '../components/cult/VisibilityChoice.jsx'
import { DashCustomize, DashSearchSettings } from '../components/dash/DashSettings.jsx'
import { isNativeApp } from '../lib/native.js'
import { useAccountSettings } from '../lib/accountSettings.jsx'
import { forgetAccountDash, useDashSettings, updateDashSettings } from '../lib/dashSettings.js'
import { deleteAccount, forgetThisBrowser, GOODBYE_KEY, loadProfile, profilePath, updateProfile } from '../lib/members.js'
import { loadStaff } from '../lib/moderation.js'
import { timeOptions } from '../lib/prefs.js'
import { siteConfig, discordInviteUrl } from '../lib/siteConfig.js'
import { accountFetch } from '../lib/account.js'

/*
 * /settings[/<tab>]: everything someone can change, in tabs (general,
 * account, notifications, dash, search, about), with a search over all of
 * them. Synced with the account, kept in this browser when logged out.
 *
 * It wears the look of where it was opened from (components/OriginShell.jsx);
 * /cult/settings and its old #hash links lead here.
 */

const Dash = lazy(() => import('./Dash.jsx'))

const TABS = [
  { id: 'general', icon: 'tune' },
  { id: 'account', icon: 'account_circle' },
  { id: 'notifications', icon: 'notifications' },
  { id: 'dash', icon: 'dashboard' },
  { id: 'search', icon: 'travel_explore' },
  { id: 'about', icon: 'info' },
]
// The site's own colour comes first ("Default"); these are the others.
const ACCENTS = ['#c2410c', '#a16207', '#4d7c0f', '#0f766e', '#1d4ed8', '#6d28d9', '#be185d', '#57534e']
function Section({ icon, title, text, children, danger = false, id }) {
  return (
    <section id={id} className={`settings-card${danger ? ' settings-card--danger' : ''}`} data-settings-card>
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

function Switch({ checked, onChange, title, text }) {
  return (
    <label className="members-switch">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <strong>{title}</strong>
        {text && <small>{text}</small>}
      </span>
    </label>
  )
}

/* Typing the word before something that can't be undone. */
function Confirmed({ openLabel, title, points, finalText, word = 'DELETE', confirmLabel, busyLabel, onConfirm, icon = 'delete_forever' }) {
  const { t } = useTranslation('settings')
  const id = useId()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  if (!open)
    return (
      <button type="button" className="members-button members-button--danger" onClick={() => setOpen(true)}>
        <span className="material-symbols-outlined" aria-hidden="true">
          {icon}
        </span>
        {openLabel}
      </button>
    )
  return (
    <div className="settings-delete" role="alertdialog" aria-labelledby={`${id}-title`}>
      <p id={`${id}-title`}>
        <strong>{title}</strong>
      </p>
      {points?.length > 0 && (
        <ul>
          {points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      )}
      {finalText && <p>{finalText}</p>}
      <label className="members-label" htmlFor={`${id}-confirm`}>
        <Trans t={t} i18nKey="delete.type" values={{ word }} components={{ word: <strong /> }} />
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
        <button
          type="button"
          className="members-button members-button--danger"
          disabled={typed !== word || busy}
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              await onConfirm()
              setOpen(false)
              setTyped('')
            } catch (reason) {
              setError(reason.message)
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </div>
  )
}

/* ---------- tabs ---------- */

function GeneralTab({ loggedIn }) {
  const { t } = useTranslation('settings')
  const { themeChoice, setTheme, prefs, setPrefs } = useAccountSettings()
  const dash = useDashSettings()
  const [css, setCss] = useState(dash.customCss ?? '')
  const [now] = useState(() => new Date())
  const [insightsChanged, setInsightsChanged] = useState(false)
  const example = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', ...timeOptions(prefs) })
  const chrome = prefs.chrome ?? { themeSwitch: true, languageSwitch: true, account: 'full' }
  const setChrome = (patch) => setPrefs({ chrome: { ...chrome, ...patch } })
  return (
    <>
      <Section icon="palette" title={t('look.title')} text={t('look.text')}>
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
        <Switch checked={prefs.loudSounds !== false} onChange={(loudSounds) => setPrefs({ loudSounds })} title={t('look.loudSounds')} text={t('look.loudSoundsText')} />
      </Section>

      <Section icon="widgets" title={t('chrome.title')} text={t('chrome.text')}>
        <Switch checked={chrome.themeSwitch} onChange={(themeSwitch) => setChrome({ themeSwitch })} title={t('chrome.themeSwitch')} text={t('chrome.themeSwitchText')} />
        <Switch checked={chrome.languageSwitch} onChange={(languageSwitch) => setChrome({ languageSwitch })} title={t('chrome.languageSwitch')} text={t('chrome.languageSwitchText')} />
        {loggedIn && (
          <Segment
            label={t('chrome.account')}
            value={chrome.account}
            onChange={(account) => setChrome({ account })}
            options={[
              ['full', t('chrome.accountFull'), 'badge'],
              ['avatar', t('chrome.accountAvatar'), 'account_circle'],
            ]}
          />
        )}
        <p className="members-hint settings-hint">{t('chrome.hint')}</p>
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

      {!isNativeApp && (
        <Section icon="install_mobile" title={t('appOpen.title')} text={t('appOpen.text')}>
          <Switch checked={prefs.openApp === true} onChange={(openApp) => setPrefs({ openApp })} title={t('appOpen.open')} text={t('appOpen.openText')} />
        </Section>
      )}

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
              {t('analytics.blockText')} <Link to="/privacy#analytics">{t('analytics.what')}</Link>
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

      <Section icon="code" title={t('css.title')} text={t('css.text')}>
        <Switch checked={dash.customCssEnabled !== false} onChange={(value) => (loggedIn ? setPrefs({ customCssEnabled: value }) : updateDashSettings({ customCssEnabled: value }, { quiet: true }))} title={t('css.use')} />
        <textarea className="members-input settings-css" rows={8} spellCheck={false} value={css} maxLength={20000} onChange={(event) => setCss(event.target.value)} placeholder={'body {\n  /* … */\n}'} aria-label={t('css.title')} />
        <div className="settings-inline">
          <button type="button" className="members-button" disabled={css === (dash.customCss ?? '')} onClick={() => (loggedIn ? setPrefs({ customCss: css }) : updateDashSettings({ customCss: css }, { quiet: true }))}>
            {t('css.apply')}
          </button>
          <span className="members-hint">{t('css.count', { count: css.length.toLocaleString(), max: '20,000' })}</span>
        </div>
      </Section>
    </>
  )
}

function LoginPrompt() {
  const { t } = useTranslation('settings')
  return (
    <Section icon="login" title={t('account.title')} text={t('account.text')}>
      <button type="button" className="members-button" onClick={() => window.dispatchEvent(new CustomEvent('homesite:open-login'))}>
        <span className="material-symbols-outlined" aria-hidden="true">
          login
        </span>
        {t('account.login')}
      </button>
    </Section>
  )
}

function AccountTab({ account, loggedIn, isAccountLoading }) {
  const { t } = useTranslation('settings')
  const [profile, setProfile] = useState(null)
  useEffect(() => {
    if (!loggedIn) return
    loadProfile(`@${account.username}`)
      .then(setProfile)
      .catch(() => {})
  }, [loggedIn, account?.username])
  if (!loggedIn) return isAccountLoading ? null : <LoginPrompt />
  return (
    <>
      <Section icon="shield_person" title={t('profile.title')} text={t('profile.text')}>
        {account.member === false ? (
          <p className="members-hint settings-hint">{t('profile.notMember')}</p>
        ) : (
          <VisibilityChoice
            value={profile?.visibility ?? 'members'}
            disabled={!profile}
            onChange={async (visibility) => {
              const result = await updateProfile({ visibility })
              setProfile((current) => ({ ...current, public: result.public, visibility: result.visibility }))
            }}
          />
        )}
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
          <Link className="members-button members-button--quiet" to="/privacy">
            <span className="material-symbols-outlined" aria-hidden="true">
              policy
            </span>
            {t('profile.privacy')}
          </Link>
        </div>
      </Section>

      <Section icon="face" title={t('avatar.title')} text={t('avatar.text')}>
        <AvatarEditor />
      </Section>

      <Section icon="lock" title={t('login.title')} text={t('login.text')}>
        <SecuritySettings />
      </Section>

      <Section icon="dashboard" title={t('dashData.title')} text={t('dashData.text')} danger>
        <Confirmed
          icon="restart_alt"
          openLabel={t('dashData.open')}
          title={t('dashData.confirmTitle')}
          points={[t('dashData.points.layout'), t('dashData.points.integrations'), t('dashData.points.files')]}
          finalText={t('dashData.final')}
          confirmLabel={t('dashData.confirm')}
          busyLabel={t('dashData.busy')}
          onConfirm={async () => {
            const response = await accountFetch('/dash/forget', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'DELETE' }) })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data.error || t('dashData.failed'))
            forgetAccountDash()
          }}
        />
      </Section>

      <Section icon="warning" title={t('delete.section')} text={t('delete.sectionText')} danger>
        <Confirmed
          openLabel={t('delete.open')}
          title={t('delete.title')}
          points={[t('delete.profile'), t('delete.stats'), t('delete.mentions'), t('delete.log')]}
          finalText={<Trans t={t} i18nKey="delete.final" components={{ privacy: <Link to="/privacy#deleting" /> }} />}
          confirmLabel={t('delete.confirm')}
          busyLabel={t('delete.deleting')}
          onConfirm={async () => {
            await deleteAccount()
            forgetThisBrowser()
            try {
              sessionStorage.setItem(GOODBYE_KEY, '1')
            } catch {
              // storage blocked: no goodbye
            }
            window.location.replace('/')
          }}
        />
      </Section>
    </>
  )
}

function NotificationsTab({ loggedIn, isAccountLoading }) {
  const { t } = useTranslation('settings')
  const { prefs, setPrefs } = useAccountSettings()
  const [staff, setStaff] = useState(false)
  useEffect(() => {
    if (loggedIn) loadStaff().then((role) => setStaff(role.staff))
  }, [loggedIn])
  if (!loggedIn) return isAccountLoading ? null : <LoginPrompt />
  const categories = [
    ['moderation', t('notify.moderation'), t('notify.moderationText')],
    ['fdc', t('notify.fdc'), t('notify.fdcText')],
    ['birthdays', t('notify.birthdays'), t('notify.birthdaysText')],
    ...(staff ? [['reports', t('notify.reports'), t('notify.reportsText')]] : []),
  ]
  return (
    <Section icon="notifications" title={t('notify.title')} text={t('notify.text')} id="notifications">
      <div className="notify-prefs">
        <PushSettings />
        {categories.map(([category, label, text]) => {
          const choice = { site: true, email: false, push: true, ...(prefs.notify?.[category] ?? {}) }
          const change = (patch) => setPrefs({ notify: { ...(prefs.notify ?? {}), [category]: { ...choice, ...patch } } })
          return (
            <div key={category} className="notify-pref">
              <span>
                <strong>{label}</strong>
                <small>{text}</small>
              </span>
              <span className="notify-pref__toggles">
                {['site', 'email', 'push'].map((channel) => (
                  <label key={channel} className="notify-pref__toggle">
                    <input type="checkbox" checked={choice[channel]} onChange={(event) => change({ [channel]: event.target.checked })} />
                    {t(`notify.${channel}`)}
                  </label>
                ))}
              </span>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

/*
 * A look at the dash as it is now: hold the button (the dash shows while it's
 * held, scrolling works), or click it once to keep it open with a way out.
 */
function DashPreview() {
  const { t } = useTranslation('settings')
  const [mode, setMode] = useState(null) // null | 'hold' | 'locked'
  const pressed = useRef(null)
  useEffect(() => {
    if (mode !== 'locked') return undefined
    const onKey = (event) => event.key === 'Escape' && setMode(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode])
  return (
    <>
      <button
        type="button"
        className={`members-button settings-preview-button${mode ? ' is-active' : ''}`}
        aria-pressed={mode === 'locked'}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          pressed.current = { at: Date.now(), timer: setTimeout(() => setMode('hold'), 180) }
        }}
        onPointerUp={() => {
          clearTimeout(pressed.current?.timer)
          const quick = pressed.current && Date.now() - pressed.current.at < 180
          pressed.current = null
          setMode((current) => (quick ? (current === 'locked' ? null : 'locked') : current === 'hold' ? null : current))
        }}
        onPointerCancel={() => {
          clearTimeout(pressed.current?.timer)
          pressed.current = null
          setMode((current) => (current === 'hold' ? null : current))
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setMode((current) => (current === 'locked' ? null : 'locked'))
          }
        }}
      >
        <span className="material-symbols-outlined" aria-hidden="true">
          visibility
        </span>
        {t('dashTab.preview')}
      </button>
      {mode && (
        <div className={`settings-preview settings-preview--${mode}`} role="dialog" aria-modal={mode === 'locked'} aria-label={t('dashTab.previewLabel')}>
          <Suspense fallback={null}>
            <Dash preview />
          </Suspense>
          {mode === 'locked' && (
            <button type="button" className="members-button settings-preview__exit" onClick={() => setMode(null)} autoFocus>
              <span className="material-symbols-outlined" aria-hidden="true">
                close
              </span>
              {t('dashTab.exitPreview')}
            </button>
          )}
        </div>
      )}
    </>
  )
}

function DashTab({ account, loggedIn, owner, isAccountLoading }) {
  const { t } = useTranslation('settings')
  const navigate = useNavigate()
  const location = useLocation()
  const section = new URLSearchParams(location.search).get('section') ?? 'look'
  if (!loggedIn) return isAccountLoading ? null : <LoginPrompt />
  return (
    <>
      <div className="settings-dash-head">
        <p className="members-hint">{t('dashTab.text')}</p>
        <div className="settings-inline">
          <DashPreview />
          <Link className="members-button members-button--quiet" to="/dash">
            <span className="material-symbols-outlined" aria-hidden="true">
              dashboard
            </span>
            {t('dashTab.open')}
          </Link>
        </div>
      </div>
      <section className="settings-card settings-card--wide" data-settings-card>
        <DashCustomize
          account={account}
          owner={owner}
          loggedIn={loggedIn}
          tab={section}
          onTab={(next) => navigate({ search: `?section=${next}` }, { replace: true, state: location.state })}
          onEditBoard={() => navigate('/dash', { state: { edit: true } })}
        />
      </section>
    </>
  )
}

function SearchTab({ owner }) {
  const { t } = useTranslation('settings')
  return (
    <>
      <p className="members-hint settings-tab-intro">{t('searchTab.text')}</p>
      <section className="settings-card settings-card--wide" data-settings-card>
        <DashSearchSettings owner={owner} />
      </section>
    </>
  )
}

function AboutTab() {
  const { t } = useTranslation('settings')
  const issues = siteConfig.sourceRepoUrl ? `${siteConfig.sourceRepoUrl.replace(/\/+$/, '')}/issues` : ''
  return (
    <>
      <Section icon="favorite" title={t('about.title')} text={t('about.text')}>
        <p className="settings-about">
          <Trans t={t} i18nKey="about.credit" components={{ name: <strong /> }} />
        </p>
        <div className="settings-links">
          {issues && (
            <a className="members-button" href={issues} target="_blank" rel="noopener noreferrer">
              <span className="material-symbols-outlined" aria-hidden="true">
                bug_report
              </span>
              {t('about.issues')}
            </a>
          )}
          {siteConfig.sourceRepoUrl && (
            <a className="members-button members-button--quiet" href={siteConfig.sourceRepoUrl} target="_blank" rel="noopener noreferrer">
              <span className="material-symbols-outlined" aria-hidden="true">
                code
              </span>
              {t('about.source')}
            </a>
          )}
          {discordInviteUrl && (
            <a className="members-button members-button--quiet" href={discordInviteUrl} target="_blank" rel="noopener noreferrer">
              <span className="material-symbols-outlined" aria-hidden="true">
                forum
              </span>
              {t('about.discord')}
            </a>
          )}
          {siteConfig.privacyEmail && (
            <a className="members-button members-button--quiet" href={`mailto:${siteConfig.privacyEmail}`}>
              <span className="material-symbols-outlined" aria-hidden="true">
                mail
              </span>
              {t('about.mail')}
            </a>
          )}
        </div>
      </Section>
      <Section icon="policy" title={t('about.legal')}>
        <div className="settings-links">
          <Link className="members-button members-button--quiet" to="/privacy">
            <span className="material-symbols-outlined" aria-hidden="true">
              shield_person
            </span>
            {t('about.privacy')}
          </Link>
          <Link className="members-button members-button--quiet" to="/license">
            <span className="material-symbols-outlined" aria-hidden="true">
              gavel
            </span>
            {t('about.license')}
          </Link>
          <Link className="members-button members-button--quiet" to="/about">
            <span className="material-symbols-outlined" aria-hidden="true">
              info
            </span>
            {t('about.site')}
          </Link>
        </div>
      </Section>
    </>
  )
}

/* ---------- search over every tab ---------- */

/* While searching, every tab is shown and every card / row that doesn't match is hidden. */
function useSettingsSearch(query, rootRef) {
  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
    const apply = () => {
      const blocks = root.querySelectorAll('[data-settings-card]')
      let any = false
      for (const block of blocks) {
        if (!words.length) {
          block.hidden = false
          for (const row of block.querySelectorAll('[data-settings-hidden]')) {
            row.hidden = false
            row.removeAttribute('data-settings-hidden')
          }
          continue
        }
        const whole = block.textContent.toLocaleLowerCase()
        const match = words.every((word) => whole.includes(word))
        block.hidden = !match
        if (match) any = true
        // Inside a matching card, only the rows that match (unless the card's title does).
        const title = block.querySelector('header')?.textContent.toLocaleLowerCase() ?? ''
        const rows = block.querySelectorAll('.settings-row, .members-switch, .dash-field, .dash-check, .dash-section, .notify-pref')
        for (const row of rows) {
          const hide = match && !words.every((word) => title.includes(word)) && !words.every((word) => row.textContent.toLocaleLowerCase().includes(word))
          if (hide) {
            row.hidden = true
            row.setAttribute('data-settings-hidden', '')
          } else if (row.hasAttribute('data-settings-hidden')) {
            row.hidden = false
            row.removeAttribute('data-settings-hidden')
          }
        }
      }
      root.dataset.searchEmpty = words.length && !any ? 'true' : 'false'
    }
    apply()
    // Parts load later (tabs, the dash's lists): search them too when they appear.
    const observer = new MutationObserver(() => apply())
    if (words.length) observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [query, rootRef])
}

export default function Settings() {
  const { t } = useTranslation('settings')
  const { tab: param } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { account, isAccountLoading } = useAccountSettings()
  const loggedIn = Boolean(account && !account.local && !account.isAdminSession)
  const owner = loggedIn && Boolean(siteConfig.ownerDiscordId && account.discordUserId === siteConfig.ownerDiscordId)
  const [query, setQuery] = useState('')
  const rootRef = useRef(null)
  useSettingsSearch(query, rootRef)
  const tab = TABS.some((entry) => entry.id === param) ? param : 'general'
  if (param && !TABS.some((entry) => entry.id === param)) return <Navigate to="/settings" replace />
  const searching = query.trim().length > 0
  const shown = searching ? TABS.map((entry) => entry.id) : [tab]
  const content = {
    general: <GeneralTab loggedIn={loggedIn} />,
    account: <AccountTab account={account} loggedIn={loggedIn} isAccountLoading={isAccountLoading} />,
    notifications: <NotificationsTab loggedIn={loggedIn} isAccountLoading={isAccountLoading} />,
    dash: <DashTab account={account} loggedIn={loggedIn} owner={owner} isAccountLoading={isAccountLoading} />,
    search: <SearchTab owner={owner} />,
    about: <AboutTab />,
  }
  const body = (
    <div className="settings-page" ref={rootRef}>
      <div className="settings-page__top">
        <h1>{t('title')}</h1>
        <p className="members-hint">{loggedIn ? t('savedAccount') : t('savedBrowser')}</p>
        <label className="settings-search">
          <span className="material-symbols-outlined" aria-hidden="true">
            search
          </span>
          <input type="search" value={query} placeholder={t('searchPlaceholder')} aria-label={t('searchPlaceholder')} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>
      <div className="settings-page__layout">
        <nav className="settings-tabs" aria-label={t('title')} role="tablist">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={!searching && tab === entry.id}
              className={!searching && tab === entry.id ? 'is-active' : ''}
              onClick={() => {
                setQuery('')
                navigate(`/settings${entry.id === 'general' ? '' : `/${entry.id}`}`, { state: location.state })
              }}
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                {entry.icon}
              </span>
              <span>
                <strong>{t(`tabs.${entry.id}`)}</strong>
                <small>{t(`tabs.${entry.id}Text`)}</small>
              </span>
            </button>
          ))}
        </nav>
        <div className="settings-panels">
          {shown.map((id) => (
            <div key={id} className="settings-panel" role="tabpanel" aria-label={t(`tabs.${id}`)}>
              {searching && <h2 className="settings-panel__title">{t(`tabs.${id}`)}</h2>}
              <div className="settings-grid">{content[id]}</div>
            </div>
          ))}
          <p className="settings-empty">{t('searchEmpty', { query })}</p>
        </div>
      </div>
    </div>
  )
  return (
    <OriginShell storeKey="homesite:settings:from" title={t('title')} heading={t('settings', { ns: 'title', defaultValue: 'Settings of HomeSite' })} backLabel={t('back')} wide>
      {body}
    </OriginShell>
  )
}
