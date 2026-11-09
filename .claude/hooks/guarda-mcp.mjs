#!/usr/bin/env node
// Guardião v7 (T-0122) — ferramentas MCP (mcp__*). Hook PreToolUse; matcher no .claude/settings.json: "mcp__.*".
// Uso: node .claude/hooks/guarda-mcp.mjs [nome-do-agente]
//  - identidade igual à dos outros guardiões (agenteDaSessao em scripts/coord-lib.mjs);
//  - regras e classes: .claude/hooks/guarda-mcp-lib.mjs (conferirFerramentaMcp). Em resumo: leitura passa; o merge fica
//    com o guarda-merge-mcp.mjs; gravar arquivo pelo MCP do GitHub segue os donos, nunca no main, com o trailer
//    "Agente:" do próprio agente, governança só pelo Alexandre; escrita do GitHub fora da lista aceita é bloqueada;
//    servidor de arquivos local segue o podeAlterar (como o guarda-donos, inclusive o clone de recados da ADR 0035);
//  - sem rede: não consulta o GitHub;
//  - leitura e ferramenta de outro servidor passam antes de qualquer coisa que possa falhar; nas demais, erro inesperado
//    do próprio hook ou entrada ilegível = BLOQUEADO (exit 2, falha fechada);
//  - desligar (uso manual do Alexandre): MACUXI_GUARDA=off, como nos outros guardiões.
// Testes: .claude/hooks/guarda-mcp.test.mjs.
import { readFileSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';

function lerEntrada() {
  return new Promise((ok) => {
    let txt = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (txt += d));
    process.stdin.on('end', () => {
      try { ok(JSON.parse(txt || '{}')); } catch { ok(null); }
    });
  });
}

const bloquear = (texto) => {
  process.stderr.write(`${texto}\n`);
  process.exit(2);
};

if ((process.env.MACUXI_GUARDA || '').toLowerCase() === 'off') process.exit(0);

try {
  const entrada = await lerEntrada();
  if (!entrada) bloquear('[guardião Macuxi] BLOQUEADO (ferramenta MCP): entrada do hook ilegível (falha fechada).');
  const ferramenta = String(entrada.tool_name || '');
  if ((entrada.hook_event_name || 'PreToolUse') !== 'PreToolUse' || !ferramenta.startsWith('mcp__')) process.exit(0);
  const { classificarFerramentaMcp, conferirFerramentaMcp } = await import('./guarda-mcp-lib.mjs');
  const classe = classificarFerramentaMcp(ferramenta, entrada.tool_input || {});
  if (!classe || classe === 'merge' || classe === 'leitura' || classe === 'outro') process.exit(0);
  const {
    RAIZ, agenteDaSessao, podeAlterar, caminhoRelativo, carregarDonos, juncoesDeRecados, relativoPorJuncao, MOTIVO_CLONE_DE_RECADOS,
  } = await import('../../scripts/coord-lib.mjs');
  const { agente, origem } = agenteDaSessao({ argumento: process.argv[2], entrada });
  const regras = carregarDonos(RAIZ); // donos.json ilegível = erro = bloqueado (falha fechada)
  let somenteLeitura = [];
  try { somenteLeitura = JSON.parse(readFileSync(join(RAIZ, '.coord', 'donos.json'), 'utf8')).somente_leitura || []; } catch { somenteLeitura = []; }
  const abs = (c) => (isAbsolute(c) ? c : resolve(String(entrada.cwd || RAIZ), c));
  let juncoes;
  const porJuncao = (c) => {
    juncoes ??= juncoesDeRecados(RAIZ);
    const j = relativoPorJuncao(abs(c), juncoes);
    return j?.clone ? { bloqueio: MOTIVO_CLONE_DE_RECADOS } : j?.rel ? { rel: j.rel } : null;
  };
  const r = conferirFerramentaMcp({
    ferramenta, entrada: entrada.tool_input || {}, agente, origem,
    subagente: Boolean(String(entrada.agent_id || '').trim()),
    podeAlterar: (p) => podeAlterar({ ...p, raiz: RAIZ, regras }),
    // relativo = a partir do cwd da sessão (como o Bash); absoluto fora do repositório → null
    caminhoRelativo: (c) => caminhoRelativo(abs(c), RAIZ),
    somenteLeitura, porJuncao,
  });
  if (!r.ok) bloquear(r.mensagem);
  process.exit(0);
} catch (e) {
  bloquear(`[guardião Macuxi] BLOQUEADO (ferramenta MCP): erro no guardião (${String(e?.message || e).slice(0, 200)}); sem a conferência a ferramenta não roda (falha fechada).`);
}
