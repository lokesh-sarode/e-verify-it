/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      boxShadow: {
        soft: "0 18px 45px -30px rgb(15 23 42 / 0.35)"
      }
    }
  },
  plugins: []
};

