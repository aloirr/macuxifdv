import { defineConfig } from 'vitest/config';

// testes puros (formatação, datas, faróis): sem DOM nem React Native
export default defineConfig({ test: { include: ['src/**/*.test.ts'], environment: 'node' } });
