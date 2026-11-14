import { getCurrentWebviewWindow, WebviewWindow } from '@tauri-apps/api/webviewWindow';

const isTauriRuntime = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

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
 */
export async function openDesktopSettingsWindow(): Promise<void> {
  if (!isTauriRuntime()) {
    console.info('[CASA] Settings desktop window is only available inside the Tauri runtime.');
    return;
  }

  if (pendingSettingsOpen) {
    return pendingSettingsOpen;
  }

  pendingSettingsOpen = (async () => {
    try {
      const existing = await WebviewWindow.getByLabel('settings');
      if (existing) {
        await existing.unminimize().catch(() => {});
        await existing.show();
        await existing.setFocus();
        return;
      }

      const settingsWin = new WebviewWindow('settings', {
        url: '/',
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
        backgroundColor: [0, 0, 0, 255],
      });

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
