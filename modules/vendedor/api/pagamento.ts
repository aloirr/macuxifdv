/**
 * Forma de pagamento e prazo do pedido na API (T-0089; RN-VEN-24, RN-VEN-25, RN-VEN-13). Usado pelo receber, pela edição
 * do orçamento e pela transformação. A regra mora em `domain/pagamento.ts`; aqui só se busca o dado:
 *  - forma e prazo do próprio Vendedor (`vendedor.forma_pagamento` e `vendedor.prazo_pagamento`);
 *  - limites do cliente (formas aceitas, prazo médio máximo) em `core.cadastro_resumo@1`;
 *  - título vencido em `core.financeiro_cliente@1` (consulta indisponível NÃO bloqueia).
 * O push do APK anterior (sem forma e prazo) segue pela condição de pagamento legada.
 */
import { CONSULTA_FINANCEIRO_CLIENTE } from '@macuxi/core/contracts';
import { ehConsultaIndisponivel, type ClienteBanco, type ContextoBase, type TransacaoTenant } from '@macuxi/platform-sdk';
import { exigeAprovacaoPorVencido, tituloVencidoDias, validarPagamento, type FormaDePagamento, type PrazoDePagamento } from '../domain';

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
}

export interface PagamentoResolvido {
  forma: FormaLinha;
  prazo: PrazoLinha;
  /** "Boleto · 28/56 dias": o texto que as telas e PDFs antigos mostram em `payment_terms` */
  texto: string;
}

export type ResultadoPagamento =
  | { ok: true; pagamento: PagamentoResolvido | null; titulo_vencido: boolean }
  | { ok: false; codigo: 'RN-VEN-24' | 'RN-VEN-25'; mensagem: string };

export const textoDoPagamento = (forma: { nome: string }, prazo: { descricao: string }): string => `${forma.nome} · ${prazo.descricao}`;

/**
 * Sem forma e prazo no payload: `pagamento = null` e o chamador segue a condição legada. Só um dos dois: RN-VEN-24.
 * Com os dois: confere RN-VEN-24/25 e, em pedido (não orçamento) a prazo, o título vencido (RN-VEN-13).
 */
export async function resolverPagamento(
  ctx: ContextoBase,
  db: ClienteBanco,
  tx: TransacaoTenant,
  p: { forma_pagamento_id?: string | null; prazo_pagamento_id?: string | null; customer_id: string },
  cliente: { prazo_medio_max_dias?: number | null; formas_pagamento?: string[] | null },
  tipo: 'pedido' | 'orcamento',
): Promise<ResultadoPagamento> {
  const formaId = p.forma_pagamento_id ?? null;
  const prazoId = p.prazo_pagamento_id ?? null;
  if (!formaId && !prazoId) return { ok: true, pagamento: null, titulo_vencido: false };
  if (!formaId || !prazoId) return { ok: false, codigo: 'RN-VEN-24', mensagem: 'Escolha a forma de pagamento e o prazo.' };

  const forma = (await db.query<FormaLinha>('select id, codigo, nome, ativo, ordem from vendedor.forma_pagamento where id = $1 and deleted_at is null', [formaId])).rows[0];
  const prazo = (
    await db.query<PrazoLinha>(
      'select id, forma_pagamento_id, codigo, descricao, parcelas_dias, prazo_medio_dias, ativo, ordem from vendedor.prazo_pagamento where id = $1 and deleted_at is null',
      [prazoId],
    )
  ).rows[0];
  const r = validarPagamento({
    forma: forma as FormaDePagamento | undefined,
    prazo: prazo as PrazoDePagamento | undefined,
    cliente: { prazo_medio_max_dias: cliente.prazo_medio_max_dias, formas_pagamento: cliente.formas_pagamento },
  });
  if (!r.ok) return r;

  let titulo_vencido = false;
  if (tipo === 'pedido' && prazo!.prazo_medio_dias > 0) {
    try {
      const fin = await tx.consultar(CONSULTA_FINANCEIRO_CLIENTE, { cliente_id: p.customer_id });
      titulo_vencido = exigeAprovacaoPorVencido({
        maior_atraso_dias: fin.financeiro?.maior_atraso_dias ?? 0,
        prazo_medio_dias: prazo!.prazo_medio_dias,
        limite_dias: tituloVencidoDias(ctx.parametros()),
      });
    } catch (e) {
      if (!ehConsultaIndisponivel(e)) throw e;
    }
  }
  return { ok: true, pagamento: { forma: forma!, prazo: prazo!, texto: textoDoPagamento(forma!, prazo!) }, titulo_vencido };
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
