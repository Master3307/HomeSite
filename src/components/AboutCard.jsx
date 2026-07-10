import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'

export default function About() {
  const { t } = useTranslation('about')

  return (
    <div className="card about-card">
      <h2>{t('about.header')}</h2>
      <p>
        {t('about.card.line1')} <br />
        {t('about.card.line2')} <br />
        <Link to='/about'>{t('about.card.line3')}</Link>
      </p>
    </div>
  )
}