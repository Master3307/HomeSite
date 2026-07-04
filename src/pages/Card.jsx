import { useTranslation } from 'react-i18next'
import { useNavigate } from "react-router";
import ThemeSwitch from "../components/ThemeSwitch.jsx";
import LanguageSwitch from '../components/LanguageSwitch.jsx'
import Profile from "../components/Profile.jsx";
import Cardbox from "../components/Card.jsx";
import About from '../components/About.jsx'

export default function Card() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <>
      <title>Card – MrKoby07</title>
      <header className="head">
        <h1 className="tit">
          {t('profileCard.pageTitlePrefix')} <b>&nbsp;MrKoby07</b>
        </h1>
      </header>

      <Cardbox />

      <About />

      <ThemeSwitch />
      <LanguageSwitch />
    </>
  );
}
