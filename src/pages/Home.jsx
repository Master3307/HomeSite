import { useTranslation } from 'react-i18next'
import About from '../components/AboutCard.jsx'
import Greeting from '../components/GreetingCard.jsx'
import Search from '../components/Search.jsx'
import SiteLogo from '../components/SiteLogo.jsx'

export default function Home() {
  const { t } = useTranslation('title')

  return (
    <>
      <title>Home – MrKoby07</title>
      <header className="head">
        <SiteLogo />
        <h1 className="tit">
          {t('home')} <strong>&nbsp;MrKoby07</strong>
        </h1>
      </header>

      {/* A full-height column: the about line sits 32px above the bottom
          when the page is short and simply follows the content when it isn't. */}
      <div className="home-page">
        <div className="home-page__main">
          <Search />
          <Greeting />
        </div>
        <About />
      </div>
    </>
  )
}
