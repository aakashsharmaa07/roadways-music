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
    this.trackRequestId = 0;
    this.metadataRafId = null;
    this.metadataResolutionToken = 0;
    this.isAutoAdvancing = false;
    this.renderedVideoId = null;
    this.artworkRequestId = 0;
    this.playbackIntent = 'paused';
    this.artworkCache = new Map();
    this.isTransitioningTrack = false;
    
    // Supabase Realtime Presence State
    this.supabaseClient = null;
    this.presenceChannel = null;
    this.passengerId = null;
    this.isInitialPresenceSynced = false;
    this.hasResolvedInitialTrack = false;
    this.metadataRetryTimer = null;
    this.initialRetryTimer = null;
    this.isFetchingInitialOembed = false;

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
    this.metadataContainer = document.getElementById('metadata-container');

    // Perfect Seek Dragging & Synchronization Lock State
    this.isSeeking = false;
    this.dragTrackRect = null;
    this.dragRafId = null;
    this.pendingClientX = 0;
    this.seekSync = {
      active: false,
      targetTime: 0,
      direction: 'forward'
    };

    // Per-Session Shuffle Playback State
    this.shuffleOrder = [];
    this.shufflePosition = 0;
    this.isShuffleInitialized = false;
    this.initialShuffleReady = false;

    this.init();
  }

  init() {
    this.startClock();
    this.initSupabasePresence();
    this.setupEventListeners();
  }

  handleResolvedYouTubeTrack(track) {
    if (!track || !track.videoId) return;

    // Strict Boot Contract: BLOCK any metadata rendering before initial shuffle is ready!
    if (!this.initialShuffleReady) {
      console.log('[BOOT] ignoring pre-shuffle track render attempt for videoId:', track ? track.videoId : 'unknown');
      return;
    }
    
    const videoId = track.videoId;

    // Deduplication check: Do NOT re-animate if this video ID is already rendered
    if (videoId === this.renderedVideoId) {
      return;
    }

    this.renderedVideoId = videoId;

    const newTitle = track.title || '';
    const newArtist = track.artist || '';
    const newArtwork = track.artwork || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

    // 1. Ultra-Fast Coordinated Track Metadata Animation (50ms Exit -> 90ms Enter = 140ms Total)
    const currentTitle = this.songTitleElement ? this.songTitleElement.textContent : '';
    const currentArtist = this.artistNameElement ? this.artistNameElement.textContent : '';

    if (this.metadataContainer && (currentTitle !== newTitle || currentArtist !== newArtist)) {
      this.metadataContainer.classList.remove('metadata-enter-prepare', 'metadata-enter-active');
      this.metadataContainer.classList.add('metadata-exit');

      setTimeout(() => {
        if (this.songTitleElement) this.songTitleElement.textContent = newTitle;
        if (this.artistNameElement) this.artistNameElement.textContent = newArtist;

        this.metadataContainer.classList.remove('metadata-exit');
        this.metadataContainer.classList.add('metadata-enter-prepare');

        requestAnimationFrame(() => {
          this.metadataContainer.classList.remove('metadata-enter-prepare');
          this.metadataContainer.classList.add('metadata-enter-active');
          
          setTimeout(() => {
            if (this.metadataContainer) {
              this.metadataContainer.classList.remove('metadata-enter-active');
            }
          }, 90);
        });
      }, 50);
    } else {
      if (this.songTitleElement) this.songTitleElement.textContent = newTitle;
      if (this.artistNameElement) this.artistNameElement.textContent = newArtist;
    }

    // 2. Asynchronous Artwork Preload with In-Memory Caching & Video ID Protection
    if (this.albumArtElement && newArtwork) {
      if (this.artworkCache.has(newArtwork)) {
        if (this.renderedVideoId === videoId && this.albumArtElement) {
          this.albumArtElement.src = newArtwork;
          this.albumArtElement.setAttribute('data-loaded-src', newArtwork);
          this.albumArtElement.classList.remove('is-swapping');
        }
      } else {
        this.albumArtElement.classList.add('is-swapping');
        
        const tempImg = new Image();
        tempImg.decoding = 'async';
        tempImg.src = newArtwork;

        let swapped = false;
        const completeSwap = () => {
          if (swapped) return;
          swapped = true;
          this.artworkCache.set(newArtwork, true);
          if (this.renderedVideoId === videoId && this.albumArtElement) {
            this.albumArtElement.src = newArtwork;
            this.albumArtElement.setAttribute('data-loaded-src', newArtwork);
            this.albumArtElement.classList.remove('is-swapping');
          }
        };

        tempImg.onload = completeSwap;
        tempImg.onerror = completeSwap;
        setTimeout(completeSwap, 100);
      }
    }
  }

  renderTrackMetadata(track) {
    this.handleResolvedYouTubeTrack(track);
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

  // Per-Session Fisher-Yates Shuffle Engine
  generateShuffleOrder(length) {
    if (!length || length <= 0) return [];
    const indices = Array.from({ length }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices;
  }

  initSessionShuffle() {
    if (this.isShuffleInitialized && this.initialShuffleReady) return true;
    const playlist = (this.ytPlayer && typeof this.ytPlayer.getPlaylist === 'function') ? this.ytPlayer.getPlaylist() : null;
    const length = (playlist && Array.isArray(playlist)) ? playlist.length : 0;

    if (length > 0) {
      this.shuffleOrder = this.generateShuffleOrder(length);
      this.shufflePosition = 0;
      this.isShuffleInitialized = true;
      this.initialShuffleReady = true;
      console.log(`[BOOT] shuffle ready -> initialIndex: ${this.shuffleOrder[0]} (order length: ${length})`);
      return true;
    }
    return false;
  }

  syncShufflePositionWithYouTube() {
    if (!this.shuffleOrder || this.shuffleOrder.length === 0) return;
    const currentIndex = (this.ytPlayer && typeof this.ytPlayer.getPlaylistIndex === 'function') ? this.ytPlayer.getPlaylistIndex() : -1;
    if (currentIndex >= 0) {
      const pos = this.shuffleOrder.indexOf(currentIndex);
      if (pos !== -1) {
        this.shufflePosition = pos;
      }
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
    console.log('[Roadways] INITIAL PLAYER READY');
    this.isReady = true;
    
    this.initSessionShuffle();
    const initialIndex = (this.shuffleOrder && this.shuffleOrder.length > 0) ? this.shuffleOrder[0] : 0;

    if (this.ytPlayer && typeof this.ytPlayer.cuePlaylist === 'function') {
      try {
        console.log(`[Roadways Shuffle] CUEING INITIAL SHUFFLED TRACK AT INDEX ${initialIndex}`);
        this.ytPlayer.cuePlaylist({
          listType: 'playlist',
          list: this.playlistId,
          index: initialIndex,
          startSeconds: 0
        });
      } catch (err) {
        console.warn('[Roadways] cuePlaylist notice:', err);
      }
    }

    // Dedicated initial track resolution requiring videoId, title AND author for initial shuffled track
    this.resolveInitialYouTubeTrack(0);
  }

  onPlayerStateChange(event) {
    const currentToken = this.trackRequestId;
    const stateNames = {
      '-1': 'UNSTARTED',
      '0': 'ENDED',
      '1': 'PLAYING',
      '2': 'PAUSED',
      '3': 'BUFFERING',
      '5': 'CUED'
    };
    const stateName = stateNames[event.data] || event.data;
    console.log(`[Roadways] YOUTUBE STATE: ${stateName} (${event.data})`);

    switch (event.data) {
      case YT.PlayerState.PLAYING:
        this.isTransitioningTrack = false;
        this.isPlaying = true;
        this.playbackIntent = 'playing';
        this.isAutoAdvancing = false;
        this.updatePlayBtnState(true);
        if (this.albumDiscElement) this.albumDiscElement.classList.add('is-playing');
        this.startTicker();
        this.pollForYouTubeVideoChange(this.renderedVideoId, 0);
        break;

      case YT.PlayerState.PAUSED:
        if (this.playbackIntent === 'paused' || !this.isTransitioningTrack) {
          this.isPlaying = false;
          this.updatePlayBtnState(false);
          if (this.albumDiscElement) this.albumDiscElement.classList.remove('is-playing');
          this.stopTicker();
          this.updateTimeAndProgress();
        }
        this.pollForYouTubeVideoChange(this.renderedVideoId, 0);
        break;

      case YT.PlayerState.BUFFERING:
        this.isTransitioningTrack = true;
        if (this.playbackIntent === 'playing') {
          this.updatePlayBtnState(true);
          if (this.albumDiscElement) this.albumDiscElement.classList.add('is-playing');
        }
        this.pollForYouTubeVideoChange(this.renderedVideoId, 0);
        break;

      case YT.PlayerState.ENDED: {
        console.log('[Roadways] ENDED fired');
        this.isTransitioningTrack = true;
        this.isAutoAdvancing = true;

        this.initSessionShuffle();

        let nextTargetIndex = 0;
        if (this.shuffleOrder && this.shuffleOrder.length > 0) {
          this.shufflePosition = (this.shufflePosition + 1) % this.shuffleOrder.length;
          nextTargetIndex = this.shuffleOrder[this.shufflePosition];
          console.log(`[Roadways Shuffle] AUTO-NEXT ENDED: position ${this.shufflePosition}/${this.shuffleOrder.length - 1} -> target YouTube index ${nextTargetIndex}`);
        } else {
          const playlist = (this.ytPlayer && typeof this.ytPlayer.getPlaylist === 'function') ? this.ytPlayer.getPlaylist() : null;
          const currentPlaylistIndex = (this.ytPlayer && typeof this.ytPlayer.getPlaylistIndex === 'function') ? this.ytPlayer.getPlaylistIndex() : -1;
          const playlistLength = (playlist && Array.isArray(playlist)) ? playlist.length : 0;
          if (playlistLength > 0 && currentPlaylistIndex >= 0) {
            nextTargetIndex = (currentPlaylistIndex + 1) % playlistLength;
          }
        }

        console.log(`[Roadways Shuffle] AUTO-NEXT COMMAND: playVideoAt(${nextTargetIndex})`);

        const previousVideoId = this.renderedVideoId;
        this.currentTime = 0;
        this.seekSync.active = false;
        this.playbackIntent = 'playing';
        this.isPlaying = true;
        this.updatePlayBtnState(true);
        if (this.albumDiscElement) this.albumDiscElement.classList.add('is-playing');
        this.updateProgressUI();
        this.startTicker();

        if (this.ytPlayer && typeof this.ytPlayer.playVideoAt === 'function') {
          try {
            this.ytPlayer.playVideoAt(nextTargetIndex);
          } catch (err) {
            console.warn('[Roadways] playVideoAt error on ENDED:', err);
          }
        }

        this.pollForYouTubeVideoChange(previousVideoId, 0);
        break;
      }

      case YT.PlayerState.CUED:
      case -1: // UNSTARTED
        this.currentTime = 0;
        this.updateTimeAndProgress();
        this.resolveInitialYouTubeTrack(0);
        this.pollForYouTubeVideoChange(this.renderedVideoId, 0);
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
    this.duration = dur;
    
    // Seek Synchronization Reconciliation (Prevents stale YouTube getCurrentTime() responses from jumping UI)
    if (this.seekSync.active) {
      if (this.seekSync.direction === 'forward') {
        if (current < this.seekSync.targetTime - 0.5) {
          // YouTube has not caught up yet to forward seek target -> maintain target position
          return;
        } else {
          // YouTube caught up! Release lock
          this.seekSync.active = false;
        }
      } else {
        if (current > this.seekSync.targetTime + 1.0) {
          // YouTube has not caught up yet to backward seek target -> maintain target position
          return;
        } else {
          // YouTube caught up! Release lock
          this.seekSync.active = false;
        }
      }
    }

    this.currentTime = current;
    this.updateProgressUI();
  }

  clearMetadataRetries() {
    if (this.metadataRetryTimer) {
      clearTimeout(this.metadataRetryTimer);
      this.metadataRetryTimer = null;
    }
  }

  clearInitialRetries() {
    if (this.initialRetryTimer) {
      clearTimeout(this.initialRetryTimer);
      this.initialRetryTimer = null;
    }
  }

  resolveInitialYouTubeTrack(retryCount = 0) {
    if (this.hasResolvedInitialTrack) return;

    const shuffleReady = this.initSessionShuffle();
    const playlist = (this.ytPlayer && typeof this.ytPlayer.getPlaylist === 'function') ? this.ytPlayer.getPlaylist() : null;

    if (!shuffleReady || !playlist || !Array.isArray(playlist) || playlist.length === 0) {
      console.log('[BOOT] shuffle not ready -> maintaining Loading state');
      if (retryCount < 100 && !this.hasResolvedInitialTrack) {
        this.initialRetryTimer = setTimeout(() => {
          this.resolveInitialYouTubeTrack(retryCount + 1);
        }, 30);
      }
      return;
    }

    const initialIndex = (this.shuffleOrder && this.shuffleOrder.length > 0) ? this.shuffleOrder[0] : 0;
    const targetVideoId = playlist[initialIndex] || '';

    if (!targetVideoId) return;

    console.log(`[BOOT] target shuffled videoId: ${targetVideoId} (index ${initialIndex})`);

    const videoData = (this.ytPlayer && typeof this.ytPlayer.getVideoData === 'function') ? this.ytPlayer.getVideoData() : null;
    let rawTitle = (videoData && videoData.video_id === targetVideoId) ? (videoData.title || '') : '';
    let author = (videoData && videoData.video_id === targetVideoId) ? (videoData.author || '') : '';

    if (videoData && videoData.video_id && videoData.video_id !== targetVideoId) {
      console.log(`[BOOT] ignoring pre-shuffle video: ${videoData.video_id}`);
    }

    // Case 1: Direct YouTube player data contains videoId matching targetVideoId, with rawTitle AND author
    if (rawTitle && author) {
      this.hasResolvedInitialTrack = true;

      let cleanTitle = rawTitle
        .replace(/\(Official Video\)/gi, '')
        .replace(/\[Official Video\]/gi, '')
        .replace(/\(Official Audio\)/gi, '')
        .replace(/\[Official Audio\]/gi, '')
        .replace(/\(Full Song\)/gi, '')
        .replace(/\[4K\]/gi, '')
        .replace(/\(HD\)/gi, '')
        .trim();

      const activeArtwork = `https://img.youtube.com/vi/${targetVideoId}/hqdefault.jpg`;
      console.log(`[BOOT] rendering initial shuffled track: ${targetVideoId} ("${cleanTitle}" by "${author}")`);

      this.handleResolvedYouTubeTrack({
        videoId: targetVideoId,
        title: cleanTitle,
        artist: author,
        artwork: activeArtwork
      });
      return;
    }

    // Case 2: Player hasn't exposed title/author for targetVideoId while paused -> fetch oEmbed metadata for targetVideoId
    if (!this.isFetchingInitialOembed) {
      this.isFetchingInitialOembed = true;
      console.log(`[BOOT] Fetching oEmbed metadata for target shuffled videoId="${targetVideoId}"...`);
      
      fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${targetVideoId}`)
        .then(res => res.json())
        .then(data => {
          if (this.hasResolvedInitialTrack) return;
          const fetchedTitle = data.title || '';
          const fetchedAuthor = data.author_name || '';

          if (fetchedTitle) {
            this.hasResolvedInitialTrack = true;
            let cleanTitle = fetchedTitle
              .replace(/\(Official Video\)/gi, '')
              .replace(/\[Official Video\]/gi, '')
              .replace(/\(Official Audio\)/gi, '')
              .replace(/\[Official Audio\]/gi, '')
              .replace(/\(Full Song\)/gi, '')
              .replace(/\[4K\]/gi, '')
              .replace(/\(HD\)/gi, '')
              .trim();

            const activeArtwork = `https://img.youtube.com/vi/${targetVideoId}/hqdefault.jpg`;
            console.log(`[BOOT] rendering initial shuffled track: ${targetVideoId} ("${cleanTitle}" by "${fetchedAuthor}")`);

            this.handleResolvedYouTubeTrack({
              videoId: targetVideoId,
              title: cleanTitle,
              artist: fetchedAuthor,
              artwork: activeArtwork
            });
          }
        })
        .catch(err => {
          console.warn('[Roadways] oEmbed fetch notice:', err);
        })
        .finally(() => {
          this.isFetchingInitialOembed = false;
        });
    }

    // High-frequency 30ms background retry (up to 100 attempts / 3.0s) while paused
    if (retryCount < 100 && !this.hasResolvedInitialTrack) {
      this.initialRetryTimer = setTimeout(() => {
        this.resolveInitialYouTubeTrack(retryCount + 1);
      }, 30);
    }
  }

  pollForYouTubeVideoChange(previousVideoId, retryCount = 0) {
    this.clearMetadataRetries();

    // Guard: Before initial shuffled track is resolved, block all polling updates
    if (!this.initialShuffleReady || !this.hasResolvedInitialTrack) {
      this.resolveInitialYouTubeTrack(0);
      return;
    }

    const videoData = (this.ytPlayer && typeof this.ytPlayer.getVideoData === 'function') ? this.ytPlayer.getVideoData() : null;
    const videoId = videoData ? (videoData.video_id || '') : '';
    const rawTitle = videoData ? (videoData.title || '') : '';
    const author = videoData ? (videoData.author || '') : '';

    // Case A: A new video_id AND non-empty title & author are available from YouTube
    if (videoId && rawTitle && author && videoId !== previousVideoId) {
      this.hasResolvedInitialTrack = true;
      this.syncShufflePositionWithYouTube();
      console.log(`[Roadways] NEW VIDEO DETECTED: Video ID: ${videoId} | Title: "${rawTitle}" by ${author}`);

      let cleanTitle = rawTitle
        .replace(/\(Official Video\)/gi, '')
        .replace(/\[Official Video\]/gi, '')
        .replace(/\(Official Audio\)/gi, '')
        .replace(/\[Official Audio\]/gi, '')
        .replace(/\(Full Song\)/gi, '')
        .replace(/\[4K\]/gi, '')
        .replace(/\(HD\)/gi, '')
        .trim();

      const activeArtwork = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
      console.log(`[Roadways] METADATA RESOLVED: Video ID: ${videoId}, Title: "${cleanTitle}", Artist: "${author}"`);
      console.log(`[Roadways] ARTWORK APPLIED: Video ID: ${videoId}`);

      this.handleResolvedYouTubeTrack({
        videoId: videoId,
        title: cleanTitle,
        artist: author,
        artwork: activeArtwork
      });
      return;
    }

    // Case B: Initial load fallback if not yet resolved
    if (!this.hasResolvedInitialTrack && videoId && rawTitle && author) {
      this.resolveInitialYouTubeTrack(0);
      return;
    }

    // Continue polling YouTube for up to 50 attempts (2 seconds) until new video_id & title appear
    if (retryCount < 50) {
      this.metadataRetryTimer = setTimeout(() => {
        this.pollForYouTubeVideoChange(previousVideoId, retryCount + 1);
      }, 40);
    }
  }

  resolveCurrentYouTubeTrack(retryCount = 0) {
    if (!this.hasResolvedInitialTrack) {
      this.resolveInitialYouTubeTrack(retryCount);
    } else {
      this.pollForYouTubeVideoChange(this.renderedVideoId, retryCount);
    }
  }

  syncTrackMetadata(retryCount = 0) {
    this.resolveCurrentYouTubeTrack(retryCount);
  }

  play() {
    this.playbackIntent = 'playing';
    this.isPlaying = true;
    this.updatePlayBtnState(true);
    if (this.albumDiscElement) this.albumDiscElement.classList.add('is-playing');
    this.startTicker();

    if (this.isReady && this.ytPlayer) {
      try {
        this.initSessionShuffle();
        const targetIndex = (this.shuffleOrder && this.shuffleOrder.length > 0) ? this.shuffleOrder[this.shufflePosition] : 0;
        const currentIndex = (typeof this.ytPlayer.getPlaylistIndex === 'function') ? this.ytPlayer.getPlaylistIndex() : -1;
        
        if (currentIndex !== targetIndex && typeof this.ytPlayer.playVideoAt === 'function') {
          console.log(`[Roadways Shuffle] PLAY: Syncing player index to shuffleTarget ${targetIndex} (was ${currentIndex})`);
          this.ytPlayer.playVideoAt(targetIndex);
        } else if (typeof this.ytPlayer.playVideo === 'function') {
          this.ytPlayer.playVideo();
        }
      } catch(err) {
        console.error('[Roadways] Error calling playVideo():', err);
      }
    }
  }

  pause() {
    this.playbackIntent = 'paused';
    this.isPlaying = false;
    this.updatePlayBtnState(false);
    if (this.albumDiscElement) this.albumDiscElement.classList.remove('is-playing');
    this.stopTicker();

    if (this.ytPlayer && typeof this.ytPlayer.pauseVideo === 'function') {
      try {
        this.ytPlayer.pauseVideo();
      } catch(err) {
        console.error('[Roadways] Error calling pauseVideo():', err);
      }
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
    const requestId = ++this.trackRequestId;
    const previousVideoId = this.renderedVideoId;
    this.isTransitioningTrack = true;
    console.log(`[Roadways] NAVIGATION: Previous Video ID: "${previousVideoId}", Navigation: NEXT (Req #${requestId})`);

    this.currentTime = 0;
    this.seekSync.active = false;
    this.updateProgressUI();

    this.initSessionShuffle();

    if (this.ytPlayer) {
      try {
        if (this.shuffleOrder && this.shuffleOrder.length > 0) {
          this.shufflePosition = (this.shufflePosition + 1) % this.shuffleOrder.length;
          const targetIndex = this.shuffleOrder[this.shufflePosition];
          console.log(`[Roadways Shuffle] NEXT: position ${this.shufflePosition}/${this.shuffleOrder.length - 1} -> target YouTube index ${targetIndex}`);

          if (typeof this.ytPlayer.playVideoAt === 'function') {
            this.ytPlayer.playVideoAt(targetIndex);
          } else if (typeof this.ytPlayer.nextVideo === 'function') {
            this.ytPlayer.nextVideo();
          }
        } else if (typeof this.ytPlayer.nextVideo === 'function') {
          this.ytPlayer.nextVideo();
        }
      } catch (err) {
        console.warn('[Roadways] next error:', err);
      }
    }

    // Start video change detector polling until YouTube returns NEW video ID
    this.pollForYouTubeVideoChange(previousVideoId, 0);
  }

  previous() {
    const requestId = ++this.trackRequestId;
    const previousVideoId = this.renderedVideoId;
    this.isTransitioningTrack = true;
    console.log(`[Roadways] NAVIGATION: Previous Video ID: "${previousVideoId}", Navigation: PREVIOUS (Req #${requestId})`);

    this.currentTime = 0;
    this.seekSync.active = false;
    this.updateProgressUI();

    this.initSessionShuffle();

    if (this.ytPlayer) {
      try {
        if (this.shuffleOrder && this.shuffleOrder.length > 0) {
          this.shufflePosition = (this.shufflePosition - 1 + this.shuffleOrder.length) % this.shuffleOrder.length;
          const targetIndex = this.shuffleOrder[this.shufflePosition];
          console.log(`[Roadways Shuffle] PREVIOUS: position ${this.shufflePosition}/${this.shuffleOrder.length - 1} -> target YouTube index ${targetIndex}`);

          if (typeof this.ytPlayer.playVideoAt === 'function') {
            this.ytPlayer.playVideoAt(targetIndex);
          } else if (typeof this.ytPlayer.previousVideo === 'function') {
            this.ytPlayer.previousVideo();
          }
        } else if (typeof this.ytPlayer.previousVideo === 'function') {
          this.ytPlayer.previousVideo();
        }
      } catch (err) {
        console.warn('[Roadways] previous error:', err);
      }
    }

    // Start video change detector polling until YouTube returns NEW video ID
    this.pollForYouTubeVideoChange(previousVideoId, 0);
  }

  seekToSeconds(seconds) {
    if (this.duration <= 0) return;
    const targetSeconds = Math.max(0, Math.min(this.duration, seconds));
    
    // Determine direction relative to current position
    const direction = targetSeconds >= this.currentTime ? 'forward' : 'backward';

    // Lock seekSync state to prevent stale YouTube getCurrentTime() responses from pulling UI backward/forward
    this.seekSync.active = true;
    this.seekSync.targetTime = targetSeconds;
    this.seekSync.direction = direction;

    this.currentTime = targetSeconds;
    this.updateProgressUI();

    if (this.ytPlayer && typeof this.ytPlayer.seekTo === 'function') {
      try {
        this.ytPlayer.seekTo(targetSeconds, true);
      } catch (err) {
        console.warn('[Roadways] seekTo error:', err);
      }
    }
  }

  seekToPercent(percentage) {
    const clampedPercent = Math.max(0, Math.min(100, percentage));
    const dur = (this.ytPlayer && typeof this.ytPlayer.getDuration === 'function') ? (this.ytPlayer.getDuration() || this.duration) : this.duration;
    if (dur > 0) {
      const targetSeconds = (clampedPercent / 100) * dur;
      this.seekToSeconds(targetSeconds);
    }
  }

  // Compositor-Synchronized Drag Frame Renderer (Zero Micro-Jitter)
  renderDragFrame() {
    this.dragRafId = null;
    if (!this.isSeeking || !this.dragTrackRect) return;

    const width = this.dragTrackRect.width || 1;
    const ratio = Math.max(0, Math.min(1, (this.pendingClientX - this.dragTrackRect.left) / width));
    const dur = (this.ytPlayer && typeof this.ytPlayer.getDuration === 'function') ? (this.ytPlayer.getDuration() || this.duration) : this.duration;
    const previewSec = ratio * (dur || 100);

    if (this.progressFill) {
      this.progressFill.style.transform = `scaleX(${ratio})`;
    }
    if (this.progressThumb) {
      const offsetPx = ratio * width;
      this.progressThumb.style.transform = `translate(${offsetPx}px, -50%) translate(-50%, 0)`;
    }
    if (this.timeDisplayElement) {
      this.timeDisplayElement.textContent = `${this.formatTime(previewSec)} / ${this.formatTime(dur)}`;
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

  updateProgressUI(overrideSeconds = null) {
    // CRITICAL: While active dragging, pointer position is 100% authoritative!
    if (this.isSeeking && overrideSeconds === null) {
      return;
    }

    const current = (overrideSeconds !== null) ? overrideSeconds : this.currentTime;
    if (this.duration <= 0) {
      if (this.progressFill) this.progressFill.style.transform = 'scaleX(0)';
      if (this.progressThumb) this.progressThumb.style.transform = 'translate(-50%, -50%) translateX(0px)';
      if (this.timeDisplayElement) this.timeDisplayElement.textContent = '0:00 / 0:00';
      return;
    }

    const scaleFactor = Math.max(0, Math.min(1, current / this.duration));
    if (this.progressFill) {
      this.progressFill.style.transform = `scaleX(${scaleFactor})`;
    }
    if (this.progressThumb && this.progressBar) {
      const barWidth = this.progressBar.clientWidth || 300;
      const offsetPx = scaleFactor * barWidth;
      this.progressThumb.style.transform = `translate(${offsetPx}px, -50%) translate(-50%, 0)`;
    }
    if (this.timeDisplayElement) {
      this.timeDisplayElement.textContent = `${this.formatTime(current)} / ${this.formatTime(this.duration)}`;
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

    // Progress Bar Listeners — PERFECT FLUID DRAG SEEK (Zero Jitter, Composite RAF)
    if (this.progressBar) {
      this.progressBar.addEventListener('pointerdown', (e) => {
        this.isSeeking = true;
        this.progressBar.classList.add('is-seeking');
        try { this.progressBar.setPointerCapture(e.pointerId); } catch(err) {}
        
        // Cache geometry ONCE on pointerdown
        this.dragTrackRect = this.progressBar.getBoundingClientRect();
        this.pendingClientX = e.clientX;
        this.renderDragFrame();
      });

      this.progressBar.addEventListener('pointermove', (e) => {
        if (!this.isSeeking) return;
        this.pendingClientX = e.clientX;
        if (!this.dragRafId) {
          this.dragRafId = requestAnimationFrame(() => this.renderDragFrame());
        }
      });

      const handleProgressPointerRelease = (e) => {
        if (!this.isSeeking) return;
        
        if (this.dragRafId) {
          cancelAnimationFrame(this.dragRafId);
          this.dragRafId = null;
        }

        const width = this.dragTrackRect ? (this.dragTrackRect.width || 1) : (this.progressBar.clientWidth || 1);
        const left = this.dragTrackRect ? this.dragTrackRect.left : 0;
        const ratio = Math.max(0, Math.min(1, (e.clientX - left) / width));
        const dur = (this.ytPlayer && typeof this.ytPlayer.getDuration === 'function') ? (this.ytPlayer.getDuration() || this.duration) : this.duration;
        const finalSeconds = ratio * (dur || 100);

        this.isSeeking = false;
        this.dragTrackRect = null;
        this.progressBar.classList.remove('is-seeking');
        try { this.progressBar.releasePointerCapture(e.pointerId); } catch(err) {}

        // Single seekTo call on release!
        this.seekToSeconds(finalSeconds);
      };

      this.progressBar.addEventListener('pointerup', handleProgressPointerRelease);
      this.progressBar.addEventListener('pointercancel', handleProgressPointerRelease);
      this.progressBar.addEventListener('lostpointercapture', handleProgressPointerRelease);
    }

    // Keyboard Shortcuts (Space, ←, →, N, P)
    document.addEventListener('keydown', (e) => {
      const activeEl = document.activeElement;
      const tagName = activeEl ? activeEl.tagName : '';
      if (
        tagName === 'INPUT' || 
        tagName === 'TEXTAREA' || 
        tagName === 'SELECT' || 
        (activeEl && activeEl.isContentEditable)
      ) {
        return;
      }

      const code = e.code;
      const key = e.key ? e.key.toLowerCase() : '';

      if (code === 'Space') {
        e.preventDefault();
        this.togglePlay();
      } else if (code === 'ArrowLeft') {
        e.preventDefault();
        const newSec = Math.max(0, this.currentTime - 5);
        this.seekToSeconds(newSec);
      } else if (code === 'ArrowRight') {
        e.preventDefault();
        const dur = (this.duration > 0) ? this.duration : 100;
        const newSec = Math.min(dur, this.currentTime + 5);
        this.seekToSeconds(newSec);
      } else if (code === 'KeyN' || key === 'n') {
        e.preventDefault();
        this.next();
      } else if (code === 'KeyP' || key === 'p') {
        e.preventDefault();
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
