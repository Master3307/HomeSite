import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'

export default function Greeting() {
  const navigate = useNavigate()
  const { t } = useTranslation('dash')

  return (
    <div id="card" className="card">
        <p>{t('temp')}</p>
    </div>
  )
}
