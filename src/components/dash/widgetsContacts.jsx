import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { addContact, exportVcf, findContacts, importVcf, initials, removeContact, updateContact, useContacts } from '../../lib/dashContacts.js'
import { apiUrl, loadMembers, profilePath } from '../../lib/members.js'
import { Empty, LoadError, Loading } from './kit.jsx'

/*
 * Contacts: the widget (search, favourites first, a click opens the card),
 * the big view (list and card side by side, .vcf import / export), the card
 * (call, text, email, map, website, profile on this site, copy) and the
 * editor (with a member of the server linked by their @name). The dash
 * search lists matching contacts too; ContactHost opens their card.
 */

const BLANK = { name: '', given: '', family: '', nickname: '', org: '', title: '', phones: [], emails: [], addresses: [], urls: [], birthday: '', note: '', photo: '', member: '', favorite: false }

function Avatar({ contact, size = 36 }) {
  const [broken, setBroken] = useState(false)
  const style = { width: size, height: size, fontSize: size * 0.4 }
  if (contact.photo && !broken) return <img className="dash-contact-avatar" src={contact.photo} alt="" style={style} onError={() => setBroken(true)} referrerPolicy="no-referrer" />
  // A colour of its own per name, from the accent.
  let hash = 0
  for (const char of contact.name ?? '') hash = (hash * 31 + char.charCodeAt(0)) % 360
  return (
    <span className="dash-contact-avatar" style={{ ...style, '--hue': hash }} aria-hidden="true">
      {initials(contact.name) || '?'}
    </span>
  )
}

const copy = (text) => navigator.clipboard?.writeText(text).catch(() => {})
const mapUrl = (address) => `https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`
const telUrl = (number) => `tel:${number.replace(/[^\d+*#]/g, '')}`

/* Birthday text: "14 March 1998 · turns 28" / "14 March". */
function birthdayText(birthday, language, t = null) {
  if (!birthday) return ''
  const [year, month, day] = birthday.startsWith('--') ? [null, ...birthday.slice(2).split('-').map(Number)] : birthday.split('-').map(Number)
  const date = new Date(2000, month - 1, day).toLocaleDateString(language, { day: 'numeric', month: 'long' })
  if (!year) return date
  const now = new Date()
  const next = new Date(now.getFullYear(), month - 1, day) < new Date(now.getFullYear(), now.getMonth(), now.getDate()) ? now.getFullYear() + 1 : now.getFullYear()
  return t ? t('widgets.contacts.turns', { date: `${date} ${year}`, age: next - year }) : `${date} ${year}`
}

export function ContactCard({ contact, onEdit, onClose = null }) {
  const { t, i18n } = useTranslation('dash')
  const [copied, setCopied] = useState(null)
  const doCopy = (text) => {
    copy(text)
    setCopied(text)
    setTimeout(() => setCopied(null), 1200)
  }
  const row = (icon, label, value, actions) => (
    <li key={`${icon}-${value}`} className="dash-contact-row">
      <span className="material-symbols-outlined" aria-hidden="true">
        {icon}
      </span>
      <span className="dash-contact-row__text">
        <span>{value}</span>
        {label && <small>{label}</small>}
      </span>
      <span className="dash-contact-row__actions">
        {actions}
        <button type="button" className="dash-tool" onClick={() => doCopy(value)} aria-label={t('widgets.contacts.copy')} title={copied === value ? t('widgets.contacts.copied') : t('widgets.contacts.copy')}>
          <span className="material-symbols-outlined">{copied === value ? 'check' : 'content_copy'}</span>
        </button>
      </span>
    </li>
  )
  const typeLabel = (type) => (type ? t(`widgets.contacts.types.${type}`, { defaultValue: type }) : '')
  const firstPhone = contact.phones?.[0]?.value
  const firstEmail = contact.emails?.[0]?.value
  return (
    <article className="dash-contact-card">
      <header>
        <Avatar contact={contact} size={64} />
        <div>
          <h3>
            {contact.name}
            {contact.favorite && (
              <span className="material-symbols-outlined dash-contact-fav" aria-label={t('widgets.contacts.favorite')}>
                star
              </span>
            )}
          </h3>
          {(contact.nickname || contact.org || contact.title) && <p className="dash-muted">{[contact.nickname && `“${contact.nickname}”`, [contact.title, contact.org].filter(Boolean).join(' · ')].filter(Boolean).join(' — ')}</p>}
        </div>
        <span className="dash-contact-card__tools">
          {onEdit && (
            <button type="button" className="dash-tool" onClick={onEdit} aria-label={t('widgets.contacts.edit')} title={t('widgets.contacts.edit')}>
              <span className="material-symbols-outlined">edit</span>
            </button>
          )}
          {onClose && (
            <button type="button" className="dash-tool" onClick={onClose} aria-label={t('settings.close')}>
              <span className="material-symbols-outlined">close</span>
            </button>
          )}
        </span>
      </header>
      {(firstPhone || firstEmail || contact.member) && (
        <div className="dash-contact-quick">
          {firstPhone && (
            <a className="dash-contact-quick__button" href={telUrl(firstPhone)}>
              <span className="material-symbols-outlined" aria-hidden="true">
                call
              </span>
              {t('widgets.contacts.call')}
            </a>
          )}
          {firstPhone && (
            <a className="dash-contact-quick__button" href={`sms:${firstPhone.replace(/[^\d+]/g, '')}`}>
              <span className="material-symbols-outlined" aria-hidden="true">
                sms
              </span>
              {t('widgets.contacts.text')}
            </a>
          )}
          {firstEmail && (
            <a className="dash-contact-quick__button" href={`mailto:${firstEmail}`}>
              <span className="material-symbols-outlined" aria-hidden="true">
                mail
              </span>
              {t('widgets.contacts.email')}
            </a>
          )}
          {contact.member && (
            <a className="dash-contact-quick__button" href={profilePath({ username: contact.member.slice(1) })} target="_blank" rel="noopener">
              <span className="material-symbols-outlined" aria-hidden="true">
                account_circle
              </span>
              {t('widgets.contacts.profile')}
            </a>
          )}
        </div>
      )}
      <ul className="dash-contact-rows">
        {(contact.phones ?? []).map((phone) =>
          row('call', typeLabel(phone.type), phone.value, (
            <a className="dash-tool" href={telUrl(phone.value)} aria-label={t('widgets.contacts.call')} title={t('widgets.contacts.call')}>
              <span className="material-symbols-outlined">call</span>
            </a>
          )),
        )}
        {(contact.emails ?? []).map((email) =>
          row('mail', typeLabel(email.type), email.value, (
            <a className="dash-tool" href={`mailto:${email.value}`} aria-label={t('widgets.contacts.email')} title={t('widgets.contacts.email')}>
              <span className="material-symbols-outlined">send</span>
            </a>
          )),
        )}
        {(contact.addresses ?? []).map((address) =>
          row('location_on', typeLabel(address.type), address.value, (
            <a className="dash-tool" href={mapUrl(address.value)} target="_blank" rel="noopener noreferrer" aria-label={t('widgets.contacts.map')} title={t('widgets.contacts.map')}>
              <span className="material-symbols-outlined">map</span>
            </a>
          )),
        )}
        {(contact.urls ?? []).map((url) =>
          row('link', '', url.value, (
            <a className="dash-tool" href={url.value} target="_blank" rel="noopener noreferrer" aria-label={t('widgets.contacts.open')} title={t('widgets.contacts.open')}>
              <span className="material-symbols-outlined">open_in_new</span>
            </a>
          )),
        )}
        {contact.birthday && row('cake', t('widgets.contacts.birthday'), birthdayText(contact.birthday, i18n.language, t), null)}
        {contact.member && row('forum', t('widgets.contacts.member'), contact.member, null)}
      </ul>
      {contact.note && <p className="dash-contact-note">{contact.note}</p>}
    </article>
  )
}

/* A member of the server to link (their @name), searched in the member list. */
function MemberPicker({ value, onChange }) {
  const { t } = useTranslation('dash')
  const [members, setMembers] = useState(null)
  const [query, setQuery] = useState('')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (members || failed) return
    loadMembers()
      .then((data) => setMembers(data.members ?? []))
      .catch(() => setFailed(true))
  }, [members, failed])
  const found = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^@/, '')
    if (!q || !members) return []
    return members.filter((member) => member.username.toLowerCase().includes(q) || (member.displayName ?? '').toLowerCase().includes(q)).slice(0, 6)
  }, [query, members])
  if (value) {
    const member = members?.find((entry) => entry.key === value)
    return (
      <div className="dash-row">
        {member?.avatarUrl && <img className="dash-contact-avatar" src={apiUrl(member.avatarUrl)} alt="" width="24" height="24" />}
        <span>{member?.displayName ? `${member.displayName} (${value})` : value}</span>
        <button type="button" className="dash-link-button" onClick={() => onChange('')}>
          {t('widgets.contacts.unlink')}
        </button>
      </div>
    )
  }
  if (failed) return <span className="dash-hint">{t('widgets.contacts.membersOnly')}</span>
  return (
    <div className="dash-contact-members">
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('widgets.contacts.findMember')} />
      {found.length > 0 && (
        <ul>
          {found.map((member) => (
            <li key={member.key}>
              <button type="button" onClick={() => (onChange(member.key), setQuery(''))}>
                {member.avatarUrl ? <img className="dash-contact-avatar" src={apiUrl(member.avatarUrl)} alt="" width="24" height="24" /> : <span className="dash-contact-avatar" style={{ width: 24, height: 24 }} />}
                <span>{member.displayName || member.username}</span>
                <small className="dash-muted">{member.key}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* Lists of { type, value } (phones, emails, addresses). */
function EntryList({ label, entries, onChange, inputType = 'text', types = ['', 'cell', 'home', 'work', 'other'], max = 20 }) {
  const { t } = useTranslation('dash')
  const list = entries.length ? entries : [{ type: types.includes('cell') && inputType === 'tel' ? 'cell' : '', value: '' }]
  const change = (index, patch) => onChange(list.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)))
  return (
    <fieldset className="dash-contact-entries">
      <legend className="dash-field__label">{label}</legend>
      {list.map((entry, index) => (
        <div key={index} className="dash-contact-entry">
          <select value={entry.type} onChange={(event) => change(index, { type: event.target.value })} aria-label={t('widgets.contacts.kind')}>
            {types.map((type) => (
              <option key={type} value={type}>
                {type ? t(`widgets.contacts.types.${type}`) : '—'}
              </option>
            ))}
          </select>
          <input type={inputType} value={entry.value} onChange={(event) => change(index, { value: event.target.value })} aria-label={label} />
          <button type="button" className="dash-tool" onClick={() => onChange(list.filter((_, position) => position !== index))} aria-label={t('widgets.contacts.removeEntry')} title={t('widgets.contacts.removeEntry')}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      ))}
      {list.length < max && (
        <button type="button" className="dash-link-button" onClick={() => onChange([...list, { type: '', value: '' }])}>
          {t('widgets.contacts.addEntry')}
        </button>
      )}
    </fieldset>
  )
}

export function ContactEditor({ contact = null, onClose, onSaved = () => {} }) {
  const { t, i18n } = useTranslation('dash')
  const ref = useRef(null)
  const photoInput = useRef(null)
  const [draft, setDraft] = useState(() => ({ ...BLANK, ...(contact ?? {}) }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  const set = (patch) => setDraft((current) => ({ ...current, ...patch }))
  const cleaned = () => ({ ...draft, phones: draft.phones.filter((entry) => entry.value.trim()), emails: draft.emails.filter((entry) => entry.value.trim()), addresses: draft.addresses.filter((entry) => entry.value.trim()), urls: draft.urls.filter((entry) => entry.value.trim()) })
  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const saved = contact?.id ? await updateContact(contact.id, cleaned()) : await addContact(cleaned())
      onSaved(saved)
      ref.current?.close()
    } catch (reason) {
      setError(reason.message)
      setBusy(false)
    }
  }
  const remove = async () => {
    setBusy(true)
    try {
      await removeContact(contact.id)
      onSaved(null)
      ref.current?.close()
    } catch (reason) {
      setError(reason.message)
      setBusy(false)
    }
  }
  const pickPhoto = (file) => {
    if (!file || !file.type.startsWith('image/') || file.type === 'image/svg+xml') return
    const reader = new FileReader()
    reader.onload = () => set({ photo: String(reader.result) })
    reader.readAsDataURL(file)
  }
  return (
    <dialog ref={ref} className="dash-dialog dash-contact-editor" onClose={onClose} aria-labelledby="dash-contact-editor-title" onClick={(event) => event.target === ref.current && ref.current.close()}>
      <form onSubmit={save}>
        <header className="dash-dialog__head">
          <h2 id="dash-contact-editor-title">{contact?.id ? t('widgets.contacts.edit') : t('widgets.contacts.new')}</h2>
          <button type="button" className="dash-tool" onClick={() => ref.current?.close()} aria-label={t('settings.close')}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>
        <div className="dash-dialog__body">
          <div className="dash-contact-editor__top">
            <button type="button" className="dash-contact-editor__photo" onClick={() => photoInput.current?.click()} title={t('widgets.contacts.photo')}>
              <Avatar contact={{ ...draft, name: draft.name || [draft.given, draft.family].join(' ') }} size={72} />
              <span className="material-symbols-outlined" aria-hidden="true">
                photo_camera
              </span>
            </button>
            <input ref={photoInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(event) => (pickPhoto(event.target.files?.[0]), (event.target.value = ''))} />
            <div className="dash-contact-editor__names">
              <label className="dash-field">
                <span className="dash-field__label">{t('widgets.contacts.name')}</span>
                <input autoFocus value={draft.name} maxLength={200} onChange={(event) => set({ name: event.target.value })} required={!draft.given && !draft.family} />
              </label>
              <label className="dash-check">
                <input type="checkbox" checked={draft.favorite} onChange={(event) => set({ favorite: event.target.checked })} />
                <span>{t('widgets.contacts.favorite')}</span>
              </label>
            </div>
          </div>
          {draft.photo && (
            <button type="button" className="dash-link-button" onClick={() => set({ photo: '' })}>
              {t('widgets.contacts.removePhoto')}
            </button>
          )}
          <div className="dash-contact-editor__grid">
            <label className="dash-field">
              <span className="dash-field__label">{t('widgets.contacts.nickname')}</span>
              <input value={draft.nickname} maxLength={100} onChange={(event) => set({ nickname: event.target.value })} />
            </label>
            <label className="dash-field">
              <span className="dash-field__label">{t('widgets.contacts.org')}</span>
              <input value={draft.org} maxLength={200} onChange={(event) => set({ org: event.target.value })} />
            </label>
          </div>
          <EntryList label={t('widgets.contacts.phones')} entries={draft.phones} inputType="tel" types={['', 'cell', 'home', 'work', 'fax', 'other']} onChange={(phones) => set({ phones })} />
          <EntryList label={t('widgets.contacts.emails')} entries={draft.emails} inputType="email" types={['', 'home', 'work', 'other']} onChange={(emails) => set({ emails })} />
          <EntryList label={t('widgets.contacts.addresses')} entries={draft.addresses} types={['', 'home', 'work', 'other']} max={10} onChange={(addresses) => set({ addresses })} />
          <label className="dash-field">
            <span className="dash-field__label">{t('widgets.contacts.birthday')}</span>
            <input type="date" value={draft.birthday.startsWith('--') ? '' : draft.birthday} onChange={(event) => set({ birthday: event.target.value })} />
            {draft.birthday.startsWith('--') && <span className="dash-hint">{t('widgets.contacts.noYear', { date: birthdayText(draft.birthday, i18n.language) })}</span>}
          </label>
          <div className="dash-field">
            <span className="dash-field__label">{t('widgets.contacts.member')}</span>
            <MemberPicker value={draft.member} onChange={(member) => set({ member })} />
          </div>
          <label className="dash-field">
            <span className="dash-field__label">{t('widgets.contacts.notes')}</span>
            <textarea rows={3} value={draft.note} maxLength={4000} onChange={(event) => set({ note: event.target.value })} />
          </label>
          {error && <p className="dash-error">{error}</p>}
        </div>
        <footer className="dash-dialog__foot dash-cal-editor__foot">
          {contact?.id &&
            (confirmDelete ? (
              <button type="button" className="dash-button dash-button--danger dash-button--small" disabled={busy} onClick={remove}>
                {t('widgets.contacts.deleteYes')}
              </button>
            ) : (
              <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => setConfirmDelete(true)}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  delete
                </span>
                {t('settings.delete')}
              </button>
            ))}
          <span className="dash-cal-editor__spacer" />
          <button type="submit" className="dash-button dash-button--small" disabled={busy}>
            {t('widgets.calendar.save')}
          </button>
        </footer>
      </form>
    </dialog>
  )
}

function ContactList({ contacts, selected, onPick, compact = false }) {
  return (
    <ul className={`dash-contact-list${compact ? ' is-compact' : ''}`}>
      {contacts.map((contact) => (
        <li key={contact.id}>
          <button type="button" className={selected === contact.id ? 'is-active' : ''} onClick={() => onPick(contact)}>
            <Avatar contact={contact} size={compact ? 30 : 36} />
            <span className="dash-contact-list__text">
              <strong>{contact.name}</strong>
              {!compact && <small className="dash-muted">{contact.org || contact.phones?.[0]?.value || contact.emails?.[0]?.value || ''}</small>}
            </span>
            {contact.favorite && (
              <span className="material-symbols-outlined dash-contact-fav" aria-hidden="true">
                star
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}

/* The widget: search, the list; a contact opens as a card in place. */
function ContactsView({ widget }) {
  const { t } = useTranslation('dash')
  const { status, contacts, error } = useContacts()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(null)
  const [editing, setEditing] = useState(null)
  const { favoritesOnly = false } = widget.options
  const shown = useMemo(() => findContacts(favoritesOnly && !query ? contacts.filter((contact) => contact.favorite) : contacts, query, 200), [contacts, query, favoritesOnly])
  if (status === 'loading' || status === 'idle') return <Loading lines={4} />
  if (status === 'error') return <LoadError error={error} />
  const current = open && contacts.find((contact) => contact.id === open)
  return (
    <div className="dash-w-contacts">
      {current ? (
        <div className="dash-w-contacts__card">
          <button type="button" className="dash-link-button" onClick={() => setOpen(null)}>
            ← {t('widgets.contacts.back')}
          </button>
          <ContactCard contact={current} onEdit={() => setEditing(current)} />
        </div>
      ) : (
        <>
          <div className="dash-w-contacts__bar">
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('widgets.contacts.search', { count: contacts.length })} aria-label={t('widgets.contacts.searchLabel')} />
            <button type="button" className="dash-tool" onClick={() => setEditing({})} aria-label={t('widgets.contacts.new')} title={t('widgets.contacts.new')}>
              <span className="material-symbols-outlined">person_add</span>
            </button>
          </div>
          {!contacts.length ? <Empty icon="contacts">{t('widgets.contacts.none')}</Empty> : shown.length ? <ContactList contacts={shown} compact onPick={(contact) => setOpen(contact.id)} /> : <p className="dash-hint">{t('widgets.contacts.noMatch')}</p>}
        </>
      )}
      {editing && <ContactEditor contact={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={(saved) => setOpen(saved?.id ?? null)} />}
    </div>
  )
}

/* Opened big: list and card side by side, .vcf import / export. */
function ContactsDetail() {
  const { t } = useTranslation('dash')
  const { status, contacts, error } = useContacts()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)
  const [editing, setEditing] = useState(null)
  const [importing, setImporting] = useState(null)
  const file = useRef(null)
  const shown = useMemo(() => findContacts(contacts, query, 5000), [contacts, query])
  const current = contacts.find((contact) => contact.id === selected) ?? shown[0] ?? null
  const runImport = async (picked) => {
    if (!picked) return
    setImporting({ progress: 0 })
    try {
      const result = await importVcf(picked, (progress) => setImporting({ progress }))
      setImporting({ done: result })
    } catch (reason) {
      setImporting({ error: reason.message })
    }
  }
  if (status === 'loading' || status === 'idle') return <Loading lines={6} />
  if (status === 'error') return <LoadError error={error} />
  return (
    <div className="dash-contacts-app">
      <aside>
        <div className="dash-w-contacts__bar">
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('widgets.contacts.search', { count: contacts.length })} aria-label={t('widgets.contacts.searchLabel')} />
        </div>
        <ContactList contacts={shown} selected={current?.id} onPick={(contact) => setSelected(contact.id)} />
        <div className="dash-contacts-app__actions">
          <button type="button" className="dash-button dash-button--small" onClick={() => setEditing({})}>
            <span className="material-symbols-outlined" aria-hidden="true">
              person_add
            </span>
            {t('widgets.contacts.new')}
          </button>
          <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => file.current?.click()} disabled={importing && !importing.done && !importing.error}>
            <span className="material-symbols-outlined" aria-hidden="true">
              upload_file
            </span>
            {importing && importing.progress !== undefined ? `${Math.round(importing.progress * 100)}%` : t('widgets.contacts.import')}
          </button>
          <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => exportVcf(contacts)} disabled={!contacts.length}>
            <span className="material-symbols-outlined" aria-hidden="true">
              download
            </span>
            {t('widgets.contacts.export')}
          </button>
          <input ref={file} type="file" accept=".vcf,text/vcard,text/x-vcard" hidden onChange={(event) => (runImport(event.target.files?.[0]), (event.target.value = ''))} />
        </div>
        {importing?.done && <p className="dash-hint dash-ok">{t('widgets.contacts.imported', { count: importing.done.added, found: importing.done.found })}</p>}
        {importing?.error && <p className="dash-error">{importing.error}</p>}
        <p className="dash-hint">{t('widgets.contacts.importHint')}</p>
      </aside>
      <section>{current ? <ContactCard contact={current} onEdit={() => setEditing(current)} /> : <Empty icon="contacts">{t('widgets.contacts.none')}</Empty>}</section>
      {editing && <ContactEditor contact={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={(saved) => saved && setSelected(saved.id)} />}
    </div>
  )
}

/* On the dash: a contact's card when the search opens one (`dash:open-contact`). */
export function ContactHost() {
  const { contacts } = useContacts({ enabled: false })
  const [id, setId] = useState(null)
  const [editing, setEditing] = useState(false)
  const ref = useRef(null)
  // Closing the card to edit it must not forget which contact it was.
  const toEditor = useRef(false)
  useEffect(() => {
    const open = (event) => setId(event.detail)
    window.addEventListener('dash:open-contact', open)
    return () => window.removeEventListener('dash:open-contact', open)
  }, [])
  useEffect(() => {
    if (id && !editing) ref.current?.showModal()
  }, [id, editing])
  const contact = contacts.find((entry) => entry.id === id)
  if (!contact) return null
  if (editing)
    return (
      <ContactEditor
        contact={contact}
        onClose={() => {
          setEditing(false)
          setId(null)
        }}
      />
    )
  return (
    <dialog
      ref={ref}
      className="dash-dialog dash-contact-dialog"
      onClose={() => {
        if (toEditor.current) toEditor.current = false
        else setId(null)
      }}
      aria-label={contact.name}
      onClick={(event) => event.target === ref.current && ref.current.close()}
    >
      <div className="dash-dialog__body">
        <ContactCard
          contact={contact}
          onEdit={() => {
            toEditor.current = true
            setEditing(true)
            ref.current?.close()
          }}
          onClose={() => ref.current?.close()}
        />
      </div>
    </dialog>
  )
}

export const CONTACT_VIEWS = { ContactsView, ContactsDetail }
