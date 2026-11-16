import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import '@xterm/xterm/css/xterm.css'
import '/src/styles/nerd-font.css'

import { ACCOUNT_API_URL, hubGet, hubSend, terminalSocketUrl } from '/src/lib/hub'
import { copyText, Empty, ErrorNote, Icon } from './common'

/*
 * The server terminal (server/services/hubTerminal.cjs). A real pty with
 * xterm.js: colours, full-screen programs, mouse, 10 000 lines of
 * scrollback, proper paste (also bracketed paste), copy on Ctrl+Shift+C.
 *
 * Connection: WebSocket first; when that's blocked (some proxies, VPNs,
 * corporate networks) it switches to HTTP streaming by itself. Dropped
 * connections resume where they left off (the server buffers the output),
 * so a phone going to sleep or a network change doesn't lose anything.
 *
 * Phones: one finger scrolls (also inside less/htop/vim), two fingers change
 * the text size, a tap opens the keyboard. Typing goes through a normal text
 * field under the terminal (sent live, letter by letter), so the keyboard's
 * suggestions, autocorrect, swipe and voice typing work; full screen then
 * ends right above the keyboard. "Show as text" makes the output selectable.
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

/*
 * The key bar under the terminal (phones and tablets). `seq` keys can depend
 * on the terminal's mode (arrow keys in "application" mode send ESC O x), and
 * `repeat` keys repeat while held.
 */
const arrow = (letter) => (term) => (term?.modes.applicationCursorKeysMode ? `\x1bO${letter}` : `\x1b[${letter}`)
const KEYS = [
  { label: 'Esc', data: '\x1b' },
  { label: 'Tab', data: '\t' },
  { label: 'Ctrl', modifier: 'ctrl' },
  { label: 'Alt', modifier: 'alt' },
  { label: '↑', title: 'Up', seq: arrow('A'), repeat: true },
  { label: '↓', title: 'Down', seq: arrow('B'), repeat: true },
  { label: '←', title: 'Left', seq: arrow('D'), repeat: true },
  { label: '→', title: 'Right', seq: arrow('C'), repeat: true },
  { label: '⌫', title: 'Backspace', data: '\x7f', repeat: true },
  { label: '^C', title: 'Ctrl+C (stop)', data: '\x03' },
  { label: '^D', title: 'Ctrl+D (end input)', data: '\x04' },
  { label: '^Z', title: 'Ctrl+Z (suspend)', data: '\x1a' },
  { label: '^R', title: 'Ctrl+R (search history)', data: '\x12' },
  { label: '^L', title: 'Ctrl+L (clear)', data: '\x0c' },
  { label: 'Home', data: '\x1b[H' },
  { label: 'End', data: '\x1b[F' },
  { label: 'PgUp', data: '\x1b[5~' },
  { label: 'PgDn', data: '\x1b[6~' },
  { label: '|', data: '|' },
  { label: '~', data: '~' },
  { label: '/', data: '/' },
  { label: '-', data: '-' },
  { label: '&', data: '&' },
  { label: '>', data: '>' },
]

const INPUT_KEY = 'hub.terminal.input'
const touchDevice = () => window.matchMedia?.('(pointer: coarse)').matches ?? false
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('motion-reduce') || document.documentElement.classList.contains('motion-none')

const readFont = () => {
  try {
    return Number(localStorage.getItem(FONT_KEY)) || (window.innerWidth < 600 ? 12 : 14)
  } catch {
    return 14
  }
}

/* "line": the typing field under the terminal (phones: keyboard suggestions, swipe typing, autocorrect); "direct": keys straight into the terminal. */
const readInputMode = () => {
  try {
    const saved = localStorage.getItem(INPUT_KEY)
    if (saved === 'line' || saved === 'direct') return saved
  } catch {
    // ignore
  }
  return touchDevice() ? 'line' : 'direct'
}

/* Ctrl+letter → its control character (Ctrl+C → \x03). */
const ctrlChar = (char) => {
  const code = char.toUpperCase().charCodeAt(0)
  return code >= 64 && code <= 95 ? String.fromCharCode(code - 64) : char === ' ' ? '\x00' : char
}

/* Everything in the terminal's buffer as plain text (for the text view). */
function bufferText(term, limit = 5000) {
  const buffer = term.buffer.active
  const lines = []
  const start = Math.max(0, buffer.length - limit)
  for (let index = start; index < buffer.length; index++) {
    const line = buffer.getLine(index)
    if (!line) continue
    const text = line.translateToString(true)
    // Wrapped lines continue the one before.
    if (line.isWrapped && lines.length) lines[lines.length - 1] += text
    else lines.push(text)
  }
  while (lines.length && !lines.at(-1).trim()) lines.pop()
  return lines.join('\n')
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

/* The output as plain text, so it can be selected and copied the normal way (phones can't select in a canvas). */
function TextView({ text, onClose }) {
  const preRef = useRef(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    // Start at the end, like the terminal.
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight
    const onKey = (event) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const copySelection = async () => {
    const selection = window.getSelection()?.toString()
    if (await copyText(selection || text)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    }
  }

  return (
    <div className="hub-term__text" role="dialog" aria-modal="true" aria-label="Terminal text">
      <div className="hub-term__text-bar">
        <span>Select text, then copy</span>
        <button type="button" className="hub-icon-button" title="Copy the selection (or everything)" onClick={copySelection}>
          <Icon name={copied ? 'check' : 'content_copy'} />
        </button>
        <button type="button" className="hub-icon-button" title="Back to the terminal" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <pre ref={preRef} tabIndex={0}>
        {text || ' '}
      </pre>
    </div>
  )
}

function TerminalView({ session, active, fontSize, setFontSize, inputMode, onTyping, onTitle, onExited }) {
  const box = useRef(null)
  const termRef = useRef(null)
  const linkRef = useRef(null)
  const offsetRef = useRef(null)
  const inputRef = useRef(null)
  const modifier = useRef(null)
  const modeRef = useRef(inputMode)
  const fontRef = useRef(fontSize)
  // What the typing field has already sent since the last Enter / special key.
  const sentRef = useRef('')
  const [state, setState] = useState('connecting')
  const [mod, setMod] = useState(null)
  const [textView, setTextView] = useState(null)
  const [scrolledUp, setScrolledUp] = useState(false)
  modeRef.current = inputMode
  fontRef.current = fontSize

  const setModifier = (next) => {
    modifier.current = next
    setMod(next)
  }

  /* Where keystrokes go after a button press: the typing field or the terminal itself. */
  const refocus = useCallback(() => {
    if (modeRef.current === 'line') inputRef.current?.focus({ preventScroll: true })
    else termRef.current?.term.focus()
  }, [])

  useEffect(() => {
    const term = new Terminal({
      fontFamily: FONT,
      fontSize,
      lineHeight: 1.15,
      cursorBlink: true,
      cursorStyle: 'bar',
      // The typing field has the focus on phones; the cursor stays a bar instead of an outline.
      cursorInactiveStyle: 'bar',
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
      // Sticky Ctrl/Alt from the key bar.
      if (modifier.current === 'ctrl' && data.length === 1) out = ctrlChar(data)
      else if (modifier.current === 'alt' && data.length === 1) out = `\x1b${data}`
      if (modifier.current) setModifier(null)
      link.send(out)
    })
    term.onTitleChange((title) => onTitle(session.id, title))
    // "Back to the end" shows while you read older output.
    term.onScroll(() => {
      const buffer = term.buffer.active
      setScrolledUp(buffer.viewportY < buffer.baseY)
    })
    term.onWriteParsed(() => {
      const buffer = term.buffer.active
      setScrolledUp(buffer.viewportY < buffer.baseY)
    })

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

    /*
     * Touch: xterm.js has no touch scrolling of its own. One finger scrolls
     * (with momentum): the scrollback normally, and in full-screen programs
     * (less, htop, vim) it is passed on the way a mouse wheel would be. Two
     * fingers change the text size. A tap opens the keyboard.
     */
    const screen = box.current
    const cellHeight = () => {
      const rows = term.element?.querySelector('.xterm-screen')
      return rows?.clientHeight && term.rows ? rows.clientHeight / term.rows : fontRef.current * 1.15
    }
    const scrollBy = (lines, clientY) => {
      if (!lines) return
      const buffer = term.buffer.active
      if (buffer.type === 'normal') {
        term.scrollLines(lines)
        return
      }
      if (term.modes.mouseTrackingMode !== 'none') {
        // The program wants mouse events: a wheel event lets xterm encode it.
        const rect = screen.getBoundingClientRect()
        term.element?.dispatchEvent(
          new WheelEvent('wheel', { deltaY: lines * cellHeight(), deltaMode: 0, clientX: rect.left + rect.width / 2, clientY: clientY ?? rect.top + rect.height / 2, bubbles: true, cancelable: true }),
        )
        return
      }
      const up = lines < 0
      link.send((up ? arrow('A') : arrow('B'))(term).repeat(Math.min(Math.abs(lines), 50)))
    }

    let touch = null
    let glide = 0
    const stopGlide = () => {
      cancelAnimationFrame(glide)
      glide = 0
    }
    const distance = (touches) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)

    const onTouchStart = (event) => {
      stopGlide()
      if (event.touches.length === 2) {
        touch = { pinch: distance(event.touches), font: fontRef.current, moved: true }
        return
      }
      if (event.touches.length !== 1) return
      const point = event.touches[0]
      touch = { startY: point.clientY, startX: point.clientX, lastY: point.clientY, lastTime: performance.now(), velocity: 0, rest: 0, moved: false }
    }
    const onTouchMove = (event) => {
      if (!touch) return
      if (touch.pinch && event.touches.length === 2) {
        event.preventDefault()
        const next = Math.round(touch.font * (distance(event.touches) / touch.pinch))
        setFontSize(Math.min(24, Math.max(8, next)))
        return
      }
      if (event.touches.length !== 1 || touch.pinch) return
      const point = event.touches[0]
      if (!touch.moved && Math.abs(point.clientY - touch.startY) < 8 && Math.abs(point.clientX - touch.startX) < 8) return
      touch.moved = true
      event.preventDefault()
      const now = performance.now()
      const dy = touch.lastY - point.clientY
      const dt = Math.max(1, now - touch.lastTime)
      // Smoothed speed in px/ms for the glide afterwards.
      touch.velocity = touch.velocity * 0.6 + (dy / dt) * 0.4
      touch.lastY = point.clientY
      touch.lastTime = now
      touch.rest += dy
      const height = cellHeight()
      const lines = Math.trunc(touch.rest / height)
      if (lines) {
        touch.rest -= lines * height
        scrollBy(lines, point.clientY)
      }
    }
    const onTouchEnd = (event) => {
      if (!touch) return
      const ended = touch
      if (event.touches.length) return
      touch = null
      if (!ended.moved) {
        // A tap: our own focus (no xterm mouse emulation, which would steal the focus from the typing field).
        if (event.cancelable) event.preventDefault()
        if (modeRef.current === 'line') inputRef.current?.focus({ preventScroll: true })
        else term.focus()
        return
      }
      if (ended.pinch || reducedMotion() || performance.now() - ended.lastTime > 80) return
      let velocity = ended.velocity
      let rest = ended.rest
      let last = performance.now()
      const step = (now) => {
        const dt = now - last
        last = now
        velocity *= Math.pow(0.95, dt / 16)
        if (Math.abs(velocity) < 0.02) {
          glide = 0
          return
        }
        rest += velocity * dt
        const height = cellHeight()
        const lines = Math.trunc(rest / height)
        if (lines) {
          rest -= lines * height
          scrollBy(lines)
        }
        glide = requestAnimationFrame(step)
      }
      glide = requestAnimationFrame(step)
    }
    // Mouse in typing-field mode: a click (not a selection) goes back to the field.
    const onClick = () => {
      if (modeRef.current === 'line' && !term.hasSelection()) inputRef.current?.focus({ preventScroll: true })
    }
    screen.addEventListener('click', onClick)
    // Capture, so xterm doesn't also turn the touches into mouse selections.
    screen.addEventListener('touchstart', onTouchStart, { passive: true, capture: true })
    screen.addEventListener('touchmove', onTouchMove, { passive: false, capture: true })
    screen.addEventListener('touchend', onTouchEnd, { passive: false, capture: true })
    screen.addEventListener('touchcancel', onTouchEnd, { passive: false, capture: true })

    return () => {
      stopGlide()
      screen.removeEventListener('click', onClick)
      screen.removeEventListener('touchstart', onTouchStart, { capture: true })
      screen.removeEventListener('touchmove', onTouchMove, { capture: true })
      screen.removeEventListener('touchend', onTouchEnd, { capture: true })
      screen.removeEventListener('touchcancel', onTouchEnd, { capture: true })
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

  // With the typing field, xterm's own hidden textarea must never open the keyboard.
  useEffect(() => {
    const area = termRef.current?.term.textarea
    if (area) area.readOnly = inputMode === 'line'
  }, [inputMode])

  useEffect(() => {
    if (!active || !termRef.current) return
    requestAnimationFrame(() => {
      try {
        termRef.current.fit.fit()
      } catch {
        // ignore
      }
      // Phones: no keyboard popping up by itself; a tap opens it.
      if (!touchDevice()) refocus()
    })
  }, [active, refocus])

  const send = (data) => linkRef.current?.send(data)

  /* Anything other than plain typing starts a new piece of the line in the typing field. */
  const commitInput = () => {
    sentRef.current = ''
    if (inputRef.current) inputRef.current.value = ''
  }

  const sendKey = (key) => {
    const term = termRef.current?.term
    if (!term) return
    if (key.modifier) {
      setModifier(modifier.current === key.modifier ? null : key.modifier)
    } else {
      commitInput()
      let data = key.seq ? key.seq(term) : key.data
      if (modifier.current === 'alt') data = `\x1b${data}`
      else if (modifier.current === 'ctrl' && data.length === 1) data = ctrlChar(data)
      if (modifier.current) setModifier(null)
      term.scrollToBottom()
      send(data)
    }
    refocus()
  }

  /*
   * Key bar: a key goes out on click, so swiping along the bar to reach more
   * keys sends nothing. Arrows and backspace repeat while held.
   */
  const repeatTimer = useRef(null)
  const repeated = useRef(false)
  const stopRepeat = () => {
    clearTimeout(repeatTimer.current)
    clearInterval(repeatTimer.current)
    repeatTimer.current = null
  }
  useEffect(() => stopRepeat, [])
  const pressKey = (event, key) => {
    event.preventDefault() // keep the focus (and the keyboard) where it is
    repeated.current = false
    if (!key.repeat) return
    stopRepeat()
    repeatTimer.current = setTimeout(() => {
      repeated.current = true
      sendKey(key)
      repeatTimer.current = setInterval(() => sendKey(key), 70)
    }, 450)
  }
  const clickKey = (key) => {
    stopRepeat()
    if (repeated.current) {
      repeated.current = false
      return
    }
    sendKey(key)
  }

  /*
   * The typing field. Every change is sent at once as the difference to what
   * was sent before: new letters go out as typed, a word replaced by
   * autocorrect or a suggestion goes out as backspaces plus the new word.
   * So the shell sees each letter live (and Tab completion works), while the
   * phone's keyboard keeps its suggestions, swipe typing and voice input.
   */
  const onInput = (event) => {
    const field = event.currentTarget
    const value = field.value
    const before = sentRef.current
    let common = 0
    while (common < before.length && common < value.length && before[common] === value[common]) common++
    const removed = before.length - common
    let added = value.slice(common)
    // Ctrl/Alt from the key bar apply to the next letter typed.
    if (modifier.current && added.length === 1 && !removed) {
      const data = modifier.current === 'ctrl' ? ctrlChar(added) : `\x1b${added}`
      setModifier(null)
      send(data)
      if (!event.nativeEvent.isComposing) field.value = before
      return
    }
    termRef.current?.term.scrollToBottom()
    send('\x7f'.repeat(removed) + added.replace(/\n/g, '\r'))
    sentRef.current = value
  }

  const onKeyDown = (event) => {
    const field = event.currentTarget
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    const empty = !field.value
    const term = termRef.current?.term
    if (event.key === 'Enter' && !event.shiftKey) {
      onSubmit(event)
      return
    }
    // Keys with a meaning of their own in the terminal.
    if (event.ctrlKey && event.key.length === 1 && !event.altKey) {
      event.preventDefault()
      commitInput()
      send(ctrlChar(event.key))
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      commitInput()
      send('\t')
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      commitInput()
      send('\x1b')
      return
    }
    // Backspace on an empty field still deletes in the shell.
    if (event.key === 'Backspace' && empty) {
      event.preventDefault()
      send('\x7f')
      return
    }
    const arrows = { ArrowUp: 'A', ArrowDown: 'B', ArrowRight: 'C', ArrowLeft: 'D' }
    if (arrows[event.key] && (empty || event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      commitInput()
      send(arrow(arrows[event.key])(term))
    }
  }

  // Some Android keyboards send no key event for backspace in an empty field, only this.
  const onBeforeInput = (event) => {
    if (event.nativeEvent.inputType === 'deleteContentBackward' && !event.currentTarget.value) {
      event.preventDefault()
      send('\x7f')
    }
  }

  function onSubmit(event) {
    event.preventDefault()
    commitInput()
    termRef.current?.term.scrollToBottom()
    send('\r')
  }

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) termRef.current?.term.paste(text)
    } catch {
      const text = window.prompt('Paste here (your browser blocks clipboard access):')
      if (text) termRef.current?.term.paste(text)
    }
    commitInput()
    refocus()
  }

  const copy = () => {
    const selection = termRef.current?.term.getSelection()
    if (selection) navigator.clipboard?.writeText(selection).catch(() => {})
    else setTextView(bufferText(termRef.current.term))
  }

  const [icon, label, tone] = STATE_LABELS[state] ?? STATE_LABELS.connecting
  const closeTextView = useCallback(() => setTextView(null), [])

  return (
    <div className={`hub-term${active ? ' is-active' : ''}`} hidden={!active}>
      <div className="hub-term__bar">
        <span className={`hub-term__state hub-tone--${tone}`} title={label}>
          <Icon name={icon} />
          <span className="hub-term__label">{label}</span>
        </span>
        <span className="hub-term__tools">
          <button type="button" className="hub-icon-button" title="Show as text (select and copy)" onClick={() => setTextView(bufferText(termRef.current.term))}>
            <Icon name="article" />
          </button>
          <button type="button" className="hub-icon-button hub-term__desk" title="Copy selection (Ctrl+Shift+C)" onClick={copy}>
            <Icon name="content_copy" />
          </button>
          <button type="button" className="hub-icon-button" title="Paste (Ctrl+Shift+V)" onPointerDown={(event) => event.preventDefault()} onClick={paste}>
            <Icon name="content_paste" />
          </button>
          <button type="button" className="hub-icon-button hub-term__desk" title="Scroll up a page" onClick={() => termRef.current?.term.scrollPages(-1)}>
            <Icon name="keyboard_double_arrow_up" />
          </button>
          <button type="button" className="hub-icon-button hub-term__desk" title="Scroll down a page" onClick={() => termRef.current?.term.scrollPages(1)}>
            <Icon name="keyboard_double_arrow_down" />
          </button>
          <button type="button" className="hub-icon-button" title="Clear screen" onClick={() => termRef.current?.term.clear()}>
            <Icon name="mop" />
          </button>
        </span>
      </div>
      <div className="hub-term__body">
        <div className="hub-term__screen" ref={box} />
        {scrolledUp && (
          <button type="button" className="hub-term__end" onPointerDown={(event) => event.preventDefault()} onClick={() => termRef.current?.term.scrollToBottom()}>
            <Icon name="arrow_downward" />
            Back to the end
          </button>
        )}
        {textView !== null && <TextView text={textView} onClose={closeTextView} />}
      </div>
      {inputMode === 'line' && (
        <form className="hub-term__input" onSubmit={onSubmit}>
          <span className="hub-term__prompt" aria-hidden="true">
            ›
          </span>
          <input
            ref={inputRef}
            type="text"
            name="terminal-input"
            aria-label="Type into the terminal"
            placeholder={state === 'exited' ? 'The shell has ended' : 'Type here; Enter sends'}
            disabled={state === 'exited'}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="on"
            spellCheck={false}
            enterKeyHint="send"
            data-gramm="false"
            onInput={onInput}
            onKeyDown={onKeyDown}
            onBeforeInput={onBeforeInput}
            onFocus={() => onTyping(true)}
          />
          <button type="submit" className="hub-term__send" title="Enter" onPointerDown={(event) => event.preventDefault()}>
            <Icon name="keyboard_return" />
          </button>
        </form>
      )}
      <div className="hub-term__keys" role="toolbar" aria-label="Special keys">
        {KEYS.map((key) => (
          <button
            key={key.label}
            type="button"
            title={key.title}
            aria-pressed={key.modifier ? mod === key.modifier : undefined}
            className={key.modifier && mod === key.modifier ? 'is-active' : ''}
            onPointerDown={(event) => pressKey(event, key)}
            onPointerUp={stopRepeat}
            onPointerLeave={stopRepeat}
            onPointerCancel={stopRepeat}
            onClick={() => clickKey(key)}
            onContextMenu={(event) => event.preventDefault()}
          >
            {key.label}
          </button>
        ))}
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
  const [inputMode, setInputMode] = useState(readInputMode)
  const [fullscreen, setFullscreen] = useState(false)
  const consoleRef = useRef(null)

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
      localStorage.setItem(INPUT_KEY, inputMode)
    } catch {
      // ignore
    }
  }, [fontSize, inputMode])

  /*
   * Full screen follows the visible part of the page: with the on-screen
   * keyboard open it ends right above it (phones don't shrink the page for
   * the keyboard, so 100vh would hide the typing field behind it).
   */
  useEffect(() => {
    if (!fullscreen) return undefined
    const onKey = (event) => event.key === 'Escape' && event.shiftKey && setFullscreen(false)
    document.addEventListener('keydown', onKey)
    document.body.classList.add('hub-no-scroll')
    const viewport = window.visualViewport
    const fitViewport = () => {
      const element = consoleRef.current
      if (!element || !viewport) return
      element.style.top = `${viewport.offsetTop}px`
      element.style.height = `${viewport.height}px`
    }
    fitViewport()
    viewport?.addEventListener('resize', fitViewport)
    viewport?.addEventListener('scroll', fitViewport)
    const element = consoleRef.current
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.classList.remove('hub-no-scroll')
      viewport?.removeEventListener('resize', fitViewport)
      viewport?.removeEventListener('scroll', fitViewport)
      if (element) {
        element.style.top = ''
        element.style.height = ''
      }
    }
  }, [fullscreen])

  // Phones: typing goes full screen, so the terminal, the field and the keys all fit above the keyboard.
  const onTyping = useCallback(() => {
    if (touchDevice()) setFullscreen(true)
  }, [])

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

  const lineInput = inputMode === 'line'

  return (
    <div ref={consoleRef} className={`hub-console${fullscreen ? ' is-fullscreen' : ''}`}>
      <div className="hub-console__head">
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
        </div>
        <div className="hub-console__actions">
          <button
            type="button"
            className={`hub-icon-button${lineInput ? ' is-on' : ''}`}
            title={lineInput ? 'Typing field on: keyboard suggestions and autocorrect work. Tap to type straight into the terminal.' : 'Typing straight into the terminal. Tap for the typing field (better with phone keyboards).'}
            aria-pressed={lineInput}
            onClick={() => setInputMode(lineInput ? 'direct' : 'line')}
          >
            <Icon name={lineInput ? 'edit_note' : 'keyboard'} />
          </button>
          <button type="button" className="hub-icon-button" title="Smaller text (or pinch)" onClick={() => setFontSize((value) => Math.max(8, value - 1))}>
            <Icon name="text_decrease" />
          </button>
          <button type="button" className="hub-icon-button" title="Larger text (or pinch)" onClick={() => setFontSize((value) => Math.min(24, value + 1))}>
            <Icon name="text_increase" />
          </button>
          <button type="button" className="hub-icon-button" title={fullscreen ? 'Exit full screen (Shift+Esc)' : 'Full screen'} onClick={() => setFullscreen((value) => !value)}>
            <Icon name={fullscreen ? 'close_fullscreen' : 'open_in_full'} />
          </button>
        </div>
      </div>

      <ErrorNote error={error} />

      {info.sessions.length ? (
        info.sessions.map((session) => (
          <TerminalView
            key={session.id}
            session={session}
            active={session.id === activeId}
            fontSize={fontSize}
            setFontSize={setFontSize}
            inputMode={inputMode}
            onTyping={onTyping}
            onTitle={onTitle}
            onExited={onExited}
          />
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
