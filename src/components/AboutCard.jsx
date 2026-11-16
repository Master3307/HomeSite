import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'

/* One quiet line under the home page: what this is, and where to read more. */
export default function About() {
  const { t } = useTranslation('about')

  return (
    <p className="home-about">
      {t('about.card.line1')}{' '}
      <Link to="/about">
        {t('about.card.line3')}
        <span className="material-symbols-outlined" aria-hidden="true">
          arrow_forward
        </span>
      </Link>
    </p>
  )
}
