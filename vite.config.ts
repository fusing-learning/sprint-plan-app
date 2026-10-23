import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    // For `npm run dev:shared`: forward API calls to `npm run server:api`.
    proxy: { '/api': `http://localhost:${process.env.PORT ?? 4000}` },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          ui: [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-select',
            '@radix-ui/react-tooltip',
            '@radix-ui/react-popover',
            '@radix-ui/react-switch',
            'lucide-react',
            'sonner',
          ],
          data: ['dexie', 'zod', 'date-fns', '@dnd-kit/core', '@dnd-kit/sortable'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
  },
});
