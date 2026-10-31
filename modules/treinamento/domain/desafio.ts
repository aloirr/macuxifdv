/**
 * Desafio de vendas ligado a campanha (RF-TRE-06, P1): XP ao vender itens da campanha, dentro da vigência.
 * Só recebe o pedido pelo contrato de evento `vendedor.pedido.criado@1` (leitura tolerante em
 * `contracts/pedido-lido.ts`); o Treinamento funciona sem o Vendedor ativo. Idempotente por desafio + pedido.
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
}

/** O que o Treinamento precisa de `vendedor.pedido.criado@1`. */
export interface PedidoLido {
  pedido_id: string;
  tenant_id: string;
  /** Quem vendeu e recebe o XP. */
  vendedor_id: string;
  /** Instante UTC da criação do pedido. */
  criado_em: string;
  itens: readonly { produto_id: string; quantidade: number }[];
}

export type AvaliacaoPedido =
  | { elegivel: true; unidades: number; pontos_base: number }
  | { elegivel: false; motivo: 'OUTRO_TENANT' | 'DESAFIO_INATIVO' | 'FORA_DA_VIGENCIA' | 'SEM_ITENS_DA_CAMPANHA' };

/** RF-TRE-06: XP do pedido = unidades dos itens da campanha × XP por unidade (inteiro, para baixo), limitado ao máximo por pedido. */
export function avaliarPedidoNoDesafio(desafio: DesafioVendas, pedido: PedidoLido, fuso: string = PARAMETROS_PADRAO.fuso): AvaliacaoPedido {
  if (pedido.tenant_id !== desafio.tenant_id) return { elegivel: false, motivo: 'OUTRO_TENANT' };
  if (!desafio.ativo) return { elegivel: false, motivo: 'DESAFIO_INATIVO' };
  const dia = localDate(new Date(pedido.criado_em), fuso);
  if (dia < desafio.vigencia_inicio || dia > desafio.vigencia_fim) return { elegivel: false, motivo: 'FORA_DA_VIGENCIA' };
  const campanha = new Set(desafio.produto_ids);
  const unidades = pedido.itens.filter((i) => campanha.has(i.produto_id) && Number.isFinite(i.quantidade) && i.quantidade > 0).reduce((s, i) => s + i.quantidade, 0);
  if (unidades <= 0) return { elegivel: false, motivo: 'SEM_ITENS_DA_CAMPANHA' };
  return { elegivel: true, unidades, pontos_base: Math.min(Math.floor(unidades * desafio.xp_por_unidade), desafio.xp_max_por_pedido) };
}

/**
 * RF-TRE-06: candidato de XP para o vendedor do pedido; `null` se o pedido não pontua. `lancamentoId` é o UUID do
 * lançamento (gerado por quem processa o evento); a repetição do evento é barrada pela referência `desafio:pedido`.
 */
export function candidatoDoDesafio(desafio: DesafioVendas, pedido: PedidoLido, lancamentoId: string, fuso: string = PARAMETROS_PADRAO.fuso): CandidatoXp | null {
  const a = avaliarPedidoNoDesafio(desafio, pedido, fuso);
  if (!a.elegivel || a.pontos_base <= 0) return null;
  return {
    id: lancamentoId,
    tenant_id: pedido.tenant_id,
    usuario_id: pedido.vendedor_id,
    origem: 'desafio_vendas',
    referencia_id: `${desafio.id}:${pedido.pedido_id}`,
    pontos_base: a.pontos_base,
    ocorrido_em: pedido.criado_em,
  };
}
