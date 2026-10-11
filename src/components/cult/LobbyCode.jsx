import { useEffect, useRef, useState } from "react";

export default function BobbingCatCard() {
  const hitboxRef = useRef(null);
  const petRef = useRef(null);
  const animationRef = useRef(null);

  const heartIdRef = useRef(0);
  const heartTimersRef = useRef(new Set());
  const [hearts, setHearts] = useState([]);

  useEffect(() => {
    return () => {
      animationRef.current?.cancel();
      animationRef.current = null;

      heartTimersRef.current.forEach((timer) => {
        clearTimeout(timer);
      });

      heartTimersRef.current.clear();
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
      setHearts((current) =>
        current.filter((item) => item.id !== id),
      );

      heartTimersRef.current.delete(timer);
    }, 2700);

    heartTimersRef.current.add(timer);
  }

  function petCat(event) {
    createHeart(event);

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
      currentTransform === "none"
        ? "scale(1, 1)"
        : currentTransform;

    animationRef.current?.cancel();

    const animation = element.animate(
      [
        {
          transform: startingTransform,
          offset: 0,
          easing: "cubic-bezier(0.2, 0.7, 0.3, 1)",
        },

        // Deep, quick compression with a wider silhouette.
        {
          transform: "scale(1.1, 0.74)",
          offset: 0.22,
          easing: "cubic-bezier(0.3, 0, 0.65, 1)",
        },

        // Briefly linger near the compressed pose.
        {
          transform: "scale(1.085, 0.77)",
          offset: 0.32,
          easing: "cubic-bezier(0.16, 0.8, 0.3, 1)",
        },

        // Small rebound, not a big bounce.
        {
          transform: "scale(0.99, 1.025)",
          offset: 0.72,
          easing: "cubic-bezier(0.35, 0, 0.55, 1)",
        },

        // Settle back into place.
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
    <div className="card cat-card">
      <div
        ref={hitboxRef}
        className="cat-hitbox"
        role="button"
        tabIndex={0}
        aria-label="Pet the cat"
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
