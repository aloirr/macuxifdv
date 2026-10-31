// Testes do `node scripts/coord.mjs verificar` (node:test, sem dependências).
// Rodar: node --test scripts/coord-verificar.test.mjs
// Cada teste cria um repositório git temporário com cópia de coord.mjs/coord-lib.mjs e um
// .coord/donos.json de exemplo, para que RAIZ (pasta do script) seja o repositório temporário.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, unlinkSync, appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { classificarMudancas, globParaRegex, normalizarCaminho, agenteDoBranch, agenteDosTrailers, remetenteDoRecado } from './coord-lib.mjs';

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
  assert.match(r.erro, /ref não encontrada: origin\/main\..*git fetch origin main/);
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

test('agente inferido do trailer "Agente:" dos commits do PR', () => {
  const dir = criarRepo();
  git(dir, 'checkout', '-q', '-b', 'trabalho-sem-padrao');
  escrever(dir, 'modules/core/a.ts', 'mudou\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'T-0008: ajuste\n\nCorpo do commit.\n\nAgente: modulo-core');
  const r = rodar(dir, ['verificar', '--base', 'main']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.match(r.saida, /agente: modulo-core \(trailer "Agente:" de 1 commit\(s\) do PR\)/);
});

test('sem como inferir o agente (--base, sem padrão de branch nem trailer): erro de uso com código 2', () => {
  // Decisão de 31/10: sem --base e sem agente vira a lista por dono (caso A9); o erro fica para o --base (B10).
  const dir = criarRepo();
  git(dir, 'checkout', '-q', '-b', 'trabalho-sem-padrao');
  escrever(dir, 'modules/core/a.ts', 'mudou\n');
  commitar(dir, 'sem trailer');
  const r = rodar(dir, ['verificar', '--base', 'main']);
  assert.equal(r.codigo, 2, r.tudo);
  assert.match(r.erro, /informe o agente ou use branch <agente>\/T-nnnn/);
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

// ---------------------------------------------------------------------------------------------
// Casos A1–A11 e B1–B12 do engenheiro-software (R-20261031-071802-engenheiro-software), com o
// .coord/donos.json real do repositório e as decisões do Alexandre de 31/10:
// códigos 0/1/2; branch <agente>/T-nnnn[-assunto], agente/T-nnnn-<agente>, alexandre/*, nuvem/*
// (trailer obrigatório em todos os commits); B9 = erro "agente ambíguo" (código 2).
// ---------------------------------------------------------------------------------------------
const DONOS_REAIS = readFileSync(join(AQUI, '..', '.coord', 'donos.json'), 'utf8');
const RECADO_ENG = '.coord/recados/gerente-projetos/R-20261031-004609-engenheiro-software.md';

/** Repositório com o donos.json real e um arquivo de cada dono que os casos usam. */
function criarRepoReal() {
  const dir = mkdtempSync(join(tmpdir(), 'coord-casos-'));
  temporarios.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Teste');
  git(dir, 'config', 'user.email', 'teste@exemplo.invalid');
  git(dir, 'config', 'commit.gpgsign', 'false');
  mkdirSync(join(dir, 'scripts'));
  copyFileSync(join(AQUI, 'coord.mjs'), join(dir, 'scripts', 'coord.mjs'));
  copyFileSync(join(AQUI, 'coord-lib.mjs'), join(dir, 'scripts', 'coord-lib.mjs'));
  escrever(dir, '.coord/donos.json', DONOS_REAIS);
  escrever(dir, RECADO_ENG, RECADO.replaceAll('modulo-core', 'engenheiro-software'));
  for (const f of [
    'CLAUDE.md', 'modules/core/app/lib/cargas.ts', 'packages/ui/src/web/ui.tsx', 'modules/vendedor/x.ts',
    '.coord/diario/engenheiro-software.md', '.coord/diario/modulo-core.md', '.coord/lidos/modulo-core.txt',
    '.coord/diario/modulo-vendedor.md',
  ]) escrever(dir, f);
  commitar(dir, 'inicial');
  return dir;
}
const mudar = (dir, rel) => appendFileSync(join(dir, rel), '// alterado\n');
const commitarCom = (dir, msg, agente) => commitar(dir, agente ? `${msg}\n\nAgente: ${agente}` : msg);

// ------------------------------------------------------------------ A. sem --base
test('A1: só arquivo do próprio agente → OK, código 0', () => {
  const dir = criarRepoReal();
  escrever(dir, 'packages/ui/src/mobile/puro.ts');
  const r = rodar(dir, ['verificar', 'engenheiro-software']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.deepEqual(secao(r.saida, 'OK'), ['A packages/ui/src/mobile/puro.ts']);
  assert.match(r.saida, /Resultado: OK — 1 arquivo\(s\) alterado\(s\), nenhuma violação para engenheiro-software/);
});

test('A2: arquivo de outro agente na mesma árvore → "Outros donos", código 0', () => {
  const dir = criarRepoReal();
  escrever(dir, 'packages/platform-sdk/src/ambiente.ts');
  mudar(dir, 'modules/core/app/lib/cargas.ts');
  const r = rodar(dir, ['verificar', 'engenheiro-software']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.deepEqual(secao(r.saida, 'OK'), ['A packages/platform-sdk/src/ambiente.ts']);
  assert.deepEqual(secao(r.saida, 'Outros donos'), ['M modules/core/app/lib/cargas.ts → modulo-core']);
  assert.deepEqual(secao(r.saida, 'VIOLAÇÃO'), []);
});

test('A3: recado novo (não rastreado), diário e lidos do próprio agente → exceções, código 0', () => {
  const dir = criarRepoReal();
  escrever(dir, '.coord/recados/modulo-core/R-20261031-070000-engenheiro-software.md', RECADO);
  mudar(dir, '.coord/diario/engenheiro-software.md');
  escrever(dir, '.coord/lidos/engenheiro-software.txt', 'R-1\n');
  git(dir, 'add', '.coord/lidos/engenheiro-software.txt'); // status A no índice
  const r = rodar(dir, ['verificar', 'engenheiro-software']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.deepEqual(secao(r.saida, 'Exceções do protocolo').sort(), [
    'A .coord/lidos/engenheiro-software.txt — lidos do próprio agente',
    'A .coord/recados/modulo-core/R-20261031-070000-engenheiro-software.md — recado novo para modulo-core',
    'M .coord/diario/engenheiro-software.md — diário do próprio agente',
  ]);
});

test('A4: diário e lidos de outro agente → "Outros donos" com o próprio agente como dono', () => {
  const dir = criarRepoReal();
  mudar(dir, '.coord/diario/modulo-core.md');
  mudar(dir, '.coord/lidos/modulo-core.txt');
  const r = rodar(dir, ['verificar', 'engenheiro-software']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.deepEqual(secao(r.saida, 'Outros donos'), [
    'M .coord/diario/modulo-core.md → modulo-core',
    'M .coord/lidos/modulo-core.txt → modulo-core',
  ]);
  assert.doesNotMatch(r.saida, /gerente-projetos/);
});

test('A5: recado novo com o nome de outro remetente → "Outros donos" (é do remetente)', () => {
  const dir = criarRepoReal();
  escrever(dir, '.coord/recados/todos/R-20261031-070001-modulo-core.md', RECADO);
  const r = rodar(dir, ['verificar', 'engenheiro-software']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.deepEqual(secao(r.saida, 'Outros donos'), ['A .coord/recados/todos/R-20261031-070001-modulo-core.md → modulo-core']);
  assert.deepEqual(secao(r.saida, 'Exceções do protocolo'), []);
});

test('A6: recado rastreado do próprio agente alterado ou apagado → VIOLAÇÃO "recados são imutáveis"', () => {
  for (const [acao, st] of [['alterar', 'M'], ['apagar', 'D']]) {
    const dir = criarRepoReal();
    if (acao === 'alterar') mudar(dir, RECADO_ENG);
    else unlinkSync(join(dir, RECADO_ENG));
    const r = rodar(dir, ['verificar', 'engenheiro-software']);
    assert.equal(r.codigo, 1, r.tudo);
    const v = secao(r.saida, 'VIOLAÇÃO');
    assert.equal(v.length, 1, r.saida);
    assert.ok(v[0].startsWith(`${st} ${RECADO_ENG} → dono: ninguém — recados são imutáveis`), v[0]);
  }
});

test('A7: recado novo em destino inválido → VIOLAÇÃO "destino de recado inválido"', () => {
  const dir = criarRepoReal();
  escrever(dir, '.coord/recados/fulano/R-20261031-070002-engenheiro-software.md', RECADO);
  const r = rodar(dir, ['verificar', 'engenheiro-software']);
  assert.equal(r.codigo, 1, r.tudo);
  assert.match(secao(r.saida, 'VIOLAÇÃO')[0], /^A \.coord\/recados\/fulano\/.* — destino de recado inválido: fulano$/);
});

test('A8: arquivos do alexandre sem --base → "Outros donos" (com --base é VIOLAÇÃO, ver B4)', () => {
  const dir = criarRepoReal();
  writeFileSync(join(dir, '.coord/donos.json'), JSON.stringify(JSON.parse(DONOS_REAIS))); // mesmo conteúdo, outro formato
  mudar(dir, 'scripts/coord.mjs');
  const r = rodar(dir, ['verificar', 'engenheiro-software']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.deepEqual(secao(r.saida, 'Outros donos'), ['M .coord/donos.json → alexandre', 'M scripts/coord.mjs → alexandre']);
});

test('A9: sem agente e sem --base (branch sem padrão) → lista por dono, recados/diários pelo remetente/agente', () => {
  const dir = criarRepoReal();
  escrever(dir, 'packages/ui/src/novo.ts');
  mudar(dir, 'modules/core/app/lib/cargas.ts');
  escrever(dir, '.coord/recados/testes/R-20261031-070003-modulo-core.md', RECADO);
  mudar(dir, '.coord/diario/modulo-vendedor.md');
  // o trailer do último commit não vale sem --base: a árvore é compartilhada
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'x\n\nAgente: testes');
  const r = rodar(dir, ['verificar']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.match(r.saida, /^Alterações por dono — árvore de trabalho × HEAD/);
  assert.match(r.saida, /engenheiro-software \(1\):\n {2}A packages\/ui\/src\/novo\.ts/);
  assert.match(r.saida, /modulo-core \(2\):\n {2}M modules\/core\/app\/lib\/cargas\.ts\n {2}A \.coord\/recados\/testes\/R-20261031-070003-modulo-core\.md/);
  assert.match(r.saida, /modulo-vendedor \(1\):\n {2}M \.coord\/diario\/modulo-vendedor\.md/);
  assert.doesNotMatch(r.saida, /gerente-projetos|testes \(/);
  assert.match(r.saida, /Resultado: OK — 4 arquivo\(s\) alterado\(s\)/);
  // recado alterado continua violação na lista
  mudar(dir, RECADO_ENG);
  assert.equal(rodar(dir, ['verificar']).codigo, 1);
});

test('A10: parênteses, espaços e acentos casam como texto literal (core.quotePath=false)', () => {
  const dir = criarRepoReal();
  git(dir, 'config', 'core.quotePath', 'true'); // o script precisa sobrepor
  const rastreado = 'apps/mobile/src/app/(tabs)/index.tsx';
  escrever(dir, rastreado);
  escrever(dir, 'docs/decisões/antigo ç.md');
  commitar(dir, 'acentos');
  git(dir, 'checkout', '-q', '-b', 'engenheiro-software/T-0005-acentos');
  mudar(dir, rastreado);
  mudar(dir, 'docs/decisões/antigo ç.md');
  escrever(dir, 'apps/web/src/app/(painel)/página inicial.tsx');
  escrever(dir, 'docs/decisões/x.md');
  let r = rodar(dir, ['verificar', 'engenheiro-software']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.deepEqual(secao(r.saida, 'OK'), ['M apps/mobile/src/app/(tabs)/index.tsx', 'A apps/web/src/app/(painel)/página inicial.tsx']);
  // "docs/decisões" (com acento) não é "docs/decisoes/**": cai em docs/** → gerente-projetos
  assert.deepEqual(secao(r.saida, 'Outros donos'), ['M docs/decisões/antigo ç.md → gerente-projetos', 'A docs/decisões/x.md → gerente-projetos']);
  assert.doesNotMatch(r.tudo, /\\3|"/);
  commitar(dir, 'tudo');
  r = rodar(dir, ['verificar', '--base', 'main']);
  assert.equal(r.codigo, 1, r.tudo);
  assert.deepEqual(secao(r.saida, 'OK'), ['M apps/mobile/src/app/(tabs)/index.tsx', 'A apps/web/src/app/(painel)/página inicial.tsx']);
  assert.equal(secao(r.saida, 'VIOLAÇÃO').length, 2);
  assert.ok(secao(r.saida, 'VIOLAÇÃO')[0].startsWith('M docs/decisões/antigo ç.md → dono: gerente-projetos'));
});

test('A11: agente inexistente → erro "agente desconhecido", código 2', () => {
  const dir = criarRepoReal();
  const r = rodar(dir, ['verificar', 'fulano']);
  assert.equal(r.codigo, 2, r.tudo);
  assert.match(r.erro, /^Erro: agente desconhecido: fulano/);
});

// ------------------------------------------------------------------ B. com --base
/** Branch modulo-core/T-0003 com o diff do caso B1 já commitado. */
function repoB1() {
  const dir = criarRepoReal();
  git(dir, 'checkout', '-q', '-b', 'modulo-core/T-0003');
  escrever(dir, 'modules/core/domain/carteira.ts');
  mudar(dir, '.coord/diario/modulo-core.md');
  escrever(dir, '.coord/recados/gerente-projetos/R-20261031-080000-modulo-core.md', RECADO);
  commitar(dir, 'T-0003: carteira');
  return dir;
}

test('B1: branch <agente>/T-nnnn sem sufixo → agente inferido; arquivo, diário e recado novo → OK', () => {
  const dir = repoB1();
  const r = rodar(dir, ['verificar', '--base', 'main']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.match(r.saida, /agente: modulo-core \(branch modulo-core\/T-0003\)/);
  assert.deepEqual(secao(r.saida, 'OK'), ['A modules/core/domain/carteira.ts']);
  assert.equal(secao(r.saida, 'Exceções do protocolo').length, 2);
});

test('B1b: branch <agente>/T-nnnn-<assunto> também infere o agente', () => {
  const dir = criarRepoReal();
  git(dir, 'checkout', '-q', '-b', 'modulo-core/T-0003-licencas');
  escrever(dir, 'modules/core/domain/licenca.ts');
  commitar(dir, 'licenças');
  const r = rodar(dir, ['verificar', '--base', 'main']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.match(r.saida, /agente: modulo-core \(branch modulo-core\/T-0003-licencas\)/);
});

test('B2: com --base não existe "outros donos": arquivo de outro dono → VIOLAÇÃO', () => {
  const dir = repoB1();
  mudar(dir, 'packages/ui/src/web/ui.tsx');
  commitar(dir, 'invadiu');
  const r = rodar(dir, ['verificar', '--base', 'main']);
  assert.equal(r.codigo, 1, r.tudo);
  assert.deepEqual(secao(r.saida, 'Outros donos'), []);
  const v = secao(r.saida, 'VIOLAÇÃO');
  assert.equal(v.length, 1);
  assert.ok(v[0].startsWith('M packages/ui/src/web/ui.tsx → dono: engenheiro-software'), v[0]);
});

test('B3: o main andou depois do branch (CLAUDE.md) → não aparece (merge-base)', () => {
  const dir = repoB1();
  git(dir, 'checkout', '-q', 'main');
  mudar(dir, 'CLAUDE.md');
  commitar(dir, 'main andou');
  git(dir, 'checkout', '-q', 'modulo-core/T-0003');
  const r = rodar(dir, ['verificar', '--base', 'main']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.doesNotMatch(r.saida, /CLAUDE\.md/);
});

test('B4: donos.json, diário de outro agente e recado com outro remetente → VIOLAÇÃO com o motivo', () => {
  const dir = repoB1();
  writeFileSync(join(dir, '.coord/donos.json'), JSON.stringify(JSON.parse(DONOS_REAIS)));
  mudar(dir, '.coord/diario/modulo-vendedor.md');
  escrever(dir, '.coord/recados/testes/R-20261031-080001-modulo-vendedor.md', RECADO);
  commitar(dir, 'invasões');
  const r = rodar(dir, ['verificar', '--base', 'main']);
  assert.equal(r.codigo, 1, r.tudo);
  const v = secao(r.saida, 'VIOLAÇÃO');
  assert.equal(v.length, 3, r.saida);
  assert.ok(v.some((l) => l.startsWith('M .coord/donos.json → dono: alexandre')), v.join('\n'));
  assert.ok(v.some((l) => l.startsWith('M .coord/diario/modulo-vendedor.md → dono: modulo-vendedor — o diário/lidos de modulo-vendedor pertence a modulo-vendedor')), v.join('\n'));
  assert.ok(v.some((l) => /^A \.coord\/recados\/testes\/R-20261031-080001-modulo-vendedor\.md → dono: modulo-vendedor — o nome do recado precisa conter o remetente/.test(l)), v.join('\n'));
});

test('B5: recado do próprio agente alterado (M) ou apagado (D) desde o merge-base → VIOLAÇÃO', () => {
  for (const st of ['M', 'D']) {
    const dir = criarRepoReal();
    git(dir, 'checkout', '-q', '-b', 'engenheiro-software/T-0005');
    if (st === 'M') mudar(dir, RECADO_ENG);
    else unlinkSync(join(dir, RECADO_ENG));
    commitar(dir, 'mexeu no recado');
    const r = rodar(dir, ['verificar', '--base', 'main']);
    assert.equal(r.codigo, 1, r.tudo);
    assert.ok(secao(r.saida, 'VIOLAÇÃO')[0].startsWith(`${st} ${RECADO_ENG} → dono: ninguém — recados são imutáveis`));
  }
});

test('B6: apagar arquivo de outro dono é VIOLAÇÃO; renomear confere os dois caminhos', () => {
  const dir = criarRepoReal();
  git(dir, 'checkout', '-q', '-b', 'modulo-core/T-0006');
  git(dir, 'mv', 'packages/ui/src/web/ui.tsx', 'modules/core/app/ui.tsx');
  git(dir, 'rm', '-q', 'modules/vendedor/x.ts');
  commitar(dir, 'renomeou e apagou');
  const r = rodar(dir, ['verificar', '--base', 'main']);
  assert.equal(r.codigo, 1, r.tudo);
  assert.deepEqual(secao(r.saida, 'OK'), ['A modules/core/app/ui.tsx']);
  const v = secao(r.saida, 'VIOLAÇÃO');
  assert.equal(v.length, 2, r.saida);
  assert.ok(v.some((l) => l.startsWith('D modules/vendedor/x.ts → dono: modulo-vendedor')));
  assert.ok(v.some((l) => l.startsWith('D packages/ui/src/web/ui.tsx → dono: engenheiro-software')));
});

test('B7: agente explícito vence a inferência do branch', () => {
  const dir = repoB1();
  const r = rodar(dir, ['verificar', 'modulo-vendedor', '--base', 'main']);
  assert.equal(r.codigo, 1, r.tudo);
  assert.match(r.saida, /agente: modulo-vendedor \(informado\)/);
  assert.ok(secao(r.saida, 'VIOLAÇÃO').some((l) => l.startsWith('A modules/core/domain/carteira.ts → dono: modulo-core')));
});

test('B8: branch sem padrão (main ou HEAD destacado) e todos os commits com o mesmo trailer → agente do trailer', () => {
  const dir = criarRepoReal();
  git(dir, 'branch', 'inicio');
  mudar(dir, 'modules/vendedor/x.ts');
  commitarCom(dir, 'T-0011: um', 'modulo-vendedor');
  escrever(dir, 'modules/vendedor/y.ts');
  commitarCom(dir, 'T-0011: dois', 'modulo-vendedor');
  for (const destacar of [false, true]) {
    if (destacar) git(dir, 'checkout', '-q', '--detach');
    const r = rodar(dir, ['verificar', '--base', 'inicio']);
    assert.equal(r.codigo, 0, r.tudo);
    assert.match(r.saida, /agente: modulo-vendedor \(trailer "Agente:" de 2 commit\(s\) do PR\)/);
    assert.deepEqual(secao(r.saida, 'OK'), ['M modules/vendedor/x.ts', 'A modules/vendedor/y.ts']);
  }
});

test('B9: trailers diferentes no mesmo PR → erro "agente ambíguo", código 2', () => {
  const dir = criarRepoReal();
  git(dir, 'checkout', '-q', '-b', 'trabalho-conjunto');
  mudar(dir, 'modules/vendedor/x.ts');
  commitarCom(dir, 'vendedor', 'modulo-vendedor');
  mudar(dir, 'modules/core/app/lib/cargas.ts');
  commitarCom(dir, 'core', 'modulo-core');
  const r = rodar(dir, ['verificar', '--base', 'main']);
  assert.equal(r.codigo, 2, r.tudo);
  assert.match(r.erro, /^Erro: agente ambíguo: modulo-core, modulo-vendedor/);
});

test('B10: sem agente, sem padrão de branch e sem trailer → erro de uso, código 2; trailer faltando em um commit também', () => {
  const dir = criarRepoReal();
  git(dir, 'checkout', '-q', '-b', 'trabalho-sem-padrao');
  mudar(dir, 'modules/vendedor/x.ts');
  commitar(dir, 'sem trailer');
  let r = rodar(dir, ['verificar', '--base', 'main']);
  assert.equal(r.codigo, 2, r.tudo);
  assert.match(r.erro, /informe o agente ou use branch <agente>\/T-nnnn/);
  escrever(dir, 'modules/vendedor/y.ts');
  commitarCom(dir, 'com trailer', 'modulo-vendedor');
  r = rodar(dir, ['verificar', '--base', 'main']);
  assert.equal(r.codigo, 2, r.tudo);
  assert.match(r.erro, /commit\(s\) sem o trailer "Agente: modulo-vendedor": [0-9a-f]{7} \(sem trailer\)/);
});

test('B10 (nuvem/*): trailer obrigatório em todos os commits do PR; com ele, o agente vem do trailer', () => {
  const dir = criarRepoReal();
  git(dir, 'checkout', '-q', '-b', 'nuvem/T-0005-verificar-casos');
  mudar(dir, 'scripts/coord.mjs');
  commitar(dir, 'T-0005: sem trailer');
  let r = rodar(dir, ['verificar', '--base', 'main']);
  assert.equal(r.codigo, 2, r.tudo);
  assert.match(r.erro, /o branch nuvem\/T-0005-verificar-casos exige o trailer "Agente: <nome>" em todos os commits do PR/);
  git(dir, 'commit', '-q', '--amend', '-m', 'T-0005: com trailer\n\nAgente: alexandre\nCo-Authored-By: Alguém <a@exemplo.invalid>');
  r = rodar(dir, ['verificar', '--base', 'main']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.match(r.saida, /agente: alexandre \(trailer "Agente:" de 1 commit\(s\) do PR\)/);
});

test('B10 (CI): HEAD destacado num merge sintético do PR nuvem/* com GITHUB_HEAD_REF → trailers dos commits do PR', () => {
  const dir = criarRepoReal();
  git(dir, 'checkout', '-q', '-b', 'nuvem/T-0011-vendedor');
  mudar(dir, 'modules/vendedor/x.ts');
  commitarCom(dir, 'T-0011: pedido', 'modulo-vendedor');
  git(dir, 'checkout', '-q', 'main');
  mudar(dir, 'CLAUDE.md');
  commitar(dir, 'main andou');
  git(dir, 'checkout', '-q', '--detach');
  git(dir, 'merge', '-q', '--no-ff', '-m', 'Merge sintético do PR', 'nuvem/T-0011-vendedor');
  const r = rodar(dir, ['verificar', '--base', 'main'], { GITHUB_HEAD_REF: 'nuvem/T-0011-vendedor' });
  assert.equal(r.codigo, 0, r.tudo);
  assert.match(r.saida, /agente: modulo-vendedor \(trailer "Agente:" de 1 commit\(s\) do PR\)/);
  assert.deepEqual(secao(r.saida, 'OK'), ['M modules/vendedor/x.ts']);
});

test('B11: ref inexistente → erro "ref não encontrada", código 2; diff vazio → OK', () => {
  const dir = criarRepoReal();
  git(dir, 'checkout', '-q', '-b', 'modulo-core/T-0003');
  let r = rodar(dir, ['verificar', '--base', 'xyz']);
  assert.equal(r.codigo, 2, r.tudo);
  assert.match(r.erro, /^Erro: ref não encontrada: xyz/);
  r = rodar(dir, ['verificar', '--base', 'main']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.match(r.saida, /Resultado: OK — nenhum arquivo alterado, nenhuma violação para modulo-core/);
  // sem agente e sem padrão de branch (ex.: push no main): diff vazio também é OK
  git(dir, 'checkout', '-q', 'main');
  r = rodar(dir, ['verificar', '--base', 'main']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.match(r.saida, /Resultado: OK — nenhum arquivo alterado/);
});

test('B12: branch alexandre/* → agente alexandre; scripts/coord.mjs e donos.json são dele', () => {
  const dir = criarRepoReal();
  git(dir, 'checkout', '-q', '-b', 'alexandre/T-0005-verificar');
  mudar(dir, 'scripts/coord.mjs');
  writeFileSync(join(dir, '.coord/donos.json'), JSON.stringify(JSON.parse(DONOS_REAIS)));
  mudar(dir, 'modules/vendedor/x.ts');
  commitar(dir, 'alexandre mexe em tudo');
  const r = rodar(dir, ['verificar', '--base', 'main']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.match(r.saida, /agente: alexandre \(branch alexandre\/T-0005-verificar\)/);
  assert.deepEqual(secao(r.saida, 'OK'), ['M .coord/donos.json', 'M scripts/coord.mjs']);
  assert.deepEqual(secao(r.saida, 'Outros donos'), ['M modules/vendedor/x.ts → modulo-vendedor']);
});

test('funções puras: agenteDoBranch, agenteDosTrailers e remetenteDoRecado', () => {
  assert.deepEqual(agenteDoBranch('modulo-core/T-0003'), { agente: 'modulo-core' });
  assert.deepEqual(agenteDoBranch('modulo-core/T-0003-licencas'), { agente: 'modulo-core' });
  assert.deepEqual(agenteDoBranch('agente/T-0003-modulo-core'), { agente: 'modulo-core' });
  assert.deepEqual(agenteDoBranch('alexandre/qualquer'), { agente: 'alexandre' });
  assert.deepEqual(agenteDoBranch('refs/heads/testes/T-1'), { agente: 'testes' });
  assert.deepEqual(agenteDoBranch('nuvem/T-0005-x'), { agente: null, nuvem: true });
  assert.deepEqual(agenteDoBranch('fulano/T-0003'), { agente: null });
  assert.deepEqual(agenteDoBranch('modulo-core/sem-tarefa'), { agente: null });
  assert.deepEqual(agenteDoBranch('main'), { agente: null });
  assert.match(agenteDoBranch('agente/T-0003-licencas').erro, /indica o agente "licencas"/);
  const c = (sha, corpo) => ({ sha, assunto: 'x', corpo });
  assert.deepEqual(agenteDosTrailers([c('a1', 'x\n\nAgente: testes'), c('b2', 'y\n\nAgente: testes\nCo-Authored-By: z')]), { agente: 'testes' });
  assert.equal(agenteDosTrailers([]).erro, 'sem-trailer');
  assert.equal(agenteDosTrailers([c('a1', 'x')]).erro, 'sem-trailer');
  assert.equal(agenteDosTrailers([c('a1', 'x\n\nAgente: testes'), c('b2', 'y')]).erro, 'parcial');
  assert.equal(agenteDosTrailers([c('a1', 'Agente: testes'), c('b2', 'Agente: modulo-core')]).mensagem, 'agente ambíguo: modulo-core, testes');
  assert.equal(agenteDosTrailers([c('a1', 'Agente: fulano')]).erro, 'invalido');
  assert.equal(remetenteDoRecado('R-20261031-071802-engenheiro-software.md'), 'engenheiro-software');
  assert.equal(remetenteDoRecado('R-20261031-071802-2-alexandre.md'), 'alexandre');
  assert.equal(remetenteDoRecado('R-20261031-071802.md'), null);
});
