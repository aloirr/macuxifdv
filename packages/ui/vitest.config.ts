import { defineConfig } from 'vitest/config';

// testes puros (formatação, datas, faróis, árvore do TableScroll): sem DOM nem React Native.
// JSX automático como no tsconfig (react-jsx): o teste do TableScroll chama o componente web como função.
export default defineConfig({ esbuild: { jsx: 'automatic' }, test: { include: ['src/**/*.test.ts'], environment: 'node' } });
