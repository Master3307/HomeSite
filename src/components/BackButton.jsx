import { useNavigate } from "react-router";

export default function BackButton() {
    const navigate = useNavigate();

    return (
        <span
            className="material-symbols-outlined back-icon"
            onClick={() => navigate(-1)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    navigate(-1);
                }
            }}
        >
            arrow_back
        </span>
    );
}
