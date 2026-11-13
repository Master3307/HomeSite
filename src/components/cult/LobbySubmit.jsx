import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentAccount } from "/src/lib/account";
import {
  LOBBY_LIMITS,
  getSavedGuestName,
  saveGuestName,
  submitLobbyCode,
} from "/src/lib/lobby";
import { catNotice } from "/src/lib/lobbyCat";

/*
 * "Submit a code" inside the lobby panel.
 *   admin session -> posted right away
 *   Discord login -> posted right away if privileged on the server,
 *                    otherwise reviewed by the moderators
 *   guest         -> asked for a name first, then reviewed
 */

function accountKind(account) {
  if (!account) return "guest";
  if (account.local) return "local";
  if (account.isAdminSession) return "admin";
  return "user";
}

/** Opens the form; LobbyCode puts it in the panel's footer row. */
export function LobbySubmitToggle({ onClick }) {
  const { t } = useTranslation("lobby-code");

  return (
    <button type="button" className="lobby-submit-toggle" onClick={onClick}>
      <span className="material-symbols-outlined" aria-hidden="true">
        add
      </span>
      {t("submit.open", { defaultValue: "Submit code" })}
    </button>
  );
}

export default function LobbySubmit({ open, onClose, onPosted }) {
  const { t } = useTranslation("lobby-code");
  const ids = { name: useId(), code: useId(), description: useId() };

  const [kind, setKind] = useState(null);
  const [account, setAccount] = useState(null);
  const [step, setStep] = useState("form"); // name | form | done
  const [guestName, setGuestName] = useState(getSavedGuestName);
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open || kind) return undefined;

    let active = true;

    getCurrentAccount()
      .catch(() => null)
      .then((current) => {
        if (!active) return;
        const nextKind = accountKind(current);
        setAccount(current);
        setKind(nextKind);
        setStep(nextKind === "guest" ? "name" : "form");
      });

    return () => {
      active = false;
    };
  }, [open, kind]);

  function close() {
    onClose?.();
    setError(null);
    setResult(null);
    setCode("");
    setDescription("");
    if (kind) setStep(kind === "guest" ? "name" : "form");
  }

  function confirmName(event) {
    event.preventDefault();
    const name = guestName.trim();
    if (!name) return;

    setGuestName(name);
    saveGuestName(name);
    setStep("form");
  }

  async function submit(event) {
    event.preventDefault();
    if (busy || !code.trim()) return;

    setBusy(true);
    setError(null);

    try {
      const next = await submitLobbyCode({
        code: code.trim(),
        description: description.trim() || undefined,
        guestName: kind === "guest" ? guestName.trim() : undefined,
      });

      setResult(next.status);
      catNotice("lobby-submitted", { status: next.status });
      setStep("done");
      if (next.status === "posted") onPosted?.();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="lobby-submit">
      <div className="lobby-submit__head">
        <p className="lobby-submit__title">
          {t("submit.title", { defaultValue: "Submit a new code" })}
        </p>
        <button
          type="button"
          className="lobby-submit__close"
          onClick={close}
          aria-label={t("submit.close", { defaultValue: "Close" })}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            close
          </span>
        </button>
      </div>

      {!kind ? (
        <p className="lobby-submit__note" role="status">
          {t("loadingPlaceholder")}
        </p>
      ) : kind === "local" ? (
        <p className="lobby-submit__note">
          {t("submit.localAdmin", {
            defaultValue:
              "Your admin session only works offline in this browser. Log in with the admin code again while the server is reachable to post lobby codes.",
          })}
        </p>
      ) : step === "name" ? (
        <form className="lobby-submit__form" onSubmit={confirmName}>
          <label htmlFor={ids.name}>
            {t("submit.nameLabel", { defaultValue: "What’s your name?" })}
          </label>
          <p className="lobby-submit__note">
            {t("submit.nameHint", {
              defaultValue:
                "You’re not logged in, so the moderators will see this name when they review your code.",
            })}
          </p>
          <div className="lobby-submit__row">
            <input
              id={ids.name}
              className="lobby-submit__input"
              type="text"
              value={guestName}
              onChange={(event) => setGuestName(event.target.value)}
              maxLength={LOBBY_LIMITS.name}
              autoComplete="nickname"
              autoFocus
              required
            />
            <button type="submit" className="lobby-submit__button" disabled={!guestName.trim()}>
              {t("submit.continue", { defaultValue: "Continue" })}
            </button>
          </div>
        </form>
      ) : step === "done" ? (
        <div className="lobby-submit__done" role="status">
          <span className="material-symbols-outlined" aria-hidden="true">
            {result === "posted" ? "check_circle" : "schedule"}
          </span>
          <p>
            {result === "posted"
              ? t("submit.posted", { defaultValue: "Posted! The lobby code is updated." })
              : t("submit.pending", {
                  defaultValue:
                    "Sent to the moderators for approval. It shows up here once it’s approved.",
                })}
          </p>
          <button type="button" className="lobby-submit-toggle" onClick={close}>
            {t("submit.done", { defaultValue: "Done" })}
          </button>
        </div>
      ) : (
        <form className="lobby-submit__form" onSubmit={submit}>
          <p className="lobby-submit__note">
            {kind === "admin"
              ? t("submit.hintAdmin", {
                  defaultValue: "Admin session: the code is posted right away.",
                })
              : kind === "user"
                ? t("submit.hintUser", {
                    defaultValue:
                      "Posted right away if you can post lobby codes on the server, otherwise sent to the moderators for approval.",
                  })
                : (
                  <>
                    {t("submit.hintGuest", {
                      defaultValue: "Submitting as {{name}}. The moderators review it before it’s posted.",
                      name: guestName,
                    })}{" "}
                    <button
                      type="button"
                      className="lobby-submit__link"
                      onClick={() => setStep("name")}
                    >
                      {t("submit.changeName", { defaultValue: "Change name" })}
                    </button>
                  </>
                )}
            {kind === "user" && account?.displayName && (
              <>
                {" "}
                {t("submit.asUser", {
                  defaultValue: "Submitting as {{name}}.",
                  name: account.displayName,
                })}
              </>
            )}
          </p>

          <label htmlFor={ids.code}>
            {t("submit.codeLabel", { defaultValue: "Lobby code" })}
          </label>
          <input
            id={ids.code}
            className="lobby-submit__input lobby-submit__input--code"
            type="text"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\s/g, ""))}
            maxLength={LOBBY_LIMITS.code}
            spellCheck={false}
            autoComplete="off"
            autoFocus
            required
          />

          <label htmlFor={ids.description}>
            {t("submit.descriptionLabel", { defaultValue: "Description (optional)" })}
          </label>
          <textarea
            id={ids.description}
            className="lobby-submit__input"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={LOBBY_LIMITS.description}
          />

          {error && (
            <p className="lobby-error" role="alert">
              {error}
            </p>
          )}

          <div className="lobby-submit__actions">
            <button type="submit" className="lobby-submit__button" disabled={busy || !code.trim()}>
              {busy
                ? t("submit.sending", { defaultValue: "Sending…" })
                : kind === "admin"
                  ? t("submit.post", { defaultValue: "Post code" })
                  : t("submit.send", { defaultValue: "Submit code" })}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
