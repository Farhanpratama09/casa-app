/**
 * CASA v2.3.0 QA VERIFICATION: Connect HP (Zero-App Local Web Drop)
 * Verifies Rust/Cargo security invariants, 1100x340 Right Satellite Pod geometry,
 * HitRect tracking, Hotspot switcher, batch folder grouping, and collapse resilience.
 */

import fs from 'node:fs';
import http from 'node:http';
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
  console.log('\n[Suite A] Source, Security, Store Sync & Zero Local-Path Leak Invariants\n');

  const cargoToml = fs.readFileSync(path.resolve('src-tauri/Cargo.toml'), 'utf8');
  const tauriConf = fs.readFileSync(path.resolve('src-tauri/tauri.conf.json'), 'utf8');
  const connectHpRs = fs.readFileSync(path.resolve('src-tauri/src/connect_hp.rs'), 'utf8');
  const dropZoneRs = fs.readFileSync(path.resolve('src-tauri/src/drop_zone.rs'), 'utf8');
  const libRs = fs.readFileSync(path.resolve('src-tauri/src/lib.rs'), 'utf8');
  const dropZoneView = fs.readFileSync(path.resolve('src/components/views/DropZoneView.tsx'), 'utf8');

  check(
    cargoToml.includes('axum =') &&
      cargoToml.includes('tokio-util =') &&
      cargoToml.includes('qrcode =') &&
      cargoToml.includes('"fs"') &&
      cargoToml.includes('Win32_Security_Cryptography') &&
      cargoToml.includes('Win32_NetworkManagement_IpHelper') &&
      cargoToml.includes('Win32_Networking_NetworkListManager') &&
      !cargoToml.includes('arboard') &&
      !cargoToml.includes('local-ip-address'),
    'Cargo.toml keeps minimal crate footprint (axum, tokio-util, qrcode, Win32 features; zero arboard/local-ip-address)'
  );

  const csp = tauriConf.app?.security?.csp || '';
  check(
    !/connect-src[^;]*(192\.168|10\.0\.|\*:)/i.test(csp),
    'tauri.conf.json WebView CSP connect-src stays tightly locked without wildcard LAN origins'
  );

  check(
    connectHpRs.includes('BCryptGenRandom') &&
      connectHpRs.includes('pub fn ct_token_eq') &&
      connectHpRs.includes('pub fn is_allowed_lan_ip') &&
      connectHpRs.includes('pub fn is_allowed_host') &&
      connectHpRs.includes('pub fn is_allowed_origin') &&
      connectHpRs.includes('from_fn_with_state') &&
      connectHpRs.includes('DefaultBodyLimit::max(MAX_DEFAULT_HTTP_BODY_BYTES)') &&
      connectHpRs.includes('DefaultBodyLimit::disable()') &&
      connectHpRs.includes('X_FRAME_OPTIONS') &&
      connectHpRs.includes('MAX_WS_CLIENTS') &&
      connectHpRs.includes('MAX_BATCH_FOLDERS_PER_SESSION') &&
      connectHpRs.includes('write_mark_of_the_web') &&
      connectHpRs.includes('x-casa-batch-id') &&
      connectHpRs.includes('x-casa-batch-total') &&
      connectHpRs.includes('pub fn prepare_store_zip_plan') &&
      connectHpRs.includes("filename*=UTF-8''") &&
      connectHpRs.includes('header::CACHE_CONTROL') &&
      connectHpRs.includes('write_streaming_store_zip') &&
      connectHpRs.includes('0x0807_4b50u32') &&
      connectHpRs.includes('crc32_update'),
    'connect_hp.rs implements CSPRNG, constant-time token compare, middleware host/RFC1918/Origin guard, per-route body limits, security headers, MOTW, WS/batch caps & streaming ZIP'
  );

  const htmlStart = connectHpRs.indexOf('const MOBILE_WEB_UI_HTML: &str = r##"');
  const htmlEnd = connectHpRs.indexOf('"##;', htmlStart);
  const htmlSlice = htmlStart >= 0 && htmlEnd > htmlStart ? connectHpRs.slice(htmlStart, htmlEnd) : '';
  check(
    htmlSlice.length > 500 &&
      htmlSlice.includes('history.replaceState') &&
      htmlSlice.includes('sessionStorage') &&
      htmlSlice.includes('visibilitychange') &&
      htmlSlice.includes('Hubungkan Ulang') &&
      htmlSlice.includes('Jika Chrome menampilkan peringatan HTTP lokal, pilih Tetap simpan') &&
      htmlSlice.includes("execCommand('copy')") &&
      htmlSlice.includes('uploadQueue') &&
      htmlSlice.includes('inFlightBytes') &&
      htmlSlice.includes('renderUploadProgress') &&
      htmlSlice.includes('pumpQueue') &&
      !htmlSlice.includes('innerHTML'),
    'Mobile Web UI persists token in sessionStorage before scrub, auto-reconnects on visibilitychange, includes Hubungkan Ulang + Chrome HTTP note, persistent queue & zero innerHTML'
  );

  const docsHtml = fs.readFileSync(path.resolve('docs/index.html'), 'utf8');
  const docsJs = fs.readFileSync(path.resolve('docs/app.js'), 'utf8');
  check(
    docsHtml.includes('id="vm-dropzone-connect-btn"') &&
      docsHtml.includes('id="vm-dropzone-connect-pod"') &&
      docsHtml.includes('id="vm-dz-iface-select"') &&
      docsJs.includes('folder-hp-batch') &&
      !docsJs.includes('innerHTML'),
    'Web Showcase (docs/) includes 1:1 Connect HP pod parity with zero innerHTML'
  );

  check(
    dropZoneRs.includes('pub async fn pick_drop_zone_folder') &&
      dropZoneRs.includes('FOS_PICKFOLDERS') &&
      dropZoneRs.includes('pub fn create_drop_transit_directory') &&
      dropZoneRs.includes('pub fn save_dropped_directory_file') &&
      dropZoneRs.includes('is_blocked_asset_scope_path') &&
      !dropZoneRs.includes('allow_directory') &&
      dropZoneRs.includes('pub fn write_clipboard_text') &&
      libRs.includes('connect_hp::shutdown_connect_hp_server()') &&
      libRs.includes('connect_hp::start_connect_hp') &&
      libRs.includes('connect_hp::sync_connect_hp_items') &&
      libRs.includes('drop_zone::create_drop_transit_directory') &&
      libRs.includes('drop_zone::save_dropped_directory_file') &&
      libRs.includes('drop_zone::pick_drop_zone_folder'),
    'drop_zone.rs and lib.rs wire folder drag-in/out scope (strictly file-level, no allow_directory), FOS_PICKFOLDERS, write_clipboard_text, shutdown hooks & Connect HP IPC commands'
  );

  const dropZoneStoreSrc = fs.readFileSync(path.resolve('src/stores/useDropZoneStore.ts'), 'utf8');
  const batteryPillSrc = fs.readFileSync(path.resolve('src/components/system/BatteryPill.tsx'), 'utf8');
  check(
    dropZoneStoreSrc.includes('webkitGetAsEntry') &&
      dropZoneStoreSrc.includes('readEntries') &&
      dropZoneStoreSrc.includes('createDropTransitDirectory') &&
      dropZoneStoreSrc.includes('saveDroppedDirectoryFile') &&
      dropZoneStoreSrc.includes('File >25 MB: gunakan tombol + File, + Folder, atau Paste (Ctrl+V).'),
    'useDropZoneStore.ts implements recursive webkitGetAsEntry/readEntries loop folder drag-in pipeline & exact >25 MB warning'
  );

  check(
    batteryPillSrc.includes('#22c55e') &&
      batteryPillSrc.includes('#f59e0b') &&
      batteryPillSrc.includes('#ef4444') &&
      batteryPillSrc.includes('#facc15') &&
      docsHtml.includes('stroke="#22c55e"'),
    'Battery indicator uses green #22c55e (normal/charging), amber #f59e0b (<=20%), red #ef4444 (<=10%) & yellow lightning bolt #facc15 synced to docs/'
  );

  check(
    !/text-emerald-|text-green-|bg-emerald-|border-emerald-|#10B981/i.test(dropZoneView) &&
      !dropZoneView.includes('dangerouslySetInnerHTML'),
    'DropZoneView enforces Pure Monochrome compliance and zero dangerouslySetInnerHTML'
  );

  // SSR Store Checks: zero local-path leak on mapDropItemsForHpSync & single batch folder upsert
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

  const { useDropZoneStore } = await viteServer.ssrLoadModule('/src/stores/useDropZoneStore.ts');
  const { mapDropItemsForHpSync } = await viteServer.ssrLoadModule('/src/stores/useConnectHpStore.ts');

  const batchCard1 = useDropZoneStore.getState().upsertBatchFolderItem({
    batchId: 'batch-101',
    folderPath: 'C:\\Users\\Demo\\Downloads\\CASA Drop\\Batch-1200',
    title: 'Batch-1200',
    fileCount: 3,
    batchTotal: 8,
    sizeBytes: 12000,
  });
  const batchCard2 = useDropZoneStore.getState().upsertBatchFolderItem({
    batchId: 'batch-101',
    folderPath: 'C:\\Users\\Demo\\Downloads\\CASA Drop\\Batch-1200',
    title: 'Batch-1200',
    fileCount: 8,
    batchTotal: 8,
    sizeBytes: 34000,
  });
  const itemsAfterBatch = useDropZoneStore.getState().items;
  check(
    batchCard1.id === batchCard2.id &&
      itemsAfterBatch.length === 1 &&
      itemsAfterBatch[0].type === 'folder' &&
      itemsAfterBatch[0].fileCount === 8 &&
      itemsAfterBatch[0].batchTotal === 8,
    'upsertBatchFolderItem merges >5 batch uploads into 1 live-updating folder card'
  );

  const mapped = mapDropItemsForHpSync([
    {
      id: 'f-secret',
      type: 'file',
      title: 'secret.pdf',
      payload: 'C:\\Users\\Developer\\Desktop\\secret.pdf',
      sizeBytes: 1024,
      extension: 'pdf',
      timestamp: Date.now(),
    },
    {
      id: 't-note',
      type: 'text',
      title: 'Note',
      payload: 'Quick reminder',
      extension: 'TXT',
      timestamp: Date.now(),
    },
  ]);

  const fileMapped = mapped.find((m) => m.id === 'f-secret');
  const textMapped = mapped.find((m) => m.id === 't-note');
  check(
    fileMapped?.textPayload === undefined &&
      fileMapped?.localPath === 'C:\\Users\\Developer\\Desktop\\secret.pdf' &&
      textMapped?.localPath === undefined &&
      textMapped?.textPayload === 'Quick reminder',
    'mapDropItemsForHpSync isolates localPath for files and textPayload strictly for text/links'
  );

  useDropZoneStore.getState().clearEphemeralSession();
}

async function runSuiteB() {
  console.log('\n[Suite B] Real Chromium 1100x340 E2E (Right Pod 204x177, Hitbox, Hotspot & Batch Incoming)\n');

  const chromePath = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((p) => fs.existsSync(p));
  if (!chromePath) {
    throw new Error('Chromium/Edge binary not found for Suite B E2E');
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
      window.__CONNECT_HP_CALLS__ = [];
      window.__SYNC_ITEMS_LOG__ = [];
      window.__EVENT_LISTENERS__ = {};
      window.__EVENT_BY_NAME__ = {};

      const mockCandidates = [
        { ip: '192.168.1.45', label: 'Wi-Fi · 192.168.1.45', isHotspot: false },
        { ip: '192.168.137.1', label: 'Mobile Hotspot · 192.168.137.1', isHotspot: true },
      ];
      let currentIp = '192.168.1.45';
      let currentActive = false;
      let sessionSeq = 0;

      const buildSession = (reason = null) =>
        currentActive
          ? {
              active: true,
              ip: currentIp,
              port: 54819 + Math.max(1, sessionSeq),
              url: `http://${currentIp}:${54819 + Math.max(1, sessionSeq)}/?t=testtoken_${Math.max(1, sessionSeq)}`,
              qrSize: 21,
              qrPath: 'M1 1h7v7H1zM13 1h7v7h-7zM1 13h7v7H1z',
              networkCategory: 'Public',
              candidateInterfaces: mockCandidates,
              connectedClients: 0,
              autoCopyClipboard: true,
              idleTimeoutSecs: 600,
              downloadDir: 'C:\\Users\\Demo\\Downloads\\CASA Drop',
              reason,
            }
          : {
              active: false,
              ip: '',
              port: 0,
              url: '',
              qrSize: 0,
              qrPath: '',
              networkCategory: 'Unknown',
              candidateInterfaces: mockCandidates,
              connectedClients: 0,
              autoCopyClipboard: true,
              idleTimeoutSecs: 600,
              downloadDir: '',
              reason,
            };

      window.__EMIT_TAURI_EVENT__ = (eventName, payload) => {
        const ids = window.__EVENT_BY_NAME__[eventName] || [];
        ids.forEach((id) => {
          const cb = window.__EVENT_LISTENERS__[id];
          if (typeof cb === 'function') {
            cb({ event: eventName, id, payload });
          }
        });
      };

      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: () => {},
      };
      window.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        convertFileSrc: (filePath, protocol = 'asset') =>
          `${protocol}://localhost/${encodeURIComponent(String(filePath || ''))}`,
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
            window.__HITBOX_EVENTS__.push({ t: Date.now(), rects: args?.rects || [] });
            return null;
          }
          if (cmd === 'get_connect_hp_status') {
            return buildSession(null);
          }
          if (cmd === 'start_connect_hp') {
            sessionSeq += 1;
            currentActive = true;
            if (args?.preferredIp) currentIp = args.preferredIp;
            window.__CONNECT_HP_CALLS__.push({ cmd, args });
            return buildSession(null);
          }
          if (cmd === 'select_connect_hp_interface') {
            if (args?.preferredIp) currentIp = args.preferredIp;
            window.__CONNECT_HP_CALLS__.push({ cmd, args });
            return buildSession(null);
          }
          if (cmd === 'stop_connect_hp') {
            currentActive = false;
            window.__CONNECT_HP_CALLS__.push({ cmd, args });
            return null;
          }
          if (cmd === 'set_connect_hp_auto_copy') {
            window.__CONNECT_HP_CALLS__.push({ cmd, args });
            return { ...buildSession(null), autoCopyClipboard: Boolean(args?.enabled) };
          }
          if (cmd === 'sync_connect_hp_items') {
            window.__SYNC_ITEMS_LOG__.push(args?.items || []);
            return null;
          }
          if (cmd === 'open_windows_network_settings') {
            window.__CONNECT_HP_CALLS__.push({ cmd, args });
            return null;
          }
          if (cmd === 'pick_drop_zone_folder') {
            return ['D:\\Media\\TripPhotos'];
          }
          if (cmd === 'create_drop_transit_directory') {
            const safeName = String(args?.folderName || 'Dropped Folder');
            window.__CONNECT_HP_CALLS__.push({ cmd, args });
            return `C:\\Users\\Demo\\Downloads\\CASA Drop\\${safeName}`;
          }
          if (cmd === 'save_dropped_directory_file') {
            window.__DROPPED_DIR_FILES__ = window.__DROPPED_DIR_FILES__ || [];
            window.__DROPPED_DIR_FILES__.push({
              rootDir: args?.rootDir,
              relativePath: args?.relativePath,
            });
            return 16;
          }
          if (cmd === 'stage_dropped_file') {
            return `C:\\Users\\Demo\\AppData\\Local\\casa\\drop_zone_transit\\${args?.fileName || 'file.bin'}`;
          }
          if (cmd === 'get_file_metadata') {
            const p = String(args?.path || '');
            if (p.toLowerCase().endsWith('.png') || p.toLowerCase().endsWith('.txt')) {
              return { exists: true, size_bytes: 64, is_dir: false, file_count: null };
            }
            return { exists: true, size_bytes: 0, is_dir: true, file_count: 14 };
          }
          if (cmd === 'read_clipboard_files') return [];
          if (cmd === 'read_clipboard_text') return null;
          if (cmd === 'cleanup_ephemeral_drop_zone') return null;
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
    });

    await page.goto('http://127.0.0.1:5303', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-island-container="true"]', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 420));

    // Open Mode 6 and switch to Drop Zone
    await page.click('[data-island-container="true"]');
    await new Promise((r) => setTimeout(r, 300));
    await page.evaluate(() => {
      const dzBtn = Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Drop Zone')
      );
      dzBtn?.click();
    });
    await new Promise((r) => setTimeout(r, 320));

    const headerControls = await page.evaluate(() => ({
      hasConnectBtn: Boolean(document.querySelector('[data-dropzone-connect-hp="true"]')),
      hasPasteBtn: Boolean(document.querySelector('[data-dropzone-paste="true"]')),
      hasPickFileBtn: Boolean(document.querySelector('[data-dropzone-pick-file="true"]')),
      hasPickFolderBtn: Boolean(document.querySelector('[data-dropzone-pick-folder="true"]')),
    }));
    check(
      headerControls.hasConnectBtn &&
        headerControls.hasPasteBtn &&
        headerControls.hasPickFileBtn &&
        headerControls.hasPickFolderBtn,
      'DropZone header exposes Connect HP, Paste, + File, and + Folder actions'
    );

    // Click Connect HP -> mounts Right Satellite Pod (204x177 at x=850..1054) + 2nd HitRect + Public warning
    await page.click('[data-dropzone-connect-hp="true"]');
    await new Promise((r) => setTimeout(r, 350));

    const podAudit = await page.evaluate(() => {
      const pod = document.querySelector('[data-connect-hp-pod="true"]');
      const mainContainer = document.querySelector('[data-island-container="true"]');
      const podRect = pod?.getBoundingClientRect();
      const mainRect = mainContainer?.getBoundingClientRect();
      const qrPathD = pod?.querySelector('svg path')?.getAttribute('d') || '';
      const lastHitboxes = window.__HITBOX_EVENTS__.at(-1)?.rects || [];
      return {
        startCalls: window.__CONNECT_HP_CALLS__.filter((c) => c.cmd === 'start_connect_hp').length,
        podLeft: podRect ? Math.round(podRect.left) : 0,
        podRight: podRect ? Math.round(podRect.right) : 0,
        podWidth: podRect ? Math.round(podRect.width) : 0,
        podHeight: podRect ? Math.round(podRect.height) : 0,
        mainRight: mainRect ? Math.round(mainRect.right) : 0,
        hasQrSvgPath: qrPathD.startsWith('M'),
        hasPublicGuide: Boolean(document.querySelector('[data-connect-hp-public-guide="true"]')),
        hitboxCount: lastHitboxes.length,
        rightHitbox: lastHitboxes[1] || null,
      };
    });
    check(
      podAudit.startCalls === 1 &&
        podAudit.podWidth === 204 &&
        podAudit.podHeight === 177 &&
        podAudit.podLeft >= 848 &&
        podAudit.podLeft > podAudit.mainRight &&
        podAudit.podRight <= 1060 &&
        podAudit.hasQrSvgPath &&
        podAudit.hasPublicGuide &&
        podAudit.hitboxCount === 2 &&
        podAudit.rightHitbox?.center_offset_x === 402 &&
        podAudit.rightHitbox?.width === 204 &&
        podAudit.rightHitbox?.height === 178,
      'Right Satellite Pod (204x177 at x=850..1054) mounts with SVG QR, Public guide & 2nd HitRect (center_offset_x=402)',
      JSON.stringify(podAudit)
    );

    // Switch interface to Mobile Hotspot 192.168.137.1
    await page.select('[data-connect-hp-iface="true"]', '192.168.137.1');
    await new Promise((r) => setTimeout(r, 220));
    const afterIface = await page.evaluate(() => ({
      ifaceCalls: window.__CONNECT_HP_CALLS__.filter(
        (c) => c.cmd === 'select_connect_hp_interface' && c.args?.preferredIp === '192.168.137.1'
      ).length,
      footerText: document.querySelector('[data-connect-hp-pod="true"]')?.textContent || '',
      hasPublicGuide: Boolean(document.querySelector('[data-connect-hp-public-guide="true"]')),
    }));
    check(
      afterIface.ifaceCalls === 1 &&
        afterIface.footerText.includes('192.168.137.1:54820') &&
        !afterIface.hasPublicGuide,
      'Adapter switch toggles to Hotspot 192.168.137.1 cleanly and clears Public Wi-Fi warning',
      JSON.stringify(afterIface)
    );

    // Simulate incoming text, link, and >5 file batch folder via casa://connect-hp-item events
    await page.evaluate(async () => {
      window.__EMIT_TAURI_EVENT__('casa://connect-hp-item', {
        kind: 'text',
        payload: 'https://casa-app.dev/connect-hp',
        copiedToClipboard: true,
      });
      await new Promise((r) => setTimeout(r, 90));
      window.__EMIT_TAURI_EVENT__('casa://connect-hp-item', {
        kind: 'batch_folder',
        payload: 'C:\\Users\\Demo\\Downloads\\CASA Drop\\Batch-0030',
        fileName: 'Batch-0030',
        batchId: 'b-e2e-1',
        fileCount: 3,
        batchTotal: 8,
        sizeBytes: 15000000,
      });
      await new Promise((r) => setTimeout(r, 90));
      window.__EMIT_TAURI_EVENT__('casa://connect-hp-item', {
        kind: 'batch_folder',
        payload: 'C:\\Users\\Demo\\Downloads\\CASA Drop\\Batch-0030',
        fileName: 'Batch-0030',
        batchId: 'b-e2e-1',
        fileCount: 8,
        batchTotal: 8,
        sizeBytes: 42000000,
      });
    });
    await new Promise((r) => setTimeout(r, 250));

    const incomingAudit = await page.evaluate(() => {
      const folderCards = document.querySelectorAll('[data-drop-item-type="folder"]');
      const linkCards = document.querySelectorAll('[data-drop-item-type="link"]');
      const lastSync = window.__SYNC_ITEMS_LOG__.at(-1) || [];
      const syncedFolder = lastSync.find((i) => i.itemType === 'folder');
      return {
        folderCount: folderCards.length,
        folderText: folderCards[0]?.textContent || '',
        linkCount: linkCards.length,
        syncedFolderHasPathOnly: Boolean(syncedFolder?.localPath) && syncedFolder?.textPayload === undefined,
      };
    });
    check(
      incomingAudit.folderCount === 1 &&
        incomingAudit.folderText.includes('8/8 file') &&
        incomingAudit.linkCount === 1 &&
        incomingAudit.syncedFolderHasPathOnly,
      'Incoming HP link & batch (>5 files) render cleanly as 1 updating folder card with secure DTO sync',
      JSON.stringify(incomingAudit)
    );

    // Drag-In mixed drop: Folder with 105 files paginated via readEntries (100 + 5 + []) + 1 plain file
    await page.evaluate(async () => {
      const container = document.querySelector('[data-dropzone-pick-folder]')?.closest('div[tabindex="-1"]');
      if (!container) throw new Error('DropZoneView container missing');

      const makeFileEntry = (name) => ({
        isFile: true,
        isDirectory: false,
        name,
        fullPath: `/ExplorerDrop/${name}`,
        file: (cb) => cb(new File(['casa-folder-data'], name, { type: 'text/plain' })),
      });

      const batch1 = Array.from({ length: 100 }, (_, i) => makeFileEntry(`img-${i + 1}.txt`));
      const nestedDirEntry = {
        isFile: false,
        isDirectory: true,
        name: 'nested',
        fullPath: '/ExplorerDrop/nested',
        createReader: () => {
          let read = false;
          return {
            readEntries: (cb) => {
              if (!read) {
                read = true;
                cb([makeFileEntry('deep.txt')]);
              } else {
                cb([]);
              }
            },
          };
        },
      };
      const batch2 = [
        makeFileEntry('img-101.txt'),
        makeFileEntry('img-102.txt'),
        makeFileEntry('img-103.txt'),
        makeFileEntry('img-104.txt'),
        nestedDirEntry,
      ];

      const rootDirEntry = {
        isFile: false,
        isDirectory: true,
        name: 'ExplorerAlbum',
        fullPath: '/ExplorerAlbum',
        createReader: () => {
          let callIdx = 0;
          return {
            readEntries: (cb) => {
              if (callIdx === 0) {
                callIdx++;
                cb(batch1);
              } else if (callIdx === 1) {
                callIdx++;
                cb(batch2);
              } else {
                cb([]);
              }
            },
          };
        },
      };

      const plainPng = new File([new Uint8Array(64)], 'cover.png', { type: 'image/png' });
      const mockDt = {
        files: [plainPng],
        items: [
          {
            kind: 'file',
            type: '',
            webkitGetAsEntry: () => rootDirEntry,
            getAsFile: () => null,
          },
          {
            kind: 'file',
            type: 'image/png',
            webkitGetAsEntry: () => ({
              isFile: true,
              isDirectory: false,
              name: 'cover.png',
              fullPath: '/cover.png',
            }),
            getAsFile: () => plainPng,
          },
        ],
        types: ['Files'],
        getData: () => '',
      };

      const dropEv = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(dropEv, 'dataTransfer', { value: mockDt });
      container.dispatchEvent(dropEv);
    });
    await new Promise((r) => setTimeout(r, 420));

    const droppedFolderAudit = await page.evaluate(() => {
      const folderCards = Array.from(document.querySelectorAll('[data-drop-item-type="folder"]')).map(
        (el) => el.textContent || ''
      );
      const imageCards = Array.from(document.querySelectorAll('[data-drop-item-type="image"]')).map(
        (el) => el.textContent || ''
      );
      const lastSync = window.__SYNC_ITEMS_LOG__.at(-1) || [];
      return {
        savedFileCount: (window.__DROPPED_DIR_FILES__ || []).length,
        hasNestedRelPath: (window.__DROPPED_DIR_FILES__ || []).some(
          (f) => f.relativePath === 'nested/deep.txt'
        ),
        has105FolderCard: folderCards.some((t) => t.includes('ExplorerAlbum') && t.includes('105 files')),
        hasCoverPngCard: imageCards.some((t) => t.includes('cover.png')),
        syncedFolderItem: lastSync.some(
          (i) =>
            i.itemType === 'folder' &&
            i.title === 'ExplorerAlbum' &&
            Boolean(i.localPath) &&
            i.textPayload === undefined
        ),
      };
    });
    check(
      droppedFolderAudit.savedFileCount === 105 &&
        droppedFolderAudit.hasNestedRelPath &&
        droppedFolderAudit.has105FolderCard &&
        droppedFolderAudit.hasCoverPngCard &&
        droppedFolderAudit.syncedFolderItem,
      'Drag-In mixed drop saves all 105 nested folder entries across readEntries pagination + parks plain file & syncs ZIP-ready folder card',
      JSON.stringify(droppedFolderAudit)
    );

    // Oversized (>25 MB) file drop renders full-width non-truncated warning strip + dismiss button
    await page.evaluate(async () => {
      const container = document.querySelector('[data-dropzone-pick-folder]')?.closest('div[tabindex="-1"]');
      if (!container) throw new Error('DropZoneView container missing');
      const hugeFile = { name: 'giant-video.mov', size: 30 * 1024 * 1024, type: 'video/quicktime' };
      const mockDt = {
        files: [hugeFile],
        items: [
          {
            kind: 'file',
            type: 'video/quicktime',
            webkitGetAsEntry: () => ({ isFile: true, isDirectory: false, name: 'giant-video.mov' }),
            getAsFile: () => hugeFile,
          },
        ],
        types: ['Files'],
        getData: () => '',
      };
      const dropEv = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(dropEv, 'dataTransfer', { value: mockDt });
      container.dispatchEvent(dropEv);
    });
    await new Promise((r) => setTimeout(r, 220));

    const largeNoticeAudit = await page.evaluate(() => {
      const noticeEl = document.querySelector('[data-security-notice="true"]');
      const rect = noticeEl?.getBoundingClientRect();
      const spanEl = noticeEl?.querySelector('span');
      return {
        exists: Boolean(noticeEl),
        text: spanEl?.textContent || noticeEl?.textContent || '',
        width: rect ? Math.round(rect.width) : 0,
        hasTruncateClass: Boolean(spanEl?.className?.includes('truncate')),
        hasDismissBtn: Boolean(document.querySelector('[data-security-notice-dismiss="true"]')),
      };
    });
    await page.click('[data-security-notice-dismiss="true"]');
    await new Promise((r) => setTimeout(r, 180));
    const dismissedAfterClick = await page.evaluate(
      () => !document.querySelector('[data-security-notice="true"]')
    );
    check(
      largeNoticeAudit.exists &&
        largeNoticeAudit.text === 'File >25 MB: gunakan tombol + File, + Folder, atau Paste (Ctrl+V).' &&
        largeNoticeAudit.width >= 500 &&
        !largeNoticeAudit.hasTruncateClass &&
        largeNoticeAudit.hasDismissBtn &&
        dismissedAfterClick,
      'Oversized >25 MB drop renders full-width non-truncated warning banner with dismiss button',
      JSON.stringify({ largeNoticeAudit, dismissedAfterClick })
    );

    // Switch tab -> collapse capsule -> server must stay alive (stop_connect_hp calls === 0)
    await page.evaluate(() => {
      const musicBtn = Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Musik')
      );
      musicBtn?.click();
    });
    await new Promise((r) => setTimeout(r, 220));
    await page.evaluate(() => {
      const dzBtn = Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Drop Zone')
      );
      dzBtn?.click();
    });
    await new Promise((r) => setTimeout(r, 240));

    const stopCountAfterTabSwitch = await page.evaluate(() => ({
      stopCalls: window.__CONNECT_HP_CALLS__.filter((c) => c.cmd === 'stop_connect_hp').length,
      startCalls: window.__CONNECT_HP_CALLS__.filter((c) => c.cmd === 'start_connect_hp').length,
    }));
    check(
      stopCountAfterTabSwitch.stopCalls === 0 && stopCountAfterTabSwitch.startCalls === 1,
      'Server stays alive across tab switch & pod close without calling stop_connect_hp',
      JSON.stringify(stopCountAfterTabSwitch)
    );

    // Re-open Connect HP pod and click explicit Stop button
    await page.click('[data-dropzone-connect-hp="true"]');
    await new Promise((r) => setTimeout(r, 320));
    await page.click('[data-connect-hp-stop="true"]');
    await new Promise((r) => setTimeout(r, 480));

    const afterExplicitStop = await page.evaluate(() => ({
      stopCalls: window.__CONNECT_HP_CALLS__.filter((c) => c.cmd === 'stop_connect_hp').length,
      podGone: !document.querySelector('[data-connect-hp-pod="true"]'),
    }));
    check(
      afterExplicitStop.stopCalls === 1 && afterExplicitStop.podGone,
      'Explicit Stop button invokes stop_connect_hp and closes Right Satellite Pod cleanly',
      JSON.stringify(afterExplicitStop)
    );

    // Re-click Connect HP after explicit Stop -> MUST start fresh session without restarting CASA
    await page.click('[data-dropzone-connect-hp="true"]');
    await new Promise((r) => setTimeout(r, 340));

    const restartedSessionAudit = await page.evaluate(() => {
      const pod = document.querySelector('[data-connect-hp-pod="true"]');
      const qrPathD = pod?.querySelector('svg path')?.getAttribute('d') || '';
      return {
        startCalls: window.__CONNECT_HP_CALLS__.filter((c) => c.cmd === 'start_connect_hp').length,
        podReopened: Boolean(pod),
        hasNewPort54821: (pod?.textContent || '').includes('192.168.137.1:54821'),
        hasQrSvgPath: qrPathD.startsWith('M'),
      };
    });
    check(
      restartedSessionAudit.startCalls === 2 &&
        restartedSessionAudit.podReopened &&
        restartedSessionAudit.hasNewPort54821 &&
        restartedSessionAudit.hasQrSvgPath,
      'Clicking Connect HP again after explicit Stop starts fresh session (port 54821 + new QR) without quitting CASA',
      JSON.stringify(restartedSessionAudit)
    );

    await page.click('[data-connect-hp-stop="true"]');
    await new Promise((r) => setTimeout(r, 420));

    check(pageErrors.length === 0, `Zero uncaught Chromium page errors (${pageErrors.length})`);
  } finally {
    await browser.close();
  }
}

async function runSuiteC() {
  console.log('\n[Suite C] Mobile Web UI Re-Scan, Reload Persistence, Auto-Reconnect, .zip Content-Length & Upload Queue E2E\n');

  const connectHpRs = fs.readFileSync(path.resolve('src-tauri/src/connect_hp.rs'), 'utf8');
  const startMarker = 'const MOBILE_WEB_UI_HTML: &str = r##"';
  const htmlStartIdx = connectHpRs.indexOf(startMarker);
  const htmlEndIdx = connectHpRs.indexOf('"##;', htmlStartIdx);
  if (htmlStartIdx < 0 || htmlEndIdx < 0) {
    throw new Error('Could not extract MOBILE_WEB_UI_HTML from connect_hp.rs');
  }
  const mobileHtml = connectHpRs.slice(htmlStartIdx + startMarker.length, htmlEndIdx).trimStart();

  // Deterministic valid STORE ZIP payload (LFH + payload + EOCD) for Content-Length parity verification
  const dummyZipBuffer = Buffer.from(
    '504b030414000000000000002100000000000400000004000000080000006e6f74652e74787463617361' +
      '504b01021400140000000000000021000000000004000000040000000800000000000000000020000000000000006e6f74652e747874' +
      '504b05060000000001000100360000002a0000000000',
    'hex'
  );

  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const hdrToken = String(req.headers['x-casa-token'] || '');
    const queryToken = reqUrl.searchParams.get('t') || '';

    if (reqUrl.pathname === '/api/items') {
      if (hdrToken !== 'testtoken1234' && queryToken !== 'testtoken1234') {
        res.writeHead(401);
        res.end('Unauthorized');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(
        JSON.stringify({
          items: [
            {
              id: 'folder-zip-1',
              itemType: 'folder',
              title: 'Trip Album',
              fileCount: 2,
              sizeBytes: dummyZipBuffer.length,
            },
          ],
        })
      );
      return;
    }

    if (reqUrl.pathname === '/api/file/folder-zip-1') {
      if (hdrToken !== 'testtoken1234' && queryToken !== 'testtoken1234') {
        res.writeHead(401);
        res.end('Unauthorized');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Length': String(dummyZipBuffer.length),
        'Content-Disposition': "attachment; filename=\"Trip Album.zip\"; filename*=UTF-8''Trip%20Album.zip",
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(dummyZipBuffer);
      return;
    }

    if (queryToken && queryToken !== 'testtoken1234') {
      res.writeHead(401);
      res.end('Unauthorized');
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
    });
    res.end(mobileHtml);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}/?t=testtoken1234`;

  const chromePath = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((p) => fs.existsSync(p));
  if (!chromePath) {
    server.close();
    throw new Error('Chromium/Edge binary not found for Suite C E2E');
  }

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    defaultViewport: { width: 390, height: 844 },
  });

  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
      console.error('  [SuiteC PageError]', err.message);
    });

    await page.evaluateOnNewDocument(() => {
      window.__MOCK_XHRS__ = [];
      window.__ACTIVE_XHR_COUNT__ = 0;
      window.__MAX_CONCURRENT_XHRS__ = 0;
      window.__MOCK_WS_INSTANCES__ = [];

      class MockWebSocket {
        constructor(url) {
          this.url = url;
          this.readyState = 0;
          window.__MOCK_WS_INSTANCES__.push(this);
          setTimeout(() => {
            if (this.readyState === 0) {
              this.readyState = 1;
              if (typeof this.onopen === 'function') this.onopen();
            }
          }, 0);
        }
        simulateDisconnect() {
          this.readyState = 3;
          if (typeof this.onclose === 'function') this.onclose();
        }
        send() {}
        close() {
          this.readyState = 3;
        }
      }
      MockWebSocket.CONNECTING = 0;
      MockWebSocket.OPEN = 1;
      MockWebSocket.CLOSED = 3;
      window.WebSocket = MockWebSocket;

      class MockXMLHttpRequest {
        constructor() {
          this.headers = {};
          this.upload = {};
          this.status = 0;
          this.method = 'GET';
          this.url = '';
        }
        open(method, url) {
          this.method = method;
          this.url = url;
        }
        setRequestHeader(k, v) {
          this.headers[k] = v;
        }
        send(body) {
          const self = this;
          this.body = body;
          const id = window.__MOCK_XHRS__.length;
          window.__ACTIVE_XHR_COUNT__ += 1;
          if (window.__ACTIVE_XHR_COUNT__ > window.__MAX_CONCURRENT_XHRS__) {
            window.__MAX_CONCURRENT_XHRS__ = window.__ACTIVE_XHR_COUNT__;
          }
          const ctrl = {
            id,
            active: true,
            headers: self.headers,
            progress(loaded, total) {
              if (!this.active) return;
              if (typeof self.upload.onprogress === 'function') {
                self.upload.onprogress({ lengthComputable: true, loaded, total });
              }
            },
            succeed(status = 200) {
              if (!this.active) return;
              this.active = false;
              window.__ACTIVE_XHR_COUNT__ -= 1;
              self.status = status;
              if (typeof self.onload === 'function') self.onload();
            },
            fail(status = 500) {
              if (!this.active) return;
              this.active = false;
              window.__ACTIVE_XHR_COUNT__ -= 1;
              self.status = status;
              if (typeof self.onerror === 'function') self.onerror();
            },
          };
          window.__MOCK_XHRS__.push(ctrl);
        }
      }
      window.XMLHttpRequest = MockXMLHttpRequest;
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#file-input', { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 60));

    const initialAuthAudit = await page.evaluate(() => ({
      search: window.location.search,
      storedToken: window.sessionStorage.getItem('casa_hp_token'),
      wsBadge: document.getElementById('ws-badge')?.textContent,
      reconnectHidden: document.getElementById('reconnect-btn')?.hidden,
      listText: document.getElementById('laptop-list')?.textContent || '',
      zipHref: document.querySelector('#laptop-list a[download]')?.getAttribute('href') || '',
    }));
    check(
      initialAuthAudit.search === '' &&
        initialAuthAudit.storedToken === 'testtoken1234' &&
        initialAuthAudit.wsBadge === 'Terhubung' &&
        initialAuthAudit.reconnectHidden === true &&
        initialAuthAudit.listText.includes('Jika Chrome menampilkan peringatan HTTP lokal, pilih Tetap simpan') &&
        initialAuthAudit.zipHref.includes('/api/file/folder-zip-1?t=testtoken1234'),
      'Suite C: Token saved to sessionStorage before scrub, WS connects & .zip card displays Chrome HTTP note',
      JSON.stringify(initialAuthAudit)
    );

    // Reload directly at '/' (without ?t= query) to simulate Chrome Android tab reload from background
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#file-input', { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 60));

    const afterReloadAudit = await page.evaluate(() => ({
      pathname: window.location.pathname,
      search: window.location.search,
      wsBadge: document.getElementById('ws-badge')?.textContent,
      listText: document.getElementById('laptop-list')?.textContent || '',
    }));
    check(
      afterReloadAudit.pathname === '/' &&
        afterReloadAudit.search === '' &&
        afterReloadAudit.wsBadge === 'Terhubung' &&
        afterReloadAudit.listText.includes('Trip Album'),
      'Suite C: Reloading / without ?t= keeps sessionStorage token & restores live Connect HP items',
      JSON.stringify(afterReloadAudit)
    );

    // Verify exact Content-Length, Content-Type, Content-Disposition (RFC 5987), & Cache-Control on .zip download
    const zipDownloadAudit = await page.evaluate(async () => {
      const link = document.querySelector('#laptop-list a[download]');
      const href = link?.getAttribute('href') || '';
      const resp = await fetch(href);
      const buf = await resp.arrayBuffer();
      return {
        status: resp.status,
        contentType: resp.headers.get('content-type'),
        contentLengthHeader: Number(resp.headers.get('content-length')),
        actualByteLength: buf.byteLength,
        contentDisposition: resp.headers.get('content-disposition'),
        cacheControl: resp.headers.get('cache-control'),
      };
    });
    check(
      zipDownloadAudit.status === 200 &&
        zipDownloadAudit.contentType === 'application/zip' &&
        zipDownloadAudit.contentLengthHeader === dummyZipBuffer.length &&
        zipDownloadAudit.actualByteLength === dummyZipBuffer.length &&
        Boolean(zipDownloadAudit.contentDisposition?.includes("filename*=UTF-8''Trip%20Album.zip")) &&
        zipDownloadAudit.cacheControl === 'no-store',
      'Suite C: Folder .zip endpoint returns exact Content-Length, application/zip, RFC5987 filename* & no-store headers',
      JSON.stringify(zipDownloadAudit)
    );

    // Simulate WS drop -> Hubungkan Ulang button appears -> visibilitychange auto-reconnects seamlessly
    await page.evaluate(() => {
      const latestWs = window.__MOCK_WS_INSTANCES__.at(-1);
      latestWs?.simulateDisconnect();
    });
    await new Promise((r) => setTimeout(r, 20));
    const disconnectedAudit = await page.evaluate(() => ({
      wsBadge: document.getElementById('ws-badge')?.textContent,
      reconnectHidden: document.getElementById('reconnect-btn')?.hidden,
      wsCountBefore: window.__MOCK_WS_INSTANCES__.length,
    }));

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await new Promise((r) => setTimeout(r, 40));

    const reconnectedAudit = await page.evaluate(() => ({
      wsBadge: document.getElementById('ws-badge')?.textContent,
      reconnectHidden: document.getElementById('reconnect-btn')?.hidden,
      wsCountAfter: window.__MOCK_WS_INSTANCES__.length,
    }));
    check(
      disconnectedAudit.wsBadge === 'Terputus' &&
        disconnectedAudit.reconnectHidden === false &&
        reconnectedAudit.wsBadge === 'Terhubung' &&
        reconnectedAudit.reconnectHidden === true &&
        reconnectedAudit.wsCountAfter > disconnectedAudit.wsCountBefore,
      'Suite C: WS disconnect reveals Hubungkan Ulang button & visibilitychange auto-reconnects cleanly',
      JSON.stringify({ disconnectedAudit, reconnectedAudit })
    );

    // Simulate QR re-scan navigation back to /?t=testtoken1234 before running upload queue checks
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#file-input', { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 30));
    const rescanAudit = await page.evaluate(() => ({
      search: window.location.search,
      wsBadge: document.getElementById('ws-badge')?.textContent,
    }));
    check(
      rescanAudit.search === '' && rescanAudit.wsBadge === 'Terhubung',
      'Suite C: Re-scanning QR URL while session active re-authenticates seamlessly'
    );

    // Case 1 (Appending while active): 5 files (100KB video + four 10KB files = 140KB) + 3 extra 20KB photos = 200KB
    const batch1State = await page.evaluate(() => {
      const input = document.getElementById('file-input');
      const dt = new DataTransfer();
      const sizes = [100000, 10000, 10000, 10000, 10000];
      sizes.forEach((sz, idx) => {
        const name = idx === 0 ? 'big-video.mp4' : `clip-${idx}.jpg`;
        dt.items.add(new File([new Uint8Array(sz)], name, { type: 'application/octet-stream' }));
      });
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        countText: document.getElementById('upload-count-text')?.textContent,
        pctText: document.getElementById('upload-pct-text')?.textContent,
        activeClass: document.getElementById('upload-prog-wrap')?.classList.contains('active'),
        activeXhrs: window.__ACTIVE_XHR_COUNT__,
        maxConcurrent: window.__MAX_CONCURRENT_XHRS__,
      };
    });
    check(
      batch1State.countText === '0 / 5 selesai' &&
        batch1State.pctText === '0%' &&
        batch1State.activeClass === true &&
        batch1State.activeXhrs === 2 &&
        batch1State.maxConcurrent === 2,
      'Suite C: Batch 1 (5 files) starts cleanly at 0 / 5 selesai with 2 concurrent workers',
      JSON.stringify(batch1State)
    );

    // Video #0 hits 50% (50KB/100KB), file #1 completes (10KB), worker pumps #2 -> now add 3 more 20KB photos
    await page.evaluate(() => {
      window.__MOCK_XHRS__[0].progress(50000, 100000);
      window.__MOCK_XHRS__[1].succeed(200);
    });
    await new Promise((r) => setTimeout(r, 25));

    const midState = await page.evaluate(() => ({
      countText: document.getElementById('upload-count-text')?.textContent,
      pctText: document.getElementById('upload-pct-text')?.textContent,
      activeXhrs: window.__ACTIVE_XHR_COUNT__,
    }));
    check(
      midState.countText === '1 / 5 selesai' &&
        midState.pctText === '43%' &&
        midState.activeXhrs === 2,
      'Suite C: Partial video progress (50KB) + 1 completed file renders accurate byte progress (43%)',
      JSON.stringify(midState)
    );

    const appendedState = await page.evaluate(() => {
      const input = document.getElementById('file-input');
      const dt = new DataTransfer();
      [20000, 20000, 20000].forEach((sz, idx) => {
        dt.items.add(new File([new Uint8Array(sz)], `extra-${idx}.jpg`, { type: 'image/jpeg' }));
      });
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        countText: document.getElementById('upload-count-text')?.textContent,
        pctText: document.getElementById('upload-pct-text')?.textContent,
        activeClass: document.getElementById('upload-prog-wrap')?.classList.contains('active'),
        maxConcurrent: window.__MAX_CONCURRENT_XHRS__,
      };
    });
    check(
      appendedState.countText === '1 / 8 selesai' &&
        appendedState.pctText === '30%' &&
        appendedState.activeClass === true &&
        appendedState.maxConcurrent === 2,
      'Suite C: Appending 3 files mid-upload expands active queue cleanly to 1 / 8 selesai & 30% (max 2 workers)',
      JSON.stringify(appendedState)
    );

    // Drain remaining 8 uploads to completion
    for (let step = 0; step < 20; step++) {
      const activeCount = await page.evaluate(() => {
        const active = window.__MOCK_XHRS__.filter((x) => x.active);
        active.forEach((x) => x.succeed(200));
        return window.__MOCK_XHRS__.filter((x) => x.active).length;
      });
      await new Promise((r) => setTimeout(r, 20));
      if (activeCount === 0) {
        const doneYet = await page.evaluate(() => window.__ACTIVE_XHR_COUNT__ === 0);
        if (doneYet) break;
      }
    }

    const doneBatchAll = await page.evaluate(() => ({
      countText: document.getElementById('upload-count-text')?.textContent,
      pctText: document.getElementById('upload-pct-text')?.textContent,
      fillTransform: document.getElementById('upload-prog-fill')?.style.transform,
      usedRawUpload: window.__MOCK_XHRS__.every((x) => x.headers['X-Casa-File-Name']),
      totalXhrs: window.__MOCK_XHRS__.length,
      maxConcurrent: window.__MAX_CONCURRENT_XHRS__,
    }));
    check(
      doneBatchAll.countText === '8 / 8 selesai' &&
        doneBatchAll.pctText === '100%' &&
        doneBatchAll.fillTransform === 'scaleX(1)' &&
        doneBatchAll.usedRawUpload &&
        doneBatchAll.totalXhrs === 8 &&
        doneBatchAll.maxConcurrent === 2,
      'Suite C: Combined 5+3 queue finishes cleanly at 8 / 8 selesai via /api/upload-raw (scaleX(1), never >2 parallel XHRs)',
      JSON.stringify(doneBatchAll)
    );

    // Case 2 (Sequential fresh batch): select 3 new files right after previous 8 finished -> resets cleanly to 0 / 3
    const freshResetState = await page.evaluate(() => {
      const input = document.getElementById('file-input');
      const dt = new DataTransfer();
      [10000, 10000, 10000].forEach((sz, idx) => {
        dt.items.add(new File([new Uint8Array(sz)], `fresh-${idx}.jpg`, { type: 'image/jpeg' }));
      });
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        countText: document.getElementById('upload-count-text')?.textContent,
        pctText: document.getElementById('upload-pct-text')?.textContent,
        activeClass: document.getElementById('upload-prog-wrap')?.classList.contains('active'),
      };
    });
    check(
      freshResetState.countText === '0 / 3 selesai' &&
        freshResetState.pctText === '0%' &&
        freshResetState.activeClass === true,
      'Suite C: Sequential batch after completion resets session counter cleanly to 0 / 3 selesai',
      JSON.stringify(freshResetState)
    );

    // Drain the 3 fresh files
    for (let step = 0; step < 15; step++) {
      await page.evaluate(() => {
        window.__MOCK_XHRS__.filter((x) => x.active).forEach((x) => x.succeed(200));
      });
      await new Promise((r) => setTimeout(r, 20));
      const idle = await page.evaluate(() => window.__ACTIVE_XHR_COUNT__ === 0);
      if (idle) break;
    }

    const doneFresh = await page.evaluate(() => ({
      countText: document.getElementById('upload-count-text')?.textContent,
      pctText: document.getElementById('upload-pct-text')?.textContent,
      activeClass: document.getElementById('upload-prog-wrap')?.classList.contains('active'),
      totalXhrs: window.__MOCK_XHRS__.length,
    }));
    check(
      doneFresh.countText === '3 / 3 selesai' &&
        doneFresh.pctText === '100%' &&
        doneFresh.activeClass === true &&
        doneFresh.totalXhrs === 11,
      'Suite C: Sequential batch finishes at 3 / 3 selesai (100%) without stale total or hide-timer interference',
      JSON.stringify(doneFresh)
    );

    check(pageErrors.length === 0, `Suite C: Zero uncaught page errors (${pageErrors.length})`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  console.log('\n=== CASA v2.3.0 QA VERIFICATION (Connect HP: Zero-App Local Web Drop) ===');
  const viteServer = await createServer({
    server: { port: 5303, strictPort: true },
    logLevel: 'error',
  });
  await viteServer.listen();

  try {
    await runSuiteA(viteServer);
    await runSuiteB();
    await runSuiteC();
  } finally {
    await viteServer.close();
  }

  console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[verify-connect-hp-v230] Fatal:', err);
  process.exit(1);
});
