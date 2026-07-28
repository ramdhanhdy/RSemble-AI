/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#05080f",
        shell: "#0a0f1c",
        panel: "#0d1424",
        card: { DEFAULT: "#111a2e", hover: "#16213a" },
        raised: "#1b2740",
        edge: { DEFAULT: "#1c2942", bright: "#2b3d5f" },
        accent: { DEFAULT: "#22d3ee", deep: "#0e7490" },
        "on-accent": "#04202b",
        text: { DEFAULT: "#e6edf7", secondary: "#a9b6c9", muted: "#7f8da3" },
        success: "#34d399",
        warning: "#fbbf24",
        error: "#fb7185",
      },
      borderRadius: {
        sm: "6px",
        md: "10px",
        lg: "14px",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(34,211,238,.45), 0 0 24px rgba(34,211,238,.18)",
        cta: "0 4px 20px rgba(34,211,238,.25)",
        popover: "0 16px 48px -12px rgba(0,0,0,.7)",
      },
      fontFamily: {
        sans: [
          "Geist",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: ["Geist Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      keyframes: {
        "dash-march": {
          to: { "stroke-dashoffset": "-12" },
        },
      },
      animation: {
        "dash-march": "dash-march 1.2s linear infinite",
      },
    },
  },
  plugins: [],
};
