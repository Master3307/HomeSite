// Own avatars: cut, made 256 px WebP, animations kept (server/services/discordOAuth.cjs makeAvatar).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const sharp = require('sharp')
const { makeAvatar } = require('../server/services/discordOAuth.cjs')

test('a still picture: cut to the square, metadata gone', async () => {
  // 400 × 200, left half red, right half blue, with EXIF.
  const left = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#ff0000' } }).png().toBuffer()
  const input = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#0000ff' } })
    .composite([{ input: left, left: 0, top: 0 }])
    .withMetadata({ exif: { IFD0: { Copyright: 'secret camera' } } })
    .jpeg()
    .toBuffer()
  const out = await makeAvatar(input, { x: 0, y: 0, size: 1 })
  const info = await sharp(out).metadata()
  assert.equal(info.format, 'webp')
  assert.equal(info.width, 256)
  assert.equal(info.height, 256)
  assert.equal(info.exif, undefined)
  const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
  assert.ok(data[0] > 200 && data[2] < 60, 'the left (red) square was taken')
})

test('an animation keeps moving', async () => {
  const input = readFileSync(new URL('../public/img/HomeSiteIconAnimated.webp', import.meta.url))
  const out = await makeAvatar(input, { x: 0.1, y: 0.1, size: 0.8 })
  const info = await sharp(out, { animated: true }).metadata()
  assert.equal(info.width, 256)
  assert.equal(info.pageHeight, 256)
  assert.ok(info.pages > 10)
})

test('not a picture', async () => {
  await assert.rejects(makeAvatar(Buffer.from('hello'), { x: 0, y: 0, size: 1 }), /isn't a picture/)
})
