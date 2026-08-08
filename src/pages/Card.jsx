import { useTranslation } from 'react-i18next'
import { useNavigate } from "react-router";
import Cardbox from "../components/ProfileCard.jsx";
import About from '../components/AboutCard.jsx'

export default function Card() {
  const { t } = useTranslation('title');
  const navigate = useNavigate();

  return (
    <>
      <title>Card – MrKoby07</title>
      <header className="head">
        <h1 className="tit">
          {t('card')} <b>&nbsp;MrKoby07</b>
        </h1>
      </header>

      <Cardbox />

      <About />

    </>
  );
}
