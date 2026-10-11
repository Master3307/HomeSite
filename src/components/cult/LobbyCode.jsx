import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "/src/styles/LobbyCode.css";
import "/src/styles/LobbyCat.css";

const LOBBY_URL = "/lobby-code.json";
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

export default function BobbingCatCard() {
  const { t, i18n } = useTranslation("lobby-code");

  const hitboxRef = useRef(null);
  const petRef = useRef(null);
  const animationRef = useRef(null);

  const heartIdRef = useRef(0);
  const heartTimersRef = useRef(new Set());
  const [hearts, setHearts] = useState([]);

  const [lobby, setLobby] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [avatar, setAvatar] = useState(null);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [copyStatus, setCopyStatus] = useState("idle");

  const copyTimerRef = useRef(null);
  const mountedRef = useRef(false);

  const updaterId = lobby?.updatedBy?.id;
  const updaterName =
    lobby?.updatedBy?.displayName ||
    lobby?.updatedBy?.username ||
    t("unknownUser");

  const updaterUsername = lobby?.updatedBy?.username;
  const updatedDate = getUpdatedDate(lobby);
  const code = typeof lobby?.code === "string" ? lobby.code : "";

  useEffect(() => {
    mountedRef.current = true;
    const heartTimers = heartTimersRef.current;

    return () => {
      mountedRef.current = false;

      animationRef.current?.cancel();
      animationRef.current = null;

      heartTimers.forEach(clearTimeout);
      heartTimers.clear();

      clearTimeout(copyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer;
    let stopped = false;

    async function loadLobby() {
      try {
        const response = await fetch(LOBBY_URL, {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          if (!stopped) {
            setFetchError({
              key: "errors.requestFailed",
              values: { status: response.status },
            });
          }
          return;
        }

        const data = await response.json();

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
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;

    setAvatar(null);
    setAvatarFailed(false);

    if (!updaterId) {
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
  }, [updaterId]);

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

  function createHeart() {
    const hitbox = hitboxRef.current;

    if (!hitbox) {
      return;
    }

    const rect = hitbox.getBoundingClientRect();
    const id = heartIdRef.current++;

    const heart = {
      id,
      x: rect.width * (0.2 + Math.random() * 0.6),
      y: rect.height * 0.3,
      drift: 0,
      rotation: 0,
    };

    setHearts((current) => [...current, heart]);

    const timer = setTimeout(() => {
      setHearts((current) => current.filter((item) => item.id !== id));
      heartTimersRef.current.delete(timer);
    }, 2700);

    heartTimersRef.current.add(timer);
  }

  function petCat() {
    createHeart();

    const element = petRef.current;

    if (
      !element ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    // Continue from the visible pose when clicked repeatedly.
    const currentTransform = getComputedStyle(element).transform;
    const startingTransform =
      currentTransform === "none" ? "scale(1, 1)" : currentTransform;

    animationRef.current?.cancel();

    const animation = element.animate(
      [
        {
          transform: startingTransform,
          offset: 0,
          easing: "cubic-bezier(0.2, 0.7, 0.3, 1)",
        },
        {
          transform: "scale(1.1, 0.74)",
          offset: 0.22,
          easing: "cubic-bezier(0.3, 0, 0.65, 1)",
        },
        {
          transform: "scale(1.085, 0.77)",
          offset: 0.32,
          easing: "cubic-bezier(0.16, 0.8, 0.3, 1)",
        },
        {
          transform: "scale(0.99, 1.025)",
          offset: 0.72,
          easing: "cubic-bezier(0.35, 0, 0.55, 1)",
        },
        {
          transform: "scale(1, 1)",
          offset: 1,
        },
      ],
      {
        duration: 460,
        iterations: 1,
        fill: "none",
      },
    );

    animationRef.current = animation;

    animation.onfinish = () => {
      if (animationRef.current === animation) {
        animationRef.current = null;
      }
    };
  }

  function handleKeyDown(event) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();

    if (!event.repeat) {
      petCat();
    }
  }

  const copyLabel =
    copyStatus === "copied"
      ? t("copyButton.copied")
      : copyStatus === "error"
        ? t("copyButton.retry")
        : copyStatus === "copying"
          ? t("copyButton.copying")
          : t("copyButton.copy");

  return (
    <div className="lobby-cat-wrap">
      <section
        className="card cat-card lobby-cat-card lobby-panel"
        aria-label={t("currentLobbyLabel")}
      >
        <label className="lobby-label" htmlFor="lobby-code-field">
          {t("lobbyCodeLabel")}
        </label>

        <div className="lobby-code-row">
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
            className="lobby-copy-button"
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

        {typeof lobby?.description === "string" &&
          lobby.description.trim() && (
            <p className="lobby-description">{lobby.description}</p>
          )}

        {lobby?.updatedBy && (
          <div className="lobby-updater">
            {avatar && !avatarFailed ? (
              <img
                className="lobby-avatar"
                src={avatar}
                alt=""
                draggable={false}
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              <span
                className="lobby-avatar lobby-avatar-fallback"
                aria-hidden="true"
              >
                {Array.from(updaterName)[0]?.toUpperCase() || "?"}
              </span>
            )}

            <div className="lobby-updater-info">
              <span className="lobby-updated-by">{t("updatedByLabel")}</span>
              <span className="lobby-updater-name">{updaterName}</span>

              {updaterUsername && (
                <span className="lobby-updater-username">
                  @{updaterUsername}
                </span>
              )}
            </div>
          </div>
        )}

        {updatedDate && (
          <p className="lobby-timestamp">
            <span className="material-symbols-outlined" aria-hidden="true">
              schedule
            </span>
            <span>
              {t("updatedAtLabel")}{" "}
              <time
                dateTime={updatedDate.toISOString()}
                title={updatedDate.toISOString()}
              >
                {updatedDate.toLocaleString(
                  i18n.resolvedLanguage || i18n.language || undefined,
                  {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  },
                )}
              </time>
            </span>
          </p>
        )}

        {fetchError && (
          <p className="lobby-error" role="status">
            {lobby
              ? t("errors.refreshFailed")
              : t(fetchError.key, fetchError.values || {})}
          </p>
        )}

        <p className="lobby-copy-status" role="status" aria-live="polite">
          {copyStatus === "copied"
            ? t("copyStatus.success")
            : copyStatus === "error"
              ? t("copyStatus.error")
              : ""}
        </p>
      </section>

      <div
        ref={hitboxRef}
        className="cat-hitbox"
        role="button"
        tabIndex={0}
        aria-label={t("petCatLabel")}
        onClick={petCat}
        onKeyDown={handleKeyDown}
      >
        <div className="cat-idle-animation">
          <div ref={petRef} className="cat-pet-animation">
            <img
              src="/img/blankCat.svg"
              className="bobbing-cat"
              alt=""
              draggable={false}
            />
          </div>
        </div>

        {/* Outside the squishing wrappers, so hearts don't distort. */}
        <div className="cat-hearts" aria-hidden="true">
          {hearts.map((heart) => (
            <span
              key={heart.id}
              className="cat-heart-position"
              style={{
                left: heart.x,
                top: heart.y,
                "--heart-drift": `${heart.drift}px`,
                "--heart-rotation": `${heart.rotation}deg`,
              }}
            >
              <img
                src="/img/sparkly.svg"
                className="cat-petting-heart"
                alt=""
                draggable={false}
              />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
