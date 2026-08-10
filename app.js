// Roadways Music Application - Core Logic Architecture (Phase 1.7 UI Interaction Polish)

class RoadwaysMusicPlayer {
  constructor() {
    this.currentIndex = 0;
    this.isPlaying = false;
    this.currentTime = 197; // 3:17 placeholder for Phase 1
    this.duration = 296;    // 4:56 placeholder for Phase 1
    this.isDragging = false;
    
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

  // 1. TOP LEFT: Real-time clock (e.g. 4:19 pm)
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

  // 2. TOP CENTER: Roadways Passenger Indicator (e.g., 🚌 26 passengers onboard)
  startLivePresenceSimulator() {
    let currentCount = 26;
    const updateCount = () => {
      const delta = Math.floor(Math.random() * 5) - 2;
      currentCount = Math.max(20, Math.min(36, currentCount + delta));
      if (this.onlineCountElement) {
        this.onlineCountElement.textContent = currentCount;
      }
    };
    setInterval(updateCount, 12000);
  }

  // 3. SONG METADATA LOADING ARCHITECTURE
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
    
    this.duration = track.durationSeconds || 296;
    this.currentTime = Math.floor(this.duration * 0.665); // ~3:17
    this.updateProgressUI();
  }

  // 4. PLAY / PAUSE CONTROLS ROTATION
  play() {
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
  }

  pause() {
    this.isPlaying = false;
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
    if (this.isPlaying) this.play();
  }

  previous() {
    this.loadSong(this.currentIndex - 1);
    if (this.isPlaying) this.play();
  }

  // 5. SEEK TO PERCENTAGE (Architecture ready for Phase 2 audio player connection)
  seekToPercent(percentage) {
    const clampedPercent = Math.max(0, Math.min(100, percentage));
    this.currentTime = Math.floor((clampedPercent / 100) * this.duration);
    this.updateProgressUI();
    console.log(`[Phase 1.7] Seek to ${clampedPercent.toFixed(1)}% (${this.formatTime(this.currentTime)})`);
  }

  updateProgressUI() {
    const percent = (this.currentTime / this.duration) * 100;
    if (this.progressFill) this.progressFill.style.width = `${percent}%`;
    if (this.progressThumb) this.progressThumb.style.left = `${percent}%`;
    if (this.timeDisplayElement) {
      this.timeDisplayElement.textContent = `${this.formatTime(this.currentTime)} / ${this.formatTime(this.duration)}`;
    }
  }

  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  // 6. DRAGGABLE SEEK BAR LOGIC (Pointer Events: Mouse, Trackpad, Touch)
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
