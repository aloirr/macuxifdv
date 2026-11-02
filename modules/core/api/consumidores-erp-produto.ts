/**
 * `integracao.produto.atualizado@1` -> `core.produto` (cadastro base, ADR 0005; T-0066; RN-INT-02, RN-CORE-18). Upsert por
 * `external_id`, idempotente; inativação do ERP = `ativo = false` (nunca apaga). O payload canônico NÃO traz custo, preço de
 * venda nem desconto máximo: essas colunas nunca são tocadas aqui (o preço de venda chega por `integracao.preco.atualizado@1`
 * no Catálogo e o custo nunca vai ao pull, RN-CORE-18). SKU já usado por outro produto: se o outro não tem `external_id`
 * (cadastro anterior), é adotado; senão o registro é ignorado com aviso (sem SKU no log).
 * RN-CORE-19: a unidade (e a embalagem, se vier) precisa ser medida cadastrada no tenant; a embalagem do ERP (medida + quantidade) é
 * gravada quando informada; evento SEM embalagem não apaga a que o BKO cadastrou. Medida da unidade desconhecida: registro ignorado
 * com aviso (o Hub já o recusa antes com `referencia_ausente`).
 */
import { z } from 'zod';
import { definirConsumidor, type ConsumidorEvento, type ContextoConsumo } from '@macuxi/platform-sdk';
import { planejarProdutoDoErp, type EventoProdutoAtualizado } from '../domain';
import { eventoIntegracao, TextoErp } from './erp-apoio';

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

    // RN-CORE-19: o produto só aceita medida cadastrada no tenant (FK). O Hub já recusa a linha com `referencia_ausente`;
    // aqui é a rede de segurança para não derrubar o consumidor (e a fila) com erro de chave estrangeira.
    const unidade = l.unidade || 'UN';
    const cadastrada = async (sigla: string) => ((await ctx.db.query('select 1 from core.medida where sigla = $1 and deleted_at is null', [sigla])).rowCount ?? 0) > 0;
    if (!(await cadastrada(unidade))) {
      ctx.log.warn({ external_id: l.external_id, unidade }, 'produto do ERP ignorado: medida da unidade não cadastrada no tenant');
      return;
    }
    // Embalagem do ERP com medida não cadastrada: o produto entra sem ela (o Hub já recusa o lote antes; aqui é a rede de segurança).
    let embalagemMedida = l.embalagem_medida;
    let embalagemQuantidade = l.embalagem_quantidade;
    if (embalagemMedida && !(await cadastrada(embalagemMedida))) {
      ctx.log.warn({ external_id: l.external_id, embalagem_medida: embalagemMedida }, 'embalagem do produto do ERP ignorada: medida não cadastrada no tenant');
      embalagemMedida = null;
      embalagemQuantidade = null;
    }

    await ctx.db.query(
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
                                                 else core.produto.embalagem_quantidade end`,
      [l.external_id, l.sku, l.ean, l.nome, l.marca, l.categoria, unidade, l.ativo, embalagemMedida, embalagemQuantidade],
    );
  },
});
