# SearXNG for Master Search

Master Search (`/search`, `server/services/masterSearch.cjs`) sends every web search to your own
SearXNG and shows its answer. This page covers running one, the settings that matter, and checking it.

```bash
pnpm searxng:check            # tests SEARXNG_URL from this server: JSON on? speed, engines, failures
pnpm searxng:check daft punk  # with your own words
```

## 1. Run it next to the site

The simplest setup is the official Docker compose ([searxng/searxng-docker](https://github.com/searxng/searxng-docker)),
listening only on this machine:

```yaml
# docker-compose.yml (excerpt)
services:
  searxng:
    image: docker.io/searxng/searxng:latest
    ports:
      - "127.0.0.1:8888:8080"
    volumes:
      - ./searxng:/etc/searxng:rw
    environment:
      - SEARXNG_BASE_URL=https://search.example.com/
  valkey: # the limiter keeps its counts here
    image: docker.io/valkey/valkey:8-alpine
    command: valkey-server --save 30 1 --loglevel warning
```

Then in `.env`:

```env
SEARXNG_URL=http://127.0.0.1:8888
```

Use the local address, not the public one. The site then asks SearXNG directly, with no Cloudflare,
redirect rules or limiter in between (private addresses are allowed here because the owner sets this
value, not a visitor). The public address (`SEARCH_ENGINE_URL`, the dash's "own search engine") can
still point at the same SearXNG for people's browsers.

> `SEARCH_ENGINE_URL` must be the SearXNG itself. A redirect rule that sends `/search` on to
> DuckDuckGo or Google is not a SearXNG: Master Search refuses such answers, and `pnpm searxng:check`
> says where the address really goes.

## 2. settings.yml

`searxng/settings.yml`. Everything left out keeps SearXNG's defaults:

```yaml
use_default_settings:
  engines:
    # Fewer, good engines answer faster and fail less than all of them.
    keep_only:
      - google
      - bing
      - duckduckgo
      - brave
      - qwant
      - startpage
      - mojeek
      - wikipedia
      - wikidata
      - google images
      - bing images
      - duckduckgo images
      - unsplash
      - youtube
      - google videos
      - bing videos
      - google news
      - bing news
      - openstreetmap
      - photon
      - soundcloud
      - bandcamp
      - arxiv
      - google scholar
      - github
      - stackoverflow
      - mdn
      - npm
      - pypi
      - docker hub
      - reddit
      - lemmy posts

general:
  instance_name: "HomeSite Search"

search:
  formats: [html, json] # Master Search needs json
  autocomplete: duckduckgo # the suggestions while typing (/search/suggest)
  safe_search: 2 # the default for people using SearXNG directly; Master Search always sends its own

server:
  secret_key: "change-me" # openssl rand -hex 32
  limiter: true # keeps bots from getting this server banned by the engines
  public_instance: false
  image_proxy: true

outgoing:
  request_timeout: 3.0 # one slow engine shouldn't hold up the page
  max_request_timeout: 6.0
  pool_connections: 100
  pool_maxsize: 20
  # When engines start answering with CAPTCHAs (pnpm searxng:check lists them):
  # proxies:
  #   all://:
  #     - socks5h://127.0.0.1:1080
```

## 3. limiter.toml (the bot blocker)

The limiter protects SearXNG from bots that would get your server's address blocked by Google,
Bing and the others. It needs Valkey or Redis (in the compose above). Let the site's own requests
through. They come from this machine and are already rate-limited by the account API (40 a minute
per visitor, 120 logged in):

```toml
# searxng/limiter.toml
[botdetection.ip_lists]
pass_ip = ["127.0.0.1", "::1"]
```

## 4. When results get thin

| What `pnpm searxng:check` says | What to change |
| --- | --- |
| JSON output is off / 403 | `search.formats: [html, json]` |
| 429 from the limiter | add the site server's address to `pass_ip` |
| Slow (over 4 s) | lower `outgoing.request_timeout`, or drop the slow engines from `keep_only` |
| Engines failed: CAPTCHA / access denied | turn those off, or send them through `outgoing.proxies` |
| A tab says "none on" | add an engine of that kind to `keep_only` |
| No autocompleter | `search.autocomplete: duckduckgo` |

For the times SearXNG still has nothing, set `SEARCH_FALLBACK_KEY` (a free Brave Search API key):
logged-in people then get Brave's results, at most `SEARCH_FALLBACK_MONTHLY` a month (2000 by default).
