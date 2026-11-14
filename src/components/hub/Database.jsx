import { useEffect, useMemo, useState } from 'react'

import { ACCOUNT_API_URL, hubGet, hubSend, userPageUrl } from '/src/lib/hub'
import { Card, Empty, ErrorNote, Icon, formatDate, timeAgo, useDebounced, useHubData } from './common'

/*
 * Database tools: website users (accounts.sqlite users + sessions), every
 * SQLite table as an editable grid, and the JSON/CSV data files of the bot
 * and the site. Every change is written to the activity log.
 */

const ROLES = ['user', 'admin', 'owner']

/* ---------- users ---------- */

function UserForm({ user, onSaved, onCancel }) {
  const creating = !user
  const [form, setForm] = useState(() => ({
    discordUserId: user?.discordUserId ?? '',
    username: user?.username ?? '',
    displayName: user?.displayName ?? '',
    email: user?.email ?? '',
    role: user?.role ?? 'user',
    settings: JSON.stringify(user?.settings ?? {}, null, 2),
  }))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      JSON.parse(form.settings || '{}')
      const body = { ...form, email: form.email || null, settings: form.settings || '{}' }
      if (!creating) delete body.discordUserId
      const saved = creating ? await hubSend('/hub/users', body) : await hubSend(`/hub/users/${user.id}`, body, 'PATCH')
      onSaved(saved)
    } catch (saveError) {
      setError(saveError instanceof SyntaxError ? new Error('Settings must be valid JSON.') : saveError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="hub-form" onSubmit={submit}>
      <div className="hub-form__grid">
        {creating && (
          <label>
            Discord user ID
            <input className="is-mono" inputMode="numeric" required value={form.discordUserId} onChange={set('discordUserId')} placeholder="17–20 digits" />
          </label>
        )}
        <label>
          Username
          <input required value={form.username} onChange={set('username')} />
        </label>
        <label>
          Display name
          <input value={form.displayName} onChange={set('displayName')} placeholder="Same as the username" />
        </label>
        <label>
          Email
          <input type="email" value={form.email} onChange={set('email')} placeholder="—" />
        </label>
        <label>
          Role
          <select value={form.role} onChange={set('role')}>
            {ROLES.map((role) => (
              <option key={role}>{role}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Settings (JSON)
        <textarea className="is-mono" rows={8} value={form.settings} onChange={set('settings')} spellCheck={false} />
      </label>
      <ErrorNote error={error} />
      <div className="hub-form__actions">
        <button type="button" className="hub-button hub-button--ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="hub-button" disabled={busy}>
          <Icon name="save" />
          {creating ? 'Create user' : 'Save'}
        </button>
      </div>
    </form>
  )
}

function UserDetails({ id, onChanged, onClose }) {
  const [user, setUser] = useState(null)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState(false)

  useEffect(() => {
    let alive = true
    hubGet(`/hub/users/${id}`)
      .then((data) => alive && setUser(data))
      .catch((loadError) => alive && setError(loadError))
    return () => {
      alive = false
    }
  }, [id])

  if (error) return <ErrorNote error={error} />
  if (!user) return <div className="hub-loading">Loading…</div>

  const avatar = user.avatarPath ? `${ACCOUNT_API_URL}/${user.avatarPath}` : null

  const action = async (path, done) => {
    try {
      await hubSend(path)
      done()
    } catch (actionError) {
      setError(actionError)
    }
  }

  return (
    <div className="hub-user">
      <button type="button" className="hub-back" onClick={onClose}>
        <Icon name="arrow_back" />
        All users
      </button>
      <header className="hub-user__head">
        {avatar ? <img src={avatar} alt="" /> : <span className="hub-user__blank">{user.displayName.slice(0, 1)}</span>}
        <div>
          <h3>{user.displayName}</h3>
          <small>
            @{user.username} <span className={`hub-role hub-role--${user.role}`}>{user.role}</span>
          </small>
        </div>
        <button type="button" className="hub-icon-button" title="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>

      {editing ? (
        <UserForm
          user={user}
          onCancel={() => setEditing(false)}
          onSaved={(saved) => {
            setUser(saved)
            setEditing(false)
            onChanged()
          }}
        />
      ) : (
        <>
          <dl className="hub-kv">
            <dt>Account ID</dt>
            <dd className="is-mono">{user.id}</dd>
            <dt>Discord ID</dt>
            <dd className="is-mono">
              {/^\d+$/.test(user.discordUserId) ? <a href={userPageUrl(user.discordUserId)}>{user.discordUserId}</a> : user.discordUserId}
            </dd>
            <dt>Email</dt>
            <dd>{user.email || '—'}</dd>
            <dt>Created</dt>
            <dd>{formatDate(user.createdAt)}</dd>
            <dt>Last login</dt>
            <dd>
              {formatDate(user.lastLoginAt)} ({timeAgo(user.lastLoginAt)})
            </dd>
            <dt>Sessions</dt>
            <dd>{user.sessions.length ? user.sessions.map((session) => `seen ${timeAgo(session.last_seen_at)}`).join(', ') : 'none'}</dd>
          </dl>
          <h4>Settings</h4>
          <pre className="hub-code">{JSON.stringify(user.settings, null, 2)}</pre>
          <div className="hub-form__actions">
            {/^\d+$/.test(user.discordUserId) && (
              <a className="hub-button hub-button--ghost" href={userPageUrl(user.discordUserId)}>
                <Icon name="person_search" />
                Discord page
              </a>
            )}
            <button type="button" className="hub-button hub-button--ghost" onClick={() => setEditing(true)}>
              <Icon name="edit" />
              Edit
            </button>
            <button type="button" className="hub-button hub-button--ghost" onClick={() => action(`/hub/users/${user.id}/logout`, () => setUser({ ...user, sessions: [] }))}>
              <Icon name="logout" />
              Log out everywhere
            </button>
            {confirm ? (
              <button
                type="button"
                className="hub-button hub-button--danger"
                onClick={() =>
                  action(`/hub/users/${user.id}/delete`, () => {
                    onChanged()
                    onClose()
                  })
                }
              >
                <Icon name="delete_forever" />
                Really delete {user.username}?
              </button>
            ) : (
              <button type="button" className="hub-button hub-button--ghost is-danger" onClick={() => setConfirm(true)}>
                <Icon name="delete" />
                Delete
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Users({ onLocked }) {
  const [query, setQuery] = useState('')
  const search = useDebounced(query, 220)
  const [version, setVersion] = useState(0)
  const { data, error } = useHubData('/hub/users', { q: search, v: version }, { onLocked })
  const [selected, setSelected] = useState(null)
  const [creating, setCreating] = useState(false)

  return (
    <div className={`hub-split${selected || creating ? ' has-detail' : ''}`}>
      <div className="hub-split__list">
        <div className="hub-toolbar">
          <label className="hub-search">
            <Icon name="search" />
            <input type="search" placeholder="Search users" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <button
            type="button"
            className="hub-button"
            onClick={() => {
              setSelected(null)
              setCreating(true)
            }}
          >
            <Icon name="person_add" />
            Add user
          </button>
        </div>
        <ErrorNote error={error} />
        {data && <small className="hub-quiet">{data.users.length === data.total ? `${data.total} users` : `${data.users.length} of ${data.total} users`}</small>}
        <ul className="hub-userlist">
          {data?.users.map((user) => (
            <li key={user.id}>
              <div className={`hub-userrow${selected === user.id ? ' is-active' : ''}`}>
                <button
                  type="button"
                  className="hub-userrow__main"
                  onClick={() => {
                    setCreating(false)
                    setSelected(user.id)
                  }}
                >
                  {user.avatarPath ? <img src={`${ACCOUNT_API_URL}/${user.avatarPath}`} alt="" loading="lazy" /> : <span className="hub-user__blank">{user.displayName.slice(0, 1)}</span>}
                  <span className="hub-userrow__text">
                    <strong>
                      {user.displayName} {user.role !== 'user' && <span className={`hub-role hub-role--${user.role}`}>{user.role}</span>}
                    </strong>
                    <small>@{user.username}</small>
                  </span>
                  <span className="hub-userrow__seen">
                    {user.activeSessions > 0 && <span className="hub-dot hub-dot--online" title="Signed in" />}
                    {timeAgo(user.lastLoginAt)}
                  </span>
                </button>
                {/^\d+$/.test(user.discordUserId) && (
                  <a className="hub-icon-button" href={userPageUrl(user.discordUserId)} title="Open the Discord page">
                    <Icon name="open_in_new" />
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
      {(selected || creating) && (
        <div className="hub-split__detail">
          {creating ? (
            <Card title="New website user">
              <UserForm
                onCancel={() => setCreating(false)}
                onSaved={(user) => {
                  setCreating(false)
                  setSelected(user.id)
                  setVersion((value) => value + 1)
                }}
              />
            </Card>
          ) : (
            <UserDetails key={selected} id={selected} onChanged={() => setVersion((value) => value + 1)} onClose={() => setSelected(null)} />
          )}
        </div>
      )}
    </div>
  )
}

/* ---------- tables ---------- */

function RowEditor({ table, row, onDone, onCancel }) {
  const creating = !row
  const [values, setValues] = useState(() => Object.fromEntries(table.columns.map((column) => [column.name, row ? row[column.name] : undefined])))
  const [error, setError] = useState(null)
  const [confirm, setConfirm] = useState(false)

  async function save(event) {
    event.preventDefault()
    setError(null)
    try {
      const changed = Object.fromEntries(
        Object.entries(values).filter(([name, value]) => (creating ? value !== undefined && value !== '' : value !== row[name])),
      )
      if (creating) await hubSend(`/hub/db/tables/${encodeURIComponent(table.name)}/rows`, { values: changed })
      else if (Object.keys(changed).length) await hubSend(`/hub/db/tables/${encodeURIComponent(table.name)}/rows/${row.__rowid}`, { values: changed }, 'PATCH')
      onDone()
    } catch (saveError) {
      setError(saveError)
    }
  }

  async function remove() {
    try {
      await hubSend(`/hub/db/tables/${encodeURIComponent(table.name)}/rows/${row.__rowid}/delete`)
      onDone()
    } catch (deleteError) {
      setError(deleteError)
    }
  }

  return (
    <form className="hub-form hub-roweditor" onSubmit={save}>
      <h3>
        {creating ? `New row in ${table.name}` : `${table.name} · row ${row.__rowid}`}
        <button type="button" className="hub-icon-button" title="Close" onClick={onCancel}>
          <Icon name="close" />
        </button>
      </h3>
      {table.columns.map((column) => {
        const value = values[column.name]
        const long = typeof value === 'string' && (value.length > 80 || value.includes('\n') || /json/i.test(column.name))
        return (
          <label key={column.name}>
            <span className="hub-roweditor__name">
              {column.name}
              <small>
                {column.type || 'any'}
                {column.pk && ' · key'}
                {column.notNull && ' · required'}
              </small>
              <button
                type="button"
                className={`hub-filter hub-filter--tiny${value === null ? ' is-on' : ''}`}
                onClick={() => setValues((current) => ({ ...current, [column.name]: current[column.name] === null ? '' : null }))}
              >
                NULL
              </button>
            </span>
            {long ? (
              <textarea className="is-mono" rows={5} value={value ?? ''} disabled={value === null} onChange={(event) => setValues((current) => ({ ...current, [column.name]: event.target.value }))} />
            ) : (
              <input
                className="is-mono"
                value={value ?? ''}
                disabled={value === null}
                placeholder={creating && column.pk ? 'automatic' : value === null ? 'NULL' : ''}
                onChange={(event) => setValues((current) => ({ ...current, [column.name]: event.target.value }))}
              />
            )}
          </label>
        )
      })}
      <ErrorNote error={error} />
      <div className="hub-form__actions">
        {!creating &&
          (confirm ? (
            <button type="button" className="hub-button hub-button--danger" onClick={remove}>
              <Icon name="delete_forever" />
              Really delete?
            </button>
          ) : (
            <button type="button" className="hub-button hub-button--ghost is-danger" onClick={() => setConfirm(true)}>
              <Icon name="delete" />
              Delete row
            </button>
          ))}
        <span className="hub-console__spacer" />
        <button type="button" className="hub-button hub-button--ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="hub-button">
          <Icon name="save" />
          {creating ? 'Add' : 'Save'}
        </button>
      </div>
    </form>
  )
}

const cell = (value) => {
  if (value === null || value === undefined) return <span className="hub-null">NULL</span>
  const text = String(value)
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}

function Tables({ onLocked }) {
  const { data: list, error: listError } = useHubData('/hub/db/tables', null, { onLocked })
  const [name, setName] = useState(null)
  const [query, setQuery] = useState('')
  const search = useDebounced(query, 250)
  const [offset, setOffset] = useState(0)
  const [sort, setSort] = useState({ column: '', dir: 'asc' })
  const [version, setVersion] = useState(0)
  const [editing, setEditing] = useState(null) // row, or "new"
  const limit = 50

  useEffect(() => {
    if (!name && list?.tables?.length) setName(list.tables.find((table) => table.name === 'users')?.name ?? list.tables[0].name)
  }, [list, name])
  useEffect(() => setOffset(0), [name, search])

  const { data, error } = useHubData(name ? `/hub/db/tables/${encodeURIComponent(name)}` : '/hub/db/tables', name ? { q: search, offset, limit, sort: sort.column, dir: sort.dir, v: version } : null, { onLocked })
  const table = name && data?.rows ? data : null
  const discordColumn = table?.columns.find((column) => column.name === 'discord_user_id')

  return (
    <div className="hub-tables">
      <div className="hub-filters hub-tables__names" role="tablist">
        {list?.tables.map((entry) => (
          <button key={entry.name} type="button" role="tab" aria-selected={entry.name === name} className={`hub-filter${entry.name === name ? ' is-on' : ''}`} onClick={() => setName(entry.name)}>
            {entry.name} <span className="hub-filter__count">{entry.rows}</span>
          </button>
        ))}
      </div>
      <ErrorNote error={listError ?? error} />
      {table && (
        <>
          <div className="hub-toolbar">
            <label className="hub-search">
              <Icon name="search" />
              <input type="search" placeholder={`Search ${table.name}…`} value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <small className="hub-quiet">
              {table.total ? `${offset + 1}–${Math.min(offset + limit, table.total)} of ${table.total}` : 'No rows'}
            </small>
            <button type="button" className="hub-icon-button" disabled={offset === 0} onClick={() => setOffset((value) => Math.max(0, value - limit))} title="Previous page">
              <Icon name="chevron_left" />
            </button>
            <button type="button" className="hub-icon-button" disabled={offset + limit >= table.total} onClick={() => setOffset((value) => value + limit)} title="Next page">
              <Icon name="chevron_right" />
            </button>
            <button type="button" className="hub-button" onClick={() => setEditing('new')}>
              <Icon name="add" />
              Add row
            </button>
          </div>
          <div className="hub-grid-table">
            <table>
              <thead>
                <tr>
                  {table.columns.map((column) => (
                    <th key={column.name}>
                      <button
                        type="button"
                        onClick={() => setSort((current) => ({ column: column.name, dir: current.column === column.name && current.dir === 'asc' ? 'desc' : 'asc' }))}
                      >
                        {column.pk && <Icon name="key" />}
                        {column.name}
                        {sort.column === column.name && <Icon name={sort.dir === 'asc' ? 'arrow_upward' : 'arrow_downward'} />}
                      </button>
                    </th>
                  ))}
                  {discordColumn && <th />}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row) => (
                  <tr key={row.__rowid} onClick={() => setEditing(row)} tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && setEditing(row)}>
                    {table.columns.map((column) => (
                      <td key={column.name} className={typeof row[column.name] === 'number' ? 'is-number' : ''}>
                        {cell(row[column.name])}
                      </td>
                    ))}
                    {discordColumn && (
                      <td>
                        {/^\d{17,20}$/.test(row.discord_user_id) && (
                          <a className="hub-icon-button" href={userPageUrl(row.discord_user_id)} onClick={(event) => event.stopPropagation()} title="Discord page">
                            <Icon name="open_in_new" />
                          </a>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {editing && table && (
        <div className="hub-modal" role="dialog" aria-modal="true" onClick={(event) => event.target === event.currentTarget && setEditing(null)}>
          <RowEditor
            table={table}
            row={editing === 'new' ? null : editing}
            onCancel={() => setEditing(null)}
            onDone={() => {
              setEditing(null)
              setVersion((value) => value + 1)
            }}
          />
        </div>
      )}
    </div>
  )
}

/* ---------- files ---------- */

const bytes = (value) => (value == null ? '' : value >= 1048576 ? `${(value / 1048576).toFixed(1)} MB` : value >= 1024 ? `${Math.round(value / 1024)} KB` : `${value} B`)

function fileIcon(entry) {
  if (entry.dir) return 'folder'
  if (/\.json$/i.test(entry.name)) return 'data_object'
  if (/\.jsonl$/i.test(entry.name)) return 'receipt_long'
  if (/\.csv$/i.test(entry.name)) return 'table'
  if (/\.(png|jpe?g|webp|gif)$/i.test(entry.name)) return 'image'
  return entry.text ? 'description' : 'draft'
}

function Files({ onLocked }) {
  const [dir, setDir] = useState('')
  const { data, error } = useHubData('/hub/files', { dir }, { onLocked })
  const [file, setFile] = useState(null)
  const [text, setText] = useState('')
  const [state, setState] = useState({ error: null, saved: false, busy: false })

  const open = async (entry) => {
    if (entry.dir) {
      setDir(entry.path)
      setFile(null)
      return
    }
    setState({ error: null, saved: false, busy: true })
    try {
      const result = await hubGet('/hub/files/read', { path: entry.path })
      setFile(result)
      setText(result.text)
      setState({ error: null, saved: false, busy: false })
    } catch (openError) {
      setState({ error: openError, saved: false, busy: false })
    }
  }

  const jsonError = useMemo(() => {
    if (!file || !/\.json$/i.test(file.path)) return null
    try {
      JSON.parse(text)
      return null
    } catch (parseError) {
      return parseError.message
    }
  }, [file, text])

  async function save() {
    setState({ error: null, saved: false, busy: true })
    try {
      const result = await hubSend('/hub/files/write', { path: file.path, text, modifiedAt: file.modifiedAt })
      setFile(result)
      setText(result.text)
      setState({ error: null, saved: true, busy: false })
    } catch (saveError) {
      setState({ error: saveError, saved: false, busy: false })
    }
  }

  const crumbs = dir ? dir.split('/') : []
  const changed = file && text !== file.text
  const status = !file ? '' : file.readOnly ? 'Read only' : jsonError ? 'Invalid JSON' : changed ? 'Unsaved changes' : state.saved ? 'Saved' : 'No changes'

  return (
    <div className={`hub-split${file ? ' has-detail' : ''}`}>
      <div className="hub-split__list hub-files">
        <div className="hub-pathbar">
          <button type="button" className="hub-icon-button" title="Up one folder" disabled={!dir} onClick={() => setDir(crumbs.slice(0, -1).join('/'))}>
            <Icon name="arrow_upward" />
          </button>
          <nav className="hub-pathbar__crumbs" aria-label="Folder">
            <button type="button" onClick={() => setDir('')}>
              data
            </button>
            {crumbs.map((part, index) => (
              <span key={index}>
                <span className="hub-pathbar__sep">/</span>
                <button type="button" onClick={() => setDir(crumbs.slice(0, index + 1).join('/'))}>
                  {part}
                </button>
              </span>
            ))}
          </nav>
        </div>
        <ErrorNote error={error} />
        {data?.files.length ? (
          <table className="hub-filetable">
            <thead>
              <tr>
                <th>Name</th>
                <th className="hub-filetable__size">Size</th>
                <th className="hub-filetable__date">Changed</th>
              </tr>
            </thead>
            <tbody>
              {data.files.map((entry) => {
                const usable = entry.dir || entry.text
                return (
                  <tr
                    key={entry.path}
                    className={`${file?.path === entry.path ? 'is-active' : ''}${usable ? '' : ' is-disabled'}`}
                    onClick={() => usable && open(entry)}
                    onKeyDown={(event) => usable && event.key === 'Enter' && open(entry)}
                    tabIndex={usable ? 0 : -1}
                  >
                    <td>
                      <span className="hub-filetable__name">
                        <span className={`hub-fileicon${entry.dir ? ' is-dir' : ''}`}>
                          <Icon name={fileIcon(entry)} />
                        </span>
                        <span>{entry.name}</span>
                        {entry.readOnly && <span className="hub-badge">read only</span>}
                      </span>
                    </td>
                    <td className="hub-filetable__size">{entry.dir ? '' : bytes(entry.bytes)}</td>
                    <td className="hub-filetable__date">{timeAgo(entry.modifiedAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          data && <Empty icon="folder_off">This folder is empty.</Empty>
        )}
      </div>
      {file && (
        <div className="hub-split__detail hub-editor">
          <button type="button" className="hub-back" onClick={() => setFile(null)}>
            <Icon name="arrow_back" />
            {crumbs.length ? crumbs.at(-1) : 'data'}
          </button>
          <header className="hub-editor__head">
            <div>
              <h3>{file.path.split('/').pop()}</h3>
              <small className={jsonError ? 'is-bad' : changed ? 'is-changed' : ''}>
                {status}, {text.split('\n').length} lines
              </small>
            </div>
            <div className="hub-editor__actions">
              {/\.json$/i.test(file.path) && !file.readOnly && (
                <button type="button" className="hub-button hub-button--quiet" disabled={Boolean(jsonError)} onClick={() => setText(JSON.stringify(JSON.parse(text), null, 2))}>
                  Format
                </button>
              )}
              {changed && (
                <button type="button" className="hub-button hub-button--quiet" onClick={() => setText(file.text)}>
                  Undo
                </button>
              )}
              <button type="button" className="hub-button" disabled={file.readOnly || state.busy || Boolean(jsonError) || !changed} onClick={save}>
                Save
              </button>
            </div>
          </header>
          {jsonError && <p className="hub-error">{jsonError}</p>}
          {state.saved && <p className="hub-ok">Saved. The previous version is kept in db/backups/hub-edits.</p>}
          <ErrorNote error={state.error} />
          <textarea className="hub-editor__text" spellCheck={false} value={text} readOnly={file.readOnly} onChange={(event) => setText(event.target.value)} />
        </div>
      )}
    </div>
  )
}

/* ---------- tab ---------- */

const SECTIONS = [
  { id: 'users', icon: 'group', title: 'Users', Component: Users },
  { id: 'tables', icon: 'table_view', title: 'Tables', Component: Tables },
  { id: 'files', icon: 'folder_open', title: 'Data files', Component: Files },
]

export default function Database({ onLocked }) {
  const [section, setSection] = useState('users')
  const current = SECTIONS.find((entry) => entry.id === section)
  return (
    <div className="hub-database">
      <div className="hub-segment hub-segment--large" role="tablist">
        {SECTIONS.map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={section === entry.id} className={section === entry.id ? 'is-active' : ''} onClick={() => setSection(entry.id)}>
            <Icon name={entry.icon} />
            {entry.title}
          </button>
        ))}
      </div>
      <current.Component onLocked={onLocked} />
    </div>
  )
}
