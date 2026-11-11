#!/usr/bin/env node
/**
 * Builds the site search index used by `src/components/Search.jsx`.
 *
 * How it works:
 *   1. Read the routes from `src/App.jsx` (`<Route path="…" element={<X />} />`).
 *   2. For every route, resolve the page component and crawl it plus every
 *      local component it imports (recursively).
 *   3. Collect the page title (`<title>` / Helmet `title` constant), the
 *      i18n namespaces (`useTranslation(...)`) and every static `t('key')` call.
 *   4. Resolve those keys against every language in `src/locales/<lang>/*.json`.
 *
 * Every piece of indexed text gets a stable identifier `<namespace>:<key>`
 * (e.g. `about:about.card.line1`) plus the component file it came from, so a
 * search hit can always be traced back to its source.
 *
 * Output: `public/search-index.json` (copied to `dist/` by `vite build`).
 *
 * Usage:
 *   pnpm search:index            # write public/search-index.json
 *   pnpm search:index --stdout   # print the index instead of writing it
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = path.join(projectRoot, 'src')
const localesDir = path.join(srcDir, 'locales')
const appFile = path.join(srcDir, 'App.jsx')
const outFile = path.join(projectRoot, 'public', 'search-index.json')

const DEFAULT_LANGUAGE = 'en'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Routes that never show up in search results. */
const EXCLUDED_ROUTES = new Set(['*', '/error', '/filter'])

/** Components that are UI chrome rather than page content. */
const EXCLUDED_COMPONENTS = new Set([
  'BackButton.jsx',
  'CloseButton.jsx',
  'LanguageSwitch.jsx',
  'ThemeSwitch.jsx',
  'Login.jsx',
  'Search.jsx',
])

/** Namespaces that only hold UI status strings (loading, errors, buttons…). */
const EXCLUDED_NAMESPACES = new Set(['language', 'themeswitch', 'login', 'error'])

/** Individual keys that are pure UI noise (matched against `<ns>:<key>`). */
const EXCLUDED_KEY_PATTERNS = [
  /^discord:/,
  /:.*(loading|Loading|failed|Failed|Error|error|AriaLabel|aria)/,
  /^lobby-code:copy(Button|Status)\./,
  /^dash:settings\.(moveUp|moveDown|edit|delete|save|add|cancel|close)$/,
  /^maps:common\./,
]

/**
 * Optional hand-written extras per route: keywords and a description that the
 * crawler can't infer. Keys are route paths.
 */
const ROUTE_META = {
  '/': {
    keywords: ['home', 'start', 'homepage', 'welcome', 'mrkoby07', 'master3307', 'startseite'],
  },
  '/card': {
    keywords: ['card', 'profile', 'user card', 'korbi', 'discord', 'presence', 'status', 'about me', 'profil'],
    description: 'Personal user card with Discord presence.',
  },
  '/about': {
    keywords: ['about', 'info', 'source', 'github', 'website', 'über'],
  },
  '/dash': {
    keywords: ['dashboard', 'start page', 'new tab', 'search', 'widgets', 'custom css', 'theme', 'backup'],
    description: 'Personal start page with web search, widgets and custom CSS.',
  },
  '/collect': {
    keywords: ['collect', 'data', 'tracking', 'privacy', 'filter'],
  },
  '/cult': {
    keywords: ['cult', 'black cats', 'discord', 'community', 'server', 'lobby', 'fdc', 'friday dress code', 'voting', 'poll'],
  },
  '/cult/profile': {
    keywords: ['cult', 'profile', 'account', 'login', 'discord'],
    description: 'Your Cult of Black Cats profile.',
  },
  '/maps': {
    keywords: ['maps', 'map', 'karte', 'openstreetmap', 'osm', 'satellite', 'directions', 'route', 'routing', 'navigation', 'places', 'favorites', 'photos', 'panoramax'],
    description: 'OpenStreetMap maps with satellite layers, directions, saved places, photos and OSM editing.',
  },
}

// ---------------------------------------------------------------------------
// Locales
// ---------------------------------------------------------------------------

function loadLocales() {
  const locales = {}

  for (const language of fs.readdirSync(localesDir)) {
    const languageDir = path.join(localesDir, language)
    if (!fs.statSync(languageDir).isDirectory()) continue

    locales[language] = {}
    for (const file of fs.readdirSync(languageDir)) {
      if (!file.endsWith('.json')) continue
      try {
        locales[language][file.replace(/\.json$/, '')] = JSON.parse(
          fs.readFileSync(path.join(languageDir, file), 'utf8'),
        )
      } catch (error) {
        console.warn(`⚠ Skipping invalid locale file ${language}/${file}: ${error.message}`)
      }
    }
  }

  return locales
}

function lookup(messages, key) {
  if (!messages) return undefined
  if (typeof messages[key] === 'string') return messages[key] // flat keys

  let value = messages
  for (const part of key.split('.')) {
    if (value == null || typeof value !== 'object') return undefined
    value = value[part]
  }
  return typeof value === 'string' ? value : undefined
}

/** Resolves a key, including i18next plural forms (`key_one`, `key_other`). */
function resolveKey(messages, key) {
  return lookup(messages, key) ?? lookup(messages, `${key}_other`) ?? lookup(messages, `${key}_one`)
}

/** Strip HTML, interpolation placeholders and collapse whitespace. */
function cleanText(value) {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    // Drop `{{placeholders}}`, including the space before trailing punctuation.
    .replace(/\s*\{\{[^}]+\}\}(\s*[!?.,:;…])?/g, (_, punctuation) =>
      punctuation ? punctuation.trim() : ' ',
    )
    .replace(/([,;:])([!?.])/g, '$2') // "Welcome, {{user}}!" -> "Welcome!"
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// Source crawling
// ---------------------------------------------------------------------------

const RESOLVE_EXTENSIONS = ['', '.jsx', '.js', '/index.jsx', '/index.js']

function resolveImport(fromFile, specifier) {
  let base
  if (specifier.startsWith('/src/')) base = path.join(projectRoot, specifier)
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(fromFile), specifier)
  else return null // package import

  for (const extension of RESOLVE_EXTENSIONS) {
    const candidate = base + extension
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}

function parseImports(file, source) {
  const imports = new Map() // local identifier -> absolute file

  for (const match of source.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]/g)) {
    const resolved = resolveImport(file, match[2])
    if (resolved && /\.(jsx?|mjs)$/.test(resolved)) imports.set(match[1], resolved)
  }

  // Lazy routes: const X = lazy(() => import('./pages/X.jsx'))
  for (const match of source.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*lazy\(\s*\(\)\s*=>\s*import\(\s*['"]([^'"]+)['"]\s*\)\s*\)/g)) {
    const resolved = resolveImport(file, match[2])
    if (resolved && /\.(jsx?|mjs)$/.test(resolved)) imports.set(match[1], resolved)
  }

  return imports
}

/** Namespaces passed to `useTranslation`, first one is the default. */
function parseNamespaces(source) {
  const match = source.match(/useTranslation\(\s*(\[[^\]]*\]|['"][^'"]+['"])?/)
  if (!match?.[1]) return ['common']

  const namespaces = [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1])
  return namespaces.length ? namespaces : ['common']
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length
}

/**
 * Finds every static `t('key')` / `t("key", { ns: 'x' })` call.
 * Template literals and variables can't be resolved statically and are skipped.
 */
function parseTranslationCalls(source, defaultNamespace) {
  const calls = []
  const pattern = /(?<![\w$.])t\(\s*(['"])([^'"]+)\1\s*(,\s*\{[^}]*\})?/g

  for (const match of source.matchAll(pattern)) {
    let key = match[2]
    let namespace = defaultNamespace

    const nsOption = match[3]?.match(/\bns\s*:\s*['"]([^'"]+)['"]/)
    if (nsOption) namespace = nsOption[1]

    const prefixed = key.match(/^([\w-]+):(.+)$/)
    if (prefixed) [, namespace, key] = prefixed

    // Rough element detection: what tag was opened last before this call?
    const before = source.slice(Math.max(0, match.index - 300), match.index)
    const lastTag = [...before.matchAll(/<(\/?)([a-zA-Z][\w.]*)/g)].pop()
    const tag = lastTag && !lastTag[1] ? lastTag[2].toLowerCase() : null

    calls.push({ namespace, key, tag, line: lineOf(source, match.index) })
  }

  return calls
}

function parseTitle(source) {
  const helmetTitle = source.match(/const\s+title\s*=\s*['"]([^'"]+)['"]/)
  if (helmetTitle) return helmetTitle[1]

  const titleTag = source.match(/<title>([^<{]+)<\/title>/)
  return titleTag ? titleTag[1].trim() : null
}

function parseDescription(source) {
  return source.match(/const\s+description\s*=\s*['"]([^'"]+)['"]/)?.[1] ?? null
}

/** Crawls a page and all local components it imports. */
function crawlPage(entryFile) {
  const visited = new Set()
  const entries = []
  let title = null
  let description = null

  const visit = (file) => {
    if (visited.has(file)) return
    visited.add(file)
    if (EXCLUDED_COMPONENTS.has(path.basename(file))) return

    const source = fs.readFileSync(file, 'utf8')
    const relativeFile = path.relative(projectRoot, file).split(path.sep).join('/')

    if (file === entryFile) {
      title = parseTitle(source)
      description = parseDescription(source)
    }

    const [defaultNamespace] = parseNamespaces(source)
    for (const call of parseTranslationCalls(source, defaultNamespace)) {
      entries.push({ ...call, file: relativeFile })
    }

    // Only follow imports that are actually rendered as JSX.
    for (const [identifier, importedFile] of parseImports(file, source)) {
      if (new RegExp(`<${identifier}[\\s/>]`).test(source)) visit(importedFile)
    }
  }

  visit(entryFile)
  return { title, description, entries }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function parseRoutes() {
  const source = fs.readFileSync(appFile, 'utf8')
  const imports = parseImports(appFile, source)
  const routes = []

  for (const match of source.matchAll(/<Route\s+path=["']([^"']+)["']\s+element=\{<([A-Za-z_$][\w$]*)/g)) {
    const [, routePath, component] = match
    const file = imports.get(component)
    if (!file) {
      console.warn(`⚠ Could not resolve component <${component}> for route ${routePath}`)
      continue
    }
    routes.push({ path: routePath, component, file })
  }

  return routes
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function buildIndex() {
  const locales = loadLocales()
  const languages = Object.keys(locales).sort()
  const routes = parseRoutes()

  // Group aliases (`/`, `/home`, `/heim`) that render the same component.
  const pagesByFile = new Map()
  for (const route of routes) {
    if (EXCLUDED_ROUTES.has(route.path)) continue

    const existing = pagesByFile.get(route.file)
    if (existing) existing.aliases.push(route.path)
    else pagesByFile.set(route.file, { ...route, aliases: [] })
  }

  const pages = []

  for (const route of pagesByFile.values()) {
    const crawl = crawlPage(route.file)
    const meta = ROUTE_META[route.path] ?? {}
    const seen = new Set()
    const content = []

    for (const entry of crawl.entries) {
      const id = `${entry.namespace}:${entry.key}`
      if (seen.has(id)) continue
      seen.add(id)

      if (EXCLUDED_NAMESPACES.has(entry.namespace)) continue
      if (EXCLUDED_KEY_PATTERNS.some((pattern) => pattern.test(id))) continue

      const text = {}
      for (const language of languages) {
        const value = resolveKey(locales[language]?.[entry.namespace], entry.key)
        const cleaned = value ? cleanText(value) : ''
        if (cleaned) text[language] = cleaned
      }
      if (!text[DEFAULT_LANGUAGE] && !Object.keys(text).length) continue

      // Collapse translations identical to English to keep the index small.
      for (const language of languages) {
        if (language !== DEFAULT_LANGUAGE && text[language] === text[DEFAULT_LANGUAGE]) {
          delete text[language]
        }
      }

      content.push({
        id,
        type: /^h[1-6]$/.test(entry.tag ?? '') ? 'heading' : 'text',
        source: `${entry.file}:${entry.line}`,
        text,
      })
    }

    // The page `<h1>` (title namespace) becomes a localized heading.
    const heading = content.find((item) => item.id.startsWith('title:'))

    pages.push({
      id: `page:${route.path}`,
      path: route.path,
      aliases: route.aliases,
      title: crawl.title ?? route.component,
      heading: heading?.text ?? null,
      description: meta.description ?? crawl.description ?? null,
      keywords: meta.keywords ?? [],
      source: path.relative(projectRoot, route.file).split(path.sep).join('/'),
      content: content.filter((item) => item !== heading),
    })
  }

  // Content shared by several pages (e.g. the About teaser card) is less
  // specific to any single page; the client uses this to down-rank it.
  const occurrences = new Map()
  for (const page of pages) {
    for (const item of page.content) occurrences.set(item.id, (occurrences.get(item.id) ?? 0) + 1)
  }
  for (const page of pages) {
    for (const item of page.content) item.shared = occurrences.get(item.id)
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    defaultLanguage: DEFAULT_LANGUAGE,
    languages,
    pages,
  }
}

const index = buildIndex()
const json = `${JSON.stringify(index, null, 2)}\n`

if (process.argv.includes('--stdout')) {
  process.stdout.write(json)
} else {
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, json)

  const entryCount = index.pages.reduce((sum, page) => sum + page.content.length, 0)
  console.log(
    `✓ Search index: ${index.pages.length} pages, ${entryCount} content entries, ` +
      `${index.languages.length} languages → ${path.relative(projectRoot, outFile)}`,
  )
}
