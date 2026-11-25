// Keeping the dash in step across devices (src/lib/dashSync.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { changedKeys, mergeSettings } from '../src/lib/dashSync.js'

const base = {
  look: { columns: 12 },
  top: { clock: 'time' },
  openInNewTab: false,
  widgets: [
    { id: 'a', type: 'clock', x: 0 },
    { id: 'b', type: 'note', x: 1, options: { text: 'hi' } },
  ],
  providers: [{ id: 'ddg' }, { id: 'g' }, { id: 's' }],
  pages: [{ id: 'p1', name: 'Home' }],
  updatedAt: 1,
  activePage: 'p1',
}

test('changes are noted per setting and per entry', () => {
  const after = { ...base, look: { columns: 16 }, widgets: [base.widgets[0], { ...base.widgets[1], options: { text: 'yo' } }, { id: 'c', type: 'todo' }], activePage: 'p2', updatedAt: 5 }
  assert.deepEqual(changedKeys(base, after).sort(), ['look', 'widgets:b', 'widgets:c'])
  assert.deepEqual(changedKeys(base, { ...base, widgets: [base.widgets[1]] }), ['widgets:-a'])
  assert.deepEqual(changedKeys(base, { ...base, providers: [base.providers[2], base.providers[0], base.providers[1]] }), ['providers#order'])
  assert.deepEqual(changedKeys(base, { ...base }), [])
})

test('two devices editing different things both keep their work', () => {
  // Device A (the account's copy now): moved the clock, added an engine, turned on new tabs.
  const remote = { ...base, openInNewTab: true, widgets: [{ ...base.widgets[0], x: 5 }, base.widgets[1]], providers: [...base.providers, { id: 'brave' }], updatedAt: 10 }
  // Device B (here): edited the note, added a to-do, removed an engine, changed the look.
  const local = { ...base, look: { columns: 8 }, widgets: [base.widgets[0], { ...base.widgets[1], options: { text: 'mine' } }, { id: 'c', type: 'todo' }], providers: [base.providers[0], base.providers[2]], updatedAt: 9 }
  const merged = mergeSettings(remote, local, changedKeys(base, local))
  assert.equal(merged.openInNewTab, true)
  assert.deepEqual(merged.look, { columns: 8 })
  assert.equal(merged.widgets.find((widget) => widget.id === 'a').x, 5)
  assert.equal(merged.widgets.find((widget) => widget.id === 'b').options.text, 'mine')
  assert.ok(merged.widgets.some((widget) => widget.id === 'c'))
  assert.deepEqual(merged.providers.map((provider) => provider.id), ['ddg', 's', 'brave'])
})

test('a reorder here keeps entries added elsewhere', () => {
  const remote = { ...base, providers: [...base.providers, { id: 'new' }] }
  const local = { ...base, providers: [base.providers[2], base.providers[1], base.providers[0]] }
  const merged = mergeSettings(remote, local, changedKeys(base, local))
  assert.deepEqual(merged.providers.map((provider) => provider.id), ['s', 'g', 'ddg', 'new'])
})

test('this browser-only things never travel', () => {
  assert.deepEqual(changedKeys(base, { ...base, activePage: 'x', customCss: 'a{}', updatedAt: 99 }), [])
})
