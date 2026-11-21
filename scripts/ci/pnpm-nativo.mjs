#!/usr/bin/env node
// Binário nativo do pnpm nas sessões da nuvem (dono: engenheiro-software).
// Uso: na sessão da nuvem o pnpm do `packageManager` vem sem o binário nativo e o turbo dá "Exec format error";
// o `postinstall` da raiz conserta. Com o node_modules em dia (o pnpm pula o postinstall), rode à mão:
//   node scripts/ci/pnpm-nativo.mjs [--estrito]
//
// Causa: o pnpm 11+ publica os bins `pnpm`, `pn`, `pnpx` e `pnx` como textos-placeholder, que o `install.js` troca
// pelo binário de `@pnpm/exe.<plataforma>`; baixado para `~/.local/share/pnpm/.tools/pnpm/<versão>` sem esse script,
// o `pnpm` do PATH fica placeholder, e o turbo, que o executa direto (sem o Node), falha no lint, typecheck e testes.
// O script roda o `install.js` de cada cópia com placeholder (sem rede). Idempotente; nunca falha a instalação: o que
// não arruma vira aviso e saída 0 (--estrito sai 1). O postinstall ignora a falta deste arquivo (imagens Docker).
// Variáveis: PNPM_HOME e XDG_DATA_HOME (onde procurar o .tools), MACUXI_PNPM_TOOLS (pasta .tools/pnpm, para testes).
import { closeSync, existsSync, openSync, readSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BINS = ['pnpm', 'pn', 'pnpx', 'pnx'];
const MARCA_PLACEHOLDER = '# pnpm';

/** Pastas `.tools/pnpm` candidatas, sem repetição. */
export function pastasTools(env = process.env) {
  if (env.MACUXI_PNPM_TOOLS) return [env.MACUXI_PNPM_TOOLS];
  const dados = env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  const pastas = [
    env.PNPM_HOME && join(env.PNPM_HOME, '.tools', 'pnpm'),
    join(dados, 'pnpm', '.tools', 'pnpm'),
  ];
  return [...new Set(pastas.filter(Boolean))];
}

/** O arquivo é o placeholder em texto (e não o binário nativo)? */
export function ehPlaceholder(arquivo) {
  let fd;
  try {
    fd = openSync(arquivo, 'r');
    const buf = Buffer.alloc(MARCA_PLACEHOLDER.length);
    const lidos = readSync(fd, buf, 0, buf.length, 0);
    return buf.toString('latin1', 0, lidos) === MARCA_PLACEHOLDER;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Pastas `node_modules/pnpm` (resolvidas, sem repetição) com algum bin placeholder e o install.js ao lado. */
export function copiasComPlaceholder(pastas) {
  const achadas = new Set();
  for (const raiz of pastas) {
    if (!existsSync(raiz)) continue;
    for (const versao of readdirSync(raiz)) {
      const pacote = join(raiz, versao, 'node_modules', 'pnpm');
      if (!existsSync(join(pacote, 'install.js'))) continue;
      const real = realpathSync(pacote);
      if (BINS.some((b) => ehPlaceholder(join(real, b)))) achadas.add(real);
    }
  }
  return [...achadas];
}

/** Roda o install.js da cópia, fora do ciclo do npm (com npm_lifecycle_event=postinstall ele faria outra coisa). */
export function instalarNativo(pacote, env = process.env) {
  const limpo = { ...env };
  delete limpo.npm_lifecycle_event;
  const r = spawnSync(process.execPath, ['install.js'], { cwd: pacote, env: limpo, encoding: 'utf8' });
  const ok = r.status === 0 && !BINS.some((b) => ehPlaceholder(join(pacote, b)));
  return { ok, saida: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

export function principal(argv = process.argv.slice(2), env = process.env) {
  const estrito = argv.includes('--estrito');
  if (process.platform === 'win32') return 0; // no Windows o pnpm usa .exe e shims do npm; não há o placeholder aqui
  let falhas = 0;
  for (const pacote of copiasComPlaceholder(pastasTools(env))) {
    const { ok, saida } = instalarNativo(pacote, env);
    if (ok) {
      console.log(`[pnpm-nativo] binário nativo instalado em ${pacote}`);
    } else {
      falhas += 1;
      console.warn(
        `[pnpm-nativo] AVISO: não consegui instalar o binário nativo em ${pacote}${saida ? `: ${saida}` : ''}`,
      );
    }
  }
  return estrito && falhas > 0 ? 1 : 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = principal();
}
