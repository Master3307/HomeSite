import { useTranslation } from 'react-i18next'

export default function About() {
  const { t } = useTranslation()

  return (
    <div className="card about-card">
      <h2>{t('aboutPage.header')}</h2>
      <p>
        {t('aboutPage.introText')} <br />
        {t('aboutPage.summaryText')}
      </p>
    </div>
  )
}