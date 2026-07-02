import { useTranslation } from 'react-i18next'

export default function About() {
  const { t } = useTranslation()

  return (
    <div className="card about-card">
      <h2>{t('about.header')}</h2>
      <p>
        {t('about.description.line1')} <br />
        {t('about.description.line2')}
      </p>
    </div>
  )
}