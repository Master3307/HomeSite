import { useTranslation } from 'react-i18next'

import {
  formatPollDate,
  isRunningPoll,
  publicPollImage,
  useFdcClock,
} from '../../lib/fdc'

export default function FdcPoll({ poll, account }) {
  const { t, i18n } = useTranslation('voting')
  const now = useFdcClock()

  const running = isRunningPoll(poll, now)
  const statistics = poll.statistics

  const winningNumbers =
    statistics.winningOptionNumbers ?? []

  const showWinners = poll.status === 'closed'

  const status = running
    ? t('fdc.running', {
        defaultValue: 'Running',
      })
    : poll.status === 'closed'
      ? t('fdc.ended', {
          defaultValue: 'Ended',
        })
      : poll.status === 'failed'
        ? t('fdc.failed', {
            defaultValue: 'Failed',
          })
        : t('fdc.notAcceptingVotes', {
            defaultValue: 'Not accepting votes',
          })

  return (
    <article className="fdc-poll">
      <header className="fdc-poll__header">
        <div>
          <h3 className="fdc-poll__title">
            {t('fdc.title', {
              defaultValue: 'Friday Dress Code',
            })}
          </h3>

          <p className="fdc-poll__date">
            {formatPollDate(
              poll.endsAt,
              i18n.language,
            )}
          </p>
        </div>

        <span
          className={`fdc-status ${
            running ? 'fdc-status--running' : ''
          }`}
        >
          {status}
        </span>
      </header>

      <div className="fdc-options">
        {poll.options.map((option) => {
          const stats = statistics.options?.find(
            (entry) =>
              entry.optionNumber === option.number,
          )

          const votes = stats?.votes ?? 0

          const percentage = Math.min(
            100,
            Math.max(
              0,
              Number(stats?.percentage) || 0,
            ),
          )

          const winner =
            showWinners &&
            winningNumbers.includes(option.number)

          return (
            <section
              key={option.number}
              className={`fdc-option ${
                winner ? 'fdc-option--winner' : ''
              }`}
            >
              <a
                className="fdc-option__media"
                href={publicPollImage(poll, option)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('fdc.openImage', {
                  defaultValue:
                    'Open image for option {{number}}',
                  number: option.number,
                })}
              >
                <img
                  src={publicPollImage(poll, option)}
                  alt={option.description}
                  loading="lazy"
                  decoding="async"
                  width="640"
                  height="400"
                />
              </a>

              <div className="fdc-option__body">
                <div className="fdc-option__heading">
                  <span className="fdc-option__number">
                    {option.number}
                  </span>

                  <span className="fdc-option__emoji">
                    {option.emoji?.display}
                  </span>

                  {winner && (
                    <span className="fdc-option__winner">
                      {statistics.isTie
                        ? t('fdc.tiedWinner', {
                            defaultValue: 'Tied winner',
                          })
                        : t('fdc.winner', {
                            defaultValue: 'Winner',
                          })}
                    </span>
                  )}
                </div>

                <p className="fdc-option__description">
                  {option.description}
                </p>

                <div className="fdc-option__counts">
                  <span>
                    {t('fdc.votes', {
                      count: votes,
                      defaultValue: '{{count}} vote',
                      defaultValue_other:
                        '{{count}} votes',
                    })}
                  </span>

                  <span>
                    {percentage.toLocaleString(
                      i18n.language,
                      {
                        maximumFractionDigits: 1,
                      },
                    )}
                    %
                  </span>
                </div>

                <div
                  className="fdc-option__progress"
                  role="progressbar"
                  aria-label={option.description}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percentage}
                >
                  <span
                    style={{
                      width: `${percentage}%`,
                    }}
                  />
                </div>

                {running && (
                  <button
                    type="button"
                    className="fdc-option__vote"
                    disabled
                  >
                    {account.authenticated
                      ? t('fdc.votingNotConnected', {
                          defaultValue:
                            'Website voting coming soon',
                        })
                      : t('fdc.loginToVoteButton', {
                          defaultValue:
                            'Log in to vote',
                        })}
                  </button>
                )}
              </div>
            </section>
          )
        })}
      </div>

      <footer className="fdc-poll__footer">
        <p>
          {t('fdc.totalVoters', {
            defaultValue:
              '{{count}} total voters',
            count: statistics.totalVoters ?? 0,
          })}
        </p>

        {running && (
          <p className="fdc-note">
            {account.loading
              ? t('fdc.checkingLogin', {
                  defaultValue:
                    'Checking login…',
                })
              : account.authenticated
                ? t('fdc.loggedInVotingSoon', {
                    defaultValue:
                      'You are logged in. Website voting will be available when the server integration is connected.',
                  })
                : t('fdc.loginToVote', {
                    defaultValue:
                      'Log in using the login button to vote. You can view the poll without logging in.',
                  })}
          </p>
        )}

        {!account.loading &&
          !account.authenticated && (
            <p className="fdc-note">
              {t('fdc.votersPrivate', {
                defaultValue:
                  'Voter identities are only available to logged-in users.',
              })}
            </p>
          )}

        {!account.loading &&
          account.authenticated && (
            <p className="fdc-note">
              {t('fdc.voterDetailsSoon', {
                defaultValue:
                  'Voter details will be available through the authenticated server integration.',
              })}
            </p>
          )}
      </footer>
    </article>
  )
}
