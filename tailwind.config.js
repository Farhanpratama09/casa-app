/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        island: {
          bg: "#0D0E12", // Cosmic Ink base notch
          cosmic: "#0D0E12", // Cosmic Ink
          accent: "#98BBD6", // Ice Blue living glow / eyes
          glow: "#98BBD6",
          border: "rgba(255, 255, 255, 0.08)",
          secondary: "#8E8E93",
          green: "#30D158",
          orange: "#FF9F0A",
          red: "#FF453A",
          blue: "#0A84FF",
          purple: "#BF5AF2",
          pink: "#FF375F",
        },
      },
      fontFamily: {
        sans: ['Montserrat', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'], // khusus angka durasi/timer
        urbanist: ['Montserrat', 'sans-serif'],
        syncopate: ["'Syncopate'", "sans-serif"],
        space: ["'Space Grotesk'", "sans-serif"],
      },
      boxShadow: {
        island: "0 10px 40px -10px rgba(0, 0, 0, 0.8), 0 0 1px 1px rgba(255, 255, 255, 0.08)",
        ambient: '0 4px 14px -2px rgba(0, 0, 0, 0.20), 0 2px 6px -1px rgba(0, 0, 0, 0.10)',
        "ambient-glow": '0 4px 16px -2px rgba(152, 187, 214, 0.18), 0 2px 8px -1px rgba(0, 0, 0, 0.15)',
        glow: "0 0 20px rgba(152, 187, 214, 0.25)",
      },
    },
  },
  plugins: [],
}
