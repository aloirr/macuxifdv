/**
 * Pedido ao ERP pela API (RN-INT-19; desenho §2.4 e D8). O pedido só vai pela API quando o ERP tem o campo do UUID do Macuxi
 * (a chave de idempotência): o trabalho procura o pedido por ele ANTES de criar. Recusa de regra do ERP vira `rejeitado_erp`
 * com o motivo. Sem o campo, o pedido vai pelo Conector, como hoje. Funções puras.
 */
import { sha256Hex } from '@macuxi/platform-sdk/sha256';
import { VERSAO_CONTRATO, type RetornoErp } from '../contracts';

export type MotivoCanalConector = 'busca_desligada' | 'sem_conector_nuvem' | 'conector_nao_recebe_pedidos' | 'sem_campo_uuid' | 'modelo_sem_pedido_pela_api';

export interface ConectorNuvemParaPedido {
  ativo: boolean;
  recebe_pedidos: boolean;
  /** Nome do campo (customizado) do ERP que guarda o UUID do Macuxi, ex.: `U_MXUUID` (SAP B1), `AD_MXUUID` (Sankhya). */
  campo_uuid: string | null;
  /** O adaptador do modelo sabe procurar e criar pedido. */
  pedido_pela_api: boolean;
}

export type CanalPedido = { canal: 'api' } | { canal: 'conector'; motivo: MotivoCanalConector };

/** RN-INT-19 / D8: pela API só com tudo ligado e o campo do UUID configurado; senão pelo Conector (tabela de entrada). */
export function decidirCanalPedido(e: { buscaLigada: boolean; conector: ConectorNuvemParaPedido | null }): CanalPedido {
  if (!e.buscaLigada) return { canal: 'conector', motivo: 'busca_desligada' };
  const c = e.conector;
  if (c === null) return { canal: 'conector', motivo: 'sem_conector_nuvem' };
  if (!c.ativo || !c.recebe_pedidos) return { canal: 'conector', motivo: 'conector_nao_recebe_pedidos' };
  if (!c.pedido_pela_api) return { canal: 'conector', motivo: 'modelo_sem_pedido_pela_api' };
  if (c.campo_uuid === null || c.campo_uuid.trim() === '') return { canal: 'conector', motivo: 'sem_campo_uuid' };
  return { canal: 'api' };
}

/** RN-INT-19: procura antes de criar. Achou = só adota o número do ERP; não achou = cria. */
export function decidirEntregaPedidoApi(e: { achado: { numero_erp: string } | null }): { acao: 'ja_existe'; numero_erp: string } | { acao: 'criar' } {
  return e.achado ? { acao: 'ja_existe', numero_erp: e.achado.numero_erp } : { acao: 'criar' };
}

export type ResultadoCriacaoPedido =
  | { resultado: 'integrado'; numero_erp: string }
  | { resultado: 'rejeitado_erp'; motivo: string }
  | { resultado: 'tentar_de_novo'; paraColetas: boolean };

/** Uma linha, sem caractere de controle, até 300 caracteres (o limite do `motivo` do retorno). */
export function motivoRecusaSeguro(texto: string): string {
  // eslint-disable-next-line no-control-regex
  return texto.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

/**
 * RN-INT-19 e RN-INT-20: o que a resposta do ERP à criação significa. 2xx com número = `integrado`; 2xx sem número tenta de novo (a
 * próxima tentativa acha o pedido pelo UUID e não duplica); 400, 409 e 422 = recusa de regra, `rejeitado_erp` com o motivo; 401 e 403
 * param as coletas (credencial) e o pedido espera; 408, 429 e 5xx tentam de novo; qualquer outro 4xx é recusa do pedido.
 */
export function classificarCriacaoPedido(e: { status: number; numero_erp: string | null; motivo: string | null }): ResultadoCriacaoPedido {
  const { status } = e;
  if (status >= 200 && status <= 299) {
    return e.numero_erp ? { resultado: 'integrado', numero_erp: e.numero_erp } : { resultado: 'tentar_de_novo', paraColetas: false };
  }
  if (status === 401 || status === 403) return { resultado: 'tentar_de_novo', paraColetas: true };
  if (status === 408 || status === 429 || status >= 500) return { resultado: 'tentar_de_novo', paraColetas: false };
  const motivo = e.motivo ? motivoRecusaSeguro(e.motivo) : '';
  return { resultado: 'rejeitado_erp', motivo: motivo || `O ERP recusou o pedido (HTTP ${status}) sem informar o motivo.` };
}

/** Monta o retorno no MESMO formato do Conector (`RetornoErp`), para a fila aplicar pela mesma regra (RN-INT-08). */
export function montarRetornoDaEntrega(pedidoUuid: string, r: Exclude<ResultadoCriacaoPedido, { resultado: 'tentar_de_novo' }>, ocorridoEm: string): RetornoErp {
  return r.resultado === 'integrado'
    ? { versao_contrato: VERSAO_CONTRATO, pedido_uuid: pedidoUuid, status: 'integrado', numero_erp: r.numero_erp, ocorrido_em: ocorridoEm }
    : { versao_contrato: VERSAO_CONTRATO, pedido_uuid: pedidoUuid, status: 'rejeitado_erp', motivo: r.motivo, ocorrido_em: ocorridoEm };
}

/**
 * Alvo do trabalho `entregar_pedido_erp` (um vivo por alvo; o trabalho concluído não se repete com o mesmo alvo): UUID derivado do pedido
 * e da rodada (a `tentativas` da fila). Rodada nova = entrega nova, por exemplo depois de trocar a credencial recusada.
 */
export function alvoDaEntrega(pedidoUuid: string, rodada: number): string {
  const h = sha256Hex(`entrega_pedido_erp:${pedidoUuid.toLowerCase()}:${Math.max(0, Math.floor(rodada))}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** Inverso de `alvoDaEntrega` entre os pedidos candidatos da fila (rodadas de 0 até a `tentativas` atual); `null` = o pedido já saiu da fila. */
export function pedidoDoAlvo(alvo: string, candidatos: readonly { pedido_uuid: string; tentativas: number }[]): string | null {
  const a = alvo.toLowerCase();
  for (const c of candidatos) {
    for (let r = 0; r <= Math.max(0, c.tentativas); r += 1) if (alvoDaEntrega(c.pedido_uuid, r) === a) return c.pedido_uuid;
  }
  return null;
}
