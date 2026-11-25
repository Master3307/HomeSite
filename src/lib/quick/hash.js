/*
 * Hashes of a text, in the browser: SHA-1/256/384/512 through Web Crypto,
 * MD5 and CRC-32 written out here (Web Crypto has neither). UTF-8 input.
 */

const encoder = new TextEncoder()
const hex = (buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')

/* MD5 (RFC 1321). Broken for security, still everywhere as a checksum. */
export function md5(text) {
  const bytes = encoder.encode(text)
  const length = bytes.length
  const words = new Uint32Array((((length + 8) >>> 6) + 1) * 16)
  for (let index = 0; index < length; index++) words[index >> 2] |= bytes[index] << ((index % 4) * 8)
  words[length >> 2] |= 0x80 << ((length % 4) * 8)
  words[words.length - 2] = (length * 8) >>> 0
  words[words.length - 1] = Math.floor((length * 8) / 0x100000000)
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]
  const K = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0)
  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]
  for (let block = 0; block < words.length; block += 16) {
    let [a, b, c, d] = [a0, b0, c0, d0]
    for (let step = 0; step < 64; step++) {
      const round = step >> 4
      let f
      let g
      if (round === 0) {
        f = (b & c) | (~b & d)
        g = step
      } else if (round === 1) {
        f = (d & b) | (~d & c)
        g = (5 * step + 1) % 16
      } else if (round === 2) {
        f = b ^ c ^ d
        g = (3 * step + 5) % 16
      } else {
        f = c ^ (b | ~d)
        g = (7 * step) % 16
      }
      const shift = S[round * 4 + (step % 4)]
      const sum = (a + f + K[step] + words[block + g]) >>> 0
      a = d
      d = c
      c = b
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) >>> 0
    }
    a0 = (a0 + a) >>> 0
    b0 = (b0 + b) >>> 0
    c0 = (c0 + c) >>> 0
    d0 = (d0 + d) >>> 0
  }
  return [a0, b0, c0, d0].map((word) => [0, 8, 16, 24].map((shift) => ((word >>> shift) & 255).toString(16).padStart(2, '0')).join('')).join('')
}

let CRC_TABLE = null
export function crc32(text) {
  CRC_TABLE ??= Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  let crc = 0xffffffff
  for (const byte of encoder.encode(text)) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8)
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0')
}

export const HASHES = {
  md5: { label: 'MD5', run: async (text) => md5(text) },
  sha1: { label: 'SHA-1', run: async (text) => hex(await crypto.subtle.digest('SHA-1', encoder.encode(text))) },
  sha256: { label: 'SHA-256', run: async (text) => hex(await crypto.subtle.digest('SHA-256', encoder.encode(text))) },
  sha384: { label: 'SHA-384', run: async (text) => hex(await crypto.subtle.digest('SHA-384', encoder.encode(text))) },
  sha512: { label: 'SHA-512', run: async (text) => hex(await crypto.subtle.digest('SHA-512', encoder.encode(text))) },
  crc32: { label: 'CRC-32', run: async (text) => crc32(text) },
}
export const DEFAULT_HASHES = ['md5', 'sha1', 'sha256', 'sha512']

/* A pasted hash: which algorithm it could be, by its length. */
export function hashKind(text) {
  const clean = String(text ?? '').trim()
  if (!/^[0-9a-f]+$/i.test(clean)) return null
  return { 8: 'crc32', 32: 'md5', 40: 'sha1', 64: 'sha256', 96: 'sha384', 128: 'sha512' }[clean.length] ?? null
}
