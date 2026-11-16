import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getDiscordPicSrc } from '/src/lib/seasonalAssets'
import { getCurrentAccount } from '/src/lib/account'

/** Hero intro of /cult: greeting and a short pitch. */
/* "Welcome, {{user}}!" in any language, with the name in bold. */
const NAME_MARK = '\u2063NAME\u2063'
function WelcomeLine({ text, name }) {
  const at = text.indexOf(NAME_MARK)
  if (at < 0) return text.replace(NAME_MARK, name)
  const tail = text.slice(at + NAME_MARK.length)
  return (
    <>
      {text.slice(0, at)}
      {/* The name and the punctuation right after it ("!") never part. */}
      <span className="cult-hero__keep">
        <strong className="cult-hero__name">{name}</strong>
        {tail.match(/^\S*/)[0]}
      </span>
      {tail.replace(/^\S*/, '')}
    </>
  )
}

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
        title={t('catTitle')}
        alt={t('catAlt')}
        width="128"
        height="128"
      />

      <p className="cult-eyebrow">
        {t('eyebrow')}
      </p>
      <h2 className="cult-hero__title">
        <WelcomeLine text={t('header', { user: NAME_MARK })} name={user} />
      </h2>
      <p className="cult-lead">
        {t('lead')}
      </p>
    </div>
  )
}
