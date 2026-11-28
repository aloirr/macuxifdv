/**
 * Opção `promotor_ve_pedidos` (RN-CORE-01; RN-PRO-01; T-0061) e leitura de pedidos do usuário (ADR 0073 §2.4). Funções puras,
 * usadas pela API (consulta e rotas) e pelo app (Cliente 360 offline). Padrão LIGADO: sem registro, ou com valor inválido, o promotor continua vendo os pedidos da carteira.
 * A opção só controla a LEITURA; a escrita de pedido pelo promotor é sempre negada (RN-PRO-01).
 */
import { podePeloCargo, promotorNaRequisicao, type Perfil, type PerfilDaRequisicaoV2 } from '@macuxi/platform-sdk';
import { promotorVePedidos, promotorVePedidosDasLinhas, type LeituraDePedidosDoUsuario } from '../contracts/promotor-pedidos';

// A resolução do valor mora em contracts (o Vendedor a importa de lá); o domain reexporta.
export { promotorVePedidos, promotorVePedidosDasLinhas };

/** O perfil enxerga pedidos? Só o promotor depende da opção; os demais seguem o escopo de carteira de sempre. */
export function perfilPodeVerPedidos(perfil: string, promotorVe: boolean): boolean {
  return perfil === 'promotor' ? promotorVe : true;
}

/**
 * RN-PRO-01 + decisão R-20261102-204544 (T-0077 D2): o histórico de compras (`historico_compra`, `resumo_compras`) é leitura de
 * pedidos. Promotor só o recebe com `promotor_ve_pedidos` ligada; os demais perfis seguem o escopo de carteira de sempre.
 */
export function perfilRecebeHistoricoDeCompra(perfil: string, promotorVe: boolean): boolean {
  return perfilPodeVerPedidos(perfil, promotorVe);
}

/** Parte de `ctx.usuario` que decide. */
export interface UsuarioDaRequisicaoPedidos {
  perfil?: Perfil;
  perfil_acesso?: PerfilDaRequisicaoV2;
}

/**
 * ADR 0073 §2.4: o usuário lê pedidos? Só o promotor depende: com `perfil_acesso` (tenant em `concessao`) vale a chave `pedido.ver`
 * pela regra do SDK (`podePeloCargo`, com a trava do cargo); sem ele (tenant em `legado`) vale o parâmetro `promotor_ve_pedidos`.
 * Os demais seguem o escopo de carteira.
 */
export function usuarioDaRequisicaoVePedidos(u: UsuarioDaRequisicaoPedidos, parametroLigado: boolean): boolean {
  if (!promotorNaRequisicao(u)) return true;
  return u.perfil_acesso ? podePeloCargo(u.perfil_acesso, 'pedido.ver') : parametroLigado;
}

/** Linhas da entidade `parametro` do pull (só o que a regra lê). */
export type LinhaParametro = { modulo: string; chave: string; valor?: unknown; deleted_at?: string | null };

/**
 * No aparelho (offline): este usuário vê pedidos? Só o promotor depende da opção sincronizada; perfil ausente
 * (`null`, ex.: demonstração) não é promotor. Vale para o Cliente 360 e para o que o Core monta com extensões.
 */
export function pedidosVisiveisNoAparelho(perfil: string | null | undefined, parametros: readonly LinhaParametro[]): boolean {
  return perfilPodeVerPedidos(perfil ?? '', promotorVePedidosDasLinhas(parametros));
}

/**
 * RN-PRO-01 / RN-CORE-01 / ADR 0073 §2.4, no aparelho: a leitura do usuário guardada (`GET /v1/core/eu/leitura-de-pedidos`) vale
 * só se for do usuário da sessão e de tenant em `concessao` (aí decide `ve_pedidos`: cargo e concessão). Sem leitura, de outro
 * usuário ou em `legado`: `pedidosVisiveisNoAparelho` (perfil e parâmetro sincronizado), como antes.
 */
export function pedidosVisiveisPelaLeitura(e: {
  usuarioId: string | null | undefined;
  perfil: string | null | undefined;
  parametros: readonly LinhaParametro[];
  leitura: LeituraDePedidosDoUsuario | null | undefined;
}): boolean {
  const l = e.leitura;
  if (l && e.usuarioId && l.usuario_id === e.usuarioId && l.leitura === 'concessao') return l.ve_pedidos;
  return pedidosVisiveisNoAparelho(e.perfil, e.parametros);
}

const ACAO_DE_PEDIDO = /^pedido(_[a-z0-9_]+)?\./;

/**
 * Filtra, no ponto de montagem do Core, os itens de extensão (`cliente.abas`, `cliente.acoes`) que mostram pedidos quando o
 * promotor não os vê: ação `pedido.*`/`pedido_item.*` (convenção do doc 03) ou `payload.mostraPedidos === true` (declaração do módulo).
 */
export function filtrarExtensoesDePedido<T extends { acao?: string; payload?: unknown }>(itens: readonly T[], verPedidos: boolean): T[] {
  if (verPedidos) return [...itens];
  return itens.filter((i) => {
    if (i.acao && ACAO_DE_PEDIDO.test(i.acao)) return false;
    return (i.payload as { mostraPedidos?: boolean } | null | undefined)?.mostraPedidos !== true;
  });
}
