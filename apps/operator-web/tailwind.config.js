import animate from 'tailwindcss-animate';
import preset from '@suarza/ui/tailwind-preset';

/** @type {import('tailwindcss').Config} */
export default {
  presets: [preset],
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    // The shared kit's classes live outside this app, so Tailwind has to be
    // told to scan it or half the components ship without their styles.
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  plugins: [animate],
};
