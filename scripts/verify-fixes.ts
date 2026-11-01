/**
 * Critical QA Auditor Verification Script (CASA Engine)
 * Verifies:
 * 1. "Boyfriend" by BOYFRIEND -> selects K-Pop BOYFRIEND lyrics (never Dove Cameron).
 * 2. "Seven (feat. Latto) - Explicit Ver." by Jung Kook -> sanitizes title & selects studio recording with valid sync.
 * 3. Strict Metadata Validator & Artist Disqualification logic assertions.
 */

import {
  fetchLyrics,
  sanitizeTrackTitleForSearch,
  sanitizeArtistNameForSearch,
  calculateMetadataSimilarity,
  flushLyricsCache,
} from '../src/utils/lyricsService';

async function runTests() {
  console.log('====================================================');
  console.log('   CASA CRITICAL QA AUDITOR: MANDATORY VERIFICATION ');
  console.log('====================================================\n');

  // Step 0: Flush any existing cache to test live network resolution
  flushLyricsCache();

  let allPassed = true;

  // -------------------------------------------------------------
  // TEST 1: Title & Artist Sanitization
  // -------------------------------------------------------------
  console.log('[TEST 1] Testing Title & Artist Sanitization...');
  const dirtyTitle = 'Seven (feat. Latto) - Explicit Ver.';
  const dirtyArtist = 'Jung Kook, Latto';
  const cleanTitle = sanitizeTrackTitleForSearch(dirtyTitle);
  const cleanArtist = sanitizeArtistNameForSearch(dirtyArtist);

  console.log(`  Raw: "${dirtyTitle}" by "${dirtyArtist}"`);
  console.log(`  Clean: "${cleanTitle}" by "${cleanArtist}"`);

  if (cleanTitle !== 'Seven') {
    console.error(`  FAIL: Expected title 'Seven', got '${cleanTitle}'`);
    allPassed = false;
  } else if (cleanArtist !== 'Jung Kook') {
    console.error(`  FAIL: Expected artist 'Jung Kook', got '${cleanArtist}'`);
    allPassed = false;
  } else {
    console.log('  PASS: Title & artist cleanly sanitized.\n');
  }

  // -------------------------------------------------------------
  // TEST 2: Strict Artist Similarity & Disqualification
  // -------------------------------------------------------------
  console.log('[TEST 2] Testing Metadata Similarity Disqualification...');
  const simBoyfriendSame = calculateMetadataSimilarity('BOYFRIEND', 'Boyfriend');
  const simDoveCameron = calculateMetadataSimilarity('BOYFRIEND', 'Dove Cameron');
  const simJustinBieber = calculateMetadataSimilarity('BOYFRIEND', 'Justin Bieber - Boyfriend');
  const simAriana = calculateMetadataSimilarity('BOYFRIEND', 'Ariana Grande, Social House, Boyfriend, 2019');

  console.log(`  Similarity ('BOYFRIEND' vs 'Boyfriend'): ${simBoyfriendSame.toFixed(3)} (Expect >= 0.60)`);
  console.log(`  Similarity ('BOYFRIEND' vs 'Dove Cameron'): ${simDoveCameron.toFixed(3)} (Expect < 0.60)`);
  console.log(`  Similarity ('BOYFRIEND' vs 'Justin Bieber - Boyfriend'): ${simJustinBieber.toFixed(3)} (Expect < 0.60)`);
  console.log(`  Similarity ('BOYFRIEND' vs 'Ariana Grande...'): ${simAriana.toFixed(3)} (Expect < 0.60)`);

  if (simBoyfriendSame < 0.60 || simDoveCameron >= 0.60 || simJustinBieber >= 0.60 || simAriana >= 0.60) {
    console.error('  FAIL: Disqualification threshold violated!');
    allPassed = false;
  } else {
    console.log('  PASS: Disqualification rules mathematically eliminate false artists.\n');
  }

  // -------------------------------------------------------------
  // TEST 3: Live Fetch - "Boyfriend" by BOYFRIEND
  // -------------------------------------------------------------
  console.log('[TEST 3] Fetching lyrics for Track: "Boyfriend", Artist: "BOYFRIEND"...');
  const boyfriendResult = await fetchLyrics('Boyfriend', 'BOYFRIEND', 187, true);

  console.log(`  Is Synced: ${boyfriendResult.isSynced}`);
  console.log(`  Line Count: ${boyfriendResult.lines.length}`);

  if (!boyfriendResult.isSynced || boyfriendResult.lines.length === 0) {
    console.error('  FAIL: No synced lyrics returned for BOYFRIEND!');
    allPassed = false;
  } else {
    const fullText = boyfriendResult.lines.map((l) => l.text).join(' ');
    const isDoveCameron = fullText.toLowerCase().includes('better boyfriend than him') ||
                          fullText.toLowerCase().includes('dove cameron');
    const isBoyfriendKpop = fullText.includes('너의 boyfriend') ||
                            fullText.includes('girlfriend') ||
                            fullText.includes('Would you be my girlfriend');

    console.log(`  Sample Line 0: "${boyfriendResult.lines[0]?.text}" (${boyfriendResult.lines[0]?.timeMs}ms)`);
    console.log(`  Sample Line 2: "${boyfriendResult.lines[2]?.text}" (${boyfriendResult.lines[2]?.timeMs}ms)`);
    console.log(`  Is Dove Cameron lyrics detected: ${isDoveCameron}`);
    console.log(`  Is authentic BOYFRIEND (K-Pop) lyrics verified: ${isBoyfriendKpop}`);

    if (isDoveCameron) {
      console.error('  CRITICAL FAIL: Dove Cameron lyrics selected instead of BOYFRIEND!');
      allPassed = false;
    } else if (!isBoyfriendKpop) {
      console.error('  FAIL: Lyrics do not match authentic BOYFRIEND track!');
      allPassed = false;
    } else {
      console.log('  PASS: Correct K-Pop BOYFRIEND track selected with zero false artist crossover.\n');
    }
  }

  // -------------------------------------------------------------
  // TEST 4: Live Fetch - "Seven (feat. Latto) - Explicit Ver." by Jung Kook
  // -------------------------------------------------------------
  console.log('[TEST 4] Fetching lyrics for Track: "Seven (feat. Latto) - Explicit Ver.", Artist: "Jung Kook"...');
  const sevenResult = await fetchLyrics('Seven (feat. Latto) - Explicit Ver.', 'Jung Kook', 184, true);

  console.log(`  Is Synced: ${sevenResult.isSynced}`);
  console.log(`  Line Count: ${sevenResult.lines.length}`);

  if (!sevenResult.isSynced || sevenResult.lines.length === 0) {
    console.error('  FAIL: No synced lyrics returned for Jung Kook - Seven!');
    allPassed = false;
  } else {
    const fullText = sevenResult.lines.map((l) => l.text).join(' ');
    const firstLineMs = sevenResult.lines[0].timeMs;
    const hasSevenLyrics = fullText.toLowerCase().includes('monday') ||
                          fullText.toLowerCase().includes('weight of the world') ||
                          fullText.toLowerCase().includes('seven days a week');

    console.log(`  Sample Line 0: "${sevenResult.lines[0]?.text}" (${firstLineMs}ms)`);
    console.log(`  Sample Line 1: "${sevenResult.lines[1]?.text}" (${sevenResult.lines[1]?.timeMs}ms)`);
    console.log(`  Has Seven lyrics content: ${hasSevenLyrics}`);
    console.log(`  First vocal offset: ${firstLineMs}ms (Valid studio offset: < 15000ms)`);

    if (!hasSevenLyrics) {
      console.error('  FAIL: Lyrics do not match Jung Kook - Seven!');
      allPassed = false;
    } else if (firstLineMs > 15000) {
      console.error('  FAIL: First vocal offset is excessively delayed (> 15s MV intro)!');
      allPassed = false;
    } else {
      console.log('  PASS: Jung Kook Seven studio master recording selected with precision vocal sync.\n');
    }
  }

  console.log('====================================================');
  if (allPassed) {
    console.log('   ALL CRITICAL QA LOGIC ASSERTIONS PASSED (100%)    ');
  } else {
    console.log('   VERIFICATION FAILED — REVIEW ERRORS ABOVE       ');
    process.exit(1);
  }
  console.log('====================================================');
}

runTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
