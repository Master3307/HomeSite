import { useTranslation } from 'react-i18next'
import AboutCard from '../components/AboutCardFull.jsx'
import { PageTitle } from '../components/SiteLogo.jsx'

export default function Home() {
  const { t } = useTranslation('title')

  return (
    <>
      <title>About – MrKoby07</title>
      <header className="head">
        <PageTitle text={t('about')} />
      </header>


      <AboutCard />
    </>
  )
}
