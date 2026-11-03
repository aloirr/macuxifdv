/**
 * `integracao.produto.atualizado@1` -> `core.produto` (cadastro base, ADR 0005; T-0066; RN-INT-02, RN-CORE-18). Upsert por
 * `external_id`, idempotente; inativação do ERP = `ativo = false` (nunca apaga). O payload canônico NÃO traz custo, preço de
 * venda nem desconto máximo: essas colunas nunca são tocadas aqui (o preço de venda chega por `integracao.preco.atualizado@1`
 * no Catálogo e o custo nunca vai ao pull, RN-CORE-18). SKU já usado por outro produto: se o outro não tem `external_id`
 * (cadastro anterior), é adotado; senão o registro é ignorado com aviso (sem SKU no log).
 * RN-CORE-19: a unidade (e a embalagem, se vier) precisa ser medida cadastrada no tenant; a embalagem do ERP (medida + quantidade) é
 * gravada quando informada; evento SEM embalagem não apaga a que o BKO cadastrou. Medida (unidade ou embalagem) desconhecida: como referência ausente reprocessável (RN-INT-04; o Hub também a recusa antes: "Cadastre em Parâmetros → Produtos → Medidas").
 * Embalagem do ERP inválida (incompleta, fora de 2 a 9999, igual à unidade) é descartada COM log e o produto entra sem ela (sem
 * retentativa sem fim; o Hub também barra o teto). RN-VEN-15: se a embalagem tem a mesma sigla de uma unidade de venda viva do ERP
 * (`core.produto_unidade`), o ERP prevalece: `embalagem_quantidade` passa a ser o `fator` (log só com external_id e sigla).
 */
import { z } from 'zod';
import { definirConsumidor, type ConsumidorEvento, type ContextoConsumo } from '@macuxi/platform-sdk';
import { planejarProdutoDoErp, reconciliarEmbalagemComErp, type EventoProdutoAtualizado } from '../domain';
import { comMedidaAusente, eventoIntegracao, ReferenciaAusenteErp, TextoErp } from './erp-apoio';

const RegistroProduto = z.object({
  external_id: z.string(),
  alterado_em: z.string(),
  ativo: z.boolean().optional(),
  sku: z.string(),
  ean: TextoErp,
  nome: z.string(),
  marca: TextoErp,
  categoria: TextoErp,
  unidade: z.string(),
  // RN-CORE-19: embalagem opcional (aditivo, mesma versão do evento)
  embalagem_medida: TextoErp,
  embalagem_quantidade: z.number().nullish(),
});

export const EventoIntegracaoProdutoAtualizado = eventoIntegracao('produto', RegistroProduto);

export const consumidorProdutoDoErp: ConsumidorEvento = definirConsumidor({
  evento: EventoIntegracaoProdutoAtualizado,
  async executar(p, ctx: ContextoConsumo) {
    const plano = planejarProdutoDoErp(p as EventoProdutoAtualizado);
    if (plano.tipo === 'ignorar') return;
    if (plano.tipo === 'inativar') {
      await ctx.db.query('update core.produto set ativo = false where external_id = $1 and deleted_at is null and ativo', [plano.external_id]);
      return;
    }
    const l = plano.linha;
    if (!l.sku || !l.nome) return;

    const mesmoSku = (await ctx.db.query<{ id: string; external_id: string | null }>('select id, external_id from core.produto where sku = $1 and deleted_at is null', [l.sku])).rows[0];
    if (mesmoSku && mesmoSku.external_id !== l.external_id) {
      if (mesmoSku.external_id !== null) {
        ctx.log.warn({ external_id: l.external_id }, 'produto do ERP ignorado: SKU já pertence a outro produto');
        return;
      }
      // Cadastro anterior ao ERP: adota o external_id (o upsert abaixo não duplica o SKU).
      await ctx.db.query('update core.produto set external_id = $2 where id = $1', [mesmoSku.id, l.external_id]);
    }

    // RN-CORE-19: medida (da unidade ou da embalagem) não cadastrada no tenant = referência ausente reprocessável (RN-INT-04):
    // a transação desfaz e a outbox repete quando a medida for cadastrada ("Cadastre em Parâmetros → Produtos → Medidas").
    const unidade = l.unidade || 'UN';
    const cadastrada = async (sigla: string) => ((await ctx.db.query('select 1 from core.medida where sigla = $1 and deleted_at is null', [sigla])).rowCount ?? 0) > 0;
    if (!(await cadastrada(unidade))) throw new ReferenciaAusenteErp('medida');
    const embalagemMedida = l.embalagem_medida;
    const embalagemQuantidade = l.embalagem_quantidade;
    if (embalagemMedida && !(await cadastrada(embalagemMedida))) throw new ReferenciaAusenteErp('medida');

    if (l.embalagem_descartada) ctx.log.warn({ external_id: l.external_id }, 'embalagem do produto do ERP descartada: informe medida e quantidade inteira de 2 a 9999, com medida diferente da unidade');

    const gravado = await comMedidaAusente(() => ctx.db.query<{ id: string; embalagem_medida: string | null; embalagem_quantidade: number | null }>(
      `insert into core.produto (tenant_id, external_id, sku, ean, nome, marca, categoria, unidade, ativo, embalagem_medida, embalagem_quantidade)
       values (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (tenant_id, external_id) where external_id is not null and deleted_at is null
       do update set sku = excluded.sku, ean = excluded.ean, nome = excluded.nome, marca = excluded.marca,
                     categoria = excluded.categoria, unidade = excluded.unidade, ativo = excluded.ativo,
                     -- embalagem: o ERP que informa vence; evento sem embalagem NÃO apaga a que o BKO cadastrou (par medida + quantidade)
                     -- (se a nova unidade passa a ser igual à embalagem guardada, esta é limpa para não ferir a regra "embalagem diferente da unidade")
                     embalagem_medida = case when excluded.embalagem_medida is not null then excluded.embalagem_medida
                                             when core.produto.embalagem_medida = excluded.unidade then null
                                             else core.produto.embalagem_medida end,
                     embalagem_quantidade = case when excluded.embalagem_medida is not null then excluded.embalagem_quantidade
                                                 when core.produto.embalagem_medida = excluded.unidade then null
                                                 else core.produto.embalagem_quantidade end
       returning id, embalagem_medida, embalagem_quantidade`,
      [l.external_id, l.sku, l.ean, l.nome, l.marca, l.categoria, unidade, l.ativo, embalagemMedida, embalagemQuantidade],
    ));

    // RN-VEN-15: o ERP prevalece sobre a embalagem do produto quando a mesma sigla existe como unidade de venda viva.
    const produto = gravado.rows[0];
    if (produto?.embalagem_medida) {
      const vendas = await ctx.db.query<{ unidade: string; fator: number }>('select unidade, fator from core.produto_unidade where produto_id = $1 and deleted_at is null', [produto.id]);
      const r = reconciliarEmbalagemComErp(produto, new Map(vendas.rows.map((v) => [v.unidade, v.fator])));
      if (r.ajustada) {
        await ctx.db.query('update core.produto set embalagem_quantidade = $2 where id = $1', [produto.id, r.embalagem_quantidade]);
        ctx.log.warn({ external_id: l.external_id, embalagem_medida: r.embalagem_medida, fator: r.embalagem_quantidade }, 'embalagem do produto ajustada ao fator da unidade de venda do ERP');
      }
    }
  },
});
