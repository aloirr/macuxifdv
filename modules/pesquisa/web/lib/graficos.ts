/**
 * Dados dos gráficos por pergunta (RF-PES-06) a partir do resultado da API: barras com contagem e percentual para
 * sim/não, única, múltipla e escala; resumo em texto para número, data, foto, código e texto. Puro e testado.
 */
import type { ResultadoPergunta } from '../../contracts';

export interface BarraGrafico {
  rotulo: string;
  contagem: number;
  /** 0–100 (largura da barra); `null` sem respondentes. */
  pct: number | null;
}

const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

export function barrasDaPergunta(p: ResultadoPergunta): BarraGrafico[] {
  if (p.tipo === 'sim_nao' || p.tipo === 'unica' || p.tipo === 'multipla') return p.opcoes.map((o) => ({ rotulo: o.rotulo, contagem: o.contagem, pct: o.pct }));
  if (p.tipo === 'escala') return p.distribuicao.map((d) => ({ rotulo: String(d.valor), contagem: d.contagem, pct: p.respondentes ? Math.round((d.contagem / p.respondentes) * 10000) / 100 : null }));
  return [];
}

export function resumoDaPergunta(p: ResultadoPergunta): string {
  const quantos = `${p.respondentes} ${p.respondentes === 1 ? 'resposta' : 'respostas'}`;
  switch (p.tipo) {
    case 'numero':
    case 'escala':
      return p.media === null ? quantos : `${quantos} · média ${fmt(p.media)} · mín. ${fmt(p.minimo ?? 0)} · máx. ${fmt(p.maximo ?? 0)}`;
    case 'data':
      return p.mais_antiga ? `${quantos} · de ${br(p.mais_antiga)} a ${br(p.mais_recente ?? p.mais_antiga)}` : quantos;
    case 'foto':
      return `${quantos} · ${p.total_fotos} ${p.total_fotos === 1 ? 'foto' : 'fotos'}`;
    case 'codigo_barras':
      return `${quantos} · ${p.codigos_distintos} ${p.codigos_distintos === 1 ? 'código distinto' : 'códigos distintos'}`;
    case 'texto':
      return `${quantos} · veja o texto na lista de respostas`;
    default:
      return quantos;
  }
}

const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** Texto da taxa de resposta: sem universo do público, explica por que não há taxa. */
export function textoTaxa(taxa: number | null): string {
  return taxa === null ? '—' : `${fmt(taxa)}%`;
}
