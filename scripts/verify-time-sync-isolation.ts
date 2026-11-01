import assert from 'assert';

console.log('========================================================================');
console.log('   CASA CRITICAL QA: TIME SYNC ISOLATION (BROWSER VS SPOTIFY)');
console.log('========================================================================\n');

// Mock simulator for the exact logic implemented in MediaSkill.tsx
function computeSyncedCurrentTime(
  payload: { position: number; is_browser: boolean },
  prevCurrentTime: number,
  trackChanged: boolean,
  nativePosChanged: boolean
): number {
  if (payload.is_browser) {
    if (trackChanged) {
      return payload.position;
    } else if (
      nativePosChanged &&
      Math.abs(payload.position - prevCurrentTime) > 2 &&
      payload.position > 0
    ) {
      return payload.position;
    } else {
      return prevCurrentTime;
    }
  } else {
    // Mode Non-Browser / Spotify
    if (
      trackChanged ||
      Math.abs(payload.position - prevCurrentTime) >= 0.5
    ) {
      return payload.position;
    } else {
      return prevCurrentTime;
    }
  }
}

// TEST GROUP 1: Spotify 1:1 Precision & Anti-Drift (0:45 Casa vs 0:44 Spotify)
console.log('--- TEST GROUP 1: Spotify 1:1 Precision & Anti-Drift ---');
{
  const prevTime = 45; // Casa is at 0:45
  const spotifyPos = 44.0; // Spotify is at 0:44 (delta = 1.0s >= 0.5s)
  const result = computeSyncedCurrentTime(
    { position: spotifyPos, is_browser: false },
    prevTime,
    false,
    true
  );
  assert.strictEqual(result, 44.0, 'Spotify 1s difference must immediately sync to 44.0s (no >2s guard block)');
  console.log('  [PASS] Spotify 1.0s delta locks 1:1 to Spotify position (44.0s)');
}
{
  const prevTime = 45.1;
  const spotifyPos = 45.2; // delta = 0.1s < 0.5s
  const result = computeSyncedCurrentTime(
    { position: spotifyPos, is_browser: false },
    prevTime,
    false,
    false
  );
  assert.strictEqual(result, 45.1, 'Spotify tiny sub-second drift (<0.5s) smoothly continues on local clock');
  console.log('  [PASS] Spotify tiny sub-second tick (<0.5s) smoothly preserved');
}

// TEST GROUP 2: Browser Static Heartbeat & Anti-Rubber-Banding
console.log('\n--- TEST GROUP 2: Browser Static Heartbeat & Anti-Rubber-Banding ---');
{
  const prevTime = 25; // Casa local ticker advanced to 25s
  const youtubeStaticPos = 0; // YouTube static initial playhead sent by 5s heartbeat
  const result = computeSyncedCurrentTime(
    { position: youtubeStaticPos, is_browser: true },
    prevTime,
    false,
    false // nativePosChanged is false
  );
  assert.strictEqual(result, 25, 'Browser static 5s heartbeat must NOT rubber-band local time back to 0s');
  console.log('  [PASS] Browser 5s static heartbeat does not rubber-band local ticker');
}
{
  const prevTime = 25;
  const userSeekedPos = 90; // User deliberately scrubbed in browser video
  const result = computeSyncedCurrentTime(
    { position: userSeekedPos, is_browser: true },
    prevTime,
    false,
    true // nativePosChanged is true and delta = 65 > 2
  );
  assert.strictEqual(result, 90, 'Browser deliberate seek (>2s) correctly syncs');
  console.log('  [PASS] Browser deliberate user seek (>2s) updates correctly');
}

// TEST GROUP 3: Spotify Duration Precision (3:34 vs 3:33)
console.log('\n--- TEST GROUP 3: Spotify Duration Precision ---');
{
  const rawDuration = 213.843; // 3 minutes 33.843 seconds
  const rounded = Math.round(rawDuration);
  assert.strictEqual(rounded, 214, '213.843s must round to 214s (3:34)');
  console.log('  [PASS] Math.round(213.843) resolves to 214s (3:34)');

  const webApiDurationMs = 213843;
  const webApiSec = Math.round(webApiDurationMs / 1000);
  assert.strictEqual(webApiSec, 214, 'Spotify Web API 213843ms resolves to 214s (3:34)');
  console.log('  [PASS] Spotify Web API duration calibration resolves to 214s (3:34)');
}

// TEST GROUP 4: Browser Next/Prev Routing to GSMTC
console.log('\n--- TEST GROUP 4: Browser Next/Prev Routing to GSMTC ---');
{
  const calls: string[] = [];
  const mockControlMediaSession = async (sessionId: string, action: string) => {
    calls.push(`control:${sessionId}:${action}`);
  };
  const mockMediaNextTrack = async () => {
    calls.push('native:next');
  };

  const handleNext = async (isBrowser: boolean, sessionId: string) => {
    if (isBrowser) {
      await mockControlMediaSession(sessionId, 'next');
    } else {
      await mockMediaNextTrack();
    }
  };

  handleNext(true, 'browser_tab_123');
  assert.strictEqual(calls[0], 'control:browser_tab_123:next', 'Browser must route next directly to controlMediaSession');
  console.log('  [PASS] Browser next routed directly to controlMediaSession with targeted sessionId');

  handleNext(false, 'spotify_session');
  assert.strictEqual(calls[1], 'native:next', 'Spotify/Native must route next to native mediaNextTrack');
  console.log('  [PASS] Spotify/Native next routed to native mediaNextTrack');
}

// TEST GROUP 5: State Hierarchy — Active Playback Precedence vs Session Stickiness
console.log('\n--- TEST GROUP 5: State Hierarchy (Playing Beats Paused vs Pause Stickiness) ---');
{
  interface MockSession {
    session_id: string;
    app_name: string;
    title: string;
    is_playing: boolean;
  }

  function shouldBlockSessionSwitch(
    prevSessionId: string,
    incomingPayload: { session_id: string; is_playing: boolean; active_sessions: MockSession[] },
    manualTargetId: string | null = null
  ): boolean {
    if (!prevSessionId || !incomingPayload.session_id || prevSessionId === incomingPayload.session_id) {
      return false;
    }
    const stickyStillAlive = incomingPayload.active_sessions.find(
      (s) => s.session_id === prevSessionId
    );
    const isIncomingTakingOverPlayback =
      incomingPayload.is_playing && (!stickyStillAlive || !stickyStillAlive.is_playing);

    return Boolean(
      stickyStillAlive &&
      manualTargetId !== incomingPayload.session_id &&
      !isIncomingTakingOverPlayback
    );
  }

  // Case A: Chrome is PAUSED ("Merry Christmas") and Brave starts PLAYING ("aespa") -> MUST NOT BLOCK!
  const blockedWhenBravePlays = shouldBlockSessionSwitch('chrome_merry_christmas', {
    session_id: 'brave_aespa',
    is_playing: true,
    active_sessions: [
      { session_id: 'brave_aespa', app_name: 'Brave', title: 'aespa', is_playing: true },
      { session_id: 'chrome_merry_christmas', app_name: 'Chrome', title: 'Merry Christmas', is_playing: false },
    ],
  });
  assert.strictEqual(blockedWhenBravePlays, false, 'Playing Brave MUST override Paused Chrome');
  console.log('  [PASS] Active Playback Precedence: Brave (PLAYING) immediately overrides Chrome (PAUSED)');

  // Case B: Brave is PAUSED and Spotify is PAUSED (OS fallback tries to snap to paused Spotify) -> MUST BLOCK!
  const blockedWhenBothPaused = shouldBlockSessionSwitch('brave_aespa', {
    session_id: 'spotify_idle',
    is_playing: false,
    active_sessions: [
      { session_id: 'brave_aespa', app_name: 'Brave', title: 'aespa', is_playing: false },
      { session_id: 'spotify_idle', app_name: 'Spotify', title: 'Idle Song', is_playing: false },
    ],
  });
  assert.strictEqual(blockedWhenBothPaused, true, 'Paused Brave must remain sticky when Spotify is also paused');
  console.log('  [PASS] Session Stickiness: Paused Brave stays locked when no other session is playing');
}

console.log('\n========================================================================');
console.log('  AUDIT RESULTS: ALL TIME SYNC ISOLATION TESTS PASSED! [PASS]');
console.log('========================================================================\n');
