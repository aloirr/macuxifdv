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

/** Pode responder pelo próprio diário/lidos e aparecer como dono em `verificar`. */
export const PESSOAS = [...AGENTES, 'alexandre'];

/**
 * Classifica as mudanças do git para `coord.mjs verificar` (função pura, sem ler disco).
 * - estrito (com --base): arquivo de outro dono é VIOLAÇÃO.
 * - não estrito (sem --base, árvore compartilhada): arquivo de outro dono é informativo.
 * - "alexandre" (dono do produto) nunca viola por mexer em arquivo de outro dono.
 * - sem-dono, congelado, recado alterado/apagado ou fora do padrão: sempre VIOLAÇÃO.
 * Exceções universais (iguais às do guardião): recado NOVO em .coord/recados/<destino>/,
 * .coord/diario/<agente>.md e .coord/lidos/<agente>.txt do próprio agente.
 * @param {{agente: string, mudancas: {status: string, caminho: string}[], regras: any[], estrito?: boolean}} p
 * @returns {{ok: any[], excecoes: any[], outros: any[], violacoes: any[]}}
 */
export function classificarMudancas({ agente, mudancas, regras, estrito = false }) {
  const res = { ok: [], excecoes: [], outros: [], violacoes: [] };
  const vistos = new Set();
  for (const m of mudancas) {
    const caminho = normalizarCaminho(m.caminho);
    if (!caminho || vistos.has(caminho)) continue;
    vistos.add(caminho);
    const status = String(m.status || 'M').charAt(0).toUpperCase();
    const item = { status, caminho };
    const violar = (dono, motivo) => res.violacoes.push({ ...item, dono, motivo });

    const mRecado = caminho.match(/^\.coord\/recados\/([^/]+)\/([^/]+)$/i);
    if (mRecado) {
      const destino = mRecado[1];
      if (status !== 'A') violar('ninguém', `recados são imutáveis (${status === 'D' ? 'apagado' : 'alterado'}): responda com um recado novo`);
      else if (!DESTINOS.includes(destino)) violar('ninguém', `destino de recado inválido: ${destino}`);
      else res.excecoes.push({ ...item, motivo: `recado novo para ${destino}` });
      continue;
    }
    if (/^\.coord\/recados\//i.test(caminho)) {
      violar('ninguém', 'fora do padrão .coord/recados/<destino>/<id>.md (use node scripts/coord.mjs enviar)');
      continue;
    }

    let dono;
    const mDiario = caminho.match(/^\.coord\/(diario|lidos)\/([^/.]+)\.(md|txt)$/i);
    if (mDiario && PESSOAS.includes(mDiario[2])) {
      if (mDiario[2] === agente) {
        res.excecoes.push({ ...item, motivo: mDiario[1] === 'diario' ? 'diário do próprio agente' : 'lidos do próprio agente' });
        continue;
      }
      dono = mDiario[2];
    } else dono = donoDe(caminho, regras);

    if (dono === 'sem-dono') violar(dono, 'caminho sem dono em .coord/donos.json: mande recado ao gerente-projetos');
    else if (dono === 'congelado') violar(dono, 'área congelada: ninguém altera');
    else if (dono === agente) res.ok.push({ ...item, dono });
    else if (!estrito || agente === 'alexandre') res.outros.push({ ...item, dono });
    else violar(dono, `fora dos caminhos de ${agente}; peça ao dono por recado (node scripts/coord.mjs enviar --de ${agente} --para ${dono} --tipo pedido ...)`);
  }
  return res;
}
