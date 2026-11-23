/**
 * Fila do cliente novo para o ERP (RN-INT-22; mesmo padrão da fila de pedidos, RN-INT-08). Funções puras; a API revalida.
 *  - `selecionarClientesPendentes`: pendentes e `enviado` vencidos, por ordem de chegada; cada entrega conta uma tentativa.
 *  - `aplicarRetornoCliente`: `vinculado` (código do ERP) ou `rejeitado_erp`; repetição idêntica é aceita sem reaplicar.
 */
import { aplicarTimeoutEnvio } from './estados';
import { PARAMETROS_PADRAO } from './parametros';

export type EstadoClienteNaFila = 'pendente' | 'enviado' | 'vinculado' | 'rejeitado';

export interface ClienteNaFila<P = Record<string, unknown>> {
  cliente_uuid: string;
  estado: EstadoClienteNaFila;
  payload: P;
  recebido_em: string;
  enviado_em: string | null;
  tentativas: number;
  external_id: string | null;
  motivo: string | null;
  removido_em: string | null;
}

export interface SelecaoClientes<P> {
  entregar: (P & { tentativa: number })[];
  atualizacoes: { cliente_uuid: string; estado: 'enviado'; enviado_em: string; tentativas: number }[];
  reenviados: string[];
}

export function selecionarClientesPendentes<P>(fila: readonly ClienteNaFila<P>[], agora: string, opcoes: { limite?: number; timeoutMin?: number } = {}): SelecaoClientes<P> {
  const limite = opcoes.limite ?? PARAMETROS_PADRAO.pedidosPorConsulta;
  const candidatos = fila
    .filter((c) => c.removido_em === null && (c.estado === 'pendente' || c.estado === 'enviado'))
    .map((c) => ({ c, t: aplicarTimeoutEnvio({ estado: c.estado as 'pendente' | 'enviado', enviado_em: c.enviado_em, tentativas: c.tentativas }, agora, { timeoutMin: opcoes.timeoutMin }) }))
    .filter((x) => x.t.estado === 'pendente')
    .sort((a, b) => Date.parse(a.c.recebido_em) - Date.parse(b.c.recebido_em) || (a.c.cliente_uuid < b.c.cliente_uuid ? -1 : a.c.cliente_uuid > b.c.cliente_uuid ? 1 : 0))
    .slice(0, limite);
  return {
    // payload antigo (v1.0.27) trazia `aprovado_em`: sai e a coluna `recebido_em` é a fonte do campo público
    entregar: candidatos.map(({ c }) => {
      const { aprovado_em: _antigo, ...payload } = c.payload as Record<string, unknown>;
      return { ...payload, recebido_em: c.recebido_em, tentativa: c.tentativas + 1 } as unknown as P & { tentativa: number };
    }),
    atualizacoes: candidatos.map(({ c }) => ({ cliente_uuid: c.cliente_uuid, estado: 'enviado' as const, enviado_em: agora, tentativas: c.tentativas + 1 })),
    reenviados: candidatos.filter(({ t }) => t.reenviado).map(({ c }) => c.cliente_uuid),
  };
}

export interface RetornoClienteEntrada {
  cliente_uuid: string;
  status: 'vinculado' | 'rejeitado_erp';
  external_id?: string | null;
  motivo?: string | null;
  ocorrido_em: string;
}

export type CodigoFalhaRetornoCliente = 'cliente_desconhecido' | 'cliente_nao_entregue' | 'transicao_invalida' | 'external_id_divergente';

export type ResultadoRetornoCliente =
  | { ok: false; codigo: CodigoFalhaRetornoCliente; mensagem: string; erros: { codigo: string; campo: string | null; mensagem: string }[] }
  | {
      ok: true;
      repetido: boolean;
      atualizacao: { estado: 'vinculado' | 'rejeitado'; external_id: string | null; motivo: string | null };
      /** Só o retorno novo publica `integracao.cliente.retorno_erp@1`. */
      publicar: boolean;
      evento: { cliente_id: string; status: 'vinculado' | 'rejeitado_erp'; external_id: string | null; motivo: string | null; ocorrido_em: string };
    };

const falha = (codigo: CodigoFalhaRetornoCliente, campo: string | null, mensagem: string): ResultadoRetornoCliente => ({ ok: false, codigo, mensagem, erros: [{ codigo, campo, mensagem }] });

export function aplicarRetornoCliente(fila: Pick<ClienteNaFila, 'estado' | 'external_id' | 'removido_em'> | null, retorno: RetornoClienteEntrada): ResultadoRetornoCliente {
  if (!fila || fila.removido_em !== null) return falha('cliente_desconhecido', null, 'O Hub não conhece este cliente. Só cliente entregue ao Conector recebe retorno.');
  const codigo = retorno.status === 'vinculado' ? (retorno.external_id ?? '').trim() : null;
  const motivo = retorno.status === 'rejeitado_erp' ? (retorno.motivo ?? '').trim() : null;
  const estado = retorno.status === 'vinculado' ? ('vinculado' as const) : ('rejeitado' as const);
  const evento = { cliente_id: retorno.cliente_uuid, status: retorno.status, external_id: codigo, motivo, ocorrido_em: retorno.ocorrido_em };
  const aceito = (repetido: boolean): ResultadoRetornoCliente => ({ ok: true, repetido, atualizacao: { estado, external_id: codigo, motivo }, publicar: !repetido, evento });

  if (fila.estado === 'pendente') return falha('cliente_nao_entregue', null, 'Este cliente ainda não foi entregue ao Conector. Busque-o em GET /clientes/pendentes antes de devolver o retorno.');
  if (fila.estado === 'enviado') return aceito(false);
  // vinculado/rejeitado: estados finais; o mesmo retorno de novo é repetição
  if (retorno.status === 'vinculado') {
    if (fila.external_id !== null && fila.external_id === codigo) return aceito(true);
    if (fila.estado === 'vinculado') return falha('external_id_divergente', 'external_id', `O cliente já tem o código ${fila.external_id} no ERP e o retorno informa outro. Confira no ERP se o cliente foi criado duas vezes.`);
    return falha('transicao_invalida', 'status', 'O cliente já foi rejeitado e é um estado final. Peça ao Macuxi para reenviar o cadastro.');
  }
  if (fila.estado === 'rejeitado') return aceito(true);
  return falha('transicao_invalida', 'status', 'O cliente já foi vinculado ao código do ERP; rejeitado_erp não vale depois do vínculo.');
}
