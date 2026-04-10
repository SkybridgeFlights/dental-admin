import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './actions/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0f172a',
          card:    '#1e293b',
          hover:   '#334155',
        },
        accent: {
          DEFAULT: '#3b82f6',
          hover:   '#2563eb',
        },
      },
    },
  },
  plugins: [],
};

export default config;
