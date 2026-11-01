/**
 * CASA Critical QA Verification Script: Monotonic Playback Progress,
 * Anti-Jitter/Rubberbanding Guard, Smooth Clock Interpolation, and Lyric Hysteresis.
 *
 * Validates:
 * 1. Network Jitter Resilience: Sequence [1000ms, 1200ms, 1150ms (jitter), 1400ms]
 *    ensures progress and active lyric index NEVER regress backward.
 * 2. Manual Backward Seek: Large backward delta (10000ms -> 2000ms, diff > 1500ms)
 *    is recognized as a deliberate user seek and updates immediately.
 * 3. Boundary Hysteresis: 50ms threshold prevents premature line flipping and boundary flicker.
 * 4. Monotonic Lock: Lyric lines only advance forward during normal continuous playback.
 */

interface MockLyricLine {
  id: string;
  time: number;
  timeMs: number;
  text: string;
}

// Emulates the exact computeRawLyricIndex & applyProgressUpdate logic from MusicCardView.tsx
class MonotonicLyricsEngine {
  private lastReportedTimeMs: number = 0;
  private lastSyncLocalTime: number = 0;
  private preciseTimeMs: number = 0;
  private activeLyricIndex: number = -1;
  private lastActiveIndex: number = -1;
  private lastSeekTime: number = 0;
  private isPlaying: boolean = true;
  private lines: MockLyricLine[] = [];

  constructor(lines: MockLyricLine[], initialTimeMs: number = 0) {
    this.lines = lines;
    this.lastReportedTimeMs = initialTimeMs;
    this.lastSyncLocalTime = 100000; // Simulated reference time
    this.preciseTimeMs = initialTimeMs;
  }

  public computeRawLyricIndex(lines: MockLyricLine[], timeMs: number): number {
    if (!lines || lines.length === 0) return -1;
    const firstLineMs = lines[0].timeMs;

    if (timeMs < firstLineMs && firstLineMs > 3000) {
      return -1;
    }

    let activeIdx = 0;
    // 50ms Hysteresis band
    for (let i = 1; i < lines.length; i++) {
      if (timeMs >= lines[i].timeMs + 50) {
        activeIdx = i;
      } else {
        break;
      }
    }
    return activeIdx;
  }

  public applyProgressUpdate(
    newMs: number,
    simulatedNow: number,
    isForceSeekOrTrackChange: boolean = false
  ) {
    const currentLocalMs =
      this.lastReportedTimeMs + (this.isPlaying ? simulatedNow - this.lastSyncLocalTime : 0);
    const backwardDiff = currentLocalMs - newMs;
    const forwardDiff = newMs - currentLocalMs;

    // 1. Force Seek or Track Change
    if (isForceSeekOrTrackChange) {
      this.lastReportedTimeMs = newMs;
      this.lastSyncLocalTime = simulatedNow;
      this.preciseTimeMs = newMs;
      this.lastSeekTime = simulatedNow;

      const newIdx = this.computeRawLyricIndex(this.lines, newMs + 350);
      this.lastActiveIndex = newIdx;
      this.activeLyricIndex = newIdx;
      return;
    }

    // 2. Monotonic Progress Guard (Anti-Lompat Mundur)
    if (backwardDiff > 0) {
      // Large backward jump (> 1500ms): manual backward seek
      if (backwardDiff > 1500) {
        this.lastReportedTimeMs = newMs;
        this.lastSyncLocalTime = simulatedNow;
        this.preciseTimeMs = newMs;
        this.lastSeekTime = simulatedNow;

        const newIdx = this.computeRawLyricIndex(this.lines, newMs + 350);
        this.lastActiveIndex = newIdx;
        this.activeLyricIndex = newIdx;
        return;
      }

      // Small backward drift (< 1500ms): Jitter from network latency -> strictly ignored!
      return;
    }

    // 3. Forward Progress
    if (forwardDiff > 1500) {
      this.lastReportedTimeMs = newMs;
      this.lastSyncLocalTime = simulatedNow;
      this.preciseTimeMs = newMs;
      this.lastSeekTime = simulatedNow;

      const newIdx = this.computeRawLyricIndex(this.lines, newMs + 350);
      this.lastActiveIndex = newIdx;
      this.activeLyricIndex = newIdx;
      return;
    }

    // Soft nudge for forward drift (100ms - 1500ms)
    if (forwardDiff > 100) {
      const nudged = currentLocalMs + forwardDiff * 0.3;
      this.lastReportedTimeMs = nudged;
      this.lastSyncLocalTime = simulatedNow;
      this.preciseTimeMs = nudged;
    }
  }

  // Simulates 60FPS tick
  public tick(simulatedNow: number) {
    const elapsed = simulatedNow - this.lastSyncLocalTime;
    const currentMs = this.lastReportedTimeMs + elapsed;
    this.preciseTimeMs = currentMs;

    const adjustedTime = currentMs + 350;
    const rawIdx = this.computeRawLyricIndex(this.lines, adjustedTime);

    // Monotonic lyric lock & hysteresis
    if (rawIdx >= this.lastActiveIndex) {
      if (rawIdx !== this.lastActiveIndex) {
        this.lastActiveIndex = rawIdx;
        this.activeLyricIndex = rawIdx;
      }
    } else {
      if (simulatedNow - this.lastSeekTime < 500) {
        this.lastActiveIndex = rawIdx;
        this.activeLyricIndex = rawIdx;
      }
    }
  }

  public getPreciseTimeMs(): number {
    return this.preciseTimeMs;
  }

  public getActiveLyricIndex(): number {
    return this.activeLyricIndex;
  }
}

async function runMonotonicLyricsAudit() {
  console.log('========================================================================');
  console.log('  CASA CRITICAL QA AUDITOR: MONOTONIC PROGRESS & LYRICS JITTER GUARD    ');
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

  const mockLines: MockLyricLine[] = [
    { id: '1', time: 0.8, timeMs: 800, text: 'First opening vocal line' },
    { id: '2', time: 1.2, timeMs: 1200, text: 'Second progressing line' },
    { id: '3', time: 2.0, timeMs: 2000, text: 'Chorus melody line' },
    { id: '4', time: 8.0, timeMs: 8000, text: 'Bridge melody line' },
  ];

  // -------------------------------------------------------------
  // TEST GROUP 1: Network Jitter Sequence [1000, 1200, 1150 (jitter), 1400]
  // -------------------------------------------------------------
  console.log('--- TEST GROUP 1: Network Jitter Sequence & Anti-Rubberbanding ---');
  {
    const engine = new MonotonicLyricsEngine(mockLines, 1000);
    let simTime = 100000;

    // Packet 1: 1000ms (Initial sync)
    engine.applyProgressUpdate(1000, simTime, true);
    engine.tick(simTime);
    assert(engine.getPreciseTimeMs() === 1000, 'Packet 1: Clock initialized to 1000ms');

    // Simulate playback advancing 200ms
    simTime += 200;
    engine.tick(simTime);
    assert(engine.getPreciseTimeMs() === 1200, 'Playback advanced smoothly to 1200ms');

    // Packet 2: 1200ms arrives
    engine.applyProgressUpdate(1200, simTime);
    assert(engine.getPreciseTimeMs() === 1200, 'Packet 2 (1200ms): Sync confirmed');
    const indexAt1200 = engine.getActiveLyricIndex();

    // Packet 3: 1150ms arrives late due to network latency (JITTER!)
    // Current local clock is at 1200ms.
    engine.applyProgressUpdate(1150, simTime);
    engine.tick(simTime);

    assert(
      engine.getPreciseTimeMs() >= 1200,
      `Anti-Rubberbanding: Clock did NOT jump back to 1150ms (Current: ${engine.getPreciseTimeMs()}ms)`
    );
    assert(
      engine.getActiveLyricIndex() >= indexAt1200,
      `Monotonic Line: Lyric index did NOT regress backward (Index: ${engine.getActiveLyricIndex()})`
    );

    // Simulate playback advancing another 200ms to 1400ms
    simTime += 200;
    engine.tick(simTime);

    // Packet 4: 1400ms arrives
    engine.applyProgressUpdate(1400, simTime);
    engine.tick(simTime);
    assert(
      engine.getPreciseTimeMs() >= 1400,
      `Smooth Forward: Clock successfully advanced to ${engine.getPreciseTimeMs()}ms`
    );
  }

  // -------------------------------------------------------------
  // TEST GROUP 2: Manual User Seek Backwards (10000ms -> 2000ms)
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 2: Manual User Seek Backwards ---');
  {
    const engine = new MonotonicLyricsEngine(mockLines, 9500);
    let simTime = 200000;

    // Song at 10000ms (Line 4: Bridge)
    engine.applyProgressUpdate(10000, simTime, true);
    engine.tick(simTime);
    assert(engine.getPreciseTimeMs() === 10000, 'Clock at 10000ms');
    assert(engine.getActiveLyricIndex() === 3, 'Lyric active at Line 4 (Bridge)');

    // User scrubs backward to 2000ms (diff: 8000ms > 1500ms seek threshold)
    simTime += 50;
    engine.applyProgressUpdate(2000, simTime);
    engine.tick(simTime);

    assert(
      engine.getPreciseTimeMs() === 2000,
      'Seek Detection: Manual backward seek accepted (Clock reset to 2000ms)'
    );
    assert(
      engine.getActiveLyricIndex() === 2,
      'Seek Lyrics Sync: Lyric index smoothly jumped back to Line 3 (Chorus at 2000ms)'
    );
  }

  // -------------------------------------------------------------
  // TEST GROUP 3: 50ms Hysteresis Boundary Tolerance
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 3: 50ms Hysteresis Boundary Tolerance ---');
  {
    // Line 1 starts at 800ms, Line 2 starts at 1200ms (threshold: 1200 + 50 = 1250ms)
    // Timestamp 1220ms (< 1250ms) -> remains at index 0 (Line 1)
    // Timestamp 1260ms (>= 1250ms) -> transitions to index 1 (Line 2)
    const engine = new MonotonicLyricsEngine(mockLines, 850);
    const rawBelowThreshold = engine.computeRawLyricIndex(mockLines, 1220); // 1220 < 1250
    const rawAboveThreshold = engine.computeRawLyricIndex(mockLines, 1260); // 1260 >= 1250

    assert(
      rawBelowThreshold === 0,
      'Hysteresis: Timestamp 1220ms (< 1250ms) stays at Line 1 (idx 0) to prevent boundary flicker'
    );
    assert(
      rawAboveThreshold === 1,
      'Hysteresis: Timestamp 1260ms (>= 1250ms) cleanly transitions to Line 2 (idx 1)'
    );
  }

  // -------------------------------------------------------------
  // TEST GROUP 4: Comparative Monotonic Proof
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 4: Comparative Monotonic Proof ---');
  {
    const engine = new MonotonicLyricsEngine(mockLines, 800);
    let simTime = 300000;
    const progressLog: number[] = [];
    const indexLog: number[] = [];

    // Simulate 10 jittery updates from noisy network polling
    const noisyPackets = [800, 850, 830, 900, 880, 950, 1000, 990, 1100, 1050];
    for (const pkt of noisyPackets) {
      simTime += 50;
      engine.applyProgressUpdate(pkt, simTime);
      engine.tick(simTime);
      progressLog.push(engine.getPreciseTimeMs());
      indexLog.push(engine.getActiveLyricIndex());
    }

    let isProgressMonotonic = true;
    for (let i = 1; i < progressLog.length; i++) {
      if (progressLog[i] < progressLog[i - 1]) {
        isProgressMonotonic = false;
        break;
      }
    }

    let isIndexMonotonic = true;
    for (let i = 1; i < indexLog.length; i++) {
      if (indexLog[i] < indexLog[i - 1]) {
        isIndexMonotonic = false;
        break;
      }
    }

    assert(
      isProgressMonotonic,
      `Progress Invariant: All 10 noisy ticks produced strictly non-decreasing progress`
    );
    assert(
      isIndexMonotonic,
      `Index Invariant: All 10 noisy ticks produced strictly non-decreasing lyric line indices`
    );
  }

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log('\n========================================================================');
  console.log(`  AUDIT RESULTS: ${passedTests}/${totalTests} TESTS PASSED`);
  if (passedTests === totalTests) {
    console.log('  ALL MONOTONIC CLOCK & JITTER INVARIANTS SATISFIED! [PASS]');
  } else {
    console.error('  SOME INVARIANTS FAILED AUDIT! [FAIL]');
    process.exit(1);
  }
  console.log('========================================================================\n');
}

runMonotonicLyricsAudit().catch((err) => {
  console.error('Fatal audit failure:', err);
  process.exit(1);
});
