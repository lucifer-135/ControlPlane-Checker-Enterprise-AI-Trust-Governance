import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { createDevWatchIgnore } from './src/server/devWatch';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    watch: {
      // Ignore only root runtime state (data/, policies/, *.db*); src/data/** stays watched.
      ignored: [createDevWatchIgnore(__dirname)],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
