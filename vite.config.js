const path = require('node:path');
const { defineConfig } = require('vite');

module.exports = defineConfig({
  base: './',
  publicDir: false,
  resolve: {
    alias: {
      '@pdfjs/pdf.min.mjs': path.resolve(__dirname, 'src/reader/foliate-pdf-disabled.mjs')
    }
  },
  build: { target: 'es2020', sourcemap: false, outDir: 'dist', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5173 }
});
