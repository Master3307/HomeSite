import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'

export default function Greeting() {
  const navigate = useNavigate()
  const { t } = useTranslation('greeting')

  return (
    <a href='https://discord.gg/px86PYjcyB'>Join the Discord Server!</a>
  )
}
