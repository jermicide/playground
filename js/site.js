const PLAYLIST_ID = 'PLx3fyeqr0GmvVB8Vlh0b8W3uHSRYzWKr0';
const VIDEO_PAGE_SIZE = 8;

let videos = [];
let activeVideoIndex = 0;
let isLoadingVideos = false;
let isYouTubeApiReady = false;
let player = null;

const rail = document.getElementById('video-rail');
const videoStatus = document.getElementById('video-status');
const spotlightTitle = document.getElementById('spotlight-title');
const spotlightSub = document.getElementById('spotlight-sub');
const videoRetryWrap = document.getElementById('video-retry-wrap');
const videoRetryButton = document.getElementById('video-retry');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(isoDate) {
  if (!isoDate) {
    return 'Unknown date';
  }

  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown date';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

function updateVideoStatus(message) {
  videoStatus.textContent = message;
}

function setRetryVisibility(type, visible) {
  if (type === 'videos') {
    videoRetryWrap.style.display = visible ? 'block' : 'none';
  }
}

function renderVideoSkeletons() {
  rail.innerHTML = '';
  const count = 4;
  for (let index = 0; index < count; index += 1) {
    const card = document.createElement('div');
    card.className = 'video-skeleton';
    card.innerHTML = `
      <div class="media skeleton"></div>
      <div class="line skeleton"></div>
    `;
    rail.appendChild(card);
  }
}

function renderRail() {
  rail.innerHTML = '';

  videos.forEach((video, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `thumb-button ${index === activeVideoIndex ? 'active' : ''}`;
    button.dataset.index = String(index);
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', index === activeVideoIndex ? 'true' : 'false');
    button.setAttribute('aria-label', `Play ${video.title}`);

    const thumbUrl = video.thumbnails.medium || video.thumbnails.high || video.thumbnails.default || '';
    button.innerHTML = `
      <img class="thumb-media" src="${escapeHtml(thumbUrl)}" alt="${escapeHtml(video.title)} thumbnail" loading="lazy">
      <div class="thumb-copy">
        <p class="thumb-title">${escapeHtml(video.title)}</p>
        <div class="thumb-date">${escapeHtml(formatDate(video.publishedAt))}</div>
      </div>
    `;

    button.addEventListener('click', () => {
      setActiveVideo(index, true, true);
    });

    rail.appendChild(button);
  });
}

function renderSpotlightCopy(video) {
  spotlightTitle.textContent = video.title || 'Untitled video';
  spotlightSub.textContent = `${formatDate(video.publishedAt)}${video.channelTitle ? ` • ${video.channelTitle}` : ''}`;
}

function ensurePlayer(videoId, autoplay) {
  if (!isYouTubeApiReady || !videoId) {
    return;
  }

  if (player) {
    player.loadVideoById(videoId);
    if (!autoplay) {
      player.pauseVideo();
    }
    return;
  }

  player = new YT.Player('spotlight-player', {
    videoId,
    playerVars: {
      autoplay: autoplay ? 1 : 0,
      rel: 0,
      modestbranding: 1
    }
  });
}

function setActiveVideo(index, autoplay, shouldFocus) {
  const video = videos[index];
  if (!video) {
    return;
  }

  activeVideoIndex = index;
  renderSpotlightCopy(video);
  ensurePlayer(video.videoId, autoplay);

  document.querySelectorAll('.thumb-button').forEach((button, buttonIndex) => {
    const isActive = buttonIndex === activeVideoIndex;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');

    if (isActive && shouldFocus) {
      button.focus({ preventScroll: true });
    }
  });
}

async function fetchVideos() {
  if (isLoadingVideos) {
    return;
  }

  isLoadingVideos = true;
  setRetryVisibility('videos', false);
  updateVideoStatus('Loading all videos...');
  renderVideoSkeletons();

  try {
    const allVideos = [];
    let pageToken = null;
    let pageLoadedFromCache = false;

    // Fetch YouTube playlist videos
    do {
      const params = new URLSearchParams({
        playlistId: PLAYLIST_ID,
        maxResults: String(VIDEO_PAGE_SIZE)
      });

      if (pageToken) {
        params.set('pageToken', pageToken);
      }

      const response = await fetch(`/api/getVideos?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Unable to load videos.');
      }

      const incoming = Array.isArray(data.items) ? data.items : [];
      allVideos.push(...incoming);
      pageLoadedFromCache = pageLoadedFromCache || Boolean(data.fromCache);
      pageToken = data.nextPageToken || null;
    } while (pageToken);

    // Fetch social feed videos
    try {
      const socialResponse = await fetch('/api/getSocials?maxResults=24');
      const socialData = await socialResponse.json();

      if (socialResponse.ok && Array.isArray(socialData.items)) {
        const socialVideos = socialData.items
          .filter((item) => item.videoId)
          .map((item) => ({
            videoId: item.videoId,
            title: item.title || 'Untitled video',
            description: item.caption || '',
            publishedAt: item.timestamp || null,
            channelTitle: item.author || item.platform || '',
            thumbnails: {
              default: item.mediaUrl || '',
              medium: item.mediaUrl || '',
              high: item.mediaUrl || ''
            }
          }));
        
        allVideos.push(...socialVideos);
        pageLoadedFromCache = pageLoadedFromCache || Boolean(socialData.fromCache);
      }
    } catch (socialError) {
      console.warn('Failed to fetch social videos:', socialError);
    }

    videos = allVideos;
    if (videos.length === 0) {
      rail.innerHTML = '';
      spotlightTitle.textContent = 'No videos found.';
      spotlightSub.textContent = 'Try again later.';
      updateVideoStatus('No videos are available for this playlist.');
      return;
    }

    renderRail();
    setActiveVideo(0, false, false);
    updateVideoStatus(pageLoadedFromCache ? 'Loaded videos (some from cache).' : 'Loaded latest videos.');
  } catch (error) {
    console.error(error);
    updateVideoStatus('Unable to load videos right now. Please try again.');
    setRetryVisibility('videos', true);
  } finally {
    isLoadingVideos = false;
  }
}

function handleRailKeyboard(event) {
  if (!videos.length) {
    return;
  }

  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    return;
  }

  event.preventDefault();
  if (event.key === 'ArrowLeft') {
    setActiveVideo(Math.max(activeVideoIndex - 1, 0), true, true);
    return;
  }

  if (event.key === 'ArrowRight') {
    setActiveVideo(Math.min(activeVideoIndex + 1, videos.length - 1), true, true);
    return;
  }

  if (event.key === 'Home') {
    setActiveVideo(0, true, true);
    return;
  }

  setActiveVideo(videos.length - 1, true, true);
}

videoRetryButton.addEventListener('click', function () {
  fetchVideos();
});
rail.addEventListener('keydown', handleRailKeyboard);

window.onYouTubeIframeAPIReady = function () {
  isYouTubeApiReady = true;
  if (videos.length > 0) {
    ensurePlayer(videos[activeVideoIndex].videoId, false);
  }
};

window.addEventListener('DOMContentLoaded', async function () {
  await fetchVideos();
});