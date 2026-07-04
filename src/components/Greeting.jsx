import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'

export default function Greeting() {
  const navigate = useNavigate()
  const { t } = useTranslation()

  return (
    <div id="card" className="card">
      <h2>{t('home.greetingHeader')}</h2>
      <button onClick={() => navigate('/card')}>
        {t('home.viewCardButton')}
        <span className="material-symbols-outlined">id_card</span>
      </button>
    </div>
  )
}