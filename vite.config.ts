import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import './src/config/index.ts';

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      input: { app: fileURLToPath(new URL('./index.html', import.meta.url)), claimsExport: fileURLToPath(new URL('./src/claims/export.ts', import.meta.url)) },
      preserveEntrySignatures: 'strict',
      output: { entryFileNames: (chunk) => chunk.name === 'claimsExport' ? 'claims-export.js' : 'assets/[name]-[hash].js' },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
