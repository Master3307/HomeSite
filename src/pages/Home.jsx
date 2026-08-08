import { useTranslation } from 'react-i18next'
import About from '../components/AboutCard.jsx'
import Greeting from '../components/GreetingCard.jsx'

export default function Home() {
  const { t } = useTranslation('title')

  return (
    <>
      <title>Home – MrKoby07</title>
      <header className="head">
        <h1 className="tit">
          {t('home')} <strong>&nbsp;MrKoby07</strong>
        </h1>
      </header>

      <Greeting />
      <About />



    </>
  )
}
