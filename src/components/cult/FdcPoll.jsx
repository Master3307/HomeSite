import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  customEmojiUrl,
  formatPollDate,
  formatRemaining,
  isRunningPoll,
  publicPollImage,
  useFdcClock,
  voteFdc,
} from '../../lib/fdc'
import { LOGIN_AVAILABLE } from '../../lib/account'
import { catNotice } from '../../lib/lobbyCat'
import FdcManage from './FdcManage'
import FdcExternalVotes from './FdcExternalVotes'
import { recycleOptions } from '../../lib/fdcRecycle'

function OptionEmoji({ emoji }) {
  const url = customEmojiUrl(emoji)
  const [failed, setFailed] = useState(false)

  if (url && !failed) {
    return (
      <img
        className="fdc-option__emoji fdc-option__emoji--custom"
        src={url}
        alt={emoji.display}
        title={emoji.display}
        width="18"
        height="18"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    )
  }

  return <span className="fdc-option__emoji">{emoji?.display}</span>
}

function VoterList({ voters, options }) {
  const { t } = useTranslation('voting')

  if (!voters.length) return null

  return (
    <details className="fdc-voters">
      <summary>
        <span className="material-symbols-outlined" aria-hidden="true">
          group
        </span>
        {t('fdc.showVoters', {
          defaultValue: 'Show who voted',
        })}
      </summary>

      <div className="fdc-voters__groups">
        {options.map((option) => {
          const group = voters.filter(
            (voter) => voter.optionNumber === option.number,
          )

          if (!group.length) return null

          return (
            <div className="fdc-voters__group" key={option.number}>
              <p className="fdc-voters__label">
                <span className="fdc-option__number">{option.number}</span>
                <OptionEmoji emoji={option.emoji} />
                <span>{group.length}</span>
              </p>

              <ul>
                {group.map((voter) => (
                  <li key={voter.userId} title={voter.via === 'web' ? t('fdc.votedOnWebsite', { defaultValue: 'Voted on the website' }) : undefined}>
                    {voter.avatarUrl ? (
                      <img src={voter.avatarUrl} alt="" width="22" height="22" loading="lazy" />
                    ) : (
                      <span className="fdc-voters__avatar" aria-hidden="true" />
                    )}
                    <span>{voter.displayName || voter.userId}</span>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </details>
  )
}

export default function FdcPoll({
  poll,
  account,
  onVoted,
  onChanged,
  compact = false,
  // Kept by the parent so the panel survives the reload after an edit.
  managing: managingProp,
  onManagingChange,
}) {
  const { t, i18n } = useTranslation('voting')
  const now = useFdcClock(15_000)

  const [result, setResult] = useState(null)
  const [pending, setPending] = useState(null)
  const [error, setError] = useState(null)
  const [managingState, setManagingState] = useState(false)
  // Editors on ended polls: option numbers already in the recycling bin.
  const [recycled, setRecycled] = useState(() => new Set(poll.viewer?.recycled ?? []))
  const [recycling, setRecycling] = useState(null)
  const canRecycle = Array.isArray(poll.viewer?.recycled) && poll.live !== false
  const managing = managingProp ?? managingState
  const setManaging = onManagingChange ?? setManagingState

  const running = isRunningPoll(poll, now)
  const canManage = running && poll.live !== false && poll.viewer?.canManage === true
  // Editors: fix ended / archived polls (archive only) and add outside votes.
  const isEditor = poll.live !== false && poll.viewer?.isEditor === true
  const canEditArchive = !running && isEditor && !canManage
  // `managing`: false | 'edit' (true = 'edit') | 'votes'
  const editing = managing === true || managing === 'edit'
  const enteringVotes = managing === 'votes'
  const externalTotal = (poll.externalVotes ?? []).reduce((sum, source) => sum + source.total, 0)
  const statistics = result?.statistics ?? poll.statistics
  const myVote = result ? result.optionNumber : poll.viewer?.myVote ?? null
  const canVote = running && poll.live !== false && poll.viewer?.canVote
  const showWinners = poll.status === 'closed'
  const winningNumbers = statistics.winningOptionNumbers ?? []
  // Past FDCs where only the winner survived: no counts to show.
  const votesKnown = poll.votesKnown !== false

  async function recycle(optionNumber) {
    if (recycling !== null || recycled.has(optionNumber)) return
    setRecycling(optionNumber)
    setError(null)
    try {
      await recycleOptions([{ date: poll.date, optionNumber }])
      setRecycled((current) => new Set([...current, optionNumber]))
    } catch (recycleError) {
      setError(recycleError.message)
    } finally {
      setRecycling(null)
    }
  }

  async function vote(optionNumber) {
    if (pending !== null) return

    setPending(optionNumber)
    setError(null)

    try {
      const next = await voteFdc(
        poll.id,
        myVote === optionNumber ? null : optionNumber,
      )
      setResult(next)
      catNotice('fdc-voted', { removed: myVote === optionNumber })
      onVoted?.()
    } catch (voteError) {
      setError(voteError.message)
    } finally {
      setPending(null)
    }
  }

  const status = running
    ? t('fdc.running', { defaultValue: 'Running' })
    : poll.status === 'closed'
      ? t('fdc.ended', { defaultValue: 'Ended' })
      : poll.status === 'failed'
        ? t('fdc.failed', { defaultValue: 'Failed' })
        : t('fdc.notAcceptingVotes', { defaultValue: 'Not accepting votes' })

  return (
    <article className={`fdc-poll${compact ? ' fdc-poll--compact' : ''}`}>
      <header className="fdc-poll__header">
        <div>
          <p className="fdc-poll__date">
            {formatPollDate(poll.endsAt, i18n.language)}
          </p>

          {running && (
            <p className="fdc-poll__remaining">
              <span className="material-symbols-outlined" aria-hidden="true">
                schedule
              </span>
              {t('fdc.endsIn', {
                defaultValue: 'Ends in {{time}}',
                time: formatRemaining(poll.endsAt, now, i18n.language),
              })}
            </p>
          )}
        </div>

        <div className="fdc-poll__header-side">
          <span className={`fdc-status${running ? ' fdc-status--running' : ''}`}>
            {running && <span className="fdc-status__dot" aria-hidden="true" />}
            {status}
          </span>

          {(canManage || canEditArchive) && !editing && (
            <button type="button" className="fdc-link" onClick={() => setManaging('edit')}>
              <span className="material-symbols-outlined" aria-hidden="true">
                edit
              </span>
              {canManage
                ? t('fdc.manage.open', { defaultValue: 'Manage' })
                : t('fdc.manage.editArchive', { defaultValue: 'Edit' })}
            </button>
          )}

          {isEditor && !enteringVotes && (
            <button type="button" className="fdc-link" onClick={() => setManaging('votes')}>
              <span className="material-symbols-outlined" aria-hidden="true">
                how_to_vote
              </span>
              {t('fdc.external.open', { defaultValue: 'Add votes' })}
            </button>
          )}

          {poll.messageUrl && (
            <a
              className="fdc-link"
              href={poll.messageUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                open_in_new
              </span>
              {t('fdc.openInDiscord', { defaultValue: 'Discord' })}
            </a>
          )}
        </div>
      </header>

      {enteringVotes && isEditor && (
        <FdcExternalVotes
          poll={poll}
          onClose={() => setManaging(false)}
          onSaved={() => (onChanged ?? onVoted)?.('votes')}
        />
      )}

      {editing && (canManage || canEditArchive) && (
        <FdcManage
          poll={poll}
          archived={canEditArchive}
          onClose={() => setManaging(false)}
          onDone={(action) => {
            if (action !== 'edited') setManaging(false)
            ;(onChanged ?? onVoted)?.(action)
          }}
        />
      )}

      {canVote && !editing && (
        <p className="fdc-poll__hint">
          <span className="material-symbols-outlined" aria-hidden="true">
            touch_app
          </span>
          {myVote
            ? t('fdc.hintSwitch', {
                defaultValue: 'Tap another outfit to switch, or your pick to remove it.',
              })
            : t('fdc.hintVote', { defaultValue: 'Tap an outfit to vote.' })}
        </p>
      )}

      <div className="fdc-options">
        {poll.options.map((option) => {
          const stats = statistics.options?.find(
            (entry) => entry.optionNumber === option.number,
          )

          const votes = stats?.votes ?? 0
          const percentage = Math.min(100, Math.max(0, Number(stats?.percentage) || 0))
          const winner = showWinners && winningNumbers.includes(option.number)
          const mine = myVote === option.number

          return (
            <section
              key={option.number}
              className={[
                'fdc-option',
                winner && 'fdc-option--winner',
                mine && 'fdc-option--mine',
                canVote && 'fdc-option--votable',
                pending === option.number && 'fdc-option--pending',
              ].filter(Boolean).join(' ')}
            >
              <div className={`fdc-option__media${option.image === null ? ' fdc-option__media--text' : ''}`}>
                {/* Past FDCs may have options without an image: show the name instead. */}
                {option.image === null ? (
                  <span className="fdc-option__text-card">{option.description}</span>
                ) : (
                  <img
                    src={publicPollImage(poll, option)}
                    alt={option.description}
                    loading="lazy"
                    decoding="async"
                    width="640"
                    height="400"
                  />
                )}

                <span className="fdc-option__tag">
                  <span className="fdc-option__number">{option.number}</span>
                  <OptionEmoji emoji={option.emoji} />
                </span>

                {mine ? (
                  <span className="fdc-option__badge fdc-option__badge--mine">
                    <span className="material-symbols-outlined" aria-hidden="true">
                      check_circle
                    </span>
                    {t('fdc.yourVote', { defaultValue: 'Your vote' })}
                  </span>
                ) : winner ? (
                  <span className="fdc-option__badge fdc-option__badge--winner">
                    <span className="material-symbols-outlined" aria-hidden="true">
                      trophy
                    </span>
                    {statistics.isTie
                      ? t('fdc.tiedWinner', { defaultValue: 'Tied winner' })
                      : t('fdc.winner', { defaultValue: 'Winner' })}
                  </span>
                ) : null}

                {canRecycle && (
                  <button
                    type="button"
                    className={`fdc-option__recycle${recycled.has(option.number) ? ' is-recycled' : ''}`}
                    onClick={() => recycle(option.number)}
                    disabled={recycling !== null || recycled.has(option.number)}
                    title={
                      recycled.has(option.number)
                        ? t('fdc.recycle.inBin', { defaultValue: 'In the recycling bin' })
                        : t('fdc.recycle.recycleThis', { defaultValue: 'Recycle this option' })
                    }
                  >
                    <span className="material-symbols-outlined" aria-hidden="true">
                      {recycled.has(option.number) ? 'check' : 'recycling'}
                    </span>
                    {recycled.has(option.number)
                      ? t('fdc.recycle.inBinShort', { defaultValue: 'In bin' })
                      : recycling === option.number
                        ? t('fdc.manage.working', { defaultValue: 'Working…' })
                        : t('fdc.recycle.recycle', { defaultValue: 'Recycle' })}
                  </button>
                )}

                {option.image !== null && (
                <a
                  className="fdc-option__zoom"
                  href={publicPollImage(poll, option)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('fdc.openImage', {
                    defaultValue: 'Open image for option {{number}}',
                    number: option.number,
                  })}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">
                    open_in_full
                  </span>
                </a>
                )}
              </div>

              <div className="fdc-option__body">
                <p className="fdc-option__description">
                  {option.description ||
                    t('fdc.create.option', { defaultValue: 'Option {{number}}', number: option.number })}
                </p>

                {votesKnown && (
                <div className="fdc-option__result">
                  <div
                    className="fdc-option__progress"
                    role="progressbar"
                    aria-label={option.description}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percentage}
                  >
                    <span style={{ width: `${percentage}%` }} />
                  </div>

                  <p className="fdc-option__counts">
                    <strong>
                      {percentage.toLocaleString(i18n.language, {
                        maximumFractionDigits: 0,
                      })}
                      %
                    </strong>
                    <span>
                      {t('fdc.votes', {
                        count: votes,
                        defaultValue: '{{count}} vote',
                        defaultValue_other: '{{count}} votes',
                      })}
                    </span>
                  </p>
                </div>
                )}
              </div>

              {canVote && (
                <button
                  type="button"
                  className="fdc-option__hit"
                  onClick={() => vote(option.number)}
                  disabled={pending !== null}
                  aria-pressed={mine}
                  aria-label={
                    mine
                      ? t('fdc.removeVote', { defaultValue: 'Remove your vote' })
                      : t('fdc.voteFor', {
                          defaultValue: 'Vote for option {{number}}',
                          number: option.number,
                        })
                  }
                  title={
                    mine
                      ? t('fdc.removeVote', { defaultValue: 'Remove your vote' })
                      : undefined
                  }
                />
              )}
            </section>
          )
        })}
      </div>

      {error && (
        <p className="fdc-error" role="alert">
          {error}
        </p>
      )}

      <footer className="fdc-poll__footer">
        <p className="fdc-poll__total">
          <span className="material-symbols-outlined" aria-hidden="true">
            {votesKnown ? 'how_to_vote' : 'trophy'}
          </span>
          {votesKnown
            ? t('fdc.totalVoters', {
                defaultValue: '{{count}} total voters',
                count: statistics.totalVoters ?? 0,
              })
            : t('fdc.winnerOnly', { defaultValue: 'Only the winner of this FDC is known; the vote counts were lost.' })}
        </p>

        {externalTotal > 0 && (
          <p className="fdc-note">
            {t('fdc.external.included', {
              defaultValue: 'Includes {{count}} votes from {{sources}}.',
              count: externalTotal,
              sources: poll.externalVotes.map((source) => source.label).join(', '),
            })}
          </p>
        )}

        {running && !account.loading && (
          <p className="fdc-note">
            {poll.live === false
              ? t('fdc.offline', {
                  defaultValue:
                    'Live data is unavailable right now, so voting is paused. You can still vote on Discord.',
                })
              : !account.authenticated
                ? LOGIN_AVAILABLE
                  ? t('fdc.loginToVote', {
                      defaultValue:
                        'Log in with the login button to vote here, or react on Discord.',
                    })
                  : t('fdc.loginUnavailable', {
                      defaultValue:
                        'Website login is currently unavailable, so vote by reacting on Discord.',
                    })
                : !poll.viewer?.canVote
                  ? t('fdc.cannotVote', {
                      defaultValue: 'This account cannot vote.',
                    })
                  : t('fdc.voteSynced', {
                      defaultValue: 'Votes here and on Discord are synced.',
                    })}
          </p>
        )}

        {Array.isArray(poll.voters) ? (
          <VoterList voters={poll.voters} options={poll.options} />
        ) : (
          !account.loading &&
          !account.authenticated && (
            <p className="fdc-note">
              {t('fdc.votersPrivate', {
                defaultValue:
                  'Voter identities are only available to logged-in users.',
              })}
            </p>
          )
        )}
      </footer>
    </article>
  )
}
