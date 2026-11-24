import React from 'react';
import { Zap } from 'lucide-react';
import { BatteryTelemetry } from '../../hooks/useSystemTelemetry';

export interface BatteryPillProps {
  battery: BatteryTelemetry;
  showPercentage?: boolean;
  statusLabel?: boolean;
  size?: number;
  className?: string;
}

const STATUS_TEXT: Record<BatteryTelemetry['status'], string> = {
  charging: 'Charging',
  plugged_in: 'Plugged In',
  low: 'Low',
  normal: 'On Battery',
};

/**
 * Circular Progress Battery Ring (CASA v2.3.1):
 * Dynamic SVG stroke-dashoffset ring + contrasting electric-yellow charging bolt + tabular percentage.
 */
export const BatteryPill: React.FC<BatteryPillProps> = ({
  battery,
  showPercentage = true,
  statusLabel = false,
  size = 15,
  className = '',
}) => {
  if (!battery.has_battery) {
    return null;
  }

  const clamped = Math.max(0, Math.min(100, Math.round(battery.percent)));
  const center = size / 2;
  const radius = Math.max(2, center - 1.65);
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (clamped / 100) * circumference;

  const isChargingOrPlugged = Boolean(battery.is_charging || battery.is_plugged_in);
  const isCritical = !isChargingOrPlugged && clamped <= 10;
  const isLow = !isChargingOrPlugged && !isCritical && (battery.status === 'low' || clamped <= 20);

  const ringColor = isChargingOrPlugged
    ? '#22c55e'
    : isCritical
    ? '#ef4444'
    : isLow
    ? '#f59e0b'
    : '#22c55e';
  const boltColor = '#facc15';

  const tooltipLabel = `${clamped}% · ${STATUS_TEXT[battery.status]}`;

  return (
    <div
      className={`inline-flex items-center gap-1 select-none shrink-0 ${className}`}
      title={tooltipLabel}
      aria-label={`Battery ${tooltipLabel}`}
    >
      {/* Circular SVG Progress Ring */}
      <div
        className={`relative flex items-center justify-center shrink-0 ${
          isCritical || isLow ? 'animate-pulse' : ''
        }`}
        style={{ width: size, height: size }}
      >
        <svg
          className="w-full h-full -rotate-90 transform"
          viewBox={`0 0 ${size} ${size}`}
          aria-hidden="true"
        >
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.16)"
            strokeWidth="1.7"
          />
          <circle
            data-battery-ring="true"
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={ringColor}
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-[stroke-dashoffset,stroke] duration-500 ease-out"
          />
        </svg>

        {isChargingOrPlugged && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Zap
              data-battery-bolt="true"
              className="w-[8px] h-[8px] fill-current"
              style={{ color: boltColor }}
              aria-hidden="true"
            />
          </div>
        )}
      </div>

      {showPercentage && (
        <span
          className="font-sans text-[10.5px] font-semibold tracking-[-0.02em] tabular-nums leading-none antialiased"
          style={{ color: isCritical || isLow ? ringColor : 'rgba(255,255,255,0.92)' }}
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
