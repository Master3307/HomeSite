// card tilt. kinda stolen lol
// check out https://stormxxboy.com/card/
function tiltCard(event) {
  const card = document.getElementById("card");
  if (!card) return;

  const cardRect = card.getBoundingClientRect();

  const cardCenterX = cardRect.left + cardRect.width / 2;
  const cardCenterY = cardRect.top + cardRect.height / 2;

  const mouseX = event.clientX;
  const mouseY = event.clientY;

  const rotateX = (mouseY - cardCenterY) / 50;
  const rotateY = (mouseX - cardCenterX) / 50;

  card.style.transition = "transform 0.05s ease";
  card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${-rotateY}deg)`;
}

function resetCard(event) {
  const card = document.getElementById("card");
  if (!card) return;
  card.style.transition = "transform 0.5s ease";
  card.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg)";
}

// clown
// allow multiple overlapping clown audio instances
const playingClownAudios = new Set();

async function clown() {
  const candidates = ["/assets/audio/clown.mp3"];
  for (const src of candidates) {
    try {
      const audio = new Audio(src);
      audio.preload = "auto";
      audio.volume = 0.26;

      // wait for metadata so we can set start time at ~2%
      await new Promise((resolve, reject) => {
        const onMeta = () => {
          cleanup();
          resolve();
        };
        const onErr = (e) => {
          cleanup();
          reject(e);
        };
        const cleanup = () => {
          audio.removeEventListener("loadedmetadata", onMeta);
          audio.removeEventListener("error", onErr);
        };
        audio.addEventListener("loadedmetadata", onMeta);
        audio.addEventListener("error", onErr);
      });

      const start = Math.max(0, audio.duration * 0.13 || 0);
      // ensure we don't set currentTime to >= duration
      audio.currentTime = Math.min(start, Math.max(0, audio.duration - 0.01));

      // keep track so we can clean up references when ended
      playingClownAudios.add(audio);
      const removeAudio = () => playingClownAudios.delete(audio);
      audio.addEventListener("ended", removeAudio);
      audio.addEventListener("error", removeAudio);

      const p = audio.play();
      if (p && typeof p.catch === "function") return; // success
    } catch (err) {
      console.warn("Playback failed for", src, err);
      // try next candidate
    }
  }
  console.warn("All playback attempts failed for clown audio.");
}

// confused
const playingConfusedAudios = new Set();

async function confused() {
  const candidates = ["/assets/audio/confuse.mp3"];

  for (const src of candidates) {
    try {
      const audio = new Audio(src);
      audio.preload = "auto";
      audio.volume = 0.26;

      await new Promise((resolve, reject) => {
        const onMeta = () => {
          cleanup();
          resolve();
        };

        const onErr = (e) => {
          cleanup();
          reject(e);
        };

        const cleanup = () => {
          audio.removeEventListener("loadedmetadata", onMeta);
          audio.removeEventListener("error", onErr);
        };

        audio.addEventListener("loadedmetadata", onMeta);
        audio.addEventListener("error", onErr);
      });

      const start = Math.max(0, audio.duration * 0.13 || 0);
      audio.currentTime = Math.min(start, Math.max(0, audio.duration - 0.01));

      playingConfusedAudios.add(audio);

      const removeAudio = () => {
        playingConfusedAudios.delete(audio);
      };

      audio.addEventListener("ended", removeAudio);
      audio.addEventListener("error", removeAudio);

      const baseVolume = 0.26;
      const fadeDuration = 0.35;
      let fading = false;

      audio.addEventListener("timeupdate", () => {
        if (fading) return;

        const timeLeft = audio.duration - audio.currentTime;
        if (timeLeft <= fadeDuration) {
          fading = true;

          const steps = 12;
          const intervalMs = (fadeDuration * 1000) / steps;
          let step = 0;

          const fadeInterval = setInterval(() => {
            step++;
            const progress = step / steps;
            audio.volume = Math.max(0, baseVolume * (1 - progress));

            if (step >= steps || audio.paused || audio.ended) {
              clearInterval(fadeInterval);
            }
          }, intervalMs);
        }
      });

      const p = audio.play();
      if (p && typeof p.catch === "function") {
        await p;
      }

      return;
    } catch (err) {
      console.warn("Playback failed for", src, err);
    }
  }

  console.warn("All playback attempts failed for confused audio.");
}


// language selector
const LANGUAGE_KEY = "preferredLanguage";
let availableLanguages = [];

function isValidLanguage(lang) {
  return availableLanguages.includes(lang);
}

function getPathLanguage(path) {
  const parts = path.split("/").filter(Boolean);
  return parts.length && isValidLanguage(parts[0]) ? parts[0] : null;
}

function buildLanguagePath(path, lang) {
  const parts = path.split("/").filter(Boolean);

  if (parts.length && isValidLanguage(parts[0])) {
    parts[0] = lang;
  } else {
    parts.unshift(lang);
  }

  return "/" + parts.join("/");
}

function switchLanguage(lang) {
  if (!isValidLanguage(lang)) return;

  localStorage.setItem(LANGUAGE_KEY, lang);

  const newPath = buildLanguagePath(window.location.pathname, lang);
  const target = newPath + window.location.search + window.location.hash;

  if (target !== window.location.pathname + window.location.search + window.location.hash) {
    window.location.href = target;
  }
}

async function initLanguagePicker() {
  const select = document.getElementById("language-select");
  if (!select) return;

  const path = window.location.pathname;
  const savedLang = localStorage.getItem(LANGUAGE_KEY);

  try {
    const response = await fetch("/locales/lang-options.json");
    if (!response.ok) {
      throw new Error(`Failed to load languages: ${response.status}`);
    }

    const languages = await response.json();
    if (!Array.isArray(languages) || languages.length === 0) {
      throw new Error("Language list is empty");
    }

    availableLanguages = languages.map(({ value: code }) => code);

    select.innerHTML = "";

    languages.forEach(({ value: code, label }) => {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = label;
      select.add(option);
    });

    const currentLang = getPathLanguage(path);
    const fallbackLang = isValidLanguage("en") ? "en" : availableLanguages[0];
    const activeLang =
      currentLang ||
      (savedLang && isValidLanguage(savedLang) ? savedLang : null) ||
      fallbackLang;

    if (!currentLang) {
      const normalized = buildLanguagePath(path, activeLang) + window.location.search + window.location.hash;
      window.location.replace(normalized);
      return;
    }

    select.value = activeLang;
    select.addEventListener("change", (e) => {
      switchLanguage(e.target.value);
    });
  } catch (error) {
    console.error("Failed to load language options:", error);
  }
}

document.addEventListener("DOMContentLoaded", initLanguagePicker);


// theme picker
const THEME_KEY = "preferredTheme";

function updateThemeIcon(theme) {
  const icon = document.getElementById("theme-icon");
  if (!icon) return;

  icon.textContent = theme === "light" ? "light_mode" : "dark_mode";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  updateThemeIcon(theme);
}

function switchTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}

document.addEventListener("DOMContentLoaded", () => {
  const select = document.getElementById("theme-select");
  const savedTheme = localStorage.getItem(THEME_KEY);
  const theme = savedTheme === "light" ? "light" : "dark";

  applyTheme(theme);

  if (select) {
    select.value = theme;
  }
});