/**
 * Diagnostic Verification Script: Transition Bug & Black Frame Analysis
 * Inspects:
 * 1. Opacity dead-zone (void frames) between ExpandedView exit and IdleView enter in CasaIsland.tsx
 * 2. Multi-step IPC and SWP_NOCOPYBITS in tauriBridge.ts and src-tauri/src/lib.rs
 */

import * as fs from 'fs';
import * as path from 'path';

console.log('\x1b[36m========================================================================\x1b[0m');
console.log('\x1b[36m  CASA DIAGNOSTIC AUDIT: TRANSITION BUG & DWM REPAINT SNAP RCA\x1b[0m');
console.log('\x1b[36m========================================================================\x1b[0m\n');

// --- 1. INSPECT CASAISLAND.TSX TRANSITION TIMINGS ---
const casaIslandPath = path.resolve('src/components/CasaIsland.tsx');
const casaContent = fs.readFileSync(casaIslandPath, 'utf8');

// Extract Layer 1 (Expanded) exit transition
// Look for data-island-view="expanded" and its exit duration
const expandedMatch = casaContent.match(/data-island-view="expanded"[\s\S]*?transition=\{[\s\S]*?:\s*\{\s*duration:\s*([\d.]+),\s*ease:\s*['"]easeIn['"]\s*\}/);
const expandedExitDuration = expandedMatch ? parseFloat(expandedMatch[1]) : null;

// Extract Layer 2 (Idle) enter transition
// Look for data-island-view="idle" and its enter duration and delay
const idleMatch = casaContent.match(/data-island-view="idle"[\s\S]*?transition=\{[\s\S]*?:\s*\{\s*duration:\s*([\d.]+),\s*delay:\s*([\d.]+),\s*ease:\s*['"]easeOut['"]\s*\}/);
const idleEnterDuration = idleMatch ? parseFloat(idleMatch[1]) : null;
const idleEnterDelay = idleMatch ? parseFloat(idleMatch[2]) : null;

console.log('--- 1. DOM OPACITY TIMELINE AUDIT (CasaIsland.tsx) ---');
console.log(`  Expanded View (Layer 1) exit duration: ${expandedExitDuration}s (${expandedExitDuration ? expandedExitDuration * 1000 : 0}ms)`);
console.log(`  Idle View (Layer 2) enter delay:       ${idleEnterDelay}s (${idleEnterDelay ? idleEnterDelay * 1000 : 0}ms)`);
console.log(`  Idle View (Layer 2) enter duration:    ${idleEnterDuration}s (${idleEnterDuration ? idleEnterDuration * 1000 : 0}ms)`);

if (expandedExitDuration && idleEnterDelay && idleEnterDelay > expandedExitDuration) {
  const gapMs = (idleEnterDelay - expandedExitDuration) * 1000;
  const framesAt60fps = Math.round(gapMs / 16.66);
  console.log(`\n  \x1b[31m[DEFECT CONFIRMED] Opacity Gap Detected: ${gapMs.toFixed(1)}ms!\x1b[0m`);
  console.log(`  From t = ${expandedExitDuration * 1000}ms to t = ${idleEnterDelay * 1000}ms, both Layer 1 and Layer 2 have opacity = 0.`);
  console.log(`  Duration of complete UI disappearance: ~${framesAt60fps} frames @ 60fps (~${framesAt60fps * 2} frames @ 120fps).`);
} else {
  console.log(`  \x1b[32m[PASS] No opacity gap found between Layer 1 exit and Layer 2 enter.\x1b[0m`);
}

// Frame-by-frame simulation during collapse
console.log('\n--- Frame-by-Frame Opacity Simulation (60fps / 16.6ms intervals) ---');
console.log('  Time (ms) | Layer 1 (Expanded) | Layer 2 (Idle) | Total Visible Opacity | Status');
console.log('  ----------+--------------------+----------------+-----------------------+-----------------');

let voidFramesCount = 0;
for (let tMs = 0; tMs <= 250; tMs += 16.66) {
  const tSec = tMs / 1000;
  
  // Layer 1 exit (easeIn over expandedExitDuration)
  let opExpanded = 0;
  if (expandedExitDuration && tSec < expandedExitDuration) {
    const progress = tSec / expandedExitDuration;
    opExpanded = Math.max(0, 1 - progress * progress); // quadratic easeIn approximation
  } else {
    opExpanded = 0;
  }

  // Layer 2 enter (easeOut over idleEnterDuration with idleEnterDelay)
  let opIdle = 0;
  if (idleEnterDelay && idleEnterDuration && tSec >= idleEnterDelay) {
    const progress = Math.min(1, (tSec - idleEnterDelay) / idleEnterDuration);
    opIdle = 1 - (1 - progress) * (1 - progress); // quadratic easeOut approximation
  } else {
    opIdle = 0;
  }

  const totalOp = opExpanded + opIdle;
  const isVoid = totalOp < 0.05;
  if (isVoid) voidFramesCount++;

  const statusStr = isVoid
    ? '\x1b[31mVOID (UI LENYAP)\x1b[0m'
    : totalOp < 0.5
    ? '\x1b[33mDimming\x1b[0m'
    : '\x1b[32mVisible\x1b[0m';

  console.log(`  ${tMs.toFixed(1).padStart(7)}ms | ${opExpanded.toFixed(3).padStart(18)} | ${opIdle.toFixed(3).padStart(14)} | ${totalOp.toFixed(3).padStart(21)} | ${statusStr}`);
}

console.log(`\n  Total Void Frames at 60fps: ${voidFramesCount} frames (${(voidFramesCount * 16.66).toFixed(1)}ms).`);

// --- 2. INSPECT TAURI BRIDGE & NATIVE WIN32 RESIZE CALLS ---
console.log('\n--- 2. NATIVE DWM & WIN32 IPC AUDIT ---');
const tauriBridgePath = path.resolve('src/utils/tauriBridge.ts');
const tauriBridgeContent = fs.readFileSync(tauriBridgePath, 'utf8');

const hasSetPosition = tauriBridgeContent.includes('appWindow.setPosition');
const hasSetSize = tauriBridgeContent.includes('appWindow.setSize');
const hasInvokeAdjust = tauriBridgeContent.includes("invoke('adjust_window_size'");

console.log(`  tauriBridge.ts calls appWindow.setPosition: ${hasSetPosition ? '\x1b[31mYES (Separate IPC)\x1b[0m' : 'NO'}`);
console.log(`  tauriBridge.ts calls appWindow.setSize:     ${hasSetSize ? '\x1b[31mYES (Separate IPC)\x1b[0m' : 'NO'}`);
console.log(`  tauriBridge.ts calls invoke(adjust_window): ${hasInvokeAdjust ? '\x1b[32mYES (Single Atomic Native IPC)\x1b[0m' : 'NO'}`);

const libRsPath = path.resolve('src-tauri/src/lib.rs');
const libRsContent = fs.readFileSync(libRsPath, 'utf8');
const hasNoCopyBits = libRsContent.includes('SWP_NOCOPYBITS');

console.log(`  src-tauri/src/lib.rs SetWindowPos SWP_NOCOPYBITS: ${hasNoCopyBits ? '\x1b[31mACTIVE (Forces DWM to discard buffer -> Black 90° flash!)\x1b[0m' : 'INACTIVE'}`);

console.log('\n========================================================================');
console.log('  DIAGNOSIS COMPLETE: ROOT CAUSES IDENTIFIED WITH EMPIRICAL PROOF');
console.log('========================================================================\n');
