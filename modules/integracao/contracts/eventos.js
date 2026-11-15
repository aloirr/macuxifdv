/**
 * Schemas dos eventos publicados pelo módulo Integracao (nome `<modulo>.<entidade>.<fato>@vN`).
 * Registro: `.coord/contratos/eventos.md`. Mudança incompatível = nova versão + ADR (RN-INT-09).
 */
import { z } from 'zod';
import { definirEvento } from '@macuxi/platform-sdk/eventos';
import { DataHoraUtc, Uuid } from './base';
import { ENTIDADES, SCHEMA_REGISTRO } from './entidades';
import { EstadoLote, ModoCarga } from './lote';
import { EstadoPedidoErp, ItemFaturado, NotaRetorno } from './pedido';
export const AcaoRegistro = z.enum(['criado', 'atualizado', 'inativado']);
/**
 * `integracao.<entidade>.atualizado@1` — um evento por registro que mudou (hash novo) ou foi
 * inativado pela carga completa (RN-INT-02/06). Reenvio com o mesmo hash não publica.
 * Em `inativado`, `registro` é omitido.
 */
export function eventoEntidadeAtualizado(entidade) {
    return z.object({
        lote_id: Uuid,
        entidade: z.literal(entidade),
        external_id: z.string().min(1),
        acao: AcaoRegistro,
        hash: z.string().min(1),
        registro: z.optional(SCHEMA_REGISTRO[entidade]),
        ocorrido_em: DataHoraUtc,
    });
}
export const NOMES_EVENTO_ATUALIZADO = ENTIDADES.map((e) => `integracao.${e}.atualizado@1`);
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
    forma_pagamento: eventoEntidadeAtualizado('forma_pagamento'),
    prazo_pagamento: eventoEntidadeAtualizado('prazo_pagamento'),
    tabela_escalonada: eventoEntidadeAtualizado('tabela_escalonada'),
    filial: eventoEntidadeAtualizado('filial'),
};
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
/**
 * `integracao.pedido.cancelamento_recusado@1` (T-0114, aditivo): o ERP recusou o cancelamento que o Hub pediu para um pedido já
 * entregue. O pedido continua vivo no ERP. Publicado uma vez por pedido, na transação do retorno `cancelamento_recusado`.
 * `motivo` é o texto do ERP (até 300 caracteres, mascarado pelo Conector; sem dado pessoal). Consumidor previsto: Vendedor
 * (avisar quem cancelou); a Integração não depende dele para mostrar o alerta no monitor.
 */
export const PedidoCancelamentoRecusadoEvento = z.object({
    pedido_uuid: Uuid,
    numero_erp: z.string().nullable(),
    motivo: z.string().min(1).max(300),
    recusado_em: DataHoraUtc,
});
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
// ---------- definições (T-0024): `tx.publicar(EVENTO_..., payload, agregadoId)` e consumo com `eventoTolerante(EVENTO_...)` ----------
export const EVENTO_LOTE_RECEBIDO = definirEvento('integracao.lote.recebido@1', LoteRecebidoEvento);
export const EVENTO_LOTE_CONCLUIDO = definirEvento('integracao.lote.concluido@1', LoteConcluidoEvento);
export const EVENTO_PEDIDO_RETORNO_ERP = definirEvento('integracao.pedido.retorno_erp@1', PedidoRetornoErpEvento);
export const EVENTO_PEDIDO_CANCELAMENTO_RECUSADO = definirEvento('integracao.pedido.cancelamento_recusado@1', PedidoCancelamentoRecusadoEvento);
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
export const EVENTO_ERP_FORMA_PAGAMENTO_ATUALIZADO = definirEvento('integracao.forma_pagamento.atualizado@1', EVENTOS_ATUALIZADO.forma_pagamento);
export const EVENTO_ERP_PRAZO_PAGAMENTO_ATUALIZADO = definirEvento('integracao.prazo_pagamento.atualizado@1', EVENTOS_ATUALIZADO.prazo_pagamento);
export const EVENTO_ERP_TABELA_ESCALONADA_ATUALIZADO = definirEvento('integracao.tabela_escalonada.atualizado@1', EVENTOS_ATUALIZADO.tabela_escalonada);
export const EVENTO_ERP_FILIAL_ATUALIZADO = definirEvento('integracao.filial.atualizado@1', EVENTOS_ATUALIZADO.filial);
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
    forma_pagamento: EVENTO_ERP_FORMA_PAGAMENTO_ATUALIZADO,
    prazo_pagamento: EVENTO_ERP_PRAZO_PAGAMENTO_ATUALIZADO,
    tabela_escalonada: EVENTO_ERP_TABELA_ESCALONADA_ATUALIZADO,
    filial: EVENTO_ERP_FILIAL_ATUALIZADO,
};
export const eventoAtualizado = (entidade) => EVENTOS_ENTIDADE_ATUALIZADO[entidade];
