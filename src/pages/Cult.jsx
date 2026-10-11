import { Helmet } from 'react-helmet-async'
import { useTranslation } from 'react-i18next'
import { useEffect } from 'react'
import CultCard from '/src/components/cult/Card'
import Login from '/src/components/Login'
import LobbyCode from '/src/components/cult/LobbyCode'
import {
  getDiscordPicSrc,
  getFaviconSrc,
} from '/src/lib/seasonalAssets'
import '/src/styles/cult.css'

export default function Home() {
  const { t } = useTranslation('title')

  const title = 'Cult of Black Cats'
  const description = 'Be a part of the Cult of black Cats!'

  const discordPicSrc = getDiscordPicSrc()
  const faviconSrc = getFaviconSrc()

  useEffect(() => {
    document.body.classList.add('cult-page')

    return () => {
      document.body.classList.remove('cult-page')
    }
  }, [])

  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description} />

        <link rel="icon" type="image/webp" href={faviconSrc} />

        <meta property="og:type" content="website" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:image" content={discordPicSrc} />
        <meta property="og:image:type" content="image/webp" />
        <meta property="og:site_name" content="Cult of Black Cats" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <meta name="twitter:image" content={discordPicSrc} />
      </Helmet>

      <header className="head">
        <h1 className="tit">
          <strong>{t('cult')}</strong>
        </h1>
      </header>

      <div className="login-below-head">
        <Login />
      </div>

      <CultCard />
      <LobbyCode />
    </>
  )
}
