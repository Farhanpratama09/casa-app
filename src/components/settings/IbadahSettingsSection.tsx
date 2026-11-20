import React, { useEffect, useState } from 'react';
import {
  MapPin,
  LocateFixed,
  Search,
  Play,
  Square,
  RotateCcw,
  ExternalLink,
  MoonStar,
} from 'lucide-react';
import {
  CasaSettings,
  CasaThemePalette,
  IbadahAudioMode,
  IbadahCalculationMethod,
  IbadahLocationMode,
  IbadahMadhab,
  IbadahOffsets,
  IbadahSettings,
} from '../../stores/useSettingsStore';
import {
  CitySearchItem,
  detectWindowsLocation,
  openWindowsLocationSettings,
  playChimeCue,
  searchPrayerCity,
} from '../../utils/tauriBridge';
import {
  AdzanAudioVariant,
  playPrayerAudio,
  stopPrayerAudio,
} from '../../features/ibadah/prayerAudio';

interface IbadahSettingsSectionProps {
  settings: CasaSettings;
  palette: CasaThemePalette;
  onUpdateIbadah: (patch: Partial<IbadahSettings>) => void;
}

const METHOD_OPTIONS: Array<{ value: IbadahCalculationMethod; label: string }> = [
  { value: 'auto', label: 'Otomatis sesuai negara' },
  { value: 'kemenag', label: 'Kemenag RI (20° / 18°)' },
  { value: 'jakim', label: 'JAKIM Malaysia (20° / 18°)' },
  { value: 'muis', label: 'MUIS Singapura (20° / 18°)' },
  { value: 'umm_al_qura', label: 'Umm al-Qura (SA / AE)' },
  { value: 'mwl', label: 'Muslim World League (MWL)' },
  { value: 'isna', label: 'ISNA (Amerika Utara)' },
  { value: 'egyptian', label: 'Egyptian General Authority' },
  { value: 'karachi', label: 'University of Karachi' },
];

const OFFSET_FIELDS: Array<{ key: keyof IbadahOffsets; label: string }> = [
  { key: 'fajr', label: 'Subuh' },
  { key: 'dhuhr', label: 'Dzuhur' },
  { key: 'asr', label: 'Ashar' },
  { key: 'maghrib', label: 'Maghrib' },
  { key: 'isha', label: 'Isya' },
];

function describeAutoMethod(countryCode: string): string {
  const cc = (countryCode || '').toUpperCase();
  if (cc === 'ID') return 'Kemenag RI';
  if (cc === 'MY') return 'JAKIM Malaysia';
  if (cc === 'SG' || cc === 'BN') return 'MUIS Singapura';
  if (['SA', 'AE', 'QA', 'KW', 'BH', 'OM'].includes(cc)) return 'Umm al-Qura';
  if (cc === 'US' || cc === 'CA') return 'ISNA';
  if (['EG', 'LY', 'SD'].includes(cc)) return 'Egyptian';
  if (['PK', 'IN', 'BD', 'AF'].includes(cc)) return 'Karachi';
  return 'Muslim World League';
}

export const IbadahSettingsSection: React.FC<IbadahSettingsSectionProps> = ({
  settings,
  palette,
  onUpdateIbadah,
}) => {
  const ibadah = settings.ibadah;
  const isMonochrome = settings.theme === 'monochrome';
  const accentColor = isMonochrome ? '#FFFFFF' : palette.ibadah;

  const [isDetectingLoc, setIsDetectingLoc] = useState(false);
  const [locNotice, setLocNotice] = useState<{
    kind: 'ok' | 'warn';
    text: string;
    showWindowsPrivacyShortcut?: boolean;
  } | null>(null);

  const [cityQuery, setCityQuery] = useState('');
  const [isSearchingCity, setIsSearchingCity] = useState(false);
  const [cityResults, setCityResults] = useState<CitySearchItem[]>([]);
  const [citySearchError, setCitySearchError] = useState<string | null>(null);

  const [testingTarget, setTestingTarget] = useState<null | 'regular' | 'subuh' | 'chime'>(null);
  const [audioNotice, setAudioNotice] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      stopPrayerAudio();
    };
  }, []);

  const handleToggleEnabled = (next: boolean) => {
    playChimeCue('tap');
    if (!next) {
      stopPrayerAudio();
      setTestingTarget(null);
    }
    onUpdateIbadah({ enabled: next });
  };

  const handleDetectWindowsLocation = async () => {
    if (isDetectingLoc) return;
    playChimeCue('tap');
    setIsDetectingLoc(true);
    setLocNotice(null);
    try {
      const res = await detectWindowsLocation();
      if (res.status === 'ok' && res.latitude !== null && res.longitude !== null) {
        onUpdateIbadah({
          locationMode: 'auto',
          latitude: res.latitude,
          longitude: res.longitude,
          city: res.city || `${res.latitude.toFixed(3)}, ${res.longitude.toFixed(3)}`,
          region: res.region || '',
          countryCode: res.countryCode || ibadah.countryCode,
        });
        setLocNotice({
          kind: 'ok',
          text: `${res.message}${res.countryCode ? ` (${res.countryCode})` : ''}. Jadwal dihitung offline.`,
        });
      } else {
        setLocNotice({
          kind: 'warn',
          text: res.message,
          showWindowsPrivacyShortcut:
            res.status === 'permission_denied' ||
            res.status === 'service_disabled' ||
            res.status === 'timeout',
        });
      }
    } catch (err) {
      setLocNotice({
        kind: 'warn',
        text: err instanceof Error ? err.message : 'Gagal membaca lokasi Windows.',
        showWindowsPrivacyShortcut: true,
      });
    } finally {
      setIsDetectingLoc(false);
    }
  };

  const handleSearchCity = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = cityQuery.trim();
    if (trimmed.length < 2 || isSearchingCity) return;
    playChimeCue('tap');
    setIsSearchingCity(true);
    setCitySearchError(null);
    try {
      const items = await searchPrayerCity(trimmed);
      setCityResults(items);
      if (items.length === 0) {
        setCitySearchError(`Kota "${trimmed}" tidak ditemukan. Coba nama kota utama terdekat.`);
      }
    } catch (err) {
      setCityResults([]);
      setCitySearchError(
        err instanceof Error ? err.message : 'Gagal mencari kota. Periksa koneksi internet.'
      );
    } finally {
      setIsSearchingCity(false);
    }
  };

  const handleSelectCity = (item: CitySearchItem) => {
    playChimeCue('tap');
    onUpdateIbadah({
      locationMode: 'manual',
      city: item.name,
      region: item.region || item.country,
      countryCode: item.countryCode || 'ID',
      latitude: item.latitude,
      longitude: item.longitude,
    });
    setCityResults([]);
    setCityQuery('');
    setLocNotice({
      kind: 'ok',
      text: `Lokasi disimpan: ${item.name}${item.region ? `, ${item.region}` : ''} (${item.countryCode || item.country}).`,
    });
  };

  const handleAdjustOffset = (key: keyof IbadahOffsets, delta: number) => {
    playChimeCue('tap');
    const nextVal = Math.max(-60, Math.min(60, (ibadah.offsets[key] || 0) + delta));
    onUpdateIbadah({
      offsets: {
        ...ibadah.offsets,
        [key]: nextVal,
      },
    });
  };

  const hasAnyOffset = OFFSET_FIELDS.some((f) => (ibadah.offsets[f.key] || 0) !== 0);

  const handleToggleTestAudio = async (variant?: AdzanAudioVariant) => {
    const requestedTarget: 'regular' | 'subuh' | 'chime' =
      ibadah.audioMode === 'adzan' ? variant ?? 'regular' : 'chime';

    if (testingTarget === requestedTarget) {
      stopPrayerAudio();
      setTestingTarget(null);
      setAudioNotice(null);
      return;
    }

    if (ibadah.audioMode === 'visual') {
      playChimeCue('tap');
      setAudioNotice('Mode Visual Saja aktif — saat T-0 kapsul muncul tanpa suara.');
      return;
    }

    setAudioNotice(null);
    setTestingTarget(requestedTarget);

    const res = await playPrayerAudio(ibadah.audioMode, {
      variant: ibadah.audioMode === 'adzan' ? variant ?? 'regular' : undefined,
      onEnded: () => {
        setTestingTarget(null);
      },
      onFallback: (reason) => {
        setAudioNotice(reason);
      },
    });

    if (ibadah.audioMode === 'chime' || res.usedFallback) {
      setTimeout(() => {
        setTestingTarget((current) => (current === requestedTarget ? null : current));
      }, 2200);
    }
  };

  return (
    <div className="space-y-4">
      {/* Master Opt-In Toggle */}
      <div className="border-t border-b border-white/[0.07] py-3.5 flex items-center justify-between gap-4">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#08080A] border border-white/[0.09] flex items-center justify-center shrink-0 mt-0.5">
            <MoonStar style={{ color: accentColor }} className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[12.5px] font-semibold text-white/95">
              Aktifkan Pengingat Ibadah
            </div>
            <div className="text-[11px] text-white/45 mt-0.5 leading-relaxed">
              Menambahkan tab <span className="text-white/75 font-medium">Ibadah</span> di Mode 6 dan pengingat waktu sholat offline. Saat nonaktif, tidak ada scheduler latar belakang.
            </div>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={ibadah.enabled}
          aria-label="Aktifkan Pengingat Ibadah"
          onClick={() => handleToggleEnabled(!ibadah.enabled)}
          className={`relative w-10 h-[22px] rounded-full transition-colors cursor-pointer shrink-0 border ${
            ibadah.enabled
              ? 'bg-white border-white'
              : 'bg-white/[0.08] border-white/[0.16] hover:border-white/30'
          }`}
        >
          <span
            className={`absolute top-[2px] w-4 h-4 rounded-full transition-all shadow-sm ${
              ibadah.enabled ? 'left-[20px] bg-[#000000]' : 'left-[2px] bg-white/80'
            }`}
          />
        </button>
      </div>

      {/* Konten Konfigurasi (tetap bisa diatur, opacity halus saat OFF) */}
      <div
        className={`space-y-4 transition-opacity ${
          ibadah.enabled ? 'opacity-100' : 'opacity-55'
        }`}
      >
        {/* Jalur Deteksi Lokasi */}
        <div className="p-3.5 rounded-xl bg-[#060608] border border-white/[0.08] space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[12px] font-semibold text-white/95">Lokasi Jadwal Sholat</div>
              <div className="text-[10.5px] text-white/45 mt-0.5">
                Kalkulasi 100% offline berbasis koordinat &amp; zona waktu aktif Windows.
              </div>
            </div>
            <div className="inline-flex items-center p-0.5 rounded-lg bg-[#000000] border border-white/[0.10] shrink-0">
              {(
                [
                  { id: 'auto', label: 'Otomatis' },
                  { id: 'manual', label: 'Manual' },
                ] as Array<{ id: IbadahLocationMode; label: string }>
              ).map((opt) => {
                const active = ibadah.locationMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      playChimeCue('tap');
                      onUpdateIbadah({ locationMode: opt.id });
                    }}
                    className={`px-2.5 py-1 rounded-md text-[10.5px] font-medium transition-colors cursor-pointer ${
                      active
                        ? 'bg-white text-black font-semibold'
                        : 'text-white/55 hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Kartu Lokasi Tersimpan Saat Ini */}
          <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-black border border-white/[0.08]">
            <div className="flex items-center gap-2 min-w-0">
              <MapPin className="w-3.5 h-3.5 text-white/55 shrink-0" />
              <div className="min-w-0">
                <div className="text-[12px] font-semibold text-white truncate">
                  {ibadah.city}
                  {ibadah.region ? (
                    <span className="text-white/45 font-normal"> · {ibadah.region}</span>
                  ) : null}
                </div>
                <div className="text-[10px] font-mono text-white/45 mt-0.5">
                  {ibadah.latitude.toFixed(4)}, {ibadah.longitude.toFixed(4)} · {ibadah.countryCode}
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={isDetectingLoc}
              onClick={() => void handleDetectWindowsLocation()}
              className="px-2.5 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.15] border border-white/[0.14] text-[11px] font-medium text-white inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-45 shrink-0 transition-colors"
              title="Ambil koordinat presisi dari Windows Location API"
            >
              <LocateFixed className={`w-3.5 h-3.5 ${isDetectingLoc ? 'animate-pulse' : ''}`} />
              <span>{isDetectingLoc ? 'Mendeteksi...' : 'Deteksi Windows'}</span>
            </button>
          </div>

          {/* Pencarian Kota Manual */}
          <form onSubmit={(e) => void handleSearchCity(e)} className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-white/40 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={cityQuery}
                onChange={(e) => setCityQuery(e.target.value)}
                placeholder="Cari kota manual (mis. Bandung, Kuala Lumpur, Makkah)..."
                className="w-full h-[32px] pl-8 pr-3 rounded-lg bg-black border border-white/[0.10] focus:border-white/35 outline-none text-[11.5px] text-white placeholder:text-white/30"
              />
            </div>
            <button
              type="submit"
              disabled={isSearchingCity || cityQuery.trim().length < 2}
              className="h-[32px] px-3 rounded-lg bg-white/[0.08] hover:bg-white/[0.15] border border-white/[0.14] text-[11px] font-medium text-white cursor-pointer disabled:opacity-40 shrink-0 transition-colors"
            >
              {isSearchingCity ? 'Mencari...' : 'Cari'}
            </button>
          </form>

          {cityResults.length > 0 && (
            <div className="rounded-lg border border-white/[0.10] bg-black divide-y divide-white/[0.06] overflow-hidden">
              {cityResults.map((item, idx) => (
                <button
                  key={`${item.name}-${item.latitude}-${item.longitude}-${idx}`}
                  type="button"
                  onClick={() => handleSelectCity(item)}
                  className="w-full px-3 py-2 text-left hover:bg-white/[0.06] flex items-center justify-between gap-2 transition-colors cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="text-[11.5px] font-medium text-white truncate">
                      {item.name}
                      {item.region ? (
                        <span className="text-white/45 font-normal">, {item.region}</span>
                      ) : null}
                    </div>
                    <div className="text-[10px] font-mono text-white/40">
                      {item.country} · {item.latitude.toFixed(3)}, {item.longitude.toFixed(3)}
                    </div>
                  </div>
                  <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded border border-white/[0.12] text-white/70 shrink-0">
                    {item.countryCode || 'GEO'}
                  </span>
                </button>
              ))}
            </div>
          )}

          {citySearchError && (
            <div
              style={{ color: palette.danger }}
              className="text-[11px] px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.08]"
            >
              {citySearchError}
            </div>
          )}

          {locNotice && (
            <div
              style={{
                borderColor:
                  locNotice.kind === 'warn' ? `${palette.timer}40` : `${palette.rest}40`,
                color: locNotice.kind === 'warn' ? palette.timer : palette.rest,
              }}
              className="text-[11px] px-3 py-2 rounded-lg bg-black border flex items-center justify-between gap-3"
            >
              <span>{locNotice.text}</span>
              {locNotice.showWindowsPrivacyShortcut && (
                <button
                  type="button"
                  onClick={() => void openWindowsLocationSettings()}
                  className="px-2 py-1 rounded-md bg-white/[0.08] hover:bg-white/[0.16] border border-white/[0.15] text-[10px] font-medium text-white inline-flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <span>Lokasi Windows</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Standar Hisab & Mazhab */}
        <div className="divide-y divide-white/[0.07] border-t border-b border-white/[0.07]">
          <div className="py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-white/95">Standar Perhitungan</div>
              <div className="text-[10.5px] text-white/45 mt-0.5">
                {ibadah.method === 'auto'
                  ? `Otomatis (${ibadah.countryCode}) → ${describeAutoMethod(ibadah.countryCode)}`
                  : 'Override manual aktif untuk lokasi saat ini.'}
              </div>
            </div>
            <select
              aria-label="Standar Perhitungan Sholat"
              value={ibadah.method}
              onChange={(e) => {
                playChimeCue('tap');
                onUpdateIbadah({ method: e.target.value as IbadahCalculationMethod });
              }}
              className="h-[30px] px-2.5 rounded-lg bg-[#08080A] border border-white/[0.14] text-[11px] text-white outline-none focus:border-white/35 cursor-pointer shrink-0"
            >
              {METHOD_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-[#0a0a0c] text-white">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-white/95">Mazhab Waktu Ashar</div>
              <div className="text-[10.5px] text-white/45 mt-0.5">
                Syafi&apos;i (standar Asia Tenggara) atau Hanafi.
              </div>
            </div>
            <div className="inline-flex items-center p-0.5 rounded-lg bg-[#08080A] border border-white/[0.10] shrink-0">
              {(
                [
                  { id: 'shafi', label: "Syafi'i" },
                  { id: 'hanafi', label: 'Hanafi' },
                ] as Array<{ id: IbadahMadhab; label: string }>
              ).map((opt) => {
                const active = ibadah.madhab === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      playChimeCue('tap');
                      onUpdateIbadah({ madhab: opt.id });
                    }}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                      active
                        ? 'bg-white text-black font-semibold'
                        : 'text-white/55 hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Koreksi Menit (± Offset) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[12px] font-semibold text-white/95">
                Koreksi Waktu (± Menit)
              </div>
              <div className="text-[10.5px] text-white/45">
                Penyesuaian ihtiyat lokal terhadap jadwal masjid setempat.
              </div>
            </div>
            {hasAnyOffset && (
              <button
                type="button"
                onClick={() => {
                  playChimeCue('tap');
                  onUpdateIbadah({
                    offsets: { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
                  });
                }}
                className="text-[10.5px] text-white/60 hover:text-white inline-flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset 0m</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-5 gap-1.5">
            {OFFSET_FIELDS.map(({ key, label }) => {
              const val = ibadah.offsets[key] || 0;
              return (
                <div
                  key={key}
                  className="p-2 rounded-lg bg-[#060608] border border-white/[0.08] flex flex-col items-center gap-1.5"
                >
                  <span className="text-[10px] text-white/60 font-medium">{label}</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleAdjustOffset(key, -1)}
                      className="w-5 h-5 rounded bg-white/[0.06] hover:bg-white/[0.15] text-white/80 text-[11px] font-mono leading-none flex items-center justify-center cursor-pointer"
                      aria-label={`Kurangi 1 menit ${label}`}
                    >
                      -
                    </button>
                    <span className="w-7 text-center font-mono text-[10.5px] tabular-nums text-white font-semibold">
                      {val > 0 ? `+${val}` : val}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleAdjustOffset(key, 1)}
                      className="w-5 h-5 rounded bg-white/[0.06] hover:bg-white/[0.15] text-white/80 text-[11px] font-mono leading-none flex items-center justify-center cursor-pointer"
                      aria-label={`Tambah 1 menit ${label}`}
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Mode Audio & Test */}
        <div className="p-3.5 rounded-xl bg-[#060608] border border-white/[0.08] space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[12px] font-semibold text-white/95">Mode Pengingat T-0</div>
              <div className="text-[10.5px] text-white/45 mt-0.5">
                Dimuat lazy dari <code className="font-mono text-white/70">/audio/adzan.ogg</code> &amp;{' '}
                <code className="font-mono text-white/70">/audio/adzan-subuh.ogg</code> (0 MB RAM saat idle).
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                { id: 'adzan', title: 'Adzan Penuh', desc: 'Reguler & Subuh OGG + fallback' },
                { id: 'chime', title: 'Chime Singkat', desc: 'Nada lembut + tutup 20d' },
                { id: 'visual', title: 'Visual Saja', desc: 'Hening + kapsul 20d' },
              ] as Array<{ id: IbadahAudioMode; title: string; desc: string }>
            ).map((opt) => {
              const active = ibadah.audioMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    playChimeCue('tap');
                    stopPrayerAudio();
                    setTestingTarget(null);
                    setAudioNotice(null);
                    onUpdateIbadah({ audioMode: opt.id });
                  }}
                  style={active ? { borderColor: accentColor } : undefined}
                  className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                    active
                      ? 'bg-white/[0.08] text-white'
                      : 'bg-black border-white/[0.08] text-white/65 hover:border-white/25 hover:text-white'
                  }`}
                >
                  <div className="text-[11px] font-semibold">{opt.title}</div>
                  <div className="text-[9.5px] text-white/45 mt-0.5 leading-snug">{opt.desc}</div>
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2.5 pt-0.5 flex-wrap">
            <span className="text-[10.5px] text-white/45">
              Volume mengikuti slider Alarm ({settings.alarmVolume}%).
            </span>
            {ibadah.audioMode === 'adzan' ? (
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => void handleToggleTestAudio('regular')}
                  className="px-2.5 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.15] border border-white/[0.14] text-[11px] font-medium text-white inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                  title="Uji audio /audio/adzan.ogg (Dzuhur, Ashar, Maghrib, Isya)"
                >
                  {testingTarget === 'regular' ? (
                    <>
                      <Square className="w-3 h-3 fill-current" />
                      <span>Stop</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3 h-3 fill-current" />
                      <span>Test Adzan</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void handleToggleTestAudio('subuh')}
                  className="px-2.5 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.15] border border-white/[0.14] text-[11px] font-medium text-white inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                  title="Uji audio /audio/adzan-subuh.ogg (khusus Subuh)"
                >
                  {testingTarget === 'subuh' ? (
                    <>
                      <Square className="w-3 h-3 fill-current" />
                      <span>Stop</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3 h-3 fill-current" />
                      <span>Test Subuh</span>
                    </>
                  )}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void handleToggleTestAudio()}
                className="px-3 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.15] border border-white/[0.14] text-[11px] font-medium text-white inline-flex items-center gap-1.5 cursor-pointer transition-colors shrink-0"
              >
                {testingTarget === 'chime' ? (
                  <>
                    <Square className="w-3 h-3 fill-current" />
                    <span>Stop Tes</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3 h-3 fill-current" />
                    <span>Test Audio</span>
                  </>
                )}
              </button>
            )}
          </div>

          {audioNotice && (
            <div className="text-[10.5px] px-2.5 py-1.5 rounded-lg bg-black border border-white/[0.10] text-white/70">
              {audioNotice}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
