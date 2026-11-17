import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import twemoji from "@twemoji/api";
import { getCurrentAccount } from "/src/lib/account";
import { CAT_NOTICE_EVENT, CAT_SAY_EVENT } from "/src/lib/lobbyCat";
import { createLobbyCatBrain } from "/src/lib/lobbyCatBrain/brain";
import { useCatSpeech } from "./useCatSpeech";
import { BONGO_TAP_EVENT, loadLobbyStyle, loadWardrobe, useCatalog } from "/src/lib/bongo";
import { BongoCat, GameIcon } from "/src/components/bongo/BongoRender";
import { outfitLayers, unionBounds } from "/shared/bongo-design.mjs";
import { useUrlParam } from "/src/lib/urlState";
import { countPet, countTap, GOODBYE_KEY } from "/src/lib/members";
import "/src/styles/LobbyCat.css";
import "/src/styles/bongo.css";

// Only editors open it; loaded on demand.
const LobbyWardrobe = lazy(() => import("/src/components/bongo/LobbyWardrobe"));

const CAT_WIDTH = 132;
const CAT_WIDTH_SMALL = 108;
const TAP_MS = 110;
const LOBBY_STYLE_EVENT = "homesite:lobby-style";

/*
 * The lobby cat wears what editors chose (server: services/lobbyStyle.cjs)
 * and taps along with every click and key press on the site, left, right,
 * left … (lib/bongo.js installBongoTap). Without imported game assets the
 * cat isn't shown at all.
 */
function useLobbyLook() {
  const { catalog, loading } = useCatalog();
  const [style, setStyle] = useState(null);

  const refresh = useCallback(() => {
    loadLobbyStyle()
      .then(setStyle)
      .catch(() => setStyle((current) => current ?? { available: false }));
  }, []);

  useEffect(() => {
    if (!catalog) return undefined;
    refresh();
    const onChange = (event) => (event.detail ? setStyle({ available: true, ...event.detail }) : refresh());
    window.addEventListener(LOBBY_STYLE_EVENT, onChange);
    // Look again every few minutes (another editor may change it).
    const poll = setInterval(refresh, 5 * 60_000);
    return () => {
      window.removeEventListener(LOBBY_STYLE_EVENT, onChange);
      clearInterval(poll);
    };
  }, [catalog, refresh]);

  // A random look or a temporary outfit ends at a known moment.
  useEffect(() => {
    if (!style?.until) return undefined;
    const wait = Math.max(1000, Math.min(style.until - Date.now() + 500, 2 ** 31 - 1));
    const timer = setTimeout(refresh, wait);
    return () => clearTimeout(timer);
  }, [style, refresh]);

  return { catalog, loading, style };
}

const TWEMOJI_OPTIONS = {
  base: "/twemoji/",
  folder: "svg",
  ext: ".svg",
  className: "discord-emoji",
};

const BRAIN_TICK_MS = 5_000;

export default function LobbyCat() {
  const { catalog, style } = useLobbyLook();
  if (!catalog || !style?.available) return null;
  return <BobbingCatCard catalog={catalog} outfit={style.outfit} />;
}

const GOODBYE_LINES = [
  "Oh… you're leaving for good? 😿",
  "I'll miss you. Even though I won't remember you at all. That's how it works now.",
  "Goodbye, stranger. Take care out there. 🐾",
];

function BobbingCatCard({ catalog, outfit }) {
  const { t } = useTranslation("lobby-code");
  const { t: tCat } = useTranslation("lobby-cat");
  const [pose, setPose] = useState("up");
  const [editor, setEditor] = useState(false);
  // ?lobby=wardrobe (or wardrobe-auto, its second tab): the wardrobe, for FDC editors.
  const [lobbyParam, setLobbyParam] = useUrlParam("lobby");
  const wardrobeOpen = Boolean(lobbyParam?.startsWith("wardrobe"));
  const setWardrobeOpen = (open) => setLobbyParam(open ? "wardrobe" : null);
  const [small, setSmall] = useState(() => window.matchMedia("(max-width: 900px)").matches);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const onChange = () => setSmall(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  const catWidth = small ? CAT_WIDTH_SMALL : CAT_WIDTH;

  // Tap along with every click / key press on the site.
  useEffect(() => {
    let timer = null;
    const onTap = (event) => {
      clearTimeout(timer);
      countTap();
      setPose(event.detail?.side === "right" ? "right" : "left");
      timer = setTimeout(() => setPose("up"), TAP_MS);
    };
    window.addEventListener(BONGO_TAP_EVENT, onTap);
    return () => {
      window.removeEventListener(BONGO_TAP_EVENT, onTap);
      clearTimeout(timer);
    };
  }, []);

  // FDC editors can dress the cat.
  useEffect(() => {
    let alive = true;
    getCurrentAccount()
      .then((account) => (account ? loadWardrobe() : null))
      .then((wardrobe) => alive && setEditor(Boolean(wardrobe)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // The cat's body rests on the line; the bongos (and tapping paws) hang in front of the card.
  const allLayers = ["up", "left", "right"].flatMap((name) =>
    outfitLayers(catalog, outfit, name === "up" ? {} : { [name]: "down" }),
  );
  const box = unionBounds(catalog, allLayers);
  const skinBody = unionBounds(catalog, outfitLayers(catalog, { skin: outfit?.skin }, {}));
  const scale = catWidth / box.w;
  const aboveLine = Math.max(10, (skinBody.y + skinBody.h - box.y) * scale - 6 * scale);

  const hitboxRef = useRef(null);
  const petRef = useRef(null);
  const animationRef = useRef(null);
  const bubbleRef = useRef(null);

  const heartIdRef = useRef(0);
  const heartTimersRef = useRef(new Set());
  const [hearts, setHearts] = useState([]);

  // Speech queue + the brain that decides what to say (lib/lobbyCatBrain).
  const speech = useCatSpeech();
  const { say, ask, busy } = speech;
  const brainRef = useRef(null);
  const tCatRef = useRef(tCat);

  useEffect(() => {
    tCatRef.current = tCat;
  });

  useEffect(() => {
    const brain = createLobbyCatBrain({
      getT: () => tCatRef.current,
      speak: say,
      ask,
      isBusy: busy,
    });
    brainRef.current = brain;

    let active = true;
    // Right after someone deleted their account (CultSettings): a sad goodbye instead of a greeting.
    let goodbye = false;
    try {
      goodbye = sessionStorage.getItem(GOODBYE_KEY) === "1";
      sessionStorage.removeItem(GOODBYE_KEY);
    } catch {
      // storage blocked
    }
    if (goodbye) {
      say(GOODBYE_LINES);
    } else {
      getCurrentAccount()
        .catch(() => null)
        .then((account) => {
          if (active) brain.arrive(account);
        });
    }

    const tick = setInterval(() => brain.tick(), BRAIN_TICK_MS);

    function onSay(event) {
      if (event.detail?.text) say([event.detail.text]);
    }
    window.addEventListener(CAT_SAY_EVENT, onSay);

    function onNotice(event) {
      if (event.detail?.type) brain.notice(event.detail.type, event.detail.detail);
    }
    window.addEventListener(CAT_NOTICE_EVENT, onNotice);

    return () => {
      active = false;
      clearInterval(tick);
      window.removeEventListener(CAT_SAY_EVENT, onSay);
      window.removeEventListener(CAT_NOTICE_EVENT, onNotice);
      brain.dispose();
      brainRef.current = null;
    };
  }, [say, ask, busy]);

  // Emoji in the bubble look like the rest of the site.
  const currentId = speech.current?.id;
  useEffect(() => {
    if (currentId && bubbleRef.current) twemoji.parse(bubbleRef.current, TWEMOJI_OPTIONS);
  }, [currentId]);

  useEffect(() => {
    const heartTimers = heartTimersRef.current;

    return () => {
      animationRef.current?.cancel();
      animationRef.current = null;

      heartTimers.forEach(clearTimeout);
      heartTimers.clear();
    };
  }, []);

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
    countPet();
    brainRef.current?.pet();

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

  return (
    <div
      className="lobby-cat-wrap"
      style={{ "--lobby-cat-width": `${catWidth}px`, "--lobby-cat-height": `${aboveLine}px`, width: catWidth, height: aboveLine }}
    >
      <span className="visually-hidden" aria-live="polite">
        {speech.current?.text ?? ""}
      </span>

      {/* Outside the hitbox: answer buttons can't live inside a button. */}
      {speech.current && (
        <div
          key={speech.current.id}
          ref={bubbleRef}
          className={[
            "cat-speech",
            speech.current.leaving && "cat-speech--leaving",
            speech.current.choices && "cat-speech--ask",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <p className="cat-speech__text">{speech.current.text}</p>

          {speech.current.choices && (
            <div className="cat-speech__choices" role="group" aria-label={speech.current.text}>
              {speech.current.choices.map((choice, index) => (
                <button
                  key={choice.id}
                  type="button"
                  className="cat-speech__choice"
                  style={{ "--i": index }}
                  disabled={speech.current.leaving}
                  onClick={() => speech.answer(speech.current.id, choice.id)}
                >
                  <span aria-hidden="true">{choice.emoji}</span>
                  {choice.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div
        ref={hitboxRef}
        className="cat-hitbox"
        role="button"
        tabIndex={0}
        aria-label={t("petCatLabel")}
        onClick={petCat}
        onKeyDown={handleKeyDown}
        // Lingering on the cat without petting it gets a little tease.
        onPointerEnter={(event) => event.pointerType === "mouse" && brainRef.current?.hover(true)}
        onPointerLeave={() => brainRef.current?.hover(false)}
        onPointerDown={() => brainRef.current?.hover(false)}
      >
        <div className="cat-idle-animation">
          <div ref={petRef} className="cat-pet-animation">
            <BongoCat catalog={catalog} outfit={outfit} pose={pose} width={catWidth} box={box} className="bobbing-cat" />
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
                src="/img/bongo-cat/sparkly.svg"
                className="cat-petting-heart"
                alt=""
                draggable={false}
              />
            </span>
          ))}
        </div>
      </div>
      {editor && (
        <button type="button" className="lobby-cat-dress" onClick={() => setWardrobeOpen(true)} title="Dress the lobby cat">
          <GameIcon catalog={catalog} name="outfits" fallback="checkroom" />
          <span className="visually-hidden">Dress the lobby cat</span>
        </button>
      )}
      {wardrobeOpen && editor && (
        <Suspense fallback={null}>
          <LobbyWardrobe
            catalog={catalog}
            onClose={() => setWardrobeOpen(false)}
            onChanged={(current) => window.dispatchEvent(new CustomEvent(LOBBY_STYLE_EVENT, { detail: current }))}
          />
        </Suspense>
      )}
    </div>
  );
}
