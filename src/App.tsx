import React, { useState, useEffect } from 'react';
import { CasaAudioProvider } from './context/CasaAudioContext';
import { CasaIsland } from './components/CasaIsland';
import { DevTriggerBar } from './components/views/DevTriggerBar';
import { IslandMode, CompactSubtype } from './types/island';
import { toggleGamingMode, playChimeCue } from './utils/tauriBridge';
import { initializeSkillsEngine } from './skills';

// Initialize CASA Universal Skills Engine
initializeSkillsEngine();

export function App() {
  const [mode, setMode] = useState<IslandMode>('idle');
  const [compactSubtype, setCompactSubtype] = useState<CompactSubtype>('charging');
  const [isGamingMode, setIsGamingMode] = useState<boolean>(false);
  const [showDevTrigger, setShowDevTrigger] = useState<boolean>(false);

  const handleToggleDevTrigger = () => {
    setShowDevTrigger((prev) => !prev);
  };

  // Global keyboard shortcuts (Escape to collapse back to idle, Ctrl+Shift+D or F2 to toggle DevTrigger)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMode('idle');
        playChimeCue('tap');
      } else if ((e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) || e.key === 'F2') {
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
          showDevTrigger={showDevTrigger}
          onToggleDevTrigger={handleToggleDevTrigger}
        />

        {/* Developer Trigger Bar flowing naturally under Island with clean flexbox */}
        {showDevTrigger && (
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

export default App;
