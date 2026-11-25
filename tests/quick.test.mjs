// The search bar's tools (src/lib/quick) and the calculator's conversions (src/lib/dashMath.js).
// Run: pnpm test  (node --test, part of pnpm checks)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { CODECS, sniff } from '../src/lib/quick/codecs.js'
import { HASHES, crc32, md5 } from '../src/lib/quick/hash.js'
import { CASES, generatePassword, slugify } from '../src/lib/quick/text.js'
import { fromRoman, readInteger, toFraction, toRoman } from '../src/lib/quick/numbers.js'
import { decodePlusCode, encodePlusCode, parseLatLon, simplifyRatio, toDms } from '../src/lib/quick/shapes.js'
import { ageOf, difference, readMoment, workdays } from '../src/lib/quick/dates.js'
import { parseMoney, readAmount } from '../src/lib/quick/currency.js'
import { quickAnswers, setToolWords } from '../src/lib/quick/index.js'
import { analyzeAll, setMathLanguage } from '../src/lib/dashMath.js'

const locale = (name) => JSON.parse(readFileSync(new URL(`../src/locales/en/${name}.json`, import.meta.url), 'utf8'))
setToolWords(locale('tools'))
setMathLanguage(locale('calc'))
const NOW = new Date(2026, 10, 24, 12, 0, 0)
const ask = (query, extra = {}) => quickAnswers(query, { locale: 'en', now: NOW, debug: true, ...extra })
const first = (query, extra) => ask(query, extra)[0]
const calc = (query) => analyzeAll(query, {})?.rows?.[0]?.text ?? null

test('every codec reads back what it wrote', () => {
  const samples = ['Hello, World!', 'Grüße aus München 🎉', 'a', '  spaced  out  ', '0123456789']
  for (const [id, codec] of Object.entries(CODECS)) {
    if (!codec.encode || !codec.decode || id === 'punycode') continue
    for (const sample of samples) {
      // Morse, NATO and Braille don't keep every character or the letter case.
      if (['morse', 'nato'].includes(id)) {
        assert.equal(codec.decode(codec.encode('SOS 123')), 'SOS 123', id)
        continue
      }
      if (id === 'braille' && /[^\x20-\x7e]/.test(sample)) continue
      assert.equal(codec.decode(codec.encode(sample)), sample, `${id}: ${sample}`)
    }
  }
})

test('codecs match the reference encodings', () => {
  assert.equal(CODECS.base64.encode('Hello'), 'SGVsbG8=')
  assert.equal(CODECS.base32.encode('foobar'), 'MZXW6YTBOI======')
  assert.equal(CODECS.base58.encode('Hello World!'), '2NEpo7TZRRrLZSi2U')
  assert.equal(CODECS.ascii85.encode('Man '), '<~9jqo^~>')
  assert.equal(CODECS.morse.encode('sos'), '... --- ...')
  assert.equal(CODECS.nato.encode('ab'), 'Alfa Bravo')
  assert.equal(CODECS.rot13.encode('Hello'), 'Uryyb')
  assert.equal(CODECS.punycode.decode('xn--mnchen-3ya.de'), 'münchen.de')
  assert.equal(CODECS.url.decode('a%20b+c'), 'a b c')
  assert.equal(CODECS.html.decode('&lt;b&gt; &amp; &#233; &euro;'), '<b> & é €')
  assert.match(CODECS.jwt.decode('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.x'), /"sub": "1"/)
  assert.equal(sniff('01101000 01101001')[0].text, 'hi')
  assert.deepEqual(sniff('just some words'), [])
})

test('hashes', async () => {
  assert.equal(md5(''), 'd41d8cd98f00b204e9800998ecf8427e')
  assert.equal(md5('hello'), '5d41402abc4b2a76b9719d911017c592')
  assert.equal(md5('The quick brown fox jumps over the lazy dog'), '9e107d9d372bb6826bd81d3542a419d6')
  assert.equal(crc32('hello'), '3610a686')
  assert.equal(await HASHES.sha256.run('hello'), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  assert.equal(await HASHES.sha1.run('hello'), 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
})

test('text tools', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world')
  assert.equal(slugify('Grüße aus Köln – 2026'), 'grusse-aus-koln-2026')
  assert.equal(CASES.camel('hello big world'), 'helloBigWorld')
  assert.equal(CASES.snake('helloBigWorld'), 'hello_big_world')
  assert.equal(CASES.kebab('XMLHttpRequest'), 'xml-http-request')
  const password = generatePassword({ length: 24, symbols: false })
  assert.equal(password.text.length, 24)
  assert.match(password.text, /^[A-Za-z0-9]+$/)
  assert.match(password.text, /\d/)
  assert.match(generatePassword({ mode: 'pin', pin: 8 }).text, /^\d{8}$/)
  assert.equal(generatePassword({ mode: 'passphrase', words: 4, separator: ' ', addNumber: false }).text.split(' ').length, 4)
})

test('numbers', () => {
  assert.equal(readInteger('0xff'), 255n)
  assert.equal(readInteger('1010', 2), 10n)
  assert.equal(readInteger('12', 2), null)
  assert.equal(toRoman(2024), 'MMXXIV')
  assert.equal(fromRoman('MCMXCIV'), 1994)
  assert.deepEqual(toFraction(0.75), { n: 3, d: 4, exact: true })
  assert.equal(toFraction(0.333333).d, 3)
})

test('places and shapes', () => {
  assert.deepEqual(simplifyRatio(1920, 1080), { w: 16, h: 9, decimal: 1920 / 1080, near: '16:9' })
  const point = parseLatLon('48°8\'14.6"N 11°34\'31.8"E')
  assert.ok(Math.abs(point.lat - 48.13739) < 1e-4 && Math.abs(point.lon - 11.5755) < 1e-4)
  assert.equal(toDms(48.1374, 11.5755), '48°8′14.6″N 11°34′31.8″E')
  // Google's own example (Mountain View): decodes there, and its centre encodes back to it.
  const decoded = decodePlusCode('849VCWC8+R9')
  assert.ok(Math.abs(decoded.lat - 37.42) < 1e-2 && Math.abs(decoded.lon + 122.08) < 1e-2)
  assert.equal(encodePlusCode(decoded.lat, decoded.lon), '849VCWC8+R9')
  assert.equal(encodePlusCode(48.1374, 11.5755).slice(0, 4), '8FWH')
})

test('dates', () => {
  assert.equal(readMoment('1 May 2000').date.getTime(), new Date(2000, 4, 1).getTime())
  assert.equal(readMoment('May 1st, 2000').date.getTime(), new Date(2000, 4, 1).getTime())
  assert.equal(readMoment('1. Mai 2000', { locale: 'de' }).date.getTime(), new Date(2000, 4, 1).getTime())
  assert.equal(readMoment('2000').precision, 'year')
  assert.equal(readMoment('easter', { now: NOW }).date.getTime(), new Date(2027, 2, 28).getTime())
  assert.equal(ageOf(new Date(2000, 4, 1), NOW).years, 26)
  assert.deepEqual(
    (({ years, months, days }) => ({ years, months, days }))(difference(new Date(2024, 0, 31), new Date(2024, 2, 1))),
    { years: 0, months: 1, days: 1 },
  )
  assert.equal(workdays(new Date(2026, 10, 23), new Date(2026, 10, 30)), 5)
})

test('money is read the way people write it', () => {
  assert.equal(readAmount('10.000,50'), 10000.5)
  assert.equal(readAmount('1,234.5'), 1234.5)
  assert.equal(readAmount('10,50'), 10.5)
  assert.equal(readAmount('1,234'), 1234)
  assert.equal(readAmount('2.5k'), 2500)
  assert.deepEqual(parseMoney('10€ to $', { locale: 'en-US' }), { amount: 10, from: 'EUR', to: ['USD'], explicit: true })
  assert.deepEqual(parseMoney('100 dollars in euro', { locale: 'en-US' }), { amount: 100, from: 'USD', to: ['EUR'], explicit: true })
  assert.deepEqual(parseMoney('100 eur to usd, gbp and jpy', { locale: 'de-DE' }).to, ['USD', 'GBP', 'JPY'])
  assert.equal(parseMoney('5 ft to cm', { locale: 'en' }), null)
  assert.equal(parseMoney('hello to base64', { locale: 'en' }), null)
})

test('queries find the right tool', () => {
  const cases = {
    help: 'help', '?': 'help', passgen: 'password', 'password generator': 'password', 'qr hello': 'qr', clock: 'clock', 'what time is it?': 'clock',
    weather: 'weather', 'weather in Munich': 'weather', 'Paris weather': 'weather', 'my ip': 'ip', '8.8.8.8': 'ip', 'where am i': 'location', 'color picker': 'color',
    '10€ to $': 'currency', 'hello to base64': 'encode', 'base64 hello': 'encode', 'decode SGVsbG8=': 'decode', '... --- ...': 'decode',
    'md5 hello': 'hash', 'slugify Hello, World!': 'text', 'roll 2d6': 'random', uuid: 'random', '255 to hex': 'numbers', '0.75 to fraction': 'fraction',
    '1920x1080 ratio': 'ratio', 'a4 in inches': 'paper', '48.1374, 11.5755': 'coords', '8FWH4HPG+XX': 'coords', 'age 2000-05-01': 'age', '1990 age': 'age',
    'from 2020-01-01 to today': 'elapsed', 'since March 2021': 'elapsed', '12:30 to 13:00': 'elapsed', 'https://example.com': 'link',
  }
  for (const [query, tool] of Object.entries(cases)) assert.equal(first(query)?.tool, tool, query)
  // Things that are not tools stay plain searches (or the calculator's).
  for (const query of ['rising sun', 'best pizza near me', '5 ft to cm', 'I', 'mix', 'die hard', 'a4 paper review site']) {
    assert.ok(!ask(query).some((answer) => ['encode', 'decode', 'age', 'elapsed', 'currency', 'random'].includes(answer.tool)), query)
  }
  assert.equal(ask('weather', { disabled: new Set(['weather']) }).length, 0)
  assert.equal(ask('https://example.com', { links: false }).length, 0)
})

test('calculator conversions', () => {
  assert.equal(calc('20°C to °F'), '20 °C = 68 °F')
  assert.equal(calc('5 ft to cm'), '5 ft = 152.4 cm')
  assert.equal(calc('3 lb to kg'), '3 lb = 1.36077711 kg')
  assert.equal(calc('50 N·m to lb·ft'), '50 N·m = 36.8781074639 lb·ft')
  assert.equal(calc('1000 kg/m³ to g/cm³'), '1,000 kg/m³ = 1 g/cm³')
  assert.equal(calc('16px to rem'), '16 px = 1 rem')
  assert.equal(calc('12pt to px'), '12 pt = 16 px')
  assert.equal(calc('2 pints to ml'), '2 pt = 946.352946 mL')
  // ":" is a time, never a division (no explosion on 07:00).
  assert.equal(analyzeAll('07:00', {})?.illegal ?? false, false)
  assert.equal(analyzeAll('6:0', {})?.illegal ?? false, false)
  assert.equal(analyzeAll('6/0', {})?.illegal, true)
})

test('countdown targets in words', async () => {
  const { readWhen } = await import('../src/lib/quick/dates.js')
  const at = (text, locale = 'en') => readWhen(text, { locale, now: NOW })?.date.getTime()
  assert.equal(at('friday 5pm'), new Date(2026, 10, 27, 17, 0).getTime())
  assert.equal(at('next tuesday'), new Date(2026, 11, 1).getTime()) // NOW is a Tuesday noon: the next one
  assert.equal(at('tuesday 18:00'), new Date(2026, 10, 24, 18, 0).getTime()) // still ahead today
  assert.equal(at('24.12. 18:00'), new Date(2026, 11, 24, 18, 0).getTime())
  assert.equal(at('christmas at 6pm'), new Date(2026, 11, 25, 18, 0).getTime())
  assert.equal(at('Freitag 17 Uhr', 'de'), new Date(2026, 10, 27, 17, 0).getTime())
  assert.equal(at('in 3 weeks'), new Date(2026, 11, 15).getTime())
  assert.equal(readWhen('banana', { now: NOW }), null)
})
