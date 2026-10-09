import { defineConfig } from 'vite';
export default defineConfig({ worker: { format: 'es' }, test: { include: ['tests/**/*.test.ts'] } } as Parameters<typeof defineConfig>[0]);
