#!/usr/bin/env node
// Guardião v6 (T-0050) — merge de PR pela ferramenta MCP do GitHub (mcp__github__merge_pull_request e variações).
// Hook PreToolUse; matcher no .claude/settings.json: ferramentas MCP com "merge" no nome.
// Uso: node .claude/hooks/guarda-merge-mcp.mjs [nome-do-agente]
//  - identidade igual à do guarda-bash (agenteDaSessao em scripts/coord-lib.mjs);
//  - regras (guarda-merge-lib.mjs, conferirMergeMcp): só squash; SHA esperado de 40 caracteres conferido com o
//    head do PR; CI do PR e do main verdes; PR que toca CAMINHOS_DE_GOVERNANCA nunca pela nuvem e, localmente,
//    só o gerente-projetos com o recado do Alexandre "autorizo o merge do PR #N no commit <sha>";
//  - consulta pela API REST (gh api) com prazo; sem gh, sem rede ou resposta inválida → BLOQUEADO (exit 2);
//  - qualquer erro inesperado do próprio hook também bloqueia (exit 2): falha fechada. Ferramenta que não é
//    merge de PR passa (exit 0) sem consultar nada.
//  - desligar (uso manual do Alexandre): MACUXI_GUARDA=off, como nos outros guardiões.
// Testes: .claude/hooks/guarda-merge-mcp.test.mjs.

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
  const { RAIZ, agenteDaSessao } = await import('../../scripts/coord-lib.mjs');
  const { conferirMergeMcp, tipoFerramentaMerge, consultarPrRest, lerRecadosDoGerente } = await import('./guarda-merge-lib.mjs');
  if (!entrada) bloquear('[guardião Macuxi] BLOQUEADO (merge pelo MCP do GitHub): entrada do hook ilegível (falha fechada).');
  const ferramenta = String(entrada.tool_name || '');
  if ((entrada.hook_event_name || 'PreToolUse') !== 'PreToolUse' || !tipoFerramentaMerge(ferramenta)) process.exit(0);
  const { agente, origem } = agenteDaSessao({ argumento: process.argv[2], entrada });
  const r = conferirMergeMcp({
    ferramenta, entrada: entrada.tool_input || {}, agente, origem,
    subagente: Boolean(String(entrada.agent_id || '').trim()),
    nuvem: String(process.env.CLAUDE_CODE_REMOTE || '').trim().toLowerCase() === 'true',
    consultarPr: (pr) => consultarPrRest(pr), lerRecados: () => lerRecadosDoGerente(RAIZ),
  });
  if (!r.ok) bloquear(r.mensagem);
  process.exit(0);
} catch (e) {
  bloquear(`[guardião Macuxi] BLOQUEADO (merge pelo MCP do GitHub): erro no guardião (${String(e?.message || e).slice(0, 200)}); sem a conferência não há merge (falha fechada).`);
}
