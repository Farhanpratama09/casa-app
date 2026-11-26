/**
 * Node.js Security & Anti-Spam Unit Tests for Supabase Review Edge Modules
 * Exercises `spam.ts` (`evaluateReviewSubmission`) and `_shared/helpers.ts`
 * (`timingSafeEqual`, `normalizeIpPrefix`, `hmacHashIp`, `escapeTelegramHtml`).
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  containsDisallowedUrl,
  containsSpamKeyword,
  evaluateReviewSubmission,
} from '../supabase/functions/submit-review/spam.ts';
import {
  escapeTelegramHtml,
  hmacHashIp,
  normalizeIpPrefix,
  timingSafeEqual,
} from '../supabase/functions/_shared/helpers.ts';

let passed = 0;
function check(cond, label) {
  assert.ok(cond, label);
  passed++;
  console.log(`  [PASS] ${label}`);
}

async function run() {
  console.log('\n[CASA Reviews Security & Anti-Spam Unit Tests]\n');

  // 1. Legitimate technical reviews (no false positives on "time slot", "deposit", version numbers)
  const legit1 = evaluateReviewSubmission({
    author_name: 'Raka W.',
    rating: 5,
    comment: 'Timer Pomodoro membantu mengatur time slot kerja, v2.0.3 sangat ringan saat idle!',
    website_hp: '',
    elapsed_ms: 6200,
  });
  check(legit1.action === 'allow', 'Allows normal review with "time slot" and "v2.0.3"');

  const legit2 = evaluateReviewSubmission({
    author_name: 'Dina',
    rating: 4,
    comment: 'No deposit needed, clean OLED notch even when Chrome is open on monitor 2.',
    website_hp: '',
    elapsed_ms: 4800,
  });
  check(legit2.action === 'allow', 'Allows review containing "deposit" (no false positive on "depo")');

  const legitDotSentence = evaluateReviewSubmission({
    author_name: 'Aria',
    rating: 5,
    comment: 'Desain hitam pekat sangat rapi. Ini aplikasi Windows terbaik sejauh ini.',
    website_hp: '',
    elapsed_ms: 5100,
  });
  check(legitDotSentence.action === 'allow', 'Allows period-space prose (no false positive on .id/.io)');

  // 2. Polite rejection for URLs / links (guides to GitHub Discussions)
  for (const urlSample of [
    'Cek screenshot bug di https://example.com/bug.png',
    'Ada log error di github.io/test',
    'Hubungi saya di t.me/user123 atau wa.me/6281234',
    'Info lanjut www.casa-bug.xyz/log',
  ]) {
    const res = evaluateReviewSubmission({
      author_name: 'Tester',
      rating: 3,
      comment: urlSample,
      website_hp: '',
      elapsed_ms: 5000,
    });
    check(res.action === 'reject_url', `Politely rejects URL (${urlSample.slice(0, 32)}...)`);
  }

  // 3. Silent drop for honeypot & fast automated submission (< 2500ms or skewed negative)
  check(
    evaluateReviewSubmission({
      author_name: 'Bot',
      rating: 5,
      comment: 'Bagus sekali',
      website_hp: 'https://bot.spam',
      elapsed_ms: 9000,
    }).action === 'silent_drop',
    'Silent-drops filled honeypot field'
  );

  check(
    evaluateReviewSubmission({
      author_name: 'FastBot',
      rating: 5,
      comment: 'Mantap aplikasinya',
      website_hp: '',
      elapsed_ms: 950,
    }).action === 'silent_drop',
    'Silent-drops instant submission (< 2500ms)'
  );

  check(
    evaluateReviewSubmission({
      author_name: 'NegBot',
      rating: 5,
      comment: 'Mantap aplikasinya',
      website_hp: '',
      elapsed_ms: -200,
    }).action === 'silent_drop',
    'Silent-drops invalid/negative elapsed_ms'
  );

  // 4. Silent drop for gambling/spam keywords including NFKC fullwidth, zero-width & leetspeak
  for (const spamText of [
    'Situs slot terpercaya hari ini',
    'Daftar g4c0r maxw1n sekarang',
    'z\u200be\u200bus perkalian 500',
    'Bonus wd cepat tanpa syarat',
    '\uff53\uff4c\uff4f\uff54 terbaik dan togel',
    'Main casino dan judi online aman',
  ]) {
    const spamRes = evaluateReviewSubmission({
      author_name: 'Promoter',
      rating: 5,
      comment: spamText,
      website_hp: '',
      elapsed_ms: 8000,
    });
    check(spamRes.action === 'silent_drop', `Silent-drops obfuscated spam (${spamText.slice(0, 26)})`);
  }

  check(containsDisallowedUrl('Lihat di docs.casa.id/demo') === true, 'containsDisallowedUrl catches subdomains');
  check(containsSpamKeyword('Bagus untuk atur time   slot belajar!') === false, 'BENIGN_SLOT_PHRASES handles multi-space "time   slot"');

  // 5. Security helpers: timingSafeEqual, HTML escaping, IPv6 /64 normalization & salted HMAC
  check(timingSafeEqual('secret-abc-123', 'secret-abc-123') === true, 'timingSafeEqual true on exact match');
  check(timingSafeEqual('secret-abc-123', 'secret-abc-124') === false, 'timingSafeEqual false on diff byte');
  check(timingSafeEqual('short', 'much-longer-secret') === false, 'timingSafeEqual false on diff length');

  const escaped = escapeTelegramHtml('<script>alert("xss") & </script>');
  check(
    escaped === '&lt;script&gt;alert(&quot;xss&quot;) &amp; &lt;/script&gt;',
    'escapeTelegramHtml neutralizes HTML injection tags'
  );

  const v6a = normalizeIpPrefix('2001:db8:abcd:12::cafe');
  const v6b = normalizeIpPrefix('2001:0DB8:ABCD:0012:9999::1');
  check(v6a === v6b && v6a === '2001:0db8:abcd:0012::/64', `IPv6 grouped to /64 prefix (${v6a})`);

  const h1 = await hmacHashIp('2001:db8:abcd:12::1', 'test-salt-0123456789');
  const h2 = await hmacHashIp('2001:db8:abcd:12:ffff::99', 'test-salt-0123456789');
  const hDiffSalt = await hmacHashIp('2001:db8:abcd:12::1', 'other-salt-0123456789');
  check(h1 === h2 && h1 !== hDiffSalt && /^[0-9a-f]{64}$/.test(h1), 'HMAC-SHA256 groups /64 IPv6 & depends on salt');

  // 6. CASA v2.3.2 Security Hardening Baseline Checks (All 14 Audit Findings)
  console.log('\n[CASA v2.3.2 Security Hardening Baseline Checks]\n');
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const readRepo = (rel) => readFileSync(resolve(rootDir, rel), 'utf8');

  const connectHpRs = readRepo('src-tauri/src/connect_hp.rs');
  const nativeAudioRs = readRepo('src-tauri/src/native_audio.rs');
  const spotifyOauthRs = readRepo('src-tauri/src/spotify_oauth.rs');
  const securityUtilsRs = readRepo('src-tauri/src/security_utils.rs');
  const dropZoneRs = readRepo('src-tauri/src/drop_zone.rs');
  const prayerRs = readRepo('src-tauri/src/prayer.rs');
  const systemHardwareRs = readRepo('src-tauri/src/system_hardware.rs');
  const gsmtcRs = readRepo('src-tauri/src/media/gsmtc.rs');
  const spotifyWin32Rs = readRepo('src-tauri/src/media/providers/spotify_win32.rs');
  const hitboxRs = readRepo('src-tauri/src/hitbox.rs');
  const libRs = readRepo('src-tauri/src/lib.rs');
  const spotifyServiceTs = readRepo('src/utils/spotifyService.ts');
  const envExample = readRepo('.env.example');
  const indexHtml = readRepo('index.html');
  const capDefault = JSON.parse(readRepo('src-tauri/capabilities/default.json'));
  const capMain = JSON.parse(readRepo('src-tauri/capabilities/main-window.json'));
  const capSettings = JSON.parse(readRepo('src-tauri/capabilities/settings-window.json'));

  // HIGH-01 & MED-05: Axum middleware auth/origin/host before extractors, per-route body limits, WS/batch caps, headers, MOTW
  check(
    connectHpRs.includes('DefaultBodyLimit::max(MAX_DEFAULT_HTTP_BODY_BYTES)') &&
      connectHpRs.includes('DefaultBodyLimit::disable()') &&
      connectHpRs.includes('from_fn_with_state') &&
      connectHpRs.includes('is_allowed_host') &&
      connectHpRs.includes('X_FRAME_OPTIONS') &&
      connectHpRs.includes('MAX_WS_CLIENTS') &&
      connectHpRs.includes('MAX_BATCH_FOLDERS_PER_SESSION') &&
      connectHpRs.includes('write_mark_of_the_web'),
    'HIGH-01/MED-05: connect_hp.rs enforces middleware auth/Host/Origin, per-route body limits, WS/batch caps, headers & MOTW'
  );

  // HIGH-02 & LOW-05 (proxy): Pinned yt-dlp SHA-256 verification before rename & exec + bounded cache & no invalid-TLS override
  check(
    nativeAudioRs.includes('YTDLP_PINNED_TAG') &&
      nativeAudioRs.includes('verify_ytdlp_binary_sha256') &&
      nativeAudioRs.includes('YTDLP_DOWNLOAD_TIMEOUT_SECS') &&
      nativeAudioRs.includes('YTDLP_MAX_BINARY_BYTES') &&
      nativeAudioRs.includes('StreamRegistryCache') &&
      nativeAudioRs.includes('MAX_STREAM_REGISTRY_ENTRIES') &&
      !nativeAudioRs.includes('danger_accept_invalid_certs(true)'),
    'HIGH-02/LOW-05: native_audio.rs enforces pinned yt-dlp SHA-256 on download & exec, bounded stream cache & TLS verification'
  );

  // MED-01 & MED-02: PKCE S256 OAuth + DPAPI storage + zero frontend client_secret
  check(
    spotifyOauthRs.includes('code_challenge_method=S256') &&
      spotifyOauthRs.includes('spotify_tokens.dpapi') &&
      spotifyOauthRs.includes('ct_eq') &&
      securityUtilsRs.includes('CryptProtectData') &&
      securityUtilsRs.includes('CryptUnprotectData') &&
      spotifyServiceTs.includes('saveSpotifyUserTokens') &&
      spotifyServiceTs.includes('clearSpotifyUserTokens') &&
      !spotifyServiceTs.includes('VITE_SPOTIFY_CLIENT_SECRET') &&
      !envExample.includes('VITE_SPOTIFY_CLIENT_SECRET'),
    'MED-01/MED-02: Spotify OAuth uses PKCE S256 + DPAPI storage with zero shipped client_secret'
  );

  // MED-03: In-process Shell/PIDL API, safe rundll32 SystemRoot resolution, COM RAII guards
  check(
    dropZoneRs.includes('ILCreateFromPathW') &&
      dropZoneRs.includes('SHOpenFolderAndSelectItems') &&
      dropZoneRs.includes('ShellExecuteW') &&
      dropZoneRs.includes('ComGuard::init_sta') &&
      prayerRs.includes('SystemRoot') &&
      prayerRs.includes('rundll32.exe') &&
      prayerRs.includes('ComGuard::init_mta') &&
      securityUtilsRs.includes('pub fn init_mta') &&
      securityUtilsRs.includes('pub fn init_sta'),
    'MED-03: drop_zone.rs & prayer.rs avoid shell argument injection and pair COM lifetimes via ComGuard'
  );

  // MED-04: Typed #[interface] COM for IPolicyConfig + active endpoint validation (no raw vtable transmute)
  check(
    systemHardwareRs.includes('trait IPolicyConfig: IUnknown') &&
      systemHardwareRs.includes('trait IPolicyConfigVista: IUnknown') &&
      !systemHardwareRs.includes('std::mem::transmute'),
    'MED-04: system_hardware.rs uses typed windows_core::interface for IPolicyConfig without raw transmute'
  );

  // MED-06: Capabilities split per window + narrow file-only asset protocol scope
  check(
    !capDefault.permissions.includes('core:window:allow-create') &&
      !capDefault.permissions.includes('core:webview:allow-create-webview-window') &&
      !capDefault.permissions.includes('process:allow-restart') &&
      capMain.windows.length === 1 &&
      capMain.windows[0] === 'main' &&
      capMain.permissions.includes('core:window:allow-create') &&
      capSettings.windows.length === 1 &&
      capSettings.windows[0] === 'settings' &&
      capSettings.permissions.includes('process:allow-restart') &&
      dropZoneRs.includes('is_blocked_asset_scope_path') &&
      !dropZoneRs.includes('allow_directory'),
    'MED-06: Least-privilege capabilities split across main/settings windows & file-only asset scope'
  );

  // LOW-01..LOW-06: Dangerous exts & reserved DOS device names, GSMTC cap, spotify.exe URI guard, COM RAII, bounded UI rects, no orphan CDN links
  check(
    dropZoneRs.includes('is_dangerous_executable_extension') &&
      dropZoneRs.includes('is_windows_reserved_device_name') &&
      gsmtcRs.includes('MAX_GSMTC_THUMBNAIL_BYTES') &&
      spotifyWin32Rs.includes('sanitize_spotify_uri') &&
      spotifyWin32Rs.includes('spotify.exe') &&
      hitboxRs.includes('normalize_hit_rect') &&
      libRs.includes('adjust_window_size') &&
      !systemHardwareRs.includes('CoInitializeEx') &&
      !indexHtml.includes('fonts.googleapis.com') &&
      existsSync(resolve(rootDir, '.agent/SECURITY_BASELINE.md')),
    'LOW-01..LOW-06: Executables/DOS names blocked, GSMTC & hitbox bounded, Spotify URI/exe verified, COM cleaned & zero orphan CDN links'
  );

  // v2.4.0 Security Guardrails: Wi-Fi XML control-char/PSK guard + zero-fill + WlanDeleteProfile rollback + dedicated ShellExecuteW + zero-eval Calc + Rust FX proxy
  const calcParserTs = readRepo('src/features/calculator/calcParser.ts');
  check(
    systemHardwareRs.includes('has_forbidden_xml_control_chars') &&
      systemHardwareRs.includes('validate_wifi_passphrase') &&
      systemHardwareRs.includes('xml_wide.fill(0)') &&
      systemHardwareRs.includes('WlanDeleteProfile') &&
      systemHardwareRs.includes('open_captive_portal_browser') &&
      systemHardwareRs.includes('open_available_wifi_networks') &&
      systemHardwareRs.includes('fetch_exchange_rates') &&
      systemHardwareRs.includes('danger_accept_invalid_certs(false)') &&
      !systemHardwareRs.includes('danger_accept_invalid_certs(true)') &&
      !/\beval\s*\(/.test(calcParserTs) &&
      !/new\s+Function\s*\(/.test(calcParserTs),
    'v2.4.0 Guardrails: Wi-Fi XML/PSK zero-fill & rollback, pinned ShellExecuteW portal/802.1X, Rust FX proxy & zero-eval calcParser'
  );

  console.log(`\n  REVIEWS SECURITY & HARDENING TESTS: ${passed} passed, 0 failed\n`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
