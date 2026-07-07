import { useTranslation } from 'react-i18next'
import ThemeSwitch from '../components/ThemeSwitch.jsx'
import LanguageSwitch from '../components/LanguageSwitch.jsx'
import AboutCard from '../components/AboutCardFull.jsx'
import Greeting from '../components/GreetingCard.jsx'

export default function Home() {
  const { t } = useTranslation('title')

  return (
    <>
      <title>About – MrKoby07</title>
      <header className="head">
        <h1 className="tit">
          {t('about')} <strong>&nbsp;MrKoby07</strong>
        </h1>
      </header>


      <AboutCard />
      

      <ThemeSwitch />
      <LanguageSwitch />
    </>
  )
}