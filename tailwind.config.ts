import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-display)"],
        body: ["var(--font-body)"],
      },
      colors: {
        court: {
          orange: "#E8621A",
          dark: "#0F0E0C",
          brown: "#1C1914",
          tan: "#C8A96E",
          cream: "#F5EDD8",
          muted: "#8A7E6D",
        },
      },
    },
  },
  plugins: [],
};
export default config;
