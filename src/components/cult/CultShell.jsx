import { useEffect, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router'
import { Trans, useTranslation } from 'react-i18next'

import { getFaviconSrc } from '/src/lib/seasonalAssets'
import { siteConfig } from '/src/lib/siteConfig'
import { apiUrl, keyPath, loadOwners } from '/src/lib/members'
import '/src/styles/cult.css'
import '/src/styles/members.css'

/* "Run by …": the site's owners, each a link to their profile. */
function Owners() {
  const [owners, setOwners] = useState([])
  useEffect(() => {
    loadOwners()
      .then((data) => setOwners(data.owners ?? []))
      .catch(() => {})
  }, [])
  if (!owners.length) return null
  return (
    <p className="cult-owners">
      <span className="material-symbols-outlined" aria-hidden="true">
        crown
      </span>
      Run by{' '}
      {owners.map((owner, index) => (
        <span key={owner.key}>
          {index > 0 && (index === owners.length - 1 ? ' and ' : ', ')}
          <Link to={keyPath(owner.key)} className="cult-owners__link">
            {owner.avatarUrl && <img src={apiUrl(owner.avatarUrl)} alt="" width="18" height="18" />}
            {owner.displayName}
          </Link>
        </span>
      ))}
    </p>
  )
}

/** The "Cult of black Cats" bar on every /cult page; it always leads back to /cult. */
export function CultHeader({ heading = false }) {
  const { t } = useTranslation('title')
  const Title = heading ? 'h1' : 'p'
  return (
    <header className="head">
      <Title className="tit">
        <Link to="/cult" className="cult-home-link" title="Cult of Black Cats">
          <strong>{t('cult')}</strong>
        </Link>
      </Title>
    </header>
  )
}

/** The footer of every /cult page: who runs it, source code, the privacy page. */
export function CultFooter() {
  return (
    <footer className="cult-footer">
      <Owners />
      {siteConfig.sourceRepoUrl && (
        <p>
          <span className="material-symbols-outlined" aria-hidden="true">
            code
          </span>
          <Trans
            ns="cult"
            i18nKey="footer.source"
            defaults="View source on <0>GitHub</0>"
            components={[<a key="github" href={siteConfig.sourceRepoUrl} target="_blank" rel="noopener noreferrer" />]}
          />
        </p>
      )}
      <p>
        <span className="material-symbols-outlined" aria-hidden="true">
          shield_person
        </span>
        <Link to="/privacy" state={{ from: 'cult' }}>Privacy</Link>
      </p>
    </footer>
  )
}

/** A /cult sub page (profile, settings, members, privacy): header, back link, content, footer. */
export default function CultShell({ title, back = { to: '/cult', label: 'Cult of Black Cats' }, wide = false, children }) {
  useEffect(() => {
    document.body.classList.add('cult-page')
    return () => document.body.classList.remove('cult-page')
  }, [])
  const siteName = 'Cult of Black Cats'

  return (
    <>
      <Helmet>
        <title>{title ? `${title} · ${siteName}` : siteName}</title>
        <link rel="icon" type="image/webp" href={getFaviconSrc()} />
        <meta name="robots" content="noindex" />
      </Helmet>

      <CultHeader />


      <main className={`cult cult-sub${wide ? ' cult-sub--wide' : ''}`}>
        {back && (
          <Link className="cult-back" to={back.to}>
            <span className="material-symbols-outlined" aria-hidden="true">
              arrow_back
            </span>
            {back.label}
          </Link>
        )}
        {children}
      </main>

      <CultFooter />
    </>
  )
}
