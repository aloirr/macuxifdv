/**
 * Forma de pagamento e prazo do pedido na API (T-0089; RN-VEN-24, RN-VEN-25, RN-VEN-13). Usado pelo receber, pela edição
 * do orçamento e pela transformação. A regra mora em `domain/pagamento.ts`; aqui só se busca o dado:
 *  - forma e prazo do próprio Vendedor (`vendedor.forma_pagamento` e `vendedor.prazo_pagamento`);
 *  - limites do cliente (formas aceitas) em `core.cadastro_resumo@1`;
 *  - título vencido em `core.financeiro_cliente@1` (consulta indisponível NÃO bloqueia).
 * O push do APK anterior (sem forma e prazo) segue pela condição de pagamento legada.
 */
import type { ClienteBanco, ContextoBase, TransacaoTenant } from '@macuxi/platform-sdk';
import { percentualAjusteParaBp, percentualDoPrazoNoDocumento, revalidarPercentualDoPrazo, validarPagamento, type FormaDePagamento, type PrazoDePagamento, type PrazoGravado } from '../domain';

interface FormaLinha {
  id: string;
  codigo: string;
  nome: string;
  ativo: boolean;
  ordem: number;
}
interface PrazoLinha {
  id: string;
  forma_pagamento_id: string;
  codigo: string;
  descricao: string;
  parcelas_dias: number[];
  prazo_medio_dias: number;
  ativo: boolean;
  ordem: number;
  /** RN-VEN-43 */
  percentual_ajuste?: number | null;
  atualizado_em?: string | null;
}

/** RN-VEN-43: leitura do percentual do prazo (2 casas); a mesma nos SELECTs de prazo. */
export const COLUNA_PERCENTUAL_AJUSTE = 'round(percentual_ajuste, 2)::float8 as percentual_ajuste';
const SELECT_PRAZO =
  `select id, forma_pagamento_id, codigo, descricao, parcelas_dias, prazo_medio_dias, ativo, ordem, ${COLUNA_PERCENTUAL_AJUSTE},
          to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as atualizado_em
     from vendedor.prazo_pagamento where id = $1 and deleted_at is null`;

export interface PagamentoResolvido {
  forma: FormaLinha;
  prazo: PrazoLinha;
  /** "Boleto · 28/56 dias": o texto que as telas e PDFs antigos mostram em `payment_terms` */
  texto: string;
}

export type ResultadoPagamento =
  | { ok: true; pagamento: PagamentoResolvido | null; percentual_ajuste_bp: number; percentual_ajuste: number; percentual_mudou: boolean }
  | { ok: false; codigo: 'RN-VEN-24' | 'RN-VEN-25' | 'RN-VEN-45'; mensagem: string };

export const textoDoPagamento = (forma: { nome: string }, prazo: { descricao: string }): string => `${forma.nome} · ${prazo.descricao}`;

/**
 * Sem forma e prazo no payload: `pagamento = null` e o chamador segue a condição legada. Só um dos dois: RN-VEN-24.
 * Com os dois: confere RN-VEN-24/25 e o percentual do prazo (RN-VEN-45). Crédito e título vencido são de `financeiro-aprovacao.ts` (T-0184).
 */
export async function resolverPagamento(
  ctx: ContextoBase,
  db: ClienteBanco,
  tx: TransacaoTenant,
  p: { forma_pagamento_id?: string | null; prazo_pagamento_id?: string | null; customer_id: string; prazo_percentual_ajuste?: number | null; created_offline_at?: string | null },
  cliente: { formas_pagamento?: string[] | null },
  _tipo: 'pedido' | 'orcamento',
  /** RN-VEN-45 */
  gravado?: PrazoGravado,
): Promise<ResultadoPagamento> {
  const formaId = p.forma_pagamento_id ?? null;
  const prazoId = p.prazo_pagamento_id ?? null;
  if (!formaId && !prazoId) return { ok: true, pagamento: null, percentual_ajuste_bp: 0, percentual_ajuste: 0, percentual_mudou: false };
  if (!formaId || !prazoId) return { ok: false, codigo: 'RN-VEN-24', mensagem: 'Escolha a forma de pagamento e o prazo.' };

  const forma = (await db.query<FormaLinha>('select id, codigo, nome, ativo, ordem from vendedor.forma_pagamento where id = $1 and deleted_at is null', [formaId])).rows[0];
  const prazo = (await db.query<PrazoLinha>(SELECT_PRAZO, [prazoId])).rows[0];
  const r = validarPagamento({
    forma: forma as FormaDePagamento | undefined,
    prazo: prazo as PrazoDePagamento | undefined,
    cliente: { formas_pagamento: cliente.formas_pagamento },
  });
  if (!r.ok) return r;

  // RN-VEN-45: o % do push é revalidado contra o % que vale no documento (percentualDoPrazoNoDocumento)
  const pct = revalidarPercentualDoPrazo({ push: p.prazo_percentual_ajuste, vigente: percentualDoPrazoNoDocumento({ prazo_id: prazoId, vigente: prazo!.percentual_ajuste, gravado }), cadastro_atualizado_em: prazo!.atualizado_em, criado_em: p.created_offline_at ?? ctx.agora().toISOString() });
  if (!pct.ok) return { ok: false, codigo: 'RN-VEN-45', mensagem: pct.mensagem };
  return {
    ok: true,
    pagamento: { forma: forma!, prazo: prazo!, texto: textoDoPagamento(forma!, prazo!) },
    percentual_ajuste_bp: percentualAjusteParaBp(pct.percentual),
    percentual_ajuste: pct.percentual,
    percentual_mudou: pct.mudou_depois,
  };
}

/** As 8 colunas do retrato (0037, `pedido_pagamento_completo`: juntas ou nenhuma), na ordem de `COLUNAS_PAGAMENTO`. */
export const COLUNAS_PAGAMENTO = [
  'forma_pagamento_id',
  'prazo_pagamento_id',
  'forma_pagamento_codigo',
  'forma_pagamento_nome',
  'prazo_codigo',
  'prazo_descricao',
  'prazo_parcelas_dias',
  'prazo_medio_dias',
] as const;

export function valoresPagamento(pg: PagamentoResolvido | null): unknown[] {
  if (!pg) return [null, null, null, null, null, null, null, null];
  return [pg.forma.id, pg.prazo.id, pg.forma.codigo, pg.forma.nome, pg.prazo.codigo, pg.prazo.descricao, pg.prazo.parcelas_dias, pg.prazo.prazo_medio_dias];
}

/**
 * RN-VEN-45: valor da coluna `prazo_percentual_ajuste` do retrato. Sem prazo (condição legada, RN-VEN-14) vai `null`: o CHECK
 * `pedido_prazo_percentual_com_prazo` só aceita o percentual com `prazo_pagamento_id`.
 */
export function valorPercentualPrazo(pagamento: PagamentoResolvido | null, percentual: number): number | null {
  return pagamento ? percentual : null;
}
