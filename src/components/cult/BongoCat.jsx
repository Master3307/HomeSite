import { useTranslation } from 'react-i18next'
import LobbyCode from './LobbyCode'
import LobbyCat from './LobbyCat'

const STEAM_WIDGET_URL =
  'https://store.steampowered.com/widget/3419430/?t=Bongo%20Cat%20is%20a%20free%20desktop%20idle%20game.%0AA%20little%20cat%20sits%20at%20the%20edge%20of%20your%20screen%20and%20taps%20along%20with%20every%20key%20you%20press%20and%20every%20click%20you%20make.%0AThe%20point%20of%20it%20is%20basically%20to%20have%20a%20little%20companion%20while%20you%20work%20and%20if%20you%20want%2C%20a%20Multiplayer%20Lobby!'

/** Steam widget for Bongo Cat and the current lobby code. */
export default function BongoCat() {
  const { t } = useTranslation('cult')

  return (
    <section id="bongo-cat" className="cult-section cult-section--game" aria-labelledby="bongo-cat-title">
      <h2 id="bongo-cat-title" className="cult-section__title cult-game__label">
        {t('game.title', { defaultValue: 'The game' })}
      </h2>

      {/* Steam's panel is shorter than its iframe; the wrapper paints the
          rest of the panel so it matches the lobby panel's height. */}
      <div className="cult-steam-widget">
        <iframe
          src={STEAM_WIDGET_URL}
          title={t('game.steamWidget', { defaultValue: 'Bongo Cat on Steam' })}
          width="646"
          height="190"
          loading="lazy"
        />
      </div>

      <div className="cult-lobby-widget">
        <LobbyCode />
      </div>

      {/* Sits on the separator line above this section (see cult.css). */}
      <LobbyCat />
    </section>
  )
}
