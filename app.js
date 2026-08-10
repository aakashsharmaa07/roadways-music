// Roadways Music Application - Core Logic Architecture (Phase 2 Prep: Glass Clock & Track Reset)

class RoadwaysMusicPlayer {
  constructor() {
    this.currentIndex = 0;
    this.isPlaying = false;
    this.currentTime = 0; // Starts cleanly at 0:00 for the loaded song
    this.duration = 296;  // Duration dynamically set per track
    this.isDragging = false;
    
    // High Precision Playback Clock State
    this.playStartedAt = 0;
    this.startPosition = 0;
    this.animFrameId = null;

    // DOM Elements
    this.clockElement = document.getElementById('live-clock');
    this.onlineCountElement = document.getElementById('online-count');
    this.songTitleElement = document.getElementById('song-title');
    this.artistNameElement = document.getElementById('artist-name');
    this.albumArtElement = document.getElementById('album-art');
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
    this.startLivePresenceSimulator();
    this.loadSong(this.currentIndex);
    this.setupEventListeners();
  }

  // 1. TOP LEFT: Real-time clock (Wrapped in small glass pill)
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

  // 2. TOP CENTER: Roadways Passenger Indicator Simulator
  startLivePresenceSimulator() {
    let currentCount = 26;
    const updateCount = () => {
      const delta = Math.floor(Math.random() * 5) - 2;
      currentCount = Math.max(20, Math.min(36, currentCount + delta));
      if (this.onlineCountElement) {
        this.onlineCountElement.textContent = currentCount;
      }
      this.triggerPassengerAnimation();
    };
    setInterval(updateCount, 12000);
  }

  // 3. REUSABLE BUS MICRO-ANIMATION TRIGGER
  triggerPassengerAnimation() {
    const busSvg = document.getElementById('bus-svg');
    if (busSvg) {
      busSvg.classList.remove('bus-idle-anim');
      void busSvg.offsetWidth; // trigger reflow
      busSvg.classList.add('bus-idle-anim');
    }
  }

  // 4. SONG METADATA & STATE INITIALIZATION (Centralized Reset for Every New Track)
  loadSong(index) {
    if (index < 0) index = PLAYLIST.length - 1;
    if (index >= PLAYLIST.length) index = 0;
    this.currentIndex = index;
    
    const track = PLAYLIST[this.currentIndex];
    if (this.songTitleElement) this.songTitleElement.textContent = track.title;
    if (this.artistNameElement) this.artistNameElement.textContent = track.artist;
    if (this.albumArtElement && track.artwork) {
      this.albumArtElement.src = track.artwork;
    }
    
    // Set duration from track metadata
    this.duration = track.durationSeconds || 296;
    
    // Complete playback reset to 0:00 for the newly loaded song
    this.currentTime = 0;
    this.startPosition = 0;
    this.playStartedAt = performance.now();
    
    // Immediately update UI to 0:00 and 0%
    this.updateProgressUI();
    
    // Preserve current PLAY/PAUSE state
    if (this.isPlaying) {
      this.startPlaybackClock();
    } else {
      this.stopPlaybackClock();
    }

    console.log(`[Phase 2 Prep] Loaded track ${this.currentIndex + 1}: ${track.title} (Duration: ${this.formatTime(this.duration)})`);
  }

  // 5. HIGH-PRECISION DRIFT-FREE PLAYBACK CLOCK
  startPlaybackClock() {
    this.playStartedAt = performance.now();
    this.startPosition = this.currentTime;
    
    const tick = () => {
      if (!this.isPlaying) return;
      
      const elapsed = (performance.now() - this.playStartedAt) / 1000;
      this.currentTime = Math.min(this.duration, this.startPosition + elapsed);
      this.updateProgressUI();
      
      if (this.currentTime >= this.duration) {
        this.handleSongEnded();
        return;
      }
      
      this.animFrameId = requestAnimationFrame(tick);
    };
    
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    this.animFrameId = requestAnimationFrame(tick);
  }

  stopPlaybackClock() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  // 6. PLAY / PAUSE CONTROLS
  play() {
    if (this.currentTime >= this.duration) {
      this.currentTime = 0;
    }
    
    this.isPlaying = true;
    if (this.albumArtElement) {
      this.albumArtElement.classList.add('is-playing');
    }
    if (this.playBtn) {
      this.playBtn.setAttribute('aria-label', 'Pause');
      this.playBtn.setAttribute('aria-pressed', 'true');
      this.playBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"></path>
        </svg>
      `;
    }
    this.startPlaybackClock();
  }

  pause() {
    this.isPlaying = false;
    this.stopPlaybackClock();
    if (this.albumArtElement) {
      this.albumArtElement.classList.remove('is-playing');
    }
    if (this.playBtn) {
      this.playBtn.setAttribute('aria-label', 'Play');
      this.playBtn.setAttribute('aria-pressed', 'false');
      this.playBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M8 5v14l11-7z"></path>
        </svg>
      `;
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
    this.loadSong(this.currentIndex + 1);
  }

  previous() {
    this.loadSong(this.currentIndex - 1);
  }

  // 7. SEEK TO PERCENTAGE (Operates relative to currently loaded song's duration)
  seekToPercent(percentage) {
    const clampedPercent = Math.max(0, Math.min(100, percentage));
    this.currentTime = (clampedPercent / 100) * this.duration;
    this.updateProgressUI();
    
    // If playing while seeking, reset clock reference point smoothly
    if (this.isPlaying) {
      this.playStartedAt = performance.now();
      this.startPosition = this.currentTime;
    }
  }

  // 8. SONG END HANDLER
  handleSongEnded() {
    this.currentTime = this.duration;
    this.pause();
    this.updateProgressUI();
    console.log(`[Phase 2 Prep] Track finished (${this.formatTime(this.duration)})`);
  }

  updateProgressUI() {
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

  // 9. DRAGGABLE SEEK BAR LOGIC (Pointer Events: Mouse, Trackpad, Touch)
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

    // Keyboard Shortcuts
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

// Initialize player on DOM Content Loaded
document.addEventListener('DOMContentLoaded', () => {
  window.roadwaysPlayer = new RoadwaysMusicPlayer();
});
