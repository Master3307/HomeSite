import { useTranslation } from 'react-i18next'
import ThemeSwitch from '../components/ThemeSwitch.jsx'
import LanguageSwitch from '../components/LanguageSwitch.jsx'
import Discord from '../components/DiscordDisplay.jsx'


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

      <Discord />


      <ThemeSwitch />
      <LanguageSwitch />
    </>
  )
}