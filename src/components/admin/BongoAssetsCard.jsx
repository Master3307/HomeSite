import { useEffect, useRef, useState } from 'react'

import { importAssets, inspectFolder, loadAssetStatus, loadCatalog, removeAssets } from '/src/lib/bongo'
import '/src/styles/backup.css'

/*
 * Settings → Bongo Cat assets: how to rip the game with AssetRipper, the
 * folder upload (first import or a game update), the installed version and
 * removing everything. Part of the hub's settings.
 * `getHeaders()`: extra auth headers, optional (the hub login is the cookie).
 */

const ASSETRIPPER = 'https://github.com/AssetRipper/AssetRipper/releases'

function Guide() {
  return (
    <ol className="bk-steps">
      <li>
        Download <a href={ASSETRIPPER} target="_blank" rel="noreferrer">AssetRipper</a> (the GUI release for your system) and start it. It opens a page in your
        browser.
      </li>
      <li>
        <strong>File → Open Folder</strong> and pick the game's folder, e.g. <code>Steam/steamapps/common/BongoCat</code> (in Steam: right-click Bongo Cat → Manage →
        Browse local files).
      </li>
      <li>
        Wait until loading finishes, then <strong>Export → Export All Files</strong> and choose an empty folder. Use the default “Unity project” format.
      </li>
      <li>
        Pick that export folder below. Only what the site needs is uploaded (item textures, the UI themes and icons, the game's fonts: about 40 MB the first
        time, only changes after that); everything else stays on your computer.
      </li>
      <li>After a game update, export again and pick the new folder: only changed and new files are sent, older items stay available.</li>
    </ol>
  )
}

export default function BongoAssetsCard({ getHeaders = () => ({}) }) {
  const [status, setStatus] = useState(null)
  const [folder, setFolder] = useState(null)
  const [progress, setProgress] = useState(null)
  const [report, setReport] = useState(null)
  const [error, setError] = useState(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const abortRef = useRef(null)
  const inputRef = useRef(null)

  const refresh = () =>
    loadAssetStatus(getHeaders())
      .then(setStatus)
      .catch((reason) => setError(reason.message))

  useEffect(() => {
    refresh()
    return () => abortRef.current?.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function pick(event) {
    setReport(null)
    setError(null)
    const found = inspectFolder(event.target.files ?? [])
    setFolder(found.problem ? null : found)
    if (found.problem) setError(found.problem)
    event.target.value = ''
  }

  async function run() {
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setProgress({ step: 'Starting', done: 0, total: 0 })
    try {
      const result = await importAssets(folder, { headers: getHeaders(), onProgress: setProgress, signal: controller.signal })
      setReport(result.report)
      setFolder(null)
      await loadCatalog({ fresh: true })
      await refresh()
    } catch (reason) {
      setError(reason.message)
    } finally {
      setProgress(null)
      abortRef.current = null
    }
  }

  async function remove() {
    setError(null)
    try {
      await removeAssets(getHeaders())
      setConfirmRemove(false)
      setReport(null)
      await loadCatalog({ fresh: true })
      await refresh()
    } catch (reason) {
      setError(reason.message)
    }
  }

  const counts = status?.counts ?? {}
  const busy = Boolean(progress)

  return (
    <div className="as-backup">
      <section className="bk-card">
        <header>
          <span className="bk-card__icon material-symbols-outlined" aria-hidden="true">
            pets
          </span>
          <div>
            <h2>Bongo Cat assets</h2>
            <p>
              The lobby cat, the cat designer and FDC designs use the game's own textures from your copy of Bongo Cat. Without them the lobby cat stays hidden and FDC
              options need an image.
            </p>
          </div>
        </header>

        {status?.imported ? (
          <p className="bk-ok">
            Installed: {counts.skin ?? 0} skins, {counts.hat ?? 0} accessories, {counts.bongos ?? 0} bongos, {counts.themes ?? 0} UI themes, {counts.fonts ?? 0} fonts ({status.textures} files),
            last updated {new Date(status.updatedAt).toLocaleString()}.
          </p>
        ) : (
          status && <p className="bk-warning">Not imported yet.</p>
        )}

        <Guide />

        <input ref={inputRef} type="file" webkitdirectory="" directory="" multiple hidden onChange={pick} />
        <div className="bk-actions">
          <button type="button" className="bk-button" disabled={busy} onClick={() => inputRef.current?.click()}>
            <span className="material-symbols-outlined" aria-hidden="true">
              folder_open
            </span>
            {folder ? 'Pick another folder' : 'Pick the export folder'}
          </button>
          {folder && (
            <button type="button" className="bk-button" disabled={busy} onClick={run}>
              <span className="material-symbols-outlined" aria-hidden="true">
                upload
              </span>
              {status?.imported ? 'Update assets' : 'Import assets'}
            </button>
          )}
          {busy && (
            <button type="button" className="bk-button bk-button--ghost" onClick={() => abortRef.current?.abort()}>
              Cancel
            </button>
          )}
        </div>

        {folder && !busy && (
          <p className="bk-note">
            Found {folder.items.size} item definitions, {folder.textures.size} textures, {folder.sprites.size} sprites and {folder.fonts.size} fonts. Nothing is sent until you press{' '}
            {status?.imported ? 'Update' : 'Import'}.
          </p>
        )}

        {progress && (
          <div className="bk-progress" role="status">
            <span>
              {progress.step}
              {progress.total ? ` ${progress.done} / ${progress.total}` : '…'}
            </span>
            <progress max={progress.total || 1} value={progress.total ? progress.done : undefined} />
          </div>
        )}

        {report && (
          <p className="bk-success" role="status">
            Done: {report.added} new item(s), {report.updated} updated, {report.changedFiles} file(s) written
            {report.kept ? `, ${report.kept} older item(s) kept` : ''}.
            {report.skipped ? ` Skipped ${report.skipped} item(s) whose textures are missing (${report.skippedItems.join(', ')}).` : ''}
          </p>
        )}
        {error && (
          <p className="bk-error" role="alert">
            {error}
          </p>
        )}

        {status?.history?.length > 0 && (
          <details className="bk-section">
            <summary>Import history</summary>
            <ul className="bk-units">
              {status.history.map((entry) => (
                <li key={entry.at}>
                  {new Date(entry.at).toLocaleString()}: {entry.label}, {entry.added} new, {entry.updated} updated, {entry.changedFiles} files
                </li>
              ))}
            </ul>
          </details>
        )}

        {status?.imported && (
          <div className="bk-actions">
            {confirmRemove ? (
              <>
                <span className="bk-warning">Remove all imported assets? The lobby cat disappears until you import again. FDC images already made stay.</span>
                <button type="button" className="bk-button bk-button--danger" onClick={remove}>
                  Remove
                </button>
                <button type="button" className="bk-button bk-button--ghost" onClick={() => setConfirmRemove(false)}>
                  Keep
                </button>
              </>
            ) : (
              <button type="button" className="bk-link" onClick={() => setConfirmRemove(true)}>
                Remove the assets
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
