import { useTranslation } from 'react-i18next'

import FdcPoll from './FdcPoll'
import { useUrlParam } from '/src/lib/urlState'

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
  // Editors see which FDCs still have picture-only options.
  const editor = summary.viewer?.canCreate === true

  // ?poll=<id>: the opened poll (Back returns to the list); ?manage=edit | votes on it.
  const [selectedId, setSelectedParam] = useUrlParam('poll', { push: true })
  const setSelectedId = (id) => setSelectedParam(id, { clear: ['manage'] })

  const selected = summary.polls.find(
    (poll) => poll.id === selectedId,
  )

  const {
    data: poll,
    loading,
    error,
    reload,
  } = useFdcPoll(selected, { live: isRunningPoll(selected, now) })
  const [manageParam, setManageParam] = useUrlParam('manage')
  const managing = ['edit', 'votes'].includes(manageParam) ? manageParam : false
  const setManaging = (value) => setManageParam(value === true ? 'edit' : value)

  if (selected) {
    return (
      <section className="fdc-archive">
        <button
          type="button"
          className="fdc-link"
          onClick={() => {
            setSelectedId(null)
          }}
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
          <FdcPoll
            // While editing, keep the panel open across the reload after a save.
            key={managing ? poll.id : `${poll.id}:${poll.updatedAt?.ms ?? ''}`}
            poll={poll}
            account={account}
            onVoted={reload}
            managing={managing}
            onManagingChange={setManaging}
          />
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
            'Browse previous polls and their results. Anyone can see the results; who voted is only shown to logged-in users.',
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
          {summary.polls.map((entry, index) => {
            const running = isRunningPoll(entry, now)

            return (
              <button
                type="button"
                className={`fdc-archive__entry${running ? ' fdc-archive__entry--running' : ''}`}
                key={entry.id}
                onClick={() => setSelectedId(entry.id)}
              >
                <span className="fdc-archive__index" aria-hidden="true">
                  #{(summary.totalFdcCount ?? summary.polls.length) - index}
                </span>

                <span className="fdc-archive__text">
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

                {editor && entry.pictureOnly > 0 && (
                  <span
                    className="fdc-todo-dot"
                    title={t('fdc.migrate.left', { count: entry.pictureOnly })}
                    aria-label={t('fdc.migrate.left', { count: entry.pictureOnly })}
                  >
                    !
                  </span>
                )}

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
