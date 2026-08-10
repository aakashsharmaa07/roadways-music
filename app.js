// Roadways Music Application — Phase 2.2 Supabase Realtime Presence Architecture

class RoadwaysMusicPlayer {
  constructor() {
    this.currentIndex = 0;
    this.isPlaying = false;
    this.isReady = false;
    this.currentTime = 0;
    this.duration = 0;
    this.isDragging = false;
    this.ytPlayer = null;
    this.tickerInterval = null;
    this.hasResolvedInitialTrack = false;
    
    // Supabase Realtime Presence State
    this.supabaseClient = null;
    this.presenceChannel = null;
    this.passengerId = null;
    this.isInitialPresenceSynced = false;

    // Official YouTube Music Playlist ID
    this.playlistId = 'PLG_xwT8XI-6E';

    // DOM Elements
    this.clockElement = document.getElementById('live-clock');
    this.onlineCountElement = document.getElementById('online-count');
    this.songTitleElement = document.getElementById('song-title');
    this.artistNameElement = document.getElementById('artist-name');
    this.albumArtElement = document.getElementById('album-art');
    this.albumDiscElement = document.getElementById('album-art-disc');
    this.playBtn = document.getElementById('play-btn');
    this.prevBtn = document.getElementById('prev-btn');
    this.nextBtn = document.getElementById('next-btn');
    this.timeDisplayElement = document.getElementById('time-display');
    this.progressBar = document.getElementById('progress-bar');
    this.progressFill = document.getElementById('progress-fill');
    this.progressThumb = document.getElementById('progress-thumb');

    this.init();
  }

  init() {
    this.startClock();
    this.initSupabasePresence();
    this.setupEventListeners();
  }

  // 1. SUPABASE REALTIME PRESENCE ENGINE (CHANNEL: "roadways-music")
  initSupabasePresence() {
    const url = (typeof SUPABASE_CONFIG !== 'undefined' && SUPABASE_CONFIG.SUPABASE_URL) ? SUPABASE_CONFIG.SUPABASE_URL : '';
    const key = (typeof SUPABASE_CONFIG !== 'undefined' && SUPABASE_CONFIG.SUPABASE_PUBLISHABLE_KEY) ? SUPABASE_CONFIG.SUPABASE_PUBLISHABLE_KEY : '';

    if (!url || !key || url === 'YOUR_SUPABASE_PROJECT_URL' || key === 'YOUR_SUPABASE_PUBLISHABLE_KEY') {
      console.warn('[Roadways Presence] Supabase credentials not configured in supabase-config.js. Standard active session active.');
      this.updatePassengerUI(1);
      return;
    }

    if (typeof supabase === 'undefined' || !supabase.createClient) {
      console.error('[Roadways Presence] Supabase JS SDK not loaded.');
      this.updatePassengerUI(1);
      return;
    }

    try {
      console.log('[Roadways Presence] Supabase initializing...');
      this.supabaseClient = supabase.createClient(url, key);

      // Generate or retrieve stable anonymous session ID (UUID concept)
      this.passengerId = localStorage.getItem('roadways_passenger_id');
      if (!this.passengerId) {
        this.passengerId = 'passenger_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
        try { localStorage.setItem('roadways_passenger_id', this.passengerId); } catch(e) {}
      }

      console.log('[Roadways Presence] Anonymous Passenger ID:', this.passengerId);

      // Shared public presence channel
      this.presenceChannel = this.supabaseClient.channel('roadways-music', {
        config: {
          presence: {
            key: this.passengerId
          }
        }
      });

      this.isInitialPresenceSynced = false;

      this.presenceChannel
        .on('presence', { event: 'sync' }, () => {
          const state = this.presenceChannel.presenceState();
          const count = Object.keys(state).length;
          console.log('[Roadways Presence] Passenger sync event. Total active passengers:', count);
          
          this.updatePassengerUI(count);

          // Mark initial sync complete after first state sync
          if (!this.isInitialPresenceSynced) {
            this.isInitialPresenceSynced = true;
          }
        })
        .on('presence', { event: 'join' }, ({ key, newPresences }) => {
          console.log('[Roadways Presence] Passenger joined:', key);
          const state = this.presenceChannel.presenceState();
          const count = Object.keys(state).length;
          this.updatePassengerUI(count);

          // Only trigger onboarding animation for REMOTE users joining AFTER initial sync!
          if (this.isInitialPresenceSynced && key !== this.passengerId) {
            console.log('[Roadways Presence] Remote passenger onboard! Triggering bus animation.');
            this.triggerPassengerAnimation();
          }
        })
        .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
          console.log('[Roadways Presence] Passenger left:', key);
          const state = this.presenceChannel.presenceState();
          const count = Object.keys(state).length;
          this.updatePassengerUI(count);
        })
        .subscribe(async (status) => {
          console.log('[Roadways Presence] Channel subscribe status:', status);
          if (status === 'SUBSCRIBED') {
            const presenceTrackStatus = await this.presenceChannel.track({
              online_at: new Date().toISOString()
            });
            console.log('[Roadways Presence] Passenger track status:', presenceTrackStatus);
          }
        });

      // Proper cleanup on tab close / page unload
      window.addEventListener('beforeunload', () => {
        if (this.presenceChannel) {
          this.presenceChannel.untrack();
          this.supabaseClient.removeChannel(this.presenceChannel);
        }
      });

    } catch (err) {
      console.error('[Roadways Presence] Connection error:', err);
      this.updatePassengerUI(1);
    }
  }

  updatePassengerUI(count) {
    const validCount = Math.max(1, count || 1);
    if (this.onlineCountElement) {
      this.onlineCountElement.textContent = validCount;
    }
  }

  triggerPassengerAnimation() {
    const busSvg = document.getElementById('bus-svg');
    if (busSvg) {
      busSvg.classList.remove('bus-idle-anim');
      void busSvg.offsetWidth;
      busSvg.classList.add('bus-idle-anim');
    }
  }

  // 2. YOUTUBE IFRAME PLAYER ENGINE (PLG_xwT8XI-6E)
  initYouTubePlayer() {
    console.log('[Roadways] YouTube API ready. Initializing embedded player (200x200) for playlist:', this.playlistId);
    
    try {
      this.ytPlayer = new YT.Player('yt-player', {
        height: '200',
        width: '200',
        playerVars: {
          listType: 'playlist',
          list: this.playlistId,
          autoplay: 0,
          controls: 0,
          enablejsapi: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          origin: window.location.origin
        },
        events: {
          onReady: (e) => this.onPlayerReady(e),
          onStateChange: (e) => this.onPlayerStateChange(e),
          onError: (e) => this.onPlayerError(e)
        }
      });
    } catch (err) {
      console.error('[Roadways] Failed to construct YT.Player instance:', err);
    }
  }

  onPlayerReady(event) {
    console.log('[Roadways] Player ready & playlist cued:', this.playlistId);
    this.isReady = true;
    
    if (this.ytPlayer && typeof this.ytPlayer.cuePlaylist === 'function') {
      try {
        this.ytPlayer.cuePlaylist({
          listType: 'playlist',
          list: this.playlistId,
          index: 0,
          startSeconds: 0
        });
      } catch (err) {
        console.warn('[Roadways] cuePlaylist notice:', err);
      }
    }
    
    this.syncTrackMetadata();
  }

  onPlayerStateChange(event) {
    const stateNames = {
      '-1': 'UNSTARTED',
      '0': 'ENDED',
      '1': 'PLAYING',
      '2': 'PAUSED',
      '3': 'BUFFERING',
      '5': 'CUED'
    };
    const stateName = stateNames[event.data] || event.data;
    console.log(`[Roadways] Player state changed: ${stateName} (${event.data})`);

    switch (event.data) {
      case YT.PlayerState.PLAYING:
        console.log('[Roadways] Real audio stream is PLAYING.');
        this.isPlaying = true;
        this.updatePlayBtnState(true);
        if (this.albumDiscElement) this.albumDiscElement.classList.add('is-playing');
        this.startTicker();
        this.syncTrackMetadata();
        break;

      case YT.PlayerState.PAUSED:
        console.log('[Roadways] Player PAUSED.');
        this.isPlaying = false;
        this.updatePlayBtnState(false);
        if (this.albumDiscElement) this.albumDiscElement.classList.remove('is-playing');
        this.stopTicker();
        this.updateTimeAndProgress();
        break;

      case YT.PlayerState.BUFFERING:
        console.log('[Roadways] Audio stream BUFFERING...');
        break;

      case YT.PlayerState.ENDED:
        console.log('[Roadways] Track ENDED. Triggering next playlist track...');
        this.isPlaying = false;
        this.stopTicker();
        if (this.ytPlayer && typeof this.ytPlayer.nextVideo === 'function') {
          this.ytPlayer.nextVideo();
        }
        break;

      case YT.PlayerState.CUED:
        console.log('[Roadways] Playlist track CUED.');
        this.currentTime = 0;
        this.updateTimeAndProgress();
        this.syncTrackMetadata();
        break;
    }
  }

  onPlayerError(event) {
    const videoData = (this.ytPlayer && typeof this.ytPlayer.getVideoData === 'function') ? this.ytPlayer.getVideoData() : {};
    const videoId = videoData.video_id || 'unknown';
    const errorCode = event.data;
    
    console.error(`[Roadways] YouTube Error ${errorCode} for Video ID: ${videoId}`);
    
    if (errorCode === 100) {
      console.warn(`[Roadways] Error 100: Video ${videoId} not found or removed.`);
    } else if (errorCode === 101 || errorCode === 150) {
      console.warn(`[Roadways] Error ${errorCode}: Video ${videoId} owner does not allow embedded playback.`);
    } else if (errorCode === 153) {
      console.warn(`[Roadways] Error 153: Embed configuration or domain origin restriction for Video ${videoId}.`);
    }

    if (this.ytPlayer && typeof this.ytPlayer.nextVideo === 'function') {
      console.log('[Roadways] Skipping unplayable track in 1s...');
      setTimeout(() => {
        try { this.ytPlayer.nextVideo(); } catch(err) {}
      }, 1000);
    }
  }

  startTicker() {
    this.stopTicker();
    this.tickerInterval = setInterval(() => {
      this.updateTimeAndProgress();
    }, 200);
  }

  stopTicker() {
    if (this.tickerInterval) {
      clearInterval(this.tickerInterval);
      this.tickerInterval = null;
    }
  }

  updateTimeAndProgress() {
    if (!this.ytPlayer || typeof this.ytPlayer.getCurrentTime !== 'function') return;
    
    const current = this.ytPlayer.getCurrentTime() || 0;
    const dur = this.ytPlayer.getDuration() || 0;
    
    this.currentTime = current;
    this.duration = dur;
    
    this.updateProgressUI();
  }

  syncTrackMetadata() {
    if (!this.ytPlayer || typeof this.ytPlayer.getVideoData !== 'function') return;
    
    const videoData = this.ytPlayer.getVideoData();
    const videoId = videoData ? (videoData.video_id || '') : '';
    
    if (!videoId) {
      if (!this.hasResolvedInitialTrack) {
        if (this.songTitleElement) this.songTitleElement.textContent = "Loading…";
        if (this.artistNameElement) this.artistNameElement.textContent = "Connecting to Roadways Music";
      }
      return;
    }

    this.hasResolvedInitialTrack = true;

    const rawTitle = videoData.title || '';
    const author = videoData.author || '';
    
    console.log(`[Roadways] Active Video ID: ${videoId} | Title: "${rawTitle}"`);

    let cleanTitle = rawTitle
      .replace(/\(Official Video\)/gi, '')
      .replace(/\[Official Video\]/gi, '')
      .replace(/\(Official Audio\)/gi, '')
      .replace(/\[Official Audio\]/gi, '')
      .replace(/\(Full Song\)/gi, '')
      .replace(/\[4K\]/gi, '')
      .replace(/\(HD\)/gi, '')
      .trim();

    if (!cleanTitle && typeof PLAYLIST !== 'undefined' && PLAYLIST[this.currentIndex]) {
      cleanTitle = PLAYLIST[this.currentIndex].title;
    }

    if (this.songTitleElement) this.songTitleElement.textContent = cleanTitle || "Roadways 90s Hit";
    if (this.artistNameElement) this.artistNameElement.textContent = author || "Bollywood Classic";
    
    if (this.albumArtElement && videoId) {
      this.albumArtElement.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    }
  }

  // Playback Controls
  play() {
    if (!this.isReady || !this.ytPlayer) {
      console.warn('[Roadways] Play clicked before YouTube player is ready.');
      return;
    }
    console.log('[Roadways] User pressed Play. Calling ytPlayer.playVideo()...');
    try {
      this.ytPlayer.playVideo();
    } catch(err) {
      console.error('[Roadways] Error calling playVideo():', err);
    }
  }

  pause() {
    if (!this.ytPlayer) return;
    console.log('[Roadways] User pressed Pause. Calling ytPlayer.pauseVideo()...');
    try {
      this.ytPlayer.pauseVideo();
    } catch(err) {
      console.error('[Roadways] Error calling pauseVideo():', err);
    }
  }

  togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  next() {
    console.log('[Roadways] User pressed Next. Calling ytPlayer.nextVideo()...');
    this.currentTime = 0;
    this.updateProgressUI();
    if (this.ytPlayer && typeof this.ytPlayer.nextVideo === 'function') {
      this.ytPlayer.nextVideo();
    }
  }

  previous() {
    console.log('[Roadways] User pressed Previous. Calling ytPlayer.previousVideo()...');
    this.currentTime = 0;
    this.updateProgressUI();
    if (this.ytPlayer && typeof this.ytPlayer.previousVideo === 'function') {
      this.ytPlayer.previousVideo();
    }
  }

  seekToPercent(percentage) {
    const clampedPercent = Math.max(0, Math.min(100, percentage));
    if (this.ytPlayer && typeof this.ytPlayer.getDuration === 'function' && typeof this.ytPlayer.seekTo === 'function') {
      const dur = this.ytPlayer.getDuration() || this.duration;
      const targetSeconds = (clampedPercent / 100) * dur;
      console.log(`[Roadways] Seeking to ${clampedPercent.toFixed(1)}% (${targetSeconds.toFixed(1)}s)...`);
      this.ytPlayer.seekTo(targetSeconds, true);
      this.currentTime = targetSeconds;
      this.updateProgressUI();
    }
  }

  updatePlayBtnState(isPlaying) {
    if (!this.playBtn) return;
    if (isPlaying) {
      this.playBtn.setAttribute('aria-label', 'Pause');
      this.playBtn.setAttribute('aria-pressed', 'true');
      this.playBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"></path>
        </svg>
      `;
    } else {
      this.playBtn.setAttribute('aria-label', 'Play');
      this.playBtn.setAttribute('aria-pressed', 'false');
      this.playBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M8 5v14l11-7z"></path>
        </svg>
      `;
    }
  }

  updateProgressUI() {
    if (this.duration <= 0) {
      if (this.progressFill) this.progressFill.style.width = '0%';
      if (this.progressThumb) this.progressThumb.style.left = '0%';
      if (this.timeDisplayElement) this.timeDisplayElement.textContent = '0:00 / 0:00';
      return;
    }

    const percent = Math.max(0, Math.min(100, (this.currentTime / this.duration) * 100));
    if (this.progressFill) this.progressFill.style.width = `${percent}%`;
    if (this.progressThumb) this.progressThumb.style.left = `${percent}%`;
    if (this.timeDisplayElement) {
      this.timeDisplayElement.textContent = `${this.formatTime(this.currentTime)} / ${this.formatTime(this.duration)}`;
    }
  }

  formatTime(seconds) {
    const totalSecs = Math.max(0, Math.floor(seconds));
    const mins = Math.floor(totalSecs / 60);
    const secs = Math.floor(totalSecs % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  // Top Clock
  startClock() {
    const updateTime = () => {
      const now = new Date();
      let hours = now.getHours();
      const minutes = now.getMinutes();
      const ampm = hours >= 12 ? 'pm' : 'am';
      hours = hours % 12;
      hours = hours ? hours : 12;
      const minutesStr = minutes < 10 ? '0' + minutes : minutes;
      if (this.clockElement) {
        this.clockElement.textContent = `${hours}:${minutesStr} ${ampm}`;
      }
    };
    updateTime();
    setInterval(updateTime, 1000);
  }

  // Event Listeners
  setupEventListeners() {
    if (this.playBtn) {
      this.playBtn.addEventListener('click', () => this.togglePlay());
    }
    if (this.prevBtn) {
      this.prevBtn.addEventListener('click', () => this.previous());
    }
    if (this.nextBtn) {
      this.nextBtn.addEventListener('click', () => this.next());
    }

    if (this.progressBar) {
      const updateDragPosition = (e) => {
        const rect = this.progressBar.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const percentage = Math.max(0, Math.min(100, (clickX / rect.width) * 100));
        this.seekToPercent(percentage);
        return percentage;
      };

      this.progressBar.addEventListener('pointerdown', (e) => {
        this.isDragging = true;
        try {
          this.progressBar.setPointerCapture(e.pointerId);
        } catch(err) {}
        updateDragPosition(e);
      });

      this.progressBar.addEventListener('pointermove', (e) => {
        if (this.isDragging) {
          updateDragPosition(e);
        }
      });

      const handlePointerRelease = (e) => {
        if (this.isDragging) {
          const finalPercent = updateDragPosition(e);
          this.seekToPercent(finalPercent);
          this.isDragging = false;
          try {
            this.progressBar.releasePointerCapture(e.pointerId);
          } catch(err) {}
        }
      };

      this.progressBar.addEventListener('pointerup', handlePointerRelease);
      this.progressBar.addEventListener('pointercancel', handlePointerRelease);
    }

    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePlay();
      } else if (e.code === 'ArrowRight') {
        this.next();
      } else if (e.code === 'ArrowLeft') {
        this.previous();
      }
    });
  }
}

// Global YouTube IFrame API Callback
window.onYouTubeIframeAPIReady = function() {
  console.log('[Roadways] global onYouTubeIframeAPIReady fired.');
  if (window.roadwaysPlayer) {
    window.roadwaysPlayer.initYouTubePlayer();
  }
};

// Initialize Roadways Player on DOM Content Loaded
document.addEventListener('DOMContentLoaded', () => {
  window.roadwaysPlayer = new RoadwaysMusicPlayer();
  if (typeof YT !== 'undefined' && YT.Player && !window.roadwaysPlayer.ytPlayer) {
    console.log('[Roadways] YT script ready on DOMContentLoaded.');
    window.roadwaysPlayer.initYouTubePlayer();
  }
});
