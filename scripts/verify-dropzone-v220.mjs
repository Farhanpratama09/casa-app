/**
 * CASA v2.2.0 QA VERIFICATION: Dropzone 2.0 (Text & Link Transit, Sanitization,
 * Smart Drag-In, Explicit Ctrl+V, Native CF_UNICODETEXT Drag-Out & Ephemeral Lifecycle)
 */

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
  console.log('\n[Suite A] Sanitization, URI Security Guard & Source Invariants\n');

  const storageMap = new Map([
    [
      'casa_drop_zone_shelf_items_v1',
      JSON.stringify([
        {
          id: 'stale-1',
          type: 'text',
          title: 'Stale leftover',
          payload: 'Should be purged on boot',
          timestamp: Date.now() - 120_000,
        },
      ]),
    ],
  ]);

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
    sanitizeDropText,
    isBlockedUriScheme,
    parseSafeHttpUrl,
    extractUriListCandidate,
    extractAnchorFromHtml,
    parseDropContent,
    useDropZoneStore,
  } = await viteServer.ssrLoadModule('/src/stores/useDropZoneStore.ts');

  // 1. Stale seed purged automatically on ephemeral boot
  check(
    useDropZoneStore.getState().items.length === 0 &&
      storageMap.get('casa_drop_zone_shelf_items_v1') === '[]',
    'Ephemeral boot purges stale drop items older than fresh seed window'
  );

  // 2. Link auto-detection & readable domain/title preview
  const linkItem = parseDropContent('https://github.com/Farhanpratama09/casa-app');
  check(
    linkItem?.type === 'link' &&
      linkItem.domain === 'github.com' &&
      linkItem.title === 'casa-app' &&
      linkItem.displayUrl === 'github.com/Farhanpratama09/casa-app',
    'Auto-detects HTTPS link with domain and displayUrl metadata'
  );

  // Credential spoofing strip check
  const credParsed = parseSafeHttpUrl('https://evil-bank.com@github.com/login');
  check(
    Boolean(credParsed) &&
      credParsed.domain === 'github.com' &&
      !credParsed.displayUrl.includes('evil-bank'),
    'Strips embedded URL userinfo credentials from visible domain/displayUrl'
  );

  // 3. Multiline text detection
  const textItem = parseDropContent('Line 1\r\nLine 2\r\nLine 3');
  check(
    textItem?.type === 'text' && textItem.lineCount === 3 && (textItem.charCount || 0) > 10,
    'Auto-detects multiline plain text with accurate charCount and lineCount'
  );

  // 4. HTML tag & control/bidi sanitization
  const cleaned = sanitizeDropText("<script>alert(1)</script><b>Hello</b>\u202E <img onerror=x src=1>");
  check(
    cleaned === 'Hello' && !cleaned.includes('<script>') && !cleaned.includes('\u202E'),
    `Sanitizes HTML tags, scripts, and bidi control chars cleanly ("${cleaned}")`
  );

  // 5. URI List & Anchor extraction
  const uriCandidate = extractUriListCandidate('# Comment line\r\nhttps://casa-app.dev/changelog\r\nhttps://example.org');
  const anchor = extractAnchorFromHtml('<a href="https://casa-app.dev"><b>CASA</b> Web</a>');
  check(
    uriCandidate === 'https://casa-app.dev/changelog' &&
      anchor?.href === 'https://casa-app.dev' &&
      anchor?.label === 'CASA Web',
    'Extracts first valid URI from text/uri-list comments and sanitized label from text/html anchor'
  );

  // 6. Blocked dangerous URI schemes
  const dangerousInputs = [
    'javascript:alert(1)',
    '  JaVaScRiPt:void(0)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///C:/Windows/System32/cmd.exe',
  ];
  const allBlocked = dangerousInputs.every(
    (u) => isBlockedUriScheme(u) && parseDropContent(u) === null
  );
  check(
    allBlocked,
    'Rejects dangerous URI schemes (javascript:, data:, vbscript:, file://)'
  );

  // 7. User item add stays strictly ephemeral (not saved to localStorage) + 4s drag-out Undo
  const addedForUndo = await useDropZoneStore.getState().addItem('Quick note without disk leak');
  const persistedAfterAdd = storageMap.get('casa_drop_zone_shelf_items_v1');
  check(
    useDropZoneStore.getState().items.length === 1 &&
      (persistedAfterAdd === '[]' || persistedAfterAdd === undefined),
    'Added DropZone item stays strictly in RAM without persisting to localStorage'
  );
  if (addedForUndo) {
    useDropZoneStore.getState().recordDraggedOutItem(addedForUndo);
    useDropZoneStore.getState().removeItem(addedForUndo.id);
    const removedHasUndo =
      useDropZoneStore.getState().items.length === 0 &&
      useDropZoneStore.getState().lastDraggedOutItem?.id === addedForUndo.id;
    const restored = useDropZoneStore.getState().undoLastDraggedOut();
    check(
      removedHasUndo &&
        Boolean(restored) &&
        useDropZoneStore.getState().items.length === 1 &&
        useDropZoneStore.getState().lastDraggedOutItem === null,
      'In-memory drag-out Undo restores last removed item cleanly without localStorage'
    );
  }
  useDropZoneStore.getState().clearEphemeralSession();
  check(
    useDropZoneStore.getState().items.length === 0 &&
      useDropZoneStore.getState().lastDraggedOutItem === null,
    'clearEphemeralSession resets DropZone store and undo buffer cleanly'
  );

  // 8. Source & config invariants
  const tauriConf = JSON.parse(fs.readFileSync(path.resolve('src-tauri/tauri.conf.json'), 'utf8'));
  const mainWin = tauriConf.app.windows.find((w) => w.label === 'main');
  const dropZoneView = fs.readFileSync(path.resolve('src/components/views/DropZoneView.tsx'), 'utf8');
  const casaIsland = fs.readFileSync(path.resolve('src/components/CasaIsland.tsx'), 'utf8');
  const dropZoneRs = fs.readFileSync(path.resolve('src-tauri/src/drop_zone.rs'), 'utf8');
  const libRs = fs.readFileSync(path.resolve('src-tauri/src/lib.rs'), 'utf8');

  check(
    mainWin?.dragDropEnabled === false,
    'src-tauri/tauri.conf.json configures dragDropEnabled: false on main window'
  );

  check(
    !/setInterval[\s\S]{0,160}readClipboard|addEventListener\(['"]copy['"]/i.test(
      dropZoneView + casaIsland
    ) && !/e\.key\.toLowerCase\(\)\s*===\s*['"]c['"]/.test(dropZoneView),
    'Zero background Ctrl+C clipboard snooping or polling in DropZoneView / CasaIsland'
  );

  check(
    !/text-emerald-|text-green-|bg-emerald-|border-emerald-|#10B981/i.test(dropZoneView),
    'DropZoneView maintains Zero Color Leak on Monochrome theme'
  );

  check(
    dropZoneRs.includes('pub async fn native_drag_drop_text') &&
      dropZoneRs.includes('CF_UNICODETEXT') &&
      dropZoneRs.includes('pub fn stage_dropped_file') &&
      dropZoneRs.includes('pub fn cleanup_ephemeral_drop_zone') &&
      libRs.includes('drop_zone::native_drag_drop_text') &&
      libRs.includes('drop_zone::stage_dropped_file') &&
      libRs.includes('drop_zone::cleanup_ephemeral_drop_zone'),
    'Rust backend implements and registers CF_UNICODETEXT drag-out, ephemeral file staging, and cleanup'
  );
}

async function runSuiteB() {
  console.log('\n[Suite B] Real Chromium 1100x340 E2E (Smart Drag-In, Ctrl+V, CF_UNICODETEXT & Ephemeral)\n');

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
      window.__MOCK_TEXT_DRAG_OUT_MODE__ = 'cancelled';
      window.__MOCK_TEXT_DRAG_LOG__ = [];
      window.__MOCK_CLIPBOARD_TEXT__ = 'https://example.com/transit-note';
      window.__COPIED_TEXT_LOG__ = [];
      window.__OPEN_URL_CALLS__ = [];
      window.__FOCUS_ISLAND_CALLS__ = 0;
      window.__EVENT_LISTENERS__ = {};
      window.__EVENT_BY_NAME__ = {};

      try {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async (text) => {
              window.__COPIED_TEXT_LOG__.push(String(text));
            },
            readText: async () => window.__MOCK_CLIPBOARD_TEXT__,
          },
        });
      } catch {
        // Ignore if non-configurable
      }

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
            window.__HITBOX_EVENTS__.push({ t: Date.now(), rects: args?.rects || [] });
            return null;
          }
          if (cmd === 'read_clipboard_files') return [];
          if (cmd === 'read_clipboard_text') return window.__MOCK_CLIPBOARD_TEXT__;
          if (cmd === 'focus_island_window') {
            window.__FOCUS_ISLAND_CALLS__++;
            return null;
          }
          if (cmd === 'native_drag_drop_text') {
            const mode = window.__MOCK_TEXT_DRAG_OUT_MODE__;
            const text = args?.text || '';
            const entry = { text, mode, startedAt: Date.now(), settled: false };
            window.__MOCK_TEXT_DRAG_LOG__.push(entry);
            return await new Promise((resolve) => {
              setTimeout(() => {
                entry.settled = true;
                if (mode === 'dropped') {
                  const ce = document.getElementById('wa-chat-input');
                  const ta = document.getElementById('chromium-textarea');
                  const dt = new DataTransfer();
                  dt.setData('text/plain', text);
                  if (/^https?:\/\//i.test(text)) {
                    dt.setData('text/uri-list', text);
                  }
                  if (ce) {
                    ce.dispatchEvent(
                      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })
                    );
                  }
                  if (ta) {
                    ta.dispatchEvent(
                      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })
                    );
                  }
                }
                resolve(
                  mode === 'dropped'
                    ? { status: 'dropped', effect: 1 }
                    : { status: 'cancelled', effect: 0 }
                );
              }, 160);
            });
          }
          if (cmd === 'native_drag_drop_files') {
            return { status: 'cancelled', effect: 0 };
          }
          if (cmd === 'open_url_item') {
            window.__OPEN_URL_CALLS__.push(args?.url || '');
            return null;
          }
          if (cmd === 'cleanup_ephemeral_drop_zone') return null;
          if (cmd === 'get_autostart_enabled') return false;
          if (cmd === 'get_global_shortcut_status') return true;
          if (cmd === 'get_hardware_telemetry') return null;
          return null;
        },
      };

      if (!sessionStorage.getItem('__v220_booted')) {
        sessionStorage.setItem('__v220_booted', '1');
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
      }
    });

    await page.goto('http://127.0.0.1:5302', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-island-container="true"]', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 450));

    // Move away to ensure idle state
    await page.mouse.move(40, 250);
    await new Promise((r) => setTimeout(r, 200));

    // 1. Smart Drag-In from Idle with text/uri-list -> wakes into Drop Zone & drops link card
    const wakeDragResult = await page.evaluate(async () => {
      const dt = new DataTransfer();
      dt.setData('text/uri-list', 'https://casa-app.dev/docs');
      dt.setData('text/plain', 'https://casa-app.dev/docs');
      window.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
      window.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      await new Promise((r) => setTimeout(r, 180));
      const wokeDropZone = Boolean(document.querySelector('[data-dropzone-paste="true"]'));

      window.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      await new Promise((r) => setTimeout(r, 220));
      const linkCard = document.querySelector('[data-drop-item-type="link"]');
      return {
        wokeDropZone,
        linkCount: document.querySelectorAll('[data-drop-item-type="link"]').length,
        hasDomain: Boolean(linkCard?.textContent?.includes('casa-app.dev')),
        hasOpenBtn: Boolean(linkCard?.querySelector('button[title="Buka tautan di browser"]')),
        hasCopyBtn: Boolean(linkCard?.querySelector('button[title="Salin tautan"]')),
      };
    });
    check(
      wakeDragResult.wokeDropZone &&
        wakeDragResult.linkCount === 1 &&
        wakeDragResult.hasDomain &&
        wakeDragResult.hasOpenBtn &&
        wakeDragResult.hasCopyBtn,
      'Smart Drag-In wakes Idle capsule to Drop Zone and creates Link card with preview & actions',
      JSON.stringify(wakeDragResult)
    );

    // 2. Smart Drag-In Plain Text + Script Sanitization
    const textDragResult = await page.evaluate(async () => {
      const dt = new DataTransfer();
      dt.setData('text/plain', '<script>alert(1)</script>Meeting at 14:00');
      window.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      await new Promise((r) => setTimeout(r, 200));
      const textCard = document.querySelector('[data-drop-item-type="text"]');
      const txt = textCard?.textContent || '';
      return {
        textCount: document.querySelectorAll('[data-drop-item-type="text"]').length,
        hasSanitizedText: txt.includes('Meeting at 14:00'),
        hasScriptTag: txt.includes('<script>') || txt.includes('alert(1)'),
      };
    });
    check(
      textDragResult.textCount === 1 &&
        textDragResult.hasSanitizedText &&
        !textDragResult.hasScriptTag,
      'Smart Drag-In plain text strips <script> tags cleanly into TXT card',
      JSON.stringify(textDragResult)
    );

    // 3. Dangerous URI scheme blocked on drop
    const blockedDropResult = await page.evaluate(async () => {
      const dt = new DataTransfer();
      dt.setData('text/uri-list', 'javascript:alert(1)');
      window.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      await new Promise((r) => setTimeout(r, 180));
      return {
        totalCards: document.querySelectorAll('[data-drop-item-type]').length,
        hasNotice: Boolean(document.querySelector('[data-security-notice="true"]')),
      };
    });
    check(
      blockedDropResult.totalCards === 2 && blockedDropResult.hasNotice,
      'Dangerous javascript: URI drop is blocked cleanly with security notice banner',
      JSON.stringify(blockedDropResult)
    );

    // 4. Explicit Ctrl+V triggers clipboard read and adds link card
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyV');
    await page.keyboard.up('Control');
    await new Promise((r) => setTimeout(r, 260));

    const ctrlVResult = await page.evaluate(() => ({
      totalCards: document.querySelectorAll('[data-drop-item-type]').length,
      hasExampleCom: Boolean(document.body.innerText.includes('example.com')),
    }));
    check(
      ctrlVResult.totalCards === 3 && ctrlVResult.hasExampleCom,
      'Explicit Ctrl+V reads clipboard on demand and adds transit Link card',
      JSON.stringify(ctrlVResult)
    );

    // 4B. Single-click body of Link & Text cards copies payload with 'Tersalin' feedback (without opening browser)
    const linkBodyPoint = await page.evaluate(() => {
      window.__COPIED_TEXT_LOG__ = [];
      window.__OPEN_URL_CALLS__ = [];
      const cards = Array.from(document.querySelectorAll('[data-drop-item-type="link"]'));
      const card = cards.find((el) => el.textContent?.includes('casa-app.dev'));
      const rect = card?.getBoundingClientRect();
      return rect ? { x: rect.left + 44, y: rect.top + 32 } : null;
    });
    if (linkBodyPoint) {
      await page.mouse.click(linkBodyPoint.x, linkBodyPoint.y);
      await new Promise((r) => setTimeout(r, 140));
    }
    const textBodyPoint = await page.evaluate(() => {
      const card = document.querySelector('[data-drop-item-type="text"]');
      const rect = card?.getBoundingClientRect();
      return rect ? { x: rect.left + 44, y: rect.top + 32 } : null;
    });
    if (textBodyPoint) {
      await page.mouse.click(textBodyPoint.x, textBodyPoint.y);
      await new Promise((r) => setTimeout(r, 140));
    }
    const singleClickCopyAudit = await page.evaluate(() => {
      const openBtn = document.querySelector(
        '[data-drop-item-type="link"] button[title="Buka tautan di browser"]'
      );
      const openUrlsBeforeBtn = window.__OPEN_URL_CALLS__.length;
      if (openBtn instanceof HTMLElement) openBtn.click();
      return {
        copiedLog: window.__COPIED_TEXT_LOG__.slice(),
        hasCopiedBadge:
          document.body.innerText.includes('Tersalin') &&
          Boolean(document.querySelector('[data-copy-status="copied"]')),
        openUrlsBeforeBtn,
        openUrlsAfterBtn: window.__OPEN_URL_CALLS__.length,
      };
    });
    check(
      singleClickCopyAudit.copiedLog.includes('https://casa-app.dev/docs') &&
        singleClickCopyAudit.copiedLog.includes('Meeting at 14:00') &&
        singleClickCopyAudit.hasCopiedBadge &&
        singleClickCopyAudit.openUrlsBeforeBtn === 0 &&
        singleClickCopyAudit.openUrlsAfterBtn === 1,
      'Single-click on Link & Text card body copies payload ("Tersalin") while ExternalLink button opens browser',
      JSON.stringify(singleClickCopyAudit)
    );

    // 5. Native CF_UNICODETEXT Drag-Out (Cancelled vs Dropped)
    const targetCardBox = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-drop-item-type="link"]'));
      const card = cards.find((el) => el.textContent?.includes('example.com'));
      return card?.getBoundingClientRect().toJSON() || null;
    });
    check(Boolean(targetCardBox), 'Located link card bounding box for native text drag-out');

    if (targetCardBox) {
      const cx = targetCardBox.left + 28;
      const cy = targetCardBox.top + 28;

      // 5A. Cancelled -> stays parked, isInternalDragging suppresses external drag-over mid-flight
      await page.evaluate(() => {
        window.__MOCK_TEXT_DRAG_OUT_MODE__ = 'cancelled';
      });
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 24, cy + 24, { steps: 3 });
      await new Promise((r) => setTimeout(r, 50));

      const midDrag = await page.evaluate(() => {
        const dt = new DataTransfer();
        dt.setData('text/plain', 'should be ignored while dragging out');
        window.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
        const container = document.querySelector('[data-island-container="true"]');
        return {
          hasGlow: Boolean(container?.className?.includes('ring-1 ring-white/55')),
          logLen: window.__MOCK_TEXT_DRAG_LOG__.length,
          settled: window.__MOCK_TEXT_DRAG_LOG__.at(-1)?.settled,
          payload: window.__MOCK_TEXT_DRAG_LOG__.at(-1)?.text,
        };
      });
      await page.mouse.up();
      await new Promise((r) => setTimeout(r, 240));

      const afterCancel = await page.evaluate(() => ({
        hasExampleCom: document.body.innerText.includes('example.com'),
        settled: window.__MOCK_TEXT_DRAG_LOG__.at(-1)?.settled,
      }));

      check(
        midDrag.logLen === 1 &&
          midDrag.settled === false &&
          midDrag.hasGlow === false &&
          midDrag.payload === 'https://example.com/transit-note' &&
          afterCancel.settled === true &&
          afterCancel.hasExampleCom === true,
        'Cancelled CF_UNICODETEXT drag-out retains link card and blocks self drag-over mid-flight',
        JSON.stringify({ midDrag, afterCancel })
      );

      // 5B. Dropped -> auto-removes link card cleanly, delivers full text to <div contenteditable="true"> & <textarea> without stealing focus
      await page.evaluate(() => {
        window.__MOCK_TEXT_DRAG_OUT_MODE__ = 'dropped';
        window.__FOCUS_ISLAND_CALLS__ = 0;

        let ce = document.getElementById('wa-chat-input');
        if (!ce) {
          ce = document.createElement('div');
          ce.id = 'wa-chat-input';
          ce.setAttribute('contenteditable', 'true');
          ce.style.cssText = 'position:fixed;bottom:8px;left:12px;width:240px;height:28px;z-index:1;';
          ce.addEventListener('drop', (ev) => {
            ev.stopPropagation();
            ev.preventDefault();
            const droppedText =
              ev.dataTransfer?.getData('text/plain') ||
              ev.dataTransfer?.getData('text/uri-list') ||
              '';
            ce.textContent = droppedText;
          });
          document.body.appendChild(ce);
        }

        let ta = document.getElementById('chromium-textarea');
        if (!ta) {
          ta = document.createElement('textarea');
          ta.id = 'chromium-textarea';
          ta.style.cssText = 'position:fixed;bottom:8px;left:264px;width:240px;height:28px;z-index:1;';
          ta.addEventListener('drop', (ev) => {
            ev.stopPropagation();
            ev.preventDefault();
            const droppedText =
              ev.dataTransfer?.getData('text/plain') ||
              ev.dataTransfer?.getData('text/uri-list') ||
              '';
            ta.value = droppedText;
          });
          document.body.appendChild(ta);
        }

        ce.focus();
      });
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 26, cy + 26, { steps: 3 });
      await page.mouse.up();
      await new Promise((r) => setTimeout(r, 450));

      const afterDrop = await page.evaluate(() => ({
        logLen: window.__MOCK_TEXT_DRAG_LOG__.length,
        settled: window.__MOCK_TEXT_DRAG_LOG__.at(-1)?.settled,
        hasExampleComInShelf: Boolean(
          document.querySelector('[data-drop-item-type="link"]')?.textContent?.includes('example.com')
        ),
        lsRaw: localStorage.getItem('casa_drop_zone_shelf_items_v1'),
        contentEditableText: document.getElementById('wa-chat-input')?.textContent || '',
        textareaValue: document.getElementById('chromium-textarea')?.value || '',
        focusCallsDuringDrop: window.__FOCUS_ISLAND_CALLS__,
        activeElementId: document.activeElement?.id || '',
      }));

      check(
        afterDrop.logLen === 2 &&
          afterDrop.settled === true &&
          afterDrop.hasExampleComInShelf === false &&
          (afterDrop.lsRaw === null || afterDrop.lsRaw === '[]') &&
          afterDrop.contentEditableText === 'https://example.com/transit-note' &&
          afterDrop.textareaValue === 'https://example.com/transit-note' &&
          afterDrop.focusCallsDuringDrop === 0 &&
          afterDrop.activeElementId === 'wa-chat-input',
        'Accepted CF_UNICODETEXT drop delivers full text into <div contenteditable="true"> & <textarea> without stealing focus and auto-removes card',
        JSON.stringify(afterDrop)
      );

      // 5C. Compact 4s Undo banner restores dragged-out card immediately
      const undoClickedResult = await page.evaluate(async () => {
        const undoBtn = document.querySelector('[data-dropzone-undo="true"]');
        const undoLabel = undoBtn?.textContent?.trim() || '';
        const visibleBeforeClick = Boolean(undoBtn);
        if (undoBtn instanceof HTMLElement) {
          undoBtn.click();
        }
        await new Promise((r) => setTimeout(r, 200));
        return {
          visibleBeforeClick,
          undoLabel,
          undoGoneAfterClick: !document.querySelector('[data-dropzone-undo="true"]'),
          restoredInShelf: Array.from(
            document.querySelectorAll('[data-drop-item-type="link"]')
          ).some((el) => el.textContent?.includes('example.com')),
        };
      });
      check(
        undoClickedResult.visibleBeforeClick &&
          undoClickedResult.undoLabel.includes('Urungkan') &&
          undoClickedResult.undoGoneAfterClick &&
          undoClickedResult.restoredInShelf,
        '4s Undo pill restores dragged-out card back to DropZone shelf cleanly',
        JSON.stringify(undoClickedResult)
      );
    }

    // 6. Reload -> verify ephemeral session starts empty (0 leftover cards)
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-island-container="true"]', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 400));
    await page.click('[data-island-container="true"]');
    await new Promise((r) => setTimeout(r, 350));
    await page.evaluate(() => {
      const dzBtn = Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Drop Zone')
      );
      dzBtn?.click();
    });
    await new Promise((r) => setTimeout(r, 320));

    const postReload = await page.evaluate(() => ({
      cardCount: document.querySelectorAll('[data-drop-item-type]').length,
      hasEmptyPrompt: document.body.innerText.includes('Drop files, links, or text'),
    }));
    check(
      postReload.cardCount === 0 && postReload.hasEmptyPrompt,
      'Ephemeral session reload starts clean with zero leftover transit items',
      JSON.stringify(postReload)
    );

    check(pageErrors.length === 0, `Zero uncaught Chromium page errors (${pageErrors.length})`);
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log('\n=== CASA v2.2.0 QA VERIFICATION (Dropzone 2.0 Text & Link Transit) ===');
  const viteServer = await createServer({
    server: { port: 5302, strictPort: true },
    logLevel: 'error',
  });
  await viteServer.listen();

  try {
    await runSuiteA(viteServer);
    await runSuiteB();
  } finally {
    await viteServer.close();
  }

  console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[verify-dropzone-v220] Fatal:', err);
  process.exit(1);
});
