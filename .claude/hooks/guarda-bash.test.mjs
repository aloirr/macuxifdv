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
  separarAcusacoes, mensagemAviso, comoDesfazer, ehAlvoEvidente, arquivosDoPatch, ambienteReal, arquivoFoto,
  TEXTO_AVISO,
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
    { padrao: 'docs/banco/**', dono: 'banco-dados' },
    { padrao: 'docs/modulos/promotor/**', dono: 'modulo-promotor' },
    { padrao: 'docs/**', dono: 'gerente-projetos' },
    { padrao: 'modules/core/**', dono: 'modulo-core' },
    { padrao: 'modules/catalogo/**', dono: 'modulo-catalogo' },
    { padrao: 'modules/pesquisa/**', dono: 'modulo-pesquisa' },
    { padrao: 'modules/promotor/**', dono: 'modulo-promotor' },
    { padrao: 'apps/**', dono: 'engenheiro-software' },
    { padrao: '*', dono: 'engenheiro-software' },
  ],
  somente_leitura: ['C:/Users/domon/dev/fase-m-exemplo'],
};
const REGRAS = DONOS.regras.map((r) => ({ ...r, re: globParaRegex(r.padrao) }));

// ───────────────────────── Parte 1: analisador com disco simulado ─────────────────────────

/**
 * Disco/git simulados. `arquivos`: rastreados existentes; `pastas`; `sujos`: [{xy, rel}].
 * Caminhos relativos à raiz.
 */
function ambiente({ raiz = '/repo', arquivos = [], pastas = [], sujos = [], conteudos = {} } = {}) {
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
    ler: (abs) => conteudos[abs] ?? conteudos[relDe(abs)] ?? null,
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

function analisar(comando, { agente = 'modulo-core', cwd = '/repo', raiz = '/repo', sujos = [], arquivos = ARQUIVOS, permitidos, conteudos } = {}) {
  return analisarComando({
    comando, agente, cwd, raiz, regras: REGRAS, somenteLeitura: DONOS.somente_leitura, permitidos,
    amb: ambiente({ raiz, arquivos, sujos, conteudos }),
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
  assert.match(bloqueia('echo x > "C:\\Users\\domon\\dev\\fase-m-exemplo\\planilha teste.xlsx"', win)[0].motivo, /somente leitura/);
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
function criarRepo({ comHook = false, extras = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'guarda-bash-'));
  temporarios.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Teste');
  git(dir, 'config', 'user.email', 'teste@exemplo.invalid');
  git(dir, 'config', 'commit.gpgsign', 'false');
  escrever(dir, '.coord/donos.json', JSON.stringify(DONOS, null, 2));
  escrever(dir, '.coord/recados/testes/R-20261031-000000-modulo-core.md', '---\nde: modulo-core\n---\n');
  for (const f of ['modules/core/a.ts', 'modules/catalogo/b.ts', 'apps/api/x.ts', 'docs/produto/01.md', 'docs/meu doc.md', ...extras]) escrever(dir, f);
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
  // Sem herdar a identificação da sessão que roda os testes (guardião v3: MACUXI_AGENTE, nuvem).
  const base = { ...process.env };
  delete base.MACUXI_AGENTE;
  delete base.CLAUDE_CODE_REMOTE;
  const r = spawnSync(process.execPath, args, { cwd: dir, input: JSON.stringify(entrada), encoding: 'utf8', env: { ...base, MACUXI_GUARDA: '', ...env } });
  return { codigo: r.status, erro: r.stderr, saida: r.stdout, ms: performance.now() - t0, id: entrada.tool_use_id, entrada };
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

/** Contexto adicional devolvido pelo PostToolUse que não bloqueia (stdout JSON, exit 0). */
function contexto(r) {
  if (!r.saida.trim()) return '';
  return JSON.parse(r.saida).hookSpecificOutput.additionalContext;
}
const SUGERE_DESFAZER = /git restore|git checkout|rm -- /;

// Atualizado na T-0005 (guardião v2): o script (node -e) que escreve em caminho alheio NÃO é alvo
// evidente; com agentes em paralelo não dá para saber se foi ele ou outro agente. Antes bloqueava
// e mandava "git restore"; agora é aviso não bloqueante e o desfazer não é liberado.
test('hook: Pre + Post de ponta a ponta (escrita alheia que não é alvo evidente vira aviso, sem mandar desfazer)', () => {
  const dir = criarRepo({ comHook: true });
  appendFileSync(join(dir, 'apps/api/x.ts'), 'engenheiro trabalhando\n'); // outro agente
  const cmd = `node -e "require('fs').appendFileSync('docs/meu doc.md','x')" && echo ok >> modules/core/a.ts`;
  const pre = rodarHook(dir, 'PreToolUse', cmd, { agente: 'modulo-core' });
  assert.equal(pre.codigo, 0, pre.erro);
  rodarBash(dir, cmd);
  const pos = rodarHook(dir, 'PostToolUse', cmd, { agente: 'modulo-core', id: pre.id });
  assert.equal(pos.codigo, 0, pos.erro);
  const aviso = contexto(pos);
  assert.match(aviso, /AVISO \(não bloqueia\)/);
  assert.match(aviso, /docs\/meu doc\.md \(alterado; dono: gerente-projetos\) → mudou durante o comando, provavelmente outro agente; não desfaça/);
  assert.doesNotMatch(aviso, SUGERE_DESFAZER);
  assert.ok(!aviso.includes('apps/api/x.ts'));
  assert.ok(!aviso.includes('modules/core/a.ts'));
  // aviso não libera desfazer: o restore do arquivo alheio continua bloqueado no PreToolUse
  assert.equal(rodarHook(dir, 'PreToolUse', 'git restore -- "docs/meu doc.md"', { agente: 'modulo-core' }).codigo, 2);
});

test('hook: alvo evidente alterado em caminho alheio continua bloqueado (Pre e, se escapar, Post) e o desfazer é liberado', () => {
  const dir = criarRepo({ comHook: true });
  const cmd = 'echo x >> "docs/meu doc.md"';
  assert.equal(rodarHook(dir, 'PreToolUse', cmd, { agente: 'modulo-core' }).codigo, 2, 'PreToolUse bloqueia a escrita evidente');
  // Se a escrita escapar do PreToolUse (ex.: hook desligado por um instante), a foto com os alvos
  // evidentes que o analisador extraiu faz o PostToolUse bloquear e indicar o desfazer.
  const amb = ambienteReal(dir);
  const { alvos } = analisarComando({ comando: cmd, agente: 'modulo-core', cwd: dir, raiz: dir, regras: REGRAS, amb });
  assert.deepEqual(alvos, [{ rel: 'docs/meu doc.md', sub: false }]);
  const entrada = { session_id: 's-teste', tool_use_id: `toolu_escapou_${++seq}` };
  mkdirSync(dirname(arquivoFoto(entrada)), { recursive: true });
  writeFileSync(arquivoFoto(entrada), JSON.stringify({ agente: 'modulo-core', estado: fotografar(dir, lerStatus(dir)), alvos, instala: false }));
  rodarBash(dir, cmd);
  const pos = rodarHook(dir, 'PostToolUse', cmd, { agente: 'modulo-core', id: entrada.tool_use_id });
  assert.equal(pos.codigo, 2);
  assert.match(pos.erro, /docs\/meu doc\.md \(alterado; dono: gerente-projetos\) → desfaça com: git restore -- "docs\/meu doc\.md"/);
  // o desfazer indicado é liberado pelo PreToolUse e, depois dele, nada mais é acusado
  const undo = 'git restore -- "docs/meu doc.md"';
  const pre2 = rodarHook(dir, 'PreToolUse', undo, { agente: 'modulo-core' });
  assert.equal(pre2.codigo, 0, pre2.erro);
  rodarBash(dir, undo);
  const pos2 = rodarHook(dir, 'PostToolUse', undo, { agente: 'modulo-core', id: pre2.id });
  assert.equal(pos2.codigo, 0, pos2.erro);
  assert.equal(pos2.saida.trim(), '');
  // ...e, já desfeito, o mesmo comando volta a ser bloqueado para o arquivo do outro dono
  appendFileSync(join(dir, 'docs/meu doc.md'), 'gerente\n');
  assert.equal(rodarHook(dir, 'PreToolUse', undo, { agente: 'modulo-core' }).codigo, 2);
});

// Atualizado na T-0005: "pnpm qualquer-coisa" não tem alvo evidente → aviso (exit 0), não bloqueio.
test('hook: PostToolUseFailure também confere (aviso não bloqueante); Post sem foto (comando só de leitura) sai 0', () => {
  const dir = criarRepo({ comHook: true });
  const cmd = 'pnpm qualquer-coisa';
  const pre = rodarHook(dir, 'PreToolUse', cmd, { agente: 'modulo-catalogo' });
  assert.equal(pre.codigo, 0);
  assert.ok(existsSync(arquivoFoto(pre.entrada)), 'comando que pode escrever tira foto');
  escrever(dir, 'modules/core/invasao.ts');
  const pos = rodarHook(dir, 'PostToolUseFailure', cmd, { agente: 'modulo-catalogo', id: pre.id });
  assert.equal(pos.codigo, 0, pos.erro);
  assert.equal(JSON.parse(pos.saida).hookSpecificOutput.hookEventName, 'PostToolUseFailure');
  assert.match(contexto(pos), /modules\/core\/invasao\.ts \(criado; dono: modulo-core\) → mudou durante o comando/);
  assert.doesNotMatch(contexto(pos), SUGERE_DESFAZER);
  const ler = rodarHook(dir, 'PreToolUse', 'git status', { agente: 'modulo-catalogo' });
  assert.equal(rodarHook(dir, 'PostToolUse', 'git status', { agente: 'modulo-catalogo', id: ler.id }).codigo, 0);
});

test('desempenho: Pre e Post abaixo de 2,5 s com ~1.000 arquivos alterados (folga para máquina carregada; o normal é < 1 s)', () => {
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
  assert.ok(pre.ms < 2500, `PreToolUse levou ${pre.ms.toFixed(0)} ms`);
  assert.ok(pos.ms < 2500, `PostToolUse levou ${pos.ms.toFixed(0)} ms`);
  const bloq = rodarHook(dir, 'PreToolUse', 'git checkout .', { agente: 'modulo-core' });
  assert.equal(bloq.codigo, 2);
  assert.ok(bloq.ms < 2500, `PreToolUse (git checkout .) levou ${bloq.ms.toFixed(0)} ms`);
  assert.match(bloq.erro, /e mais \d+ arquivo/);
});

// Atualizado na T-0005: o PreToolUse é obrigatório; o PostToolUse/PostToolUseFailure pode estar
// desligado (o Alexandre desliga localmente até o merge do guardião v2), mas, se estiver ligado,
// tem de apontar para o mesmo hook.
test('settings.json registra o guardião do Bash no PreToolUse (e no PostToolUse, quando ligado)', () => {
  const s = JSON.parse(readFileSync(join(RAIZ_REAL, '.claude', 'settings.json'), 'utf8'));
  const comando = (ev) => (s.hooks[ev] || []).filter((h) => h.matcher === 'Bash').flatMap((h) => h.hooks.map((x) => x.command));
  assert.deepEqual(comando('PreToolUse'), ['node .claude/hooks/guarda-bash.mjs']);
  for (const ev of ['PostToolUse', 'PostToolUseFailure']) {
    const lista = comando(ev);
    assert.ok(lista.length === 0 || (lista.length === 1 && lista[0] === 'node .claude/hooks/guarda-bash.mjs'), `${ev}: ${lista}`);
  }
  assert.ok(existsSync(join(AQUI, 'guarda-bash.mjs')));
  assert.ok(readdirSync(AQUI).includes('guarda-donos.mjs'), 'o guardião de Edit/Write continua');
});

// ───────────────────────── Parte 4: guardião v2 (T-0005) ─────────────────────────

test('T-0005: comandos só de leitura não tiram foto (coord de leitura, pnpm/npm view, git, ls, cat, grep, rg...)', () => {
  for (const cmd of [
    'node scripts/coord.mjs caixa engenheiro-software; ls',
    'node scripts/coord.mjs ler R-20261031-000000-modulo-core',
    'node scripts/coord.mjs fio R-20261031-000000-modulo-core',
    'node ./scripts/coord.mjs dono apps/api/x.ts',
    'node scripts/coord.mjs pendencias',
    'node scripts/coord.mjs verificar modulo-core --base origin/main',
    'pnpm view expo-image-picker dist-tags', 'npm view react version', 'pnpm why zod', 'pnpm --version',
    'git status', 'git log --oneline -5', 'git diff --stat', 'git show HEAD:apps/api/x.ts', 'git stash list',
    'ls -la apps', 'cat docs/produto/01.md', 'grep -rn foo modules', 'rg -n "x" apps', 'find apps -name "*.ts"',
    'sort apps/api/x.ts | uniq -c', 'tar -tzf /tmp/pacote.tgz', 'unzip -l /tmp/pacote.zip',
    'git apply --check /tmp/x.patch', 'node --version',
  ]) assert.equal(libera(cmd).soLeitura, true, cmd);
  for (const cmd of [
    'node scripts/coord.mjs enviar --de modulo-core --para testes --tipo aviso --assunto a --corpo b',
    'node scripts/coord.mjs lido modulo-core R-1', 'node scripts/gerar.mjs', 'pnpm install', 'pnpm test', 'npx tsc',
    'find apps -name "*.tmp" -delete', 'sort -o /tmp/y apps/api/x.ts', 'pnpm view zod > modules/core/versao.txt',
  ]) assert.equal(analisar(cmd).soLeitura, false, cmd);
});

const PATCH = 'diff --git a/apps/api/x.ts b/apps/api/x.ts\n--- a/apps/api/x.ts\n+++ b/apps/api/x.ts\n@@ -1 +1 @@\n-a\n+b\n';
const CONTEUDOS = {
  '/tmp/x.patch': PATCH,
  '/tmp/meu.patch': PATCH.replaceAll('apps/api/x.ts', 'modules/core/a.ts'),
  'mbox.patch': `From abc Mon Sep 17 00:00:00 2001\nSubject: [PATCH] x\n\n---\n ${'apps/api/x.ts'} | 2 +-\n\n${PATCH}`,
};

test('T-0005: escritas evidentes novas são bloqueadas antes (ln, chmod/chown, dd, curl, wget, tar, unzip, patch, git apply/am, rsync)', () => {
  const conteudos = CONTEUDOS;
  bloqueia('ln -s ../core/a.ts modules/catalogo/link.ts');
  assert.deepEqual(bloqueia('ln -sf modules/core/a.ts -t docs').map((v) => v.rel), ['docs/a.ts']);
  bloqueia('chmod +x apps/api/x.ts');
  bloqueia('chmod -x apps/api/x.ts'); // "-x" é modo, não opção
  assert.deepEqual(bloqueia('chmod -R 755 apps').map((v) => v.rel), ['apps/api/x.ts']);
  bloqueia('chown -R eu:eu docs/produto');
  bloqueia('chgrp eu docs/produto/01.md');
  bloqueia('dd if=/dev/zero of=apps/api/x.ts bs=1 count=0');
  bloqueia('curl -sSL https://exemplo.invalid/a -o apps/api/x.ts');
  bloqueia('curl --output docs/a.html https://exemplo.invalid');
  bloqueia('curl -sSLo docs/b.html https://exemplo.invalid');
  bloqueia('wget -q -O docs/a.html https://exemplo.invalid');
  bloqueia('wget --output-document=apps/api/x.ts https://exemplo.invalid');
  assert.deepEqual(bloqueia('tar -xzf /tmp/pacote.tgz -C apps/api').map((v) => v.rel), ['apps/api/x.ts']);
  bloqueia('tar xzf /tmp/pacote.tgz -C modules/catalogo'); // forma antiga, sem "-"
  bloqueia('tar -czf docs/pacote.tgz modules/core');
  bloqueia('unzip -o /tmp/pacote.zip -d docs/produto');
  assert.deepEqual(bloqueia('patch -p1 < /tmp/x.patch', { conteudos }).map((v) => v.rel), ['apps/api/x.ts']);
  bloqueia('patch -p1 -i /tmp/x.patch', { conteudos });
  bloqueia('patch apps/api/x.ts /tmp/x.patch');
  assert.deepEqual(bloqueia('patch -o docs/saida.md modules/core/a.ts /tmp/x.patch').map((v) => v.rel), ['docs/saida.md']);
  assert.deepEqual(bloqueia('git apply /tmp/x.patch', { conteudos }).map((v) => v.rel), ['apps/api/x.ts']);
  bloqueia('git apply --index -p1 /tmp/x.patch', { conteudos });
  bloqueia('git am mbox.patch', { conteudos });
  assert.deepEqual(bloqueia('rsync -a modules/core/ apps/api/').map((v) => v.rel), ['apps/api/x.ts']);
  assert.deepEqual(bloqueia('rsync -av modules/core/a.ts docs/').map((v) => v.rel), ['docs/a.ts']);
  bloqueia('rsync -a --remove-source-files apps/api/x.ts /tmp/');
  // no próprio caminho, fora do repositório ou sem escrita: libera
  libera('ln -s a.ts modules/core/link.ts');
  libera('chmod +x modules/core/a.ts');
  libera('dd if=/dev/zero of=/tmp/x bs=1 count=1');
  libera('curl -sSL https://exemplo.invalid');
  libera('curl -o /tmp/a.html https://exemplo.invalid');
  libera('curl -o - https://exemplo.invalid');
  libera('wget -O - https://exemplo.invalid');
  libera('tar -xzf /tmp/p.tgz -C modules/core');
  libera('unzip /tmp/p.zip -d /tmp/saida');
  libera('patch -p1 < /tmp/meu.patch', { conteudos });
  libera('git apply /tmp/meu.patch', { conteudos });
  libera('git apply --cached /tmp/x.patch', { conteudos });
  libera('patch -p1 --dry-run < /tmp/x.patch', { conteudos });
  libera('patch -p1 < /tmp/nao-existe.patch', { conteudos }); // patch ilegível: em dúvida, o PostToolUse confere
  libera('rsync -a modules/core/ /tmp/copia/');
  libera('rsync -a apps/ servidor:/backup/');
  assert.deepEqual(arquivosDoPatch('--- /dev/null\n+++ b/novo/arq.ts\n', 1), ['novo/arq.ts']);
  assert.deepEqual(arquivosDoPatch('--- x/a.ts\t2026-01-01\n+++ y/a.ts\t2026-01-02\n', 0), ['x/a.ts', 'y/a.ts']);
});

test('T-0005: analisarComando devolve os alvos evidentes (arquivo exato ou pasta inteira) e o sinal de install', () => {
  assert.deepEqual(analisar('echo x > modules/core/a.ts && rm -rf modules/catalogo; touch "docs/meu doc.md"').alvos, [
    { rel: 'modules/core/a.ts', sub: false }, { rel: 'modules/catalogo', sub: true }, { rel: 'docs/meu doc.md', sub: false },
  ]);
  const sujos = [{ xy: ' M', rel: 'apps/api/x.ts' }, { xy: ' M', rel: 'modules/core/a.ts' }, { xy: '??', rel: 'docs/novo.md' }];
  // git checkout .: só os arquivos sujos de agora (não a árvore inteira, que outro agente pode estar editando)
  assert.deepEqual(analisar('git checkout .', { sujos }).alvos.map((a) => a.rel).sort(), ['apps/api/x.ts', 'modules/core/a.ts']);
  assert.deepEqual(analisar('pnpm test').alvos, []);
  assert.deepEqual(analisar('echo x > $ARQ').alvos, []);
  assert.deepEqual(analisar('echo x > /tmp/fora.txt').alvos, []);
  assert.equal(analisar('pnpm install').instala, true);
  assert.equal(analisar('pnpm --filter @macuxi/api add zod').instala, true);
  assert.equal(analisar('cd apps/api && npm i').instala, true);
  assert.equal(analisar('pnpm test').instala, false);
  assert.ok(ehAlvoEvidente('modules/catalogo/x/y.ts', [{ rel: 'modules/catalogo', sub: true }]));
  assert.ok(!ehAlvoEvidente('modules/catalogo2/y.ts', [{ rel: 'modules/catalogo', sub: true }]));
  assert.ok(!ehAlvoEvidente('modules/core/a.ts.bak', [{ rel: 'modules/core/a.ts', sub: false }]));
  assert.ok(!ehAlvoEvidente('apps/api/x.ts', undefined));
});

test('T-0005: separarAcusacoes — só alvo evidente limpo antes bloqueia; recado novo de outro remetente nunca vira rm', () => {
  const v = (caminho, status, antes, dono = 'outro') => ({ caminho, status, antes, dono, motivo: 'fora dos caminhos' });
  const recadoAlheio = '.coord/recados/testes/R-20261031-120000-testes.md';
  const recadoNovo = '.coord/recados/gerente-projetos/R-20261031-120001-banco-dados.md';
  const alvos = [{ rel: 'docs/produto/01.md', sub: false }, { rel: 'apps', sub: true }, { rel: recadoAlheio, sub: false }];
  const lista = [
    v('docs/produto/01.md', 'M', 'limpo'), // alvo evidente, limpo antes → bloqueia
    v('apps/novo.ts', 'A', 'limpo'), // dentro de pasta alvo → bloqueia
    v('apps/api/x.ts', 'M', 'sujo'), // alvo, mas já tinha trabalho de outro → aviso
    v('docs/outro.md', 'M', 'limpo'), // não é alvo → aviso
    v(recadoAlheio, 'A', 'limpo'), // alvo evidente, mas recado novo: nunca rm → aviso
    v(recadoNovo, 'A', 'limpo'),
  ];
  const { bloqueantes, avisos } = separarAcusacoes({ violacoes: lista, alvos });
  assert.deepEqual(caminhos(bloqueantes), ['apps/novo.ts', 'docs/produto/01.md']);
  assert.deepEqual(caminhos(avisos), [recadoAlheio, recadoNovo, 'apps/api/x.ts', 'docs/outro.md'].sort());
  assert.equal(comoDesfazer(v(recadoAlheio, 'A', 'limpo')), null);
  assert.equal(comoDesfazer(v(recadoNovo, 'A', 'limpo')), null);
  assert.equal(comoDesfazer(v('apps/novo.ts', 'A', 'limpo')), 'rm -- "apps/novo.ts"');
  const msg = mensagemAviso('modulo-core', avisos);
  assert.doesNotMatch(msg, SUGERE_DESFAZER);
  assert.equal(msg.split(TEXTO_AVISO).length - 1, avisos.length);
  assert.match(mensagemPos('modulo-core', bloqueantes), /git restore -- "docs\/produto\/01\.md"[\s\S]*rm -- "apps\/novo\.ts"/);
  assert.deepEqual(separarAcusacoes({ violacoes: lista }).bloqueantes, [], 'foto sem alvos (hook antigo): nada bloqueia');
});

test('T-0005: PostToolUse num repositório de verdade — alvo evidente alheio bloqueia; mudança paralela de outro agente vira aviso', () => {
  const dir = criarRepo();
  const cmd = 'echo invasao >> docs/produto/01.md && echo meu >> modules/core/a.ts';
  const { alvos, violacoes: pre } = analisarComando({ comando: cmd, agente: 'modulo-core', cwd: dir, raiz: dir, regras: REGRAS, amb: ambienteReal(dir) });
  assert.deepEqual(pre.map((x) => x.rel), ['docs/produto/01.md'], 'o PreToolUse já bloquearia');
  const antes = fotoAntes(dir);
  rodarBash(dir, cmd); // escapou do PreToolUse
  appendFileSync(join(dir, 'modules/catalogo/b.ts'), 'modulo-catalogo em paralelo\n'); // outro agente, durante
  const v = violacoesDasMudancas({ agente: 'modulo-core', mudancas: mudancasDepois(dir, antes), regras: REGRAS });
  const { bloqueantes, avisos } = separarAcusacoes({ violacoes: v, alvos });
  assert.deepEqual(caminhos(bloqueantes), ['docs/produto/01.md']);
  assert.deepEqual(caminhos(avisos), ['modules/catalogo/b.ts']);
  assert.deepEqual(atualizarAcusados({}, bloqueantes, lerStatus(dir)), { 'docs/produto/01.md': { status: 'M' } }, 'só o alvo evidente fica liberado para desfazer');
});

/**
 * Os 9 falsos positivos da revisão do engenheiro-software (R-20261031-135947-engenheiro-software):
 * o agente A (engenheiro-software) roda um comando que não toca os arquivos; o agente B altera ou
 * cria arquivos DURANTE o comando. Antes, A recebia "blocking error" mandando git restore/rm.
 */
const FALSOS_POSITIVOS = [
  { cmd: 'node scripts/coord.mjs caixa engenheiro-software; ls', leitura: true, altera: ['modules/pesquisa/domain/checkout.test.ts'] },
  { cmd: 'node scripts/coord.mjs caixa engenheiro-software; ls', leitura: true, altera: ['modules/pesquisa/domain/resultados.test.ts'] },
  { cmd: 'pnpm view expo-image-picker dist-tags', leitura: true, altera: ['modules/pesquisa/domain/parametros.test.ts'] },
  { cmd: 'npx tsc -p apps/api --noEmit', altera: ['docs/modulos/promotor/regras.md'] },
  { cmd: 'npx tsc -p apps/api --noEmit', altera: ['modules/promotor/domain/checklist.test.ts'] },
  { cmd: 'npx vitest run apps/api', altera: ['docs/banco/README.md', 'docs/banco/core.md', 'docs/banco/fixture-dois-tenants.md'] },
  { cmd: 'pnpm install', cria: ['.coord/recados/engenheiro-software/R-20261031-131000-banco-dados.md'] },
  { cmd: 'pnpm --filter @macuxi/api test', altera: ['.coord/tarefas/T-0010.md'] },
  { cmd: 'pnpm test', altera: ['modules/pesquisa/domain/checkout.ts'], cria: ['docs/banco/novo.md'] }, // comando longo
];

test('T-0005: os 9 falsos positivos da revisão — outro agente altera arquivo durante o comando: sem bloqueio e sem sugestão de desfazer', () => {
  const extras = [...new Set(FALSOS_POSITIVOS.flatMap((c) => c.altera || []))];
  const dir = criarRepo({ comHook: true, extras });
  FALSOS_POSITIVOS.forEach((caso, n) => {
    const nome = `caso ${n + 1} (${caso.cmd})`;
    const agente = 'engenheiro-software';
    const pre = rodarHook(dir, 'PreToolUse', caso.cmd, { agente });
    assert.equal(pre.codigo, 0, `${nome}: ${pre.erro}`);
    assert.equal(existsSync(arquivoFoto(pre.entrada)), !caso.leitura, `${nome}: comando só de leitura não tira foto`);
    // agente B, em paralelo, durante o comando de A
    for (const f of caso.altera || []) appendFileSync(join(dir, f), `outro agente, caso ${n + 1}\n`);
    for (const f of caso.cria || []) escrever(dir, f, '---\nde: banco-dados\n---\n');
    const pos = rodarHook(dir, 'PostToolUse', caso.cmd, { agente, id: pre.id });
    assert.equal(pos.codigo, 0, `${nome}: não bloqueia — ${pos.erro}`);
    assert.equal(pos.erro, '', nome);
    const aviso = contexto(pos);
    assert.doesNotMatch(aviso, SUGERE_DESFAZER, nome);
    if (caso.leitura) assert.equal(aviso, '', nome);
    else for (const f of [...(caso.altera || []), ...(caso.cria || [])]) assert.ok(aviso.includes(`${f} (`) && aviso.includes(TEXTO_AVISO), `${nome}: avisa ${f}`);
    // nada fica liberado para desfazer: restaurar/apagar o trabalho do colega continua bloqueado
    for (const f of caso.altera || []) assert.equal(rodarHook(dir, 'PreToolUse', `git restore -- "${f}"`, { agente }).codigo, 2, `${nome}: restore de ${f}`);
    for (const f of caso.cria || []) assert.equal(rodarHook(dir, 'PreToolUse', `rm -- "${f}"`, { agente }).codigo, 2, `${nome}: rm de ${f}`);
  });
});

test('T-0005: pnpm install que reescreve o pnpm-lock.yaml avisa (sem bloquear) quem não é o engenheiro-software', () => {
  const dir = criarRepo({ comHook: true, extras: ['pnpm-lock.yaml'] });
  const pre = rodarHook(dir, 'PreToolUse', 'pnpm install', { agente: 'modulo-core' });
  appendFileSync(join(dir, 'pnpm-lock.yaml'), 'novo: 1\n');
  const pos = rodarHook(dir, 'PostToolUse', 'pnpm install', { agente: 'modulo-core', id: pre.id });
  assert.equal(pos.codigo, 0, pos.erro);
  assert.match(contexto(pos), /pnpm-lock\.yaml \(alterado; dono: engenheiro-software\) → reescrito pelo install deste comando: não desfaça; faça commit dele só junto com o package.json de um pacote seu \(regra "o lock acompanha a dependência", conferida pelo verificar\); senão, avise o engenheiro-software/);
  assert.doesNotMatch(contexto(pos), SUGERE_DESFAZER);
  // comando que não instala e viu o lock mudar: aviso genérico (provavelmente outro agente)
  const pre2 = rodarHook(dir, 'PreToolUse', 'pnpm test', { agente: 'modulo-core' });
  appendFileSync(join(dir, 'pnpm-lock.yaml'), 'mais: 2\n');
  assert.match(contexto(rodarHook(dir, 'PostToolUse', 'pnpm test', { agente: 'modulo-core', id: pre2.id })), /pnpm-lock\.yaml \(alterado; dono: engenheiro-software\) → mudou durante o comando/);
  // o engenheiro-software (dono do lock) não recebe aviso
  const pre3 = rodarHook(dir, 'PreToolUse', 'pnpm install', { agente: 'engenheiro-software' });
  appendFileSync(join(dir, 'pnpm-lock.yaml'), 'dono: 3\n');
  const pos3 = rodarHook(dir, 'PostToolUse', 'pnpm install', { agente: 'engenheiro-software', id: pre3.id });
  assert.equal(pos3.codigo, 0);
  assert.equal(pos3.saida.trim(), '');
});
