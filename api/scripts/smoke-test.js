const fetch = require('node-fetch');

const BASE_URL = process.env.BASE_URL || 'http://localhost:7071/api';
const DEFAULT_PLAYLIST_ID = process.env.DEFAULT_PLAYLIST_ID || 'PLx3fyeqr0GmvVB8Vlh0b8W3uHSRYzWKr0';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function requestJson(path) {
  const response = await fetch(`${BASE_URL}${path}`);
  const text = await response.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`Expected JSON response for ${path}, received: ${text.slice(0, 120)}`);
  }

  return { response, data };
}

async function testGetVideosHappyPath() {
  const { response, data } = await requestJson(`/getVideos?playlistId=${encodeURIComponent(DEFAULT_PLAYLIST_ID)}&maxResults=5`);
  assert(response.status === 200, `getVideos happy path should return 200, got ${response.status}`);
  assert(data && Array.isArray(data.items), 'getVideos happy path must return items array');
  assert(typeof data.pageSize === 'number', 'getVideos happy path must return numeric pageSize');
  assert('nextPageToken' in data, 'getVideos happy path must include nextPageToken key');
}

async function testGetVideosInvalidPlaylist() {
  const { response, data } = await requestJson('/getVideos?playlistId=*&maxResults=5');
  assert(response.status === 400, `getVideos invalid playlist should return 400, got ${response.status}`);
  assert(data && typeof data.error === 'string', 'getVideos invalid playlist must return error message');
}

async function testGetVideosClampedMaxResults() {
  const { response, data } = await requestJson(`/getVideos?playlistId=${encodeURIComponent(DEFAULT_PLAYLIST_ID)}&maxResults=200`);
  assert(response.status === 200, `getVideos maxResults clamp should return 200, got ${response.status}`);
  assert(data && data.pageSize <= 25, `getVideos pageSize should be clamped to <= 25, got ${data ? data.pageSize : 'missing'}`);
}

async function testGetSocialsContract() {
  const { response, data } = await requestJson('/getSocials?maxResults=6');
  assert(response.status === 200, `getSocials should return 200, got ${response.status}`);
  assert(data && Array.isArray(data.items), 'getSocials must return items array');
  assert(Array.isArray(data.warnings), 'getSocials must return warnings array');
}

async function run() {
  const tests = [
    testGetVideosHappyPath,
    testGetVideosInvalidPlaylist,
    testGetVideosClampedMaxResults,
    testGetSocialsContract
  ];

  for (const testFn of tests) {
    const label = testFn.name;
    process.stdout.write(`Running ${label} ... `);
    await testFn();
    process.stdout.write('ok\n');
  }

  process.stdout.write('All smoke tests passed.\n');
}

run().catch((error) => {
  process.stderr.write(`Smoke test failed: ${error.message}\n`);
  process.exit(1);
});
