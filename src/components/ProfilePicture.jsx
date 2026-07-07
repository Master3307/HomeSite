import { useEffect, useMemo, useState } from "react";

function getConnectionProfile() {
  const connection =
    navigator.connection ||
    navigator.mozConnection ||
    navigator.webkitConnection;

  if (!connection) return "unknown";
  if (connection.saveData) return "save-data";

  switch (connection.effectiveType) {
    case "slow-2g":
    case "2g":
      return "slow";
    case "3g":
      return "medium";
    case "4g":
      return "fast";
    default:
      return "unknown";
  }
}

export default function ProfilePicture() {
  const [gifReady, setGifReady] = useState(false);
  const [showGif, setShowGif] = useState(false);
  const [thumbFormat, setThumbFormat] = useState("webp");

  const profile = useMemo(() => getConnectionProfile(), []);

  useEffect(() => {
    if (profile === "save-data" || profile === "slow") return;

    const gif = new Image();
    gif.src = "/img/pfp/MrKoby07animated.gif";

    const ready = () => {
      setGifReady(true);
      setShowGif(true);
    };

    if (gif.decode) {
      gif.decode().then(ready).catch(() => {
        gif.onload = ready;
      });
    } else {
      gif.onload = ready;
    }
  }, [profile]);

  const thumbSrc =
    thumbFormat === "webp"
      ? "/img/pfp/MrKoby4purple-md.webp"
      : "/img/pfp/MrKoby4purple-md.jpg";

  const thumbSrcSet =
    thumbFormat === "webp"
      ? "/img/pfp/MrKoby4purple-sm.webp 320w, /img/pfp/MrKoby4purple-md.webp 640w"
      : "/img/pfp/MrKoby4purple-sm.jpg 320w, /img/pfp/MrKoby4purple-md.jpg 640w";

  return (
    <img
      className="pfp"
      src={showGif && gifReady ? "/img/pfp/MrKoby07animated.gif" : thumbSrc}
      srcSet={showGif && gifReady ? undefined : thumbSrcSet}
      sizes={showGif && gifReady ? undefined : "120px"}
      width={120}
      height={120}
      alt="Profile Picture"
      draggable={false}
      decoding="async"
      onDragStart={(e) => e.preventDefault()}
      onMouseEnter={() => {
        if (gifReady) setShowGif(true);
      }}
      onError={(e) => {
        if (!showGif && thumbFormat === "webp") {
          setThumbFormat("jpg");
          return;
        }

        if (showGif) {
          setShowGif(false);
          setThumbFormat("jpg");
        }

        e.currentTarget.onerror = null;
      }}
    />
  );
}