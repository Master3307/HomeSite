import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ACCOUNT_API_URL } from "/src/lib/account";
import DiscordText from "/src/components/DiscordText";
import LobbySubmit, { LobbySubmitToggle } from "./LobbySubmit";
import { catNotice } from "/src/lib/lobbyCat";
import "/src/styles/LobbyCode.css";

// The account API asks the bot for avatars and mention names; the static
// file written by /lobby-code is the fallback when it is unreachable.
const LOBBY_SOURCES = [`${ACCOUNT_API_URL}/discord/lobby`, "/lobby-code.json"];
const DISCORD_API_URL = "https://discord-api.master3307.org";
const REFRESH_INTERVAL = 30_000;

function resolveAvatarUrl(payload) {
  const objects = [
    payload,
    payload?.user,
    payload?.data,
    payload?.data?.user,
    payload?.discord_user,
    payload?.data?.discord_user,
  ];

  for (const object of objects) {
    const candidates = [
      object?.avatarUrl,
      object?.avatarURL,
      object?.avatar_url,
      object?.avatar?.url,
      object?.avatar,
    ];

    for (const candidate of candidates) {
      if (typeof candidate !== "string" || !candidate.trim()) {
        continue;
      }

      try {
        const url = new URL(candidate, `${DISCORD_API_URL}/`);

        if (
          (candidate.startsWith("https://") ||
            candidate.startsWith("http://") ||
            candidate.startsWith("/")) &&
          (url.protocol === "https:" || url.protocol === "http:")
        ) {
          return url.href;
        }
      } catch {
        // Try the next candidate.
      }
    }
  }

  return null;
}

function getUpdatedDate(lobby) {
  if (!lobby) {
    return null;
  }

  if (typeof lobby.updatedAt === "string") {
    const date = new Date(lobby.updatedAt);

    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  if (
    lobby.updatedAtUnix !== null &&
    lobby.updatedAtUnix !== undefined &&
    Number.isFinite(Number(lobby.updatedAtUnix))
  ) {
    const date = new Date(Number(lobby.updatedAtUnix) * 1000);

    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
}

function formatRelative(date, language) {
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const units = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3600],
    ["minute", 60],
  ];
  const format = new Intl.RelativeTimeFormat(language, { numeric: "auto" });

  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return format.format(Math.round(seconds / size), unit);
    }
  }

  return format.format(0, "minute");
}

async function fetchLobby(signal) {
  let lastStatus = null;

  for (const url of LOBBY_SOURCES) {
    try {
      const response = await fetch(url, { cache: "no-store", signal });

      if (!response.ok) {
        lastStatus = response.status;
        continue;
      }

      return { data: await response.json() };
    } catch (error) {
      if (error.name === "AbortError") throw error;
    }
  }

  return { status: lastStatus };
}

export default function LobbyCode() {
  const { t, i18n } = useTranslation("lobby-code");

  const [lobby, setLobby] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [avatar, setAvatar] = useState(null);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [copyStatus, setCopyStatus] = useState("idle");
  // Bumped after a code is posted from the website, to reload right away.
  const [reloadToken, setReloadToken] = useState(0);
  const [submitOpen, setSubmitOpen] = useState(false);

  const copyTimerRef = useRef(null);
  const mountedRef = useRef(false);

  const updaterId = lobby?.updatedBy?.id;
  const botAvatar =
    typeof lobby?.updatedBy?.avatarUrl === "string"
      ? lobby.updatedBy.avatarUrl
      : null;
  const avatarSrc = botAvatar || avatar;
  const updaterName =
    lobby?.updatedBy?.displayName ||
    lobby?.updatedBy?.username ||
    t("unknownUser");

  const updaterUsername = lobby?.updatedBy?.username;
  const updatedDate = getUpdatedDate(lobby);
  const code = typeof lobby?.code === "string" ? lobby.code : "";

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      clearTimeout(copyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer;
    let stopped = false;

    async function loadLobby() {
      try {
        const { data, status } = await fetchLobby(controller.signal);

        if (data === undefined) {
          if (!stopped) {
            setFetchError(
              status
                ? { key: "errors.requestFailed", values: { status } }
                : { key: "errors.loadFailed" },
            );
          }
          return;
        }

        if (!data || typeof data !== "object" || Array.isArray(data)) {
          if (!stopped) {
            setFetchError({
              key: "errors.invalidResponse",
            });
          }
          return;
        }

        if (data.code != null && typeof data.code !== "string") {
          if (!stopped) {
            setFetchError({
              key: "errors.invalidCode",
            });
          }
          return;
        }

        if (!stopped) {
          setLobby(data);
          setFetchError(null);
        }
      } catch (error) {
        if (!stopped && error.name !== "AbortError") {
          setFetchError({
            key: "errors.loadFailed",
          });
        }
      } finally {
        if (!stopped) {
          setLoading(false);
          timer = setTimeout(loadLobby, REFRESH_INTERVAL);
        }
      }
    }

    loadLobby();

    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [reloadToken]);

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;

    setAvatar(null);
    setAvatarFailed(false);

    if (!updaterId || botAvatar) {
      return () => {
        stopped = true;
        controller.abort();
      };
    }

    async function loadAvatar() {
      try {
        const response = await fetch(
          `${DISCORD_API_URL}/${encodeURIComponent(updaterId)}`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          throw new Error(`Avatar request failed (${response.status}).`);
        }

        const data = await response.json();

        if (!stopped) {
          setAvatar(resolveAvatarUrl(data));
        }
      } catch (error) {
        if (!stopped && error.name !== "AbortError") {
          setAvatarFailed(true);
        }
      }
    }

    loadAvatar();

    return () => {
      stopped = true;
      controller.abort();
    };
  }, [updaterId, botAvatar]);

  useEffect(() => {
    clearTimeout(copyTimerRef.current);
    setCopyStatus("idle");
  }, [code]);

  async function copyLobbyCode() {
    if (!code || copyStatus === "copying") {
      return;
    }

    clearTimeout(copyTimerRef.current);
    setCopyStatus("copying");

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard access is unavailable.");
      }

      await navigator.clipboard.writeText(code);

      if (!mountedRef.current) {
        return;
      }

      setCopyStatus("copied");
      catNotice("lobby-copied");
    } catch {
      if (!mountedRef.current) {
        return;
      }

      setCopyStatus("error");
    }

    copyTimerRef.current = setTimeout(() => {
      setCopyStatus("idle");
    }, 2500);
  }

  const copyLabel =
    copyStatus === "copied"
      ? t("copyButton.copied")
      : copyStatus === "error"
        ? t("copyButton.retry")
        : copyStatus === "copying"
          ? t("copyButton.copying")
          : t("copyButton.copy");

  const language = i18n.resolvedLanguage || i18n.language || undefined;
  const description =
    typeof lobby?.description === "string" ? lobby.description.trim() : "";

  return (
    <section className="lobby-panel" aria-label={t("currentLobbyLabel")}>
      <div className="lobby-panel__head">
        <label className="lobby-label" htmlFor="lobby-code-field">
          {t("lobbyCodeLabel")}
        </label>

        {code && (
          <span className="lobby-live">
            <span className="lobby-live__dot" aria-hidden="true" />
            {t("activeLabel", { defaultValue: "Active" })}
          </span>
        )}
      </div>

      <div className={`lobby-code-row${code ? "" : " lobby-code-row--empty"}`}>
        <input
          id="lobby-code-field"
          className="lobby-code-field"
          type="text"
          value={code}
          placeholder={
            loading ? t("loadingPlaceholder") : t("noActiveLobbyPlaceholder")
          }
          readOnly
          spellCheck={false}
          autoComplete="off"
          onFocus={(event) => event.currentTarget.select()}
        />

        <button
          className={`lobby-copy-button${copyStatus === "copied" ? " is-copied" : ""}`}
          type="button"
          onClick={copyLobbyCode}
          disabled={!code || copyStatus === "copying"}
          aria-label={
            copyStatus === "copied"
              ? t("copyButton.copiedAriaLabel")
              : t("copyButton.copyAriaLabel")
          }
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            {copyStatus === "copied" ? "check" : "content_copy"}
          </span>
          <span>{copyLabel}</span>
        </button>
      </div>

      {description && (
        <p className="lobby-description">
          <DiscordText text={description} mentions={lobby?.mentions} />
        </p>
      )}

      {(lobby?.updatedBy || updatedDate) && (
        <footer className="lobby-meta">
          {lobby?.updatedBy &&
            (avatarSrc && !avatarFailed ? (
              <img
                className="lobby-avatar"
                src={avatarSrc}
                alt=""
                width="36"
                height="36"
                draggable={false}
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              <span
                className="lobby-avatar lobby-avatar-fallback"
                aria-hidden="true"
              >
                {(updaterName.match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase()}
              </span>
            ))}

          <div className="lobby-meta__text">
            {lobby?.updatedBy && (
              <span className="lobby-meta__by">
                {t("updatedByLabel")}{" "}
                <strong
                  className="lobby-updater-name"
                  title={updaterUsername ? `@${updaterUsername}` : undefined}
                >
                  {updaterName}
                </strong>
              </span>
            )}

            {updatedDate && (
              <time
                className="lobby-meta__time"
                dateTime={updatedDate.toISOString()}
                title={updatedDate.toLocaleString(language, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              >
                {formatRelative(updatedDate, language)}
              </time>
            )}
          </div>

          {!submitOpen && (
            <div className="lobby-meta__actions">
              <LobbySubmitToggle onClick={() => setSubmitOpen(true)} />
            </div>
          )}
        </footer>
      )}

      {fetchError && (
        <p className="lobby-error" role="status">
          {lobby
            ? t("errors.refreshFailed")
            : t(fetchError.key, fetchError.values || {})}
        </p>
      )}

      {!(lobby?.updatedBy || updatedDate) && !submitOpen && (
        <div className="lobby-meta lobby-meta--actions-only">
          <LobbySubmitToggle onClick={() => setSubmitOpen(true)} />
        </div>
      )}

      <LobbySubmit
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        onPosted={() => setReloadToken((value) => value + 1)}
      />

      <p
        className={`lobby-copy-status${copyStatus === "error" ? "" : " visually-hidden"}`}
        role="status"
        aria-live="polite"
      >
        {copyStatus === "copied"
          ? t("copyStatus.success")
          : copyStatus === "error"
            ? t("copyStatus.error")
            : ""}
      </p>
    </section>
  );
}
