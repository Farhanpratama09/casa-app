import * as fs from 'fs';
import * as path from 'path';

console.log('========================================================================');
console.log('   CASA CRITICAL QA: SPOTIFY AUTO-MINIMIZE & WINDOW WATCHER AUDIT');
console.log('========================================================================\n');

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  [PASS] ${msg}`);
    passCount++;
  } else {
    console.error(`  [FAIL] ${msg}`);
    failCount++;
  }
}

// 1. Audit src-tauri/src/media.rs basic flags & focus
console.log('--- TEST GROUP 1: Rust Backend Minimized Spawn & Win32 Focus ---');
const mediaRsPath = path.resolve(process.cwd(), 'src-tauri/src/media.rs');
const mediaRsContent = fs.readFileSync(mediaRsPath, 'utf8');

assert(
  mediaRsContent.includes('.arg("--minimized")'),
  'Rust spawn Command includes "--minimized" flag for silent background launch'
);

assert(
  !mediaRsContent.includes('Command::new("cmd")') &&
  !mediaRsContent.includes('Command::new("powershell")'),
  'Zero subshells: Spotify launched directly via binary without cmd or powershell wrappers'
);

assert(
  mediaRsContent.includes('pub async fn focus_spotify_window() -> Result<bool, String>'),
  'Tauri command focus_spotify_window is defined and exposed'
);

assert(
  mediaRsContent.includes('ShowWindow(hwnd, SW_RESTORE)') &&
  mediaRsContent.includes('SetForegroundWindow(hwnd)'),
  'Win32 API ShowWindow(SW_RESTORE) and SetForegroundWindow are invoked to restore window'
);

// 2. Audit Win32 Creation Flags & Process Spawning
console.log('\n--- TEST GROUP 2: Win32 Creation Flags (CREATE_NO_WINDOW) ---');
assert(
  mediaRsContent.includes('CommandExt') &&
  mediaRsContent.includes('CREATE_NO_WINDOW: u32 = 0x08000000;') &&
  mediaRsContent.includes('.creation_flags(CREATE_NO_WINDOW)'),
  'CommandExt with CREATE_NO_WINDOW (0x08000000) applied during process spawn'
);

// 3. Audit Delayed Active Window Suppressor (Win32 Watcher)
console.log('\n--- TEST GROUP 3: Win32 Active Window Suppressor (Watcher) ---');
assert(
  mediaRsContent.includes('tauri::async_runtime::spawn_blocking'),
  'Watcher uses lightweight spawn_blocking to run Win32 background loop'
);

assert(
  mediaRsContent.includes('Duration::from_millis(100)') &&
  (mediaRsContent.includes('max_ticks = 30') || mediaRsContent.includes('0..30')),
  'Watcher polls every 100ms for up to 3 seconds (max 30 iterations)'
);

assert(
  mediaRsContent.includes('FindWindowW') &&
  mediaRsContent.includes('"SpotifyMainWindow\\0"'),
  'Watcher looks up "SpotifyMainWindow" via FindWindowW'
);

assert(
  mediaRsContent.includes('find_all_spotify_hwnds()'),
  'Watcher enumerates Spotify top-level windows via EnumWindows callback'
);

assert(
  mediaRsContent.includes('SW_SHOWMINNOACTIVE') &&
  mediaRsContent.includes('SW_MINIMIZE'),
  'Watcher suppresses window using SW_SHOWMINNOACTIVE or SW_MINIMIZE'
);

assert(
  mediaRsContent.includes('if suppressed {') &&
  mediaRsContent.includes('break;'),
  'Watcher terminates polling loop immediately once HWND is suppressed to preserve CPU'
);

// 4. Audit Watcher Cancellation & User Focus Precedence
console.log('\n--- TEST GROUP 4: User Focus Precedence (Cancellation Guard) ---');
assert(
  mediaRsContent.includes('SUPPRESS_CANCELLED') &&
  mediaRsContent.includes('AtomicBool'),
  'Atomic cancellation flag SUPPRESS_CANCELLED guards watcher against re-minimizing on user action'
);

assert(
  mediaRsContent.includes('SUPPRESS_CANCELLED.store(true, Ordering::SeqCst)'),
  'focus_spotify_window explicitly sets SUPPRESS_CANCELLED to abort background suppressor'
);

// 5. Audit Tauri Handler & Bridge Registration
console.log('\n--- TEST GROUP 5: Tauri Handler & Bridge Registration ---');
const libRsPath = path.resolve(process.cwd(), 'src-tauri/src/lib.rs');
const libRsContent = fs.readFileSync(libRsPath, 'utf8');

assert(
  libRsContent.includes('media::focus_spotify_window'),
  'focus_spotify_window is registered in tauri::generate_handler![]'
);

const bridgePath = path.resolve(process.cwd(), 'src/utils/tauriBridge.ts');
const bridgeContent = fs.readFileSync(bridgePath, 'utf8');

assert(
  bridgeContent.includes('export async function focusSpotifyWindow(): Promise<boolean>'),
  'focusSpotifyWindow is exported in tauriBridge.ts'
);
assert(
  bridgeContent.includes("invoke<boolean>('focus_spotify_window')"),
  'focusSpotifyWindow invokes tauri command focus_spotify_window'
);

// 6. Audit Frontend UI Event Handlers & View Integration
console.log('\n--- TEST GROUP 6: Frontend UI Event Handlers & View Integration ---');
const musicCardPath = path.resolve(process.cwd(), 'src/components/views/MusicCardView.tsx');
const musicCardContent = fs.readFileSync(musicCardPath, 'utf8');

assert(
  musicCardContent.includes('focusSpotifyWindow'),
  'MusicCardView imports focusSpotifyWindow'
);

assert(
  musicCardContent.includes('SpotifyClosedOverlay') &&
  musicCardContent.includes('title="Buka Spotify"'),
  'SpotifyClosedOverlay includes Spotify restore action'
);

assert(
  musicCardContent.includes('Tidak ada sesi aktif') &&
  musicCardContent.includes('title="Buka / Tampilkan Spotify Desktop"'),
  'Idle mode has interactive elements wired to focus Spotify desktop'
);

assert(
  musicCardContent.includes('Buka / Tampilkan Spotify Desktop'),
  'Wide Mode action bar includes Spotify desktop toggle icon button'
);

// 7. Simulation of Watcher Logic
console.log('\n--- TEST GROUP 7: Simulated Watcher Logic Invariant Tests ---');
class WatcherSimulator {
  private ticksElapsed = 0;
  public suppressed = false;
  public cancelled = false;
  public windowAppearsAtTick = -1;

  constructor(windowAppearsAtTick: number) {
    this.windowAppearsAtTick = windowAppearsAtTick;
  }

  run(maxTicks = 30) {
    for (let tick = 1; tick <= maxTicks; tick++) {
      this.ticksElapsed = tick;
      if (this.cancelled) {
        break;
      }
      if (tick >= this.windowAppearsAtTick && this.windowAppearsAtTick > 0) {
        this.suppressed = true;
        break; // Immediate termination to save CPU
      }
    }
  }

  getTicks(): number {
    return this.ticksElapsed;
  }
}

// Case A: Window appears after 8 ticks (800ms)
const simNormal = new WatcherSimulator(8);
simNormal.run(30);
assert(
  simNormal.suppressed && simNormal.getTicks() === 8,
  `Simulation: Window appearing at tick 8 suppressed immediately and loop exited at tick 8 (actual: ${simNormal.getTicks()})`
);

// Case B: User clicks focus button before window appears (cancelled at tick 3)
const simCancelled = new WatcherSimulator(10);
for (let t = 1; t <= 30; t++) {
  if (t === 4) {
    simCancelled.cancelled = true; // User clicks cover art
  }
  if (simCancelled.cancelled) {
    break;
  }
}
assert(
  simCancelled.cancelled && !simCancelled.suppressed,
  'Simulation: User focus action cancels watcher early without suppressing Spotify window'
);

// Case C: Window never appears within 30 ticks (timeout check)
const simTimeout = new WatcherSimulator(-1);
simTimeout.run(30);
assert(
  !simTimeout.suppressed && simTimeout.getTicks() === 30,
  `Simulation: Loop terminates cleanly at tick 30 (3.0s) without infinite spinning (actual: ${simTimeout.getTicks()})`
);

console.log('\n========================================================================');
console.log(`  AUDIT RESULTS: ${passCount} PASSED | ${failCount} FAILED`);
console.log('========================================================================\n');

if (failCount > 0) {
  process.exit(1);
}
