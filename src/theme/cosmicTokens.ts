/**
 * Cosmic Design Tokens - Nebula Bloom Palette
 * Centralized Single-Source-of-Truth for CASA Theme & Colors.
 */

export const cosmicTokens = {
  // 1. Drop Zone Shelf: Vibrant Cosmic Lilac
  dropZone: {
    text: '#c084fc',
    hoverText: '#d8b4fe',
    bgBadge: 'rgba(168, 85, 247, 0.15)',
    border: 'rgba(168, 85, 247, 0.35)',
    borderHover: 'rgba(168, 85, 247, 0.50)',
    glow: '0 0 12px rgba(192, 132, 252, 0.40)',
  },

  // 2. Productivity (Timer & Tasks) - Astral Periwinkle Palette
  productivity: {
    timerDial: '#818cf8', // Astral Periwinkle
    timerDialLight: '#a5b4fc',
    timerDialBg: 'rgba(129, 140, 248, 0.12)',
    timerDialBorder: 'rgba(129, 140, 248, 0.30)',
    carrotActive: '#818cf8', // Astral Periwinkle (Pinned)
    carrotInactive: '#52525b', // Zinc 600 (Unpinned)
    carrotGlow: '0 0 8px rgba(129, 140, 248, 0.50)',
  },

  // 3. Audio & Media
  media: {
    primary: '#22d3ee', // Luminescent Cyan
    accent: '#38bdf8', // Soft Ice Blue
    bg: 'rgba(34, 211, 238, 0.10)',
    border: 'rgba(34, 211, 238, 0.25)',
    glow: '0 0 8px rgba(34, 211, 238, 0.50)',
  },

  // 4. Hardware Controls & Sliders
  controls: {
    volumeActive: '#38bdf8', // Cyan / Ice Blue
    volumeMuted: '#71717a', // Muted Gray
    brightnessLumen: '#e3e0f7', // Moonlight Pearl
    capsLockActive: '#c084fc', // Cosmic Mauve (Active Ears Up)
    capsLockInactive: '#52525b', // Relaxed Ears Down
  },

  // 5. Solid Matte Obsidian Surfaces
  surfaces: {
    shell: '#09090b',
    card: '#121215',
    pill: '#18181c',
    pillHover: '#222226',
    border: '#27272a',
    borderSubtle: '#222226',
    borderHighlight: '#2e2e34',
  },
} as const;

export type CosmicTokens = typeof cosmicTokens;
