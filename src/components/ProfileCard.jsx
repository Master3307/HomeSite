import { useTranslation } from 'react-i18next'

import Profile from './DiscordCard.jsx'
import CloseButton from './CloseButton.jsx'
import BrandIcon, { BRANDS } from './BrandIcon.jsx'
import { LINKS, TOOLBELT } from '../data/links.js'
import SetupShowcase from './setup/SetupShowcase.jsx'

/*
 * /card: who I am, in a few lines. The live Discord card is the hero (avatar,
 * name, what I'm doing right now), then a short bio, the tools I build with
 * (logos that light up in their colour), where to find me, and my setup
 * in 3D (components/setup).
 */

/* Brands whose colour is (near) black or too dark on purple: they use the text colour. */
const INK = new Set(['github', 'steam', 'wakatime', 'sqlite'])
const brandColour = (icon) => (INK.has(icon) ? 'var(--text-primary)' : BRANDS[icon]?.color)

const FACTS = [
  ['cake', 'birthday'],
  ['location_on', 'from'],
  ['translate', 'languages'],
]

export default function Card() {
  const { t } = useTranslation('card')

  return (
    <div id="card" className="card me-card">
      <CloseButton />

      <header className="me-hero">
        <Profile />
      </header>

      <section className="me-intro" aria-label={t('aboutMe')}>
        <p className="me-intro__bio">{t('bio')}</p>
        <ul className="me-intro__facts">
          {FACTS.map(([icon, id]) => (
            <li key={id}>
              <span className="material-symbols-outlined" aria-hidden="true">
                {icon}
              </span>
              <span className="sr-only">{t(`facts.${id}`)}: </span>
              {t(`facts.${id}Value`)}
            </li>
          ))}
        </ul>
        <p className="me-intro__into">{t('into')}</p>
      </section>

      <section className="me-block" aria-labelledby="me-tools">
        <h3 id="me-tools">{t('skills.title')}</h3>
        <ul className="me-tools">
          {TOOLBELT.map((tool, index) => (
            <li key={tool.icon} style={{ '--brand': brandColour(tool.icon), '--i': index }}>
              <span className="me-tool" tabIndex={0} aria-label={tool.label}>
                <BrandIcon name={tool.icon} size={26} />
                <span className="me-tool__name" aria-hidden="true">
                  {tool.label}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className="me-block__note">{t('skills.also')}</p>
      </section>

      <section className="me-block" aria-labelledby="me-links">
        <h3 id="me-links">{t('links.title')}</h3>
        <ul className="me-socials">
          {LINKS.map((link) => (
            <li key={link.id} style={{ '--brand': brandColour(link.icon) }}>
              <a className="me-social" href={link.url} target="_blank" rel="noopener noreferrer me" aria-label={`${link.label}: ${t(`links.${link.id}`)}`}>
                <BrandIcon name={link.icon} size={22} />
                <span className="me-social__label" aria-hidden="true">
                  <strong>{link.label}</strong>
                  {t(`links.${link.id}`)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <SetupShowcase />
    </div>
  )
}
