import { defineConfig } from 'vite';
import { captureExport } from './scripts/capture-export.ts';
export default defineConfig({ plugins: [captureExport()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true,
    proxy: { '/api/rooms': 'http://127.0.0.1:3001', '/api/health': 'http://127.0.0.1:3001' } },
  build: { rollupOptions: { input: { solo: 'index.html', online: 'online.html' } } },
});
