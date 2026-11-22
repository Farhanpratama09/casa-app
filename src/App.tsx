import React, { Suspense, useState, useEffect, useLayoutEffect } from 'react';
import { CasaAudioProvider } from './context/CasaAudioContext';
import { CasaIsland } from './components/CasaIsland';
import { DevTriggerBar } from './components/views/DevTriggerBar';
import { IslandMode, CompactSubtype } from './types/island';
import { toggleGamingMode, playChimeCue } from './utils/tauriBridge';
import { getCurrentWindowLabel } from './utils/settingsWindow';
import { initializeSkillsEngine } from './skills';
import { startPrayerSchedulerEngine } from './features/ibadah/prayerStore';

const DesktopSettingsWindow = React.lazy(() =>
  import('./components/settings/DesktopSettingsWindow').then((mod) => ({
    default: mod.DesktopSettingsWindow,
  }))
);

const IS_SETTINGS_WINDOW = getCurrentWindowLabel() === 'settings';

// Initialize CASA Universal Skills Engine ONLY in main island window
if (!IS_SETTINGS_WINDOW) {
  initializeSkillsEngine();
}

function MainIslandApp() {
  const [mode, setMode] = useState<IslandMode>('idle');
  const [compactSubtype, setCompactSubtype] = useState<CompactSubtype>('charging');
  const [isGamingMode, setIsGamingMode] = useState<boolean>(false);
  const [showDevTrigger, setShowDevTrigger] = useState<boolean>(false);

  // Start single Prayer Scheduler Engine ONLY in main island window (0 background work when ibadah.enabled === false)
  useEffect(() => {
    return startPrayerSchedulerEngine();
  }, []);

  const handleToggleDevTrigger = () => {
    if (!import.meta.env.DEV) return;
    setShowDevTrigger((prev) => !prev);
  };

  // Global keyboard shortcuts (Escape to collapse back to idle, Ctrl+Shift+D in dev mode to toggle DevTrigger)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMode('idle');
        playChimeCue('tap');
      } else if (
        import.meta.env.DEV &&
        e.ctrlKey &&
        e.shiftKey &&
        (e.key === 'D' || e.key === 'd')
      ) {
        e.preventDefault();
        playChimeCue('tap');
        handleToggleDevTrigger();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSetMode = (newMode: IslandMode, subtype?: CompactSubtype) => {
    setMode(newMode);
    if (subtype) {
      setCompactSubtype(subtype);
    }
  };

  const handleToggleGaming = async () => {
    const nextVal = !isGamingMode;
    setIsGamingMode(nextVal);
    await toggleGamingMode(nextVal);
    if (nextVal) {
      playChimeCue('whisper');
      setMode('idle'); // Automatically collapse in gaming mode
    }
  };

  return (
    <CasaAudioProvider>
      <main className="relative w-screen h-screen overflow-hidden bg-transparent flex flex-col items-center pointer-events-none">
        {/* Dynamic Floating Island Centered at Top */}
        <CasaIsland
          mode={mode}
          compactSubtype={compactSubtype}
          onChangeMode={handleSetMode}
          isGamingMode={isGamingMode}
          showDevTrigger={import.meta.env.DEV ? showDevTrigger : false}
          onToggleDevTrigger={import.meta.env.DEV ? handleToggleDevTrigger : undefined}
        />

        {/* Developer Trigger Bar: strictly dev-only (stripped from production builds) */}
        {import.meta.env.DEV && showDevTrigger && (
          <DevTriggerBar
            currentMode={mode}
            compactSubtype={compactSubtype}
            onSetMode={handleSetMode}
            isGamingMode={isGamingMode}
            onToggleGaming={handleToggleGaming}
            onClose={handleToggleDevTrigger}
          />
        )}
      </main>
    </CasaAudioProvider>
  );
}

export function App() {
  useLayoutEffect(() => {
    if (IS_SETTINGS_WINDOW) {
      document.documentElement.setAttribute('data-casa-window', 'settings');
      document.title = 'CASA Settings';
    } else {
      document.documentElement.removeAttribute('data-casa-window');
    }
  }, []);

  if (IS_SETTINGS_WINDOW) {
    return (
      <Suspense fallback={<div className="w-screen h-screen bg-[#070708]" />}>
        <DesktopSettingsWindow />
      </Suspense>
    );
  }

  return <MainIslandApp />;
}

export default App;
