/*
 * The dash's contacts (server/services/dashContacts.cjs): one shared copy for
 * the contacts widget, its big view and the dash search. vCards are read and
 * written here (shared/vcard.mjs); photos are made small (128 px WebP)
 * before they're saved.
 */
import { useEffect, useSyncExternalStore } from 'react'

import { accountFetch } from './account.js'

let state = { status: 'idle', contacts: [], error: null }
const listeners = new Set()
const set = (next) => {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

async function call(path, options = {}) {
  const response = await accountFetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status })
  return data
}

let loading = null
export function loadContacts(force = false) {
  if (loading) return loading
  if (state.status === 'done' && !force) return Promise.resolve(state.contacts)
  if (state.status !== 'done') set({ status: 'loading', error: null })
  loading = call('/contacts')
    .then((data) => {
      set({ status: 'done', contacts: data.contacts ?? [], error: null })
      return state.contacts
    })
    .catch((error) => {
      set({ status: state.contacts.length ? 'done' : 'error', error: error.message })
      throw error
    })
    .finally(() => {
      loading = null
    })
  return loading
}
export const forgetContacts = () => set({ status: 'idle', contacts: [], error: null })

/** { status, contacts, error }; loads them the first time it's used. */
export function useContacts({ enabled = true } = {}) {
  const snapshot = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
    () => state,
  )
  useEffect(() => {
    if (enabled && state.status === 'idle') loadContacts().catch(() => {})
  }, [enabled])
  return snapshot
}

export async function addContact(contact) {
  const data = await call('/contacts', { method: 'POST', body: JSON.stringify({ contact: await withSmallPhoto(contact) }) })
  set({ contacts: [...state.contacts, data.contact] })
  return data.contact
}
export async function updateContact(id, patch) {
  const data = await call(`/contacts/${id}`, { method: 'PATCH', body: JSON.stringify({ contact: await withSmallPhoto(patch) }) })
  set({ contacts: state.contacts.map((contact) => (contact.id === id ? data.contact : contact)) })
  return data.contact
}
export async function removeContact(id) {
  await call(`/contacts/${id}`, { method: 'DELETE' })
  set({ contacts: state.contacts.filter((contact) => contact.id !== id) })
}

/** A .vcf file into the contacts (in batches): { added, skipped }. */
export async function importVcf(file, onProgress = () => {}) {
  const { parseVcards } = await import('/shared/vcard.mjs')
  const cards = parseVcards(await file.text())
  let added = 0
  let skipped = 0
  for (let start = 0; start < cards.length; start += 500) {
    const batch = await Promise.all(cards.slice(start, start + 500).map(withSmallPhoto))
    const result = await call('/contacts/import', { method: 'POST', body: JSON.stringify({ contacts: batch }) })
    added += result.added
    skipped += result.skipped
    onProgress(Math.min(1, (start + 500) / cards.length))
  }
  await loadContacts(true)
  return { added, skipped, found: cards.length }
}

/** These contacts (all when none given) downloaded as a .vcf. */
export async function exportVcf(contacts = state.contacts, name = 'contacts') {
  const { writeVcards } = await import('/shared/vcard.mjs')
  const blob = new Blob([writeVcards(contacts)], { type: 'text/vcard;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `${name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'contacts'}.vcf`
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 5000)
}

/* A photo over ~24 KB redrawn at 128 px as WebP (what's shown is a small circle anyway). */
async function withSmallPhoto(contact) {
  const photo = contact?.photo
  if (!photo || !photo.startsWith('data:') || photo.length < 32_000 || typeof document === 'undefined') return contact
  try {
    const image = new Image()
    image.src = photo
    await image.decode()
    const side = 128
    const canvas = document.createElement('canvas')
    canvas.width = side
    canvas.height = side
    const scale = Math.max(side / image.naturalWidth, side / image.naturalHeight)
    const w = image.naturalWidth * scale
    const h = image.naturalHeight * scale
    canvas.getContext('2d').drawImage(image, (side - w) / 2, (side - h) / 2, w, h)
    return { ...contact, photo: canvas.toDataURL('image/webp', 0.82) }
  } catch {
    return { ...contact, photo: '' }
  }
}

/* ---------- finding ---------- */

const fold = (value) =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
const digits = (value) => String(value ?? '').replace(/\D+/g, '')

/** Contacts matching `query` (name, nickname, company, email, phone digits), best first. */
export function findContacts(contacts, query, limit = 50) {
  const words = fold(query).split(/\s+/).filter(Boolean)
  const queryDigits = digits(query)
  if (!words.length) return [...contacts].sort(byName)
  const scored = []
  for (const contact of contacts) {
    const name = fold(contact.name)
    const rest = fold([contact.nickname, contact.org, contact.title, ...(contact.emails ?? []).map((entry) => entry.value), contact.member].join(' '))
    let score = 0
    for (const word of words) {
      if (name.startsWith(word) || name.includes(` ${word}`)) score += 3
      else if (name.includes(word)) score += 2
      else if (rest.includes(word)) score += 1
      else {
        score = -1
        break
      }
    }
    if (score < 0 && queryDigits.length >= 3 && (contact.phones ?? []).some((phone) => digits(phone.value).includes(queryDigits))) score = 2
    if (score > 0) scored.push([score + (contact.favorite ? 0.5 : 0), contact])
  }
  return scored
    .sort((a, b) => b[0] - a[0] || byName(a[1], b[1]))
    .slice(0, limit)
    .map(([, contact]) => contact)
}
export const byName = (a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || a.name.localeCompare(b.name)
export const initials = (name) =>
  String(name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0])
    .join('')
    .toUpperCase()

/** Opens a contact's card on the dash (from the search, ContactHost in widgetsContacts.jsx). */
export const openContact = (id) => window.dispatchEvent(new CustomEvent('dash:open-contact', { detail: id }))
