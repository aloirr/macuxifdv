/**
 * Troca de prazo (RN-VEN-44, T-0188): o item guarda o preço final em centavos. Trocar o prazo mantém esse preço final,
 * muda só a tabela (a original do produto ajustada pelo % do prazo novo, RN-VEN-43) e refaz o desconto ou acréscimo
 * do item a partir dele. Funções puras, as mesmas no aparelho e na API.
 */
import type { AjusteItem } from './preco-pedido';

/** O ajuste do item em R$ por unidade da medida vendida (o `AjusteItem` em valor). */
export type AjusteEmValor = Extract<NonNullable<AjusteItem>, { em: 'valor' }>;

function exigirCentavos(n: number, nome: string): void {
  if (!Number.isInteger(n) || n < 0) throw new Error(`RN-VEN-44: ${nome} inválido.`);
}

/**
 * RN-VEN-44: o ajuste do item, em R$ por unidade da medida vendida, que leva a tabela nova ao preço final guardado.
 * Final abaixo da tabela = desconto; acima = acréscimo; igual = sem ajuste.
 */
export function ajusteMantendoPrecoFinal(tabela_cents: number, preco_final_cents: number): AjusteEmValor | null {
  exigirCentavos(tabela_cents, 'preço de tabela');
  exigirCentavos(preco_final_cents, 'preço final');
  if (preco_final_cents === tabela_cents) return null;
  return preco_final_cents < tabela_cents
    ? { sentido: 'desconto', em: 'valor', cents: tabela_cents - preco_final_cents }
    : { sentido: 'acrescimo', em: 'valor', cents: preco_final_cents - tabela_cents };
}

/**
 * RN-VEN-44: o ajuste de cada linha na troca de prazo. `antes` traz o preço final no prazo anterior; `depois`, a tabela
 * no prazo novo. Linha que não está nos dois lados fica de fora.
 */
export function ajustesNaTrocaDePrazo(
  antes: ReadonlyArray<{ chave: string; preco_unitario_cents: number }>,
  depois: ReadonlyArray<{ chave: string; preco_tabela_cents: number }>,
): Record<string, AjusteEmValor | null> {
  const final = new Map(antes.map((l) => [l.chave, l.preco_unitario_cents]));
  const out: Record<string, AjusteEmValor | null> = {};
  for (const l of depois) {
    const f = final.get(l.chave);
    if (f !== undefined) out[l.chave] = ajusteMantendoPrecoFinal(l.preco_tabela_cents, f);
  }
  return out;
}

/**
 * RN-VEN-18/43/44: o preço de tabela por unidade de UM item no prazo do documento e o % que ainda se aplica a ele.
 * - Item novo: preço e faixas de hoje, com o % do prazo.
 * - Item do orçamento (`congelado_cents`), no prazo em que foi gravado (`congelado_bp`): o preço salvo, já ajustado; não ajusta de novo.
 * - Item do orçamento em outro prazo: a tabela original do produto com o % novo (RN-VEN-44); voltar ao prazo do orçamento devolve o congelado.
 * - Sem `congelado_bp` (rascunho anterior à T-0188): o preço salvo vale em qualquer prazo.
 */
export function precoDoItemNoPrazo<F>(i: { congelado_cents?: number | null; congelado_bp?: number; hoje_cents: number | null; faixas_hoje?: F; percentual_ajuste_bp: number }): {
  preco_unidade_cents: number | null;
  faixas: F | undefined;
  congelado: boolean;
  percentual_ajuste_bp: number;
} {
  if (i.congelado_cents != null && (i.congelado_bp === undefined || i.congelado_bp === i.percentual_ajuste_bp)) {
    return { preco_unidade_cents: i.congelado_cents, faixas: undefined, congelado: true, percentual_ajuste_bp: 0 };
  }
  return { preco_unidade_cents: i.hoje_cents, faixas: i.faixas_hoje, congelado: false, percentual_ajuste_bp: i.percentual_ajuste_bp };
}

/** RN-VEN-45: o prazo e o % gravados no orçamento ou no pedido (retrato `pedido.prazo_percentual_ajuste`). */
export interface PrazoGravado {
  prazo_id: string | null | undefined;
  percentual: number | null | undefined;
}

/**
 * RN-VEN-43/44/45: o % do prazo que vale no documento. No prazo em que o documento foi gravado, o % gravado, mesmo que o
 * ERP tenha mudado depois; em outro prazo, o vigente. Sem retrato, o vigente. A mesma no aparelho e na API.
 */
export function percentualDoPrazoNoDocumento(i: { prazo_id: string | null | undefined; vigente: number | null | undefined; gravado?: PrazoGravado | null }): number {
  const g = i.gravado;
  if (i.prazo_id && g && g.prazo_id === i.prazo_id && g.percentual != null) return g.percentual;
  return i.vigente ?? 0;
}
