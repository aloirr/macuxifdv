/**
 * Visão da tela Indicadores do BKO (T-0020 fase 1): funções puras sobre `GET /v1/core/indicadores`. Os textos vêm de
 * `app/lib/metas-formato`, os mesmos do app, então o número que o supervisor vê é o que o vendedor vê no aparelho.
 */
import type { IndicadoresLista } from '../../contracts';
import { formatarIndicador, textoDaLinha, textoNecessidadeDiaria } from '../../app/lib/metas-formato';

const BOM = String.fromCharCode(0xfeff);
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

export const CABECALHO = ['Vendedor ou promotor', 'Visitados', 'Cobertura', 'Positivados', 'Realizado', 'Meta de venda', 'Atingimento', 'Necessidade diária'];

export function csvDeIndicadores(l: IndicadoresLista): string {
  const linhas = l.itens.map((u) => celulasDoUsuario(u).map(aspas).join(';'));
  return BOM + `${[CABECALHO.map(aspas).join(';'), ...linhas].join('\r\n')}\r\n`;
}

/** Valor mensal em reais digitado → centavos inteiros (vírgula ou ponto); inválido → null. */
export function centavosDoTexto(texto: string): number | null {
  const limpo = texto.trim().replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(limpo)) return null;
  return Math.round(Number(limpo) * 100);
}
