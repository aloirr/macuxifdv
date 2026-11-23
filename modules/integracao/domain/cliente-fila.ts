/**
 * Fila do cliente novo para o ERP (RN-INT-22; mesmo padrão da fila de pedidos, RN-INT-08). Funções puras; a API revalida.
 *  - `selecionarClientesPendentes`: pendentes e `enviado` vencidos, por ordem de chegada; cada entrega conta uma tentativa da revisão.
 *  - `decidirEntradaClienteNaFila`: o reenvio do recusado (revisão nova, ADR 0069) reabre a mesma linha; `vinculado` nunca reabre.
 *  - `aplicarRetornoCliente`: `vinculado` (código do ERP) ou `rejeitado_erp` (motivo e, opcional, erros por campo); repetição idêntica é
 *    aceita sem reaplicar; recusa de revisão antiga é obsoleta; código do ERP de revisão antiga vale.
 */
import { mascararDadoPessoal } from '@macuxi/comum/dado-pessoal';
import { aplicarTimeoutEnvio } from './estados';
import { PARAMETROS_PADRAO } from './parametros';

export type EstadoClienteNaFila = 'pendente' | 'enviado' | 'vinculado' | 'rejeitado';

/** Erro por campo devolvido pelo ERP (RN-INT-22): o formato do `ErroCampoRetornoCliente` do contrato. */
export interface ErroRetornoCliente {
  campo: string;
  codigo: string;
  mensagem: string;
}

/** Limites do erro por campo gravado (ADR 0069 §8): até 50 itens e mensagem de até 300 caracteres. */
export const ERROS_RETORNO_CLIENTE_MAX = 50;
export const MENSAGEM_ERRO_RETORNO_MAX = 300;

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
  /** Revisão do pré-cadastro na linha (1 na primeira; sobe a cada reenvio). */
  revisao: number;
  /** sha256 dos dados da revisão (nulo nas linhas anteriores à v1.0.29). */
  hash: string | null;
  /** Erros por campo da última rejeição (só com estado `rejeitado`). */
  erros: ErroRetornoCliente[] | null;
}

export interface SelecaoClientes<P> {
  entregar: (P & { revisao: number; hash: string | null; tentativa: number })[];
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
    // payload antigo (v1.0.27) trazia `aprovado_em`: sai e a coluna `recebido_em` é a fonte do campo público;
    // `revisao` e `hash` vêm das colunas (ADR 0069), nunca do payload
    entregar: candidatos.map(({ c }) => {
      const { aprovado_em: _antigo, revisao: _revisao, hash: _hash, ...payload } = c.payload as Record<string, unknown>;
      return { ...payload, recebido_em: c.recebido_em, revisao: c.revisao, hash: c.hash, tentativa: c.tentativas + 1 } as unknown as P & { revisao: number; hash: string | null; tentativa: number };
    }),
    atualizacoes: candidatos.map(({ c }) => ({ cliente_uuid: c.cliente_uuid, estado: 'enviado' as const, enviado_em: agora, tentativas: c.tentativas + 1 })),
    reenviados: candidatos.filter(({ t }) => t.reenviado).map(({ c }) => c.cliente_uuid),
  };
}

/**
 * RN-INT-22 (ADR 0069 §8): o que fazer com o pré-cadastro que a consulta do Core devolveu. Sem linha = `inserir`; revisão maior numa
 * linha que não está `vinculado` = `reabrir` a mesma linha (`pendente`, revisão e hash novos, tentativas zeradas); o resto = `nada`.
 */
export function decidirEntradaClienteNaFila(atual: { revisao: number; estado: EstadoClienteNaFila } | null, nova: { revisao: number }): 'inserir' | 'reabrir' | 'nada' {
  if (!atual) return 'inserir';
  if (atual.estado !== 'vinculado' && nova.revisao > atual.revisao) return 'reabrir';
  return 'nada';
}

/** Erros do ERP prontos para gravar (ADR 0069 §8): `trim`, mensagem sem dado pessoal e cortada em 300, até 50 itens. */
export function errosRetornoSeguros(erros: readonly ErroRetornoCliente[] | null | undefined): ErroRetornoCliente[] {
  return (erros ?? []).slice(0, ERROS_RETORNO_CLIENTE_MAX).map((e) => ({
    campo: e.campo.trim(),
    codigo: e.codigo.trim(),
    mensagem: mascararDadoPessoal(e.mensagem.trim()).slice(0, MENSAGEM_ERRO_RETORNO_MAX),
  }));
}

const chaveErro = (e: ErroRetornoCliente) => JSON.stringify([e.campo, e.codigo, e.mensagem]);
const chavesOrdenadas = (erros: readonly ErroRetornoCliente[] | null) => (erros ?? []).map(chaveErro).sort();

/** RN-INT-22: duas recusas são a mesma quando o motivo (sem espaços nas pontas) e os erros (em qualquer ordem) são iguais. Nulo = sem erros. */
export function iguaisErrosRetorno(
  a: { motivo: string | null; erros: readonly ErroRetornoCliente[] | null },
  b: { motivo: string | null; erros: readonly ErroRetornoCliente[] | null },
): boolean {
  if ((a.motivo ?? '').trim() !== (b.motivo ?? '').trim()) return false;
  const ea = chavesOrdenadas(a.erros);
  const eb = chavesOrdenadas(b.erros);
  return ea.length === eb.length && ea.every((k, i) => k === eb[i]);
}

export interface RetornoClienteEntrada {
  cliente_uuid: string;
  status: 'vinculado' | 'rejeitado_erp';
  external_id?: string | null;
  motivo?: string | null;
  /** Revisão a que o retorno se refere; ausente = a revisão atual da linha (Conector antigo). */
  revisao?: number | null;
  erros?: readonly ErroRetornoCliente[] | null;
  ocorrido_em: string;
}

export type CodigoFalhaRetornoCliente = 'cliente_desconhecido' | 'cliente_nao_entregue' | 'transicao_invalida' | 'external_id_divergente' | 'revisao_desconhecida';

export interface EventoRetornoCliente {
  cliente_id: string;
  status: 'vinculado' | 'rejeitado_erp';
  external_id: string | null;
  motivo: string | null;
  ocorrido_em: string;
  revisao: number;
  erros?: ErroRetornoCliente[];
}

export type ResultadoRetornoCliente =
  | { ok: false; codigo: CodigoFalhaRetornoCliente; mensagem: string; erros: { codigo: string; campo: string | null; mensagem: string }[] }
  | {
      ok: true;
      repetido: boolean;
      /** Recusa de revisão anterior à da linha: aceita (200) sem gravar nem publicar. */
      obsoleto: boolean;
      /** Grava a `atualizacao` na linha. */
      gravar: boolean;
      atualizacao: { estado: 'vinculado' | 'rejeitado'; external_id: string | null; motivo: string | null; erros: ErroRetornoCliente[] | null };
      /** Só o retorno novo publica `integracao.cliente.retorno_erp@1`. */
      publicar: boolean;
      evento: EventoRetornoCliente;
      /** Revisão da linha depois do retorno (vai na resposta). */
      revisao: number;
    };

const falha = (codigo: CodigoFalhaRetornoCliente, campo: string | null, mensagem: string): ResultadoRetornoCliente => ({ ok: false, codigo, mensagem, erros: [{ codigo, campo, mensagem }] });

const NAO_ENTREGUE = 'Este cliente ainda não foi entregue ao Conector. Busque-o em GET /clientes/pendentes antes de devolver o retorno.';

export function aplicarRetornoCliente(
  fila: Pick<ClienteNaFila, 'estado' | 'external_id' | 'removido_em' | 'revisao' | 'motivo' | 'erros'> | null,
  retorno: RetornoClienteEntrada,
): ResultadoRetornoCliente {
  if (!fila || fila.removido_em !== null) return falha('cliente_desconhecido', null, 'O Hub não conhece este cliente. Só cliente entregue ao Conector recebe retorno.');
  const revisao = retorno.revisao ?? fila.revisao;
  if (revisao > fila.revisao) {
    return falha('revisao_desconhecida', 'revisao', `O retorno informa a revisão ${revisao}, mas a revisão atual deste cliente é ${fila.revisao}. Devolva a revisão recebida em GET /clientes/pendentes.`);
  }
  const antiga = revisao < fila.revisao;
  const codigo = retorno.status === 'vinculado' ? (retorno.external_id ?? '').trim() : null;
  const motivo = retorno.status === 'rejeitado_erp' ? (retorno.motivo ?? '').trim() : null;
  const erros = retorno.status === 'rejeitado_erp' ? errosRetornoSeguros(retorno.erros) : null;
  const estado = retorno.status === 'vinculado' ? ('vinculado' as const) : ('rejeitado' as const);
  const evento: EventoRetornoCliente = { cliente_id: retorno.cliente_uuid, status: retorno.status, external_id: codigo, motivo, ocorrido_em: retorno.ocorrido_em, revisao, ...(erros ? { erros } : {}) };
  const atualizacao = { estado, external_id: codigo, motivo, erros: erros && erros.length > 0 ? erros : null };
  const aceito = (repetido: boolean, obsoleto = false): ResultadoRetornoCliente => {
    const novo = !repetido && !obsoleto;
    return { ok: true, repetido, obsoleto, gravar: novo, atualizacao, publicar: novo, evento, revisao: fila.revisao };
  };

  if (retorno.status === 'vinculado') {
    if (fila.external_id !== null && fila.external_id === codigo && (fila.estado === 'vinculado' || fila.estado === 'rejeitado')) return aceito(true);
    if (fila.estado === 'vinculado') return falha('external_id_divergente', 'external_id', `O cliente já tem o código ${fila.external_id} no ERP e o retorno informa outro. Confira no ERP se o cliente foi criado duas vezes.`);
    // o código vale mesmo de revisão antiga: o cliente existe no ERP (ADR 0069 §8)
    if (antiga) return aceito(false);
    if (fila.estado === 'pendente') return falha('cliente_nao_entregue', null, NAO_ENTREGUE);
    if (fila.estado === 'enviado') return aceito(false);
    return falha('transicao_invalida', 'status', 'O cliente já foi rejeitado e é um estado final. Peça ao Macuxi para reenviar o cadastro.');
  }
  if (fila.estado === 'vinculado') return falha('transicao_invalida', 'status', 'O cliente já foi vinculado ao código do ERP; rejeitado_erp não vale depois do vínculo.');
  // recusa de revisão antiga não sobrescreve a revisão nova
  if (antiga) return aceito(false, true);
  if (fila.estado === 'pendente') return falha('cliente_nao_entregue', null, NAO_ENTREGUE);
  if (fila.estado === 'enviado') return aceito(false);
  // rejeitado na mesma revisão: a mesma recusa é repetição; outro motivo ou outros erros é fato novo
  return aceito(iguaisErrosRetorno({ motivo: fila.motivo, erros: fila.erros }, { motivo, erros }));
}
