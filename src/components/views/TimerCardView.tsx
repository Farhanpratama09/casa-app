import React from 'react';
import { Play, Pause, RotateCcw } from 'lucide-react';
import { TimerState } from '../../types/island';
import { playChimeCue } from '../../utils/tauriBridge';

interface TimerCardViewProps {
  timer: TimerState;
  onToggleTimer: () => void;
  onResetTimer: () => void;
  onSelectPreset: (minutes: number, mode: 'focus' | 'rest' | 'break') => void;
  onAdjustMinutes?: (delta: number) => void;
}

export const TimerCardView: React.FC<TimerCardViewProps> = ({
  timer,
  onToggleTimer,
  onResetTimer,
  onSelectPreset,
}) => {
  // Format MM & SS terpisah untuk animasi denyut titik dua (pulsing colon)
  const mins = Math.floor(timer.remainingSeconds / 60);
  const secs = Math.floor(timer.remainingSeconds % 60);
  const minsStr = mins < 10 ? `0${mins}` : `${mins}`;
  const secsStr = secs < 10 ? `0${secs}` : `${secs}`;

  const isRunning = timer.isActive && !timer.isPaused;
  const isFinished = timer.totalSeconds > 0 && timer.remainingSeconds === 0;

  // Kalkulasi Geometri Orbit Melingkar (R = 44px, Center = 56px, Canvas = 112px)
  const radius = 44;
  const circumference = 2 * Math.PI * radius; // ~276.46px
  const progressPercent =
    timer.totalSeconds > 0
      ? Math.min(
          100,
          Math.max(
            0,
            ((timer.totalSeconds - timer.remainingSeconds) / timer.totalSeconds) * 100
          )
        )
      : 0;
  const strokeDashoffset = circumference - (progressPercent / 100) * circumference;

  // Kalkulasi Sudut & Koordinat Lunar Node (Titik Pendar Kelinci Orbit)
  // Sudut berputar searah jarum jam dari jam 12 (-pi/2)
  const fraction =
    timer.totalSeconds > 0
      ? (timer.totalSeconds - timer.remainingSeconds) / timer.totalSeconds
      : 0;
  const angle = -Math.PI / 2 + fraction * (2 * Math.PI);
  const nodeX = 56 + radius * Math.cos(angle);
  const nodeY = 56 + radius * Math.sin(angle);

  return (
    <div className="w-full max-w-[620px] px-5 py-2 select-none h-[140px] flex items-center relative overflow-hidden">
      {/* =================================================================== */}
      {/* Background Cosmic Galaxy: Nebula Radial Glow + Stardust Dust        */}
      {/* =================================================================== */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        {/* Violet-Indigo Deep Nebula di Sudut Kanan Atas */}
        <div
          className="absolute -top-12 -right-8 w-[260px] h-[170px] rounded-full opacity-20 blur-3xl"
          style={{
            background: 'radial-gradient(circle, rgba(99, 102, 241, 0.45) 0%, rgba(125, 211, 252, 0.15) 55%, transparent 80%)',
          }}
        />
        {/* Soft Lunar Ice Dust di Sudut Kiri Bawah */}
        <div
          className="absolute -bottom-10 -left-10 w-[220px] h-[150px] rounded-full opacity-18 blur-2xl"
          style={{
            background: 'radial-gradient(circle, rgba(125, 211, 252, 0.3) 0%, rgba(129, 140, 248, 0.12) 60%, transparent 80%)',
          }}
        />

        {/* Stardust SVG Constellation Particles (Transparan ~15-20%) */}
        <svg className="absolute inset-0 w-full h-full opacity-20" xmlns="http://www.w3.org/2000/svg">
          {/* Micro stars with gentle cosmic twinkle */}
          <circle cx="50" cy="24" r="0.8" fill="#7DD3FC" opacity="0.6" />
          <circle cx="105" cy="118" r="0.6" fill="#F8FAFC" opacity="0.4" />
          <circle cx="150" cy="28" r="1.1" fill="#818CF8" opacity="0.7" />
          <circle cx="225" cy="20" r="0.7" fill="#7DD3FC" opacity="0.5" />
          <circle cx="280" cy="85" r="0.9" fill="#F8FAFC" opacity="0.35" />
          <circle cx="345" cy="24" r="1.0" fill="#7DD3FC" opacity="0.75" />
          <circle cx="410" cy="122" r="0.6" fill="#818CF8" opacity="0.5" />
          <circle cx="465" cy="32" r="0.8" fill="#F8FAFC" opacity="0.45" />
          <circle cx="525" cy="92" r="1.0" fill="#7DD3FC" opacity="0.6" />
          <circle cx="575" cy="22" r="0.7" fill="#818CF8" opacity="0.5" />
          <circle cx="600" cy="112" r="0.8" fill="#7DD3FC" opacity="0.4" />
          {/* Subtle constellation line traces */}
          <path
            d="M150 28 L225 20 L345 24 M465 32 L525 92"
            stroke="rgba(125, 211, 252, 0.12)"
            strokeWidth="0.6"
            strokeDasharray="2 3"
            fill="none"
          />
        </svg>
      </div>

      {/* 2-Column Tactical Lunar Deck */}
      <div className="flex items-center gap-5 w-full h-full relative z-10">
        {/* =================================================================== */}
        {/* LEFT COLUMN (~160px): The Lunar Orbit Dial                         */}
        {/* =================================================================== */}
        <div className="flex items-center justify-center w-[160px] shrink-0 border-r border-white/[0.06] pr-4 h-full relative">
          <div className="relative w-[112px] h-[112px] flex items-center justify-center">
            {/* SVG Orbit Rings & Node */}
            <svg className="w-full h-full -rotate-90 overflow-visible" viewBox="0 0 112 112">
              <defs>
                <linearGradient id="lunarIceGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#7DD3FC" />
                  <stop offset="60%" stopColor="#38BDF8" />
                  <stop offset="100%" stopColor="#818CF8" />
                </linearGradient>
                <filter id="lunarGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="2.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Orbit Celestial Track Luar (Dotted Guideline) */}
              <circle
                cx="56"
                cy="56"
                r="50"
                stroke="rgba(125, 211, 252, 0.12)"
                strokeWidth="1"
                strokeDasharray="2 5"
                fill="none"
              />

              {/* Base Orbit Track */}
              <circle
                cx="56"
                cy="56"
                r={radius}
                stroke="rgba(255, 255, 255, 0.06)"
                strokeWidth="2.5"
                fill="none"
              />

              {/* Progress Arc Bercahaya (Gradien Ice Blue ke Lunar Indigo) */}
              <circle
                cx="56"
                cy="56"
                r={radius}
                stroke="url(#lunarIceGrad)"
                strokeWidth="2.5"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                fill="none"
                filter={isRunning ? 'url(#lunarGlow)' : undefined}
                className="transition-all duration-300"
              />

              {/* Lunar Node (Satelit Pendar Orbit) */}
              {timer.totalSeconds > 0 && (
                <circle
                  cx={nodeX}
                  cy={nodeY}
                  r="3.5"
                  fill="#F8FAFC"
                  stroke="#7DD3FC"
                  strokeWidth="1.2"
                  className={isRunning ? 'animate-pulse' : ''}
                  style={{
                    filter: 'drop-shadow(0 0 5px #7DD3FC)',
                  }}
                />
              )}
            </svg>

            {/* Konten Inti Orbit: Countdown Digital (Lunar Silver) + Siluet Kelinci */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              {/* Angka Timer (Urbanist Font, Starlight Pearl / Lunar Silver) */}
              <div
                className={`text-[18px] font-urbanist font-bold tracking-wider leading-none text-[#F8FAFC] flex items-center tabular-nums ${
                  isFinished ? 'text-sky-200 animate-pulse' : ''
                }`}
                style={{
                  fontFamily: "'Urbanist', sans-serif",
                  fontVariantNumeric: 'tabular-nums',
                  filter: isRunning ? 'drop-shadow(0 0 8px rgba(125,211,252,0.25))' : 'none',
                }}
              >
                <span>{minsStr}</span>
                <span
                  className={`mx-0.5 transition-opacity ${
                    isRunning ? 'animate-pulse text-[#7DD3FC]' : 'text-white/40'
                  }`}
                >
                  :
                </span>
                <span>{secsStr}</span>
              </div>

              {/* Siluet Geometris Telinga Kelinci Stealth (Subtle Minimalist Vector) */}
              <div className="mt-1 flex items-center justify-center opacity-50">
                <svg className="w-[14px] h-[8px] text-[#7DD3FC] fill-current" viewBox="0 0 24 14">
                  <path
                    d="M7 13 C6 8, 4 3, 2 0 C5 2, 8 7, 9 13 Z"
                    fill="currentColor"
                    opacity="0.85"
                  />
                  <path
                    d="M17 13 C18 8, 20 3, 22 0 C19 2, 16 7, 15 13 Z"
                    fill="currentColor"
                    opacity="0.85"
                  />
                  <circle cx="12" cy="12" r="2" fill="currentColor" opacity="0.6" />
                </svg>
              </div>

              {/* Persentase Orbit */}
              <span className="text-[7.5px] font-mono text-white/40 mt-0.5 tabular-nums">
                {Math.round(progressPercent)}%
              </span>
            </div>

            {/* Lunar Bloom Pulse saat Timer Selesai (00:00) */}
            {isFinished && (
              <div className="absolute inset-0 rounded-full border-2 border-[#7DD3FC]/60 animate-ping pointer-events-none" />
            )}
          </div>
        </div>

        {/* =================================================================== */}
        {/* RIGHT COLUMN (Flex-1): Minimalist Deck & Zero-Text Action Controls */}
        {/* =================================================================== */}
        <div className="flex flex-col justify-between flex-1 min-w-0 h-full py-1">
          {/* Header Row: Hanya 4 Titik Fase Siklus Bulan di Pojok Kanan Atas */}
          <div className="flex items-center justify-end w-full pt-0.5">
            <div className="flex items-center gap-1.5" title={`Fase Siklus ${timer.currentCycle} / 4`}>
              {[1, 2, 3, 4].map((step) => {
                const isDone = step < timer.currentCycle;
                const isCurrent = step === timer.currentCycle;
                return (
                  <div
                    key={step}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      isDone
                        ? 'w-1.5 bg-[#7DD3FC] shadow-[0_0_6px_rgba(125,211,252,0.35)]'
                        : isCurrent
                        ? 'w-3.5 bg-gradient-to-r from-[#7DD3FC] to-[#818CF8] shadow-[0_0_8px_rgba(125,211,252,0.35)] animate-pulse'
                        : 'w-1.5 bg-white/[0.1]'
                    }`}
                  />
                );
              })}
            </div>
          </div>

          {/* Preset Pills Khas Kelinci Bulan (Menyatu Kosmik, Urbanist Font) */}
          <div className="grid grid-cols-3 gap-2 w-full my-auto">
            {/* Preset 1: 5m Hop (Rest) */}
            <button
              onClick={() => {
                playChimeCue('tap');
                onSelectPreset(5, 'rest');
              }}
              style={{ fontFamily: "'Urbanist', sans-serif" }}
              className={`py-1.5 px-2 rounded-xl text-[11px] font-urbanist flex items-center justify-center gap-1.5 transition-all cursor-pointer border ${
                timer.totalSeconds === 5 * 60 && timer.mode === 'rest'
                  ? 'bg-[#7DD3FC]/12 text-[#F8FAFC] border-[#7DD3FC]/35 shadow-[0_0_10px_rgba(125,211,252,0.2)] font-semibold'
                  : 'bg-white/[0.02] text-white/50 border-white/[0.08] hover:bg-white/[0.06] hover:text-white/80'
              }`}
            >
              <svg className="w-3 h-3 text-sky-300 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                <path d="M9.5 2C5.9 2 3 4.9 3 8.5s2.9 6.5 6.5 6.5c1.4 0 2.7-.4 3.7-1.2-2.8-.2-5-2.6-5-5.3 0-2.7 2.2-5.1 5-5.3C12.2 2.4 10.9 2 9.5 2z" />
              </svg>
              <span className="tracking-wide">5m Hop</span>
            </button>

            {/* Preset 2: 25m Focus */}
            <button
              onClick={() => {
                playChimeCue('tap');
                onSelectPreset(25, 'focus');
              }}
              style={{ fontFamily: "'Urbanist', sans-serif" }}
              className={`py-1.5 px-2 rounded-xl text-[11px] font-urbanist flex items-center justify-center gap-1.5 transition-all cursor-pointer border ${
                timer.totalSeconds === 25 * 60 && timer.mode === 'focus'
                  ? 'bg-[#7DD3FC]/12 text-[#F8FAFC] border-[#7DD3FC]/35 shadow-[0_0_10px_rgba(125,211,252,0.2)] font-semibold'
                  : 'bg-white/[0.02] text-white/50 border-white/[0.08] hover:bg-white/[0.06] hover:text-white/80'
              }`}
            >
              <svg className="w-3 h-3 text-sky-300 shrink-0" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
                <path d="M8 2 A6 6 0 0 1 8 14 Z" fill="currentColor" />
              </svg>
              <span className="tracking-wide">25m Focus</span>
            </button>

            {/* Preset 3: 50m Orbit */}
            <button
              onClick={() => {
                playChimeCue('tap');
                onSelectPreset(50, 'focus');
              }}
              style={{ fontFamily: "'Urbanist', sans-serif" }}
              className={`py-1.5 px-2 rounded-xl text-[11px] font-urbanist flex items-center justify-center gap-1.5 transition-all cursor-pointer border ${
                timer.totalSeconds === 50 * 60 && timer.mode === 'focus'
                  ? 'bg-[#7DD3FC]/12 text-[#F8FAFC] border-[#7DD3FC]/35 shadow-[0_0_10px_rgba(125,211,252,0.2)] font-semibold'
                  : 'bg-white/[0.02] text-white/50 border-white/[0.08] hover:bg-white/[0.06] hover:text-white/80'
              }`}
            >
              <svg className="w-3 h-3 text-sky-300 shrink-0" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2" opacity="0.6" />
                <circle cx="8" cy="8" r="4" fill="currentColor" />
              </svg>
              <span className="tracking-wide">50m Orbit</span>
            </button>
          </div>

          {/* Action Controls Row: Play/Pause Glassmorphism Lingkaran (Zero Text) + Reset */}
          <div className="flex items-center gap-2.5 pt-0.5">
            {/* Tombol Utama: Play / Pause Glassmorphism Circle */}
            <button
              onClick={() => {
                playChimeCue('tap');
                onToggleTimer();
              }}
              className="w-8 h-8 rounded-full bg-[#7DD3FC]/12 hover:bg-[#7DD3FC]/20 border border-[#7DD3FC]/35 text-[#F8FAFC] shadow-[0_0_12px_rgba(125,211,252,0.2)] flex items-center justify-center active:scale-95 transition-all cursor-pointer"
              title={isRunning ? 'Pause Orbit' : 'Mulai Orbit'}
              aria-label={isRunning ? 'Pause Orbit' : 'Mulai Orbit'}
            >
              {isRunning ? (
                <Pause className="w-3.5 h-3.5 fill-current shrink-0" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current ml-0.5 shrink-0" />
              )}
            </button>

            {/* Tombol Reset Glass Circle */}
            <button
              onClick={() => {
                playChimeCue('tap');
                onResetTimer();
              }}
              className="w-8 h-8 rounded-full bg-white/[0.03] hover:bg-white/[0.07] text-white/50 hover:text-[#7DD3FC] border border-white/[0.08] hover:border-[#7DD3FC]/30 flex items-center justify-center active:scale-95 transition-all cursor-pointer"
              title="Reset Orbit"
              aria-label="Reset Orbit"
            >
              <RotateCcw className="w-3.5 h-3.5 shrink-0" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
