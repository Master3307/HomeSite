/*
 * The /dash grid: widgets are boxes `{ x, y, w, h }` in grid cells (x from
 * the left, y from the top). Pure functions, used by the board while you
 * drag and resize and by the settings store when it repairs layouts.
 *
 *   place      puts one box at a spot; boxes in the way are pushed down
 *              (their own neighbours too), like Homarr / gridstack
 *   compact    with gravity on, every box floats up as far as it can
 *   pack       first-fit packing in reading order (a layout for another
 *              number of columns, e.g. the phone layout made from the
 *              desktop one, or boxes without a position)
 */

export const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

const byPosition = (a, b) => a.y - b.y || a.x - b.x

/** Clamps a box into `columns` (width first, then x). */
export function fit(box, columns) {
  const w = Math.max(1, Math.min(columns, Math.round(box.w) || 1))
  const h = Math.max(1, Math.round(box.h) || 1)
  const x = Math.max(0, Math.min(columns - w, Math.round(box.x) || 0))
  const y = Math.max(0, Math.round(box.y) || 0)
  return { ...box, x, y, w, h }
}

/** Every box floats up until it touches another one (or the top). Stable: reading order. */
export function compact(boxes) {
  const done = []
  for (const box of [...boxes].sort(byPosition)) {
    let y = box.y
    while (y > 0 && !done.some((other) => overlaps({ ...box, y: y - 1 }, other))) y -= 1
    done.push({ ...box, y })
  }
  return boxes.map((box) => done.find((item) => item.id === box.id))
}

/** Pushes every box that overlaps a fixed one further down, until nothing overlaps. */
function settle(boxes, fixedId) {
  const result = boxes.map((box) => ({ ...box }))
  const fixed = result.find((box) => box.id === fixedId)
  const order = result.filter((box) => box.id !== fixedId).sort(byPosition)
  const placed = fixed ? [fixed] : []
  for (const box of order) {
    // Each box keeps its spot unless something already placed is in the way; then it goes just under it.
    let guard = 0
    while (guard++ < 500) {
      const hit = placed.find((other) => overlaps(box, other))
      if (!hit) break
      box.y = hit.y + hit.h
    }
    placed.push(box)
  }
  return result
}

/**
 * Moves / resizes the box `id` to `target` ({ x, y, w, h }, any of them)
 * and makes room for it. With `gravity`, everything floats up afterwards.
 */
export function place(boxes, id, target, columns, gravity = true) {
  const before = boxes.find((box) => box.id === id)
  let moved = boxes.map((box) => (box.id === id ? fit({ ...box, ...target }, columns) : fit(box, columns)))
  // Dropped onto exactly one box of the same size (a move, not a resize): the two swap places.
  const self = moved.find((box) => box.id === id)
  const hits = moved.filter((box) => box.id !== id && overlaps(box, self))
  if (before && hits.length === 1 && self.w === before.w && self.h === before.h && hits[0].w === self.w && hits[0].h === self.h && (hits[0].x !== before.x || hits[0].y !== before.y)) {
    moved = moved.map((box) => (box.id === hits[0].id ? { ...box, x: before.x, y: before.y } : box.id === id ? { ...box, x: hits[0].x, y: hits[0].y } : box))
  }
  const settled = settle(moved, id)
  if (!gravity) return settled
  // Float up, but the moved box keeps the row it was dropped on if the space above it is free anyway.
  return compact(settled)
}

/** First-fit packing in reading order into `columns`. `size(box)` can give a new w / h. */
export function pack(boxes, columns, size = (box) => box) {
  const placed = []
  for (const box of [...boxes].sort(byPosition)) {
    const { w: rawW, h: rawH } = size(box)
    const w = Math.max(1, Math.min(columns, Math.round(rawW) || 1))
    const h = Math.max(1, Math.round(rawH) || 1)
    let spot = null
    for (let y = 0; !spot && y < 1000; y += 1) {
      for (let x = 0; x + w <= columns; x += 1) {
        const candidate = { id: box.id, x, y, w, h }
        if (!placed.some((other) => overlaps(candidate, other))) {
          spot = candidate
          break
        }
      }
    }
    placed.push(spot ?? { id: box.id, x: 0, y: 1000, w, h })
  }
  return boxes.map((box) => placed.find((item) => item.id === box.id))
}

/** Repairs a layout: inside the columns and nothing overlapping (keeps positions where it can). */
export function repair(boxes, columns, gravity = true) {
  const clamped = boxes.map((box) => fit(box, columns))
  const result = settle(clamped, null)
  return gravity ? compact(result) : result
}

/** The first free spot for a new w x h box (bottom if the board is full). */
export function freeSpot(boxes, w, h, columns) {
  const width = Math.min(columns, w)
  for (let y = 0; y < 1000; y += 1) {
    for (let x = 0; x + width <= columns; x += 1) {
      const candidate = { x, y, w: width, h }
      if (!boxes.some((other) => overlaps(candidate, other))) return candidate
    }
  }
  return { x: 0, y: bottom(boxes), w: width, h }
}

export const bottom = (boxes) => boxes.reduce((max, box) => Math.max(max, box.y + box.h), 0)
