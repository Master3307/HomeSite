import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'

export default function Greeting() {
  const navigate = useNavigate()
  const { t } = useTranslation('greeting')

  return (
    <div id="card" className="card">
      <h2>{t('header')}</h2>
      <p>{t('welcome')}</p>
      <br />
      {t('viewCardPretext')}
      <br />
      <button className='viewCard' onClick={() => navigate('/card')}>
        {t('viewCard')}
        <span className="material-symbols-outlined">id_card</span>
      </button>  {/* NOTE: Make this Button a Card visually maybe */}
    </div>
  )
}