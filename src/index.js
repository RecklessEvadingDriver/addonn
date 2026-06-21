const http = require('node:http');
const { MovieBoxClient } = require('./movieboxClient');

const PORT = Number(process.env.PORT || 7000);
const TMDB_API_KEY = process.env.TMDB_API_KEY || '1865f43a0549ca50d341dd9ab8b29f49';
const client = new MovieBoxClient();
const resolveCache = new Map();

const manifest = {
  id: 'community.moviebox.streams',
  version: '1.0.0',
  name: 'MovieBox Streams',
  description: 'Fetches MovieBox streams using Stremio IMDb/TMDB ids.',
  resources: ['stream'],
  types: ['movie', 'series'],
  catalogs: [],
  idPrefixes: ['tt', 'tmdb:']
};

function json(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*'
  });
  res.end(JSON.stringify(payload));
}

function cleanTitle(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeTitle(value) {
  return cleanTitle(String(value || '').replace(/\[.*?]/g, ' ').replace(/\(.*?\)/g, ' ').replace(/\b(dub|dubbed|hd|4k|hindi|tamil|telugu|dual audio)\b/gi, ' '));
}

function tokenEquals(a, b) {
  const sa = new Set(cleanTitle(a).split(/\s+/).filter(Boolean));
  const sb = new Set(cleanTitle(b).split(/\s+/).filter(Boolean));
  if (!sa.size || !sb.size) return false;
  const inter = [...sa].filter((item) => sb.has(item)).length;
  return inter >= Math.max(1, Math.floor(Math.min(sa.size, sb.size) * 3 / 4));
}

function parseStremioId(type, id) {
  const parts = decodeURIComponent(id).split(':');
  if (parts[0] === 'tmdb') {
    return { provider: 'tmdb', mediaType: parts[1] || type, id: parts[2], season: Number(parts[3] || 0), episode: Number(parts[4] || 0) };
  }
  return { provider: 'imdb', mediaType: type, id: parts[0], season: Number(parts[1] || 0), episode: Number(parts[2] || 0) };
}

async function fetchJson(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${url} failed with ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function getMetadata(parsed) {
  if (parsed.provider === 'tmdb') {
    const kind = parsed.mediaType === 'series' || parsed.mediaType === 'tv' ? 'tv' : 'movie';
    const url = `https://api.themoviedb.org/3/${kind}/${parsed.id}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
    const data = await fetchJson(url);
    return {
      title: data.title || data.name || data.original_title || data.original_name,
      year: Number(String(data.release_date || data.first_air_date || '').slice(0, 4)) || null,
      imdbId: data.external_ids?.imdb_id || null
    };
  }

  const metaType = parsed.mediaType === 'series' ? 'series' : 'movie';
  const data = await fetchJson(`https://v3-cinemeta.strem.io/meta/${metaType}/${parsed.id}.json`);
  const meta = data.meta || {};
  return {
    title: meta.name || meta.title,
    year: Number(String(meta.released || '').slice(0, 4)) || null,
    imdbId: parsed.id,
    imdbRating: Number(meta.imdbRating) || null
  };
}

function pickSubjects(searchJson) {
  const results = searchJson?.data?.results || [];
  return results.flatMap((group) => group.subjects || []);
}

async function resolveSubjectId(type, stremioId) {
  const cacheKey = `${type}:${stremioId}`;
  if (resolveCache.has(cacheKey)) return resolveCache.get(cacheKey);
  const parsed = parseStremioId(type, stremioId);
  const metadata = await getMetadata(parsed);
  if (!metadata.title) return null;

  const search = await client.searchSubjects(normalizeTitle(metadata.title), 1);
  const wantedType = type === 'series' ? 2 : 1;
  let best = null;
  let bestScore = -1;

  for (const subject of pickSubjects(search.json)) {
    const candidateTitle = subject.title || '';
    let score = 0;
    if (tokenEquals(candidateTitle, metadata.title)) score += 50;
    if (cleanTitle(candidateTitle).includes(cleanTitle(metadata.title)) || cleanTitle(metadata.title).includes(cleanTitle(candidateTitle))) score += 20;
    const year = Number(String(subject.releaseDate || subject.release_date || '').slice(0, 4)) || null;
    if (year && metadata.year && year === metadata.year) score += 35;
    if (subject.subjectType === wantedType) score += 20;
    const rating = Number(subject.imdbRatingValue);
    if (metadata.imdbRating && rating && Math.abs(rating - metadata.imdbRating) <= 1) score += 5;
    if (score > bestScore) {
      best = subject;
      bestScore = score;
    }
  }

  const subjectId = bestScore >= 40 ? best?.subjectId : null;
  resolveCache.set(cacheKey, subjectId);
  return subjectId;
}

function streamType(url, format) {
  const lower = String(url || '').toLowerCase();
  if (format === 'HLS' || lower.endsWith('.m3u8')) return 'hls';
  if (lower.endsWith('.mpd')) return 'dash';
  return undefined;
}

async function buildStreams(type, id) {
  const parsed = parseStremioId(type, id);
  const subjectId = await resolveSubjectId(type, id);
  if (!subjectId) return [];

  const subject = await client.getSubject(subjectId);
  const tokenHeader = subject.response.headers.get('x-user');
  let token = null;
  try { token = tokenHeader ? JSON.parse(tokenHeader).token : null; } catch (_) {}

  const subjectIds = [[subjectId, 'Original']];
  for (const dub of subject.json?.data?.dubs || []) {
    if (dub.subjectId && dub.subjectId !== subjectId) subjectIds.push([dub.subjectId, dub.lanName || 'Dub']);
  }

  const streams = [];
  for (const [dubSubjectId, language] of subjectIds) {
    const play = await client.getPlayInfo(dubSubjectId, parsed.season, parsed.episode, { token });
    for (const item of play.json?.data?.streams || []) {
      if (!item.url) continue;
      const headers = {};
      if (item.signCookie) headers.Cookie = item.signCookie;
      streams.push({
        name: `MovieBox ${language}`,
        title: `${language}${item.resolutions ? ` - ${item.resolutions}` : ''}`,
        url: item.url,
        ytId: undefined,
        behaviorHints: {
          notWebReady: false,
          proxyHeaders: Object.keys(headers).length ? { request: headers } : undefined
        },
        type: streamType(item.url, item.format)
      });
    }
  }
  return streams;
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'OPTIONS') return json(res, 200, {});
    if (url.pathname === '/' || url.pathname === '/manifest.json') return json(res, 200, manifest);

    const match = url.pathname.match(/^\/stream\/(movie|series)\/(.+)\.json$/);
    if (match) {
      const streams = await buildStreams(match[1], match[2]);
      return json(res, 200, { streams });
    }

    return json(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    return json(res, 200, { streams: [] });
  }
}

const server = http.createServer(handleRequest);

if (require.main === module) {
  server.listen(PORT, () => console.log(`MovieBox Stremio addon listening on http://127.0.0.1:${PORT}/manifest.json`));
}

module.exports = { server, handleRequest, manifest, parseStremioId, resolveSubjectId, buildStreams };
