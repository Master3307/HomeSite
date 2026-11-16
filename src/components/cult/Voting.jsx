import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  isRunningPoll,
  useFdcAccount,
  useFdcClock,
  useFdcPoll,
  useFdcSummary,
} from '../../lib/fdc'

import FdcPoll from './FdcPoll'
import FdcArchive from './FdcArchive'
import FdcMigration from './FdcMigration'
import { loadMigrationStatus } from '../../lib/fdcRecycle'
import FdcCreate from './FdcCreate'
import FdcDrafts from './FdcDrafts'
import FdcManualEntry from './FdcManualEntry'
import { Link } from 'react-router'
import { siteConfig } from '/src/lib/siteConfig'
import { useScrollToParam, useUrlParam } from '/src/lib/urlState'

import '../../styles/fdc.css'

const VIEWS = ['archive', 'create', 'manual', 'migrate']
const MANAGE_MODES = ['edit', 'votes']

function PollLoader({ entry, account, live, onVoted }) {
  const { t } = useTranslation('voting')
  const { data, loading, error, reload } = useFdcPoll(entry, { live })
  // ?manage=edit | votes: the poll's edit / outside-votes panel (only works for those allowed to).
  const [manageParam, setManageParam] = useUrlParam('manage')
  const managing = MANAGE_MODES.includes(manageParam) ? manageParam : false
  const setManaging = (value) => setManageParam(value === true ? 'edit' : value)

  if (loading) {
    return (
      <p className="fdc-placeholder" role="status">
        {t('fdc.loadingPoll', { defaultValue: 'Loading poll…' })}
      </p>
    )
  }

  if (error || !data) {
    return (
      <p role="alert" className="fdc-error">
        {t('fdc.loadError', { defaultValue: 'Could not load this poll.' })}
      </p>
    )
  }

  return (
    <FdcPoll
      // A fresh poll resets vote state; while managing, keep the panel's state.
      key={managing ? data.id : `${data.id}:${data.updatedAt?.ms ?? ''}`}
      poll={data}
      account={account}
      managing={managing}
      onManagingChange={setManaging}
      onVoted={() => {
        reload()
        onVoted?.()
      }}
    />
  )
}

/** Friday Dress Code: current poll, archive and (for moderators) creation. */
export default function Voting() {
  const { t } = useTranslation('voting')

  // ?fdc=archive | create | manual (current poll without it). Back returns to the previous view.
  const [viewParam, setViewParam] = useUrlParam('fdc', { push: true })
  const view = VIEWS.includes(viewParam) ? viewParam : 'current'
  const setView = (next) => setViewParam(next === 'current' ? null : next, { clear: ['poll', 'manage', 'bin', 'folder', 'design', 'tab', 'cat'] })
  useScrollToParam('fdc', ['fdc', 'poll', 'manage', 'bin', 'folder', 'design', 'cat'])
  const account = useFdcAccount()
  const now = useFdcClock(30_000)

  const {
    data: summary,
    loading: summaryLoading,
    error: summaryError,
    reload: reloadSummary,
  } = useFdcSummary()

  const currentEntry = summary?.polls.find((poll) => isRunningPoll(poll, now))
  const latestEntry = summary?.polls[0]
  const canCreate = summary?.viewer?.canCreate === true

  // FDC options that are still pictures: "Migration" (editors) / "Contribute" (members).
  const [migration, setMigration] = useState(null)
  const reloadMigration = useCallback(() => {
    loadMigrationStatus()
      .then(setMigration)
      .catch(() => setMigration(null))
  }, [])
  useEffect(() => {
    if (account.user) reloadMigration()
  }, [account.user, reloadMigration])
  const showMigrate = view === 'migrate' && migration?.loggedIn

  const showCreate = (view === 'create' || view === 'manual') && canCreate
  const showArchive = view === 'archive' && summary

  let content

  if (showMigrate) {
    content = <FdcMigration
        onBack={() => setView('current')}
        onChanged={() => {
          reloadMigration()
          reloadSummary()
        }}
      />
  } else if (showCreate && view === 'manual') {
    content = (
      <FdcManualEntry
        onCancel={() => setView('current')}
        onCreated={() => reloadSummary()}
        viewerDiscordId={account.user?.discordUserId}
      />
    )
  } else if (showCreate) {
    content = (
      <FdcCreate
        onCancel={() => setView('current')}
        onCreated={() => reloadSummary()}
        viewerDiscordId={account.user?.discordUserId}
      />
    )
  } else if (showArchive) {
    content = (
      <FdcArchive
        summary={summary}
        account={account}
        onBack={() => setView('current')}
      />
    )
  } else {
    content = (
      <>
        {canCreate && <FdcDrafts onSent={reloadSummary} />}

        {summary?.viewer?.local && (
          <p className="fdc-note fdc-local-note">
            <span className="material-symbols-outlined" aria-hidden="true">cloud_off</span>
            {t('fdc.localAdmin', {
              defaultValue:
                'Local admin session: new polls are saved on this device and can be sent once the server is reachable.',
            })}
          </p>
        )}

        {summaryLoading ? (
          <p className="fdc-placeholder" role="status">
            {t('fdc.loading', { defaultValue: 'Loading FDC polls…' })}
          </p>
        ) : summaryError ? (
          <p role="alert" className="fdc-error">
            {t('fdc.summaryError', {
              defaultValue: 'Could not load FDC polls. Please try again later.',
            })}
          </p>
        ) : currentEntry ? (
          <PollLoader
            entry={currentEntry}
            account={account}
            live
            onVoted={reloadSummary}
          />
        ) : (
          <>
            <p className="fdc-empty">
              <span className="material-symbols-outlined" aria-hidden="true">
                checkroom
              </span>
              {t('fdc.noCurrentPoll', { defaultValue: 'There is no running FDC poll right now.' })}
            </p>

            {latestEntry && (
              <>
                <h3 className="fdc-subheading">
                  {t('fdc.lastPoll', { defaultValue: 'Last FDC' })}
                </h3>
                <PollLoader entry={latestEntry} account={account} />
              </>
            )}
          </>
        )}
      </>
    )
  }

  return (
    <section id="fdc" className="cult-section fdc" aria-labelledby="fdc-title">
      <div className="cult-section__aside">
        <h2 id="fdc-title" className="cult-section__title">
          {t('fdc.sectionTitle', { defaultValue: 'Friday Dress Code' })}
        </h2>

        <p>
          {t('fdc.about', {
            defaultValue: 'Every Thursday, vote for your favorite Friday Dress Code idea!',
          })}
        </p>
        <p>
          {t('fdc.aboutFriday', {
            defaultValue:
              'On Friday, the winner will be announced and you can make your cat look according to it!',
          })}
        </p>

        {!showCreate && !showArchive && !showMigrate && (
          <div className="fdc-section-header__actions">
            <button
              type="button"
              className="fdc-button fdc-button--ghost fdc-button--small"
              onClick={() => setView('archive')}
              disabled={!summary}
              aria-label={t('fdc.viewArchive', { defaultValue: 'View FDC archive' })}
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                archive
              </span>
              {t('fdc.archive', { defaultValue: 'Archive' })}
            </button>

            {canCreate && (
              <button
                type="button"
                className="fdc-button fdc-button--small"
                onClick={() => setView('create')}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  add
                </span>
                {t('fdc.newPoll', { defaultValue: 'New FDC' })}
              </button>
            )}

            {migration?.loggedIn && migration.remaining > 0 && (
              <button
                type="button"
                className="fdc-button fdc-button--ghost fdc-button--small fdc-migrate-button"
                onClick={() => setView('migrate')}
                title={t('fdc.migrate.left', { count: migration.remaining })}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  {migration.editor ? 'move_up' : 'volunteer_activism'}
                </span>
                {migration.editor ? t('fdc.migrate.title', { defaultValue: 'Migration' }) : t('fdc.migrate.contributeTitle', { defaultValue: 'Contribute' })}
                <span className="fdc-migrate-button__count">{migration.remaining}</span>
              </button>
            )}

            {canCreate && (
              <button
                type="button"
                className="fdc-button fdc-button--ghost fdc-button--small"
                onClick={() => setView('manual')}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  history_edu
                </span>
                {t('fdc.manual.open', { defaultValue: 'Add past FDC' })}
              </button>
            )}

            {/* The admin account, or the site owner logged in with Discord. */}
            {(account.user?.isAdminSession || (siteConfig.ownerDiscordId && account.user?.discordUserId === siteConfig.ownerDiscordId)) && (
              <Link className="fdc-button fdc-button--ghost fdc-button--small" to="/hub/settings">
                <span className="material-symbols-outlined" aria-hidden="true">
                  admin_panel_settings
                </span>
                {t('fdc.hub', { defaultValue: 'Hub' })}
              </Link>
            )}

            {canCreate && (
              <Link className="fdc-button fdc-button--ghost fdc-button--small" to="/activity">
                <span className="material-symbols-outlined" aria-hidden="true">
                  manage_history
                </span>
                {t('fdc.activityLog', { defaultValue: 'Activity log' })}
              </Link>
            )}
          </div>
        )}
      </div>

      <div className="cult-section__main">{content}</div>
    </section>
  )
}
