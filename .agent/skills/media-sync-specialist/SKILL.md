---
name: media-sync-specialist
description: Spesialis Spotify Web API, sub-navigasi Player | Playlists & pop-up QUEUE, logika queue Playlist vs Non-Playlist, dan scoring lirik LRCLIB.
---
# ROLE: Media & Sync Specialist

1. **Mode 6 Navigation & Pop-up `QUEUE` Invariant (`Mode6MusicLayout.tsx`):**
   - Bar sub-navigasi musik tepat **`Player | Playlists`** (dilarang menambahkan tab `Queue` redundan).
   - Daftar antrean ditampilkan pada pop-up satelit kanan dengan header monospace ringkas **`QUEUE`**, dan wajib disinkronkan 1:1 pada monitor virtual `docs/`.
   - Popover `SAVE TO PLAYLIST` pada drawer pencarian kiri harus berada penuh di dalam rect `searchDrawerBounds`.
2. **Smart Queue Playback Routing:**
   - Jika `context_uri` bertipe `:playlist:` atau `:album:`, gunakan `{ context_uri, offset: { uri: targetTrackUri } }`.
   - Jika `context_uri` kosong (`null`), bertipe `:artist:`, atau hasil pencarian random, **DILARANG** mengirim `offset` ke `context_uri`; kirim `{ uris: [targetTrackUri, ...subsequentQueueUris] }` ke `/me/player/play`.
3. **Instant Queue Invalidation & `v2.1.4` Smart Queue Rules:**
   - Batalkan request queue/playback lama memakai monotonic sequence counter (`radioEpoch`, `playbackSeqRef`) + `AbortController` setiap kali lagu, pencarian, atau konteks berganti agar respons lambat tidak menimpa state baru.
   - **Auto-Queue & Anti-Loop (`useQueueStore.ts`, `radioEngine.ts`, `native_audio.rs`):** Gunakan endpoint resmi `youtubei/v1/next` (*Up Next / Watch Playlist* via `videoId`) + fallback `artistId` (`browse`), memakai `sessionSeeds` sesi aktif tanpa fallback ke riwayat 30 hari (`trackRecords`). Playlist dengan `repeatMode === 'off'` tidak boleh melakukan *wrap-around* ke lagu awal (`wrapAround: false`), melainkan berlanjut ke Smart Queue seeded dari playlist; pengulangan menyeluruh hanya aktif bila `repeatMode === 'all'` (`repeatMode` siklus `off | all | one`).
   - **Dynamic Region & Categorized Search:** Selaraskan `gl`/`hl` dari OS locale (`Win32_Globalization`) atau `settings.playerRegion` (`auto | ID | US | KR | JP`), dan dukung hasil terstruktur **Top Songs Artis**, **Albums**, **Playlists**, **Songs** lengkap dengan aksi 1-klik **Play All / Muat ke Antrian** yang memutar audio penuh tanpa memblokir ketiadaan lirik LRCLIB.
4. **Studio-Duration Dominant Lyric Scoring (`lyricsService.ts`):**
   - Normalisasi durasi ke detik; beri bobot `+15000` bila selisih durasi $\le 1.5$ detik dan penalti `-20000` bila $> 3$ detik.
   - Antara kandidat berdurasi identik, cocokan atribut (`Explicit`/`Clean`) serta penalti kandidat yang baris pertamanya terlambat ekstrim ($> 20$ detik) agar LRC versi MV tidak terpilih.
5. **Single Clock Source & Unsynced Auto-Scroll (`playbackClock.ts`, `LyricsPanel.tsx`):**
   - Gunakan `resolvePlaybackPositionMs`, `computeLyricAdjustedTimeMs` (`75 ms` companion, `0 ms` native), dan `computeSyncedLyricIndex` (`50 ms` hysteresis) secara identik di `useLyricsSync` (Mode 6) dan `IdlePillView` (Idle), serta re-anchor clock saat transisi mode dan perubahan Playing/Paused.
   - Untuk lirik *unsynced* tanpa timestamp, tampilkan badge **`Unsynced`** dengan gulir proporsional halus (`computeUnsyncedScrollProgress`, margin intro/outro ±9%) yang otomatis jeda 4 detik saat *mouse wheel* digulir manual.
