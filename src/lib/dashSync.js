/*
 * Keeping one dash in step across devices (lib/dashSettings.js uses this).
 *
 * Each browser notes what it changed since its last sync, as keys:
 *   'look', 'top', 'openInNewTab' …   a whole setting
 *   'widgets:<id>'                     one widget added or changed
 *   'widgets:-<id>'                    one widget removed
 *   'widgets#order'                    the order of the list (pages, engines)
 * When the account's copy changed on another device in the meantime, that
 * copy is taken and this browser's own changes are laid over it, item by
 * item, so two devices editing different widgets both keep their work.
 * Pure functions, no storage (tests/dashSync.test.mjs).
 */

/* Lists whose entries have an `id` and are merged entry by entry. */
export const LISTS = ['widgets', 'pages', 'providers']
/* Not part of what is synced (this browser's own, or bookkeeping). */
export const LOCAL_ONLY = new Set(['updatedAt', 'version', 'activePage', 'customCss', 'customCssEnabled', 'replaceSiteCss'])

const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b)

/** The keys that differ between two copies of the settings. */
export function changedKeys(before, after) {
  const keys = new Set()
  const names = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  for (const name of names) {
    if (LOCAL_ONLY.has(name)) continue
    const a = before?.[name]
    const b = after?.[name]
    if (LISTS.includes(name) && Array.isArray(a) && Array.isArray(b)) {
      const old = new Map(a.map((item) => [item.id, item]))
      const now = new Map(b.map((item) => [item.id, item]))
      for (const [id, item] of now) if (!old.has(id) || !same(old.get(id), item)) keys.add(`${name}:${id}`)
      for (const id of old.keys()) if (!now.has(id)) keys.add(`${name}:-${id}`)
      const kept = b.map((item) => item.id).filter((id) => old.has(id))
      const was = a.map((item) => item.id).filter((id) => now.has(id))
      if (!same(kept, was)) keys.add(`${name}#order`)
      continue
    }
    if (!same(a, b)) keys.add(name)
  }
  return [...keys]
}

/**
 * The account's copy with this browser's changes (`dirty` keys) laid over it.
 * `remote` and `local` are whole settings objects; the result is not normalized.
 */
export function mergeSettings(remote, local, dirty) {
  const result = { ...remote }
  const lists = Object.fromEntries(LISTS.map((name) => [name, Array.isArray(remote?.[name]) ? [...remote[name]] : []]))
  const touched = new Set()
  for (const key of dirty) {
    const order = /^(\w+)#order$/.exec(key)
    const item = /^(\w+):(-?)(.+)$/.exec(key)
    if (order && LISTS.includes(order[1])) {
      touched.add(order[1])
      continue
    }
    if (item && LISTS.includes(item[1])) {
      const [, name, removed, id] = item
      touched.add(name)
      const list = lists[name]
      const at = list.findIndex((entry) => entry.id === id)
      if (removed) {
        if (at !== -1) list.splice(at, 1)
        continue
      }
      const mine = (local?.[name] ?? []).find((entry) => entry.id === id)
      if (!mine) continue
      if (at !== -1) list[at] = mine
      else {
        // Added here: placed after the entry it follows on this device (else at the end).
        const own = local[name]
        const before = own[own.indexOf(mine) - 1]?.id
        const after = before ? list.findIndex((entry) => entry.id === before) : -1
        list.splice(after === -1 ? list.length : after + 1, 0, mine)
      }
      continue
    }
    if (!LOCAL_ONLY.has(key) && local && key in local) result[key] = local[key]
  }
  for (const name of touched) result[name] = lists[name]
  // A reordered list: this device's order for the entries both have, the account's others where they were.
  for (const key of dirty) {
    const order = /^(\w+)#order$/.exec(key)
    if (!order || !LISTS.includes(order[1])) continue
    const name = order[1]
    const mine = (local?.[name] ?? []).map((entry) => entry.id)
    const list = result[name] ?? []
    const ranked = new Map(mine.map((id, index) => [id, index]))
    const shared = list.filter((entry) => ranked.has(entry.id)).sort((a, b) => ranked.get(a.id) - ranked.get(b.id))
    let next = 0
    result[name] = list.map((entry) => (ranked.has(entry.id) ? shared[next++] : entry))
  }
  return result
}
