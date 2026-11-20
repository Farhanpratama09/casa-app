import React, { useMemo, useState } from 'react';
import { MapPin, RefreshCw, Settings2, VolumeX } from 'lucide-react';
import { useSettingsStore } from '../../stores/useSettingsStore';
import {
  formatPrayerCountdown,
  refreshPrayerSchedule,
  stopPrayerAlert,
  usePrayerStore,
} from './prayerStore';
import { openDesktopSettingsWindow } from '../../utils/settingsWindow';
import {
  detectWindowsLocation,
  playChimeCue,
  PrayerEntryItem,
} from '../../utils/tauriBridge';

const SVG_W = 532;
const SVG_H = 58;
const HORIZON_Y = 40;

interface CurvePoint {
  x: number;
  y: number;
}

// 5 celestial prayer anchor points aligned 1:1 with the 5 equal label columns (10%, 30%, 50%, 70%, 90%)
// Subuh (kiri bawah) -> Dzuhur (puncak zenith) -> Ashar (lereng kanan) -> Maghrib (horizon) -> Isya (lengkungan malam)
const PRAYER_ANCHORS: CurvePoint[] = [
  { x: 53.2, y: 40 },  // Subuh (dawn horizon)
  { x: 159.6, y: 11 }, // Dzuhur (zenith peak)
  { x: 266.0, y: 21 }, // Ashar (afternoon slope)
  { x: 372.4, y: 40 }, // Maghrib (sunset horizon)
  { x: 478.8, y: 50 }, // Isya (night curve)
];

const CURVE_CONTROL_POINTS: CurvePoint[] = [
  { x: 10, y: 48 },
  ...PRAYER_ANCHORS,
  { x: 522, y: 53 },
];

type Rgb = [number, number, number];
type CelestialPhaseIcon = 'sunrise' | 'sun' | 'sunset' | 'moon';

interface SkyPhaseVisual {
  icon: CelestialPhaseIcon;
  activeHex: string;
  trailStartHex: string;
  glowRgba: string;
  cardBgRgba: string;
  cardBorderRgba: string;
}

const SKY_HOUR_COLOR_STOPS: Array<{ hour: number; rgb: Rgb }> = [
  { hour: 0.0, rgb: [148, 163, 184] },  // 00:00 Dini Hari (#94A3B8)
  { hour: 4.5, rgb: [148, 163, 184] },  // 04:30 Dini Hari akhir (#94A3B8)
  { hour: 5.0, rgb: [203, 213, 225] },  // 05:00 Fajar / Subuh (#CBD5E1)
  { hour: 6.5, rgb: [253, 230, 138] },  // 06:30 Fajar akhir -> emas pagi (#FDE68A)
  { hour: 7.0, rgb: [253, 230, 138] },  // 07:00 Pagi (#FDE68A)
  { hour: 10.5, rgb: [254, 240, 138] }, // 10:30 Pagi hangat (#FEF08A)
  { hour: 11.0, rgb: [255, 251, 235] }, // 11:00 Siang putih surya (#FFFBEB)
  { hour: 14.5, rgb: [255, 251, 235] }, // 14:30 Siang akhir (#FFFBEB)
  { hour: 15.0, rgb: [252, 211, 77] },  // 15:00 Sore kuning madu (#FCD34D)
  { hour: 16.5, rgb: [252, 211, 77] },  // 16:30 Sore akhir (#FCD34D)
  { hour: 17.0, rgb: [251, 146, 60] },  // 17:00 Senja jingga (#FB923C)
  { hour: 17.75, rgb: [251, 146, 60] }, // 17:45 Senja akhir (#FB923C)
  { hour: 18.0, rgb: [147, 197, 253] }, // 18:00 Malam biru-perak adem (#93C5FD)
  { hour: 21.5, rgb: [203, 213, 225] }, // 21:30 Perak bulan tenang (#CBD5E1)
  { hour: 24.0, rgb: [148, 163, 184] }, // 24:00 Wrap halus ke dini hari (#94A3B8)
];

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const f = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

function rgbToHex([r, g, b]: Rgb): string {
  const hex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function sampleSkyRgbByHour(hourFloat: number): Rgb {
  const h = ((hourFloat % 24) + 24) % 24;
  for (let i = 0; i < SKY_HOUR_COLOR_STOPS.length - 1; i++) {
    const a = SKY_HOUR_COLOR_STOPS[i];
    const b = SKY_HOUR_COLOR_STOPS[i + 1];
    if (h >= a.hour && h <= b.hour) {
      const span = Math.max(0.0001, b.hour - a.hour);
      return lerpRgb(a.rgb, b.rgb, (h - a.hour) / span);
    }
  }
  return SKY_HOUR_COLOR_STOPS[SKY_HOUR_COLOR_STOPS.length - 1].rgb;
}

function resolveCelestialIconByHour(hourFloat: number): CelestialPhaseIcon {
  const h = ((hourFloat % 24) + 24) % 24;
  if (h < 5.0 || h >= 18.0) return 'moon';    // 00:00–04:59 & 18:00–23:59 (Malam & Dini Hari)
  if (h < 7.0) return 'sunrise';              // 05:00–06:59 (Fajar / Subuh)
  if (h < 15.75) return 'sun';                // 07:00–15:44 (Pagi & Siang)
  return 'sunset';                            // 15:45–17:59 (Sore akhir & Senja)
}

function resolveSkyPhaseVisualByClock(nowMs: number, isMonochrome: boolean): SkyPhaseVisual {
  const dt = new Date(nowMs);
  const hourFloat = dt.getHours() + dt.getMinutes() / 60 + dt.getSeconds() / 3600;
  const icon = resolveCelestialIconByHour(hourFloat);

  if (isMonochrome) {
    return {
      icon,
      activeHex: '#FFFFFF',
      trailStartHex: '#A1A1AA',
      glowRgba: 'rgba(255, 255, 255, 0.32)',
      cardBgRgba: 'rgba(255, 255, 255, 0.08)',
      cardBorderRgba: 'rgba(255, 255, 255, 0.45)',
    };
  }

  const activeRgb = sampleSkyRgbByHour(hourFloat);
  const startRgb = sampleSkyRgbByHour(hourFloat - 2.0);
  const [r, g, b] = activeRgb;

  return {
    icon,
    activeHex: rgbToHex(activeRgb),
    trailStartHex: rgbToHex(startRgb),
    glowRgba: `rgba(${r}, ${g}, ${b}, 0.36)`,
    cardBgRgba: `rgba(${r}, ${g}, ${b}, 0.08)`,
    cardBorderRgba: `rgba(${r}, ${g}, ${b}, 0.55)`,
  };
}

function evalCatmullRom(
  p0: CurvePoint,
  p1: CurvePoint,
  p2: CurvePoint,
  p3: CurvePoint,
  t: number
): CurvePoint {
  const t2 = t * t;
  const t3 = t2 * t;
  const x =
    0.5 *
    (2 * p1.x +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  const y =
    0.5 *
    (2 * p1.y +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
  return { x, y };
}

function sampleSplinePoint(u: number): CurvePoint {
  const maxSeg = CURVE_CONTROL_POINTS.length - 1;
  const clamped = Math.max(0, Math.min(maxSeg, u));
  const segIdx = Math.min(maxSeg - 1, Math.floor(clamped));
  const localT = clamped - segIdx;

  const p0 = CURVE_CONTROL_POINTS[Math.max(0, segIdx - 1)];
  const p1 = CURVE_CONTROL_POINTS[segIdx];
  const p2 = CURVE_CONTROL_POINTS[Math.min(maxSeg, segIdx + 1)];
  const p3 = CURVE_CONTROL_POINTS[Math.min(maxSeg, segIdx + 2)];

  return evalCatmullRom(p0, p1, p2, p3, localT);
}

function buildPathFromRange(uStart: number, uEnd: number, steps = 48): string {
  if (uEnd <= uStart) return '';
  const count = Math.max(2, steps);
  const parts: string[] = [];
  for (let i = 0; i <= count; i++) {
    const u = uStart + ((uEnd - uStart) * i) / count;
    const pt = sampleSplinePoint(u);
    parts.push(`${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`);
  }
  return parts.join(' ');
}

function computeProgressU(prayers: PrayerEntryItem[], nowMs: number): number {
  if (prayers.length < 5) return 1.5;

  const t0 = prayers[0].timestampMs; // Subuh -> u = 1
  const t4 = prayers[4].timestampMs; // Isya  -> u = 5

  // Before Subuh (early morning approach from u=0.15 to u=1.0)
  if (nowMs <= t0) {
    const windowMs = 4 * 3600 * 1000;
    const ratio = Math.max(0, Math.min(1, 1 - (t0 - nowMs) / windowMs));
    return 0.15 + ratio * 0.85;
  }

  // Between Subuh (u=1) .. Isya (u=5)
  for (let i = 0; i < 4; i++) {
    const a = prayers[i].timestampMs;
    const b = prayers[i + 1].timestampMs;
    if (nowMs >= a && nowMs <= b) {
      const span = Math.max(1, b - a);
      const frac = Math.max(0, Math.min(1, (nowMs - a) / span));
      return 1 + i + frac;
    }
  }

  // After Isya (night curve from u=5.0 to u=5.85)
  const nightWindowMs = 4 * 3600 * 1000;
  const nightRatio = Math.max(0, Math.min(1, (nowMs - t4) / nightWindowMs));
  return 5 + nightRatio * 0.85;
}

const SUN_RAY_DOTS: Array<[number, number]> = [
  [6.5, 1.5],
  [10.0, 3.0],
  [11.5, 6.5],
  [10.0, 10.0],
  [6.5, 11.5],
  [3.0, 10.0],
  [1.5, 6.5],
  [3.0, 3.0],
];

function renderCelestialIconGlyph(icon: CelestialPhaseIcon, color: string) {
  switch (icon) {
    case 'sunrise':
      return (
        <>
          <line
            x1="1.5"
            y1="9.6"
            x2="11.5"
            y2="9.6"
            stroke={color}
            strokeWidth="1.15"
            strokeLinecap="round"
            strokeOpacity="0.85"
          />
          <path d="M 3.3,9.6 A 3.2,3.2 0 0 1 9.7,9.6 Z" fill={color} />
          <line x1="6.5" y1="2.2" x2="6.5" y2="3.8" stroke={color} strokeWidth="1.1" strokeLinecap="round" />
          <line x1="3.1" y1="3.8" x2="4.1" y2="4.9" stroke={color} strokeWidth="1.1" strokeLinecap="round" />
          <line x1="9.9" y1="3.8" x2="8.9" y2="4.9" stroke={color} strokeWidth="1.1" strokeLinecap="round" />
        </>
      );
    case 'sun':
      return (
        <>
          <circle cx="6.5" cy="6.5" r="2.7" fill={color} />
          {SUN_RAY_DOTS.map(([cx, cy], idx) => (
            <circle key={idx} cx={cx} cy={cy} r="0.72" fill={color} fillOpacity="0.92" />
          ))}
        </>
      );
    case 'sunset':
      return (
        <>
          <path d="M 3.2,9.2 A 3.3,3.3 0 0 1 9.8,9.2 Z" fill={color} />
          <line
            x1="1.5"
            y1="9.2"
            x2="11.5"
            y2="9.2"
            stroke={color}
            strokeWidth="1.15"
            strokeLinecap="round"
          />
          <line
            x1="3.8"
            y1="11.2"
            x2="9.2"
            y2="11.2"
            stroke={color}
            strokeWidth="1.05"
            strokeLinecap="round"
            strokeOpacity="0.55"
          />
        </>
      );
    case 'moon':
    default:
      return (
        <>
          <path
            d="M 8.5,2.0 C 3.3,2.3 2.9,10.7 8.5,11.0 C 5.7,9.6 5.7,3.4 8.5,2.0 Z"
            fill={color}
          />
          <circle cx="10.2" cy="3.6" r="0.95" fill={color} />
        </>
      );
  }
}

export const IbadahExpandedView: React.FC = () => {
  const { settings, updateSettings } = useSettingsStore();
  const prayerState = usePrayerStore();
  const { schedule, countdownMs, isLoading, error, activeAlert } = prayerState;
  const [isRefreshingLoc, setIsRefreshingLoc] = useState(false);

  const countdownLabel = useMemo(
    () => formatPrayerCountdown(countdownMs),
    [countdownMs]
  );

  const isMonochrome = settings.theme === 'monochrome';
  const isVisibleAlert = Boolean(activeAlert && !activeAlert.suppressVisual);

  const nextHeading = schedule
    ? schedule.nextPrayerLabel.toUpperCase()
    : 'MEMUAT';

  const curveGeometry = useMemo(() => {
    const prayers = schedule?.prayers ?? [];
    const nowMs = schedule ? schedule.nextPrayerTimestampMs - countdownMs : Date.now();
    const uNow = computeProgressU(prayers, nowMs);
    const orb = sampleSplinePoint(uNow);
    const startPt = sampleSplinePoint(0);
    const tailStart = Math.max(0, uNow - 1.15);
    const tailStartPt = sampleSplinePoint(tailStart);
    const sky = resolveSkyPhaseVisualByClock(nowMs, isMonochrome);

    return {
      uNow,
      orb,
      startPt,
      tailStartPt,
      sky,
      passedPathD: buildPathFromRange(0, uNow, 56),
      cometTailD: buildPathFromRange(tailStart, uNow, 28),
      remainingPathD: buildPathFromRange(uNow, 6, 56),
    };
  }, [schedule, countdownMs, isMonochrome]);

  const { sky } = curveGeometry;

  const handleRefreshLocation = async () => {
    if (isRefreshingLoc || isLoading) return;
    playChimeCue('tap');
    setIsRefreshingLoc(true);
    try {
      if (settings.ibadah.locationMode === 'auto') {
        const res = await detectWindowsLocation();
        if (res.status === 'ok' && res.latitude !== null && res.longitude !== null) {
          updateSettings((prev) => ({
            ...prev,
            ibadah: {
              ...prev.ibadah,
              latitude: res.latitude!,
              longitude: res.longitude!,
              city: res.city || prev.ibadah.city,
              region: res.region ?? prev.ibadah.region,
              countryCode: res.countryCode || prev.ibadah.countryCode,
            },
          }));
        }
      }
      await refreshPrayerSchedule();
    } finally {
      setIsRefreshingLoc(false);
    }
  };

  return (
    <div className="w-full h-full px-3.5 py-2 flex flex-col justify-between gap-1 bg-[#000000] text-white select-none overflow-hidden">
      {/* Baris Atas: Lokasi + [CC] + [↻] (kiri) | Hitung Mundur + [⚙] (kanan) */}
      <div className="flex items-center justify-between gap-3 min-w-0 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <MapPin className="w-3 h-3 text-white/45 shrink-0" aria-hidden="true" />
            <span className="text-[12px] font-semibold tracking-tight text-white truncate">
              {settings.ibadah.city}
            </span>
            {settings.ibadah.countryCode && (
              <span className="text-[8.5px] font-mono uppercase px-1.5 py-[1px] rounded bg-white/[0.06] border border-white/[0.10] text-white/60 shrink-0">
                {settings.ibadah.countryCode}
              </span>
            )}
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                void handleRefreshLocation();
              }}
              className="w-[18px] h-[18px] rounded-full bg-white/[0.05] hover:bg-white/[0.14] border border-white/[0.09] text-white/55 hover:text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
              title="Perbarui Lokasi"
              aria-label="Perbarui Lokasi"
            >
              <RefreshCw
                className={`w-2.5 h-2.5 ${isLoading || isRefreshingLoc ? 'animate-spin' : ''}`}
              />
            </button>
          </div>
          <div className="flex items-center gap-1.5 text-[9.5px] font-mono text-white/45 mt-0.5 truncate">
            <span>{schedule?.resolvedMethodLabel ?? 'Menghitung...'}</span>
            <span className="text-white/25">·</span>
            <span>{schedule?.madhabLabel ?? "Syafi'i"}</span>
            {schedule?.timezoneLabel && (
              <>
                <span className="text-white/25">·</span>
                <span>{schedule.timezoneLabel}</span>
              </>
            )}
          </div>
        </div>

        {/* Kanan: Hanya Hitung Mundur (atau kontrol Stop saat T-0) + 1 tombol Settings */}
        <div className="flex items-center gap-2 shrink-0">
          {isVisibleAlert && activeAlert ? (
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/[0.07] border border-white/25">
              <span
                style={{ color: sky.activeHex }}
                className="text-[11px] font-bold tracking-tight whitespace-nowrap"
              >
                Adzan {activeAlert.prayerLabel}
              </span>
              {activeAlert.audioMode !== 'visual' && (
                <span className="casa-prayer-eq shrink-0" aria-hidden="true">
                  <span className="casa-prayer-eq-bar" />
                  <span className="casa-prayer-eq-bar" />
                  <span className="casa-prayer-eq-bar" />
                  <span className="casa-prayer-eq-bar" />
                </span>
              )}
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  stopPrayerAlert();
                }}
                style={{
                  backgroundColor: sky.activeHex,
                  color: '#000000',
                }}
                className="h-[20px] px-2.5 rounded-full text-[9.5px] font-bold inline-flex items-center gap-1 hover:opacity-90 active:scale-95 transition-all cursor-pointer"
                title={
                  activeAlert.audioMode === 'visual'
                    ? 'Tutup pengingat ibadah'
                    : 'Hentikan audio adzan'
                }
              >
                {activeAlert.audioMode !== 'visual' && <VolumeX className="w-2.5 h-2.5" />}
                <span>{activeAlert.audioMode === 'visual' ? 'Tutup' : 'Stop'}</span>
              </button>
            </div>
          ) : (
            <div className="text-right">
              <div
                style={{ color: sky.activeHex }}
                className="text-[9px] font-mono font-semibold uppercase tracking-widest leading-none opacity-85"
              >
                {nextHeading}
              </div>
              <div className="text-[16px] font-mono font-bold tabular-nums tracking-tight text-white leading-tight mt-0.5">
                -{countdownLabel}
              </div>
            </div>
          )}

          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              playChimeCue('tap');
              void openDesktopSettingsWindow('ibadah');
            }}
            className="w-[24px] h-[24px] rounded-full bg-white/[0.05] hover:bg-white/[0.14] border border-white/[0.09] text-white/60 hover:text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
            title="Buka Pengaturan Ibadah & Lokasi"
            aria-label="Buka Pengaturan Ibadah & Lokasi"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Tengah & Bawah: Kurva Parabola + 5 Titik Tetap + Ikon Benda Langit Dinamis + 5 Kolom */}
      {error ? (
        <div className="flex-1 flex items-center justify-center rounded-xl border border-white/[0.10] bg-white/[0.03] px-3 text-[11px] text-white/70 text-center">
          {error}
        </div>
      ) : (
        <div className="flex-1 flex flex-col justify-end min-h-0">
          <div className="relative w-full h-[58px] shrink-0">
            <svg
              viewBox={`0 0 ${SVG_W} ${SVG_H}`}
              preserveAspectRatio="none"
              className="w-full h-full overflow-visible"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="casa-horizon-fade" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
                  <stop offset="10%" stopColor="#ffffff" stopOpacity="0.16" />
                  <stop offset="90%" stopColor="#ffffff" stopOpacity="0.16" />
                  <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                </linearGradient>

                <linearGradient
                  id="casa-passed-sky-grad"
                  gradientUnits="userSpaceOnUse"
                  x1={curveGeometry.startPt.x}
                  y1={curveGeometry.startPt.y}
                  x2={curveGeometry.orb.x}
                  y2={curveGeometry.orb.y}
                >
                  <stop offset="0%" stopColor={sky.trailStartHex} stopOpacity="0.32" />
                  <stop offset="100%" stopColor={sky.activeHex} stopOpacity="0.72" />
                </linearGradient>

                <linearGradient
                  id="casa-comet-tail"
                  gradientUnits="userSpaceOnUse"
                  x1={curveGeometry.tailStartPt.x}
                  y1={curveGeometry.tailStartPt.y}
                  x2={curveGeometry.orb.x}
                  y2={curveGeometry.orb.y}
                >
                  <stop offset="0%" stopColor={sky.trailStartHex} stopOpacity="0" />
                  <stop offset="60%" stopColor={sky.activeHex} stopOpacity="0.62" />
                  <stop offset="100%" stopColor={sky.activeHex} stopOpacity="1" />
                </linearGradient>

                <filter id="casa-orb-glow" x="-80%" y="-80%" width="260%" height="260%">
                  <feGaussianBlur stdDeviation="2.8" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Garis Horizon Tipis */}
              <line
                x1="4"
                y1={HORIZON_Y}
                x2={SVG_W - 4}
                y2={HORIZON_Y}
                stroke="url(#casa-horizon-fade)"
                strokeWidth="1"
              />

              {/* Lintasan ke depan (garis putus-putus tipis) */}
              {curveGeometry.remainingPathD && (
                <path
                  d={curveGeometry.remainingPathD}
                  fill="none"
                  stroke="rgba(255, 255, 255, 0.18)"
                  strokeWidth="1.35"
                  strokeDasharray="3 3.5"
                  strokeLinecap="round"
                />
              )}

              {/* Lintasan terlewati dengan gradasi warna langit dinamis */}
              {curveGeometry.passedPathD && (
                <path
                  d={curveGeometry.passedPathD}
                  fill="none"
                  stroke="url(#casa-passed-sky-grad)"
                  strokeWidth="1.65"
                  strokeLinecap="round"
                />
              )}

              {/* Ekor cahaya bintang jatuh menuju ikon benda langit aktif */}
              {curveGeometry.cometTailD && (
                <path
                  d={curveGeometry.cometTailD}
                  fill="none"
                  stroke="url(#casa-comet-tail)"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  filter="url(#casa-orb-glow)"
                />
              )}

              {/* 5 Titik Sholat (dipertahankan putih/perak netral tanpa terpengaruh warna langit) */}
              {(schedule?.prayers ?? []).map((item, idx) => {
                const pt = PRAYER_ANCHORS[idx];
                if (!pt) return null;
                const isHighlighted =
                  item.isNext || (schedule?.nextPrayerIsTomorrow && item.id === 'fajr');
                const isPassed = item.isPassed && !isHighlighted;

                return (
                  <g key={item.id}>
                    {isHighlighted && (
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r="5.6"
                        fill="none"
                        stroke="#FFFFFF"
                        strokeOpacity="0.32"
                        strokeWidth="1"
                      />
                    )}
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={isHighlighted ? 3.0 : isPassed ? 2.2 : 2.1}
                      fill={
                        isHighlighted
                          ? '#FFFFFF'
                          : isPassed
                          ? '#E4E4E7'
                          : '#000000'
                      }
                      fillOpacity={isHighlighted ? 1 : isPassed ? 0.65 : 1}
                      stroke={
                        isHighlighted
                          ? '#FFFFFF'
                          : isPassed
                          ? '#E4E4E7'
                          : 'rgba(255, 255, 255, 0.34)'
                      }
                      strokeWidth={isHighlighted ? 1.2 : 1.1}
                    />
                  </g>
                );
              })}

              {/* Ikon Benda Langit Dinamis (13x13px) dengan backing #000000 r=8 & glow warna langit */}
              <g data-celestial-phase={sky.icon}>
                <circle
                  cx={curveGeometry.orb.x}
                  cy={curveGeometry.orb.y}
                  r="9.5"
                  fill={sky.glowRgba}
                  filter="url(#casa-orb-glow)"
                />
                <circle
                  cx={curveGeometry.orb.x}
                  cy={curveGeometry.orb.y}
                  r="8"
                  fill="#000000"
                />
                <g
                  transform={`translate(${(curveGeometry.orb.x - 6.5).toFixed(2)}, ${(
                    curveGeometry.orb.y - 6.5
                  ).toFixed(2)})`}
                >
                  {renderCelestialIconGlyph(sky.icon, sky.activeHex)}
                </g>
              </g>
            </svg>
          </div>

          {/* 5 Kolom Label Sejajar (hanya kartu berikutnya menampilkan label NEXT; tanpa LEWAT/NANTI) */}
          <div className="grid grid-cols-5 gap-1 pt-0.5 shrink-0">
            {(schedule?.prayers ?? []).map((item) => {
              const isHighlighted =
                item.isNext || (schedule?.nextPrayerIsTomorrow && item.id === 'fajr');
              const isPassed = item.isPassed && !isHighlighted;

              return (
                <div
                  key={item.id}
                  style={
                    isHighlighted
                      ? {
                          borderColor: sky.cardBorderRgba,
                          backgroundColor: sky.cardBgRgba,
                        }
                      : undefined
                  }
                  className={`flex flex-col items-center justify-start text-center min-w-0 px-0.5 py-1 rounded-lg border transition-colors ${
                    isHighlighted
                      ? ''
                      : isPassed
                      ? 'border-transparent opacity-[0.52]'
                      : 'border-transparent opacity-90'
                  }`}
                >
                  <span
                    style={isHighlighted ? { color: sky.activeHex } : undefined}
                    className={`text-[9.5px] leading-none truncate ${
                      isHighlighted
                        ? 'font-semibold'
                        : isPassed
                        ? 'font-medium text-white/85'
                        : 'font-medium text-white/75'
                    }`}
                  >
                    {item.label}
                  </span>
                  <span
                    className={`font-mono text-[12px] font-bold tabular-nums leading-tight mt-0.5 ${
                      isHighlighted ? 'text-white' : 'text-white/90'
                    }`}
                  >
                    {item.timeLabel}
                  </span>
                  {isHighlighted && (
                    <span
                      style={{ color: sky.activeHex }}
                      className="text-[8px] font-mono font-semibold tracking-widest uppercase leading-none mt-0.5"
                    >
                      NEXT
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
