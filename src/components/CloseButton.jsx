import { useNavigate } from "react-router";

export default function CloseButton() {
    const navigate = useNavigate();

    return (
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
    );
}