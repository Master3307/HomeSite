/*
 * Boards from other dashboards, read into the dash's own widgets. Pure: no
 * DOM, no fetching (tested in tests/dashImport.test.mjs); the YAML parser is
 * handed in (`yaml`, loaded only when someone imports).
 *
 *   readDashboard(text, { name, parseYaml })  -> { source, pages: [{ name, columns?, widgets: [{ type, title, options, column? }] }], skipped: [kind] }
 *
 * Understood: Glance (glance.yml: pages, columns, groups / split columns),
 * Homarr (0.x board JSON: apps by category + widgets; 1.x board export:
 * items by kind), Dashy (conf.yml: sections, items, widgets), Homepage
 * (services.yaml / bookmarks.yaml / widgets.yaml) and browser bookmark
 * files (Netscape HTML from Chrome, Firefox, Edge, Safari). Whatever has no
 * counterpart here is named in `skipped`, never dropped silently.
 */

const MAX_LINKS = 100
const str = (value, max = 300) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, max) : '')
const isUrl = (value) => /^https?:\/\//i.test(str(value, 2000))
const link = (title, url, icon = '', description = '') => (isUrl(url) ? { title: str(title, 120) || hostOf(url), url: str(url, 2000), icon: cleanIcon(icon), description: str(description, 200) } : null)
const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
/* Icons: links stay links; "si:github", "di:jellyfin", "mdi-…", "fas fa-…" become the plain name the dash's icon sources know. */
function cleanIcon(icon) {
  const value = str(icon, 300)
  if (!value) return ''
  if (isUrl(value)) return value
  const name = value
    .replace(/^(si|di|sh|mdi|hl|favicon)[:-]/i, '')
    .replace(/^fa[srb]? fa-/i, '')
    .replace(/\.(svg|png|webp)$/i, '')
  return /^[a-z0-9-]{1,60}$/i.test(name) ? name.toLowerCase() : ''
}
const bookmarks = (title, links) => {
  const items = links.filter(Boolean).slice(0, MAX_LINKS)
  return items.length ? { type: 'bookmarks', title: str(title, 60), options: { items } } : null
}

/* ---------- Glance ---------- */

const GLANCE_SORT = { top: 'top', new: 'new', best: 'best' }
function glanceWidget(widget, skipped) {
  const type = str(widget?.type, 40)
  const title = str(widget?.title, 60)
  switch (type) {
    case 'bookmarks':
      return (Array.isArray(widget.groups) ? widget.groups : []).map((group) => bookmarks(group.title || title, (group.links ?? []).map((item) => link(item.title, item.url, item.icon, item.description))))
    case 'rss':
      return { type: 'feed', title, options: { feeds: (widget.feeds ?? []).filter((feed) => isUrl(feed.url)).slice(0, 30).map((feed) => ({ url: str(feed.url, 2000), title: str(feed.title, 80) })), ...(widget.limit ? { limit: Math.min(60, Number(widget.limit) || 15) } : {}) } }
    case 'weather':
      return { type: 'weather', title, options: { place: str(widget.location, 120), unit: widget.units === 'imperial' ? 'f' : 'c' }, geocode: str(widget.location, 120) }
    case 'calendar':
    case 'calendar-legacy':
      return { type: 'calendar', title, options: { weekStart: widget['first-day-of-week'] === 'sunday' ? 'sunday' : widget['first-day-of-week'] === 'monday' ? 'monday' : 'locale' } }
    case 'clock': {
      const zones = (widget.timezones ?? []).filter((zone) => zone?.timezone).slice(0, 12)
      if (zones.length) return { type: 'worldclock', title, options: { zones: zones.map((zone) => ({ zone: str(zone.timezone, 60), label: str(zone.label, 40) })) } }
      return { type: 'clock', title, options: {} }
    }
    case 'search':
      return { type: 'search', title, options: {} }
    case 'hacker-news':
      return { type: 'hackernews', title, options: { list: GLANCE_SORT[widget['sort-by']] ?? 'top', count: Math.min(50, Math.max(3, Number(widget.limit) || 15)) } }
    case 'releases': {
      const repos = (widget.repositories ?? [])
        .map((entry) => (typeof entry === 'string' ? entry : entry?.repository))
        .filter(Boolean)
        .slice(0, 30)
        .map((entry) => {
          const [, source = 'github', repo] = /^(?:(gitlab|codeberg|dockerhub):)?(.+)$/.exec(String(entry)) ?? []
          return { source: source === 'codeberg' ? 'gitea' : source === 'dockerhub' ? 'docker' : source, repo: str(repo, 200) }
        })
      return { type: 'releases', title, options: { repos } }
    }
    case 'repository':
      return { type: 'repo', title, options: { source: 'github', repo: str(widget.repository, 200) } }
    case 'monitor':
      return { type: 'status', title, options: { items: (widget.sites ?? []).map((site) => link(site.title, site.url, site.icon)).filter(Boolean).slice(0, 40) } }
    case 'iframe':
      return isUrl(widget.source) ? { type: 'iframe', title, options: { url: str(widget.source, 2000) } } : null
    case 'html':
      return { type: 'html', title, options: { code: str(widget.source, 20000) } }
    case 'to-do':
      return { type: 'todo', title, options: {} }
    case 'group':
    case 'split-column':
      return (widget.widgets ?? []).flatMap((inner) => [glanceWidget(inner, skipped)].flat())
    default:
      if (type) skipped.add(`glance:${type}`)
      return null
  }
}
function fromGlance(config) {
  const skipped = new Set()
  const pages = (config.pages ?? []).map((page) => {
    const columns = (page.columns ?? []).map((column) => (column.size === 'full' ? 2 : 1))
    const widgets = []
    ;(page.columns ?? []).forEach((column, index) => {
      for (const widget of column.widgets ?? []) for (const made of [glanceWidget(widget, skipped)].flat().filter(Boolean)) widgets.push({ ...made, column: index })
    })
    for (const widget of page['head-widgets'] ?? []) for (const made of [glanceWidget(widget, skipped)].flat().filter(Boolean)) widgets.unshift({ ...made, column: 0 })
    return { name: str(page.name, 40), columns: columns.length ? columns : null, widgets }
  })
  return { source: 'glance', pages, skipped: [...skipped] }
}

/* ---------- Homarr ---------- */

function homarrWeather(location, title = '') {
  const lat = Number(location?.latitude)
  const lon = Number(location?.longitude)
  const ok = Number.isFinite(lat) && Number.isFinite(lon)
  return { type: 'weather', title, options: { place: str(location?.name, 120), ...(ok ? { lat: String(lat), lon: String(lon) } : {}) }, ...(ok ? {} : { geocode: str(location?.name, 120) }) }
}
function fromHomarrOld(config) {
  const skipped = new Set()
  const categories = new Map((config.categories ?? []).map((category) => [category.id, str(category.name, 60)]))
  const groups = new Map()
  for (const app of config.apps ?? []) {
    const group = categories.get(app.area?.properties?.id) ?? ''
    const url = app.behaviour?.externalUrl || app.url
    groups.set(group, [...(groups.get(group) ?? []), link(app.name, url, app.appearance?.iconUrl)])
  }
  const widgets = [...groups].map(([name, links]) => bookmarks(name, links))
  for (const widget of config.widgets ?? []) {
    const props = widget.properties ?? {}
    const made = {
      weather: () => homarrWeather(props.location),
      date: () => ({ type: 'clock', title: '', options: { seconds: false } }),
      calendar: () => ({ type: 'calendar', title: '', options: {} }),
      rss: () => ({ type: 'feed', title: '', options: { feeds: [props.rssFeedUrl].flat().filter(isUrl).slice(0, 30).map((url) => ({ url, title: '' })) } }),
      iframe: () => (isUrl(props.embedUrl) ? { type: 'iframe', title: '', options: { url: props.embedUrl } } : null),
      notebook: () => ({ type: 'note', title: '', options: { text: str(props.content, 20000) } }),
      bookmark: () => bookmarks('', (props.items ?? []).map((item) => link(item.name, item.href, item.iconUrl))),
    }[widget.type]
    if (made) widgets.push(made())
    else if (widget.type) skipped.add(`homarr:${widget.type}`)
  }
  return { source: 'homarr', pages: [{ name: str(config.configProperties?.name ?? config.name, 40), widgets: widgets.filter(Boolean) }], skipped: [...skipped] }
}
function fromHomarrNew(config) {
  const skipped = new Set()
  const apps = new Map((config.apps ?? []).map((app) => [app.id, app]))
  const boards = Array.isArray(config.boards) ? config.boards : [config.board ?? config]
  const pages = boards.map((board) => {
    const appLinks = []
    const widgets = []
    for (const item of board.items ?? []) {
      const options = item.options ?? {}
      switch (item.kind) {
        case 'app': {
          const app = apps.get(options.appId) ?? item.app ?? {}
          appLinks.push(link(app.name, app.href ?? app.url, app.iconUrl, app.description))
          break
        }
        case 'clock':
          widgets.push({ type: 'clock', title: '', options: { seconds: Boolean(options.showSeconds) } })
          break
        case 'weather':
          widgets.push(homarrWeather(options.location))
          break
        case 'rssFeed':
          widgets.push({ type: 'feed', title: '', options: { feeds: (options.feedUrls ?? []).filter(isUrl).slice(0, 30).map((url) => ({ url, title: '' })) } })
          break
        case 'iframe':
          if (isUrl(options.embedUrl)) widgets.push({ type: 'iframe', title: '', options: { url: options.embedUrl } })
          break
        case 'notebook':
          widgets.push({ type: 'note', title: '', options: { text: str(options.content, 20000) } })
          break
        case 'calendar':
          widgets.push({ type: 'calendar', title: '', options: {} })
          break
        case 'bookmarks':
          widgets.push(bookmarks(options.title, (options.items ?? []).map((id) => apps.get(id)).filter(Boolean).map((app) => link(app.name, app.href, app.iconUrl))))
          break
        default:
          if (item.kind) skipped.add(`homarr:${item.kind}`)
      }
    }
    return { name: str(board.name, 40), widgets: [bookmarks('', appLinks), ...widgets].filter(Boolean) }
  })
  return { source: 'homarr', pages, skipped: [...skipped] }
}

/* ---------- Dashy ---------- */

function fromDashy(config) {
  const skipped = new Set()
  const widgets = []
  for (const section of config.sections ?? []) {
    const made = bookmarks(section.name, (section.items ?? []).map((item) => link(item.title, item.url, item.icon, item.description)))
    if (made) widgets.push(made)
    for (const widget of section.widgets ?? []) {
      const options = widget.options ?? {}
      const kind = str(widget.type, 40)
      if (kind === 'clock') widgets.push({ type: 'clock', title: '', options: {} })
      else if (kind === 'weather' || kind === 'weather-forecast') widgets.push({ type: 'weather', title: '', options: { place: str(options.city, 120), unit: options.units === 'imperial' ? 'f' : 'c' }, geocode: str(options.city, 120) })
      else if (kind === 'rss-feed' && isUrl(options.rssUrl)) widgets.push({ type: 'feed', title: '', options: { feeds: [{ url: options.rssUrl, title: '' }] } })
      else if (kind === 'iframe' && isUrl(options.url)) widgets.push({ type: 'iframe', title: '', options: { url: options.url } })
      else if (kind === 'hackernews-trending') widgets.push({ type: 'hackernews', title: '', options: {} })
      else if (kind) skipped.add(`dashy:${kind}`)
    }
  }
  return { source: 'dashy', pages: [{ name: str(config.pageInfo?.title, 40), widgets }], skipped: [...skipped] }
}

/* ---------- Homepage (gethomepage.dev) ---------- */

/* services.yaml / bookmarks.yaml: [{ Group: [{ Name: { href, icon, description } | [{ href, abbr }] }] }] */
function fromHomepage(list) {
  const skipped = new Set()
  const widgets = []
  for (const group of list) {
    const [name, entries] = Object.entries(group ?? {})[0] ?? []
    if (!Array.isArray(entries)) continue
    // A widgets.yaml entry: { datetime: {…} } / { openmeteo: {…} } / { search: {…} }
    if (['datetime', 'openmeteo', 'openweathermap', 'search', 'resources', 'greeting'].includes(name)) continue
    const links = entries.map((entry) => {
      const [title, value] = Object.entries(entry ?? {})[0] ?? []
      const info = Array.isArray(value) ? value[0] : value
      if (info?.widget?.type) skipped.add(`homepage:${info.widget.type}`)
      return link(title, info?.href, info?.icon, info?.description)
    })
    const made = bookmarks(name, links)
    if (made) widgets.push(made)
  }
  for (const entry of list) {
    const [kind, options = {}] = Object.entries(entry ?? {})[0] ?? []
    if (kind === 'datetime') widgets.unshift({ type: 'clock', title: '', options: {} })
    if (kind === 'openmeteo' || kind === 'openweathermap') widgets.unshift(Number.isFinite(Number(options.latitude)) ? { type: 'weather', title: str(options.label, 60), options: { place: str(options.label, 120), lat: String(options.latitude), lon: String(options.longitude), unit: options.units === 'imperial' ? 'f' : 'c' } } : null)
  }
  return { source: 'homepage', pages: [{ name: '', widgets: widgets.filter(Boolean) }], skipped: [...skipped] }
}

/* ---------- browser bookmarks (Netscape HTML) ---------- */

const decode = (text) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
function fromBrowserBookmarks(html) {
  // Folders by their <H3> heading; links into the folder they were last inside.
  const groups = []
  const stack = []
  const pattern = /<H3[^>]*>([\s\S]*?)<\/H3>|<A\s[^>]*HREF="([^"]*)"[^>]*>([\s\S]*?)<\/A>|<\/DL>/gi
  let pendingFolder = null
  for (const match of html.matchAll(pattern)) {
    if (match[1] !== undefined) {
      pendingFolder = { name: decode(match[1].replace(/<[^>]+>/g, '')).trim(), links: [] }
      groups.push(pendingFolder)
      stack.push(pendingFolder)
    } else if (match[2] !== undefined) {
      const folder = stack.at(-1) ?? (groups[0]?.name === '' ? groups[0] : (groups.unshift({ name: '', links: [] }), groups[0]))
      folder.links.push(link(decode(match[3].replace(/<[^>]+>/g, '')), decode(match[2])))
    } else stack.pop()
  }
  const widgets = groups.map((group) => bookmarks(group.name, group.links)).filter(Boolean)
  return { source: 'browser', pages: [{ name: '', widgets }], skipped: [] }
}

/** Reads another dashboard's export or config (see the top of this file). Throws `unknown` when it's none of them. */
export function readDashboard(text, { name = '', parseYaml = null } = {}) {
  const raw = String(text ?? '')
  if (/<!DOCTYPE NETSCAPE-Bookmark-file/i.test(raw) || (/\.html?$/i.test(name) && /<A\s[^>]*HREF=/i.test(raw))) return limit(fromBrowserBookmarks(raw))
  let data = null
  try {
    data = JSON.parse(raw)
  } catch {
    if (!parseYaml) throw new Error('unknown')
    try {
      data = parseYaml(raw)
    } catch {
      throw new Error('unknown')
    }
  }
  if (Array.isArray(data)) return limit(fromHomepage(data))
  if (!data || typeof data !== 'object') throw new Error('unknown')
  if (Array.isArray(data.pages) && data.pages.some((page) => Array.isArray(page?.columns))) return limit(fromGlance(data))
  if (Array.isArray(data.apps) && (Array.isArray(data.widgets) || data.configProperties || Array.isArray(data.categories))) return limit(fromHomarrOld(data))
  if (Array.isArray(data.items) || Array.isArray(data.boards) || data.board) return limit(fromHomarrNew(data))
  if (Array.isArray(data.sections)) return limit(fromDashy(data))
  throw new Error('unknown')
}

/* At most 12 pages, 80 widgets in all (the dash's limits). */
function limit(result) {
  let left = 80
  const pages = result.pages
    .filter((page) => page.widgets.length)
    .slice(0, 12)
    .map((page) => {
      const widgets = page.widgets.filter(Boolean).slice(0, Math.max(0, left))
      left -= widgets.length
      return { ...page, widgets }
    })
    .filter((page) => page.widgets.length)
  return { ...result, pages, widgets: pages.reduce((sum, page) => sum + page.widgets.length, 0) }
}
