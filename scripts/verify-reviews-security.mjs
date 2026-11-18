/**
 * Node.js Security & Anti-Spam Unit Tests for Supabase Review Edge Modules
 * Exercises `spam.ts` (`evaluateReviewSubmission`) and `_shared/helpers.ts`
 * (`timingSafeEqual`, `normalizeIpPrefix`, `hmacHashIp`, `escapeTelegramHtml`).
 */

import assert from 'node:assert/strict';
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

  console.log(`\n  REVIEWS SECURITY UNIT TESTS: ${passed} passed, 0 failed\n`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
