import { useTranslation } from 'react-i18next'
import CultCard from '../components/CultCard'
import '../styles/cult.css'

export default function Home() {
  const { t } = useTranslation('title')

  return (
    <>
      <title>Cult of black Cats</title>
      <link rel="icon" type="image/webp" href="/discordpic-zoomed.webp" />
      <header className="head">
        <h1 className="tit">
        <strong>{t('cult')}</strong>
        </h1>
      </header>

     <CultCard />

    </>
  )
}
