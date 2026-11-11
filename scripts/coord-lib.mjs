// Biblioteca comum do protocolo de coordenação do time Macuxi.
// Usada pelo guardião (.claude/hooks/guarda-donos.mjs) e pela CLI (scripts/coord.mjs).
// Sem dependências externas.
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync, renameSync, realpathSync } from 'node:fs';
import { join, relative, isAbsolute, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { Worker, MessageChannel, receiveMessageOnPort } from 'node:worker_threads';
import { createHash } from 'node:crypto';

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const AGENTES = [
  'gerente-projetos',
  'engenheiro-software',
  'engenheiro-apps',
  'designer-ux',
  'banco-dados',
  'testes',
  'modulo-core',
  'modulo-catalogo',
  'modulo-vendedor',
  'modulo-promotor',
  'modulo-gestor',
  'modulo-pesquisa',
  'modulo-treinamento',
  'modulo-integracao',
  // T-0123: engenheiro sênior de testes e otimização; audita redundâncias e só escreve em
  // docs/qualidade/redundancias/** (donos.json), no próprio diário/lidos e em recados novos.
  'corretor-redundancias',
];
/** Pode responder pelo próprio diário/lidos e aparecer como dono em `verificar`. */
export const PESSOAS = [...AGENTES, 'alexandre'];
export const DESTINOS = [...AGENTES, 'alexandre', 'todos'];
/**
 * Remetentes de sistema (T-0158, ADR 0043; aprovado pelo dono do produto no R-20261110-112315): quem grava é o SERVIDOR
 * (worker da API, token fine-grained só dele), direto no repositório de recados. Não são agentes nem pessoas: ficam
 * fora de AGENTES, PESSOAS e DESTINOS (ninguém manda recado PARA eles, ninguém envia como eles pelo coord e o recado
 * deles nunca autoriza merge nem governança). Só o nome do arquivo os reconhece (caixa e fio mostram "de diagnostico").
 */
export const REMETENTES_DE_SISTEMA = ['diagnostico'];
export const ehRemetenteDeSistema = (nome) => REMETENTES_DE_SISTEMA.includes(String(nome || '').trim().toLowerCase());
export const TIPOS = ['pedido', 'pergunta', 'resposta', 'aviso', 'bloqueio', 'entrega', 'revisao'];
export const TIPOS_QUE_EXIGEM_ENCERRAMENTO = ['pedido', 'pergunta', 'bloqueio', 'revisao'];

/** Converte glob simples (*, **, ?) em RegExp. */
export function globParaRegex(padrao) {
  let re = '';
  for (let i = 0; i < padrao.length; i++) {
    const c = padrao[i];
    if (c === '*') {
      if (padrao[i + 1] === '*') {
        i++;
        if (padrao[i + 1] === '/') {
          re += '(?:.*/)?'; // "**/" casa zero ou mais diretórios
          i++;
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$', 'i');
}

export function carregarDonos(raiz = RAIZ) {
  const arq = join(raiz, '.coord', 'donos.json');
  const dados = JSON.parse(readFileSync(arq, 'utf8'));
  return dados.regras.map((r) => ({ ...r, re: globParaRegex(r.padrao) }));
}

/** Caminho relativo à raiz do repo com barras "/". Retorna null se estiver fora do repo. */
export function caminhoRelativo(caminho, raiz = RAIZ) {
  if (!caminho) return null;
  const abs = isAbsolute(caminho) ? caminho : resolve(raiz, caminho);
  let rel = relative(raiz, abs).replace(/\\/g, '/');
  // Windows: diferença só de maiúsculas/minúsculas na letra do drive
  if (rel.startsWith('..') && process.platform === 'win32') {
    const a = abs.toLowerCase().replace(/\\/g, '/');
    const r = raiz.toLowerCase().replace(/\\/g, '/');
    if (a.startsWith(r + '/')) rel = abs.replace(/\\/g, '/').slice(r.length + 1);
  }
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel;
}

// ───────────────────── recados no repositório próprio (ADR 0035, T-0139) ─────────────────────
// No PC, .coord/recados e .coord/lidos viram junções (mklink /J) para o clone do macuxifdv-recados.
// Nada aqui resolve caminho por realpath: quem escreve por .coord/recados/... continua dentro da raiz e
// cai nas regras de sempre. O risco é o caminho de verdade (C:\macuxifdv-recados\recados\...), que fica
// fora da raiz: juncoesDeRecados + relativoPorJuncao o trazem de volta para .coord/recados/... (mesmas
// regras), e o resto do clone (.git, .github, README) é bloqueado para os agentes.

/** Pastas de coordenação que moram no repositório de recados depois do corte. */
export const PASTAS_DE_RECADOS = ['.coord/recados', '.coord/lidos'];

const comBarras = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '');
const mesmoCaminho = (a, b) => (process.platform === 'win32' || /^[A-Za-z]:\//.test(a)
  ? comBarras(a).toLowerCase() === comBarras(b).toLowerCase()
  : comBarras(a) === comBarras(b));

/**
 * Junções das pastas de recados (ADR 0035): [{rel, real}] das PASTAS_DE_RECADOS cujo caminho de verdade
 * (realpath) é outro, e `clone` = pasta-mãe comum dos destinos (a raiz do clone) ou null.
 * Sem junção (antes do corte, na nuvem, no CI): {mapas: [], clone: null}. `realpath` é injetável (testes).
 */
export function juncoesDeRecados(raiz = RAIZ, { realpath = (p) => realpathSync.native(p) } = {}) {
  const mapas = [];
  for (const rel of PASTAS_DE_RECADOS) {
    const lexico = join(raiz, ...rel.split('/'));
    let real;
    try { real = realpath(lexico); } catch { continue; } // pasta ausente: nada a mapear
    let raizReal = raiz;
    try { raizReal = realpath(raiz); } catch { /* raiz sem realpath: compara com a léxica */ }
    if (mesmoCaminho(real, lexico) || mesmoCaminho(real, join(raizReal, ...rel.split('/')))) continue;
    mapas.push({ rel, real: comBarras(real) });
  }
  const maes = [...new Set(mapas.map((m) => comBarras(dirname(m.real))))];
  return { mapas, clone: maes.length === 1 ? maes[0] : null };
}

/**
 * Caminho absoluto que cai numa junção de recados (função pura): {rel: '.coord/recados/...'} dentro de um
 * destino mapeado; {clone: true} no resto do clone de recados (.git, .github, README...); null fora dos dois.
 */
export function relativoPorJuncao(abs, juncoes) {
  if (!abs || !juncoes) return null;
  const a = comBarras(abs);
  const sob = (base) => mesmoCaminho(a, base) || a.toLowerCase().startsWith(comBarras(base).toLowerCase() + '/');
  for (const { rel, real } of juncoes.mapas || []) {
    if (!sob(real)) continue;
    const resto = a.slice(comBarras(real).length).replace(/^\/+/, '');
    return { rel: resto ? `${rel}/${resto}` : rel };
  }
  if (juncoes.clone && sob(juncoes.clone)) return { clone: true };
  return null;
}

export const MOTIVO_CLONE_DE_RECADOS = 'o clone do repositório de recados só muda pelo node scripts/coord.mjs (enviar, lido) e pelo scripts/sincronizar-recados.ps1 (ADR 0035)';

/**
 * Estado dos recados no repositório de código pela marca do .gitignore (ADR 0035), para o verificar:
 * 'no-repo' (marca nem na base nem no topo: regra de sempre) · 'corte' (a marca entra no topo: só o
 * alexandre tira os recados e lidos do repositório) · 'fora' (marca na base: nada de recado ou lidos aqui).
 * Marca na base e não no topo é a volta (plano de volta da ADR): vale a regra de sempre.
 */
export function estadoDosRecados({ gitignoreBase = '', gitignoreTopo = '' } = {}) {
  const base = recadosForaDoRepo(gitignoreBase);
  const topo = recadosForaDoRepo(gitignoreTopo);
  if (base && topo) return 'fora';
  if (!base && topo) return 'corte';
  return 'no-repo';
}

/** O .gitignore tira .coord/recados/ do repositório (linha exata, com ou sem a barra inicial)? */
export function recadosForaDoRepo(gitignore) {
  return /^\/?\.coord\/recados\/?[ \t]*\r?$/m.test(String(gitignore || ''));
}

const ehDePastaDeRecados = (caminho) => PASTAS_DE_RECADOS.some((p) => {
  const c = String(caminho).toLowerCase();
  return c === p || c.startsWith(`${p}/`);
});

/**
 * Regra das pastas de recados conforme o estado (ADR 0035). null = vale a regra de sempre.
 * @returns {null | {excecao?: string, violacao?: string, dono?: string}}
 */
function regraDosRecadosForaDoRepo(status, caminho, agente, estado) {
  if (estado !== 'corte' && estado !== 'fora') return null;
  if (!ehDePastaDeRecados(caminho)) return null;
  if (estado === 'corte' && status === 'D') {
    return agente === 'alexandre'
      ? { excecao: 'recados e lidos saem para o repositório macuxifdv-recados (corte da ADR 0035)' }
      : { violacao: 'só o commit do corte, com "Agente: alexandre", tira recados e lidos do repositório (ADR 0035)', dono: 'alexandre' };
  }
  return {
    violacao: 'recados e lidos agora ficam no repositório macuxifdv-recados (ADR 0035): no PC use node scripts/coord.mjs enviar; na nuvem, escreva o recado no corpo do PR',
    dono: 'ninguém',
  };
}

/** Primeira regra que casa vence. */
export function donoDe(rel, regras) {
  for (const r of regras) if (r.re.test(rel)) return r.dono;
  return 'sem-dono';
}

/**
 * Decide se o agente pode alterar o arquivo.
 * @returns {{ok: boolean, motivo?: string, dono?: string}}
 */
export function podeAlterar({ agente, ferramenta, rel, raiz = RAIZ, regras = carregarDonos(raiz), conteudo, env = process.env }) {
  // T-0143 (ADR 0039): com os recados no GitHub, nada se grava em .coord/recados nem em .coord/lidos no disco (o
  // arquivo ficaria fora do repositório de recados e se perderia). enviar e lido vão direto ao GitHub pelo coord.mjs.
  if (ehDePastaDeRecados(rel) && modoDosRecados({ raiz, env }) === 'github') return { ok: false, motivo: MOTIVO_RECADOS_NO_GITHUB };
  // Anexo de recado (.coord/recados/anexos/**) não é recado: segue a regra comum, com o dono do
  // donos.json (alexandre). Só ele cria e altera; para os outros vale "arquivo de outro dono".
  const anexo = ehAnexoDeRecado(rel);
  // Recados: só criar arquivo novo, na pasta de um destino válido, com o próprio nome como remetente
  // (R-...-<agente>.md) e, se o conteúdo vier junto (Write), "de: <agente>" no cabeçalho.
  // Guardião v5 (T-0044): o nome só CONTER "-<agente>" não basta (R-1-modulo-core-alexandre.md é
  // do remetente alexandre), e ninguém além do Alexandre grava "de: alexandre".
  const mRecado = !anexo && rel.match(/^\.coord\/recados\/([^/]+)\/([^/]+)$/i);
  if (mRecado) {
    const [, destino, arquivo] = mRecado;
    if (!DESTINOS.includes(destino)) return { ok: false, motivo: `destino de recado inválido: ${destino}` };
    if (ferramenta !== 'Write' || existsSync(join(raiz, rel)))
      return { ok: false, motivo: 'recados são imutáveis: responda com um recado novo (node scripts/coord.mjs enviar --responde-a <id>)' };
    return regraDoRecadoNovo({ agente, destino, arquivo, conteudo });
  }
  if (!anexo && rel.startsWith('.coord/recados/')) return { ok: false, motivo: 'use node scripts/coord.mjs enviar para criar recados' };

  // Diário e marcação de lidos: só o próprio agente.
  const mDiario = rel.match(/^\.coord\/(diario|lidos)\/([^/.]+)\.(md|txt)$/i);
  if (mDiario) {
    return mDiario[2] === agente
      ? { ok: true }
      : { ok: false, motivo: `o diário/lidos de ${mDiario[2]} pertence a ${mDiario[2]}` };
  }

  const dono = donoDe(rel, regras);
  if (dono === agente) return { ok: true, dono };
  // Alexandre (dono do produto) altera arquivo de qualquer dono, como no `verificar`;
  // sem-dono, congelado e as regras de recado/diário/lidos acima continuam valendo.
  if (agente === 'alexandre' && dono !== 'congelado' && dono !== 'sem-dono') return { ok: true, dono };
  const dica =
    dono === 'alexandre'
      ? 'só o Alexandre altera este arquivo: mande recado para "alexandre"'
      : dono === 'congelado'
        ? 'área congelada (Fase M): não alterar'
        : dono === 'sem-dono'
          ? 'caminho sem dono em .coord/donos.json: mande recado ao gerente-projetos'
          : `deixe um recado: node scripts/coord.mjs enviar --de ${agente} --para ${dono} --tipo pedido --assunto "..." --corpo "..."`;
  return { ok: false, dono, motivo: `"${rel}" pertence a ${dono}. ${dica}` };
}

/**
 * Regras do recado novo (guardião v5, T-0044), sem olhar o disco: destino válido, nome terminando com o remetente
 * (R-...-<agente>.md) e, com o conteúdo, "de: <agente>" no cabeçalho. Usada pelo podeAlterar e pelo envio ao GitHub.
 * @returns {{ok: boolean, motivo?: string}}
 */
export function regraDoRecadoNovo({ agente, destino, arquivo, conteudo }) {
  if (!DESTINOS.includes(destino)) return { ok: false, motivo: `destino de recado inválido: ${destino}` };
  if (remetenteDoRecado(arquivo) !== agente)
    return { ok: false, motivo: `o nome do recado precisa terminar com o remetente (R-...-${agente}.md). Use node scripts/coord.mjs enviar` };
  const de = remetenteDoConteudo(conteudo);
  if (de !== null && de !== agente)
    return { ok: false, motivo: `o recado diz "de: ${de}", mas quem escreve é ${agente}: ninguém envia recado em nome de outro (de: alexandre só o Alexandre)` };
  return { ok: true };
}

/**
 * Anexo de recado (imagem, HTML... citados nos recados do Alexandre): .coord/recados/anexos/**.
 * Não é recado (não tem destino nem remetente): é arquivo comum, com o dono vindo do donos.json.
 */
export function ehAnexoDeRecado(caminho) {
  return /^\.coord\/recados\/anexos\//i.test(normalizarCaminho(caminho));
}

/** Normaliza caminho vindo do git ou do Windows: barras "/", sem "./" no início. */
export function normalizarCaminho(caminho) {
  return String(caminho).replace(/\\/g, '/').replace(/^(\.\/)+/, '');
}

/** "de:" do cabeçalho (front matter) de um recado, em minúsculas; null sem conteúdo ou sem "de:". */
export function remetenteDoConteudo(conteudo) {
  if (typeof conteudo !== 'string') return null;
  const m = conteudo.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const de = m?.[1].match(/^de:[ \t]*["']?([^"'\r\n]*?)["']?[ \t]*$/im);
  return de ? de[1].trim().toLowerCase() : null;
}

/**
 * Remetente pelo nome do arquivo do recado (R-AAAAMMDD-HHMMSS[-n]-<remetente>.md); null se não houver.
 * Reconhece também os remetentes de sistema (`-diagnostico`), que não são de nenhum agente: no `verificar`, um recado
 * desses no disco é de "diagnostico" (nunca do agente que o gravou) e vira violação.
 */
export function remetenteDoRecado(arquivo) {
  const nome = String(arquivo).replace(/\.md$/i, '').toLowerCase();
  return [...PESSOAS, ...REMETENTES_DE_SISTEMA].sort((a, b) => b.length - a.length).find((p) => nome.endsWith(`-${p}`)) || null;
}

/**
 * De quem é a mudança, pelas regras do protocolo (função pura):
 * recado → remetente do nome do arquivo; diário/lidos → o próprio agente; resto → donos.json.
 * Anexo de recado (.coord/recados/anexos/**) é arquivo comum: dono pelo donos.json (alexandre).
 * @returns {{tipo: 'recado'|'recado-fora'|'diario'|'lidos'|'comum', dono: string, destino?: string, arquivo?: string}}
 */
export function donoDaMudanca(caminho, regras) {
  if (ehAnexoDeRecado(caminho)) return { tipo: 'comum', dono: donoDe(caminho, regras) };
  const mRecado = caminho.match(/^\.coord\/recados\/([^/]+)\/([^/]+)$/i);
  if (mRecado) return { tipo: 'recado', destino: mRecado[1], arquivo: mRecado[2], dono: remetenteDoRecado(mRecado[2]) || 'sem-remetente' };
  if (/^\.coord\/recados\//i.test(caminho)) return { tipo: 'recado-fora', dono: 'sem-dono' };
  const mDiario = caminho.match(/^\.coord\/(diario|lidos)\/([^/.]+)\.(md|txt)$/i);
  if (mDiario && PESSOAS.includes(mDiario[2])) return { tipo: mDiario[1].toLowerCase(), dono: mDiario[2] };
  return { tipo: 'comum', dono: donoDe(caminho, regras) };
}

const MOTIVO_RECADO_FORA = 'fora do padrão .coord/recados/<destino>/<id>.md (use node scripts/coord.mjs enviar)';

/**
 * Violações que independem do agente: recado alterado/apagado, destino inválido, recado sem
 * remetente no nome, caminho sem-dono ou congelado. Retorna o motivo ou null.
 */
function violacaoUniversal(status, info) {
  if (info.tipo === 'recado') {
    if (status !== 'A') return `recados são imutáveis (${status === 'D' ? 'apagado' : 'alterado'}): responda com um recado novo`;
    if (!DESTINOS.includes(info.destino)) return `destino de recado inválido: ${info.destino}`;
    if (info.dono === 'sem-remetente') return 'o nome do recado precisa conter o remetente (R-...-<remetente>.md). Use node scripts/coord.mjs enviar';
    if (ehRemetenteDeSistema(info.dono)) return `recado de remetente de sistema (${info.dono}): só o servidor grava, direto no repositório de recados (T-0158)`;
    return null;
  }
  if (info.tipo === 'recado-fora') return MOTIVO_RECADO_FORA;
  if (info.dono === 'sem-dono') return 'caminho sem dono em .coord/donos.json: mande recado ao gerente-projetos';
  if (info.dono === 'congelado') return 'área congelada: ninguém altera';
  return null;
}

/** Lista as mudanças sem `vistos` repetidos, com caminho normalizado e status de uma letra. */
function* mudancasUnicas(mudancas) {
  const vistos = new Set();
  for (const m of mudancas) {
    const caminho = normalizarCaminho(m.caminho);
    if (!caminho || vistos.has(caminho)) continue;
    vistos.add(caminho);
    yield { status: String(m.status || 'M').charAt(0).toUpperCase(), caminho };
  }
}

/**
 * Classifica as mudanças do git para `coord.mjs verificar` (função pura, sem ler disco).
 * - estrito (com --base): arquivo de outro dono é VIOLAÇÃO.
 * - não estrito (sem --base, árvore compartilhada): arquivo de outro dono é informativo ("outros").
 * - "alexandre" (dono do produto) nunca viola por mexer em arquivo de outro dono.
 * - sem-dono, congelado, recado alterado/apagado/fora do padrão/sem remetente: sempre VIOLAÇÃO.
 * Exceções universais (iguais às do guardião): recado NOVO do próprio agente em
 * .coord/recados/<destino>/, .coord/diario/<agente>.md e .coord/lidos/<agente>.txt.
 * Recado novo com o nome de outro remetente e diário/lidos de outro agente são desse outro.
 * Com `lockAcompanha` (só no estrito, uso do `verificar --base/--por-commit`), aplica a regra
 * "o lock acompanha a dependência" (lockAcompanhaDependencia): o lock que seria violação vai
 * para `acompanhando`, para revisão do engenheiro-software.
 * `recados` (ADR 0035, estadoDosRecados): 'corte' aceita só do alexandre a saída (D) de .coord/recados e
 * .coord/lidos; 'fora' recusa qualquer mudança nessas pastas; 'no-repo' (padrão) é a regra de sempre.
 * @param {{agente: string, mudancas: {status: string, caminho: string}[], regras: any[], estrito?: boolean,
 *   lockAcompanha?: boolean, workspaceSoBuilds?: boolean | (() => boolean), recados?: 'no-repo'|'corte'|'fora'}} p
 * @returns {{ok: any[], excecoes: any[], outros: any[], violacoes: any[], acompanhando: any[]}}
 */
export function classificarMudancas({ agente, mudancas, regras, estrito = false, lockAcompanha = false, workspaceSoBuilds = false, recados = 'no-repo' }) {
  const res = { ok: [], excecoes: [], outros: [], violacoes: [], acompanhando: [] };
  for (const item of mudancasUnicas(mudancas)) {
    const fora = regraDosRecadosForaDoRepo(item.status, item.caminho, agente, recados);
    if (fora?.excecao) { res.excecoes.push({ ...item, motivo: fora.excecao }); continue; }
    if (fora?.violacao) { res.violacoes.push({ ...item, dono: fora.dono, motivo: fora.violacao }); continue; }
    const info = donoDaMudanca(item.caminho, regras);
    const universal = violacaoUniversal(item.status, info);
    if (universal) {
      res.violacoes.push({ ...item, dono: info.tipo.startsWith('recado') ? 'ninguém' : info.dono, motivo: universal });
      continue;
    }
    const { dono } = info;
    // Recado: é do agente só se o remetente do nome for ele (v5: R-1-modulo-core-alexandre.md é de alexandre).
    const proprio = dono === agente;
    if (proprio) {
      if (info.tipo === 'comum') res.ok.push({ ...item, dono });
      else res.excecoes.push({ ...item, motivo: info.tipo === 'recado' ? `recado novo para ${info.destino}` : info.tipo === 'diario' ? 'diário do próprio agente' : 'lidos do próprio agente' });
    } else if (!estrito || agente === 'alexandre') res.outros.push({ ...item, dono });
    else {
      const motivo = info.tipo === 'recado'
        ? `o nome do recado precisa conter o remetente (-${agente}); este recado é de ${dono}`
        : info.tipo === 'diario' || info.tipo === 'lidos'
          ? `o diário/lidos de ${dono} pertence a ${dono}`
          : `fora dos caminhos de ${agente}; peça ao dono por recado (node scripts/coord.mjs enviar --de ${agente} --para ${dono} --tipo pedido ...)`;
      res.violacoes.push({ ...item, dono, motivo });
    }
  }
  return estrito && lockAcompanha ? lockAcompanhaDependencia({ agente, resultado: res, workspaceSoBuilds }) : res;
}

// ───────────────────── "o lock acompanha a dependência" (guardião v4, T-0005) ─────────────────────

export const LOCK_PNPM = 'pnpm-lock.yaml';
export const WORKSPACE_PNPM = 'pnpm-workspace.yaml';
/** Chaves do pnpm-workspace.yaml que um agente pode mudar junto com a dependência do próprio pacote. */
export const CHAVES_DE_BUILD = ['allowBuilds', 'onlyBuiltDependencies'];

/** Pasta do pacote de um package.json ("modules/core/package.json" → "modules/core"; raiz → "."), ou null. */
export function pacoteDoPackageJson(caminho) {
  const c = normalizarCaminho(caminho);
  if (c === 'package.json') return '.';
  const m = c.match(/^(.+)\/package\.json$/i);
  return m ? m[1] : null;
}

/**
 * Remove de um pnpm-workspace.yaml os blocos de primeiro nível das CHAVES_DE_BUILD (a linha da
 * chave e as seguintes indentadas ou itens "- " de lista), as linhas em branco e as só de comentário.
 * Sobra o resto do arquivo, para comparar antes × depois (função pura, sem parser de YAML).
 */
export function workspaceSemChavesDeBuild(texto) {
  const chave = new RegExp(`^(?:${CHAVES_DE_BUILD.join('|')}|"(?:${CHAVES_DE_BUILD.join('|')})"|'(?:${CHAVES_DE_BUILD.join('|')})')[ \\t]*:`);
  const fora = [];
  let dentro = false;
  for (const linha of String(texto || '').replace(/\r\n?/g, '\n').split('\n')) {
    if (!linha.trim() || /^[ \t]*#/.test(linha)) continue; // linha em branco ou só comentário: não muda nada
    if (dentro && (/^[ \t]/.test(linha) || /^-([ \t]|$)/.test(linha))) continue;
    dentro = chave.test(linha);
    if (!dentro) fora.push(linha.replace(/[ \t]+$/, ''));
  }
  return fora.join('\n');
}

/** pnpm-workspace.yaml mudou só em allowBuilds/onlyBuiltDependencies? (função pura) */
export function workspaceMudouSoEmBuilds(antes, depois) {
  return workspaceSemChavesDeBuild(antes) === workspaceSemChavesDeBuild(depois);
}

/**
 * Regra "o lock acompanha a dependência" (função pura, sobre o resultado do classificarMudancas estrito):
 * a mudança em pnpm-lock.yaml (M/A) e a do pnpm-workspace.yaml (M) feita só em allowBuilds/
 * onlyBuiltDependencies (`workspaceSoBuilds`) deixam de ser violação quando, no MESMO PR/commit,
 * o agente alterou o package.json de um pacote que é dele (está em `ok`). Elas vão para
 * `acompanhando` ("lock acompanhando dependência de <pacote>"), para revisão do engenheiro-software.
 * Sem package.json do próprio agente (só o lock, ou package.json de outro dono) continua violação.
 * `alexandre` não precisa da regra (nunca viola por dono).
 * @param {{agente: string, resultado: {ok: any[], violacoes: any[], acompanhando?: any[]},
 *   workspaceSoBuilds?: boolean | (() => boolean)}} p
 */
export function lockAcompanhaDependencia({ agente, resultado, workspaceSoBuilds = false }) {
  const res = { ...resultado, violacoes: [...resultado.violacoes], acompanhando: [...(resultado.acompanhando || [])] };
  if (agente === 'alexandre') return res;
  const pacotes = [...new Set(res.ok.map((i) => pacoteDoPackageJson(i.caminho)).filter(Boolean))].sort();
  if (!pacotes.length) return res;
  let soBuilds;
  const workspaceOk = () => (soBuilds ??= Boolean(typeof workspaceSoBuilds === 'function' ? workspaceSoBuilds() : workspaceSoBuilds));
  const motivo = `lock acompanhando dependência de ${pacotes.join(', ')}`;
  res.violacoes = res.violacoes.filter((v) => {
    const acompanha = (v.caminho === LOCK_PNPM && (v.status === 'M' || v.status === 'A'))
      || (v.caminho === WORKSPACE_PNPM && v.status === 'M' && workspaceOk());
    if (!acompanha) return true;
    res.acompanhando.push({ ...v, pacotes, motivo: v.caminho === LOCK_PNPM ? motivo : `${motivo} (só ${CHAVES_DE_BUILD.join('/')})` });
    return false;
  });
  return res;
}

// ───────────────────── caminhos de governança (guardião v4, T-0005) ─────────────────────

/** Caminhos que exigem revisão humana (Alexandre) no PR: `coord.mjs governanca --base <ref>`. */
export const CAMINHOS_DE_GOVERNANCA = ['.claude/**', '.coord/donos.json', 'scripts/coord*.mjs', '.github/**'];

/** Mudanças em caminhos de governança, sem repetição (função pura). */
export function mudancasDeGovernanca(mudancas, padroes = CAMINHOS_DE_GOVERNANCA) {
  const res = padroes.map(globParaRegex);
  return [...mudancasUnicas(mudancas)].filter((m) => res.some((re) => re.test(m.caminho)));
}

/**
 * Agrupa as mudanças por dono, sem agente (`verificar` sem agente e sem --base, ou --por-dono).
 * Recados vão para o remetente e diário/lidos para o próprio agente.
 * `recados` (ADR 0035): no 'corte', a saída das pastas de recados vai para o grupo alexandre; no 'fora',
 * qualquer mudança nelas é violação.
 * @returns {{grupos: Record<string, any[]>, violacoes: any[]}}
 */
export function agruparPorDono({ mudancas, regras, recados = 'no-repo' }) {
  const grupos = {};
  const violacoes = [];
  for (const item of mudancasUnicas(mudancas)) {
    const fora = regraDosRecadosForaDoRepo(item.status, item.caminho, 'alexandre', recados);
    if (fora?.excecao) { (grupos.alexandre ||= []).push({ ...item, dono: 'alexandre' }); continue; }
    if (fora?.violacao) { violacoes.push({ ...item, dono: fora.dono, motivo: fora.violacao }); continue; }
    const info = donoDaMudanca(item.caminho, regras);
    const universal = violacaoUniversal(item.status, info);
    if (universal) violacoes.push({ ...item, dono: info.tipo.startsWith('recado') ? 'ninguém' : info.dono, motivo: universal });
    else (grupos[info.dono] ||= []).push({ ...item, dono: info.dono });
  }
  return { grupos, violacoes };
}

/**
 * Agente pelo nome do branch (função pura):
 *   <agente>/T-nnnn[-assunto]  ·  agente/T-nnnn-<agente>  ·  alexandre/...  → agente
 *   nuvem/...                  → { nuvem: true } (agente só pelo trailer "Agente:" de todos os commits)
 * @returns {{agente: string|null, erro?: string, nuvem?: boolean}}
 */
export function agenteDoBranch(branch) {
  const b = String(branch || '').replace(/^refs\/heads\//, '');
  if (!b || b === 'HEAD') return { agente: null };
  let m = b.match(/^agente\/T-\d+-(.+)$/i);
  if (m) {
    const nome = m[1].toLowerCase();
    return PESSOAS.includes(nome) ? { agente: nome } : { agente: null, erro: `o branch "${b}" indica o agente "${m[1]}", que não faz parte do time` };
  }
  if (/^alexandre\//i.test(b)) return { agente: 'alexandre' };
  m = b.match(/^([^/]+)\/T-\d+(?:[-/].*)?$/i);
  if (m && PESSOAS.includes(m[1].toLowerCase())) return { agente: m[1].toLowerCase() };
  if (/^nuvem\//i.test(b)) return { agente: null, nuvem: true };
  return { agente: null };
}

/**
 * Agente pelos trailers "Agente: <nome>" dos commits do PR (função pura).
 * Todos os commits precisam do trailer e com o mesmo agente.
 * @param {{sha: string, assunto?: string, corpo: string}[]} commits  (sem os commits de merge)
 * @returns {{agente: string|null, erro?: 'sem-trailer'|'parcial'|'ambiguo'|'invalido', mensagem?: string}}
 */
export function agenteDosTrailers(commits) {
  const nomes = [];
  const semTrailer = [];
  for (const c of commits) {
    const achados = [...String(c.corpo || '').matchAll(/^Agente:[ \t]*(\S+)[ \t]*$/gim)].map((a) => a[1]);
    if (!achados.length) { semTrailer.push(c); continue; }
    for (const n of achados) {
      if (!PESSOAS.includes(n.toLowerCase()))
        return { agente: null, erro: 'invalido', mensagem: `o trailer "Agente: ${n}" do commit ${String(c.sha).slice(0, 7)} não é um agente do time` };
      if (!nomes.includes(n.toLowerCase())) nomes.push(n.toLowerCase());
    }
  }
  if (nomes.length > 1) return { agente: null, erro: 'ambiguo', mensagem: `agente ambíguo: ${[...nomes].sort().join(', ')}` };
  if (!nomes.length) return { agente: null, erro: 'sem-trailer', mensagem: 'nenhum commit com o trailer "Agente: <nome>"' };
  if (semTrailer.length)
    return {
      agente: null, erro: 'parcial',
      mensagem: `commit(s) sem o trailer "Agente: ${nomes[0]}": ${semTrailer.map((c) => `${String(c.sha).slice(0, 7)}${c.assunto ? ` (${c.assunto})` : ''}`).join(', ')}`,
    };
  return { agente: nomes[0] };
}

/** Nomes dos trailers "Agente: <nome>" de uma mensagem de commit (minúsculos, sem repetição). */
export function trailersAgente(corpo) {
  const nomes = [];
  for (const a of String(corpo || '').matchAll(/^Agente:[ \t]*(\S+)[ \t]*$/gim)) {
    const n = a[1].toLowerCase();
    if (!nomes.includes(n)) nomes.push(n);
  }
  return nomes;
}

// ───────────────────── identificação do agente da sessão (guardião v4, T-0005) ─────────────────────

/**
 * Agente da sessão para os guardiões (.claude/hooks/guarda-donos.mjs e guarda-bash.mjs). Função pura.
 * Ordem (a primeira fonte que responde vence):
 *  1. SUBAGENTE (agent_id no JSON do hook): o agente do subagente (argumento do hook do frontmatter
 *     ou agent_type). Vence MACUXI_AGENTE, que todo subagente herda do processo do Claude Code: a
 *     variável vale só para a sessão principal. Subagente sem agente identificável → restrito.
 *  2. variável MACUXI_AGENTE (sessão principal);
 *  3. argumento do hook (frontmatter); agent_type numa sessão LOCAL (CLAUDE_CODE_REMOTE != "true");
 *     na nuvem, agent_type diferente do "agent" do .claude/settings.json (subagente sem agent_id);
 *  4. branch atual: <agente>/T-nnnn[-assunto], agente/T-nnnn-<agente> → agente do time;
 *     nuvem/* → trailer "Agente: <nome>" com UM ÚNICO nome em todos os commits do branch desde o
 *     main que têm o trailer (commits sem trailer não contam; nomes diferentes = ambíguo);
 *  5. fonte ausente, ambígua ou que declara "alexandre" → comportamento restrito: o agent_type da
 *     sessão; sem agent_type, sessão manual LOCAL = liberada (''); na nuvem, o "agent" do
 *     settings.json (ou 'sessao-sem-agente', fora do time).
 * "alexandre" só por fonte confiável: MACUXI_AGENTE=alexandre (ou a sessão manual local, que já é
 * liberada). Branch alexandre/* e trailer "Agente: alexandre" são declarados pelo próprio agente e
 * NÃO concedem a identidade alexandre (revisão do guardião v3, 🟡 2).
 * Na nuvem (claude.ai/code) a sessão principal recebe o agent_type do "agent" do settings.json
 * (gerente-projetos) seja qual for a tarefa; por isso lá o branch vem antes dele.
 * @param {object} p
 * @param {string} [p.argumento]      process.argv[2] do hook
 * @param {{agent_type?: string, agent_id?: string}} [p.entrada]  JSON do hook
 * @param {Record<string, string|undefined>} [p.env]
 * @param {string|null} [p.agentePadrao]  "agent" do .claude/settings.json
 * @param {() => (string|null)} [p.branch]   branch atual (null com HEAD destacado)
 * @param {() => {sha: string, corpo: string}[]} [p.commitsDoBranch]  do mais novo ao mais velho, sem merges
 * @returns {{agente: string, origem: string}}
 */
export function identificarAgente({ argumento = '', entrada = {}, env = {}, agentePadrao = null, branch = () => null, commitsDoBranch = () => [] } = {}) {
  const arg = String(argumento || '').trim();
  const tipo = String(entrada?.agent_type || '').trim();
  const subagente = Boolean(String(entrada?.agent_id || '').trim());
  const doEnv = String(env.MACUXI_AGENTE || '').trim().toLowerCase();
  const nuvem = String(env.CLAUDE_CODE_REMOTE || '').trim().toLowerCase() === 'true';
  if (subagente) {
    if (arg) return { agente: arg, origem: 'subagente (argumento do hook)' };
    if (tipo) return { agente: tipo, origem: 'subagente (agent_type)' };
    return { agente: SUBAGENTE_SEM_AGENTE, origem: 'subagente sem agent_type (restrito)' };
  }
  if (doEnv) return { agente: doEnv, origem: 'variável MACUXI_AGENTE' };
  if (arg) return { agente: arg, origem: 'argumento do hook' };
  if (tipo && !nuvem) return { agente: tipo, origem: 'sessão local (agent_type)' };
  if (tipo && agentePadrao && tipo !== agentePadrao) return { agente: tipo, origem: 'subagente (agent_type)' };
  let b = null;
  try { b = branch(); } catch { b = null; }
  let ignorado = '';
  if (b) {
    const r = agenteDoBranch(b);
    if (r.agente === 'alexandre') ignorado = ` (branch ${b} não concede alexandre)`;
    else if (r.agente) return { agente: r.agente, origem: `branch ${b}` };
    if (r.nuvem) {
      let commits = [];
      try { commits = commitsDoBranch() || []; } catch { commits = []; }
      const nomes = new Set(commits.flatMap((c) => trailersAgente(c.corpo)));
      const [nome] = [...nomes];
      if (nomes.size === 1 && nome === 'alexandre') ignorado = ` (trailer "Agente: alexandre" do branch ${b} não concede alexandre)`;
      else if (nomes.size === 1 && AGENTES.includes(nome)) return { agente: nome, origem: `trailer "Agente:" do branch ${b}` };
    }
  }
  if (tipo) return { agente: tipo, origem: `agent_type (fonte ausente ou ambígua)${ignorado}` };
  if (!nuvem) return { agente: '', origem: `sessão manual local${ignorado}` };
  return { agente: agentePadrao || SESSAO_SEM_AGENTE, origem: `sessão da nuvem sem agente (restrita)${ignorado}` };
}

/** Agentes "fora do time" usados quando não há identidade (os guardiões barram toda escrita no repositório). */
export const SUBAGENTE_SEM_AGENTE = 'subagente-sem-agente';
export const SESSAO_SEM_AGENTE = 'sessao-sem-agente';

function gitSilencioso(raiz, args) {
  try {
    return execFileSync('git', args, { cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, maxBuffer: 16 * 1024 * 1024 });
  } catch { return null; }
}

const lerTexto = (arq) => { try { return readFileSync(arq, 'utf8'); } catch { return null; } };

/**
 * Lê HEAD, branch e a base (origin/main, senão main) direto dos arquivos do .git, sem rodar o git
 * (rápido, para a chave do cache). Entende worktree (.git arquivo + commondir) e packed-refs.
 * @returns {{branch: string|null, head: string|null, base: string|null} | null}  null se não der para ler
 */
export function refsDoGit(raiz = RAIZ) {
  try {
    let gitdir = join(raiz, '.git');
    if (statSync(gitdir).isFile()) {
      const m = String(lerTexto(gitdir) || '').match(/^gitdir:[ \t]*(.+?)\s*$/m);
      if (!m) return null;
      gitdir = resolve(raiz, m[1]);
    }
    const cd = lerTexto(join(gitdir, 'commondir'))?.trim();
    const comum = cd ? resolve(gitdir, cd) : gitdir;
    const empacotados = lerTexto(join(comum, 'packed-refs')) || '';
    const ref = (nome) => {
      const solto = lerTexto(join(comum, nome))?.trim();
      if (solto && /^[0-9a-f]{40,64}$/i.test(solto)) return solto;
      for (const l of empacotados.split(/\r?\n/)) {
        const [sha, r] = l.trim().split(/\s+/);
        if (r === nome && /^[0-9a-f]{40,64}$/i.test(sha)) return sha;
      }
      return null;
    };
    const cabeca = lerTexto(join(gitdir, 'HEAD'))?.trim();
    if (!cabeca) return null;
    const m = cabeca.match(/^ref:[ \t]*(refs\/heads\/.+)$/);
    const branch = m ? m[1].slice('refs/heads/'.length) : null;
    const head = m ? ref(m[1]) : (/^[0-9a-f]{40,64}$/i.test(cabeca) ? cabeca : null);
    return { branch, head, base: ref('refs/remotes/origin/main') || ref('refs/heads/main') };
  } catch { return null; }
}

/** Branch atual do repositório (null com HEAD destacado ou fora do git). Lê o .git; senão, git rev-parse. */
export function branchAtual(raiz = RAIZ) {
  const refs = refsDoGit(raiz);
  if (refs) return refs.branch;
  const b = gitSilencioso(raiz, ['rev-parse', '--abbrev-ref', 'HEAD'])?.trim();
  return b && b !== 'HEAD' ? b : null;
}

/** Commits do branch pelo git (sem cache): desde origin/main (ou main); sem essas refs, só o último. */
function commitsDoBranchGit(raiz) {
  const base = ['origin/main', 'main'].find((r) => gitSilencioso(raiz, ['rev-parse', '--verify', '-q', `${r}^{commit}`]));
  const intervalo = base ? [`${base}..HEAD`] : ['-1', 'HEAD'];
  const out = gitSilencioso(raiz, ['log', '--no-merges', '--format=%H%x1f%B%x1e', ...intervalo]);
  if (out === null) return null;
  return out.split('\x1e').map((s) => s.replace(/^\n/, '')).filter(Boolean).map((s) => {
    const [sha, corpo] = s.split('\x1f');
    return { sha, corpo: corpo || '' };
  });
}

/** Pasta do cache de identificação (a mesma pasta temporária das fotos do guarda-bash). */
export const PASTA_CACHE = join(tmpdir(), 'macuxi-guarda');

/** Arquivo do cache de identificação do repositório `raiz`. */
export function arquivoCacheIdentificacao(raiz = RAIZ, pasta = PASTA_CACHE) {
  return join(pasta, `ident-${createHash('sha1').update(resolve(raiz)).digest('hex').slice(0, 24)}.json`);
}

/**
 * Commits do branch (sem merges, do mais novo ao mais velho): desde origin/main (ou main);
 * sem essas refs, só o último commit. Com cache por HEAD (+ base) num arquivo temporário: o
 * resultado do git rev-parse/log só é refeito quando o HEAD ou a base mudam (revisão v3, 🟢 4).
 * Do corpo de cada commit o cache guarda só as linhas "Agente:" (o que a identificação usa).
 */
export function commitsDoBranch(raiz = RAIZ, { pastaCache = PASTA_CACHE } = {}) {
  const refs = refsDoGit(raiz);
  const chave = refs?.head ? `${refs.head}|${refs.base || ''}` : null;
  const arq = chave ? arquivoCacheIdentificacao(raiz, pastaCache) : null;
  if (arq) {
    try {
      const c = JSON.parse(readFileSync(arq, 'utf8'));
      if (c && c.chave === chave && Array.isArray(c.commits)) return c.commits;
    } catch { /* sem cache ou ilegível: recalcula */ }
  }
  const commits = commitsDoBranchGit(raiz);
  if (commits === null) return [];
  if (arq) {
    const enxuto = commits.map((c) => ({ sha: c.sha, corpo: trailersAgente(c.corpo).map((n) => `Agente: ${n}`).join('\n') }));
    try {
      mkdirSync(pastaCache, { recursive: true });
      const tmp = `${arq}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ chave, commits: enxuto }));
      renameSync(tmp, arq);
    } catch { /* sem cache: segue sem ele */ }
    return enxuto;
  }
  return commits;
}

/** "agent" do .claude/settings.json (agente padrão da sessão principal), ou null. */
export function agentePadraoDaConfig(raiz = RAIZ) {
  try { return JSON.parse(readFileSync(join(raiz, '.claude', 'settings.json'), 'utf8')).agent || null; } catch { return null; }
}

/** identificarAgente com o git e o settings.json reais do repositório `raiz` (uso nos hooks). */
export function agenteDaSessao({ argumento, entrada, env = process.env, raiz = RAIZ } = {}) {
  return identificarAgente({
    argumento, entrada, env, agentePadrao: agentePadraoDaConfig(raiz),
    branch: () => branchAtual(raiz), commitsDoBranch: () => commitsDoBranch(raiz),
  });
}

// ───────────────────── recados direto no GitHub (T-0143, ADR 0039) ─────────────────────
// enviar e lido gravam direto no aloirr/macuxifdv-recados pela API do GitHub; caixa, pendencias, ler e fio leem o
// main do GitHub na hora. Sem clone, junção, Agendador nem sincronização. Sem dependências: o HTTP roda num processo
// filho do próprio Node (fetch), chamado de forma síncrona, para o coord.mjs e os guardiões continuarem síncronos.
// - Escrita: um commit por envio, pela mutação GraphQL createCommitOnBranch com expectedHeadOid (concorrência
//   otimista). Se outro agente gravou antes, o GitHub recusa; o coord relê e tenta de novo. O commit é atômico (todos
//   os destinos ou nenhum) e nunca sobrescreve: o id é escolhido contra a árvore daquele mesmo commit.
// - Leitura: índice local (cache fora do repositório) por commit. A cada leitura, compara o commit do cache com o main
//   (REST compare) e baixa só os arquivos novos (GraphQL, 100 por consulta). Os textos do cache são conferidos pelo
//   hash do git; a lista que autoriza merge (guarda-merge) vem sempre direto do GitHub.
// - Token só do ambiente: MACUXI_RECADOS_TOKEN, GH_TOKEN, GITHUB_TOKEN ou `gh auth token`. Nunca vai para arquivo,
//   argumento de processo ou log (vai ao processo filho pelo stdin).

export const REPO_RECADOS = 'aloirr/macuxifdv-recados';
export const BRANCH_RECADOS = 'main';
export const API_GITHUB = 'https://api.github.com';
export const MOTIVO_RECADOS_NO_GITHUB = 'os recados e os lidos ficam direto no GitHub (aloirr/macuxifdv-recados, ADR 0039): use node scripts/coord.mjs enviar ou lido; nada se grava em .coord/recados nem em .coord/lidos no disco';

/**
 * Onde estão os recados: 'github' (padrão quando o .gitignore tem a marca da ADR 0035) ou 'local' (pastas
 * .coord/recados e .coord/lidos no disco: antes do corte, testes e plano de volta). MACUXI_RECADOS=local|github força.
 */
export function modoDosRecados({ raiz = RAIZ, env = process.env } = {}) {
  const forcado = String(env.MACUXI_RECADOS || '').trim().toLowerCase();
  if (forcado === 'local' || forcado === 'github') return forcado;
  let gitignore = '';
  try { gitignore = readFileSync(join(raiz, '.gitignore'), 'utf8'); } catch { /* sem .gitignore: local */ }
  return recadosForaDoRepo(gitignore) ? 'github' : 'local';
}

export class ErroRecados extends Error {
  /** @param {string} mensagem @param {{rede?: boolean}} [o] rede = o GitHub não respondeu (vale a cópia local na leitura) */
  constructor(mensagem, { rede = false } = {}) { super(mensagem); this.name = 'ErroRecados'; this.rede = rede; }
}

/** Hash do git de um blob (sha1 de "blob <bytes>\0<conteúdo>"): confere o cache e reconhece o próprio envio. */
export function shaDoBlob(conteudo) {
  const b = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(String(conteudo), 'utf8');
  return createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
}

/** Arquivos que o coord lê no repositório de recados: recados/<destino>/<id>.md (sem anexos) e lidos/<agente>.txt. */
export const ehArquivoDoIndice = (p) => /^recados\/(?!anexos\/)[^/]+\/[^/]+\.md$/i.test(p) || /^lidos\/[^/]+\.txt$/i.test(p);

const SEM_TOKEN = 'sem token do GitHub: no PC, entre no gh (gh auth login); na nuvem e no CI, defina MACUXI_RECADOS_TOKEN (token fine-grained só com Contents: read and write no aloirr/macuxifdv-recados)';

/** Token do ambiente, nesta ordem: MACUXI_RECADOS_TOKEN, GH_TOKEN, GITHUB_TOKEN, `gh auth token`. Nunca é impresso. */
export function tokenDoAmbiente({ env = process.env, gh = ghAuthToken } = {}) {
  for (const k of ['MACUXI_RECADOS_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN']) {
    const v = String(env[k] || '').trim();
    if (v) return { token: v, origem: k };
  }
  const t = String(gh() || '').trim();
  return t ? { token: t, origem: 'gh auth token' } : null;
}
const executarGhAuthToken = () =>
  execFileSync('gh', ['auth', 'token', '--hostname', 'github.com'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000, windowsHide: true });
/** Espera síncrona sem gastar CPU (o coord é síncrono do começo ao fim). */
const esperarSincrono = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
/**
 * `gh auth token` com até 3 tentativas (espera de 1 s e depois 2 s): com vários agentes em paralelo, o chaveiro do
 * Windows às vezes nega a 1ª leitura (R-20261110-070316, aprovado no R-20261110-085951). Sem o gh instalado (ENOENT)
 * não insiste. Devolve '' se nenhuma tentativa der certo. O token nunca é impresso nem gravado.
 */
export function ghAuthToken({ executar = executarGhAuthToken, esperar = esperarSincrono, esperas = [1000, 2000] } = {}) {
  for (let i = 0; ; i++) {
    try {
      const t = String(executar() || '').trim();
      if (t) return t;
    } catch (e) {
      if (e && e.code === 'ENOENT') return '';
    }
    if (i >= esperas.length) return '';
    esperar(esperas[i]);
  }
}

// HTTP síncrono (fetch em paralelo, fora da thread principal). O núcleo recebe {token, reqs} e devolve
// [{status, texto} | {rede}]. O erro de rede traz só o tipo e o código, nunca cabeçalho nem token.
const NUCLEO_HTTP = `
async function executar({ token, reqs, concorrencia, timeoutMs }) {
  const res = new Array(reqs.length);
  let prox = 0;
  async function uma(k) {
    const r = reqs[k];
    const h = { 'user-agent': 'macuxi-coord', accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
    if (token) h.authorization = 'bearer ' + token;
    if (r.corpo !== undefined) h['content-type'] = 'application/json';
    try {
      const resp = await fetch(r.url, { method: r.metodo || 'GET', headers: h, body: r.corpo === undefined ? undefined : JSON.stringify(r.corpo), signal: AbortSignal.timeout(timeoutMs) });
      res[k] = { status: resp.status, texto: await resp.text() };
    } catch (e) {
      const c = e && e.cause;
      res[k] = { rede: [e && e.name, c && (c.code || c.message)].filter(Boolean).join(': ') || 'falha de rede' };
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concorrencia, reqs.length)) }, async () => { while (prox < reqs.length) await uma(prox++); }));
  return res;
}
`;
// Worker (padrão): sobe em milissegundos e reaproveita a conexão TLS entre as chamadas do mesmo comando.
const WORKER_HTTP = `${NUCLEO_HTTP}
const { workerData, parentPort } = require('node:worker_threads');
const { sinal, porta } = workerData;
parentPort.on('message', async (pedido) => {
  let res;
  try { res = await executar(pedido); } catch (e) { res = pedido.reqs.map(() => ({ rede: 'falha no fetch' })); }
  porta.postMessage(res);
  Atomics.store(sinal, 0, 1);
  Atomics.notify(sinal, 0);
});
`;
// Processo filho (com proxy no ambiente, como na nuvem): o fetch só usa HTTPS_PROXY com NODE_USE_ENV_PROXY=1 na partida.
const FILHO_HTTP = `${NUCLEO_HTTP}
import { readFileSync } from 'node:fs';
process.stdout.write(JSON.stringify(await executar(JSON.parse(readFileSync(0, 'utf8')))));
`;

const temProxy = (env) => ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'].some((k) => String(env[k] || '').trim());

/**
 * HTTP síncrono: (reqs: {url, metodo?, corpo?}[]) => ({status, texto} | {rede})[]. O token vai pela memória (worker)
 * ou pelo stdin (processo filho), nunca por argumento nem arquivo.
 */
export function httpSincrono({ token, timeoutMs = 30_000, concorrencia = 8, env = process.env } = {}) {
  const prazo = (n) => timeoutMs * (Math.ceil(n / concorrencia) + 1);
  const falha = (reqs, motivo) => reqs.map(() => ({ rede: motivo }));
  if (temProxy(env)) {
    return (reqs) => {
      if (!reqs.length) return [];
      try {
        const out = execFileSync(process.execPath, ['--input-type=module', '-e', FILHO_HTTP], {
          input: JSON.stringify({ token, reqs, concorrencia, timeoutMs }), encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'],
          maxBuffer: 512 * 1024 * 1024, timeout: prazo(reqs.length), windowsHide: true, env: { ...env, NODE_USE_ENV_PROXY: '1' },
        });
        return JSON.parse(out);
      } catch (e) {
        return falha(reqs, e?.code === 'ETIMEDOUT' ? 'tempo esgotado' : 'falha ao chamar o GitHub');
      }
    };
  }
  let w = null;
  let sinal;
  let porta;
  return (reqs) => {
    if (!reqs.length) return [];
    if (!w) {
      sinal = new Int32Array(new SharedArrayBuffer(4));
      const canal = new MessageChannel();
      porta = canal.port1;
      w = new Worker(WORKER_HTTP, { eval: true, workerData: { sinal, porta: canal.port2 }, transferList: [canal.port2] });
      w.unref();
    }
    Atomics.store(sinal, 0, 0);
    w.postMessage({ token, reqs, concorrencia, timeoutMs });
    if (Atomics.wait(sinal, 0, 0, prazo(reqs.length)) === 'timed-out') {
      w.terminate();
      w = null;
      return falha(reqs, 'tempo esgotado');
    }
    return receiveMessageOnPort(porta)?.message || falha(reqs, 'falha ao chamar o GitHub');
  };
}

const Q_CABECA = `query Cabeca($dono: String!, $nome: String!, $ref: String!) {
  repository(owner: $dono, name: $nome) { ref(qualifiedName: $ref) { target { oid } } } }`;
const Q_LISTAGEM = `query Listagem($dono: String!, $nome: String!, $ref: String!) {
  repository(owner: $dono, name: $nome) { ref(qualifiedName: $ref) { target { ... on Commit { oid
    recados: file(path: "recados") { object { ... on Tree { entries { name type oid object { ... on Tree { entries { name type oid } } } } } } }
    lidos: file(path: "lidos") { object { ... on Tree { entries { name type oid } } } }
  } } } } }`;
const Q_ARQUIVO = `query Arquivo($dono: String!, $nome: String!, $ref: String!, $caminho: String!) {
  repository(owner: $dono, name: $nome) { ref(qualifiedName: $ref) { target { ... on Commit { oid
    arquivo: file(path: $caminho) { oid object { ... on Blob { text } } }
  } } } } }`;
const Q_PASTA = `query Pasta($dono: String!, $nome: String!, $ref: String!, $caminho: String!) {
  repository(owner: $dono, name: $nome) { ref(qualifiedName: $ref) { target { ... on Commit { oid
    pasta: file(path: $caminho) { object { ... on Tree { entries { name type oid } } } }
  } } } } }`;
const M_COMMIT = `mutation CriarCommit($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid url } } }`;
const LOTE_DE_BLOBS = 100;

/**
 * Cliente da API do GitHub para o repositório de recados (síncrono). `http` é injetável (testes).
 * @param {{http: (reqs: any[]) => any[], repo?: string, api?: string, branch?: string, origem?: string}} p
 */
export function criarClienteDeRecados({ http, repo = REPO_RECADOS, api = API_GITHUB, branch = BRANCH_RECADOS, origem = 'token' }) {
  const [dono, nome] = repo.split('/');
  const ref = `refs/heads/${branch}`;
  const base = { dono, nome, ref };

  /** data do GraphQL; NOT_FOUND de arquivo (file(path:) inexistente) não é erro: o campo vem null. */
  function dados(r) {
    if (r.rede) throw new ErroRecados(`sem acesso ao GitHub (${r.rede})`, { rede: true });
    let j = null;
    try { j = JSON.parse(r.texto); } catch { /* abaixo */ }
    if (r.status === 401) throw new ErroRecados(`o GitHub recusou o token (${origem}, HTTP 401)`);
    if (r.status === 403 || r.status === 429) throw new ErroRecados(`o GitHub recusou o pedido (HTTP ${r.status}${j?.message ? `: ${j.message}` : ''})`, { rede: true });
    if (!j) throw new ErroRecados(`resposta inválida do GitHub (HTTP ${r.status})`, { rede: r.status >= 500 });
    const erros = (j.errors || []).filter((e) => !(e?.type === 'NOT_FOUND' && Array.isArray(e.path) && e.path.length > 3));
    if (erros.length) {
      if (erros.some((e) => e?.type === 'NOT_FOUND')) throw new ErroRecados(`o token (${origem}) não enxerga ${repo}: ${erros.map((e) => e.message).join('; ')}`);
      throw new ErroRecados(`GitHub: ${erros.map((e) => e?.message).join('; ')}`);
    }
    if (r.status >= 400 || !j.data) throw new ErroRecados(`GitHub: HTTP ${r.status}${j.message ? ` (${j.message})` : ''}`, { rede: r.status >= 500 });
    return j.data;
  }
  const gql = (consultas) => http(consultas.map((corpo) => ({ url: `${api}/graphql`, metodo: 'POST', corpo }))).map(dados);
  const alvo = (d) => {
    const t = d?.repository?.ref?.target;
    if (!t?.oid) throw new ErroRecados(`o branch ${branch} do ${repo} não foi encontrado`);
    return t;
  };

  return {
    repo,
    /** oid do commit no topo do main. */
    cabeca() { return alvo(gql([{ query: Q_CABECA, variables: base }])[0]).oid; },

    /** {oid, arquivos: {caminho: oid do blob}} do main, numa leitura só (consistente com o commit). */
    listar() {
      const t = alvo(gql([{ query: Q_LISTAGEM, variables: base }])[0]);
      const arquivos = {};
      for (const d of t.recados?.object?.entries || []) {
        if (d.type !== 'tree') continue;
        for (const f of d.object?.entries || []) {
          const caminho = `recados/${d.name}/${f.name}`;
          if (f.type === 'blob' && ehArquivoDoIndice(caminho)) arquivos[caminho] = f.oid;
        }
      }
      for (const f of t.lidos?.object?.entries || []) {
        const caminho = `lidos/${f.name}`;
        if (f.type === 'blob' && ehArquivoDoIndice(caminho)) arquivos[caminho] = f.oid;
      }
      return { oid: t.oid, arquivos };
    },

    /** Um arquivo no topo do main: {oid do commit, existe, blob, texto}. */
    arquivo(caminho) {
      const t = alvo(gql([{ query: Q_ARQUIVO, variables: { ...base, caminho } }])[0]);
      const a = t.arquivo;
      return { oid: t.oid, existe: Boolean(a), blob: a?.oid || null, texto: a?.object?.text ?? (a ? '' : null) };
    },

    /** Entradas de uma pasta no topo do main, direto do GitHub: {oid, entradas: [{name, type, oid}]}. */
    pasta(caminho) {
      const t = alvo(gql([{ query: Q_PASTA, variables: { ...base, caminho } }])[0]);
      return { oid: t.oid, entradas: t.pasta?.object?.entries || [] };
    },

    /** Textos dos blobs ({oid: texto}), 100 por consulta, consultas em paralelo. Binário fica de fora. */
    textos(oids) {
      const lista = [...new Set(oids)];
      const consultas = [];
      for (let i = 0; i < lista.length; i += LOTE_DE_BLOBS) {
        const lote = lista.slice(i, i + LOTE_DE_BLOBS);
        const vars = lote.map((_, k) => `$o${k}: GitObjectID!`).join(', ');
        const campos = lote.map((_, k) => `b${k}: object(oid: $o${k}) { ... on Blob { text isBinary } }`).join(' ');
        consultas.push({
          query: `query Blobs($dono: String!, $nome: String!, ${vars}) { repository(owner: $dono, name: $nome) { ${campos} } }`,
          variables: { dono, nome, ...Object.fromEntries(lote.map((o, k) => [`o${k}`, o])) },
          lote,
        });
      }
      const res = {};
      const respostas = gql(consultas.map(({ query, variables }) => ({ query, variables })));
      respostas.forEach((d, i) => consultas[i].lote.forEach((oid, k) => {
        const b = d?.repository?.[`b${k}`];
        if (b && !b.isBinary && typeof b.text === 'string') res[oid] = b.text;
      }));
      return res;
    },

    /**
     * Mudanças desde `de` até o main (REST compare): {oid, mudancas: [{status, filename, previous_filename, sha}]}.
     * null quando não dá para usar o delta (commit desconhecido, histórico reescrito, mais de 250 commits ou 300 arquivos).
     */
    comparar(de) {
      const [r] = http([{ url: `${api}/repos/${repo}/compare/${de}...${branch}` }]);
      if (r.rede) throw new ErroRecados(`sem acesso ao GitHub (${r.rede})`, { rede: true });
      if (r.status === 404 || r.status === 422) return null;
      let j = null;
      try { j = JSON.parse(r.texto); } catch { /* abaixo */ }
      if (r.status === 401) throw new ErroRecados(`o GitHub recusou o token (${origem}, HTTP 401)`);
      if (r.status >= 400 || !j) throw new ErroRecados(`GitHub: HTTP ${r.status}${j?.message ? ` (${j.message})` : ''}`, { rede: r.status >= 500 || r.status === 403 || r.status === 429 });
      if (j.status === 'identical') return { oid: de, mudancas: [] };
      const commits = j.commits || [];
      const arquivos = j.files || [];
      if (j.status !== 'ahead' || commits.length !== j.ahead_by || arquivos.length >= 300) return null;
      return { oid: commits[commits.length - 1].sha, mudancas: arquivos };
    },

    /** Um commit no main com os arquivos (atômico), só se o topo ainda for `esperado`. → {oid, url} */
    commitar({ esperado, adicoes, titulo, corpo = '' }) {
      const input = {
        branch: { repositoryNameWithOwner: repo, branchName: branch },
        expectedHeadOid: esperado,
        message: { headline: titulo, ...(corpo ? { body: corpo } : {}) },
        fileChanges: { additions: adicoes.map((a) => ({ path: a.caminho, contents: (Buffer.isBuffer(a.conteudo) ? a.conteudo : Buffer.from(String(a.conteudo), 'utf8')).toString('base64') })) },
      };
      const c = gql([{ query: M_COMMIT, variables: { input } }])[0]?.createCommitOnBranch?.commit;
      if (!c?.oid) throw new ErroRecados('o GitHub não devolveu o commit');
      return c;
    },
  };
}

/** Pasta do cache do índice (fora do repositório): MACUXI_RECADOS_CACHE, %LOCALAPPDATA% ou ~/.cache. */
export function pastaDoCacheDeRecados(env = process.env) {
  if (env.MACUXI_RECADOS_CACHE) return env.MACUXI_RECADOS_CACHE;
  return join(env.LOCALAPPDATA || env.XDG_CACHE_HOME || join(homedir() || tmpdir(), '.cache'), 'Macuxi', 'recados');
}

/** Cache do índice num arquivo JSON (gravação atômica; falha ao gravar só deixa a próxima leitura mais lenta). */
export function cacheDeRecadosEmArquivo(pasta, repo = REPO_RECADOS) {
  const arq = join(pasta, `${repo.replace(/[^a-z0-9]+/gi, '-')}.json`);
  return {
    arquivo: arq,
    ler() {
      try { const c = JSON.parse(readFileSync(arq, 'utf8')); return c && c.repo === repo ? c : null; } catch { return null; }
    },
    gravar(c) {
      try {
        mkdirSync(pasta, { recursive: true });
        const tmp = `${arq}.${process.pid}.tmp`;
        writeFileSync(tmp, JSON.stringify(c));
        renameSync(tmp, arq);
      } catch { /* outro processo gravando ao mesmo tempo, ou pasta sem permissão: segue sem cache */ }
    },
  };
}

/** Cache conferido: só os textos cujo hash bate com o oid (cache adulterado ou corrompido não entra). */
function cacheConferido(c) {
  if (!c || typeof c.oid !== 'string' || !c.arquivos || typeof c.arquivos !== 'object') return null;
  const textos = {};
  for (const [oid, t] of Object.entries(c.textos || {})) if (typeof t === 'string' && shaDoBlob(t) === oid) textos[oid] = t;
  return { ...c, textos };
}

/** Aplica o delta do compare à lista de arquivos (função pura). */
export function aplicarMudancas(arquivos, mudancas) {
  const r = { ...arquivos };
  for (const m of mudancas || []) {
    if (m.previous_filename) delete r[m.previous_filename];
    if (m.status === 'removed') { delete r[m.filename]; continue; }
    if (ehArquivoDoIndice(m.filename) && m.sha) r[m.filename] = m.sha;
    else delete r[m.filename];
  }
  return r;
}

/**
 * Índice do main do GitHub: {oid, arquivos, textos, em, online, aviso?}. Usa o cache e baixa só o que mudou.
 * Sem GitHub: devolve o cache com `online: false` e um aviso, exceto com `exigirOnline` (escrita), que lança.
 */
export function atualizarIndiceDeRecados({ cliente, cache, exigirOnline = false, agora = () => new Date() }) {
  const salvo = cacheConferido(cache.ler());
  try {
    let atual = null;
    if (salvo) {
      const d = cliente.comparar(salvo.oid);
      if (d) atual = { oid: d.oid, arquivos: aplicarMudancas(salvo.arquivos, d.mudancas) };
    }
    atual ||= cliente.listar();
    const textos = {};
    const faltam = [];
    for (const oid of new Set(Object.values(atual.arquivos))) {
      if (salvo?.textos[oid] !== undefined) textos[oid] = salvo.textos[oid];
      else faltam.push(oid);
    }
    Object.assign(textos, cliente.textos(faltam));
    const idx = { repo: cliente.repo, oid: atual.oid, arquivos: atual.arquivos, textos, em: agora().toISOString() };
    if (!salvo || salvo.oid !== idx.oid || faltam.length) cache.gravar(idx);
    return { ...idx, online: true };
  } catch (e) {
    if (!(e instanceof ErroRecados) || exigirOnline || !salvo) throw e;
    return { ...salvo, online: false, aviso: `sem o GitHub agora (${e.message}): mostrando a cópia local de ${salvo.em} (commit ${salvo.oid.slice(0, 7)})` };
  }
}

/** Arquivos de recado do índice: [{destino, nome, texto}] (textos ausentes ficam de fora). */
export function recadosDoIndice(idx) {
  const res = [];
  for (const [caminho, oid] of Object.entries(idx.arquivos)) {
    const m = caminho.match(/^recados\/([^/]+)\/([^/]+\.md)$/i);
    const texto = idx.textos[oid];
    if (m && m[1] !== 'anexos' && typeof texto === 'string') res.push({ destino: m[1], nome: m[2], texto });
  }
  return res;
}

/** Ids dos recados do índice (nome do arquivo sem .md: o coord, o formulário e o Telegram gravam <id>.md). */
export const idsDoIndice = (idx) => new Set(recadosDoIndice(idx).map((r) => r.nome.replace(/\.md$/i, '')));

/** Texto de lidos/<agente>.txt no índice ('' se não houver). */
export const lidosDoIndice = (idx, agente) => idx.textos[idx.arquivos[`lidos/${agente}.txt`]] ?? '';

/** Espera síncrona (entre tentativas). */
export function dormir(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, ms)); }
const espera = (t) => 250 * t + Math.floor(Math.random() * 500);

/**
 * Envia um recado direto ao GitHub (um commit com um arquivo por destino). Só devolve depois de o GitHub confirmar.
 * `gerarId(ids)` escolhe o id livre contra os ids do commit; `montar(id)` dá o conteúdo. Concorrência: se o main
 * mudar entre a leitura e o commit, o GitHub recusa (expectedHeadOid) e a função relê e tenta de novo.
 * @returns {{id: string, commit: {oid: string, url?: string}, tentativas: number, conferido?: boolean}}
 */
export function enviarRecadoNoGitHub({ cliente, cache, de, destinos, gerarId, montar, respondeA = null, tentativas = 6, esperar = dormir }) {
  let ultimo = null;
  for (let t = 1; t <= tentativas; t++) {
    const idx = atualizarIndiceDeRecados({ cliente, cache, exigirOnline: true });
    const ids = idsDoIndice(idx);
    if (respondeA && !ids.has(respondeA)) throw new ErroRecados(`--responde-a: recado ${respondeA} não encontrado`);
    const id = gerarId(ids);
    const conteudo = montar(id);
    const adicoes = destinos.map((d) => ({ caminho: `recados/${d}/${id}.md`, conteudo }));
    if (adicoes.some((a) => idx.arquivos[a.caminho])) throw new ErroRecados(`o recado ${id} já existe no GitHub (nada foi sobrescrito)`);
    try {
      const commit = cliente.commitar({ esperado: idx.oid, adicoes, titulo: `recados: ${id}`, corpo: `de ${de} para ${destinos.join(', ')}` });
      const blob = shaDoBlob(conteudo);
      cache.gravar({
        repo: idx.repo, oid: commit.oid, em: new Date().toISOString(),
        arquivos: { ...idx.arquivos, ...Object.fromEntries(adicoes.map((a) => [a.caminho, blob])) }, textos: { ...idx.textos, [blob]: conteudo },
      });
      return { id, commit, tentativas: t };
    } catch (e) {
      if (!(e instanceof ErroRecados)) throw e;
      ultimo = e;
      // Confere no GitHub antes de decidir: com a resposta perdida, o commit pode ter entrado.
      let r;
      try { r = cliente.arquivo(adicoes[0].caminho); } catch (e2) {
        throw new ErroRecados(`o envio do recado ${id} NÃO foi confirmado (${e.message}; conferência: ${e2.message}). Antes de reenviar, confira: node scripts/coord.mjs ler ${id}`, { rede: true });
      }
      if (r.existe && r.blob === shaDoBlob(conteudo)) return { id, commit: { oid: r.oid }, tentativas: t, conferido: true };
      if (r.oid !== idx.oid) { esperar(espera(t)); continue; } // outro commit entrou antes: relê e tenta de novo
      throw new ErroRecados(`recado NÃO enviado (nada foi gravado): ${e.message}`, { rede: e.rede });
    }
  }
  throw new ErroRecados(`recado NÃO enviado (nada foi gravado): o main do ${cliente.repo} mudou ${tentativas} vezes durante o envio${ultimo ? ` (${ultimo.message})` : ''}. Tente de novo`);
}

/**
 * Marca ids como lidos em lidos/<agente>.txt no GitHub: acrescenta só os que faltam, sobre o texto do topo do main
 * (nenhuma linha de outro processo se perde: se o main mudar no meio, o GitHub recusa e a função relê).
 * @returns {{novos: string[], commit?: {oid: string}, conferido?: boolean}}
 */
export function marcarLidosNoGitHub({ cliente, agente, ids, tentativas = 6, esperar = dormir }) {
  const caminho = `lidos/${agente}.txt`;
  const linhas = (t) => new Set(String(t || '').split(/\r?\n/).filter(Boolean));
  let ultimo = null;
  for (let t = 1; t <= tentativas; t++) {
    const a = cliente.arquivo(caminho);
    const atuais = linhas(a.texto);
    const novos = [...new Set(ids)].filter((i) => !atuais.has(i));
    if (!novos.length) return { novos };
    const texto = a.texto || '';
    const conteudo = `${texto}${texto && !texto.endsWith('\n') ? '\n' : ''}${novos.join('\n')}\n`;
    try {
      return { novos, commit: cliente.commitar({ esperado: a.oid, adicoes: [{ caminho, conteudo }], titulo: `lidos: ${agente} (${novos.length})` }) };
    } catch (e) {
      if (!(e instanceof ErroRecados)) throw e;
      ultimo = e;
      let r;
      try { r = cliente.arquivo(caminho); } catch (e2) {
        throw new ErroRecados(`a marcação NÃO foi confirmada (${e.message}; conferência: ${e2.message}). Rode o mesmo comando de novo (marcar duas vezes não duplica)`, { rede: true });
      }
      const agora = linhas(r.texto);
      if (novos.every((i) => agora.has(i))) return { novos, commit: { oid: r.oid }, conferido: true };
      if (r.oid !== a.oid) { esperar(espera(t)); continue; }
      throw new ErroRecados(`NÃO marcado (nada foi gravado): ${e.message}`, { rede: e.rede });
    }
  }
  throw new ErroRecados(`NÃO marcado (nada foi gravado): o main do ${cliente.repo} mudou ${tentativas} vezes durante a marcação${ultimo ? ` (${ultimo.message})` : ''}. Tente de novo`);
}

/**
 * Recados de uma pasta (nome + texto) com a lista lida direto do GitHub, nunca do cache: uso do guarda-merge, que
 * procura a autorização de merge do dono do produto. Textos do cache só entram se o hash bater com o oid do GitHub.
 * `filtro(nome)` limita o que é baixado. Sem GitHub, lança (quem chama trata como "nenhuma autorização").
 */
export function recadosDaPastaNoGitHub({ cliente, cache, pasta, filtro = () => true }) {
  const { entradas } = cliente.pasta(`recados/${pasta}`);
  const escolhidas = entradas.filter((e) => e.type === 'blob' && /\.md$/i.test(e.name) && filtro(e.name));
  const salvo = cacheConferido(cache?.ler?.() || null);
  const textos = {};
  for (const e of escolhidas) if (salvo?.textos[e.oid] !== undefined) textos[e.oid] = salvo.textos[e.oid];
  Object.assign(textos, cliente.textos(escolhidas.filter((e) => textos[e.oid] === undefined).map((e) => e.oid)));
  return escolhidas.filter((e) => typeof textos[e.oid] === 'string').map((e) => ({ nome: e.name, texto: textos[e.oid] }));
}

/**
 * Conexão real com o repositório de recados: {cliente, cache}. Repositório, API e cache trocáveis por variável
 * (MACUXI_RECADOS_REPO, MACUXI_RECADOS_API, MACUXI_RECADOS_CACHE). Sem token, o cliente falha com a explicação.
 */
export function conexaoDeRecados({ env = process.env, gh } = {}) {
  const repo = String(env.MACUXI_RECADOS_REPO || REPO_RECADOS).trim();
  const api = String(env.MACUXI_RECADOS_API || API_GITHUB).trim().replace(/\/+$/, '');
  const tk = tokenDoAmbiente({ env, ...(gh ? { gh } : {}) });
  const http = tk ? httpSincrono({ token: tk.token, env }) : () => { throw new ErroRecados(SEM_TOKEN, { rede: true }); };
  return { cliente: criarClienteDeRecados({ http, repo, api, origem: tk?.origem || 'sem token' }), cache: cacheDeRecadosEmArquivo(pastaDoCacheDeRecados(env), repo) };
}
