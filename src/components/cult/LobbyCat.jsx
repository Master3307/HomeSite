import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import twemoji from "@twemoji/api";
import { getCurrentAccount } from "/src/lib/account";
import { CAT_NOTICE_EVENT, CAT_SAY_EVENT } from "/src/lib/lobbyCat";
import { createLobbyCatBrain } from "/src/lib/lobbyCatBrain/brain";
import { useCatSpeech } from "./useCatSpeech";
import "/src/styles/LobbyCat.css";

const TWEMOJI_OPTIONS = {
  base: "/twemoji/",
  folder: "svg",
  ext: ".svg",
  className: "discord-emoji",
};

const BRAIN_TICK_MS = 5_000;

export default function BobbingCatCard() {
  const { t } = useTranslation("lobby-code");
  const { t: tCat } = useTranslation("lobby-cat");

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
    getCurrentAccount()
      .catch(() => null)
      .then((account) => {
        if (active) brain.arrive(account);
      });

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
    <div className="lobby-cat-wrap">
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
            <img
              src="/img/bongo-cat/blankCat.svg"
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
                src="/img/bongo-cat/sparkly.svg"
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
