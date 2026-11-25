// Boards from other dashboards (src/lib/dashImport.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse as parseYaml } from 'yaml'

import { readDashboard } from '../src/lib/dashImport.js'

test('Glance', () => {
  const yml = `
pages:
  - name: Home
    columns:
      - size: small
        widgets:
          - type: calendar
          - type: weather
            location: Munich, Germany
            units: imperial
      - size: full
        widgets:
          - type: bookmarks
            groups:
              - title: Dev
                links:
                  - title: GitHub
                    url: https://github.com
                    icon: si:github
          - type: group
            widgets:
              - type: hacker-news
                limit: 10
              - type: reddit
                subreddit: selfhosted
          - type: releases
            repositories:
              - glanceapp/glance
              - gitlab:fdroid/fdroidclient
`
  const result = readDashboard(yml, { parseYaml })
  assert.equal(result.source, 'glance')
  assert.deepEqual(result.pages[0].columns, [1, 2])
  const types = result.pages[0].widgets.map((widget) => widget.type)
  assert.deepEqual(types, ['calendar', 'weather', 'bookmarks', 'hackernews', 'releases'])
  assert.equal(result.pages[0].widgets[1].options.unit, 'f')
  assert.equal(result.pages[0].widgets[1].geocode, 'Munich, Germany')
  assert.deepEqual(result.pages[0].widgets[2].options.items[0], { title: 'GitHub', url: 'https://github.com', icon: 'github', description: '' })
  assert.deepEqual(result.pages[0].widgets[4].options.repos[1], { source: 'gitlab', repo: 'fdroid/fdroidclient' })
  assert.deepEqual(result.skipped, ['glance:reddit'])
})

test('Homarr (0.x)', () => {
  const json = JSON.stringify({
    configProperties: { name: 'default' },
    categories: [{ id: 'c1', name: 'Media' }],
    apps: [
      { name: 'Jellyfin', url: 'http://10.0.0.2:8096', behaviour: { externalUrl: 'https://jelly.example.com' }, appearance: { iconUrl: 'https://cdn.example.com/jellyfin.png' }, area: { type: 'category', properties: { id: 'c1' } } },
      { name: 'Router', url: 'http://192.168.1.1', area: { type: 'wrapper', properties: { id: 'w1' } } },
    ],
    widgets: [
      { type: 'weather', properties: { location: { name: 'Paris', latitude: 48.85, longitude: 2.35 } } },
      { type: 'torrents-status', properties: {} },
    ],
  })
  const result = readDashboard(json)
  assert.equal(result.source, 'homarr')
  const [media, other, weather] = result.pages[0].widgets
  assert.equal(media.title, 'Media')
  assert.equal(media.options.items[0].url, 'https://jelly.example.com')
  assert.equal(other.options.items[0].url, 'http://192.168.1.1')
  assert.deepEqual(weather.options, { place: 'Paris', lat: '48.85', lon: '2.35' })
  assert.deepEqual(result.skipped, ['homarr:torrents-status'])
})

test('Dashy and Homepage', () => {
  const dashy = readDashboard(`pageInfo:\n  title: Lab\nsections:\n  - name: Tools\n    items:\n      - title: Proxmox\n        url: https://pve.example.com\n        icon: hl-proxmox\n    widgets:\n      - type: clock\n      - type: crypto-watch-list\n`, { parseYaml })
  assert.equal(dashy.source, 'dashy')
  assert.deepEqual(dashy.pages[0].widgets.map((widget) => widget.type), ['bookmarks', 'clock'])
  assert.equal(dashy.pages[0].widgets[0].options.items[0].icon, 'proxmox')
  const homepage = readDashboard(`- Media:\n    - Plex:\n        href: https://plex.example.com\n        icon: plex.png\n        widget:\n          type: plex\n`, { parseYaml })
  assert.equal(homepage.source, 'homepage')
  assert.equal(homepage.pages[0].widgets[0].options.items[0].icon, 'plex')
  assert.deepEqual(homepage.skipped, ['homepage:plex'])
})

test('browser bookmarks', () => {
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3>Bookmarks bar</H3>
  <DL><p>
    <DT><A HREF="https://example.com/?a=1&amp;b=2" ADD_DATE="1">Example &amp; Co</A>
    <DT><H3>Work</H3>
    <DL><p>
      <DT><A HREF="https://mail.example.com">Mail</A>
      <DT><A HREF="javascript:void(0)">Bookmarklet</A>
    </DL><p>
    <DT><A HREF="https://news.example.com">News</A>
  </DL><p>
</DL>`
  const result = readDashboard(html, { name: 'bookmarks.html' })
  assert.deepEqual(
    result.pages[0].widgets.map((widget) => [widget.title, widget.options.items.map((item) => item.title)]),
    [
      ['Bookmarks bar', ['Example & Co', 'News']],
      ['Work', ['Mail']],
    ],
  )
  assert.equal(result.pages[0].widgets[0].options.items[0].url, 'https://example.com/?a=1&b=2')
})

test('unknown files', () => {
  assert.throws(() => readDashboard('{"hello": 1}'), /unknown/)
  assert.throws(() => readDashboard('not: [valid', { parseYaml }), /unknown/)
})
