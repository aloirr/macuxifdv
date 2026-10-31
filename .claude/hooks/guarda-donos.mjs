#!/usr/bin/env node
// Guardião de donos — hook PreToolUse (Edit|Write|MultiEdit|NotebookEdit).
// Bloqueia (exit 2) quando um agente do time tenta alterar arquivo que não é dele.
// Uso: node .claude/hooks/guarda-donos.mjs [nome-do-agente]
//  - nome do agente vem do argumento (frontmatter do agente) ou de "agent_type" no JSON do hook.
//  - sessão sem agente (uso manual) → liberado. Desligar tudo: variável MACUXI_GUARDA=off.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENTES, RAIZ, caminhoRelativo, podeAlterar } from '../../scripts/coord-lib.mjs';

function lerEntrada() {
  return new Promise((ok) => {
    let txt = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (txt += d));
    process.stdin.on('end', () => {
      try { ok(JSON.parse(txt || '{}')); } catch { ok({}); }
    });
  });
}

const bloquear = (msg) => {
  process.stderr.write(`[guardião Macuxi] BLOQUEADO: ${msg}\n`);
  process.exit(2);
};

if ((process.env.MACUXI_GUARDA || '').toLowerCase() === 'off') process.exit(0);

const entrada = await lerEntrada();
const agente = process.argv[2] || entrada.agent_type || '';
const ferramenta = entrada.tool_name || '';
const ti = entrada.tool_input || {};
const alvo = ti.file_path || ti.notebook_path || ti.path;

if (!agente) process.exit(0); // sessão manual, sem agente
if (!alvo) process.exit(0);

const rel = caminhoRelativo(alvo, RAIZ);
if (rel === null) {
  // Fora do repositório: só bloqueia as pastas marcadas como somente leitura (ex.: Fase M).
  let somenteLeitura = [];
  try { somenteLeitura = JSON.parse(readFileSync(join(RAIZ, '.coord', 'donos.json'), 'utf8')).somente_leitura || []; } catch { /* donos.json ilegível: sem pastas somente leitura */ }
  const norm = (p) => p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
  const a = norm(alvo);
  const pasta = somenteLeitura.find((p) => a === norm(p) || a.startsWith(norm(p) + '/'));
  if (pasta) bloquear(`"${alvo}" está numa pasta somente leitura (${pasta}). Copie o que precisar para dentro do repositório.`);
  process.exit(0);
}

if (!AGENTES.includes(agente)) {
  bloquear(`o agente "${agente}" não faz parte do time; só os agentes de .claude/agents podem alterar o repositório.`);
}

const r = podeAlterar({ agente, ferramenta, rel });
if (!r.ok) bloquear(r.motivo);
process.exit(0);
