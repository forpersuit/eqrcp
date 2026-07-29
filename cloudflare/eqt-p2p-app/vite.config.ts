import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app-[name].js',
        chunkFileNames: 'assets/app-[name].js',
        assetFileNames: 'assets/app-[name].[ext]'
      }
    }
  }
});
