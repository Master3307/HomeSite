import { Suspense, lazy } from 'react'

import { answerTitle, presentRow } from './present.js'
import '../../styles/quick.css'

/*
 * One tool answer in the search panel (components/Search.jsx): a quiet
 * header, its rows (each an option: Enter / click copies), and its card
 * (QuickCards.jsx, loaded the first time one is shown).
 */

const QuickCard = lazy(() => import('./QuickCards.jsx'))

export default function QuickAnswer({ answer, t, locale, optionProps, copiedKey, api, enterable = false }) {
  const rows = answer.rows.map((row) => presentRow(answer, row, t, locale))
  const title = answerTitle(answer, t)
  const subtitle = answer.subtitle ? t(answer.subtitle.key, answer.subtitle) : null
  return (
    <div role="group" aria-label={title} className={`site-search__group quick quick--${answer.tool}`} data-tool={answer.tool}>
      {(!answer.card || rows.length > 0) && (
        <p className="site-search__group-title quick__title" aria-hidden="true">
          <span className="material-symbols-outlined quick__title-icon">{answer.icon}</span>
          <span className="quick__title-text">{title}</span>
          {subtitle && <span className="quick__subtitle">{subtitle}</span>}
        </p>
      )}
      {answer.card && (
        <div
          className="quick__card-wrap"
          {...(enterable ? { ...optionProps({ key: `quickcard:${answer.key}`, kind: 'quickcard', answer }), onClick: undefined } : {})}
          onMouseDown={(event) => event.target.closest('input, textarea, select, button, a, [contenteditable], [data-drag]') || event.preventDefault()}
        >
          <Suspense fallback={<div className="quick-card quick-card--loading skeleton" aria-hidden="true" />}>
            <QuickCard answer={answer} t={t} locale={locale} api={api} />
          </Suspense>
        </div>
      )}
      {rows.map((row) => {
        const key = `quick:${answer.key}:${row.id}`
        const pending = row.text === '…'
        return (
          <div key={key} className={`site-search__option quick__row${row.mono ? ' quick__row--mono' : ''}${pending ? ' is-pending' : ''}`} {...optionProps({ key, kind: 'quick', row, answer })}>
            <div className="site-search__option-main">
              <span className="site-search__title quick__value">{pending ? <span className="skeleton skeleton--text quick__pending" /> : row.text}</span>
            </div>
            {row.hint && row.hint !== title && <span className="quick__hint">{row.hint}</span>}
            {row.copy !== '' && (
              <span className="material-symbols-outlined quick__copy" aria-hidden="true">
                {copiedKey === key ? 'check' : 'content_copy'}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
