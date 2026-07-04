import { useTranslation } from 'react-i18next'

export default function About() {
  const { t } = useTranslation('about')

  return (
    <div className="card about-card">
      <h2>{t('header')}</h2>
      <p>
        {t('line1')} <br />
        {t('line2')}
      </p>
    </div>
  )
}