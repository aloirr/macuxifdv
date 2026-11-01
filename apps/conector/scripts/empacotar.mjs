#!/usr/bin/env node
/**
 * Empacota o Conector em um único arquivo (dist/conector.mjs) com esbuild. O pacote entregue ao cliente leva o PRÓPRIO Node 24
 * LTS portátil (>= 24.7, mínimo do projeto) junto do WinSW: não depende do Node instalado no servidor do cliente (decisão do
 * Alexandre, R-20261031-233442 item 4; ver docs/modulos/integracao/conector.md, "Requisitos" e "Pacote"). `node:sqlite` fica de
 * fora (é do próprio Node). Uso: pnpm --filter @macuxi/conector build
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
  target: 'node24',
  sourcemap: true,
  minify: false,
  external: ['node:*'],
  // pacotes CommonJS (pg, tedious) usam require() dinâmico: precisam de um require no escopo do módulo ESM
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
