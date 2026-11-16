import { Helmet } from 'react-helmet-async'
import { useEffect } from 'react'
import CultCard from '/src/components/cult/Card'
import BongoCat from '/src/components/cult/BongoCat'
import Voting from '/src/components/cult/Voting'
import { CultFooter, CultHeader } from '/src/components/cult/CultShell'
import LoginNotice from '/src/components/cult/LoginNotice'
import { BirthdayBanner } from '/src/components/cult/Birthdays'
import DiscordWidget from '/src/components/DiscordWidget'

import {
  getDiscordPicSrc,
  getFaviconSrc,
} from '/src/lib/seasonalAssets'
import { useSectionHash } from '/src/lib/sectionHash'
import '/src/styles/cult.css'
import '/src/styles/members.css'

export default function Home() {

  const title = 'Cult of Black Cats'
  const description = 'Be a part of the Cult of black Cats!'

  const discordPicSrc = getDiscordPicSrc()
  const faviconSrc = getFaviconSrc()

  // #welcome (top), #game, #fdc follow the scroll position.
  useSectionHash(['welcome', 'game', 'fdc'])

  useEffect(() => {
    document.body.classList.add('cult-page')

    return () => {
      document.body.classList.remove('cult-page')
    }
  }, [])

  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description} />

        <link rel="icon" type="image/webp" href={faviconSrc} />

        <meta property="og:type" content="website" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:image" content={discordPicSrc} />
        <meta property="og:image:type" content="image/webp" />
        <meta property="og:site_name" content="Cult of Black Cats" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <meta name="twitter:image" content={discordPicSrc} />
      </Helmet>

      <CultHeader heading />


      <main className="cult">
        <LoginNotice />
        <BirthdayBanner />
        <section id="welcome" className="cult-hero">
          <CultCard />
          <DiscordWidget />
        </section>

        <BongoCat />
        <Voting />
      </main>

      <CultFooter />
    </>
  )
}
