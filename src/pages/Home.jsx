import { useTranslation } from 'react-i18next'
import ThemeSwitch from '../components/ThemeSwitch.jsx'
import LanguageSwitch from '../components/LanguageSwitch.jsx'
import About from '../components/About.jsx'
import Greeting from '../components/Greeting.jsx'

export default function Home() {
  const { t } = useTranslation()

  return (
    <>
      <title>Home – MrKoby07</title>
      <header className="head">
        <h1 className="tit">
          {t('home.titlePrefix')} <strong>&nbsp;MrKoby07</strong>
        </h1>
      </header>

      <Greeting />
      <About />

      <ThemeSwitch />
      <LanguageSwitch />
    </>
  )
}