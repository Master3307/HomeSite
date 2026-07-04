import Profile from "./Profile";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { tiltCard, resetCard } from "../lib/tilt.js";

export default function Card() {
  const navigate = useNavigate();
  const { t } = useTranslation('card');

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

      <h2>{t("header")}</h2>
      <br />

      <Profile />

      <p>{t("greeting")}</p>
      <br />
      <p>{t("line1")}</p>
      <p>{t("line2")}</p>

      <br />
      <h3>{t("buttons")}</h3>

      {/* add more info here */}
    </div>
  );
}