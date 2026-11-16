import { useEffect, useState } from 'react'

/* Preloading game textures, so cats appear whole (with a spinner until then). */

/* ---------- loading ---------- */

const loaded = new Set()
const pending = new Map() // url -> Promise

function preload(url) {
  if (loaded.has(url)) return Promise.resolve()
  if (!pending.has(url)) {
    pending.set(
      url,
      new Promise((resolve) => {
        const image = new Image()
        image.decoding = 'async'
        const done = () => {
          loaded.add(url) // a broken texture shouldn't keep the spinner forever
          pending.delete(url)
          resolve()
        }
        image.onload = () => (image.decode ? image.decode().catch(() => {}).then(done) : done())
        image.onerror = done
        image.src = url
      }),
    )
  }
  return pending.get(url)
}

/** True once every url is loaded (decoded): nothing shows up piece by piece. */
export function useImagesReady(urls) {
  const key = urls.join('|')
  const [readyKey, setReadyKey] = useState(() => (urls.every((url) => loaded.has(url)) ? key : null))
  useEffect(() => {
    let alive = true
    const list = key ? key.split('|') : []
    if (list.every((url) => loaded.has(url))) return undefined
    Promise.all(list.map(preload)).then(() => alive && setReadyKey(key))
    return () => {
      alive = false
    }
  }, [key])
  return readyKey === key || urls.every((url) => loaded.has(url))
}

