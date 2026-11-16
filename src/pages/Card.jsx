import { useTranslation } from 'react-i18next'
import Cardbox from "../components/ProfileCard.jsx";

export default function Card() {
  const { t } = useTranslation('title');

  return (
    <>
      <title>Card – MrKoby07</title>
      <header className="head">
        <h1 className="tit">
          {t('card')} <b>&nbsp;MrKoby07</b>
        </h1>
      </header>

      <Cardbox />

    </>
  );
}
