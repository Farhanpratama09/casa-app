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

  // 5 interactive prayer schedule phases for the Web Showcase (simulated clock — independent of visitor browser time)
  const DEMO_PRAYERS = [
    {
      key: 'subuh',
      label: 'Subuh',
      upper: 'SUBUH',
      time: '04:28',
      minutes: 4 * 60 + 28,
      previewMinutes: 5 * 60 + 15,
      previewTimeLabel: '05:15',
      anchor: { x: 53.2, y: 40 },
    },
    {
      key: 'dzuhur',
      label: 'Dzuhur',
      upper: 'DZUHUR',
      time: '11:55',
      minutes: 11 * 60 + 55,
      previewMinutes: 12 * 60 + 15,
      previewTimeLabel: '12:15',
      anchor: { x: 159.6, y: 11 },
    },
    {
      key: 'ashar',
      label: 'Ashar',
      upper: 'ASHAR',
      time: '15:14',
      minutes: 15 * 60 + 14,
      previewMinutes: 15 * 60 + 30,
      previewTimeLabel: '15:30',
      anchor: { x: 266.0, y: 21 },
    },
    {
      key: 'maghrib',
      label: 'Maghrib',
      upper: 'MAGHRIB',
      time: '17:30',
      minutes: 17 * 60 + 30,
      previewMinutes: 17 * 60 + 40,
      previewTimeLabel: '17:40',
      anchor: { x: 372.4, y: 40 },
    },
    {
      key: 'isya',
      label: 'Isya',
      upper: 'ISYA',
      time: '18:52',
      minutes: 18 * 60 + 52,
      previewMinutes: 19 * 60 + 20,
      previewTimeLabel: '19:20',
      anchor: { x: 478.8, y: 50 },
    },
  ];

  const CURVE_CONTROL_POINTS = [
    { x: 10, y: 48 },
    ...DEMO_PRAYERS.map((p) => p.anchor),
    { x: 522, y: 53 },
  ];

  const state = {
    mode: 'resting', // 'resting' | 'lyrics' | 'todo' | 'hud' | 'dropzone' | 'ibadah'
    expandedTab: 'control', // 'music' | 'todo' | 'control' | 'dropzone' | 'ibadah'
    capsuleState: 'idle', // 'idle' | 'expanded'
    isRestingSleep: false,
    expression: 'idle', // 'idle' | 'music' | 'focus' | 'dual_active' | 'prayer'
    ibadahEnabled: false,
    ibadahPreviewKey: 'dzuhur', // 'subuh' | 'dzuhur' | 'ashar' | 'maghrib' | 'isya'
    prayerAlertActive: false,
    prayerCountdownSeconds: (15 * 60 + 14 - (12 * 60 + 15)) * 60,
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
    prayerPill: $('casa-prayer-pill'),
    prayerEyes: $('vm-prayer-eyes'),
    prayerAlertTitle: $('vm-prayer-alert-title'),
    prayerAlertTime: $('vm-prayer-alert-time'),
    prayerStopBtn: $('vm-prayer-stop-btn'),
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
    m6IbadahTab: $('vm-m6-ibadah-tab'),
    m6DropBadge: $('vm-m6-drop-badge'),
    collapseBtn: $('vm-notch-collapse-btn'),
    expandedPrayerBanner: $('vm-expanded-prayer-banner'),
    expandedPrayerEyes: $('vm-expanded-prayer-eyes'),
    expandedPrayerLabel: $('vm-expanded-prayer-label'),
    expandedPrayerTime: $('vm-expanded-prayer-time'),
    expandedPrayerStopBtn: $('vm-expanded-prayer-stop-btn'),

    expMusic: $('vm-exp-music'),
    expFocus: $('vm-exp-focus'),
    expControl: $('vm-exp-control'),
    expDropzone: $('vm-exp-dropzone'),
    expIbadah: $('vm-exp-ibadah'),
    ibadahNextHeading: $('vm-ibadah-next-heading'),
    ibadahCountdown: $('vm-ibadah-countdown'),
    ibadahPreviewPill: $('vm-ibadah-preview-pill'),
    ibadahRefreshBtn: $('vm-ibadah-refresh-btn'),
    ibadahGrid: $('vm-ibadah-grid'),
    ibadahPrayerButtons: Array.from(document.querySelectorAll('#vm-ibadah-grid [data-prayer-preview]')),
    ibadahPrayerDots: Array.from(document.querySelectorAll('#vm-ibadah-curve-svg .vm-prayer-dot')),
    ibadahNextHalo: $('vm-ibadah-next-halo'),
    ibadahPassedGrad: $('vm-passed-sky-grad'),
    ibadahCometGrad: $('vm-comet-tail'),
    ibadahRemainingPath: $('vm-ibadah-remaining-path'),
    ibadahPassedPath: $('vm-ibadah-passed-path'),
    ibadahCometPath: $('vm-ibadah-comet-path'),
    ibadahCelestialOrb: $('vm-ibadah-celestial-orb'),
    ibadahOrbGlow: $('vm-ibadah-orb-glow'),
    ibadahOrbBacking: $('vm-ibadah-orb-backing'),
    ibadahOrbGlyph: $('vm-ibadah-orb-glyph'),
    passedGradStart: $('vm-passed-grad-start'),
    passedGradEnd: $('vm-passed-grad-end'),
    cometGradStart: $('vm-comet-grad-start'),
    cometGradMid: $('vm-comet-grad-mid'),
    cometGradEnd: $('vm-comet-grad-end'),

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
    sceneIbadah: $('scene-ibadah'),
    ibadahStatusTag: $('vm-ibadah-status-tag'),
    ibadahToggleBtn: $('vm-ibadah-toggle-btn'),
    simPrayerIdleBtn: $('vm-sim-prayer-idle-btn'),
    simPrayerBannerBtn: $('vm-sim-prayer-banner-btn'),

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

    // Prayer expression (✦ ☾ — Star left eye + Crescent Moon right eye)
    if (expr === 'prayer') {
      svgEl.appendChild(
        createSvgNode('path', {
          d: 'M 8.5,1.8 Q 8.9,7.4 14.5,8 Q 8.9,8.6 8.5,14.2 Q 8.1,8.6 2.5,8 Q 8.1,7.4 8.5,1.8 Z',
          fill: '#ffffff',
        })
      );
      svgEl.appendChild(
        createSvgNode('path', {
          d: 'M 27.2,2.7 C 21.0,2.9 20.6,13.1 27.2,13.3 C 24.0,11.8 24.0,4.2 27.2,2.7 Z',
          fill: '#ffffff',
        })
      );
      return;
    }

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

  const SKY_HOUR_STOPS = [
    [0.0, [148, 163, 184]],
    [4.5, [148, 163, 184]],
    [5.0, [203, 213, 225]],
    [5.25, [235, 224, 184]],
    [6.5, [253, 230, 138]],
    [7.0, [253, 230, 138]],
    [10.5, [254, 240, 138]],
    [11.0, [255, 251, 235]],
    [14.5, [255, 251, 235]],
    [15.0, [252, 211, 77]],
    [16.5, [252, 211, 77]],
    [17.0, [251, 146, 60]],
    [17.75, [251, 146, 60]],
    [18.0, [147, 197, 253]],
    [21.5, [203, 213, 225]],
    [24.0, [148, 163, 184]],
  ];

  function sampleSkyRgbByHour(hourFloat) {
    const h = ((hourFloat % 24) + 24) % 24;
    for (let i = 0; i < SKY_HOUR_STOPS.length - 1; i += 1) {
      const [h1, c1] = SKY_HOUR_STOPS[i];
      const [h2, c2] = SKY_HOUR_STOPS[i + 1];
      if (h >= h1 && h <= h2) {
        const f = Math.max(0, Math.min(1, (h - h1) / Math.max(0.0001, h2 - h1)));
        return [
          Math.round(c1[0] + (c2[0] - c1[0]) * f),
          Math.round(c1[1] + (c2[1] - c1[1]) * f),
          Math.round(c1[2] + (c2[2] - c1[2]) * f),
        ];
      }
    }
    return [147, 197, 253];
  }

  function rgbToHex(rgb) {
    return (
      '#' +
      rgb
        .map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0'))
        .join('')
    );
  }

  function evalCatmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return {
      x:
        0.5 *
        (2 * p1.x +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
      y:
        0.5 *
        (2 * p1.y +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
    };
  }

  function sampleSplinePoint(u) {
    const maxSeg = CURVE_CONTROL_POINTS.length - 1;
    const clamped = Math.max(0, Math.min(maxSeg, u));
    const segIdx = Math.min(maxSeg - 1, Math.floor(clamped));
    const localT = clamped - segIdx;
    const p0 = CURVE_CONTROL_POINTS[Math.max(0, segIdx - 1)];
    const p1 = CURVE_CONTROL_POINTS[segIdx];
    const p2 = CURVE_CONTROL_POINTS[Math.min(maxSeg, segIdx + 1)];
    const p3 = CURVE_CONTROL_POINTS[Math.min(maxSeg, segIdx + 2)];
    return evalCatmullRom(p0, p1, p2, p3, localT);
  }

  function buildPathFromRange(uStart, uEnd, steps = 40) {
    if (uEnd <= uStart) return '';
    const count = Math.max(2, steps);
    const parts = [];
    for (let i = 0; i <= count; i += 1) {
      const u = uStart + ((uEnd - uStart) * i) / count;
      const pt = sampleSplinePoint(u);
      parts.push(`${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`);
    }
    return parts.join(' ');
  }

  function computeDemoProgressU(simMinutes) {
    const t0 = DEMO_PRAYERS[0].minutes;
    const t4 = DEMO_PRAYERS[4].minutes;
    if (simMinutes <= t0) {
      const ratio = Math.max(0, Math.min(1, 1 - (t0 - simMinutes) / 240));
      return 0.15 + ratio * 0.85;
    }
    for (let i = 0; i < 4; i += 1) {
      const a = DEMO_PRAYERS[i].minutes;
      const b = DEMO_PRAYERS[i + 1].minutes;
      if (simMinutes >= a && simMinutes <= b) {
        const frac = Math.max(0, Math.min(1, (simMinutes - a) / Math.max(1, b - a)));
        return 1 + i + frac;
      }
    }
    const nightRatio = Math.max(0, Math.min(1, (simMinutes - t4) / 95));
    return 5 + nightRatio * 0.85;
  }

  function getActiveDemoPrayerIndex() {
    const idx = DEMO_PRAYERS.findIndex((p) => p.key === state.ibadahPreviewKey);
    return idx >= 0 ? idx : 1;
  }

  function computeDemoCountdownSeconds(activeIdx) {
    const active = DEMO_PRAYERS[activeIdx] || DEMO_PRAYERS[1];
    const nextIdx = (activeIdx + 1) % DEMO_PRAYERS.length;
    const next = DEMO_PRAYERS[nextIdx];
    const diffMin =
      nextIdx === 0
        ? 24 * 60 - active.previewMinutes + next.minutes
        : Math.max(1, next.minutes - active.previewMinutes);
    return diffMin * 60;
  }

  function selectIbadahPreviewPhase(prayerKey) {
    const idx = DEMO_PRAYERS.findIndex((p) => p.key === prayerKey);
    if (idx < 0) return;
    state.ibadahPreviewKey = DEMO_PRAYERS[idx].key;
    state.prayerCountdownSeconds = computeDemoCountdownSeconds(idx);
    syncCapsuleUI();
  }

  function syncIbadahShowcasePhase() {
    if (!el.expIbadah || !el.ibadahOrbGlyph) return;

    const activeIdx = getActiveDemoPrayerIndex();
    const activePrayer = DEMO_PRAYERS[activeIdx];
    const nextIdx = (activeIdx + 1) % DEMO_PRAYERS.length;
    const nextPrayer = DEMO_PRAYERS[nextIdx];

    // Pure simulated showcase clock (never dependent on visitor's browser local time)
    const simMinutes = activePrayer.previewMinutes;
    const hourFloat = simMinutes / 60;
    const phase =
      hourFloat < 5.0 || hourFloat >= 18.0
        ? 'moon'
        : hourFloat < 7.0
        ? 'sunrise'
        : hourFloat < 15.75
        ? 'sun'
        : 'sunset';

    const activeRgb = sampleSkyRgbByHour(hourFloat);
    const startRgb =
      phase === 'moon' ? [148, 163, 184] : sampleSkyRgbByHour(hourFloat - 2.0);
    const activeHex = rgbToHex(activeRgb);
    const startHex = rgbToHex(startRgb);
    const [r, g, b] = activeRgb;

    // 1. Sync sky CSS variables & preview pill / next heading / alert text
    el.expIbadah.style.setProperty('--vm-ibadah-sky', activeHex);
    el.expIbadah.style.setProperty('--vm-ibadah-sky-bg', `rgba(${r}, ${g}, ${b}, 0.08)`);
    el.expIbadah.style.setProperty('--vm-ibadah-sky-border', `rgba(${r}, ${g}, ${b}, 0.55)`);
    el.expIbadah.setAttribute('data-preview-prayer', activePrayer.key);

    if (el.ibadahNextHeading) el.ibadahNextHeading.textContent = nextPrayer.upper;
    if (el.ibadahPreviewPill) {
      el.ibadahPreviewPill.textContent = `Preview ${activePrayer.previewTimeLabel}`;
    }
    const alertLabel = `Adzan ${activePrayer.label}`;
    if (el.prayerAlertTitle) el.prayerAlertTitle.textContent = alertLabel;
    if (el.prayerAlertTime) el.prayerAlertTime.textContent = activePrayer.time;
    if (el.expandedPrayerLabel) el.expandedPrayerLabel.textContent = alertLabel;
    if (el.expandedPrayerTime) el.expandedPrayerTime.textContent = activePrayer.time;

    // 2. Recompute Catmull-Rom parabolic curve paths & celestial orb position
    const u = computeDemoProgressU(simMinutes);
    const orbPt = sampleSplinePoint(u);
    const cometStartU = Math.max(0, u - 0.95);
    const cometStartPt = sampleSplinePoint(cometStartU);
    const startPt = CURVE_CONTROL_POINTS[0];
    const maxU = CURVE_CONTROL_POINTS.length - 1;

    if (el.ibadahPassedPath) {
      el.ibadahPassedPath.setAttribute('d', buildPathFromRange(0, u, 36));
    }
    if (el.ibadahRemainingPath) {
      el.ibadahRemainingPath.setAttribute('d', buildPathFromRange(u, maxU, 36));
    }
    if (el.ibadahCometPath) {
      el.ibadahCometPath.setAttribute('d', buildPathFromRange(cometStartU, u, 18));
    }
    if (el.ibadahPassedGrad) {
      el.ibadahPassedGrad.setAttribute('x1', startPt.x.toFixed(1));
      el.ibadahPassedGrad.setAttribute('y1', startPt.y.toFixed(1));
      el.ibadahPassedGrad.setAttribute('x2', orbPt.x.toFixed(1));
      el.ibadahPassedGrad.setAttribute('y2', orbPt.y.toFixed(1));
    }
    if (el.ibadahCometGrad) {
      el.ibadahCometGrad.setAttribute('x1', cometStartPt.x.toFixed(1));
      el.ibadahCometGrad.setAttribute('y1', cometStartPt.y.toFixed(1));
      el.ibadahCometGrad.setAttribute('x2', orbPt.x.toFixed(1));
      el.ibadahCometGrad.setAttribute('y2', orbPt.y.toFixed(1));
    }

    if (el.passedGradStart) el.passedGradStart.setAttribute('stop-color', startHex);
    if (el.passedGradEnd) el.passedGradEnd.setAttribute('stop-color', activeHex);
    if (el.cometGradStart) el.cometGradStart.setAttribute('stop-color', startHex);
    if (el.cometGradMid) el.cometGradMid.setAttribute('stop-color', activeHex);
    if (el.cometGradEnd) el.cometGradEnd.setAttribute('stop-color', activeHex);

    if (el.ibadahOrbGlow) {
      el.ibadahOrbGlow.setAttribute('cx', orbPt.x.toFixed(1));
      el.ibadahOrbGlow.setAttribute('cy', orbPt.y.toFixed(1));
      el.ibadahOrbGlow.setAttribute('fill', `rgba(${r}, ${g}, ${b}, 0.36)`);
    }
    if (el.ibadahOrbBacking) {
      el.ibadahOrbBacking.setAttribute('cx', orbPt.x.toFixed(1));
      el.ibadahOrbBacking.setAttribute('cy', orbPt.y.toFixed(1));
    }
    if (el.ibadahOrbGlyph) {
      el.ibadahOrbGlyph.setAttribute(
        'transform',
        `translate(${(orbPt.x - 6.5).toFixed(1)}, ${(orbPt.y - 6.5).toFixed(1)})`
      );
    }
    if (el.ibadahCelestialOrb) {
      el.ibadahCelestialOrb.setAttribute('data-celestial-phase', phase);
      el.ibadahCelestialOrb.setAttribute('data-orb-x', orbPt.x.toFixed(1));
    }

    // 3. Keep 5 prayer anchor dots neutral monochrome (#E4E4E7 / #FFFFFF / #000000) & move next halo
    if (el.ibadahNextHalo) {
      el.ibadahNextHalo.setAttribute('cx', String(nextPrayer.anchor.x));
      el.ibadahNextHalo.setAttribute('cy', String(nextPrayer.anchor.y));
    }
    el.ibadahPrayerDots.forEach((dotEl, idx) => {
      const isNext = idx === nextIdx;
      const isPassed = !isNext && (nextIdx === 0 || idx < nextIdx);
      if (isNext) {
        dotEl.setAttribute('r', '3');
        dotEl.setAttribute('fill', '#FFFFFF');
        dotEl.setAttribute('fill-opacity', '1');
        dotEl.setAttribute('stroke', '#FFFFFF');
        dotEl.setAttribute('stroke-width', '1.2');
      } else if (isPassed) {
        dotEl.setAttribute('r', '2.2');
        dotEl.setAttribute('fill', '#E4E4E7');
        dotEl.setAttribute('fill-opacity', '0.65');
        dotEl.setAttribute('stroke', '#E4E4E7');
        dotEl.setAttribute('stroke-width', '1.1');
      } else {
        dotEl.setAttribute('r', '2.1');
        dotEl.setAttribute('fill', '#000000');
        dotEl.setAttribute('fill-opacity', '1');
        dotEl.setAttribute('stroke', 'rgba(255,255,255,0.34)');
        dotEl.setAttribute('stroke-width', '1.1');
      }
    });

    // 4. Sync 5 clickable prayer cards (active preview marker + single NEXT tag)
    el.ibadahPrayerButtons.forEach((btn, idx) => {
      const item = DEMO_PRAYERS[idx];
      if (!item) return;
      const isPreview = item.key === activePrayer.key;
      const isNext = idx === nextIdx;
      const isPassed = !isNext && (nextIdx === 0 || idx < nextIdx);

      btn.classList.toggle('passed', isPassed);
      btn.classList.toggle('next', isNext);
      btn.setAttribute('data-preview-active', isPreview ? 'true' : 'false');
      btn.setAttribute('aria-pressed', isPreview ? 'true' : 'false');

      let tag = btn.querySelector('.casa-ibadah-next-tag');
      if (isNext) {
        if (!tag) {
          tag = document.createElement('span');
          tag.className = 'casa-ibadah-next-tag';
          tag.textContent = 'NEXT';
          btn.appendChild(tag);
        }
      } else if (tag) {
        tag.remove();
      }
    });

    // 5. Render 13x13 celestial glyph matching simulated phase
    clearNode(el.ibadahOrbGlyph);
    if (phase === 'sunrise') {
      el.ibadahOrbGlyph.appendChild(
        createSvgNode('line', { x1: 1.5, y1: 9.6, x2: 11.5, y2: 9.6, stroke: activeHex, 'stroke-width': 1.15, 'stroke-linecap': 'round' })
      );
      el.ibadahOrbGlyph.appendChild(
        createSvgNode('path', { d: 'M 3.3,9.6 A 3.2,3.2 0 0 1 9.7,9.6 Z', fill: activeHex })
      );
      [
        [6.5, 2.2, 6.5, 3.8],
        [3.1, 3.8, 4.1, 4.9],
        [9.9, 3.8, 8.9, 4.9],
      ].forEach(([x1, y1, x2, y2]) => {
        el.ibadahOrbGlyph.appendChild(
          createSvgNode('line', { x1, y1, x2, y2, stroke: activeHex, 'stroke-width': 1.1, 'stroke-linecap': 'round' })
        );
      });
    } else if (phase === 'sun') {
      el.ibadahOrbGlyph.appendChild(createSvgNode('circle', { cx: 6.5, cy: 6.5, r: 2.7, fill: activeHex }));
      [
        [6.5, 1.5], [10.0, 3.0], [11.5, 6.5], [10.0, 10.0],
        [6.5, 11.5], [3.0, 10.0], [1.5, 6.5], [3.0, 3.0],
      ].forEach(([cx, cy]) => {
        el.ibadahOrbGlyph.appendChild(createSvgNode('circle', { cx, cy, r: 0.72, fill: activeHex }));
      });
    } else if (phase === 'sunset') {
      el.ibadahOrbGlyph.appendChild(
        createSvgNode('path', { d: 'M 3.2,9.2 A 3.3,3.3 0 0 1 9.8,9.2 Z', fill: activeHex })
      );
      el.ibadahOrbGlyph.appendChild(
        createSvgNode('line', { x1: 1.5, y1: 9.2, x2: 11.5, y2: 9.2, stroke: activeHex, 'stroke-width': 1.15, 'stroke-linecap': 'round' })
      );
      el.ibadahOrbGlyph.appendChild(
        createSvgNode('line', { x1: 3.8, y1: 11.2, x2: 9.2, y2: 11.2, stroke: activeHex, 'stroke-width': 1.05, 'stroke-linecap': 'round', 'stroke-opacity': 0.55 })
      );
    } else {
      el.ibadahOrbGlyph.appendChild(
        createSvgNode('path', { d: 'M 8.5,2.0 C 3.3,2.3 2.9,10.7 8.5,11.0 C 5.7,9.6 5.7,3.4 8.5,2.0 Z', fill: activeHex })
      );
      el.ibadahOrbGlyph.appendChild(createSvgNode('circle', { cx: 10.2, cy: 3.6, r: 0.95, fill: activeHex }));
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
    state.expandedTab = 'control';
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
      state.expandedTab = 'dropzone';
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
    state.expandedTab = 'dropzone';
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
    if (state.prayerAlertActive) return 'prayer';
    if (state.mode === 'lyrics') return 'music';
    if (state.mode === 'todo') return state.dualIdleActive ? 'dual_active' : 'focus';
    return 'idle';
  }

  function resolveMode6Variant() {
    if (state.expandedTab === 'ibadah') {
      return state.ibadahEnabled ? 'ibadah' : 'control';
    }
    if (
      state.expandedTab === 'music' ||
      state.expandedTab === 'todo' ||
      state.expandedTab === 'control' ||
      state.expandedTab === 'dropzone'
    ) {
      return state.expandedTab;
    }
    if (state.mode === 'lyrics') return 'music';
    if (state.mode === 'todo') return 'todo';
    if (state.mode === 'ibadah' && state.ibadahEnabled) return 'ibadah';
    if (state.mode === 'hud' || state.mode === 'resting' || state.mode === 'ibadah') return 'control';
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
    renderCompanionAvatar(el.prayerEyes, 'prayer');
    renderCompanionAvatar(el.expandedPrayerEyes, 'prayer');

    if (el.monitor) {
      el.monitor.setAttribute('data-capsule-open', isExpanded ? 'true' : 'false');
    }

    const showExpandedPrayerBanner = isExpanded && state.prayerAlertActive;

    if (el.capsule) {
      el.capsule.setAttribute('data-state', isExpanded ? 'expanded' : 'idle');
      el.capsule.setAttribute('data-variant', variant);
      el.capsule.setAttribute('data-five-tabs', state.ibadahEnabled ? 'true' : 'false');
      el.capsule.setAttribute(
        'data-has-prayer-banner',
        showExpandedPrayerBanner ? 'true' : 'false'
      );
    }

    if (el.m6IbadahTab) {
      el.m6IbadahTab.hidden = !state.ibadahEnabled;
    }
    if (el.expandedPrayerBanner) {
      el.expandedPrayerBanner.hidden = !showExpandedPrayerBanner;
    }

    if (el.idleLayer) el.idleLayer.hidden = isExpanded;
    if (el.expandedLayer) el.expandedLayer.hidden = !isExpanded;

    // Perimeter Open U-Shape Focus Timer Stroke (when To-Do & Focus active in Idle)
    const showPerimeter = !isExpanded && !state.prayerAlertActive && state.mode === 'todo';
    if (el.perimeterSvg) {
      el.perimeterSvg.hidden = !showPerimeter;
    }
    if (el.perimeterPath) {
      const done = state.todos.filter((t) => t.done).length;
      const pct = Math.round((done / Math.max(1, state.todos.length)) * 100);
      el.perimeterPath.style.strokeDashoffset = String(Math.max(5, 100 - pct));
    }

    // Idle Layers (Priority Prayer T-0 Pill > Compact × ♥ > HUD > Wide Feature Idle Bar)
    const showPrayerPill = !isExpanded && state.prayerAlertActive;
    const showCompactEyesOnly =
      !isExpanded &&
      !showPrayerPill &&
      !state.hudKind &&
      (state.mode === 'resting' || state.mode === 'ibadah');
    const showHud = !isExpanded && !showPrayerPill && Boolean(state.hudKind);
    const showActivePill = !isExpanded && !showPrayerPill && !showCompactEyesOnly && !showHud;

    if (el.prayerPill) el.prayerPill.hidden = !showPrayerPill;
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
        (tab === 'music' && variant === 'music') ||
        (tab === 'todo' && variant === 'todo') ||
        (tab === 'hud' && variant === 'control') ||
        (tab === 'ibadah' && variant === 'ibadah') ||
        (tab === 'dropzone' && variant === 'dropzone');
      btn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
    });

    // Expanded Mode 6 Body Subviews
    if (el.expMusic) el.expMusic.hidden = variant !== 'music';
    if (el.expFocus) el.expFocus.hidden = variant !== 'todo';
    if (el.expControl) el.expControl.hidden = variant !== 'control';
    if (el.expDropzone) el.expDropzone.hidden = variant !== 'dropzone';
    if (el.expIbadah) el.expIbadah.hidden = variant !== 'ibadah';

    if (el.ibadahCountdown) {
      const sec = Math.max(0, state.prayerCountdownSeconds);
      const hh = String(Math.floor(sec / 3600)).padStart(2, '0');
      const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
      const ss = String(sec % 60).padStart(2, '0');
      el.ibadahCountdown.textContent = `-${hh}:${mm}:${ss}`;
    }
    syncIbadahShowcasePhase();

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
    if (el.sceneIbadah) el.sceneIbadah.hidden = state.mode !== 'ibadah';

    if (el.ibadahStatusTag) {
      el.ibadahStatusTag.textContent = state.ibadahEnabled
        ? 'Tab Ibadah Aktif (5 Tab)'
        : 'Tab Ibadah Nonaktif (4 Tab)';
    }

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
      state.expandedTab = 'control';
      state.capsuleState = 'idle';
    } else if (nextMode === 'lyrics') {
      state.expandedTab = 'music';
      state.capsuleState = 'expanded';
      state.musicSubTab = 'player';
    } else if (nextMode === 'todo') {
      state.expandedTab = 'todo';
      state.capsuleState = 'expanded';
    } else if (nextMode === 'hud') {
      state.expandedTab = 'control';
      state.capsuleState = 'idle';
      showHudChip('volume', 'Volume', `${state.volume}%`, true);
    } else if (nextMode === 'dropzone') {
      state.expandedTab = 'dropzone';
      state.capsuleState = 'expanded';
    } else if (nextMode === 'ibadah') {
      state.ibadahEnabled = true;
      state.expandedTab = 'ibadah';
      state.prayerAlertActive = false;
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
        state.capsuleState = 'expanded';
        state.isRestingSleep = false;
        state.hudKind = '';
        if (tab === 'music') {
          state.expandedTab = 'music';
          if (state.mode !== 'ibadah') state.mode = 'lyrics';
        } else if (tab === 'todo') {
          state.expandedTab = 'todo';
          if (state.mode !== 'ibadah') state.mode = 'todo';
        } else if (tab === 'hud') {
          state.expandedTab = 'control';
          if (state.mode !== 'ibadah') state.mode = 'hud';
        } else if (tab === 'dropzone') {
          state.expandedTab = 'dropzone';
          if (state.mode !== 'ibadah') state.mode = 'dropzone';
        } else if (tab === 'ibadah') {
          state.ibadahEnabled = true;
          state.expandedTab = 'ibadah';
          if (state.mode !== 'ibadah') state.mode = 'ibadah';
        }
        syncUI();
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
        // hoverExpandLocked parity during Pengingat Ibadah T-0 idle pill
        if (state.capsuleState === 'idle' && state.prayerAlertActive) return;
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

    // Pengingat Ibadah (v2.1.0 Opt-In + Interactive 5-Prayer Preview + T-0 Simulation)
    if (el.ibadahToggleBtn) {
      el.ibadahToggleBtn.addEventListener('click', () => {
        state.ibadahEnabled = !state.ibadahEnabled;
        if (!state.ibadahEnabled) {
          state.prayerAlertActive = false;
          if (state.expandedTab === 'ibadah') {
            state.expandedTab = 'control';
          }
        } else if (state.mode === 'ibadah') {
          state.expandedTab = 'ibadah';
        }
        syncUI();
      });
    }

    el.ibadahPrayerButtons.forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const key = btn.getAttribute('data-prayer-preview');
        if (key) selectIbadahPreviewPhase(key);
      });
    });

    if (el.simPrayerIdleBtn) {
      el.simPrayerIdleBtn.addEventListener('click', () => {
        state.ibadahEnabled = true;
        state.prayerAlertActive = true;
        state.capsuleState = 'idle';
        state.isRestingSleep = false;
        state.hudKind = '';
        syncUI();
      });
    }

    if (el.simPrayerBannerBtn) {
      el.simPrayerBannerBtn.addEventListener('click', () => {
        state.ibadahEnabled = true;
        state.prayerAlertActive = true;
        state.capsuleState = 'expanded';
        state.isRestingSleep = false;
        state.hudKind = '';
        syncUI();
      });
    }

    const stopDemoPrayerAlert = (ev) => {
      if (ev) ev.stopPropagation();
      state.prayerAlertActive = false;
      syncUI();
    };

    if (el.prayerStopBtn) {
      el.prayerStopBtn.addEventListener('click', stopDemoPrayerAlert);
    }
    if (el.expandedPrayerStopBtn) {
      el.expandedPrayerStopBtn.addEventListener('click', stopDemoPrayerAlert);
    }
    if (el.ibadahRefreshBtn) {
      el.ibadahRefreshBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        el.ibadahRefreshBtn.classList.remove('spinning');
        void el.ibadahRefreshBtn.offsetWidth;
        el.ibadahRefreshBtn.classList.add('spinning');
      });
    }

    // Lyrics & Music Controls + Idle Lyric Minimize
    const triggerIdleLyricMinimize = (ev) => {
      if (ev) ev.stopPropagation();
      state.mode = 'lyrics';
      state.expandedTab = 'music';
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
      } else if (state.capsuleState === 'expanded' && resolveMode6Variant() === 'ibadah') {
        if (state.prayerCountdownSeconds > 0) {
          state.prayerCountdownSeconds -= 1;
          if (el.ibadahCountdown) {
            const sec = state.prayerCountdownSeconds;
            const hh = String(Math.floor(sec / 3600)).padStart(2, '0');
            const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
            const ss = String(sec % 60).padStart(2, '0');
            el.ibadahCountdown.textContent = `-${hh}:${mm}:${ss}`;
          }
        }
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
          : 'v2.1.1';
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
        exeVersion = typeof v2Release.tag_name === 'string' ? v2Release.tag_name : 'v2.1.1';
        const exeAsset = v2Release.assets.find(
          (a) => typeof a.name === 'string' && a.name.toLowerCase().endsWith('.exe')
        );
        if (exeAsset && isSafeGitHubUrl(exeAsset.browser_download_url)) {
          exeUrl = exeAsset.browser_download_url;
          exeSize = formatMegabytes(exeAsset.size) || '6.42 MB';
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
      // Keep static v2.1.1 fallback link & hide download count gracefully when offline/rate-limited
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

  function formatReviewCalendarDate(d) {
    return d.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  function formatReviewFullTimestamp(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      if (Number.isNaN(d.getTime())) return '';
      const datePart = formatReviewCalendarDate(d);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${datePart}, ${hh}:${mm}`;
    } catch (_err) {
      return '';
    }
  }

  function formatReviewDate(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      if (Number.isNaN(d.getTime())) return '';
      const diffSeconds = Math.floor(Math.max(0, Date.now() - d.getTime()) / 1000);
      if (diffSeconds < 60) {
        return 'Baru saja';
      }
      if (diffSeconds < 3600) {
        const mins = Math.floor(diffSeconds / 60);
        return `${mins} menit lalu`;
      }
      if (diffSeconds < 86400) {
        const hours = Math.floor(diffSeconds / 3600);
        return `${hours} jam lalu`;
      }
      const days = Math.floor(diffSeconds / 86400);
      if (days === 1) {
        return 'Kemarin';
      }
      if (days < 7) {
        return `${days} hari lalu`;
      }
      return formatReviewCalendarDate(d);
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

      const starsWrap = document.createElement('span');
      starsWrap.className = 'reviews-stars-row';
      starsWrap.setAttribute('aria-label', `${item.rating || 5} dari 5 bintang`);
      renderMonochromeStars(starsWrap, item.rating || 5, 12);

      authorGroup.appendChild(authorEl);
      authorGroup.appendChild(starsWrap);

      const dateEl = document.createElement('time');
      dateEl.className = 'review-date';
      if (item.created_at) {
        dateEl.setAttribute('datetime', item.created_at);
        const fullCreatedTip = formatReviewFullTimestamp(item.created_at);
        if (fullCreatedTip) dateEl.setAttribute('title', fullCreatedTip);
      }
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
        if (item.replied_at) {
          replyDate.setAttribute('datetime', item.replied_at);
          const fullReplyTip = formatReviewFullTimestamp(item.replied_at);
          if (fullReplyTip) replyDate.setAttribute('title', fullReplyTip);
        }
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
        'select=id,author_name,rating,comment,creator_reply,replied_at,created_at',
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
