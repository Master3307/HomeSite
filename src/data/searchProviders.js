/*
 * Search engines for the dash's "Add from list" (DashSettings.jsx): name,
 * address (%s is the search), !keyword, category. Entries with `start` are in
 * a new dash (hidden ones with `hidden`); removing any of them puts it back
 * into this list, and adding it again resets changes made to it.
 */

export const PROVIDER_CATEGORIES = ['web', 'knowledge', 'ai', 'dev', 'linux', 'media', 'music', 'shopping', 'maps', 'language', 'social', 'games', 'minecraft', 'images']

export const PROVIDER_CATALOG = [
  // web
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s', keyword: 'ddg', category: 'web', start: true },
  { id: 'startpage', name: 'Startpage', url: 'https://www.startpage.com/do/search?q=%s', keyword: 'sp', category: 'web', start: true, hidden: true },
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=%s', keyword: 'g', category: 'web' },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=%s', keyword: 'b', category: 'web' },
  { id: 'brave', name: 'Brave Search', url: 'https://search.brave.com/search?q=%s', keyword: 'br', category: 'web' },
  { id: 'ecosia', name: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s', keyword: 'eco', category: 'web' },
  { id: 'qwant', name: 'Qwant', url: 'https://www.qwant.com/?q=%s', keyword: 'qw', category: 'web' },
  { id: 'kagi', name: 'Kagi', url: 'https://kagi.com/search?q=%s', keyword: 'kagi', category: 'web' },
  { id: 'mojeek', name: 'Mojeek', url: 'https://www.mojeek.com/search?q=%s', keyword: 'mj', category: 'web' },
  { id: 'yahoo', name: 'Yahoo', url: 'https://search.yahoo.com/search?p=%s', keyword: 'y', category: 'web' },
  { id: 'yandex', name: 'Yandex', url: 'https://yandex.com/search/?text=%s', keyword: 'ya', category: 'web' },
  { id: 'baidu', name: 'Baidu', url: 'https://www.baidu.com/s?wd=%s', keyword: 'bd', category: 'web' },
  { id: 'metager', name: 'MetaGer', url: 'https://metager.org/meta/meta.ger3?eingabe=%s', keyword: 'mg', category: 'web' },
  // knowledge
  { id: 'wikipedia', name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=%s', keyword: 'w', category: 'knowledge', start: true, hidden: true },
  { id: 'wikipediaDe', name: 'Wikipedia (Deutsch)', url: 'https://de.wikipedia.org/w/index.php?search=%s', keyword: 'wde', category: 'knowledge' },
  { id: 'wiktionary', name: 'Wiktionary', url: 'https://en.wiktionary.org/w/index.php?search=%s', keyword: 'wt', category: 'knowledge' },
  { id: 'wolfram', name: 'Wolfram|Alpha', url: 'https://www.wolframalpha.com/input?i=%s', keyword: 'wa', category: 'knowledge' },
  { id: 'archive', name: 'Internet Archive', url: 'https://archive.org/search?query=%s', keyword: 'ia', category: 'knowledge' },
  { id: 'wayback', name: 'Wayback Machine', url: 'https://web.archive.org/web/*/%s', keyword: 'wb', category: 'knowledge' },
  { id: 'scholar', name: 'Google Scholar', url: 'https://scholar.google.com/scholar?q=%s', keyword: 'gs', category: 'knowledge' },
  { id: 'arxiv', name: 'arXiv', url: 'https://arxiv.org/search/?query=%s&searchtype=all', keyword: 'arxiv', category: 'knowledge' },
  // ai
  { id: 'perplexity', name: 'Perplexity', url: 'https://www.perplexity.ai/search?q=%s', keyword: 'px', category: 'ai' },
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/?q=%s', keyword: 'gpt', category: 'ai' },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai/new?q=%s', keyword: 'claude', category: 'ai' },
  { id: 'phind', name: 'Phind', url: 'https://www.phind.com/search?q=%s', keyword: 'phind', category: 'ai' },
  // dev
  { id: 'github', name: 'GitHub', url: 'https://github.com/search?q=%s', keyword: 'gh', category: 'dev', start: true, hidden: true },
  { id: 'gitlab', name: 'GitLab', url: 'https://gitlab.com/search?search=%s', keyword: 'gl', category: 'dev' },
  { id: 'codeberg', name: 'Codeberg', url: 'https://codeberg.org/explore/repos?q=%s', keyword: 'cb', category: 'dev' },
  { id: 'stackoverflow', name: 'Stack Overflow', url: 'https://stackoverflow.com/search?q=%s', keyword: 'so', category: 'dev' },
  { id: 'mdn', name: 'MDN Web Docs', url: 'https://developer.mozilla.org/en-US/search?q=%s', keyword: 'mdn', category: 'dev' },
  { id: 'npm', name: 'npm', url: 'https://www.npmjs.com/search?q=%s', keyword: 'npm', category: 'dev' },
  { id: 'pypi', name: 'PyPI', url: 'https://pypi.org/search/?q=%s', keyword: 'pypi', category: 'dev' },
  { id: 'crates', name: 'crates.io', url: 'https://crates.io/search?q=%s', keyword: 'crates', category: 'dev' },
  { id: 'dockerhub', name: 'Docker Hub', url: 'https://hub.docker.com/search?q=%s', keyword: 'docker', category: 'dev' },
  { id: 'gopkg', name: 'Go packages', url: 'https://pkg.go.dev/search?q=%s', keyword: 'go', category: 'dev' },
  { id: 'caniuse', name: 'Can I use', url: 'https://caniuse.com/?search=%s', keyword: 'ciu', category: 'dev' },
  { id: 'devdocs', name: 'DevDocs', url: 'https://devdocs.io/#q=%s', keyword: 'dd', category: 'dev' },
  { id: 'bundlephobia', name: 'Bundlephobia', url: 'https://bundlephobia.com/package/%s', keyword: 'bp', category: 'dev' },
  { id: 'sourcegraph', name: 'Sourcegraph', url: 'https://sourcegraph.com/search?q=%s', keyword: 'sg', category: 'dev' },
  // linux
  { id: 'archwiki', name: 'ArchWiki', url: 'https://wiki.archlinux.org/index.php?search=%s', keyword: 'aw', category: 'linux' },
  { id: 'archpkg', name: 'Arch packages', url: 'https://archlinux.org/packages/?q=%s', keyword: 'arch', category: 'linux' },
  { id: 'aur', name: 'AUR', url: 'https://aur.archlinux.org/packages?K=%s', keyword: 'aur', category: 'linux' },
  { id: 'flathub', name: 'Flathub', url: 'https://flathub.org/apps/search?q=%s', keyword: 'flat', category: 'linux' },
  { id: 'debian', name: 'Debian packages', url: 'https://packages.debian.org/search?keywords=%s', keyword: 'deb', category: 'linux' },
  { id: 'ubuntu', name: 'Ubuntu packages', url: 'https://packages.ubuntu.com/search?keywords=%s', keyword: 'ubu', category: 'linux' },
  { id: 'nixpkgs', name: 'Nix packages', url: 'https://search.nixos.org/packages?query=%s', keyword: 'nix', category: 'linux' },
  { id: 'protondb', name: 'ProtonDB', url: 'https://www.protondb.com/search?q=%s', keyword: 'proton', category: 'linux' },
  // media
  { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com/results?search_query=%s', keyword: 'yt', category: 'media', start: true, hidden: true },
  { id: 'twitch', name: 'Twitch', url: 'https://www.twitch.tv/search?term=%s', keyword: 'tw', category: 'media' },
  { id: 'imdb', name: 'IMDb', url: 'https://www.imdb.com/find/?q=%s', keyword: 'imdb', category: 'media' },
  { id: 'tmdb', name: 'TMDB', url: 'https://www.themoviedb.org/search?query=%s', keyword: 'tmdb', category: 'media' },
  { id: 'letterboxd', name: 'Letterboxd', url: 'https://letterboxd.com/search/%s/', keyword: 'lb', category: 'media' },
  { id: 'justwatch', name: 'JustWatch', url: 'https://www.justwatch.com/de/Suche?q=%s', keyword: 'jw', category: 'media' },
  { id: 'goodreads', name: 'Goodreads', url: 'https://www.goodreads.com/search?q=%s', keyword: 'gr', category: 'media' },
  { id: 'anilist', name: 'AniList', url: 'https://anilist.co/search/anime?search=%s', keyword: 'ani', category: 'media' },
  { id: 'myanimelist', name: 'MyAnimeList', url: 'https://myanimelist.net/search/all?q=%s', keyword: 'mal', category: 'media' },
  // music
  { id: 'spotify', name: 'Spotify', url: 'https://open.spotify.com/search/%s', keyword: 'spot', category: 'music' },
  { id: 'youtubemusic', name: 'YouTube Music', url: 'https://music.youtube.com/search?q=%s', keyword: 'ytm', category: 'music' },
  { id: 'soundcloud', name: 'SoundCloud', url: 'https://soundcloud.com/search?q=%s', keyword: 'sc', category: 'music' },
  { id: 'bandcamp', name: 'Bandcamp', url: 'https://bandcamp.com/search?q=%s', keyword: 'bc', category: 'music' },
  { id: 'genius', name: 'Genius', url: 'https://genius.com/search?q=%s', keyword: 'lyrics', category: 'music' },
  { id: 'lastfm', name: 'Last.fm', url: 'https://www.last.fm/search?q=%s', keyword: 'lfm', category: 'music' },
  { id: 'discogs', name: 'Discogs', url: 'https://www.discogs.com/search/?q=%s', keyword: 'discogs', category: 'music' },
  { id: 'musicbrainz', name: 'MusicBrainz', url: 'https://musicbrainz.org/search?query=%s&type=artist', keyword: 'mb', category: 'music' },
  // shopping
  { id: 'amazonDe', name: 'Amazon.de', url: 'https://www.amazon.de/s?k=%s', keyword: 'amz', category: 'shopping' },
  { id: 'amazon', name: 'Amazon.com', url: 'https://www.amazon.com/s?k=%s', keyword: 'amzus', category: 'shopping' },
  { id: 'ebayDe', name: 'eBay.de', url: 'https://www.ebay.de/sch/i.html?_nkw=%s', keyword: 'ebay', category: 'shopping' },
  { id: 'kleinanzeigen', name: 'Kleinanzeigen', url: 'https://www.kleinanzeigen.de/s-%s/k0', keyword: 'ka', category: 'shopping' },
  { id: 'geizhals', name: 'Geizhals', url: 'https://geizhals.de/?fs=%s', keyword: 'gz', category: 'shopping' },
  { id: 'idealo', name: 'idealo', url: 'https://www.idealo.de/preisvergleich/MainSearchProductCategory.html?q=%s', keyword: 'idealo', category: 'shopping' },
  { id: 'aliexpress', name: 'AliExpress', url: 'https://www.aliexpress.com/wholesale?SearchText=%s', keyword: 'ali', category: 'shopping' },
  // maps
  { id: 'googlemaps', name: 'Google Maps', url: 'https://www.google.com/maps/search/%s', keyword: 'maps', category: 'maps' },
  { id: 'osm', name: 'OpenStreetMap', url: 'https://www.openstreetmap.org/search?query=%s', keyword: 'osm', category: 'maps' },
  { id: 'applemaps', name: 'Apple Maps', url: 'https://maps.apple.com/?q=%s', keyword: 'amaps', category: 'maps' },
  // language
  { id: 'deepl', name: 'DeepL', url: 'https://www.deepl.com/translator#auto/de/%s', keyword: 'deepl', category: 'language' },
  { id: 'googletranslate', name: 'Google Translate', url: 'https://translate.google.com/?sl=auto&tl=de&text=%s', keyword: 'gt', category: 'language' },
  { id: 'dictcc', name: 'dict.cc', url: 'https://www.dict.cc/?s=%s', keyword: 'dict', category: 'language' },
  { id: 'leo', name: 'LEO', url: 'https://dict.leo.org/englisch-deutsch/%s', keyword: 'leo', category: 'language' },
  { id: 'duden', name: 'Duden', url: 'https://www.duden.de/suchen/dudenonline/%s', keyword: 'duden', category: 'language' },
  { id: 'linguee', name: 'Linguee', url: 'https://www.linguee.de/deutsch-englisch/search?query=%s', keyword: 'lin', category: 'language' },
  { id: 'urban', name: 'Urban Dictionary', url: 'https://www.urbandictionary.com/define.php?term=%s', keyword: 'ud', category: 'language' },
  { id: 'thesaurus', name: 'Thesaurus.com', url: 'https://www.thesaurus.com/browse/%s', keyword: 'syn', category: 'language' },
  // social
  { id: 'reddit', name: 'Reddit', url: 'https://www.reddit.com/search/?q=%s', keyword: 'r', category: 'social' },
  { id: 'x', name: 'X', url: 'https://x.com/search?q=%s', keyword: 'x', category: 'social' },
  { id: 'bluesky', name: 'Bluesky', url: 'https://bsky.app/search?q=%s', keyword: 'bsky', category: 'social' },
  { id: 'mastodon', name: 'Mastodon (mastodon.social)', url: 'https://mastodon.social/search?q=%s', keyword: 'masto', category: 'social' },
  { id: 'hackernews', name: 'Hacker News', url: 'https://hn.algolia.com/?q=%s', keyword: 'hn', category: 'social' },
  // games
  { id: 'steam', name: 'Steam', url: 'https://store.steampowered.com/search/?term=%s', keyword: 'steam', category: 'games' },
  { id: 'steamdb', name: 'SteamDB', url: 'https://steamdb.info/search/?a=all&q=%s', keyword: 'sdb', category: 'games' },
  { id: 'hltb', name: 'HowLongToBeat', url: 'https://howlongtobeat.com/?q=%s', keyword: 'hltb', category: 'games' },
  { id: 'igdb', name: 'IGDB', url: 'https://www.igdb.com/search?type=1&q=%s', keyword: 'igdb', category: 'games' },
  { id: 'gog', name: 'GOG', url: 'https://www.gog.com/en/games?query=%s', keyword: 'gog', category: 'games' },
  { id: 'itch', name: 'itch.io', url: 'https://itch.io/search?q=%s', keyword: 'itch', category: 'games' },
  // minecraft
  { id: 'namemc', name: 'NameMC', url: 'https://namemc.com/search?q=%s', keyword: 'namemc', category: 'minecraft', start: true, hidden: true, minecraft: 'https://namemc.com/profile/%s' },
  { id: 'labymod', name: 'LabyMod', url: 'https://laby.net/@%s', keyword: 'laby', category: 'minecraft', minecraft: 'https://laby.net/@%s' },
  { id: 'mcuuid', name: 'MCUUID', url: 'https://mcuuid.net/?q=%s', keyword: 'mcuuid', category: 'minecraft', minecraft: 'https://mcuuid.net/?q=%s' },
  { id: 'crafty', name: 'Crafty', url: 'https://crafty.gg/@%s', keyword: 'crafty', category: 'minecraft', minecraft: 'https://crafty.gg/@%s' },
  { id: 'minecraftwiki', name: 'Minecraft Wiki', url: 'https://minecraft.wiki/w/Special:Search?search=%s', keyword: 'mcw', category: 'minecraft' },
  { id: 'modrinth', name: 'Modrinth', url: 'https://modrinth.com/mods?q=%s', keyword: 'mr', category: 'minecraft' },
  { id: 'curseforge', name: 'CurseForge', url: 'https://www.curseforge.com/minecraft/search?search=%s', keyword: 'cf', category: 'minecraft' },
  // images
  { id: 'googleimages', name: 'Google Images', url: 'https://www.google.com/search?tbm=isch&q=%s', keyword: 'gi', category: 'images' },
  { id: 'unsplash', name: 'Unsplash', url: 'https://unsplash.com/s/photos/%s', keyword: 'us', category: 'images' },
  { id: 'pixabay', name: 'Pixabay', url: 'https://pixabay.com/images/search/%s/', keyword: 'pxb', category: 'images' },
  { id: 'wikimedia', name: 'Wikimedia Commons', url: 'https://commons.wikimedia.org/w/index.php?search=%s', keyword: 'wc', category: 'images' },
]

export const catalogEntry = (id) => PROVIDER_CATALOG.find((entry) => entry.id === id) ?? null
