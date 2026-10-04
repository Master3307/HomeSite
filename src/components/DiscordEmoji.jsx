import { useEffect, useRef } from "react";
import twemoji from "@twemoji/api";

const twemojiOptions = {
  base: "/twemoji/",
  folder: "svg",
  ext: ".svg",
  className: "discord-emoji",
};

export function DiscordEmoji({ children, className }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;

    twemoji.parse(ref.current, twemojiOptions);
  }, [children]);

  return (
    <span ref={ref} className={className}>
      {children}
    </span>
  );
}
