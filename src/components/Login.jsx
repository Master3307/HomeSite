import { useTranslation } from 'react-i18next'

const API_URL = 'https://discord-api.master3307.org'

export default function Login() {
  const { t } = useTranslation('login')

  return (
    <a
      className="loginButton"
      href={`${API_URL}/auth/discord`}
    >
      <strong>{t('login')}</strong>
    </a>
  )
}
