import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import Profile from './DiscordCard.jsx'
import CloseButton from './CloseButton.jsx'
import BrandIcon, { BRANDS } from './BrandIcon.jsx'
import { LINKS, TOOLBELT } from '../data/links.js'
import SetupShowcase from './setup/SetupShowcase.jsx'
import '../styles/nerd-font.css'
import '../styles/nunito.css'

/*
 * /card: who I am. Wide screens: me on the left (the live Discord card,
 * a few facts, where to find me) in a soft glass column that stays in view,
 * the rest on the right (the intro as a terminal session, what I build
 * with, my setup in 3D). Phones: one column in the old order (the wrappers step aside).
 * The headings and the prompt use the JetBrains Mono Nerd Font (the hub
 * console's), its glyphs as icons. A tool in the toolbelt grows into a
 * small card when clicked.
 */

/* Brands whose colour is (near) black or too dark on purple: they use the text colour. */
const INK = new Set(['github', 'steam', 'wakatime', 'sqlite'])
const brandColour = (icon) => (INK.has(icon) ? 'var(--text-primary)' : BRANDS[icon]?.color)

/* Nerd Font glyphs (Font Awesome set): birthday cake, map marker, language; code, link, desktop. */
const GLYPH = { birthday: '', from: '', languages: '', tools: '', links: '', setup: '' }
const FACTS = ['birthday', 'from', 'languages']

const motion = () => {
  const root = document.documentElement
  if (root.classList.contains('motion-none')) return 'none'
  if (root.classList.contains('motion-reduce') || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 'reduce'
  return 'all'
}

/*
 * The prompt as in my terminal (fish with Tide): OS logo, folder, git
 * branch, Node and the time on the right, the command on the second line.
 * The frame joining both lines is drawn in CSS so it always lines up.
 */
function Prompt({ time, children }) {
  return (
    <div className="me-shell__prompt">
      <p className="me-shell__line">
        <span className="me-shell__os">{'\uf303'}</span>
        <span className="me-shell__sep">/</span>
        <span className="me-shell__dir">
          {'\uf07c'} ~/Projects/git-repos/<b>HomeSite</b>
        </span>
        <span className="me-shell__sep">/</span>
        <span className="me-shell__git">{'\ue702'} dev</span>
        <span className="me-shell__right">
          <span className="me-shell__node">{'\u2b22'} 26.13.1</span>
          <span className="me-shell__sep">/</span>
          <span className="me-shell__time">{time}</span>
        </span>
      </p>
      <p className="me-shell__line">
        <span className="me-shell__arrow">❯</span>
        {children}
      </p>
    </div>
  )
}

/*
 * The intro as a short terminal session: `whoami`, `cat about.txt` (the
 * bio), `ls interests/`. Each command is typed at the prompt, then it
 * collapses to one line with its output under it, and the next follows. Until the Nerd Font is there only the cursor shows (no boxes
 * where the glyphs go); with fewer motions it is all there at once.
 */
const COMMANDS = ['whoami', 'cat about.txt', 'ls interests/']

function Terminal() {
  const { t } = useTranslation('card')
  const animate = motion() === 'all'
  const interests = t('interests', { returnObjects: true })
  const steps = [
    { command: COMMANDS[0], output: <p className="me-shell__out">mrkoby07</p> },
    { command: COMMANDS[1], output: <p className="me-shell__out me-shell__text">{t('bio')}</p> },
    {
      command: COMMANDS[2],
      output: (
        <p className="me-shell__out me-shell__ls">
          {(Array.isArray(interests) ? interests : []).map((item) => (
            <span key={item}>{item}/</span>
          ))}
        </p>
      ),
    },
  ]
  // Where the session is: step index and how much of its command is typed.
  const [ready, setReady] = useState(false)
  const [step, setStep] = useState(animate ? 0 : COMMANDS.length)
  const [typed, setTyped] = useState(0)
  const [clock, setClock] = useState(() => new Date())

  useEffect(() => {
    let alive = true
    const loaded = document.fonts?.load?.('1em "JetBrainsMono Nerd Font Mono"') ?? Promise.resolve()
    Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, 2000))]).then(() => alive && setReady(true))
    const timer = setInterval(() => setClock(new Date()), 1000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!ready || step >= COMMANDS.length) return undefined
    const command = COMMANDS[step]
    const timer =
      typed < command.length
        ? setTimeout(() => setTyped((value) => value + 1), 55 + Math.random() * 65)
        : setTimeout(() => {
            setStep((value) => value + 1)
            setTyped(0)
          }, 420)
    return () => clearTimeout(timer)
  }, [ready, step, typed])

  const time = clock.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  // The session at `at` (how many commands ran) and `typing` (the part of the next one already typed).
  const session = (at, typing) => (
    <>
      {/* Commands that ran collapse to a short line (Tide's transient prompt); the current one has the full prompt. */}
      {steps.slice(0, Math.min(at, steps.length)).map((entry) => (
        <div key={entry.command} className="me-shell__block">
          <p className="me-shell__line">
            <span className="me-shell__frame">╰─</span>
            <span className="me-shell__arrow">❯</span>
            <span className="me-shell__cmd">{entry.command}</span>
          </p>
          {entry.output}
        </div>
      ))}
      <Prompt time={time}>
        {at < steps.length && <span className="me-shell__cmd">{steps[at].command.slice(0, typing)}</span>}
        <span className="me-shell__cursor" />
      </Prompt>
    </>
  )
  return (
    <div className="me-shell" aria-hidden="true">
      {/* The finished session, unseen: the box has its final height from the start, so nothing below moves while it types. */}
      <div className="me-shell__layer me-shell__layer--ghost">{session(steps.length, 0)}</div>
      <div className="me-shell__layer">
        {ready ? (
          session(step, typed)
        ) : (
          <p className="me-shell__line">
            <span className="me-shell__cursor" />
          </p>
        )}
      </div>
    </div>
  )
}

/*
 * A tool opened: the chip morphs into a card in its place, over the page
 * (which dims a little). The card's background grows out of the chip (only
 * a transform, its corners counter-scaled so they stay round: an animated
 * clip-path drew in stripes on some GPUs), the icon flies from the chip to
 * its spot, then name, text and link come in one after another; closing
 * plays it backwards into the chip.
 * Esc, a click outside or on the card itself (not the link) closes it.
 */
const CARD = { width: 320, height: 236 }
const EASE = 'cubic-bezier(0.2, 0.85, 0.25, 1)'

function ToolCard({ tool, from, onClose }) {
  const { t } = useTranslation('card')
  const cardRef = useRef(null)
  const shadeRef = useRef(null)
  const bgRef = useRef(null)
  const iconRef = useRef(null)
  const linkRef = useRef(null)
  const closingRef = useRef(false)
  const width = Math.min(CARD.width, window.innerWidth - 32)
  const height = CARD.height
  const chip = from.rect
  const left = Math.min(Math.max(16, chip.left + chip.width / 2 - width / 2), window.innerWidth - width - 16)
  const top = Math.min(Math.max(16, chip.top + chip.height / 2 - height / 2), window.innerHeight - height - 16)

  // The steps of the morph (open; `reverse` closes).
  const morph = useCallback(
    (reverse) => {
      const card = cardRef.current
      const icon = iconRef.current
      const bg = bgRef.current
      if (!card || !icon || !bg || motion() !== 'all') return Promise.resolve()
      // The background starts as exactly the chip: its box and its corners.
      const sx = chip.width / width
      const sy = chip.height / height
      const radius = from.radius ?? 12
      const box = icon.getBoundingClientRect()
      const scale = from.icon ? from.icon.width / box.width : 0.65
      const dx = from.icon ? from.icon.left + from.icon.width / 2 - (box.left + box.width / 2) : 0
      const dy = from.icon ? from.icon.top + from.icon.height / 2 - (box.top + box.height / 2) : 0
      const direction = reverse ? 'reverse' : 'normal'
      const texts = [...card.querySelectorAll('[data-reveal]')]
      const runs = [
        bg.animate(
          {
            transform: [`translate(${chip.left - left}px, ${chip.top - top}px) scale(${sx}, ${sy})`, 'none'],
            borderRadius: [`${radius / sx}px / ${radius / sy}px`, '22px'],
            boxShadow: ['0 0 0 rgb(0 0 0 / 0)', '0 22px 60px rgb(0 0 0 / 0.28)'],
          },
          { duration: reverse ? 260 : 420, easing: EASE, direction, fill: 'both' },
        ),
        icon.animate({ transform: [`translate(${dx}px, ${dy}px) scale(${scale})`, 'none'] }, { duration: reverse ? 260 : 440, easing: EASE, direction, fill: 'both' }),
        shadeRef.current?.animate({ opacity: [0, 1] }, { duration: reverse ? 220 : 320, easing: 'ease-out', direction, fill: 'both' }),
        ...texts.map((element, index) =>
          element.animate(
            { opacity: [0, 1], transform: ['translateY(10px)', 'none'], filter: ['blur(6px)', 'blur(0)'] },
            reverse
              ? { duration: 120, easing: 'ease-in', direction, fill: 'both' }
              : { duration: 360, delay: 150 + index * 70, easing: EASE, fill: 'both' },
          ),
        ),
      ].filter(Boolean)
      return Promise.all(runs.map((run) => run.finished)).catch(() => {})
    },
    [chip, from.icon, from.radius, height, left, top, width],
  )

  useLayoutEffect(() => {
    morph(false)
    // Keyboard: straight to the link. Mouse or touch: the card itself (no ring on the link).
    ;(from.keyboard ? linkRef.current : cardRef.current)?.focus({ preventScroll: true })
    const card = cardRef.current
    const shade = shadeRef.current
    // (Stops a morph that is still running when it unmounts, e.g. React running effects twice in development.)
    return () => [...(card?.getAnimations({ subtree: true }) ?? []), ...(shade?.getAnimations() ?? [])].forEach((run) => run.cancel())
    // (The morph only needs to run once, when it opens.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Closes after the morph back (a timer too, so it can never get stuck half-closed).
  const close = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    const fallback = setTimeout(onClose, 600)
    morph(true).then(() => {
      clearTimeout(fallback)
      onClose()
    })
  }, [morph, onClose])

  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && close()
    // The chip moves with the page, the card doesn't: it closes on scroll.
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, { passive: true })
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close)
      window.removeEventListener('resize', close)
    }
  }, [close])

  let host = tool.url
  try {
    host = new URL(tool.url).hostname.replace(/^www\./, '')
  } catch {
    // Not a full address: show it as it is.
  }
  return createPortal(
    <>
      <div ref={shadeRef} className="me-toolcard-shade" onClick={close} aria-hidden="true" />
      <div
        ref={cardRef}
        className="me-toolcard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="me-toolcard-name"
        tabIndex={-1}
        style={{ '--brand': brandColour(tool.icon), '--at-x': `${-left}px`, '--at-y': `${-top}px`, left, top, width, height }}
        onClick={(event) => !event.target.closest('a') && close()}
      >
        <span ref={bgRef} className="me-toolcard__bg" aria-hidden="true" />
        <span ref={iconRef} className="me-toolcard__icon">
          <BrandIcon name={tool.icon} size={44} />
        </span>
        <strong id="me-toolcard-name" data-reveal="">
          {tool.label}
        </strong>
        <p data-reveal="">{t(`skills.items.${tool.icon}`)}</p>
        <a ref={linkRef} className="me-toolcard__link" href={tool.url} target="_blank" rel="noopener noreferrer" data-reveal="">
          {host}
          <span className="material-symbols-outlined" aria-hidden="true">
            arrow_outward
          </span>
        </a>
      </div>
    </>,
    document.body,
  )
}

export default function Card() {
  const { t } = useTranslation('card')
  // The tool shown as a card: { index, rect }.
  const [open, setOpen] = useState(null)
  const chips = useRef([])

  const openTool = (index, keyboard = false) => {
    const chip = chips.current[index]
    if (!chip) return
    // A hovered square is tilted, and a tilted box measures bigger: take
    // its centre and its own (untilted) size, so the morph starts exactly on it.
    const upright = (element, width, height) => {
      const box = element.getBoundingClientRect()
      const x = box.left + box.width / 2 - width / 2
      const y = box.top + box.height / 2 - height / 2
      return { left: x, top: y, width, height, right: x + width, bottom: y + height }
    }
    const svg = chip.querySelector('svg')
    const iconSize = svg ? parseFloat(getComputedStyle(svg).width) || 0 : 0
    setOpen({
      index,
      keyboard,
      rect: upright(chip, chip.offsetWidth, chip.offsetHeight),
      radius: parseFloat(getComputedStyle(chip).borderTopLeftRadius) || 12,
      icon: svg && iconSize ? upright(svg, iconSize, iconSize) : null,
    })
  }
  const closeTool = useCallback(() => {
    setOpen((current) => {
      if (current) requestAnimationFrame(() => chips.current[current.index]?.focus({ preventScroll: true }))
      return null
    })
  }, [])

  return (
    <div id="card" className="card me-card">
      <CloseButton />

      <div className="me-layout">
        <aside className="me-aside">
          <header className="me-hero">
            <Profile />
          </header>

          <ul className="me-facts" aria-label={t('aboutMe')}>
            {FACTS.map((id) => (
              <li key={id}>
                <span className="me-glyph" aria-hidden="true">
                  {GLYPH[id]}
                </span>
                <span className="sr-only">{t(`facts.${id}`)}: </span>
                {t(`facts.${id}Value`)}
              </li>
            ))}
          </ul>

          <section className="me-block me-block--links" aria-labelledby="me-links">
            <h3 id="me-links">
              <span className="me-glyph" aria-hidden="true">
                {GLYPH.links}
              </span>
              {t('links.title')}
            </h3>
            <ul className="me-socials">
              {LINKS.map((link) => (
                <li key={link.id} style={{ '--brand': brandColour(link.icon) }}>
                  <a className="me-social" href={link.url} target="_blank" rel="noopener noreferrer me" aria-label={`${link.label}: ${t(`links.${link.id}`)}`}>
                    <BrandIcon name={link.icon} size={22} />
                    <span className="me-social__label" aria-hidden="true">
                      <strong>{link.label}</strong>
                      <span className="me-social__what">{t(`links.${link.id}`)}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <div className="me-main">
          <section className="me-intro" aria-label={t('aboutMe')}>
            {/* The terminal is the visible intro; the plain text is there for screen readers and search. */}
            <Terminal />
            <p className="sr-only">{t('bio')}</p>
            <p className="sr-only">{t('into')}</p>
          </section>

          <section className="me-block me-block--tools" aria-labelledby="me-tools">
            <h3 id="me-tools">
              <span className="me-glyph" aria-hidden="true">
                {GLYPH.tools}
              </span>
              {t('skills.title')}
            </h3>
            <ul className="me-tools">
              {TOOLBELT.map((tool, index) => (
                <li key={tool.icon} style={{ '--brand': brandColour(tool.icon), '--i': index }}>
                  <button
                    ref={(element) => (chips.current[index] = element)}
                    type="button"
                    className={`me-tool${open?.index === index ? ' is-open' : ''}`}
                    aria-label={tool.label}
                    aria-haspopup="dialog"
                    aria-expanded={open?.index === index}
                    onClick={(event) => openTool(index, event.detail === 0)}
                  >
                    <BrandIcon name={tool.icon} size={26} />
                    <span className="me-tool__name" aria-hidden="true">
                      {tool.label}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="me-block__note">{t('skills.also')}</p>
          </section>

          <SetupShowcase />
        </div>
      </div>

      {open && <ToolCard tool={TOOLBELT[open.index]} from={open} onClose={closeTool} />}
    </div>
  )
}
