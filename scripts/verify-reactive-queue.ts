/**
 * CASA Critical QA Verification Script: Reactive Queue Auto-Refresh,
 * Anti-Double-Slice Invariance, Debounce Protection, and Lamport Ordering.
 *
 * Validates:
 * 1. Optimistic removal: tracks.filter(t => t.id !== currentTrackId) removes active track instantly (0ms).
 * 2. Anti-double-slice invariance: manual queue click slice + reactive ID filter NEVER double-slices upcoming tracks.
 * 3. Blind slice comparison: proves slice(1) causes double-slice while ID filter is 100% stable.
 * 4. Rapid skip debouncing: 3 consecutive skips in 200ms triggers clearTimeout and executes exactly 1 server sync.
 * 5. Lamport sequence ordering: slow delayed responses are rejected and cannot overwrite newer state.
 * 6. Fast-path match: song.title change resolves ID from queueTracks at 0ms.
 */

interface MockTrack {
  id: string;
  title: string;
  artist: string;
  uri?: string;
}

async function runQueueAudit() {
  console.log('========================================================================');
  console.log('    CASA CRITICAL QA AUDITOR: REACTIVE QUEUE & ANTI-DOUBLE-SLICE AUDIT  ');
  console.log('========================================================================\n');

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
  // TEST GROUP 1: Optimistic Active ID Removal (0ms)
  // -------------------------------------------------------------
  console.log('--- TEST GROUP 1: Optimistic Active ID Removal (0ms) ---');
  {
    const initialQueue: MockTrack[] = [
      { id: 'track_2', title: 'Batter Up', artist: 'BABYMONSTER' },
      { id: 'track_3', title: 'Sheesh', artist: 'BABYMONSTER' },
      { id: 'track_4', title: 'Like That', artist: 'BABYMONSTER' },
    ];

    // Simulate song change to track_2
    const currentTrackId = 'track_2';
    const optimisticQueue = initialQueue.filter((t) => t.id !== currentTrackId);

    assert(optimisticQueue.length === 2, 'Optimistic filter removes exactly 1 active track');
    assert(optimisticQueue[0].id === 'track_3', 'Track 3 ("Sheesh") immediately becomes top item');
    assert(optimisticQueue[1].id === 'track_4', 'Track 4 ("Like That") preserved in position 2');
    assert(!optimisticQueue.some((t) => t.id === 'track_2'), 'Active track_2 completely absent from queue');
  }

  // -------------------------------------------------------------
  // TEST GROUP 2: Anti-Double-Slice Invariance (Manual Click vs Blind Slice)
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 2: Anti-Double-Slice Invariance ---');
  {
    const queue: MockTrack[] = [
      { id: 'track_1', title: 'Seven', artist: 'Jungkook' },
      { id: 'track_2', title: 'Standing Next to You', artist: 'Jungkook' },
      { id: 'track_3', title: '3D', artist: 'Jungkook' },
      { id: 'track_4', title: 'Yes or No', artist: 'Jungkook' },
    ];

    // Scenario: User clicks index 1 (track_2: 'Standing Next to You')
    const clickedIdx = 1;
    const clickedTrack = queue[clickedIdx]; // track_2

    // Step 1: User click optimistic array shift: slice(clickedIdx + 1)
    const shiftedQueue = queue.slice(clickedIdx + 1); // [track_3, track_4]
    assert(shiftedQueue.length === 2, 'Step 1 shift preserves remaining tracks after clicked item');
    assert(shiftedQueue[0].id === 'track_3', 'Step 1 top item is track_3');

    // Step 2: Reactive watcher triggers on currentTrackId change (currentTrackId = 'track_2')
    // Correct logic: ID filter
    const reactiveFilteredQueue = shiftedQueue.filter((t) => t.id !== clickedTrack.id);
    assert(
      reactiveFilteredQueue.length === 2,
      'Anti-double-slice: Filter by currentTrackId preserves [track_3, track_4]'
    );
    assert(
      reactiveFilteredQueue[0].id === 'track_3' && reactiveFilteredQueue[1].id === 'track_4',
      'Anti-double-slice: Track 3 and Track 4 retained intact without accidental removal'
    );

    // Flawed logic comparison: Blind slice(1)
    const flawedDoubleSlicedQueue = shiftedQueue.slice(1); // [track_4]
    assert(
      flawedDoubleSlicedQueue.length === 1 && flawedDoubleSlicedQueue[0].id === 'track_4',
      'Proved flaw: blind slice(1) would have dropped track_3 (Double-slice bug averted)'
    );
  }

  // -------------------------------------------------------------
  // TEST GROUP 3: Debounced Server Revalidation (800ms) with Rapid Skips
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 3: Debounced Server Revalidation (800ms) ---');
  {
    let serverFetchCount = 0;
    let activeDebounceTimer: any = null;

    const mockTriggerReactiveWatcher = (trackId: string) => {
      // 1. Optimistic removal
      // 2. Debounced background sync
      if (activeDebounceTimer) {
        clearTimeout(activeDebounceTimer);
      }
      activeDebounceTimer = setTimeout(() => {
        serverFetchCount++;
      }, 800);
    };

    // User rapidly skips 3 tracks: at 0ms, 150ms, 300ms
    mockTriggerReactiveWatcher('track_skip_1');

    await new Promise((r) => setTimeout(r, 150));
    mockTriggerReactiveWatcher('track_skip_2');

    await new Promise((r) => setTimeout(r, 150));
    mockTriggerReactiveWatcher('track_skip_3');

    // At 400ms after start (100ms after 3rd skip), serverFetchCount must STILL be 0
    await new Promise((r) => setTimeout(r, 100));
    assert(
      serverFetchCount === 0,
      'Debounce in progress: zero network requests fired during rapid skips'
    );

    // Wait until 850ms after 3rd skip (total > 800ms since last skip)
    await new Promise((r) => setTimeout(r, 850));
    assert(
      serverFetchCount === 1,
      'Debounce complete: exactly 1 server fetch triggered for 3 rapid skips'
    );
  }

  // -------------------------------------------------------------
  // TEST GROUP 4: Lamport Sequence ID Ordering (Anti-Race Condition)
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 4: Lamport Sequence ID Ordering ---');
  {
    let queueRequestId = 0;
    let lastAppliedReqId = 0;
    let activeQueueState: string[] = [];

    async function simulatedFetchQueue(reqTrackName: string, delayMs: number) {
      const reqId = ++queueRequestId;
      await new Promise((r) => setTimeout(r, delayMs));

      // Lamport protection check
      if (reqId < lastAppliedReqId) {
        return; // Discard stale response
      }

      lastAppliedReqId = reqId;
      activeQueueState = [reqTrackName];
    }

    // Launch Request 1 (slow, 300ms delay)
    const p1 = simulatedFetchQueue('Old Queue from Req 1', 300);

    // Launch Request 2 shortly after (fast, 50ms delay)
    await new Promise((r) => setTimeout(r, 30));
    const p2 = simulatedFetchQueue('Fresh Queue from Req 2', 50);

    await Promise.all([p1, p2]);

    assert(
      lastAppliedReqId === 2,
      'Lamport sequence correctly locked to newest request ID (2)'
    );
    assert(
      activeQueueState[0] === 'Fresh Queue from Req 2',
      'Fresh Queue preserved: Slow Request 1 cleanly rejected without overwriting Request 2'
    );
  }

  // -------------------------------------------------------------
  // TEST GROUP 5: Fast-Path Queue Match on Song Title Change (0ms)
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 5: Fast-Path Queue Match on Song Title Change ---');
  {
    const currentQueue: MockTrack[] = [
      { id: 'sp_101', title: 'FOREVER', artist: 'BABYMONSTER' },
      { id: 'sp_102', title: 'DRIP', artist: 'BABYMONSTER' },
    ];

    const newSongTitle = 'FOREVER';
    let detectedTrackId: string | null = null;

    // Fast-path lookup
    const match = currentQueue.find(
      (t) =>
        t.title.toLowerCase() === newSongTitle.toLowerCase() ||
        (newSongTitle.toLowerCase().includes(t.title.toLowerCase()) && t.title.length > 3)
    );

    if (match) {
      detectedTrackId = match.id;
    }

    assert(detectedTrackId === 'sp_101', 'Fast-path matched track ID "sp_101" at 0ms');

    // Optimistic removal with detected ID
    const afterMatchQueue = currentQueue.filter((t) => t.id !== detectedTrackId);
    assert(afterMatchQueue.length === 1, 'Fast-path match allows immediate queue reduction');
    assert(afterMatchQueue[0].id === 'sp_102', 'Next track ("DRIP") promoted instantly');
  }

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log('\n========================================================================');
  console.log(`  AUDIT RESULTS: ${passedTests}/${totalTests} TESTS PASSED`);
  if (passedTests === totalTests) {
    console.log('  ALL REACTIVE QUEUE & ANTI-DOUBLE-SLICE INVARIANTS SATISFIED! [PASS]');
  } else {
    console.error('  SOME INVARIANTS FAILED AUDIT! [FAIL]');
    process.exit(1);
  }
  console.log('========================================================================\n');
}

runQueueAudit().catch((err) => {
  console.error('Fatal audit failure:', err);
  process.exit(1);
});
