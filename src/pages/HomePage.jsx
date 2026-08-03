import { useTranslation } from 'react-i18next'
import ThemeSwitch from '../components/ThemeSwitch.jsx'
import LanguageSwitch from '../components/LanguageSwitch.jsx'
import About from '../components/AboutCard.jsx'
import Greeting from '../components/GreetingCard.jsx'

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


      <About />

      <ThemeSwitch />
      <LanguageSwitch />
    </>
  )
}
