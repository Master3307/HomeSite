/*
 * Release notes, changelogs and the like as readable text: headings, lists,
 * quotes, code, **bold**, *italic*, `code`, [links](https://…) and bare
 * links. Built from React elements only — nothing from the text is ever
 * put into the page as HTML, and only http(s) links become links.
 */

const SAFE_URL = /^https?:\/\/[^\s<>"]+$/i

function inline(text, keyBase, linkProps) {
  const out = []
  // Order matters: code first (nothing inside it is formatted), then links, bold, italic, bare URLs.
  const pattern = /(`[^`\n]+`)|(\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\))|(\*\*([^*\n]+)\*\*|__([^_\n]+)__)|(\*([^*\n]+)\*|_([^_\n]+)_)|(https?:\/\/[^\s<>()"]+[^\s<>()".,;:!?])/g
  let last = 0
  let match
  let index = 0
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index))
    const key = `${keyBase}-${index++}`
    if (match[1]) out.push(<code key={key}>{match[1].slice(1, -1)}</code>)
    else if (match[2]) {
      const href = match[4]
      out.push(
        SAFE_URL.test(href) ? (
          <a key={key} href={href} {...linkProps}>
            {match[3]}
          </a>
        ) : (
          match[3]
        ),
      )
    } else if (match[5]) out.push(<strong key={key}>{match[6] ?? match[7]}</strong>)
    else if (match[8]) out.push(<em key={key}>{match[9] ?? match[10]}</em>)
    else if (match[11])
      out.push(
        <a key={key} href={match[11]} {...linkProps}>
          {match[11].replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}
        </a>,
      )
    last = match.index + match[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** `text`: the source; `max`: blocks shown at most; `newTab`: links open in a new tab. */
export default function MarkdownLite({ text, max = 200, newTab = true, className = '' }) {
  const linkProps = newTab ? { target: '_blank', rel: 'noopener noreferrer' } : { rel: 'noopener noreferrer' }
  // HTML some projects put into their notes: tags dropped, entities read.
  const source = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:p|div|details|summary|h\d|ul|ol|li|table|tr|td|th|img|a|span|sub|sup|picture|source|video)\b[^>]*>/gi, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
  const lines = source.split('\n')
  const blocks = []
  let index = 0
  while (index < lines.length && blocks.length < max) {
    const line = lines[index]
    if (!line.trim()) {
      index++
      continue
    }
    const key = `b${blocks.length}`
    if (/^```/.test(line)) {
      const code = []
      index++
      while (index < lines.length && !/^```/.test(lines[index])) code.push(lines[index++])
      index++
      blocks.push(
        <pre key={key}>
          <code>{code.join('\n')}</code>
        </pre>,
      )
      continue
    }
    const heading = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line)
    if (heading) {
      const Tag = heading[1].length <= 2 ? 'h4' : 'h5'
      blocks.push(<Tag key={key}>{inline(heading[2], key, linkProps)}</Tag>)
      index++
      continue
    }
    if (/^\s*[-*+]\s+|^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line)
      const items = []
      while (index < lines.length && /^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').replace(/^\[([ xX])\]\s+/, (_, done) => (done.trim() ? '✓ ' : '☐ ')))
        index++
      }
      const List = ordered ? 'ol' : 'ul'
      blocks.push(
        <List key={key}>
          {items.map((item, position) => (
            <li key={position}>{inline(item, `${key}-${position}`, linkProps)}</li>
          ))}
        </List>,
      )
      continue
    }
    if (/^\s*>/.test(line)) {
      const quote = []
      while (index < lines.length && /^\s*>/.test(lines[index])) quote.push(lines[index++].replace(/^\s*>\s?/, ''))
      blocks.push(<blockquote key={key}>{inline(quote.join(' '), key, linkProps)}</blockquote>)
      continue
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<hr key={key} />)
      index++
      continue
    }
    const paragraph = []
    while (index < lines.length && lines[index].trim() && !/^(?:```|#{1,6}\s|\s*[-*+]\s+|\s*\d+[.)]\s+|\s*>)/.test(lines[index])) paragraph.push(lines[index++].trim())
    blocks.push(<p key={key}>{inline(paragraph.join(' '), key, linkProps)}</p>)
  }
  return <div className={`dash-md ${className}`.trim()}>{blocks}</div>
}
