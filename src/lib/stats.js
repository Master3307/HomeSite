import { accountFetch } from './account'

/*
 * The Stats page for FDC editors (server/services/statsWeb.cjs): the
 * migration log and the lobby cat's taps and pets. `range`: { from, to }
 * as YYYY-MM-DD (UTC days), both optional.
 */

async function call(path) {
  const response = await accountFetch(path)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status })
  return data
}

const query = ({ from, to } = {}) => {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const text = params.toString()
  return text ? `?${text}` : ''
}

let access = null
/** Whether this account may open the Stats page (asked once per page load). */
export function loadStatsAccess() {
  access ??= call('/stats/access')
    .then((data) => Boolean(data.allowed))
    .catch(() => {
      access = null
      return false
    })
  return access
}

export const loadMigrationStats = (range) => call(`/stats/migration${query(range)}`)
export const loadLobbyStats = (range) => call(`/stats/lobby${query(range)}`)
