import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DesignPreview } from '../bongo/BongoRender'
import { useCatalog } from '../../lib/bongo'
import { pollDate } from '../../lib/fdc'
import { decideSuggestion, designMigrated, loadMigration, migrationDesignUrl, migrationImageUrl, suggestMigratedDesign } from '../../lib/fdcRecycle'
import { useUrlParam } from '../../lib/urlState'

const DesignEditor = lazy(() => import('../bongo/DesignEditor'))

/*
 * ?fdc=migrate: moving every FDC option that is still a picture (archive,
 * running polls, the recycling bin) to a designed cat. Editors design a cat
 * right away; members suggest a design that waits for an editor (the
 * "Suggestions" tab). Every cat shows its old picture next to the designer.
 * The tab and the open cat are in the address.
 */

function Emoji({ emoji }) {
  if (!emoji) return null
  if (emoji.id) return <img className="fdc-migrate__emoji" src={`https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'webp'}?size=32`} alt={emoji.name ?? ''} />
  return emoji.display ? <span className="fdc-migrate__emoji">{emoji.display}</span> : null
}

export default function FdcMigration({ onBack, onChanged }) {
  const { t, i18n } = useTranslation('voting')
  const { catalog, loading: catalogLoading } = useCatalog()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [tabParam, setTab] = useUrlParam('tab')
  const [openId, setOpenId] = useUrlParam('cat')
  // A suggestion an editor wants to change before approving it.
  const [reviewing, setReviewing] = useState(null)
  const [note, setNote] = useState('')

  const reload = useCallback(
    () =>
      loadMigration()
        .then((value) => {
          setData(value)
          setError(null)
        })
        .catch((reason) => setError(reason.message)),
    [],
  )
  useEffect(() => {
    reload()
  }, [reload])

  if (error && !data) return <p className="fdc-error" role="alert">{error}</p>
  if (!data || catalogLoading) return <p className="fdc-placeholder" role="status">{t('fdc.loading', { defaultValue: 'Loading…' })}</p>

  const editor = data.editor
  const tab = ['done', 'suggestions'].includes(tabParam) && (tabParam !== 'suggestions' || editor) ? tabParam : 'todo'
  const open = data.remaining.find((item) => item.id === openId) ?? null
  const mySuggestion = (item) => data.suggestions.find((entry) => entry.itemId === item.id && entry.mine)
  const percent = data.total ? Math.round((data.migrated / data.total) * 100) : 100
  const name = (item) => item.description || t('fdc.create.option', { defaultValue: 'Option {{number}}', number: item.optionNumber })
  // Where the cat is: an FDC's option, or only in the recycling bin (its FDC is gone).
  const where = (item) =>
    item.source === 'bin'
      ? t('fdc.migrate.inBin', { defaultValue: 'Recycling bin · {{date}}', date: pollDate(item.date, i18n.language) })
      : t('fdc.migrate.inPoll', { defaultValue: 'FDC {{date}} · option {{number}}', date: pollDate(item.date, i18n.language), number: item.optionNumber })
  const itemOf = (id) => data.remaining.find((item) => item.id === id) ?? data.done.find((item) => item.id === id)

  async function run(task, message) {
    setBusy(true)
    setNotice(null)
    try {
      await task()
      setNotice(message)
      await reload()
      onChanged?.()
    } catch (reason) {
      setError(reason.message)
    } finally {
      setBusy(false)
    }
  }

  async function saveDesign(item, design) {
    await run(async () => {
      if (editor) await designMigrated(item.id, design)
      else await suggestMigratedDesign(item.id, design, note)
      setOpenId(null)
      setNote('')
    }, editor ? t('fdc.migrate.saved', { defaultValue: '"{{name}}" is a designed cat now.', name: name(item) }) : t('fdc.migrate.suggested', { defaultValue: 'Thanks! An editor will look at your design.' }))
  }

  const tabs = [
    ['todo', 'pending_actions', t('fdc.migrate.todo', { defaultValue: 'To do' }), data.remaining.length],
    ['done', 'task_alt', t('fdc.migrate.done', { defaultValue: 'Designed' }), data.migrated],
    ...(editor ? [['suggestions', 'how_to_vote', t('fdc.migrate.suggestions', { defaultValue: 'Suggestions' }), data.suggestions.length]] : []),
  ]

  return (
    <div className="fdc-migrate">
      <header className="fdc-migrate__head">
        <button type="button" className="fdc-button fdc-button--ghost fdc-button--small" onClick={onBack}>
          <span className="material-symbols-outlined" aria-hidden="true">
            arrow_back
          </span>
          {t('fdc.back', { defaultValue: 'Back' })}
        </button>
        <div>
          <h3>{editor ? t('fdc.migrate.title', { defaultValue: 'Migration' }) : t('fdc.migrate.contributeTitle', { defaultValue: 'Contribute' })}</h3>
          <p>
            {editor
              ? t('fdc.migrate.introEditor', { defaultValue: 'Old FDC options are pictures. Give every one of them a design, using its old picture as a guide: the archive then shows the designed cat (the picture stays), and recycled cats can be used again. Once all are done, this disappears.' })
              : t('fdc.migrate.introMember', { defaultValue: 'Old FDC options are pictures. Help turn them into designed cats: pick one, rebuild it in the designer and send it in. An editor checks every suggestion, nothing changes before that.' })}
          </p>
        </div>
      </header>

      <div className="fdc-migrate__progress" role="group" aria-label={t('fdc.migrate.progress', { defaultValue: 'Progress' })}>
        <div className="fdc-migrate__bar" role="progressbar" aria-valuemin={0} aria-valuemax={data.total} aria-valuenow={data.migrated}>
          <span style={{ width: `${percent}%` }} />
        </div>
        <p>
          {t('fdc.migrate.counts', { defaultValue: '{{migrated}} of {{total}} designed, {{remaining}} left', migrated: data.migrated, total: data.total, remaining: data.remaining.length })}
        </p>
      </div>

      <div className="fdc-migrate__tabs" role="tablist">
        {tabs.map(([id, icon, label, count]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id === 'todo' ? null : id, { clear: ['cat'] })}>
            <span className="material-symbols-outlined" aria-hidden="true">
              {icon}
            </span>
            {label}
            <span className="fdc-migrate__count">{count}</span>
          </button>
        ))}
      </div>

      {notice && (
        <p className="fdc-migrate__notice" role="status">
          <span className="material-symbols-outlined" aria-hidden="true">
            check_circle
          </span>
          {notice}
        </p>
      )}
      {error && data && <p className="fdc-error" role="alert">{error}</p>}
      {!catalog && <p className="fdc-note">{t('fdc.migrate.noAssets', { defaultValue: 'The Bongo Cat items are not imported on this server yet, so nothing can be designed.' })}</p>}

      {tab === 'todo' &&
        (data.remaining.length ? (
          <ul className="fdc-migrate__grid">
            {data.remaining.map((item) => {
              const waiting = mySuggestion(item)
              return (
                <li key={item.id} className="fdc-migrate__card">
                  <span className="fdc-migrate__image">
                    <img src={migrationImageUrl(item)} alt="" loading="lazy" />
                    <span className="recycle-item__todo" aria-hidden="true">
                      !
                    </span>
                  </span>
                  <span className="fdc-migrate__text">
                    <strong>
                      <Emoji emoji={item.emoji} /> {name(item)}
                    </strong>
                    <small>
                      {where(item)}
                      {item.won && ` · ${t('fdc.winner', { defaultValue: 'Winner' })}`}
                      {item.running && ` · ${t('fdc.migrate.running', { defaultValue: 'running now' })}`}
                      {editor && item.suggestions > 0 && ` · ${t('fdc.migrate.suggestionCount', { count: item.suggestions })}`}
                    </small>
                  </span>
                  <button type="button" className="fdc-button fdc-button--small" disabled={!catalog || busy} onClick={() => setOpenId(item.id)}>
                    <span className="material-symbols-outlined" aria-hidden="true">
                      {editor ? 'brush' : waiting ? 'edit' : 'volunteer_activism'}
                    </span>
                    {editor ? t('fdc.migrate.design', { defaultValue: 'Design it' }) : waiting ? t('fdc.migrate.changeSuggestion', { defaultValue: 'Change my suggestion' }) : t('fdc.migrate.suggest', { defaultValue: 'Suggest a design' })}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="fdc-empty">
            <span className="material-symbols-outlined" aria-hidden="true">
              celebration
            </span>
            {t('fdc.migrate.allDone', { defaultValue: 'Every FDC option is a designed cat now. Thank you!' })}
          </p>
        ))}

      {tab === 'done' &&
        (data.done.length ? (
          <ul className="fdc-migrate__grid">
            {data.done.map((item) => (
              <li key={item.id} className="fdc-migrate__card fdc-migrate__card--done">
                <span className="fdc-migrate__pair">
                  <img src={migrationImageUrl(item)} alt="" loading="lazy" />
                  <span className="material-symbols-outlined" aria-hidden="true">
                    arrow_forward
                  </span>
                  <img src={migrationDesignUrl(item)} alt="" loading="lazy" />
                </span>
                <span className="fdc-migrate__text">
                  <strong>
                    <Emoji emoji={item.emoji} /> {name(item)}
                  </strong>
                  <small>
                    {where(item)}
                    {item.migratedBy && ` · ${t('fdc.migrate.designedBy', { defaultValue: 'Designed by {{name}}', name: item.migratedBy })}`}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="fdc-empty">{t('fdc.migrate.noneDone', { defaultValue: 'No designed cats yet.' })}</p>
        ))}

      {tab === 'suggestions' &&
        (data.suggestions.length ? (
          <ul className="fdc-migrate__suggestions">
            {data.suggestions.map((entry) => {
              const item = itemOf(entry.itemId)
              if (!item) return null
              return (
                <li key={entry.id} className="fdc-migrate__suggestion">
                  <div className="fdc-migrate__compare">
                    <figure>
                      <img src={migrationImageUrl(item)} alt="" loading="lazy" />
                      <figcaption>{t('fdc.migrate.oldPicture', { defaultValue: 'The old picture' })}</figcaption>
                    </figure>
                    <figure>
                      {catalog && <DesignPreview catalog={catalog} design={entry.design} play />}
                      <figcaption>{t('fdc.migrate.suggestedBy', { defaultValue: 'Suggested by {{name}}', name: entry.by ?? t('fdc.migrate.someone', { defaultValue: 'someone' }) })}</figcaption>
                    </figure>
                  </div>
                  <div className="fdc-migrate__suggestion-side">
                    <strong>
                      <Emoji emoji={item.emoji} /> {name(item)}
                    </strong>
                    {entry.note && <blockquote>{entry.note}</blockquote>}
                    <div className="fdc-migrate__actions">
                      <button type="button" className="fdc-button fdc-button--small" disabled={busy} onClick={() => run(() => decideSuggestion(entry.id, true), t('fdc.migrate.approved', { defaultValue: 'Approved.' }))}>
                        <span className="material-symbols-outlined" aria-hidden="true">
                          check
                        </span>
                        {t('fdc.migrate.approve', { defaultValue: 'Approve' })}
                      </button>
                      <button type="button" className="fdc-button fdc-button--ghost fdc-button--small" disabled={busy || !catalog} onClick={() => setReviewing(entry)}>
                        <span className="material-symbols-outlined" aria-hidden="true">
                          edit
                        </span>
                        {t('fdc.migrate.adjust', { defaultValue: 'Adjust and approve' })}
                      </button>
                      <button type="button" className="fdc-button fdc-button--ghost fdc-button--small" disabled={busy} onClick={() => run(() => decideSuggestion(entry.id, false), t('fdc.migrate.rejected', { defaultValue: 'Rejected.' }))}>
                        <span className="material-symbols-outlined" aria-hidden="true">
                          close
                        </span>
                        {t('fdc.migrate.reject', { defaultValue: 'Reject' })}
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="fdc-empty">{t('fdc.migrate.noSuggestions', { defaultValue: 'No suggestions waiting.' })}</p>
        ))}

      {open && catalog && (
        <Suspense fallback={null}>
          <DesignEditor
            catalog={catalog}
            design={mySuggestion(open)?.design ?? open.startDesign ?? null}
            title={t('fdc.migrate.designTitle', { defaultValue: 'Design "{{name}}"', name: name(open) })}
            reference={{ src: migrationImageUrl(open), label: t('fdc.migrate.oldPicture', { defaultValue: 'The old picture' }) }}
            applyLabel={editor ? t('fdc.migrate.save', { defaultValue: 'Save design' }) : t('fdc.migrate.send', { defaultValue: 'Send suggestion' })}
            busy={busy}
            extra={
              !editor && (
                <label className="fdc-migrate__note">
                  <span>{t('fdc.migrate.noteLabel', { defaultValue: 'A note for the editors (optional)' })}</span>
                  <input className="fdc-input" maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} />
                </label>
              )
            }
            onCancel={() => setOpenId(null)}
            onApply={(design) => saveDesign(open, design)}
          />
        </Suspense>
      )}

      {reviewing && catalog && (
        <Suspense fallback={null}>
          <DesignEditor
            catalog={catalog}
            design={reviewing.design}
            title={t('fdc.migrate.adjustTitle', { defaultValue: 'Adjust the suggestion' })}
            reference={{ src: migrationImageUrl(itemOf(reviewing.itemId)), label: t('fdc.migrate.oldPicture', { defaultValue: 'The old picture' }) }}
            applyLabel={t('fdc.migrate.approve', { defaultValue: 'Approve' })}
            busy={busy}
            onCancel={() => setReviewing(null)}
            onApply={(design) =>
              run(async () => {
                await decideSuggestion(reviewing.id, true, design)
                setReviewing(null)
              }, t('fdc.migrate.approved', { defaultValue: 'Approved.' }))
            }
          />
        </Suspense>
      )}
    </div>
  )
}
