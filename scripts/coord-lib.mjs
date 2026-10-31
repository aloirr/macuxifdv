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
