import { Helmet } from 'react-helmet-async'
import { useTranslation } from 'react-i18next'
import { useEffect } from 'react'
import Login from '/src/components/Login'
import {
  getDiscordPicSrc,
  getFaviconSrc,
} from '/src/lib/seasonalAssets'
import '/src/styles/cult.css'

const SITE_URL = 'https://home.master3307.org'

export default function Home() {
  const { t } = useTranslation('title')

  const title = 'Cult of Black Cats'
  const description = 'Be a part of the Cult of black Cats!'
  const url = `${SITE_URL}/`

  const discordPicSrc = getDiscordPicSrc()
  const faviconSrc = getFaviconSrc()

  // Open Graph and Twitter require full absolute URLs.
  const image = `${SITE_URL}${discordPicSrc}`

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
        <meta property="og:url" content={url} />
        <meta property="og:image" content={image} />
        <meta property="og:image:type" content="image/webp" />
        <meta property="og:site_name" content="Cult of Black Cats" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <meta name="twitter:image" content={image} />
      </Helmet>

      <header className="head">
        <h1 className="tit">
          <strong>{t('cult')}</strong>
        </h1>
      </header>

      <div className="login-below-head">
        <Login />
        <span className="material-symbols-outlined">favorite</span>
      </div>

    </>
  )
}
