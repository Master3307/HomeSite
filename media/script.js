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

// allow multiple overlapping clown audio instances
const playingClownAudios = new Set();

async function clown() {
  const candidates = ["media/clown.mp3", "media/cdn/clown.mp3"];
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

      // set start position to ~2% of duration
      const start = Math.max(0, audio.duration * 0.13 || 0);
      // ensure we don't set currentTime to >= duration
      audio.currentTime = Math.min(start, Math.max(0, audio.duration - 0.01));

      // keep track so we can clean up references when ended
      playingClownAudios.add(audio);
      const removeAudio = () => playingClownAudios.delete(audio);
      audio.addEventListener("ended", removeAudio);
      audio.addEventListener("error", removeAudio);

      const p = audio.play();
      if (p && typeof p.catch === "function")
        p.catch((err) => console.warn("clown play blocked:", err));
      return; // success
    } catch (err) {
      console.warn("Playback failed for", src, err);
      // try next candidate
    }
  }
  console.warn("All playback attempts failed for clown audio.");
}
