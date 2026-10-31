// Testes do guardião de donos para o Bash (node:test, sem dependências).
// Rodar: node --test .claude/hooks/guarda-bash.test.mjs
// Parte 1: analisador (PreToolUse) com disco/git simulados. Parte 2: foto antes × depois
// (PostToolUse) num repositório git temporário. Parte 3: o hook de verdade (stdin → exit code)
// num repositório temporário com cópia de coord-lib.mjs e dos hooks, como em coord-verificar.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, appendFileSync, utimesSync, existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { globParaRegex } from '../../scripts/coord-lib.mjs';
import {
  tokenizar, analisarComando, absoluto, relativoDaRaiz, lerStatus, fotografar, compararFotos, statDe,
  violacoesDasMudancas, atualizarAcusados, permitidosDe, mensagemPos, descontarDesfeitos,
} from './guarda-bash-lib.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_REAL = join(AQUI, '..', '..');

const DONOS = {
  versao: 1,
  regras: [
    { padrao: '.claude/**', dono: 'alexandre' },
    { padrao: 'scripts/coord*.mjs', dono: 'alexandre' },
    { padrao: 'legado/**', dono: 'congelado' },
    { padrao: '.coord/**', dono: 'gerente-projetos' },
    { padrao: 'docs/**', dono: 'gerente-projetos' },
    { padrao: 'modules/core/**', dono: 'modulo-core' },
    { padrao: 'modules/catalogo/**', dono: 'modulo-catalogo' },
    { padrao: 'apps/**', dono: 'engenheiro-software' },
  ],
  somente_leitura: ['C:/Users/domon/dev/forca-vendas'],
};
const REGRAS = DONOS.regras.map((r) => ({ ...r, re: globParaRegex(r.padrao) }));

// ───────────────────────── Parte 1: analisador com disco simulado ─────────────────────────

/**
 * Disco/git simulados. `arquivos`: rastreados existentes; `pastas`; `sujos`: [{xy, rel}].
 * Caminhos relativos à raiz.
 */
function ambiente({ raiz = '/repo', arquivos = [], pastas = [], sujos = [] } = {}) {
  const relDe = (abs) => relativoDaRaiz(abs, raiz);
  const todas = new Set(pastas);
  for (const f of [...arquivos, ...sujos.map((s) => s.rel)]) {
    const partes = f.split('/');
    for (let i = 1; i < partes.length; i++) todas.add(partes.slice(0, i).join('/'));
  }
  return {
    existe: (abs) => { const r = relDe(abs); return r !== null && (r === '' || arquivos.includes(r) || todas.has(r) || sujos.some((s) => s.rel === r)); },
    ehDiretorio: (abs) => { const r = relDe(abs); return r !== null && (r === '' || todas.has(r)); },
    sujos: () => sujos,
    rastreadosSob: (rel) => arquivos.filter((f) => rel === '' || f === rel || f.startsWith(rel + '/')),
  };
}

const ARQUIVOS = [
  'modules/core/a.ts',
  'modules/catalogo/b.ts',
  'apps/api/x.ts',
  'docs/produto/01.md',
  '.coord/recados/testes/R-20261031-000000-modulo-core.md',
  '.coord/diario/modulo-core.md',
  '.coord/diario/testes.md',
];

function analisar(comando, { agente = 'modulo-core', cwd = '/repo', raiz = '/repo', sujos = [], arquivos = ARQUIVOS, permitidos } = {}) {
  return analisarComando({
    comando, agente, cwd, raiz, regras: REGRAS, somenteLeitura: DONOS.somente_leitura, permitidos,
    amb: ambiente({ raiz, arquivos, sujos }),
  });
}
const bloqueia = (cmd, opts) => {
  const r = analisar(cmd, opts);
  assert.ok(r.violacoes.length > 0, `deveria bloquear: ${cmd}`);
  return r.violacoes;
};
const libera = (cmd, opts) => {
  const r = analisar(cmd, opts);
  assert.deepEqual(r.violacoes, [], `deveria liberar: ${cmd}`);
  return r;
};

test('escrita no próprio caminho é permitida (redirecionamento, sed -i, tee, cp, mv, rm, touch)', () => {
  libera('echo oi > modules/core/a.ts');
  libera('echo oi >> modules/core/novo.ts');
  libera("sed -i 's/a/b/' modules/core/a.ts");
  libera('cat modules/core/a.ts | tee modules/core/c.ts');
  libera('cp apps/api/x.ts modules/core/copia.ts');
  libera('mv modules/core/a.ts modules/core/b.ts');
  libera('rm -f modules/core/a.ts && touch modules/core/z.ts');
  libera('git checkout -- modules/core/a.ts', { sujos: [{ xy: ' M', rel: 'modules/core/a.ts' }] });
});

test('bloqueia redirecionamento > e >> para caminho de outro dono, com o motivo do guardião', () => {
  const v = bloqueia('echo oi > modules/catalogo/b.ts');
  assert.equal(v[0].rel, 'modules/catalogo/b.ts');
  assert.match(v[0].motivo, /pertence a modulo-catalogo/);
  assert.match(v[0].motivo, /coord\.mjs enviar --de modulo-core --para modulo-catalogo/);
  bloqueia('echo oi >> apps/api/x.ts');
  bloqueia('ls modules/core 2> apps/api/erros.log');
  bloqueia('pnpm test &> docs/saida.txt');
  bloqueia('echo oi >| docs/x.md');
  bloqueia("cat > apps/api/novo.ts <<'EOF'\nconst a = 1 > 0;\nEOF");
  bloqueia('echo oi>apps/api/x.ts');
  bloqueia('echo ".claude é do Alexandre" > .claude/hooks/x.mjs');
});

test('bloqueia sed -i (todas as formas) e libera sed sem -i', () => {
  bloqueia("sed -i 's/a/b/' apps/api/x.ts");
  bloqueia("sed -i.bak -e 's/a/b/' apps/api/x.ts");
  bloqueia("sed -Ei 's/a/b/' modules/catalogo/b.ts");
  bloqueia("sed --in-place=.bak 's/a/b/' modules/catalogo/b.ts");
  bloqueia("sed -e 's/a/b/' -i modules/core/a.ts apps/api/x.ts");
  bloqueia("perl -pi -e 's/a/b/' apps/api/x.ts");
  libera("sed -n '1,10p' apps/api/x.ts");
  libera("sed 's/a/b/' apps/api/x.ts > modules/core/saida.ts");
});

test('bloqueia mv/cp para caminho alheio e mv de arquivo alheio', () => {
  const v = bloqueia('mv modules/core/a.ts modules/catalogo/a.ts');
  assert.deepEqual(v.map((x) => x.rel), ['modules/catalogo/a.ts']);
  assert.deepEqual(bloqueia('mv apps/api/x.ts modules/core/x.ts').map((x) => x.rel), ['apps/api/x.ts']);
  assert.deepEqual(bloqueia('cp modules/core/a.ts apps/api/').map((x) => x.rel), ['apps/api/a.ts']);
  assert.deepEqual(bloqueia('cp -t docs modules/core/a.ts').map((x) => x.rel), ['docs/a.ts']);
  bloqueia('cp -r modules/core apps/novo');
  bloqueia('install -m 644 modules/core/a.ts apps/api/a.ts');
});

test('bloqueia tee, rm, touch e git rm/mv em caminho alheio; rm -rf de pasta confere os arquivos de dentro', () => {
  bloqueia('echo oi | tee -a docs/produto/01.md');
  bloqueia('rm docs/produto/01.md');
  bloqueia('touch modules/catalogo/novo.ts');
  bloqueia('git rm apps/api/x.ts');
  bloqueia('git mv modules/core/a.ts apps/api/a.ts');
  assert.deepEqual(bloqueia('rm -rf modules').map((x) => x.rel).sort(), ['modules/catalogo/b.ts']);
  libera('git rm --cached apps/api/x.ts');
});

test('git checkout/restore: só bloqueia quando descartaria alteração alheia (ou traz versão de outro ref)', () => {
  const sujos = [{ xy: ' M', rel: 'apps/api/x.ts' }, { xy: ' M', rel: 'modules/core/a.ts' }, { xy: '??', rel: 'apps/api/novo.ts' }];
  bloqueia('git checkout -- apps/api/x.ts', { sujos });
  bloqueia('git restore apps/api/x.ts', { sujos });
  bloqueia('git checkout apps/api/x.ts', { sujos }); // sem "--": o arquivo existe → é caminho
  assert.deepEqual(bloqueia('git checkout .', { sujos }).map((x) => x.rel), ['apps/api/x.ts']);
  bloqueia('git checkout origin/main -- apps/api/x.ts'); // de outro ref muda mesmo arquivo limpo
  bloqueia('git restore --source=HEAD~1 apps/api/x.ts');
  libera('git checkout -- apps/api/x.ts'); // arquivo limpo: nada a descartar
  libera('git checkout -- modules/core/a.ts', { sujos });
  libera('git checkout main', { sujos }); // branch, não caminho
  libera('git checkout -b modulo-core/T-0003', { sujos });
  libera('git restore --staged apps/api/x.ts', { sujos });
});

test('git reset --hard, stash e clean -f bloqueiam se houver trabalho de outro dono em jogo', () => {
  const sujos = [{ xy: ' M', rel: 'apps/api/x.ts' }, { xy: '??', rel: 'docs/novo.md' }];
  bloqueia('git reset --hard', { sujos });
  bloqueia('git stash', { sujos });
  bloqueia('git clean -fd', { sujos: [{ xy: '??', rel: 'docs/novo.md' }] });
  libera('git reset --hard', { sujos: [{ xy: ' M', rel: 'modules/core/a.ts' }] });
  libera('git stash list', { sujos });
  libera('git clean -n', { sujos });
  libera('git reset HEAD apps/api/x.ts', { sujos });
});

test('exceções universais: recado novo, diário e lidos do próprio agente', () => {
  libera('node scripts/coord.mjs enviar --de modulo-core --para testes --tipo aviso --assunto "x" --corpo "y"');
  libera("cat > .coord/recados/testes/R-20261031-120000-modulo-core.md <<'FIM'\n---\nde: modulo-core\n---\nFIM");
  libera('echo "2026-10-31 — T-0003 — feito" >> .coord/diario/modulo-core.md');
  libera('echo R-1 >> .coord/lidos/modulo-core.txt');
  assert.match(bloqueia('echo x > .coord/recados/testes/R-20261031-120000-testes.md')[0].motivo, /remetente/);
  assert.match(bloqueia('echo x >> .coord/recados/testes/R-20261031-000000-modulo-core.md')[0].motivo, /imutáveis/);
  assert.match(bloqueia('echo x > .coord/recados/ninguem/R-20261031-120000-modulo-core.md')[0].motivo, /destino de recado inválido/);
  assert.match(bloqueia('echo x >> .coord/diario/testes.md')[0].motivo, /pertence a testes/);
  bloqueia('echo x >> .coord/quadro.md');
});

test('em dúvida não bloqueia: variável, $(...), crase, glob, ~, xargs, find, script', () => {
  libera('echo x > $ARQ');
  libera('echo x > "$DESTINO/b.ts"');
  libera('rm modules/catalogo/*.ts');
  libera('rm $(git ls-files modules/catalogo)');
  libera('rm `cat lista.txt`');
  libera('git ls-files apps | xargs rm');
  libera('find apps -name "*.ts" -delete');
  libera('node -e "require(\'fs\').writeFileSync(\'apps/api/x.ts\', \'\')"');
  libera('pnpm lint --fix');
  libera('echo x > ~/notas.txt');
  libera('cd "$PASTA" && echo x > apps/api/x.ts');
});

test('redirecionamentos que não escrevem arquivo e comandos só de leitura', () => {
  assert.equal(libera('ls apps 2>/dev/null').soLeitura, true);
  assert.equal(libera('grep -rn foo apps 2>&1 | head -5').soLeitura, true);
  assert.equal(libera('git status --porcelain && git diff --stat').soLeitura, true);
  assert.equal(libera('cat < apps/api/x.ts').soLeitura, true);
  assert.equal(libera('echo x >&2').soLeitura, true);
  assert.equal(libera('pnpm test').soLeitura, false);
  assert.equal(libera('echo x > modules/core/a.ts').soLeitura, false);
});

test('cd, subshell, -C do git e bash -c mudam a pasta e o comando analisados', () => {
  bloqueia('cd modules && echo x > catalogo/b.ts');
  bloqueia('cd modules/core; echo x > ../../apps/api/x.ts');
  libera('cd /tmp && echo x > apps/api/x.ts');
  libera('(cd /tmp && echo x > a.txt) && echo y > modules/core/a.ts');
  bloqueia('(cd /tmp && echo x > a.txt); echo y > apps/api/x.ts');
  bloqueia('echo x > ../repo/apps/api/x.ts', { cwd: '/repo/modules' });
  bloqueia('git -C apps restore api/x.ts', { sujos: [{ xy: ' M', rel: 'apps/api/x.ts' }] });
  bloqueia('bash -c "echo x > apps/api/x.ts"');
  bloqueia("sh -c 'sed -i s/a/b/ docs/produto/01.md'");
  libera('echo x > /tmp/fora-do-repo.txt');
});

test('caminhos com espaço e barra invertida do Windows', () => {
  assert.equal(bloqueia('echo x > "apps/api/meu arquivo.ts"')[0].rel, 'apps/api/meu arquivo.ts');
  assert.equal(bloqueia("echo x > 'docs/produto/com espaço (1).md'")[0].rel, 'docs/produto/com espaço (1).md');
  assert.equal(bloqueia('echo x > apps/api/meu\\ arquivo.ts')[0].rel, 'apps/api/meu arquivo.ts');
  assert.equal(bloqueia('echo x > modules\\catalogo\\b.ts')[0].rel, 'modules/catalogo/b.ts');
  const win = { raiz: 'C:/macuxifdv', cwd: 'C:\\macuxifdv' };
  assert.equal(bloqueia('sed -i "s/a/b/" "C:\\macuxifdv\\apps\\api\\x.ts"', win)[0].rel, 'apps/api/x.ts');
  assert.equal(bloqueia('echo x > "C:\\macuxifdv\\docs\\meu doc.md"', win)[0].rel, 'docs/meu doc.md');
  assert.equal(bloqueia('echo x > /c/macuxifdv/apps/api/x.ts', win)[0].rel, 'apps/api/x.ts');
  bloqueia('mv "C:\\macuxifdv\\modules\\core\\a.ts" "C:\\macuxifdv\\modules\\catalogo\\a.ts"', win);
  libera('echo x > c:/MACUXIFDV/modules/core/a.ts', win); // drive e caixa diferentes: mesmo arquivo
  libera('echo x > "C:\\Users\\domon\\AppData\\Local\\Temp\\x.txt"', win);
  assert.match(bloqueia('echo x > "C:\\Users\\domon\\dev\\forca-vendas\\planilha teste.xlsx"', win)[0].motivo, /somente leitura/);
  assert.equal(absoluto('modules\\core\\a.ts', 'C:\\macuxifdv', 'C:/macuxifdv'), 'C:/macuxifdv/modules/core/a.ts');
});

test('agente fora do time não escreve no repositório pelo Bash (igual ao guarda-donos)', () => {
  assert.match(bloqueia('echo x > modules/core/a.ts', { agente: 'general-purpose' })[0].motivo, /não faz parte do time/);
  libera('echo x > /tmp/a.txt', { agente: 'general-purpose' });
});

test('o agente pode desfazer o que o PostToolUse acusou (e só isso)', () => {
  const sujos = [{ xy: ' M', rel: 'apps/api/x.ts' }, { xy: '??', rel: 'docs/novo.md' }];
  const permitidos = permitidosDe({ 'apps/api/x.ts': { status: 'M' }, 'docs/novo.md': { status: 'A' } });
  libera('git restore -- "apps/api/x.ts"', { sujos, permitidos });
  libera('rm -- "docs/novo.md"', { sujos, permitidos });
  bloqueia('echo x >> apps/api/x.ts', { sujos, permitidos }); // escrever de novo continua proibido
  bloqueia('git restore -- "apps/api/x.ts"', { sujos });
});

test('tokenizador: aspas, escapes, here-doc e descritores', () => {
  const palavras = (c) => tokenizar(c).filter((t) => t.tipo === 'palavra').map((t) => t.valor);
  assert.deepEqual(palavras('echo "a b" \'c d\' e\\ f'), ['echo', 'a b', 'c d', 'e f']);
  assert.deepEqual(palavras("cat <<EOF > x\nlinha > y\nEOF\necho z"), ['cat', 'x', 'echo', 'z']);
  const redir = tokenizar('cmd 2>err.txt').find((t) => t.tipo === 'redir');
  assert.deepEqual(redir, { tipo: 'redir', valor: '>', fd: '2' });
});

// ───────────────────────── Parte 2: foto antes × depois (repositório temporário) ─────────────────────────

const temporarios = [];
process.on('exit', () => { for (const d of temporarios) rmSync(d, { recursive: true, force: true }); });

function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function escrever(dir, rel, conteudo = `${rel}\n`) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), conteudo);
}

/** Repositório com donos.json, um arquivo de cada dono e (opcional) cópia do hook. */
function criarRepo({ comHook = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'guarda-bash-'));
  temporarios.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Teste');
  git(dir, 'config', 'user.email', 'teste@exemplo.invalid');
  git(dir, 'config', 'commit.gpgsign', 'false');
  escrever(dir, '.coord/donos.json', JSON.stringify(DONOS, null, 2));
  escrever(dir, '.coord/recados/testes/R-20261031-000000-modulo-core.md', '---\nde: modulo-core\n---\n');
  for (const f of ['modules/core/a.ts', 'modules/catalogo/b.ts', 'apps/api/x.ts', 'docs/produto/01.md', 'docs/meu doc.md']) escrever(dir, f);
  if (comHook) {
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true });
    copyFileSync(join(RAIZ_REAL, 'scripts', 'coord-lib.mjs'), join(dir, 'scripts', 'coord-lib.mjs'));
    for (const f of ['guarda-bash.mjs', 'guarda-bash-lib.mjs']) copyFileSync(join(AQUI, f), join(dir, '.claude', 'hooks', f));
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'inicial');
  return dir;
}

/** Foto de antes como o hook tira: estado + início = data de um arquivo gravado agora. */
function fotoAntes(dir) {
  const estado = fotografar(dir, lerStatus(dir));
  const marca = join(dir, '.git', 'marca-foto');
  writeFileSync(marca, '');
  return { inicio: statSync(marca).mtimeMs, estado };
}
function mudancasDepois(dir, antes) {
  return compararFotos(antes, fotografar(dir, lerStatus(dir)), (rel) => statDe(dir, rel));
}
const caminhos = (lista) => lista.map((m) => m.caminho).sort();

test('PostToolUse acusa só o que mudou durante o comando (não o que outros agentes já tinham alterado)', () => {
  const dir = criarRepoComOutroAgente();
  const antes = fotoAntes(dir);
  // "comando": mexe no próprio arquivo, num arquivo limpo de outro dono e cria um arquivo alheio
  appendFileSync(join(dir, 'modules/core/a.ts'), 'meu\n');
  appendFileSync(join(dir, 'docs/produto/01.md'), 'invasão\n');
  escrever(dir, 'modules/catalogo/novo.ts');
  const mud = mudancasDepois(dir, antes);
  assert.deepEqual(caminhos(mud), ['docs/produto/01.md', 'modules/catalogo/novo.ts', 'modules/core/a.ts']);
  const v = violacoesDasMudancas({ agente: 'modulo-core', mudancas: mud, regras: REGRAS });
  assert.deepEqual(caminhos(v), ['docs/produto/01.md', 'modules/catalogo/novo.ts']);
  const msg = mensagemPos('modulo-core', v);
  assert.match(msg, /git restore -- "docs\/produto\/01\.md"/);
  assert.match(msg, /rm -- "modules\/catalogo\/novo\.ts"/);
  assert.match(msg, /Nada foi desfeito automaticamente/);
  assert.ok(!msg.includes('apps/api/x.ts'), 'o arquivo alterado pelo outro agente antes do comando não é acusado');
});

function criarRepoComOutroAgente() {
  const dir = criarRepo();
  appendFileSync(join(dir, 'apps/api/x.ts'), 'trabalho do engenheiro\n'); // outro agente, em paralelo
  escrever(dir, 'modules/catalogo/rascunho.ts'); // não rastreado de outro agente
  return dir;
}

test('PostToolUse: arquivo que já estava sujo e foi alterado de novo é acusado, sem mandar descartar', () => {
  const dir = criarRepoComOutroAgente();
  const antes = fotoAntes(dir);
  appendFileSync(join(dir, 'apps/api/x.ts'), 'mais uma linha\n');
  const v = violacoesDasMudancas({ agente: 'modulo-core', mudancas: mudancasDepois(dir, antes), regras: REGRAS });
  assert.deepEqual(caminhos(v), ['apps/api/x.ts']);
  assert.equal(v[0].antes, 'sujo');
  assert.match(mensagemPos('modulo-core', v), /NÃO descarte/);
  assert.deepEqual(atualizarAcusados({}, v, lerStatus(dir)), {}, 'não libera desfazer de arquivo que já tinha trabalho alheio');
});

test('PostToolUse: alteração paralela de outro agente antes do início do comando não é acusada', () => {
  const dir = criarRepo();
  const antes = fotoAntes(dir);
  appendFileSync(join(dir, 'apps/api/x.ts'), 'outro agente\n');
  const passado = new Date(antes.inicio - 60_000);
  utimesSync(join(dir, 'apps/api/x.ts'), passado, passado);
  assert.deepEqual(mudancasDepois(dir, antes), []);
});

test('PostToolUse: git add/commit de arquivos alheios (rodada do gerente) não é acusado; checkout que descarta é', () => {
  const dir = criarRepoComOutroAgente();
  let antes = fotoAntes(dir);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'rodada');
  assert.deepEqual(mudancasDepois(dir, antes), []);
  appendFileSync(join(dir, 'apps/api/x.ts'), 'de novo\n');
  antes = fotoAntes(dir);
  git(dir, 'checkout', '--', 'apps/api/x.ts');
  const v = violacoesDasMudancas({ agente: 'modulo-core', mudancas: mudancasDepois(dir, antes), regras: REGRAS });
  assert.deepEqual(caminhos(v), ['apps/api/x.ts']);
});

test('PostToolUse: exceções universais (recado novo, diário, lidos) e recado alterado', () => {
  const dir = criarRepo();
  const antes = fotoAntes(dir);
  escrever(dir, '.coord/recados/gerente-projetos/R-20261031-120000-modulo-core.md');
  escrever(dir, '.coord/diario/modulo-core.md');
  escrever(dir, '.coord/lidos/modulo-core.txt');
  appendFileSync(join(dir, '.coord/recados/testes/R-20261031-000000-modulo-core.md'), 'editado\n');
  const v = violacoesDasMudancas({ agente: 'modulo-core', mudancas: mudancasDepois(dir, antes), regras: REGRAS });
  assert.deepEqual(caminhos(v), ['.coord/recados/testes/R-20261031-000000-modulo-core.md']);
  assert.match(v[0].motivo, /imutáveis/);
});

test('PostToolUse: acusados ficam liberados para desfazer até voltarem ao normal', () => {
  const dir = criarRepo();
  const antes = fotoAntes(dir);
  appendFileSync(join(dir, 'docs/produto/01.md'), 'x\n');
  escrever(dir, 'apps/novo.ts');
  const v = violacoesDasMudancas({ agente: 'modulo-core', mudancas: mudancasDepois(dir, antes), regras: REGRAS });
  let acusados = atualizarAcusados({}, v, lerStatus(dir));
  assert.deepEqual(acusados, { 'docs/produto/01.md': { status: 'M' }, 'apps/novo.ts': { status: 'A' } });
  const antes2 = fotoAntes(dir);
  git(dir, 'restore', '--', 'docs/produto/01.md');
  rmSync(join(dir, 'apps/novo.ts'));
  assert.equal(mudancasDepois(dir, antes2).length, 2);
  assert.deepEqual(descontarDesfeitos(mudancasDepois(dir, antes2), acusados, lerStatus(dir)), [], 'desfazer não é acusado');
  acusados = atualizarAcusados(acusados, [], lerStatus(dir));
  assert.deepEqual(acusados, {});
});

// ───────────────────────── Parte 3: o hook de verdade ─────────────────────────

let seq = 0;
function rodarHook(dir, evento, comando, { agente, sessao = 's-teste', id, env = {}, viaArgumento = false } = {}) {
  const entrada = {
    session_id: sessao, tool_use_id: id ?? `toolu_${++seq}`, hook_event_name: evento, tool_name: 'Bash',
    tool_input: { command: comando }, cwd: dir, ...(agente && !viaArgumento ? { agent_type: agente } : {}),
  };
  const args = [join(dir, '.claude', 'hooks', 'guarda-bash.mjs'), ...(viaArgumento && agente ? [agente] : [])];
  const t0 = performance.now();
  const r = spawnSync(process.execPath, args, { cwd: dir, input: JSON.stringify(entrada), encoding: 'utf8', env: { ...process.env, MACUXI_GUARDA: '', ...env } });
  return { codigo: r.status, erro: r.stderr, ms: performance.now() - t0, id: entrada.tool_use_id };
}
function rodarBash(dir, comando) {
  execFileSync('bash', ['-c', comando], { cwd: dir, stdio: 'ignore' });
}

test('hook: sessão sem agente é liberada; agente pelo argumento ou por agent_type', () => {
  const dir = criarRepo({ comHook: true });
  assert.equal(rodarHook(dir, 'PreToolUse', 'echo x > apps/api/x.ts').codigo, 0);
  const r = rodarHook(dir, 'PreToolUse', 'echo x > apps/api/x.ts', { agente: 'modulo-core' });
  assert.equal(r.codigo, 2);
  assert.match(r.erro, /BLOQUEADO \(Bash\).*\n.*"apps\/api\/x\.ts" pertence a engenheiro-software/);
  assert.equal(rodarHook(dir, 'PreToolUse', 'echo x > apps/api/x.ts', { agente: 'modulo-core', viaArgumento: true }).codigo, 2);
  assert.equal(rodarHook(dir, 'PreToolUse', 'echo x > apps/api/x.ts', { agente: 'modulo-core', env: { MACUXI_GUARDA: 'off' } }).codigo, 0);
});

test('hook: Pre + Post de ponta a ponta (comando permitido que alterou arquivo alheio sem ser evidente)', () => {
  const dir = criarRepo({ comHook: true });
  appendFileSync(join(dir, 'apps/api/x.ts'), 'engenheiro trabalhando\n'); // outro agente
  const cmd = `node -e "require('fs').appendFileSync('docs/meu doc.md','x')" && echo ok >> modules/core/a.ts`;
  const pre = rodarHook(dir, 'PreToolUse', cmd, { agente: 'modulo-core' });
  assert.equal(pre.codigo, 0, pre.erro);
  rodarBash(dir, cmd);
  const pos = rodarHook(dir, 'PostToolUse', cmd, { agente: 'modulo-core', id: pre.id });
  assert.equal(pos.codigo, 2);
  assert.match(pos.erro, /docs\/meu doc\.md \(alterado; dono: gerente-projetos\) → desfaça com: git restore -- "docs\/meu doc\.md"/);
  assert.ok(!pos.erro.includes('apps/api/x.ts'));
  assert.ok(!pos.erro.includes('modules/core/a.ts'));
  // o desfazer indicado é liberado pelo PreToolUse e, depois dele, nada mais é acusado
  const undo = 'git restore -- "docs/meu doc.md"';
  const pre2 = rodarHook(dir, 'PreToolUse', undo, { agente: 'modulo-core' });
  assert.equal(pre2.codigo, 0, pre2.erro);
  rodarBash(dir, undo);
  assert.equal(rodarHook(dir, 'PostToolUse', undo, { agente: 'modulo-core', id: pre2.id }).codigo, 0);
  // ...e, já desfeito, o mesmo comando volta a ser bloqueado para o arquivo do outro dono
  appendFileSync(join(dir, 'docs/meu doc.md'), 'gerente\n');
  assert.equal(rodarHook(dir, 'PreToolUse', undo, { agente: 'modulo-core' }).codigo, 2);
});

test('hook: PostToolUseFailure também confere; Post sem foto (comando só de leitura) sai 0', () => {
  const dir = criarRepo({ comHook: true });
  const cmd = 'pnpm qualquer-coisa';
  const pre = rodarHook(dir, 'PreToolUse', cmd, { agente: 'modulo-catalogo' });
  assert.equal(pre.codigo, 0);
  escrever(dir, 'modules/core/invasao.ts');
  const pos = rodarHook(dir, 'PostToolUseFailure', cmd, { agente: 'modulo-catalogo', id: pre.id });
  assert.equal(pos.codigo, 2);
  assert.match(pos.erro, /modules\/core\/invasao\.ts \(criado; dono: modulo-core\)/);
  const ler = rodarHook(dir, 'PreToolUse', 'git status', { agente: 'modulo-catalogo' });
  assert.equal(rodarHook(dir, 'PostToolUse', 'git status', { agente: 'modulo-catalogo', id: ler.id }).codigo, 0);
});

test('desempenho: Pre e Post abaixo de 1 s com ~1.000 arquivos alterados', () => {
  const dir = criarRepo({ comHook: true });
  for (let i = 0; i < 1000; i++) escrever(dir, `apps/carga/arquivo-${i}.ts`, 'v1\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'carga');
  for (let i = 0; i < 700; i++) appendFileSync(join(dir, `apps/carga/arquivo-${i}.ts`), 'v2\n');
  for (let i = 0; i < 300; i++) escrever(dir, `apps/novos/n-${i}.ts`);
  const cmd = 'pnpm build';
  rodarHook(dir, 'PreToolUse', 'echo aquece', { agente: 'modulo-core' }); // aquece cache do git/disco
  const pre = rodarHook(dir, 'PreToolUse', cmd, { agente: 'modulo-core' });
  const pos = rodarHook(dir, 'PostToolUse', cmd, { agente: 'modulo-core', id: pre.id });
  assert.equal(pre.codigo, 0);
  assert.equal(pos.codigo, 0, pos.erro);
  assert.ok(pre.ms < 1000, `PreToolUse levou ${pre.ms.toFixed(0)} ms`);
  assert.ok(pos.ms < 1000, `PostToolUse levou ${pos.ms.toFixed(0)} ms`);
  const bloq = rodarHook(dir, 'PreToolUse', 'git checkout .', { agente: 'modulo-core' });
  assert.equal(bloq.codigo, 2);
  assert.ok(bloq.ms < 1000, `PreToolUse (git checkout .) levou ${bloq.ms.toFixed(0)} ms`);
  assert.match(bloq.erro, /e mais \d+ arquivo/);
});

test('settings.json registra o guardião do Bash no PreToolUse e no PostToolUse', () => {
  const s = JSON.parse(readFileSync(join(RAIZ_REAL, '.claude', 'settings.json'), 'utf8'));
  const comando = (ev) => (s.hooks[ev] || []).filter((h) => h.matcher === 'Bash').flatMap((h) => h.hooks.map((x) => x.command));
  assert.deepEqual(comando('PreToolUse'), ['node .claude/hooks/guarda-bash.mjs']);
  assert.deepEqual(comando('PostToolUse'), ['node .claude/hooks/guarda-bash.mjs']);
  assert.deepEqual(comando('PostToolUseFailure'), ['node .claude/hooks/guarda-bash.mjs']);
  assert.ok(existsSync(join(AQUI, 'guarda-bash.mjs')));
  assert.ok(readdirSync(AQUI).includes('guarda-donos.mjs'), 'o guardião de Edit/Write continua');
});
