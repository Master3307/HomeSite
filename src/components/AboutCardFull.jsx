import { Link } from 'react-router'
import { Trans, useTranslation } from 'react-i18next'

import BackButton from './BackButton.jsx'
import BrandIcon from './BrandIcon.jsx'
import { discordInviteUrl, siteConfig } from '../lib/siteConfig.js'
import { OLD_SITE_URL } from '../data/links.js'

/*
 * /about: the site in a few quiet rows (from the README): why it exists,
 * what's on it, what runs it, how to help, and who to thank.
 */

const PLACES = [
  { id: 'card', to: '/card' },
  { id: 'cult', to: '/cult' },
  { id: 'dash', to: '/dash' },
]

const STACK = [
  { id: 'site', icon: 'react' },
  { id: 'api', icon: 'nodedotjs' },
  { id: 'bot', icon: 'discord' },
  { id: 'host', icon: 'linux' },
]

const external = { target: '_blank', rel: 'noopener noreferrer' }

function Row({ title, children }) {
  return (
    <section className="about-row">
      <h3>{title}</h3>
      <div className="about-row__body">{children}</div>
    </section>
  )
}

export default function About() {
  const { t } = useTranslation('about')
  const botInvite = siteConfig.botUserId ? `https://discord.com/oauth2/authorize?client_id=${siteConfig.botUserId}` : null

  return (
    <div className="card site-about">
      <BackButton />
      <header className="site-about__head">
        <h2>{t('about.header')}</h2>
        <p className="site-about__lead">{t('about.lead')}</p>
      </header>

      <Row title={t('about.storyTitle')}>
        <p>
          <Trans t={t} i18nKey="about.story" components={{ old: <a href={OLD_SITE_URL} {...external} /> }} />
        </p>
      </Row>

      <Row title={t('about.whatTitle')}>
        <ul className="about-list">
          {PLACES.map((place) => (
            <li key={place.id}>
              <Link to={place.to}>{t(`about.${place.id}_title`)}</Link>
              <span>{t(`about.${place.id}_text`)}</span>
            </li>
          ))}
        </ul>
      </Row>

      <Row title={t('about.builtTitle')}>
        <ul className="about-list about-list--stack">
          {STACK.map((part) => (
            <li key={part.id}>
              <BrandIcon name={part.icon} size={18} />
              <span>
                <strong>{t(`about.stack.${part.id}_title`)}</strong> {t(`about.stack.${part.id}_text`)}
              </span>
            </li>
          ))}
        </ul>
        {(botInvite || discordInviteUrl) && (
          <p className="about-row__links">
            {botInvite && (
              <a href={botInvite} {...external}>
                {t('about.installBot')}
              </a>
            )}
            {discordInviteUrl && (
              <a href={discordInviteUrl} {...external}>
                {t('about.joinServer')}
              </a>
            )}
          </p>
        )}
      </Row>

      <Row title={t('about.helpTitle')}>
        <p>{t('about.help')}</p>
        <p className="about-row__links">
          {siteConfig.translateUrl && (
            <a href={siteConfig.translateUrl} {...external}>
              {t('about.translate')}
            </a>
          )}
          {siteConfig.sourceRepoUrl && (
            <a href={`${siteConfig.sourceRepoUrl.replace(/\/+$/, '')}/blob/master/CONTRIBUTING.md`} {...external}>
              {t('about.contribute')}
            </a>
          )}
        </p>
      </Row>

      <Row title={t('about.creditsTitle')}>
        <ul className="about-credits">
          <li>
            <Trans t={t} i18nKey="about.creditBot" components={{ a: <a href="https://github.com/NamVr/DiscordBot-Template" {...external} /> }} />
          </li>
          <li>
            <Trans t={t} i18nKey="about.creditTilt" components={{ a: <a href="https://stormxxboy.com/card/" {...external} /> }} />
          </li>
          <li>
            <Trans t={t} i18nKey="about.creditIcons" components={{ a: <a href="https://simpleicons.org" {...external} /> }} />
          </li>
          <li>
            <Trans t={t} i18nKey="about.creditCachy" components={{ a: <a href="https://cachyos.org" {...external} /> }} />
          </li>
        </ul>
      </Row>

      <footer className="site-about__foot">
        {siteConfig.sourceRepoUrl && (
          <a className="me-button" href={siteConfig.sourceRepoUrl} {...external}>
            <BrandIcon name="github" size={18} />
            {t('about.source')}
          </a>
        )}
        <Link className="me-button me-button--quiet" to="/cult/privacy">
          {t('about.privacy')}
        </Link>
        <Link className="me-button me-button--quiet" to="/license">
          {t('about.license')}
        </Link>
      </footer>
    </div>
  )
}
