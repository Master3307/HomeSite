import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/*
 * A picture shown large on the page (native <dialog>: Esc and a click next
 * to it close it, focus stays inside), with "open in a new tab" and
 * "download" below it.
 */

async function download(src, name) {
  try {
    const response = await fetch(src, { credentials: 'include' })
    if (!response.ok) throw new Error(String(response.status))
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = Object.assign(document.createElement('a'), { href: url, download: name })
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  } catch {
    window.open(src, '_blank', 'noopener')
  }
}

export default function ImageViewer({ src, alt = '', caption = '', fileName, onClose }) {
  const { t } = useTranslation('common')
  const dialog = useRef(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (!element.open) element.showModal()
    const close = () => onClose()
    element.addEventListener('close', close)
    return () => element.removeEventListener('close', close)
  }, [onClose])

  const name = fileName || decodeURIComponent(new URL(src, window.location.href).pathname.split('/').pop() || 'image')

  return (
    <dialog
      ref={dialog}
      className="image-viewer"
      aria-label={caption || alt}
      onClick={(event) => {
        // A click on the backdrop (the dialog itself, not its content) closes it.
        if (event.target === dialog.current) dialog.current.close()
      }}
    >
      <figure className="image-viewer__figure">
        <img src={src} alt={alt} />
        {caption && <figcaption>{caption}</figcaption>}
      </figure>
      <div className="image-viewer__actions">
        <a className="image-viewer__button" href={src} target="_blank" rel="noopener noreferrer">
          <span className="material-symbols-outlined" aria-hidden="true">
            open_in_new
          </span>
          {t('image.openTab')}
        </a>
        <button
          type="button"
          className="image-viewer__button"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await download(src, name)
            setBusy(false)
          }}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            download
          </span>
          {t('image.download')}
        </button>
        <button type="button" className="image-viewer__button image-viewer__button--close" onClick={() => dialog.current?.close()}>
          <span className="material-symbols-outlined" aria-hidden="true">
            close
          </span>
          {t('image.close')}
        </button>
      </div>
    </dialog>
  )
}
