/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#0a0a0a",
        shell: "#0a0a0a",
        panel: "#121212",
        card: { DEFAULT: "#121212", hover: "#1a1a1a" },
        raised: "#181818",
        edge: { DEFAULT: "#262626", bright: "#3a3a3a" },
        accent: { DEFAULT: "#00e5ff", deep: "#00a9bd" },
        "on-accent": "#001719",
        text: { DEFAULT: "#ededed", secondary: "#a1a1a1", muted: "#777777" },
        success: "#00ff9d",
        warning: "#ffb300",
        error: "#ff4d4d",
      },
      borderRadius: {
        sm: "4px",
        md: "6px",
        lg: "8px",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(0,229,255,.45), 0 0 24px rgba(0,229,255,.18)",
        cta: "0 4px 20px rgba(0,229,255,.25)",
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
