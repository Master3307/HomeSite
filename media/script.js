// card tilt. kinda stolen lol
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
  const candidates = ["/media/cdn/clown.mp3"];
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
  const candidates = ["../../media/cdn/confuse.mp3"];

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

function getPathLanguage(path) {
  if (path.startsWith("/de/") || path === "/de") return "de";
  if (path.startsWith("/en/") || path === "/en") return "en";
  return null;
}

function buildLanguagePath(path, lang) {
  if (path.startsWith("/de/")) return path.replace("/de/", `/${lang}/`);
  if (path === "/de") return `/${lang}`;
  if (path.startsWith("/en/")) return path.replace("/en/", `/${lang}/`);
  if (path === "/en") return `/${lang}`;
  return `/${lang}${path.startsWith("/") ? path : "/" + path}`;
}

function switchLanguage(lang) {
  localStorage.setItem(LANGUAGE_KEY, lang);

  const newPath = buildLanguagePath(window.location.pathname, lang);
  window.location.href = newPath + window.location.search + window.location.hash;
}

document.addEventListener("DOMContentLoaded", () => {
  const select = document.getElementById("language-select");
  const path = window.location.pathname;

  const currentLang = getPathLanguage(path);
  const savedLang = localStorage.getItem(LANGUAGE_KEY);

  if (select) {
    select.value = currentLang || savedLang || "en";

    select.addEventListener("change", (e) => {
      switchLanguage(e.target.value);
    });
  }

  // Redirect only if URL has no language yet and a preference exists
  if (!currentLang && (savedLang === "de" || savedLang === "en")) {
    const newPath = buildLanguagePath(path, savedLang);
    window.location.href = newPath + window.location.search + window.location.hash;
  }
});


// theme picker
const THEME_KEY = "preferredTheme";

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

function switchTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}

document.addEventListener("DOMContentLoaded", () => {
  const select = document.getElementById("theme-select");
  const savedTheme = localStorage.getItem(THEME_KEY);

  const theme =
    savedTheme === "light" || savedTheme === "dark"
      ? savedTheme
      : "dark";

  applyTheme(theme);

  if (select) {
    select.value = theme;
  }
});