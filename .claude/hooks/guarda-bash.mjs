#!/usr/bin/env node
// Guardião de donos para o Bash — hook PreToolUse e PostToolUse/PostToolUseFailure (matcher "Bash").
// Uso: node .claude/hooks/guarda-bash.mjs [nome-do-agente]
//  - agente (guardião v4, T-0005), igual ao guarda-donos.mjs (identificarAgente em scripts/coord-lib.mjs):
//      1. subagente (agent_id no JSON do hook): o próprio subagente (argumento ou agent_type);
//         vence MACUXI_AGENTE, que vale só para a sessão principal;
//      2. variável MACUXI_AGENTE;
//      3. argumento (frontmatter do agente) ou "agent_type" numa sessão local (na nuvem,
//         CLAUDE_CODE_REMOTE=true, só agent_type diferente do "agent" do .claude/settings.json);
//      4. branch atual: <agente>/T-nnnn-..., agente/T-nnnn-<agente>; nuvem/* → trailer
//         "Agente: <nome>" com um único nome em todos os commits do branch (desde o main) que o têm;
//      5. fonte ausente, ambígua ou que declara alexandre → restrito (agent_type; sessão manual local
//         = liberada; na nuvem sem agente, o "agent" do settings.json).
//    "alexandre" só por MACUXI_AGENTE=alexandre ou sessão manual local (branch alexandre/* e trailer
//    "Agente: alexandre" não dão a identidade); altera arquivo de qualquer dono (sem-dono,
//    congelado e recados continuam valendo). O resultado do git rev-parse/log fica em cache por
//    HEAD num arquivo temporário (commitsDoBranch em scripts/coord-lib.mjs).
//  - sessão manual local (sem agente) → liberado. Desligar tudo: MACUXI_GUARDA=off.
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
//  - Guardião v5 (T-0044), PreToolUse, ANTES da liberação da sessão manual (vale para todas):
//      · trava do `gh pr merge` (também encadeado com ; && || |, em subshell e em $(...)): só o
//        gerente-projetos na sessão principal (subagente nunca; identidade por MACUXI_AGENTE ou
//        agent_type local), só `gh pr merge N -R aloirr/macuxifdv --squash --match-head-commit <sha>`
//        (+ --body/--subject), sem --admin/--auto/--merge/--rebase, sem prefixo nem $VAR; o hook
//        consulta `gh pr view N --json files,headRefOid,changedFiles` e exige head = SHA e, em PR
//        com caminho de governança, o recado do Alexandre "autorizo o merge do PR #N no commit <sha>"
//        em .coord/recados/gerente-projetos. gh sem resposta = bloqueado (falha fechada). Merge
//        escondido (bash -c, eval, xargs, node -e, gh api, alias) também é bloqueado.
//      · recado falso: agente não envia recado em nome de outro (coord.mjs enviar --de alheio,
//        "de: alexandre" no comando, script que escreve recado de alexandre).
//    Mensagens e casos: .claude/hooks/guarda-merge-lib.mjs e guarda-merge.test.mjs.
//  - Guardião v6 (T-0050): o bloqueio "recado em nome do Alexandre" vale SÓ para comando que cria, altera,
//    move ou apaga arquivo de recado (> >> tee cp mv rm sed -i, node/python que grava, coord.mjs enviar
//    --de alexandre...). Leitura (ls, cat, grep, find, head, git show/ls-tree/fetch, for que só lê) passa,
//    mesmo citando alexandre e .coord/recados. Casos: guarda-recado.test.mjs. O merge pela ferramenta MCP
//    do GitHub tem hook próprio: .claude/hooks/guarda-merge-mcp.mjs (casos: guarda-merge-mcp.test.mjs).
//    git add/commit/stash de recado do Alexandre JÁ EXISTENTE passa se ele estiver intacto: não criado nem
//    alterado durante comando desta sessão (o PostToolUse registra o que muda em recado do Alexandre durante
//    comando opaco ou de escrita incerta) e com o conteúdo do índice igual ao do disco. O gh é procurado no
//    PATH e, no Windows, também em %ProgramFiles%\GitHub CLI e %LOCALAPPDATA%\Programs\GitHub CLI.
//  - ADR 0035 (T-0139): com .coord/recados e .coord/lidos em junção para o clone do macuxifdv-recados, o alvo pelo
//    caminho de verdade do clone segue as regras de .coord/recados, o git que grava no clone é bloqueado e a foto do
//    PostToolUse inclui o git status do clone (juncoesDeRecados; casos em guarda-juncao.test.mjs).
// Detalhes e casos: .claude/hooks/guarda-bash-lib.mjs e .claude/hooks/guarda-bash.test.mjs.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ, carregarDonos, agenteDaSessao, juncoesDeRecados } from '../../scripts/coord-lib.mjs';
import {
  analisarComando, ambienteReal, mensagemPre, lerStatus, fotografar, compararFotos, statDe,
  violacoesDasMudancas, mensagemPos, mensagemAviso, separarAcusacoes, atualizarAcusados, descontarDesfeitos, permitidosDe,
  arquivoFoto, arquivoAcusados, arquivoRecadosDaSessao, ehRecadoDoAlexandre,
  lerJson, gravarJson, apagarArquivo, limparAntigos,
} from './guarda-bash-lib.mjs';
import {
  conferirMerge, consultarPrGh, lerRecadosDoGerente, motivosRecadoFalso, mensagemRecadoFalso,
  motivosIndiceDeRecados, mensagemIndiceDeRecados, vigiarRecados,
} from './guarda-merge-lib.mjs';

/** Conteúdo de um arquivo do repositório (rel) ou null. */
const lerDoRepo = (rel) => { try { return readFileSync(join(RAIZ, rel), 'utf8'); } catch { return null; } };

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
if (entrada.tool_name && entrada.tool_name !== 'Bash') process.exit(0);
const { agente, origem } = agenteDaSessao({ argumento: process.argv[2], entrada });
const comando = String(entrada.tool_input?.command || '');
const evento = entrada.hook_event_name || 'PreToolUse';

// Guardião v5 (T-0044): trava do gh pr merge — vale para TODA sessão, inclusive a manual e a do
// alexandre; só o gerente-projetos na sessão principal passa, com as regras (guarda-merge-lib.mjs).
if (evento === 'PreToolUse') {
  const m = conferirMerge({
    comando, agente, origem, subagente: Boolean(String(entrada.agent_id || '').trim()),
    consultarPr: (pr) => consultarPrGh(pr), lerRecados: () => lerRecadosDoGerente(RAIZ),
  });
  if (!m.ok) {
    process.stderr.write(m.mensagem + '\n');
    process.exit(2);
  }
}

if (!agente) process.exit(0); // sessão manual, sem agente
let regras;
let somenteLeitura = [];
try {
  regras = carregarDonos(RAIZ);
  somenteLeitura = JSON.parse(readFileSync(join(RAIZ, '.coord', 'donos.json'), 'utf8')).somente_leitura || [];
} catch {
  process.exit(0); // donos.json ilegível: o guarda-donos/verificar acusam; aqui não trava o Bash
}

const juncoes = juncoesDeRecados(RAIZ);

if (evento === 'PreToolUse') {
  const amb = ambienteReal(RAIZ, juncoes);
  const acusados = lerJson(arquivoAcusados(entrada, agente), {});
  const { violacoes, soLeitura, alvos, instala } = analisarComando({
    comando, agente, cwd: entrada.cwd || process.cwd(), raiz: RAIZ, regras, somenteLeitura,
    permitidos: permitidosDe(acusados), amb, juncoes,
  });
  if (violacoes.length) {
    process.stderr.write(mensagemPre(agente, violacoes) + '\n');
    process.exit(2);
  }
  // Guardião v5: nenhum agente cria recado em nome de outro (sobretudo de: alexandre).
  const motivos = motivosRecadoFalso({ comando, agente, cwd: entrada.cwd || process.cwd() });
  if (motivos.length) {
    process.stderr.write(mensagemRecadoFalso(agente, motivos) + '\n');
    process.exit(2);
  }
  // Guardião v6 (T-0050): git add/commit/stash de recado do Alexandre já existente passa se ele estiver intacto
  // (não tocado nesta sessão, índice = disco).
  if (agente !== 'alexandre') {
    const indice = motivosIndiceDeRecados({
      comando, cwd: entrada.cwd || process.cwd(), raiz: RAIZ, status: amb.status() || [],
      tocados: Object.keys(lerJson(arquivoRecadosDaSessao(entrada, agente, RAIZ), {})),
      ehDoAlexandre: (rel) => ehRecadoDoAlexandre(rel, lerDoRepo),
    });
    if (indice.length) {
      process.stderr.write(mensagemIndiceDeRecados(agente, indice) + '\n');
      process.exit(2);
    }
  }
  if (!soLeitura) {
    const status = amb.status();
    const vigiar = agente !== 'alexandre' && vigiarRecados(comando, entrada.cwd || process.cwd());
    // A data do próprio arquivo da foto é o "início" (mesmo relógio do sistema de arquivos).
    if (status) gravarJson(arquivoFoto(entrada), { agente, estado: fotografar(RAIZ, status), alvos, instala, vigiar });
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
  const status = lerStatus(RAIZ, juncoes);
  if (!status) process.exit(0);
  const arqAcusados = arquivoAcusados(entrada, agente);
  const antes = lerJson(arqAcusados, {});
  const mudancas = descontarDesfeitos(
    compararFotos({ inicio, estado: foto.estado }, fotografar(RAIZ, status), (rel) => statDe(RAIZ, rel)),
    antes, status,
  );
  // v6: recado do Alexandre que mudou durante comando opaco/de escrita incerta desta sessão não vai depois para
  // o índice/commit/stash por ela (motivosIndiceDeRecados). O registro vale até o fim da sessão.
  if (foto.vigiar) {
    const doAlexandre = mudancas.filter((m) => ehRecadoDoAlexandre(m.caminho, lerDoRepo));
    if (doAlexandre.length) {
      const arqSessao = arquivoRecadosDaSessao(entrada, agente, RAIZ);
      const registro = lerJson(arqSessao, {});
      for (const m of doAlexandre) registro[m.caminho] = { status: m.status, em: Date.now() };
      gravarJson(arqSessao, registro);
    }
  }
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
