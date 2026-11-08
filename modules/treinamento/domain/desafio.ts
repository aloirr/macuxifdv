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
// Entrada do desafio = `EventoFaturadoNoDesafio` dos contracts (payload de `vendedor.pedido.faturado@1` + `evento_id` e
// `tenant_id` do envelope, lido por `lerPedidoFaturado`). Tipo único (T-0036): o domínio não declara forma própria,
// então mudança no contrato quebra o typecheck daqui (regra 3 do CLAUDE.md).
import type { EventoFaturadoNoDesafio } from '../contracts';
import { PARAMETROS_PADRAO, type ParametrosTreinamento } from './parametros';
import { proporLancamento, type CandidatoXp, type LancamentoXp, type ResultadoLancamento } from './xp';

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

export type AvaliacaoPedido =
  | { elegivel: true; unidades: number; pontos_base: number }
  | { elegivel: false; motivo: 'OUTRO_TENANT' | 'PEDIDO_NAO_FATURADO' | 'PARCIAL_SEM_ITENS' | 'DESAFIO_INATIVO' | 'FORA_DA_VIGENCIA' | 'SEM_ITENS_DA_CAMPANHA' };

/** RF-TRE-06: XP do pedido faturado (deste evento, sem olhar o histórico) = unidades dos itens da campanha × XP por unidade (inteiro, para baixo), limitado ao máximo por pedido. */
export function avaliarPedidoNoDesafio(desafio: DesafioVendas, pedido: Omit<EventoFaturadoNoDesafio, 'evento_id'>, fuso: string = PARAMETROS_PADRAO.fuso): AvaliacaoPedido {
  if (pedido.tenant_id !== desafio.tenant_id) return { elegivel: false, motivo: 'OUTRO_TENANT' };
  // O contrato já recusa pedido sem `faturado_em`; a checagem fica como defesa (a API sempre revalida).
  if (!pedido.faturado_em) return { elegivel: false, motivo: 'PEDIDO_NAO_FATURADO' };
  if (pedido.parcial === true && pedido.itens.length === 0) return { elegivel: false, motivo: 'PARCIAL_SEM_ITENS' };
  if (!desafio.ativo) return { elegivel: false, motivo: 'DESAFIO_INATIVO' };
  const dia = localDate(new Date(pedido.faturado_em), fuso);
  if (dia < desafio.vigencia_inicio || dia > desafio.vigencia_fim) return { elegivel: false, motivo: 'FORA_DA_VIGENCIA' };
  const campanha = new Set(desafio.produto_ids);
  const unidades = pedido.itens.filter((i) => campanha.has(i.produto_id) && Number.isInteger(i.quantidade) && i.quantidade > 0).reduce((s, i) => s + i.quantidade, 0);
  if (unidades <= 0) return { elegivel: false, motivo: 'SEM_ITENS_DA_CAMPANHA' };
  return { elegivel: true, unidades, pontos_base: Math.min(Math.floor(unidades * desafio.xp_por_unidade), desafio.xp_max_por_pedido) };
}

/**
 * Opções do candidato. `fuso` e `xp_max_por_desafio` são os parâmetros do tenant: passe o MESMO `params` que vai ao
 * `processarLote` (`{ ...params, lancamentos }`), para a vigência (aqui) e o `dia` do lançamento (lá) usarem o mesmo fuso.
 */
export interface OpcoesDesafio extends Partial<Pick<ParametrosTreinamento, 'fuso' | 'xp_max_por_desafio'>> {
  /**
   * Lançamentos já gravados do vendedor (idealmente os `desafio_vendas` dele neste desafio): servem para não pagar de
   * novo o evento/total já pago e para descontar do máximo por pedido o que os eventos anteriores já pagaram.
   * Ausente = sem histórico.
   */
  lancamentos?: readonly LancamentoXp[];
}

/** Chave natural do lançamento do evento (`referencia_id`): `desafio:pedido:evento_id` (parcial) ou `desafio:pedido:total`. */
export const referenciaDoDesafio = (desafioId: string, pedido: Pick<EventoFaturadoNoDesafio, 'pedido_id' | 'evento_id' | 'parcial'>): string =>
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
 * Fuso: o de `opcoes.fuso` define a vigência; use o mesmo do `processarLote` (veja `OpcoesDesafio`).
 * Quantidade: só conta item com quantidade INTEIRA > 0 (como manda o contrato oficial); fração é ignorada, então
 * não há arredondamento por evento (duas parciais de 0,5 un. não pagam 0 + 0 por acaso: nenhuma conta).
 */
export function candidatoDoDesafio(desafio: DesafioVendas, pedido: EventoFaturadoNoDesafio, lancamentoId: string, opcoes: OpcoesDesafio = {}): CandidatoXp | null {
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
    ocorrido_em: pedido.faturado_em,
    ...(max > 0 ? { teto_desafio: { desafio_id: desafio.id, max } } : {}),
  };
}

/**
 * RF-TRE-06, RN-TRE-04, RN-TRE-08: caminho único do pedido faturado ao lançamento. Recebe o `params` do tenant UMA vez e o
 * usa na vigência (candidato) e no `dia` do lançamento (`proporLancamento`), sem como os fusos divergirem.
 * `null` = não paga (inelegível ou repetição); senão, o resultado de `proporLancamento` (aceito, duplicado, sem pontos).
 * `existentes` = lançamentos já gravados do vendedor (idealmente os dele).
 */
export function lancarPedidoNoDesafio(
  desafio: DesafioVendas,
  pedido: EventoFaturadoNoDesafio,
  lancamentoId: string,
  existentes: readonly LancamentoXp[],
  params: Pick<ParametrosTreinamento, 'fuso' | 'xp_max_por_desafio' | 'xp_teto_diario'> = PARAMETROS_PADRAO,
): ResultadoLancamento | null {
  const c = candidatoDoDesafio(desafio, pedido, lancamentoId, { fuso: params.fuso, xp_max_por_desafio: params.xp_max_por_desafio, lancamentos: existentes });
  return c ? proporLancamento(existentes, c, params) : null;
}
