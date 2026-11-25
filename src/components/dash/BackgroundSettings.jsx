import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BACKGROUND_PRESETS, deleteFile, loadWallpapers, randomBackground, uploadFile } from '../../lib/dashBackgrounds.js'
import { useCustomFont } from './useCustomFont.js'
import { LOOK_CHOICES, backgroundCss, createId, isColor, pickBackground, updateDashSettings, updateLook, useDashSettings, withScheme } from '../../lib/dashSettings.js'

/*
 * Customize → Look → Background and Font (/settings → Dash): presets (the
 * site's and your own), a colour, a gradient (2–5 stops, linear / radial /
 * conic), a picture (uploaded wallpapers, kept on your account and counted
 * against its storage, or a link), shuffling (now, each visit, daily), and
 * an own font (uploaded, a link, or a Google Fonts family).
 */

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`

function Swatch({ look, label, active, onClick, onRemove, removeLabel }) {
  const css = backgroundCss({ ...look, gradientStops: look.gradientStops ?? [] })
  const style = css === null ? { backgroundImage: `url("${encodeURI(withScheme(look.backgroundValue))}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: css || 'var(--bg-primary)' }
  return (
    <span className={`dash-bg-swatch${active ? ' is-active' : ''}`}>
      <button type="button" style={style} onClick={onClick} aria-pressed={active} title={label} aria-label={label} />
      {onRemove && (
        <button type="button" className="dash-bg-swatch__remove" onClick={onRemove} aria-label={removeLabel} title={removeLabel}>
          <span className="material-symbols-outlined" aria-hidden="true">
            close
          </span>
        </button>
      )}
    </span>
  )
}

function Stops({ look }) {
  const { t } = useTranslation('dash')
  const stops = look.gradientStops?.length >= 2 ? look.gradientStops : [{ color: look.gradientFrom, at: 0 }, { color: look.gradientTo, at: 100 }]
  const save = (next) => updateLook({ gradientStops: next, gradientFrom: next[0].color, gradientTo: next.at(-1).color })
  return (
    <div className="dash-bg-stops">
      <div className="dash-bg-stops__bar" style={{ background: `linear-gradient(90deg, ${stops.map((stop) => `${stop.color} ${stop.at}%`).join(', ')})` }} aria-hidden="true" />
      {stops.map((stop, index) => (
        <div key={index} className="dash-bg-stop">
          <input type="color" value={stop.color} aria-label={t('settings.background.stopColor', { n: index + 1 })} onChange={(event) => save(stops.map((entry, position) => (position === index ? { ...entry, color: event.target.value } : entry)))} />
          <input type="range" min="0" max="100" value={stop.at} aria-label={t('settings.background.stopAt', { n: index + 1 })} onChange={(event) => save(stops.map((entry, position) => (position === index ? { ...entry, at: Number(event.target.value) } : entry)).sort((a, b) => a.at - b.at))} />
          <output>{stop.at}%</output>
          <button type="button" className="dash-tool" disabled={stops.length <= 2} onClick={() => save(stops.filter((_, position) => position !== index))} aria-label={t('settings.background.removeStop')} title={t('settings.background.removeStop')}>
            <span className="material-symbols-outlined">remove</span>
          </button>
        </div>
      ))}
      {stops.length < 5 && (
        <button
          type="button"
          className="dash-link-button"
          onClick={() => {
            // A new stop in the widest gap, in the colour between its neighbours.
            let best = 0
            for (let index = 1; index < stops.length; index++) if (stops[index].at - stops[index - 1].at > stops[best + 1].at - stops[best].at) best = index - 1
            const at = Math.round((stops[best].at + stops[best + 1].at) / 2)
            save([...stops.slice(0, best + 1), { color: stops[best].color, at }, ...stops.slice(best + 1)])
          }}
        >
          {t('settings.background.addStop')}
        </button>
      )}
    </div>
  )
}

function Wallpapers({ look }) {
  const { t } = useTranslation('dash')
  const [state, setState] = useState({ status: 'loading' })
  const [upload, setUpload] = useState(null) // { progress } | { error }
  const [confirm, setConfirm] = useState(null)
  const input = useRef(null)
  const reload = () =>
    loadWallpapers({ fresh: true })
      .then((data) => setState({ status: 'done', ...data }))
      .catch((error) => setState({ status: 'error', error: error.message }))
  useEffect(() => {
    reload()
  }, [])
  const send = async (files) => {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      setUpload({ progress: 0, name: file.name })
      try {
        const result = await uploadFile(file, 'wallpaper', { onProgress: (progress) => setUpload({ progress, name: file.name }) })
        updateLook({ background: 'image', backgroundValue: result.file.url, backgroundFile: result.file.id })
        setUpload(null)
      } catch (error) {
        setUpload({ error: error.message })
        return reload()
      }
    }
    reload()
  }
  return (
    <div
      className="dash-bg-wallpapers"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        send([...(event.dataTransfer?.files ?? [])])
      }}
    >
      {state.status === 'done' && state.quota !== null && (
        <div className="dash-bg-quota" title={t('settings.background.quotaHint')}>
          <span>{t('settings.background.quota', { used: megabytes(state.used), quota: megabytes(state.quota) })}</span>
          <span className="dash-bg-quota__bar">
            <span style={{ width: `${Math.min(100, (state.used / state.quota) * 100)}%` }} />
          </span>
        </div>
      )}
      <div className="dash-bg-grid">
        <button type="button" className="dash-bg-upload" onClick={() => input.current?.click()} disabled={Boolean(upload?.progress !== undefined && !upload?.error)}>
          {upload && !upload.error ? (
            <>
              <span className="dash-bg-upload__ring" style={{ '--p': `${Math.round(upload.progress * 100)}%` }} />
              <small>{Math.round(upload.progress * 100)}%</small>
            </>
          ) : (
            <>
              <span className="material-symbols-outlined" aria-hidden="true">
                add_photo_alternate
              </span>
              <small>{t('settings.background.upload')}</small>
            </>
          )}
        </button>
        <input ref={input} type="file" accept="image/*" multiple hidden onChange={(event) => send([...event.target.files]).finally(() => (event.target.value = ''))} />
        {state.status === 'done' &&
          state.files.map((file) => (
            <span key={file.id} className={`dash-bg-thumb${look.backgroundFile === file.id ? ' is-active' : ''}`}>
              <button type="button" onClick={() => updateLook({ background: 'image', backgroundValue: file.url, backgroundFile: file.id })} aria-pressed={look.backgroundFile === file.id} title={`${file.name} · ${file.width}×${file.height} · ${megabytes(file.size)}`}>
                <img src={file.url} alt={file.name} loading="lazy" decoding="async" />
              </button>
              {confirm === file.id ? (
                <span className="dash-bg-thumb__confirm">
                  <button
                    type="button"
                    className="dash-button dash-button--small dash-button--danger"
                    onClick={async () => {
                      setConfirm(null)
                      await deleteFile(file.id).catch(() => {})
                      if (look.backgroundFile === file.id) updateLook({ background: 'site', backgroundValue: '', backgroundFile: '' })
                      reload()
                    }}
                  >
                    {t('settings.delete')}
                  </button>
                  <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => setConfirm(null)}>
                    {t('settings.cancel')}
                  </button>
                </span>
              ) : (
                <button type="button" className="dash-bg-thumb__remove" onClick={() => setConfirm(file.id)} aria-label={t('settings.background.deleteWallpaper', { name: file.name })} title={t('settings.delete')}>
                  <span className="material-symbols-outlined" aria-hidden="true">
                    delete
                  </span>
                </button>
              )}
            </span>
          ))}
      </div>
      {state.status === 'loading' && <span className="skeleton skeleton--text" style={{ width: '40%' }} />}
      {state.status === 'error' && <p className="dash-error">{state.error}</p>}
      {upload?.error && <p className="dash-error">{upload.error}</p>}
      <p className="dash-hint">{t('settings.background.uploadHint')}</p>
    </div>
  )
}

export function BackgroundSettings() {
  const { t } = useTranslation('dash')
  const settings = useDashSettings()
  const { look } = settings
  const [naming, setNaming] = useState(null)
  const [source, setSource] = useState(look.backgroundFile || !look.backgroundValue ? 'upload' : 'link')
  const current = pickBackground(look)
  const same = (other) => Object.entries(other).every(([key, value]) => JSON.stringify(current[key] ?? '') === JSON.stringify(value ?? ''))
  const apply = (patch) => updateLook({ ...patch, gradientStops: patch.gradientStops ?? (patch.background === 'gradient' ? [] : look.gradientStops) })
  const previewCss = backgroundCss(look)
  const preview = previewCss === null ? { backgroundImage: `linear-gradient(rgb(0 0 0 / ${look.dim / 100}), rgb(0 0 0 / ${look.dim / 100})), url("${encodeURI(withScheme(look.backgroundValue))}")`, backgroundSize: look.backgroundFit === 'tile' ? 'auto' : look.backgroundFit, backgroundRepeat: look.backgroundFit === 'tile' ? 'repeat' : 'no-repeat', backgroundPosition: 'center' } : { background: previewCss || 'var(--bg-primary)' }
  const shuffle = async () => {
    let files = []
    if (look.backgroundPool.includes('wallpapers')) files = (await loadWallpapers().catch(() => ({ files: [] }))).files
    const next = randomBackground(look.backgroundPool.length ? look.backgroundPool : ['presets'], { saved: settings.savedBackgrounds, wallpaperFiles: files, current })
    if (next) apply({ ...next, gradientStops: next.gradientStops ?? [] })
  }
  return (
    <div className="dash-bg">
      <div className="dash-bg-preview" style={preview} aria-hidden="true">
        <span className="dash-bg-preview__card" />
        <span className="dash-bg-preview__card" />
        <span className="dash-bg-preview__card" />
      </div>

      <div className="dash-field">
        <span className="dash-field__label">{t('settings.background.presets')}</span>
        <div className="dash-bg-swatches">
          {BACKGROUND_PRESETS.map((preset) => (
            <Swatch key={preset.id} look={preset.look} label={t(`settings.background.preset.${preset.id}`, { defaultValue: preset.id })} active={same(preset.look)} onClick={() => apply(preset.look)} />
          ))}
          {settings.savedBackgrounds.map((entry) => (
            <Swatch
              key={entry.id}
              look={entry.look}
              label={entry.name || t('settings.background.mine')}
              active={same(entry.look)}
              onClick={() => apply(entry.look)}
              onRemove={() => updateDashSettings((now) => ({ savedBackgrounds: now.savedBackgrounds.filter((item) => item.id !== entry.id) }))}
              removeLabel={t('settings.background.removePreset', { name: entry.name })}
            />
          ))}
          {naming === null ? (
            <button type="button" className="dash-bg-save" onClick={() => setNaming('')} disabled={look.background === 'site' || settings.savedBackgrounds.length >= 40} title={t('settings.background.save')}>
              <span className="material-symbols-outlined" aria-hidden="true">
                bookmark_add
              </span>
            </button>
          ) : (
            <form
              className="dash-bg-name"
              onSubmit={(event) => {
                event.preventDefault()
                updateDashSettings((now) => ({ savedBackgrounds: [...now.savedBackgrounds, { id: createId('bg'), name: naming.trim().slice(0, 40), look: current }] }))
                setNaming(null)
              }}
            >
              <input autoFocus value={naming} maxLength={40} placeholder={t('settings.background.name')} onChange={(event) => setNaming(event.target.value)} onKeyDown={(event) => event.key === 'Escape' && setNaming(null)} />
              <button type="submit" className="dash-button dash-button--small">
                {t('settings.background.keep')}
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="dash-field">
        <span className="dash-field__label">{t('settings.look.backgroundKind')}</span>
        <div className="dash-segment" role="radiogroup" aria-label={t('settings.look.backgroundKind')}>
          {LOOK_CHOICES.background.map((option) => (
            <button key={option} type="button" role="radio" aria-checked={look.background === option} className={look.background === option ? 'is-active' : ''} onClick={() => updateLook({ background: option })}>
              {t(`settings.choices.${option}`, { defaultValue: option })}
            </button>
          ))}
        </div>
      </div>

      {look.background === 'color' && (
        <div className="dash-field dash-field--inline">
          <span className="dash-field__label">{t('settings.look.color')}</span>
          <span className="dash-row">
            <input type="color" value={isColor(look.backgroundValue) ? look.backgroundValue : '#1a1030'} onChange={(event) => updateLook({ backgroundValue: event.target.value })} aria-label={t('settings.look.color')} />
            <input className="dash-bg-hex" value={look.backgroundValue} maxLength={7} spellCheck="false" onChange={(event) => isColor(event.target.value) && updateLook({ backgroundValue: event.target.value })} aria-label="HEX" />
          </span>
        </div>
      )}

      {look.background === 'gradient' && (
        <>
          <div className="dash-field">
            <span className="dash-field__label">{t('settings.background.type')}</span>
            <div className="dash-segment" role="radiogroup">
              {LOOK_CHOICES.gradientType.map((option) => (
                <button key={option} type="button" role="radio" aria-checked={look.gradientType === option} className={look.gradientType === option ? 'is-active' : ''} onClick={() => updateLook({ gradientType: option })}>
                  {t(`settings.background.types.${option}`)}
                </button>
              ))}
            </div>
          </div>
          <Stops look={look} />
          {look.gradientType !== 'radial' && (
            <label className="dash-field dash-range">
              <span className="dash-field__label">
                {t('settings.look.angle')}
                <output>{look.gradientAngle}°</output>
              </span>
              <input type="range" min="0" max="360" step="5" value={look.gradientAngle} onChange={(event) => updateLook({ gradientAngle: Number(event.target.value) })} />
            </label>
          )}
        </>
      )}

      {look.background === 'image' && (
        <>
          <div className="dash-segment dash-segment--small" role="tablist">
            {['upload', 'link'].map((option) => (
              <button key={option} type="button" role="tab" aria-selected={source === option} className={source === option ? 'is-active' : ''} onClick={() => setSource(option)}>
                {t(`settings.background.source.${option}`)}
              </button>
            ))}
          </div>
          {source === 'upload' ? (
            <Wallpapers look={look} />
          ) : (
            <label className="dash-field">
              <span className="dash-field__label">{t('settings.look.imageUrl')}</span>
              <input type="url" value={look.backgroundFile ? '' : look.backgroundValue} placeholder="https://…" onChange={(event) => updateLook({ backgroundValue: event.target.value, backgroundFile: '' })} />
              <span className="dash-hint">{t('settings.background.linkHint')}</span>
            </label>
          )}
          <div className="dash-field">
            <span className="dash-field__label">{t('settings.look.fit')}</span>
            <div className="dash-segment" role="radiogroup">
              {LOOK_CHOICES.backgroundFit.map((option) => (
                <button key={option} type="button" role="radio" aria-checked={look.backgroundFit === option} className={look.backgroundFit === option ? 'is-active' : ''} onClick={() => updateLook({ backgroundFit: option })}>
                  {t(`settings.choices.${option}`, { defaultValue: option })}
                </button>
              ))}
            </div>
          </div>
          {[
            ['dim', 0, 80, '%'],
            ['backgroundBlur', 0, 30, 'px'],
          ].map(([key, min, max, unit]) => (
            <label key={key} className="dash-field dash-range">
              <span className="dash-field__label">
                {t(`settings.look.${key}`)}
                <output>
                  {look[key]}
                  {unit}
                </output>
              </span>
              <input type="range" min={min} max={max} value={look[key]} onChange={(event) => updateLook({ [key]: Number(event.target.value) })} />
            </label>
          ))}
        </>
      )}

      <div className="dash-bg-random">
        <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={shuffle} disabled={!look.backgroundPool.length}>
          <span className="material-symbols-outlined" aria-hidden="true">
            shuffle
          </span>
          {t('settings.background.shuffle')}
        </button>
        <div className="dash-field">
          <span className="dash-field__label">{t('settings.background.changeBy')}</span>
          <div className="dash-segment" role="radiogroup">
            {LOOK_CHOICES.backgroundRandom.map((option) => (
              <button key={option} type="button" role="radio" aria-checked={look.backgroundRandom === option} className={look.backgroundRandom === option ? 'is-active' : ''} onClick={() => updateLook({ backgroundRandom: option })}>
                {t(`settings.background.random.${option}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="dash-chips" role="group" aria-label={t('settings.background.pickFrom')}>
          <span className="dash-field__label">{t('settings.background.pickFrom')}</span>
          {['presets', 'saved', 'wallpapers'].map((option) => {
            const on = look.backgroundPool.includes(option)
            return (
              <button key={option} type="button" className={on ? 'is-active' : ''} aria-pressed={on} onClick={() => updateLook({ backgroundPool: on ? look.backgroundPool.filter((entry) => entry !== option) : [...look.backgroundPool, option] })}>
                {t(`settings.background.pool.${option}`)}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* The dash's own font: uploaded (counted against the storage), a font file's address, or a Google Fonts family. */
export function CustomFontSettings() {
  const { t } = useTranslation('dash')
  const { look } = useDashSettings()
  const font = look.customFont
  const [source, setSource] = useState(font?.source ?? 'google')
  const [value, setValue] = useState(font && font.source !== 'file' ? font.value : '')
  const [upload, setUpload] = useState(null)
  const input = useRef(null)
  const setFont = (next) => updateLook({ font: 'custom', customFont: next })
  useCustomFont(look.font === 'custom' ? font : null)
  return (
    <div className="dash-font">
      <div className="dash-segment dash-segment--small" role="tablist">
        {['google', 'file', 'url'].map((option) => (
          <button key={option} type="button" role="tab" aria-selected={source === option} className={source === option ? 'is-active' : ''} onClick={() => setSource(option)}>
            {t(`settings.font.source.${option}`)}
          </button>
        ))}
      </div>
      {source === 'file' ? (
        <div className="dash-row">
          <button type="button" className="dash-button dash-button--small" onClick={() => input.current?.click()} disabled={Boolean(upload && !upload.error)}>
            <span className="material-symbols-outlined" aria-hidden="true">
              upload_file
            </span>
            {upload && !upload.error ? `${Math.round(upload.progress * 100)}%` : t('settings.font.upload')}
          </button>
          <input
            ref={input}
            type="file"
            accept=".woff2,.woff,.ttf,.otf,font/*"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              setUpload({ progress: 0 })
              try {
                const result = await uploadFile(file, 'font', { onProgress: (progress) => setUpload({ progress }) })
                setFont({ source: 'file', value: result.file.url, name: result.file.name, fileId: result.file.id })
                setUpload(null)
              } catch (error) {
                setUpload({ error: error.message })
              }
            }}
          />
          {font?.source === 'file' && <span className="dash-muted">{font.name}</span>}
        </div>
      ) : (
        <form
          className="dash-row"
          onSubmit={(event) => {
            event.preventDefault()
            const clean = value.trim()
            if (clean) setFont({ source, value: source === 'url' ? withScheme(clean) : clean, name: source === 'google' ? clean : t('settings.font.custom') })
          }}
        >
          <input className="dash-input" value={value} placeholder={source === 'google' ? 'Inter, Lora, Space Grotesk …' : 'https://…/font.woff2'} onChange={(event) => setValue(event.target.value)} aria-label={t(`settings.font.source.${source}`)} />
          <button type="submit" className="dash-button dash-button--small" disabled={!value.trim()}>
            {t('settings.font.use')}
          </button>
        </form>
      )}
      {upload?.error && <p className="dash-error">{upload.error}</p>}
      <p className="dash-hint">{t(`settings.font.hint.${source}`)}</p>
      {font && look.font === 'custom' && (
        <p className="dash-font__sample" style={{ fontFamily: 'var(--dash-custom-font), sans-serif' }}>
          {font.name}: The quick brown fox jumps over the lazy dog. 0123456789
        </p>
      )}
    </div>
  )
}
