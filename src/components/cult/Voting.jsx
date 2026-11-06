import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ACCOUNT_API_URL } from '../../lib/account'

import {
  isRunningPoll,
  useFdcClock,
  useFdcPoll,
  useFdcSummary,
} from '../../lib/fdc'

import FdcPoll from './FdcPoll'
import FdcArchive from './FdcArchive'

import '../../styles/fdc.css'

export default function Cult() {
  const { t } = useTranslation('voting')

  const [displayName, setDisplayName] = useState(null)
  const [authenticated, setAuthenticated] = useState(false)
  const [accountLoading, setAccountLoading] = useState(true)
  const [showArchive, setShowArchive] = useState(false)

  const now = useFdcClock()

  const {
    data: summary,
    loading: summaryLoading,
    error: summaryError,
  } = useFdcSummary()

  const currentEntry = summary?.polls.find((poll) =>
    isRunningPoll(poll, now),
  )

  const {
    data: currentPoll,
    loading: pollLoading,
    error: pollError,
  } = useFdcPoll(currentEntry)

  useEffect(() => {
    const controller = new AbortController()

    async function loadCurrentUser() {
      try {
        const response = await fetch(
          `${ACCOUNT_API_URL}/auth/me`,
          {
            credentials: 'include',
            signal: controller.signal,
            cache: 'no-store',
          },
        )

        if (!response.ok) {
          return
        }

        const data = await response.json()

        if (controller.signal.aborted) {
          return
        }

        setAuthenticated(data.authenticated === true)

        if (data.authenticated && data.user?.displayName) {
          setDisplayName(data.user.displayName)
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error(
            'Could not load current account:',
            error,
          )
        }
      } finally {
        if (!controller.signal.aborted) {
          setAccountLoading(false)
        }
      }
    }

    loadCurrentUser()

    return () => {
      controller.abort()
    }
  }, [])

  const account = {
    loading: accountLoading,
    authenticated,
    displayName,
  }

  return (
    <div id="card" className="card fdc">
      {showArchive && summary ? (
        <FdcArchive
          summary={summary}
          account={account}
          onBack={() => setShowArchive(false)}
        />
      ) : (
        <>
          <header className="fdc-section-header">
            <h3>
              {t('fdc.sectionTitle', {
                defaultValue: 'Friday Dress Code',
              })}
            </h3>

            <button
              type="button"
              className="fdc-link"
              onClick={() => setShowArchive(true)}
              disabled={!summary}
              aria-label={t('fdc.viewArchive', {
                defaultValue: 'View FDC archive',
              })}
            >
              <span
                className="material-symbols-outlined"
                aria-hidden="true"
              >
                archive
              </span>

              {t('fdc.archive', {
                defaultValue: 'View Archive',
              })}
            </button>
          </header>

          {summaryLoading ? (
            <p role="status">
              {t('fdc.loading', {
                defaultValue: 'Loading FDC polls…',
              })}
            </p>
          ) : summaryError ? (
            <p role="alert" className="fdc-error">
              {t('fdc.summaryError', {
                defaultValue:
                  'Could not load FDC polls. Please try again later.',
              })}
            </p>
          ) : !currentEntry ? (
            <p className="fdc-empty">
              {t('fdc.noCurrentPoll', {
                defaultValue:
                  'There is no current FDC poll.',
              })}
            </p>
          ) : pollLoading ? (
            <p role="status">
              {t('fdc.loadingPoll', {
                defaultValue: 'Loading poll…',
              })}
            </p>
          ) : pollError ? (
            <p role="alert" className="fdc-error">
              {t('fdc.loadError', {
                defaultValue:
                  'Could not load this poll.',
              })}
            </p>
          ) : currentPoll ? (
            <FdcPoll
              poll={currentPoll}
              account={account}
            />
          ) : null}
        </>
      )}
    </div>
  )
}
