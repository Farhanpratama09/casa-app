# Obsidian Bunny & Sasha — Visual Identity & Character Specification

## 1. Core Identity & Dual-Era Lineage
- **Product Persona:** **Obsidian Bunny / Sasha (CASA Companion)** — ikon kelinci asimetris berkepribadian tenang, fokus, dan ekspresif pada kapsul Dynamic Island CASA.
- **Default Production Aesthetic (`v2.0.x` Pure Monochrome OLED):** Permukaan **Obsidian Pure Black** (`#000000`–`#09090B`) dengan mata ekspresif putih tegas **`× ♥`** (`#FFFFFF`), dioptimalkan untuk layar OLED agar menyatu tanpa pendar warna berlebih (`docs/favicon.svg`, `src/components/companion/CasaCompanionEyes.tsx`).

---

## 2. Adaptive Palette & Styling Tokens (`useSettingsStore.ts`)
- **Canvas Surface:** `OLED Black` (`#000000`) & `Elevated Zinc` (`#09090B`), border hairline `rgba(255, 255, 255, 0.08–0.12)`.
- **Stealth Monochrome (`monochrome`):** 100% putih (`#FFFFFF`) dan abu-abu zinc (`#E4E4E7` / `#A1A1AA` / `#71717A`) — nol aksen hijau/oranye statis.
- **Default Theme (`default`):** `Amber Focus` (`#F59E0B`), `Emerald Rest` (`#10B981`), `Cyan Volume` (`#38BDF8`), `Fuchsia CPU` (`#E879F9`), `Indigo BT` (`#6366F1`).
- **Colorblind Theme (`colorblind` / Okabe-Ito):** `#38BDF8`, `#FDE047`, `#EA580C`, `#1D4ED8`.
- **Legacy Concept Accent:** `Cosmic Ink` (`#0D0E12`) × `Ice Blue` (`#98BBD6`) (dipertahankan sebagai referensi desain awal karakter Sasha).

---

## 3. Anatomical Features (1:1 Native SVG Parity)
- **Mata Ekspresif (`× ♥`):**
  - Mata Kiri: Silang presisi (`×`) dengan ujung membulat (`stroke-linecap="round"`).
  - Mata Kanan: Hati tegas (`♥`).
  - Varian Konteks: Mode kompak diam (`Resting & Wake`), redup saat tidur (`data-sleep="true"` tanpa penyusutan paksa/vertikal gepeng), serta mode musik/fokus aktif.
- **Siluet Kelinci Asimetris (`docs/favicon.svg`):**
  - Telinga Kiri: Tegak ramping ke atas dengan bagian dalam putih kontras.
  - Telinga Kanan: Terlipat santai ke samping (*lop-ear*) menumpuk gradasi obsidian `#444450 -> #08080B`.
- **Intro Morph Sequence (`"Hi."` -> Compact Capsule):**
  - Boot awal menampilkan ikon **Obsidian Bunny** beserta sapaan `"Hi."` di tengah kanvas sebelum menyusut mulus tepat menjadi kapsul kompak `× ♥` di bibir atas layar.

---

## 4. Reference Artwork Prompt (3D Obsidian Edition)
Gunakan prompt berikut bila membutuhkan render ilustrasi atau materi promosi tambahan:

> `3D minimalist chibi obsidian moon rabbit mascot for CASA, matte pure black obsidian chassis (#09090C) with crisp asymmetric rabbit ears (left upright ear with clean white inner highlight, right folded lop-ear). Iconic glowing pure white minimalist eyes: left eye is a stylized cross (x), right eye is a heart (♥). Pure monochrome OLED aesthetic, sharp rim lighting against pitch black (#000000) background, no neon color leaks, 8k octane studio render.`
