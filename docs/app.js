/**
 * CASA — Dynamic Rabbit Island for Windows · 1:1 Native Island Parity Showcase
 * Zero external dependencies, CSP-strict (no eval, no inline HTML injection, URL allowlists).
 */

(() => {
  'use strict';

  const REPO_OWNER = 'Farhanpratama09';
  const REPO_NAME = 'casa-app';
  const RELEASES_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases`;

  // Supabase public review backend (isi `SUPABASE_PUBLISHABLE_KEY` dengan kunci `sb_publishable_...` dari Dashboard)
  const SUPABASE_URL = 'https://ivlyujaafwqziogajjtk.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable__TDUvXJeCptks3hvpETwNw_h64fdeOd';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SMALL_RING_C = 31.42; // 2 * PI * 5
  const BIG_RING_C = 188.5; // 2 * PI * 30

  const QUEUE_TRACKS = [
    {
      id: 'trk-midnight',
      title: 'Midnight Coding',
      artist: 'Lo-Fi Bunny · SMTC',
      duration: '3:12',
      elapsed: '0:42',
      progressPct: 34,
      lyrics: [
        'Silence hums across an OLED screen',
        'Two monochrome eyes watch the top bezel',
        'Keystrokes fall in steady midnight rain',
        'Zero clutter across every open window',
        'Stay inside the flow until dawn breaks',
      ],
    },
    {
      id: 'trk-obsidian',
      title: 'Obsidian Horizon',
      artist: 'CASA Synth · LRCLIB',
      duration: '2:48',
      elapsed: '1:05',
      progressPct: 48,
      lyrics: [
        '4px Smart-Tuck rests along the top edge',
        'Wait for the cue when the movie ends',
        'Smooth morph back to the digital clock',
        'Quiet telemetry ticking in pure black',
      ],
    },
    {
      id: 'trk-rabbit-island',
      title: 'Rabbit Island Waltz',
      artist: 'Asa & Sasha · Studio',
      duration: '3:27',
      elapsed: '0:54',
      progressPct: 28,
      lyrics: [
        'Tiny heart beside a calm tilted cross',
        'Press Alt + Space to widen the workspace',
        'Every lyric synced inside the narrow pill',
        'Clean focus ring counting down to rest',
      ],
    },
    {
      id: 'trk-crimson',
      title: 'Velvet Monochrome',
      artist: 'Crimson · Instrumental',
      duration: '2:55',
      elapsed: '1:18',
      progressPct: 52,
      lyrics: [
        'No stray pixels, only sharp hairlines',
        'Carry files right into the top Drop Zone',
        'Copy back to desktop in a single click',
        'Crafted cleanly for Windows 11 OLED',
      ],
    },
  ];

  const SAMPLE_PLAYLISTS = [
    { id: 'pl-focus', name: 'Focus Lo-Fi', count: '4 tracks', startIdx: 0 },
    { id: 'pl-night', name: 'Late Night Code', count: '3 tracks', startIdx: 1 },
    { id: 'pl-bunny', name: 'Rabbit Island', count: '3 tracks', startIdx: 2 },
  ];

  const INITIAL_TODOS = [
    { id: 'td-1', text: 'Audit border hairline OLED', done: true },
    { id: 'td-2', text: 'Verifikasi OTA signed key', done: false },
    { id: 'td-3', text: 'Rilis build Windows x64', done: false },
  ];

  const SAMPLE_FILES = [
    { id: 'file-brief', name: 'brief-casa.pdf', ext: 'PDF', meta: 'PDF · 420 KB' },
    { id: 'file-sasha', name: 'sasha-icon.svg', ext: 'SVG', meta: 'SVG · 14 KB' },
    { id: 'file-mix', name: 'mix-playlist.url', ext: 'URL', meta: 'URL · Web' },
  ];

  const state = {
    mode: 'resting', // 'resting' | 'lyrics' | 'todo' | 'hud' | 'dropzone'
    capsuleState: 'idle', // 'idle' | 'expanded'
    isRestingSleep: false,
    expression: 'idle', // 'idle' | 'music' | 'focus' | 'dual_active'
    idleLyricMinimized: false,
    musicSubTab: 'player', // 'player' | 'playlists'
    isLyricsOpen: true,
    isQueuePopoutOpen: false,
    activePlaylistId: 'pl-focus',
    musicPlaying: true,
    trackIndex: 0,
    lyricIndex: 0,
    todos: INITIAL_TODOS.map((t) => ({ ...t })),
    focusTimerRunning: true,
    focusTotalMinutes: 25,
    focusSeconds: 18 * 60 + 45,
    dualIdleActive: false,
    volume: 68,
    brightness: 85,
    audioOutputLabel: 'Speakers',
    hudKind: '', // '' | 'volume' | 'brightness' | 'bluetooth' | 'wired'
    hudLabel: '',
    hudDetail: '',
    hudTimerId: null,
    droppedIds: [],
    introTimers: [],
    lyricIntervalId: null,
    clockIntervalId: null,
    focusTickId: null,
    pointerDrag: null,
    programmaticScrollUntil: 0,
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    monitor: $('virtual-monitor'),
    monitorScreen: $('monitor-screen'),
    monitorDesktop: $('monitor-desktop'),
    introOverlay: $('intro-overlay'),
    headerNavLinks: Array.from(document.querySelectorAll('.header-nav a[data-route]')),
    capsule: $('vm-notch-capsule'),
    perimeterSvg: $('vm-perimeter-svg'),
    perimeterPath: $('vm-perimeter-path'),

    idleLayer: $('vm-idle-layer'),
    restingPill: $('casa-resting-pill'),
    hudPill: $('casa-hud-pill'),
    hudIcon: $('casa-hud-icon'),
    hudLabel: $('casa-hud-label'),
    hudBarWrap: $('casa-hud-bar-wrap'),
    hudBarFill: $('casa-hud-bar-fill'),
    hudDetail: $('casa-hud-detail'),
    activePill: $('casa-active-pill'),
    eyes: $('vm-notch-eyes'),
    standbySegment: $('casa-standby-segment'),
    title: $('vm-notch-title'),
    date: $('vm-notch-date'),
    musicSegment: $('casa-music-segment'),
    pillTrackWrap: $('vm-pill-track-wrap'),
    pillSong: $('vm-pill-song'),
    pillSongSep: $('vm-pill-song-sep'),
    pillArtist: $('vm-pill-artist'),
    miniLyricPill: $('vm-mini-lyric-pill'),
    eqGlyph: $('casa-eq-glyph'),
    midDivider: $('casa-mid-divider'),
    timerSegment: $('casa-timer-segment'),
    focusRingArc: $('vm-focus-ring-arc'),
    focusTaskLabel: $('vm-focus-task-label'),
    focusTimerClock: $('vm-focus-timer-clock'),
    rightDivider: $('casa-right-divider'),
    batteryBadge: $('vm-battery-badge'),

    expandedLayer: $('vm-expanded-layer'),
    m6Eyes: $('vm-m6-eyes'),
    m6EyesBtn: $('vm-m6-eyes-btn'),
    m6TabButtons: Array.from(document.querySelectorAll('[data-m6-tab]')),
    m6DropBadge: $('vm-m6-drop-badge'),
    collapseBtn: $('vm-notch-collapse-btn'),

    expMusic: $('vm-exp-music'),
    expFocus: $('vm-exp-focus'),
    expControl: $('vm-exp-control'),
    expDropzone: $('vm-exp-dropzone'),

    musicSubButtons: Array.from(document.querySelectorAll('[data-music-sub]')),
    musicSubPlayer: $('vm-music-sub-player'),
    musicSubPlaylists: $('vm-music-sub-playlists'),
    expPlaylistList: $('vm-exp-playlist-list'),
    expAudioLabel: $('vm-exp-audio-label'),
    expTrackTitle: $('vm-exp-track-title'),
    expTrackArtist: $('vm-exp-track-artist'),
    expSaveBtn: $('vm-exp-save-btn'),
    expLyricsToggle: $('vm-exp-lyrics-toggle'),
    expSearchBtn: $('vm-exp-search-btn'),
    expQueueToggle: $('vm-exp-queue-toggle'),
    expQueuePopout: $('vm-exp-queue-popout'),
    expQueueTitle: $('vm-exp-queue-title'),
    expQueueCount: $('vm-exp-queue-count'),
    expQueueClose: $('vm-exp-queue-close'),
    expLyricsPane: $('vm-exp-lyrics-pane'),
    scrubElapsed: $('vm-scrub-elapsed'),
    scrubFill: $('vm-scrub-fill'),
    scrubTotal: $('vm-scrub-total'),
    expPrevBtn: $('vm-exp-prev-btn'),
    expPlayBtn: $('vm-exp-play-btn'),
    expNextBtn: $('vm-exp-next-btn'),
    expQueueList: $('vm-exp-queue-list'),
    expLyricsScroll: $('vm-exp-lyrics-scroll'),
    idleLyricBtn: $('vm-idle-lyric-btn'),

    expFocusTaskHead: $('vm-exp-focus-task-head'),
    expFocusEnds: $('vm-exp-focus-ends'),
    expRingArc: $('vm-exp-ring-arc'),
    expRingPct: $('vm-exp-ring-pct'),
    expTimerDigits: $('vm-exp-timer-digits'),
    presetChips: Array.from(document.querySelectorAll('[data-preset-mins]')),
    expTimerBtn: $('vm-exp-timer-btn'),
    expTodoCount: $('vm-exp-todo-count'),
    expTodoList: $('vm-exp-todo-list'),

    ccBtBtn: $('vm-cc-bt-btn'),
    ccBtSub: $('vm-cc-bt-sub'),
    ccWiredBtn: $('vm-cc-wired-btn'),
    expRestBtn: $('vm-exp-rest-btn'),
    ccVolSlider: $('vm-cc-vol-slider'),
    ccVolVal: $('vm-cc-vol-val'),
    ccBrightSlider: $('vm-cc-bright-slider'),
    ccBrightVal: $('vm-cc-bright-val'),

    dropzonePrompt: $('vm-dropzone-prompt'),
    droppedItems: $('vm-dropped-items'),
    dropzoneCount: $('vm-dropzone-count'),
    copyBackBtn: $('vm-copy-back-btn'),

    // Desktop workspace scenes
    sceneResting: $('scene-resting'),
    sceneLyrics: $('scene-lyrics'),
    sceneTodo: $('scene-todo'),
    sceneHud: $('scene-hud'),
    sceneDropzone: $('scene-dropzone'),

    desktopTime: $('vm-desktop-time'),
    clockStatus: $('vm-clock-status'),
    sceneToggleRestBtn: $('scene-toggle-rest-btn'),
    sceneToggleExpandBtn: $('scene-toggle-expand-btn'),
    lyricStage: $('vm-lyric-stage'),
    queueList: $('vm-queue-list'),
    queueCountTag: $('vm-queue-count-tag'),
    sceneLyricMinimizeBtn: $('scene-lyric-minimize-btn'),
    todoList: $('vm-todo-list'),
    todoForm: $('vm-todo-form'),
    todoInput: $('vm-todo-input'),
    todoProgressText: $('vm-todo-progress-text'),
    focusEyeBadge: $('vm-focus-eye-badge'),
    todoDualBtn: $('vm-todo-dual-btn'),
    todoTimerBtn: $('vm-todo-timer-btn'),
    hudReadout: $('vm-hud-readout'),
    brightnessSlider: $('vm-brightness-slider'),
    brightnessPct: $('vm-brightness-pct'),
    volumeSlider: $('vm-volume-slider'),
    volumePct: $('vm-volume-pct'),
    simBtBtn: $('vm-sim-bt-btn'),
    simWiredBtn: $('vm-sim-wired-btn'),
    desktopFiles: $('vm-desktop-files'),
    simDropAllBtn: $('vm-sim-drop-all-btn'),

    modeButtons: Array.from(document.querySelectorAll('[data-vm-mode]')),
    replayIntroBtn: $('replay-intro-btn'),

    // Download CTA & SHA-256
    primaryDownloadBtn: $('primary-download-btn'),
    primaryDownloadLabel: $('primary-download-label'),
    downloadSizeNote: $('download-size-note'),
    downloadSizeText: $('download-size-text'),
    downloadCountText: $('download-count-text'),
    copyShaBtn: $('copy-sha-btn'),
    shaValueExe: $('sha-value-exe'),

    // Ratings & Reviews (Play Store Style)
    reviewsAvgScore: $('reviews-avg-score'),
    reviewsAvgStars: $('reviews-avg-stars'),
    reviewsTotalCount: $('reviews-total-count'),
    reviewsSummaryHint: $('reviews-summary-hint'),
    reviewsBars: $('reviews-bars'),
    reviewForm: $('review-form'),
    reviewStarPicker: $('review-star-picker'),
    reviewRatingDesc: $('review-rating-desc'),
    revName: $('rev-name'),
    revComment: $('rev-comment'),
    revCharCount: $('rev-char-count'),
    revWebsiteHp: $('rev-website-hp'),
    revSubmitBtn: $('rev-submit-btn'),
    revStatus: $('rev-status'),
    reviewsFilterBar: $('reviews-filter-bar'),
    reviewsSortSelect: $('reviews-sort-select'),
    reviewsList: $('reviews-list'),
    reviewsEmpty: $('reviews-empty'),
    reviewsMoreWrap: $('reviews-more-wrap'),
    reviewsLoadMoreBtn: $('reviews-load-more'),
  };

  function createSvgNode(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([k, v]) => {
      node.setAttribute(k, String(v));
    });
    return node;
  }

  function clearNode(node) {
    while (node && node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function formatClockHHMM(date = new Date()) {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  function formatDateShort(date = new Date()) {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  }

  function formatMMSS(sec) {
    const safe = Math.max(0, Math.floor(sec));
    const m = Math.floor(safe / 60);
    const s = safe % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  /**
   * 1:1 Port of `src/components/companion/CasaCompanionAvatar.tsx` SVG paths.
   */
  function renderCompanionAvatar(svgEl, expr) {
    if (!svgEl) return;
    clearNode(svgEl);

    const heartPath =
      'M 25,13.5 L 24.3,12.8 C 21.1,10.0 19.6,8.3 19.6,6.1 C 19.6,4.4 20.9,3.1 22.5,3.1 C 23.6,3.1 24.5,3.7 25,4.6 C 25.5,3.7 26.4,3.1 27.5,3.1 C 29.1,3.1 30.4,4.4 30.4,6.1 C 30.4,8.3 28.9,10.0 25.7,12.8 Z';

    // Left eye
    if (expr === 'music') {
      svgEl.appendChild(
        createSvgNode('path', {
          d: 'M 9.8,11.6 L 9.8,3.2 L 14.2,4.8',
          fill: 'none',
          stroke: '#ffffff',
          'stroke-width': 1.9,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        })
      );
      svgEl.appendChild(
        createSvgNode('ellipse', {
          cx: 6.8,
          cy: 11.6,
          rx: 3.0,
          ry: 2.2,
          transform: 'rotate(-18 6.8 11.6)',
          fill: '#ffffff',
        })
      );
    } else if (expr === 'focus' || expr === 'dual_active') {
      svgEl.appendChild(
        createSvgNode('path', {
          d: 'M 4.2,3.0 L 12.2,5.6',
          fill: 'none',
          stroke: '#ffffff',
          'stroke-width': 1.9,
          'stroke-linecap': 'round',
        })
      );
      svgEl.appendChild(
        createSvgNode('circle', {
          cx: 8.4,
          cy: 9.8,
          r: 2.7,
          fill: '#ffffff',
        })
      );
    } else {
      // ×
      svgEl.appendChild(
        createSvgNode('path', {
          d: 'M 3.5,3.5 L 12.5,12.5 M 12.5,3.5 L 3.5,12.5',
          fill: 'none',
          stroke: '#ffffff',
          'stroke-width': 2.1,
          'stroke-linecap': 'round',
        })
      );
    }

    // Right eye
    if (expr === 'dual_active') {
      svgEl.appendChild(
        createSvgNode('path', {
          d: 'M 26.2,11.6 L 26.2,3.2 L 30.6,4.8',
          fill: 'none',
          stroke: '#ffffff',
          'stroke-width': 1.9,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        })
      );
      svgEl.appendChild(
        createSvgNode('ellipse', {
          cx: 23.2,
          cy: 11.6,
          rx: 3.0,
          ry: 2.2,
          transform: 'rotate(-18 23.2 11.6)',
          fill: '#ffffff',
        })
      );
    } else {
      svgEl.appendChild(createSvgNode('path', { d: heartPath, fill: '#ffffff' }));
    }
  }

  function renderHudIcon(kind) {
    if (!el.hudIcon) return;
    clearNode(el.hudIcon);
    const svg = createSvgNode('svg', {
      width: 14,
      height: 14,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    });
    if (kind === 'bluetooth') {
      svg.appendChild(createSvgNode('polyline', { points: '6.5 6.5 17.5 17.5 12 23 12 1 17.5 6.5 6.5 17.5' }));
    } else if (kind === 'wired') {
      svg.appendChild(createSvgNode('path', { d: 'M3 18v-6a9 9 0 0 1 18 0v6' }));
      svg.appendChild(createSvgNode('path', { d: 'M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z' }));
    } else if (kind === 'brightness') {
      svg.appendChild(createSvgNode('circle', { cx: 12, cy: 12, r: 4 }));
      svg.appendChild(
        createSvgNode('path', {
          d: 'M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41',
        })
      );
    } else {
      svg.appendChild(createSvgNode('polygon', { points: '11 5 6 9 2 9 2 15 6 15 11 19 11 5' }));
      svg.appendChild(createSvgNode('path', { d: 'M15.54 8.46a5 5 0 0 1 0 7.07' }));
    }
    el.hudIcon.appendChild(svg);
  }

  function getActiveTrack() {
    return QUEUE_TRACKS[state.trackIndex] || QUEUE_TRACKS[0];
  }

  function showHudChip(kind, label, detail, showBar = false) {
    if (state.hudTimerId) {
      window.clearTimeout(state.hudTimerId);
      state.hudTimerId = null;
    }
    state.hudKind = kind;
    state.hudLabel = label;
    state.hudDetail = detail;
    renderHudIcon(kind);
    if (el.hudBarWrap) el.hudBarWrap.hidden = !showBar;
    syncCapsuleUI();

    state.hudTimerId = window.setTimeout(() => {
      state.hudKind = '';
      state.hudLabel = '';
      state.hudDetail = '';
      state.hudTimerId = null;
      syncCapsuleUI();
    }, 2500);
  }

  function clearIntroTimers() {
    state.introTimers.forEach((id) => window.clearTimeout(id));
    state.introTimers = [];
  }

  function startIntroMorphSequence() {
    clearIntroTimers();
    if (!el.monitor || !el.introOverlay) return;

    state.mode = 'resting';
    state.capsuleState = 'idle';
    state.isRestingSleep = false;
    state.idleLyricMinimized = false;
    state.hudKind = '';

    el.introOverlay.hidden = false;
    el.monitor.setAttribute('data-intro-phase', 'hi');
    syncUI();

    const t1 = window.setTimeout(() => {
      el.monitor.setAttribute('data-intro-phase', 'morph');
    }, 1500);

    const t2 = window.setTimeout(() => {
      el.monitor.setAttribute('data-intro-phase', 'ready');
      el.introOverlay.hidden = true;
      state.isRestingSleep = false;
      state.expression = 'idle';
      syncCapsuleUI();
      syncDesktopScenes();
    }, 2200);

    state.introTimers.push(t1, t2);
  }

  function renderLyricsAndQueue() {
    const track = getActiveTrack();

    // Desktop workspace synced lyrics + Mode 6 capsule synced lyrics
    [el.lyricStage, el.expLyricsScroll].forEach((container, cIdx) => {
      if (!container) return;
      clearNode(container);
      track.lyrics.forEach((line, idx) => {
        const row = document.createElement('div');
        row.className =
          cIdx === 0
            ? idx === state.lyricIndex
              ? 'vm-lyric-row active'
              : 'vm-lyric-row'
            : idx === state.lyricIndex
            ? 'casa-m6-lyric-row active'
            : 'casa-m6-lyric-row';
        row.textContent = line;
        container.appendChild(row);
      });
    });

    if (el.queueCountTag) {
      el.queueCountTag.textContent = `${QUEUE_TRACKS.length} lagu`;
    }
    if (el.expQueueCount) {
      el.expQueueCount.textContent = String(QUEUE_TRACKS.length);
    }

    // Mode 6 Playlists List (`Player | Playlists`)
    if (el.expPlaylistList) {
      clearNode(el.expPlaylistList);
      SAMPLE_PLAYLISTS.forEach((pl) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'casa-q-mini-btn';
        if (pl.id === state.activePlaylistId) {
          btn.setAttribute('aria-current', 'true');
        }
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          state.activePlaylistId = pl.id;
          state.trackIndex = pl.startIdx % QUEUE_TRACKS.length;
          state.lyricIndex = 0;
          state.musicPlaying = true;
          state.musicSubTab = 'player';
          syncUI();
        });

        const nameSpan = document.createElement('span');
        nameSpan.textContent = pl.name;
        const metaSpan = document.createElement('span');
        metaSpan.className = 'tabular';
        metaSpan.textContent = pl.count;
        btn.appendChild(nameSpan);
        btn.appendChild(metaSpan);
        el.expPlaylistList.appendChild(btn);
      });
    }

    // Desktop Queue List & Popout QUEUE Card List
    [el.queueList, el.expQueueList].forEach((listEl, isMini) => {
      if (!listEl) return;
      clearNode(listEl);
      QUEUE_TRACKS.forEach((item, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = isMini ? 'casa-q-mini-btn' : 'vm-queue-btn';
        if (idx === state.trackIndex) {
          btn.setAttribute('aria-current', 'true');
        }
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          state.trackIndex = idx;
          state.lyricIndex = 0;
          state.musicPlaying = true;
          syncUI();
        });

        const titleSpan = document.createElement('span');
        titleSpan.className = isMini ? '' : 'vm-queue-title';
        titleSpan.textContent = item.title;

        const durSpan = document.createElement('span');
        durSpan.className = isMini ? 'tabular' : 'vm-queue-artist tabular';
        durSpan.textContent = isMini ? item.duration : `${item.artist} · ${item.duration}`;

        btn.appendChild(titleSpan);
        btn.appendChild(durSpan);

        if (isMini) {
          listEl.appendChild(btn);
        } else {
          const li = document.createElement('li');
          li.appendChild(btn);
          listEl.appendChild(li);
        }
      });
    });
  }

  function renderTodos() {
    const doneCount = state.todos.filter((t) => t.done).length;
    const totalCount = Math.max(1, state.todos.length);
    const ratio = doneCount / totalCount;

    if (el.todoProgressText) {
      el.todoProgressText.textContent = `${doneCount} / ${state.todos.length} selesai`;
    }
    if (el.expTodoCount) {
      el.expTodoCount.textContent = `${doneCount}/${state.todos.length}`;
    }
    if (el.focusEyeBadge) {
      el.focusEyeBadge.textContent = state.dualIdleActive ? '•̀ ♪ Dual-Idle' : '•̀ ♥ Focus';
    }
    if (el.focusRingArc) {
      el.focusRingArc.style.strokeDashoffset = (SMALL_RING_C * (1 - ratio)).toFixed(2);
    }
    if (el.expRingArc) {
      el.expRingArc.style.strokeDashoffset = (BIG_RING_C * (1 - ratio)).toFixed(2);
    }
    if (el.expRingPct) {
      el.expRingPct.textContent = `${Math.round(ratio * 100)}%`;
    }

    // Desktop To-Do List
    if (el.todoList) {
      clearNode(el.todoList);
      state.todos.forEach((task) => {
        const li = document.createElement('li');
        const label = document.createElement('label');
        label.className = 'vm-todo-item';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'vm-todo-checkbox';
        cb.checked = task.done;
        cb.addEventListener('change', () => {
          task.done = cb.checked;
          syncUI();
        });

        const span = document.createElement('span');
        span.className = task.done ? 'vm-todo-text done' : 'vm-todo-text';
        span.textContent = task.text;

        label.appendChild(cb);
        label.appendChild(span);
        li.appendChild(label);
        el.todoList.appendChild(li);
      });
    }

    // 1:1 Mode 6 ProductivitySplitView Task Rows
    if (el.expTodoList) {
      clearNode(el.expTodoList);
      state.todos.forEach((task) => {
        const row = document.createElement('div');
        row.className = task.done ? 'casa-exp-todo-item done' : 'casa-exp-todo-item';
        row.addEventListener('click', (ev) => {
          ev.stopPropagation();
          task.done = !task.done;
          syncUI();
        });

        const circle = document.createElement('span');
        circle.className = 'casa-round-check';
        circle.textContent = task.done ? '✓' : '';

        const text = document.createElement('span');
        text.textContent = task.text;

        row.appendChild(circle);
        row.appendChild(text);
        el.expTodoList.appendChild(row);
      });
    }
  }

  function renderDropzoneCards() {
    if (el.desktopFiles) {
      clearNode(el.desktopFiles);
      SAMPLE_FILES.forEach((file) => {
        const isDropped = state.droppedIds.includes(file.id);
        const card = document.createElement('div');
        card.className = isDropped ? 'vm-file-card stashed' : 'vm-file-card';
        card.setAttribute('draggable', isDropped ? 'false' : 'true');
        card.setAttribute('data-file-id', file.id);

        const title = document.createElement('div');
        title.className = 'vm-file-name';
        title.textContent = file.name;

        const meta = document.createElement('div');
        meta.className = 'vm-file-meta';
        meta.textContent = isDropped ? 'Parked in Drop Zone' : file.meta;

        card.appendChild(title);
        card.appendChild(meta);

        if (!isDropped) {
          card.addEventListener('dragstart', (ev) => {
            if (ev.dataTransfer) {
              ev.dataTransfer.setData('text/plain', file.id);
              ev.dataTransfer.effectAllowed = 'copyMove';
            }
            card.classList.add('dragging');
            openDropZoneTarget(true);
          });

          card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            if (el.capsule) el.capsule.removeAttribute('data-drop-hover');
          });

          card.addEventListener('pointerdown', (ev) => {
            if (ev.pointerType === 'mouse' && ev.button !== 0) return;
            state.pointerDrag = {
              fileId: file.id,
              startY: ev.clientY,
              moved: false,
            };
            card.classList.add('dragging');
            try {
              card.setPointerCapture(ev.pointerId);
            } catch (_err) {}
          });

          card.addEventListener('pointermove', (ev) => {
            if (!state.pointerDrag || state.pointerDrag.fileId !== file.id) return;
            const dy = state.pointerDrag.startY - ev.clientY;
            if (dy > 14) {
              state.pointerDrag.moved = true;
              openDropZoneTarget(true);
            }
            if (el.monitorScreen) {
              const sRect = el.monitorScreen.getBoundingClientRect();
              const nearTopLip = ev.clientY <= sRect.top + 135;
              if (el.capsule) {
                el.capsule.setAttribute('data-drop-hover', nearTopLip ? 'true' : 'false');
              }
            }
          });

          const endPointerDrag = (ev) => {
            if (!state.pointerDrag || state.pointerDrag.fileId !== file.id) return;
            card.classList.remove('dragging');
            const sRect = el.monitorScreen ? el.monitorScreen.getBoundingClientRect() : null;
            const droppedNearTop =
              state.pointerDrag.moved && sRect && ev.clientY <= sRect.top + 150;
            state.pointerDrag = null;
            if (el.capsule) el.capsule.removeAttribute('data-drop-hover');
            if (droppedNearTop) {
              captureFileIntoDropZone(file.id);
            }
          };

          card.addEventListener('pointerup', endPointerDrag);
          card.addEventListener('pointercancel', endPointerDrag);
        }

        el.desktopFiles.appendChild(card);
      });
    }

    // Populate 1:1 `DropShelfCard` items inside expanded Drop Zone
    if (el.droppedItems) {
      clearNode(el.droppedItems);
      state.droppedIds.forEach((fid) => {
        const meta = SAMPLE_FILES.find((f) => f.id === fid);
        if (!meta) return;

        const shelfCard = document.createElement('div');
        shelfCard.className = 'casa-drop-card';

        const top = document.createElement('div');
        top.className = 'casa-drop-card-top';
        const iconTile = document.createElement('div');
        iconTile.className = 'casa-drop-icon-tile';
        iconTile.textContent = meta.ext;
        const info = document.createElement('div');
        info.style.minWidth = '0';
        const nameEl = document.createElement('div');
        nameEl.className = 'casa-drop-name';
        nameEl.textContent = meta.name;
        const subEl = document.createElement('div');
        subEl.className = 'casa-drop-meta';
        subEl.textContent = meta.meta;
        info.appendChild(nameEl);
        info.appendChild(subEl);
        top.appendChild(iconTile);
        top.appendChild(info);

        const bot = document.createElement('div');
        bot.className = 'casa-drop-card-bot';
        const hint = document.createElement('span');
        hint.textContent = 'Parked';
        const restoreBtn = document.createElement('button');
        restoreBtn.type = 'button';
        restoreBtn.className = 'casa-dz-pill-btn';
        restoreBtn.textContent = 'Return';
        restoreBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          state.droppedIds = state.droppedIds.filter((id) => id !== fid);
          syncUI();
        });
        bot.appendChild(hint);
        bot.appendChild(restoreBtn);

        shelfCard.appendChild(top);
        shelfCard.appendChild(bot);
        el.droppedItems.appendChild(shelfCard);
      });
    }

    if (el.dropzonePrompt) {
      el.dropzonePrompt.hidden = state.droppedIds.length > 0;
    }
    if (el.dropzoneCount) {
      el.dropzoneCount.textContent =
        state.droppedIds.length === 0
          ? 'Drop Zone Shelf'
          : `${state.droppedIds.length} ${state.droppedIds.length === 1 ? 'item parked' : 'items parked'}`;
    }
    if (el.m6DropBadge) {
      el.m6DropBadge.hidden = state.droppedIds.length === 0;
      el.m6DropBadge.textContent = String(state.droppedIds.length);
    }
    if (el.copyBackBtn) {
      el.copyBackBtn.hidden = state.droppedIds.length === 0;
    }
  }

  function openDropZoneTarget(expand) {
    if (expand) {
      state.capsuleState = 'expanded';
      if (el.capsule) el.capsule.setAttribute('data-drop-hover', 'true');
      syncCapsuleUI();
    }
  }

  function captureFileIntoDropZone(fileId) {
    if (!fileId) return;
    if (!state.droppedIds.includes(fileId)) {
      state.droppedIds.push(fileId);
    }
    state.mode = 'dropzone';
    state.capsuleState = 'expanded';
    syncUI();
  }

  function copyDropZoneBackToDesktop() {
    state.droppedIds = [];
    if (el.capsule) el.capsule.removeAttribute('data-drop-hover');
    state.capsuleState = 'idle';
    syncUI();
    showHudChip('volume', 'Copied Back', 'Desktop', false);
  }

  function resolveActiveExpression() {
    if (state.mode === 'lyrics') return 'music';
    if (state.mode === 'todo') return state.dualIdleActive ? 'dual_active' : 'focus';
    return 'idle';
  }

  function resolveMode6Variant() {
    if (state.mode === 'lyrics') return 'music';
    if (state.mode === 'todo') return 'todo';
    if (state.mode === 'hud' || state.mode === 'resting') return 'control';
    return 'dropzone';
  }

  function syncCapsuleUI() {
    const now = new Date();
    const timeText = formatClockHHMM(now);
    const dateText = formatDateShort(now);
    const track = getActiveTrack();
    const activeLyric = track.lyrics[state.lyricIndex] || track.lyrics[0];
    const activeExpr = resolveActiveExpression();
    const isExpanded = state.capsuleState === 'expanded';
    const variant = resolveMode6Variant();

    renderCompanionAvatar(el.eyes, activeExpr);
    renderCompanionAvatar(el.m6Eyes, activeExpr);

    if (el.monitor) {
      el.monitor.setAttribute('data-capsule-open', isExpanded ? 'true' : 'false');
    }

    if (el.capsule) {
      el.capsule.setAttribute('data-state', isExpanded ? 'expanded' : 'idle');
      el.capsule.setAttribute('data-variant', variant);
    }

    if (el.idleLayer) el.idleLayer.hidden = isExpanded;
    if (el.expandedLayer) el.expandedLayer.hidden = !isExpanded;

    // Perimeter Open U-Shape Focus Timer Stroke (when To-Do & Focus active in Idle)
    const showPerimeter = !isExpanded && state.mode === 'todo';
    if (el.perimeterSvg) {
      el.perimeterSvg.hidden = !showPerimeter;
    }
    if (el.perimeterPath) {
      const done = state.todos.filter((t) => t.done).length;
      const pct = Math.round((done / Math.max(1, state.todos.length)) * 100);
      el.perimeterPath.style.strokeDashoffset = String(Math.max(5, 100 - pct));
    }

    // Idle Layers (Compact × ♥ in Resting & Wake mode vs HUD vs Wide Feature Idle Bar)
    const showCompactEyesOnly =
      !isExpanded &&
      !state.hudKind &&
      state.mode === 'resting';
    const showHud = !isExpanded && Boolean(state.hudKind);
    const showActivePill = !isExpanded && !showCompactEyesOnly && !showHud;

    if (el.restingPill) {
      el.restingPill.hidden = !showCompactEyesOnly;
      el.restingPill.setAttribute('data-sleep', state.isRestingSleep ? 'true' : 'false');
    }
    if (el.hudPill) el.hudPill.hidden = !showHud;
    if (el.activePill) el.activePill.hidden = !showActivePill;

    if (showHud) {
      if (el.hudLabel) el.hudLabel.textContent = state.hudLabel;
      if (el.hudDetail) el.hudDetail.textContent = state.hudDetail;
      if (el.hudBarFill) {
        if (state.hudKind === 'volume') {
          el.hudBarFill.style.width = `${state.volume}%`;
        } else if (state.hudKind === 'brightness') {
          el.hudBarFill.style.width = `${state.brightness}%`;
        }
      }
    }

    // Active Pill segments matching IdlePillView.tsx modes 2-5
    if (el.standbySegment) {
      el.standbySegment.hidden = state.mode === 'lyrics' || state.mode === 'todo';
    }
    if (el.title) el.title.textContent = timeText;
    if (el.date) el.date.textContent = dateText;

    const showMusicInPill =
      state.mode === 'lyrics' || (state.mode === 'todo' && state.dualIdleActive);
    if (el.musicSegment) {
      el.musicSegment.hidden = !showMusicInPill;
    }
    if (el.pillTrackWrap) {
      el.pillTrackWrap.hidden = state.mode === 'lyrics' && state.idleLyricMinimized;
    }
    if (el.pillSong) el.pillSong.textContent = track.title;
    if (el.pillArtist) el.pillArtist.textContent = track.artist;

    if (el.miniLyricPill) {
      const showLyricStrip = state.mode === 'lyrics' && state.idleLyricMinimized;
      el.miniLyricPill.hidden = !showLyricStrip;
      if (showLyricStrip) {
        el.miniLyricPill.textContent = activeLyric;
      }
    }
    if (el.eqGlyph) {
      el.eqGlyph.classList.toggle('paused', !state.musicPlaying);
    }

    const showTimerInPill = state.mode === 'todo';
    if (el.midDivider) {
      el.midDivider.hidden = !(showMusicInPill && showTimerInPill);
    }
    if (el.timerSegment) {
      el.timerSegment.hidden = !showTimerInPill;
    }
    if (el.focusTaskLabel) {
      const firstOpen = state.todos.find((t) => !t.done);
      el.focusTaskLabel.textContent = firstOpen ? firstOpen.text : 'Focus Complete';
    }
    if (el.focusTimerClock) {
      el.focusTimerClock.textContent = formatMMSS(state.focusSeconds);
    }

    const hideBatteryInMinimal =
      state.mode === 'lyrics' || state.mode === 'todo';
    if (el.rightDivider) el.rightDivider.hidden = hideBatteryInMinimal;
    if (el.batteryBadge) el.batteryBadge.hidden = hideBatteryInMinimal;

    // Mode 6 Header Active Pill
    el.m6TabButtons.forEach((btn) => {
      const tab = btn.getAttribute('data-m6-tab');
      const isMatch =
        (tab === 'music' && state.mode === 'lyrics') ||
        (tab === 'todo' && state.mode === 'todo') ||
        (tab === 'hud' && (state.mode === 'hud' || state.mode === 'resting')) ||
        (tab === 'dropzone' && state.mode === 'dropzone');
      btn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
    });

    // Expanded Mode 6 Body Subviews
    if (el.expMusic) el.expMusic.hidden = variant !== 'music';
    if (el.expFocus) el.expFocus.hidden = variant !== 'todo';
    if (el.expControl) el.expControl.hidden = variant !== 'control';
    if (el.expDropzone) el.expDropzone.hidden = variant !== 'dropzone';

    // Mode 6 Music Player Metadata
    if (el.expAudioLabel) el.expAudioLabel.textContent = state.audioOutputLabel;
    if (el.expTrackTitle) el.expTrackTitle.textContent = track.title;
    if (el.expTrackArtist) el.expTrackArtist.textContent = track.artist;
    if (el.scrubElapsed) el.scrubElapsed.textContent = track.elapsed;
    if (el.scrubTotal) el.scrubTotal.textContent = track.duration;
    if (el.scrubFill) el.scrubFill.style.width = `${track.progressPct}%`;
    if (el.expPlayBtn) el.expPlayBtn.textContent = state.musicPlaying ? 'Pause' : 'Play';
    if (el.musicSubPlayer) el.musicSubPlayer.hidden = state.musicSubTab !== 'player';
    if (el.musicSubPlaylists) el.musicSubPlaylists.hidden = state.musicSubTab !== 'playlists';
    if (el.expQueuePopout) el.expQueuePopout.hidden = !state.isQueuePopoutOpen;
    if (el.expQueueToggle) {
      el.expQueueToggle.classList.toggle('active', state.isQueuePopoutOpen);
    }
    if (el.expLyricsToggle) {
      el.expLyricsToggle.classList.toggle('active', state.isLyricsOpen);
    }
    if (el.expLyricsPane) {
      el.expLyricsPane.style.opacity = state.isLyricsOpen ? '1' : '0.35';
    }
    el.musicSubButtons.forEach((b) => {
      b.setAttribute(
        'aria-pressed',
        b.getAttribute('data-music-sub') === state.musicSubTab ? 'true' : 'false'
      );
    });

    if (el.sceneLyricMinimizeBtn) {
      el.sceneLyricMinimizeBtn.textContent = state.idleLyricMinimized
        ? 'Restore Expanded'
        : 'Idle Lyric Minimize';
    }

    // Mode 6 Focus & Control Center values
    if (el.expTimerDigits) el.expTimerDigits.textContent = formatMMSS(state.focusSeconds);
    if (el.expFocusEnds) el.expFocusEnds.textContent = `ends ${timeText}`;
    if (el.expTimerBtn) {
      el.expTimerBtn.textContent = state.focusTimerRunning ? 'Pause' : 'Start';
    }
    if (el.ccVolSlider) el.ccVolSlider.value = String(state.volume);
    if (el.ccVolVal) el.ccVolVal.textContent = `${state.volume}%`;
    if (el.ccBrightSlider) el.ccBrightSlider.value = String(state.brightness);
    if (el.ccBrightVal) el.ccBrightVal.textContent = `${state.brightness}%`;
  }

  function applyMonitorBrightness() {
    const clamped = Math.max(15, Math.min(100, Number(state.brightness) || 85));
    state.brightness = clamped;
    const factor = (0.20 + 0.80 * (clamped / 100)).toFixed(3);
    if (el.monitorDesktop) {
      el.monitorDesktop.style.filter = `brightness(${factor})`;
    }
    if (el.brightnessSlider) el.brightnessSlider.value = String(clamped);
    if (el.brightnessPct) el.brightnessPct.textContent = `${clamped}%`;
    if (el.ccBrightSlider) el.ccBrightSlider.value = String(clamped);
    if (el.ccBrightVal) el.ccBrightVal.textContent = `${clamped}%`;
  }

  function syncDesktopScenes() {
    if (el.monitor) {
      el.monitor.setAttribute('data-mode', state.mode);
    }

    if (el.sceneResting) el.sceneResting.hidden = state.mode !== 'resting';
    if (el.sceneLyrics) el.sceneLyrics.hidden = state.mode !== 'lyrics';
    if (el.sceneTodo) el.sceneTodo.hidden = state.mode !== 'todo';
    if (el.sceneHud) el.sceneHud.hidden = state.mode !== 'hud';
    if (el.sceneDropzone) el.sceneDropzone.hidden = state.mode !== 'dropzone';

    el.modeButtons.forEach((btn) => {
      btn.setAttribute(
        'aria-pressed',
        btn.getAttribute('data-vm-mode') === state.mode ? 'true' : 'false'
      );
    });

    if (el.desktopTime) el.desktopTime.textContent = formatClockHHMM();
    if (el.clockStatus) {
      el.clockStatus.textContent = state.isRestingSleep
        ? 'Kapsul kompak × ♥ tertidur redup di bezel atas — hover, klik, atau Alt + Space untuk membangunkan'
        : state.capsuleState === 'expanded'
        ? 'Mode 6 Expanded terbuka — klik ikon Chevron atas atau tekan Alt + Space untuk kembali ke kompak × ♥'
        : 'Kapsul kompak × ♥ aktif — tidurkan, bangunkan, atau klik kapsul untuk memekarkan Mode 6';
    }
    if (el.hudReadout) {
      el.hudReadout.textContent = `Bright ${state.brightness}% · Vol ${state.volume}% · ${state.audioOutputLabel}`;
    }
    if (el.volumeSlider) el.volumeSlider.value = String(state.volume);
    if (el.volumePct) {
      el.volumePct.textContent = `${state.volume}%`;
    }
    applyMonitorBrightness();
  }

  function syncUI() {
    syncDesktopScenes();
    renderLyricsAndQueue();
    renderTodos();
    renderDropzoneCards();
    syncCapsuleUI();
  }

  function switchMode(nextMode) {
    clearIntroTimers();
    if (el.introOverlay) el.introOverlay.hidden = true;
    if (el.monitor) el.monitor.setAttribute('data-intro-phase', 'ready');

    state.mode = nextMode;
    state.isRestingSleep = false;
    state.idleLyricMinimized = false;

    if (nextMode === 'resting') {
      state.capsuleState = 'idle';
    } else if (nextMode === 'lyrics') {
      state.capsuleState = 'expanded';
      state.musicSubTab = 'player';
    } else if (nextMode === 'todo') {
      state.capsuleState = 'expanded';
    } else if (nextMode === 'hud') {
      state.capsuleState = 'idle';
      showHudChip('volume', 'Volume', `${state.volume}%`, true);
    } else if (nextMode === 'dropzone') {
      state.capsuleState = 'expanded';
    }
    syncUI();
  }

  /**
   * Clean Path Routing Without Hash (`#`)
   * Supports pushState on nav click, logo reset to /casa-app/, popstate, ScrollSpy replaceState, and 404.html restoration.
   */
  function initCleanNavigation() {
    const ROUTE_BASE = '/casa-app/';
    const ROUTE_MAP = {
      top: { elementId: 'top', slug: '' },
      playground: { elementId: 'playground', slug: 'playground' },
      architecture: { elementId: 'architecture', slug: 'arsitektur' },
      arsitektur: { elementId: 'architecture', slug: 'arsitektur' },
      download: { elementId: 'download', slug: 'unduh' },
      unduh: { elementId: 'download', slug: 'unduh' },
      feedback: { elementId: 'feedback', slug: 'feedback' },
      discussions: { elementId: 'feedback', slug: 'feedback' },
    };

    const buildRouteUrl = (slug) => (slug ? `${ROUTE_BASE}${slug}` : ROUTE_BASE);

    const setActiveNavRoute = (slug) => {
      el.headerNavLinks.forEach((link) => {
        const target = link.getAttribute('data-route') || '';
        if (slug && target === slug) {
          link.setAttribute('aria-current', 'page');
        } else {
          link.removeAttribute('aria-current');
        }
      });
    };

    const scrollToTargetId = (elementId, smooth = true) => {
      state.programmaticScrollUntil = Date.now() + 950;
      const behavior = smooth ? 'smooth' : 'auto';
      if (elementId === 'top') {
        window.scrollTo({ top: 0, behavior });
        return;
      }
      const targetEl = document.getElementById(elementId);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior, block: 'start' });
      }
    };

    const resolveFromPath = (pathname) => {
      const normalized = String(pathname || '')
        .replace(/^\/casa-app\/?/i, '/')
        .replace(/^\/+|\/+$/g, '')
        .toLowerCase();
      if (!normalized || normalized === 'index.html') return ROUTE_MAP.top;
      return ROUTE_MAP[normalized] || null;
    };

    // 1. Check 404.html sessionStorage handoff or legacy hash URL on initial load
    let initialRoute = null;
    try {
      const pending = window.sessionStorage.getItem('casa_pending_route');
      if (pending) {
        window.sessionStorage.removeItem('casa_pending_route');
        initialRoute = ROUTE_MAP[pending.toLowerCase()] || null;
      }
    } catch (_err) {}

    if (!initialRoute && window.location.hash) {
      const hashKey = window.location.hash.replace(/^#/, '').toLowerCase();
      initialRoute = ROUTE_MAP[hashKey] || ROUTE_MAP.top;
    }

    if (!initialRoute) {
      initialRoute = resolveFromPath(window.location.pathname);
    }

    if (initialRoute && initialRoute.slug) {
      const cleanUrl = buildRouteUrl(initialRoute.slug);
      window.history.replaceState({ route: initialRoute.slug }, '', cleanUrl);
      setActiveNavRoute(initialRoute.slug);
      window.requestAnimationFrame(() => {
        scrollToTargetId(initialRoute.elementId, true);
      });
    } else if (window.location.hash) {
      window.history.replaceState({ route: '' }, '', buildRouteUrl(''));
      setActiveNavRoute('');
    }

    // 2. Smooth Scroll + pushState on Nav & Brand Clicks
    const navLinks = Array.from(document.querySelectorAll('a[data-scroll-target], a[href^="#"]'));
    navLinks.forEach((link) => {
      link.addEventListener('click', (ev) => {
        const href = link.getAttribute('href') || '';
        const attrRoute = link.getAttribute('data-route');
        const targetId =
          link.getAttribute('data-scroll-target') || href.replace(/^#/, '');
        const key = (attrRoute !== null && attrRoute !== '' ? attrRoute : targetId).toLowerCase();
        const mapped = ROUTE_MAP[key] || ROUTE_MAP[targetId] || ROUTE_MAP.top;

        ev.preventDefault();
        scrollToTargetId(mapped.elementId, true);

        const nextUrl = buildRouteUrl(mapped.slug);
        if (window.location.pathname !== nextUrl || window.location.hash) {
          window.history.pushState({ route: mapped.slug }, '', nextUrl);
        }
        setActiveNavRoute(mapped.slug);
      });
    });

    // 3. Browser Back / Forward (`popstate`)
    window.addEventListener('popstate', (ev) => {
      const stateRoute =
        ev.state && typeof ev.state.route === 'string'
          ? ROUTE_MAP[ev.state.route || 'top']
          : null;
      const mapped = stateRoute || resolveFromPath(window.location.pathname) || ROUTE_MAP.top;
      setActiveNavRoute(mapped.slug);
      scrollToTargetId(mapped.elementId, true);
    });

    // 4. Scroll-Sync (`replaceState`, respects programmatic scroll lock)
    const sectionOrder = [
      { id: 'playground', slug: 'playground' },
      { id: 'architecture', slug: 'arsitektur' },
      { id: 'download', slug: 'unduh' },
      { id: 'feedback', slug: 'feedback' },
    ];
    let lastObservedSlug = initialRoute ? initialRoute.slug : '';

    if ('IntersectionObserver' in window) {
      const sectionEls = sectionOrder
        .map((item) => ({ ...item, node: document.getElementById(item.id) }))
        .filter((item) => Boolean(item.node));

      const ratios = new Map();
      const spy = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            ratios.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0);
          });
          if (Date.now() < state.programmaticScrollUntil) return;

          if (window.scrollY < 100 && lastObservedSlug !== '') {
            lastObservedSlug = '';
            setActiveNavRoute('');
            if (window.location.pathname.startsWith(ROUTE_BASE)) {
              window.history.replaceState({ route: '' }, '', buildRouteUrl(''));
            }
            return;
          }

          let best = null;
          sectionEls.forEach((sec) => {
            const ratio = ratios.get(sec.id) || 0;
            if (ratio >= 0.35 && (!best || ratio > best.ratio)) {
              best = { ...sec, ratio };
            }
          });
          if (best && best.slug !== lastObservedSlug) {
            lastObservedSlug = best.slug;
            setActiveNavRoute(best.slug);
            window.history.replaceState(
              { route: best.slug },
              '',
              buildRouteUrl(best.slug)
            );
          }
        },
        { threshold: [0.35, 0.55, 0.75] }
      );
      sectionEls.forEach((sec) => spy.observe(sec.node));
    }

    let scrollTickPending = false;
    window.addEventListener(
      'scroll',
      () => {
        if (scrollTickPending) return;
        scrollTickPending = true;
        window.requestAnimationFrame(() => {
          scrollTickPending = false;
          if (Date.now() < state.programmaticScrollUntil) return;
          if (window.scrollY < 80 && window.location.pathname.startsWith(ROUTE_BASE)) {
            if (window.location.pathname !== ROUTE_BASE) {
              lastObservedSlug = '';
              setActiveNavRoute('');
              window.history.replaceState({ route: '' }, '', buildRouteUrl(''));
            }
          }
        });
      },
      { passive: true }
    );
  }

  function initVirtualMonitorControls() {
    el.modeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.getAttribute('data-vm-mode');
        if (next) switchMode(next);
      });
    });

    el.m6TabButtons.forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const tab = btn.getAttribute('data-m6-tab');
        if (tab === 'music') switchMode('lyrics');
        else if (tab === 'todo') switchMode('todo');
        else if (tab === 'hud') {
          state.mode = 'hud';
          state.capsuleState = 'expanded';
          syncUI();
        } else if (tab === 'dropzone') switchMode('dropzone');
      });
    });

    el.musicSubButtons.forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const sub = btn.getAttribute('data-music-sub');
        if (sub) {
          state.musicSubTab = sub;
          syncCapsuleUI();
        }
      });
    });

    if (el.replayIntroBtn) {
      el.replayIntroBtn.addEventListener('click', startIntroMorphSequence);
    }

    // Hover & Click on Native Notch Assembly
    if (el.capsule) {
      el.capsule.addEventListener('mouseenter', () => {
        if (state.mode === 'resting' && state.isRestingSleep) {
          state.isRestingSleep = false;
          syncUI();
        }
      });

      el.capsule.addEventListener('click', (ev) => {
        if (ev.target && ev.target.closest('button')) return;
        if (state.capsuleState === 'idle') {
          state.isRestingSleep = false;
          state.capsuleState = 'expanded';
          state.idleLyricMinimized = false;
          syncUI();
        }
      });

      el.capsule.addEventListener('dragover', (ev) => {
        ev.preventDefault();
        el.capsule.setAttribute('data-drop-hover', 'true');
      });

      el.capsule.addEventListener('dragleave', () => {
        el.capsule.removeAttribute('data-drop-hover');
      });

      el.capsule.addEventListener('drop', (ev) => {
        ev.preventDefault();
        el.capsule.removeAttribute('data-drop-hover');
        const fid = ev.dataTransfer ? ev.dataTransfer.getData('text/plain') : '';
        if (fid) captureFileIntoDropZone(fid);
      });
    }

    if (el.monitorScreen) {
      el.monitorScreen.addEventListener('dragover', (ev) => {
        if (state.mode !== 'dropzone') return;
        ev.preventDefault();
        const rect = el.monitorScreen.getBoundingClientRect();
        if (ev.clientY <= rect.top + 145) {
          openDropZoneTarget(true);
        }
      });

      el.monitorScreen.addEventListener('drop', (ev) => {
        if (state.mode !== 'dropzone') return;
        const rect = el.monitorScreen.getBoundingClientRect();
        if (ev.clientY <= rect.top + 160) {
          ev.preventDefault();
          if (el.capsule) el.capsule.removeAttribute('data-drop-hover');
          const fid = ev.dataTransfer ? ev.dataTransfer.getData('text/plain') : '';
          if (fid) captureFileIntoDropZone(fid);
        }
      });
    }

    if (el.collapseBtn) {
      el.collapseBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        state.capsuleState = 'idle';
        syncUI();
      });
    }

    if (el.m6EyesBtn) {
      el.m6EyesBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        state.mode = 'resting';
        state.capsuleState = 'idle';
        state.isRestingSleep = !state.isRestingSleep;
        syncUI();
      });
    }

    if (el.expRestBtn) {
      el.expRestBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        state.mode = 'resting';
        state.capsuleState = 'idle';
        state.isRestingSleep = true;
        syncUI();
      });
    }

    // Alt + Space toggle inside playground
    window.addEventListener('keydown', (ev) => {
      if (ev.altKey && ev.code === 'Space') {
        ev.preventDefault();
        state.isRestingSleep = false;
        state.idleLyricMinimized = false;
        state.capsuleState = state.capsuleState === 'expanded' ? 'idle' : 'expanded';
        syncUI();
      }
    });

    if (el.sceneToggleRestBtn) {
      el.sceneToggleRestBtn.addEventListener('click', () => {
        state.isRestingSleep = !state.isRestingSleep;
        if (state.isRestingSleep) state.capsuleState = 'idle';
        syncUI();
      });
    }

    if (el.sceneToggleExpandBtn) {
      el.sceneToggleExpandBtn.addEventListener('click', () => {
        state.isRestingSleep = false;
        state.capsuleState = state.capsuleState === 'expanded' ? 'idle' : 'expanded';
        syncUI();
      });
    }

    // Lyrics & Music Controls + Idle Lyric Minimize
    const triggerIdleLyricMinimize = (ev) => {
      if (ev) ev.stopPropagation();
      state.mode = 'lyrics';
      if (state.capsuleState === 'expanded') {
        state.idleLyricMinimized = true;
        state.capsuleState = 'idle';
      } else {
        state.idleLyricMinimized = !state.idleLyricMinimized;
        if (!state.idleLyricMinimized) state.capsuleState = 'expanded';
      }
      syncUI();
    };

    if (el.sceneLyricMinimizeBtn) {
      el.sceneLyricMinimizeBtn.addEventListener('click', triggerIdleLyricMinimize);
    }
    if (el.idleLyricBtn) {
      el.idleLyricBtn.addEventListener('click', triggerIdleLyricMinimize);
    }
    if (el.expPlayBtn) {
      el.expPlayBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        state.musicPlaying = !state.musicPlaying;
        syncCapsuleUI();
      });
    }
    if (el.expPrevBtn) {
      el.expPrevBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        state.trackIndex = (state.trackIndex - 1 + QUEUE_TRACKS.length) % QUEUE_TRACKS.length;
        state.lyricIndex = 0;
        syncUI();
      });
    }
    if (el.expNextBtn) {
      el.expNextBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        state.trackIndex = (state.trackIndex + 1) % QUEUE_TRACKS.length;
        state.lyricIndex = 0;
        syncUI();
      });
    }
    if (el.expQueueToggle) {
      el.expQueueToggle.addEventListener('click', (ev) => {
        ev.stopPropagation();
        state.isQueuePopoutOpen = !state.isQueuePopoutOpen;
        syncCapsuleUI();
      });
    }
    if (el.expQueueClose) {
      el.expQueueClose.addEventListener('click', (ev) => {
        ev.stopPropagation();
        state.isQueuePopoutOpen = false;
        syncCapsuleUI();
      });
    }
    if (el.expLyricsToggle) {
      el.expLyricsToggle.addEventListener('click', (ev) => {
        ev.stopPropagation();
        state.isLyricsOpen = !state.isLyricsOpen;
        state.isQueuePopoutOpen = false;
        syncCapsuleUI();
      });
    }
    if (el.expSaveBtn) {
      el.expSaveBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        el.expSaveBtn.classList.add('active');
        window.setTimeout(() => {
          if (el.expSaveBtn) el.expSaveBtn.classList.remove('active');
        }, 900);
      });
    }
    if (el.expSearchBtn) {
      el.expSearchBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        state.musicSubTab = state.musicSubTab === 'playlists' ? 'player' : 'playlists';
        syncCapsuleUI();
      });
    }

    // To-Do & Focus Presets
    if (el.todoForm && el.todoInput) {
      el.todoForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const text = el.todoInput.value.trim();
        if (!text) return;
        state.todos.push({
          id: `td-${Date.now().toString(36)}`,
          text,
          done: false,
        });
        el.todoInput.value = '';
        syncUI();
      });
    }
    if (el.todoDualBtn) {
      el.todoDualBtn.addEventListener('click', () => {
        state.dualIdleActive = !state.dualIdleActive;
        syncUI();
      });
    }
    if (el.todoTimerBtn) {
      el.todoTimerBtn.addEventListener('click', () => {
        state.focusTimerRunning = !state.focusTimerRunning;
        syncUI();
      });
    }
    if (el.expTimerBtn) {
      el.expTimerBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        state.focusTimerRunning = !state.focusTimerRunning;
        syncUI();
      });
    }
    el.presetChips.forEach((chip) => {
      chip.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const mins = Number(chip.getAttribute('data-preset-mins') || 25);
        state.focusTotalMinutes = mins;
        state.focusSeconds = mins * 60;
        el.presetChips.forEach((c) => c.classList.toggle('active', c === chip));
        syncCapsuleUI();
      });
    });

    // Volume, Brightness & BT HUD Controls
    if (el.brightnessSlider) {
      el.brightnessSlider.addEventListener('input', () => {
        state.brightness = Number(el.brightnessSlider.value);
        state.capsuleState = 'idle';
        syncDesktopScenes();
        showHudChip('brightness', 'Brightness', `${state.brightness}%`, true);
      });
    }

    if (el.volumeSlider) {
      el.volumeSlider.addEventListener('input', () => {
        state.volume = Number(el.volumeSlider.value);
        state.capsuleState = 'idle';
        syncDesktopScenes();
        showHudChip('volume', 'Volume', `${state.volume}%`, true);
      });
    }

    if (el.ccBrightSlider) {
      el.ccBrightSlider.addEventListener('click', (ev) => ev.stopPropagation());
      el.ccBrightSlider.addEventListener('input', (ev) => {
        ev.stopPropagation();
        state.brightness = Number(el.ccBrightSlider.value);
        syncDesktopScenes();
        syncCapsuleUI();
      });
      el.ccBrightSlider.addEventListener('change', (ev) => {
        ev.stopPropagation();
        state.brightness = Number(el.ccBrightSlider.value);
        state.capsuleState = 'idle';
        syncDesktopScenes();
        showHudChip('brightness', 'Brightness', `${state.brightness}%`, true);
      });
    }

    if (el.ccVolSlider) {
      el.ccVolSlider.addEventListener('click', (ev) => ev.stopPropagation());
      el.ccVolSlider.addEventListener('input', (ev) => {
        ev.stopPropagation();
        state.volume = Number(el.ccVolSlider.value);
        syncDesktopScenes();
        syncCapsuleUI();
      });
      el.ccVolSlider.addEventListener('change', (ev) => {
        ev.stopPropagation();
        state.volume = Number(el.ccVolSlider.value);
        state.capsuleState = 'idle';
        syncDesktopScenes();
        showHudChip('volume', 'Volume', `${state.volume}%`, true);
      });
    }

    const triggerBtHud = (ev) => {
      if (ev) ev.stopPropagation();
      state.audioOutputLabel = 'BT Earphone • 85%';
      state.capsuleState = 'idle';
      if (el.ccBtSub) el.ccBtSub.textContent = 'Earphone · 85%';
      syncDesktopScenes();
      showHudChip('bluetooth', 'BT Earphone', '85%', false);
    };

    const triggerWiredHud = (ev) => {
      if (ev) ev.stopPropagation();
      state.audioOutputLabel = 'Wired Earphone';
      state.capsuleState = 'idle';
      syncDesktopScenes();
      showHudChip('wired', 'Wired Earphone', 'Connected', false);
    };

    if (el.simBtBtn) el.simBtBtn.addEventListener('click', triggerBtHud);
    if (el.ccBtBtn) el.ccBtBtn.addEventListener('click', triggerBtHud);
    if (el.simWiredBtn) el.simWiredBtn.addEventListener('click', triggerWiredHud);
    if (el.ccWiredBtn) el.ccWiredBtn.addEventListener('click', triggerWiredHud);

    // Drop Zone
    if (el.simDropAllBtn) {
      el.simDropAllBtn.addEventListener('click', () => {
        const nextFile =
          SAMPLE_FILES.find((f) => !state.droppedIds.includes(f.id)) || SAMPLE_FILES[0];
        captureFileIntoDropZone(nextFile.id);
      });
    }
    if (el.copyBackBtn) {
      el.copyBackBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        copyDropZoneBackToDesktop();
      });
    }

    // Live Intervals
    state.lyricIntervalId = window.setInterval(() => {
      if (state.mode === 'lyrics' && state.musicPlaying) {
        const track = getActiveTrack();
        state.lyricIndex = (state.lyricIndex + 1) % track.lyrics.length;
        renderLyricsAndQueue();
        syncCapsuleUI();
      }
    }, 2200);

    state.focusTickId = window.setInterval(() => {
      if (state.mode === 'todo' && state.focusTimerRunning) {
        state.focusSeconds = state.focusSeconds > 0 ? state.focusSeconds - 1 : 25 * 60;
        syncCapsuleUI();
      }
    }, 1000);

    state.clockIntervalId = window.setInterval(() => {
      if (el.desktopTime) el.desktopTime.textContent = formatClockHHMM();
      if (state.capsuleState === 'idle') syncCapsuleUI();
    }, 15000);

    // Trigger Intro Morph once monitor enters viewport
    let introTriggered = false;
    const triggerIntroOnce = () => {
      if (introTriggered) return;
      introTriggered = true;
      startIntroMorphSequence();
    };

    if ('IntersectionObserver' in window && el.monitor) {
      const obs = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            obs.disconnect();
            triggerIntroOnce();
          }
        },
        { threshold: 0.2 }
      );
      obs.observe(el.monitor);
    } else {
      triggerIntroOnce();
    }
  }

  /**
   * Release Download Link Sync (Single Primary .exe Button)
   */
  function isSafeGitHubUrl(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return false;
    try {
      const parsed = new URL(urlStr);
      return (
        parsed.protocol === 'https:' &&
        (parsed.hostname === 'github.com' ||
          parsed.hostname === 'objects.githubusercontent.com' ||
          parsed.hostname === 'release-assets.githubusercontent.com')
      );
    } catch (_err) {
      return false;
    }
  }

  function formatMegabytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return null;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  const DL_CACHE_KEY = 'casa_dl_count_cache';
  const DL_CACHE_TTL_MS = 15 * 60 * 1000;
  const DL_COOLDOWN_MS = 6000;

  function applyReleaseMetadata(count, exeUrl, exeSize, exeVersion) {
    if (exeUrl && isSafeGitHubUrl(exeUrl) && el.primaryDownloadBtn) {
      el.primaryDownloadBtn.href = exeUrl;
    }
    if (exeSize && el.downloadSizeText) {
      const versionTag =
        typeof exeVersion === 'string' && exeVersion.trim()
          ? exeVersion.trim().startsWith('v')
            ? exeVersion.trim()
            : `v${exeVersion.trim()}`
          : 'v2.0.3';
      el.downloadSizeText.textContent = `${versionTag} · NSIS Setup (.exe) · ${exeSize}`;
    }
    if (el.downloadCountText) {
      if (Number.isFinite(count) && count >= 0) {
        el.downloadCountText.textContent = `· ${count.toLocaleString('en-US')} downloads`;
        el.downloadCountText.hidden = false;
      } else {
        el.downloadCountText.textContent = '';
        el.downloadCountText.hidden = true;
      }
    }
  }

  function initDownloadButtonCooldown() {
    const btn = el.primaryDownloadBtn;
    if (!btn) return;
    let isCooldown = false;
    let timerId = null;

    btn.addEventListener('click', (ev) => {
      if (isCooldown) {
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
      isCooldown = true;
      const labelNode = el.primaryDownloadLabel || btn.querySelector('span') || btn;
      const originalText = labelNode.textContent || 'Download CASA for Windows';
      btn.setAttribute('aria-disabled', 'true');
      btn.classList.add('is-cooldown');
      labelNode.textContent = 'Memulai unduhan...';

      if (timerId) window.clearTimeout(timerId);
      timerId = window.setTimeout(() => {
        isCooldown = false;
        timerId = null;
        btn.removeAttribute('aria-disabled');
        btn.classList.remove('is-cooldown');
        labelNode.textContent = originalText;
      }, DL_COOLDOWN_MS);
    });
  }

  async function initSmartReleaseHub() {
    try {
      const rawCache = window.localStorage.getItem(DL_CACHE_KEY);
      if (rawCache) {
        const cached = JSON.parse(rawCache);
        if (
          cached &&
          typeof cached.cachedAt === 'number' &&
          Date.now() - cached.cachedAt < DL_CACHE_TTL_MS &&
          typeof cached.count === 'number'
        ) {
          applyReleaseMetadata(
            cached.count,
            cached.exeUrl || null,
            cached.exeSize || null,
            cached.exeVersion || null
          );
          return;
        }
      }
    } catch (_err) {}

    try {
      const response = await fetch(RELEASES_API_URL, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!response.ok) return;
      const releases = await response.json();
      if (!Array.isArray(releases) || releases.length === 0) return;

      // Sum download_count strictly for installer binaries (.exe and .msi), excluding .sig & latest.json
      let totalInstallerDownloads = 0;
      releases.forEach((rel) => {
        if (!rel || !Array.isArray(rel.assets)) return;
        rel.assets.forEach((asset) => {
          const name = typeof asset?.name === 'string' ? asset.name.toLowerCase() : '';
          if (name.endsWith('.exe') || name.endsWith('.msi')) {
            const c = Number(asset.download_count);
            if (Number.isFinite(c) && c > 0) {
              totalInstallerDownloads += c;
            }
          }
        });
      });

      const v2Release = releases.find((rel) => {
        if (typeof rel.tag_name !== 'string') return false;
        const m = rel.tag_name.match(/^v2\.(\d+)\.(\d+)$/);
        if (!m) return false;
        const minor = Number(m[1]);
        const patch = Number(m[2]);
        return minor > 0 || patch >= 3;
      });

      let exeUrl = null;
      let exeSize = null;
      let exeVersion = null;
      if (v2Release && Array.isArray(v2Release.assets)) {
        exeVersion = typeof v2Release.tag_name === 'string' ? v2Release.tag_name : 'v2.0.3';
        const exeAsset = v2Release.assets.find(
          (a) => typeof a.name === 'string' && a.name.toLowerCase().endsWith('.exe')
        );
        if (exeAsset && isSafeGitHubUrl(exeAsset.browser_download_url)) {
          exeUrl = exeAsset.browser_download_url;
          exeSize = formatMegabytes(exeAsset.size) || '4.43 MB';
        }
      }

      applyReleaseMetadata(totalInstallerDownloads, exeUrl, exeSize, exeVersion);

      try {
        window.localStorage.setItem(
          DL_CACHE_KEY,
          JSON.stringify({
            count: totalInstallerDownloads,
            exeUrl,
            exeSize,
            exeVersion,
            cachedAt: Date.now(),
          })
        );
      } catch (_err) {}
    } catch (_err) {
      // Keep static v2.0.3 fallback link & hide download count gracefully when offline/rate-limited
    }
  }

  function initCopyHash() {
    if (!el.copyShaBtn || !el.shaValueExe || !navigator.clipboard) return;
    el.copyShaBtn.addEventListener('click', async () => {
      const hashText = (el.shaValueExe.textContent || '').trim();
      if (!hashText) return;
      try {
        await navigator.clipboard.writeText(hashText);
        el.copyShaBtn.textContent = 'Tersalin!';
        window.setTimeout(() => {
          el.copyShaBtn.textContent = 'Salin Hash';
        }, 2000);
      } catch (_err) {
        el.copyShaBtn.textContent = 'Salin Manual';
      }
    });
  }

  const RATING_LABELS = {
    1: '1/5 — Sangat Kurang',
    2: '2/5 — Perlu Perbaikan',
    3: '3/5 — Cukup Bagus',
    4: '4/5 — Sangat Bagus',
    5: '5/5 — Luar Biasa!',
  };
  const REVIEWS_PAGE_SIZE = 6;

  function renderMonochromeStars(container, ratingVal, size = 14) {
    if (!container) return;
    clearNode(container);
    const fullCount = Math.round(Math.max(0, Math.min(5, Number(ratingVal) || 0)));
    for (let i = 1; i <= 5; i++) {
      const svg = createSvgNode('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        'aria-hidden': 'true',
      });
      const path = createSvgNode('path', {
        d: 'M12 2.5l2.86 5.79 6.39.93-4.62 4.5 1.09 6.36L12 17.08l-5.72 3 1.09-6.36-4.62-4.5 6.39-.93L12 2.5z',
        fill: i <= fullCount ? '#ffffff' : 'rgba(255, 255, 255, 0.16)',
      });
      svg.appendChild(path);
      container.appendChild(svg);
    }
  }

  function formatReviewDate(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      if (Number.isNaN(d.getTime())) return '';
      return d.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch (_err) {
      return '';
    }
  }

  function hasSupabaseConfig() {
    return (
      typeof SUPABASE_URL === 'string' &&
      SUPABASE_URL.startsWith('https://') &&
      typeof SUPABASE_PUBLISHABLE_KEY === 'string' &&
      SUPABASE_PUBLISHABLE_KEY.trim().length > 0
    );
  }

  async function supabaseRequest(pathAndQuery, init = {}) {
    const base = SUPABASE_URL.replace(/\/+$/, '');
    const headers = {
      apikey: SUPABASE_PUBLISHABLE_KEY.trim(),
      ...(init.headers || {}),
    };
    return await fetch(`${base}/${pathAndQuery}`, {
      ...init,
      headers,
    });
  }

  function initReviewsHub() {
    const reviewState = {
      selectedRating: 0,
      filterRating: 'all',
      sortBy: 'newest',
      offset: 0,
      hasMore: false,
      isSubmitting: false,
      formStartPerf: performance.now(),
      formStartWall: Date.now(),
    };

    const starButtons = el.reviewStarPicker
      ? Array.from(el.reviewStarPicker.querySelectorAll('[data-star-value]'))
      : [];
    const filterButtons = el.reviewsFilterBar
      ? Array.from(el.reviewsFilterBar.querySelectorAll('[data-filter-rating]'))
      : [];

    const setStatusMessage = (msg, isError = false) => {
      if (!el.revStatus) return;
      el.revStatus.textContent = msg;
      el.revStatus.setAttribute('data-tone', isError ? 'error' : 'neutral');
    };

    const syncStarPickerUI = (previewRating = 0) => {
      const displayVal = previewRating || reviewState.selectedRating;
      starButtons.forEach((btn) => {
        const val = Number(btn.getAttribute('data-star-value') || 0);
        btn.classList.toggle('active', val <= displayVal);
        btn.setAttribute('aria-checked', val === reviewState.selectedRating ? 'true' : 'false');
      });
      if (el.reviewRatingDesc) {
        el.reviewRatingDesc.textContent = displayVal
          ? RATING_LABELS[displayVal] || `${displayVal}/5`
          : 'Pilih rating (1–5)';
      }
    };

    const syncCharCount = () => {
      if (!el.revComment || !el.revCharCount) return;
      const len = el.revComment.value.length;
      el.revCharCount.textContent = `${len}/500`;
    };

    const renderSummaryStats = (rawStats) => {
      const stats = rawStats || {
        total_reviews: 0,
        avg_rating: 0,
        count_5: 0,
        count_4: 0,
        count_3: 0,
        count_2: 0,
        count_1: 0,
      };
      const total = Math.max(0, Number(stats.total_reviews) || 0);
      const avg = total > 0 ? Number(stats.avg_rating) || 0 : 0;

      if (el.reviewsAvgScore) {
        el.reviewsAvgScore.textContent = avg.toFixed(1);
      }
      if (el.reviewsAvgStars) {
        el.reviewsAvgStars.setAttribute('aria-label', `Rating rata-rata ${avg.toFixed(1)} dari 5`);
        renderMonochromeStars(el.reviewsAvgStars, avg, 15);
      }
      if (el.reviewsTotalCount) {
        el.reviewsTotalCount.textContent = `${total.toLocaleString('en-US')} ulasan`;
      }
      if (el.reviewsSummaryHint) {
        el.reviewsSummaryHint.textContent =
          total === 0
            ? 'Belum ada ulasan terpublikasi'
            : total < 3
            ? 'Sampel awal — ulasan pertama'
            : 'Terverifikasi oleh moderator';
      }

      [5, 4, 3, 2, 1].forEach((star) => {
        const count = Math.max(0, Number(stats[`count_${star}`]) || 0);
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const fillEl = el.reviewsBars?.querySelector(`[data-bar-fill="${star}"]`);
        const countEl = el.reviewsBars?.querySelector(`[data-bar-count="${star}"]`);
        const trackEl = fillEl?.parentElement;
        if (fillEl) fillEl.style.width = `${pct}%`;
        if (countEl) countEl.textContent = String(count);
        if (trackEl) {
          trackEl.setAttribute('aria-label', `Distribusi ${star} bintang: ${count}`);
        }
      });
    };

    const buildReviewCardNode = (item) => {
      const article = document.createElement('article');
      article.className = 'review-item';

      const head = document.createElement('div');
      head.className = 'review-item-head';

      const authorGroup = document.createElement('div');
      authorGroup.className = 'review-author-group';

      const authorEl = document.createElement('span');
      authorEl.className = 'review-author-name';
      authorEl.textContent = item.author_name || 'Pengguna';

      const versionEl = document.createElement('span');
      versionEl.className = 'review-version-badge';
      versionEl.textContent = item.app_version || 'v2.0.4';

      const starsWrap = document.createElement('span');
      starsWrap.className = 'reviews-stars-row';
      starsWrap.setAttribute('aria-label', `${item.rating || 5} dari 5 bintang`);
      renderMonochromeStars(starsWrap, item.rating || 5, 12);

      authorGroup.appendChild(authorEl);
      authorGroup.appendChild(starsWrap);
      authorGroup.appendChild(versionEl);

      const dateEl = document.createElement('time');
      dateEl.className = 'review-date';
      dateEl.textContent = formatReviewDate(item.created_at);

      head.appendChild(authorGroup);
      head.appendChild(dateEl);

      const bodyEl = document.createElement('p');
      bodyEl.className = 'review-comment-text';
      bodyEl.textContent = item.comment || '';

      article.appendChild(head);
      article.appendChild(bodyEl);

      if (item.creator_reply && String(item.creator_reply).trim()) {
        const replyBox = document.createElement('div');
        replyBox.className = 'creator-reply-box';

        const replyHead = document.createElement('div');
        replyHead.className = 'creator-reply-head';

        const badge = document.createElement('span');
        badge.className = 'creator-badge';
        badge.textContent = 'Creator';

        const replyDate = document.createElement('time');
        replyDate.className = 'review-date';
        replyDate.textContent = formatReviewDate(item.replied_at);

        replyHead.appendChild(badge);
        replyHead.appendChild(replyDate);

        const replyText = document.createElement('p');
        replyText.className = 'creator-reply-text';
        replyText.textContent = item.creator_reply;

        replyBox.appendChild(replyHead);
        replyBox.appendChild(replyText);
        article.appendChild(replyBox);
      }

      return article;
    };

    const showEmptyState = (message) => {
      if (!el.reviewsEmpty) return;
      el.reviewsEmpty.textContent = message;
      el.reviewsEmpty.hidden = false;
    };

    const hideEmptyState = () => {
      if (!el.reviewsEmpty) return;
      el.reviewsEmpty.hidden = true;
      el.reviewsEmpty.textContent = '';
    };

    const fetchReviewsFeed = async (append = false) => {
      if (!el.reviewsList) return;
      if (!append) {
        reviewState.offset = 0;
        clearNode(el.reviewsList);
      }

      if (!hasSupabaseConfig()) {
        if (el.reviewsMoreWrap) el.reviewsMoreWrap.hidden = true;
        showEmptyState(
          'Belum ada ulasan terpublikasi (siap terhubung setelah Publishable Key diisi di docs/app.js).'
        );
        return;
      }

      const sortExpr =
        reviewState.sortBy === 'highest'
          ? 'rating.desc,created_at.desc'
          : reviewState.sortBy === 'lowest'
          ? 'rating.asc,created_at.desc'
          : 'created_at.desc';

      const params = [
        'select=id,author_name,rating,comment,app_version,creator_reply,replied_at,created_at',
        `order=${encodeURIComponent(sortExpr)}`,
        `limit=${REVIEWS_PAGE_SIZE + 1}`,
        `offset=${reviewState.offset}`,
      ];
      if (reviewState.filterRating !== 'all') {
        params.push(`rating=eq.${encodeURIComponent(reviewState.filterRating)}`);
      }

      try {
        const resp = await supabaseRequest(`rest/v1/casa_reviews_public?${params.join('&')}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const rows = await resp.json();
        const list = Array.isArray(rows) ? rows : [];
        reviewState.hasMore = list.length > REVIEWS_PAGE_SIZE;
        const pageItems = list.slice(0, REVIEWS_PAGE_SIZE);
        reviewState.offset += pageItems.length;

        pageItems.forEach((item) => {
          el.reviewsList.appendChild(buildReviewCardNode(item));
        });

        if (el.reviewsList.children.length === 0) {
          showEmptyState(
            reviewState.filterRating === 'all'
              ? 'Belum ada ulasan disetujui. Jadilah yang pertama menulis ulasan!'
              : `Belum ada ulasan untuk filter ${reviewState.filterRating} ★.`
          );
        } else {
          hideEmptyState();
        }

        if (el.reviewsMoreWrap) {
          el.reviewsMoreWrap.hidden = !reviewState.hasMore;
        }
      } catch (_err) {
        if (el.reviewsList.children.length === 0) {
          showEmptyState('Ulasan sedang tidak tersedia sementara waktu.');
        }
        if (el.reviewsMoreWrap) el.reviewsMoreWrap.hidden = true;
      }
    };

    const fetchSummaryStats = async () => {
      if (!hasSupabaseConfig()) {
        renderSummaryStats(null);
        return;
      }
      try {
        const resp = await supabaseRequest('rest/v1/casa_review_stats?select=*');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const rows = await resp.json();
        renderSummaryStats(Array.isArray(rows) && rows[0] ? rows[0] : null);
      } catch (_err) {
        renderSummaryStats(null);
      }
    };

    // Wire Star Picker (Click + Hover + Arrow Keys)
    starButtons.forEach((btn) => {
      const val = Number(btn.getAttribute('data-star-value') || 0);
      btn.addEventListener('click', () => {
        reviewState.selectedRating = val;
        syncStarPickerUI();
      });
      btn.addEventListener('mouseenter', () => syncStarPickerUI(val));
      btn.addEventListener('mouseleave', () => syncStarPickerUI());
      btn.addEventListener('keydown', (ev) => {
        if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') {
          ev.preventDefault();
          const next = Math.min(5, (reviewState.selectedRating || val) + 1);
          reviewState.selectedRating = next;
          syncStarPickerUI();
          starButtons[next - 1]?.focus();
        } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') {
          ev.preventDefault();
          const prev = Math.max(1, (reviewState.selectedRating || val) - 1);
          reviewState.selectedRating = prev;
          syncStarPickerUI();
          starButtons[prev - 1]?.focus();
        }
      });
    });

    if (el.revComment) {
      el.revComment.addEventListener('input', syncCharCount);
      syncCharCount();
    }

    // Wire Filter Pills & Sort Dropdown
    filterButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextFilter = btn.getAttribute('data-filter-rating') || 'all';
        reviewState.filterRating = nextFilter;
        filterButtons.forEach((b) => {
          b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
        });
        void fetchReviewsFeed(false);
      });
    });

    if (el.reviewsSortSelect) {
      el.reviewsSortSelect.addEventListener('change', () => {
        reviewState.sortBy = el.reviewsSortSelect.value || 'newest';
        void fetchReviewsFeed(false);
      });
    }

    if (el.reviewsLoadMoreBtn) {
      el.reviewsLoadMoreBtn.addEventListener('click', () => {
        void fetchReviewsFeed(true);
      });
    }

    // Wire Review Form Submit
    if (el.reviewForm) {
      el.reviewForm.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (reviewState.isSubmitting) return;

        const rating = reviewState.selectedRating;
        const authorName = (el.revName?.value || '').trim();
        const comment = (el.revComment?.value || '').trim();
        const websiteHp = el.revWebsiteHp?.value || '';

        if (rating < 1 || rating > 5) {
          setStatusMessage('Pilih rating 1 sampai 5 bintang terlebih dahulu.', true);
          starButtons[0]?.focus();
          return;
        }
        if (!authorName || authorName.length > 40) {
          setStatusMessage('Nama wajib diisi (maksimal 40 karakter).', true);
          el.revName?.focus();
          return;
        }
        if (comment.length < 3 || comment.length > 500) {
          setStatusMessage('Tulis ulasan singkat (3–500 karakter).', true);
          el.revComment?.focus();
          return;
        }

        if (!hasSupabaseConfig()) {
          setStatusMessage(
            'Layanan ulasan belum aktif (Publishable Key Supabase belum dikonfigurasi).',
            true
          );
          return;
        }

        reviewState.isSubmitting = true;
        if (el.revSubmitBtn) el.revSubmitBtn.disabled = true;
        setStatusMessage('Mengirim ulasan ke antrean moderasi...');

        try {
          const perfDelta = performance.now() - reviewState.formStartPerf;
          const wallDelta = Date.now() - reviewState.formStartWall;
          const rawElapsed = Math.max(
            Number.isFinite(perfDelta) ? perfDelta : 0,
            Number.isFinite(wallDelta) ? wallDelta : 0
          );
          const elapsedMs = rawElapsed > 0 ? Math.round(rawElapsed) : 0;

          const resp = await supabaseRequest('functions/v1/submit-review', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              author_name: authorName,
              rating,
              comment,
              website_hp: websiteHp,
              elapsed_ms: elapsedMs,
              app_version: 'v2.0.4',
            }),
          });

          const result = await resp.json().catch(() => ({}));
          if (!resp.ok) {
            setStatusMessage(
              typeof result.error === 'string'
                ? result.error
                : 'Gagal mengirim ulasan. Silakan coba lagi nanti.',
              true
            );
            return;
          }

          el.reviewForm.reset();
          reviewState.selectedRating = 0;
          reviewState.formStartPerf = performance.now();
          reviewState.formStartWall = Date.now();
          syncStarPickerUI();
          syncCharCount();
          setStatusMessage(
            'Terima kasih! Ulasan kamu sedang ditinjau moderator sebelum tayang.'
          );
        } catch (_err) {
          setStatusMessage(
            'Koneksi gagal saat mengirim ulasan. Pastikan perangkat online lalu coba lagi.',
            true
          );
        } finally {
          reviewState.isSubmitting = false;
          if (el.revSubmitBtn) el.revSubmitBtn.disabled = false;
        }
      });
    }

    syncStarPickerUI();
    void Promise.all([fetchSummaryStats(), fetchReviewsFeed(false)]);
  }

  // Boot
  initCleanNavigation();
  initVirtualMonitorControls();
  initCopyHash();
  initDownloadButtonCooldown();
  initReviewsHub();
  syncUI();
  void initSmartReleaseHub();
})();
