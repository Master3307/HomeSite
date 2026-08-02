// card tilt. kinda stolen lol
// check out https://stormxxboy.com/card/
export function tiltCard(event) {
  const card = event.currentTarget;
  if (!card) return;

  const cardRect = card.getBoundingClientRect();

  const cardCenterX = cardRect.left + cardRect.width / 2;
  const cardCenterY = cardRect.top + cardRect.height / 2;

  const mouseX = event.clientX;
  const mouseY = event.clientY;

  const rotateX = (mouseY - cardCenterY) / 100;
  const rotateY = (mouseX - cardCenterX) / 100;

  card.style.transition = "transform 0.05s ease";
  card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${-rotateY}deg)`;
}

export function resetCard(event) {
  const card = event.currentTarget;
  if (!card) return;

  card.style.transition = "transform 0.5s ease";
  card.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg)";
}
