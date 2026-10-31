#!/usr/bin/env node
/**
 * Empacota o Conector em um único arquivo (dist/conector.mjs) com esbuild: o técnico do cliente só precisa do Node 22+
 * e desse arquivo (mais o WinSW). `node:sqlite` fica de fora (é do próprio Node). Uso: pnpm --filter @macuxi/conector build
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(raiz, 'dist'), { recursive: true });

await build({
  entryPoints: [join(raiz, 'src/cli.ts')],
  outfile: join(raiz, 'dist/conector.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  minify: false,
  external: ['node:*'],
  // pacotes CommonJS (pg, tedious) usam require() dinâmico: precisam de um require no escopo do módulo ESM
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
