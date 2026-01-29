/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'mm-bg': '#1a1a2e',
        'mm-surface': '#16213e',
        'mm-primary': '#e94560',
        'mm-secondary': '#0f3460',
        'mm-text': '#eaeaea',
        'mm-muted': '#8b8b8b',
      }
    },
  },
  plugins: [],
}
