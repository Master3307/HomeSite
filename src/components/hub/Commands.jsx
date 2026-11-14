import { useEffect, useMemo, useRef, useState } from 'react'

import { hubSend } from '/src/lib/hub'
import { Card, DiscordMarkup, Empty, ErrorNote, Icon, Picker, formatTime, useDebounced, useHubData } from './common'

/*
 * Run the bot's slash and prefix commands from the hub, as the owner, in a
 * channel of your choice. Public replies are posted there; ephemeral ones
 * only show up here.
 */

const CHANNEL_KEY = 'hub.commands.channel'

const readChannel = () => {
  try {
    return localStorage.getItem(CHANNEL_KEY) || ''
  } catch {
    return ''
  }
}

function OptionField({ option, value, onChange, command, variant, values, channelId }) {
  const id = `opt-${option.name}`
  const [suggestions, setSuggestions] = useState([])
  const focusedText = useDebounced(option.autocomplete ? String(value ?? '') : '', 200)

  const valuesRef = useRef(values)
  valuesRef.current = values
  const { name: commandName, hasAutocomplete } = command
  const { group, sub } = variant

  useEffect(() => {
    if (!option.autocomplete || !hasAutocomplete) return
    let alive = true
    hubSend('/hub/commands/autocomplete', { name: commandName, group, sub, options: { ...valuesRef.current, [option.name]: focusedText }, focused: option.name, channelId })
      .then((data) => alive && setSuggestions(data.choices ?? []))
      .catch(() => alive && setSuggestions([]))
    return () => {
      alive = false
    }
  }, [focusedText, option.name, option.autocomplete, hasAutocomplete, commandName, group, sub, channelId])

  let control
  if (option.choices?.length) {
    control = (
      <select id={id} value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
        <option value="">{option.required ? 'Choose…' : '—'}</option>
        {option.choices.map((choice) => (
          <option key={String(choice.value)} value={choice.value}>
            {choice.name}
          </option>
        ))}
      </select>
    )
  } else if (option.type === 'boolean') {
    control = (
      <div className="hub-segment" role="radiogroup">
        {[
          ['', '—'],
          ['true', 'True'],
          ['false', 'False'],
        ].map(([key, label]) => (
          <button key={key} type="button" role="radio" aria-checked={String(value ?? '') === key} className={String(value ?? '') === key ? 'is-active' : ''} onClick={() => onChange(key)}>
            {label}
          </button>
        ))}
      </div>
    )
  } else if (option.type === 'user' || option.type === 'mentionable') {
    control = <Picker id={id} kind="user" value={value} onChange={(next) => onChange(next)} />
  } else if (option.type === 'channel') {
    control = <Picker id={id} kind="channel" value={value} onChange={(next) => onChange(next)} />
  } else if (option.type === 'role') {
    control = <Picker id={id} kind="role" value={value} onChange={(next) => onChange(next)} />
  } else {
    control = (
      <>
        <input
          id={id}
          type={option.type === 'integer' || option.type === 'number' ? 'number' : option.type === 'attachment' ? 'url' : 'text'}
          step={option.type === 'number' ? 'any' : undefined}
          min={option.type !== 'string' ? (option.min ?? undefined) : undefined}
          max={option.type !== 'string' ? (option.max ?? undefined) : undefined}
          maxLength={option.type === 'string' ? (option.max ?? undefined) : undefined}
          placeholder={option.type === 'attachment' ? 'https://… (file URL)' : option.description}
          value={value ?? ''}
          list={suggestions.length ? `${id}-list` : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        {suggestions.length > 0 && (
          <datalist id={`${id}-list`}>
            {suggestions.map((choice) => (
              <option key={String(choice.value)} value={choice.value}>
                {choice.name}
              </option>
            ))}
          </datalist>
        )}
      </>
    )
  }

  return (
    <div className="hub-option">
      <label htmlFor={id}>
        <span className="hub-option__name">{option.name}</span>
        {option.required && <span className="hub-option__required">required</span>}
        <small>{option.type}</small>
      </label>
      {control}
      {option.description && <p>{option.description}</p>}
    </div>
  )
}

function Embed({ embed }) {
  const color = embed.color != null ? `#${Number(embed.color).toString(16).padStart(6, '0')}` : 'var(--hub-border)'
  return (
    <div className="hub-embed" style={{ '--embed': color }}>
      {embed.author?.name && <div className="hub-embed__author">{embed.author.name}</div>}
      {embed.title && <div className="hub-embed__title">{embed.title}</div>}
      {embed.description && (
        <div className="hub-embed__text">
          <DiscordMarkup text={embed.description} />
        </div>
      )}
      {embed.fields?.length > 0 && (
        <div className="hub-embed__fields">
          {embed.fields.map((field, index) => (
            <div key={index} className={field.inline ? 'is-inline' : ''}>
              <strong>{field.name}</strong>
              <div>
                <DiscordMarkup text={field.value} />
              </div>
            </div>
          ))}
        </div>
      )}
      {embed.image?.url && <img src={embed.image.url} alt="" loading="lazy" />}
      {embed.thumbnail?.url && <img className="hub-embed__thumb" src={embed.thumbnail.url} alt="" loading="lazy" />}
      {embed.footer?.text && <div className="hub-embed__footer">{embed.footer.text}</div>}
    </div>
  )
}

function Output({ run }) {
  return (
    <li className={`hub-run${run.result?.ok === false || run.error ? ' is-failed' : ''}`}>
      <header>
        <span className="hub-run__cmd">{run.label}</span>
        <small>
          {formatTime(run.at)}
          {run.result?.ms != null && ` · ${run.result.ms} ms`}
        </small>
      </header>
      {run.pending && <p className="hub-run__note">Running…</p>}
      {run.error && <ErrorNote error={run.error} />}
      {run.result?.error && <ErrorNote error={{ message: run.result.error }} />}
      {run.result?.output?.map((message, index) => (
        <div key={index} className={`hub-message${message.ephemeral ? ' is-ephemeral' : ''}`}>
          <div className="hub-message__meta">
            {message.ephemeral ? (
              <span>Only visible to you</span>
            ) : (
              <span>Posted in Discord</span>
            )}
            {message.url && (
              <a href={message.url} target="_blank" rel="noopener noreferrer">
                Open message
              </a>
            )}
          </div>
          {message.thinking && <p className="hub-run__note">Bot is thinking…</p>}
          {message.content && (
            <div className="hub-message__content">
              <DiscordMarkup text={message.content} />
            </div>
          )}
          {message.embeds?.map((embed, embedIndex) => (
            <Embed key={embedIndex} embed={embed} />
          ))}
          {message.components?.length > 0 && (
            <div className="hub-message__components">
              {message.components.flatMap((row) => row.components ?? []).map((component, componentIndex) => (
                <span key={componentIndex} className="hub-component" title="Buttons and menus only work in Discord">
                  {component.label ?? component.placeholder ?? component.custom_id ?? 'Component'}
                </span>
              ))}
            </div>
          )}
          {message.files?.length > 0 && <small className="hub-run__note">Files: {message.files.join(', ')}</small>}
        </div>
      ))}
      {run.result?.ok && !run.result.output?.length && <p className="hub-run__note">Done. The command sent no reply.</p>}
    </li>
  )
}

export default function Commands({ onLocked }) {
  const { data, error } = useHubData('/hub/commands', null, { onLocked })
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState(null)
  const [variantIndex, setVariantIndex] = useState(0)
  const [values, setValues] = useState({})
  const [args, setArgs] = useState('')
  const [channelId, setChannelId] = useState(readChannel)
  const [runs, setRuns] = useState([])

  useEffect(() => {
    try {
      localStorage.setItem(CHANNEL_KEY, channelId)
    } catch {
      // ignore
    }
  }, [channelId])

  const commands = useMemo(() => {
    const needle = filter.trim().toLowerCase().replace(/^[/!]/, '')
    return (data?.commands ?? []).filter((command) => !needle || `${command.name} ${command.description}`.toLowerCase().includes(needle))
  }, [data, filter])

  const command = data?.commands.find((entry) => entry.kind === selected?.kind && entry.name === selected?.name)
  const variant = command?.kind === 'slash' ? command.variants[variantIndex] : null

  const pick = (entry) => {
    setSelected({ kind: entry.kind, name: entry.name })
    setVariantIndex(0)
    setValues({})
    setArgs('')
  }

  async function run(event) {
    event.preventDefault()
    if (!command) return
    const label =
      command.kind === 'prefix'
        ? `${data.prefix}${command.name} ${args}`.trim()
        : `/${[command.name, variant.group, variant.sub].filter(Boolean).join(' ')} ${Object.entries(values)
            .filter(([, value]) => value !== '' && value != null)
            .map(([name, value]) => `${name}:${value}`)
            .join(' ')}`.trim()
    const id = Date.now()
    setRuns((list) => [{ id, label, at: new Date().toISOString(), pending: true }, ...list].slice(0, 30))
    try {
      const result = await hubSend(
        '/hub/commands/run',
        command.kind === 'prefix'
          ? { kind: 'prefix', name: command.name, args, channelId }
          : { kind: 'slash', name: command.name, group: variant.group, sub: variant.sub, options: values, channelId },
      )
      setRuns((list) => list.map((entry) => (entry.id === id ? { ...entry, pending: false, result } : entry)))
    } catch (runError) {
      if (runError.locked) onLocked?.()
      setRuns((list) => list.map((entry) => (entry.id === id ? { ...entry, pending: false, error: runError } : entry)))
    }
  }

  return (
    <div className={`hub-commands${command ? ' has-selection' : ''}`}>
      <aside className="hub-commands__list">
        <label className="hub-search">
          <Icon name="search" />
          <input type="search" placeholder="Find a command…" value={filter} onChange={(event) => setFilter(event.target.value)} />
        </label>
        <ErrorNote error={error} />
        <ul>
          {commands.map((entry) => (
            <li key={`${entry.kind}:${entry.name}`}>
              <button type="button" className={`hub-command${selected?.name === entry.name && selected?.kind === entry.kind ? ' is-active' : ''}`} onClick={() => pick(entry)}>
                <span className="hub-command__name">
                  {entry.kind === 'slash' ? '/' : data.prefix}
                  {entry.name}
                </span>
                <small>{entry.description}</small>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="hub-commands__main">
        {command && (
          <button type="button" className="hub-back" onClick={() => setSelected(null)}>
            <Icon name="arrow_back" />
            All commands
          </button>
        )}
        <Card title="Channel">
          <div className="hub-runin">
            <Picker kind="channel" value={channelId} onChange={(next) => setChannelId(next)} placeholder="Pick a channel" />
            <p>Commands run as you. Replies everyone can see go to this channel; private replies only show up here.</p>
          </div>
        </Card>

        {command ? (
          <Card title={`${command.kind === 'slash' ? '/' : data.prefix}${command.name}`} className="hub-card--command">
            <form className="hub-command-form" onSubmit={run}>
              <p className="hub-command-form__text">{variant?.description || command.description}</p>
              {command.kind === 'slash' && command.variants.length > 1 && (
                <div className="hub-chips">
                  {command.variants.map((entry, index) => (
                    <button
                      key={`${entry.group}-${entry.sub}`}
                      type="button"
                      className={`hub-chip${index === variantIndex ? ' is-active' : ''}`}
                      onClick={() => {
                        setVariantIndex(index)
                        setValues({})
                      }}
                    >
                      {[entry.group, entry.sub].filter(Boolean).join(' ')}
                    </button>
                  ))}
                </div>
              )}
              {command.kind === 'slash' ? (
                variant.options.length ? (
                  <div className="hub-options">
                    {variant.options.map((option) => (
                      <OptionField
                        key={option.name}
                        option={option}
                        value={values[option.name]}
                        values={values}
                        command={command}
                        variant={variant}
                        channelId={channelId}
                        onChange={(next) => setValues((current) => ({ ...current, [option.name]: next }))}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="hub-run__note">No options.</p>
                )
              ) : (
                <div className="hub-option">
                  <label htmlFor="prefix-args">
                    <span className="hub-option__name">arguments</span>
                    {command.args && <span className="hub-option__required">required</span>}
                  </label>
                  <input id="prefix-args" placeholder={command.usage || 'arguments…'} value={args} onChange={(event) => setArgs(event.target.value)} />
                </div>
              )}
              <div className="hub-command-form__actions">
                {!channelId && <small>Without a channel, only private replies work.</small>}
                <button type="submit" className="hub-button">
                  <Icon name="send" />
                  Run
                </button>
              </div>
            </form>
          </Card>
        ) : (
          <Empty icon="terminal">Pick a command to run it.</Empty>
        )}

        {runs.length > 0 && (
          <Card
            title="Results"
            actions={
              <button type="button" className="hub-link-button" onClick={() => setRuns([])}>
                Clear
              </button>
            }
          >
            <ol className="hub-runs">
              {runs.map((entry) => (
                <Output key={entry.id} run={entry} />
              ))}
            </ol>
          </Card>
        )}
      </div>
    </div>
  )
}
