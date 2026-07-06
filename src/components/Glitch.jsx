import { useEffect, useMemo, useState } from "react";

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
  const [displayText, setDisplayText] = useState(text);

  const safeText = useMemo(() => text ?? "", [text]);

  useEffect(() => {
    if (!obfuscated) {
      setDisplayText(safeText);
      return;
    }

    setDisplayText(obfuscateText(safeText, preserveSpaces));

    const id = window.setInterval(() => {
      setDisplayText(obfuscateText(safeText, preserveSpaces));
    }, interval);

    return () => window.clearInterval(id);
  }, [safeText, obfuscated, interval, preserveSpaces]);

  return (
    <Tag className={`enchant-text ${className}`.trim()}>
      {displayText}
    </Tag>
  );
}