/**
 * CASA v2.0.0 — Showcase Website Interactive Runtime
 * Zero dependencies, CSP-strict (no eval, no inline HTML injection, URL allowlists).
 */

(() => {
  'use strict';

  const REPO_OWNER = 'Farhanpratama09';
  const REPO_NAME = 'casa-app';
  const RELEASES_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases`;
  const RELEASES_PAGE_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;
  const NEW_ISSUE_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/new`;

  // Optional direct webhook endpoint (Web3Forms or Formspree).
  // Leave blank to use the built-in pre-filled GitHub Issue fallback automatically.
  const FEEDBACK_ENDPOINT = '';
  const ALLOWED_FEEDBACK_HOSTS = ['api.web3forms.com', 'formspree.io'];

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const CHIME_NOTES_HZ = [523.25, 659.25, 783.99, 987.77]; // C5 -> E5 -> G5 -> B5

  const THEME_LABELS = {
    default: 'Warm Amber',
    monochrome: 'Monochrome',
    colorblind: 'Colorblind Safe',
  };

  const EXPRESSION_LABELS = {
    idle: '× ♥ Idle',
    dual_active: '•̀ ♪ Focus+Musik',
    focus: '•̀ ♥ Focus',
    music: '♪ ♥ Musik',
    awake_lock: '✦ ♥ Keep Awake',
    alarm: '> < Alarm',
  };

  const DEMO_TRACKS = [
    {
      title: 'Midnight Coding',
      artist: 'Lo-Fi Bunny · Spotify SMTC',
      lyric: 'Pure OLED black, zero distractions.',
    },
    {
      title: 'Obsidian Horizon',
      artist: 'CASA Synthwave · LRCLIB',
      lyric: '4px Smart-Tuck keeps fullscreen crystal clear.',
    },
    {
      title: 'Coffee & Focus',
      artist: 'Pomodoro Sessions · Local',
      lyric: 'Alt + Space summons your workspace capsule.',
    },
  ];

  const AUDIO_OUTPUTS = [
    { kind: 'wired', label: 'Wired Earphone (Realtek USB)', short: 'Wired' },
    { kind: 'speaker', label: 'Speakers (Realtek Audio)', short: 'Speaker' },
    { kind: 'bluetooth', label: 'BT Earphone • 85%', short: 'BT 85%' },
  ];

  const state = {
    theme: 'default',
    placement: 'docked',
    tucked: false,
    expanded: false,
    expression: 'idle',
    activeTab: 'control',
    keepAwake: false,
    focusRunning: false,
    focusSeconds: 25 * 60,
    musicPlaying: false,
    trackIndex: 0,
    outputIndex: 0,
    hudTimerId: null,
    hudKind: null,
    alarmRinging: false,
    audioCtx: null,
    hoverOpenTimer: null,
    hoverCloseTimer: null,
    focusIntervalId: null,
  };

  // DOM helpers
  const $ = (id) => document.getElementById(id);
  const el = {
    html: document.documentElement,
    notchMount: $('live-notch-mount'),
    notchShell: $('casa-notch-shell'),
    notchEyes: $('notch-eyes-svg'),
    notchPrimary: $('notch-primary-text'),
    notchSecondary: $('notch-secondary-text'),
    notchHudChip: $('notch-hud-chip'),
    notchAlarmActions: $('notch-alarm-actions'),
    notchSnoozeBtn: $('notch-snooze-btn'),
    notchDismissBtn: $('notch-dismiss-btn'),
    notchBatteryLabel: $('notch-battery-label'),
    notchExpClock: $('notch-exp-clock'),
    notchCollapseBtn: $('notch-collapse-btn'),
    notchTabButtons: Array.from(document.querySelectorAll('[data-notch-tab]')),
    notchBodyControl: $('notch-exp-body-control'),
    notchBodyMusic: $('notch-exp-body-music'),
    notchTimerDisplay: $('notch-timer-display'),
    notchTimerStatus: $('notch-timer-status'),
    notchFocusToggle: $('notch-focus-toggle'),
    notchAwakeToggle: $('notch-awake-toggle'),
    notchMusicToggle: $('notch-music-toggle'),
    notchChimeMini: $('notch-chime-mini'),
    notchExpTrack: $('notch-exp-track'),
    notchExpArtist: $('notch-exp-artist'),
    notchMusicTitle: $('notch-music-title'),
    notchMusicArtist: $('notch-music-artist'),
    notchMusicLyric: $('notch-music-lyric'),
    notchPrevTrack: $('notch-prev-track'),
    notchPlayPauseBtn: $('notch-play-pause-btn'),
    notchNextTrack: $('notch-next-track'),
    notchOutputLabel: $('notch-output-label'),
    notchBtLabel: $('notch-bt-label'),
    notchHudBtMini: $('notch-hud-bt-mini'),
    notchHudOutMini: $('notch-hud-out-mini'),
    heroEyeLeft: $('hero-eye-left'),
    heroEyeRight: $('hero-eye-right'),
    mascotCard: $('mascot-card'),
    mascotExpressionLabel: $('mascot-expression-label'),
    mascotPlacementLabel: $('mascot-placement-label'),
    themeStatusPill: $('theme-status-pill'),
    placementStatusPill: $('placement-status-pill'),
    exprCodePill: $('expr-code-pill'),
    themeButtons: Array.from(document.querySelectorAll('[data-theme-btn]')),
    placementButtons: Array.from(document.querySelectorAll('[data-placement-btn]')),
    exprButtons: Array.from(document.querySelectorAll('[data-expr-btn]')),
    simTuckBtn: $('sim-tuck-btn'),
    simExpandBtn: $('sim-expand-btn'),
    simChimeBtn: $('sim-chime-btn'),
    simBtBtn: $('sim-bt-btn'),
    simOutputBtn: $('sim-output-btn'),
    heroToggleNotchBtn: $('hero-toggle-notch-btn'),
    heroDownloadBtn: $('hero-download-btn'),
    heroDownloadsSummary: $('hero-downloads-summary'),
    releaseVersionBadge: $('release-version-badge'),
    releaseDateBadge: $('release-date-badge'),
    primaryDownloadBtn: $('primary-download-btn'),
    msiDownloadBtn: $('msi-download-btn'),
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

  /**
   * Renders CASA companion SVG eye geometry safely into both the pinned Notch SVG (34x16)
   * and the Hero Obsidian Bunny centerpiece SVG (240x240) using pure createElementNS primitives.
   */
  function renderEyeGeometry(expr) {
    const heartPathNotch =
      'M 25,13.5 L 24.3,12.8 C 21.1,10.0 19.6,8.3 19.6,6.1 C 19.6,4.4 20.9,3.1 22.5,3.1 C 23.6,3.1 24.5,3.7 25,4.6 C 25.5,3.7 26.4,3.1 27.5,3.1 C 29.1,3.1 30.4,4.4 30.4,6.1 C 30.4,8.3 28.9,10.0 25.7,12.8 Z';

    const heroHeartPath =
      'M 148 167 C 148 167, 133.5 157, 133.5 148.5 C 133.5 143.2, 137.7 139.5, 142 139.5 C 144.7 139.5, 146.9 141.2, 148 143.3 C 149.1 141.2, 151.3 139.5, 154 139.5 C 158.3 139.5, 162.5 143.2, 162.5 148.5 C 162.5 157, 148 167, 148 167 Z';

    // 1. Pinned Notch SVG (viewBox 0 0 34 16)
    if (el.notchEyes) {
      clearNode(el.notchEyes);
      if (expr === 'alarm') {
        el.notchEyes.appendChild(
          createSvgNode('path', {
            d: 'M 4.5,3.2 L 12.5,8 L 4.5,12.8',
            fill: 'none',
            stroke: 'var(--casa-accent)',
            'stroke-width': 2.1,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
          })
        );
        el.notchEyes.appendChild(
          createSvgNode('path', {
            d: 'M 29.5,3.2 L 21.5,8 L 29.5,12.8',
            fill: 'none',
            stroke: 'var(--casa-accent)',
            'stroke-width': 2.1,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
          })
        );
      } else {
        // Left eye
        if (expr === 'dual_active' || expr === 'focus') {
          el.notchEyes.appendChild(
            createSvgNode('path', {
              d: 'M 4.2,3.0 L 12.2,5.6',
              fill: 'none',
              stroke: '#ffffff',
              'stroke-width': 1.9,
              'stroke-linecap': 'round',
            })
          );
          el.notchEyes.appendChild(
            createSvgNode('circle', {
              cx: 8.4,
              cy: 9.8,
              r: 2.7,
              fill: '#ffffff',
            })
          );
        } else if (expr === 'music') {
          el.notchEyes.appendChild(
            createSvgNode('path', {
              d: 'M 9.8,11.6 L 9.8,3.2 L 14.2,4.8',
              fill: 'none',
              stroke: '#ffffff',
              'stroke-width': 1.9,
              'stroke-linecap': 'round',
              'stroke-linejoin': 'round',
            })
          );
          el.notchEyes.appendChild(
            createSvgNode('ellipse', {
              cx: 6.8,
              cy: 11.6,
              rx: 3.0,
              ry: 2.2,
              transform: 'rotate(-18 6.8 11.6)',
              fill: '#ffffff',
            })
          );
        } else if (expr === 'awake_lock') {
          el.notchEyes.appendChild(
            createSvgNode('path', {
              d: 'M 8.5,1.8 Q 8.8,7.6 14.6,8 Q 8.8,8.4 8.5,14.2 Q 8.2,8.4 2.4,8 Q 8.2,7.6 8.5,1.8 Z',
              fill: '#ffffff',
            })
          );
        } else {
          el.notchEyes.appendChild(
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
          el.notchEyes.appendChild(
            createSvgNode('path', {
              d: 'M 26.2,11.6 L 26.2,3.2 L 30.6,4.8',
              fill: 'none',
              stroke: '#ffffff',
              'stroke-width': 1.9,
              'stroke-linecap': 'round',
              'stroke-linejoin': 'round',
            })
          );
          el.notchEyes.appendChild(
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
          el.notchEyes.appendChild(
            createSvgNode('path', {
              d: heartPathNotch,
              fill: '#ffffff',
            })
          );
        }
      }
    }

    // 2. Hero Obsidian Bunny SVG Eyes (centered around left=(92,155), right=(148,153))
    if (el.heroEyeLeft && el.heroEyeRight) {
      clearNode(el.heroEyeLeft);
      clearNode(el.heroEyeRight);

      if (expr === 'alarm') {
        el.heroEyeLeft.appendChild(
          createSvgNode('path', {
            d: 'M 81 144 L 103 155 L 81 166',
            fill: 'none',
            stroke: 'var(--casa-accent)',
            'stroke-width': 6.4,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
          })
        );
        el.heroEyeRight.appendChild(
          createSvgNode('path', {
            d: 'M 159 144 L 137 155 L 159 166',
            fill: 'none',
            stroke: 'var(--casa-accent)',
            'stroke-width': 6.4,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
          })
        );
        return;
      }

      // Hero Left Eye
      if (expr === 'dual_active' || expr === 'focus') {
        el.heroEyeLeft.appendChild(
          createSvgNode('path', {
            d: 'M 80 142 L 104 149',
            fill: 'none',
            stroke: '#FFFFFF',
            'stroke-width': 5.6,
            'stroke-linecap': 'round',
          })
        );
        el.heroEyeLeft.appendChild(
          createSvgNode('circle', {
            cx: 92,
            cy: 160,
            r: 7.4,
            fill: '#FFFFFF',
          })
        );
      } else if (expr === 'music') {
        el.heroEyeLeft.appendChild(
          createSvgNode('path', {
            d: 'M 95 162 L 95 140 L 108 145',
            fill: 'none',
            stroke: '#FFFFFF',
            'stroke-width': 5.4,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
          })
        );
        el.heroEyeLeft.appendChild(
          createSvgNode('ellipse', {
            cx: 87,
            cy: 162,
            rx: 8.2,
            ry: 6.0,
            transform: 'rotate(-18 87 162)',
            fill: '#FFFFFF',
          })
        );
      } else if (expr === 'awake_lock') {
        el.heroEyeLeft.appendChild(
          createSvgNode('path', {
            d: 'M 92 138 Q 93.2 153 108 155 Q 93.2 157 92 172 Q 90.8 157 76 155 Q 90.8 153 92 138 Z',
            fill: '#FFFFFF',
          })
        );
      } else {
        el.heroEyeLeft.appendChild(
          createSvgNode('path', {
            d: 'M 83 146 L 101 164 M 101 146 L 83 164',
            fill: 'none',
            stroke: '#FFFFFF',
            'stroke-width': 6.8,
            'stroke-linecap': 'round',
          })
        );
      }

      // Hero Right Eye
      if (expr === 'dual_active') {
        el.heroEyeRight.appendChild(
          createSvgNode('path', {
            d: 'M 151 162 L 151 140 L 164 145',
            fill: 'none',
            stroke: '#FFFFFF',
            'stroke-width': 5.4,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
          })
        );
        el.heroEyeRight.appendChild(
          createSvgNode('ellipse', {
            cx: 143,
            cy: 162,
            rx: 8.2,
            ry: 6.0,
            transform: 'rotate(-18 143 162)',
            fill: '#FFFFFF',
          })
        );
      } else {
        el.heroEyeRight.appendChild(
          createSvgNode('path', {
            d: heroHeartPath,
            fill: '#FFFFFF',
          })
        );
      }
    }
  }

  function formatMmSs(totalSeconds) {
    const clamped = Math.max(0, Math.floor(totalSeconds));
    const mins = String(Math.floor(clamped / 60)).padStart(2, '0');
    const secs = String(clamped % 60).padStart(2, '0');
    return `${mins}:${secs}`;
  }

  function computeCurrentExpression() {
    if (state.alarmRinging) return 'alarm';
    if (state.expression !== 'idle') return state.expression;
    if (state.focusRunning && state.musicPlaying) return 'dual_active';
    if (state.focusRunning) return 'focus';
    if (state.musicPlaying) return 'music';
    if (state.keepAwake) return 'awake_lock';
    return 'idle';
  }

  function syncUI() {
    const resolvedExpr = computeCurrentExpression();
    renderEyeGeometry(resolvedExpr);

    // Theme tokens
    el.html.setAttribute('data-theme', state.theme);
    if (el.themeStatusPill) {
      el.themeStatusPill.textContent = THEME_LABELS[state.theme] || 'Warm Amber';
    }
    el.themeButtons.forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.themeBtn === state.theme));
    });

    // Placement & Smart-Tuck
    if (el.notchMount) {
      el.notchMount.setAttribute('data-placement', state.placement);
      el.notchMount.setAttribute('data-tucked', String(state.tucked && !state.expanded && !state.alarmRinging));
    }
    el.placementButtons.forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.placementBtn === state.placement));
    });
    if (el.simTuckBtn) {
      el.simTuckBtn.setAttribute('aria-pressed', String(state.tucked));
    }
    if (el.simExpandBtn) {
      el.simExpandBtn.setAttribute('aria-pressed', String(state.expanded));
    }
    if (el.placementStatusPill) {
      el.placementStatusPill.textContent = state.tucked
        ? '4px Smart-Tuck'
        : state.placement === 'floating'
        ? 'Floating 12px'
        : 'Docked 0px';
    }
    if (el.mascotPlacementLabel) {
      el.mascotPlacementLabel.textContent = state.tucked
        ? 'Smart-Tuck 4px'
        : state.placement === 'floating'
        ? 'Floating 12px'
        : 'Docked 0px';
    }

    // Expressions
    const exprLabel = EXPRESSION_LABELS[resolvedExpr] || EXPRESSION_LABELS.idle;
    if (el.exprCodePill) el.exprCodePill.textContent = exprLabel;
    if (el.mascotExpressionLabel) el.mascotExpressionLabel.textContent = exprLabel;
    el.exprButtons.forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.exprBtn === state.expression));
    });

    // Live Notch State Machine ('tucked' | 'expanded' | 'alarm' | 'hud' | 'idle')
    let shellState = 'idle';
    if (state.expanded) {
      shellState = 'expanded';
    } else if (state.alarmRinging) {
      shellState = 'alarm';
    } else if (state.hudKind) {
      shellState = 'hud';
    } else if (state.tucked) {
      shellState = 'tucked';
    }

    if (el.notchShell) {
      el.notchShell.setAttribute('data-state', shellState);
    }

    // Update idle / HUD / alarm content inside Notch
    if (el.notchHudChip && el.notchAlarmActions && el.notchBatteryLabel) {
      el.notchHudChip.hidden = true;
      el.notchAlarmActions.hidden = true;
      el.notchBatteryLabel.hidden = false;

      if (state.alarmRinging) {
        el.notchPrimary.textContent = "Time's Up!";
        el.notchSecondary.textContent = 'Focus selesai';
        el.notchAlarmActions.hidden = false;
        el.notchBatteryLabel.hidden = true;
      } else if (state.hudKind === 'bluetooth') {
        el.notchPrimary.textContent = 'Bluetooth Connected';
        el.notchSecondary.textContent = '';
        el.notchHudChip.textContent = 'BT Earphone • 85%';
        el.notchHudChip.hidden = false;
        el.notchBatteryLabel.hidden = true;
      } else if (state.hudKind === 'audio_output') {
        const currentOutput = AUDIO_OUTPUTS[state.outputIndex];
        el.notchPrimary.textContent = 'Audio Output';
        el.notchSecondary.textContent = currentOutput.short;
        el.notchHudChip.textContent = 'WASAPI';
        el.notchHudChip.hidden = false;
        el.notchBatteryLabel.hidden = true;
      } else if (resolvedExpr === 'music' || resolvedExpr === 'dual_active') {
        const track = DEMO_TRACKS[state.trackIndex];
        el.notchPrimary.textContent = track.title;
        el.notchSecondary.textContent = resolvedExpr === 'dual_active' ? formatMmSs(state.focusSeconds) : '♪ Spotify';
      } else if (resolvedExpr === 'focus') {
        el.notchPrimary.textContent = 'Focus Session';
        el.notchSecondary.textContent = formatMmSs(state.focusSeconds);
      } else if (resolvedExpr === 'awake_lock') {
        el.notchPrimary.textContent = 'Keep Awake';
        el.notchSecondary.textContent = 'Display On';
      } else {
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        el.notchPrimary.textContent = `${hh}:${mm}`;
        el.notchSecondary.textContent = 'Sab, 14 Nov';
      }
    }

    // Expanded panel content
    if (el.notchTimerDisplay) {
      el.notchTimerDisplay.textContent = formatMmSs(state.focusSeconds);
    }
    if (el.notchTimerStatus) {
      el.notchTimerStatus.textContent = state.alarmRinging
        ? "Time's Up!"
        : state.focusRunning
        ? 'Focus Aktif'
        : 'Ready';
    }
    if (el.notchFocusToggle) {
      el.notchFocusToggle.textContent = state.focusRunning ? 'Pause Focus' : 'Start Focus';
      el.notchFocusToggle.classList.toggle('active', state.focusRunning);
    }
    if (el.notchAwakeToggle) {
      el.notchAwakeToggle.setAttribute('aria-pressed', String(state.keepAwake));
      el.notchAwakeToggle.classList.toggle('active', state.keepAwake);
    }
    if (el.notchMusicToggle) {
      el.notchMusicToggle.setAttribute('aria-pressed', String(state.musicPlaying));
      el.notchMusicToggle.classList.toggle('active', state.musicPlaying);
      el.notchMusicToggle.textContent = state.musicPlaying ? 'Pause Track' : 'Play Track';
    }

    const activeTrack = DEMO_TRACKS[state.trackIndex];
    if (el.notchExpTrack) el.notchExpTrack.textContent = activeTrack.title;
    if (el.notchExpArtist) el.notchExpArtist.textContent = activeTrack.artist;
    if (el.notchMusicTitle) el.notchMusicTitle.textContent = activeTrack.title;
    if (el.notchMusicArtist) el.notchMusicArtist.textContent = activeTrack.artist;
    if (el.notchMusicLyric) el.notchMusicLyric.textContent = activeTrack.lyric;

    const currentOutput = AUDIO_OUTPUTS[state.outputIndex];
    if (el.notchOutputLabel) el.notchOutputLabel.textContent = currentOutput.label;
    if (el.notchBtLabel) {
      el.notchBtLabel.textContent =
        currentOutput.kind === 'bluetooth'
          ? 'Active Sink: BT Earphone • 85%'
          : 'BT Earphone • 85% Ready';
    }
  }

  /**
   * Pure Web Audio API Harmonic Chime matching CASA alarmChime.ts (C5 -> E5 -> G5 -> B5)
   */
  function playHarmonicChimePreview() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    if (!state.audioCtx) {
      state.audioCtx = new AudioCtx();
    }
    const ctx = state.audioCtx;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime + 0.02;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.85, now);
    masterGain.connect(ctx.destination);

    CHIME_NOTES_HZ.forEach((freq, idx) => {
      const noteStart = now + idx * 0.14;
      const noteDuration = idx === CHIME_NOTES_HZ.length - 1 ? 1.15 : 0.78;

      const oscMain = ctx.createOscillator();
      oscMain.type = 'sine';
      oscMain.frequency.setValueAtTime(freq, noteStart);

      const oscHarmonic = ctx.createOscillator();
      oscHarmonic.type = 'triangle';
      oscHarmonic.frequency.setValueAtTime(freq * 2, noteStart);

      const mainGain = ctx.createGain();
      mainGain.gain.setValueAtTime(0.0001, noteStart);
      mainGain.gain.linearRampToValueAtTime(0.16, noteStart + 0.02);
      mainGain.gain.exponentialRampToValueAtTime(0.0008, noteStart + noteDuration);

      const harmonicGain = ctx.createGain();
      harmonicGain.gain.setValueAtTime(0.0001, noteStart);
      harmonicGain.gain.linearRampToValueAtTime(0.028, noteStart + 0.015);
      harmonicGain.gain.exponentialRampToValueAtTime(0.0005, noteStart + noteDuration * 0.65);

      oscMain.connect(mainGain);
      mainGain.connect(masterGain);
      oscHarmonic.connect(harmonicGain);
      harmonicGain.connect(masterGain);

      oscMain.start(noteStart);
      oscMain.stop(noteStart + noteDuration + 0.04);
      oscHarmonic.start(noteStart);
      oscHarmonic.stop(noteStart + noteDuration + 0.04);
    });
  }

  function triggerHudBanner(kind) {
    if (state.hudTimerId) {
      window.clearTimeout(state.hudTimerId);
    }
    state.expanded = false;
    state.tucked = false;
    state.alarmRinging = false;
    state.hudKind = kind;
    syncUI();

    state.hudTimerId = window.setTimeout(() => {
      state.hudKind = null;
      state.hudTimerId = null;
      syncUI();
    }, 3200);
  }

  function triggerAlarmDemo() {
    playHarmonicChimePreview();
    state.expanded = false;
    state.tucked = false;
    state.hudKind = null;
    state.alarmRinging = true;
    state.expression = 'alarm';
    syncUI();
  }

  function dismissAlarmDemo(snoozeMinutes) {
    state.alarmRinging = false;
    if (snoozeMinutes > 0) {
      state.focusSeconds = snoozeMinutes * 60;
      state.focusRunning = true;
      state.expression = 'focus';
      ensureFocusTick();
    } else if (state.expression === 'alarm') {
      state.expression = 'idle';
    }
    syncUI();
  }

  function ensureFocusTick() {
    if (state.focusIntervalId) return;
    state.focusIntervalId = window.setInterval(() => {
      if (!state.focusRunning) return;
      if (state.focusSeconds > 1) {
        state.focusSeconds -= 1;
        syncUI();
      } else {
        state.focusSeconds = 0;
        state.focusRunning = false;
        triggerAlarmDemo();
      }
    }, 1000);
  }

  function switchNotchTab(tabName) {
    state.activeTab = tabName;
    el.notchTabButtons.forEach((btn) => {
      btn.setAttribute('aria-selected', String(btn.dataset.notchTab === tabName));
    });
    if (el.notchBodyControl) el.notchBodyControl.hidden = tabName !== 'control';
    if (el.notchBodyMusic) el.notchBodyMusic.hidden = tabName !== 'music';
  }

  function initInteractiveSimulator() {
    // Theme switching
    el.themeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        state.theme = btn.dataset.themeBtn || 'default';
        syncUI();
      });
    });

    // Placement switching
    el.placementButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        state.placement = btn.dataset.placementBtn === 'floating' ? 'floating' : 'docked';
        state.tucked = false;
        syncUI();
      });
    });

    // Expression switching
    el.exprButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextExpr = btn.dataset.exprBtn || 'idle';
        state.expression = nextExpr;
        state.alarmRinging = nextExpr === 'alarm';
        state.tucked = false;
        if (nextExpr === 'music') {
          state.musicPlaying = true;
        }
        syncUI();
      });
    });

    // Smart-Tuck toggle
    if (el.simTuckBtn) {
      el.simTuckBtn.addEventListener('click', () => {
        state.tucked = !state.tucked;
        if (state.tucked) {
          state.expanded = false;
          state.alarmRinging = false;
          state.hudKind = null;
        }
        syncUI();
      });
    }

    // Expand toggle controls
    const toggleExpand = () => {
      state.tucked = false;
      state.expanded = !state.expanded;
      syncUI();
    };

    if (el.simExpandBtn) el.simExpandBtn.addEventListener('click', toggleExpand);
    if (el.heroToggleNotchBtn) el.heroToggleNotchBtn.addEventListener('click', toggleExpand);
    if (el.notchCollapseBtn) {
      el.notchCollapseBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        state.expanded = false;
        syncUI();
      });
    }

    // Top-lip Notch pointer hover + click interactions
    if (el.notchShell) {
      el.notchShell.addEventListener('pointerenter', () => {
        if (state.alarmRinging || state.expanded) return;
        window.clearTimeout(state.hoverCloseTimer);
        state.hoverOpenTimer = window.setTimeout(() => {
          if (!state.alarmRinging) {
            state.tucked = false;
            state.expanded = true;
            syncUI();
          }
        }, 220);
      });

      el.notchShell.addEventListener('pointerleave', () => {
        window.clearTimeout(state.hoverOpenTimer);
        if (!state.expanded) return;
        state.hoverCloseTimer = window.setTimeout(() => {
          state.expanded = false;
          syncUI();
        }, 260);
      });

      el.notchShell.addEventListener('click', () => {
        if (!state.expanded && !state.alarmRinging) {
          state.tucked = false;
          state.expanded = true;
          syncUI();
        }
      });
    }

    // Alt + Space Global Shortcut simulation inside showcase page
    document.addEventListener('keydown', (ev) => {
      if (ev.altKey && (ev.code === 'Space' || ev.key === ' ')) {
        ev.preventDefault();
        toggleExpand();
      }
    });

    // Notch Expanded internal tabs & mini buttons
    el.notchTabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        switchNotchTab(btn.dataset.notchTab || 'control');
      });
    });

    if (el.notchFocusToggle) {
      el.notchFocusToggle.addEventListener('click', () => {
        state.focusRunning = !state.focusRunning;
        if (state.focusRunning) {
          ensureFocusTick();
          state.expression = state.musicPlaying ? 'dual_active' : 'focus';
        } else if (state.expression === 'focus' || state.expression === 'dual_active') {
          state.expression = state.musicPlaying ? 'music' : 'idle';
        }
        syncUI();
      });
    }

    if (el.notchAwakeToggle) {
      el.notchAwakeToggle.addEventListener('click', () => {
        state.keepAwake = !state.keepAwake;
        if (state.keepAwake && !state.focusRunning && !state.musicPlaying) {
          state.expression = 'awake_lock';
        } else if (!state.keepAwake && state.expression === 'awake_lock') {
          state.expression = 'idle';
        }
        syncUI();
      });
    }

    const toggleMusicDemo = () => {
      state.musicPlaying = !state.musicPlaying;
      if (state.musicPlaying) {
        state.expression = state.focusRunning ? 'dual_active' : 'music';
      } else if (state.expression === 'music' || state.expression === 'dual_active') {
        state.expression = state.focusRunning ? 'focus' : 'idle';
      }
      syncUI();
    };

    if (el.notchMusicToggle) el.notchMusicToggle.addEventListener('click', toggleMusicDemo);
    if (el.notchPlayPauseBtn) el.notchPlayPauseBtn.addEventListener('click', toggleMusicDemo);

    if (el.notchPrevTrack) {
      el.notchPrevTrack.addEventListener('click', () => {
        state.trackIndex = (state.trackIndex - 1 + DEMO_TRACKS.length) % DEMO_TRACKS.length;
        state.musicPlaying = true;
        syncUI();
      });
    }

    if (el.notchNextTrack) {
      el.notchNextTrack.addEventListener('click', () => {
        state.trackIndex = (state.trackIndex + 1) % DEMO_TRACKS.length;
        state.musicPlaying = true;
        syncUI();
      });
    }

    // Alarm chime & banner buttons
    if (el.simChimeBtn) el.simChimeBtn.addEventListener('click', triggerAlarmDemo);
    if (el.notchChimeMini) el.notchChimeMini.addEventListener('click', triggerAlarmDemo);

    if (el.notchSnoozeBtn) {
      el.notchSnoozeBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        dismissAlarmDemo(5);
      });
    }

    if (el.notchDismissBtn) {
      el.notchDismissBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        dismissAlarmDemo(0);
      });
    }

    // Hardware HUD simulations
    if (el.simBtBtn) el.simBtBtn.addEventListener('click', () => triggerHudBanner('bluetooth'));
    if (el.notchHudBtMini) el.notchHudBtMini.addEventListener('click', () => triggerHudBanner('bluetooth'));

    const cycleAudioOutput = () => {
      state.outputIndex = (state.outputIndex + 1) % AUDIO_OUTPUTS.length;
      triggerHudBanner('audio_output');
    };

    if (el.simOutputBtn) el.simOutputBtn.addEventListener('click', cycleAudioOutput);
    if (el.notchHudOutMini) el.notchHudOutMini.addEventListener('click', cycleAudioOutput);
  }

  /**
   * 3D Mouse Parallax Hover Tilt on Hero Obsidian Bunny Card
   */
  function initHeroMascotTilt() {
    if (!el.mascotCard) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    el.mascotCard.addEventListener('pointermove', (ev) => {
      const rect = el.mascotCard.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const relX = (ev.clientX - rect.left) / rect.width - 0.5;
      const relY = (ev.clientY - rect.top) / rect.height - 0.5;
      const rotateY = (relX * 14).toFixed(2);
      const rotateX = (-relY * 14).toFixed(2);
      el.mascotCard.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    });

    el.mascotCard.addEventListener('pointerleave', () => {
      el.mascotCard.style.transform = 'rotateX(0deg) rotateY(0deg)';
    });
  }

  /**
   * Checks safe GitHub HTTPS URLs before binding anchors rendered from API responses.
   */
  function isSafeGitHubUrl(rawUrl) {
    if (typeof rawUrl !== 'string') return false;
    return (
      rawUrl.startsWith(`https://github.com/${REPO_OWNER}/${REPO_NAME}/`) ||
      rawUrl.startsWith('https://objects.githubusercontent.com/')
    );
  }

  function formatMegabytes(bytes) {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) {
      return null;
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function formatReleaseDate(isoStr) {
    if (typeof isoStr !== 'string' || !isoStr) return 'GitHub Release';
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return 'GitHub Release';
    return d.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  function renderArchiveReleases(releases) {
    if (!el.archiveList) return;
    clearNode(el.archiveList);

    if (!Array.isArray(releases) || releases.length === 0) {
      const item = document.createElement('li');
      item.className = 'archive-item';

      const meta = document.createElement('div');
      meta.className = 'archive-item-meta';
      const title = document.createElement('strong');
      title.textContent = 'Riwayat Rilis GitHub';
      const sub = document.createElement('span');
      sub.className = 'archive-item-sub';
      sub.textContent = 'Lihat seluruh catatan rilis & biner resmi';
      meta.append(title, sub);

      const link = document.createElement('a');
      link.href = RELEASES_PAGE_URL;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'archive-link';
      link.textContent = 'Buka Releases ↗';

      item.append(meta, link);
      el.archiveList.appendChild(item);
      return;
    }

    releases.slice(0, 5).forEach((rel) => {
      const item = document.createElement('li');
      item.className = 'archive-item';

      const meta = document.createElement('div');
      meta.className = 'archive-item-meta';

      const title = document.createElement('strong');
      title.textContent = rel.tag_name || rel.name || 'Release';

      const assets = Array.isArray(rel.assets) ? rel.assets : [];
      const exeAsset = assets.find((a) => typeof a.name === 'string' && a.name.endsWith('.exe'));
      const downloads = assets.reduce(
        (sum, a) => sum + (typeof a.download_count === 'number' ? a.download_count : 0),
        0
      );

      const sub = document.createElement('span');
      sub.className = 'archive-item-sub';
      const sizeStr = exeAsset ? formatMegabytes(exeAsset.size) : null;
      sub.textContent = [
        formatReleaseDate(rel.published_at),
        sizeStr ? `.exe ${sizeStr}` : null,
        `${downloads} unduhan`,
      ]
        .filter(Boolean)
        .join(' · ');

      meta.append(title, sub);

      const link = document.createElement('a');
      const targetUrl =
        exeAsset && isSafeGitHubUrl(exeAsset.browser_download_url)
          ? exeAsset.browser_download_url
          : isSafeGitHubUrl(rel.html_url)
          ? rel.html_url
          : RELEASES_PAGE_URL;

      link.href = targetUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'archive-link';
      link.textContent = exeAsset ? 'Unduh .exe ↗' : 'Lihat ↗';

      item.append(meta, link);
      el.archiveList.appendChild(item);
    });
  }

  /**
   * Smart Release Hub: fetches https://api.github.com/repos/Farhanpratama09/casa-app/releases
   */
  async function initSmartReleaseHub() {
    try {
      const response = await fetch(RELEASES_API_URL, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const releases = await response.json();
      if (!Array.isArray(releases)) {
        throw new Error('Unexpected releases payload');
      }

      let totalDownloads = 0;
      releases.forEach((rel) => {
        if (Array.isArray(rel.assets)) {
          rel.assets.forEach((asset) => {
            if (typeof asset.download_count === 'number') {
              totalDownloads += asset.download_count;
            }
          });
        }
      });

      if (el.statTotalDownloads) {
        el.statTotalDownloads.textContent = totalDownloads.toLocaleString('id-ID');
      }
      if (el.heroDownloadsSummary) {
        el.heroDownloadsSummary.textContent = `• Total Unduhan: ${totalDownloads.toLocaleString('id-ID')}+`;
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
          const sizeLabel = formatMegabytes(exeAsset.size) || '4.43 MB';
          if (el.statExeSize) el.statExeSize.textContent = sizeLabel;
          if (el.primaryDownloadBtn) {
            el.primaryDownloadBtn.href = exeAsset.browser_download_url;
            el.primaryDownloadBtn.textContent = `Download CASA ${v2Release.tag_name} for Windows (64-bit .exe • ${sizeLabel})`;
          }
          if (el.heroDownloadBtn) {
            el.heroDownloadBtn.href = exeAsset.browser_download_url;
          }
        }

        if (msiAsset && isSafeGitHubUrl(msiAsset.browser_download_url)) {
          const msiSizeLabel = formatMegabytes(msiAsset.size) || '6.41 MB';
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
        // v2.0.0 tag exists in repo; binary upload to Releases page may still be pending
        if (el.primaryDownloadBtn) el.primaryDownloadBtn.href = RELEASES_PAGE_URL;
        if (el.msiDownloadBtn) el.msiDownloadBtn.href = RELEASES_PAGE_URL;
        if (el.releaseStatusNote) {
          const latestTag = latestRelease && latestRelease.tag_name ? latestRelease.tag_name : 'v1.0.0';
          el.releaseStatusNote.textContent =
            `Tag v2.0.0 aktif di repositori. Menunggu unggahan biner v2.0.0 di GitHub Releases (rilis publik terbaru di API: ${latestTag}).`;
        }
      }

      const archiveItems = v2Release
        ? releases.filter((rel) => rel !== v2Release)
        : releases;
      renderArchiveReleases(archiveItems);
    } catch (_err) {
      if (el.statTotalDownloads) el.statTotalDownloads.textContent = 'GitHub';
      if (el.heroDownloadsSummary) el.heroDownloadsSummary.textContent = '• Open-Source MIT';
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

  /**
   * Dual-Path Feedback & Feature Requests Form
   */
  function isAllowedFeedbackEndpoint(urlStr) {
    if (!urlStr) return false;
    try {
      const parsed = new URL(urlStr);
      return (
        parsed.protocol === 'https:' &&
        ALLOWED_FEEDBACK_HOSTS.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))
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
      '_Dikirim melalui CASA v2.0.0 Showcase Web_',
    ].join('\n');

    const params = new URLSearchParams({
      title,
      body,
    });
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
              source: 'casa-v2-showcase',
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
  initInteractiveSimulator();
  initHeroMascotTilt();
  initCopyHash();
  initFeedbackForm();
  syncUI();
  void initSmartReleaseHub();
})();
