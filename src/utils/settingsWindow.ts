import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow, WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { emit } from '@tauri-apps/api/event';

export type SettingsSectionTarget = 'appearance' | 'behavior' | 'audio' | 'ibadah' | 'system';

export const SETTINGS_DEEP_LINK_STORAGE_KEY = 'casa_settings_deep_link_v1';
export const SETTINGS_NAVIGATE_EVENT = 'casa://settings-navigate';

// Must stay 1:1 with `app.windows[main].additionalBrowserArgs` in `src-tauri/tauri.conf.json`
// so Windows WebView2 shares the same environment & User Data Folder (localStorage + IndexedDB).
const SHARED_WEBVIEW_BROWSER_ARGS =
  '--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required';

const VALID_SECTIONS = new Set<SettingsSectionTarget>([
  'appearance',
  'behavior',
  'audio',
  'ibadah',
  'system',
]);

const isTauriRuntime = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function isValidSettingsSection(value: unknown): value is SettingsSectionTarget {
  return typeof value === 'string' && VALID_SECTIONS.has(value as SettingsSectionTarget);
}

export function consumePendingSettingsDeepLink(): SettingsSectionTarget | null {
  if (typeof window === 'undefined') return null;

  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('section');
    if (isValidSettingsSection(fromQuery)) {
      return fromQuery;
    }
  } catch {
    // Ignore malformed query string
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_DEEP_LINK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { section?: unknown; ts?: unknown };
    window.localStorage.removeItem(SETTINGS_DEEP_LINK_STORAGE_KEY);
    if (
      isValidSettingsSection(parsed?.section) &&
      typeof parsed?.ts === 'number' &&
      Date.now() - parsed.ts <= 10_000
    ) {
      return parsed.section;
    }
  } catch {
    // Non-fatal
  }

  return null;
}

export function getCurrentWindowLabel(): string {
  if (!isTauriRuntime()) {
    return 'main';
  }
  try {
    return getCurrentWebviewWindow().label;
  } catch {
    return 'main';
  }
}

let pendingSettingsOpen: Promise<void> | null = null;

/**
 * Opens or focuses the dedicated non-transparent CASA Settings desktop window (`settings`, 760x520).
 * Optional `section` deep-links directly to the requested sidebar tab whether freshly created or already open.
 */
export async function openDesktopSettingsWindow(section?: SettingsSectionTarget): Promise<void> {
  if (typeof window !== 'undefined' && section && isValidSettingsSection(section)) {
    try {
      window.localStorage.setItem(
        SETTINGS_DEEP_LINK_STORAGE_KEY,
        JSON.stringify({ section, ts: Date.now() })
      );
    } catch {
      // Non-fatal
    }
  }

  if (!isTauriRuntime()) {
    console.info(
      '[CASA] Settings desktop window is only available inside the Tauri runtime.',
      section ? `(section=${section})` : ''
    );
    return;
  }

  if (pendingSettingsOpen) {
    await pendingSettingsOpen;
    if (section && isValidSettingsSection(section)) {
      void emit(SETTINGS_NAVIGATE_EVENT, { section }).catch(() => {});
    }
    return;
  }

  const validSection = section && isValidSettingsSection(section) ? section : undefined;

  pendingSettingsOpen = (async () => {
    try {
      try {
        await invoke('open_settings_window', { section: validSection ?? null });
        return;
      } catch (rustErr) {
        console.warn('[CASA] open_settings_window IPC failed, falling back to JS WebviewWindow:', rustErr);
      }

      const existing = await WebviewWindow.getByLabel('settings');
      if (existing) {
        if (validSection) {
          await emit(SETTINGS_NAVIGATE_EVENT, { section: validSection }).catch(() => {});
        }
        await existing.unminimize().catch(() => {});
        await existing.show();
        await existing.setFocus();
        return;
      }

      const targetUrl = validSection
        ? `index.html?section=${encodeURIComponent(validSection)}`
        : 'index.html';

      const fallbackOptions: ConstructorParameters<typeof WebviewWindow>[1] & {
        additionalBrowserArgs?: string;
      } = {
        url: targetUrl,
        title: 'CASA Settings',
        width: 760,
        height: 520,
        resizable: false,
        decorations: false,
        transparent: false,
        center: true,
        focus: true,
        alwaysOnTop: false,
        skipTaskbar: false,
        shadow: true,
        additionalBrowserArgs: SHARED_WEBVIEW_BROWSER_ARGS,
        backgroundColor: [0, 0, 0, 255],
      };

      const settingsWin = new WebviewWindow('settings', fallbackOptions);

      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };

        void settingsWin.once('tauri://created', () => {
          void settingsWin.show().catch(() => {});
          void settingsWin.setFocus().catch(() => {});
          if (validSection) {
            setTimeout(() => {
              void emit(SETTINGS_NAVIGATE_EVENT, { section: validSection }).catch(() => {});
            }, 180);
          }
          finish();
        });

        void settingsWin.once('tauri://error', (err) => {
          console.error('[CASA] Failed to create settings window:', err);
          finish();
        });

        setTimeout(finish, 2500);
      });
    } catch (err) {
      console.error('[CASA] openDesktopSettingsWindow failed:', err);
    } finally {
      pendingSettingsOpen = null;
    }
  })();

  return pendingSettingsOpen;
}
