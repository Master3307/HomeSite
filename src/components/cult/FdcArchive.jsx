import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import FdcPoll from './FdcPoll'
import { useUrlParam } from '/src/lib/urlState'
import { customEmojiUrl } from '/src/lib/emoji'

import {
  formatPollDate,
  isRunningPoll,
  useFdcClock,
  useFdcPoll,
} from '../../lib/fdc'

/* Lower case without accents, so "cafe" finds "Café". */
const fold = (text) =>
  String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

/*
 * The archive search (everyone): every word has to appear in the FDC's
 * number (#12), its date or one of its options (description, emoji).
 * Returns the matching options so the list can show what was found.
 */
function searchPolls(polls, query, total, language) {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return null
  return polls.flatMap((entry, index) => {
    const number = `#${total - index}`
    const head = fold(`${number} ${formatPollDate(entry.endsAt, language)}`)
    const options = (entry.options ?? []).map((option) => ({ option, text: fold(`${option.description} ${option.emoji?.display ?? ''}`) }))
    const all = `${head} ${options.map((item) => item.text).join(' ')}`
    if (!words.every((word) => all.includes(word))) return []
    const hits = options.filter((item) => words.some((word) => item.text.includes(word))).map((item) => item.option)
    return [{ entry, index, hits }]
  })
}

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

  // ?q=…: the archive search (kept in the address, so Back returns to the results).
  const [query = '', setQueryParam] = useUrlParam('q')
  const [draft, setDraft] = useState(query ?? '')
  const total = summary.totalFdcCount ?? summary.polls.length
  const results = useMemo(
    () => searchPolls(summary.polls, draft, total, i18n.language),
    [summary.polls, draft, total, i18n.language],
  )
  const setQuery = (value) => {
    setDraft(value)
    setQueryParam(value.trim() ? value : null)
  }

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

      {summary.polls.length > 0 && (
        <label className="fdc-archive__search">
          <span className="material-symbols-outlined" aria-hidden="true">
            search
          </span>
          <input
            type="search"
            value={draft}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('fdc.searchPlaceholder', {
              defaultValue: 'Search past FDCs: themes, emoji, dates, #number',
            })}
            aria-label={t('fdc.searchLabel', { defaultValue: 'Search the FDC archive' })}
            enterKeyHint="search"
          />
          {results && (
            <span className="fdc-archive__count" role="status">
              {t('fdc.searchCount', { defaultValue: '{{count}} found', count: results.length })}
            </span>
          )}
        </label>
      )}

      {summary.polls.length === 0 ? (
        <p>
          {t('fdc.archiveEmpty', {
            defaultValue: 'No archived polls yet.',
          })}
        </p>
      ) : results && results.length === 0 ? (
        <p className="fdc-archive__none">
          {t('fdc.searchEmpty', {
            defaultValue: 'No FDC matches "{{query}}".',
            query: draft.trim(),
          })}
        </p>
      ) : (
        <div className="fdc-archive__list">
          {(results ?? summary.polls.map((entry, index) => ({ entry, index, hits: [] }))).map(({ entry, index, hits }) => {
            const running = isRunningPoll(entry, now)

            return (
              <button
                type="button"
                className={`fdc-archive__entry${running ? ' fdc-archive__entry--running' : ''}`}
                key={entry.id}
                onClick={() => setSelectedId(entry.id)}
              >
                <span className="fdc-archive__index" aria-hidden="true">
                  #{total - index}
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

                  {hits.length > 0 && (
                    <span className="fdc-archive__hits">
                      {hits.map((option) => (
                        <span key={option.number} className={`fdc-archive__hit${entry.winners?.includes(option.number) ? ' is-winner' : ''}`}>
                          {entry.winners?.includes(option.number) && (
                            <span className="material-symbols-outlined" aria-label={t('fdc.winner', { defaultValue: 'Winner' })}>
                              trophy
                            </span>
                          )}
                          {option.emoji?.id ? (
                            <img className="fdc-archive__emoji" src={customEmojiUrl(option.emoji, 32)} alt={option.emoji.display} loading="lazy" />
                          ) : option.emoji?.display ? (
                            `${option.emoji.display} `
                          ) : null}
                          {option.description || t('fdc.optionNumber', { defaultValue: 'Option {{number}}', number: option.number })}
                        </span>
                      ))}
                    </span>
                  )}
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
