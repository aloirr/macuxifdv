#!/usr/bin/env node
/**
 * Guardião ligado no CI e na nuvem (ADR 0045, item "guardião"). Sem dependência: node:child_process e node:fs.
 *
 * O guardião (.claude/hooks/*) desliga com a variável MACUXI_GUARDA=off, que existe para o uso manual do Alexandre no PC.
 * Com o time 100% na nuvem, nenhum ambiente automático pode desligá-lo. Este script falha (saída 1) quando:
 *   1. arquivo  — um arquivo de configuração de ambiente VERSIONADO atribui MACUXI_GUARDA = off, ou atribui por expressão
 *                 (${{ vars.X }}, $VAR), que pode virar off sem passar por revisão. Vale também para MACUXI_GH_SIMULADO, que
 *                 troca o gh da trava de merge por um script (só os testes dos hooks usam, no ambiente do processo filho).
 *                 Arquivos olhados (git ls-files): .github/**, settings*.json de .claude/ (e da cópia de instalação),
 *                 .devcontainer/**, .vscode/**, package.json, turbo.json, .npmrc, pnpm-workspace.yaml e scripts de shell
 *                 (*.sh, *.ps1, *.cmd, *.bat). Arquivos .env* ficam de fora: são segredos, ninguém os lê, e os hooks não os
 *                 carregam. Linha que é só comentário (# ou REM ou ::) não conta.
 *   2. ambiente — o próprio processo (o job "governança") roda com MACUXI_GUARDA=off ou com MACUXI_GH_SIMULADO definido
 *                 (variável de repositório, de organização ou env do workflow).
 *
 * Uso no CI (job governança):  node scripts/ci/guardiao-ligado.mjs
 * Saída: 0 = ok; 1 = violação (com ::error:: por ocorrência); 2 = erro de git (falha fechada).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VARIAVEIS = ['MACUXI_GUARDA', 'MACUXI_GH_SIMULADO'];

/** Arquivo versionado que configura ambiente (de CI, da sessão do Claude Code ou de shell). */
export function ehConfigDeAmbiente(caminho) {
  const c = String(caminho).replace(/\\/g, '/');
  const nome = c.split('/').pop();
  if (/^\.env(\.|$)/i.test(nome)) return false;
  if (c.startsWith('.github/')) return true;
  if (/(^|\/)\.?claude\/settings[^/]*\.json$/i.test(c)) return true;
  if (c.startsWith('.devcontainer/') || c.startsWith('.vscode/')) return true;
  if (['package.json', 'turbo.json', '.npmrc', 'pnpm-workspace.yaml'].includes(nome)) return true;
  return /\.(sh|bash|ps1|psm1|cmd|bat)$/i.test(nome);
}

/** Linha só de comentário (YAML/shell/PowerShell "#", batch "REM" e "::", JSON com "//"). */
const ehComentario = (linha) => /^\s*(#|\/\/|::|rem(\s|$))/i.test(linha);

/**
 * Ocorrências proibidas num texto (função pura).
 *  - MACUXI_GUARDA atribuída a "off" (qualquer caixa, com ou sem aspas): `MACUXI_GUARDA: off`, `"MACUXI_GUARDA": "off"`,
 *    `MACUXI_GUARDA=off`, `export MACUXI_GUARDA=OFF`, `$env:MACUXI_GUARDA = 'off'`, `set MACUXI_GUARDA=off`;
 *  - qualquer das VARIAVEIS atribuída por expressão (`${{ ... }}`, `$VAR`, `%VAR%`): o valor não é revisável;
 *  - MACUXI_GH_SIMULADO atribuída a qualquer valor não vazio.
 * MACUXI_GUARDA_CONEXAO (outra variável) não conta.
 * @returns {{linha: number, variavel: string, texto: string}[]}
 */
export function ocorrencias(texto) {
  const achados = [];
  const linhas = String(texto || '').split(/\r?\n/);
  linhas.forEach((l, i) => {
    if (ehComentario(l)) return;
    for (const v of VARIAVEIS) {
      const atrib = new RegExp(`${v}(?![A-Za-z0-9_])\\s*["']?\\s*[:=]\\s*["']?\\s*([^"'\\s,}]*)`, 'gi');
      for (const m of l.matchAll(atrib)) {
        const valor = m[1] || '';
        const expressao = /^(\$|%)/.test(valor);
        const proibido = v === 'MACUXI_GUARDA' ? /^off$/i.test(valor) || expressao : valor !== '' || expressao;
        if (proibido) achados.push({ linha: i + 1, variavel: v, texto: l.trim().slice(0, 160) });
      }
    }
  });
  return achados;
}

/** Violações do ambiente do processo (função pura). */
export function violacoesDoAmbiente(env) {
  const r = [];
  if (String(env.MACUXI_GUARDA || '').trim().toLowerCase() === 'off') r.push('MACUXI_GUARDA=off no ambiente do job');
  if (String(env.MACUXI_GH_SIMULADO || '').trim()) r.push('MACUXI_GH_SIMULADO definida no ambiente do job');
  return r;
}

/** Varre os arquivos versionados da raiz. @returns {{arquivo: string, linha: number, variavel: string, texto: string}[]} */
export function varrerRepositorio(raiz) {
  const arquivos = execFileSync('git', ['-c', 'core.quotePath=false', 'ls-files', '-z'], { cwd: raiz, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean)
    .filter(ehConfigDeAmbiente);
  const achados = [];
  for (const arquivo of arquivos) {
    let texto;
    try { texto = readFileSync(join(raiz, arquivo), 'utf8'); } catch { continue; } // apagado na árvore e ainda no índice
    for (const o of ocorrencias(texto)) achados.push({ arquivo, ...o });
  }
  return achados;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const raiz = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
  let codigo = 0;
  for (const v of violacoesDoAmbiente(process.env)) {
    console.log(`::error title=guardião desligado::${v}. Na nuvem e no CI o guardião não desliga (ADR 0045); tire a variável do workflow ou das variáveis do repositório.`);
    codigo = 1;
  }
  try {
    const achados = varrerRepositorio(raiz);
    console.log(`[guardião ligado] ${achados.length} atribuição(ões) proibida(s) de ${VARIAVEIS.join(' / ')} em configuração versionada.`);
    for (const a of achados) {
      console.log(`::error file=${a.arquivo},line=${a.linha},title=guardião desligado em configuração::${a.variavel} em ${a.arquivo}:${a.linha} (${a.texto}). Configuração versionada não desliga o guardião nem troca o gh da trava de merge (ADR 0045).`);
    }
    if (achados.length) codigo = 1;
  } catch (e) {
    console.log(`::error title=guardiao-ligado::git falhou (${String(e.message).split('\n')[0]}): falha fechada.`);
    codigo = 2;
  }
  process.exit(codigo);
}
