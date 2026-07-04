import Profile from "./Profile";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { tiltCard, resetCard } from "../lib/tilt.js";

export default function Card({ tiltCard, resetCard }) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
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
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            navigate("/");
          }
        }}
      >
        close
      </span>

      <h2>{t("profileCard.cardHeader")}</h2>
      <br />

      <Profile />

      <p>{t("profileCard.greeting")}</p>
      <br />
      <p>{t("profileCard.introName")}</p>
      <p>{t("profileCard.introLearning")}</p>

      <br />
      <h3>{t("profileCard.buttonsHeader")}</h3>

      {/* add more info here */}
    </div>
  );
}