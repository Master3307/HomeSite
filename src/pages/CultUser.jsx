import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'

import CultShell from '/src/components/cult/CultShell'
import PageLoading from '/src/components/PageLoading'
import MemberBadges from '/src/components/cult/MemberBadges'
import VisibilityChoice from '/src/components/cult/VisibilityChoice'
import BrandIcon from '/src/components/BrandIcon'
import { AboutChips, AboutForm } from '/src/components/cult/AboutMe'
import { BirthdayLine } from '/src/components/cult/Birthdays'
import ModerationPanel from '/src/components/cult/ModerationPanel'
import { loadStaff } from '/src/lib/moderation'
import { Activity } from '/src/components/DiscordCard'
import { DISCORD_LOGIN_URL } from '/src/lib/account'
import { apiUrl, keyPath, loadProfile, saveNickname, updateProfile } from '/src/lib/members'
import { useCatalog } from '/src/lib/bongo'
import { useUrlParam } from '/src/lib/urlState'

const AvatarEditor = lazy(() => import('/src/components/bongo/AvatarEditor'))
const ReportDialog = lazy(() => import('/src/components/cult/ReportDialog'))

/*
 * /cult/user/@name (or /<Discord ID>, /<account id>): a member's profile.
 * Public profiles are visible to everyone, private ones only to their owner
 * (everyone else gets the lock). ?edit=profile / ?edit=avatar / ?report=1
 * keep the open panel in the address.
 */

const STATUS_TEXT = { online: 'Online', idle: 'Away', dnd: 'Do not disturb', offline: 'Offline' }

const date = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : null)
const n = (value) => Number(value ?? 0).toLocaleString()

function Avatar({ src, decoration, status, size = 124 }) {
  return (
    <span className="member-avatar" style={{ '--size': `${size}px` }}>
      {src ? <img className="member-avatar__image" src={src} alt="" /> : <span className="member-avatar__image member-avatar__image--empty material-symbols-outlined">person</span>}
      {decoration && <img className="member-avatar__decoration" src={decoration} alt="" />}
      {status && <span className={`member-avatar__status member-avatar__status--${status}`} aria-hidden="true" />}
    </span>
  )
}

function Stat({ icon, label, value, hint }) {
  return (
    <div className="member-stat" title={hint}>
      <span className="material-symbols-outlined" aria-hidden="true">
        {icon}
      </span>
      <span className="member-stat__value">{value}</span>
      <span className="member-stat__label">{label}</span>
    </div>
  )
}

function Locked({ loggedIn, membersOnly }) {
  return (
    <div className="members-locked">
      <span className="material-symbols-outlined" aria-hidden="true">
        {membersOnly ? 'group' : 'lock'}
      </span>
      <h1>{membersOnly ? 'Only for members' : 'This profile is private'}</h1>
      <p>{membersOnly ? (loggedIn ? 'Only members who are still in the server can see this profile.' : 'Only logged-in members of the server can see this profile.') : 'Its owner chose to keep it to themselves, so nobody else can view it.'}</p>
      {!loggedIn && (
        <div className="members-locked__login">
          <p>{membersOnly ? 'Are you in the server? Log in to see it.' : 'Is it yours? Log in to see it.'}</p>
          <a className="members-button" href={DISCORD_LOGIN_URL}>
            <span className="material-symbols-outlined" aria-hidden="true">
              login
            </span>
            Log in with Discord
          </a>
        </div>
      )}
    </div>
  )
}

/* The picture as shown (background + cat), drawn in the browser. */
/* The server nickname, changed by the bot (Discord doesn't allow bots to change server avatars). */
function NicknameForm({ current, fallback, onSaved }) {
  const [value, setValue] = useState(current ?? '')
  const [state, setState] = useState({})
  async function save(nickname) {
    setState({ busy: true })
    try {
      const result = await saveNickname(nickname)
      setValue(result.nickname ?? '')
      setState({ saved: true })
      onSaved(result)
    } catch (reason) {
      setState({ error: reason.message })
    }
  }
  return (
    <form
      className="member-edit__nick"
      onSubmit={(event) => {
        event.preventDefault()
        save(value.trim() || null)
      }}
    >
      <label className="members-label" htmlFor="member-nickname">
        Name on the server
      </label>
      <div className="settings-inline">
        <input id="member-nickname" name="nickname" autoComplete="nickname" className="members-input" value={value} maxLength={32} placeholder={fallback} onChange={(event) => (setValue(event.target.value), setState({}))} />
        <button type="submit" className="members-button" disabled={state.busy || value.trim() === (current ?? '')}>
          Save
        </button>
        {current && (
          <button type="button" className="members-button members-button--quiet" disabled={state.busy} onClick={() => save(null)}>
            Reset
          </button>
        )}
      </div>
      {state.saved && <p className="members-ok">Changed on the server.</p>}
      {state.error && <p className="members-error">{state.error}</p>}
    </form>
  )
}

async function exportAvatar(profile) {
  if (!profile.bongo.imageUrl) return
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 512
  const context = canvas.getContext('2d')
  const draw = async (url) => context.drawImage(await createImageBitmap(await fetch(url, { credentials: 'include' }).then((response) => response.blob())), 0, 0, 512, 512)
  if (profile.bongo.spec?.background === 'image' && profile.bongo.backgroundUrl) await draw(apiUrl(profile.bongo.backgroundUrl))
  await draw(apiUrl(profile.bongo.imageUrl))
  const link = document.createElement('a')
  link.href = canvas.toDataURL('image/png')
  link.download = `${profile.username}-bongo-cat.png`
  document.body.append(link)
  link.click()
  link.remove()
}

export default function CultUser() {
  const { key: routeKey, handle } = useParams()
  // /cult/@name or /cult/user/<@name | Discord ID | account id>
  const key = handle ?? routeKey
  const navigate = useNavigate()
  const { t } = useTranslation('discord')
  const { t: tm } = useTranslation('members')
  const { catalog } = useCatalog()
  const [state, setState] = useState({ loading: true })
  const [edit, setEdit] = useUrlParam('edit')
  const [report, setReport] = useUrlParam('report')
  const [saving, setSaving] = useState(false)
  const [role, setRole] = useState({ staff: false, owner: false })
  const [moderating, setModerating] = useUrlParam('moderate')

  useEffect(() => {
    loadStaff().then(setRole)
  }, [])
  const [copied, setCopied] = useState(false)

  // Only the newest lookup counts: switching profiles quickly must not let an
  // older, slower answer replace the page (or its address).
  const latest = useRef(0)
  const load = useCallback(() => {
    const request = ++latest.current
    return loadProfile(key)
      .then((profile) => {
        if (request !== latest.current) return
        setState({ profile })
        // Any working address shows the @name one (shareable, the default).
        if (profile.key && window.location.pathname !== keyPath(profile.key)) navigate(`${keyPath(profile.key)}${window.location.search}${window.location.hash}`, { replace: true })
      })
      .catch((error) => {
        if (request === latest.current) setState({ error })
      })
  }, [key, navigate])

  useEffect(() => {
    load()
  }, [load])

  const profile = state.profile

  async function setVisibility(next) {
    setSaving(true)
    try {
      const result = await updateProfile({ visibility: next })
      setState((current) => ({ profile: { ...current.profile, public: result.public, visibility: result.visibility } }))
    } finally {
      setSaving(false)
    }
  }

  async function copyLink() {
    await navigator.clipboard?.writeText(`${window.location.origin}${keyPath(profile.key)}`).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  if (state.loading) {
    return (
      <CultShell title="Profile">
        <PageLoading label="Loading the profile…" screen />
      </CultShell>
    )
  }

  if (state.error) {
    return (
      <CultShell title="Profile">
        {state.error.data?.private || state.error.data?.membersOnly ? (
          <Locked loggedIn={state.error.data.loggedIn} membersOnly={Boolean(state.error.data.membersOnly)} />
        ) : (
          <div className="members-locked">
            <span className="material-symbols-outlined" aria-hidden="true">
              person_off
            </span>
            <h1>No member here</h1>
            <p>{state.error.status === 404 ? 'There is no member with that name. Maybe they changed it?' : state.error.message}</p>
            <Link className="members-button members-button--quiet" to="/cult/members">
              See all members
            </Link>
          </div>
        )}
      </CultShell>
    )
  }

  const discord = profile.discord
  const member = discord?.member
  const presence = discord?.presence
  const level = discord?.stats?.level
  const pets = discord?.stats?.pets
  const displayName = member?.display_name ?? profile.displayName
  const status = presence?.status ?? 'offline'
  // The Discord banner, else the bongo avatar's picture.
  const banner = discord?.user?.banner ?? (profile.bongo.backgroundUrl ? apiUrl(profile.bongo.backgroundUrl) : null)
  const accent = discord?.user?.accent_color

  return (
    <CultShell title={displayName} wide>
      <article className="member-profile">
        <header className="member-hero" style={{ '--banner': banner ? `url("${banner}")` : undefined, '--banner-tint': accent ?? undefined }}>
          <div className="member-hero__banner" aria-hidden="true" />
          <div className="member-hero__body">
            <Avatar src={discord?.user?.avatar ?? apiUrl(profile.avatarUrl)} decoration={discord?.user?.avatar_decoration} status={status} />
            <div className="member-hero__names">
              <h1>{displayName}</h1>
              <p className="member-hero__username">
                <span>@{profile.username}</span>
                <span className={`member-status member-status--${status}`}>
                  <i aria-hidden="true" />
                  {STATUS_TEXT[status] ?? 'Offline'}
                </span>
                {profile.visibility !== 'everyone' && (
                  <span className="member-pill" title={profile.visibility === 'private' ? 'Only you can see this profile' : 'Only logged-in members of the server can see this profile'}>
                    <span className="material-symbols-outlined" aria-hidden="true">
                      {profile.visibility === 'private' ? 'lock' : 'group'}
                    </span>
                    {profile.visibility === 'private' ? 'Private' : 'Members only'}
                  </span>
                )}
              </p>
              <MemberBadges badges={discord?.badges} />
            </div>
            <div className="member-hero__actions">
              {profile.isSelf && (
                <button type="button" className="members-button" onClick={() => setEdit(edit ? null : 'profile')} aria-expanded={Boolean(edit)}>
                  <span className="material-symbols-outlined" aria-hidden="true">
                    edit
                  </span>
                  Edit profile
                </button>
              )}
              <button type="button" className="members-icon-button member-hero__icon" onClick={copyLink} title={copied ? 'Copied' : 'Copy the link to this profile'} aria-label="Copy the link to this profile">
                <span className="material-symbols-outlined" aria-hidden="true">
                  {copied ? 'check' : 'link'}
                </span>
              </button>
              {profile.discordId && (
                <a
                  className="members-icon-button member-hero__icon member-hero__icon--discord"
                  href={`https://discord.com/users/${profile.discordId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open on Discord"
                  aria-label="Open on Discord"
                >
                  <BrandIcon name="discord" size={20} />
                </a>
              )}
              {!profile.isSelf && role.staff && (
                <button type="button" className="members-icon-button member-hero__icon" onClick={() => setModerating(moderating ? null : true)} aria-expanded={Boolean(moderating)} title="Moderate" aria-label="Moderate">
                  <span className="material-symbols-outlined" aria-hidden="true">
                    shield
                  </span>
                </button>
              )}
              {!profile.isSelf && profile.loggedIn && (
                <button type="button" className="members-icon-button member-hero__icon member-hero__icon--danger" onClick={() => setReport(true)} title="Report" aria-label="Report">
                  <span className="material-symbols-outlined" aria-hidden="true">
                    flag
                  </span>
                </button>
              )}
            </div>
          </div>
        </header>

        {!profile.isSelf && role.staff && moderating && (
          <section className="member-card" aria-label="Moderate">
            <h2>Moderate</h2>
            <ModerationPanel userKey={profile.key} owner={role.owner} onDone={(result) => result.deleted && navigate('/cult/members')} />
          </section>
        )}

        {profile.isSelf && edit && (
          <section className="member-card member-edit" aria-label="Edit profile">
            <h2>Edit profile</h2>
            <div>
              <p className="members-label">Who can see your profile</p>
              <VisibilityChoice value={profile.visibility} disabled={saving} onChange={setVisibility} />
            </div>
            {member && (
              <NicknameForm
                current={member.nickname}
                fallback={discord?.user?.global_name ?? profile.username}
                onSaved={(result) =>
                  setState((current) => ({
                    profile: { ...current.profile, displayName: result.displayName, discord: { ...current.profile.discord, member: { ...current.profile.discord.member, nickname: result.nickname, display_name: result.displayName } } },
                  }))
                }
              />
            )}
            <AboutForm about={profile.about} onSaved={(about) => setState((current) => ({ profile: { ...current.profile, about } }))} />
            <div className="member-edit__row">
              <button type="button" className="members-button" onClick={() => setEdit('avatar')} disabled={!catalog}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  pets
                </span>
                {profile.bongo.spec ? 'Edit your bongo avatar' : 'Design a bongo avatar'}
              </button>
              {profile.bongo.spec && (
                <button
                  type="button"
                  className="members-button members-button--quiet"
                  onClick={async () => {
                    const result = await updateProfile({ bongo: null })
                    setState((current) => ({ profile: { ...current.profile, bongo: result.bongo } }))
                  }}
                >
                  Remove it
                </button>
              )}
              <Link className="members-button members-button--quiet" to="/settings/account" state={{ from: 'cult' }}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  settings
                </span>
                All settings
              </Link>
            </div>
          </section>
        )}

        <div className="member-grid">
          <section className="member-card member-bongo" aria-label="Bongo avatar">
            <div className="member-bongo__stage">
              {profile.bongo.imageUrl ? (
                <div className="member-bongo__frame" style={profile.bongo.spec?.background === 'image' && profile.bongo.backgroundUrl ? { backgroundImage: `url("${apiUrl(profile.bongo.backgroundUrl)}")` } : undefined}>
                  <img className="member-bongo__image" src={apiUrl(profile.bongo.imageUrl)} alt={`${displayName}'s bongo cat`} />
                </div>
              ) : (
                <div className="member-bongo__empty">
                  <span className="material-symbols-outlined" aria-hidden="true">
                    pets
                  </span>
                  <span>{profile.isSelf ? 'Make your own bongo cat: any skin, hats and bongos, moved and turned how you like.' : 'No bongo avatar yet.'}</span>
                </div>
              )}
            </div>
            <div className="member-bongo__bar">
              <span className="member-bongo__label">
                <span className="material-symbols-outlined" aria-hidden="true">
                  pets
                </span>
                Bongo avatar
              </span>
              {profile.isSelf && catalog && (
                <button type="button" className="members-icon-button" onClick={() => setEdit('avatar')} title={profile.bongo.spec ? 'Edit it' : 'Design it'} aria-label={profile.bongo.spec ? 'Edit your bongo avatar' : 'Design your bongo avatar'}>
                  <span className="material-symbols-outlined" aria-hidden="true">
                    {profile.bongo.spec ? 'edit' : 'add'}
                  </span>
                </button>
              )}
              {profile.bongo.imageUrl && (
                <button type="button" className="members-icon-button" onClick={() => exportAvatar(profile)} title="Save as PNG" aria-label="Save as PNG">
                  <span className="material-symbols-outlined" aria-hidden="true">
                    download
                  </span>
                </button>
              )}
            </div>
          </section>

          <div className="member-column">
            {(profile.about?.hobbies?.length > 0 || (profile.about?.gender && profile.about.gender !== 'unsaid') || profile.birthday) && (
              <section className="member-card" aria-label="About">
                <h2>{tm('about.title')}</h2>
                <AboutChips about={profile.about} />
                {profile.birthday && <BirthdayLine birthday={profile.birthday} />}
              </section>
            )}
            {presence?.activities?.length > 0 && (
              <section className="member-card member-presence" aria-label="Right now">
                <h2>Right now</h2>
                <Activity activities={presence.activities} t={t} />
              </section>
            )}

            <section className="member-card" aria-label="Stats">
              <h2>Stats</h2>
              <div className="member-stats">
                {level && <Stat icon="military_tech" label="Level" value={`${level.level} / ${level.max}`} hint={level.rank} />}
                {level && <Stat icon="star" label="Points" value={n(level.points)} />}
                {pets && <Stat icon="volunteer_activism" label="Pets given" value={n(pets.given)} />}
                {pets && <Stat icon="favorite" label="Pets received" value={n(pets.received)} />}
                {pets && <Stat icon="bolt" label="Best combo" value={n(pets.bestCombo)} />}
                <Stat icon="touch_app" label="Lobby cat taps" value={n(profile.site.taps)} />
                <Stat icon="pets" label="Lobby cat pets" value={n(profile.site.lobbyPets)} hint={`Trust level ${profile.site.lobbyLevel}`} />
              </div>
              {level && !level.progress?.isMaxLevel && level.progress && (
                <div className="member-progress" title={`${n(level.progress.pointsIntoLevel)} / ${n(level.progress.pointsNeeded)} points to level ${level.progress.nextLevel}`}>
                  <span>{level.rank}</span>
                  <div className="member-progress__bar">
                    <span style={{ width: `${Math.min(100, (100 * level.progress.pointsIntoLevel) / Math.max(1, level.progress.pointsNeeded))}%` }} />
                  </div>
                  <span>Level {level.progress.nextLevel}</span>
                </div>
              )}
            </section>

            <section className="member-card" aria-label="On the server">
              <h2>On the server</h2>
              <dl className="member-facts">
                {member?.joined_at && (
                  <>
                    <dt>Joined the server</dt>
                    <dd>{date(member.joined_at)}</dd>
                  </>
                )}
                {member?.premium_since && (
                  <>
                    <dt>Boosting since</dt>
                    <dd>{date(member.premium_since)}</dd>
                  </>
                )}
                {discord?.user?.created_at && (
                  <>
                    <dt>On Discord since</dt>
                    <dd>{date(discord.user.created_at)}</dd>
                  </>
                )}
                <dt>Website member since</dt>
                <dd>{date(profile.site.memberSince)}</dd>
              </dl>
              {member?.roles?.length > 0 && (
                <ul className="member-roles" aria-label="Roles">
                  {member.roles.map((role) => (
                    <li key={role.id} style={{ '--role': role.color ?? undefined }}>
                      {role.name}
                    </li>
                  ))}
                </ul>
              )}
              {!discord && <p className="members-hint">Discord details are not available right now.</p>}
            </section>
          </div>
        </div>
      </article>

      {profile.isSelf && edit === 'avatar' && catalog && (
        <Suspense fallback={null}>
          <AvatarEditor
            catalog={catalog}
            initial={profile.bongo.spec}
            background={profile.bongo.backgroundUrl ? apiUrl(profile.bongo.backgroundUrl) : null}
            onCancel={() => setEdit('profile')}
            onSaved={(bongo) => {
              setState((current) => ({ profile: { ...current.profile, bongo } }))
              setEdit('profile')
            }}
          />
        </Suspense>
      )}

      {report && !profile.isSelf && profile.loggedIn && (
        <Suspense fallback={null}>
          <ReportDialog profile={profile} displayName={displayName} onClose={() => setReport(null)} />
        </Suspense>
      )}
    </CultShell>
  )
}
