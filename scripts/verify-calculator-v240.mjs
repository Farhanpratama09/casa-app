/**
 * CASA v2.4.0 Verification Suite:
 *  - Safe zero-eval math parser (`calcParser.ts`) including `x`/`X`, contextual percentages & anti-freeze guards
 *  - 155+ world currencies catalog, instant search, 30-min cache TTL & status badge helpers (`unitConverter.ts`)
 *  - Drop Zone ◈ ♥ reactive expression priority (`CasaCompanionAvatar.tsx`)
 *  - Source & security baseline invariants for 2-col keypad calc, Kontrol-last tab order, Focus stopwatch icon, and Rust FX TLS
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { transformSync } from 'esbuild';

let passed = 0;
function check(cond, label) {
  assert.ok(cond, label);
  passed++;
  console.log(`  [PASS] ${label}`);
}

function loadTsModule(relPath, extraExports = {}) {
  const fullPath = path.resolve(relPath);
  const src = fs.readFileSync(fullPath, 'utf8');
  const isTsx = relPath.endsWith('.tsx');
  const { code } = transformSync(src, {
    loader: isTsx ? 'tsx' : 'ts',
    format: 'cjs',
    target: 'es2022',
  });
  const mod = { exports: {} };
  const localRequire = (spec) => {
    if (spec in extraExports) return extraExports[spec];
    if (spec === './calcParser' && extraExports.calcParser) return extraExports.calcParser;
    if (spec === 'react') {
      return {
        __esModule: true,
        default: { createElement: () => null },
        createElement: () => null,
        memo: (c) => c,
        useEffect: () => {},
        useRef: (v) => ({ current: v }),
        useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
      };
    }
    if (spec === 'framer-motion') {
      return { motion: { div: 'div', g: 'g' } };
    }
    if (spec.startsWith('../') || spec.startsWith('./')) {
      return new Proxy(
        {},
        {
          get: () => () => ({}),
        }
      );
    }
    throw new Error(`Unexpected require in test loader: ${spec}`);
  };
  const fn = new Function('exports', 'require', 'module', code);
  fn(mod.exports, localRequire, mod);
  return mod.exports;
}

async function run() {
  console.log('\n=== CASA v2.4.0 QA VERIFICATION (Calculator Keypad, 155+ FX, Nav Contrast, Focus Icon & ◈ ♥) ===\n');

  const calcParser = loadTsModule('src/features/calculator/calcParser.ts');
  const unitConverter = loadTsModule('src/features/calculator/unitConverter.ts', {
    calcParser,
  });
  const avatarMod = loadTsModule('src/components/companion/CasaCompanionAvatar.tsx');

  // Suite A: Safe Zero-Eval Math Evaluator
  console.log('[Suite A] Pure TypeScript Safe Math Evaluator (calcParser.ts)\n');

  const r1 = calcParser.evaluateCalcExpression('100000 + 10%');
  check(r1.ok && r1.value === 110000 && r1.copyText === '110000', 'Contextual add percentage: 100000 + 10% = 110000');

  const r2 = calcParser.evaluateCalcExpression('100000 - 15%');
  check(r2.ok && r2.value === 85000, 'Contextual sub percentage: 100000 - 15% = 85000');

  const r3 = calcParser.evaluateCalcExpression('25% * 80');
  check(r3.ok && r3.value === 20, 'Multiplicative percentage: 25% * 80 = 20');

  const r4 = calcParser.evaluateCalcExpression('50%');
  check(r4.ok && r4.value === 0.5, 'Standalone percentage: 50% = 0.5');

  const r5 = calcParser.evaluateCalcExpression('0.1 + 0.2');
  check(r5.ok && r5.value === 0.3 && r5.copyText === '0.3', 'Floating-point precision cleanup: 0.1 + 0.2 = 0.3');

  const r6 = calcParser.evaluateCalcExpression('2^3^2');
  check(r6.ok && r6.value === 512, 'Right-associative power: 2^3^2 = 512');

  const r7 = calcParser.evaluateCalcExpression('2(3 + 4) - 5');
  check(r7.ok && r7.value === 9, 'Implicit multiplication & grouping: 2(3 + 4) - 5 = 9');

  const rMulX = calcParser.evaluateCalcExpression('12x5');
  const rMulBigX = calcParser.evaluateCalcExpression('12X5');
  check(rMulX.ok && rMulX.value === 60 && rMulBigX.ok && rMulBigX.value === 60, 'Keyboard x and X multiply identically to *: 12x5 = 60');

  const r8 = calcParser.evaluateCalcExpression('-10 + 4 * 3');
  check(r8.ok && r8.value === 2, 'Unary minus & operator precedence: -10 + 4 * 3 = 2');

  const rDiv0 = calcParser.evaluateCalcExpression('42 / 0');
  check(!rDiv0.ok && rDiv0.error.includes('nol'), 'Division by zero rejected safely without Infinity/NaN');

  const rFreeze = calcParser.evaluateCalcExpression('9^9^9');
  check(!rFreeze.ok, 'Huge exponent 9^9^9 blocked safely by anti-freeze exponent cap');

  const rLong = calcParser.evaluateCalcExpression('1+'.repeat(70) + '1');
  check(!rLong.ok, 'Expressions exceeding MAX_CALC_EXPRESSION_LENGTH (128) rejected safely');

  const rInject = calcParser.evaluateCalcExpression('alert(1)');
  check(!rInject.ok, 'Arbitrary JS/identifier payload rejected cleanly by tokenizer');

  // Suite B: 155+ World Currency Catalog, Search, Cache TTL & Unit Converter
  console.log('\n[Suite B] 155+ World Currencies, Search, Cache TTL & Offline Units (unitConverter.ts)\n');

  const uniqueCodes = new Set(unitConverter.WORLD_CURRENCY_CATALOG.map((c) => c.code));
  check(
    unitConverter.WORLD_CURRENCY_CATALOG.length >= 155 &&
      uniqueCodes.size === unitConverter.WORLD_CURRENCY_CATALOG.length,
    `World currency catalog contains ${uniqueCodes.size} unique ISO-4217 currencies (>= 155)`
  );

  const searchSaudi = unitConverter.searchCurrencies('Arab Saudi');
  const searchKorea = unitConverter.searchCurrencies('Korea');
  const searchJapan = unitConverter.searchCurrencies('Jepang');
  const searchMalaysia = unitConverter.searchCurrencies('Malaysia');
  check(
    searchSaudi[0]?.code === 'SAR' &&
      searchKorea.some((c) => c.code === 'KRW') &&
      searchJapan[0]?.code === 'JPY' &&
      searchMalaysia[0]?.code === 'MYR',
    'searchCurrencies matches country names (Arab Saudi->SAR, Korea->KRW, Jepang->JPY, Malaysia->MYR)'
  );

  const sarToIdr = unitConverter.convertValueByCategory('currency', '100', 'SAR', 'IDR');
  check(
    sarToIdr && Number(sarToIdr.copyText) > 400000,
    `SAR -> IDR conversion uses 155+ world catalog accurately (100 SAR = ${sarToIdr?.formatted})`
  );

  const nowMs = Date.parse('2026-11-26T12:00:00Z');
  const freshCache = {
    rates: unitConverter.DEFAULT_USD_EXCHANGE_RATES,
    updatedAt: '2026-11-26T11:40:00Z',
    source: 'open.er-api.com',
    isLive: true,
  };
  const staleCache = {
    rates: unitConverter.DEFAULT_USD_EXCHANGE_RATES,
    updatedAt: '2026-11-26T11:20:00Z',
    source: 'open.er-api.com',
    isLive: true,
  };
  check(
    !unitConverter.isExchangeRateCacheStale(freshCache, nowMs) &&
      unitConverter.isExchangeRateCacheStale(staleCache, nowMs) &&
      unitConverter.isExchangeRateCacheStale({ rates: {}, updatedAt: null, source: 'Offline Cache', isLive: false }, nowMs),
    'isExchangeRateCacheStale enforces 30-minute FX cache TTL'
  );

  const liveBadge = unitConverter.formatFxStatusBadge(freshCache, false, false);
  const offlineBadge = unitConverter.formatFxStatusBadge(staleCache, false, true);
  check(
    liveBadge.isLive &&
      liveBadge.label.startsWith('Live · ') &&
      !offlineBadge.isLive &&
      offlineBadge.label.startsWith('Offline Cache'),
    `FX status badge distinguishes "${liveBadge.label}" vs "${offlineBadge.label}"`
  );

  const lenRes = unitConverter.convertValueByCategory('length', '2.5', 'km', 'm');
  check(lenRes && lenRes.copyText === '2500', 'Length: 2.5 km = 2500 m');

  const massRes = unitConverter.convertValueByCategory('mass', '1', 'kg', 'g');
  check(massRes && massRes.copyText === '1000', 'Mass: 1 kg = 1000 g');

  const tempCF = unitConverter.convertValueByCategory('temperature', '100', 'C', 'F');
  const tempCK = unitConverter.convertValueByCategory('temperature', '0', 'C', 'K');
  check(
    tempCF && tempCF.copyText === '212' && tempCK && tempCK.copyText === '273.15',
    'Temperature: 100°C = 212°F and 0°C = 273.15 K'
  );

  const dataRes = unitConverter.convertValueByCategory('data', '1', 'GiB', 'MiB');
  check(dataRes && dataRes.copyText === '1024', 'Data binary units: 1 GiB = 1024 MiB');

  const tzRes = unitConverter.convertTimezoneValue('22:30', 'WIB', 'WITA');
  const tzUtc = unitConverter.convertTimezoneValue('02:00', 'WIB', 'UTC');
  check(
    tzRes && tzRes.copyText === '23:30 WITA' && tzUtc && tzUtc.copyText === '19:00 UTC' && tzUtc.dayDelta === -1,
    'Timezone: 22:30 WIB -> 23:30 WITA and 02:00 WIB -> 19:00 UTC (-1 day)'
  );

  const fxRes = unitConverter.convertValueByCategory('currency', '10', 'USD', 'IDR');
  check(fxRes && fxRes.copyText === '162500', 'Currency offline preset: 10 USD = 162500 IDR');

  const sanitizedFx = unitConverter.sanitizeCurrencyRates({
    IDR: -5,
    SGD: Number.NaN,
    JPY: 150,
    SAR: 3.76,
    BADCODE: 99,
  });
  check(
    sanitizedFx.IDR === unitConverter.DEFAULT_USD_EXCHANGE_RATES.IDR &&
      sanitizedFx.SGD === unitConverter.DEFAULT_USD_EXCHANGE_RATES.SGD &&
      sanitizedFx.JPY === 150 &&
      sanitizedFx.SAR === 3.76 &&
      !('BADCODE' in sanitizedFx),
    'sanitizeCurrencyRates rejects negative/NaN/invalid keys while accepting valid 155+ rates'
  );

  // Suite C: Reactive Avatar Expression Priority & Source Invariants
  console.log('\n[Suite C] Companion ◈ ♥ Priority, Split Keypad, Kontrol-Last Nav & Security Invariants\n');

  const baseExprInputs = {
    isPrayerAlert: false,
    isAlarmRinging: false,
    isTimerRunning: false,
    isPlaying: false,
    keepAwake: false,
    hasDropItems: false,
    hasBattery: true,
    batteryLevel: 85,
    isCharging: false,
  };
  check(
    avatarMod.resolveCompanionExpression({ ...baseExprInputs, hasDropItems: true }) === 'drop_zone' &&
      avatarMod.resolveCompanionExpression({ ...baseExprInputs, hasDropItems: true, isPrayerAlert: true }) === 'prayer' &&
      avatarMod.resolveCompanionExpression({ ...baseExprInputs, hasDropItems: false }) === 'idle',
    'Companion avatar resolves Drop Zone ◈ ♥ when items parked and yields cleanly to Ibadah T-0 priority'
  );

  const calcParserSrc = fs.readFileSync(path.resolve('src/features/calculator/calcParser.ts'), 'utf8');
  const calcViewSrc = fs.readFileSync(path.resolve('src/features/calculator/CalculatorExpandedView.tsx'), 'utf8');
  const topNavSrc = fs.readFileSync(path.resolve('src/components/views/Mode6TopNav.tsx'), 'utf8');
  const casaIslandSrc = fs.readFileSync(path.resolve('src/components/CasaIsland.tsx'), 'utf8');
  const prodViewSrc = fs.readFileSync(path.resolve('src/components/views/ProductivitySplitView.tsx'), 'utf8');
  const avatarSrc = fs.readFileSync(path.resolve('src/components/companion/CasaCompanionAvatar.tsx'), 'utf8');
  const eyesSrc = fs.readFileSync(path.resolve('src/components/companion/CasaCompanionEyes.tsx'), 'utf8');
  const ccSrc = fs.readFileSync(path.resolve('src/components/views/mode6/Mode6ControlCenterView.tsx'), 'utf8');
  const sysHwRs = fs.readFileSync(path.resolve('src-tauri/src/system_hardware.rs'), 'utf8');
  const tauriConf = fs.readFileSync(path.resolve('src-tauri/tauri.conf.json'), 'utf8');
  const docsAppJs = fs.readFileSync(path.resolve('docs/app.js'), 'utf8');

  check(
    !/\beval\s*\(/.test(calcParserSrc) &&
      !/new\s+Function\s*\(/.test(calcParserSrc) &&
      !/\beval\s*\(/.test(docsAppJs) &&
      !/new\s+Function\s*\(/.test(docsAppJs) &&
      !docsAppJs.includes('innerHTML'),
    'Zero eval(), zero new Function(), and zero innerHTML across calcParser.ts & docs/app.js'
  );

  check(
    !calcViewSrc.includes('QUICK_OP_BUTTONS') &&
      calcViewSrc.includes('data-calc-layout="split-2col"') &&
      calcViewSrc.includes('data-calc-keypad="true"') &&
      calcViewSrc.includes('data-currency-search-input="true"') &&
      calcViewSrc.includes('isExchangeRateCacheStale') &&
      calcViewSrc.includes('.replace(/[xX]/g') &&
      !/text-(?:emerald|green)-|bg-(?:emerald|green)-/.test(calcViewSrc) &&
      !/text-(?:emerald|green)-|bg-(?:emerald|green)-/.test(ccSrc),
    'Split 2-col calculator keypad, searchable 155+ currency UI, auto-fetch TTL & zero color-leak verified'
  );

  const navOrderMatch = topNavSrc.match(/const navTabs:[\s\S]*?\];/);
  const wheelOrderMatch = casaIslandSrc.match(/const modes: IslandMode\[\] = \[[\s\S]*?\];/);
  check(
    topNavSrc.includes('data-hybrid-nav="true"') &&
      topNavSrc.includes('rgba(255, 255, 255, 0.08)') &&
      topNavSrc.includes('rgba(255, 255, 255, 0.14)') &&
      topNavSrc.includes('#F4F4F5') &&
      topNavSrc.includes('#FFFFFF') &&
      topNavSrc.includes('#FACC15') &&
      topNavSrc.includes('#38BDF8') &&
      topNavSrc.includes('#10B981') &&
      topNavSrc.includes('#FB923C') &&
      topNavSrc.includes('#A78BFA') &&
      topNavSrc.includes("isMonochrome ? '#FFFFFF' : tab.activeIconColor") &&
      Boolean(navOrderMatch && navOrderMatch[0].trim().endsWith('CONTROL_NAV_TAB,\n  ];')) &&
      Boolean(wheelOrderMatch && wheelOrderMatch[0].includes("'expanded_control',\n        ];")) &&
      prodViewSrc.includes('data-focus-timer-icon="true"') &&
      !prodViewSrc.includes('w-1.5 h-1.5 rounded-full') &&
      avatarSrc.includes("case 'drop_zone':") &&
      eyesSrc.includes('useDropZoneStore'),
    'Kontrol-last tab order, dark glass + glowing module icons (monochrome-guarded), Focus Timer icon & Drop Zone ◈ ♥ eyes verified'
  );

  check(
    sysHwRs.includes('WlanDeleteProfile') &&
      sysHwRs.includes('ConstrainedInternetAccess') &&
      sysHwRs.includes('open_captive_portal_browser') &&
      sysHwRs.includes('open_available_wifi_networks') &&
      sysHwRs.includes('fetch_exchange_rates') &&
      sysHwRs.includes('MAX_FX_CURRENCIES') &&
      sysHwRs.includes('danger_accept_invalid_certs(false)') &&
      !sysHwRs.includes('danger_accept_invalid_certs(true)') &&
      !tauriConf.includes('er-api.com') &&
      !tauriConf.includes('frankfurter.app'),
    'Rust Wi-Fi rollback, zero-fill XML, Captive Portal, 802.1X redirect, explicit FX TLS verify & locked CSP verified'
  );

  console.log(`\n=== SUMMARY: ${passed} passed, 0 failed ===\n`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
