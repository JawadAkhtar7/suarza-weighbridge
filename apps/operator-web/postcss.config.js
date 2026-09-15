export default {
  plugins: {
    // Required so the @tailwind directives inside @suarza/ui's stylesheet are
    // inlined before Tailwind runs — without it the shared theme silently
    // ships unprocessed.
    'postcss-import': {},
    tailwindcss: {},
    autoprefixer: {},
  },
};
