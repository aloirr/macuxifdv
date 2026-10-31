// Biblioteca comum do protocolo de coordenação do time Macuxi.
// Usada pelo guardião (.claude/hooks/guarda-donos.mjs) e pela CLI (scripts/coord.mjs).
// Sem dependências externas.
import { readFileSync, existsSync } from 'node:fs';
import { join, relative, isAbsolute, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const AGENTES = [
  'gerente-projetos',
  'engenheiro-software',
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
];
/** Pode responder pelo próprio diário/lidos e aparecer como dono em `verificar`. */
export const PESSOAS = [...AGENTES, 'alexandre'];
export const DESTINOS = [...AGENTES, 'alexandre', 'todos'];
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

/** Primeira regra que casa vence. */
export function donoDe(rel, regras) {
  for (const r of regras) if (r.re.test(rel)) return r.dono;
  return 'sem-dono';
}

/**
 * Decide se o agente pode alterar o arquivo.
 * @returns {{ok: boolean, motivo?: string, dono?: string}}
 */
export function podeAlterar({ agente, ferramenta, rel, raiz = RAIZ, regras = carregarDonos(raiz) }) {
  // Recados: só criar arquivo novo, na pasta de um destino válido, com o próprio nome no id.
  const mRecado = rel.match(/^\.coord\/recados\/([^/]+)\/([^/]+)$/i);
  if (mRecado) {
    const [, destino, arquivo] = mRecado;
    if (!DESTINOS.includes(destino)) return { ok: false, motivo: `destino de recado inválido: ${destino}` };
    if (ferramenta !== 'Write' || existsSync(join(raiz, rel)))
      return { ok: false, motivo: 'recados são imutáveis: responda com um recado novo (node scripts/coord.mjs enviar --responde-a <id>)' };
    if (!arquivo.toLowerCase().includes(`-${agente}`))
      return { ok: false, motivo: `o nome do recado precisa conter o remetente (-${agente}). Use node scripts/coord.mjs enviar` };
    return { ok: true };
  }
  if (rel.startsWith('.coord/recados/')) return { ok: false, motivo: 'use node scripts/coord.mjs enviar para criar recados' };

  // Diário e marcação de lidos: só o próprio agente.
  const mDiario = rel.match(/^\.coord\/(diario|lidos)\/([^/.]+)\.(md|txt)$/i);
  if (mDiario) {
    return mDiario[2] === agente
      ? { ok: true }
      : { ok: false, motivo: `o diário/lidos de ${mDiario[2]} pertence a ${mDiario[2]}` };
  }

  const dono = donoDe(rel, regras);
  if (dono === agente) return { ok: true, dono };
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

/** Normaliza caminho vindo do git ou do Windows: barras "/", sem "./" no início. */
export function normalizarCaminho(caminho) {
  return String(caminho).replace(/\\/g, '/').replace(/^(\.\/)+/, '');
}

/** Remetente pelo nome do arquivo do recado (R-AAAAMMDD-HHMMSS[-n]-<remetente>.md); null se não houver. */
export function remetenteDoRecado(arquivo) {
  const nome = String(arquivo).replace(/\.md$/i, '').toLowerCase();
  return [...PESSOAS].sort((a, b) => b.length - a.length).find((p) => nome.endsWith(`-${p}`)) || null;
}

/**
 * De quem é a mudança, pelas regras do protocolo (função pura):
 * recado → remetente do nome do arquivo; diário/lidos → o próprio agente; resto → donos.json.
 * @returns {{tipo: 'recado'|'recado-fora'|'diario'|'lidos'|'comum', dono: string, destino?: string, arquivo?: string}}
 */
export function donoDaMudanca(caminho, regras) {
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
 * @param {{agente: string, mudancas: {status: string, caminho: string}[], regras: any[], estrito?: boolean}} p
 * @returns {{ok: any[], excecoes: any[], outros: any[], violacoes: any[]}}
 */
export function classificarMudancas({ agente, mudancas, regras, estrito = false }) {
  const res = { ok: [], excecoes: [], outros: [], violacoes: [] };
  for (const item of mudancasUnicas(mudancas)) {
    const info = donoDaMudanca(item.caminho, regras);
    const universal = violacaoUniversal(item.status, info);
    if (universal) {
      res.violacoes.push({ ...item, dono: info.tipo.startsWith('recado') ? 'ninguém' : info.dono, motivo: universal });
      continue;
    }
    const { dono } = info;
    const proprio = dono === agente || (info.tipo === 'recado' && info.arquivo.toLowerCase().includes(`-${agente}`));
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
  return res;
}

/**
 * Agrupa as mudanças por dono, sem agente (`verificar` sem agente e sem --base, ou --por-dono).
 * Recados vão para o remetente e diário/lidos para o próprio agente.
 * @returns {{grupos: Record<string, any[]>, violacoes: any[]}}
 */
export function agruparPorDono({ mudancas, regras }) {
  const grupos = {};
  const violacoes = [];
  for (const item of mudancasUnicas(mudancas)) {
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
