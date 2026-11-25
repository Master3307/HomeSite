/*
 * Sending a file to the account API with real progress. Anything over 50 MB
 * goes in 32 MB parts first (server/services/chunkedUploads.cjs: Cloudflare
 * refuses request bodies over 100 MB), then the real route is called with
 * X-Upload-Id and no body. A part that fails is sent again (3 tries), from
 * where the server says it got to.
 *
 *   sendFile(path, file, { purpose, method, headers, onProgress, signal })  -> the route's JSON answer
 */
import { ACCOUNT_API_URL } from './account.js'

export const CHUNKED_FROM = 50 * 1024 * 1024
const TRIES = 3

/* One request through XHR (fetch has no upload progress): { status, data }. */
function request(method, path, { body = null, headers = {}, onProgress = null, signal = null } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, `${ACCOUNT_API_URL}${path}`)
    xhr.withCredentials = true
    xhr.setRequestHeader('X-Requested-With', 'homesite-web')
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value)
    if (onProgress) xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded, event.total)
    xhr.onload = () => {
      let data = {}
      try {
        data = JSON.parse(xhr.responseText)
      } catch {
        data = {}
      }
      resolve({ status: xhr.status, data })
    }
    xhr.onerror = () => reject(Object.assign(new Error('The upload failed (connection).'), { network: true }))
    xhr.onabort = () => reject(Object.assign(new Error('The upload was stopped.'), { name: 'AbortError' }))
    if (signal) {
      if (signal.aborted) return xhr.abort()
      signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }
    xhr.send(body)
  })
}
const failed = ({ status, data }) => Object.assign(new Error(data.error || `HTTP ${status}`), { status, data })

/** Sends `file` to `path` (POST unless `method` says otherwise); big files in parts for `purpose`. */
export async function sendFile(path, file, { purpose, method = 'POST', headers = {}, onProgress = null, signal = null } = {}) {
  const progress = (fraction) => onProgress?.(Math.max(0, Math.min(1, fraction)))
  if (file.size <= CHUNKED_FROM || !purpose) {
    const answer = await request(method, path, { body: file, headers: { 'Content-Type': 'application/octet-stream', ...headers }, onProgress: (loaded, total) => progress(loaded / total), signal })
    if (answer.status >= 400) throw failed(answer)
    return answer.data
  }

  const start = await request('POST', '/uploads', { body: JSON.stringify({ purpose, name: file.name, size: file.size }), headers: { 'Content-Type': 'application/json' }, signal })
  if (start.status >= 400) throw failed(start)
  const { id, chunkSize } = start.data
  const giveUp = () => request('DELETE', `/uploads/${id}`).catch(() => {})
  try {
    let offset = 0
    let tries = 0
    while (offset < file.size) {
      const part = file.slice(offset, Math.min(file.size, offset + chunkSize))
      let answer
      try {
        answer = await request('PUT', `/uploads/${id}?offset=${offset}`, {
          body: part,
          headers: { 'Content-Type': 'application/octet-stream' },
          // The last 2 % is the server storing it.
          onProgress: (loaded) => progress(((offset + loaded) / file.size) * 0.98),
          signal,
        })
      } catch (error) {
        if (error.name === 'AbortError' || ++tries >= TRIES) throw error
        await new Promise((resolve) => setTimeout(resolve, 1000 * tries))
        continue
      }
      if (answer.status < 400) {
        offset = answer.data.received
        tries = 0
        continue
      }
      // The server says how far it got (a part arrived although its answer didn't): go on from there.
      if (Number.isSafeInteger(answer.data.received) && answer.status !== 413 && ++tries < TRIES) {
        offset = answer.data.received
        continue
      }
      throw failed(answer)
    }
    const done = await request(method, path, { headers: { 'X-Upload-Id': id }, signal })
    if (done.status >= 400) throw failed(done)
    progress(1)
    return done.data
  } catch (error) {
    giveUp()
    throw error
  }
}
