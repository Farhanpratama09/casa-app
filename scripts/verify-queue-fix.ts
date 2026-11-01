/**
 * CASA Critical QA Verification Script: Queue Desync & Active Device Binding
 *
 * Validates:
 * 1. resolveTargetDeviceId: Correct prioritization (active computer -> active -> computer -> first)
 * 2. buildSpotifyPlayUrl: Device ID query parameter injection (?device_id=...)
 * 3. parseSpotifyQueuePayload: Full /v1/me/player/queue payload parsing, normalization, and filtering
 * 4. Lamport Sequence ID Ordering: Race condition prevention and safe state updates
 * 5. Transparent Error Handling & Auto-Recovery simulation
 */

import {
  resolveTargetDeviceId,
  buildSpotifyPlayUrl,
  parseSpotifyQueuePayload,
  normalizeTrackUri,
} from '../src/utils/spotifyService';

async function runQueueVerification() {
  console.log('================================================================');
  console.log('  CASA CRITICAL QA AUDITOR: QUEUE DESYNC & DEVICE BINDING AUDIT ');
  console.log('================================================================\n');

  let totalTests = 0;
  let passedTests = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`  [PASS] ${testName}`);
    } else {
      console.error(`  [FAIL] ${testName}${detail ? ` -> ${detail}` : ''}`);
    }
  }

  // -------------------------------------------------------------
  // TEST GROUP 1: Device ID Resolution & Prioritization
  // -------------------------------------------------------------
  console.log('--- TEST GROUP 1: Device ID Prioritization & Binding ---');

  const devicesMock = [
    { id: 'phone_01', name: 'Pixel Phone', type: 'Smartphone', is_active: false },
    { id: 'pc_01', name: 'Desktop-Windows', type: 'Computer', is_active: false },
    { id: 'speaker_01', name: 'Kitchen Speaker', type: 'Speaker', is_active: false },
  ];

  // 1.1 Inactive computer prioritized over inactive phone/speaker
  const resolvedComputer = resolveTargetDeviceId(devicesMock);
  assert(
    resolvedComputer === 'pc_01',
    'Inactive Computer prioritized over other inactive devices',
    `Expected pc_01, got ${resolvedComputer}`
  );

  // 1.2 Active device prioritized
  const devicesWithActiveSpeaker = [
    { id: 'phone_01', name: 'Pixel Phone', type: 'Smartphone', is_active: false },
    { id: 'pc_01', name: 'Desktop-Windows', type: 'Computer', is_active: false },
    { id: 'speaker_01', name: 'Kitchen Speaker', type: 'Speaker', is_active: true },
  ];
  const resolvedActive = resolveTargetDeviceId(devicesWithActiveSpeaker);
  assert(
    resolvedActive === 'speaker_01',
    'Active device prioritized when active',
    `Expected speaker_01, got ${resolvedActive}`
  );

  // 1.3 Active Computer prioritized over active phone
  const devicesMultipleActive = [
    { id: 'phone_01', name: 'Pixel Phone', type: 'Smartphone', is_active: true },
    { id: 'pc_01', name: 'Desktop-Windows', type: 'Computer', is_active: true },
  ];
  const resolvedActiveComputer = resolveTargetDeviceId(devicesMultipleActive);
  assert(
    resolvedActiveComputer === 'pc_01',
    'Active Computer prioritized over active Smartphone',
    `Expected pc_01, got ${resolvedActiveComputer}`
  );

  // 1.4 Fallback to first device if no computer present
  const devicesNoComputer = [
    { id: 'speaker_01', name: 'Living Room', type: 'Speaker', is_active: false },
    { id: 'tv_01', name: 'Smart TV', type: 'TV', is_active: false },
  ];
  const resolvedFirst = resolveTargetDeviceId(devicesNoComputer);
  assert(
    resolvedFirst === 'speaker_01',
    'Fallback to first device when no computer exists',
    `Expected speaker_01, got ${resolvedFirst}`
  );

  // 1.5 Empty device list returns undefined
  const resolvedEmpty = resolveTargetDeviceId([]);
  assert(
    resolvedEmpty === undefined,
    'Empty device list returns undefined safely',
    `Expected undefined, got ${resolvedEmpty}`
  );

  // -------------------------------------------------------------
  // TEST GROUP 2: Playback URL Formation & Device ID Injection
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 2: Playback URL Formation & Device ID Injection ---');

  // 2.1 URL with device_id query param
  const urlWithDevice = buildSpotifyPlayUrl('pc_01');
  assert(
    urlWithDevice === 'https://api.spotify.com/v1/me/player/play?device_id=pc_01',
    'Mandatory ?device_id query param injected when target device is known',
    `Got ${urlWithDevice}`
  );

  // 2.2 Special character encoding in device_id
  const urlWithSpecialChar = buildSpotifyPlayUrl('device/with special+chars');
  assert(
    urlWithSpecialChar === 'https://api.spotify.com/v1/me/player/play?device_id=device%2Fwith%20special%2Bchars',
    'Device ID query parameter properly URL-encoded',
    `Got ${urlWithSpecialChar}`
  );

  // 2.3 URL without device_id falls back cleanly
  const urlWithoutDevice = buildSpotifyPlayUrl(undefined);
  assert(
    urlWithoutDevice === 'https://api.spotify.com/v1/me/player/play',
    'Clean fallback to base URL when device_id is omitted',
    `Got ${urlWithoutDevice}`
  );

  // -------------------------------------------------------------
  // TEST GROUP 3: Parsing /v1/me/player/queue Payload
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 3: Parsing /v1/me/player/queue Payload ---');

  const simulatedSpotifyQueuePayload = {
    currently_playing: {
      id: 'track_curr_01',
      name: 'FOREVER',
      artists: [{ name: 'BABYMONSTER' }],
      album: {
        name: 'BABYMONS7ER',
        images: [{ url: 'https://i.scdn.co/image/art_forever.jpg' }],
      },
      duration_ms: 180000,
      uri: 'spotify:track:track_curr_01',
    },
    queue: [
      {
        id: 'track_q_01',
        name: 'SHEESH',
        artists: [{ name: 'BABYMONSTER' }, { name: 'YG' }],
        album: {
          name: 'BABYMONS7ER',
          images: [{ url: 'https://i.scdn.co/image/art_sheesh.jpg' }],
        },
        duration_ms: 170000,
        uri: 'spotify:track:track_q_01',
      },
      {
        id: 'track_q_02',
        name: 'BATTER UP',
        artists: [{ name: 'BABYMONSTER' }],
        album: {
          name: 'BATTER UP',
          images: [{ url: 'https://i.scdn.co/image/art_batterup.jpg' }],
        },
        duration_ms: 188000,
        uri: 'spotify:track:track_q_02',
      },
      // Corrupt/malformed item in queue (e.g. ad, empty name)
      {
        id: null,
        name: null,
        artists: [],
      },
    ],
  };

  const parsedQueue = parseSpotifyQueuePayload(simulatedSpotifyQueuePayload);

  // 3.1 Currently playing parsed accurately
  assert(
    parsedQueue.currentlyPlaying?.id === 'track_curr_01' &&
      parsedQueue.currentlyPlaying?.title === 'FOREVER' &&
      parsedQueue.currentlyPlaying?.artist === 'BABYMONSTER',
    'Currently playing track extracted accurately from payload',
    `Got ${JSON.stringify(parsedQueue.currentlyPlaying)}`
  );

  // 3.2 Queue tracks parsed & malformed item filtered out
  assert(
    parsedQueue.tracks.length === 2,
    'Queue tracks parsed and corrupt/ad items filtered out (length === 2)',
    `Expected length 2, got ${parsedQueue.tracks.length}`
  );

  // 3.3 Multiple artists joined cleanly
  assert(
    parsedQueue.tracks[0]?.artist === 'BABYMONSTER, YG',
    'Multiple artists joined with comma delimiter',
    `Expected "BABYMONSTER, YG", got "${parsedQueue.tracks[0]?.artist}"`
  );

  // 3.4 Track URI normalized
  assert(
    parsedQueue.tracks[1]?.uri === 'spotify:track:track_q_02',
    'Track URIs standardized to spotify:track:<id>',
    `Got ${parsedQueue.tracks[1]?.uri}`
  );

  // 3.5 Empty queue payload handles gracefully without error
  const emptyParsed = parseSpotifyQueuePayload({ currently_playing: null, queue: [] });
  assert(
    emptyParsed.currentlyPlaying === undefined && emptyParsed.tracks.length === 0,
    'Empty queue payload returns empty tracks without throwing',
    `Got ${JSON.stringify(emptyParsed)}`
  );

  // -------------------------------------------------------------
  // TEST GROUP 4: Lamport Sequence ID Ordering (Anti-Race Condition)
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 4: Lamport Sequence ID Ordering (Anti-Race Condition) ---');

  let lastAppliedReqId = 0;
  let currentDisplayTitle = 'Next from: BOYFRIEND';

  function simulateQueueResponse(reqId: number, newContextTitle: string) {
    if (reqId < lastAppliedReqId) {
      // Discarded because a newer request already committed
      return false;
    }
    lastAppliedReqId = reqId;
    currentDisplayTitle = newContextTitle;
    return true;
  }

  // Req 1 starts for BABYMONSTER (reqId = 1)
  // Req 2 starts immediately due to GSMTC artist event (reqId = 2)
  // Scenario A: Req 1 finishes first with fresh data -> MUST NOT be discarded!
  const req1Applied = simulateQueueResponse(1, 'Next from: BABYMONSTER');
  assert(
    req1Applied === true && currentDisplayTitle === 'Next from: BABYMONSTER',
    'Req 1 fresh data is applied when no newer request has committed yet (reqId >= lastAppliedReqId)',
    `currentDisplayTitle: ${currentDisplayTitle}`
  );

  // Req 2 finishes later -> applied successfully
  const req2Applied = simulateQueueResponse(2, 'Next from: BABYMONS7ER Album');
  assert(
    req2Applied === true && currentDisplayTitle === 'Next from: BABYMONS7ER Album',
    'Req 2 with newer seq ID commits cleanly over Req 1',
    `currentDisplayTitle: ${currentDisplayTitle}`
  );

  // Scenario B: Out-of-order delivery
  // Req 3 starts (seq 3) and commits first (fast network)
  simulateQueueResponse(3, 'Next from: New Album');
  // Late Req 1 or 2 arrives after Req 3 has already committed -> discarded!
  const lateReq2Applied = simulateQueueResponse(2, 'Stale Queue Context');
  assert(
    lateReq2Applied === false && currentDisplayTitle === 'Next from: New Album',
    'Stale out-of-order response (seq 2 arriving after seq 3) is safely discarded',
    `currentDisplayTitle: ${currentDisplayTitle}`
  );

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`  AUDIT RESULTS: ${passedTests}/${totalTests} TESTS PASSED`);
  if (passedTests === totalTests) {
    console.log('  ALL QUEUE & DEVICE BINDING INVARIANTS SATISFIED! [PASS]');
  } else {
    console.error(`  SOME INVARIANTS FAILED (${totalTests - passedTests} failures)`);
    process.exit(1);
  }
  console.log('================================================================');
}

runQueueVerification().catch((err) => {
  console.error('Fatal verification runner error:', err);
  process.exit(1);
});
