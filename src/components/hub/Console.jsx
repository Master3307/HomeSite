import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import '@xterm/xterm/css/xterm.css'
import '/src/styles/nerd-font.css'

import { ACCOUNT_API_URL, hubGet, hubSend, terminalSocketUrl } from '/src/lib/hub'
import { Empty, ErrorNote, Icon } from './common'

/*
 * The server terminal (server/services/hubTerminal.cjs). A real pty with
 * xterm.js: colours, full-screen programs, mouse, 10 000 lines of
 * scrollback, proper paste (also bracketed paste), copy on Ctrl+Shift+C.
 *
 * Connection: WebSocket first; when that's blocked (some proxies, VPNs,
 * corporate networks) it switches to HTTP streaming by itself. Dropped
 * connections resume where they left off (the server buffers the output),
 * so a phone going to sleep or a network change doesn't lose anything.
 */

const FONT_KEY = 'hub.terminal.fontSize'
// JetBrains Mono with Nerd Font icons (self-hosted, scripts/update-fonts.mjs), so fancy prompts render.
const FONT = '"JetBrainsMono Nerd Font Mono", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace'
const THEME = {
  background: '#0d0717',
  foreground: '#ece8ff',
  cursor: '#b9a8ff',
  cursorAccent: '#0d0717',
  selectionBackground: '#7b6cff66',
  black: '#1b1229',
  red: '#ff6b81',
  green: '#6be0a4',
  yellow: '#f5c542',
  blue: '#7aa2ff',
  magenta: '#c792ea',
  cyan: '#5fd7ff',
  white: '#d8d4e8',
  brightBlack: '#6c6385',
  brightRed: '#ff8fa0',
  brightGreen: '#8ff0bd',
  brightYellow: '#ffd970',
  brightBlue: '#9fbcff',
  brightMagenta: '#ddb0ff',
  brightCyan: '#8be6ff',
  brightWhite: '#ffffff',
}

const KEYS = [
  { label: 'Esc', data: '\x1b' },
  { label: 'Tab', data: '\t' },
  { label: 'Ctrl', modifier: 'ctrl' },
  { label: 'Alt', modifier: 'alt' },
  { label: '↑', data: '\x1b[A' },
  { label: '↓', data: '\x1b[B' },
  { label: '←', data: '\x1b[D' },
  { label: '→', data: '\x1b[C' },
  { label: 'Home', data: '\x1b[H' },
  { label: 'End', data: '\x1b[F' },
  { label: '|', data: '|' },
  { label: '~', data: '~' },
  { label: '/', data: '/' },
  { label: '-', data: '-' },
  { label: '^C', data: '\x03' },
  { label: '^D', data: '\x04' },
  { label: '^Z', data: '\x1a' },
  { label: '^R', data: '\x12' },
]

const readFont = () => {
  try {
    return Number(localStorage.getItem(FONT_KEY)) || (window.innerWidth < 600 ? 12 : 14)
  } catch {
    return 14
  }
}

/* One connection to one session, WebSocket or HTTP. */
function connect(sessionId, { onOutput, onReset, onExit, onState, getOffset }) {
  let closed = false
  let socket = null
  let source = null
  let mode = 'ws'
  let wsFailures = 0
  let retry = null
  let pending = ''
  let flushTimer = null
  let lastSize = null

  const flushHttp = () => {
    flushTimer = null
    if (!pending) return
    const data = pending
    pending = ''
    hubSend(`/hub/terminal/${sessionId}/input`, { d: data }).catch(() => {})
  }

  const handle = (message) => {
    if (message.t === 'o') onOutput(message.d, message.o)
    else if (message.t === 'reset') onReset()
    else if (message.t === 'x') onExit(message.code)
  }

  function openSocket() {
    onState(mode === 'ws' ? 'connecting' : 'connecting-http')
    let opened = false
    socket = new WebSocket(terminalSocketUrl(sessionId, getOffset()))
    const timeout = setTimeout(() => !opened && socket.close(), 7000)
    socket.onopen = () => {
      opened = true
      wsFailures = 0
      clearTimeout(timeout)
      onState('ws')
      if (lastSize) socket.send(JSON.stringify({ t: 'r', c: lastSize.cols, r: lastSize.rows }))
    }
    socket.onmessage = (event) => {
      try {
        handle(JSON.parse(event.data))
      } catch {
        // ignore
      }
    }
    socket.onclose = () => {
      clearTimeout(timeout)
      socket = null
      if (closed) return
      if (!opened) wsFailures++
      // Two failed WebSocket attempts in a row: use HTTP instead.
      if (wsFailures >= 2) {
        mode = 'http'
        openStream()
      } else {
        onState('reconnecting')
        retry = setTimeout(openSocket, 1500)
      }
    }
  }

  function openStream() {
    onState('connecting-http')
    const url = `${ACCOUNT_API_URL}/hub/terminal/${sessionId}/stream?offset=${encodeURIComponent(getOffset() ?? '')}`
    source = new EventSource(url, { withCredentials: true })
    source.onopen = () => {
      onState('http')
      if (lastSize) hubSend(`/hub/terminal/${sessionId}/resize`, lastSize).catch(() => {})
    }
    source.onmessage = (event) => {
      try {
        handle(JSON.parse(event.data))
      } catch {
        // ignore
      }
    }
    source.onerror = () => {
      source.close()
      source = null
      if (closed) return
      onState('reconnecting')
      // Try WebSockets again now and then; the network may have changed.
      retry = setTimeout(() => {
        mode = 'ws'
        wsFailures = 1
        openSocket()
      }, 3000)
    }
  }

  openSocket()

  // Reconnect at once when the device comes back online or the tab is shown again.
  const wake = () => {
    if (closed || document.visibilityState === 'hidden') return
    if ((mode === 'ws' && !socket) || (mode === 'http' && !source)) {
      clearTimeout(retry)
      if (mode === 'ws') openSocket()
      else openStream()
    }
  }
  window.addEventListener('online', wake)
  document.addEventListener('visibilitychange', wake)

  return {
    send(data) {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: 'i', d: data }))
      else {
        pending += data
        if (!flushTimer) flushTimer = setTimeout(flushHttp, 25)
      }
    },
    resize(cols, rows) {
      lastSize = { cols, rows }
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: 'r', c: cols, r: rows }))
      else hubSend(`/hub/terminal/${sessionId}/resize`, lastSize).catch(() => {})
    },
    close() {
      closed = true
      clearTimeout(retry)
      clearTimeout(flushTimer)
      window.removeEventListener('online', wake)
      document.removeEventListener('visibilitychange', wake)
      socket?.close()
      source?.close()
    },
  }
}

const STATE_LABELS = {
  connecting: ['sync', 'Connecting…', 'warn'],
  'connecting-http': ['sync', 'Connecting (HTTP)…', 'warn'],
  ws: ['bolt', 'Live · WebSocket', 'ok'],
  http: ['swap_vert', 'Live · HTTP fallback', 'ok'],
  reconnecting: ['wifi_off', 'Reconnecting…', 'warn'],
  exited: ['power_settings_new', 'Ended', 'muted'],
}

function TerminalView({ session, active, fontSize, onTitle, onExited }) {
  const box = useRef(null)
  const termRef = useRef(null)
  const linkRef = useRef(null)
  const offsetRef = useRef(null)
  const modifier = useRef(null)
  const [state, setState] = useState('connecting')
  const [mod, setMod] = useState(null)

  useEffect(() => {
    const term = new Terminal({
      fontFamily: FONT,
      fontSize,
      lineHeight: 1.15,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 10_000,
      allowProposedApi: true,
      macOptionIsMeta: true,
      rightClickSelectsWord: true,
      smoothScrollDuration: 80,
      theme: THEME,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    const unicode = new Unicode11Addon()
    term.loadAddon(unicode)
    term.unicode.activeVersion = '11'
    term.open(box.current)
    termRef.current = { term, fit }

    // Ctrl+Shift+C copies, Ctrl+Shift+V pastes (Ctrl+C stays an interrupt).
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      const key = event.key.toLowerCase()
      if (event.ctrlKey && event.shiftKey && key === 'c') {
        const selection = term.getSelection()
        if (selection) navigator.clipboard?.writeText(selection).catch(() => {})
        return false
      }
      if (event.ctrlKey && event.shiftKey && key === 'v') {
        navigator.clipboard
          ?.readText()
          .then((text) => text && term.paste(text))
          .catch(() => {})
        return false
      }
      return true
    })

    const link = connect(session.id, {
      onOutput: (data, offset) => {
        term.write(data)
        offsetRef.current = offset
      },
      onReset: () => term.reset(),
      onExit: () => {
        setState('exited')
        onExited(session.id)
      },
      onState: (next) => setState((current) => (current === 'exited' ? current : next)),
      getOffset: () => offsetRef.current,
    })
    linkRef.current = link

    term.onData((data) => {
      let out = data
      // Sticky Ctrl/Alt from the mobile key bar.
      if (modifier.current === 'ctrl' && data.length === 1) {
        const code = data.toUpperCase().charCodeAt(0)
        if (code >= 64 && code <= 95) out = String.fromCharCode(code - 64)
      } else if (modifier.current === 'alt' && data.length === 1) out = `\x1b${data}`
      if (modifier.current) {
        modifier.current = null
        setMod(null)
      }
      link.send(out)
    })
    term.onTitleChange((title) => onTitle(session.id, title))

    // xterm measures the font once; measure again when the web font arrives.
    document.fonts
      ?.load(`${fontSize}px "JetBrainsMono Nerd Font Mono"`)
      .then(() => {
        term.options.fontFamily = FONT
        try {
          fit.fit()
          link.resize(term.cols, term.rows)
        } catch {
          // not visible yet
        }
      })
      .catch(() => {})

    let resizeTimer = null
    const doFit = () => {
      if (!box.current?.offsetWidth) return
      try {
        fit.fit()
      } catch {
        return
      }
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => link.resize(term.cols, term.rows), 120)
    }
    const observer = new ResizeObserver(doFit)
    observer.observe(box.current)
    doFit()

    return () => {
      observer.disconnect()
      clearTimeout(resizeTimer)
      link.close()
      term.dispose()
    }
    // One terminal per session; font size is updated separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  useEffect(() => {
    const current = termRef.current
    if (!current) return
    current.term.options.fontSize = fontSize
    try {
      current.fit.fit()
      linkRef.current?.resize(current.term.cols, current.term.rows)
    } catch {
      // not visible
    }
  }, [fontSize])

  useEffect(() => {
    if (!active || !termRef.current) return
    requestAnimationFrame(() => {
      try {
        termRef.current.fit.fit()
      } catch {
        // ignore
      }
      termRef.current.term.focus()
    })
  }, [active])

  const sendKey = (key) => {
    const term = termRef.current?.term
    if (!term) return
    if (key.modifier) {
      const next = modifier.current === key.modifier ? null : key.modifier
      modifier.current = next
      setMod(next)
    } else {
      linkRef.current?.send(key.data)
    }
    term.focus()
  }

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) termRef.current?.term.paste(text)
    } catch {
      const text = window.prompt('Paste here (your browser blocks clipboard access):')
      if (text) termRef.current?.term.paste(text)
    }
    termRef.current?.term.focus()
  }

  const copy = () => {
    const selection = termRef.current?.term.getSelection()
    if (selection) navigator.clipboard?.writeText(selection).catch(() => {})
  }

  const [icon, label, tone] = STATE_LABELS[state] ?? STATE_LABELS.connecting

  return (
    <div className={`hub-term${active ? ' is-active' : ''}`} hidden={!active}>
      <div className="hub-term__bar">
        <span className={`hub-term__state hub-tone--${tone}`}>
          <Icon name={icon} />
          <span className="hub-term__label">{label}</span>
        </span>
        <span className="hub-term__tools">
          <button type="button" className="hub-icon-button" title="Copy selection (Ctrl+Shift+C)" onClick={copy}>
            <Icon name="content_copy" />
          </button>
          <button type="button" className="hub-icon-button" title="Paste (Ctrl+Shift+V)" onClick={paste}>
            <Icon name="content_paste" />
          </button>
          <button type="button" className="hub-icon-button" title="Scroll up a page" onClick={() => termRef.current?.term.scrollPages(-1)}>
            <Icon name="keyboard_double_arrow_up" />
          </button>
          <button type="button" className="hub-icon-button" title="Scroll down a page" onClick={() => termRef.current?.term.scrollPages(1)}>
            <Icon name="keyboard_double_arrow_down" />
          </button>
          <button type="button" className="hub-icon-button" title="Jump to the end" onClick={() => termRef.current?.term.scrollToBottom()}>
            <Icon name="vertical_align_bottom" />
          </button>
          <button type="button" className="hub-icon-button" title="Clear screen" onClick={() => termRef.current?.term.clear()}>
            <Icon name="mop" />
          </button>
        </span>
      </div>
      <div className="hub-term__screen" ref={box} />
      <div className="hub-term__keys" role="toolbar" aria-label="Special keys">
        {KEYS.map((key) => (
          <button
            key={key.label}
            type="button"
            className={key.modifier && mod === key.modifier ? 'is-active' : ''}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => sendKey(key)}
          >
            {key.label}
          </button>
        ))}
        <button type="button" onPointerDown={(event) => event.preventDefault()} onClick={paste}>
          Paste
        </button>
      </div>
    </div>
  )
}

export default function Console({ onLocked }) {
  const [info, setInfo] = useState(null)
  const [error, setError] = useState(null)
  const [activeId, setActiveId] = useState(null)
  const [titles, setTitles] = useState({})
  const [fontSize, setFontSize] = useState(readFont)
  const [fullscreen, setFullscreen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const data = await hubGet('/hub/terminal/sessions')
      setInfo(data)
      setActiveId((current) => (current && data.sessions.some((entry) => entry.id === current) ? current : (data.sessions.find((entry) => !entry.exited)?.id ?? data.sessions[0]?.id ?? null)))
    } catch (loadError) {
      if (loadError.locked) onLocked?.()
      setError(loadError)
    }
  }, [onLocked])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    try {
      localStorage.setItem(FONT_KEY, String(fontSize))
    } catch {
      // ignore
    }
  }, [fontSize])

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (event) => event.key === 'Escape' && event.shiftKey && setFullscreen(false)
    document.addEventListener('keydown', onKey)
    document.body.classList.add('hub-no-scroll')
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.classList.remove('hub-no-scroll')
    }
  }, [fullscreen])

  async function create() {
    setError(null)
    try {
      const session = await hubSend('/hub/terminal/sessions', { cols: 120, rows: 32 })
      setInfo((current) => ({ ...current, sessions: [...(current?.sessions ?? []), session] }))
      setActiveId(session.id)
    } catch (createError) {
      if (createError.locked) onLocked?.()
      setError(createError)
    }
  }

  async function close(id) {
    await hubSend(`/hub/terminal/${id}/close`).catch(() => {})
    setInfo((current) => {
      const sessions = current.sessions.filter((entry) => entry.id !== id)
      if (activeId === id) setActiveId(sessions.at(-1)?.id ?? null)
      return { ...current, sessions }
    })
  }

  const onTitle = useCallback((id, title) => setTitles((current) => ({ ...current, [id]: title })), [])
  const onExited = useCallback((id) => setInfo((current) => current && { ...current, sessions: current.sessions.map((entry) => (entry.id === id ? { ...entry, exited: true } : entry)) }), [])

  if (!info) return error ? <ErrorNote error={error} /> : <div className="hub-loading">Loading terminals…</div>

  if (!info.enabled) {
    return (
      <Empty icon="terminal">
        The terminal is off. Turn on <code>HUB_TERMINAL</code> in the Settings tab (Security), then restart the account API (<code>pnpm accounts</code>).
      </Empty>
    )
  }

  return (
    <div className={`hub-console${fullscreen ? ' is-fullscreen' : ''}`}>
      <div className="hub-console__tabs" role="tablist">
        {info.sessions.map((session, index) => (
          <div key={session.id} role="tab" aria-selected={session.id === activeId} className={`hub-console__tab${session.id === activeId ? ' is-active' : ''}${session.exited ? ' is-exited' : ''}`}>
            <button type="button" onClick={() => setActiveId(session.id)}>
              <Icon name={session.exited ? 'power_settings_new' : 'terminal'} />
              <span>{titles[session.id] || session.title || `Terminal ${index + 1}`}</span>
            </button>
            <button type="button" className="hub-console__close" title="Close (ends the shell)" onClick={() => close(session.id)}>
              <Icon name="close" />
            </button>
          </div>
        ))}
        <button type="button" className="hub-console__new" title="New terminal" onClick={create}>
          <Icon name="add" />
        </button>
        <span className="hub-console__spacer" />
        <button type="button" className="hub-icon-button" title="Smaller text" onClick={() => setFontSize((value) => Math.max(9, value - 1))}>
          <Icon name="text_decrease" />
        </button>
        <button type="button" className="hub-icon-button" title="Larger text" onClick={() => setFontSize((value) => Math.min(24, value + 1))}>
          <Icon name="text_increase" />
        </button>
        <button type="button" className="hub-icon-button" title={fullscreen ? 'Exit full screen (Shift+Esc)' : 'Full screen'} onClick={() => setFullscreen((value) => !value)}>
          <Icon name={fullscreen ? 'close_fullscreen' : 'open_in_full'} />
        </button>
      </div>

      <ErrorNote error={error} />

      {info.sessions.length ? (
        info.sessions.map((session) => (
          <TerminalView key={session.id} session={session} active={session.id === activeId} fontSize={fontSize} onTitle={onTitle} onExited={onExited} />
        ))
      ) : (
        <div className="hub-console__start">
          <Empty icon="terminal">
            A shell on the server ({info.backend === 'python' ? 'full terminal' : `${info.backend} mode, no resizing`}). It keeps running for 30 minutes after you leave, so you can come back to it.
          </Empty>
          <button type="button" className="hub-button" onClick={create}>
            <Icon name="add" />
            Open a terminal
          </button>
        </div>
      )}
    </div>
  )
}
