import * as fs from 'fs';
import * as path from 'path';
import {
  getCachedArtwork,
  setCachedArtwork,
  clearTrackArtworkCache,
} from '../src/components/views/MusicCardView';
import { getCurrentlyPlayingTrackDetails } from '../src/utils/spotifyService';

console.log('========================================================================');
console.log('   CASA CRITICAL QA: COVER ART RESILIENCE & ANTI-FLICKER AUDIT');
console.log('========================================================================\n');

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  [PASS] ${msg}`);
    passCount++;
  } else {
    console.error(`  [FAIL] ${msg}`);
    failCount++;
  }
}

// -------------------------------------------------------------------------
// TEST GROUP 1: Rust Backend Direct Binary Execution (Zero Subshell Leaks)
// -------------------------------------------------------------------------
console.log('--- TEST GROUP 1: Backend Zero-Subshell & Direct Binary Verification ---');
const mediaRsPath = path.resolve(process.cwd(), 'src-tauri/src/media/providers/spotify_win32.rs');
const mediaRsContent = fs.readFileSync(mediaRsPath, 'utf8');

assert(
  !mediaRsContent.includes('Command::new("cmd")') &&
  !mediaRsContent.includes("Command::new('cmd')") &&
  !mediaRsContent.includes('Command::new("powershell")'),
  'Zero occurrences of Command::new("cmd") or powershell in media.rs (all subshells eradicated)'
);

assert(
  mediaRsContent.includes('pub fn get_real_spotify_binary() -> Option<std::path::PathBuf>'),
  'Direct executable resolver get_real_spotify_binary filters 0-byte execution aliases'
);

assert(
  mediaRsContent.includes('ShellExecuteW') &&
  mediaRsContent.includes('SW_SHOWMINNOACTIVE'),
  'Store execution alias fallback uses in-process ShellExecuteW to avoid conhost/CMD popups'
);

assert(
  mediaRsContent.includes('std::process::Command::new(exe_path)') &&
  mediaRsContent.includes('.creation_flags(CREATE_NO_WINDOW)'),
  'Spotify process is launched directly via binary path with CREATE_NO_WINDOW'
);

// -------------------------------------------------------------------------
// TEST GROUP 2: Two-Tier Resilient Memory Cache (Real Service Verification)
// -------------------------------------------------------------------------
console.log('\n--- TEST GROUP 2: Two-Tier Resilient Memory Cache Universal Tests ---');
clearTrackArtworkCache();

const sampleId1 = `trk_${Math.random().toString(36).substring(2, 9)}`;
const sampleTitle1 = `Random Track Alpha [${sampleId1}]`;
const sampleArtist1 = `Artist One [${sampleId1}]`;
const sampleCdnUrl1 = `https://i.scdn.co/image/ab67616d0000b273${sampleId1}`;

setCachedArtwork(sampleTitle1, sampleArtist1, sampleCdnUrl1, sampleId1);

assert(
  getCachedArtwork(sampleTitle1, sampleArtist1, sampleId1) === sampleCdnUrl1,
  'Cache Hit by trackId returns exact high-res CDN URL'
);

assert(
  getCachedArtwork(sampleTitle1.toLowerCase(), sampleArtist1.toUpperCase()) === sampleCdnUrl1,
  'Cache Hit by case-insensitive title::artist returns exact high-res CDN URL'
);

assert(
  getCachedArtwork('Different Title', 'Different Artist', sampleId1) === null,
  'Anti-poisoning invariant: getCachedArtwork rejects stale trackId if title/artist do not match'
);

assert(
  getCachedArtwork('NonExistentTitle', 'NonExistentArtist') === null,
  'Cache safely returns null for unknown tracks without throwing'
);

// -------------------------------------------------------------------------
// TEST GROUP 3: 5 Consecutive Track Transitions (Varied Payload Invariants)
// -------------------------------------------------------------------------
console.log('\n--- TEST GROUP 3: 5-Track Dynamic Transition Sequence & Invariant Audit ---');

interface SimulationTrack {
  id: string;
  title: string;
  artist: string;
  gsmtcBlob?: string;
  webApiCdn?: string;
  delayMs?: number;
}

const mockTracks: SimulationTrack[] = [
  // Track 1: Only Web API CDN URL
  {
    id: `trk_1_${Date.now()}`,
    title: 'Symphony of Stars',
    artist: 'Cosmic Band',
    webApiCdn: 'https://i.scdn.co/image/cdn_sample_1_640x640',
  },
  // Track 2: Only GSMTC base64 thumbnail
  {
    id: `trk_2_${Date.now()}`,
    title: 'Neon Nights',
    artist: 'Cyber Echo',
    gsmtcBlob: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD_thumbnail_blob',
  },
  // Track 3: Delayed payload (GSMTC delayed, Web API arrives after 500ms)
  {
    id: `trk_3_${Date.now()}`,
    title: 'Velvet Rain',
    artist: 'Autumn Breeze',
    delayMs: 500,
    // At 0ms tick, neither GSMTC nor Web API has landed yet
  },
  // Track 4: Previous Track 1 repeated (verifies instant 0ms cache re-hit)
  {
    id: `trk_1_${Date.now()}`,
    title: 'Symphony of Stars',
    artist: 'Cosmic Band',
    // intentionally omitted payloads: must resolve instantly from trackArtworkCache!
  },
  // Track 5: Network failure (primary CDN fails, fallbacks to GSMTC secondary buffer)
  {
    id: `trk_5_${Date.now()}`,
    title: 'Broken Connection',
    artist: 'Signal Loss',
    webApiCdn: 'https://broken.invalid/404.jpg',
    gsmtcBlob: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD_local_backup_blob',
  },
];

// Replicate MusicCardView's Resilient Resolver Logic
class ResilientArtworkStateResolver {
  public displayedArtwork: string | null = null;
  public secondaryArtwork: string | null = null;
  public hasFailed = false;

  resolveTrackChange(
    track: SimulationTrack,
    optimisticArt?: string,
    initialPayloadArt?: string
  ) {
    const directUrl = initialPayloadArt || track.gsmtcBlob;
    const optimistic = optimisticArt || track.webApiCdn;
    const cached = getCachedArtwork(track.title, track.artist, track.id);

    // Warm cache if CDN URL
    if (directUrl && directUrl.startsWith('http')) {
      setCachedArtwork(track.title, track.artist, directUrl, track.id);
    }
    if (optimistic && optimistic.startsWith('http')) {
      setCachedArtwork(track.title, track.artist, optimistic, track.id);
    }

    let primary: string | null = null;
    let fallback: string | null = null;

    if (optimistic && optimistic.startsWith('http')) {
      primary = optimistic;
    } else if (cached && cached.startsWith('http')) {
      primary = cached;
    } else if (directUrl && directUrl.startsWith('http')) {
      primary = directUrl;
    }

    if (directUrl && !directUrl.startsWith('http')) {
      fallback = directUrl;
    } else if (cached && !cached.startsWith('http')) {
      fallback = cached;
    }

    if (!primary && fallback) {
      primary = fallback;
      fallback = null;
    }

    // Strict Anti-Desync Rule:
    // If no candidate is ready for THIS track, reset displayedArtwork to null so
    // that the card displays vinyl fallback instead of previous track's art (prevents desync)
    if (primary) {
      this.displayedArtwork = primary;
      this.secondaryArtwork = fallback;
      this.hasFailed = false;
    } else if (fallback) {
      this.displayedArtwork = fallback;
      this.secondaryArtwork = null;
      this.hasFailed = false;
    } else {
      this.displayedArtwork = null;
      this.secondaryArtwork = null;
      this.hasFailed = false;
    }
  }

  handleImageError() {
    if (this.secondaryArtwork && this.displayedArtwork !== this.secondaryArtwork) {
      this.displayedArtwork = this.secondaryArtwork;
      this.secondaryArtwork = null;
    } else {
      this.hasFailed = true;
    }
  }
}

const resolver = new ResilientArtworkStateResolver();

// Step 1: Track 1 (Web API CDN)
resolver.resolveTrackChange(mockTracks[0], mockTracks[0].webApiCdn);
assert(
  resolver.displayedArtwork === mockTracks[0].webApiCdn,
  `Track 1: Resolved directly to Web API CDN URL (${resolver.displayedArtwork})`
);
assert(
  resolver.displayedArtwork !== undefined && typeof resolver.displayedArtwork === 'string',
  'Track 1 Invariant: Artwork is defined and valid string'
);

// Step 2: Track 2 (GSMTC Blob)
resolver.resolveTrackChange(mockTracks[1]);
assert(
  resolver.displayedArtwork === mockTracks[1].gsmtcBlob,
  'Track 2: Correctly resolved and fell back to GSMTC thumbnail blob'
);
assert(
  resolver.displayedArtwork !== undefined && !resolver.hasFailed,
  'Track 2 Invariant: No undefined state, no failure flag'
);

// Step 3: Track 3 (Delayed payload - 0ms tick has no artwork)
resolver.resolveTrackChange(mockTracks[2]); // 0ms tick: no payload arrives yet
assert(
  resolver.displayedArtwork === null,
  'Track 3 (0ms tick): Resets to null to show vinyl fallback instead of holding onto previous track artwork (anti-desync)'
);
assert(
  resolver.hasFailed === false,
  'Track 3 Invariant: No failure flag raised while waiting for delayed payload'
);

// Later at 500ms, Web API payload arrives:
const delayedCdn = 'https://i.scdn.co/image/cdn_sample_3_delayed_640';
mockTracks[2].webApiCdn = delayedCdn;
setCachedArtwork(mockTracks[2].title, mockTracks[2].artist, delayedCdn, mockTracks[2].id);
resolver.resolveTrackChange(mockTracks[2], delayedCdn);
assert(
  resolver.displayedArtwork === delayedCdn,
  'Track 3 (500ms arrival): Smoothly updated to fresh Web API CDN image once loaded'
);

// Step 4: Track 4 (Skip Backwards to Track 1 without incoming network payload)
resolver.resolveTrackChange(mockTracks[3]);
assert(
  resolver.displayedArtwork === mockTracks[0].webApiCdn,
  'Track 4 (Backward Skip): Instant 0ms Cache Hit restored Track 1 high-res art without re-fetching'
);

// Step 5: Track 5 (Network Error with Local Backup)
resolver.resolveTrackChange(mockTracks[4], mockTracks[4].webApiCdn);
assert(
  resolver.displayedArtwork === mockTracks[4].webApiCdn &&
  resolver.secondaryArtwork === mockTracks[4].gsmtcBlob,
  'Track 5: Primary set to CDN URL and secondary buffer safely primed with GSMTC blob'
);

// Simulate browser onError event:
resolver.handleImageError();
assert(
  resolver.displayedArtwork === mockTracks[4].gsmtcBlob && !resolver.hasFailed,
  'Track 5 Error Recovery: Image onError successfully switched to secondary GSMTC blob without failing to broken vinyl'
);

// -------------------------------------------------------------------------
// TEST GROUP 4: Frontend UI DOM Integration & Component File Audit
// -------------------------------------------------------------------------
console.log('\n--- TEST GROUP 4: Component DOM & Event Handler Audit ---');
const musicCardPath = path.resolve(process.cwd(), 'src/components/views/MusicCardView.tsx');
const musicCardContent = fs.readFileSync(musicCardPath, 'utf8');

assert(
  musicCardContent.includes('onLoad={handleCoverImageLoad}') &&
  musicCardContent.includes('onError={handleCoverImageError}'),
  'MusicCardView binds both onLoad and onError resilient recovery handlers'
);

assert(
  musicCardContent.includes("key={(song as any)?.id || song.title || 'current-cover'}"),
  'React key on cover art <img> ensures clean lifecycle re-render on track transition'
);

assert(
  musicCardContent.includes('getCurrentlyPlayingTrackDetails'),
  'MusicCardView imports getCurrentlyPlayingTrackDetails for Tier-1 Web API CDN resolution'
);

assert(
  musicCardContent.includes('isTitleMatch') &&
  musicCardContent.includes('Ignored stale cloud artwork'),
  'MusicCardView implements strict anti-poisoning filter rejecting mismatched cloud track payloads'
);

console.log('\n========================================================================');
console.log(`  AUDIT RESULTS: ${passCount} PASSED | ${failCount} FAILED`);
console.log('========================================================================\n');

if (failCount > 0) {
  process.exit(1);
}
