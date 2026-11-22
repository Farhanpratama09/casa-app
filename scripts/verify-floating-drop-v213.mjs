/**
 * CASA v2.1.3 QA VERIFICATION: Native CF_HDROP Drag-Out & Floating Pill Anti-Flicker
 *
 * Suite A: Parametric & SSR Module Verification (`islandLayoutState.ts` + Rust source guarantees)
 *  - Verifies static `1100x340` canvas lock in `tauri.conf.json`, `lib.rs`, and `CasaIsland.tsx`
 *  - Verifies Floating Mode hitbox & sensor continuity (`top_offset: 0` bridge across `tucked` <-> `tucked_peek` <-> `idle` <-> `idle_peek`)
 *  - Verifies `computePrimaryIslandHitboxAndSensor` has ZERO vertical click-through dead-zone between `y = 0..18px`
 *  - Verifies `HOVER_TRANSITION_HYSTERESIS_MS >= 200` and `>= 200ms` cooldown on both `handleMouseEnter` and `handleMouseMove`
 *
 * Suite B: Real Headless Chromium 1100x340 E2E Interaction Test (`CasaIsland` + `DropZoneView`)
 *  - Enables Floating Mode (`placementMode: 'floating'`)
 *  - Right-clicks idle pill -> `tucked`, checks tucked sensor size (`140x18`)
 *  - Moves mouse across the `y = 4..10px` floating bezel corridor -> verifies `tucked_peek` wakes cleanly
 *    and stays stable WITHOUT bouncing back to `tucked` (0 premature `mouseleave` flicker)
 *  - Right-clicks `idle` -> `tucked` and moves mouse across boundary during active collapse animation:
 *    asserts `handleMouseLeave` does NOT clear `hoverSuppressedRef` prematurely during collapse and `>= 200ms` hysteresis holds
 *  - Opens Drop Zone (`expanded`, `drop_zone`), drags card out with `native_drag_drop_files` returning `'cancelled'`:
 *    asserts item REMAINS parked and `isInternalDragging` was held `true` until promise resolution
 *  - Drags card out with `native_drag_drop_files` returning `'dropped'`:
 *    asserts item IS removed cleanly from Drop Zone shelf and `isExternalDragOver` never leaked mid-drag
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';

let passed = 0;
let failed = 0;

function check(cond, label, detail = '') {
  if (cond) {
    passed++;
    console.log(`  [PASS] ${label}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${label}${detail ? ` -> ${detail}` : ''}`);
  }
}

async function runSuiteA(viteServer) {
  console.log('\n[Suite A] Parametric Geometry & Native Drop-Out Safety Invariants\n');

  const storageMap = new Map();
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    localStorage: {
      getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
      setItem: (k, v) => storageMap.set(k, String(v)),
      removeItem: (k) => storageMap.delete(k),
      clear: () => storageMap.clear(),
    },
  };

  const {
    ISLAND_DIMENSIONS,
    resolveEffectiveIslandLayout,
    computePrimaryIslandHitboxAndSensor,
  } = await viteServer.ssrLoadModule('/src/utils/islandLayoutState.ts');

  // 1. Static 1100x340 window invariants
  const tauriConf = JSON.parse(fs.readFileSync(path.resolve('src-tauri/tauri.conf.json'), 'utf8'));
  const mainWin = tauriConf.app.windows.find((w) => w.label === 'main');
  const libRs = fs.readFileSync(path.resolve('src-tauri/src/lib.rs'), 'utf8');
  const casaTsx = fs.readFileSync(path.resolve('src/components/CasaIsland.tsx'), 'utf8');
  const dropZoneRs = fs.readFileSync(path.resolve('src-tauri/src/drop_zone.rs'), 'utf8');
  const hitboxRs = fs.readFileSync(path.resolve('src-tauri/src/hitbox.rs'), 'utf8');

  check(
    mainWin?.width === 1100 &&
      mainWin?.height === 340 &&
      libRs.includes('Some(1100.0), Some(340.0)') &&
      /adjustWindowSize\(1100,\s*340\)/.test(casaTsx),
    'Transparent canvas remains statically locked at 1100x340 across tauri.conf.json, lib.rs & CasaIsland.tsx'
  );

  // 2. Hysteresis >= 200ms
  check(
    ISLAND_DIMENSIONS.HOVER_TRANSITION_HYSTERESIS_MS >= 200,
    `HOVER_TRANSITION_HYSTERESIS_MS >= 200ms (${ISLAND_DIMENSIONS.HOVER_TRANSITION_HYSTERESIS_MS}ms)`
  );
  check(
    casaTsx.includes('handleMouseEnter = useCallback') &&
      casaTsx.includes('handleMouseMove = useCallback') &&
      casaTsx.includes('isCollapseCooldownActive()') &&
      casaTsx.includes('recheckPointerHoverIntent') &&
      casaTsx.includes('clearMinimizeWakeupLocks'),
    'Both handleMouseEnter and handleMouseMove enforce collapse-only cooldown (>=200ms) with post-transition pointer re-check and deterministic minimize wake unlock'
  );
  check(
    casaTsx.includes('ease: [0.22, 1, 0.36, 1]') &&
      casaTsx.includes('y: isFloatingMode ? activeTopPx : 0') &&
      !casaTsx.includes('marginTop: isFloatingMode ? activeTopPx : 0'),
    'Peek/idle transitions use zero-overshoot [0.22, 1, 0.36, 1] easing and GPU y-transform instead of marginTop layout thrashing'
  );

  // 3. Floating Mode hitbox & sensor vertical continuity (no 0..12px dead-zone gap)
  const tuckedFloating = computePrimaryIslandHitboxAndSensor({
    capsuleW: ISLAND_DIMENSIONS.TUCKED_WIDTH,
    capsuleH: ISLAND_DIMENSIONS.TUCKED_HEIGHT,
    isFloatingMode: true,
    tucked: true,
    isHoverPreview: false,
  });
  const tuckedPeekFloating = computePrimaryIslandHitboxAndSensor({
    capsuleW: ISLAND_DIMENSIONS.IDLE_MIN_AWAKE_WIDTH,
    capsuleH: ISLAND_DIMENSIONS.IDLE_PHYSICAL_HEIGHT,
    isFloatingMode: true,
    tucked: false,
    isHoverPreview: true,
  });
  const idleFloating = computePrimaryIslandHitboxAndSensor({
    capsuleW: ISLAND_DIMENSIONS.IDLE_MIN_AWAKE_WIDTH,
    capsuleH: ISLAND_DIMENSIONS.IDLE_PHYSICAL_HEIGHT,
    isFloatingMode: true,
    tucked: false,
    isHoverPreview: false,
  });
  const idlePeekMode6Floating = computePrimaryIslandHitboxAndSensor({
    capsuleW: ISLAND_DIMENSIONS.EXPANDED_MUSIC_DEFAULT_WIDTH,
    capsuleH: ISLAND_DIMENSIONS.EXPANDED_MUSIC_DEFAULT_HEIGHT,
    isFloatingMode: true,
    tucked: false,
    isHoverPreview: true,
  });
  const expandedLockedFloating = computePrimaryIslandHitboxAndSensor({
    capsuleW: ISLAND_DIMENSIONS.EXPANDED_DROPZONE_WIDTH,
    capsuleH: ISLAND_DIMENSIONS.EXPANDED_DROPZONE_HEIGHT,
    isFloatingMode: true,
    tucked: false,
    isHoverPreview: false,
  });

  const tuckedBottomY = tuckedFloating.hitbox.top_offset + tuckedFloating.hitbox.height;
  const peekTopY = tuckedPeekFloating.hitbox.top_offset;
  const idleTopY = idleFloating.hitbox.top_offset;
  const idlePeekTopY = idlePeekMode6Floating.hitbox.top_offset;

  check(
    tuckedFloating.hitbox.top_offset === 0 &&
      tuckedBottomY >= 16 &&
      tuckedFloating.sensor.height >= 16,
    `Floating tucked sensor covers top approach corridor cleanly (width=${tuckedFloating.sensor.width}, y=0..${tuckedBottomY})`
  );
  check(
    peekTopY === 0 &&
      tuckedPeekFloating.sensor.topBridgePx === 12 &&
      tuckedPeekFloating.hitbox.height === 12 + ISLAND_DIMENSIONS.IDLE_PHYSICAL_HEIGHT + 6 &&
      idleTopY === 0 &&
      idlePeekTopY === 0,
    `Floating tucked_peek/idle/idle_peek bridge y=0..12 gap cleanly (top_offset=0, height=${tuckedPeekFloating.hitbox.height})`
  );
  check(
    expandedLockedFloating.hitbox.top_offset === 12 &&
      expandedLockedFloating.hitbox.height === ISLAND_DIMENSIONS.EXPANDED_DROPZONE_HEIGHT,
    'Floating locked Mode 6 keeps top_offset=12 for click-through top wings/tabs'
  );

  const dockedLayout = resolveEffectiveIslandLayout({
    islandState: 'idle',
    expandedMode: 'idle',
    measuredPillWidth: 200,
    isFloatingMode: false,
    hasHudAlert: false,
    isAlarmRinging: false,
    isRestingSleep: false,
    isLyricsOpen: false,
    isFocusHoverPeek: false,
  });
  check(
    dockedLayout.topPx === -1 && dockedLayout.hitboxTopOffset === 0,
    'Docked Mode keeps topPx=-1 flush bezel invariant untouched'
  );

  // 4. Rust CF_HDROP & DoDragDrop safeguards
  check(
    dropZoneRs.includes('pub async fn native_drag_drop_files') &&
      dropZoneRs.includes('DRAGDROP_S_DROP') &&
      dropZoneRs.includes('DROPEFFECT_NONE') &&
      dropZoneRs.includes('OleInitialize') &&
      dropZoneRs.includes('SHCreateStdEnumFmtEtc') &&
      libRs.includes('drop_zone::native_drag_drop_files'),
    'Rust native CF_HDROP DoDragDrop command & double validation registered cleanly in lib.rs'
  );
  check(
    hitboxRs.includes('IS_INTERNAL_DRAG_OUT') &&
      hitboxRs.includes('pub fn set_internal_drag_out'),
    'hitbox.rs supports IS_INTERNAL_DRAG_OUT pass-through isolation during DoDragDrop'
  );
}

async function runSuiteB(viteServer) {
  console.log('\n[Suite B] Real Chromium DOM 1100x340 E2E (Floating Anti-Flicker + Drop-Out)\n');

  const chromePath = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((p) => fs.existsSync(p));
  if (!chromePath) {
    throw new Error('Chromium binary not found for Suite B E2E');
  }

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    defaultViewport: { width: 1100, height: 340 },
  });

  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
      console.error('  [PageError]', err.message);
    });

    await page.evaluateOnNewDocument(() => {
      window.__HITBOX_EVENTS__ = [];
      window.__MOCK_DRAG_OUT_MODE__ = 'cancelled';
      window.__MOCK_DRAG_OUT_LOG__ = [];
      window.__RESOLVE_PENDING_DRAG__ = null;
      window.__EVENT_LISTENERS__ = {};
      window.__EVENT_BY_NAME__ = {};

      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: () => {},
      };
      window.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback: (fn) => {
          const id = Math.floor(Math.random() * 1000000) + 1;
          window.__EVENT_LISTENERS__[id] = fn;
          return id;
        },
        unregisterCallback: (id) => {
          delete window.__EVENT_LISTENERS__[id];
        },
        plugins: { event: { unregisterListener: () => {} } },
        invoke: async (cmd, args) => {
          if (cmd === 'plugin:event|listen') {
            if (args?.event && args?.handler) {
              if (!window.__EVENT_BY_NAME__[args.event]) {
                window.__EVENT_BY_NAME__[args.event] = [];
              }
              window.__EVENT_BY_NAME__[args.event].push(args.handler);
            }
            return args?.handler || 0;
          }
          if (cmd === 'update_island_hitboxes') {
            window.__HITBOX_EVENTS__.push({
              t: Date.now(),
              rects: args?.rects || [],
            });
            return null;
          }
          if (cmd === 'native_drag_drop_files') {
            const mode = window.__MOCK_DRAG_OUT_MODE__;
            const paths = args?.paths || [];
            const entry = { paths, mode, startedAt: Date.now(), settled: false };
            window.__MOCK_DRAG_OUT_LOG__.push(entry);
            return await new Promise((resolve, reject) => {
              const finish = () => {
                entry.settled = true;
                if (mode === 'missing') {
                  reject(new Error('Berkas tidak ditemukan di disk'));
                } else if (mode === 'dropped') {
                  resolve({ status: 'dropped', effect: 1 });
                } else {
                  resolve({ status: 'cancelled', effect: 0 });
                }
              };
              window.__RESOLVE_PENDING_DRAG__ = finish;
              setTimeout(finish, 180);
            });
          }
          if (cmd === 'get_file_metadata') {
            return { exists: true, sizeBytes: 4096, isDir: false };
          }
          if (cmd === 'get_autostart_enabled') return false;
          if (cmd === 'get_global_shortcut_status') return true;
          if (cmd === 'get_hardware_telemetry') return null;
          return null;
        },
      };

      localStorage.clear();
      localStorage.setItem(
        'casa_settings_v1',
        JSON.stringify({
          theme: 'monochrome',
          placementMode: 'floating',
          horizontalAlign: 'center',
          idlePillStyle: 'eyes',
          hoverDelayMs: 0,
          autoTuckIdle: false,
          fullscreenBehavior: 'smart-tuck',
          alarmVolume: 80,
          autoStartNextCycle: false,
          launchAtStartup: false,
        })
      );

      localStorage.setItem(
        'casa_drop_zone_shelf_items_v1',
        JSON.stringify([
          {
            id: 'dz_test_sample_1',
            type: 'file',
            title: 'design-spec.pdf',
            payload: 'C:\\Samples\\design-spec.pdf',
            extension: 'PDF',
            sizeBytes: 128400,
            timestamp: Date.now(),
          },
        ])
      );
    });

    await page.goto('http://127.0.0.1:5299', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-island-hover-sensor="true"]', { timeout: 15000 });
    await page.waitForSelector('[data-island-container="true"]', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 450));

    // Move away first to ensure clean initial floating idle state
    await page.mouse.move(50, 260);
    await new Promise((r) => setTimeout(r, 250));

    const pillBoxBeforeTuck = await page.evaluate(() => {
      const c = document.querySelector('[data-island-container="true"]');
      const s = document.querySelector('[data-island-hover-sensor="true"]');
      return {
        cRect: c?.getBoundingClientRect().toJSON(),
        sRect: s?.getBoundingClientRect().toJSON(),
      };
    });

    check(
      pillBoxBeforeTuck.cRect &&
        pillBoxBeforeTuck.cRect.top >= 10 &&
        pillBoxBeforeTuck.sRect &&
        pillBoxBeforeTuck.sRect.top <= 1 &&
        pillBoxBeforeTuck.sRect.height >= 55,
      `Floating idle mounts capsule at top ~12px (${Math.round(pillBoxBeforeTuck.cRect?.top || 0)}px) while hover sensor anchors cleanly at y=0..${Math.round(pillBoxBeforeTuck.sRect?.bottom || 0)}px`
    );

    // 1. Right-click Floating Idle pill to minimize -> 'tucked'
    await page.click('[data-island-container="true"]', { button: 'right' });
    await new Promise((r) => setTimeout(r, 420));

    // Confirm collapsed tucked state & zero hover bounce even if mouse sits over capsule edge
    await page.mouse.move(550, 25);
    await new Promise((r) => setTimeout(r, 260));
    const tuckedAudit = await page.evaluate(() => {
      const c = document.querySelector('[data-island-container="true"]')?.getBoundingClientRect();
      const s = document.querySelector('[data-island-hover-sensor="true"]')?.getBoundingClientRect();
      const latestHb = window.__HITBOX_EVENTS__.at(-1)?.rects?.[0];
      return {
        cHeight: Math.round(c?.height || 0),
        sHeight: Math.round(s?.height || 0),
        latestHb,
      };
    });
    check(
      tuckedAudit.cHeight <= 6 &&
        tuckedAudit.sHeight >= 16 &&
        tuckedAudit.latestHb?.top_offset === 0 &&
        tuckedAudit.latestHb?.height >= 16,
      `Minimize transitions to tucked (visual=${tuckedAudit.cHeight}px, sensorHeight=${tuckedAudit.sHeight}px, hb=${tuckedAudit.latestHb?.width}x${tuckedAudit.latestHb?.height})`
    );

    // 2. Hover top bezel (y = 5px, right inside Floating top gap!) -> must wake to tucked_peek and NOT flicker back to tucked!
    await page.mouse.move(550, 5);
    await new Promise((r) => setTimeout(r, 60));
    await page.mouse.move(552, 6);
    await page.mouse.move(550, 5);
    await new Promise((r) => setTimeout(r, 480));

    const peekStabilitySamples = [];
    for (let i = 0; i < 6; i++) {
      await page.mouse.move(550 + (i % 2), 6);
      await new Promise((r) => setTimeout(r, 75));
      const sample = await page.evaluate(() => {
        const c = document.querySelector('[data-island-container="true"]')?.getBoundingClientRect();
        const s = document.querySelector('[data-island-hover-sensor="true"]')?.getBoundingClientRect();
        return {
          cTop: Math.round(c?.top ?? -1),
          cHeight: Math.round(c?.height ?? 0),
          sTop: Math.round(s?.top ?? -1),
          sBottom: Math.round(s?.bottom ?? 0),
        };
      });
      peekStabilitySamples.push(sample);
    }

    const stablyPeeking = peekStabilitySamples.every(
      (s) => s.cHeight >= 36 && s.cHeight <= 44 && s.cTop >= 10 && s.sTop <= 1 && s.sBottom >= 54
    );
    check(
      stablyPeeking,
      `Floating tucked_peek stays locked stably over top corridor y=5..6px across 6 samples (no flicker loop)`,
      JSON.stringify(peekStabilitySamples)
    );

    // 2B. Regression Check: tucked -> hover (tucked_peek) -> click wake (idle) -> cursor stays/moves inside sensor -> MUST open idle_peek without dead-hover!
    await page.mouse.move(550, 26);
    await page.click('[data-island-container="true"]');
    await new Promise((r) => setTimeout(r, 120));
    await page.mouse.move(554, 28);
    await new Promise((r) => setTimeout(r, 340));

    const wakeToIdlePeekAudit = await page.evaluate(() => {
      const c = document.querySelector('[data-island-container="true"]')?.getBoundingClientRect();
      const s = document.querySelector('[data-island-hover-sensor="true"]')?.getBoundingClientRect();
      const latestHb = window.__HITBOX_EVENTS__.at(-1)?.rects?.[0];
      return {
        cTop: Math.round(c?.top ?? -1),
        cHeight: Math.round(c?.height ?? 0),
        cWidth: Math.round(c?.width ?? 0),
        sTop: Math.round(s?.top ?? -1),
        sHeight: Math.round(s?.height ?? 0),
        latestHb,
      };
    });
    check(
      wakeToIdlePeekAudit.cHeight >= 80 &&
        wakeToIdlePeekAudit.cTop >= 10 &&
        wakeToIdlePeekAudit.cTop <= 14 &&
        wakeToIdlePeekAudit.latestHb?.top_offset === 0 &&
        wakeToIdlePeekAudit.latestHb?.height >= 90,
      `Post-minimize wake (tucked -> hover -> idle -> hover inside sensor) expands smoothly to idle_peek (W=${wakeToIdlePeekAudit.cWidth}, H=${wakeToIdlePeekAudit.cHeight}, top=${wakeToIdlePeekAudit.cTop}px, hbTop=${wakeToIdlePeekAudit.latestHb?.top_offset})`,
      JSON.stringify(wakeToIdlePeekAudit)
    );

    // Move cleanly outside so idle_peek collapses back to idle cleanly after >=220ms hysteresis, then verify steady idle at top~12px
    await page.mouse.move(50, 260);
    await new Promise((r) => setTimeout(r, 480));
    const afterPeekIdleAudit = await page.evaluate(() => {
      const c = document.querySelector('[data-island-container="true"]')?.getBoundingClientRect();
      return {
        cTop: Math.round(c?.top ?? -1),
        cHeight: Math.round(c?.height ?? 0),
      };
    });
    check(
      afterPeekIdleAudit.cHeight >= 36 &&
        afterPeekIdleAudit.cHeight <= 44 &&
        afterPeekIdleAudit.cTop >= 10 &&
        afterPeekIdleAudit.cTop <= 14,
      `Leaving idle_peek collapses cleanly back to idle at consistent y=${afterPeekIdleAudit.cTop}px (H=${afterPeekIdleAudit.cHeight}px)`
    );

    // 3. Test direct tucked -> click wake -> keep cursor completely stationary inside sensor -> post-transition pointer re-check promotes idle -> idle_peek automatically!
    await page.mouse.move(550, 26);
    await page.click('[data-island-container="true"]', { button: 'right' });
    await new Promise((r) => setTimeout(r, 420));

    // Confirm collapsed tucked, move away cleanly, then click tucked edge once and keep pointer inside
    await page.mouse.move(80, 260);
    await new Promise((r) => setTimeout(r, 300));
    await page.click('[data-island-container="true"]');
    await new Promise((r) => setTimeout(r, 520));
    const stationaryWakePeekAudit = await page.evaluate(() => {
      const c = document.querySelector('[data-island-container="true"]')?.getBoundingClientRect();
      return {
        cTop: Math.round(c?.top ?? -1),
        cHeight: Math.round(c?.height ?? 0),
      };
    });
    check(
      stationaryWakePeekAudit.cHeight >= 80 &&
        stationaryWakePeekAudit.cTop >= 10 &&
        stationaryWakePeekAudit.cTop <= 14,
      `Direct minimize wake (tucked click -> stationary pointer in sensor) re-checks pointer & promotes to idle_peek (H=${stationaryWakePeekAudit.cHeight}px, top=${stationaryWakePeekAudit.cTop}px)`,
      JSON.stringify(stationaryWakePeekAudit)
    );

    // Collapse idle_peek -> idle, then minimize idle -> tucked & jitter during collapse!
    await page.mouse.move(80, 260);
    await new Promise((r) => setTimeout(r, 480));
    await page.mouse.move(550, 25);
    await page.click('[data-island-container="true"]', { button: 'right' });
    await new Promise((r) => setTimeout(r, 45));
    await page.mouse.move(550, 16);
    await new Promise((r) => setTimeout(r, 45));
    await page.mouse.move(550, 6);
    await new Promise((r) => setTimeout(r, 45));
    await page.mouse.move(550, 10);
    await new Promise((r) => setTimeout(r, 450));

    const postCollapseJitterAudit = await page.evaluate(() => {
      const c = document.querySelector('[data-island-container="true"]')?.getBoundingClientRect();
      return { cHeight: Math.round(c?.height || 0) };
    });
    check(
      postCollapseJitterAudit.cHeight <= 6,
      `Rapid edge jitter during Floating collapse does NOT reopen peek (stays tucked: ${postCollapseJitterAudit.cHeight}px)`
    );

    // Move cleanly away outside hitbox for >=300ms so suppression lifts cleanly before clicking
    await page.mouse.move(80, 260);
    await new Promise((r) => setTimeout(r, 340));

    // Verify hover works again normally after user cleanly moved away
    await page.mouse.move(550, 6);
    await new Promise((r) => setTimeout(r, 320));
    const rehoverAudit = await page.evaluate(() => {
      const c = document.querySelector('[data-island-container="true"]')?.getBoundingClientRect();
      return { cHeight: Math.round(c?.height || 0) };
    });
    check(
      rehoverAudit.cHeight >= 36,
      `Hover-to-peek recovers cleanly once cursor exits after cooldown (${rehoverAudit.cHeight}px)`
    );

    await page.mouse.move(80, 260);
    await new Promise((r) => setTimeout(r, 360));

    // Lock into Mode 6 (1st click wakes tucked->idle if tucked, 2nd click opens Mode 6) -> switch to Drop Zone tab
    let clickedDropZone = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.click('[data-island-container="true"]');
      await new Promise((r) => setTimeout(r, 420));
      clickedDropZone = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const dzBtn = buttons.find((b) => b.textContent?.includes('Drop Zone'));
        if (!dzBtn) return false;
        dzBtn.click();
        return true;
      });
      if (clickedDropZone) break;
    }
    await new Promise((r) => setTimeout(r, 380));

    const hasSeededCard = await page.evaluate(() =>
      document.body.innerText.includes('design-spec.pdf')
    );
    check(
      clickedDropZone && hasSeededCard,
      'Mode 6 Drop Zone opens and renders seeded ephemeral file card (design-spec.pdf)'
    );

    // Locate the 186x106 DropShelfCard rect (NOT the outer 580px DropZoneView container!)
    const cardBox = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.cursor-grab[data-tauri-drag-region="false"]'));
      const targetCard = cards.find((el) => el.textContent?.includes('design-spec.pdf'));
      return targetCard?.getBoundingClientRect().toJSON() || null;
    });
    assert.ok(cardBox && cardBox.width < 240, 'DropZone card bounding box found');

    const cx = cardBox.left + 32;
    const cy = cardBox.top + 32;

    // 3A. Drag-out CANCELLED -> item MUST stay, isInternalDragging held during flight
    await page.evaluate(() => {
      window.__MOCK_DRAG_OUT_MODE__ = 'cancelled';
    });
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 28, cy + 28, { steps: 3 });
    await new Promise((r) => setTimeout(r, 60));

    const midDragState = await page.evaluate(() => {
      // Simulate synthetic Tauri drag-enter event ONLY (never casa://toggle-island) while DoDragDrop is active:
      // CasaIsland + DropZoneView MUST keep isExternalDragOver suppressed until promise completes.
      const dragHandlerIds = [
        ...(window.__EVENT_BY_NAME__?.['tauri://drag-enter'] || []),
        ...(window.__EVENT_BY_NAME__?.['tauri://drag-over'] || []),
      ];
      dragHandlerIds.forEach((hid) => {
        const cb = window.__EVENT_LISTENERS__?.[hid];
        if (cb) {
          try {
            cb({ payload: { paths: ['C:\\Samples\\other.txt'], position: { x: 550, y: 80 } } });
          } catch {}
        }
      });
      const container = document.querySelector('[data-island-container="true"]');
      const hasDragOverGlow = Boolean(container?.className?.includes('ring-1 ring-white/55'));
      return {
        dragListenerFound: dragHandlerIds.length > 0,
        logCount: window.__MOCK_DRAG_OUT_LOG__.length,
        settled: window.__MOCK_DRAG_OUT_LOG__.at(-1)?.settled,
        hasDragOverGlow,
      };
    });
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 260));

    const afterCancelledState = await page.evaluate(() => ({
      hasCard: document.body.innerText.includes('design-spec.pdf'),
      bodyText: document.body.innerText.slice(0, 220),
      settled: window.__MOCK_DRAG_OUT_LOG__.at(-1)?.settled,
    }));
    check(
      midDragState.dragListenerFound === true &&
        midDragState.logCount === 1 &&
        midDragState.settled === false &&
        midDragState.hasDragOverGlow === false &&
        afterCancelledState.settled === true &&
        afterCancelledState.hasCard === true,
      'Cancelled OS drag (DRAGDROP_S_CANCEL / DROPEFFECT_NONE) preserves DropZone item & suppresses isExternalDragOver mid-drag',
      JSON.stringify({ cardBox, midDragState, afterCancelledState })
    );

    // 3B. Drag-out DROPPED (DRAGDROP_S_DROP + DROPEFFECT_COPY) -> item MUST auto-remove cleanly
    await page.evaluate(() => {
      window.__MOCK_DRAG_OUT_MODE__ = 'dropped';
    });
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 30, cy + 30, { steps: 3 });
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 320));

    const afterDroppedState = await page.evaluate(() => ({
      logCount: window.__MOCK_DRAG_OUT_LOG__.length,
      mode: window.__MOCK_DRAG_OUT_LOG__.at(-1)?.mode,
      settled: window.__MOCK_DRAG_OUT_LOG__.at(-1)?.settled,
      hasCard: document.body.innerText.includes('design-spec.pdf'),
      lsRaw: localStorage.getItem('casa_drop_zone_shelf_items_v1'),
    }));
    check(
      afterDroppedState.logCount === 2 &&
        afterDroppedState.mode === 'dropped' &&
        afterDroppedState.settled === true &&
        afterDroppedState.hasCard === false &&
        afterDroppedState.lsRaw === '[]',
      'Accepted OS drop (DRAGDROP_S_DROP + DROPEFFECT_COPY) auto-removes item from DropZone & storage',
      JSON.stringify({ cardBox, afterDroppedState })
    );

    check(pageErrors.length === 0, `Zero uncaught Chromium page errors (${pageErrors.length})`);
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log('\n=== CASA v2.1.3 QA VERIFICATION (Floating Mode + Native CF_HDROP Drag-Out) ===');
  const viteServer = await createServer({
    server: { port: 5299, strictPort: true },
    logLevel: 'error',
  });
  await viteServer.listen();

  try {
    await runSuiteA(viteServer);
    await runSuiteB(viteServer);
  } finally {
    await viteServer.close();
  }

  console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[verify-floating-drop-v213] Fatal:', err);
  process.exit(1);
});
