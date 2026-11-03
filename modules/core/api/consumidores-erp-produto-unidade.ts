/**
 * `integracao.produto_unidade.atualizado@1` -> `core.produto_unidade` (unidades de venda UN/CX e fator, RN-VEN-15; T-0061;
 * RN-INT-02/04/06). Upsert idempotente por `external_id`; inativação do ERP = `ativo = false` (nunca apaga). Produto ainda
 * ausente = `ReferenciaAusenteErp` (a outbox repete, sem órfão). Invariantes da 0013: (produto, unidade) único vivo e no
 * máximo uma `padrao` viva por produto — marcar uma nova desmarca a anterior na mesma transação do consumo (a regra é
 * `planejarProdutoUnidadeDoErp`, no domain). Unidade cuja chave já pertence a outra linha do ERP é ignorada com aviso; a de
 * cadastro sem `external_id` é adotada. O schema abaixo é estrutural (subconjunto do `ProdutoUnidadePayload` do Hub).
 */
import { z } from 'zod';
import { definirConsumidor, type ConsumidorEvento, type ContextoConsumo } from '@macuxi/platform-sdk';
import { planejarProdutoUnidadeDoErp, type EventoProdutoUnidadeAtualizado } from '../domain';
import { eventoIntegracao, ReferenciaAusenteErp, TextoErp } from './erp-apoio';

const RegistroProdutoUnidade = z.object({
  external_id: z.string(),
  alterado_em: z.string(),
  ativo: z.boolean().optional(),
  produto_external_id: z.string(),
  unidade: z.string(),
  fator: z.number(),
  ean: TextoErp,
  padrao: z.boolean().optional(),
});

export const EventoIntegracaoProdutoUnidadeAtualizado = eventoIntegracao('produto_unidade', RegistroProdutoUnidade);

export const consumidorProdutoUnidadeDoErp: ConsumidorEvento = definirConsumidor({
  evento: EventoIntegracaoProdutoUnidadeAtualizado,
  async executar(p, ctx: ContextoConsumo) {
    const plano = planejarProdutoUnidadeDoErp(p as EventoProdutoUnidadeAtualizado);
    if (plano.tipo === 'ignorar') {
      if (plano.motivo !== 'sem_registro') ctx.log.warn({ external_id: p.external_id, motivo: plano.motivo }, 'unidade de venda do ERP ignorada');
      return;
    }
    if (plano.tipo === 'inativar') {
      await ctx.db.query('update core.produto_unidade set ativo = false, padrao = false where external_id = $1 and deleted_at is null and (ativo or padrao)', [plano.external_id]);
      return;
    }
    const l = plano.linha;
    const produto = (await ctx.db.query<{ id: string }>('select id from core.produto where external_id = $1 and deleted_at is null', [l.produto_external_id])).rows[0];
    if (!produto) throw new ReferenciaAusenteErp('produto');

    // (produto, unidade) já existe com outro dono: o do cadastro anterior ao ERP é adotado; o de outro external_id vence.
    const mesmaChave = (
      await ctx.db.query<{ id: string; external_id: string | null }>('select id, external_id from core.produto_unidade where produto_id = $1 and unidade = $2 and deleted_at is null', [produto.id, l.unidade])
    ).rows[0];
    if (mesmaChave && mesmaChave.external_id !== l.external_id) {
      if (mesmaChave.external_id !== null) {
        ctx.log.warn({ external_id: l.external_id }, 'unidade de venda do ERP ignorada: a unidade já pertence a outra linha do produto');
        return;
      }
      await ctx.db.query('update core.produto_unidade set external_id = $2 where id = $1', [mesmaChave.id, l.external_id]);
    }

    // No máximo uma padrão viva por produto (índice único): desmarca a anterior antes de gravar a nova.
    if (plano.desmarcar_outras_padrao) {
      await ctx.db.query('update core.produto_unidade set padrao = false where produto_id = $1 and padrao and deleted_at is null and external_id is distinct from $2', [produto.id, l.external_id]);
    }

    await ctx.db.query(
      `insert into core.produto_unidade as u (tenant_id, external_id, produto_id, unidade, fator, ean, padrao, ativo)
       values (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6, $7)
       on conflict (tenant_id, external_id) where external_id is not null and deleted_at is null
       do update set produto_id = excluded.produto_id, unidade = excluded.unidade, fator = excluded.fator, ean = excluded.ean,
                     padrao = excluded.padrao, ativo = excluded.ativo
       where (u.produto_id, u.unidade, u.fator, u.ean, u.padrao, u.ativo) is distinct from
             (excluded.produto_id, excluded.unidade, excluded.fator, excluded.ean, excluded.padrao, excluded.ativo)`,
      [l.external_id, produto.id, l.unidade, l.fator, l.ean, l.padrao, l.ativo],
    );
  },
});
