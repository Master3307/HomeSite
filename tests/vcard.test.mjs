// The contacts' vCard reading and writing (shared/vcard.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseVcards, writeVcards } from '../shared/vcard.mjs'

test('vCard 3.0 / 4.0 (Google, Apple)', () => {
  const text = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:Anna Müller',
    'N:Müller;Anna;;;',
    'item1.TEL;TYPE=CELL:+49 170 1234567',
    'TEL;TYPE=WORK,VOICE:089 123',
    'EMAIL;TYPE=INTERNET;TYPE=HOME:anna@example.com',
    'ADR;TYPE=HOME:;;Hauptstr. 1;München;Bayern;80331;Germany',
    'BDAY:--0314',
    'ORG:Example GmbH;Sales',
    'NOTE:Met at the\\nconference\\, 2024',
    'PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJ',
    '  RgABAQ==',
    'END:VCARD',
    'BEGIN:VCARD',
    'VERSION:4.0',
    'FN:Ben',
    'TEL;VALUE=uri;TYPE="voice,cell":tel:+1-555-0100',
    'BDAY:19900102',
    'END:VCARD',
  ].join('\r\n')
  const [anna, ben] = parseVcards(text)
  assert.equal(anna.name, 'Anna Müller')
  assert.deepEqual(anna.phones, [{ type: 'cell', value: '+49 170 1234567' }, { type: 'work', value: '089 123' }])
  assert.deepEqual(anna.emails, [{ type: 'home', value: 'anna@example.com' }])
  assert.equal(anna.addresses[0].value, 'Hauptstr. 1, 80331 München, Bayern, Germany')
  assert.equal(anna.birthday, '--03-14')
  assert.equal(anna.org, 'Example GmbH, Sales')
  assert.equal(anna.note, 'Met at the\nconference, 2024')
  assert.equal(anna.photo, 'data:image/jpeg;base64,/9j/4AAQSkZJ RgABAQ=='.replace(' ', ''))
  assert.deepEqual(ben.phones, [{ type: 'cell', value: '+1-555-0100' }])
  assert.equal(ben.birthday, '1990-01-02')
})

test('vCard 2.1 (old phones): bare types, quoted-printable', () => {
  const text = 'BEGIN:VCARD\r\nVERSION:2.1\r\nN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:J=C3=BCrgen;Klaus\r\nTEL;CELL;PREF:0171 999\r\nEND:VCARD\r\n'
  const [klaus] = parseVcards(text)
  assert.equal(klaus.name, 'Klaus Jürgen')
  assert.deepEqual(klaus.phones, [{ type: 'cell', value: '0171 999' }])
})

test('writing and reading back', () => {
  const contacts = parseVcards('BEGIN:VCARD\nFN:Cara; Dee\nN:Dee;Cara\nTEL;TYPE=HOME:123\nEMAIL:c@example.com\nBDAY:--12-24\nNOTE:a\\nb\nEND:VCARD')
  const again = parseVcards(writeVcards(contacts))
  assert.deepEqual(again, contacts)
})
