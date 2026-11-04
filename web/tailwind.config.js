/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        card: "rgb(var(--card) / <alpha-value>)",
        "card-hover": "rgb(var(--card-hover) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        primary: {
          DEFAULT: "rgb(var(--primary) / <alpha-value>)",
          light: "rgb(var(--primary-light) / <alpha-value>)",
          dark: "rgb(var(--primary-dark) / <alpha-value>)",
        },
        ink: "rgb(var(--text) / <alpha-value>)",
        muted: "rgb(var(--text-muted) / <alpha-value>)",
        dim: "rgb(var(--text-dim) / <alpha-value>)",
        ok: "rgb(var(--ok) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "Segoe UI", "Roboto", "Arial", "sans-serif"],
        mono: ['"Cascadia Code"', "Consolas", "ui-monospace", "monospace"],
      },
      borderRadius: { xl: "14px", "2xl": "20px", "3xl": "26px" },
      boxShadow: {
        glow: "0 0 0 1px rgba(124,92,255,0.25), 0 8px 30px -8px rgba(124,92,255,0.35)",
        card: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 10px 30px -18px rgba(0,0,0,0.8)",
      },
      keyframes: {
        pulse2: { "0%,100%": { opacity: 1 }, "50%": { opacity: 0.35 } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "fade-up": { from: { opacity: 0, transform: "translateY(6px)" }, to: { opacity: 1, transform: "none" } },
      },
      animation: {
        pulse2: "pulse2 2.2s ease-in-out infinite",
        "fade-up": "fade-up 0.35s ease both",
      },
    },
  },
  plugins: [],
};
