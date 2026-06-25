/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fff1f1",
          100: "#ffe2e3",
          600: "#91080B",
          700: "#7b0609",
          800: "#640507",
          900: "#4f0305"
        }
      },
      boxShadow: {
        soft: "0 18px 45px -30px rgb(15 23 42 / 0.35)",
        panel: "0 20px 60px -42px rgb(79 3 5 / 0.35)"
      }
    }
  },
  plugins: []
};
