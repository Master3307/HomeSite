import { useTranslation } from 'react-i18next'

/*
 * Shown while a page's code is still on its way (App.jsx, Suspense). It keeps
 * the page's height so nothing below jumps, and only fades in after a short
 * moment, so quick loads never flash it.
 */
/** `screen`: as tall as the screen (pages whose footer would otherwise show and then jump away). */
export default function PageLoading({ label, screen = false }) {
  const { t } = useTranslation('common')
  const text = label ?? t('loading', { defaultValue: 'Loading…' })
  return (
    <div className={`page-loading${screen ? ' page-loading--screen' : ''}`} role="status" aria-live="polite">
      <span className="page-loading__spinner" aria-hidden="true" />
      <span className="sr-only">{text}</span>
    </div>
  )
}
