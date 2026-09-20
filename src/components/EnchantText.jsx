import { useEffect, useState } from "react";

const SGA_CHARS = [
  "ᔑ", "ʖ", "ᓵ", "↸", "ᒷ", "⎓", "⊣", "⍑", "╎", "⋮",
  "ꖌ", "ꖎ", "ᒲ", "リ", "𝙹", "ᑑ", "∷", "ᓭ", "ℸ", "⚍",
  "⍊", "∴", "⨅"
];

function randomSGAChar() {
  return SGA_CHARS[Math.floor(Math.random() * SGA_CHARS.length)];
}

function obfuscateText(text, preserveSpaces = true) {
  return text
    .split("")
    .map((ch) => {
      if (preserveSpaces && ch === " ") return " ";
      return randomSGAChar();
    })
    .join("");
}

export default function EnchantParagraph({
  text,
  obfuscated = false,
  interval = 60,
  className = "",
  as: Tag = "p",
  preserveSpaces = true,
}) {
  const [, setScrambleTick] = useState(0);

  const safeText = text ?? "";

  useEffect(() => {
    if (!obfuscated) return undefined;

    const id = window.setInterval(() => {
      setScrambleTick((tick) => tick + 1);
    }, interval);

    return () => window.clearInterval(id);
  }, [obfuscated, interval]);

  const displayText = obfuscated
    ? obfuscateText(safeText, preserveSpaces)
    : safeText;

  return (
    <Tag className={`enchant-text ${className}`.trim()}>
      {displayText}
    </Tag>
  );
}