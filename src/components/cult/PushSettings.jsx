import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { disablePush, enablePush, loadPushDevices, pushStatus, PUSH_EVENT, removePushDevice, sendTestPush, thisPushDevice } from '/src/lib/push'
import { isNativeApp } from '/src/lib/native'

/*
 * Settings → Notifications: push on this device (browser or app) and the
 * list of devices that get them. Which kinds are pushed is the "Push"
 * switch of each category (CultSettings.jsx).
 */

const formatDate = (value, language) => {
  if (!value) return ''
  try {
    return new Date(value).toLocaleDateString(language, { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return ''
  }
}

export default function PushSettings() {
  const { t, i18n } = useTranslation('settings')
  const [status, setStatus] = useState(null)
  const [devices, setDevices] = useState([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null) // { tone, text }

  const refresh = useCallback(async () => {
    const [next, list] = await Promise.all([pushStatus().catch(() => ({ supported: false, reason: 'browser' })), loadPushDevices().catch(() => ({ devices: [] }))])
    setStatus(next)
    setDevices(list.devices ?? [])
  }, [])

  useEffect(() => {
    refresh()
    window.addEventListener(PUSH_EVENT, refresh)
    return () => window.removeEventListener(PUSH_EVENT, refresh)
  }, [refresh])

  const act = async (work, success) => {
    setBusy(true)
    setMessage(null)
    try {
      await work()
      if (success) setMessage({ tone: 'ok', text: success })
    } catch (error) {
      const code = error?.code
      const text =
        code === 'denied'
          ? t(isNativeApp ? 'notify.pushDeniedApp' : 'notify.pushDenied')
          : code === 'server' || code === 'app' || code === 'browser' || code === 'install'
            ? t(`notify.pushReason.${code}`)
            : error?.status === 409
              ? t('notify.pushTestNone')
              : t('notify.pushFailed', { error: error?.message || '?' })
      setMessage({ tone: 'error', text })
    } finally {
      setBusy(false)
      refresh()
    }
  }

  if (!status) return <p className="push-settings__hint">{t('notify.pushChecking')}</p>

  const here = thisPushDevice()
  return (
    <div className="push-settings">
      <div className="push-settings__device">
        <span className="material-symbols-outlined push-settings__icon" aria-hidden="true">
          {status.enabled ? 'notifications_active' : status.supported ? 'notifications_off' : 'block'}
        </span>
        <span className="push-settings__text">
          <strong>{t(isNativeApp ? 'notify.pushThisApp' : 'notify.pushThisBrowser')}</strong>
          <small>
            {!status.supported
              ? t(`notify.pushReason.${status.reason}`)
              : status.enabled
                ? t('notify.pushOn')
                : status.permission === 'denied'
                  ? t(isNativeApp ? 'notify.pushDeniedApp' : 'notify.pushDenied')
                  : t('notify.pushOff')}
          </small>
        </span>
        {status.supported && (
          <span className="push-settings__actions">
            {status.enabled && (
              <button type="button" className="members-button members-button--quiet" disabled={busy} onClick={() => act(sendTestPush, t('notify.pushTestSent'))}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  send
                </span>
                {t('notify.pushTest')}
              </button>
            )}
            <button
              type="button"
              className={`members-button${status.enabled ? ' members-button--quiet' : ''}`}
              disabled={busy || (!status.enabled && status.permission === 'denied')}
              aria-pressed={status.enabled}
              onClick={() => act(status.enabled ? disablePush : enablePush, status.enabled ? null : t('notify.pushEnabled'))}
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                {status.enabled ? 'notifications_off' : 'notifications_active'}
              </span>
              {status.enabled ? t('notify.pushDisable') : t('notify.pushEnable')}
            </button>
          </span>
        )}
      </div>

      {message && (
        <p className={`push-settings__message push-settings__message--${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}

      {devices.length > 0 && (
        <div className="push-settings__list">
          <h3>{t('notify.pushDevices')}</h3>
          <ul>
            {devices.map((device) => (
              <li key={device.id}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  {device.kind === 'fcm' ? 'smartphone' : 'web'}
                </span>
                <span className="push-settings__text">
                  <strong>
                    {device.label || (device.kind === 'fcm' ? t('notify.pushApp') : t('notify.pushBrowser'))}
                    {device.id === here && <em> · {t('notify.pushHere')}</em>}
                  </strong>
                  <small>
                    {t('notify.pushAdded', { date: formatDate(device.createdAt, i18n.language) })}
                    {device.lastSentAt ? ` · ${t('notify.pushLast', { date: formatDate(device.lastSentAt, i18n.language) })}` : ''}
                  </small>
                </span>
                <button
                  type="button"
                  className="push-settings__remove"
                  disabled={busy}
                  aria-label={t('notify.pushRemove', { name: device.label || '' })}
                  title={t('notify.pushRemove', { name: device.label || '' })}
                  onClick={() => act(() => (device.id === here ? disablePush() : removePushDevice(device.id)))}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">
                    delete
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
