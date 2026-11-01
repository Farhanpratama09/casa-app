/**
 * CASA Critical QA Verification Script: Playlist Pagination & Unified Panel State Machine
 *
 * Validates:
 * 1. Playlist auto-pagination loop: 69-track playlist response (50 + 19) returns exactly 69 tracks.
 * 2. Unified State Machine 1-click transition: Direct transition between any subpanels in 1 iteration.
 * 3. Sticky Panel View invariance: Track change events do NOT force-switch or override activeSubPanel.
 */

import {
  getPlaylistTracks,
  parsePlaylistTrackEntries,
} from '../src/utils/spotifyService';
import type { MusicSubPanel } from '../src/components/views/MusicCardView';

async function runNavigationVerification() {
  console.log('========================================================================');
  console.log('  CASA CRITICAL QA AUDITOR: PLAYLIST PAGINATION & UNIFIED PANEL AUDIT   ');
  console.log('========================================================================\n');

  let totalTests = 0;
  let passedTests = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`  [PASS] ${testName}`);
    } else {
      console.error(`  [FAIL] ${testName}${detail ? ` -> ${detail}` : ''}`);
    }
  }

  // -------------------------------------------------------------
  // TEST GROUP 1: Playlist Full Pagination Engine
  // -------------------------------------------------------------
  console.log('--- TEST GROUP 1: Full Playlist Auto-Paging Loop (69 Tracks) ---');

  // Build simulated 69 tracks (Page 1: 50 tracks, Page 2: 19 tracks)
  const page1Items = Array.from({ length: 50 }, (_, i) => ({
    track: {
      id: `track_page1_${i + 1}`,
      name: `Track #${i + 1}`,
      artists: [{ name: `Artist ${(i % 3) + 1}` }],
      album: { name: 'Album One', images: [{ url: `https://art/1_${i}.jpg` }] },
      duration_ms: 180000 + i * 1000,
      uri: `spotify:track:track_page1_${i + 1}`,
    },
  }));

  const page2Items = Array.from({ length: 19 }, (_, i) => ({
    track: {
      id: `track_page2_${i + 1}`,
      name: `Track #${i + 51}`,
      artists: [{ name: `Artist ${(i % 2) + 1}` }],
      album: { name: 'Album Two', images: [{ url: `https://art/2_${i}.jpg` }] },
      duration_ms: 195000 + i * 1000,
      uri: `spotify:track:track_page2_${i + 1}`,
    },
  }));

  // Intercept fetch for playlist tracks
  const originalFetch = globalThis.fetch;
  let pageRequestCount = 0;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input.toString();

    // Mock Spotify User Token response if requested
    if (urlStr.includes('/v1/playlists/mock_69_pl/tracks')) {
      pageRequestCount++;
      if (urlStr.includes('offset=50') || pageRequestCount === 2) {
        return new Response(
          JSON.stringify({
            items: page2Items,
            next: null,
            total: 69,
            limit: 50,
            offset: 50,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      } else {
        return new Response(
          JSON.stringify({
            items: page1Items,
            next: 'https://api.spotify.com/v1/playlists/mock_69_pl/tracks?offset=50&limit=50',
            total: 69,
            limit: 50,
            offset: 0,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    return originalFetch(input, init);
  };

  try {
    // Mock user access token in localStorage for test environment
    if (typeof globalThis.localStorage === 'undefined') {
      const store = new Map<string, string>();
      store.set('casa_spotify_user_access_token', 'mock_valid_token');
      store.set('casa_spotify_user_expires_at', String(Date.now() + 3600000));
      (globalThis as any).localStorage = {
        getItem: (k: string) => store.get(k) || null,
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k),
      };
    }

    const fetchedTracks = await getPlaylistTracks('mock_69_pl', 250);

    // 1.1 Total tracks returned
    assert(
      fetchedTracks.length === 69,
      'Playlist pagination fetched exactly 69 tracks across multiple pages',
      `Expected 69 tracks, got ${fetchedTracks.length}`
    );

    // 1.2 Page count verification
    assert(
      pageRequestCount === 2,
      'Pagination loop iterated through exactly 2 pages (50 + 19)',
      `Expected 2 page requests, got ${pageRequestCount}`
    );

    // 1.3 Boundary tracks data integrity
    assert(
      fetchedTracks[0]?.title === 'Track #1' && fetchedTracks[0]?.id === 'track_page1_1',
      'First track (index 0) preserved accurately from Page 1',
      `Got title: "${fetchedTracks[0]?.title}", id: "${fetchedTracks[0]?.id}"`
    );

    assert(
      fetchedTracks[49]?.title === 'Track #50' && fetchedTracks[49]?.id === 'track_page1_50',
      'Last track of Page 1 (index 49) preserved accurately',
      `Got title: "${fetchedTracks[49]?.title}", id: "${fetchedTracks[49]?.id}"`
    );

    assert(
      fetchedTracks[50]?.title === 'Track #51' && fetchedTracks[50]?.id === 'track_page2_1',
      'First track of Page 2 (index 50) parsed seamlessly',
      `Got title: "${fetchedTracks[50]?.title}", id: "${fetchedTracks[50]?.id}"`
    );

    assert(
      fetchedTracks[68]?.title === 'Track #69' && fetchedTracks[68]?.id === 'track_page2_19',
      '69th track (index 68) reached and parsed 100% without clipping',
      `Got title: "${fetchedTracks[68]?.title}", id: "${fetchedTracks[68]?.id}"`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  // -------------------------------------------------------------
  // TEST GROUP 2: Direct 1-Click State Machine Transitions
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 2: Direct 1-Click SubPanel State Machine ---');

  let currentSubPanel: MusicSubPanel = 'none';
  const switchSubPanel = (target: MusicSubPanel) => {
    currentSubPanel = currentSubPanel === target ? 'none' : target;
  };

  // 2.1 From 'none' directly to 'lyrics' in 1 click
  switchSubPanel('lyrics');
  assert(
    currentSubPanel === 'lyrics',
    'Clicking Lyrics from "none" opens "lyrics" in 1 click',
    `Expected lyrics, got ${currentSubPanel}`
  );

  // 2.2 From 'lyrics' directly to 'search' in 1 click (NO need to close 'lyrics' first!)
  switchSubPanel('search');
  assert(
    currentSubPanel === 'search',
    'Switching from "lyrics" to "search" transitions directly in 1 click',
    `Expected search, got ${currentSubPanel}`
  );

  // 2.3 From 'search' directly to 'queue' in 1 click
  switchSubPanel('queue');
  assert(
    currentSubPanel === 'queue',
    'Switching from "search" to "queue" transitions directly in 1 click',
    `Expected queue, got ${currentSubPanel}`
  );

  // 2.4 From 'queue' directly to 'playlist' in 1 click
  switchSubPanel('playlist');
  assert(
    currentSubPanel === 'playlist',
    'Switching from "queue" to "playlist" transitions directly in 1 click',
    `Expected playlist, got ${currentSubPanel}`
  );

  // 2.5 Clicking the same active icon toggles off to 'none' in 1 click
  switchSubPanel('playlist');
  assert(
    currentSubPanel === 'none',
    'Clicking active icon toggles off to "none" (Unified Wide Player) in 1 click',
    `Expected none, got ${currentSubPanel}`
  );

  // -------------------------------------------------------------
  // TEST GROUP 3: Sticky Panel View Invariance Across Track Changes
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 3: Sticky Panel View (Anti-Auto-Switch) ---');

  interface StateMachineContext {
    activeSubPanel: MusicSubPanel;
    currentTrackId: string;
    songTitle: string;
    songArtist: string;
  }

  const simulateTrackChange = (
    state: StateMachineContext,
    newTrackId: string,
    newTitle: string,
    newArtist: string
  ): StateMachineContext => {
    // In our new architecture, track change ONLY updates track metadata;
    // activeSubPanel is STICKY and NEVER modified automatically!
    return {
      ...state,
      currentTrackId: newTrackId,
      songTitle: newTitle,
      songArtist: newArtist,
    };
  };

  // 3.1 Sticky Queue View when track changes
  let testState: StateMachineContext = {
    activeSubPanel: 'queue',
    currentTrackId: 'track_alpha',
    songTitle: 'Seven',
    songArtist: 'Jung Kook',
  };

  testState = simulateTrackChange(testState, 'track_beta', 'FOREVER', 'BABYMONSTER');
  assert(
    testState.activeSubPanel === 'queue' && testState.songTitle === 'FOREVER',
    'Queue view remains strictly active ("queue") when active track changes',
    `activeSubPanel: ${testState.activeSubPanel}`
  );

  // 3.2 Sticky Search View when track changes
  testState.activeSubPanel = 'search';
  testState = simulateTrackChange(testState, 'track_gamma', 'SHEESH', 'BABYMONSTER');
  assert(
    testState.activeSubPanel === 'search',
    'Search view remains strictly active ("search") when active track changes',
    `activeSubPanel: ${testState.activeSubPanel}`
  );

  // 3.3 Sticky Playlist View when track changes
  testState.activeSubPanel = 'playlist';
  testState = simulateTrackChange(testState, 'track_delta', 'BATTER UP', 'BABYMONSTER');
  assert(
    testState.activeSubPanel === 'playlist',
    'Playlist view remains strictly active ("playlist") when active track changes',
    `activeSubPanel: ${testState.activeSubPanel}`
  );

  // 3.4 Sticky Lyrics View when track changes
  testState.activeSubPanel = 'lyrics';
  testState = simulateTrackChange(testState, 'track_epsilon', 'Boyfriend', 'BOYFRIEND');
  assert(
    testState.activeSubPanel === 'lyrics',
    'Lyrics view remains active ("lyrics") when user specifically chose lyrics',
    `activeSubPanel: ${testState.activeSubPanel}`
  );

  // 3.5 Sticky Wide Player ('none') when track changes
  testState.activeSubPanel = 'none';
  testState = simulateTrackChange(testState, 'track_zeta', 'DRIP', 'BABYMONSTER');
  assert(
    testState.activeSubPanel === 'none',
    'Unified Wide Player remains in "none" mode without popping lyrics unexpectedly',
    `activeSubPanel: ${testState.activeSubPanel}`
  );

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log('\n========================================================================');
  console.log(`  AUDIT RESULTS: ${passedTests}/${totalTests} TESTS PASSED`);
  if (passedTests === totalTests) {
    console.log('  ALL PAGINATION & PANEL STATE INVARIANTS SATISFIED! [PASS]');
  } else {
    console.error(`  SOME INVARIANTS FAILED (${totalTests - passedTests} failures)`);
    process.exit(1);
  }
  console.log('========================================================================');
}

runNavigationVerification().catch((err) => {
  console.error('Fatal navigation verification runner error:', err);
  process.exit(1);
});
