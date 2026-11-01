#!/usr/bin/env node
/**
 * Varredura de relógio (agente testes, pedido R-20261101-160851-alexandre): roda as suítes Vitest SEM banco com o
 * relógio do Node deslocado para instantes críticos (virada do dia em Manaus, fim de mês, virada do ano, longe no
 * futuro) e lista o que reprova só por causa da hora. Resultado em tests/plano/relogio-varredura.md.
 *
 *   node tests/scripts/varrer-relogio.mjs                       # todos os alvos padrão, todos os pacotes
 *   node tests/scripts/varrer-relogio.mjs --alvo 2026-12-01T03:59:30Z --pacote modules/core
 *   node tests/scripts/varrer-relogio.mjs --saida <pasta>       # JSON por pacote/alvo (padrão: pasta temporária)
 *
 * Postgres fica fora (MACUXI_PG_PORTA=1, sem subir Docker): o now() do banco não é deslocável por aqui.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PRELOAD = join(RAIZ, 'tests/scripts/relogio-deslocado.cjs');
const VITEST = join(RAIZ, 'node_modules/vitest/vitest.mjs');

export const ALVOS_PADRAO = {
  'manaus-23h59': '2026-11-02T03:59:30Z', // 23:59 em Manaus; já é o dia seguinte em UTC
  'fim-de-mes': '2026-12-01T03:59:30Z', // 30/11 23:59 em Manaus; 01/12 em UTC
  'virada-ano-utc': '2027-01-01T00:30:00Z', // 31/12 20:30 em Manaus
  'madrugada-manaus': '2026-11-03T05:30:00Z', // 01:30 em Manaus (janela 00:00–03:00 dos "now − N horas")
  'futuro-2031': '2031-07-15T15:00:00Z',
};
export const PACOTES = [
  'apps/api', 'apps/conector', 'apps/mobile', 'apps/web', 'db', 'modules/catalogo', 'modules/core', 'modules/gestor', 'modules/integracao',
  'modules/pesquisa', 'modules/promotor', 'modules/treinamento', 'modules/vendedor', 'packages/comum', 'packages/config', 'packages/platform-sdk', 'packages/ui', 'tests',
];

function arg(nome) {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function rodar(pacote, alvo, saida) {
  const arquivo = join(saida, `${pacote.replace(/\//g, '_')}.json`);
  const env = { ...process.env, MACUXI_PG_PORTA: '1', MACUXI_PG_AUTO_SUBIR: '0', MACUXI_PG_EXIGIR: '0' };
  if (alvo) Object.assign(env, { MACUXI_RELOGIO_ALVO: alvo, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require ${PRELOAD}`.trim() });
  const args = pacote === 'tests' ? ['run', '--config', 'tests/vitest.config.ts'] : ['run', '--passWithNoTests'];
  spawnSync(process.execPath, [VITEST, ...args, '--reporter=json', `--outputFile=${arquivo}`], { cwd: pacote === 'tests' ? RAIZ : join(RAIZ, pacote), env, stdio: 'ignore', timeout: 900_000 });
  if (!existsSync(arquivo)) return [{ teste: `${pacote}: sem resultado (falha ao rodar)`, erro: '' }];
  const j = JSON.parse(readFileSync(arquivo, 'utf8'));
  const falhas = [];
  for (const r of j.testResults) {
    const nome = r.name.replace(/\\/g, '/').replace(/.*macuxifdv\//i, '');
    if (r.status === 'failed' && r.assertionResults.every((a) => a.status !== 'failed')) falhas.push({ teste: `${nome} (arquivo)`, erro: (r.message ?? '').split('\n')[0] });
    for (const a of r.assertionResults) if (a.status === 'failed') falhas.push({ teste: `${nome} :: ${a.fullName}`, erro: (a.failureMessages[0] ?? '').split('\n')[0] });
  }
  return falhas;
}

const alvoUnico = arg('alvo');
const pacotes = arg('pacote') ? [arg('pacote')] : PACOTES;
const base = arg('saida') ?? mkdtempSync(join(tmpdir(), 'macuxi-relogio-'));
const alvos = alvoUnico ? { unico: alvoUnico } : ALVOS_PADRAO;
const chave = (f) => f.teste;

const referencia = new Set();
for (const p of pacotes) {
  const d = join(base, 'base');
  mkdirSync(d, { recursive: true });
  for (const f of rodar(p, '', d)) referencia.add(chave(f));
}
let novas = 0;
for (const [rotulo, alvo] of Object.entries(alvos)) {
  const d = join(base, rotulo);
  mkdirSync(d, { recursive: true });
  for (const p of pacotes) {
    for (const f of rodar(p, alvo, d)) {
      if (referencia.has(chave(f))) continue;
      novas += 1;
      console.log(`[${rotulo} ${alvo}] ${f.teste}\n    ${f.erro.slice(0, 300)}`);
    }
  }
}
console.log(`\n${novas} falha(s) que dependem do relógio (fora as que já falham sem deslocar: ${referencia.size}). JSON em ${base}`);
process.exitCode = novas > 0 ? 1 : 0;
