import { useTranslation } from 'react-i18next'
import { useEffect } from "react";
import { Link, useLocation } from "react-router";

import About from "../components/About.jsx";
import LanguageSwitch from "../components/LanguageSwitch.jsx";
import ThemeSwitch from "../components/ThemeSwitch.jsx";

import { getErrorMessage } from "../lib/error.js";
import { playAudio } from "../lib/play-audio.js";
import { resetCard, tiltCard } from "../lib/tilt.js";

import styles from "../styles/error.module.css";



const ERROR_THEME = {
  "--bg-secondary": "#970000",
  "--accent": "#b60b0b",
  "--accent-hover": "#610000",
  "--bg-primary": "#320505",
};

export default function Error({ forcedCode }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const code = String(forcedCode || params.get("code") || "template");
  const errorInfo = getErrorMessage(code);
  const { t } = useTranslation();

  useEffect(() => {
    document.title = `${errorInfo.title} – MrKoby07`;

    const root = document.documentElement;
    const previous = {
      "--bg-secondary": root.style.getPropertyValue("--bg-secondary"),
      "--accent": root.style.getPropertyValue("--accent"),
      "--accent-hover": root.style.getPropertyValue("--accent-hover"),
      "--bg-primary": root.style.getPropertyValue("--bg-primary"),
    };

    Object.entries(ERROR_THEME).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });

    return () => {
      Object.entries(previous).forEach(([key, value]) => {
        if (value) {
          root.style.setProperty(key, value);
        } else {
          root.style.removeProperty(key);
        }
      });
    };
  }, [errorInfo.title]);

  return (
    <div className={styles.errorPage}>
      <header className="head">
        <h1 className="tit">
          {t('error.title')} <b>&nbsp;MrKoby07</b>
        </h1>
      </header>

      <div
        className={`card ${styles.errorCard}`}
        onMouseMove={tiltCard}
        onMouseLeave={resetCard}
      >
        <h2>{errorInfo.title}</h2>
        <p>{errorInfo.message}</p>

        <img
          className="uhh"
          src="/img/uhh-md.webp"
          srcSet="
    /img/uhh-sm.webp 320w,
    /img/uhh-md.webp 640w,
    /img/uhh-lg.webp 1024w
  "
          sizes="(max-width: 640px) 320px, (max-width: 1024px) 640px, 1024px"
          alt="uhh"
          onClick={() =>
            playAudio("/audio/confuse.mp3", {
              fadeOut: true,
              fadeDuration: 0.6,
            })
          }
        />
        <br />

        <div className={styles.errorButtons}>
          <button type="button" onClick={() => window.history.back()}>
            Go Back
          </button>

          <Link to="/">
            <button type="button">Go Home</button>
          </Link>

          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>

      <About />

      <ThemeSwitch />
      <LanguageSwitch />
    </div>
  );
}
