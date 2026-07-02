import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'

export default function Greeting() {
  const navigate = useNavigate()
  const { t } = useTranslation()

  return (
    <div id="card" className="card">
      <h2>{t('greeting.header')}</h2>
      <button onClick={() => navigate('/card')}>
        {t('greeting.view-card')}
        <span className="material-symbols-outlined">id_card</span>
      </button>
    </div>
  )
}