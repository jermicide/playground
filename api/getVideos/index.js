const fetch = require('node-fetch');

module.exports = async function (context, req) {
  const apiKey = process.env.YOUTUBE_API_KEY; // Loaded from Azure config
  const playlistId = req.query.playlistId || 'PLxxxxxxxxxxxxxxxxxx'; // Replace with your playlist ID
  const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=10&playlistId=${playlistId}&key=${apiKey}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    context.res = {
      status: 200,
      body: data
    };
  } catch (error) {
    context.res = {
      status: 500,
      body: { error: 'Failed to fetch videos' }
    };
  }
};