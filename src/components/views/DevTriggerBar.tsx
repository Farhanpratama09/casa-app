import React, { useRef } from 'react';
import { IslandMode, CompactSubtype } from '../../types/island';
import { playChimeCue } from '../../utils/tauriBridge';

interface DevTriggerBarProps {
  currentMode: IslandMode;
  compactSubtype: CompactSubtype;
  onSetMode: (mode: IslandMode, subtype?: CompactSubtype) => void;
  isGamingMode: boolean;
  onToggleGaming: () => void;
  onClose?: () => void;
  className?: string;
}

export const DevTriggerBar: React.FC<DevTriggerBarProps> = ({
  currentMode,
  compactSubtype,
  onSetMode,
  isGamingMode,
  onToggleGaming,
  onClose,
  className = '',
}) => {
  const devTriggerRef = useRef<HTMLElement>(null);

  const handleWheel = (e: React.WheelEvent<HTMLElement>) => {
    // Strictly isolate wheel listener: ONLY fire if cursor is directly on the Dev Trigger Bar
    if (e.currentTarget !== devTriggerRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    playChimeCue('tap');
    const order: IslandMode[] = [
      'idle',
      'dual_bubble',
      'compact_strip',
      'expanded_music',
      'expanded_timer',
      'expanded_todo',
      'drop_zone',
    ];
    const currentIndex = order.indexOf(currentMode);
    if (currentIndex === -1) {
      onSetMode('idle');
      return;
    }
    if (e.deltaY < 0) {
      const nextIndex = (currentIndex + 1) % order.length;
      onSetMode(order[nextIndex]);
    } else {
      const prevIndex = (currentIndex - 1 + order.length) % order.length;
      onSetMode(order[prevIndex]);
    }
  };

  const triggerItem = (
    label: string,
    mode: IslandMode,
    subtype?: CompactSubtype,
    isActive?: boolean
  ) => {
    return (
      <button
        onClick={() => {
          playChimeCue('tap');
          onSetMode(mode, subtype);
        }}
        className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-all ${
          isActive
            ? 'bg-white text-black font-semibold shadow-sm'
            : 'text-white/60 hover:text-white hover:bg-white/10'
        }`}
        title={`Switch state to: ${label}`}
      >
        {label}
      </button>
    );
  };

  return (
    <aside
      ref={devTriggerRef}
      onWheel={handleWheel}
      aria-label="Developer State Testing Controls"
      className={`mt-3 flex items-center justify-center gap-2 px-4 py-2 bg-neutral-900/90 backdrop-blur-md rounded-full border border-white/10 shadow-xl select-none max-w-full overflow-x-auto no-scrollbar pointer-events-auto ${className}`.trim()}
    >
      <span className="text-[9px] font-semibold tracking-wider text-island-secondary uppercase mr-1 border-r border-white/10 pr-2">
        DEV TRIGGER
      </span>

      {triggerItem('Idle', 'idle', undefined, currentMode === 'idle')}
      {triggerItem('Dual Bubble', 'dual_bubble', undefined, currentMode === 'dual_bubble')}
      {triggerItem(
        '⚡ Charge',
        'compact_strip',
        'charging',
        currentMode === 'compact_strip' && compactSubtype === 'charging'
      )}
      {triggerItem(
        '🎤 Mic Mute',
        'compact_strip',
        'mute_mic',
        currentMode === 'compact_strip' && compactSubtype === 'mute_mic'
      )}
      {triggerItem(
        '🔊 Volume',
        'compact_strip',
        'volume_hud',
        currentMode === 'compact_strip' && compactSubtype === 'volume_hud'
      )}
      {triggerItem('🎵 Music', 'expanded_music', undefined, currentMode === 'expanded_music')}
      {triggerItem('⏱ Timer', 'expanded_timer', undefined, currentMode === 'expanded_timer')}
      {triggerItem('✓ To-Do', 'expanded_todo', undefined, currentMode === 'expanded_todo')}
      {triggerItem('📦 Drop Zone', 'drop_zone', undefined, currentMode === 'drop_zone')}

      <div className="w-[1px] h-3 bg-white/20 mx-1" />

      <button
        onClick={() => {
          playChimeCue('tap');
          onToggleGaming();
        }}
        className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-all ${
          isGamingMode
            ? 'bg-island-green/20 text-island-green border border-island-green/40'
            : 'text-white/60 hover:text-white'
        }`}
        title="Toggle Gaming Mode (Auto-suspend UI)"
      >
        🎮 Game: {isGamingMode ? 'ON' : 'OFF'}
      </button>

      {onClose && (
        <>
          <div className="w-[1px] h-3 bg-white/20 mx-0.5" />
          <button
            onClick={() => {
              playChimeCue('tap');
              onClose();
            }}
            className="w-4 h-4 rounded-full bg-white/10 hover:bg-white/20 text-white/50 hover:text-white flex items-center justify-center text-[10px] transition-colors ml-0.5"
            title="Hide Dev Trigger Bar"
            aria-label="Hide Dev Trigger Bar"
          >
            ✕
          </button>
        </>
      )}
    </aside>
  );
};
