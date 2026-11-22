/**
 * CASA CRITICAL QA VERIFICATION (`v2.1.4`):
 * Smart Queue (Up Next + Artist ID Fallback), Anti-Loop Playlist, Session Seeding,
 * Dynamic Region Parameter, Multi-Category Search Play All, 3-Mode Repeat, & Bundle Hygiene.
 */

import fs from 'node:fs';
import path from 'node:path';
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

async function runUnitAndStateMachineSuite(viteServer) {
  console.log('\n[Suite A] Smart Queue, Anti-Loop Playlist, Session Seeding & Region Logic\n');

  const storageMap = new Map();
  const invokeCalls = [];

  let mockUpNextHandler = async ({ videoId, artistId, artistName, region }) => [
    {
      id: 'relTrack001',
      title: `Related to ${videoId || artistId || artistName}`,
      artist: artistName || 'Session Artist',
      durationSeconds: 205,
      thumbnailUrl: '',
      artistId: artistId || 'UCrelArtist01',
      resultKind: 'song',
    },
    {
      id: 'relTrack002',
      title: 'Follow-Up Session Song',
      artist: 'Related Peer Artist',
      durationSeconds: 198,
      thumbnailUrl: '',
      artistId: 'UCpeerArtist02',
      resultKind: 'song',
    },
  ];

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
    __TAURI_INTERNALS__: {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => 1,
      unregisterCallback: () => {},
      plugins: { event: { unregisterListener: () => {} } },
      invoke: async (cmd, args) => {
        invokeCalls.push({ cmd, args });
        if (cmd === 'get_up_next_native') {
          return await mockUpNextHandler(args || {});
        }
        if (cmd === 'search_catalog_native') {
          return {
            query: args?.query || '',
            gl: args?.region === 'auto' ? 'ID' : args?.region || 'ID',
            hl: args?.region === 'JP' ? 'ja' : args?.region === 'US' ? 'en' : 'id',
            topArtistName: 'Hindia',
            topArtistId: 'UCHindiaOfficial01',
            topSongs: [],
            songs: [],
            albums: [],
            playlists: [],
          };
        }
        if (cmd === 'get_player_region_info') {
          return {
            gl: args?.region === 'auto' ? 'ID' : args?.region,
            hl: 'id',
            detectedGl: 'ID',
            detectedHl: 'id',
          };
        }
        return [];
      },
    },
  };

  // Seed unrelated 30-day Personal Mix in localStorage BEFORE loading stores
  storageMap.set(
    'casa_music_affinity_v1',
    JSON.stringify({
      recentQueries: [{ query: 'old mix', lastSearchedAt: Date.now() - 86400000, count: 10 }],
      trackRecords: {
        'id:oldPersonal01': {
          key: 'id:oldPersonal01',
          track: {
            id: 'oldPersonal01',
            title: 'Old Personal Pop Mix',
            artist: 'Unrelated Legacy Singer',
            duration: 210,
            durationSeconds: 210,
            durationMs: 210000,
            thumbnailUrl: '',
            source: 'native',
            isLocal: false,
          },
          playCount: 99,
          completedCount: 80,
          totalListenSeconds: 15000,
          addedToPlaylistCount: 5,
          focusPlayCount: 20,
          playedDuringFocus: true,
          isLocalUpload: false,
          lastPlayedAt: Date.now() - 50000000,
          lastAddedAt: 0,
          score: 999,
        },
      },
      artistRecords: {},
    })
  );

  const { shouldTriggerSmartFill, buildOrderedQueue } = await viteServer.ssrLoadModule(
    '/src/utils/musicQueueEngine.ts'
  );
  const { useSettingsStore, updateSettings } = await viteServer.ssrLoadModule(
    '/src/stores/useSettingsStore.ts'
  );
  const { searchCatalog } = await viteServer.ssrLoadModule(
    '/src/services/nativeAudioService.ts'
  );
  const { useQueueStore } = await viteServer.ssrLoadModule(
    '/src/stores/useQueueStore.ts'
  );

  // 1. Verify shouldTriggerSmartFill & 3-mode Repeat
  check(
    shouldTriggerSmartFill({
      currentTrack: { id: 'aaaaaaaaaaa', title: 'A', artist: 'X' },
      manualQueueLength: 0,
      smartQueueLength: 0,
      repeatMode: 'off',
    }) === true &&
      shouldTriggerSmartFill({
        currentTrack: { id: 'aaaaaaaaaaa', title: 'A', artist: 'X' },
        manualQueueLength: 0,
        smartQueueLength: 0,
        repeatMode: 'all',
      }) === false &&
      shouldTriggerSmartFill({
        currentTrack: { id: 'aaaaaaaaaaa', title: 'A', artist: 'X' },
        manualQueueLength: 0,
        smartQueueLength: 0,
        repeatMode: 'one',
      }) === false,
    'shouldTriggerSmartFill triggers ONLY when repeatMode === "off"'
  );

  // 2. Verify buildOrderedQueue does NOT wrap [0..startIndex-1] by default (Anti-Loop)
  const samplePlaylist = [
    { id: 'plTrack0001', title: 'Track 1', artist: 'Band A', durationSeconds: 200, artistId: 'UCbandA' },
    { id: 'plTrack0002', title: 'Track 2', artist: 'Band A', durationSeconds: 200, artistId: 'UCbandA' },
    { id: 'plTrack0003', title: 'Track 3', artist: 'Band B', durationSeconds: 200, artistId: 'UCbandB' },
    { id: 'plTrack0004', title: 'Track 4', artist: 'Band B', durationSeconds: 200, artistId: 'UCbandB' },
  ];
  const orderedFromIdx1 = buildOrderedQueue(samplePlaylist, 1, false);
  check(
    orderedFromIdx1.currentTrack?.id === 'plTrack0002' &&
      orderedFromIdx1.upNext.length === 2 &&
      orderedFromIdx1.upNext[0].id === 'plTrack0003' &&
      orderedFromIdx1.upNext[1].id === 'plTrack0004' &&
      !orderedFromIdx1.upNext.some((t) => t.id === 'plTrack0001'),
    'buildOrderedQueue omits earlier tracks [0..startIndex-1] when wrapAround=false (Anti-Loop)'
  );

  // 3. Playlist end transition on Repeat Off -> Smart Queue seeded from playlist, NOT personal mix
  invokeCalls.length = 0;
  useQueueStore.getState().clearAllQueues();
  useQueueStore.getState().setRepeatMode('off');
  useQueueStore
    .getState()
    .setOrderedPlaylistQueue(samplePlaylist, 3, { contextKind: 'playlist' });

  // Wait briefly for initial Smart Queue background fill or await via getNextTrack
  const nextAfterLastPlaylistTrack = await useQueueStore
    .getState()
    .getNextTrack({ awaitSmartFill: true });

  const radioCallAfterPlaylist = invokeCalls.find((c) => c.cmd === 'get_up_next_native');
  const legacyTextSearches = invokeCalls.filter((c) => c.cmd === 'search_tracks_native');
  check(
    Boolean(radioCallAfterPlaylist) &&
      legacyTextSearches.length === 0 &&
      nextAfterLastPlaylistTrack !== null &&
      nextAfterLastPlaylistTrack.id === 'relTrack001' &&
      !nextAfterLastPlaylistTrack.title.includes('Old Personal') &&
      nextAfterLastPlaylistTrack.id !== 'plTrack0001',
    'Last playlist track with Repeat Off transitions to Up Next Smart Queue (NOT looping Track 1 & NOT personal mix)'
  );

  // 4. Repeat All restarts active playlist deterministically
  useQueueStore.getState().setRepeatMode('all');
  useQueueStore
    .getState()
    .setOrderedPlaylistQueue(samplePlaylist, 3, { contextKind: 'playlist' });
  const loopedFirstTrack = await useQueueStore.getState().getNextTrack();
  check(
    loopedFirstTrack?.id === 'plTrack0001' &&
      useQueueStore.getState().manualQueue.length === 3,
    'Playlist with Repeat All explicitly loops back to Track 1 + restores [2, 3, 4] in queue'
  );

  // 5. Repeat toggle cycle ('off' -> 'all' -> 'one' -> 'off')
  useQueueStore.getState().setRepeatMode('off');
  const r1 = useQueueStore.getState().toggleRepeat();
  const r2 = useQueueStore.getState().toggleRepeat();
  const r3 = useQueueStore.getState().toggleRepeat();
  check(
    r1 === 'all' && r2 === 'one' && r3 === 'off',
    'toggleRepeat cycles cleanly across off -> all -> one -> off'
  );

  // 6. Session-Seeded Smart Queue after manual queueing (uses session seeds & never 30-day personal mix)
  invokeCalls.length = 0;
  mockUpNextHandler = async ({ videoId }) => [
    {
      id: `upnext_${videoId || 'fallback'}`,
      title: `Session Mix for ${videoId}`,
      artist: 'Indie Session Peer',
      durationSeconds: 215,
      thumbnailUrl: '',
      artistId: 'UCindiePeer',
      resultKind: 'song',
    },
  ];
  useQueueStore.getState().clearAllQueues();
  useQueueStore.getState().setOrderedPlaylistQueue(
    [
      {
        id: 'sessSeedAA1',
        title: 'Indie Song 1',
        artist: 'Reality Club',
        artistId: 'UCrealityClub01',
        durationSeconds: 220,
        thumbnailUrl: '',
      },
    ],
    0,
    { contextKind: 'single' }
  );
  useQueueStore.getState().addToManualQueue({
    id: 'sessSeedBB2',
    title: 'Indie Song 2',
    artist: 'Feast',
    artistId: 'UCfeast01',
    durationSeconds: 205,
    thumbnailUrl: '',
  });
  await useQueueStore.getState().getNextTrack(); // Moves to sessSeedBB2, manualQueue empty -> triggers Smart Fill
  await new Promise((r) => setTimeout(r, 80));

  const sessionState = useQueueStore.getState();
  const upNextCalls = invokeCalls.filter((c) => c.cmd === 'get_up_next_native');
  check(
    upNextCalls.some((c) => c.args.videoId === 'sessSeedBB2' || c.args.videoId === 'sessSeedAA1') &&
      sessionState.radioQueue.length > 0 &&
      !sessionState.radioQueue.some((t) => t.id === 'oldPersonal01') &&
      !sessionState.radioQueue.some((t) => t.id === 'sessSeedBB2' || t.id === 'sessSeedAA1'),
    'Manual queue exhaustion draws Smart Queue from active session seeds (no 30-day personal mix, no session duplicates)'
  );

  // 7. Race-condition cancellation on rapid Next skip
  let slowResolveDone = false;
  mockUpNextHandler = async ({ videoId }) => {
    if (videoId === 'rapidSlow11') {
      await new Promise((r) => setTimeout(r, 140));
      slowResolveDone = true;
      return [
        {
          id: 'staleSlow01',
          title: 'Stale Slow Result',
          artist: 'Stale Artist',
          durationSeconds: 180,
          thumbnailUrl: '',
        },
      ];
    }
    return [
      {
        id: 'freshFast02',
        title: 'Fresh Fast Result',
        artist: 'Fast Artist',
        durationSeconds: 185,
        thumbnailUrl: '',
      },
    ];
  };
  useQueueStore.getState().clearAllQueues();
  useQueueStore.getState().setOrderedPlaylistQueue(
    [{ id: 'rapidSlow11', title: 'Slow Track', artist: 'Artist A', durationSeconds: 200, thumbnailUrl: '' }],
    0,
    { contextKind: 'single' }
  );
  // Immediately skip to a newer track before slow request returns
  await new Promise((r) => setTimeout(r, 15));
  useQueueStore.getState().setOrderedPlaylistQueue(
    [
      { id: 'rapidFast22', title: 'Fast Track', artist: 'Artist B', durationSeconds: 200, thumbnailUrl: '' },
      { id: 'rapidFast23', title: 'Fast Track 2', artist: 'Artist B', durationSeconds: 210, thumbnailUrl: '' },
    ],
    0,
    { contextKind: 'playlist' }
  );
  await new Promise((r) => setTimeout(r, 200));
  const afterRace = useQueueStore.getState();
  check(
    slowResolveDone &&
      afterRace.radioQueue.some((t) => t.id === 'freshFast02') &&
      !afterRace.radioQueue.some((t) => t.id === 'staleSlow01') &&
      afterRace.isFetchingRadio === false,
    'Rapid track switch cancels/discards stale slower Smart Queue response & clears loading state cleanly',
    `slowResolveDone=${slowResolveDone}, queue=${afterRace.radioQueue.map((t) => t.id).join(',')}, fetching=${afterRace.isFetchingRadio}`
  );

  // 8. Region setting persistence & dynamic parameter forwarding
  updateSettings({ playerRegion: 'JP' });
  await searchCatalog('Yorushika');
  const jpSearchCall = [...invokeCalls].reverse().find((c) => c.cmd === 'search_catalog_native');
  check(
    jpSearchCall?.args?.region === 'JP',
    `Dynamic region setting ('JP') forwards directly to search_catalog_native (got region=${jpSearchCall?.args?.region})`
  );
  updateSettings({ playerRegion: 'auto' });
  await searchCatalog('Hindia');
  const autoSearchCall = [...invokeCalls].reverse().find((c) => c.cmd === 'search_catalog_native');
  check(
    autoSearchCall?.args?.region === 'auto',
    `Auto region setting ('auto') forwards cleanly to OS locale resolver (got region=${autoSearchCall?.args?.region})`
  );
  void useSettingsStore;
}

async function runBundleHygieneCheck() {
  console.log('\n[Suite B] Bundle Chunk Split Hygiene (`Settings` lazy-loaded outside Main)\n');
  const distAssetsDir = path.resolve(process.cwd(), 'dist', 'assets');
  const distHtmlPath = path.resolve(process.cwd(), 'dist', 'index.html');

  const hasDist = fs.existsSync(distAssetsDir) && fs.existsSync(distHtmlPath);
  check(hasDist, 'dist/ production build artifacts exist before verifying chunks');
  if (!hasDist) return;

  const assetFiles = fs.readdirSync(distAssetsDir);
  const settingsChunks = assetFiles.filter((f) => f.startsWith('settings-window-') && f.endsWith('.js'));
  const htmlContent = fs.readFileSync(distHtmlPath, 'utf-8');

  check(
    settingsChunks.length === 1,
    `Vite emits dedicated lazy Settings chunk (${settingsChunks.join(', ') || 'none'})`
  );
  check(
    settingsChunks.every((chunk) => !htmlContent.includes(chunk)),
    'dist/index.html does NOT statically load or modulepreload settings-window chunk on main window'
  );
}

async function runRealChromiumUiSuite() {
  console.log('\n[Suite C] Headless Chromium E2E: Multi-Category Search, Play All Without Lyrics & Repeat 3-Mode\n');

  const candidateBrowsers = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  const chromePath = candidateBrowsers.find((p) => fs.existsSync(p));
  if (!chromePath) {
    throw new Error('No Chromium binary (Chrome/Edge) found for E2E suite.');
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
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // Stub external LRCLIB (empty/no lyrics) + local mock WAV stream (3 seconds so track stays playing during inspection)
    const pcmBytes = 48000;
    const wavHeader = Buffer.alloc(44 + pcmBytes);
    wavHeader.write('RIFF', 0);
    wavHeader.writeUInt32LE(36 + pcmBytes, 4);
    wavHeader.write('WAVE', 8);
    wavHeader.write('fmt ', 12);
    wavHeader.writeUInt32LE(16, 16);
    wavHeader.writeUInt16LE(1, 20);
    wavHeader.writeUInt16LE(1, 22);
    wavHeader.writeUInt32LE(8000, 24);
    wavHeader.writeUInt32LE(16000, 28);
    wavHeader.writeUInt16LE(2, 32);
    wavHeader.writeUInt16LE(16, 34);
    wavHeader.write('data', 36);
    wavHeader.writeUInt32LE(pcmBytes, 40);

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('lrclib.net')) {
        return req.respond({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Not Found' }),
        });
      }
      if (url.includes('__mock_audio.wav')) {
        return req.respond({
          status: 200,
          contentType: 'audio/wav',
          headers: { 'Accept-Ranges': 'bytes' },
          body: wavHeader,
        });
      }
      return req.continue();
    });

    await page.evaluateOnNewDocument(() => {
      window.__V214_IPC__ = [];
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: () => {},
      };
      window.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback: () => Math.floor(Math.random() * 100000),
        unregisterCallback: () => {},
        plugins: { event: { unregisterListener: () => {} } },
        invoke: async (cmd, args) => {
          window.__V214_IPC__.push({ cmd, args });
          if (cmd === 'search_catalog_native') {
            return {
              query: args?.query || 'Hindia',
              gl: 'ID',
              hl: 'id',
              topArtistName: 'Hindia',
              topArtistId: 'UCHindiaOfficial01',
              topSongs: [
                {
                  id: 'topHindia01',
                  title: 'Evaluasi',
                  artist: 'Hindia',
                  durationSeconds: 194,
                  thumbnailUrl: '',
                  artistId: 'UCHindiaOfficial01',
                  resultKind: 'top_song',
                },
                {
                  id: 'topHindia02',
                  title: 'Secukupnya',
                  artist: 'Hindia',
                  durationSeconds: 205,
                  thumbnailUrl: '',
                  artistId: 'UCHindiaOfficial01',
                  resultKind: 'top_song',
                },
              ],
              albums: [
                {
                  id: 'MPREb_menari01',
                  title: 'Menari Dengan Bayangan',
                  subtitle: 'Album • Hindia • 2019',
                  kind: 'album',
                  browseId: 'MPREb_menari01',
                  artistId: 'UCHindiaOfficial01',
                  thumbnailUrl: '',
                },
              ],
              playlists: [
                {
                  id: 'VLPLindie01',
                  title: 'Indie Senja Pilihan',
                  subtitle: 'Playlist • CASA Curated',
                  kind: 'playlist',
                  browseId: 'VLPLindie01',
                  playlistId: 'PLindie01',
                  thumbnailUrl: '',
                },
              ],
              songs: [
                {
                  id: 'songHindia3',
                  title: 'Rumah Ke Rumah',
                  artist: 'Hindia',
                  durationSeconds: 277,
                  thumbnailUrl: '',
                  artistId: 'UCHindiaOfficial01',
                  resultKind: 'song',
                },
              ],
            };
          }
          if (cmd === 'browse_collection_tracks_native') {
            return [
              {
                id: 'colTrack001',
                title: 'Besok Mungkin Kita Sampai',
                artist: 'Hindia',
                durationSeconds: 218,
                thumbnailUrl: '',
                artistId: 'UCHindiaOfficial01',
              },
              {
                id: 'colTrack002',
                title: 'Membasuh',
                artist: 'Hindia',
                durationSeconds: 252,
                thumbnailUrl: '',
                artistId: 'UCHindiaOfficial01',
              },
            ];
          }
          if (cmd === 'get_up_next_native') {
            return [
              {
                id: 'smartNext01',
                title: 'Danila - Berdistraksi',
                artist: 'Danilla',
                durationSeconds: 210,
                thumbnailUrl: '',
                artistId: 'UCDanilla01',
              },
            ];
          }
          if (cmd === 'resolve_track_stream') {
            return {
              videoId: args?.videoId || 'topHindia01',
              durationSeconds: 194,
              candidates: ['http://127.0.0.1:5201/__mock_audio.wav'],
              sourceTier: 'mock_test',
            };
          }
          if (cmd === 'get_autostart_enabled') return false;
          if (cmd === 'get_global_shortcut_status') return true;
          return null;
        },
      };
      localStorage.clear();
    });

    await page.goto('http://localhost:5201', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-island-hover-sensor="true"]', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 350));

    // Open Mode 6 Music
    for (let i = 0; i < 3; i++) {
      if (await page.$('button[aria-label="Toggle Search Pod"]')) break;
      const musicBtn = await page.$('button[title*="Music"], button[aria-label*="Music"]');
      if (musicBtn) await musicBtn.click();
      else await page.click('[data-island-hover-sensor="true"]');
      await new Promise((r) => setTimeout(r, 400));
    }

    // Open Search Pod and type query
    const searchToggle = await page.waitForSelector('button[aria-label="Toggle Search Pod"]', {
      timeout: 8000,
    });
    await searchToggle.click();
    await page.waitForSelector('[data-pod="left"] input', { timeout: 5000 });
    await page.click('[data-pod="left"] input');
    await page.type('[data-pod="left"] input', 'Hindia');
    await new Promise((r) => setTimeout(r, 550));

    const searchDom = await page.evaluate(() => {
      const podText = document.querySelector('[data-pod="left"]')?.textContent || '';
      return {
        hasTopSongs: podText.includes('Evaluasi') && podText.includes('Play All'),
        hasAlbums: podText.includes('Menari Dengan Bayangan'),
        hasPlaylists: podText.includes('Indie Senja Pilihan'),
        hasSongs: podText.includes('Rumah Ke Rumah'),
      };
    });

    check(
      searchDom.hasTopSongs && searchDom.hasAlbums && searchDom.hasPlaylists && searchDom.hasSongs,
      'Search Pod renders Top Songs (with Play All), Albums, Playlists, and Songs categories'
    );

    // Click Play All on Album ("Menari Dengan Bayangan") and ensure track loads even with 404 LRCLIB lyrics
    await page.click('button[aria-label="Play All Menari Dengan Bayangan"]');
    await new Promise((r) => setTimeout(r, 450));

    // Open Queue Pod to verify tracks queued & test 3-mode Repeat button
    const queueToggle = await page.waitForSelector('button[aria-label="Toggle Queue Pod"]', {
      timeout: 5000,
    });
    await queueToggle.click();
    await new Promise((r) => setTimeout(r, 350));

    const queueAfterAlbum = await page.evaluate(() => {
      const rightPodText = document.querySelector('[data-pod="right"]')?.textContent || '';
      const centerText = document.body.innerText;
      return {
        playsFirstTrack: centerText.includes('Besok Mungkin Kita Sampai'),
        queuesSecondTrack: rightPodText.includes('Membasuh'),
        hasErrorState: centerText.includes('STREAM ERROR'),
        ipcCmds: window.__V214_IPC__.map((c) => c.cmd),
        rightPodSnippet: rightPodText.slice(0, 140),
        centerSnippet: centerText.slice(0, 220),
      };
    });

    check(
      queueAfterAlbum.playsFirstTrack &&
        queueAfterAlbum.queuesSecondTrack &&
        !queueAfterAlbum.hasErrorState,
      '1-click Album Play All loads full tracklist into Queue & plays cleanly without LRCLIB lyrics',
      JSON.stringify(queueAfterAlbum)
    );

    // Cycle Mode 6 header Repeat button: Off -> All -> One -> Off
    const repeatBtnSel = 'button[aria-label="Toggle Repeat Mode"]';
    await page.click(repeatBtnSel);
    await new Promise((r) => setTimeout(r, 120));
    const titleAll = await page.$eval(repeatBtnSel, (el) => el.getAttribute('title') || '');
    await page.click(repeatBtnSel);
    await new Promise((r) => setTimeout(r, 120));
    const titleOne = await page.$eval(repeatBtnSel, (el) => el.getAttribute('title') || '');
    await page.click(repeatBtnSel);
    await new Promise((r) => setTimeout(r, 120));
    const titleOff = await page.$eval(repeatBtnSel, (el) => el.getAttribute('title') || '');

    check(
      titleAll.includes('All') && titleOne.includes('One') && titleOff.includes('Off'),
      `Mode 6 Repeat button cycles Off -> All -> One -> Off (${titleAll} | ${titleOne} | ${titleOff})`
    );
    check(pageErrors.length === 0, `Zero uncaught browser errors during E2E (${pageErrors.join('; ')})`);
  } finally {
    await browser.close();
  }
}

async function main() {
  const viteServer = await createServer({
    root: process.cwd(),
    server: { port: 5201, strictPort: true, host: '127.0.0.1' },
    logLevel: 'silent',
  });
  await viteServer.listen();

  try {
    await runUnitAndStateMachineSuite(viteServer);
    await runBundleHygieneCheck();
    await runRealChromiumUiSuite();
  } finally {
    await viteServer.close();
  }

  console.log(`\nSUMMARY: ${passed} passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[verify-player-v214] Fatal error:', err);
  process.exit(1);
});
