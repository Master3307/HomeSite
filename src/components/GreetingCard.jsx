import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'

/*
 * The home page: a short hello, then the three places worth going to, and
 * one quiet line about the site.
 */

const PLACES = [
  { id: 'card', to: '/card', icon: 'waving_hand' },
  { id: 'cult', to: '/cult', icon: 'pets' },
  { id: 'dash', to: '/dash', icon: 'space_dashboard' },
]

export default function Greeting() {
  const { t } = useTranslation('greeting')

  return (
    <section className="home-hello" aria-labelledby="home-hello">
      <h2 id="home-hello">{t('header')}</h2>
      <p className="home-hello__lead">{t('welcome')}</p>
      <nav className="home-places" aria-label={t('placesLabel')}>
        {PLACES.map((place) => (
          <Link key={place.id} className="home-place" to={place.to}>
            <span className="material-symbols-outlined home-place__icon" aria-hidden="true">
              {place.icon}
            </span>
            <span className="home-place__text">
              <strong>{t(`places.${place.id}.title`)}</strong>
              <span>{t(`places.${place.id}.text`)}</span>
            </span>
            <span className="material-symbols-outlined home-place__go" aria-hidden="true">
              arrow_forward
            </span>
          </Link>
        ))}
      </nav>
    </section>
  )
}
