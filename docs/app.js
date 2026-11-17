/**
 * CASA — Dynamic Rabbit Island for Windows · 1:1 Native Island Parity Showcase
 * Zero external dependencies, CSP-strict (no eval, no inline HTML injection, URL allowlists).
 */

(() => {
  'use strict';

  const REPO_OWNER = 'Farhanpratama09';
  const REPO_NAME = 'casa-app';
  const RELEASES_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases`;
  const RELEASES_PAGE_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;
  const NEW_ISSUE_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/new`;
  const FEEDBACK_ENDPOINT = '';
  const ALLOWED_FEEDBACK_HOSTS = ['api.web3forms.com', 'formspree.io'];

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
    musicSubTab: 'player', // 'player' | 'queue'
    musicPlaying: true,
    trackIndex: 0,
    lyricIndex: 0,
    todos: INITIAL_TODOS.map((t) => ({ ...t })),
    focusTimerRunning: true,
    focusTotalMinutes: 25,
    focusSeconds: 18 * 60 + 45,
    dualIdleActive: false,
    volume: 68,
    audioOutputLabel: 'Speakers',
    hudKind: '', // '' | 'volume' | 'bluetooth' | 'wired'
    hudLabel: '',
    hudDetail: '',
    hudTimerId: null,
    droppedIds: [],
    introTimers: [],
    lyricIntervalId: null,
    clockIntervalId: null,
    focusTickId: null,
    pointerDrag: null,
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    monitor: $('virtual-monitor'),
    monitorScreen: $('monitor-screen'),
    introOverlay: $('intro-overlay'),
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
    musicSubQueue: $('vm-music-sub-queue'),
    expAudioLabel: $('vm-exp-audio-label'),
    expTrackTitle: $('vm-exp-track-title'),
    expTrackArtist: $('vm-exp-track-artist'),
    expLyricsToggle: $('vm-exp-lyrics-toggle'),
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
    ccVolFill: $('vm-cc-vol-fill'),
    ccVolVal: $('vm-cc-vol-val'),

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
    volumeSlider: $('vm-volume-slider'),
    volumePct: $('vm-volume-pct'),
    simBtBtn: $('vm-sim-bt-btn'),
    simWiredBtn: $('vm-sim-wired-btn'),
    desktopFiles: $('vm-desktop-files'),
    simDropAllBtn: $('vm-sim-drop-all-btn'),

    modeButtons: Array.from(document.querySelectorAll('[data-vm-mode]')),
    replayIntroBtn: $('replay-intro-btn'),

    // Download + Feedback
    primaryDownloadBtn: $('primary-download-btn'),
    downloadSizeNote: $('download-size-note'),
    copyShaBtn: $('copy-sha-btn'),
    shaValueExe: $('sha-value-exe'),
    feedbackForm: $('feedback-form'),
    fbName: $('fb-name'),
    fbCategory: $('fb-category'),
    fbMessage: $('fb-message'),
    fbStatus: $('fb-status'),
    fbFallbackContainer: $('fb-fallback-container'),
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
    state.isRestingSleep = true;
    state.idleLyricMinimized = false;
    state.hudKind = '';

    el.introOverlay.hidden = false;
    el.monitor.setAttribute('data-intro-phase', 'hi');
    syncUI();

    const t1 = window.setTimeout(() => {
      el.monitor.setAttribute('data-intro-phase', 'morph');
    }, 1500);

    const t2 = window.setTimeout(() => {
      el.monitor.setAttribute('data-intro-phase', 'resting');
      el.introOverlay.hidden = true;
      state.isRestingSleep = true;
      syncCapsuleUI();
    }, 2180);

    const t3 = window.setTimeout(() => {
      el.monitor.setAttribute('data-intro-phase', 'ready');
      state.isRestingSleep = false;
      state.expression = 'idle';
      syncCapsuleUI();
      syncDesktopScenes();
    }, 2750);

    state.introTimers.push(t1, t2, t3);
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

    // Desktop Queue List & Embedded Mode 6 Queue List
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

    // Idle Layers (RestingPill vs HUD vs Standby/Music/Timer Pill)
    const showRestingOnly =
      !isExpanded &&
      !state.hudKind &&
      state.mode === 'resting' &&
      state.isRestingSleep;
    const showHud = !isExpanded && Boolean(state.hudKind);
    const showActivePill = !isExpanded && !showRestingOnly && !showHud;

    if (el.restingPill) el.restingPill.hidden = !showRestingOnly;
    if (el.hudPill) el.hudPill.hidden = !showHud;
    if (el.activePill) el.activePill.hidden = !showActivePill;

    if (showHud) {
      if (el.hudLabel) el.hudLabel.textContent = state.hudLabel;
      if (el.hudDetail) el.hudDetail.textContent = state.hudDetail;
      if (el.hudBarFill && state.hudKind === 'volume') {
        el.hudBarFill.style.width = `${state.volume}%`;
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
    if (el.musicSubQueue) el.musicSubQueue.hidden = state.musicSubTab !== 'queue';
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
    if (el.ccVolFill) el.ccVolFill.style.width = `${state.volume}%`;
    if (el.ccVolVal) el.ccVolVal.textContent = `${state.volume}%`;
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
        ? 'RestingPill (126×39px) terpejam di bezel atas — hover, klik, atau Alt + Space untuk bangun'
        : state.capsuleState === 'expanded'
        ? 'Mode 6 Expanded terbuka — klik ikon Chevron atas atau tekan Alt + Space untuk menutup'
        : 'Idle Standby (× ♥) aktif — klik kapsul di atas untuk memekarkan Mode 6';
    }
    if (el.hudReadout) {
      el.hudReadout.textContent = `Volume ${state.volume}% · ${state.audioOutputLabel}`;
    }
    if (el.volumePct) {
      el.volumePct.textContent = `${state.volume}%`;
    }
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
   * Clean URL Navigation Without Hash (`#`)
   */
  function initCleanNavigation() {
    if (window.location.hash) {
      const initialId = window.location.hash.replace(/^#/, '');
      const target = document.getElementById(initialId);
      if (target) {
        window.requestAnimationFrame(() => {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search
      );
    }

    const navLinks = Array.from(document.querySelectorAll('a[data-scroll-target], a[href^="#"]'));
    navLinks.forEach((link) => {
      link.addEventListener('click', (ev) => {
        const href = link.getAttribute('href') || '';
        const targetId = link.getAttribute('data-scroll-target') || href.replace(/^#/, '');
        if (!targetId) return;

        ev.preventDefault();
        if (targetId === 'top') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          const targetEl = document.getElementById(targetId);
          if (targetEl) {
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
        window.history.replaceState(
          null,
          '',
          window.location.pathname + window.location.search
        );
      });
    });
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

    // Volume & BT HUD Controls
    if (el.volumeSlider) {
      el.volumeSlider.addEventListener('input', () => {
        state.volume = Number(el.volumeSlider.value);
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

  async function initSmartReleaseHub() {
    try {
      const response = await fetch(RELEASES_API_URL, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!response.ok) return;
      const releases = await response.json();
      if (!Array.isArray(releases)) return;

      const v2Release = releases.find(
        (rel) => typeof rel.tag_name === 'string' && rel.tag_name.startsWith('v2.')
      );
      if (v2Release && Array.isArray(v2Release.assets)) {
        const exeAsset = v2Release.assets.find(
          (a) => typeof a.name === 'string' && a.name.toLowerCase().endsWith('.exe')
        );
        if (exeAsset && isSafeGitHubUrl(exeAsset.browser_download_url)) {
          const sizeLabel = formatMegabytes(exeAsset.size) || '4.44 MB';
          if (el.primaryDownloadBtn) {
            el.primaryDownloadBtn.href = exeAsset.browser_download_url;
          }
          if (el.downloadSizeNote) {
            el.downloadSizeNote.textContent = `NSIS Setup · ${sizeLabel}`;
          }
        }
      } else if (el.primaryDownloadBtn) {
        el.primaryDownloadBtn.href = RELEASES_PAGE_URL;
      }
    } catch (_err) {
      if (el.primaryDownloadBtn) el.primaryDownloadBtn.href = RELEASES_PAGE_URL;
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

  function isAllowedFeedbackEndpoint(urlStr) {
    if (!urlStr) return false;
    try {
      const parsed = new URL(urlStr);
      return (
        parsed.protocol === 'https:' &&
        ALLOWED_FEEDBACK_HOSTS.some(
          (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
        )
      );
    } catch (_err) {
      return false;
    }
  }

  function buildGitHubIssueUrl(name, category, message) {
    const cleanName = (name || 'Anonim').trim();
    const title = `[${category}] ${message.slice(0, 60)}${message.length > 60 ? '...' : ''}`;
    const body = [
      `**Kategori:** ${category}`,
      `**Pengirim:** ${cleanName}`,
      '',
      '**Detail Masukan / Masalah:**',
      message,
      '',
      '---',
      '_Dikirim melalui CASA Showcase Web_',
    ].join('\n');

    const params = new URLSearchParams({ title, body });
    return `${NEW_ISSUE_URL}?${params.toString()}`;
  }

  function initFeedbackForm() {
    if (!el.feedbackForm) return;

    el.feedbackForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      clearNode(el.fbFallbackContainer);

      const name = (el.fbName && el.fbName.value ? el.fbName.value : '').trim();
      const category = (el.fbCategory && el.fbCategory.value ? el.fbCategory.value : 'Bug Report').trim();
      const message = (el.fbMessage && el.fbMessage.value ? el.fbMessage.value : '').trim();

      if (message.length < 5) {
        if (el.fbStatus) {
          el.fbStatus.textContent = 'Tuliskan pesan minimal 5 karakter sebelum mengirim.';
        }
        if (el.fbMessage) el.fbMessage.focus();
        return;
      }

      if (isAllowedFeedbackEndpoint(FEEDBACK_ENDPOINT)) {
        if (el.fbStatus) el.fbStatus.textContent = 'Mengirim feedback...';
        try {
          const resp = await fetch(FEEDBACK_ENDPOINT, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              name: name || 'Anonim',
              category,
              message,
              source: 'casa-showcase',
            }),
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          if (el.fbStatus) {
            el.fbStatus.textContent = 'Terima kasih! Feedback kamu sudah terkirim.';
          }
          el.feedbackForm.reset();
          return;
        } catch (_err) {
          // Fall through cleanly to GitHub Issue fallback
        }
      }

      const issueUrl = buildGitHubIssueUrl(name, category, message);
      window.open(issueUrl, '_blank', 'noopener,noreferrer');

      if (el.fbStatus) {
        el.fbStatus.textContent = 'Membuka template GitHub Issue siap kirim di tab baru...';
      }

      if (el.fbFallbackContainer) {
        const directLink = document.createElement('a');
        directLink.href = issueUrl;
        directLink.target = '_blank';
        directLink.rel = 'noopener noreferrer';
        directLink.className = 'feedback-fallback-link';
        directLink.textContent = 'Klik di sini jika tab GitHub Issue belum terbuka ↗';
        el.fbFallbackContainer.appendChild(directLink);
      }
    });
  }

  // Boot
  initCleanNavigation();
  initVirtualMonitorControls();
  initCopyHash();
  initFeedbackForm();
  syncUI();
  void initSmartReleaseHub();
})();
