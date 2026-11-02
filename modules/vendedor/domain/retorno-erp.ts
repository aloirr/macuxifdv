/**
 * Retorno do ERP aplicado ao pedido (T-0053; RN-VEN-30, RN-INT-08; decisão do Alexandre R-20261031-100601, opção b).
 * O Hub publica `integracao.pedido.retorno_erp@1` a cada retorno aceito; o Vendedor consome e muda o status do pedido.
 * A ordem dos eventos não é garantida (ADR 0007): o pedido só ANDA para a frente; retorno repetido ou atrasado é ignorado.
 *
 *   aprovado ─enviado─► enviado ao ERP ─integrado─► integrado ─faturado_parcial─► faturado parcial ─faturado_total─► faturado
 *        └──────────── rejeitado_erp ──► rejeitado            cancelado (só do ERP) ◄── aprovado em diante
 */
import type { ItemFaturado } from './faturamento';
import type { OrderStatus } from './order';

/** Retorno do ERP como o Vendedor precisa (subconjunto de `integracao.pedido.retorno_erp@1`). */
export interface RetornoErpEntrada {
  status: string;
  numero_erp: string | null;
  motivo: string | null;
  ocorrido_em: string;
  itens_faturados?: ReadonlyArray<{ sequencia: number; quantidade: number }> | null;
}

export type MotivoIgnorar = 'status_do_hub' | 'status_desconhecido' | 'pedido_nao_enviado' | 'repetido_ou_atrasado';

export type PlanoRetornoErp =
  | { acao: 'ignorar'; motivo: MotivoIgnorar }
  | {
      acao: 'aplicar';
      de: OrderStatus;
      para: OrderStatus;
      /** `false` na 2ª nota parcial: fatura (evento) sem mudar o status nem gravar transição. */
      muda_status: boolean;
      numero_erp: string | null;
      texto_historico: string;
      motivo_rejeicao: string | null;
      motivo_cancelamento: string | null;
      /** publica `vendedor.pedido.faturado@1` */
      faturar: boolean;
    };

/** Posição na esteira do ERP; fora dela = o pedido nunca foi para a fila (RN-INT-08: só `aprovado` entra). */
const ESTEIRA: Partial<Record<OrderStatus, number>> = { approved: 0, sent_to_erp: 1, integrated: 2, invoiced_partial: 3, invoiced: 4 };

const texto = (s: string | null | undefined) => (s ?? '').trim();

/**
 * Plano do retorno do ERP (puro). `atual` = status gravado do pedido; nada aqui lê banco nem relógio.
 */
export function planejarRetornoErp(atual: OrderStatus, r: RetornoErpEntrada): PlanoRetornoErp {
  const pos = ESTEIRA[atual];
  const numero = texto(r.numero_erp) || null;
  const motivoErp = texto(r.motivo);
  const aplicar = (para: OrderStatus, historico: string, extra: Partial<Extract<PlanoRetornoErp, { acao: 'aplicar' }>> = {}): PlanoRetornoErp => ({
    acao: 'aplicar',
    de: atual,
    para,
    muda_status: para !== atual,
    numero_erp: numero,
    texto_historico: historico,
    motivo_rejeicao: null,
    motivo_cancelamento: null,
    faturar: false,
    ...extra,
  });
  const avanca = (alvo: number) => (pos === undefined ? ({ acao: 'ignorar', motivo: 'pedido_nao_enviado' } as const) : pos >= alvo ? ({ acao: 'ignorar', motivo: 'repetido_ou_atrasado' } as const) : null);
  const comNumero = (base: string) => (numero ? `${base} (nº ${numero})` : base);

  switch (r.status) {
    case 'pendente':
      return { acao: 'ignorar', motivo: 'status_do_hub' };
    case 'enviado':
      return avanca(1) ?? aplicar('sent_to_erp', 'Entregue ao ERP');
    case 'integrado':
      return avanca(2) ?? aplicar('integrated', comNumero('Integrado ao ERP'));
    case 'faturado_parcial':
      if (atual === 'invoiced_partial') return aplicar('invoiced_partial', comNumero('Nova nota parcial do ERP'), { faturar: true });
      return avanca(3) ?? aplicar('invoiced_partial', comNumero('Faturado parcialmente no ERP'), { faturar: true });
    case 'faturado_total':
      return avanca(4) ?? aplicar('invoiced', comNumero('Faturado no ERP'), { faturar: true });
    case 'rejeitado_erp': {
      if (atual === 'rejected') return { acao: 'ignorar', motivo: 'repetido_ou_atrasado' };
      const b = avanca(2);
      if (b) return b;
      const motivo = `Recusado pelo ERP: ${motivoErp || 'sem motivo informado'}`;
      return aplicar('rejected', motivo, { motivo_rejeicao: motivo });
    }
    case 'cancelado': {
      if (atual === 'cancelled') return { acao: 'ignorar', motivo: 'repetido_ou_atrasado' };
      if (pos === undefined && atual !== 'rejected') return { acao: 'ignorar', motivo: 'pedido_nao_enviado' };
      const motivo = motivoErp ? `Cancelado no ERP: ${motivoErp}` : 'Cancelado no ERP';
      return aplicar('cancelled', motivo, { motivo_cancelamento: motivo });
    }
    default:
      return { acao: 'ignorar', motivo: 'status_desconhecido' };
  }
}

export interface ItemDoPedidoEnviado {
  sequencia: number;
  produto_id: string;
  quantidade: number;
}

export type BaseFaturamento = 'itens_do_retorno' | 'pedido_inteiro' | 'restante' | 'sem_base';

/**
 * Itens de `vendedor.pedido.faturado@1` (RN-INT-08, RN-TRE-08). Com `itens_faturados`, traduz a `sequencia` do pedido enviado
 * (1..n, igual à do `PedidoParaErp`) para o produto do Macuxi. Sem eles: `faturado_total` de pedido sem parcial anterior = o
 * pedido inteiro; depois de parcial, só com o acumulado (`jaFaturados`), senão `sem_base` (não publica: nunca conta em dobro).
 */
export function itensFaturadosDoRetorno(
  status: string,
  statusAntes: OrderStatus,
  itens: readonly ItemDoPedidoEnviado[],
  itensFaturados: RetornoErpEntrada['itens_faturados'],
  jaFaturados?: readonly ItemFaturado[],
): { base: BaseFaturamento; itens: ItemFaturado[] } {
  const somar = (lista: ItemFaturado[]) => {
    const m = new Map<string, number>();
    for (const i of lista) if (i.quantity > 0) m.set(i.product_id, (m.get(i.product_id) ?? 0) + i.quantity);
    return [...m].map(([product_id, quantity]) => ({ product_id, quantity }));
  };
  if (itensFaturados && itensFaturados.length > 0) {
    const porSeq = new Map(itens.map((i) => [i.sequencia, i.produto_id]));
    const lista = somar(itensFaturados.flatMap((f) => (porSeq.has(f.sequencia) ? [{ product_id: porSeq.get(f.sequencia)!, quantity: f.quantidade }] : [])));
    return lista.length > 0 ? { base: 'itens_do_retorno', itens: lista } : { base: 'sem_base', itens: [] };
  }
  if (status !== 'faturado_total') return { base: 'sem_base', itens: [] };
  const inteiro = somar(itens.map((i) => ({ product_id: i.produto_id, quantity: i.quantidade })));
  if (statusAntes !== 'invoiced_partial') return { base: 'pedido_inteiro', itens: inteiro };
  if (!jaFaturados) return { base: 'sem_base', itens: [] };
  const ja = new Map<string, number>();
  for (const i of jaFaturados) ja.set(i.product_id, (ja.get(i.product_id) ?? 0) + i.quantity);
  const resto = somar(inteiro.map((i) => ({ product_id: i.product_id, quantity: i.quantity - (ja.get(i.product_id) ?? 0) })));
  return resto.length > 0 ? { base: 'restante', itens: resto } : { base: 'sem_base', itens: [] };
}
