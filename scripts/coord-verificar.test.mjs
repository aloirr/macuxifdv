// Testes do `node scripts/coord.mjs verificar` (node:test, sem dependências).
// Rodar: node --test scripts/coord-verificar.test.mjs
// Cada teste cria um repositório git temporário com cópia de coord.mjs/coord-lib.mjs e um
// .coord/donos.json de exemplo, para que RAIZ (pasta do script) seja o repositório temporário.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { classificarMudancas, globParaRegex, normalizarCaminho } from './coord-lib.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));

const DONOS = {
  versao: 1,
  regras: [
    { padrao: 'scripts/coord*.mjs', dono: 'alexandre' },
    { padrao: 'legado/**', dono: 'congelado' },
    { padrao: '.coord/**', dono: 'gerente-projetos' },
    { padrao: 'modules/core/**', dono: 'modulo-core' },
    { padrao: 'apps/**', dono: 'engenheiro-software' },
    { padrao: 'docs/**', dono: 'gerente-projetos' },
  ], // sem regra "*": qualquer outro caminho é sem-dono
};
const RECADO = '---\nid: R-20261031-000000-modulo-core\nde: modulo-core\npara: [testes]\ntipo: aviso\n---\n# Olá\n';

const temporarios = [];
process.on('exit', () => { for (const d of temporarios) rmSync(d, { recursive: true, force: true }); });

function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function escrever(dir, rel, conteudo = `${rel}\n`) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), conteudo);
}
function commitar(dir, msg) {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', msg);
}

/** Repositório com main + 1 commit contendo scripts, donos, um recado e arquivos de cada dono. */
function criarRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'coord-verificar-'));
  temporarios.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Teste');
  git(dir, 'config', 'user.email', 'teste@exemplo.invalid');
  git(dir, 'config', 'commit.gpgsign', 'false');
  mkdirSync(join(dir, 'scripts'));
  copyFileSync(join(AQUI, 'coord.mjs'), join(dir, 'scripts', 'coord.mjs'));
  copyFileSync(join(AQUI, 'coord-lib.mjs'), join(dir, 'scripts', 'coord-lib.mjs'));
  escrever(dir, '.coord/donos.json', JSON.stringify(DONOS, null, 2));
  escrever(dir, '.coord/recados/testes/R-20261031-000000-modulo-core.md', RECADO);
  escrever(dir, 'modules/core/a.ts');
  escrever(dir, 'apps/api/x.ts');
  escrever(dir, 'legado/velho.txt');
  commitar(dir, 'inicial');
  return dir;
}

/** Roda o script do repositório `dir` (cwd = dir), sem herdar GITHUB_HEAD_REF do ambiente. */
function rodar(dir, args, env = {}) {
  const base = { ...process.env };
  delete base.GITHUB_HEAD_REF;
  const r = spawnSync(process.execPath, [join(dir, 'scripts', 'coord.mjs'), ...args], {
    cwd: dir, encoding: 'utf8', env: { ...base, ...env },
  });
  return { codigo: r.status, saida: r.stdout, erro: r.stderr, tudo: r.stdout + r.stderr };
}

/** Linhas de uma seção da saída ("OK", "VIOLAÇÃO", "Outros donos", "Exceções do protocolo"). */
function secao(saida, nome) {
  const blocos = saida.split(/\n\n/);
  const b = blocos.find((x) => x.startsWith(nome));
  return b ? b.split('\n').slice(1).map((l) => l.trim()) : [];
}

test('arquivo do próprio agente: OK e código 0', () => {
  const dir = criarRepo();
  escrever(dir, 'modules/core/a.ts', 'mudou\n');
  escrever(dir, 'modules/core/novo.ts');
  const r = rodar(dir, ['verificar', 'modulo-core']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.deepEqual(secao(r.saida, 'OK'), ['M modules/core/a.ts', 'A modules/core/novo.ts']);
  assert.match(r.saida, /Resultado: OK — 2 arquivo\(s\) alterado\(s\), nenhuma violação para modulo-core/);
});

test('sem alteração nenhuma: OK', () => {
  const dir = criarRepo();
  const r = rodar(dir, ['verificar', 'modulo-core']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.match(r.saida, /Resultado: OK — nenhum arquivo alterado/);
});

test('--base: arquivo de outro dono no branch é VIOLAÇÃO (código 1)', () => {
  const dir = criarRepo();
  git(dir, 'checkout', '-q', '-b', 'agente/T-0001-modulo-core');
  escrever(dir, 'modules/core/a.ts', 'mudou\n');
  escrever(dir, 'apps/api/x.ts', 'invadiu\n');
  commitar(dir, 'mudanças');
  const r = rodar(dir, ['verificar', 'modulo-core', '--base', 'main']);
  assert.equal(r.codigo, 1, r.tudo);
  assert.deepEqual(secao(r.saida, 'OK'), ['M modules/core/a.ts']);
  const v = secao(r.saida, 'VIOLAÇÃO');
  assert.equal(v.length, 1);
  assert.match(v[0], /^M apps\/api\/x\.ts → dono: engenheiro-software/);
  assert.match(r.saida, /Resultado: VIOLAÇÃO — 1 de 2 arquivo\(s\) alterado\(s\)/);
});

test('sem --base: outros donos aparecem como informativo e não mudam o código de saída', () => {
  const dir = criarRepo();
  escrever(dir, 'modules/core/a.ts', 'mudou\n');
  escrever(dir, 'apps/api/x.ts', 'outro agente na mesma árvore\n');
  escrever(dir, 'docs/nota.md');
  const r = rodar(dir, ['verificar', 'modulo-core']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.deepEqual(secao(r.saida, 'Outros donos (informativo'), [
    'M apps/api/x.ts → engenheiro-software',
    'A docs/nota.md → gerente-projetos',
  ]);
  assert.deepEqual(secao(r.saida, 'VIOLAÇÃO'), []);
});

test('sem-dono e congelado são sempre VIOLAÇÃO, mesmo sem --base', () => {
  const dir = criarRepo();
  escrever(dir, 'solto.txt');
  escrever(dir, 'legado/velho.txt', 'mexeu\n');
  const r = rodar(dir, ['verificar', 'modulo-core']);
  assert.equal(r.codigo, 1, r.tudo);
  const v = secao(r.saida, 'VIOLAÇÃO');
  assert.equal(v.length, 2);
  assert.ok(v.some((l) => l.startsWith('M legado/velho.txt → dono: congelado')), v.join('\n'));
  assert.ok(v.some((l) => l.startsWith('A solto.txt → dono: sem-dono')), v.join('\n'));
});

for (const comBase of [false, true]) {
  const modo = comBase ? 'com --base' : 'sem --base';

  test(`exceções universais (${modo}): diário, lidos e recado novo`, () => {
    const dir = criarRepo();
    git(dir, 'checkout', '-q', '-b', 'agente/T-0002-modulo-core');
    escrever(dir, '.coord/diario/modulo-core.md', '2026-10-31 — T-0002 — feito\n');
    escrever(dir, '.coord/lidos/modulo-core.txt', 'R-1\n');
    escrever(dir, '.coord/recados/engenheiro-software/R-20261031-010000-modulo-core.md', RECADO);
    escrever(dir, '.coord/recados/testes/R-20261031-010001-modulo-core.md', RECADO);
    if (comBase) commitar(dir, 'recados');
    const r = rodar(dir, comBase ? ['verificar', 'modulo-core', '--base', 'main'] : ['verificar', 'modulo-core']);
    assert.equal(r.codigo, 0, r.tudo);
    const ex = secao(r.saida, 'Exceções do protocolo');
    assert.equal(ex.length, 4, r.saida);
    assert.ok(ex.includes('A .coord/diario/modulo-core.md — diário do próprio agente'));
    assert.ok(ex.includes('A .coord/lidos/modulo-core.txt — lidos do próprio agente'));
    assert.ok(ex.includes('A .coord/recados/testes/R-20261031-010001-modulo-core.md — recado novo para testes'));
  });

  test(`recado existente alterado ou apagado é VIOLAÇÃO (${modo})`, () => {
    for (const acao of ['alterar', 'apagar']) {
      const dir = criarRepo();
      git(dir, 'checkout', '-q', '-b', 'agente/T-0003-modulo-core');
      const rel = '.coord/recados/testes/R-20261031-000000-modulo-core.md';
      if (acao === 'alterar') escrever(dir, rel, RECADO + 'editado\n');
      else unlinkSync(join(dir, rel));
      if (comBase) commitar(dir, acao);
      const r = rodar(dir, comBase ? ['verificar', 'modulo-core', '--base', 'main'] : ['verificar', 'modulo-core']);
      assert.equal(r.codigo, 1, r.tudo);
      const v = secao(r.saida, 'VIOLAÇÃO');
      assert.equal(v.length, 1, r.saida);
      assert.match(v[0], new RegExp(`^${acao === 'alterar' ? 'M' : 'D'} \\.coord/recados/testes/.*recados são imutáveis`));
    }
  });
}

test('--base: diário de outro agente é VIOLAÇÃO; sem --base é informativo', () => {
  const dir = criarRepo();
  git(dir, 'checkout', '-q', '-b', 'agente/T-0004-modulo-core');
  escrever(dir, '.coord/diario/testes.md');
  assert.equal(rodar(dir, ['verificar', 'modulo-core']).codigo, 0);
  commitar(dir, 'diário alheio');
  const r = rodar(dir, ['verificar', 'modulo-core', '--base', 'main']);
  assert.equal(r.codigo, 1, r.tudo);
  assert.match(secao(r.saida, 'VIOLAÇÃO')[0], /^A \.coord\/diario\/testes\.md → dono: testes/);
});

test('--base enxerga só o diff do branch (merge-base) somado ao não commitado', () => {
  const dir = criarRepo();
  git(dir, 'checkout', '-q', '-b', 'agente/T-0005-modulo-core');
  escrever(dir, 'modules/core/b.ts');
  commitar(dir, 'branch');
  // o main anda depois do ponto de divergência, com arquivo de outro dono
  git(dir, 'checkout', '-q', 'main');
  escrever(dir, 'apps/web/depois.ts');
  commitar(dir, 'main andou');
  git(dir, 'checkout', '-q', 'agente/T-0005-modulo-core');
  escrever(dir, 'modules/core/a.ts', 'não commitado\n');
  escrever(dir, 'modules/core/rascunho.ts'); // não rastreado
  const r = rodar(dir, ['verificar', 'modulo-core', '--base', 'main']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.deepEqual(secao(r.saida, 'OK'), ['M modules/core/a.ts', 'A modules/core/b.ts', 'A modules/core/rascunho.ts']);
  assert.doesNotMatch(r.saida, /apps\/web\/depois\.ts/);
  assert.match(r.saida, /Comparação: merge-base de HEAD com main \([0-9a-f]{7}\) \+ não commitados/);
});

test('--base num checkout limpo (clone, como no CI) com origin/main', () => {
  const origem = criarRepo();
  git(origem, 'checkout', '-q', '-b', 'agente/T-0006-modulo-core');
  escrever(origem, 'modules/core/c.ts');
  commitar(origem, 'branch do PR');
  git(origem, 'checkout', '-q', 'main');
  const clone = mkdtempSync(join(tmpdir(), 'coord-verificar-clone-'));
  temporarios.push(clone);
  git(tmpdir(), 'clone', '-q', '--branch', 'agente/T-0006-modulo-core', origem, clone);
  // CI: HEAD destacado, nome do branch só em GITHUB_HEAD_REF
  git(clone, 'checkout', '-q', '--detach');
  const r = rodar(clone, ['verificar', '--base', 'origin/main'], { GITHUB_HEAD_REF: 'agente/T-0006-modulo-core' });
  assert.equal(r.codigo, 0, r.tudo);
  assert.match(r.saida, /agente: modulo-core \(branch agente\/T-0006-modulo-core \(GITHUB_HEAD_REF\)\)/);
  assert.deepEqual(secao(r.saida, 'OK'), ['A modules/core/c.ts']);
});

test('--base com ref ausente (clone raso sem main) dá erro claro e código 2', () => {
  const origem = criarRepo();
  git(origem, 'checkout', '-q', '-b', 'agente/T-0006-modulo-core');
  escrever(origem, 'modules/core/c.ts');
  commitar(origem, 'branch do PR');
  const clone = mkdtempSync(join(tmpdir(), 'coord-verificar-raso-'));
  temporarios.push(clone);
  git(tmpdir(), 'clone', '-q', '--depth', '1', '--single-branch', '--branch', 'agente/T-0006-modulo-core', `file://${origem}`, clone);
  const r = rodar(clone, ['verificar', 'modulo-core', '--base', 'origin/main']);
  assert.equal(r.codigo, 2, r.tudo);
  assert.match(r.erro, /ref "origin\/main" não encontrada.*git fetch origin main/);
});

test('agente inferido do branch agente/T-nnnn-<agente> e alexandre/...', () => {
  const dir = criarRepo();
  git(dir, 'checkout', '-q', '-b', 'agente/T-0007-modulo-core');
  escrever(dir, 'modules/core/a.ts', 'mudou\n');
  let r = rodar(dir, ['verificar']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.match(r.saida, /agente: modulo-core \(branch agente\/T-0007-modulo-core\)/);

  git(dir, 'checkout', '-q', '-b', 'alexandre/T-0005-verificar');
  escrever(dir, 'scripts/coord-extra.mjs', '// novo\n');
  commitar(dir, 'alexandre');
  r = rodar(dir, ['verificar', '--base', 'main']);
  assert.equal(r.codigo, 0, r.tudo); // alexandre: outros donos são informativos mesmo com --base
  assert.match(r.saida, /agente: alexandre \(branch alexandre\/T-0005-verificar\)/);
  assert.deepEqual(secao(r.saida, 'OK'), ['A scripts/coord-extra.mjs']);
  assert.deepEqual(secao(r.saida, 'Outros donos (informativo'), ['M modules/core/a.ts → modulo-core']);
});

test('agente inferido do trailer "Agente:" do último commit', () => {
  const dir = criarRepo();
  git(dir, 'checkout', '-q', '-b', 'trabalho-sem-padrao');
  escrever(dir, 'modules/core/a.ts', 'mudou\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'T-0008: ajuste\n\nCorpo do commit.\n\nAgente: modulo-core');
  const r = rodar(dir, ['verificar', '--base', 'main']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.match(r.saida, /agente: modulo-core \(trailer Agente: do último commit\)/);
});

test('sem como inferir o agente: erro de uso com código 2', () => {
  const dir = criarRepo();
  const r = rodar(dir, ['verificar']);
  assert.equal(r.codigo, 2, r.tudo);
  assert.match(r.erro, /não deu para inferir o agente/);
  assert.match(r.erro, /uso: node scripts\/coord\.mjs verificar \[agente\] \[--base <ref>\]/);
});

test('erros de uso: agente desconhecido, --base sem ref, opção desconhecida e branch com agente inválido', () => {
  const dir = criarRepo();
  for (const args of [['verificar', 'fulano'], ['verificar', 'modulo-core', '--base'], ['verificar', 'modulo-core', '--bse', 'main']]) {
    const r = rodar(dir, args);
    assert.equal(r.codigo, 2, `${args.join(' ')}\n${r.tudo}`);
    assert.match(r.erro, /^Erro: /);
  }
  git(dir, 'checkout', '-q', '-b', 'agente/T-0009-fulano');
  const r = rodar(dir, ['verificar']);
  assert.equal(r.codigo, 2, r.tudo);
  assert.match(r.erro, /indica o agente "fulano"/);
});

test('--base=<ref> (com sinal de igual) também funciona', () => {
  const dir = criarRepo();
  git(dir, 'checkout', '-q', '-b', 'agente/T-0010-modulo-core');
  escrever(dir, 'modules/core/z.ts');
  commitar(dir, 'z');
  const r = rodar(dir, ['verificar', 'modulo-core', '--base=main']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.deepEqual(secao(r.saida, 'OK'), ['A modules/core/z.ts']);
});

test('caminho com barra invertida (Windows) é normalizado para /', { skip: process.platform === 'win32' && 'no Windows o git já entrega "/"' }, () => {
  // No Linux "modules\core\win.ts" é um nome de arquivo válido: simula a saída com "\" do Windows.
  const dir = criarRepo();
  writeFileSync(join(dir, 'modules\\core\\win.ts'), 'x\n');
  const r = rodar(dir, ['verificar', 'modulo-core']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.deepEqual(secao(r.saida, 'OK'), ['A modules/core/win.ts']);
});

test('classificarMudancas normaliza barra invertida também na função pura', () => {
  const regras = DONOS.regras.map((r) => ({ ...r, re: globParaRegex(r.padrao) }));
  const r = classificarMudancas({
    agente: 'modulo-core',
    estrito: true,
    regras,
    mudancas: [
      { status: 'M', caminho: 'modules\\core\\domain\\x.ts' },
      { status: 'M', caminho: '.\\.coord\\diario\\modulo-core.md' },
      { status: 'A', caminho: '.coord\\recados\\testes\\R-1-modulo-core.md' },
      { status: 'M', caminho: 'apps\\api\\x.ts' },
    ],
  });
  assert.deepEqual(r.ok.map((i) => i.caminho), ['modules/core/domain/x.ts']);
  assert.deepEqual(r.excecoes.map((i) => i.caminho), ['.coord/diario/modulo-core.md', '.coord/recados/testes/R-1-modulo-core.md']);
  assert.deepEqual(r.violacoes.map((i) => [i.caminho, i.dono]), [['apps/api/x.ts', 'engenheiro-software']]);
  assert.equal(normalizarCaminho('C:\\macuxifdv\\x'), 'C:/macuxifdv/x');
});

test('dono <caminho> aceita barra invertida', () => {
  const dir = criarRepo();
  const r = rodar(dir, ['dono', 'modules\\core\\domain\\x.ts']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.equal(r.saida.trim(), 'modules/core/domain/x.ts → modulo-core');
});

test('--por-dono agrupa por dono e acusa sem-dono', () => {
  const dir = criarRepo();
  escrever(dir, 'modules/core/a.ts', 'mudou\n');
  escrever(dir, 'apps/api/x.ts', 'mudou\n');
  let r = rodar(dir, ['verificar', '--por-dono']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.match(r.saida, /engenheiro-software \(1\):\n {2}M apps\/api\/x\.ts/);
  assert.match(r.saida, /modulo-core \(1\):\n {2}M modules\/core\/a\.ts/);
  escrever(dir, 'solto.txt');
  r = rodar(dir, ['verificar', '--por-dono']);
  assert.equal(r.codigo, 1, r.tudo);
});
