const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  md5,
  reverseString,
  generateXClientToken,
  generateDeviceId,
  buildCanonicalString,
  generateXTrSignature,
  randomBrandModel
} = require('../src/movieboxClient');
const { handleRequest, manifest, parseStremioId } = require('../src/index');

test('ported crypto and client helpers are deterministic where expected', () => {
  assert.equal(md5('abc'), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(reverseString('12345'), '54321');
  assert.equal(generateXClientToken(12345), '12345,01cfcd4f6b8770febfb40cb906715822');
  assert.match(generateDeviceId(), /^[a-f0-9]{32}$/);
  assert.match(generateXTrSignature('GET', 'application/json', 'application/json', 'https://api3.aoneroom.com/path?b=2&a=1', null, false, 12345), /^12345\|2\|.+/);
  assert.match(randomBrandModel().brand, /Samsung|Xiaomi|OnePlus|Google|Realme/);
});

test('canonical string sorts query parameters and hashes request body', () => {
  const body = JSON.stringify({ keyword: 'Avatar' });
  const canonical = buildCanonicalString('POST', 'application/json', 'application/json; charset=utf-8', 'https://api3.aoneroom.com/search?z=9&a=1', body, 123);
  assert.equal(canonical, ['POST', 'application/json', 'application/json; charset=utf-8', String(Buffer.byteLength(body)), '123', md5(body), '/search?a=1&z=9'].join('\n'));
});

test('Stremio ids parse IMDb and TMDB movie/series forms', () => {
  assert.deepEqual(parseStremioId('movie', 'tt1234567'), { provider: 'imdb', mediaType: 'movie', id: 'tt1234567', season: 0, episode: 0 });
  assert.deepEqual(parseStremioId('series', 'tt1234567:2:3'), { provider: 'imdb', mediaType: 'series', id: 'tt1234567', season: 2, episode: 3 });
  assert.deepEqual(parseStremioId('series', 'tmdb:tv:99:1:8'), { provider: 'tmdb', mediaType: 'tv', id: '99', season: 1, episode: 8 });
});

test('manifest route returns valid addon manifest', async () => {
  const req = new EventEmitter();
  req.method = 'GET';
  req.url = '/manifest.json';
  req.headers = { host: 'localhost' };
  const res = makeResponse();
  await handleRequest(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), manifest);
});

function makeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk = '') {
      this.body += chunk;
    }
  };
}

test('MovieBox client defaults to India mbox profile headers', () => {
  const { MovieBoxClient } = require('../src/movieboxClient');
  const client = new MovieBoxClient({ fetchImpl: async () => ({ ok: true, text: async () => '{}' }) });
  const headers = client.signedHeaders('GET', 'https://api3.aoneroom.com/wefeed-mobile-bff/subject-api/get?subjectId=1');
  assert.match(headers['user-agent'], /^com\.community\.mbox\.in\/50020042/);
  const info = JSON.parse(headers['x-client-info']);
  assert.equal(info.package_name, 'com.community.mbox.in');
  assert.equal(info.region, 'IN');
  assert.equal(headers['x-play-mode'], '2');
});

test('MovieBox client retries with alternate profile on region 403', async () => {
  const { MovieBoxClient } = require('../src/movieboxClient');
  const profiles = [];
  const fetchImpl = async (_url, init) => {
    const info = JSON.parse(init.headers['x-client-info']);
    profiles.push(info.package_name);
    if (profiles.length === 1) {
      return {
        ok: false,
        status: 403,
        text: async () => '{"code":403,"message":"Service not available in current region"}'
      };
    }
    return { ok: true, status: 200, text: async () => '{"data":{"ok":true}}' };
  };
  const client = new MovieBoxClient({ fetchImpl });
  const result = await client.signedGet('https://api3.aoneroom.com/wefeed-mobile-bff/subject-api/get?subjectId=1');
  assert.equal(result.json.data.ok, true);
  assert.deepEqual(profiles, ['com.community.mbox.in', 'com.community.oneroom']);
});
