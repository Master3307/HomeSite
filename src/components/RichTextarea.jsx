import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import DiscordText from './DiscordText'
import EmojiPicker from './cult/EmojiPicker'
import { accountFetch } from '../lib/account'

/*
 * A text field for things that end up on Discord (lobby code and FDC option
 * descriptions):
 *   - "@" + a name lists people of the server; picking one inserts a Discord
 *     mention (<@id>), which Discord and the site show as @Name
 *   - a small emoji button inserts emojis at the cursor
 *   - with mentions or custom emojis in it, a preview shows how it will look
 * `mentions={false}` turns the "@" list off (e.g. logged out).
 */

const MENTION_QUERY = /(^|\s)@([\p{L}\p{N}_.-]{0,32})$/u

async function searchPeople(query) {
  const response = await accountFetch(`/members/mention?q=${encodeURIComponent(query)}`, { cache: 'no-store' })
  if (!response.ok) return []
  const data = await response.json().catch(() => null)
  return data?.members ?? []
}

export default function RichTextarea({ id, value, onChange, mentions = true, emoji = true, className = '', inputClassName = '', rows = 2, maxLength, placeholder, ...rest }) {
  const { t } = useTranslation('common')
  const listId = useId()
  const field = useRef(null)
  const [query, setQuery] = useState(null) // { text, start } while typing "@name"
  const [people, setPeople] = useState([])
  const [active, setActive] = useState(0)
  // Names of people mentioned here, for the preview.
  const [known, setKnown] = useState({})

  useEffect(() => {
    if (query === null || !mentions) return undefined
    let alive = true
    const timer = setTimeout(() => {
      searchPeople(query.text)
        .then((list) => {
          if (!alive) return
          setPeople(list)
          setActive(0)
        })
        .catch(() => {})
    }, 120)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [query, mentions])

  /* Replaces the text between `start` and the cursor (or inserts at the cursor). */
  function insert(text, start = null) {
    const element = field.current
    const from = start ?? element?.selectionStart ?? value.length
    const to = element?.selectionEnd ?? value.length
    let next = value.slice(0, from) + text + value.slice(to)
    if (maxLength) next = next.slice(0, maxLength)
    onChange(next)
    const caret = Math.min(next.length, from + text.length)
    requestAnimationFrame(() => {
      element?.focus()
      element?.setSelectionRange(caret, caret)
    })
  }

  function look(element) {
    if (!mentions) return
    const before = element.value.slice(0, element.selectionStart)
    const match = before.match(MENTION_QUERY)
    setQuery(match ? { text: match[2], start: before.length - match[2].length - 1 } : null)
  }

  function pick(person) {
    setKnown((current) => ({ ...current, [person.id]: { displayName: person.displayName, username: person.username, key: person.key } }))
    insert(`<@${person.id}> `, query.start)
    setQuery(null)
    setPeople([])
  }

  const open = query !== null && people.length > 0
  const hasMarkup = /<(@!?|a?:\w{2,32}:)\d{17,20}>/.test(value)

  return (
    <div className={`rich-textarea ${className}`}>
      <div className="rich-textarea__field">
        <textarea
          {...rest}
          ref={field}
          id={id}
          className={inputClassName}
          rows={rows}
          maxLength={maxLength}
          placeholder={placeholder}
          value={value}
          role={mentions ? 'combobox' : undefined}
          aria-expanded={mentions ? open : undefined}
          aria-controls={open ? listId : undefined}
          aria-autocomplete={mentions ? 'list' : undefined}
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          onChange={(event) => {
            onChange(event.target.value)
            look(event.target)
          }}
          onClick={(event) => look(event.currentTarget)}
          onBlur={() => setTimeout(() => setQuery(null), 150)}
          onKeyDown={(event) => {
            if (!open) return
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : people.length - 1)) % people.length)
            } else if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault()
              pick(people[active])
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setQuery(null)
            }
          }}
        />
        {emoji && (
          <span className="rich-textarea__tools">
            <EmojiPicker variant="insert" onChange={(picked) => insert(picked)} label={t('richText.emoji', { defaultValue: 'Add an emoji' })} />
          </span>
        )}
      </div>

      {open && (
        <ul className="rich-textarea__people" id={listId} role="listbox" aria-label={t('richText.people', { defaultValue: 'People to mention' })}>
          {people.map((person, index) => (
            <li
              key={person.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={index === active ? 'is-active' : ''}
              onMouseDown={(event) => {
                event.preventDefault()
                pick(person)
              }}
              onMouseEnter={() => setActive(index)}
            >
              {person.avatarUrl ? <img src={person.avatarUrl} alt="" width="24" height="24" /> : <span className="material-symbols-outlined">person</span>}
              <strong>{person.displayName}</strong>
              <small>@{person.username}</small>
            </li>
          ))}
        </ul>
      )}

      {hasMarkup && (
        <p className="rich-textarea__preview" aria-label={t('richText.preview', { defaultValue: 'Preview' })}>
          <span className="material-symbols-outlined" aria-hidden="true">
            visibility
          </span>
          <span>
            <DiscordText text={value} mentions={{ users: known }} />
          </span>
        </p>
      )}
    </div>
  )
}
