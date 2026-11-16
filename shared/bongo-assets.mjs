/*
 * Reading an AssetRipper export of Bongo Cat: the rules for what the site
 * imports. Shared by the browser upload (src/lib/bongo.js) and the server
 * (server/services/bongoAssets.cjs), so both always agree on the same files.
 *
 * Nothing here knows a fixed list of items, themes or UI pieces: game
 * updates that add skins, hats, bongos, new item slots (emotes, …), UI
 * themes, theme pieces or icons are picked up by the next import.
 *   - Items: every MonoBehaviour "<Id> - <Name>.asset" with an itemslot: tag.
 *     Slots the site can draw (SLOT_FILES) need all their layers, other
 *     slots keep whatever textures exist (for later use).
 *   - Themes: every sprite sheet "sactx-<n>-<WxH>-<format>-<Theme>-<hash>.png"
 *     and every sprite (Sprite/*.asset) cut from it, whatever its name.
 *     Pieces a theme lacks come from the standalone textures of the same
 *     name (ScrollbarHandle_0.png, …), the "default" theme.
 *   - UI icons: the named ones in UI_ICONS plus every Icon_*.png.
 */

/* Layers of the slots the site draws: key -> file suffix (file = name without spaces + suffix). */
export const SLOT_FILES = {
  skin: { icon: 'Icon', left: 'Left', leftPunch: 'LeftPunch', right: 'Right', rightPunch: 'RightPunch' },
  bongos: { icon: 'Icon', left: 'Left', leftPunch: 'LeftPunch', right: 'Right', rightPunch: 'RightPunch' },
  hat: { sprite: '', icon: 'Icon' },
}
/* Other slots: whichever of these exist. */
const GENERIC_SUFFIXES = { icon: 'Icon', sprite: '', left: 'Left', leftPunch: 'LeftPunch', right: 'Right', rightPunch: 'RightPunch' }

export const DEFAULT_SKIN_FILES = { icon: 'CatIcon.png', left: 'CatLeft.png', leftPunch: 'CatLeftPunch.png', right: 'CatRight.png', rightPunch: 'CatRightPunch.png' }

/* The game's own UI icons the site uses by role (missing ones fall back to Material icons). */
export const UI_ICONS = {
  skins: 'Skins.png',
  hats: 'HatsIcon.png',
  bongos: 'BongosIcon.png',
  emotes: 'EmotesIcon.png',
  outfits: 'PresetsIcon.png',
  themes: 'ThemesIcon.png',
  random: 'DieIcon.png',
  check: 'Icon_Checkmark.png',
  close: 'Icon_Close.png',
  menu: 'Icon_Menu.png',
  search: 'IconSearch.png',
  filter: 'FilterIcon.png',
  shop: 'Icon_Shop.png',
  emojiShop: 'Icon_Emoji_Shop.png',
}
/* Theme backgrounds that are standalone textures. */
export const UI_EXTRAS = ['PanelBackground.png', 'PopupBackgroundPattern.png']

export const ATLAS = /^sactx-\d+-\d+x\d+-[^-]+-(.+)-[0-9a-f]{6,}\.png$/
const SPRITE_NAME = /^[A-Za-z][\w-]{0,63}$/
const SLOT_NAME = /^[a-z][a-z0-9_]{0,23}$/
export const MAX_SPRITES = 4000

/* Texture files are the display name without spaces, punctuation kept. */
export const compactName = (name) => String(name).replace(/ /g, '')
export const themeKey = (label) =>
  String(label)
    .toLowerCase()
    .replace(/ ui$/, '')
    .replace(/[^a-z0-9]/g, '')
/** "Rhythmi Star" from a sheet's file name, or null. */
export const atlasLabel = (file) => String(file).match(ATLAS)?.[1] ?? null
const prettyLabel = (label) => label.replace(/([a-z])([A-Z])/g, '$1 $2')

/* ---------- Unity YAML ---------- */

/* A YAML scalar as Unity writes it: plain, '…' ('' = ') or "…" (\-escapes). */
export function yamlScalar(raw) {
  const value = String(raw ?? '').trim()
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) return value.slice(1, -1).replace(/''/g, "'")
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    try {
      return JSON.parse(value)
    } catch {
      return value.slice(1, -1)
    }
  }
  return value
}

/** One "<Id> - <Name>.asset": `{ id, name, description, tags }` or null. */
export function parseItemAsset(text) {
  const source = String(text ?? '')
  const id = source.match(/^ {2}Id: (\d+)\s*$/m)?.[1]
  const nameLine = source.match(/^ {2}Name: (.*)$/m)?.[1]
  if (!id || nameLine === undefined) return null
  const tagBlock = source.match(/^ {2}Tags:\s*\n((?: {2}- .*\n?)*)/m)?.[1] ?? ''
  return {
    id,
    name: yamlScalar(nameLine),
    description: String(yamlScalar(source.match(/^ {2}Description: (.*)$/m)?.[1] ?? '')).slice(0, 500),
    tags: [...tagBlock.matchAll(/^ {2}- (.*)$/gm)].map((match) => yamlScalar(match[1])),
  }
}

/** One Sprite/*.asset: `{ name, guid, rect: [x, y, w, h], border: [l, b, r, t] }` (Unity: y from the bottom) or null. */
export function parseSpriteAsset(text) {
  const source = String(text ?? '')
  const name = source.match(/^ {2}m_Name: (.*)$/m)?.[1]?.trim()
  if (!name || !SPRITE_NAME.test(name)) return null
  const rectBlock = source.match(/^ {2}m_Rect:\s*\n((?: {4}.*\n?){1,8})/m)?.[1] ?? ''
  const rect = ['x', 'y', 'width', 'height'].map((key) => Number(rectBlock.match(new RegExp(`^ {4}${key}: (-?[\\d.e+-]+)`, 'm'))?.[1] ?? NaN))
  const border = source.match(/m_Border: \{x: ([\d.]+), y: ([\d.]+), z: ([\d.]+), w: ([\d.]+)\}/)?.slice(1, 5).map(Number) ?? [0, 0, 0, 0]
  const guid = source.match(/m_RD:[\s\S]*?texture: \{fileID: \d+, guid: ([0-9a-f]{32})/)?.[1]
  if (!guid || rect.some((value) => !Number.isFinite(value))) return null
  return { name, guid, rect, border }
}

/** The GUID in a .meta file. */
export const metaGuid = (text) => String(text ?? '').match(/^guid: ([0-9a-f]{32})/m)?.[1] ?? null

/* ---------- items ---------- */

/** The item's slot tag ("skin", "hat", "emote", …) or null. */
export function slotOf(item) {
  const slot = item?.tags?.find((tag) => String(tag).startsWith('itemslot:'))?.slice(9)
  return slot && SLOT_NAME.test(slot) ? slot : null
}

export const drawable = (slot) => Boolean(SLOT_FILES[slot])

/**
 * An item's textures: `{ key: file }`, or `{ missing: [...] }` when a slot
 * the site draws lacks one of its layers. Other slots keep what exists.
 */
export function itemFiles(item, slot, has) {
  const base = compactName(item.name)
  if (SLOT_FILES[slot]) {
    const files = Object.fromEntries(Object.entries(SLOT_FILES[slot]).map(([key, suffix]) => [key, `${base}${suffix}.png`]))
    const missing = Object.values(files).filter((file) => !has(file))
    return missing.length ? { missing } : { files }
  }
  const files = Object.fromEntries(
    Object.entries(GENERIC_SUFFIXES)
      .map(([key, suffix]) => [key, `${base}${suffix}.png`])
      .filter(([, file]) => has(file)),
  )
  return Object.keys(files).length ? { files } : { missing: [`${base}Icon.png`] }
}

/* ---------- themes ---------- */

/** Standalone textures that may hold a theme piece called one of `names` ("ScrollbarHandle_0.png"). */
export function standaloneCandidates(textureNames, names) {
  return textureNames.filter((file) => {
    const match = file.match(/^([A-Za-z][\w-]*?)(?:_\d+)?\.png$/)
    return match && names.has(match[1])
  })
}

/**
 * The theme sprites to import from parsed Sprite assets and `guidToFile`
 * (texture GUID -> file name): everything on a sheet, plus standalone
 * textures with the name of a sheet piece (the default look).
 */
export function selectSprites(parsed, guidToFile) {
  const onSheets = parsed.filter((sprite) => ATLAS.test(guidToFile.get(sprite.guid) ?? ''))
  const names = new Set(onSheets.map((sprite) => sprite.name))
  const out = []
  for (const sprite of parsed) {
    const file = guidToFile.get(sprite.guid)
    if (!file || (!ATLAS.test(file) && !names.has(sprite.name))) continue
    out.push({ name: sprite.name, file, rect: sprite.rect, border: sprite.border })
  }
  return out.slice(0, MAX_SPRITES)
}

/** Which theme a sprite belongs to: its sheet's key, or "default" for standalone textures. */
export const themeOfSprite = (sprite) => {
  const label = atlasLabel(sprite.file)
  return label ? themeKey(label) : 'default'
}

/**
 * The themes in an import: `[{ id, name, item, icon }]` (default first).
 * `item` is the matching itemslot:uitheme item, if any.
 */
export function themesOf(items, sprites, has) {
  const byKey = new Map()
  for (const sprite of sprites) {
    const label = atlasLabel(sprite.file)
    if (label && !byKey.has(themeKey(label))) byKey.set(themeKey(label), label)
  }
  const themeItems = new Map(items.filter((item) => slotOf(item) === 'uitheme').map((item) => [themeKey(item.name), item]))
  const themes = sprites.some((sprite) => themeOfSprite(sprite) === 'default') ? [{ id: 'default', name: 'Default', item: null, icon: null }] : []
  for (const [id, label] of byKey) {
    const item = themeItems.get(id) ?? null
    const icons = [item && `${compactName(item.name)}Icon.png`, `${compactName(label)}UIIcon.png`, `${compactName(label)}Icon.png`].filter(Boolean)
    themes.push({ id, name: item ? item.name.replace(/ UI$/, '') : prettyLabel(label), item, icon: icons.find(has) ?? null })
  }
  return themes
}

/* ---------- what to import ---------- */

/* The game's fonts (Assets/Font): every .ttf / .otf, kept for later use. */
export const FONT_FILE = /^[^/\\]+\.(ttf|otf)$/i
const WEIGHTS = { thin: 100, extralight: 200, light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 }

/** "Nunito-ExtraBold.ttf" -> { file, family: "Nunito", weight: 800 }. */
export function fontInfo(file) {
  const stem = file.replace(/\.(ttf|otf)$/i, '')
  const [family, style = 'regular'] = stem.split('-')
  return { file, family, weight: WEIGHTS[style.toLowerCase()] ?? 400 }
}

/**
 * Plans an import from what the export contains (`textureNames`, `fontNames`).
 * Returns `{ files: Map(file -> purpose), items: [{ item, slot, files }], skipped: [{ id, name, missing }], themes, ui, problem }`.
 * Purposes: "layer" (a 256x256 cat layer), "icon", "ui", "sheet" (a theme sprite sheet), "extra", "font".
 */
export function planImport({ items, sprites = [], textureNames, fontNames = [] }) {
  const available = new Set(textureNames)
  const has = (file) => available.has(file)
  const files = new Map()
  const missingDefault = Object.values(DEFAULT_SKIN_FILES).filter((file) => !has(file))
  if (missingDefault.length) {
    return { files, items: [], skipped: [], themes: [], ui: {}, problem: `The default cat is missing (${missingDefault.join(', ')}). Is this a Bongo Cat export?` }
  }
  for (const file of Object.values(DEFAULT_SKIN_FILES)) files.set(file, 'layer')

  const ui = {}
  for (const [role, file] of Object.entries(UI_ICONS)) if (has(file)) ui[role] = file
  for (const file of textureNames) {
    const icon = file.match(/^Icon_(.+)\.png$/)?.[1]
    if (icon && !Object.values(ui).includes(file)) ui[`icon${icon.replace(/_/g, '')}`] = file
  }
  for (const file of Object.values(ui)) files.set(file, 'ui')
  for (const file of UI_EXTRAS) if (has(file)) files.set(file, 'extra')

  const planned = []
  const skipped = []
  for (const item of items) {
    const slot = slotOf(item)
    if (!slot || slot === 'uitheme') continue
    const result = itemFiles(item, slot, has)
    if (result.missing) {
      // Drawn slots need every layer; other slots without any texture are simply left out.
      if (drawable(slot)) skipped.push({ id: item.id, name: item.name, missing: result.missing })
      continue
    }
    planned.push({ item, slot, files: result.files })
    for (const [key, file] of Object.entries(result.files)) {
      if (!files.has(file)) files.set(file, drawable(slot) && key !== 'icon' ? 'layer' : 'icon')
    }
  }

  const usable = sprites.filter((sprite) => has(sprite.file))
  for (const sprite of usable) files.set(sprite.file, 'sheet')
  const themes = themesOf(items, usable, has)
  for (const theme of themes) if (theme.icon) files.set(theme.icon, 'icon')

  const fonts = fontNames.filter((file) => FONT_FILE.test(file) && !files.has(file)).map(fontInfo)
  for (const font of fonts) files.set(font.file, 'font')

  return { files, items: planned, skipped, themes, ui, sprites: usable, fonts, problem: null }
}

/**
 * Reads an export through `io` (the browser's picked files or the server's
 * folder), the same way on both sides:
 * `{ textureNames, fontNames?, itemNames, spriteNames, readItem(name), readSprite(name), readMeta(textureName) }`
 * (reads return text or null). Returns `{ items, sprites, plan }`.
 */
export async function scanExport(io, { onProgress = () => {}, signal } = {}) {
  const check = () => {
    if (signal?.aborted) throw new Error('Cancelled.')
  }
  const items = []
  for (const [index, name] of io.itemNames.entries()) {
    const item = parseItemAsset(await io.readItem(name))
    if (item) items.push(item)
    if (index % 200 === 0) {
      onProgress({ step: 'Reading item definitions', done: index, total: io.itemNames.length })
      check()
    }
  }

  // Theme sprites: sheets first (their GUIDs), then standalone textures named like a sheet piece.
  const guidToFile = new Map()
  const readGuids = async (names) => {
    for (const name of names) {
      const guid = metaGuid(await io.readMeta(name))
      if (guid) guidToFile.set(guid, name)
    }
  }
  await readGuids(io.textureNames.filter((name) => ATLAS.test(name)))
  const parsed = []
  if (guidToFile.size) {
    for (const [index, name] of io.spriteNames.entries()) {
      const sprite = parseSpriteAsset(await io.readSprite(name))
      if (sprite) parsed.push(sprite)
      if (index % 400 === 0) {
        onProgress({ step: 'Reading UI themes', done: index, total: io.spriteNames.length })
        check()
      }
    }
    const sheetNames = new Set(parsed.filter((sprite) => guidToFile.has(sprite.guid)).map((sprite) => sprite.name))
    await readGuids(standaloneCandidates(io.textureNames, sheetNames))
  }
  const sprites = selectSprites(parsed, guidToFile)
  const plan = planImport({ items, sprites, textureNames: io.textureNames, fontNames: io.fontNames ?? [] })
  return { items, sprites: plan.sprites ?? sprites, plan }
}
