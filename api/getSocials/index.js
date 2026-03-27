const fetch = require('node-fetch');
const { BlobServiceClient } = require('@azure/storage-blob');

const CACHE_DURATION = 2 * 60 * 60 * 1000;
const DEFAULT_MAX_RESULTS = 12;
const MAX_RESULTS_CAP = 24;
const DEFAULT_FACEBOOK_PAGES = ['https://www.facebook.com/OwassoRamsHSWrestling'];

function buildHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=180'
  };
}

function toSafeInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function isValidPlaylistId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,}$/.test(value);
}

function parsePlaylistList(rawList) {
  if (!rawList) {
    return [];
  }

  return rawList
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && isValidPlaylistId(value));
}

function parseFacebookPageList(rawList) {
  const source = rawList && rawList.trim().length > 0
    ? rawList
    : DEFAULT_FACEBOOK_PAGES.join(',');

  return source
    .split(',')
    .map((value) => value.trim())
    .filter((value) => /^https?:\/\/(www\.)?facebook\.com\//i.test(value));
}

function decodeHtmlEntities(value) {
  if (!value) {
    return '';
  }

  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/');
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function extractTagValue(block, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = block.match(regex);
  if (!match) {
    return '';
  }

  const cdataMatch = match[1].match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
  return cdataMatch ? cdataMatch[1] : match[1];
}

function extractAttribute(block, tagName, attributeName) {
  const regex = new RegExp(`<${tagName}[^>]*${attributeName}="([^"]+)"[^>]*>`, 'i');
  const match = block.match(regex);
  return match ? match[1] : '';
}

function normalizeFacebookRssItem(itemBlock, sourceId, index) {
  const title = decodeHtmlEntities(extractTagValue(itemBlock, 'title'));
  const postUrl = decodeHtmlEntities(extractTagValue(itemBlock, 'link'));
  const description = extractTagValue(itemBlock, 'description');
  const guid = decodeHtmlEntities(extractTagValue(itemBlock, 'guid'));
  const mediaUrl = extractAttribute(itemBlock, 'enclosure', 'url') || extractAttribute(itemBlock, 'media:content', 'url');
  const pubDate = extractTagValue(itemBlock, 'pubDate');
  const parsedDate = pubDate ? new Date(pubDate) : null;

  return {
    id: `fb-${guid || sourceId}-${index}`,
    platform: 'facebook',
    title: title || 'Facebook post',
    caption: stripHtml(description).slice(0, 400),
    postUrl,
    mediaUrl: decodeHtmlEntities(mediaUrl),
    timestamp: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null,
    author: 'Owasso Rams HS Wrestling',
    sourceId,
    videoId: ''
  };
}

async function resolveFacebookPageId(pageUrl) {
    const extractPageId = (html) => {
      if (!html) {
        return '';
      }

      const patterns = [
        /"pageID"\s*:\s*"(\d+)"/i,
        /"entity_id"\s*:\s*"(\d+)"/i,
        /"profile_id"\s*:\s*"(\d+)"/i,
        /fb:\/\/page\/(\d+)/i,
        /page_id=(\d+)/i
      ];

      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          return match[1];
        }
      }

      return '';
    };

    const mobileUrl = pageUrl.replace('://www.facebook.com/', '://m.facebook.com/');
    const pluginUrl = `https://www.facebook.com/plugins/page.php?href=${encodeURIComponent(pageUrl)}&tabs=timeline`;
    const lookupUrls = [mobileUrl, pluginUrl];

    for (const lookupUrl of lookupUrls) {
      const response = await fetch(lookupUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SocialFeedBot/1.0)'
        }
      });

      const html = await response.text();

      if (!response.ok) {
        continue;
      }

      const pageId = extractPageId(html);
      if (pageId) {
        return pageId;
      }
    }

    // Keep known override for the default page to avoid runtime outages if Facebook markup shifts.
    if (/facebook\.com\/OwassoRamsHSWrestling\/?$/i.test(pageUrl)) {
      return '303144436557258';
    }

    throw new Error(`Could not resolve a Facebook page ID for ${pageUrl}.`);
  }

  async function loadFacebookSource(pageUrl, maxResults) {
    const pageId = await resolveFacebookPageId(pageUrl);
    const feedUrl = `https://www.facebook.com/feeds/page.php?format=rss20&id=${pageId}`;
    const response = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SocialFeedBot/1.0)'
      }
    });
    const rssText = await response.text();

    if (!response.ok) {
      throw new Error(`Facebook RSS feed failed with HTTP ${response.status}.`);
    }

    const itemBlocks = rssText.match(/<item\b[\s\S]*?<\/item>/gi) || [];
    const items = itemBlocks
      .slice(0, maxResults)
      .map((block, index) => normalizeFacebookRssItem(block, pageUrl, index))
      .filter((entry) => entry.postUrl);

    return {
      items,
      source: `facebook:${pageUrl}`
    };
  }

function normalizeYouTubePost(item, playlistId) {
  const snippet = item && item.snippet ? item.snippet : {};
  const resourceId = snippet.resourceId || {};
  const thumbs = snippet.thumbnails || {};

  return {
    id: `yt-${resourceId.videoId || ''}`,
    platform: 'youtube',
    title: snippet.title || 'Untitled post',
    caption: snippet.description || '',
    postUrl: resourceId.videoId ? `https://www.youtube.com/watch?v=${resourceId.videoId}` : '',
    mediaUrl: (thumbs.high && thumbs.high.url) || (thumbs.medium && thumbs.medium.url) || (thumbs.default && thumbs.default.url) || '',
    timestamp: snippet.publishedAt || null,
    author: snippet.channelTitle || '',
    sourceId: playlistId,
    videoId: resourceId.videoId || ''
  };
}

function normalizeExternalPost(item, index) {
  const platform = item && typeof item.platform === 'string' ? item.platform.toLowerCase() : 'external';
  const idSeed = item && item.id ? String(item.id) : String(index);

  return {
    id: `${platform}-${idSeed}`,
    platform,
    title: item && item.title ? String(item.title) : 'Social post',
    caption: item && item.caption ? String(item.caption) : '',
    postUrl: item && item.postUrl ? String(item.postUrl) : '',
    mediaUrl: item && item.mediaUrl ? String(item.mediaUrl) : '',
    timestamp: item && item.timestamp ? String(item.timestamp) : null,
    author: item && item.author ? String(item.author) : '',
    sourceId: item && item.sourceId ? String(item.sourceId) : 'external',
    videoId: ''
  };
}

async function loadYouTubeSource(apiKey, playlistId, maxResults) {
  const params = new URLSearchParams({
    part: 'snippet',
    maxResults: String(maxResults),
    playlistId,
    key: apiKey
  });
  const url = `https://www.googleapis.com/youtube/v3/playlistItems?${params.toString()}`;

  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(`YouTube source ${playlistId} failed with HTTP ${response.status}.`);
  }

  const items = Array.isArray(data.items)
    ? data.items.map((entry) => normalizeYouTubePost(entry, playlistId)).filter((entry) => entry.videoId)
    : [];

  return {
    items,
    source: `youtube:${playlistId}`
  };
}

async function loadExternalJsonSource(feedUrl) {
  const response = await fetch(feedUrl);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(`External source failed with HTTP ${response.status}.`);
  }

  const rawItems = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
  const items = rawItems
    .map((item, index) => normalizeExternalPost(item, index))
    .filter((entry) => entry.postUrl || entry.mediaUrl);

  return {
    items,
    source: 'external-json'
  };
}

function buildCacheKey(maxResults, configuredPlaylists, externalFeedUrl, facebookPages) {
  const playlistKey = configuredPlaylists.length > 0 ? configuredPlaylists.join('_') : 'none';
  const externalKey = externalFeedUrl ? 'external' : 'noexternal';
  const facebookKey = facebookPages.length > 0 ? `fb-${facebookPages.length}` : 'nofb';
  return `social-feed-${playlistKey}-${externalKey}-${facebookKey}-${maxResults}.json`;
}

module.exports = async function (context, req) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  const connectionString = process.env.STORAGE_CONNECTION_STRING;

  if (!connectionString) {
    context.res = {
      status: 500,
      headers: buildHeaders(),
      body: {
        error: 'Server is missing required configuration.'
      }
    };
    return;
  }

  const maxResults = toSafeInteger(req.query.maxResults, DEFAULT_MAX_RESULTS, 1, MAX_RESULTS_CAP);
  const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
  const configuredPlaylists = parsePlaylistList(process.env.SOCIAL_YOUTUBE_PLAYLISTS || process.env.DEFAULT_PLAYLIST_ID || '');
  const externalFeedUrl = process.env.SOCIAL_JSON_FEED_URL || '';
  const facebookPageUrls = parseFacebookPageList(process.env.SOCIAL_FACEBOOK_PAGE_URLS || '');
  const warnings = [];

  if (configuredPlaylists.length === 0 && !externalFeedUrl && facebookPageUrls.length === 0) {
    context.res = {
      status: 500,
      headers: buildHeaders(),
      body: {
        error: 'No SOCIAL_YOUTUBE_PLAYLISTS, DEFAULT_PLAYLIST_ID, SOCIAL_JSON_FEED_URL, or SOCIAL_FACEBOOK_PAGE_URLS configured.'
      }
    };
    return;
  }

  const cacheFile = buildCacheKey(maxResults, configuredPlaylists, externalFeedUrl, facebookPageUrls);
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient('cache');
  const blobClient = containerClient.getBlockBlobClient(cacheFile);

  try {
    let payload = null;

    if (!refresh) {
      try {
        const properties = await blobClient.getProperties();
        const ageMs = Date.now() - new Date(properties.lastModified).getTime();

        if (ageMs < CACHE_DURATION) {
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
      const sourceTasks = [];

      if (configuredPlaylists.length > 0) {
        if (!apiKey) {
          warnings.push('YOUTUBE_API_KEY is not configured, skipping YouTube sources.');
        } else {
          const perPlaylist = Math.max(1, Math.ceil(maxResults / configuredPlaylists.length));
          for (const playlistId of configuredPlaylists) {
            sourceTasks.push(loadYouTubeSource(apiKey, playlistId, perPlaylist));
          }
        }
      }

      if (externalFeedUrl) {
        sourceTasks.push(loadExternalJsonSource(externalFeedUrl));
      }

      if (facebookPageUrls.length > 0) {
        const perPage = Math.max(1, Math.ceil(maxResults / facebookPageUrls.length));
        for (const pageUrl of facebookPageUrls) {
          sourceTasks.push(loadFacebookSource(pageUrl, perPage));
        }
      }

      const settledResults = await Promise.allSettled(sourceTasks);
      let items = [];
      const activeSources = [];

      settledResults.forEach((result) => {
        if (result.status === 'fulfilled') {
          items = items.concat(result.value.items);
          activeSources.push(result.value.source);
          return;
        }

        warnings.push(result.reason && result.reason.message ? result.reason.message : 'A social source request failed.');
      });

      items.sort((a, b) => {
        const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return bTime - aTime;
      });

      payload = {
        items: items.slice(0, maxResults),
        totalResults: items.length,
        sources: activeSources,
        warnings,
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
    context.log.error('Failed to fetch social feed', error);
    context.res = {
      status: 500,
      headers: buildHeaders(),
      body: {
        error: 'Failed to fetch social feed.'
      }
    };
  }
};
