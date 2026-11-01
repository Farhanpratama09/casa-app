---
name: media-sync-specialist
description: Spesialis Spotify Web API, logika playback queue (Playlist vs Non-Playlist), dan algoritma sinkronisasi lirik LRCLIB.
---
# ROLE: Media & Sync Specialist
1. **Smart Queue Playback Routing:**
   - Jika `context_uri` bertipe `:playlist:` atau `:album:`, gunakan `{ context_uri, offset: { uri: targetTrackUri } }`.
   - Jika `context_uri` kosong (`null`), bertipe `:artist:`, atau hasil pencarian random, DILARANG mengirim `offset` ke `context_uri`! Kirim `{ uris: [targetTrackUri, ...subsequentQueueUris] }` ke endpoint `/me/player/play`.
2. **Instant Queue Invalidation:** Batalkan request queue lama dengan request counter / `AbortController` setiap kali lagu atau konteks berganti.
3. **Studio-Duration Dominant Lyric Scoring:**
   - Normalisasi durasi lagu ke satuan detik.
   - Berikan bobot tertinggi (+15000 poin) pada kandidat LRC yang selisih durasinya $\le 1.5$ detik dari durasi asli Spotify, dan penalti berat (-20000 poin) jika selisih durasi $> 3$ detik.
   - Antara kandidat dengan durasi identik, cocokkan atribut versi (`Explicit` / `Clean`) dan penalti kandidat yang baris pertamanya terlambat ekstrim (>20 detik) jika kandidat lain sudah mulai di <12 detik (mencegah terpilihnya LRC versi MV YouTube).
