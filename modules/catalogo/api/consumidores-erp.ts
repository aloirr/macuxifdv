/**
 * `integracao.preco.atualizado@1` -> `catalogo.tabela_preco` / `tabela_preco_item` e `integracao.estoque.atualizado@1`
 * -> `catalogo.deposito` / `estoque_saldo` (T-0066; RN-INT-02, RN-INT-04). Upsert por `external_id`, idempotente
 * (reentrega não duplica); inativação do ERP = soft delete do item (nunca apaga de verdade). O produto do payload é achado
 * pelo `external_id` na consulta `core.cadastro_resumo@1` (ADR 0012, nunca `core.produto`); produto que ainda não chegou
 * lança `ReferenciaAusenteErp`: a transação do consumo desfaz e a outbox repete com espera crescente, sem gravar órfão.
 * O schema do envelope é estrutural (subconjunto do payload do Hub): o Catálogo não importa pacote do Integracao.
 */
import { CONSULTA_CADASTRO_RESUMO } from '@macuxi/core/contracts';
import { definirConsumidor, definirEvento, type ClienteBanco, type ConsumidorEvento, type ContextoConsumo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { planejarEstoqueDoErp, planejarPrecoDoErp, type EventoErpBase, type RegistroEstoqueErp, type RegistroPrecoErp } from '../domain';

export class ReferenciaAusenteErp extends Error {
  constructor(
    public readonly entidade: string,
    quantidade = 1,
  ) {
    super(`referencia_ausente: ${String(quantidade)} registro(s) de ${entidade} ainda não chegaram do ERP; a entrega será repetida (RN-INT-04)`);
    this.name = 'ReferenciaAusenteErp';
  }
}

/** Resolve produtos do ERP (external_id) para o id interno. Injetável nos testes; o padrão usa a consulta do Core. */
export type ResolverProdutos = (ctx: ContextoConsumo, externalIds: string[]) => Promise<Map<string, string>>;

export const resolverProdutosPelaConsulta: ResolverProdutos = async (ctx, externalIds) => {
  // `produto_external_ids` é o campo pedido ao Core (R-20261102-152246-modulo-catalogo); até existir, a consulta rejeita
  // a entrada e o evento volta para a outbox (nunca grava órfão).
  const entrada = { cliente_ids: [], usuario_ids: [], produto_ids: [], produto_external_ids: externalIds } as never;
  const saida = (await ctx.consultar(CONSULTA_CADASTRO_RESUMO, entrada)) as { produtos: { id: string; external_id: string | null }[] };
  const mapa = new Map<string, string>();
  for (const p of saida.produtos) if (p.external_id) mapa.set(p.external_id, p.id);
  return mapa;
};

function envelope<S extends z.ZodTypeAny>(entidade: string, registro: S) {
  return definirEvento(
    `integracao.${entidade}.atualizado@1`,
    z.object({
      external_id: z.string().min(1),
      acao: z.enum(['criado', 'atualizado', 'inativado']),
      registro: registro.optional(),
      ocorrido_em: z.string(),
    }),
  );
}

const RegistroPreco = z.object({
  ativo: z.boolean().optional(),
  tabela_external_id: z.string().min(1),
  tabela_nome: z.string(),
  vigencia_inicio: z.string().min(10),
  vigencia_fim: z.string().nullish(),
  produto_external_id: z.string().min(1),
  preco_cents: z.number().nonnegative(),
});
const RegistroEstoque = z.object({
  ativo: z.boolean().optional(),
  deposito_external_id: z.string().min(1),
  deposito_nome: z.string().nullish(),
  produto_external_id: z.string().min(1),
  saldo: z.number(),
});

export const EventoIntegracaoPrecoAtualizado = envelope('preco', RegistroPreco);
export const EventoIntegracaoEstoqueAtualizado = envelope('estoque', RegistroEstoque);

async function produtoId(ctx: ContextoConsumo, resolver: ResolverProdutos, externalId: string): Promise<string> {
  const id = (await resolver(ctx, [externalId])).get(externalId);
  if (!id) throw new ReferenciaAusenteErp('produto');
  return id;
}

async function tabelaId(db: ClienteBanco, externalId: string, nome: string): Promise<string> {
  const achada = (await db.query<{ id: string }>('select id from catalogo.tabela_preco where external_id = $1 and deleted_at is null', [externalId])).rows[0];
  if (achada) {
    await db.query('update catalogo.tabela_preco set nome = $2, ativo = true where id = $1', [achada.id, nome]);
    return achada.id;
  }
  // Tabela cadastrada antes do ERP com o mesmo código: adota o external_id (o código é único por tenant).
  const mesmoCodigo = (await db.query<{ id: string }>('select id from catalogo.tabela_preco where codigo = $1 and deleted_at is null', [externalId])).rows[0];
  if (mesmoCodigo) {
    await db.query('update catalogo.tabela_preco set external_id = $2, nome = $3, ativo = true where id = $1', [mesmoCodigo.id, externalId, nome]);
    return mesmoCodigo.id;
  }
  const nova = await db.query<{ id: string }>(
    'insert into catalogo.tabela_preco (tenant_id, codigo, nome, external_id) values (plataforma.tenant_atual(), $1, $2, $1) returning id',
    [externalId, nome],
  );
  return nova.rows[0]!.id;
}

export function criarConsumidorPrecoDoErp(resolver: ResolverProdutos = resolverProdutosPelaConsulta): ConsumidorEvento {
  return definirConsumidor({
    evento: EventoIntegracaoPrecoAtualizado,
    async executar(p, ctx: ContextoConsumo) {
      const plano = planejarPrecoDoErp(p as EventoErpBase<RegistroPrecoErp>);
      if (plano.tipo === 'ignorar') return;
      if (plano.tipo === 'inativar') {
        await ctx.db.query('update catalogo.tabela_preco_item set deleted_at = now() where external_id = $1 and deleted_at is null', [plano.external_id]);
        return;
      }
      const l = plano.linha;
      const produto = await produtoId(ctx, resolver, l.produto_external_id);
      const tabela = await tabelaId(ctx.db, l.tabela_external_id, l.tabela_nome);
      // Fim da vigência do ERP é inclusivo (data civil); no Catálogo o fim é exclusivo: dia seguinte à meia-noite UTC.
      await ctx.db.query(
        `insert into catalogo.tabela_preco_item (tenant_id, tabela_preco_id, produto_id, preco_cents, vigencia_inicio, vigencia_fim, external_id)
         values (plataforma.tenant_atual(), $1, $2, $3, $4::date::timestamptz, case when $5::date is null then null else ($5::date + 1)::timestamptz end, $6)
         on conflict (tenant_id, external_id) where external_id is not null and deleted_at is null
         do update set tabela_preco_id = excluded.tabela_preco_id, produto_id = excluded.produto_id, preco_cents = excluded.preco_cents,
                       vigencia_inicio = excluded.vigencia_inicio, vigencia_fim = excluded.vigencia_fim`,
        [tabela, produto, l.preco_cents, l.vigencia_inicio, l.vigencia_fim, l.external_id],
      );
    },
  });
}

export function criarConsumidorEstoqueDoErp(resolver: ResolverProdutos = resolverProdutosPelaConsulta): ConsumidorEvento {
  return definirConsumidor({
    evento: EventoIntegracaoEstoqueAtualizado,
    async executar(p, ctx: ContextoConsumo) {
      const plano = planejarEstoqueDoErp(p as EventoErpBase<RegistroEstoqueErp>);
      if (plano.tipo === 'ignorar') return;
      if (plano.tipo === 'inativar') {
        await ctx.db.query('update catalogo.estoque_saldo set deleted_at = now() where external_id = $1 and deleted_at is null', [plano.external_id]);
        return;
      }
      const l = plano.linha;
      const produto = await produtoId(ctx, resolver, l.produto_external_id);
      const dep = await ctx.db.query<{ id: string }>(
        `insert into catalogo.deposito (tenant_id, codigo, nome, external_id) values (plataforma.tenant_atual(), $1, $2, $1)
         on conflict (tenant_id, external_id) where external_id is not null and deleted_at is null
         do update set nome = excluded.nome, ativo = true returning id`,
        [l.deposito_external_id, l.deposito_nome],
      );
      await ctx.db.query(
        `insert into catalogo.estoque_saldo (tenant_id, deposito_id, produto_id, quantidade, atualizado_erp_em, external_id)
         values (plataforma.tenant_atual(), $1, $2, $3, $4::timestamptz, $5)
         on conflict (tenant_id, external_id) where external_id is not null and deleted_at is null
         do update set deposito_id = excluded.deposito_id, produto_id = excluded.produto_id, quantidade = excluded.quantidade, atualizado_erp_em = excluded.atualizado_erp_em`,
        [dep.rows[0]!.id, produto, l.saldo, p.ocorrido_em, l.external_id],
      );
    },
  });
}

export const consumidoresDoErp: ConsumidorEvento[] = [criarConsumidorPrecoDoErp(), criarConsumidorEstoqueDoErp()];
