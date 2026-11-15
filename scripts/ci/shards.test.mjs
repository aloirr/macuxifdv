// Testes dos shards do testes-pacotes (R-20261114-221000-alexandre). node --test scripts/ci/*.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { lerWorkspace } from './escopo.mjs';
import {
  SEM_SUPER,
  decidirShard,
  dividir,
  itensDoWorkspace,
  lerParametros,
  nomesDoFiltro,
  pesoDaPasta,
} from './shards.mjs';

const RAIZ = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT = fileURLToPath(new URL('./shards.mjs', import.meta.url));

const ITENS = [
  { nome: 'a', peso: 10 },
  { nome: 'b', peso: 7 },
  { nome: 'c', peso: 5 },
  { nome: 'd', peso: 4 },
  { nome: 'e', peso: 1 },
];

/** Pacotes (não virtuais) de todos os shards, juntos. */
const todosOsPacotes = (itens, total) =>
  Array.from({ length: total }, (_, i) => decidirShard({ shard: i + 1, total, itens }))
    .flatMap((d) => d.filtro.split(' ').filter(Boolean))
    .map((f) => f.replace('--filter=', ''))
    .sort();

test('nomesDoFiltro: vazio = todos (null); ignora a raiz (--filter=//); token fora do formato = erro', () => {
  assert.equal(nomesDoFiltro(''), null);
  assert.equal(nomesDoFiltro('--filter=//'), null);
  assert.deepEqual(nomesDoFiltro('--filter=@macuxi/db  --filter=// --filter=web'), ['@macuxi/db', 'web']);
  assert.throws(() => nomesDoFiltro('web'), /filtro inválido/);
});

test('dividir: LPT determinística (maior peso primeiro, menor soma, empate no menor índice)', () => {
  const r = dividir(ITENS, 3).map((s) => [s.soma, s.itens.map((i) => i.nome)]);
  assert.deepEqual(r, [
    [10, ['a']],
    [8, ['b', 'e']],
    [9, ['c', 'd']],
  ]);
  // Empate de peso: pelo nome, independente da ordem de entrada.
  const empate = [
    { nome: 'z', peso: 2 },
    { nome: 'y', peso: 2 },
  ];
  assert.deepEqual(
    dividir(empate, 2).map((s) => s.itens.map((i) => i.nome)),
    [['y'], ['z']],
  );
});

test('filtro vazio (todos os pacotes): os 3 shards cobrem cada pacote exatamente uma vez', () => {
  const ws = lerWorkspace(RAIZ);
  const itens = itensDoWorkspace(ws, RAIZ, '', false);
  assert.deepEqual(todosOsPacotes(itens, 3), ws.pacotes.map((p) => p.nome).sort());
});

test('admin sem superusuário: em exatamente um shard, só com DB_SEM_SUPER', () => {
  const com = [...ITENS, { nome: SEM_SUPER, peso: 6, virtual: true }];
  const shards = [1, 2, 3].map((shard) => decidirShard({ shard, total: 3, itens: com }));
  assert.equal(shards.filter((d) => d.db_sem_super === 'true').length, 1);
  assert.ok(shards.every((d) => !d.filtro.includes(SEM_SUPER)));
  const sem = [1, 2, 3].map((shard) => decidirShard({ shard, total: 3, itens: ITENS }));
  assert.ok(sem.every((d) => d.db_sem_super === 'false'));
});

test('shard vazio: vazio=true e filtro vazio (o job NÃO pode chamar turbo run test sem filtro)', () => {
  const d = decidirShard({ shard: 3, total: 3, itens: [{ nome: 'web', peso: 2 }] });
  assert.deepEqual([d.filtro, d.vazio, d.db_sem_super], ['', 'true', 'false']);
  // Shard só com o admin sem superusuário (empate de peso: "(" vem antes de "@"): sem pacote turbo, mas roda o admin.
  const so = decidirShard({
    shard: 1,
    total: 2,
    itens: [
      { nome: '@macuxi/db', peso: 9 },
      { nome: SEM_SUPER, peso: 9, virtual: true },
    ],
  });
  assert.deepEqual([so.filtro, so.vazio, so.db_sem_super], ['', 'true', 'true']);
});

test('SHARD/TOTAL inválidos = erro de uso (saída 2 no CLI)', () => {
  assert.deepEqual(lerParametros({ SHARD: '2', TOTAL: '3', FILTRO: '', DB_SEM_SUPER: 'true' }), {
    shard: 2,
    total: 3,
    filtro: '',
    dbSemSuper: true,
  });
  for (const env of [
    { SHARD: '0', TOTAL: '3' },
    { SHARD: '4', TOTAL: '3' },
    { SHARD: 'x', TOTAL: '3' },
    { SHARD: '1' },
  ])
    assert.throws(() => lerParametros(env), /inválido/);
  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd: RAIZ,
    env: { ...process.env, SHARD: '4', TOTAL: '3', GITHUB_OUTPUT: '' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /SHARD inválido/);
});

test('pesoDaPasta: *.test.* = 1, *.db.test.* = 3, ignora node_modules/dist; mínimo 1', () => {
  const d = mkdtempSync(join(tmpdir(), 'shards-'));
  try {
    mkdirSync(join(d, 'src'), { recursive: true });
    mkdirSync(join(d, 'node_modules', 'x'), { recursive: true });
    mkdirSync(join(d, 'dist'), { recursive: true });
    for (const f of [
      'src/a.test.ts',
      'src/b.db.test.ts',
      'node_modules/x/c.test.js',
      'dist/d.test.js',
      'src/e.ts',
    ])
      writeFileSync(join(d, f), '');
    assert.equal(pesoDaPasta(d), 4);
    assert.equal(pesoDaPasta(join(d, 'dist', 'nada')), 1);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('repositório real (CLI): 3 shards cobrem todos os pacotes e nenhum passa de metade do peso total', () => {
  const ws = lerWorkspace(RAIZ);
  const saidas = [1, 2, 3].map((shard) => {
    const r = spawnSync(process.execPath, [SCRIPT], {
      cwd: RAIZ,
      env: {
        ...process.env,
        SHARD: String(shard),
        TOTAL: '3',
        FILTRO: '',
        DB_SEM_SUPER: 'true',
        GITHUB_OUTPUT: '',
      },
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    return Object.fromEntries(
      r.stdout
        .split('\n')
        .filter((l) => /^(filtro|db_sem_super|vazio)=/.test(l))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    );
  });
  const nomes = saidas
    .flatMap((s) => s.filtro.split(' ').filter(Boolean))
    .map((f) => f.replace('--filter=', ''));
  assert.deepEqual(nomes.sort(), ws.pacotes.map((p) => p.nome).sort());
  assert.equal(saidas.filter((s) => s.db_sem_super === 'true').length, 1);
  const itens = itensDoWorkspace(ws, RAIZ, '', true);
  const total = itens.reduce((s, i) => s + i.peso, 0);
  for (const s of dividir(itens, 3)) assert.ok(s.soma <= total / 2, `shard com ${s.soma} de ${total}`);
});
