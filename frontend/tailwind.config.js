/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        dark: { 900: "#0f1117", 800: "#1a1d27", 700: "#1e2235", 600: "#2a2d3e" },
      },
    },
  },
  plugins: [],
}

