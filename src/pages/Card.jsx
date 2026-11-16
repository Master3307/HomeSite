import { useTranslation } from 'react-i18next'
import Cardbox from "../components/ProfileCard.jsx";
import { PageTitle } from '../components/SiteLogo.jsx'

export default function Card() {
  const { t } = useTranslation('title');

  return (
    <>
      <title>Card – MrKoby07</title>
      <header className="head">
        <PageTitle text={t('card')} />
      </header>

      <Cardbox />

    </>
  );
}
