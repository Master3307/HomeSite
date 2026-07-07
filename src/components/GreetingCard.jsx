import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'

export default function Greeting() {
  const navigate = useNavigate()
  const { t } = useTranslation('greeting')

  return (
    <div id="card" className="card">
      <h2>{t('header')}</h2>
      <button onClick={() => navigate('/card')}>
        {t('viewCard')}
        <span className="material-symbols-outlined">id_card</span>
      </button>
    </div>
  )
}