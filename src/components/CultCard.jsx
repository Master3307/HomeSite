import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'

export default function Cult() {
  const navigate = useNavigate()
  const { t } = useTranslation('cult')

  return (
    <div id="card" className="card">
      <h2>{t('header', { user: 'Stranger' })}</h2>
      <br />
      <img src='/discordpic.webp' className='discordpic' title='hehehehehe' alt='Some Funny Cat Greeting You' />
    </div>
  )
}
