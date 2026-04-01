const fetch = require('node-fetch');
const { BlobServiceClient } = require('@azure/storage-blob');

const CACHE_DURATION = 24 * 60 * 60 * 1000;
const DEFAULT_PLAYLIST_ID = process.env.DEFAULT_PLAYLIST_ID || 'PLx3fyeqr0GmtfrBrIpPSW7K2s-Q1rMgLj';
const DEFAULT_MAX_RESULTS = 10;
const MAX_RESULTS_CAP = 25;

function buildHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300',
    'Permissions-Policy': 'unload=*'
  };
}

function isValidPlaylistId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,}$/.test(value);
}

function isValidPageToken(value) {
  return !value || /^[A-Za-z0-9_-]+$/.test(value);
}

function toSafeInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function normalizeItem(item) {
  const snippet = item && item.snippet ? item.snippet : {};
  const resourceId = snippet.resourceId || {};
  const thumbs = snippet.thumbnails || {};

  return {
    videoId: resourceId.videoId || '',
    title: snippet.title || 'Untitled video',
    description: snippet.description || '',
    publishedAt: snippet.publishedAt || null,
    channelTitle: snippet.channelTitle || '',
    position: typeof snippet.position === 'number' ? snippet.position : null,
    thumbnails: {
      default: thumbs.default ? thumbs.default.url : '',
      medium: thumbs.medium ? thumbs.medium.url : '',
      high: thumbs.high ? thumbs.high.url : ''
    }
  };
}

module.exports = async function (context, req) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  const connectionString = process.env.STORAGE_CONNECTION_STRING;

  if (!apiKey || !connectionString) {
    context.res = {
      status: 500,
      headers: buildHeaders(),
      body: {
        error: 'Server is missing required configuration.'
      }
    };
    return;
  }

  const playlistId = req.query.playlistId || DEFAULT_PLAYLIST_ID;
  const pageToken = req.query.pageToken || '';
  const maxResults = toSafeInteger(req.query.maxResults, DEFAULT_MAX_RESULTS, 1, MAX_RESULTS_CAP);
  const refresh = req.query.refresh === '1' || req.query.refresh === 'true';

  if (!isValidPlaylistId(playlistId)) {
    context.res = {
      status: 400,
      headers: buildHeaders(),
      body: { error: 'Invalid playlistId.' }
    };
    return;
  }

  if (!isValidPageToken(pageToken)) {
    context.res = {
      status: 400,
      headers: buildHeaders(),
      body: { error: 'Invalid pageToken.' }
    };
    return;
  }

  const cacheFile = `youtube-videos-${playlistId}-${pageToken || 'first'}-${maxResults}.json`;
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient('cache');
  const blobClient = containerClient.getBlockBlobClient(cacheFile);

  try {
    let payload = null;

    if (!refresh) {
      try {
        const properties = await blobClient.getProperties();
        const lastModified = new Date(properties.lastModified).getTime();

        if (Date.now() - lastModified < CACHE_DURATION) {
          const download = await blobClient.downloadToBuffer();
          payload = JSON.parse(download.toString());
          payload.fromCache = true;
        }
      } catch (error) {
        if (error.statusCode !== 404) {
          throw error;
        }
      }
    }

    if (!payload) {
      const params = new URLSearchParams({
        part: 'snippet',
        maxResults: String(maxResults),
        playlistId,
        key: apiKey
      });

      if (pageToken) {
        params.set('pageToken', pageToken);
      }

      const url = `https://www.googleapis.com/youtube/v3/playlistItems?${params.toString()}`;
      const response = await fetch(url);
      const data = await response.json();

      if (!response.ok) {
        context.log.error('YouTube API request failed', data);
        context.res = {
          status: response.status,
          headers: buildHeaders(),
          body: { error: 'Unable to fetch videos from YouTube right now.' }
        };
        return;
      }

      const items = Array.isArray(data.items)
        ? data.items.map(normalizeItem).filter((item) => item.videoId)
        : [];

      payload = {
        items,
        nextPageToken: data.nextPageToken || null,
        totalResults: data.pageInfo && typeof data.pageInfo.totalResults === 'number'
          ? data.pageInfo.totalResults
          : items.length,
        pageSize: maxResults,
        playlistId,
        fromCache: false
      };

      await containerClient.createIfNotExists();
      const body = Buffer.from(JSON.stringify(payload));
      await blobClient.upload(body, body.length, {
        blobHTTPHeaders: { blobContentType: 'application/json' }
      });
    }

    context.res = {
      status: 200,
      headers: buildHeaders(),
      body: payload
    };
  } catch (error) {
    context.log.error('Failed to fetch or cache videos', error);
    context.res = {
      status: 500,
      headers: buildHeaders(),
      body: { error: 'Failed to fetch videos.' }
    };
  }
};