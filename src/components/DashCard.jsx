import { useTranslation } from 'react-i18next'

export default function Greeting() {
  const { t } = useTranslation('dash')

  return (
    <div id="card" className="card">
        <p>{t('temp')}</p>
    </div>
  )
}
