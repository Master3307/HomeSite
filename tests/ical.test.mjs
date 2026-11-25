// The calendar's .ics reading, repeating and writing (shared/ical.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { expand, parseIcs, writeIcs } from '../shared/ical.mjs'

const SAMPLE = [
  'BEGIN:VCALENDAR',
  'X-WR-CALNAME:Work',
  'BEGIN:VEVENT',
  'UID:a1',
  'SUMMARY:Stand-up\\, daily',
  'DTSTART;TZID=Europe/Berlin:20261102T093000',
  'DTEND;TZID=Europe/Berlin:20261102T094500',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=6',
  'EXDATE;TZID=Europe/Berlin:20261104T093000',
  'BEGIN:VALARM',
  'SUMMARY:not me',
  'END:VALARM',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:b2',
  'SUMMARY:Holiday',
  'DTSTART;VALUE=DATE:20261224',
  'DTEND;VALUE=DATE:20261227',
  'DESCRIPTION:Line one\\nLine two',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:c3',
  'SUMMARY:A very long title that goes on and on so that the line has to be folded by the',
  '  writer',
  'DTSTART:20261130T120000Z',
  'DURATION:PT1H30M',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

test('reading', () => {
  const calendar = parseIcs(SAMPLE)
  assert.equal(calendar.name, 'Work')
  assert.equal(calendar.events.length, 3)
  const [standup, holiday, long] = calendar.events
  assert.equal(standup.title, 'Stand-up, daily')
  assert.equal(standup.start, '2026-11-02T08:30:00.000Z') // 09:30 in Berlin (winter)
  assert.equal(holiday.allDay, true)
  assert.equal(holiday.start, '2026-12-24')
  assert.equal(holiday.description, 'Line one\nLine two')
  assert.equal(long.end, '2026-11-30T13:30:00.000Z')
  assert.match(long.title, /folded by the writer$/)
})

test('repeating', () => {
  const [standup] = parseIcs(SAMPLE).events
  const times = expand(standup, new Date('2026-11-01'), new Date('2026-12-31')).map((entry) => entry.start.slice(0, 10))
  // Six times counted (one of them skipped by EXDATE): Mo 2, We 4 (skipped), Fr 6, Mo 9, We 11, Fr 13.
  assert.deepEqual(times, ['2026-11-02', '2026-11-06', '2026-11-09', '2026-11-11', '2026-11-13'])
  const monthly = { start: '2026-01-31T10:00:00.000Z', end: '2026-01-31T11:00:00.000Z', zone: 'UTC', rrule: 'FREQ=MONTHLY;BYDAY=-1FR', exdates: [] }
  assert.deepEqual(
    expand(monthly, new Date('2026-01-01'), new Date('2026-05-01')).map((entry) => entry.start.slice(0, 10)),
    ['2026-01-30', '2026-02-27', '2026-03-27', '2026-04-24'].filter((day) => day >= '2026-01-31'),
  )
  const birthday = { start: '2000-03-14', end: '2000-03-15', allDay: true, rrule: 'FREQ=YEARLY', exdates: [] }
  assert.deepEqual(expand(birthday, new Date('2026-01-01'), new Date('2027-12-31')).map((entry) => entry.start), ['2026-03-14', '2027-03-14'])
})

test('writing and reading back', () => {
  const events = parseIcs(SAMPLE).events
  const again = parseIcs(writeIcs({ name: 'Work', events }))
  assert.equal(again.events.length, 3)
  assert.deepEqual(
    again.events.map(({ uid, title, start, end, allDay }) => ({ uid, title, start, end, allDay: Boolean(allDay) })),
    events.map(({ uid, title, start, end, allDay }) => ({ uid, title, start, end, allDay: Boolean(allDay) })),
  )
})
