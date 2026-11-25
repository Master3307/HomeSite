/*
 * vCard (.vcf) for the dash's contacts: reading 2.1 / 3.0 / 4.0 (Google,
 * Apple, Outlook, Android, Nextcloud exports: folded lines, grouped
 * properties "item1.TEL", TYPE parameters, quoted-printable, embedded
 * photos) and writing 3.0 (what every address book imports). No
 * dependencies; used by the browser and tested in tests/vcard.test.mjs.
 *
 *   parseVcards(text)      [{ name, given, family, nickname, org, title, phones, emails, addresses, urls, birthday, note, photo }]
 *   writeVcards(contacts)  the .vcf text
 *
 * phones / emails / addresses / urls are [{ type, value }]; birthday is
 * "YYYY-MM-DD" or "--MM-DD" (no year); photo is a data: URL or an http(s) link.
 */

const unfold = (text) => String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '')
const unescape = (value) => value.replace(/\\n/gi, '\n').replace(/\\([,;:\\])/g, '$1')
const escape = (value) =>
  String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/([,;])/g, '\\$1')
/* Splits on separators that aren't escaped. */
const splitOn = (value, separator) => {
  const parts = []
  let current = ''
  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    if (char === '\\' && index + 1 < value.length) {
      current += char + value[index + 1]
      index += 1
    } else if (char === separator) {
      parts.push(current)
      current = ''
    } else current += char
  }
  parts.push(current)
  return parts
}

function decodeQuotedPrintable(value, charset = 'utf-8') {
  const bytes = []
  const text = value.replace(/=\n/g, '')
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '=' && /^[0-9A-F]{2}$/i.test(text.slice(index + 1, index + 3))) {
      bytes.push(parseInt(text.slice(index + 1, index + 3), 16))
      index += 2
    } else bytes.push(text.charCodeAt(index) & 0xff)
  }
  try {
    return new TextDecoder(/utf-?8/i.test(charset) ? 'utf-8' : charset).decode(new Uint8Array(bytes))
  } catch {
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes))
  }
}

/* "item1.TEL;TYPE=CELL,VOICE;PREF=1:+49 …" -> { name: 'TEL', params: { TYPE: ['cell', 'voice'] }, value } */
function parseLine(line) {
  let inQuote = false
  let colon = -1
  for (let index = 0; index < line.length; index++) {
    if (line[index] === '"') inQuote = !inQuote
    else if (line[index] === ':' && !inQuote) {
      colon = index
      break
    }
  }
  if (colon === -1) return null
  const head = line.slice(0, colon).split(';')
  const name = head[0].replace(/^[^.]+\./, '').toUpperCase()
  const params = {}
  for (const part of head.slice(1)) {
    const [key, ...rest] = part.split('=')
    // vCard 2.1 writes bare types: "TEL;CELL;HOME:…"
    const paramName = rest.length ? key.toUpperCase() : 'TYPE'
    const values = (rest.length ? rest.join('=') : key).replace(/^"|"$/g, '').split(',')
    params[paramName] = [...(params[paramName] ?? []), ...values.map((value) => value.toLowerCase())]
  }
  let value = line.slice(colon + 1)
  if (params.ENCODING?.includes('quoted-printable')) value = decodeQuotedPrintable(value, params.CHARSET?.[0])
  return { name, params, value }
}

const TYPE_WORDS = ['cell', 'mobile', 'home', 'work', 'fax', 'pager', 'main', 'other', 'iphone']
const typeOf = (params) => {
  const types = (params.TYPE ?? []).filter((type) => TYPE_WORDS.includes(type))
  const type = types.find((entry) => entry !== 'voice' && entry !== 'internet') ?? ''
  return type === 'mobile' || type === 'iphone' ? 'cell' : type
}

/* BDAY: 19980314, 1998-03-14, --0314, --03-14, 1998-03-14T00:00:00Z */
function readBirthday(value) {
  const text = value.trim()
  let match = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(text)
  if (match && match[1] !== '1604') return `${match[1]}-${match[2]}-${match[3]}`
  // Apple writes a missing year as 1604.
  if (match) return `--${match[2]}-${match[3]}`
  match = /^--(\d{2})-?(\d{2})$/.exec(text)
  return match ? `--${match[1]}-${match[2]}` : ''
}

const MAX_PHOTO = 200_000 // characters of a data: URL kept (bigger photos are made smaller by the browser before saving)

/** Reads every card in a .vcf text. */
export function parseVcards(text, { limit = 5000 } = {}) {
  const cards = []
  let card = null
  for (const raw of unfold(text).split('\n')) {
    // vCard 2.1 quoted-printable soft breaks fold with "=" at the line end.
    const line = raw.trimEnd()
    if (!line) continue
    if (/^BEGIN:VCARD$/i.test(line)) {
      card = { name: '', given: '', family: '', nickname: '', org: '', title: '', phones: [], emails: [], addresses: [], urls: [], birthday: '', note: '', photo: '' }
      continue
    }
    if (/^END:VCARD$/i.test(line)) {
      if (card) {
        if (!card.name) card.name = [card.given, card.family].filter(Boolean).join(' ') || card.org || card.emails[0]?.value || card.phones[0]?.value || ''
        if (card.name && cards.length < limit) cards.push(card)
      }
      card = null
      continue
    }
    if (!card) continue
    const entry = parseLine(line)
    if (!entry) continue
    const value = entry.value
    switch (entry.name) {
      case 'FN':
        card.name = unescape(value).trim().slice(0, 200)
        break
      case 'N': {
        const [family = '', given = ''] = splitOn(value, ';').map((part) => unescape(part).trim())
        card.family = family.slice(0, 100)
        card.given = given.slice(0, 100)
        break
      }
      case 'NICKNAME':
        card.nickname = unescape(value).trim().slice(0, 100)
        break
      case 'ORG':
        card.org = splitOn(value, ';').map((part) => unescape(part).trim()).filter(Boolean).join(', ').slice(0, 200)
        break
      case 'TITLE':
        card.title = unescape(value).trim().slice(0, 200)
        break
      case 'TEL': {
        const number = unescape(value).replace(/^tel:/i, '').trim()
        if (number && card.phones.length < 20) card.phones.push({ type: typeOf(entry.params), value: number.slice(0, 60) })
        break
      }
      case 'EMAIL': {
        const address = unescape(value).replace(/^mailto:/i, '').trim()
        if (address && card.emails.length < 20) card.emails.push({ type: typeOf(entry.params), value: address.slice(0, 200) })
        break
      }
      case 'ADR': {
        // PO box; extended; street; city; region; postal code; country
        const [, extended = '', street = '', city = '', region = '', postal = '', country = ''] = splitOn(value, ';').map((part) => unescape(part).trim())
        const address = [street, extended, [postal, city].filter(Boolean).join(' '), region, country].filter(Boolean).join(', ')
        if (address && card.addresses.length < 10) card.addresses.push({ type: typeOf(entry.params), value: address.slice(0, 300) })
        break
      }
      case 'URL': {
        const url = unescape(value).trim()
        if (/^https?:\/\//i.test(url) && card.urls.length < 10) card.urls.push({ type: typeOf(entry.params), value: url.slice(0, 1000) })
        break
      }
      case 'BDAY':
        card.birthday = readBirthday(value)
        break
      case 'NOTE':
        card.note = unescape(value).slice(0, 4000)
        break
      case 'PHOTO': {
        const raw = value.trim()
        if (/^data:image\//i.test(raw)) card.photo = raw.length <= MAX_PHOTO ? raw : ''
        else if (/^https?:\/\//i.test(raw)) card.photo = raw.slice(0, 1000)
        else if (entry.params.ENCODING?.some((encoding) => encoding === 'b' || encoding === 'base64')) {
          const type = (entry.params.TYPE ?? []).find((entry) => ['jpeg', 'jpg', 'png', 'gif', 'webp'].includes(entry)) ?? 'jpeg'
          const photo = `data:image/${type === 'jpg' ? 'jpeg' : type};base64,${raw.replace(/\s+/g, '')}`
          card.photo = photo.length <= MAX_PHOTO ? photo : ''
        }
        break
      }
    }
  }
  return cards
}

/* Lines over 75 characters folded. */
const fold = (line) => {
  const out = []
  let rest = line
  while (rest.length > 75) {
    out.push(rest.slice(0, 75))
    rest = ` ${rest.slice(75)}`
  }
  out.push(rest)
  return out.join('\r\n')
}
const typeParam = (type) => (type ? `;TYPE=${type.toUpperCase()}` : '')

/** Contacts as .vcf text (vCard 3.0). */
export function writeVcards(contacts) {
  const lines = []
  for (const contact of contacts) {
    const given = contact.given ?? ''
    const family = contact.family ?? ''
    lines.push('BEGIN:VCARD', 'VERSION:3.0', `FN:${escape(contact.name)}`, `N:${escape(family)};${escape(given)};;;`)
    if (contact.nickname) lines.push(`NICKNAME:${escape(contact.nickname)}`)
    if (contact.org) lines.push(`ORG:${escape(contact.org)}`)
    if (contact.title) lines.push(`TITLE:${escape(contact.title)}`)
    for (const phone of contact.phones ?? []) lines.push(`TEL${typeParam(phone.type)}:${escape(phone.value)}`)
    for (const email of contact.emails ?? []) lines.push(`EMAIL;TYPE=INTERNET${email.type ? `,${email.type.toUpperCase()}` : ''}:${escape(email.value)}`)
    // Addresses are kept as one line: written into the street part.
    for (const address of contact.addresses ?? []) lines.push(`ADR${typeParam(address.type)}:;;${escape(address.value)};;;;`)
    for (const url of contact.urls ?? []) lines.push(`URL:${url.value}`)
    if (contact.birthday) lines.push(`BDAY:${contact.birthday.startsWith('--') ? contact.birthday.replace(/-/g, '').replace(/^/, '--') : contact.birthday}`)
    if (contact.note) lines.push(`NOTE:${escape(contact.note)}`)
    const photo = /^data:image\/(\w+);base64,(.+)$/.exec(contact.photo ?? '')
    if (photo) lines.push(`PHOTO;ENCODING=b;TYPE=${photo[1].toUpperCase()}:${photo[2]}`)
    else if (/^https?:\/\//.test(contact.photo ?? '')) lines.push(`PHOTO;VALUE=uri:${contact.photo}`)
    lines.push('END:VCARD')
  }
  return `${lines.map(fold).join('\r\n')}\r\n`
}
