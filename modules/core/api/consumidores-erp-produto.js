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
import { definirConsumidor, eventoTolerante } from '@macuxi/platform-sdk';
import { decidirOrdemErp, planejarProdutoDoErp, reconciliarEmbalagemComErp } from '../domain';
import { comMedidaAusente, ReferenciaAusenteErp } from './erp-apoio';
import { EVENTO_ERP_PRODUTO_ATUALIZADO } from '../../integracao/contracts';
export const EventoIntegracaoProdutoAtualizado = eventoTolerante(EVENTO_ERP_PRODUTO_ATUALIZADO);
export const consumidorProdutoDoErp = definirConsumidor({
    evento: EventoIntegracaoProdutoAtualizado,
    async executar(p, ctx) {
        // T-0095 (RN-INT-02): reentrega fora de ordem da outbox não sobrescreve a versão mais nova já aplicada
        const aplicado = (await ctx.db.query('select erp_alterado_em::text from core.produto where external_id = $1 and deleted_at is null', [p.external_id])).rows[0]?.erp_alterado_em ?? null;
        const plano = planejarProdutoDoErp(p, aplicado);
        if (plano.tipo === 'ignorar')
            return;
        if (plano.tipo === 'inativar') {
            // RN-INT-02: só o alterado_em do registro (relógio do ERP) entra na ordem; o ocorrido_em é do Hub. Sem registro, inativa sem avançar a ordem
            if (plano.alterado_em !== null && decidirOrdemErp(aplicado, plano.alterado_em) === 'ignorar_antigo')
                return;
            await ctx.db.query('update core.produto set ativo = false, erp_alterado_em = coalesce($2::timestamptz, erp_alterado_em) where external_id = $1 and deleted_at is null and ativo', [plano.external_id, plano.alterado_em]);
            return;
        }
        const l = plano.linha;
        if (!l.sku || !l.nome)
            return;
        const mesmoSku = (await ctx.db.query('select id, external_id from core.produto where sku = $1 and deleted_at is null', [l.sku])).rows[0];
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
        const cadastrada = async (sigla) => ((await ctx.db.query('select 1 from core.medida where sigla = $1 and deleted_at is null', [sigla])).rowCount ?? 0) > 0;
        if (!(await cadastrada(unidade)))
            throw new ReferenciaAusenteErp('medida');
        const embalagemMedida = l.embalagem_medida;
        const embalagemQuantidade = l.embalagem_quantidade;
        if (embalagemMedida && !(await cadastrada(embalagemMedida)))
            throw new ReferenciaAusenteErp('medida');
        if (l.embalagem_descartada)
            ctx.log.warn({ external_id: l.external_id }, 'embalagem do produto do ERP descartada: informe medida e quantidade inteira de 2 a 9999, com medida diferente da unidade');
        const gravado = await comMedidaAusente(() => ctx.db.query(`insert into core.produto (tenant_id, external_id, sku, ean, nome, marca, categoria, unidade, ativo, embalagem_medida, embalagem_quantidade, erp_alterado_em)
       values (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz)
       on conflict (tenant_id, external_id) where external_id is not null and deleted_at is null
       do update set sku = excluded.sku, ean = excluded.ean, nome = excluded.nome, marca = excluded.marca,
                     categoria = excluded.categoria, unidade = excluded.unidade, ativo = excluded.ativo, erp_alterado_em = excluded.erp_alterado_em,
                     -- embalagem: o ERP que informa vence; evento sem embalagem NÃO apaga a que o BKO cadastrou (par medida + quantidade)
                     -- (se a nova unidade passa a ser igual à embalagem guardada, esta é limpa para não ferir a regra "embalagem diferente da unidade")
                     embalagem_medida = case when excluded.embalagem_medida is not null then excluded.embalagem_medida
                                             when core.produto.embalagem_medida = excluded.unidade then null
                                             else core.produto.embalagem_medida end,
                     embalagem_quantidade = case when excluded.embalagem_medida is not null then excluded.embalagem_quantidade
                                                 when core.produto.embalagem_medida = excluded.unidade then null
                                                 else core.produto.embalagem_quantidade end
       returning id, embalagem_medida, embalagem_quantidade`, [l.external_id, l.sku, l.ean, l.nome, l.marca, l.categoria, unidade, l.ativo, embalagemMedida, embalagemQuantidade, l.alterado_em]));
        // RN-VEN-15: o ERP prevalece sobre a embalagem do produto quando a mesma sigla existe como unidade de venda viva.
        const produto = gravado.rows[0];
        if (produto?.embalagem_medida) {
            const vendas = await ctx.db.query('select unidade, fator from core.produto_unidade where produto_id = $1 and deleted_at is null', [produto.id]);
            const r = reconciliarEmbalagemComErp(produto, new Map(vendas.rows.map((v) => [v.unidade, v.fator])));
            if (r.ajustada) {
                await ctx.db.query('update core.produto set embalagem_quantidade = $2 where id = $1', [produto.id, r.embalagem_quantidade]);
                ctx.log.warn({ external_id: l.external_id, embalagem_medida: r.embalagem_medida, fator: r.embalagem_quantidade }, 'embalagem do produto ajustada ao fator da unidade de venda do ERP');
            }
        }
    },
});
