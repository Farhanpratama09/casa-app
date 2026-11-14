import React from 'react';
import { Zap } from 'lucide-react';
import { BatteryTelemetry } from '../../hooks/useSystemTelemetry';

export interface BatteryPillProps {
  battery: BatteryTelemetry;
  showPercentage?: boolean;
  statusLabel?: boolean;
  className?: string;
}

const STATUS_TEXT: Record<BatteryTelemetry['status'], string> = {
  charging: 'Charging',
  plugged_in: 'Plugged In',
  low: 'Low',
  normal: 'On Battery',
};

/**
 * OLED horizontal battery capsule (22x11px):
 * - is_plugged_in (charging or plugged_in): emerald #10B981 fill with centered Zap icon
 * - normal (unplugged, > 20%): clean emerald #10B981 fill without icon
 * - low (unplugged, <= 20%): coral red #EF4444 fill with animate-pulse
 */
export const BatteryPill: React.FC<BatteryPillProps> = ({
  battery,
  showPercentage = true,
  statusLabel = false,
  className = '',
}) => {
  if (!battery.has_battery) {
    return null;
  }

  const clamped = Math.max(0, Math.min(100, Math.round(battery.percent)));
  const fillWidth = clamped <= 0 ? 0 : Math.max(12, clamped);

  const isPluggedIn = battery.is_plugged_in;
  const isLow = !isPluggedIn && (battery.status === 'low' || clamped <= 20);

  const fillClass = isLow
    ? 'bg-[#EF4444] animate-pulse'
    : isPluggedIn
    ? 'bg-[#10B981] shadow-[0_0_6px_rgba(16,185,129,0.5)]'
    : 'bg-[#10B981]';

  const borderClass = isLow
    ? 'border-red-400/55'
    : isPluggedIn
    ? 'border-emerald-300/45'
    : 'border-white/35';

  const nubClass = isLow
    ? 'bg-red-400/55'
    : isPluggedIn
    ? 'bg-emerald-300/45'
    : 'bg-white/35';

  const textColorClass = isLow
    ? 'text-red-400'
    : isPluggedIn
    ? 'text-emerald-300'
    : 'text-white/85';

  const tooltipLabel = `${clamped}% · ${STATUS_TEXT[battery.status]}`;

  return (
    <div
      className={`inline-flex items-center gap-1.5 select-none shrink-0 ${className}`}
      title={tooltipLabel}
      aria-label={`Battery ${tooltipLabel}`}
    >
      {/* Horizontal 22x11px OLED Battery Capsule + Right Nub */}
      <div className="inline-flex items-center gap-[1px] shrink-0">
        <div
          className={`relative w-[22px] h-[11px] rounded-[3px] border ${borderClass} bg-black/95 p-[1.5px] flex items-center overflow-hidden`}
        >
          <div className="relative w-full h-full rounded-[1.5px] bg-white/[0.08] overflow-hidden">
            <div
              className={`h-full rounded-[1px] transition-[width,background-color] duration-300 ease-out ${fillClass}`}
              style={{ width: `${fillWidth}%` }}
            />
          </div>

          {isPluggedIn && (
            <Zap
              className="absolute inset-0 m-auto w-[8px] h-[8px] text-white fill-white drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.95)] pointer-events-none"
              aria-hidden="true"
            />
          )}
        </div>
        <span
          className={`w-[1.5px] h-[5px] rounded-r-[1px] shrink-0 ${nubClass}`}
          aria-hidden="true"
        />
      </div>

      {showPercentage && (
        <span
          className={`font-sans text-[10.5px] font-semibold tracking-[-0.02em] tabular-nums leading-none ${textColorClass}`}
        >
          {clamped}%
        </span>
      )}

      {statusLabel && (
        <span className="font-sans text-[9.5px] font-medium text-white/45 leading-none whitespace-nowrap">
          {STATUS_TEXT[battery.status]}
        </span>
      )}
    </div>
  );
};
