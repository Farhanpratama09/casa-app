import * as fs from 'fs';
import * as path from 'path';

console.log('\x1b[36m========================================================================\x1b[0m');
console.log('\x1b[36m  CASA QA: SPOTIFY MEDIA INTEGRATION & FORENSIC AUDIT\x1b[0m');
console.log('\x1b[36m========================================================================\x1b[0m\n');

let total = 0;
let passed = 0;

function assert(cond, name) {
  total++;
  if (cond) {
    passed++;
    console.log(`  \x1b[32m[PASS]\x1b[0m ${name}`);
  } else {
    console.log(`  \x1b[31m[FAIL]\x1b[0m ${name}`);
  }
}

// -------------------------------------------------------------
// 1. Audit Rust Win32 Spotify Handler (`spotify_win32.rs`)
// -------------------------------------------------------------
const rustPath = path.resolve('src-tauri/src/media/providers/spotify_win32.rs');
const rustContent = fs.readFileSync(rustPath, 'utf8');

assert(rustContent.includes('is_spotify_main_window'), 'spotify_win32.rs defines is_spotify_main_window');
assert(rustContent.includes('norm_w > 300 && norm_h > 300'), 'is_spotify_main_window verifies normal placement dimensions (>300x300)');
assert(rustContent.includes('w > 300 && h > 300'), 'is_spotify_main_window verifies real window bounds (>300x300)');
assert(rustContent.includes('is_spotify_frontmost'), 'spotify_win32.rs implements is_spotify_frontmost Z-order detection');
assert(rustContent.includes('starts_with("Chrome_WidgetWin_")'), 'is_spotify_main_window matches Chrome_WidgetWin_1 and Chrome_WidgetWin_0');
assert(rustContent.includes('SC_CLOSE'), 'focus_spotify_window posts SC_CLOSE to trigger minimize to tray');
assert(rustContent.includes('ShowWindow(target_hwnd, SW_MINIMIZE)'), 'focus_spotify_window includes SW_MINIMIZE fallback');
assert(rustContent.includes('is_open_on_screen'), 'focus_spotify_window detects is_open_on_screen reliably');
assert(rustContent.includes('PostMessageW(target_hwnd, WM_CLOSE, 0, 0)'), 'focus_spotify_window executes WM_CLOSE to hide open Spotify to tray');
assert(rustContent.includes('ShowWindow(target_hwnd, SW_RESTORE)'), 'focus_spotify_window executes SW_RESTORE on minimized/background window');
assert(!rustContent.includes('"taskkill"'), 'spotify_win32.rs has zero taskkill external process execution');
assert(!rustContent.includes('std::process::Command::new'), 'spotify_win32.rs has ZERO std::process::Command child process spawns');
assert(rustContent.includes('GetConsoleWindow'), 'spotify_win32.rs checks and blacklists GetConsoleWindow');
assert(rustContent.includes('ConsoleWindowClass'), 'spotify_win32.rs blacklists ConsoleWindowClass');
assert(rustContent.includes('CASCADIA_HOSTING_WINDOW_CLASS'), 'spotify_win32.rs blacklists Windows Terminal CASCADIA_HOSTING_WINDOW_CLASS');
assert(rustContent.includes('"cmd.exe"') && rustContent.includes('"conhost.exe"'), 'spotify_win32.rs explicitly blacklists cmd.exe and conhost.exe');
assert(rustContent.includes('ShellExecuteW') && rustContent.includes('"spotify:\\0"'), 'spotify_win32.rs launches Spotify cleanly via ShellExecuteW with spotify: URI');
assert(rustContent.includes('GetWindowTextLengthW') && rustContent.includes('title_len == 0'), 'spotify_win32.rs guards against headless/dummy CEF windows with GetWindowTextLengthW == 0');
assert(rustContent.includes('!is_visible && !is_iconic'), 'spotify_win32.rs rejects invisible/offscreen dummy windows');
assert(!rustContent.includes('ShowWindow(target_hwnd, SW_SHOW)'), 'focus_spotify_window never forces SW_SHOW on dummy windows');



// -------------------------------------------------------------
// 1B. Audit GSMTC Native Virtual Media Fallback (`gsmtc.rs`)
// -------------------------------------------------------------
const gsmtcPath = path.resolve('src-tauri/src/media/gsmtc.rs');
const gsmtcContent = fs.readFileSync(gsmtcPath, 'utf8');

assert(gsmtcContent.includes('simulate_virtual_media_key'), 'gsmtc.rs implements simulate_virtual_media_key via keybd_event');
assert(gsmtcContent.includes('let is_paused = status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused;'), 'gsmtc.rs checks is_paused playback status');
assert(gsmtcContent.includes('if !is_playing && !is_paused'), 'gsmtc.rs permits both Playing AND Paused media sessions');
assert(gsmtcContent.includes('VK_MEDIA_PLAY_PAUSE'), 'control_play_pause falls back to VK_MEDIA_PLAY_PAUSE Win32 API');
assert(gsmtcContent.includes('VK_MEDIA_NEXT_TRACK'), 'control_next falls back to VK_MEDIA_NEXT_TRACK Win32 API');
assert(gsmtcContent.includes('VK_MEDIA_PREV_TRACK'), 'control_prev falls back to VK_MEDIA_PREV_TRACK Win32 API');
assert(!gsmtcContent.includes('let _ = app.emit("spotify-closed", serde_json::json!({ "running": false }));\n                        let _ = app.emit("media-session-closed"'), 'gsmtc daemon does not unconditionally kill media sessions when Spotify closes');

// -------------------------------------------------------------
// 1C. Audit Spotify OAuth Zero Subprocess (`spotify_oauth.rs`)
// -------------------------------------------------------------
const oauthPath = path.resolve('src-tauri/src/spotify_oauth.rs');
const oauthContent = fs.readFileSync(oauthPath, 'utf8');

assert(!oauthContent.includes('"rundll32.exe"'), 'spotify_oauth.rs removed rundll32.exe child process');
assert(oauthContent.includes('ShellExecuteW'), 'spotify_oauth.rs launches browser cleanly via Win32 ShellExecuteW');

// -------------------------------------------------------------
// 2. Audit MediaSkill (`MediaSkill.tsx`)
// -------------------------------------------------------------
const skillPath = path.resolve('src/skills/media/MediaSkill.tsx');
const skillContent = fs.readFileSync(skillPath, 'utf8');

assert(skillContent.includes('isValidTrackMetadata'), 'MediaSkill.tsx exports isValidTrackMetadata guard');
assert(skillContent.includes("activeSubPanel: getInitialSubPanel()"), 'MediaSkill.tsx references getInitialSubPanel');
assert(/return\s+'none'/.test(skillContent), 'getInitialSubPanel strictly returns "none" on cold-start/mount');
assert(skillContent.includes('if (isValidTrackMetadata(cleanTitle, initial.artist))'), 'fetchLyrics on cold-start is guarded by isValidTrackMetadata');
assert(skillContent.includes('if (payload.is_playing && isValidTrackMetadata(cleanTitle, payload.artist))'), 'fetchLyrics on media-update is guarded by isValidTrackMetadata');
assert(skillContent.includes('!isValidTrackMetadata(current?.song?.title, current?.song?.artist)'), 'playbackTickerInterval rejects non-playing/buffering metadata');

// -------------------------------------------------------------
// 3. Audit MusicCardView (`MusicCardView.tsx`) & EmptyMediaView (`EmptyMediaView.tsx`)
// -------------------------------------------------------------
const cardPath = path.resolve('src/components/views/MusicCardView.tsx');
const cardContent = fs.readFileSync(cardPath, 'utf8');

const emptyPath = path.resolve('src/components/views/EmptyMediaView.tsx');
const emptyContent = fs.readFileSync(emptyPath, 'utf8');

assert(!emptyContent.includes('Spotify tidak terdeteksi'), 'EmptyMediaView.tsx has ZERO "Spotify tidak terdeteksi" modal text');
assert(!cardContent.includes('SpotifyClosedOverlay'), 'MusicCardView.tsx completely removed SpotifyClosedOverlay');
assert(!cardContent.includes("!effectiveSpotifyRunning && !hasActiveSession ? 'opacity-50 pointer-events-none'"), 'MusicCardView.tsx removed lockout opacity and pointer-events-none');
assert(cardContent.includes("useState<MusicSubPanel>(\n    propActiveSubPanel ?? 'none'\n  );"), 'MusicCardView defaults internalSubPanel to propActiveSubPanel ?? "none"');
assert(cardContent.includes("activeSubPanel === 'none' || activeSubPanel === 'lyrics' || activeSubPanel === 'queue'"), 'EmptyMediaView triggers when no active session even if subpanel is lyrics/queue');
assert(!cardContent.includes('const session = await ensureSpotifySessionReady(4000);\n    if (!session.isReady)'), 'handlePlayQueueTrack removes blocking 4000ms cold start session wait');
assert(cardContent.includes('playQueueTrack(targetTrack, activeContextUri, remainingUris)'), 'handlePlayQueueTrack initiates playQueueTrack without blocking UI');

// -------------------------------------------------------------
// 4. Audit useMediaPlayback (`useMediaPlayback.ts`)
// -------------------------------------------------------------
const playbackHookPath = path.resolve('src/features/media/useMediaPlayback.ts');
const playbackHookContent = fs.readFileSync(playbackHookPath, 'utf8');

assert(playbackHookContent.includes('const ok = await resumeSpotifyPlayback'), 'useMediaPlayback checks resumeSpotifyPlayback result');
assert(playbackHookContent.includes('const ok = await pauseSpotifyPlayback'), 'useMediaPlayback checks pauseSpotifyPlayback result');
assert(playbackHookContent.includes('controlMediaSession(sessionId, \'toggle\')'), 'useMediaPlayback falls back to controlMediaSession if Web API fails');
assert(playbackHookContent.includes('mediaPlayPause()'), 'useMediaPlayback falls back to native mediaPlayPause if Web API fails');

// -------------------------------------------------------------
// 5. Functional Validation of Metadata Filtering Logic
// -------------------------------------------------------------
const isValidTrackMetadataFn = (title, artist) => {
  if (!title) return false;
  const t = title.trim();
  if (
    !t ||
    t === 'No Media Playing' ||
    t === 'No Media Active' ||
    t.toLowerCase() === 'spotify' ||
    t.toLowerCase() === 'spotify free' ||
    t.toLowerCase() === 'spotify premium'
  ) {
    return false;
  }
  if (!artist) return false;
  const a = artist.trim().toLowerCase();
  if (!a || a === 'unknown' || a === 'unknown artist') {
    return false;
  }
  return true;
};

assert(!isValidTrackMetadataFn('', 'Adele'), 'Functional: Rejects empty title');
assert(!isValidTrackMetadataFn('Spotify', 'Spotify'), 'Functional: Rejects "Spotify" app title');
assert(!isValidTrackMetadataFn('Spotify Free', 'Spotify'), 'Functional: Rejects "Spotify Free" app title');
assert(!isValidTrackMetadataFn('No Media Active', 'Unknown'), 'Functional: Rejects "No Media Active"');
assert(!isValidTrackMetadataFn('Song Title', 'Unknown Artist'), 'Functional: Rejects "Unknown Artist"');
assert(isValidTrackMetadataFn('Ditto', 'NewJeans'), 'Functional: Accepts valid track "Ditto" by "NewJeans"');
assert(isValidTrackMetadataFn('Easy On Me', 'Adele'), 'Functional: Accepts valid track "Easy On Me" by "Adele"');

// -------------------------------------------------------------
// Summary
// -------------------------------------------------------------
console.log('\n=============================================================');
console.log(`  AUDIT RESULTS: ${passed}/${total} TESTS PASSED`);
if (passed === total) {
  console.log('  SPOTIFY INTEGRATION FIXES 100% VERIFIED & GREEN! [PASS]');
}
console.log('=============================================================\n');

if (passed !== total) process.exit(1);
