import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { accountFetch } from '../lib/account.js'
import { useAccountSettings } from '../lib/accountSettings.jsx'

/*
 * Settings → Account → Avatar: your own picture instead of Discord's. A
 * picture (animated GIF / WebP too) is placed in the circle by dragging and
 * zooming (wheel, pinch, the slider, arrow keys); only the square's place
 * goes to the server with the file (POST /account/avatar), which cuts it,
 * makes it 256 px and drops everything hidden in it. "Back to Discord"
 * removes it again.
 */

const VIEW = 280

export default function AvatarEditor() {
  const { t } = useTranslation('settings')
  const { account, patchAccount } = useAccountSettings()
  const input = useRef(null)
  const [picked, setPicked] = useState(null) // { file, url, width, height }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const choose = (file) => {
    setError(null)
    if (!file) return
    if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(file.type)) return setError(t('avatar.type'))
    if (file.size > 12 * 1024 * 1024) return setError(t('avatar.tooBig'))
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => setPicked({ file, url, width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => (URL.revokeObjectURL(url), setError(t('avatar.type')))
    image.src = url
  }
  const close = () => {
    if (picked) URL.revokeObjectURL(picked.url)
    setPicked(null)
  }
  const send = async (crop) => {
    setBusy(true)
    setError(null)
    try {
      const query = new URLSearchParams({ x: crop.x.toFixed(5), y: crop.y.toFixed(5), size: crop.size.toFixed(5) })
      const response = await accountFetch(`/account/avatar?${query}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: picked.file })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || t('avatar.failed'))
      patchAccount({ avatarUrl: data.avatarUrl, customAvatar: true })
      close()
    } catch (reason) {
      setError(reason.message)
    } finally {
      setBusy(false)
    }
  }
  const reset = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await accountFetch('/account/avatar', { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || t('avatar.failed'))
      patchAccount({ avatarUrl: data.avatarUrl, customAvatar: false })
    } catch (reason) {
      setError(reason.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="avatar-editor">
      <div className="avatar-editor__now">
        {account?.avatarUrl ? <img src={account.avatarUrl} alt="" width="72" height="72" /> : <span className="avatar-editor__blank material-symbols-outlined">person</span>}
        <div>
          <strong>{account?.customAvatar ? t('avatar.own') : t('avatar.discord')}</strong>
          <span className="settings-hint">{t('avatar.hint')}</span>
        </div>
      </div>
      <div className="settings-links">
        <button type="button" className="members-button" onClick={() => input.current?.click()} disabled={busy}>
          <span className="material-symbols-outlined" aria-hidden="true">
            add_photo_alternate
          </span>
          {t('avatar.choose')}
        </button>
        {account?.customAvatar && (
          <button type="button" className="members-button members-button--quiet" onClick={reset} disabled={busy}>
            <span className="material-symbols-outlined" aria-hidden="true">
              undo
            </span>
            {t('avatar.reset')}
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden onChange={(event) => (choose(event.target.files?.[0]), (event.target.value = ''))} />
      {error && <p className="members-error">{error}</p>}
      {picked && <CropDialog picked={picked} busy={busy} onCancel={close} onDone={send} />}
    </div>
  )
}

/* The picture under a round window: drag it, zoom it; the square around the circle is what's kept. */
function CropDialog({ picked, busy, onCancel, onDone }) {
  const { t } = useTranslation('settings')
  const ref = useRef(null)
  const base = VIEW / Math.min(picked.width, picked.height) // "cover" at zoom 1
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState(() => ({ x: (VIEW - picked.width * base) / 2, y: (VIEW - picked.height * base) / 2 }))
  const drag = useRef(null)
  const pinch = useRef(null)
  const view = useRef(null)
  // The window may be narrower than 280 px (small phones): the stage is scaled to it.
  const [fit, setFit] = useState(1)
  useEffect(() => {
    ref.current?.showModal()
    const element = view.current
    if (!element) return undefined
    const observer = new ResizeObserver(() => setFit(element.clientWidth / VIEW || 1))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const scale = base * zoom
  // The picture always covers the window.
  const clamp = (next, z = zoom) => {
    const s = base * z
    return { x: Math.min(0, Math.max(VIEW - picked.width * s, next.x)), y: Math.min(0, Math.max(VIEW - picked.height * s, next.y)) }
  }
  // Zooming keeps the point under the pointer (or the middle) in place.
  const zoomTo = (next, at = { x: VIEW / 2, y: VIEW / 2 }) => {
    const z = Math.min(8, Math.max(1, next))
    const ratio = z / zoom
    setZoom(z)
    setOffset((current) => clamp({ x: at.x - (at.x - current.x) * ratio, y: at.y - (at.y - current.y) * ratio }, z))
  }
  const done = () => {
    const side = VIEW / scale
    onDone({ x: -offset.x / scale / picked.width, y: -offset.y / scale / picked.height, size: side / Math.min(picked.width, picked.height) })
  }
  const local = (event) => {
    const box = event.currentTarget.getBoundingClientRect()
    return { x: ((event.clientX - box.left) / box.width) * VIEW, y: ((event.clientY - box.top) / box.height) * VIEW }
  }
  return (
    <dialog ref={ref} className="avatar-crop" onClose={onCancel} aria-labelledby="avatar-crop-title">
      <h2 id="avatar-crop-title">{t('avatar.place')}</h2>
      <div
        ref={view}
        className="avatar-crop__view"
        style={{ '--view': `${VIEW}px` }}
        tabIndex={0}
        role="application"
        aria-label={t('avatar.placeHelp')}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          const points = (drag.current?.points ?? new Map()).set(event.pointerId, local(event))
          drag.current = { points, last: local(event) }
          if (points.size === 2) {
            const [a, b] = [...points.values()]
            pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom }
          }
        }}
        onPointerMove={(event) => {
          if (!drag.current?.points.has(event.pointerId)) return
          const point = local(event)
          drag.current.points.set(event.pointerId, point)
          if (drag.current.points.size === 2 && pinch.current) {
            const [a, b] = [...drag.current.points.values()]
            zoomTo((pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.distance, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
            return
          }
          const last = drag.current.last
          drag.current.last = point
          setOffset((current) => clamp({ x: current.x + point.x - last.x, y: current.y + point.y - last.y }))
        }}
        onPointerUp={(event) => {
          drag.current?.points.delete(event.pointerId)
          if ((drag.current?.points.size ?? 0) < 2) pinch.current = null
          if (drag.current) drag.current.last = drag.current.points.size ? [...drag.current.points.values()][0] : null
        }}
        onWheel={(event) => {
          event.preventDefault()
          zoomTo(zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1), local(event))
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 30 : 8
          const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
          if (moves[event.key]) {
            event.preventDefault()
            setOffset((current) => clamp({ x: current.x + moves[event.key][0], y: current.y + moves[event.key][1] }))
          }
          if (event.key === '+' || event.key === '=') zoomTo(zoom * 1.1)
          if (event.key === '-') zoomTo(zoom / 1.1)
        }}
      >
        <div className="avatar-crop__stage" style={{ transform: `scale(${fit})` }}>
          <img src={picked.url} alt="" draggable={false} style={{ width: picked.width * scale, height: picked.height * scale, transform: `translate(${offset.x}px, ${offset.y}px)` }} />
        </div>
        <span className="avatar-crop__ring" aria-hidden="true" />
      </div>
      <label className="avatar-crop__zoom">
        <span className="material-symbols-outlined" aria-hidden="true">
          zoom_out
        </span>
        <input type="range" min="1" max="8" step="0.01" value={zoom} onChange={(event) => zoomTo(Number(event.target.value))} aria-label={t('avatar.zoom')} />
        <span className="material-symbols-outlined" aria-hidden="true">
          zoom_in
        </span>
      </label>
      <p className="settings-hint">{picked.file.type === 'image/gif' || picked.file.type === 'image/webp' ? t('avatar.animatedHint') : t('avatar.placeHelp')}</p>
      <div className="avatar-crop__actions">
        <button type="button" className="members-button members-button--quiet" onClick={() => ref.current?.close()} disabled={busy}>
          {t('avatar.cancel')}
        </button>
        <button type="button" className="members-button" onClick={done} disabled={busy}>
          {busy ? t('avatar.saving') : t('avatar.save')}
        </button>
      </div>
    </dialog>
  )
}
