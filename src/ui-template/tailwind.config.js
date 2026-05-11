/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/ui-template/src/**/*.{ts,tsx}", "./src/ui-template/index.html"],
  theme: {
    extend: {
      colors: {
        primary: "#3B82F6",
        secondary: "#60A5FA",
        cta: "#F97316",
        background: "#F8FAFC",
        text: "#1E293B",
        border: "#E2E8F0",
      },
    },
  },
  plugins: [],
};
