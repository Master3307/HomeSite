/*
 * The search bar's tool answers in the visitor's language: the engine
 * (lib/quick) only gives ids and values; these turn them into the texts
 * the rows and headers show.
 */

const number = (value, locale) => new Intl.NumberFormat(locale).format(value)

/* Row texts and hints in the visitor's language (the engine only gives ids and values). */
export function presentRow(answer, row, t, locale) {
  const hint = row.hint
  switch (answer.tool) {
    case 'encode':
    case 'decode':
      return { ...row, hint: t(`codecs.${hint}`, { defaultValue: hint }) }
    case 'text':
      if (row.id.startsWith('slug')) return { ...row, hint: t(`text.cases.${hint}`) }
      if (row.id.startsWith('case:')) return { ...row, hint: t(`text.cases.${hint}`) }
      return { ...row, hint: t('text.reverse') }
    case 'numbers':
      return { ...row, hint: t(`numbers.names.${hint}`, { defaultValue: t('numbers.base', { base: hint }) }) }
    case 'fraction':
      return { ...row, hint: hint === 'approx' ? `${t('numbers.approx')} · ${t('numbers.fraction')}` : t(`numbers.${hint}`) }
    case 'ratio':
      return { ...row, hint: t(`ratio.${hint}`) }
    case 'paper':
      return { ...row, hint: t(`paper.${hint}`, { dpi: row.dpi }) }
    case 'coords':
      return { ...row, hint: t(`coords.${hint}`) }
    case 'age': {
      if (row.id === 'age:years') return { ...row, text: t('age.years', { count: Number(row.text) }), hint: t('age.title') }
      if (row.id === 'age:full') {
        const text = t('age.full', row.values)
        return { ...row, text, copy: text, hint: '' }
      }
      if (row.id === 'age:days') return { ...row, text: t('age.days', { count: Number(row.text) }).replace(row.text, number(Number(row.text), locale)), hint: '' }
      if (row.id === 'age:approx') return { ...row, text: t('age.approx', { year: row.year, low: row.low, high: row.high }), hint: t('age.title') }
      return { ...row, text: t('age.unborn'), hint: '', copy: '' }
    }
    case 'elapsed': {
      if (row.id === 'span:ymd') {
        const text = t('elapsed.span', row.values)
        return { ...row, text, copy: text, hint: t('elapsed.title') }
      }
      if (row.id === 'span:days') return { ...row, text: t('elapsed.days', { count: Number(row.text) }).replace(row.text, number(Number(row.text), locale)), hint: '' }
      if (row.id === 'span:work') return { ...row, text: t('elapsed.workdays', { count: Number(row.text) }), hint: '' }
      if (row.id === 'span:hm') return { ...row, hint: t('elapsed.duration') }
      if (row.id === 'span:min') return { ...row, text: t('elapsed.minutes', { count: Number(row.text) }), hint: '' }
      return row
    }
    default:
      return row
  }
}

export function answerTitle(answer, t) {
  const title = answer.title
  if (!title) return t(`tools.${answer.tool}.name`, { defaultValue: answer.tool })
  if (title.raw) return t(title.key, { codec: title.codec })
  const values = { ...title }
  if (title.codec) values.codec = t(`codecs.${title.codec}`, { defaultValue: title.codec })
  if (title.case) values.name = t(`text.cases.${title.case}`)
  return t(title.key, values)
}
