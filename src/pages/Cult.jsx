import { Helmet } from 'react-helmet-async'
import { useTranslation } from 'react-i18next'
import CultCard from '../components/CultCard'
import '../styles/cult.css'

export default function Home() {
  const { t } = useTranslation('title')

  const title = 'Cult of Black Cats'
  const description =
    'Enter the Cult of Black Cats — a mysterious gathering of feline darkness.'
  const image = 'https://home.master3307.org/discordpic-zoomed.webp'
  const url = 'https://home.master3307.org/'

  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description} />

        <link rel="icon" type="image/webp" href="/discordpic-zoomed.webp" />

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

      <CultCard />
    </>
  )
}
