#!/usr/bin/env node
// Guardião de donos para o Bash — hook PreToolUse e PostToolUse/PostToolUseFailure (matcher "Bash").
// Uso: node .claude/hooks/guarda-bash.mjs [nome-do-agente]
//  - agente: argumento (frontmatter do agente) ou "agent_type" no JSON do hook, como no guarda-donos.mjs.
//  - sessão sem agente (uso manual do Alexandre) → liberado. Desligar tudo: MACUXI_GUARDA=off.
//  - PreToolUse: bloqueia (exit 2) escrita evidente em caminho de outro dono e tira a foto do
//    git status (+ data/tamanho) para o PostToolUse.
//    A foto guarda também os ALVOS EVIDENTES do comando (os mesmos que o analisador extraiu).
//    Comando só de leitura (ls, cat, git status/log/diff, coord.mjs caixa/ler/fio/dono/pendencias/
//    verificar, pnpm/npm view...) não tira foto.
//  - PostToolUse: compara com a foto. Só bloqueia (exit 2, stderr) e só sugere desfazer o que for
//    alvo evidente do comando e estava limpo antes. Qualquer outra mudança fora dos caminhos do
//    agente (outro agente trabalhando em paralelo na mesma árvore) vira aviso NÃO bloqueante
//    (exit 0, additionalContext): "mudou durante o comando, provavelmente outro agente; não desfaça".
//    Não desfaz nada sozinho.
// Detalhes e casos: .claude/hooks/guarda-bash-lib.mjs e .claude/hooks/guarda-bash.test.mjs.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ, carregarDonos } from '../../scripts/coord-lib.mjs';
import {
  analisarComando, ambienteReal, mensagemPre, lerStatus, fotografar, compararFotos, statDe,
  violacoesDasMudancas, mensagemPos, mensagemAviso, separarAcusacoes, atualizarAcusados, descontarDesfeitos, permitidosDe,
  arquivoFoto, arquivoAcusados,
  lerJson, gravarJson, apagarArquivo, limparAntigos,
} from './guarda-bash-lib.mjs';

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

if ((process.env.MACUXI_GUARDA || '').toLowerCase() === 'off') process.exit(0);

const entrada = await lerEntrada();
const agente = process.argv[2] || entrada.agent_type || '';
if (!agente) process.exit(0); // sessão manual, sem agente
if (entrada.tool_name && entrada.tool_name !== 'Bash') process.exit(0);

const comando = String(entrada.tool_input?.command || '');
const evento = entrada.hook_event_name || 'PreToolUse';
let regras;
let somenteLeitura = [];
try {
  regras = carregarDonos(RAIZ);
  somenteLeitura = JSON.parse(readFileSync(join(RAIZ, '.coord', 'donos.json'), 'utf8')).somente_leitura || [];
} catch {
  process.exit(0); // donos.json ilegível: o guarda-donos/verificar acusam; aqui não trava o Bash
}

if (evento === 'PreToolUse') {
  const amb = ambienteReal(RAIZ);
  const acusados = lerJson(arquivoAcusados(entrada, agente), {});
  const { violacoes, soLeitura, alvos, instala } = analisarComando({
    comando, agente, cwd: entrada.cwd || process.cwd(), raiz: RAIZ, regras, somenteLeitura,
    permitidos: permitidosDe(acusados), amb,
  });
  if (violacoes.length) {
    process.stderr.write(mensagemPre(agente, violacoes) + '\n');
    process.exit(2);
  }
  if (!soLeitura) {
    const status = amb.status();
    // A data do próprio arquivo da foto é o "início" (mesmo relógio do sistema de arquivos).
    if (status) gravarJson(arquivoFoto(entrada), { agente, estado: fotografar(RAIZ, status), alvos, instala });
    limparAntigos();
  }
  process.exit(0);
}

if (evento === 'PostToolUse' || evento === 'PostToolUseFailure') {
  const arq = arquivoFoto(entrada);
  const foto = lerJson(arq, null);
  if (!foto) process.exit(0); // comando só de leitura ou sem foto: nada a comparar
  let inicio;
  try { inicio = statSync(arq).mtimeMs; } catch { process.exit(0); }
  apagarArquivo(arq);
  const status = lerStatus(RAIZ);
  if (!status) process.exit(0);
  const arqAcusados = arquivoAcusados(entrada, agente);
  const antes = lerJson(arqAcusados, {});
  const mudancas = descontarDesfeitos(
    compararFotos({ inicio, estado: foto.estado }, fotografar(RAIZ, status), (rel) => statDe(RAIZ, rel)),
    antes, status,
  );
  const violacoes = violacoesDasMudancas({ agente, mudancas, regras });
  // Foto sem "alvos" (versão antiga do hook): nada é evidente → tudo vira aviso.
  const { bloqueantes, avisos } = separarAcusacoes({ violacoes, alvos: foto.alvos || [] });
  const acusados = atualizarAcusados(antes, bloqueantes, status);
  if (Object.keys(acusados).length) gravarJson(arqAcusados, acusados);
  else if (Object.keys(antes).length) apagarArquivo(arqAcusados);
  const aviso = avisos.length ? mensagemAviso(agente, avisos, { instala: !!foto.instala }) : '';
  if (bloqueantes.length) {
    process.stderr.write(mensagemPos(agente, bloqueantes) + (aviso ? `\n${aviso}` : '') + '\n');
    process.exit(2);
  }
  if (aviso) {
    // Não bloqueante: o texto chega ao agente como contexto adicional (stdout JSON, exit 0).
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: evento, additionalContext: aviso } }) + '\n');
  }
}
process.exit(0);
