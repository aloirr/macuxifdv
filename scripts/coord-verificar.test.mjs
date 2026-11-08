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
import {
  classificarMudancas, globParaRegex, normalizarCaminho, agenteDoBranch, agenteDosTrailers, remetenteDoRecado,
  workspaceMudouSoEmBuilds, lockAcompanhaDependencia, pacoteDoPackageJson, mudancasDeGovernanca, carregarDonos,
  donoDaMudanca, podeAlterar, ehAnexoDeRecado,
} from './coord-lib.mjs';

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
    { padrao: 'pnpm-lock.yaml', dono: 'engenheiro-software' },
    { padrao: 'pnpm-workspace.yaml', dono: 'engenheiro-software' },
    { padrao: 'package.json', dono: 'engenheiro-software' },
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
  const r = rodar(dir, ['verificar', 'designer-ux']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.deepEqual(secao(r.saida, 'OK'), ['A packages/ui/src/mobile/puro.ts']);
  assert.match(r.saida, /Resultado: OK — 1 arquivo\(s\) alterado\(s\), nenhuma violação para designer-ux/);
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
  assert.match(r.saida, /designer-ux \(1\):\n {2}A packages\/ui\/src\/novo\.ts/);
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
  git(dir, 'checkout', '-q', '-b', 'engenheiro-apps/T-0005-acentos');
  mudar(dir, rastreado);
  mudar(dir, 'docs/decisões/antigo ç.md');
  escrever(dir, 'apps/web/src/app/(painel)/página inicial.tsx');
  escrever(dir, 'docs/decisões/x.md');
  let r = rodar(dir, ['verificar', 'engenheiro-apps']);
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
  assert.ok(v[0].startsWith('M packages/ui/src/web/ui.tsx → dono: designer-ux'), v[0]);
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
  assert.ok(v.some((l) => l.startsWith('D packages/ui/src/web/ui.tsx → dono: designer-ux')));
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

// ───────────── verificar --por-commit (guardião v3, T-0005): cada commit × o agente do próprio trailer ─────────────

/** Commit com a mensagem "<assunto>\n\nAgente: <agente>" (sem trailer se agente for null). */
function commitarComo(dir, agente, assunto) {
  commitar(dir, agente ? `${assunto}\n\nAgente: ${agente}` : assunto);
  return git(dir, 'rev-parse', '--short', 'HEAD').trim();
}
/** Bloco da saída de um commit ("== <sha> ..." até o próximo "== " ou o resultado). */
function blocoDoCommit(saida, sha) {
  const i = saida.indexOf(`== ${sha}`);
  assert.ok(i >= 0, `commit ${sha} não aparece na saída:\n${saida}`);
  const resto = saida.slice(i);
  const fim = resto.slice(3).search(/\n== |\nVIOLAÇÃO em |\nResultado:/);
  return fim < 0 ? resto : resto.slice(0, fim + 3);
}

test('--por-commit: 3 commits de agentes diferentes, um invadindo caminho alheio → código 1 só nele', () => {
  const dir = criarRepo();
  const inicio = git(dir, 'rev-parse', 'HEAD').trim();
  escrever(dir, 'modules/core/a.ts', 'core\n');
  escrever(dir, '.coord/diario/modulo-core.md');
  const c1 = commitarComo(dir, 'modulo-core', 'T-0003: core');
  escrever(dir, 'apps/api/x.ts', 'engenheiro\n');
  escrever(dir, 'modules/core/a.ts', 'engenheiro invadiu\n');
  const c2 = commitarComo(dir, 'engenheiro-software', 'T-0004: api');
  escrever(dir, 'docs/status.md');
  escrever(dir, 'scripts/coord-lib.mjs', readFileSync(join(dir, 'scripts', 'coord-lib.mjs'), 'utf8') + '\n');
  const c3 = commitarComo(dir, 'alexandre', 'T-0005: alexandre mexe em tudo');
  const r = rodar(dir, ['verificar', '--por-commit', `${inicio}..HEAD`]);
  assert.equal(r.codigo, 1, r.tudo);
  assert.match(r.saida, /Verificação de donos por commit — [0-9a-f]+\.\.HEAD \(3 commit\(s\)\)/);
  const b1 = blocoDoCommit(r.saida, c1);
  assert.match(b1, /agente: modulo-core \(trailer\)/);
  assert.doesNotMatch(b1, /VIOLAÇÃO/);
  assert.match(b1, /\.coord\/diario\/modulo-core\.md — diário do próprio agente/);
  const b2 = blocoDoCommit(r.saida, c2);
  assert.match(b2, /agente: engenheiro-software/);
  assert.match(b2, /M modules\/core\/a\.ts → dono: modulo-core/);
  assert.doesNotMatch(b2, /apps\/api\/x\.ts → dono/);
  const b3 = blocoDoCommit(r.saida, c3);
  assert.match(b3, /agente: alexandre/);
  assert.doesNotMatch(b3, /VIOLAÇÃO/, 'alexandre nunca viola por dono');
  assert.match(b3, /A docs\/status\.md → gerente-projetos/);
  assert.match(r.saida, new RegExp(`VIOLAÇÃO em 1 commit\\(s\\):\\n  ${c2} \\(engenheiro-software\\)`));
  assert.match(r.saida, /Resultado: VIOLAÇÃO — 1 de 3 commit\(s\) conferido\(s\)/);
});

test('--por-commit: sem invasão → 0; commit de merge é ignorado', () => {
  const dir = criarRepo();
  const inicio = git(dir, 'rev-parse', 'HEAD').trim();
  git(dir, 'checkout', '-q', '-b', 'modulo-core/T-0003');
  escrever(dir, 'modules/core/b.ts');
  const c1 = commitarComo(dir, 'modulo-core', 'T-0003: core');
  git(dir, 'checkout', '-q', 'main');
  escrever(dir, 'apps/api/y.ts');
  const c2 = commitarComo(dir, 'engenheiro-software', 'T-0004: api');
  git(dir, 'merge', '-q', '--no-ff', '--no-edit', '-m', 'Merge sem trailer', 'modulo-core/T-0003');
  const merge = git(dir, 'rev-parse', '--short', 'HEAD').trim();
  const r = rodar(dir, ['verificar', '--por-commit', `${inicio}..main`]);
  assert.equal(r.codigo, 0, r.tudo);
  assert.match(blocoDoCommit(r.saida, merge), /commit de merge — ignorado/);
  assert.match(blocoDoCommit(r.saida, c1), /agente: modulo-core/);
  assert.match(blocoDoCommit(r.saida, c2), /agente: engenheiro-software/);
  assert.match(r.saida, /Resultado: OK — 2 commit\(s\) conferido\(s\), nenhuma violação/);
});

test('--por-commit: commit sem trailer (ou agente desconhecido/ambíguo) → código 2 com a lista', () => {
  const dir = criarRepo();
  const inicio = git(dir, 'rev-parse', 'HEAD').trim();
  escrever(dir, 'modules/core/a.ts', '1\n');
  const ok = commitarComo(dir, 'modulo-core', 'T-0003: com trailer');
  escrever(dir, 'modules/core/a.ts', '2\n');
  const sem = commitarComo(dir, null, 'T-0003: esqueceu o trailer');
  escrever(dir, 'modules/core/a.ts', '3\n');
  const fulano = commitarComo(dir, 'fulano', 'T-0003: agente de fora');
  escrever(dir, 'modules/core/a.ts', '4\n');
  commitar(dir, 'T-0003: dois agentes\n\nAgente: modulo-core\nAgente: testes');
  const dois = git(dir, 'rev-parse', '--short', 'HEAD').trim();
  const r = rodar(dir, ['verificar', '--por-commit', `${inicio}..HEAD`]);
  assert.equal(r.codigo, 2, r.tudo);
  assert.match(r.erro, /3 commit\(s\) sem agente identificável/);
  assert.match(r.erro, new RegExp(`${sem} T-0003: esqueceu o trailer — sem o trailer "Agente: <nome>"`));
  assert.match(r.erro, new RegExp(`${fulano} T-0003: agente de fora — trailer "Agente: fulano" não é um agente do time`));
  assert.match(r.erro, new RegExp(`${dois} T-0003: dois agentes — agente ambíguo: modulo-core, testes`));
  assert.doesNotMatch(r.erro, new RegExp(ok));
  assert.match(blocoDoCommit(r.saida, ok), /agente: modulo-core/);
});

test('--por-commit: intervalo vazio → 0; intervalo inválido, ref inexistente ou combinação de modos → 2', () => {
  const dir = criarRepo();
  const vazio = rodar(dir, ['verificar', '--por-commit', 'HEAD..HEAD']);
  assert.equal(vazio.codigo, 0, vazio.tudo);
  assert.match(vazio.saida, /Resultado: OK — nenhum commit no intervalo/);
  assert.equal(rodar(dir, ['verificar', '--por-commit=HEAD..HEAD']).codigo, 0);
  assert.match(rodar(dir, ['verificar', '--por-commit', 'HEAD']).erro, /exige um intervalo <de>\.\.<até>/);
  assert.equal(rodar(dir, ['verificar', '--por-commit']).codigo, 2);
  assert.match(rodar(dir, ['verificar', '--por-commit', 'naoexiste..HEAD']).erro, /ref não encontrada: naoexiste/);
  assert.match(rodar(dir, ['verificar', '--por-commit', `${'0'.repeat(40)}..HEAD`]).erro, /início do intervalo/);
  assert.match(rodar(dir, ['verificar', 'modulo-core', '--por-commit', 'HEAD..HEAD']).erro, /não se combina/);
  assert.equal(rodar(dir, ['verificar', '--base', 'main', '--por-commit', 'HEAD..HEAD']).codigo, 2);
});

test('--por-commit: recado existente alterado é violação mesmo para alexandre; recado novo do próprio agente é exceção', () => {
  const dir = criarRepo();
  const inicio = git(dir, 'rev-parse', 'HEAD').trim();
  escrever(dir, '.coord/recados/gerente-projetos/R-20261031-120000-modulo-core.md', RECADO);
  const novo = commitarComo(dir, 'modulo-core', 'T-0003: recado');
  appendFileSync(join(dir, '.coord/recados/testes/R-20261031-000000-modulo-core.md'), 'editado\n');
  const editou = commitarComo(dir, 'alexandre', 'T-0005: editou recado');
  const r = rodar(dir, ['verificar', '--por-commit', `${inicio}..HEAD`]);
  assert.equal(r.codigo, 1, r.tudo);
  assert.match(blocoDoCommit(r.saida, novo), /recado novo para gerente-projetos/);
  assert.match(blocoDoCommit(r.saida, editou), /VIOLAÇÃO[\s\S]*recados são imutáveis/);
});

// ───────────── guardião v4 (T-0005): "o lock acompanha a dependência", alexandre declarado e governanca ─────────────

const WORKSPACE = [
  'nodeLinker: hoisted',
  '',
  'packages:',
  '  - "apps/*"',
  '  - "modules/*"',
  '',
  '# pnpm 11+',
  'allowBuilds:',
  '  esbuild: true',
  '',
  '# pnpm 10 (equivalente)',
  'onlyBuiltDependencies:',
  '  - esbuild',
  '',
].join('\n');
const PKG = (nome, deps = {}) => JSON.stringify({ name: nome, version: '0.0.0', dependencies: deps }, null, 2) + '\n';

/** criarRepo + lock, workspace e package.json de dois donos no main. */
function criarRepoComLock() {
  const dir = criarRepo();
  escrever(dir, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\n");
  escrever(dir, 'pnpm-workspace.yaml', WORKSPACE);
  escrever(dir, 'package.json', PKG('raiz'));
  escrever(dir, 'modules/core/package.json', PKG('@macuxi/core'));
  escrever(dir, 'apps/api/package.json', PKG('@macuxi/api'));
  commitar(dir, 'lock e pacotes');
  return dir;
}

test('v4 lock: pnpm-lock.yaml + package.json do próprio agente no mesmo PR → OK, listado para revisão', () => {
  const dir = criarRepoComLock();
  git(dir, 'checkout', '-q', '-b', 'modulo-core/T-0003-dep');
  escrever(dir, 'modules/core/package.json', PKG('@macuxi/core', { zod: '^3.23.0' }));
  escrever(dir, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\n# zod\n");
  commitar(dir, 'T-0003: zod');
  const r = rodar(dir, ['verificar', '--base', 'main']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.deepEqual(secao(r.saida, 'OK'), ['M modules/core/package.json']);
  assert.deepEqual(secao(r.saida, 'Lock acompanhando dependência'), ['M pnpm-lock.yaml → dono: engenheiro-software — lock acompanhando dependência de modules/core']);
  assert.match(r.saida, /Resultado: OK — 2 arquivo\(s\) alterado\(s\), nenhuma violação para modulo-core \(1 com lock acompanhando dependência: revisão do engenheiro-software\)/);
  assert.doesNotMatch(r.saida, /VIOLAÇÃO/);
});

test('v4 lock: pnpm-lock.yaml sozinho → VIOLAÇÃO', () => {
  const dir = criarRepoComLock();
  git(dir, 'checkout', '-q', '-b', 'modulo-core/T-0003-dep');
  escrever(dir, 'modules/core/a.ts', 'mudou\n');
  escrever(dir, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\n# solto\n");
  commitar(dir, 'T-0003: lock solto');
  const r = rodar(dir, ['verificar', '--base', 'main']);
  assert.equal(r.codigo, 1, r.tudo);
  assert.match(secao(r.saida, 'VIOLAÇÃO').join('\n'), /^M pnpm-lock\.yaml → dono: engenheiro-software — fora dos caminhos de modulo-core/);
  assert.deepEqual(secao(r.saida, 'Lock acompanhando dependência'), []);
});

test('v4 lock: pnpm-lock.yaml + package.json de outro dono → VIOLAÇÃO nos dois', () => {
  const dir = criarRepoComLock();
  git(dir, 'checkout', '-q', '-b', 'modulo-core/T-0003-dep');
  escrever(dir, 'apps/api/package.json', PKG('@macuxi/api', { zod: '^3.23.0' }));
  escrever(dir, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\n# zod na api\n");
  commitar(dir, 'T-0003: dependência na api');
  const r = rodar(dir, ['verificar', '--base', 'main']);
  assert.equal(r.codigo, 1, r.tudo);
  const v = secao(r.saida, 'VIOLAÇÃO');
  assert.equal(v.length, 2, r.saida);
  assert.match(v.join('\n'), /M apps\/api\/package\.json → dono: engenheiro-software/);
  assert.match(v.join('\n'), /M pnpm-lock\.yaml → dono: engenheiro-software/);
});

test('v4 lock: pnpm-workspace.yaml só em allowBuilds/onlyBuiltDependencies acompanha; em outra chave é VIOLAÇÃO', () => {
  const dir = criarRepoComLock();
  git(dir, 'checkout', '-q', '-b', 'modulo-core/T-0003-dep');
  escrever(dir, 'modules/core/package.json', PKG('@macuxi/core', { sharp: '^0.33.0' }));
  escrever(dir, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\n# sharp\n");
  escrever(dir, 'pnpm-workspace.yaml', WORKSPACE.replace('  esbuild: true\n', '  esbuild: true\n  sharp: true\n').replace('  - esbuild\n', '  - esbuild\n  - sharp\n'));
  commitar(dir, 'T-0003: sharp');
  const ok = rodar(dir, ['verificar', '--base', 'main']);
  assert.equal(ok.codigo, 0, ok.tudo);
  assert.deepEqual(secao(ok.saida, 'Lock acompanhando dependência'), [
    'M pnpm-lock.yaml → dono: engenheiro-software — lock acompanhando dependência de modules/core',
    'M pnpm-workspace.yaml → dono: engenheiro-software — lock acompanhando dependência de modules/core (só allowBuilds/onlyBuiltDependencies)',
  ]);
  // Não commitado também conta (--base soma a árvore de trabalho): mexer em "packages:" vira violação.
  escrever(dir, 'pnpm-workspace.yaml', WORKSPACE.replace('  - "modules/*"\n', '  - "modules/*"\n  - "outros/*"\n').replace('  esbuild: true\n', '  esbuild: true\n  sharp: true\n'));
  const r = rodar(dir, ['verificar', '--base', 'main']);
  assert.equal(r.codigo, 1, r.tudo);
  assert.match(secao(r.saida, 'VIOLAÇÃO').join('\n'), /^M pnpm-workspace\.yaml → dono: engenheiro-software/);
  assert.deepEqual(secao(r.saida, 'Lock acompanhando dependência'), ['M pnpm-lock.yaml → dono: engenheiro-software — lock acompanhando dependência de modules/core']);
});

test('v4 lock: sem --base a regra não se aplica (lock de outro dono é informativo, como antes)', () => {
  const dir = criarRepoComLock();
  escrever(dir, 'modules/core/package.json', PKG('@macuxi/core', { zod: '^3.23.0' }));
  escrever(dir, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\n# zod\n");
  const r = rodar(dir, ['verificar', 'modulo-core']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.deepEqual(secao(r.saida, 'Outros donos (informativo'), ['M pnpm-lock.yaml → engenheiro-software']);
});

test('v4 lock --por-commit: lock + package.json próprio no mesmo commit → OK; lock em commit separado → VIOLAÇÃO', () => {
  const dir = criarRepoComLock();
  const inicio = git(dir, 'rev-parse', 'HEAD').trim();
  escrever(dir, 'modules/core/package.json', PKG('@macuxi/core', { zod: '^3.23.0' }));
  escrever(dir, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\n# zod\n");
  escrever(dir, 'pnpm-workspace.yaml', WORKSPACE.replace('  - esbuild\n', '  - esbuild\n  - zod\n'));
  const c1 = commitarComo(dir, 'modulo-core', 'T-0003: zod');
  escrever(dir, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\n# zod de novo\n");
  const c2 = commitarComo(dir, 'modulo-core', 'T-0003: só o lock');
  const r = rodar(dir, ['verificar', '--por-commit', `${inicio}..HEAD`]);
  assert.equal(r.codigo, 1, r.tudo);
  const b1 = blocoDoCommit(r.saida, c1);
  assert.doesNotMatch(b1, /VIOLAÇÃO/);
  assert.match(b1, /M pnpm-lock\.yaml → dono: engenheiro-software — lock acompanhando dependência de modules\/core/);
  assert.match(b1, /M pnpm-workspace\.yaml → dono: engenheiro-software — lock acompanhando dependência de modules\/core \(só allowBuilds\/onlyBuiltDependencies\)/);
  const b2 = blocoDoCommit(r.saida, c2);
  assert.match(b2, /VIOLAÇÃO/);
  assert.match(b2, /M pnpm-lock\.yaml → dono: engenheiro-software — fora dos caminhos de modulo-core/);
  assert.match(r.saida, new RegExp(`lock acompanhando dependência em 1 commit\\(s\\):\\n  ${c1} \\(modulo-core\\)`));
  assert.match(r.saida, new RegExp(`VIOLAÇÃO em 1 commit\\(s\\):\\n  ${c2} \\(modulo-core\\)`));
});

test('v4: alexandre pelo trailer (--base e --por-commit) é aceito e marcado "identidade alexandre declarada por trailer"', () => {
  const dir = criarRepo();
  const inicio = git(dir, 'rev-parse', 'HEAD').trim();
  git(dir, 'checkout', '-q', '-b', 'nuvem/T-0005-guardiao-v4');
  escrever(dir, 'scripts/coord-lib.mjs', readFileSync(join(dir, 'scripts', 'coord-lib.mjs'), 'utf8') + '\n');
  escrever(dir, 'apps/api/x.ts', 'alexandre\n');
  const c1 = commitarComo(dir, 'alexandre', 'T-0005: guardião');
  const base = rodar(dir, ['verificar', '--base', 'main']);
  assert.equal(base.codigo, 0, base.tudo);
  assert.match(base.saida, /agente: alexandre \(trailer "Agente:" de 1 commit\(s\) do PR\)/);
  assert.match(base.saida, /Atenção: identidade alexandre declarada por trailer/);
  const pc = rodar(dir, ['verificar', '--por-commit', `${inicio}..HEAD`]);
  assert.equal(pc.codigo, 0, pc.tudo);
  assert.match(blocoDoCommit(pc.saida, c1), /agente: alexandre \(trailer\)\n   Atenção: identidade alexandre declarada por trailer/);
  assert.match(pc.saida, new RegExp(`identidade alexandre declarada por trailer em 1 commit\\(s\\)[^\\n]*:\\n  ${c1} T-0005: guardião`));
  const explicito = rodar(dir, ['verificar', 'alexandre', '--base', 'main']);
  assert.equal(explicito.codigo, 0, explicito.tudo);
  assert.doesNotMatch(explicito.saida, /declarada por/, 'agente informado no comando não é "declarado"');
  git(dir, 'checkout', '-q', '-b', 'alexandre/T-0005-x');
  assert.match(rodar(dir, ['verificar', '--base', 'main']).saida, /Atenção: identidade alexandre declarada por branch/);
});

test('v4 governanca --base: sai 1 com a lista quando o diff mexe em .claude/**, donos.json, scripts/coord*.mjs ou .github/**', () => {
  const casos = [
    ['.claude/hooks/guarda-donos.mjs'],
    ['.claude/settings.json'],
    ['.coord/donos.json'],
    ['scripts/coord.mjs'],
    ['scripts/coord-verificar.test.mjs'],
    ['.github/workflows/ci.yml'],
    ['.github/CODEOWNERS', 'modules/core/a.ts'],
  ];
  for (const arquivos of casos) {
    const dir = criarRepo();
    git(dir, 'checkout', '-q', '-b', 'nuvem/T-0005-gov');
    for (const f of arquivos) {
      if (f.startsWith('scripts/coord')) appendFileSync(join(dir, f), '\n// mudou\n'); // o script continua rodando
      else escrever(dir, f, `${f} mudou\n`);
    }
    commitar(dir, 'mexe em governança');
    const r = rodar(dir, ['governanca', '--base', 'main']);
    assert.equal(r.codigo, 1, `${arquivos}: ${r.tudo}`);
    const status = ['.coord/donos.json', 'scripts/coord.mjs'].includes(arquivos[0]) ? 'M' : 'A';
    assert.deepEqual(secao(r.saida, 'Caminhos de governança alterados'), [`${status} ${arquivos[0]}`]);
    assert.match(r.saida, /Resultado: GOVERNANÇA — 1 arquivo\(s\) de governança alterado\(s\): o PR exige revisão do Alexandre/);
  }
});

test('v4 governanca --base: sai 0 sem caminho de governança (inclui .coord/ fora do donos.json e scripts/ que não são coord*); 2 em erro de uso', () => {
  const dir = criarRepo();
  git(dir, 'checkout', '-q', '-b', 'modulo-core/T-0003-x');
  escrever(dir, 'modules/core/a.ts', 'mudou\n');
  escrever(dir, '.coord/quadro.md');
  escrever(dir, 'scripts/outro.mjs');
  escrever(dir, 'docs/.github/nota.md');
  commitar(dir, 'sem governança');
  escrever(dir, 'apps/api/x.ts', 'não commitado\n');
  const r = rodar(dir, ['governanca', '--base', 'main']);
  assert.equal(r.codigo, 0, r.tudo);
  assert.match(r.saida, /Resultado: OK — nenhum caminho de governança alterado \(5 arquivo\(s\) no diff\)/);
  assert.equal(rodar(dir, ['governanca', '--base', 'HEAD']).codigo, 0, 'só não commitado fora da governança');
  escrever(dir, '.claude/hooks/novo.mjs');
  const naoCommitado = rodar(dir, ['governanca', '--base', 'HEAD']);
  assert.equal(naoCommitado.codigo, 1, 'não commitado em .claude/ também conta: ' + naoCommitado.tudo);
  assert.deepEqual(secao(naoCommitado.saida, 'Caminhos de governança alterados'), ['A .claude/hooks/novo.mjs']);
  for (const args of [['governanca'], ['governanca', '--base'], ['governanca', '--base', 'nao-existe'], ['governanca', '--base', 'main', '--x'], ['governanca', 'main']]) {
    const e = rodar(dir, args);
    assert.equal(e.codigo, 2, `${args.join(' ')}: ${e.tudo}`);
  }
});

test('v4 funções puras: workspaceMudouSoEmBuilds, pacoteDoPackageJson, lockAcompanhaDependencia e mudancasDeGovernanca', () => {
  assert.equal(workspaceMudouSoEmBuilds(WORKSPACE, WORKSPACE.replace('  esbuild: true\n', '  esbuild: true\n  "@tailwindcss/oxide": true\n  # comentário\n')), true);
  assert.equal(workspaceMudouSoEmBuilds(WORKSPACE, WORKSPACE.replace('onlyBuiltDependencies:\n  - esbuild\n', 'onlyBuiltDependencies: [esbuild, sharp]\n')), true, 'forma de fluxo');
  assert.equal(workspaceMudouSoEmBuilds(WORKSPACE.replace(/allowBuilds:\n  esbuild: true\n/, ''), WORKSPACE), true, 'chave nova');
  assert.equal(workspaceMudouSoEmBuilds(WORKSPACE, WORKSPACE.replace(/\n/g, '\r\n') + '\n\n'), true, 'CRLF e linhas em branco');
  assert.equal(workspaceMudouSoEmBuilds(WORKSPACE, WORKSPACE.replace('nodeLinker: hoisted', 'nodeLinker: isolated')), false);
  assert.equal(workspaceMudouSoEmBuilds(WORKSPACE, WORKSPACE + 'minimumReleaseAge: 0\n'), false, 'chave nova fora das de build');
  assert.equal(workspaceMudouSoEmBuilds(WORKSPACE, WORKSPACE.replace('allowBuilds:\n  esbuild: true\n', 'allowBuilds:\n  esbuild: true\nminimumReleaseAge: 0\n')), false, 'chave colada no fim do bloco');
  assert.equal(pacoteDoPackageJson('modules/core/package.json'), 'modules/core');
  assert.equal(pacoteDoPackageJson('package.json'), '.');
  assert.equal(pacoteDoPackageJson('modules/core/package.json.bak'), null);
  const regras = DONOS.regras.map((r) => ({ ...r, re: globParaRegex(r.padrao) }));
  const mudancas = [{ status: 'M', caminho: 'pnpm-lock.yaml' }, { status: 'M', caminho: 'pnpm-workspace.yaml' }, { status: 'M', caminho: 'modules/core/package.json' }];
  const sem = classificarMudancas({ agente: 'modulo-core', mudancas, regras, estrito: true });
  assert.equal(sem.violacoes.length, 2, 'sem lockAcompanha (uso dos hooks): violação como antes');
  const com = classificarMudancas({ agente: 'modulo-core', mudancas, regras, estrito: true, lockAcompanha: true, workspaceSoBuilds: () => false });
  assert.deepEqual(com.violacoes.map((v) => v.caminho), ['pnpm-workspace.yaml']);
  assert.deepEqual(com.acompanhando.map((v) => v.caminho), ['pnpm-lock.yaml']);
  const apagado = lockAcompanhaDependencia({ agente: 'modulo-core', resultado: { ok: [{ status: 'M', caminho: 'modules/core/package.json' }], violacoes: [{ status: 'D', caminho: 'pnpm-lock.yaml' }] } });
  assert.equal(apagado.violacoes.length, 1, 'apagar o lock não é acompanhar');
  assert.deepEqual(mudancasDeGovernanca([
    { status: 'M', caminho: '.claude\\hooks\\x.mjs' }, { status: 'M', caminho: '.coord/donos.json' }, { status: 'M', caminho: '.coord/quadro.md' },
    { status: 'A', caminho: 'scripts/coord-novo.mjs' }, { status: 'A', caminho: 'scripts/fronteiras.mjs' }, { status: 'M', caminho: '.github/workflows/ci.yml' },
  ]).map((m) => m.caminho), ['.claude/hooks/x.mjs', '.coord/donos.json', 'scripts/coord-novo.mjs', '.github/workflows/ci.yml']);
  assert.ok(carregarDonos);
});

// ───────────── anexos de recado (.coord/recados/anexos/**): arquivo comum, dono alexandre ─────────────
// Antes, o regex de recado casava "anexos" como destino e todo verificar acusava "destino de recado inválido".

const ANEXO_PNG = '.coord/recados/anexos/R-20261106-alexandre-filtro-periodo.png';
const ANEXO_HTML = '.coord/recados/anexos/R-20261106-alexandre-filtro-periodo.html';

test('anexos: donos.json real tem a regra .coord/recados/anexos/** → alexandre antes de .coord/**', () => {
  const regras = JSON.parse(DONOS_REAIS).regras.map((r) => r.padrao);
  const iAnexos = regras.indexOf('.coord/recados/anexos/**');
  assert.ok(iAnexos >= 0, 'regra dos anexos ausente');
  assert.equal(JSON.parse(DONOS_REAIS).regras[iAnexos].dono, 'alexandre');
  assert.ok(iAnexos < regras.indexOf('.coord/**'), 'a regra dos anexos precisa vir antes da genérica de .coord/**');
});

test('anexos: donoDaMudanca e podeAlterar tratam o anexo como arquivo comum do alexandre; recado normal igual', () => {
  const regras = carregarDonos(join(AQUI, '..'));
  assert.deepEqual(donoDaMudanca(ANEXO_PNG, regras), { tipo: 'comum', dono: 'alexandre' });
  assert.deepEqual(donoDaMudanca('.coord/recados/anexos/sub/pasta/x.html', regras), { tipo: 'comum', dono: 'alexandre' });
  assert.equal(ehAnexoDeRecado('.coord\\recados\\anexos\\a.png'), true, 'barra invertida');
  assert.equal(ehAnexoDeRecado('.coord/recados/alexandre/R-1-anexos.md'), false);
  assert.equal(ehAnexoDeRecado('.coord/recados/anexos'), false, 'a pasta sem arquivo não é anexo');
  // recado normal: sem mudança
  assert.deepEqual(donoDaMudanca('.coord/recados/alexandre/R-20261106-1-engenheiro-software.md', regras),
    { tipo: 'recado', destino: 'alexandre', arquivo: 'R-20261106-1-engenheiro-software.md', dono: 'engenheiro-software' });
  assert.deepEqual(donoDaMudanca('.coord/recados/fulano/x/y.md', regras), { tipo: 'recado-fora', dono: 'sem-dono' });
  // guardião (Edit/Write): alexandre cria e altera; os outros recebem a regra comum de arquivo de outro dono
  const raiz = mkdtempSync(join(tmpdir(), 'coord-anexos-'));
  temporarios.push(raiz);
  escrever(raiz, ANEXO_HTML, '<p>anexo</p>\n');
  for (const ferramenta of ['Write', 'Edit']) {
    assert.deepEqual(podeAlterar({ agente: 'alexandre', ferramenta, rel: ANEXO_HTML, raiz, regras }), { ok: true, dono: 'alexandre' }, `${ferramenta} do alexandre em anexo existente`);
    const r = podeAlterar({ agente: 'gerente-projetos', ferramenta, rel: ANEXO_PNG, raiz, regras });
    assert.equal(r.ok, false);
    assert.equal(r.dono, 'alexandre');
    assert.match(r.motivo, /pertence a alexandre\. só o Alexandre altera este arquivo/);
  }
  // recado normal no guardião: sem mudança
  assert.match(podeAlterar({ agente: 'alexandre', ferramenta: 'Write', rel: '.coord/recados/fulano/R-1-alexandre.md', raiz, regras }).motivo, /destino de recado inválido: fulano/);
  escrever(raiz, '.coord/recados/alexandre/R-1-engenheiro-software.md', RECADO);
  assert.match(podeAlterar({ agente: 'engenheiro-software', ferramenta: 'Edit', rel: '.coord/recados/alexandre/R-1-engenheiro-software.md', raiz, regras }).motivo, /imutáveis/);
  assert.deepEqual(podeAlterar({ agente: 'engenheiro-software', ferramenta: 'Write', rel: '.coord/recados/alexandre/R-2-engenheiro-software.md', raiz, regras }), { ok: true });
});

test('anexos: anexo novo ou alterado pelo alexandre não viola (verificar alexandre, sem agente e branch alexandre/*)', () => {
  const dir = criarRepoReal();
  escrever(dir, ANEXO_PNG, 'png\n');
  escrever(dir, ANEXO_HTML, '<p>v1</p>\n');
  const sem = rodar(dir, ['verificar']);
  assert.equal(sem.codigo, 0, sem.tudo);
  assert.doesNotMatch(sem.tudo, /destino de recado inválido/);
  const alexandre = rodar(dir, ['verificar', 'alexandre']);
  assert.equal(alexandre.codigo, 0, alexandre.tudo);
  assert.deepEqual(secao(alexandre.saida, 'OK').sort(), [`A ${ANEXO_HTML}`, `A ${ANEXO_PNG}`]);
  git(dir, 'checkout', '-q', '-b', 'alexandre/T-0090-anexos');
  commitar(dir, 'anexos');
  writeFileSync(join(dir, ANEXO_HTML), '<p>v2</p>\n'); // anexo não é imutável: o alexandre altera
  commitar(dir, 'anexo v2');
  const base = rodar(dir, ['verificar', '--base', 'main']);
  assert.equal(base.codigo, 0, base.tudo);
  assert.deepEqual(secao(base.saida, 'OK').sort(), [`A ${ANEXO_HTML}`, `A ${ANEXO_PNG}`]);
});

test('anexos: anexo criado ou alterado por outro agente viola (--base e --por-commit); sem --base é "Outros donos"', () => {
  const dir = criarRepoReal();
  git(dir, 'checkout', '-q', '-b', 'gerente-projetos/T-0090');
  escrever(dir, ANEXO_PNG, 'png\n');
  commitar(dir, 'T-0090: anexo');
  const r = rodar(dir, ['verificar', '--base', 'main']);
  assert.equal(r.codigo, 1, r.tudo);
  const v = secao(r.saida, 'VIOLAÇÃO');
  assert.equal(v.length, 1, r.saida);
  assert.match(v[0], /^A \.coord\/recados\/anexos\/R-20261106-alexandre-filtro-periodo\.png → dono: alexandre — fora dos caminhos de gerente-projetos/);
  assert.doesNotMatch(r.tudo, /destino de recado inválido/);

  const dir2 = criarRepoReal();
  const inicio = git(dir2, 'rev-parse', 'HEAD').trim();
  escrever(dir2, ANEXO_HTML, '<p>v1</p>\n');
  const doAlexandre = commitarComo(dir2, 'alexandre', 'T-0090: anexos do alexandre');
  writeFileSync(join(dir2, ANEXO_HTML), '<p>editado pelo gerente</p>\n');
  const doGerente = commitarComo(dir2, 'gerente-projetos', 'T-0090: mexeu no anexo');
  const pc = rodar(dir2, ['verificar', '--por-commit', `${inicio}..HEAD`]);
  assert.equal(pc.codigo, 1, pc.tudo);
  assert.doesNotMatch(blocoDoCommit(pc.saida, doAlexandre), /VIOLAÇÃO/);
  assert.match(blocoDoCommit(pc.saida, doGerente), /VIOLAÇÃO[\s\S]*M \.coord\/recados\/anexos\/R-20261106-alexandre-filtro-periodo\.html → dono: alexandre/);

  const dir3 = criarRepoReal();
  escrever(dir3, ANEXO_PNG, 'png\n');
  const arvore = rodar(dir3, ['verificar', 'engenheiro-software']);
  assert.equal(arvore.codigo, 0, arvore.tudo);
  assert.deepEqual(secao(arvore.saida, 'Outros donos'), [`A ${ANEXO_PNG} → alexandre`]);
});

test('anexos: recado normal continua igual ao lado de um anexo (exceção, destino inválido e imutável)', () => {
  const dir = criarRepoReal();
  escrever(dir, ANEXO_PNG, 'png\n');
  escrever(dir, '.coord/recados/alexandre/R-20261106-090000-engenheiro-software.md', RECADO);
  escrever(dir, '.coord/recados/fulano/R-20261106-090001-engenheiro-software.md', RECADO);
  mudar(dir, RECADO_ENG);
  const r = rodar(dir, ['verificar', 'engenheiro-software']);
  assert.equal(r.codigo, 1, r.tudo);
  assert.deepEqual(secao(r.saida, 'Exceções do protocolo'), ['A .coord/recados/alexandre/R-20261106-090000-engenheiro-software.md — recado novo para alexandre']);
  assert.deepEqual(secao(r.saida, 'Outros donos'), [`A ${ANEXO_PNG} → alexandre`]);
  const v = secao(r.saida, 'VIOLAÇÃO');
  assert.equal(v.length, 2, r.saida);
  assert.ok(v.some((l) => /fulano\/.* — destino de recado inválido: fulano$/.test(l)), v.join('\n'));
  assert.ok(v.some((l) => l.startsWith(`M ${RECADO_ENG} → dono: ninguém — recados são imutáveis`)), v.join('\n'));
});

// ───────────── T-0123: agente corretor-redundancias (donos, guardião Edit/Write, verificar e recados) ─────────────

const REDUNDANCIAS = 'docs/qualidade/redundancias/2026-11-08-inicio-campo.md';

test('T-0123 corretor-redundancias: donos.json real dá a ele só docs/qualidade/redundancias/** e o próprio diário', () => {
  const regras = carregarDonos(join(AQUI, '..'));
  assert.deepEqual(donoDaMudanca(REDUNDANCIAS, regras), { tipo: 'comum', dono: 'corretor-redundancias' });
  assert.deepEqual(donoDaMudanca('docs/qualidade/redundancias/catalogo.md', regras), { tipo: 'comum', dono: 'corretor-redundancias' });
  assert.deepEqual(donoDaMudanca('docs/qualidade/outra-coisa.md', regras), { tipo: 'comum', dono: 'gerente-projetos' }, 'só a subpasta redundancias é dele');
  assert.deepEqual(donoDaMudanca('.coord/diario/corretor-redundancias.md', regras), { tipo: 'diario', dono: 'corretor-redundancias' });
  assert.equal(remetenteDoRecado('R-20261108-120000-corretor-redundancias.md'), 'corretor-redundancias');
  assert.equal(remetenteDoRecado('R-20261108-120000-2-corretor-redundancias.md'), 'corretor-redundancias');

  const raiz = mkdtempSync(join(tmpdir(), 'coord-corretor-'));
  temporarios.push(raiz);
  const pode = (rel, ferramenta = 'Write', conteudo) => podeAlterar({ agente: 'corretor-redundancias', ferramenta, rel, raiz, regras, conteudo });
  for (const ferramenta of ['Write', 'Edit']) {
    assert.equal(pode(REDUNDANCIAS, ferramenta).ok, true, `${ferramenta} no relatório`);
    assert.equal(pode('docs/qualidade/redundancias/catalogo.md', ferramenta).ok, true, `${ferramenta} no catálogo`);
    assert.equal(pode('.coord/diario/corretor-redundancias.md', ferramenta).ok, true, `${ferramenta} no diário`);
    assert.equal(pode('.coord/lidos/corretor-redundancias.txt', ferramenta).ok, true, `${ferramenta} nos lidos`);
  }
  // Fora de docs/qualidade/redundancias/**: bloqueado, com o dono e a dica do recado.
  for (const [rel, dono] of [
    ['modules/core/app/inicio.tsx', 'modulo-core'],
    ['modules/vendedor/app/pedidos.tsx', 'modulo-vendedor'],
    ['packages/ui/src/mobile/cartao.tsx', 'designer-ux'],
    ['docs/produto/03-regras-e-permissoes.md', 'gerente-projetos'],
    ['docs/qualidade/outra-coisa.md', 'gerente-projetos'],
    ['.coord/quadro.md', 'gerente-projetos'],
    ['.claude/agents/corretor-redundancias.md', 'alexandre'],
    ['.coord/donos.json', 'alexandre'],
    ['scripts/coord.mjs', 'alexandre'],
  ]) {
    const r = pode(rel);
    assert.equal(r.ok, false, rel);
    assert.equal(r.dono, dono, rel);
    assert.match(r.motivo, new RegExp(`pertence a ${dono}`), rel);
  }
  assert.match(pode('modules/core/app/inicio.tsx').motivo, /enviar --de corretor-redundancias --para modulo-core --tipo pedido/);
  assert.equal(pode('.coord/diario/modulo-core.md').ok, false, 'diário de outro agente');
  // Recado novo dele (para outro) e recado de outro para ele: aceitos; em nome de outro, não.
  const recadoDele = '---\nid: R-20261108-120000-corretor-redundancias\nde: corretor-redundancias\npara: [modulo-core]\n---\n# RD-0001\n';
  assert.deepEqual(pode('.coord/recados/modulo-core/R-20261108-120000-corretor-redundancias.md', 'Write', recadoDele), { ok: true });
  assert.equal(pode('.coord/recados/modulo-core/R-20261108-120000-modulo-core.md').ok, false, 'nome com outro remetente');
  const emNomeDeOutro = recadoDele.replace('de: corretor-redundancias', 'de: modulo-vendedor');
  assert.match(pode('.coord/recados/modulo-core/R-20261108-120001-corretor-redundancias.md', 'Write', emNomeDeOutro).motivo, /em nome de outro/);
  assert.deepEqual(podeAlterar({ agente: 'modulo-core', ferramenta: 'Write', rel: '.coord/recados/corretor-redundancias/R-20261108-120002-modulo-core.md', raiz, regras }), { ok: true }, 'destino corretor-redundancias é válido');
});

test('T-0123 corretor-redundancias: verificar acusa a escrita dele fora de docs/qualidade/redundancias/**', () => {
  const dir = criarRepoReal();
  git(dir, 'checkout', '-q', '-b', 'corretor-redundancias/T-0124-inicio-campo');
  escrever(dir, REDUNDANCIAS, '# Auditoria\n');
  escrever(dir, 'docs/qualidade/redundancias/catalogo.md', '| ID |\n');
  escrever(dir, '.coord/diario/corretor-redundancias.md', '2026-11-08 — T-0124 — auditoria\n');
  commitarCom(dir, 'T-0124: relatório', 'corretor-redundancias');
  const ok = rodar(dir, ['verificar', '--base', 'main']);
  assert.equal(ok.codigo, 0, ok.tudo);
  assert.match(ok.saida, /nenhuma violação para corretor-redundancias/);

  mudar(dir, 'modules/core/app/lib/cargas.ts');
  commitarCom(dir, 'T-0124: corrigiu o Início por conta própria', 'corretor-redundancias');
  const r = rodar(dir, ['verificar', '--base', 'main']);
  assert.equal(r.codigo, 1, r.tudo);
  const v = secao(r.saida, 'VIOLAÇÃO');
  assert.equal(v.length, 1, r.saida);
  assert.match(v[0], /^M modules\/core\/app\/lib\/cargas\.ts → dono: modulo-core — fora dos caminhos de corretor-redundancias/);
  assert.ok(secao(r.saida, 'OK').includes(`A ${REDUNDANCIAS}`), r.saida);
});

test('T-0123 corretor-redundancias: caixa funciona e o recado de ida e volta passa pela CLI', () => {
  const dir = criarRepoReal();
  const env = { MACUXI_AGENTE: '' };
  const vazia = rodar(dir, ['caixa', 'corretor-redundancias'], env);
  assert.equal(vazia.codigo, 0, vazia.tudo);
  assert.match(vazia.saida, /Caixa de corretor-redundancias: nada pendente/);

  const ida = rodar(dir, ['enviar', '--de', 'engenheiro-software', '--para', 'corretor-redundancias', '--tipo', 'pedido', '--tarefa', 'T-0123',
    '--assunto', 'Recado de teste (ida)', '--corpo', 'Contexto | Confirme o recebimento | Resposta com --encerra'], env);
  assert.equal(ida.codigo, 0, ida.tudo);
  const idIda = ida.saida.match(/Recado (R-\S+-engenheiro-software) enviado para corretor-redundancias/)?.[1];
  assert.ok(idIda, ida.saida);
  assert.match(readFileSync(join(dir, '.coord/recados/corretor-redundancias', `${idIda}.md`), 'utf8'), /^de: engenheiro-software\npara: \[corretor-redundancias\]$/m);
  const caixa = rodar(dir, ['caixa', 'corretor-redundancias'], env);
  assert.match(caixa.saida, /Caixa de corretor-redundancias: 1 exigem ação, 0 informativos não lidos/);
  assert.match(caixa.saida, new RegExp(`${idIda}\\s+\\[pedido\\] de engenheiro-software`));

  const volta = rodar(dir, ['enviar', '--de', 'corretor-redundancias', '--para', 'engenheiro-software', '--cc', 'gerente-projetos', '--tipo', 'resposta',
    '--responde-a', idIda, '--encerra', '--tarefa', 'T-0123', '--assunto', 'Recado de teste (volta)', '--corpo', 'Recebido.'], env);
  assert.equal(volta.codigo, 0, volta.tudo);
  const idVolta = volta.saida.match(/Recado (R-\S+-corretor-redundancias) enviado para engenheiro-software, gerente-projetos \(cc\)/)?.[1];
  assert.ok(idVolta, volta.saida);
  const texto = readFileSync(join(dir, '.coord/recados/engenheiro-software', `${idVolta}.md`), 'utf8');
  assert.match(texto, /^de: corretor-redundancias$/m);
  assert.match(texto, new RegExp(`^responde_a: ${idIda}$`, 'm'));
  assert.match(texto, /^encerra: true$/m);

  assert.match(rodar(dir, ['caixa', 'corretor-redundancias'], env).saida, /nada pendente/, 'o pedido foi encerrado pela resposta');
  const doEng = rodar(dir, ['caixa', 'engenheiro-software'], env).saida;
  assert.match(doEng, new RegExp(`${idVolta}\\s+\\[resposta\\] de corretor-redundancias`));
  const fio = rodar(dir, ['fio', idIda], env);
  assert.equal(fio.codigo, 0, fio.tudo);
  assert.match(fio.saida, /engenheiro-software → corretor-redundancias {2}\[pedido\]/);
  assert.match(fio.saida, /corretor-redundancias → engenheiro-software {2}\[resposta, encerra\]/);
  const lido = rodar(dir, ['lido', 'corretor-redundancias', idIda], env);
  assert.equal(lido.codigo, 0, lido.tudo);

  // verificar: o recado novo e os lidos dele são exceções do protocolo, sem violação.
  const v = rodar(dir, ['verificar', 'corretor-redundancias']);
  assert.equal(v.codigo, 0, v.tudo);
  const exc = secao(v.saida, 'Exceções do protocolo').join('\n');
  assert.match(exc, new RegExp(`A \\.coord/recados/engenheiro-software/${idVolta}\\.md — recado novo para engenheiro-software`));
  assert.match(exc, /\.coord\/lidos\/corretor-redundancias\.txt/);
});
