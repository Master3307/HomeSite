import { useTranslation } from 'react-i18next'
import ThemeSwitch from '../components/ThemeSwitch.jsx'
import LanguageSwitch from '../components/LanguageSwitch.jsx'
import About from '../components/AboutCard.jsx'

export default function Home() {
  const { t } = useTranslation(['collect', 'title'])

  return (
    <>
      <title>Home – MrKoby07</title>
      <header className="head">
        <h1 className="tit">
          {t('collect', { ns:'title'})} <strong>&nbsp;MrKoby07</strong>
        </h1>
      </header>

      <div className='card'>
        <h2>{t('whatCollect')}</h2>
      </div>


      <About />
      <ThemeSwitch />
      <LanguageSwitch />
    </>
  )
}
