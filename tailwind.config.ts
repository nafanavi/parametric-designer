import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        panel: '#1f2125',
        'panel-2': '#2a2d33',
        border: '#3a3d44',
      },
    },
  },
  plugins: [],
};

export default config;
