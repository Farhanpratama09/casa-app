import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Calculator,
  Check,
  ChevronDown,
  Copy,
  Delete,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { useSettingsStore } from '../../stores/useSettingsStore';
import {
  fetchExchangeRates,
  focusIslandWindow,
  playChimeCue,
  writeClipboardText,
} from '../../utils/tauriBridge';
import {
  evaluateCalcExpression,
  MAX_CALC_EXPRESSION_LENGTH,
} from './calcParser';
import {
  CONVERTER_CATEGORIES,
  convertValueByCategory,
  formatFxStatusBadge,
  getCurrencyMeta,
  isExchangeRateCacheStale,
  loadCachedExchangeRates,
  sanitizeCurrencyRates,
  saveCachedExchangeRates,
  searchCurrencies,
  type CachedExchangeRates,
  type ConverterCategoryId,
} from './unitConverter';

type ActiveSubMode = 'calc' | 'convert';

interface KeypadButtonSpec {
  id: string;
  label: string;
  token?: string;
  action?: 'backspace';
  isOp?: boolean;
  title: string;
}

const KEYPAD_BUTTONS: KeypadButtonSpec[] = [
  { id: '7', label: '7', token: '7', title: 'Angka 7' },
  { id: '8', label: '8', token: '8', title: 'Angka 8' },
  { id: '9', label: '9', token: '9', title: 'Angka 9' },
  { id: '/', label: '÷', token: '/', isOp: true, title: 'Bagi (/)' },
  { id: 'backspace', label: '⌫', action: 'backspace', isOp: true, title: 'Hapus mundur (Backspace)' },

  { id: '4', label: '4', token: '4', title: 'Angka 4' },
  { id: '5', label: '5', token: '5', title: 'Angka 5' },
  { id: '6', label: '6', token: '6', title: 'Angka 6' },
  { id: '*', label: '×', token: '*', isOp: true, title: 'Kali (* atau x)' },
  { id: '(', label: '(', token: '(', isOp: true, title: 'Kurung buka (' },

  { id: '1', label: '1', token: '1', title: 'Angka 1' },
  { id: '2', label: '2', token: '2', title: 'Angka 2' },
  { id: '3', label: '3', token: '3', title: 'Angka 3' },
  { id: '-', label: '−', token: '-', isOp: true, title: 'Kurang (-)' },
  { id: ')', label: ')', token: ')', isOp: true, title: 'Kurung tutup )' },

  { id: '0', label: '0', token: '0', title: 'Angka 0' },
  { id: '.', label: '.', token: '.', title: 'Koma desimal (.)' },
  { id: '%', label: '%', token: '%', isOp: true, title: 'Persen (%)' },
  { id: '+', label: '+', token: '+', isOp: true, title: 'Tambah (+)' },
  { id: '^', label: '^', token: '^', isOp: true, title: 'Pangkat (^)' },
];

const FX_AUTO_RETRY_COOLDOWN_MS = 60_000;

export const CalculatorExpandedView: React.FC = () => {
  const { palette } = useSettingsStore();

  const [subMode, setSubMode] = useState<ActiveSubMode>('calc');

  // Calculator state
  const [expression, setExpression] = useState('100000 + 10%');
  const [copiedCalc, setCopiedCalc] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const calcInputRef = useRef<HTMLInputElement>(null);
  const keyFlashTimerRef = useRef<number | null>(null);

  // Converter state
  const [category, setCategory] = useState<ConverterCategoryId>('currency');
  const [fromUnit, setFromUnit] = useState('USD');
  const [toUnit, setToUnit] = useState('IDR');
  const [convertInput, setConvertInput] = useState('10');
  const [copiedConvert, setCopiedConvert] = useState(false);

  // Searchable currency selector overlay state
  const [pickerTarget, setPickerTarget] = useState<'from' | 'to' | null>(null);
  const [currencyQuery, setCurrencyQuery] = useState('');

  // Currency rates state (auto-fetched + 30-minute localStorage cache)
  const [fxCache, setFxCache] = useState<CachedExchangeRates>(() =>
    loadCachedExchangeRates()
  );
  const [fxLoading, setFxLoading] = useState(false);
  const [fxError, setFxError] = useState<string | null>(null);
  const lastAutoFetchRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (keyFlashTimerRef.current !== null) {
        window.clearTimeout(keyFlashTimerRef.current);
      }
    };
  }, []);

  const flashKey = useCallback((keyId: string) => {
    setActiveKey(keyId);
    if (keyFlashTimerRef.current !== null) {
      window.clearTimeout(keyFlashTimerRef.current);
    }
    keyFlashTimerRef.current = window.setTimeout(() => {
      setActiveKey(null);
      keyFlashTimerRef.current = null;
    }, 130);
  }, []);

  const calcResult = useMemo(
    () => evaluateCalcExpression(expression),
    [expression]
  );

  const activeCategoryMeta = useMemo(
    () =>
      CONVERTER_CATEGORIES.find((c) => c.id === category) ||
      CONVERTER_CATEGORIES[0],
    [category]
  );

  const convertResult = useMemo(
    () =>
      convertValueByCategory(
        category,
        convertInput,
        fromUnit,
        toUnit,
        fxCache.rates
      ),
    [category, convertInput, fromUnit, toUnit, fxCache.rates]
  );

  const filteredCurrencies = useMemo(
    () => searchCurrencies(currencyQuery, fxCache.rates),
    [currencyQuery, fxCache.rates]
  );

  const fxStatusBadge = useMemo(
    () => formatFxStatusBadge(fxCache, fxLoading, Boolean(fxError)),
    [fxCache, fxLoading, fxError]
  );

  const handleRefreshRates = useCallback(
    async (silent = false) => {
      if (fxLoading) return;
      if (!silent) playChimeCue('tap');
      setFxLoading(true);
      setFxError(null);
      try {
        const fresh = await fetchExchangeRates();
        const nextCache: CachedExchangeRates = {
          rates: sanitizeCurrencyRates(fresh.rates),
          updatedAt: fresh.updated_at || new Date().toISOString(),
          source: fresh.source,
          isLive: true,
        };
        setFxCache(nextCache);
        saveCachedExchangeRates(nextCache);
      } catch (err) {
        setFxError(typeof err === 'string' ? err : 'Offline — memakai cache.');
      } finally {
        setFxLoading(false);
      }
    },
    [fxLoading]
  );

  // Auto-fetch fresh 150+ world rates when opening Converter -> Kurs if cache is missing or > 30 mins old
  useEffect(() => {
    if (subMode !== 'convert' || category !== 'currency') return;
    if (!isExchangeRateCacheStale(fxCache)) return;
    const now = Date.now();
    if (now - lastAutoFetchRef.current < FX_AUTO_RETRY_COOLDOWN_MS) return;
    lastAutoFetchRef.current = now;
    void handleRefreshRates(true);
  }, [subMode, category, fxCache, handleRefreshRates]);

  const handleSelectCategory = (nextCat: ConverterCategoryId) => {
    playChimeCue('tap');
    const meta = CONVERTER_CATEGORIES.find((c) => c.id === nextCat);
    if (!meta) return;
    setCategory(nextCat);
    setPickerTarget(null);
    setCurrencyQuery('');
    setFromUnit(meta.defaultFrom);
    setToUnit(meta.defaultTo);
    setConvertInput(nextCat === 'timezone' ? '14:00' : nextCat === 'currency' ? '10' : '1');
    setFxError(null);
  };

  const handleSwapUnits = () => {
    playChimeCue('tap');
    const prevFrom = fromUnit;
    setFromUnit(toUnit);
    setToUnit(prevFrom);
  };

  const handleCopyCalc = useCallback(async () => {
    if (!calcResult.ok || !calcResult.copyText) return;
    playChimeCue('tap');
    const ok = await writeClipboardText(calcResult.copyText);
    if (ok) {
      setCopiedCalc(true);
      window.setTimeout(() => setCopiedCalc(false), 1400);
    }
  }, [calcResult]);

  const handleCopyConvert = async () => {
    if (!convertResult?.copyText) return;
    playChimeCue('tap');
    const ok = await writeClipboardText(convertResult.copyText);
    if (ok) {
      setCopiedConvert(true);
      window.setTimeout(() => setCopiedConvert(false), 1400);
    }
  };

  const handleKeypadPress = useCallback(
    (spec: KeypadButtonSpec) => {
      playChimeCue('tap');
      flashKey(spec.id);
      if (spec.action === 'backspace') {
        setExpression((prev) => prev.slice(0, -1));
      } else if (spec.token) {
        const tok = spec.token;
        setExpression((prev) => {
          if (prev.length >= MAX_CALC_EXPRESSION_LENGTH) return prev;
          return `${prev}${tok}`;
        });
      }
      calcInputRef.current?.focus();
    },
    [flashKey]
  );

  const handleCalcPhysicalKeyFeedback = useCallback(
    (e: React.KeyboardEvent, driveInputWhenUnfocused: boolean) => {
      e.stopPropagation();
      const rawKey = e.key;
      if (rawKey === 'Enter') {
        e.preventDefault();
        void handleCopyCalc();
        return;
      }
      if (rawKey === 'Escape') {
        e.preventDefault();
        setExpression('');
        return;
      }

      const normalizedId =
        rawKey === 'Backspace'
          ? 'backspace'
          : rawKey === 'x' || rawKey === 'X'
          ? '*'
          : rawKey;

      const matched = KEYPAD_BUTTONS.find((btn) => btn.id === normalizedId);
      if (matched) {
        flashKey(matched.id);
        if (driveInputWhenUnfocused && document.activeElement !== calcInputRef.current) {
          e.preventDefault();
          if (matched.action === 'backspace') {
            setExpression((prev) => prev.slice(0, -1));
          } else if (matched.token) {
            const tok = matched.token;
            setExpression((prev) =>
              prev.length >= MAX_CALC_EXPRESSION_LENGTH ? prev : `${prev}${tok}`
            );
          }
        }
      }
    },
    [flashKey, handleCopyCalc]
  );

  const openCurrencyPicker = (target: 'from' | 'to') => {
    playChimeCue('tap');
    setPickerTarget(target);
    setCurrencyQuery('');
    void focusIslandWindow();
  };

  const selectCurrencyFromPicker = (code: string) => {
    playChimeCue('tap');
    if (pickerTarget === 'from') {
      setFromUnit(code);
    } else if (pickerTarget === 'to') {
      setToUnit(code);
    }
    setPickerTarget(null);
    setCurrencyQuery('');
  };

  const fromCurrencyMeta = useMemo(() => getCurrencyMeta(fromUnit), [fromUnit]);
  const toCurrencyMeta = useMemo(() => getCurrencyMeta(toUnit), [toUnit]);

  return (
    <div
      data-tauri-drag-region="false"
      className="relative w-full h-full bg-[#000000] px-3.5 pt-1.5 pb-2 flex flex-col justify-between gap-1.5 select-none"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Top Sub-Mode Bar (No top operator toolbar in Calc mode) */}
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="inline-flex items-center p-[2px] rounded-full bg-[#0a0a0a] border border-white/[0.09]">
          <button
            type="button"
            onClick={() => {
              playChimeCue('tap');
              setPickerTarget(null);
              setSubMode('calc');
            }}
            className={`inline-flex items-center gap-1 px-2.5 py-[3px] rounded-full text-[9.5px] font-semibold transition-colors cursor-pointer ${
              subMode === 'calc'
                ? 'bg-white text-black'
                : 'text-white/60 hover:text-white'
            }`}
          >
            <Calculator className="w-2.5 h-2.5" />
            <span>Kalkulator</span>
          </button>
          <button
            type="button"
            onClick={() => {
              playChimeCue('tap');
              setSubMode('convert');
            }}
            className={`inline-flex items-center gap-1 px-2.5 py-[3px] rounded-full text-[9.5px] font-semibold transition-colors cursor-pointer ${
              subMode === 'convert'
                ? 'bg-white text-black'
                : 'text-white/60 hover:text-white'
            }`}
          >
            <ArrowLeftRight className="w-2.5 h-2.5" />
            <span>Konverter</span>
          </button>
        </div>

        {subMode === 'calc' ? (
          <span className="text-[8.5px] font-mono text-white/35 tracking-tight">
            x → × · Enter salin · Esc hapus
          </span>
        ) : (
          <div className="flex items-center gap-1 overflow-x-auto">
            {CONVERTER_CATEGORIES.map((cat) => {
              const active = cat.id === category;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => handleSelectCategory(cat.id)}
                  style={
                    active
                      ? {
                          borderColor: `${palette.timer}66`,
                          color: palette.timer,
                          backgroundColor: `${palette.timer}18`,
                        }
                      : undefined
                  }
                  className={`px-2 py-[2.5px] rounded-full border text-[9px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? ''
                      : 'bg-[#0a0a0a] border-white/[0.08] text-white/55 hover:text-white/90'
                  }`}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Main Content */}
      {subMode === 'calc' ? (
        <div
          data-calc-layout="split-2col"
          tabIndex={-1}
          onKeyDown={(e) => handleCalcPhysicalKeyFeedback(e, true)}
          className="flex-1 min-h-0 grid grid-cols-[minmax(0,1.06fr)_minmax(0,0.94fr)] gap-2 outline-none"
        >
          {/* Left Column: Expression Input, Live Result, C + Salin */}
          <div className="min-w-0 min-h-0 flex flex-col justify-between gap-1.5">
            <div className="flex items-center bg-[#0a0a0a] border border-white/[0.11] focus-within:border-white/30 rounded-lg px-2 h-[30px] shrink-0">
              <input
                ref={calcInputRef}
                type="text"
                value={expression}
                maxLength={MAX_CALC_EXPRESSION_LENGTH}
                onFocus={() => void focusIslandWindow()}
                onChange={(e) => setExpression(e.target.value.replace(/[xX]/g, '*'))}
                onKeyDown={(e) => handleCalcPhysicalKeyFeedback(e, false)}
                placeholder="100000 + 10% atau (25 * 4)^2"
                aria-label="Ekspresi Kalkulator"
                className="w-full bg-transparent text-[11.5px] font-mono tabular-nums text-white placeholder-white/30 outline-none"
              />
            </div>

            <div className="flex-1 min-h-0 rounded-lg bg-[#0a0a0a] border border-white/[0.09] px-2.5 py-1 flex flex-col justify-center">
              <div className="text-[7.5px] uppercase tracking-[0.08em] font-semibold text-white/40 leading-none mb-0.5">
                {calcResult.ok ? 'Hasil Real-Time' : 'Status Ekspresi'}
              </div>
              {calcResult.ok ? (
                <div
                  data-calc-result="true"
                  className="text-[19px] font-mono font-bold tabular-nums text-white truncate leading-tight"
                >
                  = {calcResult.formatted}
                </div>
              ) : (
                <div
                  style={{ color: expression.trim() ? palette.danger : 'rgba(255,255,255,0.45)' }}
                  className="text-[10.5px] font-medium truncate leading-tight"
                >
                  {calcResult.error}
                </div>
              )}
            </div>

            <div className="h-[24px] flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                data-calc-clear="true"
                onClick={() => {
                  playChimeCue('tap');
                  setExpression('');
                  calcInputRef.current?.focus();
                }}
                className="h-full px-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.15] border border-white/[0.10] text-[10px] font-mono font-semibold text-white/80 hover:text-white cursor-pointer active:scale-95 transition-all"
                title="Bersihkan seluruh ekspresi (Esc)"
              >
                C
              </button>
              <button
                type="button"
                disabled={!calcResult.ok}
                onClick={() => void handleCopyCalc()}
                style={
                  copiedCalc
                    ? {
                        borderColor: `${palette.timer}66`,
                        backgroundColor: `${palette.timer}22`,
                        color: palette.timer,
                      }
                    : undefined
                }
                className={`flex-1 h-full px-2.5 rounded-lg border text-[10px] font-semibold inline-flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95 disabled:opacity-35 disabled:cursor-not-allowed ${
                  copiedCalc
                    ? ''
                    : 'bg-white text-black border-white hover:bg-white/90'
                }`}
              >
                {copiedCalc ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                <span>{copiedCalc ? 'Tersalin' : 'Salin Hasil'}</span>
              </button>
            </div>
          </div>

          {/* Right Column: Compact 5x4 Calculator Keypad */}
          <div
            data-calc-keypad="true"
            className="min-w-0 min-h-0 grid grid-cols-5 grid-rows-4 gap-1"
          >
            {KEYPAD_BUTTONS.map((btn) => {
              const pressed = activeKey === btn.id;
              return (
                <button
                  key={btn.id}
                  type="button"
                  data-keypad-key={btn.id}
                  data-pressed={pressed ? 'true' : 'false'}
                  onClick={() => handleKeypadPress(btn)}
                  title={btn.title}
                  aria-label={btn.title}
                  className={`rounded-md border font-mono text-[11px] font-semibold flex items-center justify-center transition-all cursor-pointer active:scale-95 select-none ${
                    pressed
                      ? 'bg-white text-black border-white scale-95'
                      : btn.isOp
                      ? 'bg-white/[0.07] hover:bg-white/[0.16] border-white/[0.10] text-white/85 hover:text-white'
                      : 'bg-[#0b0b0e] hover:bg-white/[0.14] border-white/[0.08] text-white'
                  }`}
                >
                  {btn.action === 'backspace' ? (
                    <Delete className="w-3 h-3" />
                  ) : (
                    <span>{btn.label}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col justify-between gap-1.5">
          {/* Input + Searchable Currency Picker (or Select for Units) / Swap */}
          <div className="flex items-center gap-1.5 h-[36px]">
            <input
              type="text"
              value={convertInput}
              maxLength={32}
              onFocus={() => void focusIslandWindow()}
              onChange={(e) => setConvertInput(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleCopyConvert();
                }
              }}
              placeholder={category === 'timezone' ? '14:00' : 'Nilai'}
              aria-label="Nilai Konversi"
              className="w-[100px] h-full px-2.5 rounded-xl bg-[#0a0a0a] border border-white/[0.11] focus:border-white/30 text-[12px] font-mono tabular-nums text-white placeholder-white/30 outline-none shrink-0"
            />

            {category === 'currency' ? (
              <>
                <button
                  type="button"
                  data-currency-picker-trigger="from"
                  onClick={() => openCurrencyPicker('from')}
                  title={`Asal: ${fromCurrencyMeta.code} (${fromCurrencyMeta.country}) — klik untuk cari`}
                  className="flex-1 min-w-0 h-full px-2.5 rounded-xl bg-[#0a0a0a] hover:bg-white/[0.06] border border-white/[0.11] text-left flex items-center justify-between gap-1 cursor-pointer transition-colors"
                >
                  <div className="min-w-0 flex items-center gap-1.5">
                    <span className="text-[11px] font-mono font-bold text-white shrink-0">
                      {fromCurrencyMeta.code}
                    </span>
                    <span className="text-[9.5px] text-white/55 truncate">
                      {fromCurrencyMeta.country}
                    </span>
                  </div>
                  <ChevronDown className="w-3 h-3 text-white/45 shrink-0" />
                </button>

                <button
                  type="button"
                  onClick={handleSwapUnits}
                  title="Tukar mata uang"
                  className="w-[30px] h-[30px] rounded-lg bg-white/[0.06] hover:bg-white/[0.14] border border-white/[0.08] text-white/75 hover:text-white flex items-center justify-center cursor-pointer active:scale-95 shrink-0"
                >
                  <ArrowLeftRight className="w-3 h-3" />
                </button>

                <button
                  type="button"
                  data-currency-picker-trigger="to"
                  onClick={() => openCurrencyPicker('to')}
                  title={`Tujuan: ${toCurrencyMeta.code} (${toCurrencyMeta.country}) — klik untuk cari`}
                  className="flex-1 min-w-0 h-full px-2.5 rounded-xl bg-[#0a0a0a] hover:bg-white/[0.06] border border-white/[0.11] text-left flex items-center justify-between gap-1 cursor-pointer transition-colors"
                >
                  <div className="min-w-0 flex items-center gap-1.5">
                    <span className="text-[11px] font-mono font-bold text-white shrink-0">
                      {toCurrencyMeta.code}
                    </span>
                    <span className="text-[9.5px] text-white/55 truncate">
                      {toCurrencyMeta.country}
                    </span>
                  </div>
                  <ChevronDown className="w-3 h-3 text-white/45 shrink-0" />
                </button>
              </>
            ) : (
              <>
                <select
                  value={fromUnit}
                  onChange={(e) => setFromUnit(e.target.value)}
                  aria-label="Satuan Asal"
                  className="flex-1 min-w-0 h-full px-2 rounded-xl bg-[#0a0a0a] border border-white/[0.10] text-[10.5px] font-medium text-white outline-none cursor-pointer"
                >
                  {activeCategoryMeta.units.map((u) => (
                    <option key={u.id} value={u.id} className="bg-[#09090b] text-white">
                      {u.label}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={handleSwapUnits}
                  title="Tukar satuan"
                  className="w-[30px] h-[30px] rounded-lg bg-white/[0.06] hover:bg-white/[0.14] border border-white/[0.08] text-white/75 hover:text-white flex items-center justify-center cursor-pointer active:scale-95 shrink-0"
                >
                  <ArrowLeftRight className="w-3 h-3" />
                </button>

                <select
                  value={toUnit}
                  onChange={(e) => setToUnit(e.target.value)}
                  aria-label="Satuan Tujuan"
                  className="flex-1 min-w-0 h-full px-2 rounded-xl bg-[#0a0a0a] border border-white/[0.10] text-[10.5px] font-medium text-white outline-none cursor-pointer"
                >
                  {activeCategoryMeta.units.map((u) => (
                    <option key={u.id} value={u.id} className="bg-[#09090b] text-white">
                      {u.label}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>

          {/* Output + Status Badge (Live · HH:MM / Offline Cache) + Copy + Refresh */}
          <div className="flex-1 min-h-0 rounded-xl bg-[#0a0a0a] border border-white/[0.09] px-3 py-2 flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[8.5px] font-medium text-white/50 leading-none mb-1">
                <span className="uppercase tracking-[0.08em] font-semibold">
                  {activeCategoryMeta.label}
                </span>
                {category === 'currency' && (
                  <>
                    <span>·</span>
                    <span
                      data-fx-status="true"
                      className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-full bg-white/[0.05] border border-white/[0.08] truncate"
                      style={{
                        color: fxStatusBadge.isLive ? palette.rest : 'rgba(255,255,255,0.65)',
                      }}
                      title={fxError ? `${fxError} (${fxCache.source})` : fxCache.source}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{
                          backgroundColor: fxStatusBadge.isLive
                            ? palette.rest
                            : 'rgba(255,255,255,0.4)',
                        }}
                      />
                      <span className="font-mono tabular-nums">{fxStatusBadge.label}</span>
                    </span>
                  </>
                )}
              </div>
              <div
                data-convert-result="true"
                className="text-[17px] font-mono font-bold tabular-nums text-white truncate leading-tight"
              >
                {convertResult ? convertResult.formatted : '—'}
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {category === 'currency' && (
                <button
                  type="button"
                  disabled={fxLoading}
                  onClick={() => void handleRefreshRates(false)}
                  title="Perbarui kurs real-time 150+ negara lewat proxy Rust"
                  className="h-[28px] px-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.14] border border-white/[0.10] text-[9.5px] font-medium text-white/80 hover:text-white inline-flex items-center gap-1 cursor-pointer active:scale-95 disabled:opacity-45"
                >
                  <RefreshCw className={`w-2.5 h-2.5 ${fxLoading ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
              )}

              <button
                type="button"
                disabled={!convertResult}
                onClick={() => void handleCopyConvert()}
                style={
                  copiedConvert
                    ? {
                        borderColor: `${palette.timer}66`,
                        backgroundColor: `${palette.timer}22`,
                        color: palette.timer,
                      }
                    : undefined
                }
                className={`h-[28px] px-2.5 rounded-lg border text-[10px] font-semibold inline-flex items-center gap-1 transition-all cursor-pointer active:scale-95 disabled:opacity-35 ${
                  copiedConvert
                    ? ''
                    : 'bg-white text-black border-white hover:bg-white/90'
                }`}
              >
                {copiedConvert ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                <span>{copiedConvert ? 'Tersalin' : 'Salin'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Searchable 150+ World Currency Selector Overlay (Contained strictly inside 540x186 panel) */}
      {pickerTarget !== null && (
        <div
          data-currency-picker-overlay="true"
          className="absolute inset-0 z-30 bg-[#050507] px-3 pt-1.5 pb-2 flex flex-col gap-1.5"
        >
          <div className="flex items-center gap-1.5 h-[28px] shrink-0">
            <div className="flex-1 min-w-0 h-full px-2 rounded-lg bg-[#0d0d11] border border-white/[0.14] focus-within:border-white/35 flex items-center gap-1.5">
              <Search className="w-3 h-3 text-white/45 shrink-0" />
              <input
                type="text"
                autoFocus
                data-currency-search-input="true"
                value={currencyQuery}
                onFocus={() => void focusIslandWindow()}
                onChange={(e) => setCurrencyQuery(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setPickerTarget(null);
                  } else if (e.key === 'Enter' && filteredCurrencies.length > 0) {
                    e.preventDefault();
                    selectCurrencyFromPicker(filteredCurrencies[0].code);
                  }
                }}
                placeholder={`Cari ${pickerTarget === 'from' ? 'Asal' : 'Tujuan'}: USD, IDR, Arab Saudi, Korea...`}
                aria-label="Cari Mata Uang atau Negara"
                className="w-full bg-transparent text-[10.5px] text-white placeholder-white/35 outline-none"
              />
            </div>
            <span className="text-[9px] font-mono tabular-nums text-white/45 px-1.5 shrink-0">
              {filteredCurrencies.length}
            </span>
            <button
              type="button"
              onClick={() => setPickerTarget(null)}
              aria-label="Tutup pencarian mata uang"
              className="w-[26px] h-[26px] rounded-lg bg-white/[0.06] hover:bg-white/[0.16] border border-white/[0.10] text-white/70 hover:text-white flex items-center justify-center cursor-pointer shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          </div>

          <div
            onWheel={(e) => e.stopPropagation()}
            className="flex-1 min-h-0 overflow-y-auto oled-thin-scrollbar grid grid-cols-2 gap-1 pr-0.5 content-start"
          >
            {filteredCurrencies.length === 0 ? (
              <div className="col-span-2 py-6 text-center text-[10px] text-white/40">
                Mata uang tidak ditemukan untuk "{currencyQuery}"
              </div>
            ) : (
              filteredCurrencies.map((item) => {
                const selected =
                  (pickerTarget === 'from' ? fromUnit : toUnit) === item.code;
                return (
                  <button
                    key={item.code}
                    type="button"
                    data-currency-option={item.code}
                    onClick={() => selectCurrencyFromPicker(item.code)}
                    className={`px-2 py-1 rounded-lg border text-left flex items-center justify-between gap-1.5 cursor-pointer transition-colors ${
                      selected
                        ? 'bg-white text-black border-white'
                        : 'bg-[#0b0b0f] hover:bg-white/[0.10] border-white/[0.08] text-white'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[10px] font-bold shrink-0">
                          {item.code}
                        </span>
                        <span
                          className={`text-[9.5px] truncate ${
                            selected ? 'text-black/80 font-medium' : 'text-white/75'
                          }`}
                        >
                          {item.country}
                        </span>
                      </div>
                      <div
                        className={`text-[8px] truncate ${
                          selected ? 'text-black/65' : 'text-white/40'
                        }`}
                      >
                        {item.name}
                      </div>
                    </div>
                    {selected && <Check className="w-3 h-3 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
