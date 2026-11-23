/**
 * CASA v2.0.1 Visual Parity, Clean Path Routing & Brightness HUD Verification
 * Serves `docs/` at `/` and `/casa-app/` with `404.html` fallback for direct sub-routes,
 * running headless Chromium E2E across Desktop (1280x800) & Mobile (390x844).
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const DOCS_DIR = path.resolve('docs');
const EXE_BUNDLE_PATH = path.resolve(
  'src-tauri/target/release/bundle/nsis/CASA_2.3.0_x64-setup.exe'
);
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

function startStaticServer(port = 5212, { overrideSupabaseKey } = {}) {
  const server = http.createServer((req, res) => {
    const rawUrl = (req.url || '/').split('?')[0];
    // Support both `/casa-app/...` (GitHub Pages project subpath) and `/`
    let relPath = rawUrl.replace(/^\/casa-app(?=\/|$)/i, '');
    if (!relPath || relPath === '/') {
      relPath = 'index.html';
    } else {
      relPath = relPath.replace(/^\/+/, '');
    }

    const filePath = path.resolve(DOCS_DIR, relPath);
    if (!filePath.startsWith(DOCS_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      const notFoundPage = path.resolve(DOCS_DIR, '404.html');
      if (fs.existsSync(notFoundPage)) {
        res.writeHead(404, { 'Content-Type': MIME['.html'] });
        fs.createReadStream(notFoundPage).pipe(res);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    if (typeof overrideSupabaseKey === 'string' && relPath === 'app.js') {
      const src = fs
        .readFileSync(filePath, 'utf8')
        .replace(
          /const\s+SUPABASE_PUBLISHABLE_KEY\s*=\s*(['"`]).*?\1;/,
          `const SUPABASE_PUBLISHABLE_KEY = '${overrideSupabaseKey}';`
        );
      res.end(src, 'utf8');
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const server = await startStaticServer(5212, { overrideSupabaseKey: '' });
  const candidateBrowsers = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  const chromePath = candidateBrowsers.find((p) => fs.existsSync(p));
  if (!chromePath) throw new Error('Chromium binary not found');

  const expectedExeSha = fs.existsSync(EXE_BUNDLE_PATH)
    ? crypto.createHash('sha256').update(fs.readFileSync(EXE_BUNDLE_PATH)).digest('hex').toUpperCase()
    : null;

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    defaultViewport: { width: 1280, height: 800 },
  });

  try {
    // =========================================================================
    // DESKTOP 1280x800 SUITE (/casa-app/)
    // =========================================================================
    console.log('\n[Desktop 1280x800] Compact Wake, Brightness HUD & Clean Path Routing\n');
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
    let githubReleasesCalls = 0;
    page.on('request', (req) => {
      if (req.url().startsWith('https://api.github.com/')) {
        githubReleasesCalls++;
        req.respond({
          status: 200,
          headers: { 'Access-Control-Allow-Origin': '*' },
          contentType: 'application/json',
          body: JSON.stringify([
            {
              tag_name: 'v2.3.0',
              assets: [
                {
                  name: 'CASA_2.3.0_x64-setup.exe',
                  size: 4876396,
                  download_count: 8,
                  browser_download_url:
                    'https://github.com/Farhanpratama09/casa-app/releases/download/v2.3.0/CASA_2.3.0_x64-setup.exe',
                },
                { name: 'CASA_2.3.0_x64-setup.exe.sig', size: 444, download_count: 90 },
                { name: 'CASA_2.3.0_x64_en-US.msi', size: 5857280, download_count: 3 },
                { name: 'CASA_2.3.0_x64_en-US.msi.sig', size: 444, download_count: 45 },
                { name: 'latest.json', size: 1200, download_count: 500 },
              ],
            },
            {
              tag_name: 'v2.0.1',
              assets: [
                { name: 'CASA_2.0.1_x64-setup.exe', size: 4652960, download_count: 2 },
                { name: 'CASA_2.0.1_x64_en-US.msi', size: 6729728, download_count: 1 },
              ],
            },
          ]),
        });
        return;
      }
      req.continue();
    });

    await page.goto('http://127.0.0.1:5212/casa-app/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => document.getElementById('download-count-text')?.hidden === false,
      { timeout: 3000 }
    );

    const layoutAudit = await page.evaluate(() => {
      const heroIntro = document.querySelector('.hero-intro');
      const heroButtons = heroIntro ? heroIntro.querySelectorAll('a, button').length : -1;
      const monitorScreen = document.getElementById('monitor-screen');
      const replayInsideMonitor = Boolean(
        monitorScreen && monitorScreen.contains(document.getElementById('replay-intro-btn'))
      );
      const hasConcaveShoulders = document.querySelectorAll('.casa-shoulder').length === 2;
      const capsuleHeight = Math.round(
        document.getElementById('vm-notch-capsule')?.getBoundingClientRect().height ?? 0
      );

      const downloadSection = document.getElementById('download');
      const primaryBtn = document.getElementById('primary-download-btn');
      const hasPrimaryExe = Boolean(primaryBtn);
      const primaryLabelText =
        document.getElementById('primary-download-label')?.textContent?.trim() || '';
      const primaryHref = primaryBtn?.getAttribute('href') || '';
      const dlSizeText = document.getElementById('download-size-text')?.textContent?.trim() || '';
      const dlCountEl = document.getElementById('download-count-text');
      const dlCountText = dlCountEl?.textContent?.trim() || '';
      const dlCountHidden = dlCountEl?.hidden === true;
      const dlCacheRaw = window.localStorage.getItem('casa_dl_count_cache');
      const dlCachedCount = dlCacheRaw ? JSON.parse(dlCacheRaw).count : null;
      const shaDetails = downloadSection?.querySelector('details.sha-accordion');
      const shaSummaryText = shaDetails?.querySelector('summary')?.textContent?.trim();
      const shaText = document.getElementById('sha-value-exe')?.textContent?.trim() || '';

      return {
        title: document.title,
        heroButtons,
        replayInsideMonitor,
        hasConcaveShoulders,
        capsuleHeight,
        hasPrimaryExe,
        primaryLabelText,
        primaryHref,
        dlSizeText,
        dlCountText,
        dlCountHidden,
        dlCachedCount,
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
      `Hero clean without download button (${layoutAudit.heroButtons}) & Replay Intro inside monitor`
    );
    check(
      layoutAudit.hasConcaveShoulders && layoutAudit.capsuleHeight === 39,
      `1:1 Island anatomy matches src/ (2 concave shoulders, height=${layoutAudit.capsuleHeight}px)`
    );
    check(
      layoutAudit.hasPrimaryExe &&
        layoutAudit.primaryLabelText === 'Download CASA for Windows' &&
        layoutAudit.dlSizeText.startsWith('v2.3.0 · NSIS Setup (.exe) ·') &&
        layoutAudit.primaryHref.includes('CASA_2.3.0_x64-setup.exe') &&
        layoutAudit.shaClosedInitially &&
        layoutAudit.shaSummaryText === 'Verify SHA-256 checksum' &&
        /^[0-9A-F]{64}$/.test(layoutAudit.shaText) &&
        (!expectedExeSha || layoutAudit.shaText === expectedExeSha),
      `Download CTA "${layoutAudit.primaryLabelText}" + metadata "${layoutAudit.dlSizeText}" + SHA-256 valid (${layoutAudit.shaText.slice(0, 12)}...)`
    );
    check(
      !layoutAudit.dlCountHidden &&
        layoutAudit.dlCountText.includes('14 downloads') &&
        layoutAudit.dlCachedCount === 14 &&
        githubReleasesCalls === 1,
      `Live download counter summed .exe+.msi only (${layoutAudit.dlCountText}) & cached in localStorage`
    );

    const cooldownAudit = await page.evaluate(() => {
      const btn = document.getElementById('primary-download-btn');
      const label = document.getElementById('primary-download-label');
      let firstWasAllowed = false;
      btn.addEventListener(
        'click',
        (ev) => {
          firstWasAllowed = !ev.defaultPrevented;
          ev.preventDefault();
        },
        { once: true }
      );
      btn.dispatchEvent(new MouseEvent('click', { cancelable: true, bubbles: true }));
      const disabledAfterFirst = btn.getAttribute('aria-disabled');
      const labelAfterFirst = label?.textContent?.trim();
      const secondNotCanceled = btn.dispatchEvent(
        new MouseEvent('click', { cancelable: true, bubbles: true })
      );
      return {
        firstWasAllowed,
        disabledAfterFirst,
        labelAfterFirst,
        secondBlocked: secondNotCanceled === false,
      };
    });
    check(
      cooldownAudit.firstWasAllowed &&
        cooldownAudit.disabledAfterFirst === 'true' &&
        cooldownAudit.labelAfterFirst === 'Memulai unduhan...' &&
        cooldownAudit.secondBlocked,
      `Download button activates 6s cooldown (${cooldownAudit.labelAfterFirst}) and blocks repeat clicks`
    );
    check(
      layoutAudit.introPhase === 'hi',
      `Intro begins with "Hi." Obsidian Bunny phase (${layoutAudit.introPhase})`
    );

    // Wait for intro morph sequence -> must stop cleanly on COMPACT × ♥ capsule (no clock/battery, no scaleY squash)
    await page.waitForFunction(
      () => document.getElementById('virtual-monitor')?.getAttribute('data-intro-phase') === 'ready',
      { timeout: 5500 }
    );
    await new Promise((r) => setTimeout(r, 120));

    const postIntroCompact = await page.evaluate(() => {
      const compactPill = document.getElementById('casa-resting-pill');
      const activePill = document.getElementById('casa-active-pill');
      const firstEye = document.querySelector('.casa-compact-eye');
      const eyeTransform = firstEye ? window.getComputedStyle(firstEye).transform : '';
      const capsuleW = Math.round(
        document.getElementById('vm-notch-capsule')?.getBoundingClientRect().width ?? 0
      );
      return {
        compactVisible: compactPill?.hidden === false,
        compactSleep: compactPill?.getAttribute('data-sleep'),
        activeHidden: activePill?.hidden === true,
        capsuleW,
        eyeNotSquashed: eyeTransform === 'none' || eyeTransform === 'matrix(1, 0, 0, 1, 0, 0)',
      };
    });
    check(
      postIntroCompact.compactVisible &&
        postIntroCompact.compactSleep === 'false' &&
        postIntroCompact.activeHidden &&
        postIntroCompact.capsuleW <= 140 &&
        postIntroCompact.eyeNotSquashed,
      `Intro stops on compact × ♥ capsule without clock/battery or vertical squash (W=${postIntroCompact.capsuleW}px)`
    );

    // Resting & Wake Sleep -> Wake retains compact × ♥ capsule
    await page.click('#scene-toggle-rest-btn');
    await new Promise((r) => setTimeout(r, 120));
    const sleptState = await page.evaluate(() => ({
      sleepAttr: document.getElementById('casa-resting-pill')?.getAttribute('data-sleep'),
      compactVisible: document.getElementById('casa-resting-pill')?.hidden === false,
    }));
    await page.click('#scene-toggle-rest-btn');
    await new Promise((r) => setTimeout(r, 120));
    const wokeState = await page.evaluate(() => ({
      sleepAttr: document.getElementById('casa-resting-pill')?.getAttribute('data-sleep'),
      compactVisible: document.getElementById('casa-resting-pill')?.hidden === false,
      activeHidden: document.getElementById('casa-active-pill')?.hidden === true,
    }));
    check(
      sleptState.compactVisible &&
        sleptState.sleepAttr === 'true' &&
        wokeState.compactVisible &&
        wokeState.sleepAttr === 'false' &&
        wokeState.activeHidden,
      'Resting & Wake retains compact × ♥ capsule across sleep -> wake cycle'
    );

    // Alt+Space expands Mode 6, Alt+Space collapses back to compact × ♥
    await page.keyboard.down('AltLeft');
    await page.keyboard.press('Space');
    await page.keyboard.up('AltLeft');
    await new Promise((r) => setTimeout(r, 180));
    const m6OpenCheck = await page.evaluate(() => ({
      expanded: document.getElementById('vm-notch-capsule')?.getAttribute('data-state') === 'expanded',
      variant: document.getElementById('vm-notch-capsule')?.getAttribute('data-variant'),
      hasNavTabs: document.querySelectorAll('.casa-m6-tab:not([hidden])').length === 4,
    }));
    await page.keyboard.down('AltLeft');
    await page.keyboard.press('Space');
    await page.keyboard.up('AltLeft');
    await new Promise((r) => setTimeout(r, 180));
    const m6CollapsedBack = await page.evaluate(() => ({
      idle: document.getElementById('vm-notch-capsule')?.getAttribute('data-state') === 'idle',
      compactVisible: document.getElementById('casa-resting-pill')?.hidden === false,
    }));
    check(
      m6OpenCheck.expanded &&
        m6OpenCheck.hasNavTabs &&
        m6CollapsedBack.idle &&
        m6CollapsedBack.compactVisible,
      `Alt+Space toggles Mode 6 (${m6OpenCheck.variant}) and collapses cleanly back to compact × ♥`
    );

    // Mode 2: Lyrics & Queue (Player | Playlists sub-nav + Right QUEUE Popout) + Idle Lyric Minimize
    await page.click('button[data-vm-mode="lyrics"]');
    await new Promise((r) => setTimeout(r, 150));

    const musicNavAudit = await page.evaluate(() => {
      const pills = Array.from(document.querySelectorAll('#vm-exp-music .casa-sub-pill')).map((el) =>
        (el.textContent || '').trim()
      );
      return { pills };
    });
    await page.click('#vm-exp-queue-toggle');
    await new Promise((r) => setTimeout(r, 120));
    const popoutAudit = await page.evaluate(() => ({
      open: document.getElementById('vm-exp-queue-popout')?.hidden === false,
      title: document.getElementById('vm-exp-queue-title')?.textContent?.trim(),
      items: document.querySelectorAll('#vm-exp-queue-list .casa-q-mini-btn').length,
    }));
    await page.click('#vm-exp-queue-close');
    await page.click('button[data-music-sub="playlists"]');
    await new Promise((r) => setTimeout(r, 100));
    const playlistAudit = await page.evaluate(() => ({
      playlistsVisible: document.getElementById('vm-music-sub-playlists')?.hidden === false,
      playlistRows: document.querySelectorAll('#vm-exp-playlist-list .casa-q-mini-btn').length,
    }));
    await page.click('button[data-music-sub="player"]');

    check(
      musicNavAudit.pills.length === 2 &&
        musicNavAudit.pills[0] === 'Player' &&
        musicNavAudit.pills[1] === 'Playlists' &&
        popoutAudit.open &&
        popoutAudit.title === 'QUEUE' &&
        popoutAudit.items === 4 &&
        playlistAudit.playlistsVisible &&
        playlistAudit.playlistRows === 3,
      `Mode 2 Sub-Nav (${musicNavAudit.pills.join('|')}) & Popout Header (${popoutAudit.title}, ${popoutAudit.items} items)`
    );

    const qBtns = await page.$$('#vm-queue-list .vm-queue-btn');
    await qBtns[1].click();
    await page.click('#vm-idle-lyric-btn');
    await new Promise((r) => setTimeout(r, 180));
    const musicIdleCheck = await page.evaluate(() => ({
      collapsedToIdle: document.getElementById('vm-notch-capsule')?.getAttribute('data-state') === 'idle',
      miniLyricVisible: document.getElementById('vm-mini-lyric-pill')?.hidden === false,
      miniLyricText: document.getElementById('vm-mini-lyric-pill')?.textContent?.trim(),
    }));
    check(
      musicIdleCheck.collapsedToIdle &&
        musicIdleCheck.miniLyricVisible &&
        musicIdleCheck.miniLyricText === '4px Smart-Tuck rests along the top edge',
      `Mode 2 (Lyrics & Queue): Idle Lyric Minimize shows synced lyric (${musicIdleCheck.miniLyricText})`
    );

    // Mode 3: To-Do & Focus
    await page.click('button[data-vm-mode="todo"]');
    await new Promise((r) => setTimeout(r, 150));
    await page.type('#vm-todo-input', 'Verify v2.0.1 route');
    await page.click('#vm-todo-form button[type="submit"]');
    const cbs = await page.$$('#vm-todo-list .vm-todo-checkbox');
    await cbs[1].click();
    await page.click('#vm-todo-dual-btn');
    await page.click('#vm-notch-collapse-btn');
    await new Promise((r) => setTimeout(r, 180));
    const todoIdleCheck = await page.evaluate(() => ({
      perimeterVisible: document.getElementById('vm-perimeter-svg')?.hidden === false,
      progressText: document.getElementById('vm-todo-progress-text')?.textContent?.trim(),
      musicSegmentVisible: document.getElementById('casa-music-segment')?.hidden === false,
    }));
    check(
      todoIdleCheck.perimeterVisible &&
        todoIdleCheck.progressText === '2 / 4 selesai' &&
        todoIdleCheck.musicSegmentVisible,
      `Mode 3 (To-Do & Focus): U-shape perimeter stroke & Dual-Idle active (${todoIdleCheck.progressText})`
    );

    // Mode 4: Volume, Brightness & BT HUD + Live Screen Dimming
    await page.click('button[data-vm-mode="hud"]');
    await new Promise((r) => setTimeout(r, 120));
    await page.evaluate(() => {
      const b = document.getElementById('vm-brightness-slider');
      b.value = '45';
      b.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const brightHud = await page.evaluate(() => ({
      visible: document.getElementById('casa-hud-pill')?.hidden === false,
      label: document.getElementById('casa-hud-label')?.textContent?.trim(),
      detail: document.getElementById('casa-hud-detail')?.textContent?.trim(),
      barWidth: document.getElementById('casa-hud-bar-fill')?.style.width,
      desktopFilter: document.getElementById('monitor-desktop')?.style.filter || '',
      ccSynced: document.getElementById('vm-cc-bright-val')?.textContent?.trim(),
    }));
    await page.evaluate(() => {
      const s = document.getElementById('vm-volume-slider');
      s.value = '82';
      s.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const volHud = await page.evaluate(() => ({
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
    }));
    // Restore bright cleanly to 85%
    await page.evaluate(() => {
      const b = document.getElementById('vm-brightness-slider');
      b.value = '85';
      b.dispatchEvent(new Event('input', { bubbles: true }));
    });
    check(
      brightHud.visible &&
        brightHud.label === 'Brightness' &&
        brightHud.detail === '45%' &&
        brightHud.barWidth === '45%' &&
        brightHud.desktopFilter.includes('brightness(0.56') &&
        brightHud.ccSynced === '45%' &&
        volHud.detail === '82%' &&
        btHud.label === 'BT Earphone' &&
        wiredHud.label === 'Wired Earphone',
      `Mode 4 (Volume, Brightness & BT HUD): Brightness(${brightHud.detail}, ${brightHud.desktopFilter}) / Vol(${volHud.detail}) / BT / Wired`
    );

    // Mode 5: Drop Zone
    await page.click('button[data-vm-mode="dropzone"]');
    await page.click('#vm-sim-drop-all-btn');
    await new Promise((r) => setTimeout(r, 180));
    const dzBefore = await page.evaluate(() => ({
      dropCards: document.querySelectorAll('#vm-dropped-items .casa-drop-card').length,
      copyBackVisible: document.getElementById('vm-copy-back-btn')?.hidden === false,
    }));
    await page.click('#vm-copy-back-btn');
    await new Promise((r) => setTimeout(r, 180));
    check(
      dzBefore.dropCards === 1 && dzBefore.copyBackVisible,
      'Mode 5 (Drag & Drop): DropShelfCard & Copy Back to Desktop functional'
    );

    // Mode 6: Pengingat Ibadah (v2.1.0 Opt-In 5th Tab, Interactive 5-Phase Preview, T-0 ✦ ☾ Pill & Keep-Tab Banner)
    await page.click('button[data-vm-mode="ibadah"]');
    await new Promise((r) => setTimeout(r, 150));

    const expectedPhases = [
      { key: 'subuh', phase: 'sunrise', nextHeading: 'DZUHUR', pill: 'Preview 05:15', minX: 55, maxX: 110 },
      { key: 'dzuhur', phase: 'sun', nextHeading: 'ASHAR', pill: 'Preview 12:15', minX: 162, maxX: 220, hex: '#fffbeb' },
      { key: 'ashar', phase: 'sun', nextHeading: 'MAGHRIB', pill: 'Preview 15:30', minX: 268, maxX: 330, hex: '#fcd34d' },
      { key: 'maghrib', phase: 'sunset', nextHeading: 'ISYA', pill: 'Preview 17:40', minX: 376, maxX: 440, hex: '#fb923c' },
      { key: 'isya', phase: 'moon', nextHeading: 'SUBUH', pill: 'Preview 19:20', minX: 482, maxX: 525 },
    ];
    const phasePreviewResults = [];
    for (const exp of expectedPhases) {
      await page.click(`#vm-ibadah-grid button[data-prayer-preview="${exp.key}"]`);
      await new Promise((r) => setTimeout(r, 60));
      const snap = await page.evaluate((k) => {
        const expEl = document.getElementById('vm-exp-ibadah');
        const orbEl = document.getElementById('vm-ibadah-celestial-orb');
        const btn = document.querySelector(`#vm-ibadah-grid button[data-prayer-preview="${k}"]`);
        const dots = Array.from(document.querySelectorAll('#vm-ibadah-curve-svg .vm-prayer-dot'));
        const neutralDotFills = new Set(['#E4E4E7', '#FFFFFF', '#000000']);
        return {
          key: k,
          cursor: btn ? window.getComputedStyle(btn).cursor : '',
          previewActive: btn?.getAttribute('data-preview-active') === 'true',
          phase: orbEl?.getAttribute('data-celestial-phase') || '',
          orbX: Number(orbEl?.getAttribute('data-orb-x') || 0),
          orbGlyphChildren: document.getElementById('vm-ibadah-orb-glyph')?.children.length ?? 0,
          nextHeading: document.getElementById('vm-ibadah-next-heading')?.textContent?.trim() || '',
          previewPill: document.getElementById('vm-ibadah-preview-pill')?.textContent?.trim() || '',
          skyHex: (expEl?.style.getPropertyValue('--vm-ibadah-sky') || '').trim().toLowerCase(),
          allDotsNeutral:
            dots.length === 5 &&
            dots.every((d) => neutralDotFills.has((d.getAttribute('fill') || '').toUpperCase())),
          nextTagTexts: Array.from(document.querySelectorAll('#vm-ibadah-grid .casa-ibadah-next-tag')).map(
            (el) => el.textContent?.trim() || ''
          ),
          gridText: document.getElementById('vm-ibadah-grid')?.textContent || '',
        };
      }, exp.key);
      const ok =
        snap.cursor === 'pointer' &&
        snap.previewActive &&
        snap.phase === exp.phase &&
        snap.orbGlyphChildren > 0 &&
        snap.orbX >= exp.minX &&
        snap.orbX <= exp.maxX &&
        snap.nextHeading === exp.nextHeading &&
        snap.previewPill === exp.pill &&
        (!exp.hex || snap.skyHex === exp.hex) &&
        snap.allDotsNeutral &&
        snap.nextTagTexts.length === 1 &&
        snap.nextTagTexts[0] === 'NEXT' &&
        !/LEWAT|NANTI|BERIKUTNYA/i.test(snap.gridText);
      phasePreviewResults.push({ ...snap, ok });
    }
    const allPhasePreviewsOk = phasePreviewResults.every((r) => r.ok);

    const ibadahPanelAudit = await page.evaluate(() => ({
      visibleTabs: document.querySelectorAll('.casa-m6-tab:not([hidden])').length,
      ibadahOpen: document.getElementById('vm-exp-ibadah')?.hidden === false,
      hasParabolicSvg: Boolean(document.getElementById('vm-ibadah-curve-svg')),
      hasRefreshNearCity: Boolean(
        document.querySelector('.casa-ibadah-city-row #vm-ibadah-refresh-btn')
      ),
      prayerCols: document.querySelectorAll('#vm-ibadah-grid button.casa-ibadah-col').length,
      variant: document.getElementById('vm-notch-capsule')?.getAttribute('data-variant'),
    }));

    // T-0 Idle Pill (synced with last previewed prayer: Isya -> Adzan Isya)
    await page.click('#vm-sim-prayer-idle-btn');
    await new Promise((r) => setTimeout(r, 120));
    // Verify hoverExpandLocked: clicking non-button area of T-0 pill does NOT expand Mode 6
    await page.click('#vm-prayer-alert-title');
    await new Promise((r) => setTimeout(r, 120));
    const prayerIdleAudit = await page.evaluate(() => ({
      prayerPillVisible: document.getElementById('casa-prayer-pill')?.hidden === false,
      stayedIdle: document.getElementById('vm-notch-capsule')?.getAttribute('data-state') === 'idle',
      titleText: document.getElementById('vm-prayer-alert-title')?.textContent?.trim() || '',
      hasStarCrescentEyes: (document.getElementById('vm-prayer-eyes')?.children.length ?? 0) === 2,
      eqBars: document.querySelectorAll('#casa-prayer-pill .casa-prayer-eq-bar').length,
    }));
    await page.click('#vm-prayer-stop-btn');
    await new Promise((r) => setTimeout(r, 120));

    // Banner Mode 6 Test A: triggered while on Ibadah tab -> MUST stay on Ibadah (NO forced jump to Musik)
    await page.click('#vm-sim-prayer-banner-btn');
    await new Promise((r) => setTimeout(r, 150));
    const prayerBannerOnIbadahAudit = await page.evaluate(() => ({
      bannerVisible: document.getElementById('vm-expanded-prayer-banner')?.hidden === false,
      bannerLabel: document.getElementById('vm-expanded-prayer-label')?.textContent?.trim() || '',
      stayedOnIbadahTab:
        document.getElementById('vm-exp-ibadah')?.hidden === false &&
        document.getElementById('vm-exp-music')?.hidden === true &&
        document.getElementById('vm-notch-capsule')?.getAttribute('data-variant') === 'ibadah',
      expandedState: document.getElementById('vm-notch-capsule')?.getAttribute('data-state') === 'expanded',
    }));
    await page.click('#vm-expanded-prayer-stop-btn');
    await new Promise((r) => setTimeout(r, 100));
    const afterStopOnIbadahAudit = await page.evaluate(() => ({
      bannerHidden: document.getElementById('vm-expanded-prayer-banner')?.hidden === true,
      stayedOnIbadahTab: document.getElementById('vm-exp-ibadah')?.hidden === false,
      stayedExpanded: document.getElementById('vm-notch-capsule')?.getAttribute('data-state') === 'expanded',
    }));

    // Banner Mode 6 Test B: switch Mode 6 header to Focus & Tasks -> Banner MUST stay on Focus & Tasks (not Musik)
    await page.click('.casa-m6-tab[data-m6-tab="todo"]');
    await new Promise((r) => setTimeout(r, 120));
    await page.click('#vm-sim-prayer-banner-btn');
    await new Promise((r) => setTimeout(r, 150));
    const prayerBannerOnTodoAudit = await page.evaluate(() => ({
      bannerVisible: document.getElementById('vm-expanded-prayer-banner')?.hidden === false,
      stayedOnTodoTab:
        document.getElementById('vm-exp-focus')?.hidden === false &&
        document.getElementById('vm-exp-music')?.hidden === true &&
        document.getElementById('vm-notch-capsule')?.getAttribute('data-variant') === 'todo',
    }));
    await page.click('#vm-expanded-prayer-stop-btn');
    await new Promise((r) => setTimeout(r, 100));
    const afterStopOnTodoAudit = await page.evaluate(() => ({
      bannerHidden: document.getElementById('vm-expanded-prayer-banner')?.hidden === true,
      stayedOnTodoTab: document.getElementById('vm-exp-focus')?.hidden === false,
      stayedExpanded: document.getElementById('vm-notch-capsule')?.getAttribute('data-state') === 'expanded',
    }));

    check(
      ibadahPanelAudit.visibleTabs === 5 &&
        ibadahPanelAudit.ibadahOpen &&
        ibadahPanelAudit.hasParabolicSvg &&
        ibadahPanelAudit.hasRefreshNearCity &&
        ibadahPanelAudit.prayerCols === 5 &&
        ibadahPanelAudit.variant === 'ibadah' &&
        allPhasePreviewsOk &&
        prayerIdleAudit.prayerPillVisible &&
        prayerIdleAudit.stayedIdle &&
        prayerIdleAudit.titleText === 'Adzan Isya' &&
        prayerIdleAudit.hasStarCrescentEyes &&
        prayerIdleAudit.eqBars === 4 &&
        prayerBannerOnIbadahAudit.bannerVisible &&
        prayerBannerOnIbadahAudit.bannerLabel === 'Adzan Isya' &&
        prayerBannerOnIbadahAudit.stayedOnIbadahTab &&
        prayerBannerOnIbadahAudit.expandedState &&
        afterStopOnIbadahAudit.bannerHidden &&
        afterStopOnIbadahAudit.stayedOnIbadahTab &&
        afterStopOnIbadahAudit.stayedExpanded &&
        prayerBannerOnTodoAudit.bannerVisible &&
        prayerBannerOnTodoAudit.stayedOnTodoTab &&
        afterStopOnTodoAudit.bannerHidden &&
        afterStopOnTodoAudit.stayedOnTodoTab &&
        afterStopOnTodoAudit.stayedExpanded,
      `Mode 6 (Pengingat Ibadah v2.1.0): 5 clickable sky-phase previews (Subuh→Isya), T-0 pill (✦ ☾ + hoverExpandLocked) & non-switching Mode 6 banner (Ibadah + Focus & Tasks) verified`,
      !allPhasePreviewsOk ? JSON.stringify(phasePreviewResults.filter((r) => !r.ok)) : ''
    );

    // Clean Path Routing Without `#` (/casa-app/<section>, popstate Back, Logo reset -> /casa-app/)
    const routeChecks = [
      { target: 'architecture', expectedPath: '/casa-app/arsitektur' },
      { target: 'download', expectedPath: '/casa-app/unduh' },
      { target: 'feedback', expectedPath: '/casa-app/feedback' },
    ];
    let navPathOk = true;
    for (const rc of routeChecks) {
      await page.click(`a[data-scroll-target="${rc.target}"]`);
      await new Promise((r) => setTimeout(r, 180));
      const loc = await page.evaluate(() => ({
        pathname: window.location.pathname,
        hash: window.location.hash,
      }));
      if (loc.pathname !== rc.expectedPath || loc.hash !== '') {
        navPathOk = false;
        check(false, `Route click "${rc.target}" expected ${rc.expectedPath}, got ${loc.pathname}${loc.hash}`);
      }
    }

    await page.goBack();
    await new Promise((r) => setTimeout(r, 250));
    const afterBack = await page.evaluate(() => ({
      pathname: window.location.pathname,
      hash: window.location.hash,
    }));

    await page.click('a[data-scroll-target="top"]');
    await new Promise((r) => setTimeout(r, 200));
    const afterLogo = await page.evaluate(() => ({
      pathname: window.location.pathname,
      hash: window.location.hash,
    }));

    check(
      navPathOk &&
        afterBack.pathname === '/casa-app/unduh' &&
        afterBack.hash === '' &&
        afterLogo.pathname === '/casa-app/' &&
        afterLogo.hash === '',
      `Clean path routing: /casa-app/{arsitektur,unduh,feedback}, Back -> /casa-app/unduh, Logo -> /casa-app/ (hash="")`
    );

    // Direct Hit / F5 on Sub-route via docs/404.html fallback
    await page.goto('http://127.0.0.1:5212/casa-app/unduh', { waitUntil: 'networkidle0' });
    await page.waitForFunction(
      () => window.location.pathname === '/casa-app/unduh' && document.title.startsWith('CASA'),
      { timeout: 5000 }
    );
    await new Promise((r) => setTimeout(r, 450));
    const subRouteRestore = await page.evaluate(() => ({
      pathname: window.location.pathname,
      hash: window.location.hash,
      downloadTop: Math.round(
        document.getElementById('download')?.getBoundingClientRect().top ?? 9999
      ),
    }));
    check(
      subRouteRestore.pathname === '/casa-app/unduh' &&
        subRouteRestore.hash === '' &&
        subRouteRestore.downloadTop < 700 &&
        githubReleasesCalls === 1,
      `404.html reload restored /casa-app/unduh & reused cached download count (apiCalls=${githubReleasesCalls})`
    );

    const overflowDesktop = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    check(
      !overflowDesktop,
      'Desktop 1280x800 zero horizontal overflow'
    );

    // Ratings & Reviews DOM, empty fallback, interactive picker & strict CSP verification
    await page.click('#review-star-picker button[data-star-value="4"]');
    await page.type('#rev-comment', 'Clean OLED notch!!');
    const reviewsStaticAudit = await page.evaluate(() => {
      const cspMeta =
        document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') || '';
      const hpRect = document.getElementById('rev-website-hp')?.parentElement?.getBoundingClientRect();
      return {
        hasNoGiscus: !/giscus\.app/i.test(cspMeta) && !document.querySelector('script[src*="giscus"]'),
        cspScriptSelfOnly:
          /script-src\s+'self'\s*;/.test(cspMeta) && !/script-src[^;]*unsafe-inline/.test(cspMeta),
        cspFrameNone: /frame-src\s+'none'/.test(cspMeta),
        cspSupabaseExact: /connect-src[^;]*https:\/\/ivlyujaafwqziogajjtk\.supabase\.co/.test(cspMeta),
        hasSummaryScore: document.getElementById('reviews-avg-score')?.textContent?.trim() === '0.0',
        barRows: document.querySelectorAll('#reviews-bars [data-star-row]').length,
        filterButtons: document.querySelectorAll('#reviews-filter-bar [data-filter-rating]').length,
        sortOptions: document.querySelectorAll('#reviews-sort-select option').length,
        ratingDescText: document.getElementById('review-rating-desc')?.textContent?.trim() || '',
        charCountText: document.getElementById('rev-char-count')?.textContent?.trim() || '',
        hpOffscreen: (hpRect?.left ?? 0) < -100,
        hpHardened:
          document.getElementById('rev-website-hp')?.getAttribute('autocomplete') === 'new-password' &&
          document.getElementById('rev-website-hp')?.getAttribute('tabindex') === '-1' &&
          document.getElementById('rev-website-hp')?.parentElement?.getAttribute('aria-hidden') === 'true' &&
          !/website/i.test(document.querySelector('label[for="rev-website-hp"]')?.textContent || ''),
        discussionsHref: document.getElementById('github-discussions-link')?.getAttribute('href') || '',
        emptyVisible: document.getElementById('reviews-empty')?.hidden === false,
      };
    });
    check(
      reviewsStaticAudit.hasNoGiscus &&
        reviewsStaticAudit.cspScriptSelfOnly &&
        reviewsStaticAudit.cspFrameNone &&
        reviewsStaticAudit.cspSupabaseExact &&
        reviewsStaticAudit.hasSummaryScore &&
        reviewsStaticAudit.barRows === 5 &&
        reviewsStaticAudit.filterButtons === 6 &&
        reviewsStaticAudit.sortOptions === 3 &&
        reviewsStaticAudit.ratingDescText.startsWith('4/5') &&
        reviewsStaticAudit.charCountText === '18/500' &&
        reviewsStaticAudit.hpOffscreen &&
        reviewsStaticAudit.hpHardened &&
        reviewsStaticAudit.discussionsHref === 'https://github.com/Farhanpratama09/casa-app/discussions' &&
        reviewsStaticAudit.emptyVisible,
      'Ratings & Reviews UI, CSP (exact Supabase origin, frame-src none, no Giscus), & interactive star/char counter verified'
    );

    // Mocked Supabase Live Mode Suite (apikey-only header compatibility, Creator reply, filter & submit-review)
    const mockServer = await startStaticServer(5213, {
      overrideSupabaseKey: 'sb_publishable_e2e_mock_key',
    });
    const mockCtx = await browser.createBrowserContext();
    const mockPage = await mockCtx.newPage();
    await mockPage.setViewport({ width: 1280, height: 800 });
    let headerSafetyOk = true;
    let postedReviewBody = null;
    const nowMs = Date.now();
    const sampleReviews = [
      {
        id: 'rev-1',
        author_name: 'Nadia K.',
        rating: 5,
        comment: 'Sangat bersih di OLED 240Hz, pop-up QUEUE instan!',
        app_version: 'v2.0.4',
        creator_reply: 'Terima kasih Nadia! Mode Monokrom OLED memang fokus utama v2.0.4.',
        replied_at: new Date(nowMs - 15 * 60 * 1000).toISOString(),
        created_at: new Date(nowMs - 20 * 1000).toISOString(),
      },
      {
        id: 'rev-2',
        author_name: 'Bima P.',
        rating: 4,
        comment: 'Smart-Tuck 4px aman saat main game fullscreen.',
        app_version: 'v2.0.3',
        creator_reply: null,
        replied_at: null,
        created_at: new Date(nowMs - 26 * 3600 * 1000).toISOString(),
      },
      {
        id: 'rev-3',
        author_name: 'Raka M.',
        rating: 5,
        comment: 'Focus timer langsung auto-check To-Do saat selesai.',
        app_version: 'v2.0.4',
        creator_reply: null,
        replied_at: null,
        created_at: new Date(nowMs - 3 * 3600 * 1000).toISOString(),
      },
      {
        id: 'rev-4',
        author_name: 'Sinta A.',
        rating: 5,
        comment: 'Ring baterai & brightness slider responsif.',
        app_version: 'v2.0.3',
        creator_reply: null,
        replied_at: null,
        created_at: new Date(nowMs - 4 * 86400 * 1000).toISOString(),
      },
      {
        id: 'rev-5',
        author_name: 'Dimas W.',
        rating: 4,
        comment: 'Sudah pakai seminggu lebih di Windows 11, super stabil.',
        app_version: 'v2.0.2',
        creator_reply: null,
        replied_at: null,
        created_at: '2026-10-02T08:15:00Z',
      },
    ];
    await mockPage.setRequestInterception(true);
    mockPage.on('request', (req) => {
      const url = req.url();
      if (url.startsWith('https://api.github.com/')) {
        req.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: '[]' });
        return;
      }
      if (url.startsWith('https://ivlyujaafwqziogajjtk.supabase.co/')) {
        if (req.method() === 'OPTIONS') {
          req.respond({
            status: 204,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Headers': 'content-type, apikey, x-client-info',
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            },
          });
          return;
        }
        const hdrs = req.headers();
        if (hdrs['apikey'] !== 'sb_publishable_e2e_mock_key' || Boolean(hdrs['authorization'])) {
          headerSafetyOk = false;
        }
        if (url.includes('/rest/v1/casa_review_stats')) {
          req.respond({
            status: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            contentType: 'application/json',
            body: JSON.stringify([
              {
                total_reviews: 5,
                avg_rating: 4.6,
                count_5: 3,
                count_4: 2,
                count_3: 0,
                count_2: 0,
                count_1: 0,
              },
            ]),
          });
          return;
        }
        if (url.includes('/rest/v1/casa_reviews_public')) {
          const filtered = url.includes('rating=eq.5')
            ? sampleReviews.filter((r) => r.rating === 5)
            : sampleReviews;
          req.respond({
            status: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            contentType: 'application/json',
            body: JSON.stringify(filtered),
          });
          return;
        }
        if (url.includes('/functions/v1/submit-review') && req.method() === 'POST') {
          postedReviewBody = JSON.parse(req.postData() || '{}');
          req.respond({
            status: 201,
            headers: { 'Access-Control-Allow-Origin': '*' },
            contentType: 'application/json',
            body: JSON.stringify({ ok: true, id: 'rev-mock-3', status: 'pending' }),
          });
          return;
        }
      }
      req.continue();
    });

    await mockPage.goto('http://127.0.0.1:5213/casa-app/', { waitUntil: 'domcontentloaded' });
    await mockPage.waitForFunction(
      () => document.querySelectorAll('#reviews-list .review-item').length === 5,
      { timeout: 4000 }
    );
    const beforeFilterAudit = await mockPage.evaluate(() => {
      const dates = Array.from(document.querySelectorAll('#reviews-list .review-item > .review-item-head .review-date'));
      const heads = Array.from(document.querySelectorAll('#reviews-list .review-item > .review-item-head'));
      return {
        downloadSubtext: document.querySelector('#download .section-desc')?.textContent?.trim() || '',
        feedbackSubtext: document.querySelector('#feedback .section-desc')?.textContent?.trim() || '',
        dateTexts: dates.map((d) => d.textContent?.trim() || ''),
        dateTitles: dates.map((d) => d.getAttribute('title') || ''),
        versionBadgeCount: document.querySelectorAll('#reviews-list .review-version-badge').length,
        headTexts: heads.map((h) => h.textContent?.trim() || ''),
        replyDateText:
          document.querySelector('#reviews-list .creator-reply-box .review-date')?.textContent?.trim() ||
          '',
      };
    });
    await mockPage.click('#reviews-filter-bar button[data-filter-rating="5"]');
    await mockPage.waitForFunction(
      () => document.querySelectorAll('#reviews-list .review-item').length === 3,
      { timeout: 4000 }
    );
    await mockPage.click('#review-star-picker button[data-star-value="5"]');
    await mockPage.type('#rev-name', 'Tariq Z.');
    await mockPage.type('#rev-comment', 'Suka sekali dengan bar kontrol audio & circular battery!');
    await mockPage.click('#rev-submit-btn');
    await mockPage.waitForFunction(
      () =>
        (document.getElementById('rev-status')?.textContent || '').includes('ditinjau moderator'),
      { timeout: 4000 }
    );
    const liveMockAudit = await mockPage.evaluate(() => ({
      avgScore: document.getElementById('reviews-avg-score')?.textContent?.trim(),
      totalText: document.getElementById('reviews-total-count')?.textContent?.trim(),
      creatorBadge: document.querySelector('#reviews-list .creator-badge')?.textContent?.trim(),
      filteredCount: document.querySelectorAll('#reviews-list .review-item').length,
      statusMsg: document.getElementById('rev-status')?.textContent?.trim(),
    }));
    await mockCtx.close();
    mockServer.close();

    const expectedDownloadSubtext =
      'Installer ringan dengan dukungan pembaruan otomatis dan mode senyap 4px Smart-Tuck.';
    const hasHybridTimestamps =
      beforeFilterAudit.dateTexts[0] === 'Baru saja' &&
      beforeFilterAudit.replyDateText === '15 menit lalu' &&
      beforeFilterAudit.dateTexts[1] === 'Kemarin' &&
      beforeFilterAudit.dateTexts[2] === '3 jam lalu' &&
      beforeFilterAudit.dateTexts[3] === '4 hari lalu' &&
      beforeFilterAudit.dateTexts[4] === '2 Okt 2026' &&
      beforeFilterAudit.dateTitles.every((t) => /^\d{1,2} [A-Za-z]+ \d{4}, \d{2}:\d{2}$/.test(t));

    check(
      beforeFilterAudit.downloadSubtext === expectedDownloadSubtext &&
        beforeFilterAudit.feedbackSubtext.includes('TikTok') &&
        hasHybridTimestamps,
      `Evergreen #download copy, TikTok subtitle & hybrid review timestamps + tooltips verified`
    );

    const hasNoVersionBadges =
      beforeFilterAudit.versionBadgeCount === 0 &&
      beforeFilterAudit.headTexts.length === 5 &&
      beforeFilterAudit.headTexts.every((t) => !/\bv\d+\.\d+\.\d+\b/i.test(t));

    check(
      headerSafetyOk &&
        hasNoVersionBadges &&
        liveMockAudit.avgScore === '4.6' &&
        liveMockAudit.totalText === '5 ulasan' &&
        liveMockAudit.creatorBadge === 'Creator' &&
        liveMockAudit.filteredCount === 3 &&
        postedReviewBody?.rating === 5 &&
        postedReviewBody?.author_name === 'Tariq Z.' &&
        typeof postedReviewBody?.elapsed_ms === 'number' &&
        Number.isFinite(postedReviewBody.elapsed_ms) &&
        postedReviewBody.elapsed_ms >= 0 &&
        !('app_version' in (postedReviewBody || {})),
      `Supabase apikey-only fetch, Play Store summary (${liveMockAudit.avgScore}), Creator reply, 5★ filter, hidden version badges & submit-review (no app_version) verified`
    );

    check(
      consoleErrors.length === 0 && cspErrors.length === 0,
      `Desktop zero console/CSP errors (pageErrors=${consoleErrors.length}, csp=${cspErrors.length})`
    );

    // =========================================================================
    // MOBILE 390x844 SUITE (Isolated Incognito Context -> empty localStorage & failed/empty API)
    // =========================================================================
    console.log('\n[Mobile 390x844] Responsive Native Parity Verification\n');
    const mobileCtx = await browser.createBrowserContext();
    const mobilePage = await mobileCtx.newPage();
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
        req.respond({
          status: 200,
          headers: { 'Access-Control-Allow-Origin': '*' },
          contentType: 'application/json',
          body: '[]',
        });
        return;
      }
      req.continue();
    });
    await mobilePage.goto('http://127.0.0.1:5212/casa-app/', { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 200));
    await mobilePage.click('button[data-vm-mode="hud"]');
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
        dlCountFallbackHidden: document.getElementById('download-count-text')?.hidden === true,
      };
    });

    check(
      !mobileMetrics.overflowX &&
        mobileMetrics.monitorW <= 390 &&
        mobileMetrics.dropCards === 1 &&
        mobileMetrics.dlCountFallbackHidden,
      `Mobile 390x844 zero overflow & graceful counter fallback (${mobileMetrics.scrollW}/${mobileMetrics.innerW}, dropCards=${mobileMetrics.dropCards})`
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
