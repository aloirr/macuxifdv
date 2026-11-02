/**
 * Schemas dos eventos publicados pelo módulo Integracao (nome `<modulo>.<entidade>.<fato>@vN`).
 * Registro: `.coord/contratos/eventos.md`. Mudança incompatível = nova versão + ADR (RN-INT-09).
 */
import { z } from 'zod';
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
    registro: SCHEMA_REGISTRO[entidade].optional(),
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
