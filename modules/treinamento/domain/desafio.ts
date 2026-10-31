/**
 * Desafio de vendas ligado a campanha (RF-TRE-06, P1): XP ao vender itens da campanha, dentro da vigência.
 * Paga no FATURAMENTO do pedido (status vindo do ERP pelo Hub), não na criação. Só recebe o pedido
 * pelo contrato de evento de pedido faturado (nome PENDENTE; leitura tolerante em `contracts/pedido-lido.ts`); o
 * Treinamento funciona sem o Vendedor ativo. Idempotente por desafio + pedido. Sem estorno nesta fase.
 */
import { localDate } from '@macuxi/comum';
import { PARAMETROS_PADRAO } from './parametros';
import type { CandidatoXp } from './xp';

export interface DesafioVendas {
  id: string;
  tenant_id: string;
  nome: string;
  ativo: boolean;
  /** Produtos (`produto_id` do Core) que fazem parte da campanha. */
  produto_ids: readonly string[];
  /** Vigência em datas civis no fuso do tenant, inclusive nas duas pontas. */
  vigencia_inicio: string;
  vigencia_fim: string;
  /** XP por unidade vendida de item da campanha. */
  xp_por_unidade: number;
  /** Teto de XP por pedido (evita pontuar pedido gigante). */
  xp_max_por_pedido: number;
  /** Teto de XP por vendedor neste desafio; ausente = padrão do tenant; 0 = sem teto. */
  xp_max_por_desafio?: number | null;
}

/** O que o Treinamento precisa do pedido faturado. */
export interface PedidoFaturadoLido {
  pedido_id: string;
  tenant_id: string;
  /** Quem vendeu e recebe o XP. */
  vendedor_id: string;
  /** Instante UTC do faturamento (ERP); ausente/nulo = pedido ainda não faturado, não pontua. */
  faturado_em?: string | null;
  itens: readonly { produto_id: string; quantidade: number }[];
}

export type AvaliacaoPedido =
  | { elegivel: true; unidades: number; pontos_base: number }
  | { elegivel: false; motivo: 'OUTRO_TENANT' | 'PEDIDO_NAO_FATURADO' | 'DESAFIO_INATIVO' | 'FORA_DA_VIGENCIA' | 'SEM_ITENS_DA_CAMPANHA' };

/** RF-TRE-06: XP do pedido faturado = unidades dos itens da campanha × XP por unidade (inteiro, para baixo), limitado ao máximo por pedido. */
export function avaliarPedidoNoDesafio(desafio: DesafioVendas, pedido: PedidoFaturadoLido, fuso: string = PARAMETROS_PADRAO.fuso): AvaliacaoPedido {
  if (pedido.tenant_id !== desafio.tenant_id) return { elegivel: false, motivo: 'OUTRO_TENANT' };
  if (!pedido.faturado_em) return { elegivel: false, motivo: 'PEDIDO_NAO_FATURADO' };
  if (!desafio.ativo) return { elegivel: false, motivo: 'DESAFIO_INATIVO' };
  const dia = localDate(new Date(pedido.faturado_em), fuso);
  if (dia < desafio.vigencia_inicio || dia > desafio.vigencia_fim) return { elegivel: false, motivo: 'FORA_DA_VIGENCIA' };
  const campanha = new Set(desafio.produto_ids);
  const unidades = pedido.itens.filter((i) => campanha.has(i.produto_id) && Number.isFinite(i.quantidade) && i.quantidade > 0).reduce((s, i) => s + i.quantidade, 0);
  if (unidades <= 0) return { elegivel: false, motivo: 'SEM_ITENS_DA_CAMPANHA' };
  return { elegivel: true, unidades, pontos_base: Math.min(Math.floor(unidades * desafio.xp_por_unidade), desafio.xp_max_por_pedido) };
}

export interface OpcoesDesafio {
  /** Fuso do tenant (padrão `America/Manaus`). */
  fuso?: string;
  /** Padrão do tenant para o teto por desafio (`xp_max_por_desafio`); o do cadastro do desafio tem prioridade. */
  xp_max_por_desafio?: number;
}

/**
 * RF-TRE-06: candidato de XP para o vendedor do pedido faturado; `null` se o pedido não pontua. `lancamentoId` é o
 * UUID do lançamento (gerado por quem processa o evento); a repetição do evento é barrada pela referência
 * `desafio:pedido`. O candidato leva o teto do desafio (`teto_desafio`): `proporLancamento` paga só o saldo do
 * vendedor no desafio e, esgotado, grava lançamento de 0 ponto. O desafio não passa pelo teto diário.
 */
export function candidatoDoDesafio(desafio: DesafioVendas, pedido: PedidoFaturadoLido, lancamentoId: string, opcoes: OpcoesDesafio = {}): CandidatoXp | null {
  const a = avaliarPedidoNoDesafio(desafio, pedido, opcoes.fuso ?? PARAMETROS_PADRAO.fuso);
  if (!a.elegivel || a.pontos_base <= 0) return null;
  const max = desafio.xp_max_por_desafio ?? opcoes.xp_max_por_desafio ?? PARAMETROS_PADRAO.xp_max_por_desafio;
  return {
    id: lancamentoId,
    tenant_id: pedido.tenant_id,
    usuario_id: pedido.vendedor_id,
    origem: 'desafio_vendas',
    referencia_id: `${desafio.id}:${pedido.pedido_id}`,
    pontos_base: a.pontos_base,
    ocorrido_em: pedido.faturado_em!,
    ...(max > 0 ? { teto_desafio: { desafio_id: desafio.id, max } } : {}),
  };
}
