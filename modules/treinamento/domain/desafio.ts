/**
 * Desafio de vendas ligado a campanha (RF-TRE-06, P1): XP ao vender itens da campanha, dentro da vigência.
 * Paga no FATURAMENTO do pedido (status vindo do ERP pelo Hub), não na criação. Só recebe o pedido
 * pelo evento `vendedor.pedido.faturado@1` (leitura tolerante em `contracts/pedido-lido.ts`); o Treinamento
 * funciona sem o Vendedor ativo. Sem estorno nesta fase.
 *
 * Idempotência (premissa do Treinamento; o desenho docs/desenho/T-0011.md não foi encontrado — ver regras.md §8):
 * faturamento TOTAL → chave `desafio:pedido`; PARCIAL → chave `desafio:pedido:produto`. Item já pago (em parcial ou
 * total) não paga de novo; o total depois de parciais paga só os itens ainda não pagos; parcial depois do total não
 * paga nada. Em cada evento parcial, `quantidade` é a quantidade faturada naquele evento.
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
  pedido_id: string;
  tenant_id: string;
  /** Quem vendeu e recebe o XP. */
  vendedor_id: string;
  /** Instante UTC do faturamento (ERP); ausente/nulo = pedido ainda não faturado, não pontua. */
  faturado_em?: string | null;
  itens: readonly { produto_id: string; quantidade: number }[];
  /** Faturamento parcial do pedido (padrão false = total). Parcial sem itens é ignorado. */
  parcial?: boolean;
}

export type AvaliacaoPedido =
  | { elegivel: true; unidades: number; pontos_base: number }
  | { elegivel: false; motivo: 'OUTRO_TENANT' | 'PEDIDO_NAO_FATURADO' | 'PARCIAL_SEM_ITENS' | 'DESAFIO_INATIVO' | 'FORA_DA_VIGENCIA' | 'SEM_ITENS_DA_CAMPANHA' };

/** RF-TRE-06: XP do pedido faturado (total ou parcial, sem olhar o histórico) = unidades dos itens da campanha × XP por unidade (inteiro, para baixo), limitado ao máximo por pedido. */
export function avaliarPedidoNoDesafio(desafio: DesafioVendas, pedido: PedidoFaturadoLido, fuso: string = PARAMETROS_PADRAO.fuso): AvaliacaoPedido {
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
   * novo o item/pedido já pago e para descontar do máximo por pedido o que as parciais já pagaram. Ausente = sem histórico.
   */
  lancamentos?: readonly LancamentoXp[];
}

function candidatoBase(desafio: DesafioVendas, pedido: PedidoFaturadoLido, id: string, referencia: string, pontos: number, opcoes: OpcoesDesafio): CandidatoXp {
  const max = desafio.xp_max_por_desafio ?? opcoes.xp_max_por_desafio ?? PARAMETROS_PADRAO.xp_max_por_desafio;
  return {
    id,
    tenant_id: pedido.tenant_id,
    usuario_id: pedido.vendedor_id,
    origem: 'desafio_vendas',
    referencia_id: referencia,
    pontos_base: pontos,
    ocorrido_em: pedido.faturado_em!,
    ...(max > 0 ? { teto_desafio: { desafio_id: desafio.id, max } } : {}),
  };
}

/**
 * RF-TRE-06: candidatos de XP do evento de pedido faturado, para o vendedor do pedido; `[]` se não pontua.
 * - Total: um candidato `desafio:pedido` com os itens da campanha ainda não pagos por parciais.
 * - Parcial: um candidato por produto da campanha, `desafio:pedido:produto`, pulando o que já foi pago.
 * - Total já pago, ou parcial depois do total: `[]` (não paga nada).
 * O máximo por pedido (`xp_max_por_pedido`) vale para o pedido todo: o que lançamentos anteriores do pedido já pagaram
 * (`pontos_base`) é descontado. `gerarId` fornece o UUID de cada lançamento. Cada candidato leva o teto do desafio
 * (`teto_desafio`): `proporLancamento` paga só o saldo do vendedor no desafio e, esgotado, grava lançamento de 0
 * ponto. O desafio não passa pelo teto diário. Eventos processados em lotes sem o histórico ainda gravado continuam
 * protegidos pela chave natural (usuário + origem + referência) em `proporLancamento`.
 */
export function candidatosDoDesafio(desafio: DesafioVendas, pedido: PedidoFaturadoLido, gerarId: () => string, opcoes: OpcoesDesafio = {}): CandidatoXp[] {
  const a = avaliarPedidoNoDesafio(desafio, pedido, opcoes.fuso ?? PARAMETROS_PADRAO.fuso);
  if (!a.elegivel) return [];
  const refPedido = `${desafio.id}:${pedido.pedido_id}`;
  const doPedido = (opcoes.lancamentos ?? []).filter(
    (l) => l.usuario_id === pedido.vendedor_id && l.origem === 'desafio_vendas' && (l.referencia_id === refPedido || l.referencia_id.startsWith(`${refPedido}:`)),
  );
  if (doPedido.some((l) => l.referencia_id === refPedido)) return []; // faturamento total já pago
  const pagos = new Set(doPedido.map((l) => l.referencia_id.slice(refPedido.length + 1)));
  let saldoPedido = Math.max(0, desafio.xp_max_por_pedido - doPedido.reduce((s, l) => s + l.pontos_base, 0));

  const campanha = new Set(desafio.produto_ids);
  const porProduto = new Map<string, number>();
  for (const i of pedido.itens) {
    if (!campanha.has(i.produto_id) || !Number.isFinite(i.quantidade) || i.quantidade <= 0 || pagos.has(i.produto_id)) continue;
    porProduto.set(i.produto_id, (porProduto.get(i.produto_id) ?? 0) + i.quantidade);
  }

  if (pedido.parcial !== true) {
    const unidades = [...porProduto.values()].reduce((s, q) => s + q, 0);
    const pontos = Math.min(Math.floor(unidades * desafio.xp_por_unidade), saldoPedido);
    return pontos > 0 ? [candidatoBase(desafio, pedido, gerarId(), refPedido, pontos, opcoes)] : [];
  }
  const out: CandidatoXp[] = [];
  for (const [produto, q] of porProduto) {
    const pontos = Math.min(Math.floor(q * desafio.xp_por_unidade), saldoPedido);
    if (pontos <= 0) continue;
    saldoPedido -= pontos;
    out.push(candidatoBase(desafio, pedido, gerarId(), `${refPedido}:${produto}`, pontos, opcoes));
  }
  return out;
}

/**
 * RF-TRE-06: atalho do faturamento TOTAL (um lançamento `desafio:pedido`); `null` se o pedido não pontua.
 * Evento parcial gera um candidato por item: use `candidatosDoDesafio` (aqui é recusado com `RangeError`).
 */
export function candidatoDoDesafio(desafio: DesafioVendas, pedido: PedidoFaturadoLido, lancamentoId: string, opcoes: OpcoesDesafio = {}): CandidatoXp | null {
  if (pedido.parcial === true) throw new RangeError('Faturamento parcial gera um lançamento por item: use candidatosDoDesafio.');
  return candidatosDoDesafio(desafio, pedido, () => lancamentoId, opcoes)[0] ?? null;
}
