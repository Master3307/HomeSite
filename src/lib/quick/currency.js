/*
 * Currency conversion for the search bar: "10€ to $", "€10 in USD",
 * "100 dollars to euro", "50 bucks in yen", "usd to eur", "1 btc in eur",
 * "100 eur to usd, gbp and jpy", "10.000,50 € in CHF".
 *
 * Rates: Coinbase's public exchange rates (live, fiat and crypto, no key),
 * falling back to the ECB reference rates (frankfurter.dev, once a working
 * day). Only the currency codes are sent, never the amount.
 */

/* Symbols -> codes; ambiguous ones list their candidates, the locale picks. */
const SYMBOLS = {
  '€': ['EUR'], '$': ['USD', 'CAD', 'AUD', 'NZD', 'MXN', 'SGD', 'HKD'], 'us$': ['USD'], 'ca$': ['CAD'], 'c$': ['CAD'], 'a$': ['AUD'], 'au$': ['AUD'], 'nz$': ['NZD'], 'hk$': ['HKD'], 's$': ['SGD'], 'mx$': ['MXN'], 'r$': ['BRL'],
  '£': ['GBP'], '¥': ['JPY', 'CNY'], '￥': ['JPY', 'CNY'], '円': ['JPY'], '元': ['CNY'], 'cn¥': ['CNY'], 'rmb': ['CNY'], '₹': ['INR'], '₽': ['RUB'], '₩': ['KRW'], '₺': ['TRY'], '₪': ['ILS'], '₫': ['VND'], '₱': ['PHP'], '฿': ['THB'], '₴': ['UAH'], '₦': ['NGN'], '₨': ['PKR', 'INR', 'LKR', 'NPR'], '₸': ['KZT'], '₾': ['GEL'], '₼': ['AZN'], '₡': ['CRC'], '₲': ['PYG'], '₵': ['GHS'],
  'zł': ['PLN'], 'kč': ['CZK'], 'ft': ['HUF'], 'kr': ['SEK', 'NOK', 'DKK', 'ISK'], 'lei': ['RON'], 'лв': ['BGN'], 'chf': ['CHF'], 'fr.': ['CHF'], 'sfr': ['CHF'], 'rp': ['IDR'], 'rm': ['MYR'], 'r': ['ZAR'], 'ksh': ['KES'], '₿': ['BTC'], 'Ξ': ['ETH'],
}
/* English names and slang (Intl.DisplayNames adds every language's own names). */
const NAMES = {
  EUR: 'euro, euros, eur', USD: 'dollar, dollars, us dollar, us dollars, usd, buck, bucks', GBP: 'pound, pounds, pound sterling, sterling, quid, gbp, british pound', JPY: 'yen, japanese yen', CNY: 'yuan, renminbi, chinese yuan', INR: 'rupee, rupees, indian rupee', RUB: 'ruble, rubles, rouble, roubles', KRW: 'won, korean won', CHF: 'franc, francs, swiss franc, swiss francs', CAD: 'canadian dollar, canadian dollars', AUD: 'australian dollar, australian dollars', NZD: 'new zealand dollar, kiwi dollar', MXN: 'peso, pesos, mexican peso', BRL: 'real, reais, brazilian real', SEK: 'swedish krona, swedish kronor', NOK: 'norwegian krone, norwegian kroner', DKK: 'danish krone, danish kroner', PLN: 'zloty, zlotys, złoty', CZK: 'koruna, czech koruna, czech crowns', HUF: 'forint, forints', TRY: 'lira, turkish lira', ILS: 'shekel, shekels', THB: 'baht', UAH: 'hryvnia', ZAR: 'rand', SGD: 'singapore dollar', HKD: 'hong kong dollar', BTC: 'bitcoin, bitcoins, btc, sats?', ETH: 'ether, ethereum, eth', SOL: 'solana', DOGE: 'dogecoin, doge', XRP: 'ripple, xrp', LTC: 'litecoin', ADA: 'cardano', USDT: 'tether', USDC: 'usd coin', XAU: 'gold, ounce of gold, oz gold', XAG: 'silver, ounce of silver',
}
const CRYPTO = new Set(['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'LTC', 'ADA', 'USDT', 'USDC', 'DOT', 'AVAX', 'LINK', 'MATIC', 'SHIB', 'BNB', 'TRX', 'XLM', 'ATOM', 'UNI', 'BCH'])
/* Region -> currency (for "$" and for the default target). */
const REGION = { US: 'USD', CA: 'CAD', AU: 'AUD', NZ: 'NZD', MX: 'MXN', SG: 'SGD', HK: 'HKD', GB: 'GBP', JP: 'JPY', CN: 'CNY', IN: 'INR', RU: 'RUB', KR: 'KRW', TR: 'TRY', IL: 'ILS', CH: 'CHF', LI: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', IS: 'ISK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN', BR: 'BRL', ZA: 'ZAR', UA: 'UAH', TH: 'THB', ID: 'IDR', MY: 'MYR', PH: 'PHP', VN: 'VND', HR: 'EUR', DE: 'EUR', AT: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR', BE: 'EUR', IE: 'EUR', PT: 'EUR', FI: 'EUR', GR: 'EUR', LU: 'EUR', LV: 'EUR', LT: 'EUR', EE: 'EUR', SK: 'EUR', SI: 'EUR', MT: 'EUR', CY: 'EUR' }
const LANG_REGION = { de: 'DE', fr: 'FR', it: 'IT', es: 'ES', hr: 'HR', lv: 'LV', uk: 'UA', bar: 'DE', swg: 'DE', ja: 'JP', zh: 'CN', ko: 'KR', sv: 'SE', nb: 'NO', no: 'NO', da: 'DK', pl: 'PL', cs: 'CZ', hu: 'HU', ru: 'RU', tr: 'TR', pt: 'PT', nl: 'NL', en: 'US' }

export function regionOf(locale) {
  const tag = String(locale ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-US'))
  try {
    const region = new Intl.Locale(tag).maximize().region
    if (region) return region
  } catch {
    // fall through
  }
  return LANG_REGION[tag.split('-')[0]] ?? 'US'
}
export const localCurrency = (locale) => REGION[regionOf(locale)] ?? 'USD'

const nameCache = new Map()
function nameIndex(locale) {
  const key = locale ?? 'en'
  if (nameCache.has(key)) return nameCache.get(key)
  const map = new Map()
  const add = (name, code) => {
    const clean = name.toLocaleLowerCase().trim()
    if (clean && !map.has(clean)) map.set(clean, code)
  }
  for (const [code, names] of Object.entries(NAMES)) for (const name of names.split(',')) add(name.replace(/\?$/, ''), code)
  let codes = []
  try {
    codes = Intl.supportedValuesOf('currency')
  } catch {
    codes = Object.keys(NAMES)
  }
  for (const lang of [...new Set(['en', locale].filter(Boolean))]) {
    try {
      const names = new Intl.DisplayNames([lang], { type: 'currency' })
      for (const code of codes) {
        const name = names.of(code)
        if (name && name !== code) {
          add(name, code)
          // "US-Dollar", "Euro" plural forms: a final s / n.
          add(`${name}s`, code)
        }
      }
    } catch {
      // no DisplayNames
    }
  }
  for (const code of [...codes, ...CRYPTO]) add(code, code)
  nameCache.set(key, map)
  return map
}

/** A currency as written ("€", "eur", "euros", "US-Dollar", "btc"): its code, or null. */
export function currencyOf(raw, locale) {
  const clean = String(raw ?? '').trim().toLocaleLowerCase().replace(/\s+/g, ' ')
  if (!clean) return null
  const symbol = SYMBOLS[clean] ?? SYMBOLS[raw?.trim()]
  if (symbol) {
    const local = localCurrency(locale)
    return symbol.includes(local) ? local : symbol[0]
  }
  const index = nameIndex(locale)
  if (index.has(clean)) return index.get(clean)
  if (clean.endsWith('s') && index.has(clean.slice(0, -1))) return index.get(clean.slice(0, -1))
  return null
}

/* "10.000,50", "1,234.5", "1 234", "10k", "2.5m": a number, or null. */
export function readAmount(text) {
  let clean = String(text ?? '').trim().replace(/[\s  ']/g, '')
  const scale = /^(.*\d)\s*([kmb]|mio|mrd|bn)$/i.exec(clean)
  let factor = 1
  if (scale) {
    clean = scale[1]
    factor = { k: 1e3, m: 1e6, b: 1e9, mio: 1e6, mrd: 1e9, bn: 1e9 }[scale[2].toLowerCase()]
  }
  if (!/^-?[\d.,]+$/.test(clean) || !/\d/.test(clean)) return null
  const lastComma = clean.lastIndexOf(',')
  const lastDot = clean.lastIndexOf('.')
  if (lastComma > -1 && lastDot > -1) clean = lastComma > lastDot ? clean.replace(/\./g, '').replace(',', '.') : clean.replace(/,/g, '')
  else if (lastComma > -1) {
    // "1,234" and "1,234,567" are thousands; "10,50" and "0,5" are decimals.
    const groups = clean.replace(/^-/, '').split(',')
    const thousands = groups.length > 2 ? groups.slice(1).every((group) => group.length === 3) : groups[1].length === 3 && groups[0].length <= 3 && groups[0] !== '0'
    clean = thousands ? clean.replace(/,/g, '') : clean.replace(',', '.')
  }
  else if ((clean.match(/\./g) ?? []).length > 1) clean = clean.replace(/\./g, '')
  const value = Number(clean) * factor
  return Number.isFinite(value) ? value : null
}

const SYMBOL_RE = Object.keys(SYMBOLS)
  .sort((a, b) => b.length - a.length)
  .map((symbol) => symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|')

/* One side: "10€", "€ 10", "10 EUR", "10 euros", "eur", "$". */
function readSide(text, locale, { needAmount = false } = {}) {
  const clean = String(text ?? '').trim()
  if (!clean) return null
  const before = new RegExp(`^(${SYMBOL_RE}|[a-z]{3})\\s*(-?[\\d.,'\\s]*\\d(?:\\s*(?:k|m|mio|mrd|bn))?)$`, 'i').exec(clean)
  if (before) {
    const code = currencyOf(before[1], locale)
    const amount = readAmount(before[2])
    if (code && amount !== null) return { amount, code }
  }
  const after = /^(-?[\d.,'\s]*\d(?:\s*(?:k|m|mio|mrd|bn)\b)?)\s*(.+)$/i.exec(clean)
  if (after) {
    const amount = readAmount(after[1])
    const code = currencyOf(after[2], locale)
    if (code && amount !== null) return { amount, code }
  }
  if (needAmount) return null
  const code = currencyOf(clean, locale)
  return code ? { amount: null, code } : null
}

/**
 * The conversion asked for, or null: { amount, from, to: [codes], explicit }.
 * `words.convert`: "to", "in", … (language pack), `words.and`: "and", "&".
 */
export function parseMoney(raw, { locale = 'en', words = {} } = {}) {
  const text = String(raw ?? '')
    .trim()
    .replace(/^(?:convert|exchange|how much is|what is|what's|whats)\s+/i, '')
    .replace(/[?!.]+$/, '')
    .trim()
  if (!text || text.length > 80) return null
  const joiners = ['to', 'in', 'into', 'as', 'for', '->', '→', '=', '=>', ...(words.convert ?? [])].map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const split = new RegExp(`\\s+(?:${joiners.join('|')})\\s+|\\s*(?:->|→|=>|=)\\s*`, 'i')
  const parts = text.split(split)
  if (parts.length > 2) return null
  const from = readSide(parts[0], locale)
  if (!from) return null
  if (parts.length === 1) {
    // "10€", "100 usd": into the local currency (and USD/EUR); a bare code alone is too vague.
    if (from.amount === null) return null
    return { amount: from.amount, from: from.code, to: [], explicit: false }
  }
  const and = ['and', '&', ',', '+', ...(words.and ?? [])].map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const targets = parts[1]
    .split(new RegExp(`\\s*(?:${and.join('|')})\\s*`, 'i'))
    .filter(Boolean)
    .map((side) => readSide(side, locale)?.code ?? null)
  if (!targets.length || targets.some((code) => !code)) return null
  return { amount: from.amount ?? 1, from: from.code, to: [...new Set(targets)], explicit: true }
}

/* ---------- rates ---------- */
const rateCache = new Map() // base -> { at, value }
const RATE_MS = 60_000

/** { rates: { CODE: per one base }, source, at: Date, live } for a base currency. */
export async function fetchRates(base, { signal } = {}) {
  const hit = rateCache.get(base)
  if (hit && Date.now() - hit.at < RATE_MS) return hit.value
  let value = null
  try {
    const response = await fetch(`https://api.coinbase.com/v2/exchange-rates?currency=${encodeURIComponent(base)}`, { signal })
    if (!response.ok) throw new Error(String(response.status))
    const data = await response.json()
    const rates = Object.fromEntries(Object.entries(data?.data?.rates ?? {}).map(([code, rate]) => [code, Number(rate)]).filter(([, rate]) => Number.isFinite(rate) && rate > 0))
    if (!Object.keys(rates).length) throw new Error('empty')
    value = { rates, source: 'Coinbase', sourceUrl: 'https://www.coinbase.com/converter', at: new Date(), live: true }
  } catch (error) {
    if (error.name === 'AbortError') throw error
    const response = await fetch(`https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(base)}`, { signal })
    if (!response.ok) throw new Error(`Rates ${response.status}`)
    const data = await response.json()
    value = { rates: { ...data.rates, [base]: 1 }, source: 'ECB (frankfurter.dev)', sourceUrl: 'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html', at: new Date(`${data.date}T16:00:00+01:00`), live: false }
  }
  rateCache.set(base, { at: Date.now(), value })
  return value
}

export const isCrypto = (code) => CRYPTO.has(code)

/** "€1,234.50" in the visitor's format; crypto with more digits. */
export function money(value, code, locale) {
  const digits = isCrypto(code) || Math.abs(value) < 1 ? 6 : 2
  try {
    if (isCrypto(code)) throw new Error('no ISO code')
    return new Intl.NumberFormat(locale, { style: 'currency', currency: code, maximumFractionDigits: digits, minimumFractionDigits: Math.min(2, digits) }).format(value)
  } catch {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${code}`
  }
}
export function currencyName(code, locale) {
  try {
    return new Intl.DisplayNames([locale], { type: 'currency' }).of(code) ?? code
  } catch {
    return code
  }
}
