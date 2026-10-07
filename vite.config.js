import { defineConfig } from 'vite';
import path from 'node:path';

const assetRoot = path.resolve(process.env.ACU_MAP_ASSET_ROOT || 'public');

export default defineConfig({
  root: 'web',
  base: './',
  publicDir: assetRoot,
  plugins: [{
    name: 'android-local-assets',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => html.replaceAll(' crossorigin', ''),
    },
  }],
  build: {
    outDir: '../app/src/main/assets',
    emptyOutDir: true,
  },
  server: {
    fs: { allow: ['..', assetRoot] },
  },
});
