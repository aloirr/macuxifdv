/**
 * Visão da tela Indicadores do BKO (T-0020 fase 1): funções puras sobre `GET /v1/core/indicadores`. Os textos vêm de
 * `app/lib/metas-formato`, os mesmos do app, então o número que o supervisor vê é o que o vendedor vê no aparelho.
 */
import { BOM_CSV } from '@macuxi/comum/csv';
import { formatBRL0 } from '@macuxi/comum';
import type { IndicadoresLista } from '../../contracts';
import { formatarIndicador, textoDaLinha, textoNecessidadeDiaria } from '../../app/lib/metas-formato';

const aspas = (v: string) => `"${v.replace(/"/g, '""')}"`;

export type LinhaDaTabela = IndicadoresLista['itens'][number];

/** Colunas da tabela por usuário (mesma ordem do CSV). */
export function celulasDoUsuario(u: LinhaDaTabela): string[] {
  const i = u.indicadores;
  const venda = u.metas.find((m) => m.indicador === 'venda_cents');
  return [
    u.usuario_nome,
    `${i.visitados} de ${i.planejados}`,
    formatarIndicador('cobertura_pct', i.cobertura_pct),
    formatarIndicador('positivacao', i.positivados ?? null),
    formatarIndicador('venda_cents', i.realizado_cents ?? null),
    venda ? formatarIndicador('venda_cents', venda.meta) : '—',
    venda ? textoDaLinha(venda).atingimento : '—',
    textoNecessidadeDiaria({ meta_cents: i.meta_cents ?? null, necessidade_diaria_cents: i.necessidade_diaria_cents ?? null, dias_uteis_restantes: i.dias_uteis_restantes, realizado_cents: i.realizado_cents ?? null }),
  ];
}

/** Título da coluna "por dia útil" da tela: os dias restantes (do primeiro item) vão no título, não em cada célula (RD-0419). */
export function tituloPorDiaUtil(itens: LinhaDaTabela[]): string {
  const dias = itens[0]?.indicadores.dias_uteis_restantes;
  return dias === undefined ? 'Por dia útil' : `Por dia útil (${dias} restantes)`;
}

/** Célula da coluna "por dia útil" da tela: só o valor, "Batida" com a meta atingida ou "—" sem meta (RD-0419). O CSV mantém a frase longa. */
export function celulaPorDiaUtil(u: LinhaDaTabela): string {
  const i = u.indicadores;
  if (i.meta_cents == null || i.realizado_cents == null || i.dias_uteis_restantes <= 0) return '—';
  const n = i.necessidade_diaria_cents ?? 0;
  return n === 0 ? 'Batida' : formatBRL0(n);
}

export const CABECALHO = ['Vendedor ou promotor', 'Visitados', 'Cobertura', 'Positivados', 'Realizado', 'Meta de venda', 'Atingimento', 'Necessidade diária'];

export function csvDeIndicadores(l: IndicadoresLista): string {
  const linhas = l.itens.map((u) => celulasDoUsuario(u).map(aspas).join(';'));
  return BOM_CSV + `${[CABECALHO.map(aspas).join(';'), ...linhas].join('\r\n')}\r\n`;
}
