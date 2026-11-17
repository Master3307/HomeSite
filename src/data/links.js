import { discordInviteUrl } from '../lib/siteConfig.js'

/*
 * The links on /card. `icon` is a key of BRANDS in components/BrandIcon.jsx,
 * `label` the brand name, the description comes from card.json (links.<id>).
 * Entries without a URL (e.g. no Discord invite configured) are left out.
 */
export const LINKS = [
  { id: 'github', icon: 'github', label: 'GitHub', handle: 'Master3307', url: 'https://github.com/Master3307' },
  { id: 'youtube', icon: 'youtube', label: 'YouTube', handle: '@Master3307', url: 'https://www.youtube.com/@master3307' },
  { id: 'discord', icon: 'discord', label: 'Discord', handle: 'Cult of black Cats', url: discordInviteUrl },
  { id: 'steam', icon: 'steam', label: 'Steam', handle: 'master3307', url: 'https://steamcommunity.com/id/master3307/' },
  { id: 'modrinth', icon: 'modrinth', label: 'Modrinth', handle: 'Master3307', url: 'https://modrinth.com/user/Master3307' },
  { id: 'nexusmods', icon: 'nexusmods', label: 'Nexus Mods', handle: 'Master3307', url: 'https://next.nexusmods.com/profile/Master3307' },
  { id: 'spotify', icon: 'spotify', label: 'Spotify', handle: 'Master3307', url: 'https://open.spotify.com/user/31my4lm5nu6eeti44jz3aid65tdi' },
  { id: 'twitch', icon: 'twitch', label: 'Twitch', handle: 'master3307', url: 'https://twitch.tv/master3307' },
  { id: 'wakatime', icon: 'wakatime', label: 'WakaTime', handle: '@Master3307', url: 'https://wakatime.com/@Master3307' },
].filter((link) => link.url)

/*
 * My setup (/card): each part is shown in 3D (components/setup). `model`
 * names the builder in components/setup/models.js; `facts` are keys of
 * card.json (setup.facts.*). Brand and model names stay untranslated.
 */
export const SETUP = [
  { id: 'setup', model: 'setup', icon: 'desk', nameKey: 'setup.setupName', facts: ['setupParts', 'setupPick'], options: ['cables'] },
  { id: 'pc', model: 'pc', icon: 'computer', nameKey: 'setup.pcName', facts: ['pcParts', 'pcPick'], options: ['cables'] },
  { id: 'cpu', model: 'cpu', icon: 'memory', name: 'AMD Ryzen 5 5600X', facts: ['cores', 'clock', 'socket'] },
  { id: 'gpu', model: 'gpu', icon: 'videogame_asset', name: 'Gigabyte GeForce RTX 4060 AERO OC 8G', facts: ['vram', 'cooling', 'outputs'] },
  { id: 'ram', model: 'ram', icon: 'memory_alt', name: 'Kingston FURY Beast DDR4', facts: ['capacity', 'type'] },
  { id: 'board', model: 'board', icon: 'developer_board', name: 'Gigabyte B550M DS3H', facts: ['format', 'chipset', 'slots'] },
  { id: 'displays', model: 'displays', icon: 'desktop_windows', name: 'LG 22″ IPS + Samsung S22D300', facts: ['resolution', 'screens'] },
  { id: 'keyboard', model: 'keyboard', icon: 'keyboard', name: 'HyperX Alloy Elite RGB', facts: ['kbLayout', 'kbLight'] },
  { id: 'mouse', model: 'mouse', icon: 'mouse', name: 'Redragon M908 Impact', facts: ['mouseButtons', 'mouseDpi'] },
  { id: 'mic', model: 'mic', icon: 'mic', name: 'HyperX QuadCast', facts: ['micPatterns', 'micMute'] },
  { id: 'software', model: null, icon: 'terminal', nameKey: 'setup.softwareName', facts: [] },
]

/*
 * What the screens and the "About this System" window show: KDE Plasma on
 * CachyOS as set up (kinfo / fastfetch output, November 2026). Update the
 * versions now and then.
 */
export const SOFTWARE = {
  os: 'CachyOS Linux',
  desktop: 'KDE Plasma',
  plasma: '6.8.2',
  frameworks: '6.31.0',
  qt: '6.12.0',
  kernel: '7.3.3-1-cachyos',
  platform: 'Wayland',
  wm: 'KWin (Wayland)',
  theme: 'Darkly',
  colors: 'MateriaDark',
  icons: 'Papirus-Dark',
  font: 'Google Sans Flex',
  processors: '12 × AMD Ryzen 5 5600X 6-Core Processor',
  memory: { total: 32, usable: 31.3 },
  graphics: 'NVIDIA GeForce RTX 4060',
  // As the system reports it (the PC was built by CSL).
  manufacturer: 'CSL Computer GmbH',
  product: '5814',
  version: '-CF',
}

/*
 * What I build with (/card): Simple Icons keys in components/BrandIcon.jsx,
 * the name shown on hover and the link in the card a click opens
 * (descriptions in card.json skills.items). The things without a logo are in card.json
 * (skills.also).
 */
export const TOOLBELT = [
  { icon: 'javascript', label: 'JavaScript', url: 'https://developer.mozilla.org/docs/Web/JavaScript' },
  { icon: 'react', label: 'React', url: 'https://react.dev/' },
  { icon: 'nodedotjs', label: 'Node.js', url: 'https://nodejs.org/' },
  { icon: 'vite', label: 'Vite', url: 'https://vite.dev/' },
  { icon: 'html5', label: 'HTML', url: 'https://developer.mozilla.org/docs/Web/HTML' },
  { icon: 'css3', label: 'CSS', url: 'https://developer.mozilla.org/docs/Web/CSS' },
  { icon: 'sqlite', label: 'SQLite', url: 'https://sqlite.org/' },
  { icon: 'git', label: 'Git', url: 'https://git-scm.com/' },
  { icon: 'linux', label: 'Linux', url: 'https://kernel.org/' },
  { icon: 'archlinux', label: 'Arch / CachyOS', url: 'https://cachyos.org/' },
  { icon: 'kde', label: 'KDE Plasma', url: 'https://kde.org/plasma-desktop/' },
]

/* The first version of the site (static, still online), named on /about. */
export const OLD_SITE_URL = 'https://old.master3307.org/'
