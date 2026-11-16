/*
 * Scrolling over a slider (<input type="range">) moves it one step per
 * notch, for fine adjustments; Shift moves ten steps. The page doesn't
 * scroll while the pointer is on a slider. React's onChange fires as usual
 * (the value is set through the native setter, then an input event).
 */
const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set

function onWheel(event) {
  const input = event.target instanceof Element ? event.target.closest('input[type="range"]') : null
  if (!input || input.disabled || event.ctrlKey) return
  const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : -event.deltaX
  if (!delta) return
  event.preventDefault()

  const min = Number(input.min || 0)
  const max = Number(input.max || 100)
  const step = input.step === 'any' || !Number(input.step) ? (max - min) / 200 : Number(input.step)
  const direction = delta < 0 ? 1 : -1
  const next = Math.min(max, Math.max(min, Number(input.value) + direction * step * (event.shiftKey ? 10 : 1)))
  // Rounded to the step's decimals (0.1 + 0.2 …).
  const decimals = (String(step).split('.')[1] ?? '').length
  const value = decimals ? next.toFixed(decimals) : String(Math.round(next))
  if (value === input.value) return
  setValue.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

/** Installs the handler once; returns the cleanup. */
export function installRangeWheel() {
  window.addEventListener('wheel', onWheel, { passive: false })
  return () => window.removeEventListener('wheel', onWheel)
}
