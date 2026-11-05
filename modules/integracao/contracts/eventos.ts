/**
 * Schemas dos eventos publicados pelo módulo Integracao (nome `<modulo>.<entidade>.<fato>@vN`).
 * Registro: `.coord/contratos/eventos.md`. Mudança incompatível = nova versão + ADR (RN-INT-09).
 */
import { z } from 'zod';
import { definirEvento, type DefinicaoEvento } from '@macuxi/platform-sdk/eventos';
import { DataHoraUtc, Uuid } from './base';
import { ENTIDADES, SCHEMA_REGISTRO, type Entidade } from './entidades';
import { EstadoLote, ModoCarga } from './lote';
import { EstadoPedidoErp, ItemFaturado, NotaRetorno } from './pedido';

export const AcaoRegistro = z.enum(['criado', 'atualizado', 'inativado']);
export type AcaoRegistro = z.infer<typeof AcaoRegistro>;

/**
 * `integracao.<entidade>.atualizado@1` — um evento por registro que mudou (hash novo) ou foi
 * inativado pela carga completa (RN-INT-02/06). Reenvio com o mesmo hash não publica.
 * Em `inativado`, `registro` é omitido.
 */
export function eventoEntidadeAtualizado<E extends Entidade>(entidade: E) {
  return z.object({
    lote_id: Uuid,
    entidade: z.literal(entidade),
    external_id: z.string().min(1),
    acao: AcaoRegistro,
    hash: z.string().min(1),
    registro: z.optional(SCHEMA_REGISTRO[entidade] as (typeof SCHEMA_REGISTRO)[E]),
    ocorrido_em: DataHoraUtc,
  });
}

export const NOMES_EVENTO_ATUALIZADO = ENTIDADES.map((e) => `integracao.${e}.atualizado@1` as const);

export const EVENTOS_ATUALIZADO = {
  vendedor: eventoEntidadeAtualizado('vendedor'),
  cliente: eventoEntidadeAtualizado('cliente'),
  produto: eventoEntidadeAtualizado('produto'),
  preco: eventoEntidadeAtualizado('preco'),
  estoque: eventoEntidadeAtualizado('estoque'),
  titulo: eventoEntidadeAtualizado('titulo'),
  nota: eventoEntidadeAtualizado('nota'),
  rota: eventoEntidadeAtualizado('rota'),
  catalogo_no: eventoEntidadeAtualizado('catalogo_no'),
  produto_unidade: eventoEntidadeAtualizado('produto_unidade'),
  cliente_endereco: eventoEntidadeAtualizado('cliente_endereco'),
  transportadora: eventoEntidadeAtualizado('transportadora'),
} as const;

/** `integracao.pedido.retorno_erp@1` — cada retorno aceito do ERP (RN-INT-08). */
export const PedidoRetornoErpEvento = z.object({
  pedido_uuid: Uuid,
  status: EstadoPedidoErp,
  numero_erp: z.string().nullable(),
  motivo: z.string().nullable(),
  nota: NotaRetorno.nullable(),
  /** Itens faturados nesta nota (campo opcional novo, compatível com @1; RN-INT-08). */
  itens_faturados: z.array(ItemFaturado).nullish(),
  ocorrido_em: DataHoraUtc,
});
export type PedidoRetornoErpEvento = z.infer<typeof PedidoRetornoErpEvento>;

/** `integracao.lote.concluido@1` — lote chegou a estado final (monitor e notificações). */
export const LoteConcluidoEvento = z.object({
  lote_id: Uuid,
  entidade: z.enum(ENTIDADES),
  modo: ModoCarga,
  status: EstadoLote.extract(['concluido', 'concluido_com_erros', 'falhou']),
  recebidas: z.number().int().nonnegative(),
  com_erro: z.number().int().nonnegative(),
  concluido_em: DataHoraUtc,
});
export type LoteConcluidoEvento = z.infer<typeof LoteConcluidoEvento>;

/** `integracao.reconciliacao.divergente@1` — divergência acima da tolerância (RN-INT-07). */
export const ReconciliacaoDivergenteEvento = z.object({
  entidade: z.enum(ENTIDADES),
  data_referencia: z.string(),
  contagem_erp: z.number().int().nonnegative(),
  contagem_macuxi: z.number().int().nonnegative(),
  soma_erp: z.number().nullable(),
  soma_macuxi: z.number().nullable(),
  motivos: z.array(z.string()).min(1),
});
export type ReconciliacaoDivergenteEvento = z.infer<typeof ReconciliacaoDivergenteEvento>;

/**
 * `integracao.lote.recebido@1` — evento INTERNO (T-0025): o `POST /lotes` o publica na mesma transação que grava o lote e o
 * staging; o próprio módulo o consome para aplicar o lote em segundo plano (outbox como fila, ADR 0007). Não tem outro consumidor.
 * O payload não leva linhas (nem dado pessoal): quem processa lê o staging do lote.
 */
export const LoteRecebidoEvento = z.object({
  lote_id: Uuid,
  conector_id: z.string().min(1),
  entidade: z.enum(ENTIDADES),
  modo: ModoCarga,
  recebidas: z.number().int().positive(),
  recebido_em: DataHoraUtc,
});
export type LoteRecebidoEvento = z.infer<typeof LoteRecebidoEvento>;

// ---------- definições (T-0024): `tx.publicar(EVENTO_..., payload, agregadoId)` e consumo com `eventoTolerante(EVENTO_...)` ----------
export const EVENTO_LOTE_RECEBIDO = definirEvento('integracao.lote.recebido@1', LoteRecebidoEvento);
export const EVENTO_LOTE_CONCLUIDO = definirEvento('integracao.lote.concluido@1', LoteConcluidoEvento);
export const EVENTO_PEDIDO_RETORNO_ERP = definirEvento('integracao.pedido.retorno_erp@1', PedidoRetornoErpEvento);
export const EVENTO_RECONCILIACAO_DIVERGENTE = definirEvento('integracao.reconciliacao.divergente@1', ReconciliacaoDivergenteEvento);

export const EVENTO_ERP_VENDEDOR_ATUALIZADO = definirEvento('integracao.vendedor.atualizado@1', EVENTOS_ATUALIZADO.vendedor);
export const EVENTO_ERP_CLIENTE_ATUALIZADO = definirEvento('integracao.cliente.atualizado@1', EVENTOS_ATUALIZADO.cliente);
export const EVENTO_ERP_PRODUTO_ATUALIZADO = definirEvento('integracao.produto.atualizado@1', EVENTOS_ATUALIZADO.produto);
export const EVENTO_ERP_PRECO_ATUALIZADO = definirEvento('integracao.preco.atualizado@1', EVENTOS_ATUALIZADO.preco);
export const EVENTO_ERP_ESTOQUE_ATUALIZADO = definirEvento('integracao.estoque.atualizado@1', EVENTOS_ATUALIZADO.estoque);
export const EVENTO_ERP_TITULO_ATUALIZADO = definirEvento('integracao.titulo.atualizado@1', EVENTOS_ATUALIZADO.titulo);
export const EVENTO_ERP_NOTA_ATUALIZADO = definirEvento('integracao.nota.atualizado@1', EVENTOS_ATUALIZADO.nota);
export const EVENTO_ERP_ROTA_ATUALIZADO = definirEvento('integracao.rota.atualizado@1', EVENTOS_ATUALIZADO.rota);
export const EVENTO_ERP_CATALOGO_NO_ATUALIZADO = definirEvento('integracao.catalogo_no.atualizado@1', EVENTOS_ATUALIZADO.catalogo_no);
export const EVENTO_ERP_PRODUTO_UNIDADE_ATUALIZADO = definirEvento('integracao.produto_unidade.atualizado@1', EVENTOS_ATUALIZADO.produto_unidade);
export const EVENTO_ERP_CLIENTE_ENDERECO_ATUALIZADO = definirEvento('integracao.cliente_endereco.atualizado@1', EVENTOS_ATUALIZADO.cliente_endereco);
export const EVENTO_ERP_TRANSPORTADORA_ATUALIZADO = definirEvento('integracao.transportadora.atualizado@1', EVENTOS_ATUALIZADO.transportadora);

/** `integracao.<entidade>.atualizado@1`, uma definição por entidade (o payload é validado pelo schema da entidade). */
export const EVENTOS_ENTIDADE_ATUALIZADO = {
  vendedor: EVENTO_ERP_VENDEDOR_ATUALIZADO,
  cliente: EVENTO_ERP_CLIENTE_ATUALIZADO,
  produto: EVENTO_ERP_PRODUTO_ATUALIZADO,
  preco: EVENTO_ERP_PRECO_ATUALIZADO,
  estoque: EVENTO_ERP_ESTOQUE_ATUALIZADO,
  titulo: EVENTO_ERP_TITULO_ATUALIZADO,
  nota: EVENTO_ERP_NOTA_ATUALIZADO,
  rota: EVENTO_ERP_ROTA_ATUALIZADO,
  catalogo_no: EVENTO_ERP_CATALOGO_NO_ATUALIZADO,
  produto_unidade: EVENTO_ERP_PRODUTO_UNIDADE_ATUALIZADO,
  cliente_endereco: EVENTO_ERP_CLIENTE_ENDERECO_ATUALIZADO,
  transportadora: EVENTO_ERP_TRANSPORTADORA_ATUALIZADO,
} as const;

export const eventoAtualizado = (entidade: Entidade): DefinicaoEvento => EVENTOS_ENTIDADE_ATUALIZADO[entidade] as DefinicaoEvento;
