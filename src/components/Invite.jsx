import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { discordInviteUrl } from '../lib/siteConfig'

export default function Greeting() {
  const navigate = useNavigate()
  const { t } = useTranslation('greeting')

  return (
    <a href={discordInviteUrl}>Join the Discord Server!</a>
  )
}
