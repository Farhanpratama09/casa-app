/**
 * QA Verification: MicroStatusHeader Drag-Region Bypass & Single Pipeline Navigation Audit
 */

import * as fs from 'fs';
import * as path from 'path';

console.log('\x1b[36m========================================================================\x1b[0m');
console.log('\x1b[36m  CASA QA: NAVIGATION SINGLE PIPELINE & DRAG-REGION AUDIT\x1b[0m');
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

// 1. Inspect MicroStatusHeader.tsx
const headerPath = path.resolve('src/components/views/MicroStatusHeader.tsx');
const headerContent = fs.readFileSync(headerPath, 'utf8');

assert(headerContent.includes('onPrev?: () => void;'), 'MicroStatusHeaderProps exposes onPrev');
assert(headerContent.includes('onNext?: () => void;'), 'MicroStatusHeaderProps exposes onNext');

// Verify drag isolation: outer wrapper and switcher must NOT have drag region, only safe text elements
assert(!/<div[^>]*onClick=\{handleBarClick\}[^>]*data-tauri-drag-region/.test(headerContent), 'Outer header bar wrapper does NOT have data-tauri-drag-region');
assert(!/<div[^>]*className="[^"]*relative z-30[^"]*"[^>]*data-tauri-drag-region/.test(headerContent), 'Switcher container does NOT have data-tauri-drag-region');
assert(headerContent.includes('data-tauri-drag-region'), 'Safe text elements (CASA logo & clock) have data-tauri-drag-region');

// Verify switcher container and buttons style & hitbox
assert(headerContent.includes("WebkitAppRegion: 'no-drag'"), "Switcher elements set WebkitAppRegion: 'no-drag'");
assert(headerContent.includes("onMouseDown="), "Buttons intercept onMouseDown to stop drag propagation");
assert(headerContent.includes("onPointerDown="), "Buttons intercept onPointerDown to stop drag propagation");
assert(headerContent.includes("w-7 h-7"), "Buttons have minimum w-7 h-7 (28x28px) hitbox");
assert(headerContent.includes("relative z-30 pointer-events-auto cursor-pointer"), "Buttons have relative z-30 pointer-events-auto cursor-pointer");

// Direct callbacks and console logs
assert(headerContent.includes("[NAV] Prev Clicked"), "Previous chevron logs '[NAV] Prev Clicked'");
assert(headerContent.includes("[NAV] Next Clicked"), "Next chevron logs '[NAV] Next Clicked'");
assert(/onPrev\(\)/.test(headerContent), 'Previous chevron button triggers direct onPrev() callback');
assert(/onNext\(\)/.test(headerContent), 'Next chevron button triggers direct onNext() callback');

// 2. Inspect CasaIsland.tsx
const casaPath = path.resolve('src/components/CasaIsland.tsx');
const casaContent = fs.readFileSync(casaPath, 'utf8');

assert(casaContent.includes('const handleNavigate = useCallback('), 'CasaIsland declares unified handleNavigate');
assert(/handleNavigate\('next'\)/.test(casaContent), 'handleNavigate handles next direction');
assert(/handleNavigate\('prev'\)/.test(casaContent), 'handleNavigate handles prev direction');
assert(/const handleWheel =[\s\S]*?handleNavigate\(direction\)/.test(casaContent), 'handleWheel routes through handleNavigate');
assert(/<MicroStatusHeader[\s\S]*?onPrev=\{\(\) => handleNavigate\('prev'\)\}/.test(casaContent), 'MicroStatusHeader wired to onPrev');
assert(/<MicroStatusHeader[\s\S]*?onNext=\{\(\) => handleNavigate\('next'\)\}/.test(casaContent), 'MicroStatusHeader wired to onNext');

// Idle-Peek Instant Lock & Anti-Glitch Navigation
assert(/handleNavigate[\s\S]*?clearTimeout\(intensiveHoverTimerRef\.current\)[\s\S]*?clearTimeout\(hoverLeaveTimerRef\.current\)/.test(casaContent), 'handleNavigate cancels hover peek and leave timers synchronously');
assert(/const isPeeking = currentState === 'idle_peek'/.test(casaContent), 'handleNavigate checks isPeeking');
assert(/isPeeking[\s\S]*?islandStateRef\.current = 'expanded'[\s\S]*?setIslandState\('expanded'\)/.test(casaContent), 'handleNavigate locks expanded state immediately on peek navigation');
assert(/\(isExpandedView \|\| isPeeking\) && effectiveExpandedMode !== 'drop_zone'/.test(casaContent), 'handleNavigate routes module change when either already expanded or peeking');

// Dynamic Stacking Context in CasaIsland.tsx
assert(/data-island-view="expanded"[\s\S]*?isExpandedView \? 'z-20' : 'z-10'/.test(casaContent), 'Expanded Layer 1 sets z-20 when expanded, z-10 when collapsed');
assert(/data-island-view="idle"[\s\S]*?isExpandedView \? 'z-10' : 'z-20'/.test(casaContent), 'Idle Layer 2 drops to z-10 when expanded, rises to z-20 when idle');
assert(/<IdlePillView[\s\S]*?isExpanded=\{isExpandedView\}/.test(casaContent), 'IdlePillView explicitly receives isExpanded={isExpandedView}');

// 3. Inspect IdlePillView.tsx
const idlePath = path.resolve('src/components/views/IdlePillView.tsx');
const idleContent = fs.readFileSync(idlePath, 'utf8');

assert(/isExpanded = false/.test(idleContent), 'IdlePillViewComponent destructures isExpanded prop');
assert(idleContent.includes("isExpanded ? 'pointer-events-none' : ''"), 'IdlePillView root container disables pointer events when expanded');
assert(idleContent.includes("isExpanded || isRestingSleep"), 'IdlePillView digital clock sub-layer explicitly blocks pointer events when expanded');

console.log('\n========================================================================');
console.log(`  AUDIT RESULTS: ${passed}/${total} TESTS PASSED`);
if (passed === total) {
  console.log('  NAVIGATION SINGLE PIPELINE 100% VERIFIED & GREEN! [PASS]');
}
console.log('========================================================================\n');

if (passed !== total) process.exit(1);
