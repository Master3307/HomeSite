import { useTranslation } from 'react-i18next'
const API_URL = 'https://discord-api.master3307.org'

export default function Cult() {
  const { t} = useTranslation('login')

  return (
    <a href={`${API_URL}/auth/discord`}>
      <p className='loginButtonText'><strong>{t('login')}</strong></p>
    </a>
  )
}
