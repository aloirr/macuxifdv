// Testes da varredura de timers (RN-CORE-23, ADR 0018): node --test scripts/ci/timers-sync.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { avaliar, MINIMO_MS, varrerTexto } from './timers-sync.mjs';

const nada = () => null;

test('avalia números, contas, constantes e intervaloSyncAutoMs', () => {
  assert.equal(avaliar('10_000', nada), 10_000);
  assert.equal(avaliar('15 * 60_000', nada), MINIMO_MS);
  assert.equal(avaliar('X * 2', (n) => (n === 'X' ? '60_000' : null)), 120_000);
  assert.equal(avaliar('intervaloSyncAutoMs(p.sync_auto_min)', nada), MINIMO_MS);
  assert.equal(avaliar('algumaFuncao()', nada), null);
  assert.equal(avaliar('IMPORTADA', nada), null);
});

test('setInterval curto, sem avaliação ou refetchInterval curto = violação', () => {
  const t = [
    'const POLL = 60_000;',
    'setInterval(() => void carregar(), POLL);',
    'setInterval(() => tick(), outro());',
    'useQuery({ queryKey: [1], refetchInterval: 10_000, queryFn });',
  ].join('\n');
  const v = varrerTexto(t, 'x.tsx');
  assert.deepEqual(v.map((x) => [x.linha, x.tipo, x.ms]), [
    [2, 'setInterval', 60_000],
    [3, 'setInterval', null],
    [4, 'refetchInterval', 10_000],
  ]);
});

test('>= 15 min, refetchInterval false, comentário e timer-permitido passam', () => {
  const t = [
    'const AUTO = 30 * 60_000;',
    'setInterval(() => sincronizar(), AUTO);',
    'useQuery({ refetchInterval: false });',
    '// exemplo: setInterval(() => x(), 1000)',
    '// timer-permitido: relógio da tela, sem rede',
    'setInterval(() => setAgora(Date.now()), 30_000);',
    'useQuery({ refetchInterval: intervaloSyncAutoMs(SYNC_AUTO_PADRAO_MIN) });',
  ].join('\n');
  assert.deepEqual(varrerTexto(t, 'y.tsx'), []);
});

test('constante exportada de outro arquivo resolve pelo índice global', () => {
  const v = varrerTexto('setInterval(f, LIVE_MS);', 'z.ts', (n) => (n === 'LIVE_MS' ? '10_000' : null));
  assert.equal(v[0].ms, 10_000);
});
