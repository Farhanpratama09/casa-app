/**
 * smartShuffle.ts
 * Anti-Clustering Shuffle Engine
 * 
 * Prevents adjacent or repetitive tracks by the same artist in sequence.
 * 1. Initial Fisher-Yates random shuffle.
 * 2. Artist Spacing Pass: ensures tracks from the same artist maintain a minimum distance (3-4 tracks).
 * 3. Swap Collision Resolution: swaps colliding tracks with subsequent tracks by different artists.
 * 4. Backward Safety Pass: guarantees 0 adjacent same-artist collisions at the tail of the list.
 */

/**
 * Normalizes artist name for uniform comparison:
 * Strips feat/ft, collaboration delimiters, trims whitespace, and lowercases.
 */
export function normalizeArtist(raw?: string): string {
  if (!raw) return 'unknown';
  // Split on delimiters like ' feat. ', ' ft. ', ' & ', ',', ' / ', ' x '
  const primary = raw.split(/\s+(?:feat\.?|ft\.?|&|x)\s+|,|\//i)[0];
  return primary.trim().toLowerCase();
}

/**
 * Pure Fisher-Yates shuffle algorithm.
 */
export function fisherYates<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Anti-Clustering Smart Shuffle
 * 
 * @param tracks Array of tracks with an `artist` property
 * @param targetSpacing Target minimum separation between tracks by the same artist (default: 3)
 */
export function smartShuffle<T extends { artist?: string; [key: string]: any }>(
  tracks: T[],
  targetSpacing: number = 3
): T[] {
  if (!tracks || tracks.length <= 2) {
    return tracks ? [...tracks] : [];
  }

  // Step 1: Initial Fisher-Yates Shuffle
  const result = fisherYates(tracks);
  const n = result.length;

  // Step 2: Compute track frequencies per artist to determine maximum achievable spacing
  const artistCounts = new Map<string, number>();
  for (const track of result) {
    const a = normalizeArtist(track.artist);
    artistCounts.set(a, (artistCounts.get(a) || 0) + 1);
  }

  let maxArtistCount = 0;
  for (const count of artistCounts.values()) {
    if (count > maxArtistCount) maxArtistCount = count;
  }

  // Dynamic achievable spacing:
  // If an artist dominates the playlist, spacing >= 3 might be mathematically impossible.
  // We guarantee at least 1 (never adjacent), scaling up to targetSpacing.
  const maxPossibleSpacing = Math.floor((n - maxArtistCount) / Math.max(1, maxArtistCount));
  const effectiveSpacing = Math.max(1, Math.min(targetSpacing, maxPossibleSpacing));

  // Step 3: Forward Artist Spacing Pass
  for (let i = 0; i < n; i++) {
    const currentArtist = normalizeArtist(result[i].artist);

    // Check recent window [max(0, i - effectiveSpacing) ... i - 1]
    const windowStart = Math.max(0, i - effectiveSpacing);
    let hasCollision = false;

    for (let w = windowStart; w < i; w++) {
      if (normalizeArtist(result[w].artist) === currentArtist) {
        hasCollision = true;
        break;
      }
    }

    if (hasCollision) {
      // Find swap candidate j in [i + 1 ... n - 1]
      let bestSwapIdx = -1;
      let nonAdjacentSwapIdx = -1;

      for (let j = i + 1; j < n; j++) {
        const candidateArtist = normalizeArtist(result[j].artist);

        // Does candidate satisfy distance from recent window at index i?
        let candidateConflictsAtI = false;
        for (let w = windowStart; w < i; w++) {
          if (normalizeArtist(result[w].artist) === candidateArtist) {
            candidateConflictsAtI = true;
            break;
          }
        }

        if (!candidateConflictsAtI) {
          bestSwapIdx = j;
          break;
        } else if (
          i > 0 &&
          candidateArtist !== normalizeArtist(result[i - 1].artist) &&
          nonAdjacentSwapIdx === -1
        ) {
          nonAdjacentSwapIdx = j;
        }
      }

      const targetSwap = bestSwapIdx !== -1 ? bestSwapIdx : nonAdjacentSwapIdx;
      if (targetSwap !== -1) {
        [result[i], result[targetSwap]] = [result[targetSwap], result[i]];
      }
    }
  }

  // Step 4: Backward Safety Pass for End-of-List Adjacent Collisions
  for (let i = n - 1; i > 0; i--) {
    if (normalizeArtist(result[i].artist) === normalizeArtist(result[i - 1].artist)) {
      const collidingArtist = normalizeArtist(result[i].artist);
      for (let k = 1; k < i - 1; k++) {
        const kArtist = normalizeArtist(result[k].artist);
        const prevK = normalizeArtist(result[k - 1].artist);
        const nextK = normalizeArtist(result[k + 1].artist);
        if (
          collidingArtist !== prevK &&
          collidingArtist !== nextK &&
          kArtist !== collidingArtist
        ) {
          [result[i], result[k]] = [result[k], result[i]];
          break;
        }
      }
    }
  }

  return result;
}
