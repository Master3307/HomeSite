import { useTranslation } from 'react-i18next'
import { useDashSettings } from '../../lib/dashSettings.js'

const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox'

export default function DashWidgets({ onOpenSettings }) {
  const { t } = useTranslation('dash')
  const { widgets } = useDashSettings()

  if (widgets.length === 0) {
    return (
      <section className="card dash-empty">
        <span className="material-symbols-outlined dash-empty__icon" aria-hidden="true">widgets</span>
        <p>{t('widgets.empty')}</p>
        <button type="button" onClick={onOpenSettings}>
          <span className="material-symbols-outlined" aria-hidden="true">add</span>
          {t('widgets.add')}
        </button>
      </section>
    )
  }

  return (
    <section className="dash-widgets" aria-label={t('widgets.label')}>
      {widgets.map((widget) => (
        <article
          key={widget.id}
          className={`dash-widget dash-widget--${widget.size}`}
        >
          {widget.showTitle && (
            <header className="dash-widget__head">
              <span className="dash-widget__title">
                {widget.title || new URL(widget.url).hostname}
              </span>
              <a
                className="dash-widget__open"
                href={widget.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('widgets.openExternal')}
                title={t('widgets.openExternal')}
              >
                <span className="material-symbols-outlined" aria-hidden="true">open_in_new</span>
              </a>
            </header>
          )}
          <iframe
            className="dash-widget__frame"
            src={widget.url}
            title={widget.title || widget.url}
            style={{ height: `${widget.height}px` }}
            loading="lazy"
            referrerPolicy="no-referrer"
            sandbox={widget.sandboxed ? SANDBOX : undefined}
            allow="clipboard-write; fullscreen; autoplay; encrypted-media"
          />
        </article>
      ))}
    </section>
  )
}
