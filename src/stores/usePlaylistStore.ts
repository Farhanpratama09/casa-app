/**
 * usePlaylistStore.ts
 * Persistent Custom Playlists CRUD + 4 Read-Only Dynamic Smart Playlists
 *
 * - Stores user-created playlists ({ id, name, tracks, createdAt, updatedAt }) in localStorage.
 * - Supports mixed tracks from online searches and local audio files.
 * - Generates 4 dynamic Smart Playlists from affinity, local uploads, focus sessions, and 7-day top artist.
 */

import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import {
  AffinityTrackRecord,
  ArtistAffinityRecord,
  getTopArtistLast7Days,
  useMusicAffinityStore,
} from '../hooks/useMusicAffinity';
import {
  getTrackIdentityKey,
  isSameTrack,
  MusicTrackLike,
  NormalizedMusicTrack,
  normalizeTrackMetadata,
} from '../utils/musicQueueEngine';

const PLAYLIST_STORAGE_KEY = 'casa_custom_playlists_v1';

export interface CustomPlaylist {
  id: string;
  name: string;
  tracks: NormalizedMusicTrack[];
  createdAt: number;
  updatedAt: number;
}

export interface SmartPlaylist {
  id: 'smart-heavy-rotation' | 'smart-recently-added' | 'smart-focus-chill' | 'smart-artist-mix';
  name: string;
  subtitle: string;
  badge: string;
  isSmart: true;
  tracks: NormalizedMusicTrack[];
}

const CALM_FOCUS_REGEX =
  /\b(lofi|lo-fi|chill|ambient|instrumental|acoustic|piano|focus|study|sleep|calm|jazz|soft|rain|night)\b/i;

function sanitizePlaylistTrackForStorage(track: NormalizedMusicTrack): NormalizedMusicTrack {
  const hasBlob = Boolean(track.streamUrl && track.streamUrl.startsWith('blob:'));
  return {
    ...track,
    streamUrl: hasBlob ? undefined : track.streamUrl,
    candidates: hasBlob ? undefined : track.candidates,
  };
}

function loadPersistedPlaylists(): CustomPlaylist[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PLAYLIST_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
      .map((p) => ({
        id: p.id,
        name: p.name.trim() || 'Untitled Playlist',
        tracks: Array.isArray(p.tracks)
          ? p.tracks.map((t: MusicTrackLike) => normalizeTrackMetadata(t))
          : [],
        createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
        updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : Date.now(),
      }));
  } catch {
    return [];
  }
}

function savePersistedPlaylists(playlists: CustomPlaylist[]): void {
  if (typeof window === 'undefined') return;
  try {
    const serialized = playlists.map((p) => ({
      ...p,
      tracks: p.tracks.map(sanitizePlaylistTrackForStorage),
    }));
    window.localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify(serialized));
  } catch (err) {
    console.warn('[usePlaylistStore] Failed to persist playlists:', err);
  }
}

function hydrateSessionTrack(
  track: NormalizedMusicTrack,
  sessionCache: Record<string, NormalizedMusicTrack>
): NormalizedMusicTrack {
  const key = getTrackIdentityKey(track);
  const cached = sessionCache[key];
  if (cached && cached.streamUrl) {
    return { ...track, streamUrl: cached.streamUrl, candidates: cached.candidates };
  }
  return track;
}

export interface PlaylistStoreState {
  customPlaylists: CustomPlaylist[];

  createPlaylist: (name: string, initialTracks?: MusicTrackLike[]) => CustomPlaylist | null;
  renamePlaylist: (playlistId: string, newName: string) => void;
  deletePlaylist: (playlistId: string) => void;
  addTrackToPlaylist: (playlistId: string, rawTrack: MusicTrackLike) => boolean;
  removeTrackFromPlaylist: (playlistId: string, trackIndexOrId: number | string) => void;
}

// ============================================================================
// Module-Level Shared Singleton Pub-Sub Store
// Guarantees synchronous same-frame re-renders across every mounted component
// (MusicPlaylistView, AddToPlaylistPopover, Mode6MusicLayout, etc.)
// ============================================================================

let sharedCustomPlaylists: CustomPlaylist[] = loadPersistedPlaylists();
const playlistListeners = new Set<() => void>();

function subscribePlaylists(listener: () => void): () => void {
  playlistListeners.add(listener);
  return () => {
    playlistListeners.delete(listener);
  };
}

function getPlaylistSnapshot(): CustomPlaylist[] {
  return sharedCustomPlaylists;
}

function commitSharedPlaylists(next: CustomPlaylist[]): void {
  sharedCustomPlaylists = next;
  savePersistedPlaylists(next);
  usePlaylistStore.setState({ customPlaylists: next });
  playlistListeners.forEach((listener) => {
    try {
      listener();
    } catch {}
  });
}

function createPlaylistAction(
  rawName: string,
  initialTracks: MusicTrackLike[] = []
): CustomPlaylist | null {
  const trimmed = rawName.trim();
  if (!trimmed) return null;

  const now = Date.now();
  const normalizedInitial: NormalizedMusicTrack[] = [];
  for (const raw of initialTracks) {
    const norm = normalizeTrackMetadata(raw);
    if (!normalizedInitial.some((t) => isSameTrack(t, norm))) {
      normalizedInitial.push(norm);
    }
  }

  const created: CustomPlaylist = {
    id: `pl-${now}-${Math.random().toString(36).slice(2, 6)}`,
    name: trimmed,
    tracks: normalizedInitial,
    createdAt: now,
    updatedAt: now,
  };

  if (normalizedInitial.length > 0) {
    const affinity = useMusicAffinityStore.getState();
    normalizedInitial.forEach((t) => affinity.recordTrackPlaylistSave(t));
  }

  commitSharedPlaylists([created, ...sharedCustomPlaylists]);
  return created;
}

function renamePlaylistAction(playlistId: string, newName: string): void {
  const trimmed = newName.trim();
  if (!trimmed) return;
  const next = sharedCustomPlaylists.map((p) =>
    p.id === playlistId ? { ...p, name: trimmed, updatedAt: Date.now() } : p
  );
  commitSharedPlaylists(next);
}

function deletePlaylistAction(playlistId: string): void {
  const next = sharedCustomPlaylists.filter((p) => p.id !== playlistId);
  commitSharedPlaylists(next);
}

function addTrackToPlaylistAction(playlistId: string, rawTrack: MusicTrackLike): boolean {
  if (!rawTrack) return false;
  const norm = normalizeTrackMetadata({ ...rawTrack, addedAt: Date.now() });
  let added = false;

  const next = sharedCustomPlaylists.map((p) => {
    if (p.id !== playlistId) return p;
    if (p.tracks.some((existing) => isSameTrack(existing, norm))) {
      return p;
    }
    added = true;
    return {
      ...p,
      tracks: [...p.tracks, norm],
      updatedAt: Date.now(),
    };
  });

  if (added) {
    commitSharedPlaylists(next);
    useMusicAffinityStore.getState().recordTrackPlaylistSave(norm);
  }
  return added;
}

function removeTrackFromPlaylistAction(
  playlistId: string,
  trackIndexOrId: number | string
): void {
  const next = sharedCustomPlaylists.map((p) => {
    if (p.id !== playlistId) return p;
    const filtered = p.tracks.filter((t, idx) =>
      typeof trackIndexOrId === 'number'
        ? idx !== trackIndexOrId
        : t.id !== trackIndexOrId && t.trackPairKey !== trackIndexOrId
    );
    return { ...p, tracks: filtered, updatedAt: Date.now() };
  });
  commitSharedPlaylists(next);
}

export const usePlaylistStore = create<PlaylistStoreState>(() => ({
  customPlaylists: sharedCustomPlaylists,
  createPlaylist: createPlaylistAction,
  renamePlaylist: renamePlaylistAction,
  deletePlaylist: deletePlaylistAction,
  addTrackToPlaylist: addTrackToPlaylistAction,
  removeTrackFromPlaylist: removeTrackFromPlaylistAction,
}));

/**
 * Dynamically derives the 4 read-only Smart Playlists from current affinity,
 * local uploads, focus sessions, and 7-day rolling top artist score.
 */
export function buildSmartPlaylists(
  trackRecords: Record<string, AffinityTrackRecord>,
  artistRecords: Record<string, ArtistAffinityRecord>,
  customPlaylists: CustomPlaylist[],
  sessionCache: Record<string, NormalizedMusicTrack>
): SmartPlaylist[] {
  const allRecords = Object.values(trackRecords);
  const hydrate = (t: NormalizedMusicTrack) => hydrateSessionTrack(t, sessionCache);

  // Combine library tracks across affinity + custom playlists (deduplicated)
  const combinedLibrary: AffinityTrackRecord[] = [...allRecords];
  for (const pl of customPlaylists) {
    for (const track of pl.tracks) {
      if (!combinedLibrary.some((r) => isSameTrack(r.track, track))) {
        combinedLibrary.push({
          key: getTrackIdentityKey(track),
          track,
          playCount: 0,
          completedCount: 0,
          totalListenSeconds: 0,
          addedToPlaylistCount: 1,
          focusPlayCount: 0,
          playedDuringFocus: Boolean(track.playedDuringFocus),
          isLocalUpload: track.isLocal,
          lastPlayedAt: 0,
          lastAddedAt: track.addedAt || pl.updatedAt,
          score: 1,
        });
      }
    }
  }

  // 1. Heavy Rotation: Top 15 by highest playCount
  const heavyRotationTracks = allRecords
    .filter((r) => r.playCount > 0)
    .sort((a, b) => b.playCount - a.playCount || b.score - a.score || b.lastPlayedAt - a.lastPlayedAt)
    .slice(0, 15)
    .map((r) => hydrate(r.track));

  // 2. Recently Added: 15 newest from local uploads & recently played/added
  const recentlyAddedTracks = combinedLibrary
    .filter((r) => r.lastAddedAt > 0 || r.lastPlayedAt > 0 || r.isLocalUpload)
    .sort(
      (a, b) =>
        Math.max(b.lastAddedAt, b.lastPlayedAt) - Math.max(a.lastAddedAt, a.lastPlayedAt)
    )
    .slice(0, 15)
    .map((r) => hydrate(r.track));

  // 3. Focus & Chill: Played during Focus Timer OR matching calm/instrumental vibe
  const focusTracks = combinedLibrary
    .filter(
      (r) =>
        r.focusPlayCount > 0 ||
        r.playedDuringFocus ||
        CALM_FOCUS_REGEX.test(`${r.track.title} ${r.track.artist}`)
    )
    .sort(
      (a, b) =>
        b.focusPlayCount - a.focusPlayCount ||
        b.score - a.score ||
        b.lastPlayedAt - a.lastPlayedAt
    )
    .slice(0, 15)
    .map((r) => hydrate(r.track));

  const smartList: SmartPlaylist[] = [
    {
      id: 'smart-heavy-rotation',
      name: 'Heavy Rotation',
      subtitle: 'Top played tracks',
      badge: 'TOP 15',
      isSmart: true,
      tracks: heavyRotationTracks,
    },
    {
      id: 'smart-recently-added',
      name: 'Recently Added',
      subtitle: 'Local uploads & recent',
      badge: 'RECENT',
      isSmart: true,
      tracks: recentlyAddedTracks,
    },
    {
      id: 'smart-focus-chill',
      name: 'Focus & Chill',
      subtitle: 'Calm & timer sessions',
      badge: 'FOCUS',
      isSmart: true,
      tracks: focusTracks,
    },
  ];

  // 4. Artist Mix: Highest-scoring artist over last 7 days (hidden automatically if no history)
  const topArtist = getTopArtistLast7Days(artistRecords);
  if (topArtist) {
    const artistMixTracks = combinedLibrary
      .filter(
        (r) =>
          r.track.normalizedArtist === topArtist.normalizedArtist ||
          r.track.artist.toLowerCase().includes(topArtist.normalizedArtist)
      )
      .sort((a, b) => b.score - a.score || b.playCount - a.playCount)
      .slice(0, 15)
      .map((r) => hydrate(r.track));

    if (artistMixTracks.length > 0) {
      smartList.push({
        id: 'smart-artist-mix',
        name: 'Artist Mix',
        subtitle: topArtist.artist,
        badge: '7D TOP',
        isSmart: true,
        tracks: artistMixTracks,
      });
    }
  }

  return smartList;
}

export function usePlaylistsWithSmartMixes() {
  const customPlaylists = useSyncExternalStore(
    subscribePlaylists,
    getPlaylistSnapshot,
    getPlaylistSnapshot
  );

  const trackRecords = useMusicAffinityStore((s) => s.trackRecords);
  const artistRecords = useMusicAffinityStore((s) => s.artistRecords);
  const sessionCache = useMusicAffinityStore((s) => s.sessionTrackCache);

  const smartPlaylists = buildSmartPlaylists(
    trackRecords,
    artistRecords,
    customPlaylists,
    sessionCache
  );

  const hydratedCustomPlaylists: CustomPlaylist[] = customPlaylists.map((p) => ({
    ...p,
    tracks: p.tracks.map((t) => hydrateSessionTrack(t, sessionCache)),
  }));

  return {
    customPlaylists: hydratedCustomPlaylists,
    smartPlaylists,
    createPlaylist: createPlaylistAction,
    renamePlaylist: renamePlaylistAction,
    deletePlaylist: deletePlaylistAction,
    addTrackToPlaylist: addTrackToPlaylistAction,
    removeTrackFromPlaylist: removeTrackFromPlaylistAction,
  };
}
