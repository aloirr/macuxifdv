// Testes do escopo do CI (T-0033 → T-0160; ADR 0014 e ADR 0044). node --test scripts/ci/*.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  afetados,
  classificar,
  decidir,
  diaEmManaus,
  ehDocumentacao,
  lerWorkspace,
  lidosPeloCodigo,
} from './escopo.mjs';

const RAIZ = fileURLToPath(new URL('../..', import.meta.url));
const QUARTA = new Date('2026-11-11T15:00:00Z');
const SEXTA = new Date('2026-11-13T15:00:00Z');

/** Workspace de mentira: sdk ← core ← vendedor; web e mobile usam core; gestor lê modules/vendedor e docs/modulos (inputs). */
const WS = {
  pacotes: [
    { nome: '@macuxi/sdk', dir: 'packages/sdk', deps: [] },
    { nome: '@macuxi/core', dir: 'modules/core', deps: ['@macuxi/sdk'] },
    { nome: '@macuxi/vendedor', dir: 'modules/vendedor', deps: ['@macuxi/core'] },
    { nome: '@macuxi/gestor', dir: 'modules/gestor', deps: ['@macuxi/sdk'] },
    { nome: '@macuxi/db', dir: 'db', deps: [] },
    { nome: 'web', dir: 'apps/web', deps: ['@macuxi/core'] },
    { nome: 'mobile', dir: 'apps/mobile', deps: ['@macuxi/vendedor'] },
  ],
  turbo: {
    tasks: {
      '@macuxi/gestor#test': {
        inputs: [
          '$TURBO_DEFAULT$',
          '$TURBO_ROOT$/modules/vendedor/**',
          '$TURBO_ROOT$/docs/modulos/**',
          '!$TURBO_ROOT$/**/node_modules/**',
        ],
      },
    },
  },
};
const LIDOS = lidosPeloCodigo(WS.turbo);

test('documentação: .coord/**, docs/** e *.md da raiz; fora dela, as pastas que o código lê (inputs do turbo.json)', () => {
  assert.deepEqual(LIDOS, ['docs/modulos/']);
  for (const a of [
    '.coord/quadro.md',
    '.coord/donos.json',
    'docs/status/demo.md',
    'docs/desenho/T-0160.md',
    'docs/decisoes/0044-x.md',
    'CLAUDE.md',
    'README.md',
  ]) {
    assert.equal(ehDocumentacao(a, LIDOS), true, a);
  }
  for (const a of [
    'docs/modulos/integracao/hub-api.md',
    'modules/core/README.md',
    'tests/a.md',
    '.coordenacao/x.md',
    'docsx/a.md',
    'package.json',
    '',
  ]) {
    assert.equal(ehDocumentacao(a, LIDOS), false, a);
  }
  assert.equal(classificar(['.coord/quadro.md', 'docs/backlog.md', 'CLAUDE.md'], LIDOS), 'documentacao');
  assert.equal(classificar(['.coord/quadro.md', 'docs/modulos/integracao/hub-api.md'], LIDOS), 'codigo');
  assert.equal(classificar(['.coord/quadro.md', 'modules/core/domain/a.ts'], LIDOS), 'codigo');
  assert.equal(classificar([], LIDOS), 'codigo');
  assert.equal(classificar(['', '  '], LIDOS), 'codigo');
});

test('a pasta lida pelo código no repositório real é a docs/modulos/ (o teste da Integração lê o hub-api.md)', () => {
  assert.deepEqual(lidosPeloCodigo(lerWorkspace(RAIZ).turbo), ['docs/modulos/']);
});

test('afetados: o pacote alterado e os dependentes declarados, em cadeia; inputs do turbo.json valem só para a tarefa deles', () => {
  const af = afetados(['packages/sdk/src/a.ts'], WS);
  assert.equal(af.todos, false);
  assert.deepEqual([...af.porTarefa.test].sort(), [
    '@macuxi/core',
    '@macuxi/gestor',
    '@macuxi/sdk',
    '@macuxi/vendedor',
    'mobile',
    'web',
  ]);
  const v = afetados(['modules/vendedor/domain/a.ts'], WS);
  assert.deepEqual([...v.porTarefa.lint].sort(), ['@macuxi/vendedor', 'mobile']);
  assert.deepEqual([...v.porTarefa.test].sort(), ['@macuxi/gestor', '@macuxi/vendedor', 'mobile']); // gestor#test lê modules/vendedor
  const d = afetados(['docs/modulos/gestor/regras.md'], WS);
  assert.deepEqual([d.todos, [...d.porTarefa.test], [...d.porTarefa.lint]], [false, ['@macuxi/gestor'], []]);
});

test('afetados: tests/ não seleciona pacote; arquivo global (lockfile, package.json, turbo.json, .github, scripts) = todos', () => {
  const t = afetados(['tests/integracao/a.test.ts', '.coord/quadro.md'], WS);
  assert.deepEqual([t.todos, t.porTarefa.test.size, t.porTarefa.lint.size], [false, 0, 0]);
  for (const a of [
    'pnpm-lock.yaml',
    'package.json',
    'turbo.json',
    'tsconfig.json',
    '.github/workflows/ci.yml',
    'scripts/fronteiras.mjs',
    '.nvmrc',
  ]) {
    assert.equal(afetados(['modules/core/a.ts', a], WS).todos, true, a);
  }
});

test('decidir: só documentação → documentacao (PR, push, ensaio e sexta); agendado e manual completo rodam tudo', () => {
  const docs = ['.coord/quadro.md', 'docs/desenho/T-0160.md', 'CLAUDE.md'];
  for (const evento of ['pull_request', 'push', 'workflow_dispatch']) {
    for (const agora of [QUARTA, SEXTA])
      assert.equal(
        decidir({ evento, arquivos: docs, agora, workspace: WS }).escopo,
        'documentacao',
        `${evento} ${agora.toISOString()}`,
      );
  }
  for (const d of [
    decidir({ evento: 'schedule', arquivos: docs, agora: QUARTA, workspace: WS }),
    decidir({ evento: 'workflow_dispatch', arquivos: docs, completo: true, agora: QUARTA, workspace: WS }),
  ]) {
    assert.deepEqual(
      [d.escopo, d.matriz, d.filtro_test, d.build, d.db_sem_super],
      ['codigo', 'completa', '', 'true', 'true'],
    );
    assert.deepEqual(d.jobs, ['estatico', 'testes-pacotes', 'testes-integracao']);
  }
});

test('decidir: PR, ensaio e push = pacotes afetados com o tests/ da raiz; build só se web ou mobile; db sem superusuário só se o db', () => {
  const d = decidir({
    evento: 'pull_request',
    arquivos: ['modules/core/domain/a.ts'],
    agora: QUARTA,
    workspace: WS,
  });
  assert.deepEqual([d.escopo, d.matriz], ['codigo', 'afetados']);
  assert.equal(
    d.filtro_lint,
    '--filter=@macuxi/core --filter=@macuxi/vendedor --filter=mobile --filter=web --filter=//',
  );
  assert.equal(d.filtro_test, '--filter=@macuxi/core --filter=@macuxi/vendedor --filter=mobile --filter=web');
  assert.deepEqual([d.build, d.db_sem_super], ['true', 'false']);
  const db = decidir({
    evento: 'workflow_dispatch',
    arquivos: ['db/migrations/0060.sql'],
    agora: QUARTA,
    workspace: WS,
  });
  assert.deepEqual([db.filtro_test, db.build, db.db_sem_super], ['--filter=@macuxi/db', 'false', 'true']);
  const t = decidir({ evento: 'push', arquivos: ['tests/a.test.ts'], agora: QUARTA, workspace: WS });
  assert.deepEqual(
    [t.jobs, t.filtro_lint, t.filtro_typecheck, t.build],
    [['estatico', 'testes-integracao'], '--filter=//', '--filter=//', 'false'],
  );
});

test('decidir: sexta em Manaus (véspera da produção), lista vazia ou sem lista = todos os pacotes', () => {
  const s = decidir({ evento: 'push', arquivos: ['modules/core/a.ts'], agora: SEXTA, workspace: WS });
  assert.deepEqual([s.matriz, s.filtro_lint, s.filtro_test], ['completa', '', '']);
  for (const arquivos of [null, []]) {
    const d = decidir({ evento: 'push', arquivos, agora: QUARTA, workspace: WS });
    assert.deepEqual([d.escopo, d.matriz, d.filtro_test, d.build], ['codigo', 'afetados', '', 'true']);
  }
});

test('decidir: push de árvore já verde = reaproveitado (só no push; PR e ensaio sempre testam)', () => {
  const d = decidir({
    evento: 'push',
    arquivos: ['modules/core/a.ts'],
    agora: QUARTA,
    workspace: WS,
    reaproveitado: 123,
  });
  assert.deepEqual([d.escopo, d.reaproveitado_de, d.jobs], ['reaproveitado', '123', []]);
  assert.equal(
    decidir({
      evento: 'pull_request',
      arquivos: ['modules/core/a.ts'],
      agora: QUARTA,
      workspace: WS,
      reaproveitado: 123,
    }).escopo,
    'codigo',
  );
  // só documentação continua documentacao (a governança é a mesma)
  assert.equal(
    decidir({ evento: 'push', arquivos: ['docs/a.md'], agora: QUARTA, workspace: WS, reaproveitado: 123 })
      .escopo,
    'documentacao',
  );
});

test('diaEmManaus: o dia vira às 04:00 UTC', () => {
  assert.equal(diaEmManaus(new Date('2026-11-13T03:59:00Z')), 4);
  assert.equal(diaEmManaus(new Date('2026-11-13T04:00:00Z')), 5);
  assert.equal(diaEmManaus(QUARTA), 3);
});

test('workspace real: mudança no SDK seleciona api, web e mobile; no db, o @macuxi/db', () => {
  const ws = lerWorkspace(RAIZ);
  const d = decidir({
    evento: 'pull_request',
    arquivos: ['packages/platform-sdk/src/diagnostico.ts'],
    agora: QUARTA,
    workspace: ws,
  });
  for (const n of ['api', 'web', 'mobile', '@macuxi/core'])
    assert.ok(d.filtro_test.split(' ').includes(`--filter=${n}`), n);
  assert.equal(d.build, 'true');
  assert.equal(
    decidir({ evento: 'pull_request', arquivos: ['db/migrations/x.sql'], agora: QUARTA, workspace: ws })
      .db_sem_super,
    'true',
  );
});

test('CLI num repositório git: PR só de .coord → documentacao; push → afetados pela base; ANTES zerado e agendado → todos', () => {
  const dir = mkdtempSync(join(tmpdir(), 'escopo-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
  const escrever = (rel, c) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), c);
  };
  const script = fileURLToPath(new URL('./escopo.mjs', import.meta.url));
  const rodar = (env) => {
    const out = join(dir, 'saida.txt');
    writeFileSync(out, '');
    execFileSync(process.execPath, [script], {
      cwd: dir,
      env: {
        ...process.env,
        MACUXI_CI_SEM_API: '1',
        MACUXI_CI_AGORA: QUARTA.toISOString(),
        ...env,
        GITHUB_OUTPUT: out,
      },
      encoding: 'utf8',
    });
    return Object.fromEntries(
      readFileSync(out, 'utf8')
        .trim()
        .split('\n')
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    );
  };
  try {
    git('init', '-q');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    escrever('modules/core/package.json', JSON.stringify({ name: '@macuxi/core' }));
    escrever('modules/core/a.ts', '1');
    escrever(
      'apps/web/package.json',
      JSON.stringify({ name: 'web', dependencies: { '@macuxi/core': 'workspace:*' } }),
    );
    escrever('turbo.json', JSON.stringify({ tasks: {} }));
    escrever('saida.txt', '');
    escrever('.gitignore', 'saida.txt\n');
    git('add', '-A');
    git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD');
    git('checkout', '-qb', 'pr');
    escrever('.coord/recados/R.md', 'x');
    git('add', '-A');
    git('commit', '-qm', 'recado');
    const recado = git('rev-parse', 'HEAD');
    git('checkout', '-q', '-');
    escrever('modules/core/b.ts', '2'); // a base andou (código) depois do PR abrir
    git('add', '-A');
    git('commit', '-qm', 'base andou');
    const andou = git('rev-parse', 'HEAD');
    git('merge', '-q', '--no-ff', 'pr', '-m', 'merge'); // como o refs/pull/N/merge
    let r = rodar({ GITHUB_EVENT_NAME: 'pull_request' });
    assert.deepEqual([r.escopo, r.jobs], ['documentacao', '[]']);
    assert.match(r.arvore, /^[0-9a-f]{40}$/);
    r = rodar({ GITHUB_EVENT_NAME: 'push', ANTES: base, DEPOIS: recado });
    assert.deepEqual([r.escopo, r.base], ['documentacao', base]);
    r = rodar({ GITHUB_EVENT_NAME: 'push', ANTES: base, DEPOIS: andou });
    assert.deepEqual(
      [r.escopo, r.matriz, r.filtro_test, r.build],
      ['codigo', 'afetados', '--filter=@macuxi/core --filter=web', 'true'],
    );
    r = rodar({ GITHUB_EVENT_NAME: 'schedule' });
    assert.deepEqual([r.escopo, r.matriz, r.filtro_test], ['codigo', 'completa', '']);
    r = rodar({
      GITHUB_EVENT_NAME: 'push',
      ANTES: '0000000000000000000000000000000000000000',
      DEPOIS: recado,
    });
    assert.deepEqual([r.escopo, r.base, r.filtro_test], ['codigo', '', '']);
    r = rodar({ GITHUB_EVENT_NAME: 'push', ANTES: 'naoexiste', DEPOIS: recado });
    assert.deepEqual([r.escopo, r.filtro_test], ['codigo', '']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
