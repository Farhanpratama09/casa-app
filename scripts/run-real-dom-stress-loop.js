import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';

async function main() {
  console.log('\n================================================================');
  console.log('   CASA ISLAND: REAL CHROMIUM ENGINE DOM RUNTIME LOOP-TEST');
  console.log('================================================================\n');

  // 1. Start Vite dev server in-process
  console.log('[Runner] Starting Vite dev server on port 5188...');
  const viteServer = await createServer({
    server: { port: 5188 },
    logLevel: 'error',
  });
  await viteServer.listen();
  console.log('[Runner] Vite server listening at http://localhost:5188');

  // 2. Launch Real Chromium Browser via Puppeteer-Core
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  console.log(`[Runner] Launching real Chromium engine at: ${chromePath}`);

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1920,1080',
    ],
    defaultViewport: {
      width: 440,
      height: 38,
    },
  });

  try {
    const page = await browser.newPage();

    // 3. Expose Tauri window resize bridge to sync Puppeteer viewport with native Win32 window sizes
    await page.exposeFunction('__TAURI_RESIZE_WINDOW__', async (w, h) => {
      await page.setViewport({ width: w, height: h });
    });

    console.log('[Runner] Loading application in Chromium...');
    await page.goto('http://localhost:5188', { waitUntil: 'networkidle0' });

    // Wait for the test API to mount
    await page.waitForFunction(
      () => typeof window.__START_REAL_DOM_LOOP_TEST__ === 'function',
      { timeout: 10000 }
    );
    console.log('[Runner] CASA Island detected and test hook successfully bound.');

    // 4. Run the 50 cycles Real-DOM stress loop
    const CYCLES = 50;
    const TRANSITION_HOLD_MS = 250;
    console.log(`[Runner] Executing ${CYCLES} state loop cycles in real Chromium DOM...`);
    console.log(`         Sequence: idle -> dual_idle -> idle_peek -> expanded -> collapse(dual_idle) -> idle\n`);

    const report = await page.evaluate(async (cycles, holdMs) => {
      return await window.__START_REAL_DOM_LOOP_TEST__(cycles, holdMs);
    }, CYCLES, TRANSITION_HOLD_MS);

    // 5. Present the forensic results
    console.log('\n======================== REAL DOM SAMPLING SNAPSHOTS ========================');
    console.log(
      'Sample | Cycle | State/Transition | Height | Width | Center  | Shift | BubbleRight | WinWidth | Margin | IdleOp | ExpOp | IdleClock Display'
    );
    console.log('----------------------------------------------------------------------------------------------------------------------------');

    // Display first 25 and last 10 snapshots
    const displaySnapshots = report.sampleSnapshots.length > 35
      ? [...report.sampleSnapshots.slice(0, 20), ...report.sampleSnapshots.slice(-15)]
      : report.sampleSnapshots;

    for (let i = 0; i < displaySnapshots.length; i++) {
      const s = displaySnapshots[i];
      const bubbleStr = s.bubbleRight !== null ? `${s.bubbleRight.toFixed(1)}px` : 'unmounted';
      const marginStr = s.bubbleRight !== null ? `${(s.windowInnerWidth - s.bubbleRight).toFixed(1)}px` : 'N/A';
      const clockStr = s.idleClockFound ? (s.idleClockDisplay || 'none') : 'unmounted';
      console.log(
        `#${String(i + 1).padStart(4, ' ')} | ` +
        `C${String(s.cycle).padStart(2, ' ')}  | ` +
        `${s.transition.padEnd(16, ' ')} | ` +
        `${String(s.containerHeight).padStart(5, ' ')}px | ` +
        `${String(s.containerWidth).padStart(5, ' ')}px | ` +
        `${String(s.containerCenter).padStart(6, ' ')}px | ` +
        `${String(s.horizontalShift).padStart(4, ' ')}px | ` +
        `${bubbleStr.padStart(9, ' ')} | ` +
        `${String(s.windowInnerWidth).padStart(6, ' ')}px | ` +
        `${marginStr.padStart(6, ' ')} | ` +
        `${s.idleOpacity.toFixed(2).padStart(6, ' ')} | ` +
        `${s.expandedOpacity.toFixed(2).padStart(5, ' ')} | ` +
        `${clockStr}`
      );
    }

    console.log('\n==================== AUDIT EXECUTION SUMMARY ====================');
    console.log(`Total Cycles Executed:        ${report.totalCycles}`);
    console.log(`Total DOM Frames Sampled:     ${report.totalSamples}`);
    console.log(`Test Duration:                ${(report.durationMs / 1000).toFixed(2)}s`);
    console.log(`Max Horizontal Pivot Shift:   ${report.maxHorizontalShift.toFixed(2)}px (Target: <= 0.5px)`);
    console.log(`Min Secondary Bubble Margin:  ${report.minBubbleMargin.toFixed(1)}px buffer`);
    console.log(`Max Container Height:         ${report.maxContainerHeight.toFixed(1)}px`);
    console.log(
      `Zero-Shift Assertion:         ${report.zeroShiftViolations === 0 ? '✓ PASSED (0 Violation / Locked Center)' : '✗ FAILED (' + report.zeroShiftViolations + ' Violations)'}`
    );
    console.log(
      `Zero-Clipping Assertion:      ${report.zeroClippingViolations === 0 ? '✓ PASSED (0 Violation)' : '✗ FAILED (' + report.zeroClippingViolations + ' Violations)'}`
    );
    console.log(
      `Anti-Ghosting Assertion:      ${report.antiGhostingViolations === 0 ? '✓ PASSED (0 Violation / Height <= 45px)' : '✗ FAILED (' + report.antiGhostingViolations + ' Violations)'}`
    );
    console.log(
      `No-Header Leak Assertion:     ${report.noHeaderLeakViolations === 0 ? '✓ PASSED (0 Violation)' : '✗ FAILED (' + report.noHeaderLeakViolations + ' Violations)'}`
    );
    console.log('================================================================');

    if (!report.passed) {
      console.error('\n[Runner] FAILURES DETECTED:');
      for (const err of report.errors.slice(0, 10)) {
        console.error(' - ' + err);
      }
      process.exitCode = 1;
    } else {
      console.log('\n[Runner] ALL ASSERTIONS 100% GREEN (ZERO DEFECT)');
      process.exitCode = 0;
    }
  } finally {
    await browser.close();
    await viteServer.close();
  }
}

main().catch((err) => {
  console.error('[Runner] Fatal Error:', err);
  process.exit(1);
});
