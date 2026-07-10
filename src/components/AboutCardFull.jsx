import { useTranslation } from 'react-i18next'
import CloseButton from "./CloseButton.jsx";

export default function About() {
  const { t } = useTranslation('about')

  return (
    <div className="card">
      <CloseButton />
      <h2>{t('about.header')}</h2>
      <p>
        {t('about.card.line1')} <br />
        {t('about.card.line2')}
      </p>
      <br />
      <p dangerouslySetInnerHTML={{ __html: t('about.card.github') }} />
    </div>
  )
}