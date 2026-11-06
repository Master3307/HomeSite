import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import FdcPoll from './FdcPoll'

import {
  formatPollDate,
  isRunningPoll,
  useFdcClock,
  useFdcPoll,
} from '../../lib/fdc'

export default function FdcArchive({
  summary,
  account,
  onBack,
}) {
  const { t, i18n } = useTranslation('voting')
  const now = useFdcClock()

  const [selectedId, setSelectedId] = useState(null)

  const selected = summary.polls.find(
    (poll) => poll.id === selectedId,
  )

  const {
    data: poll,
    loading,
    error,
  } = useFdcPoll(selected)

  if (selected) {
    return (
      <section className="fdc-archive">
        <button
          type="button"
          className="fdc-link"
          onClick={() => setSelectedId(null)}
        >
          <span
            className="material-symbols-outlined"
            aria-hidden="true"
          >
            arrow_back
          </span>

          {t('fdc.backToArchive', {
            defaultValue: 'Back to archive',
          })}
        </button>

        {loading && (
          <p role="status">
            {t('fdc.loadingPoll', {
              defaultValue: 'Loading poll…',
            })}
          </p>
        )}

        {error && (
          <p role="alert" className="fdc-error">
            {t('fdc.loadError', {
              defaultValue: 'Could not load this poll.',
            })}
          </p>
        )}

        {poll && (
          <FdcPoll poll={poll} account={account} />
        )}
      </section>
    )
  }

  return (
    <section className="fdc-archive">
      <header className="fdc-section-header">
        <h3>
          {t('fdc.archiveTitle', {
            defaultValue: 'FDC archive',
          })}
        </h3>

        <button
          type="button"
          className="fdc-link"
          onClick={onBack}
        >
          <span
            className="material-symbols-outlined"
            aria-hidden="true"
          >
            arrow_back
          </span>

          {t('fdc.back', {
            defaultValue: 'Back',
          })}
        </button>
      </header>

      <p className="fdc-note">
        {t('fdc.archiveIntroduction', {
          defaultValue:
            'Browse previous polls and their results. Polls are visible without logging in; voter identities are not.',
        })}
      </p>

      {summary.polls.length === 0 ? (
        <p>
          {t('fdc.archiveEmpty', {
            defaultValue: 'No archived polls yet.',
          })}
        </p>
      ) : (
        <div className="fdc-archive__list">
          {summary.polls.map((entry) => {
            const running = isRunningPoll(entry, now)

            return (
              <button
                type="button"
                className="fdc-archive__entry"
                key={entry.id}
                onClick={() => setSelectedId(entry.id)}
              >
                <span>
                  <span className="fdc-archive__date">
                    {formatPollDate(
                      entry.endsAt,
                      i18n.language,
                    )}
                  </span>

                  <span className="fdc-archive__meta">
                    {running
                      ? t('fdc.running', {
                          defaultValue: 'Running',
                        })
                      : entry.status === 'closed'
                        ? t('fdc.ended', {
                            defaultValue: 'Ended',
                          })
                        : t('fdc.notAcceptingVotes', {
                            defaultValue:
                              'Not accepting votes',
                          })}

                    {' · '}

                    {t('fdc.totalVoters', {
                      defaultValue:
                        '{{count}} total voters',
                      count: entry.totalVoters ?? 0,
                    })}
                  </span>
                </span>

                <span
                  className="material-symbols-outlined"
                  aria-hidden="true"
                >
                  chevron_right
                </span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
