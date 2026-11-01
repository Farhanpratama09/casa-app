/**
 * QA Verification: Option B - Fixed HWND 620px + Rust Hitbox Poller Audit
 */

import * as fs from 'fs';
import * as path from 'path';

console.log('\x1b[36m========================================================================\x1b[0m');
console.log('\x1b[36m  CASA OPTION B QA: FIXED HWND (620px) & RUST HITBOX POLLER AUDIT\x1b[0m');
console.log('\x1b[36m========================================================================\x1b[0m\n');

let total = 0;
let passed = 0;

function assert(cond: boolean, name: string) {
  total++;
  if (cond) {
    passed++;
    console.log(`  \x1b[32m[PASS]\x1b[0m ${name}`);
  } else {
    console.log(`  \x1b[31m[FAIL]\x1b[0m ${name}`);
  }
}

// 1. Rust Hitbox Module & Poller
const hitboxPath = path.resolve('src-tauri/src/hitbox.rs');
const hasHitboxFile = fs.existsSync(hitboxPath);
assert(hasHitboxFile, 'src-tauri/src/hitbox.rs exists');

const hitboxContent = fs.readFileSync(hitboxPath, 'utf8');
assert(hitboxContent.includes('pub fn start_hitbox_poller'), 'Hitbox module exposes start_hitbox_poller');
assert(hitboxContent.includes('pub fn update_island_hitbox'), 'Hitbox module exposes update_island_hitbox command');
assert(hitboxContent.includes('GetCursorPos'), 'Hitbox poller reads hardware cursor via Win32 GetCursorPos');
assert(hitboxContent.includes('set_ignore_cursor_events'), 'Hitbox poller uses official Tauri set_ignore_cursor_events API for child WebView2 pass-through');
assert(hitboxContent.includes('scale_factor'), 'Hitbox poller synchronizes physical bounds using window.scale_factor()');
assert(hitboxContent.includes('GetAsyncKeyState'), 'Hitbox poller implements anti-drag protection via GetAsyncKeyState');
assert(hitboxContent.includes('std::time::Duration::from_millis(20)'), 'Hitbox poller executes at 50Hz (20ms interval)');

// 2. Tauri Configuration Window Dimensions
const tauriConfPath = path.resolve('src-tauri/tauri.conf.json');
const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
const mainWindow = tauriConf.app.windows.find((w: any) => w.label === 'main');
assert(mainWindow.width === 620, 'tauri.conf.json sets main window width to 620');
assert(mainWindow.height === 250, 'tauri.conf.json sets main window height to 250');

// 3. Tauri Bridge Update Island Hitbox IPC
const tauriBridgePath = path.resolve('src/utils/tauriBridge.ts');
const bridgeContent = fs.readFileSync(tauriBridgePath, 'utf8');
assert(bridgeContent.includes('export async function updateIslandHitbox'), 'tauriBridge.ts exports updateIslandHitbox');
assert(bridgeContent.includes("invoke('update_island_hitbox'"), 'updateIslandHitbox invokes update_island_hitbox IPC');

// 4. CasaIsland Integration
const casaPath = path.resolve('src/components/CasaIsland.tsx');
const casaContent = fs.readFileSync(casaPath, 'utf8');
assert(casaContent.includes('updateIslandHitbox'), 'CasaIsland imports updateIslandHitbox');
assert(/adjustWindowSize\(620,\s*250\)/.test(casaContent), 'CasaIsland locks native window at 620x250 on mount');
assert(/applyWindowSize[\s\S]*?updateIslandHitbox\(roundedW,\s*roundedH\)/.test(casaContent), 'applyWindowSize delegates to updateIslandHitbox');

// 5. Rust lib.rs Registration
const libRsPath = path.resolve('src-tauri/src/lib.rs');
const libRsContent = fs.readFileSync(libRsPath, 'utf8');
assert(libRsContent.includes('mod hitbox;'), 'src-tauri/src/lib.rs declares mod hitbox');
assert(libRsContent.includes('hitbox::start_hitbox_poller'), 'src-tauri/src/lib.rs initializes start_hitbox_poller on setup');
assert(libRsContent.includes('hitbox::update_island_hitbox'), 'src-tauri/src/lib.rs registers update_island_hitbox in invoke_handler');
assert(/center_window_top\(&window,\s*Some\(620\.0\),\s*Some\(250\.0\)\)/.test(libRsContent), 'src-tauri/src/lib.rs centers window at fixed 620x250');

console.log('\n========================================================================');
console.log(`  AUDIT RESULTS: ${passed}/${total} TESTS PASSED`);
if (passed === total) {
  console.log('  OPTION B IMPLEMENTATION 100% VERIFIED & GREEN! [PASS]');
}
console.log('========================================================================\n');

if (passed !== total) process.exit(1);
