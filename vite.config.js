const { defineConfig } = require('vite');

module.exports = defineConfig({
  base: './',
  publicDir: false,
  build: { target: 'es2020', sourcemap: false, outDir: 'dist', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5173 }
});
