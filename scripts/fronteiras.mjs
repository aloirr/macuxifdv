#!/usr/bin/env node
/**
 * Roda as regras de fronteira (dependency-cruiser) em apps/, packages/ e modules/ — só nas pastas
 * que existem (modules/ nasce na Fase B da T-0001). Código de saída = nº de violações de erro.
 * Uso: pnpm fronteiras
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const alvos = ['apps', 'packages', 'modules'].filter((p) => existsSync(join(raiz, p)));
const bin = join(raiz, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruise.mjs');

const r = spawnSync(process.execPath, [bin, ...alvos, '--config', '.dependency-cruiser.cjs', ...process.argv.slice(2)], {
  cwd: raiz,
  stdio: 'inherit',
});
process.exit(r.status ?? 1);
