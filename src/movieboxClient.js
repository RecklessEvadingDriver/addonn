const crypto = require('node:crypto');

const BASE_URL = 'https://api3.aoneroom.com';
const DEFAULT_SECRET_B64 = 'NzZpUmwwN3MweFNOOWpxbUVXQXQ3OUVCSlp1bElRSXNWNjRGWnIyTw==';
const ALT_SECRET_B64 = 'WHFuMm5uTzQxL0w5Mm8xaXVYaFNMSFRiWHZZNFo1Wlo2Mm04bVNMQQ==';
const PACKAGE_NAME = 'com.community.oneroom';
const VERSION_NAME = '3.0.13.0325.03';
const VERSION_CODE = 50020088;

const brandModels = {
  Samsung: ['SM-S918B', 'SM-A528B', 'SM-M336B'],
  Xiaomi: ['2201117TI', 'M2012K11AI', 'Redmi Note 11'],
  OnePlus: ['LE2111', 'CPH2449', 'IN2023'],
  Google: ['Pixel 6', 'Pixel 7', 'Pixel 8'],
  Realme: ['RMX3085', 'RMX3360', 'RMX3551']
};

function md5(input) {
  return crypto.createHash('md5').update(input).digest('hex');
}

function reverseString(input) {
  return String(input).split('').reverse().join('');
}

function generateXClientToken(hardcodedTimestamp) {
  const timestamp = String(hardcodedTimestamp ?? Date.now());
  return `${timestamp},${md5(reverseString(timestamp))}`;
}

function generateDeviceId() {
  return crypto.randomBytes(16).toString('hex');
}

function randomChoice(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function randomBrandModel() {
  const brand = randomChoice(Object.keys(brandModels));
  return { brand, model: randomChoice(brandModels[brand]) };
}

function buildCanonicalString(method, accept, contentType, url, body, timestamp) {
  const parsed = new URL(url);
  const path = parsed.pathname || '';
  const keys = [...new Set([...parsed.searchParams.keys()])].sort();
  const query = keys
    .flatMap((key) => parsed.searchParams.getAll(key).map((value) => `${key}=${value}`))
    .join('&');
  const canonicalUrl = query ? `${path}?${query}` : path;
  const bodyBuffer = body == null ? null : Buffer.from(String(body), 'utf8');
  const bodyHash = bodyBuffer ? md5(bodyBuffer.subarray(0, Math.min(bodyBuffer.length, 102400))) : '';
  const bodyLength = bodyBuffer ? String(bodyBuffer.length) : '';

  return [
    method.toUpperCase(),
    accept ?? '',
    contentType ?? '',
    bodyLength,
    String(timestamp),
    bodyHash,
    canonicalUrl
  ].join('\n');
}

function generateXTrSignature(method, accept, contentType, url, body = null, useAltKey = false, hardcodedTimestamp) {
  const timestamp = hardcodedTimestamp ?? Date.now();
  const canonical = buildCanonicalString(method, accept, contentType, url, body, timestamp);
  const secretBytes = Buffer.from(useAltKey ? ALT_SECRET_B64 : DEFAULT_SECRET_B64, 'base64');
  const signatureB64 = crypto.createHmac('md5', secretBytes).update(canonical, 'utf8').digest('base64');
  return `${timestamp}|2|${signatureB64}`;
}

class MovieBoxClient {
  constructor({ baseUrl = BASE_URL, deviceId = generateDeviceId(), fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
    if (!fetchImpl) throw new Error('A fetch implementation is required. Use Node.js 18+ or pass fetchImpl.');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.deviceId = deviceId;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  clientInfo(overrides = {}) {
    const { brand, model } = randomBrandModel();
    return JSON.stringify({
      package_name: PACKAGE_NAME,
      version_name: VERSION_NAME,
      version_code: VERSION_CODE,
      os: 'android',
      os_version: '13',
      install_ch: 'ps',
      device_id: this.deviceId,
      install_store: 'ps',
      gaid: '1b2212c1-dadf-43c3-a0c8-bd6ce48ae22d',
      brand,
      model,
      system_language: 'en',
      net: 'NETWORK_WIFI',
      region: 'US',
      timezone: 'Asia/Calcutta',
      sp_code: '',
      'X-Play-Mode': '1',
      'X-Idle-Data': '1',
      'X-Family-Mode': '0',
      'X-Content-Mode': '0',
      ...overrides
    });
  }

  signedHeaders(method, url, body = null, options = {}) {
    const accept = options.accept ?? 'application/json';
    const contentType = options.contentType ?? (body == null ? 'application/json' : 'application/json; charset=utf-8');
    const { brand } = randomBrandModel();
    return {
      'user-agent': `com.community.oneroom/${VERSION_CODE} (Linux; U; Android 13; en_US; ${brand}; Build/TQ3A.230901.001; Cronet/145.0.7582.0)`,
      accept,
      'content-type': contentType,
      connection: 'keep-alive',
      'x-client-token': generateXClientToken(),
      'x-tr-signature': generateXTrSignature(method, accept, contentType, url, body, options.useAltKey ?? false),
      'x-client-info': this.clientInfo(options.clientInfo),
      'x-client-status': '0',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers ?? {})
    };
  }

  async request(method, url, { body = null, ...options } = {}) {
    const textBody = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? this.timeoutMs);
    let response;
    let text;
    try {
      response = await this.fetch(url, {
        method,
        headers: this.signedHeaders(method, url, textBody, options),
        body: textBody,
        signal: controller.signal
      });
      text = await response.text();
    } finally {
      clearTimeout(timeout);
    }
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) {}
    if (!response.ok) {
      const error = new Error(`MovieBox ${method} ${url} failed with ${response.status}`);
      error.status = response.status;
      error.body = text;
      throw error;
    }
    return { response, text, json };
  }

  signedGet(url, options = {}) {
    return this.request('GET', url, options);
  }

  signedPost(url, body, options = {}) {
    return this.request('POST', url, { ...options, body });
  }

  async getSubject(subjectId) {
    const url = `${this.baseUrl}/wefeed-mobile-bff/subject-api/get?subjectId=${encodeURIComponent(subjectId)}`;
    return this.signedGet(url);
  }

  async searchSubjects(keyword, page = 1) {
    const url = `${this.baseUrl}/wefeed-mobile-bff/subject-api/search/v2`;
    const body = { page, perPage: 20, keyword };
    return this.signedPost(url, body);
  }

  async getPlayInfo(subjectId, season = 0, episode = 0, options = {}) {
    const url = `${this.baseUrl}/wefeed-mobile-bff/subject-api/play-info?subjectId=${encodeURIComponent(subjectId)}&se=${season || 0}&ep=${episode || 0}`;
    return this.signedGet(url, options);
  }

  async getCaptions(subjectId, streamId, options = {}) {
    const url = `${this.baseUrl}/wefeed-mobile-bff/subject-api/get-stream-captions?subjectId=${encodeURIComponent(subjectId)}&streamId=${encodeURIComponent(streamId)}`;
    return this.signedGet(url, { ...options, accept: '', contentType: '' });
  }
}

module.exports = {
  BASE_URL,
  MovieBoxClient,
  md5,
  reverseString,
  generateXClientToken,
  generateDeviceId,
  buildCanonicalString,
  generateXTrSignature,
  randomBrandModel
};
