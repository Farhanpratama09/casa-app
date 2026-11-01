import React from 'react';
import {
  Zap,
  MicOff,
  Volume2,
  Calendar,
  Lock,
} from 'lucide-react';
import { CompactSubtype, HardwareMetrics } from '../../types/island';

interface CompactStripViewProps {
  subtype: CompactSubtype;
  metrics: HardwareMetrics;
}

export const CompactStripView: React.FC<CompactStripViewProps> = ({ subtype, metrics }) => {
  switch (subtype) {
    case 'charging':
      return (
        <div className="flex items-center justify-between w-full h-[38px] px-4 select-none">
          <div className="flex items-center gap-2 shrink-0">
            <Zap className="w-3.5 h-3.5 text-island-green shrink-0 fill-island-green/20" />
            <span className="text-[12px] font-medium text-white tracking-wide">
              {metrics.isCharging ? 'Charging' : 'Battery'}
            </span>
          </div>

          {/* Pure black empty space in middle */}
          <div className="flex-1" />

          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[12px] font-semibold text-island-green tabular-nums">
              {metrics.batteryPct}%
            </span>
            <div className="w-5 h-2.5 rounded-sm border border-island-green/60 p-[1px] flex items-center">
              <div
                className="h-full rounded-[1px] bg-island-green transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(5, metrics.batteryPct))}%` }}
              />
            </div>
          </div>
        </div>
      );

    case 'mute_mic':
      return (
        <div className="flex items-center justify-between w-full h-[38px] px-4 select-none">
          <div className="flex items-center gap-2 shrink-0">
            <span className="w-2 h-2 rounded-full bg-island-red animate-pulse shrink-0" />
            <span className="text-[12px] font-medium text-white">
              Microphone
            </span>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[12px] font-semibold text-island-red tracking-wide">
              MUTED
            </span>
            <MicOff className="w-3.5 h-3.5 text-island-red shrink-0" />
          </div>
        </div>
      );

    case 'volume_hud':
      return (
        <div className="flex items-center justify-between w-full h-[38px] px-4 select-none">
          <div className="flex items-center gap-2 shrink-0">
            <Volume2 className="w-3.5 h-3.5 text-island-blue shrink-0" />
            <span className="text-[12px] font-medium text-white">
              Volume
            </span>
          </div>

          {/* Volume bar in middle */}
          <div className="flex-1 mx-4 max-w-[120px] h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-island-blue rounded-full transition-all duration-150"
              style={{ width: `${metrics.volumePct}%` }}
            />
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[12px] font-medium text-island-blue tabular-nums">
              {metrics.volumePct}%
            </span>
          </div>
        </div>
      );

    case 'calendar_peek':
      return (
        <div className="flex items-center justify-between w-full h-[38px] px-4 select-none">
          <div className="flex items-center gap-2 shrink-0 min-w-0">
            <Calendar className="w-3.5 h-3.5 text-white/90 shrink-0" />
            <span className="text-[12px] font-medium text-white truncate max-w-[160px]">
              Design System Review
            </span>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[11px] text-island-secondary font-medium">in</span>
            <span className="text-[12px] font-semibold text-white tabular-nums">
              15m
            </span>
          </div>
        </div>
      );

    case 'caps_lock':
      return (
        <div className="flex items-center justify-between w-full h-[38px] px-4 select-none">
          <div className="flex items-center gap-2 shrink-0">
            <Lock className="w-3.5 h-3.5 text-island-secondary shrink-0" />
            <span className="text-[12px] font-medium text-white">
              Caps Lock
            </span>
          </div>

          <div className="flex-1" />

          <span className="text-[11px] font-semibold text-white/80 shrink-0">
            ON
          </span>
        </div>
      );

    default:
      return null;
  }
};
