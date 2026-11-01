/**
 * CASA CRITICAL QA: HOVER, PEEK, DYNAMIC HITBOX & BROWSER MEDIA FILTER AUDIT
 *
 * Validates:
 * 1. Dynamic Hitbox Sensor: tight 120x10 on tucked, 168x38 on resting, physical on idle/expanded
 * 2. Absolute Center Anchoring: fixed top-0 left-1/2 -translate-x-1/2 (anti clock jump on resize)
 * 3. Safe Window Shrinking on Animation Complete: frees side Chrome tab areas immediately
 * 4. 180ms Hysteresis / Debounce on mouse leave (anti-flutter / anti-kejang)
 * 5. State Lock: Click prioritized over hover (permanent 'idle'/'expanded' never auto-minimizes on mouse leave)
 * 6. Browser GSMTC Filter: strictly checks Playing status, MediaPlaybackType (Music/Video), and filters plain web tabs
 */

import * as fs from 'fs';
import * as path from 'path';

console.log('\x1b[36m========================================================================\x1b[0m');
console.log('\x1b[36m  CASA CRITICAL QA: HOVER, DYNAMIC HITBOX & BROWSER MEDIA FILTER AUDIT\x1b[0m');
console.log('\x1b[36m========================================================================\x1b[0m\n');

const casaPath = path.resolve('src/components/CasaIsland.tsx');
const casaCode = fs.readFileSync(casaPath, 'utf8');

const gsmtcPath = path.resolve('src-tauri/src/media/gsmtc.rs');
const gsmtcCode = fs.readFileSync(gsmtcPath, 'utf8');

const mediaSkillPath = path.resolve('src/skills/media/MediaSkill.tsx');
const mediaSkillCode = fs.readFileSync(mediaSkillPath, 'utf8');

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  \x1b[32m[PASS]\x1b[0m ${testName}`);
  } else {
    console.log(`  \x1b[31m[FAIL]\x1b[0m ${testName}`);
    if (detail) console.log(`         \x1b[33m${detail}\x1b[0m`);
  }
}

// -------------------------------------------------------------------------
// TEST GROUP 1: Dynamic Hitbox Sensor (Anti-Ghost Trigger)
// -------------------------------------------------------------------------
console.log('--- TEST GROUP 1: Dynamic Hitbox Sensor (Anti-Ghost Trigger) ---');

const hasSensorWrapper = casaCode.includes('data-island-hover-sensor="true"');
assert(hasSensorWrapper, 'Hover sensor wrapper (data-island-hover-sensor) present in DOM');

const sensorMatch = casaCode.match(/<div[^>]*?data-island-hover-sensor="true"[\s\S]*?style=\{\{/);
const sensorBlock = sensorMatch ? sensorMatch[0] : '';

assert(sensorBlock.includes('onMouseEnter={handleMouseEnter}'), 'Sensor wrapper holds onMouseEnter');
assert(sensorBlock.includes('onMouseLeave={handleMouseLeave}'), 'Sensor wrapper holds onMouseLeave');
assert(sensorBlock.includes('pointer-events-auto'), 'Sensor wrapper configured with pointer-events-auto');
assert(sensorBlock.includes('bg-transparent'), 'Sensor wrapper configured with bg-transparent');

const containerMatches = casaCode.match(/<motion\.div[\s\S]*?data-island-container="true"[\s\S]*?>/);
const containerTag = containerMatches ? containerMatches[0] : '';

assert(!containerTag.includes('onMouseEnter='), 'Animated capsule (data-island-container) DOES NOT hold onMouseEnter');
assert(!containerTag.includes('onMouseLeave='), 'Animated capsule (data-island-container) DOES NOT hold onMouseLeave');

assert(casaCode.includes('TUCKED_SENSOR_WIDTH = 120'), 'TUCKED_SENSOR_WIDTH reduced to 120px (tight top lip)');
assert(casaCode.includes('TUCKED_SENSOR_HEIGHT = 10'), 'TUCKED_SENSOR_HEIGHT reduced to 10px (anti-ghost trigger)');

const hasGetSensorDimensions = casaCode.includes('getSensorDimensions = () =>');
assert(hasGetSensorDimensions, 'Dynamic sensor dimension calculator (getSensorDimensions) present');

const usesSensorWidthHeight = casaCode.includes('width: sensorWidth') && casaCode.includes('height: sensorHeight');
assert(usesSensorWidthHeight, 'Sensor wrapper dynamically binds to { width: sensorWidth, height: sensorHeight }');

// -------------------------------------------------------------------------
// TEST GROUP 2: Absolute Center Anchoring & Post-Landing Resize
// -------------------------------------------------------------------------
console.log('\n--- TEST GROUP 2: Absolute Center Anchoring & Post-Landing Resize ---');

const hasAbsoluteCenterAnchor = casaCode.includes('left-1/2 -translate-x-1/2');
assert(hasAbsoluteCenterAnchor, 'Container anchored with fixed top-0 left-1/2 -translate-x-1/2 (anti clock jump)');

const hasPostLandingResize = /onAnimationComplete[\s\S]*?else\s*if\s*\(\s*islandStateRef\.current\s*===\s*['"]idle['"]\s*\)\s*\{[\s\S]*?applyWindowSize\(targetW,\s*targetH\)/.test(casaCode);
assert(hasPostLandingResize, 'onAnimationComplete shrinks native window to idle width (frees Chrome tab clicks)');

// -------------------------------------------------------------------------
// TEST GROUP 3: Hysteresis / Debounce on Mouse Leave (180ms)
// -------------------------------------------------------------------------
console.log('\n--- TEST GROUP 3: Hysteresis / Debounce on Mouse Leave (180ms) ---');

assert(casaCode.includes('leaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)'), 'leaveTimeoutRef declared');
assert(/leaveTimeoutRef\.current\s*=\s*setTimeout\([\s\S]*?,\s*180\)/.test(casaCode), '180ms hysteresis enforced on mouse leave');
assert(/handleMouseEnter[\s\S]*?if\s*\(\s*leaveTimeoutRef\.current\s*\)\s*clearTimeout\(\s*leaveTimeoutRef\.current\s*\)/.test(casaCode), 'Pending leave timeout cancelled on mouse enter');

// -------------------------------------------------------------------------
// TEST GROUP 4: State Lock (Prioritize Click over Hover)
// -------------------------------------------------------------------------
console.log('\n--- TEST GROUP 4: State Lock (Click Prioritized over Hover) ---');

assert(casaCode.includes('const [isPeeking, setIsPeeking] = useState<boolean>(false)'), 'isPeeking state isolated');
assert(/handleMouseLeave[\s\S]*?if\s*\(\s*currentState\s*===\s*['"]idle['"]\s*\)\s*\{[\s\S]*?resetRestingSleepTimer\(\);\s*return;\s*\}/.test(casaCode), 'Mouse leave strictly ignores auto-minimize in "idle" mode');
assert(/handleMouseLeave[\s\S]*?if\s*\(\s*currentState\s*===\s*['"]expanded['"]\s*\)\s*\{[\s\S]*?return;\s*\}/.test(casaCode), 'Mouse leave strictly ignores auto-minimize in "expanded" mode');
assert(/handlePillClick[\s\S]*?if\s*\(\s*currentState\s*===\s*['"]tucked_peek['"]\s*\)\s*\{[\s\S]*?setIslandState\(['"]idle['"]\)/.test(casaCode), 'Pill click locks "tucked_peek" into permanent "idle" state');

// -------------------------------------------------------------------------
// TEST GROUP 5: Browser Media Filter in Rust GSMTC & Frontend
// -------------------------------------------------------------------------
console.log('\n--- TEST GROUP 5: Browser Media Filter in Rust GSMTC & Frontend ---');

const rustHasPlaybackStatusCheck = /let\s+is_playing\s*=\s*status\s*==\s*GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing;[\s\S]*?if\s*!is_playing\s*\{\s*return\s*None;\s*\}/.test(gsmtcCode);
assert(rustHasPlaybackStatusCheck, 'Rust GSMTC: strictly rejects non-playing sessions (!is_playing -> return None)');

const rustHasMediaPlaybackType = gsmtcCode.includes('MediaPlaybackType::Music') && gsmtcCode.includes('MediaPlaybackType::Video');
assert(rustHasMediaPlaybackType, 'Rust GSMTC: validates MediaPlaybackType (Music or Video) for browser processes');

const rustHasWebTabGuard = gsmtcCode.includes('http://') && gsmtcCode.includes('.com') && gsmtcCode.includes('unknown artist');
assert(rustHasWebTabGuard, 'Rust GSMTC: filters plain web tabs and URL page titles');

const frontendHasBrowserPlayGuard = mediaSkillCode.includes('payload.is_browser && !payload.is_playing');
assert(frontendHasBrowserPlayGuard, 'Frontend MediaSkill: rejects non-playing browser payloads');

const frontendHasLyricsGuard = mediaSkillCode.includes('if (payload.is_playing) {') && mediaSkillCode.includes('fetchLyrics(');
assert(frontendHasLyricsGuard, 'Frontend MediaSkill: only triggers fetchLyrics when payload.is_playing === true');

console.log('\n========================================================================');
console.log(`  AUDIT RESULTS: ${passedTests}/${totalTests} TESTS PASSED`);
if (passedTests === totalTests) {
  console.log('  ALL HOVER, DYNAMIC HITBOX & BROWSER MEDIA FILTER TESTS GREEN! [PASS]');
} else {
  console.log('  SOME TESTS FAILED - REVIEW LOGS ABOVE.');
}
console.log('========================================================================\n');
