/**
 * Desafio de vendas ligado a campanha (RF-TRE-06, RN-TRE-08, P1): XP ao vender itens da campanha, dentro da vigência.
 * Paga no FATURAMENTO do pedido (status vindo do ERP pelo Hub), não na criação. Só recebe o pedido
 * pelo evento `vendedor.pedido.faturado@1` (leitura tolerante em `contracts/pedido-lido.ts`); o Treinamento
 * funciona sem o Vendedor ativo. Sem estorno nesta fase.
 *
 * Contrato do evento (docs/desenho/T-0011.md §2 e .coord/contratos/eventos.md): um evento por retorno aceito do ERP;
 * `itens` = o que foi faturado NESTE retorno (o consumidor soma); o total depois de parciais traz só o saldo.
 * Idempotência: o consumidor é idempotente por `evento_id` (do envelope). Cada evento paga as quantidades que traz:
 * parcial → chave natural `desafio:pedido:evento_id`; total (`parcial: false`) → `desafio:pedido:total` (defesa: um
 * segundo total do mesmo pedido, ainda que com outro `evento_id`, não paga de novo).
 */
import { localDate } from '@macuxi/comum';
import { PARAMETROS_PADRAO } from './parametros';
import type { CandidatoXp, LancamentoXp } from './xp';

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
  /** `evento_id` do envelope do evento (não vem no payload): é a chave de idempotência do retorno. */
  evento_id: string;
  pedido_id: string;
  tenant_id: string;
  /** Quem vendeu e recebe o XP. */
  vendedor_id: string;
  /** Instante UTC do faturamento (ERP); ausente/nulo = pedido ainda não faturado, não pontua. */
  faturado_em?: string | null;
  /** Itens faturados NESTE evento (o domínio soma os eventos; o total depois de parciais traz só o saldo). */
  itens: readonly { produto_id: string; quantidade: number }[];
  /** Faturamento parcial do pedido (padrão false = total). Parcial sem itens é ignorado. */
  parcial?: boolean;
}

export type AvaliacaoPedido =
  | { elegivel: true; unidades: number; pontos_base: number }
  | { elegivel: false; motivo: 'OUTRO_TENANT' | 'PEDIDO_NAO_FATURADO' | 'PARCIAL_SEM_ITENS' | 'DESAFIO_INATIVO' | 'FORA_DA_VIGENCIA' | 'SEM_ITENS_DA_CAMPANHA' };

/** RF-TRE-06: XP do pedido faturado (deste evento, sem olhar o histórico) = unidades dos itens da campanha × XP por unidade (inteiro, para baixo), limitado ao máximo por pedido. */
export function avaliarPedidoNoDesafio(desafio: DesafioVendas, pedido: Omit<PedidoFaturadoLido, 'evento_id'>, fuso: string = PARAMETROS_PADRAO.fuso): AvaliacaoPedido {
  if (pedido.tenant_id !== desafio.tenant_id) return { elegivel: false, motivo: 'OUTRO_TENANT' };
  if (!pedido.faturado_em) return { elegivel: false, motivo: 'PEDIDO_NAO_FATURADO' };
  if (pedido.parcial === true && pedido.itens.length === 0) return { elegivel: false, motivo: 'PARCIAL_SEM_ITENS' };
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
  /**
   * Lançamentos já gravados do vendedor (idealmente os `desafio_vendas` dele neste desafio): servem para não pagar de
   * novo o evento/total já pago e para descontar do máximo por pedido o que os eventos anteriores já pagaram.
   * Ausente = sem histórico.
   */
  lancamentos?: readonly LancamentoXp[];
}

/** Chave natural do lançamento do evento (`referencia_id`): `desafio:pedido:evento_id` (parcial) ou `desafio:pedido:total`. */
export const referenciaDoDesafio = (desafioId: string, pedido: Pick<PedidoFaturadoLido, 'pedido_id' | 'evento_id' | 'parcial'>): string =>
  `${desafioId}:${pedido.pedido_id}:${pedido.parcial === true ? pedido.evento_id : 'total'}`;

/**
 * RF-TRE-06, RN-TRE-08: candidato de XP do evento de pedido faturado, para o vendedor do pedido; `null` se não paga.
 * - Soma as unidades dos itens da campanha DESTE evento (parcial e total pagam o que trazem; duas parciais do mesmo
 *   produto pagam as duas quantidades; o total depois de parciais paga o saldo que vier nele).
 * - Idempotente: o mesmo evento entregue de novo (mesmo `evento_id`) não paga; um segundo total do mesmo pedido, nem
 *   com outro `evento_id`. Detectado pelos `opcoes.lancamentos`; sem histórico, a chave natural (usuário + origem +
 *   referência) de `proporLancamento` barra a repetição.
 * - `xp_max_por_pedido` vale para o pedido todo: o que os eventos anteriores do pedido já pagaram (`pontos_base`) é
 *   descontado; o evento que cruza o teto paga só o saldo.
 * - Parcial sem itens: ignorada (`PARCIAL_SEM_ITENS`). Pedido sem `faturado_em`: não paga.
 * O candidato leva o teto do desafio (`teto_desafio`): `proporLancamento` paga só o saldo do vendedor no desafio e,
 * esgotado, grava lançamento de 0 ponto. O desafio não passa pelo teto diário. `lancamentoId` é o UUID do lançamento.
 */
export function candidatoDoDesafio(desafio: DesafioVendas, pedido: PedidoFaturadoLido, lancamentoId: string, opcoes: OpcoesDesafio = {}): CandidatoXp | null {
  const a = avaliarPedidoNoDesafio(desafio, pedido, opcoes.fuso ?? PARAMETROS_PADRAO.fuso);
  if (!a.elegivel) return null;
  const refPedido = `${desafio.id}:${pedido.pedido_id}`;
  const referencia = referenciaDoDesafio(desafio.id, pedido);
  const doPedido = (opcoes.lancamentos ?? []).filter((l) => l.usuario_id === pedido.vendedor_id && l.origem === 'desafio_vendas' && l.referencia_id.startsWith(`${refPedido}:`));
  if (doPedido.some((l) => l.referencia_id === referencia)) return null; // mesmo evento (ou mesmo total) já pago
  if (pedido.parcial !== true && doPedido.some((l) => l.referencia_id === `${refPedido}:total`)) return null; // defesa: 2º total
  const saldoPedido = Math.max(0, desafio.xp_max_por_pedido - doPedido.reduce((s, l) => s + l.pontos_base, 0));
  const pontos = Math.min(a.pontos_base, saldoPedido);
  if (pontos <= 0) return null;
  const max = desafio.xp_max_por_desafio ?? opcoes.xp_max_por_desafio ?? PARAMETROS_PADRAO.xp_max_por_desafio;
  return {
    id: lancamentoId,
    tenant_id: pedido.tenant_id,
    usuario_id: pedido.vendedor_id,
    origem: 'desafio_vendas',
    referencia_id: referencia,
    pontos_base: pontos,
    ocorrido_em: pedido.faturado_em!,
    ...(max > 0 ? { teto_desafio: { desafio_id: desafio.id, max } } : {}),
  };
}
