import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getDiscordPicSrc } from '/src/lib/seasonalAssets'
import { getCurrentAccount } from '/src/lib/account'

/** Hero intro of /cult: greeting and a short pitch. */
export default function Cult() {
  const { t } = useTranslation('cult')

  const [displayName, setDisplayName] = useState(null)

  useEffect(() => {
    let active = true

    getCurrentAccount()
      .then((account) => {
        if (active && account?.displayName) setDisplayName(account.displayName)
      })
      .catch((error) => console.error('Could not load current account:', error))

    return () => {
      active = false
    }
  }, [])

  const user = displayName || t('stranger')
  const discordPicSrc = getDiscordPicSrc()

  return (
    <div id="cult-card" className="cult-hero__intro">
      <img
        src={discordPicSrc}
        className="discordpic"
        title="hehehehehe"
        alt="Some Funny Cat Greeting You"
        width="128"
        height="128"
      />

      <p className="cult-eyebrow">
        {t('eyebrow', { defaultValue: 'A Discord community' })}
      </p>
      <h2 className="cult-hero__title">{t('header', { user })}</h2>
      <p className="cult-lead">
        {t('lead', {
          defaultValue:
            'A small server of black cat enjoyers who mostly hang out in Bongo Cat. Grab the lobby code, vote on this week’s Friday Dress Code, and pet the cat while you’re here.',
        })}
      </p>
    </div>
  )
}
