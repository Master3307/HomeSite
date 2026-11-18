#!/usr/bin/env node
/*
 * Builds src/data/elements.json (the periodic table on /dash) and the English
 * element names in src/locales/en/elements.json from PubChem's periodic table
 * (public domain: https://pubchem.ncbi.nlm.nih.gov/periodic-table/).
 *
 *   pnpm elements            fetch from PubChem
 *   pnpm elements -- file    read a saved copy of the same JSON
 *
 * Kept as PubChem gives it (strings, so no precision is invented). Added
 * here: period, group (La and Ac in group 3, the 4f / 5f rows below, as in
 * German school tables), block, the electrons per shell (from the electron
 * configuration) and an approximate mass number.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = process.argv[2]
const data = source ? JSON.parse(readFileSync(source, 'utf8')) : await (await fetch('https://pubchem.ncbi.nlm.nih.gov/rest/pug/periodictable/JSON')).json()
const columns = data.Table.Columns.Column
const rows = data.Table.Row.map((row) => Object.fromEntries(columns.map((name, index) => [name, row.Cell[index] ?? ''])))

const CATEGORY = {
  Nonmetal: 'nonmetal',
  'Noble gas': 'noble',
  'Alkali metal': 'alkali',
  'Alkaline earth metal': 'alkaline',
  Metalloid: 'metalloid',
  Halogen: 'halogen',
  'Post-transition metal': 'post',
  'Transition metal': 'transition',
  Lanthanide: 'lanthanide',
  Actinide: 'actinide',
}
const STATE = { Solid: 'solid', Liquid: 'liquid', Gas: 'gas', 'Expected to be a Solid': 'solid?', 'Expected to be a Gas': 'gas?', 'Expected to be a Liquid': 'liquid?' }

function position(z) {
  const periods = [2, 10, 18, 36, 54, 86, 118]
  const period = periods.findIndex((last) => z <= last) + 1
  const first = [1, 3, 11, 19, 37, 55, 87][period - 1]
  const offset = z - first
  if (period === 1) return { period, group: z === 1 ? 1 : 18 }
  if (period <= 3) return { period, group: offset < 2 ? offset + 1 : offset + 11 }
  if (period <= 5) return { period, group: offset + 1 }
  // 6 and 7: s block, La / Ac in group 3, the f rows (Ce–Lu, Th–Lr) without a group, then 4 … 18.
  if (offset < 2) return { period, group: offset + 1 }
  if (offset === 2) return { period, group: 3 }
  if (offset <= 16) return { period, group: null, f: offset - 2 }
  return { period, group: offset - 13 }
}

const configs = Object.fromEntries(rows.map((row) => [row.Symbol, row.ElectronConfiguration]))
function expand(config, depth = 0) {
  const clean = String(config).replace(/\(.*?\)/g, '').trim()
  const core = /^\[([A-Z][a-z]?)\]/.exec(clean)
  const rest = clean.replace(/^\[[A-Z][a-z]?\]/, '').trim().split(/\s+/).filter(Boolean)
  return [...(core && depth < 8 ? expand(configs[core[1]], depth + 1) : []), ...rest]
}
function shells(config) {
  const counts = []
  for (const orbital of expand(config)) {
    const match = /^(\d)([spdfg])(\d+)$/.exec(orbital)
    if (!match) continue
    const n = Number(match[1])
    counts[n - 1] = (counts[n - 1] ?? 0) + Number(match[3])
  }
  return Array.from(counts, (count) => count ?? 0)
}

const elements = rows.map((row) => {
  const z = Number(row.AtomicNumber)
  const place = position(z)
  const block = place.f ? 'f' : z === 2 || place.group <= 2 ? 's' : place.group >= 13 ? 'p' : 'd'
  const mass = Number(row.AtomicWeight)
  const shellCounts = shells(row.ElectronConfiguration)
  if (shellCounts.reduce((a, b) => a + b, 0) !== z) console.warn(`shells of ${row.Symbol} add up to ${shellCounts.reduce((a, b) => a + b, 0)}, not ${z}`)
  return {
    z,
    symbol: row.Symbol,
    mass: row.AtomicWeight,
    // Rounded atomic mass: the mass number of an isotope near it (not necessarily the most common one).
    a: Math.round(mass),
    color: row.CPKHexColor || null,
    config: row.ElectronConfiguration,
    shells: shellCounts,
    en: row.Electronegativity || null,
    radius: row.AtomicRadius || null,
    ie: row.IonizationEnergy || null,
    ea: row.ElectronAffinity || null,
    ox: row.OxidationStates || null,
    state: STATE[row.StandardState] ?? null,
    mp: row.MeltingPoint || null,
    bp: row.BoilingPoint || null,
    density: row.Density || null,
    category: CATEGORY[row.GroupBlock] ?? null,
    year: row.YearDiscovered || null,
    period: place.period,
    group: place.group,
    f: place.f ?? null,
    block,
  }
})
writeFileSync(join(root, 'src/data/elements.json'), `${JSON.stringify({ source: 'PubChem (public domain), https://pubchem.ncbi.nlm.nih.gov/periodic-table/', units: { mass: 'u', radius: 'pm (van der Waals)', ie: 'eV', ea: 'eV', mp: 'K', bp: 'K', density: 'g/cm³' }, elements })}\n`)

const localeFile = join(root, 'src/locales/en/elements.json')
let locale = {}
try {
  locale = JSON.parse(readFileSync(localeFile, 'utf8'))
} catch {
  locale = {}
}
locale.names = Object.fromEntries(rows.map((row) => [row.Symbol, row.Name]))
writeFileSync(localeFile, `${JSON.stringify(locale, null, 4)}\n`)
console.log(`${elements.length} elements written`)
