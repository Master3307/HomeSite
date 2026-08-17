import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'

export default function Cult() {
  const navigate = useNavigate()
  const { t } = useTranslation('cult')

  return (
    <a href="/api/auth/discord">Continue with Discord</a>
  )
}
