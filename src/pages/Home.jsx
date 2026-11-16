import { useTranslation } from 'react-i18next'
import About from '../components/AboutCard.jsx'
import Greeting from '../components/GreetingCard.jsx'
import Search from '../components/Search.jsx'
import { PageTitle } from '../components/SiteLogo.jsx'

export default function Home() {
  const { t } = useTranslation('title')

  return (
    <>
      <title>Home – MrKoby07</title>
      <header className="head">
        <PageTitle text={t('home')} />
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
