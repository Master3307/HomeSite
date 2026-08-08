import { useTranslation } from 'react-i18next'
import About from '../components/AboutCard.jsx'
import Dash from '../components/DashCard.jsx'

export default function Home() {
  const { t } = useTranslation('title')

  return (
    <>
      <title>Dash – MrKoby07</title>
      <header className="head">
        <h1 className="tit">
          {t('dash')} <strong>&nbsp;MrKoby07</strong>
        </h1>
      </header>

      <Dash />
      <About />
    </>
  )
}
