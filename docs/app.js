/**
 * CASA — Dynamic Rabbit Island for Windows · Showcase Interactive Runtime
 * Zero dependencies, CSP-strict (no eval, no inline HTML injection, URL allowlists).
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
  const RING_CIRCUMFERENCE = 47.12; // 2 * PI * 7.5

  const QUEUE_TRACKS = [
    {
      id: 'trk-midnight',
      title: 'Midnight Coding',
      artist: 'Lo-Fi Bunny · SMTC',
      duration: '03:12',
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
      duration: '02:48',
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
      duration: '03:27',
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
      duration: '02:55',
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
    { id: 'file-brief', name: 'brief-casa.pdf', kind: 'PDF · 420 KB' },
    { id: 'file-sasha', name: 'sasha-icon.svg', kind: 'SVG · 14 KB' },
    { id: 'file-mix', name: 'mix-playlist.url', kind: 'URL · Web' },
  ];

  const state = {
    mode: 'resting', // 'resting' | 'lyrics' | 'todo' | 'hud' | 'dropzone'
    capsuleState: 'idle', // 'resting' | 'idle' | 'expanded'
    expression: 'idle', // 'resting' | 'idle' | 'music' | 'focus' | 'dual_active'
    idleLyricMinimized: false,
    musicPlaying: true,
    trackIndex: 0,
    lyricIndex: 0,
    todos: INITIAL_TODOS.map((t) => ({ ...t })),
    focusTimerRunning: true,
    focusSeconds: 18 * 60 + 45,
    dualIdleActive: false,
    volume: 68,
    audioOutputLabel: 'Speakers',
    hudText: '',
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
    eyes: $('vm-notch-eyes'),
    title: $('vm-notch-title'),
    subtitle: $('vm-notch-subtitle'),
    miniLyricPill: $('vm-mini-lyric-pill'),
    hudChip: $('vm-hud-chip'),
    focusRingWrap: $('vm-focus-ring-wrap'),
    focusRingArc: $('vm-focus-ring-arc'),
    focusMiniPct: $('vm-focus-mini-pct'),
    batteryBadge: $('vm-battery-badge'),
    expandedPanel: $('vm-notch-expanded'),
    expModeTitle: $('vm-exp-mode-title'),
    expClock: $('vm-exp-clock'),
    collapseBtn: $('vm-notch-collapse-btn'),
    expControl: $('vm-exp-control'),
    expMusic: $('vm-exp-music'),
    expFocus: $('vm-exp-focus'),
    expDropzone: $('vm-exp-dropzone'),
    expRestBtn: $('vm-exp-rest-btn'),
    expTrackTitle: $('vm-exp-track-title'),
    expTrackArtist: $('vm-exp-track-artist'),
    expLyricLine: $('vm-exp-lyric-line'),
    idleLyricBtn: $('vm-idle-lyric-btn'),
    expPlayBtn: $('vm-exp-play-btn'),
    expFocusLabel: $('vm-exp-focus-label'),
    expFocusSub: $('vm-exp-focus-sub'),
    expTimerBtn: $('vm-exp-timer-btn'),
    dropzonePrompt: $('vm-dropzone-prompt'),
    droppedItems: $('vm-dropped-items'),
    dropzoneCount: $('vm-dropzone-count'),
    copyBackBtn: $('vm-copy-back-btn'),

    // Scenes
    sceneResting: $('scene-resting'),
    sceneLyrics: $('scene-lyrics'),
    sceneTodo: $('scene-todo'),
    sceneHud: $('scene-hud'),
    sceneDropzone: $('scene-dropzone'),

    // Scene controls
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

    // Bottom Dock & Replay
    modeButtons: Array.from(document.querySelectorAll('[data-vm-mode]')),
    replayIntroBtn: $('replay-intro-btn'),

    // Release Hub & Feedback
    primaryDownloadBtn: $('primary-download-btn'),
    msiDownloadBtn: $('msi-download-btn'),
    heroDownloadBtn: $('hero-download-btn'),
    releaseVersionBadge: $('release-version-badge'),
    releaseDateBadge: $('release-date-badge'),
    releaseStatusNote: $('release-status-note'),
    statExeSize: $('stat-exe-size'),
    statMsiSize: $('stat-msi-size'),
    statTotalDownloads: $('stat-total-downloads'),
    copyShaBtn: $('copy-sha-btn'),
    shaValueExe: $('sha-value-exe'),
    archiveList: $('archive-release-list'),
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

  function formatMMSS(sec) {
    const safe = Math.max(0, Math.floor(sec));
    const m = Math.floor(safe / 60);
    const s = safe % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  /**
   * Renders SVG eye geometry inside the virtual monitor Notch (strict monochrome #FFFFFF).
   */
  function renderNotchEyes(expr) {
    if (!el.eyes) return;
    clearNode(el.eyes);
    const heartPath =
      'M 25,13.5 L 24.3,12.8 C 21.1,10.0 19.6,8.3 19.6,6.1 C 19.6,4.4 20.9,3.1 22.5,3.1 C 23.6,3.1 24.5,3.7 25,4.6 C 25.5,3.7 26.4,3.1 27.5,3.1 C 29.1,3.1 30.4,4.4 30.4,6.1 C 30.4,8.3 28.9,10.0 25.7,12.8 Z';

    if (expr === 'resting') {
      el.eyes.appendChild(
        createSvgNode('path', {
          d: 'M 3.5,8.5 Q 8,12 12.5,8.5',
          fill: 'none',
          stroke: '#a1a1aa',
          'stroke-width': 2.0,
          'stroke-linecap': 'round',
        })
      );
      el.eyes.appendChild(
        createSvgNode('path', {
          d: 'M 20.5,8.5 Q 25,12 29.5,8.5',
          fill: 'none',
          stroke: '#a1a1aa',
          'stroke-width': 2.0,
          'stroke-linecap': 'round',
        })
      );
      return;
    }

    // Left eye by active expression
    if (expr === 'music') {
      el.eyes.appendChild(
        createSvgNode('path', {
          d: 'M 7.5,12 L 7.5,4 L 13,2.8',
          fill: 'none',
          stroke: '#ffffff',
          'stroke-width': 1.9,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        })
      );
      el.eyes.appendChild(
        createSvgNode('circle', { cx: 6.2, cy: 12.2, r: 2.2, fill: '#ffffff' })
      );
    } else if (expr === 'focus' || expr === 'dual_active') {
      el.eyes.appendChild(
        createSvgNode('path', {
          d: 'M 3.5,3.8 L 12.5,6.4',
          fill: 'none',
          stroke: '#ffffff',
          'stroke-width': 2.0,
          'stroke-linecap': 'round',
        })
      );
      el.eyes.appendChild(
        createSvgNode('circle', { cx: 8.5, cy: 10.6, r: 2.3, fill: '#ffffff' })
      );
    } else {
      // Idle ×
      el.eyes.appendChild(
        createSvgNode('path', {
          d: 'M 3.5,3.5 L 12.5,12.5 M 12.5,3.5 L 3.5,12.5',
          fill: 'none',
          stroke: '#ffffff',
          'stroke-width': 2.2,
          'stroke-linecap': 'round',
        })
      );
    }

    // Right eye
    if (expr === 'dual_active') {
      el.eyes.appendChild(
        createSvgNode('path', {
          d: 'M 25.5,12 L 25.5,4 L 30.8,2.8',
          fill: 'none',
          stroke: '#ffffff',
          'stroke-width': 1.9,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        })
      );
      el.eyes.appendChild(
        createSvgNode('circle', { cx: 24.2, cy: 12.2, r: 2.2, fill: '#ffffff' })
      );
    } else {
      el.eyes.appendChild(createSvgNode('path', { d: heartPath, fill: '#ffffff' }));
    }
  }

  function showHudChip(label) {
    if (state.hudTimerId) {
      window.clearTimeout(state.hudTimerId);
      state.hudTimerId = null;
    }
    state.hudText = label;
    syncCapsuleUI();
    state.hudTimerId = window.setTimeout(() => {
      state.hudText = '';
      state.hudTimerId = null;
      syncCapsuleUI();
    }, 2600);
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
    state.expression = 'resting';
    state.idleLyricMinimized = false;
    state.hudText = '';

    el.introOverlay.hidden = false;
    el.monitor.setAttribute('data-intro-phase', 'hi');
    syncUI();

    const t1 = window.setTimeout(() => {
      el.monitor.setAttribute('data-intro-phase', 'morph');
    }, 1500);

    const t2 = window.setTimeout(() => {
      el.monitor.setAttribute('data-intro-phase', 'resting');
      el.introOverlay.hidden = true;
      state.expression = 'resting';
      syncCapsuleUI();
    }, 2180);

    const t3 = window.setTimeout(() => {
      el.monitor.setAttribute('data-intro-phase', 'ready');
      state.expression = 'idle';
      syncCapsuleUI();
    }, 2700);

    state.introTimers.push(t1, t2, t3);
  }

  function getActiveTrack() {
    return QUEUE_TRACKS[state.trackIndex] || QUEUE_TRACKS[0];
  }

  function renderLyricsScene() {
    const track = getActiveTrack();
    if (el.lyricStage) {
      clearNode(el.lyricStage);
      track.lyrics.forEach((line, idx) => {
        const row = document.createElement('div');
        row.className = idx === state.lyricIndex ? 'vm-lyric-row active' : 'vm-lyric-row';
        row.textContent = line;
        el.lyricStage.appendChild(row);
      });
    }

    if (el.queueCountTag) {
      el.queueCountTag.textContent = `${QUEUE_TRACKS.length} lagu`;
    }

    if (el.queueList) {
      clearNode(el.queueList);
      QUEUE_TRACKS.forEach((item, idx) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vm-queue-btn';
        if (idx === state.trackIndex) {
          btn.setAttribute('aria-current', 'true');
        }
        btn.addEventListener('click', () => {
          state.trackIndex = idx;
          state.lyricIndex = 0;
          state.musicPlaying = true;
          syncUI();
        });

        const left = document.createElement('div');
        const tEl = document.createElement('div');
        tEl.className = 'vm-queue-title';
        tEl.textContent = item.title;
        const aEl = document.createElement('div');
        aEl.className = 'vm-queue-artist';
        aEl.textContent = item.artist;
        left.appendChild(tEl);
        left.appendChild(aEl);

        const right = document.createElement('span');
        right.className = 'vm-queue-artist tabular';
        right.textContent = item.duration;

        btn.appendChild(left);
        btn.appendChild(right);
        li.appendChild(btn);
        el.queueList.appendChild(li);
      });
    }
  }

  function renderTodoScene() {
    const doneCount = state.todos.filter((t) => t.done).length;
    const totalCount = Math.max(1, state.todos.length);
    const ratio = doneCount / totalCount;

    if (el.todoProgressText) {
      el.todoProgressText.textContent = `${doneCount} / ${state.todos.length} selesai`;
    }
    if (el.focusEyeBadge) {
      el.focusEyeBadge.textContent = state.dualIdleActive ? '•̀ ♪ Dual-Idle' : '•̀ ♥ Focus';
    }
    if (el.focusRingArc) {
      const offset = RING_CIRCUMFERENCE * (1 - ratio);
      el.focusRingArc.style.strokeDashoffset = String(offset.toFixed(2));
    }
    if (el.focusMiniPct) {
      el.focusMiniPct.textContent = `${doneCount}/${state.todos.length}`;
    }

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
  }

  function renderDropzoneScene() {
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
        meta.textContent = isDropped ? 'Tersimpan di Drop Zone' : file.kind;

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
              const nearTopLip = ev.clientY <= sRect.top + 110;
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
              state.pointerDrag.moved && sRect && ev.clientY <= sRect.top + 125;
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

    // Populate Drop Zone Shelf inside expanded Notch
    if (el.droppedItems) {
      clearNode(el.droppedItems);
      state.droppedIds.forEach((fid) => {
        const meta = SAMPLE_FILES.find((f) => f.id === fid);
        if (!meta) return;
        const chip = document.createElement('span');
        chip.className = 'vm-dropped-chip';
        chip.textContent = meta.name;
        el.droppedItems.appendChild(chip);
      });
    }

    if (el.dropzonePrompt) {
      el.dropzonePrompt.hidden = state.droppedIds.length > 0;
    }
    if (el.dropzoneCount) {
      el.dropzoneCount.textContent = `${state.droppedIds.length} file di rak`;
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
    showHudChip('Copied Back to Desktop');
  }

  function syncCapsuleUI() {
    const nowText = formatClockHHMM();
    const track = getActiveTrack();
    const activeLyric = track.lyrics[state.lyricIndex] || track.lyrics[0];

    let activeExpr = state.expression;
    if (state.mode === 'resting') {
      activeExpr = state.expression === 'resting' ? 'resting' : 'idle';
    } else if (state.mode === 'lyrics') {
      activeExpr = 'music';
    } else if (state.mode === 'todo') {
      activeExpr = state.dualIdleActive ? 'dual_active' : 'focus';
    } else if (state.mode === 'hud') {
      activeExpr = 'idle';
    } else if (state.mode === 'dropzone') {
      activeExpr = 'idle';
    }

    renderNotchEyes(activeExpr);

    const isExpanded = state.capsuleState === 'expanded';
    if (el.capsule) {
      el.capsule.setAttribute('data-state', isExpanded ? 'expanded' : 'idle');
      el.capsule.setAttribute('data-hud-active', state.hudText ? 'true' : 'false');
    }
    if (el.expandedPanel) {
      el.expandedPanel.hidden = !isExpanded;
    }

    // Pill row text & widgets
    if (state.mode === 'lyrics') {
      if (el.title) el.title.textContent = state.idleLyricMinimized ? track.title : nowText;
      if (el.subtitle) {
        el.subtitle.textContent = state.idleLyricMinimized ? '' : track.title;
      }
      if (el.miniLyricPill) {
        el.miniLyricPill.hidden = !state.idleLyricMinimized;
        if (state.idleLyricMinimized) {
          el.miniLyricPill.textContent = activeLyric;
        }
      }
    } else if (state.mode === 'todo') {
      if (el.title) el.title.textContent = formatMMSS(state.focusSeconds);
      if (el.subtitle) {
        el.subtitle.textContent = state.dualIdleActive ? 'Dual Focus' : 'Focus Active';
      }
      if (el.miniLyricPill) el.miniLyricPill.hidden = true;
    } else {
      if (el.title) el.title.textContent = nowText;
      if (el.subtitle) {
        el.subtitle.textContent =
          activeExpr === 'resting'
            ? 'Resting'
            : state.mode === 'dropzone'
            ? 'Drop Ready'
            : 'Awake';
      }
      if (el.miniLyricPill) el.miniLyricPill.hidden = true;
    }

    if (el.focusRingWrap) {
      el.focusRingWrap.hidden = state.mode !== 'todo';
    }
    if (el.hudChip) {
      if (state.hudText) {
        el.hudChip.hidden = false;
        el.hudChip.textContent = state.hudText;
      } else {
        el.hudChip.hidden = true;
        el.hudChip.textContent = '';
      }
    }
    if (el.batteryBadge) {
      el.batteryBadge.hidden = state.mode === 'lyrics' && state.idleLyricMinimized;
    }

    // Expanded panel active subview matching current monitor scenario
    if (el.expClock) el.expClock.textContent = nowText;
    if (el.expControl) el.expControl.hidden = state.mode !== 'resting' && state.mode !== 'hud';
    if (el.expMusic) el.expMusic.hidden = state.mode !== 'lyrics';
    if (el.expFocus) el.expFocus.hidden = state.mode !== 'todo';
    if (el.expDropzone) el.expDropzone.hidden = state.mode !== 'dropzone';

    if (el.expModeTitle) {
      el.expModeTitle.textContent =
        state.mode === 'lyrics'
          ? 'Music & Lyrics'
          : state.mode === 'todo'
          ? 'Focus & To-Do'
          : state.mode === 'dropzone'
          ? 'Drop Zone Shelf'
          : 'CASA Capsule';
    }
    if (el.expTrackTitle) el.expTrackTitle.textContent = track.title;
    if (el.expTrackArtist) el.expTrackArtist.textContent = track.artist;
    if (el.expLyricLine) el.expLyricLine.textContent = activeLyric;
    if (el.expPlayBtn) el.expPlayBtn.textContent = state.musicPlaying ? 'Pause' : 'Play';
    if (el.idleLyricBtn) {
      el.idleLyricBtn.textContent = state.idleLyricMinimized
        ? 'Expand Lyrics'
        : 'Idle Lyric Minimize';
    }
    if (el.sceneLyricMinimizeBtn) {
      el.sceneLyricMinimizeBtn.textContent = state.idleLyricMinimized
        ? 'Restore Capsule'
        : 'Idle Lyric Minimize';
    }

    const doneCount = state.todos.filter((t) => t.done).length;
    if (el.expFocusLabel) {
      el.expFocusLabel.textContent = `Sesi Fokus · ${formatMMSS(state.focusSeconds)}`;
    }
    if (el.expFocusSub) {
      el.expFocusSub.textContent = `${doneCount} / ${state.todos.length} To-Do selesai`;
    }
    if (el.expTimerBtn) {
      el.expTimerBtn.textContent = state.focusTimerRunning ? 'Jeda Timer' : 'Lanjut Focus';
    }
  }

  function syncUI() {
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
      el.clockStatus.textContent =
        state.expression === 'resting'
          ? 'Mode Resting — arahkan kursor ke kapsul atas atau tekan Alt + Space untuk membangunkan'
          : state.capsuleState === 'expanded'
          ? 'Kapsul Mekar — klik Tutup atau tekan Alt + Space untuk kembali ringkas'
          : 'Kapsul Aktif (× ♥) — klik kapsul di bezel atas untuk membuka kontrol penuh';
    }

    if (el.hudReadout) {
      el.hudReadout.textContent = `Volume ${state.volume}% · ${state.audioOutputLabel}`;
    }
    if (el.volumePct) {
      el.volumePct.textContent = `${state.volume}%`;
    }

    renderLyricsScene();
    renderTodoScene();
    renderDropzoneScene();
    syncCapsuleUI();
  }

  function switchMode(nextMode) {
    // Cancel opening animation cleanly if user interacts early
    clearIntroTimers();
    if (el.introOverlay) el.introOverlay.hidden = true;
    if (el.monitor) el.monitor.setAttribute('data-intro-phase', 'ready');

    state.mode = nextMode;
    if (nextMode === 'resting') {
      state.expression = 'idle';
      state.capsuleState = 'idle';
      state.idleLyricMinimized = false;
    } else if (nextMode === 'lyrics') {
      state.expression = 'music';
      state.capsuleState = 'idle';
      state.idleLyricMinimized = false;
    } else if (nextMode === 'todo') {
      state.expression = state.dualIdleActive ? 'dual_active' : 'focus';
      state.capsuleState = 'idle';
      state.idleLyricMinimized = false;
    } else if (nextMode === 'hud') {
      state.expression = 'idle';
      state.capsuleState = 'idle';
      showHudChip(`Vol ${state.volume}%`);
    } else if (nextMode === 'dropzone') {
      state.expression = 'idle';
      state.capsuleState = 'expanded';
    }
    syncUI();
  }

  function initVirtualMonitorControls() {
    // Mode dock switches
    el.modeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.getAttribute('data-vm-mode');
        if (next) switchMode(next);
      });
    });

    if (el.replayIntroBtn) {
      el.replayIntroBtn.addEventListener('click', startIntroMorphSequence);
    }

    // Capsule Hover & Click Wake
    if (el.capsule) {
      el.capsule.addEventListener('mouseenter', () => {
        if (state.mode === 'resting' && state.expression === 'resting') {
          state.expression = 'idle';
          syncUI();
        }
      });

      el.capsule.addEventListener('click', (ev) => {
        if (ev.target && ev.target.closest('button')) return;
        if (state.capsuleState === 'idle') {
          if (state.expression === 'resting') {
            state.expression = 'idle';
          }
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
        if (fid) {
          captureFileIntoDropZone(fid);
        }
      });
    }

    // Monitor screen HTML5 dragover zone near top bezel
    if (el.monitorScreen) {
      el.monitorScreen.addEventListener('dragover', (ev) => {
        if (state.mode !== 'dropzone') return;
        ev.preventDefault();
        const rect = el.monitorScreen.getBoundingClientRect();
        if (ev.clientY <= rect.top + 115) {
          openDropZoneTarget(true);
        }
      });

      el.monitorScreen.addEventListener('drop', (ev) => {
        if (state.mode !== 'dropzone') return;
        const rect = el.monitorScreen.getBoundingClientRect();
        if (ev.clientY <= rect.top + 130) {
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

    if (el.expRestBtn) {
      el.expRestBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        state.capsuleState = 'idle';
        state.expression = 'resting';
        syncUI();
      });
    }

    // Global Alt + Space inside monitor showcase
    window.addEventListener('keydown', (ev) => {
      if (ev.altKey && ev.code === 'Space') {
        ev.preventDefault();
        if (state.expression === 'resting') {
          state.expression = 'idle';
          state.capsuleState = 'expanded';
        } else {
          state.capsuleState = state.capsuleState === 'expanded' ? 'idle' : 'expanded';
        }
        syncUI();
      }
    });

    // Scene 1: Resting & Wake buttons
    if (el.sceneToggleRestBtn) {
      el.sceneToggleRestBtn.addEventListener('click', () => {
        state.expression = state.expression === 'resting' ? 'idle' : 'resting';
        if (state.expression === 'resting') state.capsuleState = 'idle';
        syncUI();
      });
    }

    if (el.sceneToggleExpandBtn) {
      el.sceneToggleExpandBtn.addEventListener('click', () => {
        state.expression = 'idle';
        state.capsuleState = state.capsuleState === 'expanded' ? 'idle' : 'expanded';
        syncUI();
      });
    }

    // Scene 2: Lyrics & Idle Lyric Minimize
    const toggleIdleLyricMinimize = (ev) => {
      if (ev) ev.stopPropagation();
      state.mode = 'lyrics';
      state.idleLyricMinimized = !state.idleLyricMinimized;
      state.capsuleState = 'idle';
      state.expression = 'music';
      syncUI();
    };

    if (el.sceneLyricMinimizeBtn) {
      el.sceneLyricMinimizeBtn.addEventListener('click', toggleIdleLyricMinimize);
    }
    if (el.idleLyricBtn) {
      el.idleLyricBtn.addEventListener('click', toggleIdleLyricMinimize);
    }
    if (el.expPlayBtn) {
      el.expPlayBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        state.musicPlaying = !state.musicPlaying;
        syncCapsuleUI();
      });
    }

    // Scene 3: To-Do & Focus
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

    // Scene 4: Volume & BT HUD
    if (el.volumeSlider) {
      el.volumeSlider.addEventListener('input', () => {
        state.volume = Number(el.volumeSlider.value);
        if (el.volumePct) el.volumePct.textContent = `${state.volume}%`;
        if (el.hudReadout) {
          el.hudReadout.textContent = `Volume ${state.volume}% · ${state.audioOutputLabel}`;
        }
        showHudChip(`Vol ${state.volume}%`);
      });
    }
    if (el.simBtBtn) {
      el.simBtBtn.addEventListener('click', () => {
        state.audioOutputLabel = 'BT Earphone • 85%';
        syncUI();
        showHudChip('BT Earphone · 85%');
      });
    }
    if (el.simWiredBtn) {
      el.simWiredBtn.addEventListener('click', () => {
        state.audioOutputLabel = 'Wired Earphone';
        syncUI();
        showHudChip('Wired Earphone');
      });
    }

    // Scene 5: Simulate Drop + Copy Back to Desktop
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

    // Auto intervals (lyrics ticker, clock refresh, focus countdown)
    state.lyricIntervalId = window.setInterval(() => {
      if (state.mode === 'lyrics' && state.musicPlaying) {
        const track = getActiveTrack();
        state.lyricIndex = (state.lyricIndex + 1) % track.lyrics.length;
        renderLyricsScene();
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
      if (state.capsuleState === 'idle' && state.mode === 'resting') {
        syncCapsuleUI();
      }
    }, 15000);

    // Trigger opening morph intro when virtual monitor enters viewport
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
   * Smart GitHub Release Hub (Strict URL validation, DOM safe rendering)
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

  function formatReleaseDate(isoStr) {
    if (!isoStr) return 'Latest Build';
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return 'Latest Build';
    return d.toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  function renderArchiveReleases(archiveReleases) {
    if (!el.archiveList) return;
    clearNode(el.archiveList);

    if (!archiveReleases || archiveReleases.length === 0) {
      const emptyLi = document.createElement('li');
      emptyLi.className = 'archive-item';

      const metaDiv = document.createElement('div');
      metaDiv.className = 'archive-item-meta';
      const strong = document.createElement('strong');
      strong.textContent = 'Riwayat Rilis GitHub';
      const sub = document.createElement('span');
      sub.className = 'archive-item-sub';
      sub.textContent = 'Lihat seluruh changelog & biner resmi di GitHub Releases.';
      metaDiv.appendChild(strong);
      metaDiv.appendChild(sub);

      const link = document.createElement('a');
      link.href = RELEASES_PAGE_URL;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'archive-link';
      link.textContent = 'GitHub Releases ↗';

      emptyLi.appendChild(metaDiv);
      emptyLi.appendChild(link);
      el.archiveList.appendChild(emptyLi);
      return;
    }

    archiveReleases.slice(0, 4).forEach((rel) => {
      const li = document.createElement('li');
      li.className = 'archive-item';

      const meta = document.createElement('div');
      meta.className = 'archive-item-meta';

      const title = document.createElement('strong');
      title.textContent = rel.tag_name || rel.name || 'Release';

      const relDownloads = Array.isArray(rel.assets)
        ? rel.assets.reduce((sum, a) => sum + (Number(a.download_count) || 0), 0)
        : 0;

      const sub = document.createElement('span');
      sub.className = 'archive-item-sub';
      sub.textContent = `${formatReleaseDate(rel.published_at)} · ${relDownloads.toLocaleString('id-ID')} unduhan`;

      meta.appendChild(title);
      meta.appendChild(sub);

      const link = document.createElement('a');
      link.href = isSafeGitHubUrl(rel.html_url) ? rel.html_url : RELEASES_PAGE_URL;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'archive-link';
      link.textContent = 'Unduh ↗';

      li.appendChild(meta);
      li.appendChild(link);
      el.archiveList.appendChild(li);
    });
  }

  async function initSmartReleaseHub() {
    try {
      const response = await fetch(RELEASES_API_URL, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!response.ok) throw new Error(`GitHub API ${response.status}`);

      const releases = await response.json();
      if (!Array.isArray(releases)) throw new Error('Invalid GitHub API shape');

      let totalDownloads = 0;
      releases.forEach((rel) => {
        if (Array.isArray(rel.assets)) {
          rel.assets.forEach((asset) => {
            totalDownloads += Number(asset.download_count) || 0;
          });
        }
      });

      if (el.statTotalDownloads) {
        el.statTotalDownloads.textContent = totalDownloads.toLocaleString('id-ID');
      }

      const v2Release = releases.find(
        (rel) => typeof rel.tag_name === 'string' && rel.tag_name.startsWith('v2.')
      );
      const latestRelease = v2Release || releases[0];

      if (v2Release && Array.isArray(v2Release.assets) && v2Release.assets.length > 0) {
        const exeAsset = v2Release.assets.find(
          (a) => typeof a.name === 'string' && a.name.toLowerCase().endsWith('.exe')
        );
        const msiAsset = v2Release.assets.find(
          (a) => typeof a.name === 'string' && a.name.toLowerCase().endsWith('.msi')
        );

        if (exeAsset && isSafeGitHubUrl(exeAsset.browser_download_url)) {
          const sizeLabel = formatMegabytes(exeAsset.size) || '4.44 MB';
          if (el.statExeSize) el.statExeSize.textContent = sizeLabel;
          if (el.primaryDownloadBtn) {
            el.primaryDownloadBtn.href = exeAsset.browser_download_url;
            el.primaryDownloadBtn.textContent = `Download CASA ${v2Release.tag_name} for Windows (.exe · ${sizeLabel})`;
          }
          if (el.heroDownloadBtn) {
            el.heroDownloadBtn.href = exeAsset.browser_download_url;
          }
        }

        if (msiAsset && isSafeGitHubUrl(msiAsset.browser_download_url)) {
          const msiSizeLabel = formatMegabytes(msiAsset.size) || '6.42 MB';
          if (el.statMsiSize) el.statMsiSize.textContent = msiSizeLabel;
          if (el.msiDownloadBtn) {
            el.msiDownloadBtn.href = msiAsset.browser_download_url;
            el.msiDownloadBtn.textContent = `Unduh .msi (${msiSizeLabel})`;
          }
        }

        if (el.releaseVersionBadge) {
          el.releaseVersionBadge.textContent = `${v2Release.tag_name} Latest`;
        }
        if (el.releaseDateBadge) {
          el.releaseDateBadge.textContent = formatReleaseDate(v2Release.published_at);
        }
        if (el.releaseStatusNote) {
          el.releaseStatusNote.textContent = `Terhubung langsung ke GitHub Release ${v2Release.tag_name} resmi.`;
        }
      } else {
        if (el.primaryDownloadBtn) el.primaryDownloadBtn.href = RELEASES_PAGE_URL;
        if (el.msiDownloadBtn) el.msiDownloadBtn.href = RELEASES_PAGE_URL;
        if (el.releaseStatusNote) {
          const latestTag = latestRelease && latestRelease.tag_name ? latestRelease.tag_name : 'v2.0.0';
          el.releaseStatusNote.textContent =
            `Tag v2.0.0 aktif di repositori (rilis terbaru di API: ${latestTag}).`;
        }
      }

      const archiveItems = v2Release
        ? releases.filter((rel) => rel !== v2Release)
        : releases;
      renderArchiveReleases(archiveItems);
    } catch (_err) {
      if (el.statTotalDownloads) el.statTotalDownloads.textContent = 'GitHub';
      if (el.releaseStatusNote) {
        el.releaseStatusNote.textContent =
          'Tidak dapat memuat metadata live dari GitHub API saat ini. Gunakan tombol untuk membuka halaman Releases resmi.';
      }
      if (el.primaryDownloadBtn) el.primaryDownloadBtn.href = RELEASES_PAGE_URL;
      if (el.msiDownloadBtn) el.msiDownloadBtn.href = RELEASES_PAGE_URL;
      renderArchiveReleases([]);
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
  initVirtualMonitorControls();
  initCopyHash();
  initFeedbackForm();
  syncUI();
  void initSmartReleaseHub();
})();
