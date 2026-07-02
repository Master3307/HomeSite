import { useNavigate } from "react-router";
import { tiltCard, resetCard } from "../lib/tilt.js";
import { playAudio } from '../lib/play-audio.js'
import ThemeSwitch from "../components/ThemeSwitch.jsx";
import LanguageSwitch from '../components/LanguageSwitch.jsx'

export default function Card() {
  const navigate = useNavigate();

  return (
    <>
      <title>Card – MrKoby07</title>
      <header className="head">
        <h1 className="tit">
          Card of<b>&nbsp;MrKoby07</b>
        </h1>
      </header>

      <div
        id="card"
        className="card"
        onMouseMove={tiltCard}
        onMouseLeave={resetCard}
      >
        <span
          className="material-symbols-outlined close-icon"
          onClick={() => navigate("/")}
          role="button"
          tabIndex={0}
        >
          close
        </span>

        <h2>Personal User Card</h2>
        <br />

        <img
          className="pfp"
          src="/img/pfp/MrKoby07animated.gif"
          alt="Profile Picture"
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          onClick={() => playAudio('/audio/clown.mp3')}
        />

        <p>Hi there! :D</p>
        <br />
        <p>
          My name is Korbi and I'm a developer and I like to try different
          computer things.
        </p>
        <p>
          I learn pretty consistently and I find joy in finding and fixing small
          Problems.
        </p>

        <br />
        <h3>Buttons</h3>

        {/* add more info here */}
      </div>

      <ThemeSwitch />
      <LanguageSwitch />
    </>
  );
}
