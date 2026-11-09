// Testes dos scripts PowerShell dos recados (ADR 0035, T-0139): sincronizar-recados.ps1, corte.ps1, volta.ps1 e
// agendar-sincronizacao.ps1.
// Rodar (Windows, PowerShell 5.1): node --test scripts/recados/recados-ps.test.mjs
// Fora do Windows (CI do GitHub em Ubuntu) os testes são pulados: os scripts são do PC do dono do produto.
// Cada teste monta um "GitHub" local (repositório bare) e clones em pastas temporárias; nada toca C:\macuxifdv-recados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, appendFileSync, unlinkSync, lstatSync, readdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(AQUI, '..');
const SINCRONIZAR = join(SCRIPTS, 'sincronizar-recados.ps1');
const temPowershell = process.platform === 'win32' && spawnSync('powershell.exe', ['-NoProfile', '-Command', 'exit 0']).status === 0;
const pular = temPowershell ? false : 'só no Windows com PowerShell (scripts do PC do dono do produto)';

const temporarios = [];
process.on('exit', () => { for (const d of temporarios) { try { rmSync(d, { recursive: true, force: true }); } catch { /* junção já removida */ } } });

function tmp(prefixo) {
  const d = mkdtempSync(join(tmpdir(), prefixo));
  temporarios.push(d);
  return d;
}
function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function escrever(dir, rel, conteudo = `${rel}\n`) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), conteudo);
}
function configurar(dir) {
  git(dir, 'config', 'user.name', 'Teste');
  git(dir, 'config', 'user.email', 'teste@exemplo.invalid');
  git(dir, 'config', 'commit.gpgsign', 'false');
}
const ATRIBUTOS = '* text=auto eol=lf\nlidos/*.txt text eol=lf merge=union\n';
const recado = (id, de = 'modulo-core') => `---\nid: ${id}\nde: ${de}\npara: [testes]\ntipo: aviso\n---\n# ${id}\n`;

/** "GitHub" local (bare) com o primeiro commit do repositório de recados, e N clones prontos. */
function montar(nClones = 2) {
  const pai = tmp('recados-ps-');
  const remoto = join(pai, 'remoto.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remoto]);
  const semente = join(pai, 'semente');
  execFileSync('git', ['clone', '-q', remoto, semente], { stdio: 'ignore' });
  configurar(semente);
  git(semente, 'checkout', '-q', '-b', 'main');
  escrever(semente, '.gitattributes', ATRIBUTOS);
  escrever(semente, 'recados/testes/R-20261108-000000-modulo-core.md', recado('R-20261108-000000-modulo-core'));
  escrever(semente, 'lidos/testes.txt', 'R-0\n');
  git(semente, 'add', '-A');
  git(semente, 'commit', '-q', '-m', 'inicial');
  git(semente, 'push', '-q', 'origin', 'main');
  const clones = [];
  for (let i = 0; i < nClones; i++) {
    const c = join(pai, `clone${i}`);
    execFileSync('git', ['clone', '-q', remoto, c], { stdio: 'ignore' });
    configurar(c);
    clones.push(c);
  }
  return { pai, remoto, clones, log: join(pai, 'sync.log') };
}

const argsSync = (clone, log, extra = []) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SINCRONIZAR, '-Clone', clone, '-Log', log, '-Origem', 'teste', ...extra];
function sincronizar(clone, log, extra) {
  const r = spawnSync('powershell.exe', argsSync(clone, log, extra), { encoding: 'utf8', timeout: 120_000 });
  return { codigo: r.status, saida: `${r.stdout}${r.stderr}` };
}
function sincronizarAsync(clone, log) {
  return new Promise((ok) => {
    const p = spawn('powershell.exe', argsSync(clone, log), { stdio: ['ignore', 'pipe', 'pipe'] });
    let saida = '';
    p.stdout.on('data', (d) => (saida += d));
    p.stderr.on('data', (d) => (saida += d));
    p.on('close', (codigo) => ok({ codigo, saida }));
  });
}
const noRemoto = (remoto, caminho) => execFileSync('git', ['--git-dir', remoto, 'show', `main:${caminho}`], { encoding: 'utf8' });
const linhas = (t) => t.split('\n').filter(Boolean).sort();

test('sincronizar: sem clone (antes do corte) sai 0 sem fazer nada', { skip: pular }, () => {
  const pai = tmp('recados-ps-sem-');
  const r = sincronizar(join(pai, 'nao-existe'), join(pai, 'sync.log'));
  assert.equal(r.codigo, 0, r.saida);
  assert.match(r.saida, /clone ausente/);
  assert.equal(existsSync(join(pai, 'sync.log')), false, 'nada a registrar');
});

test('sincronizar: dois PCs/agentes marcando lidos e criando recados ao mesmo tempo, sem conflito (merge=union)', { skip: pular }, async () => {
  const { remoto, clones: [a, b], log } = montar(2);
  escrever(a, 'recados/gerente-projetos/R-20261108-100000-modulo-core.md', recado('R-20261108-100000-modulo-core'));
  appendFileSync(join(a, 'lidos', 'testes.txt'), 'R-A\n');
  escrever(b, 'recados/gerente-projetos/R-20261108-100001-testes.md', recado('R-20261108-100001-testes', 'testes'));
  appendFileSync(join(b, 'lidos', 'testes.txt'), 'R-B\n');
  const [ra, rb] = await Promise.all([sincronizarAsync(a, `${log}.a`), sincronizarAsync(b, `${log}.b`)]);
  assert.equal(ra.codigo, 0, ra.saida);
  assert.equal(rb.codigo, 0, rb.saida);
  for (const c of [a, b]) assert.equal(sincronizar(c, log).codigo, 0);
  assert.deepEqual(linhas(noRemoto(remoto, 'lidos/testes.txt')), ['R-0', 'R-A', 'R-B']);
  for (const c of [a, b]) {
    assert.deepEqual(linhas(readFileSync(join(c, 'lidos', 'testes.txt'), 'utf8')), ['R-0', 'R-A', 'R-B']);
    assert.ok(existsSync(join(c, 'recados/gerente-projetos/R-20261108-100000-modulo-core.md')));
    assert.ok(existsSync(join(c, 'recados/gerente-projetos/R-20261108-100001-testes.md')));
    assert.equal(git(c, 'status', '--porcelain').trim(), '');
  }
  assert.match(git(a, 'log', '--format=%s', '-5'), /^recados: sync \S+ \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{2}:\d{2}$/m);
});

test('sincronizar: nada a fazer não cria commit nem log', { skip: pular }, () => {
  const { clones: [a], log } = montar(1);
  const antes = git(a, 'rev-parse', 'HEAD');
  const r = sincronizar(a, log);
  assert.equal(r.codigo, 0, r.saida);
  assert.match(r.saida, /nada a enviar/);
  assert.equal(git(a, 'rev-parse', 'HEAD'), antes);
  assert.equal(existsSync(log), false);
});

test('sincronizar: conflito no rebase aborta, não apaga nada e registra no log (código 2)', { skip: pular }, () => {
  const { clones: [a, b], log } = montar(2);
  const mesmo = 'recados/testes/R-20261108-120000-modulo-core.md';
  escrever(a, mesmo, recado('R-20261108-120000-modulo-core') + 'versão A\n');
  escrever(b, mesmo, recado('R-20261108-120000-modulo-core') + 'versão B\n');
  assert.equal(sincronizar(a, log).codigo, 0);
  const r = sincronizar(b, log);
  assert.equal(r.codigo, 2, r.saida);
  assert.match(r.saida, /conflito no pull --rebase: rebase abortado, nada foi apagado/);
  assert.equal(existsSync(join(b, '.git', 'rebase-merge')) || existsSync(join(b, '.git', 'rebase-apply')), false);
  assert.match(readFileSync(join(b, mesmo), 'utf8'), /versão B/, 'o recado local continua no disco');
  assert.match(git(b, 'log', '-1', '--format=%s'), /^recados: sync/, 'o commit local continua');
  assert.match(readFileSync(log, 'utf8'), /\[teste\] conflito no pull --rebase/);
});

test('sincronizar: recado apagado no PC volta do git; recado alterado no PC não sobe (imutável) e fica no log', { skip: pular }, () => {
  const { remoto, clones: [a], log } = montar(1);
  const existente = 'recados/testes/R-20261108-000000-modulo-core.md';
  unlinkSync(join(a, existente));
  appendFileSync(join(a, 'lidos', 'testes.txt'), 'R-X\n');
  let r = sincronizar(a, log);
  assert.equal(r.codigo, 0, r.saida);
  assert.ok(existsSync(join(a, existente)), 'restaurado');
  assert.equal(noRemoto(remoto, existente), recado('R-20261108-000000-modulo-core'));
  appendFileSync(join(a, existente), 'editado\n');
  r = sincronizar(a, log);
  assert.equal(r.codigo, 0, r.saida);
  assert.equal(noRemoto(remoto, existente), recado('R-20261108-000000-modulo-core'), 'a edição não sobe');
  const texto = readFileSync(log, 'utf8');
  assert.match(texto, /restaurado\(s\) do git/);
  assert.match(texto, /AVISO: 1 recado\(s\) alterado\(s\) no PC nao sobem/);
});

test('sincronizar: trava de execução única (outra instância rodando = sai 0 na hora, "ocupado")', { skip: pular }, async () => {
  const { clones: [a], log } = montar(1);
  const hash = createHash('sha1').update(a.toLowerCase(), 'utf8').digest('hex').toUpperCase().slice(0, 12);
  const segura = spawn('powershell.exe', ['-NoProfile', '-Command',
    `$m = New-Object System.Threading.Mutex($false, 'Local\\MacuxiSincronizarRecados-${hash}'); [void]$m.WaitOne(); Write-Output pronto; Start-Sleep -Seconds 20; $m.ReleaseMutex()`,
  ], { stdio: ['ignore', 'pipe', 'ignore'] });
  await new Promise((ok) => segura.stdout.on('data', (d) => { if (String(d).includes('pronto')) ok(); }));
  try {
    const inicio = Date.now();
    const r = sincronizar(a, log);
    assert.equal(r.codigo, 0, r.saida);
    assert.match(r.saida, /ocupado/);
    assert.ok(Date.now() - inicio < 15_000, 'não espera a outra instância');
  } finally {
    segura.kill();
  }
});

test('sincronizar: sem rede para o remoto não trava (sai com 3 dentro do prazo)', { skip: pular }, () => {
  const { clones: [a], log } = montar(1);
  git(a, 'remote', 'set-url', 'origin', join(a, '..', 'nao-existe.git'));
  escrever(a, 'recados/testes/R-20261108-130000-modulo-core.md', recado('R-20261108-130000-modulo-core'));
  const r = sincronizar(a, log, ['-PrazoSegundos', '30']);
  assert.equal(r.codigo, 3, r.saida);
  assert.match(readFileSync(log, 'utf8'), /pull falhou/);
  assert.match(git(a, 'log', '-1', '--format=%s'), /^recados: sync/, 'o recado fica no commit local até a próxima sincronização');
});

// ───────────────────────── corte e volta ─────────────────────────

/** Repositório de código de mentira com .coord/recados e .coord/lidos rastreados, e os scripts dos recados. */
function codigoComRecados(pai) {
  const repo = join(pai, 'macuxifdv');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  configurar(repo);
  escrever(repo, '.gitignore', 'node_modules/\n');
  escrever(repo, '.coord/recados/testes/R-20261101-000000-modulo-core.md', recado('R-20261101-000000-modulo-core'));
  escrever(repo, '.coord/recados/gerente-projetos/R-20261101-000001-testes.md', recado('R-20261101-000001-testes', 'testes'));
  escrever(repo, '.coord/recados/anexos/figura.png', 'png\n');
  escrever(repo, '.coord/lidos/testes.txt', 'R-1\nR-2\n');
  escrever(repo, 'modules/core/a.ts');
  // modelo do repositório de recados: o corte publica só .gitattributes e README.md. O .github (a resposta pelo Telegram
  // aguarda a decisão do intervalo) não pode ir para o clone: sobraria fora do commit e travaria o passo 5.
  escrever(repo, 'docs/desenho/T-0139-repo-recados/.gitattributes', ATRIBUTOS);
  escrever(repo, 'docs/desenho/T-0139-repo-recados/README.md', '# modelo do README\n');
  escrever(repo, 'docs/desenho/T-0139-repo-recados/.github/workflows/telegram-recado.yml');
  escrever(repo, 'docs/desenho/T-0139-repo-recados/.github/scripts/telegram-recado.mjs');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'inicial');
  mkdirSync(join(repo, 'scripts', 'recados'), { recursive: true });
  for (const f of ['corte.ps1', 'volta.ps1', 'comum.ps1']) copyFileSync(join(AQUI, f), join(repo, 'scripts', 'recados', f));
  copyFileSync(SINCRONIZAR, join(repo, 'scripts', 'sincronizar-recados.ps1'));
  // recado ainda não commitado no momento do corte (escrito por um agente antes de parar): também migra
  escrever(repo, '.coord/recados/testes/R-20261108-090000-modulo-core.md', recado('R-20261108-090000-modulo-core'));
  return repo;
}
function rodarPs(script, args) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], { encoding: 'utf8', timeout: 180_000 });
  return { codigo: r.status, saida: `${r.stdout}${r.stderr}` };
}
const ehJuncao = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };

test('corte: simulação não muda nada; corte migra, cria as junções, tira do índice e é idempotente; volta desfaz', { skip: pular }, () => {
  const pai = tmp('recados-corte-');
  const remoto = join(pai, 'remoto.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remoto]);
  const repo = codigoComRecados(pai);
  const clone = join(pai, 'macuxifdv-recados');
  const backup = join(pai, 'backup');
  const corte = join(repo, 'scripts', 'recados', 'corte.ps1');
  // sem -Repo: a raiz sai da pasta do script (no PowerShell 5.1 com -File, $PSScriptRoot chega vazio no param())
  const base = ['-Remoto', remoto, '-Clone', clone, '-Backup', backup, '-IgnorarProcessos'];

  const sim = rodarPs(corte, [...base, '-Simular']);
  assert.equal(sim.codigo, 0, sim.saida);
  assert.match(sim.saida, /\[simulacao\] git clone/);
  assert.equal(existsSync(clone), false);
  assert.equal(ehJuncao(join(repo, '.coord', 'recados')), false);
  assert.equal(git(repo, 'status', '--porcelain', '--', '.gitignore').trim(), '');

  const r = rodarPs(corte, base);
  assert.equal(r.codigo, 0, r.saida);
  assert.match(r.saida, /Corte feito/);
  for (const p of ['recados', 'lidos']) assert.ok(ehJuncao(join(repo, '.coord', p)), `.coord/${p} é junção`);
  // no "GitHub": recados (inclusive o não commitado e o anexo), lidos e .gitattributes
  const noGit = execFileSync('git', ['--git-dir', remoto, 'ls-tree', '-r', '--name-only', 'main'], { encoding: 'utf8' }).split('\n').filter(Boolean).sort();
  assert.deepEqual(noGit, ['.gitattributes', 'README.md', 'lidos/testes.txt', 'recados/anexos/figura.png',
    'recados/gerente-projetos/R-20261101-000001-testes.md', 'recados/testes/R-20261101-000000-modulo-core.md', 'recados/testes/R-20261108-090000-modulo-core.md']);
  assert.match(noRemoto(remoto, '.gitattributes'), /^lidos\/\*\.txt .*merge=union$/m);
  assert.equal(noRemoto(remoto, 'README.md'), '# modelo do README\n', 'README vem do modelo');
  assert.equal(git(clone, 'status', '--porcelain', '--untracked-files=all').trim(), '', 'clone sem sobra fora do commit');
  assert.equal(existsSync(join(clone, '.github')), false, 'o .github do modelo não vai para o clone pelo corte');
  assert.match(execFileSync('git', ['--git-dir', remoto, 'log', '-1', '--format=%s', 'main'], { encoding: 'utf8' }), /^recados: migracao de macuxifdv@[0-9a-f]+ \(T-0139, ADR 0035\)/);
  // repositório de código: índice sem as pastas, marca no .gitignore, nada não rastreado, backup fora do repo
  assert.equal(git(repo, 'ls-files', '--', '.coord/recados', '.coord/lidos').trim(), '');
  assert.match(git(repo, 'diff', '--cached', '--name-status'), /^D\t\.coord\/recados\/testes\/R-20261101-000000-modulo-core\.md$/m);
  assert.match(readFileSync(join(repo, '.gitignore'), 'utf8'), /^\/\.coord\/recados$/m);
  assert.doesNotMatch(git(repo, 'status', '--porcelain', '--untracked-files=all'), /^\?\? \.coord/m);
  assert.ok(existsSync(join(backup, 'recados', 'testes', 'R-20261101-000000-modulo-core.md')));
  // a junção leva ao clone: ler e escrever por .coord/ cai em C:\...\macuxifdv-recados
  escrever(repo, '.coord/recados/testes/R-20261108-140000-modulo-core.md', recado('R-20261108-140000-modulo-core'));
  assert.ok(existsSync(join(clone, 'recados', 'testes', 'R-20261108-140000-modulo-core.md')));

  const de_novo = rodarPs(corte, base);
  assert.equal(de_novo.codigo, 0, de_novo.saida);
  assert.match(de_novo.saida, /corte ja foi feito/);

  // volta: pastas de verdade com tudo (inclusive o recado novo, que ainda nem tinha subido), marca fora do .gitignore
  const voltaSim = rodarPs(join(repo, 'scripts', 'recados', 'volta.ps1'), ['-Clone', clone, '-IgnorarProcessos', '-ManterAgendamento', '-SemSincronizar', '-Simular']);
  assert.equal(voltaSim.codigo, 0, voltaSim.saida);
  assert.match(voltaSim.saida, /\[simulacao\] remover a juncao/);
  for (const p of ['recados', 'lidos']) assert.ok(ehJuncao(join(repo, '.coord', p)), 'a volta simulada não muda nada');
  assert.doesNotMatch(git(repo, 'diff', '--cached', '--name-status', '--', '.coord/recados'), /^A\t/m);
  const volta = rodarPs(join(repo, 'scripts', 'recados', 'volta.ps1'), ['-Clone', clone, '-IgnorarProcessos', '-ManterAgendamento']);
  assert.equal(volta.codigo, 0, volta.saida);
  for (const p of ['recados', 'lidos']) assert.equal(ehJuncao(join(repo, '.coord', p)), false);
  assert.ok(existsSync(join(repo, '.coord', 'recados', 'testes', 'R-20261108-140000-modulo-core.md')));
  assert.ok(existsSync(join(clone, 'recados', 'testes', 'R-20261108-140000-modulo-core.md')), 'o clone fica intacto');
  assert.doesNotMatch(readFileSync(join(repo, '.gitignore'), 'utf8'), /\.coord\/recados/);
  assert.deepEqual(linhas(readFileSync(join(repo, '.coord', 'lidos', 'testes.txt'), 'utf8')), ['R-1', 'R-2']);
  assert.match(git(repo, 'diff', '--cached', '--name-status', '--', '.coord/recados'), /^A\t\.coord\/recados\/testes\/R-20261108-140000-modulo-core\.md$/m);
  const volta2 = rodarPs(join(repo, 'scripts', 'recados', 'volta.ps1'), ['-Clone', clone, '-Repo', repo, '-IgnorarProcessos', '-ManterAgendamento']);
  assert.equal(volta2.codigo, 0, volta2.saida);
  assert.match(volta2.saida, /nada a voltar/);
});

test('corte: recado com o mesmo nome e conteúdo diferente no clone para o corte antes de mover qualquer pasta', { skip: pular }, () => {
  const pai = tmp('recados-corte-conflito-');
  const remoto = join(pai, 'remoto.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remoto]);
  const repo = codigoComRecados(pai);
  const clone = join(pai, 'macuxifdv-recados');
  execFileSync('git', ['clone', '-q', remoto, clone], { stdio: 'ignore' });
  configurar(clone);
  escrever(clone, 'recados/testes/R-20261101-000000-modulo-core.md', 'outro conteúdo\n');
  const r = rodarPs(join(repo, 'scripts', 'recados', 'corte.ps1'), ['-Remoto', remoto, '-Clone', clone, '-Repo', repo, '-Backup', join(pai, 'b'), '-IgnorarProcessos']);
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /mesmo nome e conteudo diferente/);
  assert.equal(ehJuncao(join(repo, '.coord', 'recados')), false);
  assert.ok(readdirSync(join(repo, '.coord', 'recados')).length > 0);
  assert.equal(readFileSync(join(clone, 'recados/testes/R-20261101-000000-modulo-core.md'), 'utf8'), 'outro conteúdo\n');
});

// ───────────────────────── agendamento ─────────────────────────

const AGENDAR = join(AQUI, 'agendar-sincronizacao.ps1');

test('agendar: -Simular sem -Repo roda no PowerShell 5.1, mostra a ação e não cadastra nada', { skip: pular }, () => {
  const r = rodarPs(AGENDAR, ['-Simular']);
  assert.equal(r.codigo, 0, r.saida);
  assert.match(r.saida, /acao: conhost\.exe --headless powershell\.exe .*-File "[^"]+\\scripts\\sincronizar-recados\.ps1" -Origem agendador/);
  assert.match(r.saida, /\[simulacao\] cadastrar \\Macuxi\\Sincronizar recados a cada 2 min/);
});

/**
 * Variáveis usadas nos blocos passados a "Fazer" (comum.ps1) com o nome de um parâmetro dela: o bloco roda dentro da
 * função, então o parâmetro encobre a variável do script (sem diferença de maiúsculas). Foi o defeito do $acao no
 * agendar-sincronizacao.ps1 ("ScriptBlock no tipo CimInstance[]"), que o -Simular não pega porque não roda o bloco.
 */
function colisoesComFazer(arquivos) {
  const pai = tmp('recados-ast-');
  const analisador = join(pai, 'colisoes.ps1');
  writeFileSync(analisador, [
    'param([string]$Comum, [string]$Lista)',
    '$Arquivos = $Lista -split [regex]::Escape("|")',
    '$erros = $null; $tokens = $null',
    '$ast = [System.Management.Automation.Language.Parser]::ParseFile($Comum, [ref]$tokens, [ref]$erros)',
    '$fazer = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq "Fazer" }, $true)',
    '$params = @($fazer.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath.ToLowerInvariant() })',
    'if ($params.Count -lt 2) { Write-Output "ERRO: Fazer sem parametros em $Comum"; exit 1 }',
    'foreach ($f in $Arquivos) {',
    '  $a = [System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$tokens, [ref]$erros)',
    '  if ($erros) { Write-Output ("ERRO de sintaxe em {0}: {1}" -f $f, $erros[0].Message); continue }',
    '  $chamadas = $a.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq "Fazer" }, $true)',
    '  foreach ($c in $chamadas) {',
    '    foreach ($b in @($c.CommandElements | Where-Object { $_ -is [System.Management.Automation.Language.ScriptBlockExpressionAst] })) {',
    '      foreach ($v in $b.FindAll({ param($n) $n -is [System.Management.Automation.Language.VariableExpressionAst] }, $true)) {',
    '        if ($params -contains $v.VariablePath.UserPath.ToLowerInvariant()) { Write-Output ((Split-Path -Leaf $f) + ":" + $v.Extent.StartLineNumber + ": " + $v.Extent.Text) }',
    '      }',
    '    }',
    '  }',
    '}',
  ].join('\r\n'));
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', analisador, '-Comum', join(AQUI, 'comum.ps1'), '-Lista', arquivos.join('|')], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  return r.stdout.split(/\r?\n/).filter(Boolean);
}

test('agendar e demais scripts: nenhum bloco de "Fazer" usa variável com o nome de um parâmetro dela ($Descricao, $Acao)', { skip: pular }, () => {
  const scripts = [...readdirSync(AQUI).filter((f) => f.endsWith('.ps1')).map((f) => join(AQUI, f)), SINCRONIZAR];
  assert.deepEqual(colisoesComFazer(scripts), []);
  // controle: o analisador acusa o defeito original
  const ruim = join(tmp('recados-ast-ruim-'), 'ruim.ps1');
  writeFileSync(ruim, "$acao = 1\r\nFazer 'cadastrar' { Register-ScheduledTask -Action $acao }\r\n");
  assert.deepEqual(colisoesComFazer([ruim]), ['ruim.ps1:2: $acao']);
});

test('agendar: cadastro de verdade com nome de teste (repo de mentira) leva a ação certa ao Agendador; -Remover tira', { skip: pular }, () => {
  const pai = tmp('recados-agendar-');
  const repo = join(pai, 'macuxifdv');
  mkdirSync(join(repo, 'scripts', 'recados'), { recursive: true });
  for (const f of ['agendar-sincronizacao.ps1', 'comum.ps1']) copyFileSync(join(AQUI, f), join(repo, 'scripts', 'recados', f));
  escrever(repo, 'scripts/sincronizar-recados.ps1', 'exit 0\r\n'); // a tarefa de teste, se chegar a disparar, não faz nada
  const script = join(repo, 'scripts', 'recados', 'agendar-sincronizacao.ps1');
  const nome = `Teste T-0139 ${process.pid}`;
  const consultar = () => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `$t = Get-ScheduledTask -TaskPath '\\Macuxi\\' -TaskName '${nome}' -ErrorAction SilentlyContinue; if ($t) { $t.Actions[0].Execute + ' ' + $t.Actions[0].Arguments }`,
  ], { encoding: 'utf8' }).stdout.trim();
  try {
    const r = rodarPs(script, ['-Nome', nome]); // sem -Repo: a raiz sai da pasta do script
    assert.equal(r.codigo, 0, r.saida);
    assert.match(r.saida, /tarefa cadastrada/);
    const acao = consultar();
    assert.ok(acao.startsWith('conhost.exe --headless powershell.exe '), acao);
    assert.ok(acao.toLowerCase().includes(`-file "${join(repo, 'scripts', 'sincronizar-recados.ps1')}"`.toLowerCase()), acao);
    const rm = rodarPs(script, ['-Nome', nome, '-Remover']);
    assert.equal(rm.codigo, 0, rm.saida);
    assert.equal(consultar(), '');
  } finally {
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Unregister-ScheduledTask -TaskPath '\\Macuxi\\' -TaskName '${nome}' -Confirm:$false -ErrorAction SilentlyContinue`]);
  }
});
