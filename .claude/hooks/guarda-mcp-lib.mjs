// Guardião v7 (T-0122) — ferramentas MCP (mcp__*) no PreToolUse (hook .claude/hooks/guarda-mcp.mjs).
// Funções puras; o donos.json, a identidade e "o arquivo já existe?" são injetados (testes: guarda-mcp.test.mjs).
// Sem dependências externas.
//
// Por que: o Edit/Write passa pelo guarda-donos e o Bash pelo guarda-bash, mas uma ferramenta MCP que grava no
// GitHub (push_files, create_or_update_file, delete_file) ou em disco (servidor de arquivos) não passava por nenhum
// guardião (backlog "Guardião v7"; R-20261101-215200). O merge pelo MCP continua com o guarda-merge-mcp.mjs (v6).
//
// Classes (classificarFerramentaMcp):
//  - 'merge'            ferramenta de merge (tipoFerramentaMerge do v6): passa AQUI, quem decide é o guarda-merge-mcp.mjs;
//  - 'leitura'          get_/list_/search_/read_/view_/show_/download_... de qualquer servidor: passa;
//  - 'github-arquivo'   GitHub: push_files, create_or_update_file, delete_file (e variações): regras abaixo;
//  - 'github-escrita'   GitHub: escrita conhecida que não grava arquivo (PR, revisão, comentário, issue, branch): só no
//                       repositório oficial quando o repositório vem na chamada;
//  - 'github-proibida'  GitHub: qualquer outra escrita (apagar branch, criar/forkar repositório, workflow, release,
//                       segredo, configuração...) ou nome desconhecido: BLOQUEADO (falha fechada);
//  - 'arquivo-local'    outro servidor com verbo de escrita (write/edit/create/move/delete...) e caminho na entrada:
//                       cada caminho dentro do repositório passa pelo podeAlterar (as mesmas regras do guarda-donos),
//                       o caminho de verdade do clone de recados (junção, ADR 0035) vira .coord/recados/... (mesmas
//                       regras) e o resto do clone é bloqueado; fora disso só as pastas somente leitura do donos.json;
//  - 'outro'            outra ferramenta de outro servidor (Canva, documentos...): passa.
//
// Regras do 'github-arquivo' (todas as sessões; MACUXI_GUARDA=off desliga, como nos outros guardiões):
//  a) só no repositório aloirr/macuxifdv e com branch explícito diferente de main (nada vai direto ao main pelo MCP:
//     o main recebe por PR, regra A, ou pelo lote local do gerente);
//  b) caminho relativo limpo (sem "..", sem "/" no início, sem "\"); arquivo em CAMINHOS_DE_GOVERNANCA só pelo
//     Alexandre (MACUXI_AGENTE=alexandre ou sessão manual local) e com "Agente: alexandre" no último bloco da mensagem;
//  c) agente do time: cada arquivo passa pelo podeAlterar (dono, recado só novo com o próprio nome e "de:", diário e
//     lidos só do próprio agente) e a mensagem do commit tem exatamente um "Agente: <o próprio agente>" no último bloco
//     (o verificar --por-commit do CI exige o trailer); subagente e sessão sem agente do time = BLOQUEADO;
//  d) sessão manual local (sem agente): só a) e b).
import { partesFerramentaMcp, tipoFerramentaMerge, ultimoBlocoDaMensagem, REPO_OFICIAL } from './guarda-merge-lib.mjs';
import { PESSOAS, CAMINHOS_DE_GOVERNANCA, globParaRegex } from '../../scripts/coord-lib.mjs';

const CABECALHO = '[guardião Macuxi] BLOQUEADO (ferramenta MCP):';
const RE_GOVERNANCA = CAMINHOS_DE_GOVERNANCA.map(globParaRegex);
const RE_AGENTE = /^\s*Agente:[ \t]*(\S+)[ \t]*$/i;

/** Nome sem separadores, em minúsculas (push_files, pushFiles e push-files viram "pushfiles"). */
const compacto = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const ehServidorGithub = (servidor) => /git[-_]?hub|^gh$|[-_]gh$|^gh[-_]/i.test(String(servidor || ''));

/**
 * Leitura em qualquer servidor: verbo de consulta no início (get_, listFoo...) ou no fim das ferramentas consolidadas do
 * MCP do GitHub (pull_request_read, issue_read, actions_list, actions_get, projects_list...).
 */
const VERBOS_LEITURA = 'get|list|search|read|view|show|download|fetch|find|query|describe|count|lookup';
const RE_LEITURA = new RegExp(`^(?:${VERBOS_LEITURA})(?:[_-]|$)|^(?:${VERBOS_LEITURA})[A-Z]|[_-](?:read|get|list|search)$|^[a-z]+(?:Read|Get|List|Search)$`);
export const ehNomeDeLeitura = (nome) => RE_LEITURA.test(String(nome || '').replace(/^([A-Z])/, (c) => c.toLowerCase()));
/** GitHub que grava arquivo no repositório (nome compacto). */
export const GITHUB_ARQUIVO = new Set(['pushfiles', 'createorupdatefile', 'createfile', 'updatefile', 'deletefile', 'deletefiles', 'putfile', 'writefile', 'commitfiles']);
/** GitHub: escritas aceitas que não gravam arquivo (nome compacto). */
export const GITHUB_ESCRITA_ACEITA = new Set([
  // PR
  'createpullrequest', 'updatepullrequest', 'updatepullrequestbranch', 'requestcopilotreview', 'requestreviewers',
  // revisão e comentários
  'pullrequestreviewwrite', 'creatependingpullrequestreview', 'createpullrequestreview', 'submitpendingpullrequestreview',
  'deletependingpullrequestreview', 'addcommenttopendingreview', 'addpullrequestreviewcomment', 'addreplytopullrequestcomment',
  'replytopullrequestcomment', 'resolvereviewthread', 'unresolvereviewthread', 'addissuecomment', 'updateissuecomment',
  // issues
  'createissue', 'updateissue', 'issuewrite', 'subissuewrite', 'addsubissue', 'addlabelstoissue', 'labelwrite',
  // branch novo (nunca apaga nem reescreve)
  'createbranch',
]);
/** Verbos de escrita no nome (servidor que não é o GitHub): com caminho na entrada, vira 'arquivo-local'. */
const RE_VERBO_ESCRITA = /(write|edit|create|update|move|rename|delete|remove|append|patch|replace|insert|save|put|upload|copy|mkdir|touch|apply)/;
/** Chaves de entrada que apontam arquivo local (servidor de arquivos, editor...). */
const CHAVES_CAMINHO = ['path', 'file_path', 'filePath', 'filepath', 'file', 'filename', 'notebook_path', 'source', 'destination', 'target', 'dest', 'from', 'to', 'paths', 'files', 'edits'];

/**
 * Classe da ferramenta (ver o cabeçalho). Função pura.
 * @returns {'merge'|'leitura'|'github-arquivo'|'github-escrita'|'github-proibida'|'arquivo-local'|'outro'|null} null = não é MCP
 */
export function classificarFerramentaMcp(ferramenta, entrada = {}) {
  const p = partesFerramentaMcp(ferramenta);
  if (!p) return null;
  if (tipoFerramentaMerge(ferramenta)) return 'merge';
  const nome = compacto(p.nome);
  if (ehServidorGithub(p.servidor)) {
    if (GITHUB_ARQUIVO.has(nome)) return 'github-arquivo';
    if (GITHUB_ESCRITA_ACEITA.has(nome)) return 'github-escrita';
    if (ehNomeDeLeitura(p.nome)) return 'leitura';
    return 'github-proibida';
  }
  if (ehNomeDeLeitura(p.nome)) return 'leitura';
  if (RE_VERBO_ESCRITA.test(nome) && caminhosLocais(entrada).length) return 'arquivo-local';
  return 'outro';
}

/** Caminhos locais citados na entrada de uma ferramenta de arquivos (strings ou objetos com path). */
export function caminhosLocais(entrada) {
  const obj = entrada && typeof entrada === 'object' && !Array.isArray(entrada) ? entrada : {};
  const res = [];
  const pegar = (v) => {
    if (typeof v === 'string' && v.trim()) res.push(v.trim());
    else if (Array.isArray(v)) v.forEach(pegar);
    else if (v && typeof v === 'object') for (const k of ['path', 'file_path', 'filePath', 'filename', 'source', 'destination']) if (typeof v[k] === 'string') pegar(v[k]);
  };
  for (const k of CHAVES_CAMINHO) if (obj[k] !== undefined) pegar(obj[k]);
  return [...new Set(res)];
}

/** owner/repo da chamada ("" se não veio). */
export function repositorioDaEntrada(entrada) {
  const o = entrada && typeof entrada === 'object' ? entrada : {};
  const dono = o.owner ?? o.repo_owner ?? o.repoOwner;
  const nome = o.repo ?? o.repository ?? o.repo_name ?? o.repoName;
  if (dono === undefined && nome === undefined) return '';
  return (dono !== undefined ? `${dono}/${nome ?? ''}` : String(nome ?? '')).trim().toLowerCase();
}

/** Arquivos que a ferramenta do GitHub grava: [{caminho, conteudo?, apaga, atualiza}]. */
export function arquivosDaEntrada(nome, entrada) {
  const o = entrada && typeof entrada === 'object' ? entrada : {};
  const apaga = /delete/.test(nome);
  const lista = [];
  if (Array.isArray(o.files)) for (const f of o.files) lista.push({ caminho: f?.path ?? f?.file_path ?? f?.filename, conteudo: f?.content, apaga: apaga || f?.delete === true || f?.content === null, atualiza: Boolean(f?.sha) });
  if (o.path !== undefined || o.file_path !== undefined) lista.push({ caminho: o.path ?? o.file_path, conteudo: o.content, apaga, atualiza: Boolean(o.sha) });
  if (Array.isArray(o.paths)) for (const c of o.paths) lista.push({ caminho: c, apaga, atualiza: false });
  return lista;
}

/** Caminho do repositório remoto: relativo, com "/", sem "..". Retorna {rel} ou {erro}. */
export function caminhoRemoto(caminho) {
  if (typeof caminho !== 'string' || !caminho.trim()) return { erro: 'arquivo sem caminho (path)' };
  const c = caminho.trim();
  if (c.includes('\\')) return { erro: `caminho com "\\" não é aceito (${c})` };
  if (c.startsWith('/') || /^[a-z]:/i.test(c)) return { erro: `caminho absoluto não é aceito (${c}): use o caminho relativo à raiz do repositório` };
  const rel = c.replace(/^(\.\/)+/, '');
  if (rel.split('/').some((s) => s === '..' || s === '.' || s === '')) return { erro: `caminho com "..", "." ou "//" não é aceito (${c})` };
  return { rel };
}

export const ehGovernanca = (rel) => RE_GOVERNANCA.some((re) => re.test(rel));

/** Nomes "Agente:" do último bloco da mensagem do commit (minúsculas). */
export function agentesDaMensagem(mensagem) {
  return ultimoBlocoDaMensagem(mensagem).map((l) => l.match(RE_AGENTE)).filter(Boolean).map((m) => m[1].toLowerCase());
}

/** A sessão é do Alexandre (identidade confiável) ou manual local? */
const ehAlexandre = (agente) => agente === 'alexandre';

/**
 * Confere uma chamada de ferramenta MCP (PreToolUse). Função pura.
 * @param {{ferramenta: string, entrada?: object, agente: string, origem?: string, subagente?: boolean,
 *   podeAlterar: (p: {agente: string, ferramenta: string, rel: string, conteudo?: string}) => {ok: boolean, motivo?: string},
 *   caminhoRelativo: (c: string) => (string|null), somenteLeitura?: string[],
 *   porJuncao?: (c: string) => ({rel: string}|{bloqueio: string}|null)}} p  caminho fora da raiz pela junção de recados
 * @returns {{ok: boolean, classe: string|null, mensagem?: string}}
 */
export function conferirFerramentaMcp({ ferramenta, entrada = {}, agente, origem = '', subagente = false, podeAlterar, caminhoRelativo, somenteLeitura = [], porJuncao = () => null }) {
  const classe = classificarFerramentaMcp(ferramenta, entrada);
  if (!classe || classe === 'merge' || classe === 'leitura' || classe === 'outro') return { ok: true, classe };
  const erros = [];
  const p = partesFerramentaMcp(ferramenta);
  const nome = compacto(p.nome);
  const doTime = PESSOAS.includes(agente);

  if (classe === 'github-proibida') {
    erros.push(`${ferramenta} não está entre as escritas aceitas pelo MCP do GitHub (aceitas: PR, revisão, comentário, issue, criar branch e gravar arquivo com as regras do guardião). Apagar branch, repositório, workflow, release, segredo ou configuração é com o Alexandre`);
  }

  if (classe === 'github-escrita') {
    const repo = repositorioDaEntrada(entrada);
    if (repo && repo !== REPO_OFICIAL) erros.push(`escrita só no repositório ${REPO_OFICIAL} (veio ${repo})`);
    if (nome === 'createbranch' && /^(refs\/heads\/)?main$/i.test(String(entrada?.branch ?? '').trim())) erros.push('o branch main já existe e não é recriado pelo MCP');
  }

  if (classe === 'github-arquivo') {
    const repo = repositorioDaEntrada(entrada);
    if (!repo) erros.push(`falta o repositório (owner: "aloirr", repo: "macuxifdv")`);
    else if (repo !== REPO_OFICIAL) erros.push(`gravar arquivo só no repositório ${REPO_OFICIAL} (veio ${repo})`);
    const branch = String(entrada?.branch ?? entrada?.ref ?? '').trim().replace(/^refs\/heads\//i, '');
    if (!branch) erros.push('falta o branch: sem ele o GitHub grava no branch padrão (main)');
    else if (/^main$/i.test(branch)) erros.push('nada vai direto ao main pelo MCP: grave no branch da tarefa (nuvem/T-nnnn-...) e abra o PR');
    const arquivos = arquivosDaEntrada(nome, entrada);
    if (!arquivos.length) erros.push('nenhum arquivo na chamada (files[].path ou path)');
    const mensagem = entrada?.message ?? entrada?.commit_message ?? entrada?.commitMessage;
    const nomes = agentesDaMensagem(mensagem);
    const governanca = [];
    for (const a of arquivos) {
      const c = caminhoRemoto(a.caminho);
      if (c.erro) { erros.push(c.erro); continue; }
      if (ehGovernanca(c.rel)) governanca.push(c.rel);
    }
    if (governanca.length) {
      const lista = `${governanca.slice(0, 5).join(', ')}${governanca.length > 5 ? ', ...' : ''}`;
      if (agente && !ehAlexandre(agente)) erros.push(`caminho de governança (${lista}): pelo MCP, só o Alexandre grava; os agentes entregam em diff (docs/desenho/T-nnnn-*.diff) para o Alexandre aplicar`);
      if (nomes.length !== 1 || nomes[0] !== 'alexandre') erros.push('caminho de governança: a mensagem do commit termina com "Agente: alexandre" no último bloco (CI da T-0049)');
    }
    if (agente) {
      if (subagente && !doTime) erros.push(`subagente "${agente}" não é do time: só os agentes de .claude/agents gravam no repositório`);
      else if (!doTime) erros.push(`a sessão "${agente}" (${origem || 'origem desconhecida'}) não tem agente do time identificado: na nuvem, use o branch nuvem/T-nnnn-... com o trailer "Agente: <dono>"`);
      else {
        if (!governanca.length && (nomes.length !== 1 || nomes[0] !== agente)) erros.push(`a mensagem do commit precisa de exatamente um "Agente: ${agente}" no último bloco (veio ${nomes.length ? nomes.join(', ') : 'nenhum'}): o verificar --por-commit do CI confere o dono de cada arquivo pelo trailer`);
        for (const a of arquivos) {
          const c = caminhoRemoto(a.caminho);
          if (c.erro) continue;
          const r = podeAlterar({ agente, ferramenta: a.apaga ? 'Delete' : a.atualiza ? 'Edit' : 'Write', rel: c.rel, conteudo: typeof a.conteudo === 'string' ? a.conteudo : undefined });
          if (!r.ok) erros.push(r.motivo);
        }
      }
    }
  }

  if (classe === 'arquivo-local') {
    for (const caminho of caminhosLocais(entrada)) {
      let rel = caminhoRelativo(caminho);
      if (rel === null) {
        // ADR 0035 (T-0139): escrita direta no clone de recados (por fora da junção), como no guarda-donos.
        const j = porJuncao(caminho);
        if (j?.bloqueio) { erros.push(`"${caminho}": ${j.bloqueio}`); continue; }
        if (j?.rel) rel = j.rel;
      }
      if (rel === null) {
        const norm = (x) => String(x).replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
        const pasta = somenteLeitura.find((s) => norm(caminho) === norm(s) || norm(caminho).startsWith(norm(s) + '/'));
        if (pasta) erros.push(`"${caminho}" está numa pasta somente leitura (${pasta})`);
        continue;
      }
      if (!agente) continue; // sessão manual local: como no guarda-donos
      if (!doTime) { erros.push(`o agente "${agente}" não faz parte do time; só os agentes de .claude/agents alteram o repositório`); break; }
      const ferr = /delete|remove/.test(nome) ? 'Delete' : /write|create|save|put|upload|copy|touch|mkdir/.test(nome) ? 'Write' : 'Edit';
      const r = podeAlterar({ agente, ferramenta: ferr, rel, conteudo: typeof entrada?.content === 'string' ? entrada.content : undefined });
      if (!r.ok) erros.push(r.motivo);
    }
  }

  if (!erros.length) return { ok: true, classe };
  return { ok: false, classe, mensagem: mensagemMcp(ferramenta, [...new Set(erros)]) };
}

export function mensagemMcp(ferramenta, erros) {
  return (
    `${CABECALHO} ${ferramenta}\n${erros.map((e) => ` - ${e}`).join('\n')}\n` +
    'Pelo MCP do GitHub vale o mesmo que no disco: cada agente grava só os próprios caminhos (.coord/donos.json), num branch da tarefa ' +
    '(nunca no main), com "Agente: <o próprio agente>" no último bloco da mensagem; governança (.claude/**, .coord/donos.json, ' +
    'scripts/coord*.mjs, .github/**) só o Alexandre.\n' +
    'Não contorne o bloqueio (outra ferramenta, gh api, script): fora dos seus caminhos, deixe um recado ao dono (node scripts/coord.mjs dono <caminho>).'
  );
}
