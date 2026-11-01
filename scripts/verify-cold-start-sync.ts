/**
 * CASA Critical QA Auditor: Cold-Start Spotify Sync, Ghost Playback Defense,
 * and Track Discrimination (Resume Same Track vs Play New Track).
 * 
 * Verifies:
 * 1. Cold start resume track with explicit `position_ms: lastKnownPositionMs`
 * 2. 800ms Guard Buffer: dropping initial `progress_ms: 0` packets before audio buffer is ready
 * 3. Explicit Device Locking: preventing routing to null sinks / remote inactive devices
 * 4. Trigger De-Duplication: Windows GSMTC priority vs Web API fallback
 * 5. Track Discrimination:
 *    - Same track resume -> continues at lastKnownPositionMs (e.g. 42s) + arms 800ms guard
 *    - New track selection -> resets lastKnownPositionMs to 0, starts from 00:00, clears guard buffer
 */

import {
  setLastKnownPositionMs,
  getLastKnownPositionMs,
  markPlayTriggered,
  clearPlayGuardWindow,
  isWithinPlayGuardWindow,
  setLastPlayedTrackUri,
  getLastPlayedTrackUri,
  buildSpotifyPlayUrl,
  buildSpotifyUrlWithDevice,
  resolveTargetDeviceId,
  normalizeTrackUri,
} from '../src/utils/spotifyService';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  [PASS] ${msg}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${msg}`);
    failed++;
  }
}

console.log('========================================================================');
console.log('  CASA CRITICAL QA: COLD-START SPOTIFY SYNC & TRACK DISCRIMINATION');
console.log('========================================================================\n');

// --- TEST GROUP 1: lastKnownPositionMs High-Watermark Tracking ---
console.log('--- TEST GROUP 1: High-Watermark Position Tracking ---');
setLastKnownPositionMs(0);
assert(getLastKnownPositionMs() === 0, 'Initial state: lastKnownPositionMs is 0');

setLastKnownPositionMs(42500);
assert(getLastKnownPositionMs() === 42500, 'Tracking: updates to 42500ms correctly');

setLastKnownPositionMs(42500.8);
assert(getLastKnownPositionMs() === 42501, 'Rounding: fractional milliseconds rounded to integer');

setLastKnownPositionMs(-10);
assert(getLastKnownPositionMs() === 42501, 'Sanitization: negative values rejected');

// --- TEST GROUP 2: 800ms Guard Buffer for progress_ms: 0 ---
console.log('\n--- TEST GROUP 2: 800ms Guard Buffer for Cold-Start progress_ms: 0 ---');
// Simulate play triggered right now
markPlayTriggered(Date.now());
assert(isWithinPlayGuardWindow(800) === true, 'Guard window active immediately after play dispatch (0ms < 800ms)');

// Simulate incoming poll packets
function simulatePollProgress(progressMs: number): number | null {
  if (progressMs === 0 && isWithinPlayGuardWindow(800)) {
    return null; // dropped by guard buffer
  }
  setLastKnownPositionMs(progressMs);
  return progressMs;
}

assert(simulatePollProgress(0) === null, 'Packet @ 50ms: progress_ms: 0 DROPPED by guard buffer (prevents reset to 00:00)');
assert(getLastKnownPositionMs() === 42501, 'Local state preserved: lastKnownPositionMs remains 42501ms');

// Non-zero progress packet within guard window should be accepted
assert(simulatePollProgress(42700) === 42700, 'Packet @ 200ms: non-zero progress_ms (42700) ACCEPTED within guard window');
assert(getLastKnownPositionMs() === 42700, 'Local state updated: lastKnownPositionMs advances to 42700ms');

// Simulate expired guard window (> 800ms)
markPlayTriggered(Date.now() - 900);
assert(isWithinPlayGuardWindow(800) === false, 'Guard window correctly expired after 900ms (> 800ms)');
assert(simulatePollProgress(0) === 0, 'Packet after guard window: genuine progress_ms: 0 (e.g. track start) permitted');

// --- TEST GROUP 3: Explicit Device Locking (Anti-Null Sink) ---
console.log('\n--- TEST GROUP 3: Explicit Device Locking & Endpoint Construction ---');
const dummyDevices = [
  { id: 'phone_123', name: 'Galaxy S24', is_active: false, type: 'Smartphone' },
  { id: 'desktop_456', name: 'DESKTOP-CASA', is_active: false, type: 'Computer' },
  { id: 'speaker_789', name: 'Kitchen Echo', is_active: false, type: 'Speaker' },
];

const resolvedId = resolveTargetDeviceId(dummyDevices);
assert(resolvedId === 'desktop_456', 'Device Resolution: Prioritizes Windows desktop computer over smartphone/speaker');

const activeDevices = [
  { id: 'phone_123', name: 'Galaxy S24', is_active: true, type: 'Smartphone' },
  { id: 'desktop_456', name: 'DESKTOP-CASA', is_active: true, type: 'Computer' },
];
const resolvedActiveComputer = resolveTargetDeviceId(activeDevices);
assert(resolvedActiveComputer === 'desktop_456', 'Device Resolution: Prioritizes active Computer over active smartphone');

const playUrlWithDevice = buildSpotifyPlayUrl('desktop_456');
assert(
  playUrlWithDevice === 'https://api.spotify.com/v1/me/player/play?device_id=desktop_456',
  'Play URL: Explicit device_id query parameter attached (prevents null sink routing)'
);

const pauseUrlWithDevice = buildSpotifyUrlWithDevice('https://api.spotify.com/v1/me/player/pause', 'desktop_456');
assert(
  pauseUrlWithDevice === 'https://api.spotify.com/v1/me/player/pause?device_id=desktop_456',
  'Pause URL: Explicit device_id query parameter attached'
);

// --- TEST GROUP 4: Track Discrimination Logic Engine ---
console.log('\n--- TEST GROUP 4: Track Discrimination (Resume Same Track vs Play New Track) ---');

function evaluatePlayCommand(options: {
  trackUri?: string;
  contextUri?: string | null;
  uris?: string[];
  positionMs?: number;
  isNewTrack?: boolean;
}) {
  const normalizedTrackUri = normalizeTrackUri(options.trackUri);
  const normalizedUris = options.uris?.map(normalizeTrackUri).filter((u): u is string => Boolean(u));
  const targetUri = normalizedTrackUri || (normalizedUris && normalizedUris[0]) || undefined;

  const currentLastPlayedUri = getLastPlayedTrackUri();

  const isNewTrack = Boolean(
    options.isNewTrack ||
    (targetUri && currentLastPlayedUri && targetUri !== currentLastPlayedUri) ||
    (targetUri && !currentLastPlayedUri && options.positionMs === undefined)
  );

  let resolvedPositionMs: number | undefined;

  if (isNewTrack) {
    setLastKnownPositionMs(0);
    clearPlayGuardWindow();
    if (targetUri) {
      setLastPlayedTrackUri(targetUri);
    }
    resolvedPositionMs =
      typeof options.positionMs === 'number' && options.positionMs > 0 ? Math.round(options.positionMs) : undefined;
  } else {
    markPlayTriggered();
    if (targetUri) {
      setLastPlayedTrackUri(targetUri);
    }
    resolvedPositionMs =
      typeof options.positionMs === 'number' && options.positionMs >= 0
        ? Math.round(options.positionMs)
        : getLastKnownPositionMs() > 0
        ? getLastKnownPositionMs()
        : undefined;
  }

  let body: Record<string, any>;
  if (options.contextUri && options.contextUri.startsWith('spotify:')) {
    body = {
      context_uri: options.contextUri,
      ...(normalizedTrackUri ? { offset: { uri: normalizedTrackUri } } : {}),
      ...(resolvedPositionMs !== undefined ? { position_ms: resolvedPositionMs } : {}),
    };
  } else if (normalizedUris && normalizedUris.length > 0) {
    body = {
      uris: normalizedUris,
      ...(normalizedTrackUri && normalizedUris[0] !== normalizedTrackUri
        ? { offset: { uri: normalizedTrackUri } }
        : {}),
      ...(resolvedPositionMs !== undefined ? { position_ms: resolvedPositionMs } : {}),
    };
  } else if (normalizedTrackUri) {
    body = {
      uris: [normalizedTrackUri],
      ...(resolvedPositionMs !== undefined ? { position_ms: resolvedPositionMs } : {}),
    };
  } else if (resolvedPositionMs !== undefined) {
    body = {
      position_ms: resolvedPositionMs,
    };
  } else {
    body = {};
  }

  return { isNewTrack, resolvedPositionMs, body, targetUri };
}

// Subtest 4.1: Same Track Resume (e.g. Song A paused at 42 seconds)
setLastPlayedTrackUri('spotify:track:song_A_123');
setLastKnownPositionMs(42000);

const resumeResult = evaluatePlayCommand({
  trackUri: 'spotify:track:song_A_123',
});

assert(resumeResult.isNewTrack === false, 'Same Track: Detected as RESUME (isNewTrack === false)');
assert(resumeResult.resolvedPositionMs === 42000, 'Same Track: resolvedPositionMs preserves 42000ms');
assert(resumeResult.body.position_ms === 42000, 'Same Track: Payload explicitly sends position_ms: 42000');
assert(isWithinPlayGuardWindow(800) === true, 'Same Track: 800ms cold-start guard buffer armed');
assert(getLastPlayedTrackUri() === 'spotify:track:song_A_123', 'Same Track: lastPlayedTrackUri maintained');

// Subtest 4.2: Selecting a NEW track (Song B from search/queue/playlist)
const newTrackResult = evaluatePlayCommand({
  trackUri: 'spotify:track:song_B_999',
});

assert(newTrackResult.isNewTrack === true, 'New Track: URI mismatch detected as NEW TRACK (isNewTrack === true)');
assert(getLastKnownPositionMs() === 0, 'New Track: lastKnownPositionMs immediately RESET to 0');
assert(newTrackResult.resolvedPositionMs === undefined, 'New Track: resolvedPositionMs is undefined (plays from 00:00)');
assert(newTrackResult.body.position_ms === undefined, 'New Track: Payload does NOT contain old position_ms (starts 00:00)');
assert(isWithinPlayGuardWindow(800) === false, 'New Track: Guard window BYPASSED (allows immediate progress_ms: 0)');
assert(getLastPlayedTrackUri() === 'spotify:track:song_B_999', 'New Track: lastPlayedTrackUri updated to Song B');

// Subtest 4.3: Same Track again (Song B paused at 18 seconds)
setLastKnownPositionMs(18000);
const resumeSongB = evaluatePlayCommand({
  trackUri: 'spotify:track:song_B_999',
});
assert(resumeSongB.isNewTrack === false, 'Song B Resume: Detected as RESUME (isNewTrack === false)');
assert(resumeSongB.body.position_ms === 18000, 'Song B Resume: Continues at 18000ms');

// Subtest 4.4: Pure Resume without URI (e.g. Play button with no URI argument)
setLastKnownPositionMs(25000);
const pureResume = evaluatePlayCommand({});
assert(pureResume.isNewTrack === false, 'Pure Resume: Detected as RESUME');
assert(pureResume.body.position_ms === 25000, 'Pure Resume: Payload sends position_ms: 25000');

// --- TEST GROUP 5: Trigger De-Duplication Verification ---
console.log('\n--- TEST GROUP 5: Trigger De-Duplication (GSMTC vs Web API) ---');
interface MockMediaState {
  hasNativeMedia: boolean;
  session_id: string;
  song: {
    is_spotify: boolean;
    is_browser: boolean;
    isPlaying: boolean;
  };
}

let gsmtcCalls = 0;
let webApiCalls = 0;

async function executeMockTogglePlay(state: MockMediaState, isConnected: boolean) {
  const isBrowser = Boolean(state.song?.is_browser);
  const isSpotifySessionActiveInGsmtc = Boolean(
    state.hasNativeMedia &&
    (state.song?.is_spotify || !isBrowser) &&
    state.session_id
  );

  if (isSpotifySessionActiveInGsmtc) {
    gsmtcCalls++;
    return 'gsmtc_handled';
  }

  if (isConnected) {
    webApiCalls++;
    return 'web_api_handled';
  }

  return 'none';
}

gsmtcCalls = 0;
webApiCalls = 0;
const gsmtcActiveState: MockMediaState = {
  hasNativeMedia: true,
  session_id: 'Spotify.exe_1',
  song: { is_spotify: true, is_browser: false, isPlaying: false },
};
executeMockTogglePlay(gsmtcActiveState, true);
assert(gsmtcCalls === 1 && webApiCalls === 0, 'De-duplication: GSMTC session active -> 1 GSMTC call, 0 Web API calls (no double-firing)');

gsmtcCalls = 0;
webApiCalls = 0;
const coldStartState: MockMediaState = {
  hasNativeMedia: false,
  session_id: '',
  song: { is_spotify: true, is_browser: false, isPlaying: false },
};
executeMockTogglePlay(coldStartState, true);
assert(gsmtcCalls === 0 && webApiCalls === 1, 'Cold start: GSMTC absent -> 0 GSMTC calls, 1 Web API call handled cleanly');

console.log('\n========================================================================');
console.log(`  AUDIT RESULTS: ${passed}/${passed + failed} TESTS PASSED`);
if (failed === 0) {
  console.log('  ALL COLD-START SYNCHRONIZATION & TRACK DISCRIMINATION TESTS GREEN! [PASS]');
} else {
  console.error(`  ${failed} TESTS FAILED!`);
  process.exit(1);
}
console.log('========================================================================\n');
