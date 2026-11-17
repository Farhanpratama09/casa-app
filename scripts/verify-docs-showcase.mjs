/**
 * CASA Phase 11.0 Showcase Verification (Desktop 1280x800 + Mobile 390x844)
 * Serves `docs/` over local HTTP with strict CSP check via Puppeteer Chromium.
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

function startStaticServer(port = 5211) {
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
  const server = await startStaticServer(5211);
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
    console.log('\n[Desktop 1280x800] SEO, Intro Morph & 5 Interactive Modes\n');
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
        req.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              tag_name: 'v2.0.0',
              published_at: '2026-11-17T00:00:00Z',
              html_url: 'https://github.com/Farhanpratama09/casa-app/releases/tag/v2.0.0',
              assets: [
                {
                  name: 'CASA_2.0.0_x64-setup.exe',
                  size: 4641413,
                  download_count: 142,
                  browser_download_url:
                    'https://github.com/Farhanpratama09/casa-app/releases/download/v2.0.0/CASA_2.0.0_x64-setup.exe',
                },
                {
                  name: 'CASA_2.0.0_x64_en-US.msi',
                  size: 6725632,
                  download_count: 38,
                  browser_download_url:
                    'https://github.com/Farhanpratama09/casa-app/releases/download/v2.0.0/CASA_2.0.0_x64_en-US.msi',
                },
              ],
            },
          ]),
        });
        return;
      }
      req.continue();
    });

    await page.goto('http://127.0.0.1:5211/', { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 350));

    // Check SEO, Header/Hero Cleanliness, Footer Signature & Monitor Ratio
    const seoAndLayout = await page.evaluate(() => {
      const header = document.querySelector('.site-header');
      const heroIntro = document.querySelector('.hero-intro');
      const monitor = document.getElementById('virtual-monitor');
      const mRect = monitor ? monitor.getBoundingClientRect() : null;
      const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
      const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
      const twCard = document.querySelector('meta[name="twitter:card"]')?.getAttribute('content');
      const ldJson = document.querySelector('script[type="application/ld+json"]')?.textContent || '';
      const footerSig = document.querySelector('.footer-sig')?.textContent?.trim();
      const introPhaseInitial = monitor?.getAttribute('data-intro-phase');
      const hiVisible = document.getElementById('intro-greeting')?.textContent?.trim();
      const ratio = mRect ? mRect.width / mRect.height : 0;
      const sectionsOrder = Array.from(document.querySelectorAll('main > section')).map((s) => s.id);
      return {
        title: document.title,
        headerHasV2: header?.textContent?.includes('v2.0.0') ?? false,
        heroHasV2: heroIntro?.textContent?.includes('v2.0.0') ?? false,
        canonical,
        ogTitle,
        twCard,
        hasSoftwareAppLd: ldJson.includes('"SoftwareApplication"'),
        footerSig,
        introPhaseInitial,
        hiVisible,
        ratio,
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
        sectionsOrder,
      };
    });

    check(
      seoAndLayout.title === 'CASA — Dynamic Rabbit Island for Windows',
      `Page title matches (${seoAndLayout.title})`
    );
    check(
      !seoAndLayout.headerHasV2 && !seoAndLayout.heroHasV2,
      'Header and Hero contain zero v2.0.0 version labels'
    );
    check(
      seoAndLayout.canonical === 'https://farhanpratama09.github.io/casa-app/' &&
        seoAndLayout.ogTitle === 'CASA — Dynamic Rabbit Island for Windows' &&
        seoAndLayout.twCard === 'summary_large_image' &&
        seoAndLayout.hasSoftwareAppLd,
      'Canonical, Open Graph, Twitter Card & SoftwareApplication JSON-LD present'
    );
    check(
      seoAndLayout.footerSig === 'Crafted by Crimson',
      `Footer signature verified (${seoAndLayout.footerSig})`
    );
    check(
      seoAndLayout.sectionsOrder[0] === 'playground' &&
        seoAndLayout.sectionsOrder[seoAndLayout.sectionsOrder.length - 1] === 'feedback' &&
        seoAndLayout.sectionsOrder.indexOf('download') > seoAndLayout.sectionsOrder.indexOf('architecture'),
      `Section order places Download & Feedback cleanly at bottom (${seoAndLayout.sectionsOrder.join(' -> ')})`
    );
    check(
      Math.abs(seoAndLayout.ratio - 1.6) < 0.08,
      `Desktop virtual monitor keeps ~16:10 ratio (${seoAndLayout.ratio.toFixed(2)})`
    );
    check(
      seoAndLayout.introPhaseInitial === 'hi' && seoAndLayout.hiVisible === 'Hi.',
      `Intro begins with "Hi." Obsidian Bunny phase (${seoAndLayout.introPhaseInitial})`
    );

    // Wait for Morph Sequence to transition cleanly into 'ready'
    await page.waitForFunction(
      () => document.getElementById('virtual-monitor')?.getAttribute('data-intro-phase') === 'ready',
      { timeout: 5000 }
    );
    const afterIntro = await page.evaluate(() => ({
      introHidden: document.getElementById('intro-overlay')?.hidden === true,
      subtitle: document.getElementById('vm-notch-subtitle')?.textContent?.trim(),
      battery: document.getElementById('vm-battery-badge')?.textContent?.trim(),
    }));
    check(
      afterIntro.introHidden && afterIntro.subtitle === 'Awake' && afterIntro.battery === '88%',
      `Intro morph completes to ready awake notch (${afterIntro.subtitle}, ${afterIntro.battery})`
    );

    // Replay Intro test
    await page.click('#replay-intro-btn');
    await new Promise((r) => setTimeout(r, 120));
    const replayedPhase = await page.evaluate(() =>
      document.getElementById('virtual-monitor')?.getAttribute('data-intro-phase')
    );
    check(replayedPhase === 'hi', `Replay Intro resets cleanly to "Hi." phase (${replayedPhase})`);
    await page.waitForFunction(
      () => document.getElementById('virtual-monitor')?.getAttribute('data-intro-phase') === 'ready',
      { timeout: 5000 }
    );

    // Mode 1: Resting & Wake + Alt+Space
    await page.keyboard.down('AltLeft');
    await page.keyboard.press('Space');
    await page.keyboard.up('AltLeft');
    await new Promise((r) => setTimeout(r, 150));
    const expandedViaHotkey = await page.evaluate(
      () => document.getElementById('vm-notch-capsule')?.getAttribute('data-state') === 'expanded'
    );
    check(expandedViaHotkey, 'Mode 1 (Resting & Wake): Alt + Space expands top monitor capsule');

    // Mode 2: Lyrics & Queue + Idle Lyric Minimize + Queue Click
    await page.click('button[data-vm-mode="lyrics"]');
    await new Promise((r) => setTimeout(r, 150));
    const secondQueueBtn = await page.$$('#vm-queue-list .vm-queue-btn');
    await secondQueueBtn[1].click();
    await page.click('#scene-lyric-minimize-btn');
    await new Promise((r) => setTimeout(r, 150));
    const lyricsResult = await page.evaluate(() => ({
      trackTitle: document.getElementById('vm-notch-title')?.textContent?.trim(),
      miniLyricVisible: document.getElementById('vm-mini-lyric-pill')?.hidden === false,
      miniLyricText: document.getElementById('vm-mini-lyric-pill')?.textContent?.trim(),
    }));
    check(
      lyricsResult.trackTitle === 'Obsidian Horizon' &&
        lyricsResult.miniLyricVisible &&
        Boolean(lyricsResult.miniLyricText),
      `Mode 2 (Lyrics & Queue): queue switch + Idle Lyric Minimize renders mini lyric ticker ("${lyricsResult.miniLyricText}")`
    );

    // Mode 3: To-Do & Focus (Add To-Do + Check + Dual-Idle)
    await page.click('button[data-vm-mode="todo"]');
    await page.type('#vm-todo-input', 'Test SVG focus ring');
    await page.click('#vm-todo-form button[type="submit"]');
    const secondCb = await page.$$('#vm-todo-list .vm-todo-checkbox');
    await secondCb[1].click();
    await page.click('#vm-todo-dual-btn');
    await new Promise((r) => setTimeout(r, 150));
    const todoResult = await page.evaluate(() => ({
      progressText: document.getElementById('vm-todo-progress-text')?.textContent?.trim(),
      ringPct: document.getElementById('vm-focus-mini-pct')?.textContent?.trim(),
      ringOffset: Number(document.getElementById('vm-focus-ring-arc')?.style.strokeDashoffset || 99),
      eyeBadge: document.getElementById('vm-focus-eye-badge')?.textContent?.trim(),
    }));
    check(
      todoResult.progressText === '2 / 4 selesai' &&
        todoResult.ringPct === '2/4' &&
        todoResult.ringOffset < 30 &&
        todoResult.eyeBadge?.includes('•̀ ♪'),
      `Mode 3 (To-Do & Focus): live progress (${todoResult.ringPct}), ring updated, Dual-Idle (${todoResult.eyeBadge})`
    );

    // Mode 4: Volume & BT HUD
    await page.click('button[data-vm-mode="hud"]');
    await page.evaluate(() => {
      const slider = document.getElementById('vm-volume-slider');
      slider.value = '84';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const volHud = await page.evaluate(() => document.getElementById('vm-hud-chip')?.textContent?.trim());
    await page.click('#vm-sim-bt-btn');
    const btHud = await page.evaluate(() => document.getElementById('vm-hud-chip')?.textContent?.trim());
    await page.click('#vm-sim-wired-btn');
    const wiredHud = await page.evaluate(() => document.getElementById('vm-hud-chip')?.textContent?.trim());
    check(
      volHud === 'Vol 84%' && btHud?.includes('85%') && wiredHud === 'Wired Earphone',
      `Mode 4 (Volume & BT HUD): Volume(${volHud}) / BT(${btHud}) / Wired(${wiredHud}) chips triggered`
    );

    // Mode 5: Drag & Drop + Pointer Drag to Top + Copy Back to Desktop
    await page.click('button[data-vm-mode="dropzone"]');
    await new Promise((r) => setTimeout(r, 150));
    const pointerDropMetrics = await page.evaluate(() => {
      const card = document.querySelector('#vm-desktop-files .vm-file-card');
      const screen = document.getElementById('monitor-screen');
      const cr = card.getBoundingClientRect();
      const sr = screen.getBoundingClientRect();
      return {
        startX: cr.left + cr.width / 2,
        startY: cr.top + cr.height / 2,
        endX: sr.left + sr.width / 2,
        endY: sr.top + 28,
      };
    });
    await page.mouse.move(pointerDropMetrics.startX, pointerDropMetrics.startY);
    await page.mouse.down();
    await page.mouse.move(pointerDropMetrics.endX, pointerDropMetrics.endY, { steps: 10 });
    await page.mouse.up();
    await page.click('#vm-sim-drop-all-btn');
    await new Promise((r) => setTimeout(r, 150));

    const droppedBeforeCopy = await page.evaluate(() => ({
      countText: document.getElementById('vm-dropzone-count')?.textContent?.trim(),
      chipsCount: document.querySelectorAll('#vm-dropped-items .vm-dropped-chip').length,
      copyBackVisible: document.getElementById('vm-copy-back-btn')?.hidden === false,
    }));
    await page.click('#vm-copy-back-btn');
    await new Promise((r) => setTimeout(r, 150));
    const afterCopyBack = await page.evaluate(() => ({
      countText: document.getElementById('vm-dropzone-count')?.textContent?.trim(),
      stashedCards: document.querySelectorAll('#vm-desktop-files .vm-file-card.stashed').length,
      hudText: document.getElementById('vm-hud-chip')?.textContent?.trim(),
    }));
    check(
      droppedBeforeCopy.chipsCount >= 1 &&
        droppedBeforeCopy.copyBackVisible &&
        afterCopyBack.stashedCards === 0 &&
        afterCopyBack.hudText === 'Copied Back to Desktop',
      `Mode 5 (Drag & Drop): captured ${droppedBeforeCopy.chipsCount} file(s), restored cleanly via Copy Back to Desktop`
    );

    check(!seoAndLayout.overflowX, 'Desktop 1280x800 has zero horizontal overflow');
    check(
      consoleErrors.length === 0 && cspErrors.length === 0,
      `Desktop zero console/CSP errors (pageErrors=${consoleErrors.length}, csp=${cspErrors.length})`
    );

    // =========================================================================
    // MOBILE 390x844 SUITE
    // =========================================================================
    console.log('\n[Mobile 390x844] Responsive Virtual Monitor & Touch Drop Verification\n');
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
    await mobilePage.goto('http://127.0.0.1:5211/', { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 200));
    await mobilePage.click('button[data-vm-mode="dropzone"]');
    await mobilePage.click('#vm-sim-drop-all-btn');
    await new Promise((r) => setTimeout(r, 150));

    const mobileMetrics = await mobilePage.evaluate(() => {
      const mRect = document.getElementById('virtual-monitor')?.getBoundingClientRect();
      const dockButtons = Array.from(document.querySelectorAll('.mode-dock-btn'));
      return {
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
        monitorWidth: mRect ? Math.round(mRect.width) : 0,
        dockWrappedCleanly: dockButtons.every((b) => b.getBoundingClientRect().right <= window.innerWidth),
        mobileDropped: document.querySelectorAll('#vm-dropped-items .vm-dropped-chip').length,
      };
    });

    check(
      !mobileMetrics.overflowX && mobileMetrics.monitorWidth <= 390,
      `Mobile 390x844 fits monitor (${mobileMetrics.monitorWidth}px) with zero horizontal overflow (${mobileMetrics.scrollW}/${mobileMetrics.innerW})`
    );
    check(
      mobileMetrics.dockWrappedCleanly && mobileMetrics.mobileDropped >= 1,
      `Mobile mode dock wraps inside 390px and Drop Zone captures files (${mobileMetrics.mobileDropped})`
    );
    check(
      mobileCspErrors.length === 0,
      `Mobile zero CSP errors (${mobileCspErrors.length})`
    );
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n================================================================`);
  console.log(`  SHOWCASE E2E RESULT: ${passed} passed, ${failed} failed`);
  console.log(`================================================================\n`);
  assert.equal(failed, 0, `${failed} assertion(s) failed`);
}

main().catch((err) => {
  console.error('\n[FATAL]', err);
  process.exit(1);
});
