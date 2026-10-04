import path from "node:path";
import { fileURLToPath } from "node:url";
import { ActivityType } from "discord.js";

import {
  IGDB_CLIENT_ID,
  IGDB_CLIENT_SECRET,
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  STEAMGRIDDB_API,
  STEAMGRIDDB_API_KEY,
} from "./config.js";

import { readJsonFile, writeJsonFile } from "./file-store.js";

import { normalizeName, safeJsonParseArray, scoreNameMatch } from "./utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GAME_IMAGE_CACHE_PATH = path.join(
  __dirname,
  "..",
  "db",
  "game_image_cache.json",
);

export function createEnrichmentService() {
  let spotifyTokenCache = {
    access_token: null,
    expires_at: 0,
  };

  let igdbTokenCache = {
    access_token: null,
    expires_at: 0,
  };

  let gameImageCache = {};

  async function loadGameImageCache() {
    gameImageCache = await readJsonFile(GAME_IMAGE_CACHE_PATH, {});
  }

  async function saveGameImageCache() {
    await writeJsonFile(GAME_IMAGE_CACHE_PATH, gameImageCache);
  }

  async function getSpotifyAccessToken() {
    const now = Date.now();

    if (
      spotifyTokenCache.access_token &&
      spotifyTokenCache.expires_at > now + 60000
    ) {
      return spotifyTokenCache.access_token;
    }

    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
      return null;
    }

    const basic = Buffer.from(
      `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`,
    ).toString("base64");

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    spotifyTokenCache = {
      access_token: data.access_token,
      expires_at: Date.now() + Number(data.expires_in || 0) * 1000,
    };

    return spotifyTokenCache.access_token;
  }

  async function fetchSpotifyTrackMeta(trackId) {
    if (!trackId) return null;

    const token = await getSpotifyAccessToken();

    if (!token) return null;

    try {
      const response = await fetch(
        `https://api.spotify.com/v1/tracks/${encodeURIComponent(trackId)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        },
      );

      if (!response.ok) {
        return null;
      }

      const track = await response.json();

      return {
        song_url:
          track?.external_urls?.spotify ??
          (track?.id ? `https://open.spotify.com/track/${track.id}` : null),
        album_url: track?.album?.external_urls?.spotify ?? null,
        artists: Array.isArray(track?.artists)
          ? track.artists
              .map((artist) => ({
                id: artist?.id ?? null,
                name: artist?.name ?? null,
                url:
                  artist?.external_urls?.spotify ??
                  (artist?.id
                    ? `https://open.spotify.com/artist/${artist.id}`
                    : null),
              }))
              .filter((artist) => artist.name && artist.url)
          : [],
      };
    } catch (error) {
      console.warn(
        `Failed Spotify metadata lookup for track ${trackId}:`,
        error.message,
      );

      return null;
    }
  }

  async function enrichSpotifyActivityLinks(row) {
    const isSpotify =
      row.kind === "music" ||
      row.name === "Spotify" ||
      Number(row.type) === ActivityType.Listening;

    if (!isSpotify) {
      return row;
    }

    const currentSyncId = row.sync_id || null;
    const previousSyncId = row.last_sync_id || null;
    const trackChanged = !!currentSyncId && currentSyncId !== previousSyncId;

    if (!currentSyncId) {
      row.song_url = row.song_url || null;
      row.album_url = row.album_url || null;
      row.artist_links_json = row.artist_links_json || "[]";
      row.last_sync_id = previousSyncId;

      return row;
    }

    const alreadyEnriched =
      !trackChanged &&
      row.song_url &&
      safeJsonParseArray(row.artist_links_json).length > 0;

    if (alreadyEnriched) {
      return row;
    }

    const metadata = await fetchSpotifyTrackMeta(currentSyncId);

    if (!metadata) {
      row.song_url = `https://open.spotify.com/track/${currentSyncId}`;
      row.album_url = null;
      row.artist_links_json = "[]";
      row.last_sync_id = currentSyncId;

      return row;
    }

    row.song_url =
      metadata.song_url || `https://open.spotify.com/track/${currentSyncId}`;

    row.album_url = metadata.album_url || null;
    row.artist_links_json = JSON.stringify(metadata.artists || []);
    row.last_sync_id = currentSyncId;

    return row;
  }

  function buildIgdbImageUrl(imageId, size = "cover_small") {
    if (!imageId) return null;

    return `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg`;
  }

  async function getIgdbAccessToken() {
    const now = Date.now();

    if (
      igdbTokenCache.access_token &&
      igdbTokenCache.expires_at > now + 60000
    ) {
      return igdbTokenCache.access_token;
    }

    if (!IGDB_CLIENT_ID || !IGDB_CLIENT_SECRET) {
      return null;
    }

    const tokenUrl = new URL("https://id.twitch.tv/oauth2/token");

    tokenUrl.searchParams.set("client_id", IGDB_CLIENT_ID);
    tokenUrl.searchParams.set("client_secret", IGDB_CLIENT_SECRET);
    tokenUrl.searchParams.set("grant_type", "client_credentials");

    const response = await fetch(tokenUrl, {
      method: "POST",
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    igdbTokenCache = {
      access_token: data.access_token,
      expires_at: Date.now() + Number(data.expires_in || 0) * 1000,
    };

    return igdbTokenCache.access_token;
  }

  async function fetchIgdbGameIcon(gameName) {
    if (!gameName) return null;

    const token = await getIgdbAccessToken();

    if (!token) return null;

    try {
      const escapedGameName = String(gameName)
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"');

      const body = `fields name,cover.image_id; search "${escapedGameName}"; limit 5;`;

      const response = await fetch("https://api.igdb.com/v4/games", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Client-ID": IGDB_CLIENT_ID,
          Authorization: `Bearer ${token}`,
          "Content-Type": "text/plain",
        },
        body,
      });

      if (!response.ok) {
        return null;
      }

      const results = await response.json();

      if (!Array.isArray(results) || !results.length) {
        return null;
      }

      const chosen = [...results]
        .map((item) => ({
          item,
          score: scoreNameMatch(gameName, item?.name),
        }))
        .sort((first, second) => second.score - first.score)[0]?.item;

      return buildIgdbImageUrl(chosen?.cover?.image_id ?? null, "cover_small");
    } catch (error) {
      console.warn(`Failed IGDB fallback for ${gameName}:`, error.message);
      return null;
    }
  }

  async function steamGridDbRequest(endpoint, query = {}) {
    if (!STEAMGRIDDB_API_KEY) {
      return null;
    }

    const url = new URL(`${STEAMGRIDDB_API}${endpoint}`);

    for (const [key, value] of Object.entries(query)) {
      if (value != null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${STEAMGRIDDB_API_KEY}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return null;
    }

    return response.json();
  }

  async function searchSteamGridDbGame(gameName) {
    if (!gameName) {
      return null;
    }

    try {
      const data = await steamGridDbRequest(
        `/search/autocomplete/${encodeURIComponent(gameName)}`,
      );

      const list = Array.isArray(data?.data) ? data.data : [];

      if (!list.length) {
        return null;
      }

      return (
        [...list]
          .map((item) => {
            const game = item?.data ?? item;

            return {
              game,
              score: scoreNameMatch(gameName, game?.name),
            };
          })
          .sort((first, second) => second.score - first.score)[0]?.game ?? null
      );
    } catch (error) {
      console.warn(`Failed SteamGridDB search for ${gameName}:`, error.message);

      return null;
    }
  }

  function pickBestSteamGridDbAsset(items, preferredStyles = []) {
    if (!Array.isArray(items) || !items.length) {
      return null;
    }

    const styleRank = new Map(
      preferredStyles.map((style, index) => [style, index]),
    );

    const scored = items.map((item) => ({
      item,
      score:
        (styleRank.has(item.style) ? 100 - styleRank.get(item.style) : 0) +
        Number(item.score || 0),
    }));

    scored.sort((first, second) => second.score - first.score);

    return scored[0]?.item ?? null;
  }

  async function fetchSteamGridDbGameImage(gameName) {
    if (!gameName) {
      return null;
    }

    const cacheKey = `game:${normalizeName(gameName)}`;

    if (gameImageCache[cacheKey]) {
      return gameImageCache[cacheKey];
    }

    try {
      const game = await searchSteamGridDbGame(gameName);

      if (!game?.id) {
        return null;
      }

      const icons = await steamGridDbRequest(`/icons/game/${game.id}`, {
        styles: "official,custom",
        dimensions: "512,1024",
        mimes: "image/png",
        types: "static",
        nsfw: "false",
        humor: "false",
        epilepsy: "false",
        limit: 50,
      });

      const bestIcon = pickBestSteamGridDbAsset(icons?.data, [
        "official",
        "custom",
      ]);

      if (bestIcon?.url) {
        const payload = {
          url: bestIcon.url,
          thumb: bestIcon.thumb ?? null,
          source: "steamgriddb-icon",
          game_id: game.id,
          matched_name: game.name,
        };

        gameImageCache[cacheKey] = payload;

        await saveGameImageCache();

        return payload;
      }

      const grids = await steamGridDbRequest(`/grids/game/${game.id}`, {
        styles: "alternate,no_logo,material,blurred,white_logo",
        dimensions: "512x512,1024x1024",
        mimes: "image/png,image/webp,image/jpeg",
        types: "static",
        nsfw: "false",
        humor: "false",
        epilepsy: "false",
        limit: 50,
      });

      const bestGrid = pickBestSteamGridDbAsset(grids?.data, [
        "alternate",
        "no_logo",
        "material",
        "blurred",
        "white_logo",
      ]);

      if (bestGrid?.url) {
        const payload = {
          url: bestGrid.url,
          thumb: bestGrid.thumb ?? null,
          source: "steamgriddb-grid",
          game_id: game.id,
          matched_name: game.name,
        };

        gameImageCache[cacheKey] = payload;

        await saveGameImageCache();

        return payload;
      }

      return null;
    } catch (error) {
      console.warn(`Failed SteamGridDB lookup for ${gameName}:`, error.message);

      return null;
    }
  }

  async function fetchBestGameImage(gameName) {
    if (!gameName) {
      return null;
    }

    const cacheKey = `game:${normalizeName(gameName)}`;

    if (gameImageCache[cacheKey]) {
      return gameImageCache[cacheKey];
    }

    const steamGridDbResult = await fetchSteamGridDbGameImage(gameName);

    if (steamGridDbResult?.url) {
      return steamGridDbResult;
    }

    const igdbUrl = await fetchIgdbGameIcon(gameName);

    if (!igdbUrl) {
      return null;
    }

    const payload = {
      url: igdbUrl,
      thumb: igdbUrl,
      source: "igdb-cover",
    };

    gameImageCache[cacheKey] = payload;

    await saveGameImageCache();

    return payload;
  }

  async function enrichRow(row) {
    await enrichSpotifyActivityLinks(row);

    const hasDiscordImage = !!(row.small_image || row.large_image);

    if (hasDiscordImage) {
      row.image_source = row.image_source || "discord";

      return row.small_image || row.large_image || null;
    }

    if (row.kind === "game") {
      const result = await fetchBestGameImage(row.name);

      if (result?.url) {
        row.small_image = result.url;
        row.image_source = result.source || null;

        return result.url;
      }
    }

    return null;
  }

  return {
    loadGameImageCache,
    enrichRow,
    enrichSpotifyActivityLinks,
    spotifyEnabled: Boolean(SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET),
    steamGridDbEnabled: Boolean(STEAMGRIDDB_API_KEY),
    igdbEnabled: Boolean(IGDB_CLIENT_ID && IGDB_CLIENT_SECRET),
  };
}
