/**
 * CASA CRITICAL QA VERIFICATION: Left Search Drawer Playlist Creation, Bounds, Focus & Store Sync
 *
 * Runs TWO real verification suites (no source regex hacks):
 *  Suite A: Real TypeScript module execution via Vite `ssrLoadModule` testing:
 *    - `normalizeTrackForPlaylist` across Local (blob/path), Native (InnerTube), and Spotify tracks
 *    - `usePlaylistStore` creation, empty-name guard, deduplication, and storage blob sanitization
 *    - `computeSearchDrawerBounds` parametric Win32 hitbox clamping & dynamic popover overhang expansion
 *  Suite B: Real Headless Chromium E2E test (`1100x340` Tauri overlay viewport) via `puppeteer-core`:
 *    - Opens Mode 6 -> Search Pod (`left-search-pod`)
 *    - Opens `SAVE TO PLAYLIST` popover on search track rows
 *    - Asserts `popoverRect` is strictly bounded horizontally inside `left-search-pod` (`left >= pod.left && right <= pod.right`)
 *    - Asserts `left-search-pod` is `overflow-visible` (no vertical popover clipping) and popover stays within `340px` window height
 *    - Tests `+ New playlist` via Enter key AND `+` button click, plus selecting an existing playlist
 *    - Switches Mode 6 tab to `Playlists` (`MusicPlaylistView`) and asserts immediate real-time DOM synchronization
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';

let passed = 0;
let failed = 0;

function check(condition, label, detail = '') {
  if (condition) {
    passed++;
    console.log(`  [PASS] ${label}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${label}${detail ? ` -> ${detail}` : ''}`);
  }
}

async function runUnitAndParametricSuite(viteServer) {
  console.log('\n[Suite A] Real TypeScript Module & Parametric Boundary Verification\n');

  // Minimal localStorage + event listener shim in Node so Zustand persistence initializes cleanly during SSR module load
  const storageMap = new Map();
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    localStorage: {
      getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
      setItem: (k, v) => {
        storageMap.set(k, String(v));
      },
      removeItem: (k) => {
        storageMap.delete(k);
      },
      clear: () => storageMap.clear(),
    },
  };

  const { normalizeTrackForPlaylist } = await viteServer.ssrLoadModule(
    '/src/utils/musicQueueEngine.ts'
  );
  const { computeSearchDrawerBounds } = await viteServer.ssrLoadModule(
    '/src/utils/islandLayoutState.ts'
  );
  const { usePlaylistStore } = await viteServer.ssrLoadModule(
    '/src/stores/usePlaylistStore.ts'
  );

  // 1. Track normalization across local blob, local path, native online, and Spotify
  const localBlobTrack = normalizeTrackForPlaylist({
    id: 'local-audio-1',
    title: 'NIKI - Lowkey (Official Audio).mp3',
    duration: 171,
    url: 'blob:http://localhost:1420/abc-123',
  });
  check(
    localBlobTrack.source === 'local' &&
      localBlobTrack.isLocal === true &&
      localBlobTrack.artist === 'NIKI' &&
      localBlobTrack.title === 'Lowkey' &&
      localBlobTrack.duration === 171 &&
      localBlobTrack.durationSeconds === 171 &&
      localBlobTrack.url === 'blob:http://localhost:1420/abc-123' &&
      typeof localBlobTrack.addedAt === 'number',
    'Local blob track normalizes artist/title/duration/url/addedAt cleanly'
  );

  const localPathTrack = normalizeTrackForPlaylist({
    title: 'Night Tape',
    artist: 'Home Studio',
    duration: 205,
    path: 'C:\\Users\\User\\Music\\Night Tape.flac',
  });
  check(
    localPathTrack.source === 'local' &&
      localPathTrack.isLocal === true &&
      localPathTrack.duration === 205 &&
      localPathTrack.streamUrl === 'C:\\Users\\User\\Music\\Night Tape.flac' &&
      localPathTrack.path === 'C:\\Users\\User\\Music\\Night Tape.flac',
    'Local filesystem path track infers source=local and preserves path/streamUrl/duration'
  );

  const nativeTrack = normalizeTrackForPlaylist({
    id: 'yt-9988',
    title: 'Midnight Study Session',
    artist: 'Lofi Girl',
    durationSeconds: 184,
    streamUrl: 'http://127.0.0.1:41200/stream/yt-9988',
    source: 'native',
  });
  check(
    nativeTrack.source === 'native' &&
      nativeTrack.isLocal === false &&
      nativeTrack.duration === 184 &&
      nativeTrack.url === 'http://127.0.0.1:41200/stream/yt-9988',
    'Native online search track preserves source=native, duration, and stream URL'
  );

  const spotifyTrack = normalizeTrackForPlaylist({
    id: 'sp-42',
    title: 'Electric Feel',
    artist: 'MGMT',
    durationMs: 229600,
    uri: 'spotify:track:3FtYbEfBqAlGO46NUDQSAt',
    source: 'spotify',
  });
  check(
    spotifyTrack.source === 'spotify' &&
      spotifyTrack.duration === 230 &&
      spotifyTrack.durationSeconds === 230 &&
      spotifyTrack.url === 'spotify:track:3FtYbEfBqAlGO46NUDQSAt',
    'Spotify track normalizes durationMs -> 230s and maps uri -> url fallback'
  );

  // 2. Store CRUD + whitespace validation + deduplication + blob sanitization
  const store = usePlaylistStore.getState();
  check(store.createPlaylist('   ', [nativeTrack]) === null, 'Blank playlist name returns null');

  const created = store.createPlaylist('Study Rotation', [localBlobTrack]);
  check(
    Boolean(created && created.tracks.length === 1 && created.tracks[0].id === localBlobTrack.id),
    'createPlaylist persists initial normalized track into new playlist'
  );

  const persistedRaw = JSON.parse(storageMap.get('casa_custom_playlists_v1') || '[]');
  check(
    persistedRaw.length === 1 &&
      persistedRaw[0].tracks[0].streamUrl === undefined &&
      persistedRaw[0].tracks[0].url === undefined &&
      usePlaylistStore.getState().customPlaylists[0].tracks[0].url ===
        'blob:http://localhost:1420/abc-123',
    'Storage persistence strips volatile blob: URLs while retaining live blob URL in memory'
  );

  const dupAdded = store.addTrackToPlaylist(created.id, { ...localBlobTrack });
  check(dupAdded === false, 'addTrackToPlaylist rejects duplicate track already in playlist');

  const secondAdded = store.addTrackToPlaylist(created.id, spotifyTrack);
  const afterSecond = usePlaylistStore.getState().customPlaylists.find((p) => p.id === created.id);
  check(
    secondAdded === true && afterSecond?.tracks.length === 2,
    'addTrackToPlaylist appends distinct Spotify/Online track accurately'
  );

  // 3. Parametric Win32 hitbox bounds for Left Search Drawer + downward popover overhang
  const scenarios = [
    { capsuleWidth: 480, capsuleHeight: 186, topOffset: 0, extra: 0 },
    { capsuleWidth: 480, capsuleHeight: 186, topOffset: 0, extra: 96 },
    { capsuleWidth: 640, capsuleHeight: 192, topOffset: 12, extra: 74 },
    { capsuleWidth: 640, capsuleHeight: 192, topOffset: 12, extra: 400 }, // saturation clamp
  ];

  for (const sc of scenarios) {
    const rect = computeSearchDrawerBounds({
      centerOffsetX: 0,
      capsuleWidth: sc.capsuleWidth,
      capsuleHeight: sc.capsuleHeight,
      topOffset: sc.topOffset,
      extraPopoverHeight: sc.extra,
    });
    const baseHeight = sc.capsuleHeight - 14;
    const expectedUncapped = baseHeight + sc.extra;
    const maxAllowed = 340 - (sc.topOffset + 14) - 2;
    check(
      rect.width === 204 &&
        rect.top_offset === sc.topOffset + 14 &&
        rect.height === Math.min(maxAllowed, expectedUncapped) &&
        rect.top_offset + rect.height <= 338,
      `computeSearchDrawerBounds(W=${sc.capsuleWidth}, top=${sc.topOffset}, extra=${sc.extra}) -> h=${rect.height}`
    );
  }
}

async function runRealChromiumDomSuite() {
  console.log('\n[Suite B] Real Chromium DOM E2E Interaction Test (1100x340 Overlay)\n');

  const candidateBrowsers = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  const chromePath = candidateBrowsers.find((p) => fs.existsSync(p));
  if (!chromePath) {
    throw new Error('No Chromium binary (Chrome/Edge) found to execute real DOM E2E suite.');
  }

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    defaultViewport: { width: 1100, height: 340 },
  });

  try {
    const page = await browser.newPage();
    page.on('pageerror', (err) => {
      console.error('  [Browser PageError]', err.message);
    });

    // Seed mixed tracks (local + native) AND Tauri IPC spy so we capture live hitbox rects & focus calls
    await page.evaluateOnNewDocument(() => {
      window.__HITBOX_LOG__ = [];
      window.__FOCUS_CALLS__ = 0;
      window.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback: () => Math.floor(Math.random() * 100000),
        unregisterCallback: () => {},
        plugins: { event: { unregisterListener: () => {} } },
        invoke: async (cmd, args) => {
          if (cmd === 'update_island_hitboxes') {
            window.__HITBOX_LOG__.push(args?.rects || []);
          } else if (cmd === 'focus_island_window') {
            window.__FOCUS_CALLS__ += 1;
          } else if (cmd === 'get_autostart_enabled') {
            return false;
          } else if (cmd === 'get_global_shortcut_status') {
            return true;
          } else if (cmd === 'get_hardware_telemetry') {
            return null;
          }
          return null;
        },
      };

      localStorage.clear();
      const now = Date.now();
      const trackA = {
        key: 'id:yt-rain-1',
        track: {
          id: 'yt-rain-1',
          title: 'Midnight Rain',
          artist: 'Lo-Fi Dreams',
          normalizedTitle: 'midnight rain',
          normalizedArtist: 'lofi dreams',
          trackPairKey: 'midnight rain::lofi dreams',
          duration: 192,
          durationSeconds: 192,
          durationMs: 192000,
          thumbnailUrl: '',
          albumArt: '',
          streamUrl: 'http://127.0.0.1:41200/audio/midnight-rain.mp3',
          url: 'http://127.0.0.1:41200/audio/midnight-rain.mp3',
          source: 'native',
          isLocal: false,
        },
        playCount: 4,
        completedCount: 3,
        totalListenSeconds: 520,
        addedToPlaylistCount: 0,
        focusPlayCount: 2,
        playedDuringFocus: true,
        isLocalUpload: false,
        lastPlayedAt: now - 1000,
        lastAddedAt: 0,
        score: 95,
      };
      const trackB = {
        key: 'id:local-tape-2',
        track: {
          id: 'local-tape-2',
          title: 'Analog Coffee',
          artist: 'Cassette Club',
          normalizedTitle: 'analog coffee',
          normalizedArtist: 'cassette club',
          trackPairKey: 'analog coffee::cassette club',
          duration: 164,
          durationSeconds: 164,
          durationMs: 164000,
          thumbnailUrl: '',
          albumArt: '',
          path: 'C:\\Music\\Analog Coffee.mp3',
          url: 'C:\\Music\\Analog Coffee.mp3',
          streamUrl: 'C:\\Music\\Analog Coffee.mp3',
          source: 'local',
          isLocal: true,
        },
        playCount: 3,
        completedCount: 2,
        totalListenSeconds: 380,
        addedToPlaylistCount: 0,
        focusPlayCount: 1,
        playedDuringFocus: true,
        isLocalUpload: true,
        lastPlayedAt: now - 5000,
        lastAddedAt: 0,
        score: 80,
      };
      localStorage.setItem(
        'casa_music_affinity_v1',
        JSON.stringify({
          recentQueries: [{ query: 'chill study', lastSearchedAt: now, count: 2 }],
          trackRecords: { 'id:yt-rain-1': trackA, 'id:local-tape-2': trackB },
          artistRecords: {},
        })
      );
    });

    await page.goto('http://localhost:5199', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-island-hover-sensor="true"]', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 350));

    // Real user interaction: click center capsule to lock Mode 6 Expanded view (if resting sleep, a second click opens Mode 6)
    for (let attempt = 0; attempt < 3; attempt++) {
      const hasSearchToggle = await page.$('button[aria-label="Toggle Search Pod"]');
      if (hasSearchToggle) break;
      const musicNavBtn = await page.$('button[title*="Music"], button[aria-label*="Music"]');
      if (musicNavBtn) {
        await musicNavBtn.click();
      } else {
        await page.click('[data-island-hover-sensor="true"]');
      }
      await new Promise((r) => setTimeout(r, 450));
    }

    // Open Left Search Pod
    const searchToggle = await page.waitForSelector('button[aria-label="Toggle Search Pod"]', {
      timeout: 8000,
    });
    await searchToggle.click();
    await page.waitForSelector('[data-pod="left"]', { timeout: 6000 });
    await new Promise((r) => setTimeout(r, 450));

    // Verify tracks rendered inside left-search-pod and click Track 1's "Add to Playlist"
    const addButtons = await page.$$('[data-pod="left"] button[aria-label="Add to Playlist"]');
    check(addButtons.length >= 2, `Left Search Pod renders ${addButtons.length} track Save buttons`);

    await addButtons[0].click();
    await page.waitForSelector('[data-casa-popover="true"]', { timeout: 4000 });
    await new Promise((r) => setTimeout(r, 150));

    const boundsCheck = await page.evaluate(() => {
      const pod = document.querySelector('[data-pod="left"]');
      const pop = document.querySelector('[data-casa-popover="true"]');
      if (!pod || !pop) return null;
      const podRect = pod.getBoundingClientRect();
      const popRect = pop.getBoundingClientRect();
      const overflow = window.getComputedStyle(pod).overflow;
      const hitboxLog = window.__HITBOX_LOG__ || [];
      const latestRects = hitboxLog[hitboxLog.length - 1] || [];
      const searchDrawerHitbox = latestRects[1] || null;
      return {
        insidePodDom: pod.contains(pop),
        podLeft: podRect.left,
        podRight: podRect.right,
        popLeft: popRect.left,
        popRight: popRect.right,
        popTop: popRect.top,
        popBottom: popRect.bottom,
        popHeight: popRect.height,
        podOverflow: overflow,
        searchDrawerHitbox,
      };
    });

    check(Boolean(boundsCheck && boundsCheck.insidePodDom), 'Popover portals strictly inside left-search-pod DOM');
    check(
      Boolean(
        boundsCheck &&
          boundsCheck.popLeft >= boundsCheck.podLeft + 4 &&
          boundsCheck.popRight <= boundsCheck.podRight - 4
      ),
      `Popover horizontally locked inside search drawer (${Math.round(boundsCheck?.popLeft ?? 0)}..${Math.round(boundsCheck?.popRight ?? 0)} within ${Math.round(boundsCheck?.podLeft ?? 0)}..${Math.round(boundsCheck?.podRight ?? 0)})`
    );
    check(
      Boolean(
        boundsCheck &&
          boundsCheck.podOverflow !== 'hidden' &&
          boundsCheck.popHeight >= 75 &&
          boundsCheck.popBottom <= 340
      ),
      `Popover unclipped vertically (overflow=${boundsCheck?.podOverflow}, height=${Math.round(boundsCheck?.popHeight ?? 0)}, bottom=${Math.round(boundsCheck?.popBottom ?? 0)})`
    );
    check(
      Boolean(
        boundsCheck?.searchDrawerHitbox &&
          boundsCheck.searchDrawerHitbox.top_offset + boundsCheck.searchDrawerHitbox.height >=
            boundsCheck.popBottom
      ),
      `Win32 search_drawer hitbox expands dynamically to cover popover bottom (${boundsCheck?.searchDrawerHitbox?.top_offset}+${boundsCheck?.searchDrawerHitbox?.height} >= ${Math.round(boundsCheck?.popBottom ?? 0)})`
    );

    // Create first playlist via Enter key inside `+ New playlist` input
    const inputSel = '[data-casa-popover="true"] input[placeholder="+ New playlist"]';
    const focusBefore = await page.evaluate(() => window.__FOCUS_CALLS__);
    await page.click(inputSel);
    await page.type(inputSel, 'Late Night Coding');
    const focusAfter = await page.evaluate(() => window.__FOCUS_CALLS__);
    check(focusAfter > focusBefore, `Clicking "+ New playlist" invokes focus_island_window (${focusBefore} -> ${focusAfter})`);
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 600));

    const hitboxAfterClose = await page.evaluate(() => {
      const log = window.__HITBOX_LOG__ || [];
      const latest = log[log.length - 1] || [];
      return latest[1]?.height ?? null;
    });
    check(
      hitboxAfterClose === 172,
      `Win32 search_drawer hitbox restores back to base height 172 after popover closes (got ${hitboxAfterClose})`
    );

    const afterEnterState = await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem('casa_custom_playlists_v1') || '[]');
      return {
        popoverStillOpen: Boolean(document.querySelector('[data-casa-popover="true"]')),
        playlists: stored.map((p) => ({ name: p.name, tracks: p.tracks.map((t) => t.title) })),
      };
    });
    check(
      afterEnterState.playlists.length === 1 &&
        afterEnterState.playlists[0].name === 'Late Night Coding' &&
        afterEnterState.playlists[0].tracks.includes('Midnight Rain'),
      'Pressing Enter in "+ New playlist" creates playlist and adds native Track 1'
    );

    // Open Track 2's popover and create second playlist by clicking '+' submit button
    const buttonsRound2 = await page.$$('[data-pod="left"] button[aria-label="Add to Playlist"]');
    await buttonsRound2[1].click();
    await page.waitForSelector('[data-casa-popover="true"]', { timeout: 4000 });
    await page.click(inputSel);
    await page.type(inputSel, 'Gym Cardio');
    await page.click('[data-casa-popover="true"] button[type="submit"]');
    await new Promise((r) => setTimeout(r, 600));

    // Re-open Track 1's popover and click existing 'Gym Cardio' item
    const buttonsRound3 = await page.$$('[data-pod="left"] button[aria-label="Add to Playlist"]');
    await buttonsRound3[0].click();
    await page.waitForSelector('[data-casa-popover="true"]', { timeout: 4000 });
    const clickedExisting = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('[data-casa-popover="true"] button'));
      const gymBtn = btns.find((b) => b.textContent?.includes('Gym Cardio'));
      if (!gymBtn) return false;
      gymBtn.click();
      return true;
    });
    await new Promise((r) => setTimeout(r, 600));

    const afterPlusState = await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem('casa_custom_playlists_v1') || '[]');
      return stored.map((p) => ({
        name: p.name,
        count: p.tracks.length,
        sources: p.tracks.map((t) => t.source),
      }));
    });
    const gym = afterPlusState.find((p) => p.name === 'Gym Cardio');
    check(
      clickedExisting && Boolean(gym && gym.count === 2 && gym.sources.includes('local') && gym.sources.includes('native')),
      'Clicking "+" submit button & existing playlist saves both Local & Native tracks cleanly'
    );

    // Switch Mode 6 sub-tab to "Playlists" and assert real-time DOM synchronization without reload
    const switchedToPlaylists = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const plTab = buttons.find((b) => b.textContent?.trim() === 'Playlists');
      if (!plTab) return false;
      plTab.click();
      return true;
    });
    await new Promise((r) => setTimeout(r, 250));

    const playlistViewDom = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      return {
        hasGymCardio: bodyText.includes('Gym Cardio'),
        hasLateNight: bodyText.includes('Late Night Coding'),
        hasTwoTracksLabel: bodyText.includes('2 tracks'),
      };
    });

    check(
      switchedToPlaylists &&
        playlistViewDom.hasGymCardio &&
        playlistViewDom.hasLateNight &&
        playlistViewDom.hasTwoTracksLabel,
      'Right-panel MusicPlaylistView displays newly created playlists & track counts in real time'
    );
  } finally {
    await browser.close();
  }
}

async function main() {
  const viteServer = await createServer({
    server: { port: 5199, strictPort: true },
    logLevel: 'error',
  });
  await viteServer.listen();

  try {
    await runUnitAndParametricSuite(viteServer);
    await runRealChromiumDomSuite();
  } finally {
    await viteServer.close();
  }

  console.log(`\n================================================================`);
  console.log(`  RESULT: ${passed} passed, ${failed} failed`);
  console.log(`================================================================\n`);
  assert.equal(failed, 0, `${failed} verification assertion(s) failed`);
}

main().catch((err) => {
  console.error('\n[FATAL]', err);
  process.exit(1);
});
