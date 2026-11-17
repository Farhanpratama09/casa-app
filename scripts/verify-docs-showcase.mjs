/**
 * CASA Phase 12 Visual Parity & Clean Navigation Verification
 * Serves `docs/` over local HTTP with Chromium E2E on Desktop (1280x800) & Mobile (390x844).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const DOCS_DIR = path.resolve('docs');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

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

function startStaticServer(port = 5212) {
  const server = http.createServer((req, res) => {
    const reqUrl = (req.url || '/').split('?')[0];
    const relPath = reqUrl === '/' ? 'index.html' : reqUrl.replace(/^\/+/, '');
    const filePath = path.resolve(DOCS_DIR, relPath);
    if (!filePath.startsWith(DOCS_DIR) || !fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const server = await startStaticServer(5212);
  const candidateBrowsers = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  const chromePath = candidateBrowsers.find((p) => fs.existsSync(p));
  if (!chromePath) throw new Error('Chromium binary not found');

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    defaultViewport: { width: 1280, height: 800 },
  });

  try {
    // =========================================================================
    // DESKTOP 1280x800 SUITE
    // =========================================================================
    console.log('\n[Desktop 1280x800] 1:1 Island Parity, Clean Hashless Nav & Minimal Download\n');
    const page = await browser.newPage();
    const consoleErrors = [];
    const cspErrors = [];

    page.on('pageerror', (e) => consoleErrors.push(e.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (text.toLowerCase().includes('content security policy')) {
          cspErrors.push(text);
        }
      }
    });

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url().startsWith('https://api.github.com/')) {
        req.respond({ status: 200, contentType: 'application/json', body: '[]' });
        return;
      }
      req.continue();
    });

    await page.goto('http://127.0.0.1:5212/', { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 300));

    // Check Hero simplification, Native 1:1 Anatomy, SEO, Download simplification
    const layoutAudit = await page.evaluate(() => {
      const heroIntro = document.querySelector('.hero-intro');
      const heroButtons = heroIntro ? heroIntro.querySelectorAll('a, button').length : -1;
      const monitorScreen = document.getElementById('monitor-screen');
      const replayInsideMonitor = Boolean(
        monitorScreen && monitorScreen.contains(document.getElementById('replay-intro-btn'))
      );
      const capsule = document.getElementById('vm-notch-capsule');
      const hasConcaveShoulders =
        document.querySelectorAll('.casa-shoulder').length === 2;
      const restingPillRect = document
        .getElementById('casa-resting-pill')
        ?.getBoundingClientRect();
      const capsuleHeight = capsule?.getBoundingClientRect().height ?? 0;

      const downloadSection = document.getElementById('download');
      const hasPrimaryExe = Boolean(document.getElementById('primary-download-btn'));
      const hasMsiBtn = Boolean(document.getElementById('msi-download-btn'));
      const hasStatGrid = Boolean(downloadSection?.querySelector('.release-stats'));
      const shaDetails = downloadSection?.querySelector('details.sha-accordion');
      const shaSummaryText = shaDetails?.querySelector('summary')?.textContent?.trim();
      const shaText = document.getElementById('sha-value-exe')?.textContent?.trim();

      return {
        title: document.title,
        heroButtons,
        replayInsideMonitor,
        hasConcaveShoulders,
        capsuleHeight: Math.round(capsuleHeight),
        restingWidth: Math.round(restingPillRect?.width ?? 0),
        hasPrimaryExe,
        hasMsiBtn,
        hasStatGrid,
        shaClosedInitially: shaDetails?.hasAttribute('open') === false,
        shaSummaryText,
        shaText,
        introPhase: document.getElementById('virtual-monitor')?.getAttribute('data-intro-phase'),
      };
    });

    check(
      layoutAudit.title === 'CASA — Dynamic Rabbit Island for Windows',
      `Title verified (${layoutAudit.title})`
    );
    check(
      layoutAudit.heroButtons === 0 && layoutAudit.replayInsideMonitor,
      `Hero has no download button (${layoutAudit.heroButtons}) & Replay Intro sits inside monitor corner`
    );
    check(
      layoutAudit.hasConcaveShoulders && layoutAudit.capsuleHeight === 39 && layoutAudit.restingWidth >= 120,
      `1:1 Island anatomy matches src/ (2 concave SVG shoulders, height=${layoutAudit.capsuleHeight}px, restingW=${layoutAudit.restingWidth}px)`
    );
    check(
      layoutAudit.hasPrimaryExe &&
        !layoutAudit.hasMsiBtn &&
        !layoutAudit.hasStatGrid &&
        layoutAudit.shaClosedInitially &&
        layoutAudit.shaSummaryText === 'Verify SHA-256 checksum' &&
        layoutAudit.shaText === '0D54BE3021396C7FFDCCB09D81DEA12F9460BFFE053F0125B555990A70671BFA',
      'Download section displays single .exe CTA + collapsed SHA-256 accordion with exact latest hash'
    );
    check(
      layoutAudit.introPhase === 'hi',
      `Intro begins with "Hi." Obsidian Bunny phase (${layoutAudit.introPhase})`
    );

    // Wait for intro morph sequence to finish cleanly into ready state
    await page.waitForFunction(
      () => document.getElementById('virtual-monitor')?.getAttribute('data-intro-phase') === 'ready',
      { timeout: 5500 }
    );

    // Test Mode 1: Resting & Wake (Alt+Space opens native Mode6TopNav + Control Center)
    await page.keyboard.down('AltLeft');
    await page.keyboard.press('Space');
    await page.keyboard.up('AltLeft');
    await new Promise((r) => setTimeout(r, 180));
    const m6OpenCheck = await page.evaluate(() => ({
      expanded: document.getElementById('vm-notch-capsule')?.getAttribute('data-state') === 'expanded',
      variant: document.getElementById('vm-notch-capsule')?.getAttribute('data-variant'),
      hasNavTabs: document.querySelectorAll('.casa-m6-tab').length === 4,
    }));
    check(
      m6OpenCheck.expanded && m6OpenCheck.hasNavTabs,
      `Mode 1 (Resting & Wake): Alt+Space expands native Mode 6 (${m6OpenCheck.variant}, 4 nav tabs)`
    );

    // Test Mode 2: Lyrics & Queue + Idle Lyric Minimize (real Mode6MusicLayout + IdlePillView)
    await page.click('button[data-vm-mode="lyrics"]');
    await new Promise((r) => setTimeout(r, 150));
    const qBtns = await page.$$('#vm-queue-list .vm-queue-btn');
    await qBtns[1].click();
    await page.click('#vm-idle-lyric-btn');
    await new Promise((r) => setTimeout(r, 180));
    const musicIdleCheck = await page.evaluate(() => ({
      collapsedToIdle: document.getElementById('vm-notch-capsule')?.getAttribute('data-state') === 'idle',
      miniLyricVisible: document.getElementById('vm-mini-lyric-pill')?.hidden === false,
      miniLyricText: document.getElementById('vm-mini-lyric-pill')?.textContent?.trim(),
      eqVisible: !document.getElementById('casa-eq-glyph')?.hidden,
      eyeVisible: !document.getElementById('vm-notch-eyes')?.hidden,
    }));
    check(
      musicIdleCheck.collapsedToIdle &&
        musicIdleCheck.miniLyricVisible &&
        musicIdleCheck.miniLyricText === '4px Smart-Tuck rests along the top edge' &&
        musicIdleCheck.eqVisible &&
        musicIdleCheck.eyeVisible,
      `Mode 2 (Lyrics & Queue): Idle Lyric Minimize shows synced lyric beside companion eyes & EQ (${musicIdleCheck.miniLyricText})`
    );

    // Test Mode 3: To-Do & Focus (ProductivitySplitView + Idle U-Shape Perimeter Stroke + Dual-Idle)
    await page.click('button[data-vm-mode="todo"]');
    await new Promise((r) => setTimeout(r, 150));
    await page.type('#vm-todo-input', 'Check Mode 6 parity');
    await page.click('#vm-todo-form button[type="submit"]');
    const cbs = await page.$$('#vm-todo-list .vm-todo-checkbox');
    await cbs[1].click();
    await page.click('#vm-todo-dual-btn');
    await page.click('#vm-notch-collapse-btn');
    await new Promise((r) => setTimeout(r, 180));
    const todoIdleCheck = await page.evaluate(() => ({
      perimeterVisible: document.getElementById('vm-perimeter-svg')?.hidden === false,
      progressText: document.getElementById('vm-todo-progress-text')?.textContent?.trim(),
      timerClock: document.getElementById('vm-focus-timer-clock')?.textContent?.trim(),
      musicSegmentVisible: document.getElementById('casa-music-segment')?.hidden === false,
    }));
    check(
      todoIdleCheck.perimeterVisible &&
        todoIdleCheck.progressText === '2 / 4 selesai' &&
        todoIdleCheck.musicSegmentVisible,
      `Mode 3 (To-Do & Focus): U-shape perimeter stroke visible, Dual-Idle active (${todoIdleCheck.progressText}, ${todoIdleCheck.timerClock})`
    );

    // Test Mode 4: Volume & BT HUD (IdlePillView system-hud)
    await page.click('button[data-vm-mode="hud"]');
    await new Promise((r) => setTimeout(r, 120));
    await page.evaluate(() => {
      const s = document.getElementById('vm-volume-slider');
      s.value = '82';
      s.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const volHud = await page.evaluate(() => ({
      visible: document.getElementById('casa-hud-pill')?.hidden === false,
      label: document.getElementById('casa-hud-label')?.textContent?.trim(),
      detail: document.getElementById('casa-hud-detail')?.textContent?.trim(),
    }));
    await page.click('#vm-sim-bt-btn');
    const btHud = await page.evaluate(() => ({
      label: document.getElementById('casa-hud-label')?.textContent?.trim(),
      detail: document.getElementById('casa-hud-detail')?.textContent?.trim(),
    }));
    await page.click('#vm-sim-wired-btn');
    const wiredHud = await page.evaluate(() => ({
      label: document.getElementById('casa-hud-label')?.textContent?.trim(),
      detail: document.getElementById('casa-hud-detail')?.textContent?.trim(),
    }));
    check(
      volHud.visible &&
        volHud.detail === '82%' &&
        btHud.label === 'BT Earphone' &&
        btHud.detail === '85%' &&
        wiredHud.label === 'Wired Earphone',
      `Mode 4 (Volume & BT HUD): Volume(${volHud.detail}) / BT(${btHud.detail}) / Wired(${wiredHud.detail})`
    );

    // Test Mode 5: Drag & Drop -> DropZoneView Shelf Cards -> Copy Back to Desktop
    await page.click('button[data-vm-mode="dropzone"]');
    await page.click('#vm-sim-drop-all-btn');
    await new Promise((r) => setTimeout(r, 180));
    const dzBefore = await page.evaluate(() => ({
      dropCards: document.querySelectorAll('#vm-dropped-items .casa-drop-card').length,
      copyBackVisible: document.getElementById('vm-copy-back-btn')?.hidden === false,
    }));
    await page.click('#vm-copy-back-btn');
    await new Promise((r) => setTimeout(r, 180));
    const dzAfter = await page.evaluate(() => ({
      stashedDesktopCards: document.querySelectorAll('#vm-desktop-files .vm-file-card.stashed').length,
      hudLabel: document.getElementById('casa-hud-label')?.textContent?.trim(),
    }));
    check(
      dzBefore.dropCards === 1 &&
        dzBefore.copyBackVisible &&
        dzAfter.stashedDesktopCards === 0 &&
        dzAfter.hudLabel === 'Copied Back',
      `Mode 5 (Drag & Drop): shelf rendered native DropShelfCard, Copy Back to Desktop restored state cleanly`
    );

    // Test Clean URL Navigation Without `#` Across All Header Anchor Links
    const navTargets = ['architecture', 'download', 'feedback', 'playground', 'top'];
    let allNavClean = true;
    for (const target of navTargets) {
      await page.click(`a[data-scroll-target="${target}"]`);
      await new Promise((r) => setTimeout(r, 200));
      const hashNow = await page.evaluate(() => window.location.hash);
      if (hashNow !== '') {
        allNavClean = false;
        check(false, `Navigation link "${target}" leaked URL hash: ${hashNow}`);
      }
    }
    check(allNavClean, 'All header navigation links & brand logo scroll cleanly with window.location.hash === ""');

    const overflowDesktop = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    check(!overflowDesktop, 'Desktop 1280x800 has zero horizontal overflow');
    check(
      consoleErrors.length === 0 && cspErrors.length === 0,
      `Desktop zero console/CSP errors (pageErrors=${consoleErrors.length}, csp=${cspErrors.length})`
    );

    // =========================================================================
    // MOBILE 390x844 SUITE
    // =========================================================================
    console.log('\n[Mobile 390x844] Responsive Native Parity Verification\n');
    const mobilePage = await browser.newPage();
    await mobilePage.setViewport({ width: 390, height: 844 });
    const mobileCspErrors = [];
    mobilePage.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().toLowerCase().includes('content security policy')) {
        mobileCspErrors.push(msg.text());
      }
    });
    await mobilePage.setRequestInterception(true);
    mobilePage.on('request', (req) => {
      if (req.url().startsWith('https://api.github.com/')) {
        req.respond({ status: 200, contentType: 'application/json', body: '[]' });
        return;
      }
      req.continue();
    });
    await mobilePage.goto('http://127.0.0.1:5212/', { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 200));
    await mobilePage.click('button[data-vm-mode="lyrics"]');
    await mobilePage.click('button[data-vm-mode="dropzone"]');
    await mobilePage.click('#vm-sim-drop-all-btn');
    await new Promise((r) => setTimeout(r, 180));

    const mobileMetrics = await mobilePage.evaluate(() => {
      const mRect = document.getElementById('virtual-monitor')?.getBoundingClientRect();
      return {
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
        monitorW: Math.round(mRect?.width ?? 0),
        dropCards: document.querySelectorAll('#vm-dropped-items .casa-drop-card').length,
      };
    });

    check(
      !mobileMetrics.overflowX && mobileMetrics.monitorW <= 390 && mobileMetrics.dropCards === 1,
      `Mobile 390x844 zero horizontal overflow (${mobileMetrics.scrollW}/${mobileMetrics.innerW}, dropCards=${mobileMetrics.dropCards})`
    );
    check(mobileCspErrors.length === 0, `Mobile zero CSP errors (${mobileCspErrors.length})`);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n================================================================`);
  console.log(`  PARITY E2E RESULT: ${passed} passed, ${failed} failed`);
  console.log(`================================================================\n`);
  assert.equal(failed, 0, `${failed} assertion(s) failed`);
}

main().catch((err) => {
  console.error('\n[FATAL]', err);
  process.exit(1);
});
