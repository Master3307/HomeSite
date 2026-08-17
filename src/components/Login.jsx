import { useTranslation } from 'react-i18next'

const API_URL = 'https://discord-api.master3307.org'

export default function Cult() {
  const { t } = useTranslation('cult')

  return (
    <a href={`${API_URL}/auth/discord`}>
      Continue with Discord
    </a>
  )
}
