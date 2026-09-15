import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: false,
  // The workspace packages ship TypeScript/TSX source, so they are bundled in
  // rather than resolved at runtime. Everything else stays external and is
  // installed normally on the droplet — pdfkit in particular ships binary font
  // files that must not be bundled.
  noExternal: ['@suarza/ui', '@suarza/shared', '@suarza/receipt-pdf'],
  // PDFKit and qrcode are CommonJS with dynamic `require`s and binary font
  // files. Bundling them yields "Dynamic require of stream is not supported"
  // the moment a PDF is asked for, so they stay external and are installed
  // normally on the droplet.
  external: ['pdfkit', 'qrcode'],
});
