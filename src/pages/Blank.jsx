import { useTranslation } from 'react-i18next'
import ThemeSwitch from '../components/ThemeSwitch.jsx'
import LanguageSwitch from '../components/LanguageSwitch.jsx'
import { PageTitle } from '../components/SiteLogo.jsx'


export default function Home() {
  const { t } = useTranslation('title')

  return (
    <>
      <title>Home – MrKoby07</title>
      <header className="head">
        <PageTitle text={t('home')} />
      </header>


      <ThemeSwitch />
      <LanguageSwitch />
    </>
  )
}