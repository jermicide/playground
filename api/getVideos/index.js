const fetch = require('node-fetch');
const { BlobServiceClient } = require('@azure/storage-blob');

const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_FILE = 'youtube-videos.json';

module.exports = async function (context, req) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  const playlistId = req.query.playlistId || 'PLxxxxxxxxxxxxxxxxxx'; // Replace with wrestling playlist ID
  const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=10&playlistId=${playlistId}&key=${apiKey}`;
  const connectionString = process.env.STORAGE_CONNECTION_STRING;
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient('cache');
  const blobClient = containerClient.getBlockBlobClient(CACHE_FILE);

  try {
    // Check cache
    let cachedData = null;
    let shouldFetch = true;

    try {
      const properties = await blobClient.getProperties();
      const lastModified = new Date(properties.lastModified).getTime();
      const now = Date.now();

      if (now - lastModified < CACHE_DURATION) {
        const download = await blobClient.downloadToBuffer();
        cachedData = JSON.parse(download.toString());
        shouldFetch = false;
        context.log('Serving from Blob Storage cache');
      }
    } catch (error) {
      if (error.statusCode !== 404) throw error; // Ignore if file doesn’t exist
    }

    if (!shouldFetch) {
      return context.res = {
        status: 200,
        body: cachedData
      };
    }

    // Fetch from YouTube API
    const response = await fetch(url);
    const data = await response.json();

    // Convert data to string and calculate length
    const dataString = JSON.stringify(data);
    const dataBuffer = Buffer.from(dataString);
    const contentLength = dataBuffer.length;

    // Update cache
    await blobClient.upload(dataBuffer, contentLength, {
      blobHTTPHeaders: { blobContentType: 'application/json' }
    });

    context.log('Fetched from YouTube API and cached');
    context.res = {
      status: 200,
      body: data
    };
  } catch (error) {
    context.log.error('Failed to fetch or cache videos Error:', error);
    context.res = {
      status: 500,
      body: { error: 'Failed to fetch or cache videos', details: error.message }
    };
  }
};