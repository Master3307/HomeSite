import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { analyzeAll } from '../../lib/dashMath.js'
import { languageName, translateText, translationLanguages } from '../../lib/translate.js'

/*
 * An image pasted / dropped into the dash search (or taken with the camera):
 * reverse image search (the image goes from the browser straight to the
 * service clicked, never through our server), QR codes and barcodes (the
 * browser's BarcodeDetector, else jsQR), the text in it (Tesseract, in the
 * browser: the picture never leaves it; the reading models load from the
 * jsDelivr CDN once), what the calculator finds in that text (times, units,
 * maths), translating it (the site's LibreTranslate), a colour picker (click
 * the image) and its main colours, size and type, and saving it as PNG /
 * JPEG / WebP.
 */

/* Tesseract's names for the languages it reads (the visitor's language joins English and German). */
const OCR_LANGUAGES = { en: 'eng', de: 'deu', fr: 'fra', es: 'spa', it: 'ita', nl: 'nld', pl: 'pol', pt: 'por', ru: 'rus', tr: 'tur', uk: 'ukr', cs: 'ces', sv: 'swe', da: 'dan', fi: 'fin', nb: 'nor', hu: 'hun', ja: 'jpn', zh: 'chi_sim', ko: 'kor' }

/* Reverse image search: each takes the file in a form posted to the service, in a new tab. */
const REVERSE = [
  { id: 'lens', name: 'Google Lens', action: () => `https://lens.google.com/v3/upload?ep=ccm&s=&st=${Date.now()}`, field: 'encoded_image', kind: 'file' },
  { id: 'bing', name: 'Bing Visual Search', action: () => 'https://www.bing.com/images/search?view=detailv2&iss=sbiupload', field: 'imageBin', kind: 'base64' },
  { id: 'tineye', name: 'TinEye', action: () => 'https://tineye.com/search', field: 'image', kind: 'file' },
]

async function postImage(service, file) {
  const form = document.createElement('form')
  form.method = 'POST'
  form.enctype = 'multipart/form-data'
  form.action = service.action()
  form.target = '_blank'
  form.rel = 'noopener noreferrer'
  form.style.display = 'none'
  if (service.kind === 'file') {
    const input = document.createElement('input')
    input.type = 'file'
    input.name = service.field
    const transfer = new DataTransfer()
    transfer.items.add(file)
    input.files = transfer.files
    form.appendChild(input)
  } else {
    const data = await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
      reader.readAsDataURL(file)
    })
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = service.field
    input.value = data
    form.appendChild(input)
  }
  document.body.appendChild(form)
  form.submit()
  form.remove()
}

const hex = (value) => Math.round(value).toString(16).padStart(2, '0')

/* The main colours: a coarse histogram over a small copy (16 levels per channel), the five biggest. */
function mainColors(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const buckets = new Map()
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < 128) continue
    const key = ((data[index] >> 4) << 8) | ((data[index + 1] >> 4) << 4) | (data[index + 2] >> 4)
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 }
    bucket.count++
    bucket.r += data[index]
    bucket.g += data[index + 1]
    bucket.b += data[index + 2]
    buckets.set(key, bucket)
  }
  const picked = []
  for (const bucket of [...buckets.values()].sort((a, b) => b.count - a.count)) {
    const color = [bucket.r / bucket.count, bucket.g / bucket.count, bucket.b / bucket.count]
    // Skip ones too close to a colour already picked.
    if (picked.some((other) => Math.hypot(other[0] - color[0], other[1] - color[1], other[2] - color[2]) < 48)) continue
    picked.push(color)
    if (picked.length === 5) break
  }
  return picked.map((color) => `#${color.map(hex).join('')}`)
}

export default function ImageTools({ file, onClose, onQuery }) {
  const { t } = useTranslation('dash')
  const [url, setUrl] = useState(null)
  const [info, setInfo] = useState(null)
  const [codes, setCodes] = useState(null) // null: not looked, []: none, or [{ format, value }]
  const [colors, setColors] = useState([])
  const [copied, setCopied] = useState('')
  const [reading, setReading] = useState({ state: 'idle', progress: 0, text: '' })
  const [targets, setTargets] = useState([])
  const [target, setTarget] = useState('')
  const [translation, setTranslation] = useState({ state: 'idle', text: '', error: '' })
  const { i18n } = useTranslation()
  const canvas = useRef(null)
  const detector = typeof window !== 'undefined' && 'BarcodeDetector' in window

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    setCodes(null)
    const image = new Image()
    image.onload = async () => {
      setInfo({ width: image.naturalWidth, height: image.naturalHeight })
      // A small copy for colours and picking.
      const scale = Math.min(1, 800 / Math.max(image.naturalWidth, image.naturalHeight))
      const work = canvas.current ?? document.createElement('canvas')
      canvas.current = work
      work.width = Math.max(1, Math.round(image.naturalWidth * scale))
      work.height = Math.max(1, Math.round(image.naturalHeight * scale))
      work.getContext('2d', { willReadFrequently: true }).drawImage(image, 0, 0, work.width, work.height)
      setColors(mainColors(work))
      if (detector) {
        try {
          const found = await new window.BarcodeDetector().detect(image)
          setCodes(found.map((code) => ({ format: code.format, value: code.rawValue })))
        } catch {
          setCodes([])
        }
      } else {
        // No detector in this browser (Firefox): jsQR reads QR codes (not barcodes).
        try {
          const { default: jsQR } = await import('jsqr')
          const big = document.createElement('canvas')
          const scaleUp = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight))
          big.width = Math.max(1, Math.round(image.naturalWidth * scaleUp))
          big.height = Math.max(1, Math.round(image.naturalHeight * scaleUp))
          const bigCtx = big.getContext('2d', { willReadFrequently: true })
          bigCtx.drawImage(image, 0, 0, big.width, big.height)
          const found = jsQR(bigCtx.getImageData(0, 0, big.width, big.height).data, big.width, big.height)
          setCodes(found?.data ? [{ format: 'qr_code', value: found.data }] : [])
        } catch {
          setCodes([])
        }
      }
    }
    image.src = objectUrl
    return () => URL.revokeObjectURL(objectUrl)
  }, [file, detector])

  // Reading the text, by itself once the picture is there.
  useEffect(() => {
    let cancelled = false
    let worker = null
    setReading({ state: 'loading', progress: 0, text: '' })
    setTranslation({ state: 'idle', text: '', error: '' })
    ;(async () => {
      try {
        const { createWorker } = await import('tesseract.js')
        const own = OCR_LANGUAGES[String(i18n.language).split('-')[0]]
        const langs = [...new Set(['eng', 'deu', own].filter(Boolean))]
        worker = await createWorker(langs, 1, {
          logger: (message) => {
            if (!cancelled && message.status === 'recognizing text') setReading((current) => ({ ...current, state: 'reading', progress: message.progress }))
          },
        })
        const { data } = await worker.recognize(file)
        if (!cancelled) setReading({ state: 'done', progress: 1, text: String(data.text ?? '').replace(/\n{3,}/g, '\n\n').trim() })
      } catch {
        if (!cancelled) setReading({ state: 'error', progress: 0, text: '' })
      } finally {
        worker?.terminate()
      }
    })()
    return () => {
      cancelled = true
      worker?.terminate()
    }
  }, [file, i18n.language])
  useEffect(() => {
    translationLanguages().then((list) => {
      const codes = [...new Set(list.flatMap((entry) => [entry.code, ...entry.targets]))]
      setTargets(codes)
      const own = String(i18n.language).split('-')[0]
      setTarget((current) => current || (codes.includes(own) ? own : codes.includes('en') ? 'en' : (codes[0] ?? '')))
    })
  }, [i18n.language])
  // What the calculator understands in the text: times, units, maths, colours.
  const found = reading.text
    ? reading.text
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line.length >= 2 && line.length <= 120)
        .map((line) => {
          // "Meeting 11:00 + 1h": words in front are tried away until the rest works out.
          const words = line.split(/\s+/)
          for (let skip = 0; skip <= Math.min(4, words.length - 1); skip++) {
            const part = words.slice(skip).join(' ')
            try {
              const result = analyzeAll(part, { locale: i18n.language })
              if (result?.rows?.length) return { line: part, answer: result.rows[0].text }
            } catch {
              // not maths
            }
          }
          return null
        })
        .filter(Boolean)
        .slice(0, 8)
    : []

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied((current) => (current === key ? '' : current)), 1400)
    } catch {
      // no clipboard
    }
  }
  const pick = (event) => {
    const work = canvas.current
    if (!work) return
    const box = event.currentTarget.getBoundingClientRect()
    const x = Math.floor(((event.clientX - box.left) / box.width) * work.width)
    const y = Math.floor(((event.clientY - box.top) / box.height) * work.height)
    const [r, g, b] = work.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data
    onQuery(`#${hex(r)}${hex(g)}${hex(b)}`)
  }
  const save = (type) => {
    const image = new Image()
    image.onload = () => {
      const out = document.createElement('canvas')
      out.width = image.naturalWidth
      out.height = image.naturalHeight
      const ctx = out.getContext('2d')
      if (type === 'image/jpeg') {
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, out.width, out.height)
      }
      ctx.drawImage(image, 0, 0)
      out.toBlob(
        (blob) => {
          if (!blob) return
          const link = document.createElement('a')
          link.href = URL.createObjectURL(blob)
          link.download = `${(file.name || 'image').replace(/\.[^.]+$/, '')}.${type.split('/')[1].replace('jpeg', 'jpg')}`
          link.click()
          setTimeout(() => URL.revokeObjectURL(link.href), 10_000)
        },
        type,
        0.92,
      )
    }
    image.src = url
  }
  const isLink = (value) => /^https?:\/\/\S+$/i.test(value)

  return (
    <div className="dash-image" role="region" aria-label={t('image.title')}>
      <div className="dash-image__preview">
        {url && <img src={url} alt={t('image.alt')} onClick={pick} title={t('image.pick')} />}
        <button type="button" className="dash-tool dash-image__close" onClick={onClose} aria-label={t('image.close')} title={t('image.close')}>
          <span className="material-symbols-outlined" aria-hidden="true">
            close
          </span>
        </button>
      </div>
      <div className="dash-image__tools">
        <p className="dash-image__info">
          {file.name ? <strong>{file.name}</strong> : <strong>{t('image.pasted')}</strong>}
          {info && ` · ${info.width} × ${info.height}`} · {file.type.replace('image/', '').toUpperCase()} · {Math.max(1, Math.round(file.size / 1024))} kB
        </p>

        <section>
          <h4>{t('image.reverse')}</h4>
          <div className="dash-image__row">
            {REVERSE.map((service) => (
              <button key={service.id} type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => postImage(service, file)}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  image_search
                </span>
                {service.name}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h4>{t('image.codes')}</h4>
          {codes === null ? (
            <p className="dash-hint">{t('image.looking')}</p>
          ) : codes.length === 0 ? (
            <p className="dash-hint">{t('image.noCodes')}</p>
          ) : (
            <ul className="dash-image__codes">
              {codes.map((code, index) => (
                <li key={`${code.format}:${index}`}>
                  <span className="material-symbols-outlined" aria-hidden="true">
                    {code.format === 'qr_code' ? 'qr_code_2' : 'barcode'}
                  </span>
                  <span className="dash-image__code">{code.value}</span>
                  {isLink(code.value) && (
                    <a className="dash-button dash-button--small" href={code.value} target="_blank" rel="noopener noreferrer">
                      {t('image.openLink')}
                    </a>
                  )}
                  <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => copy(code.value, `code${index}`)}>
                    {copied === `code${index}` ? t('image.copied') : t('image.copy')}
                  </button>
                  <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => onQuery(code.value)}>
                    {t('image.search')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h4>{t('image.text')}</h4>
          {(reading.state === 'loading' || reading.state === 'reading') && (
            <p className="dash-hint dash-image__reading">
              <span className="dash-image__progress" style={{ '--progress': `${Math.round(reading.progress * 100)}%` }} />
              {reading.state === 'loading' ? t('image.loadingReader') : t('image.reading', { percent: Math.round(reading.progress * 100) })}
            </p>
          )}
          {reading.state === 'error' && <p className="dash-hint">{t('image.readError')}</p>}
          {reading.state === 'done' && !reading.text && <p className="dash-hint">{t('image.noText')}</p>}
          {reading.state === 'done' && reading.text && (
            <>
              <textarea className="dash-image__text" value={reading.text} readOnly rows={Math.min(8, reading.text.split('\n').length + 1)} aria-label={t('image.text')} />
              <div className="dash-image__row">
                <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => copy(reading.text, 'text')}>
                  {copied === 'text' ? t('image.copied') : t('image.copy')}
                </button>
                <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => onQuery(reading.text)}>
                  {t('image.search')}
                </button>
                {targets.length > 0 && (
                  <>
                    <select value={target} onChange={(event) => setTarget(event.target.value)} aria-label={t('image.translateTo')}>
                      {targets.map((code) => (
                        <option key={code} value={code}>
                          {languageName(code, i18n.language)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="dash-button dash-button--small"
                      disabled={translation.state === 'loading'}
                      onClick={async () => {
                        setTranslation({ state: 'loading', text: '', error: '' })
                        try {
                          const result = await translateText(reading.text.slice(0, 5000), target)
                          setTranslation({ state: 'done', text: result.text, error: '' })
                        } catch (failure) {
                          setTranslation({ state: 'error', text: '', error: failure.message })
                        }
                      }}
                    >
                      <span className="material-symbols-outlined" aria-hidden="true">
                        translate
                      </span>
                      {t('image.translate')}
                    </button>
                  </>
                )}
              </div>
              {translation.state === 'done' && <textarea className="dash-image__text" value={translation.text} readOnly rows={Math.min(8, translation.text.split('\n').length + 1)} aria-label={t('image.translated')} />}
              {translation.state === 'error' && <p className="dash-error">{translation.error}</p>}
              {found.length > 0 && (
                <ul className="dash-image__found">
                  {found.map((entry) => (
                    <li key={entry.line}>
                      <button type="button" onClick={() => onQuery(entry.line)}>
                        <span>{entry.line}</span>
                        <strong>{entry.answer}</strong>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        <section>
          <h4>{t('image.colors')}</h4>
          <div className="dash-image__colors">
            {colors.map((color) => (
              <button key={color} type="button" style={{ '--chip': color }} onClick={() => onQuery(color)} title={color}>
                <i />
                {color}
              </button>
            ))}
          </div>
          <p className="dash-hint">{t('image.pickHint')}</p>
        </section>

        <section>
          <h4>{t('image.save')}</h4>
          <div className="dash-image__row">
            {['image/png', 'image/jpeg', 'image/webp'].map((type) => (
              <button key={type} type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => save(type)}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  download
                </span>
                {type.split('/')[1].replace('jpeg', 'JPEG').toUpperCase()}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
