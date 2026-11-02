/**
 * Preço e custo do produto no BKO (`/v1/core/produtos`; RN-CORE-18, RN-VEN-11; T-0062). Margem, markup, lucro e preço mínimo
 * vêm do domínio (`produto-preco`), a mesma regra do app e da API de pedido. O CUSTO só sai aqui (ação `produto.editar_preco`);
 * o pull do app e o `cadastro_resumo` não o levam. Toda edição é auditada.
 */
import { ErroNaoEncontrado, type ClienteBanco, type RotaModulo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { ProdutoParametrosSchema, ProdutoPrecoPutSchema, ProdutosPrecoListaSchema, ProdutosPrecoQuerySchema, type ProdutoPreco } from '../contracts';
import {
  custoNaoInformado,
  DESCONTO_MAXIMO_PRODUTO_PADRAO_PCT,
  descontoMaximoAplicavel,
  lucroCents,
  margemNoMinimoPct,
  margemPct,
  markupPct,
  precoMinimoCents,
  produtoVendavel,
} from '../domain';
import { auditar } from './auditoria';

const CHAVE = 'desconto_maximo_produto_pct';

interface Linha {
  id: string;
  sku: string;
  nome: string;
  unidade: string;
  ativo: boolean;
  custo_cents: number | null;
  preco_venda_cents: number | null;
  desconto_maximo_pct: number | null;
}

const COLUNAS = 'id, sku, nome, unidade, ativo, custo_cents::float8 as custo_cents, preco_venda_cents::float8 as preco_venda_cents, desconto_maximo_pct::float8 as desconto_maximo_pct';

export async function padraoDeDesconto(db: ClienteBanco): Promise<number> {
  const r = await db.query<{ valor: unknown }>("select valor from plataforma.parametro where modulo = 'core' and chave = $1 and deleted_at is null limit 1", [CHAVE]);
  const v = r.rows[0]?.valor;
  return typeof v === 'number' && v >= 0 && v <= 100 ? v : DESCONTO_MAXIMO_PRODUTO_PADRAO_PCT;
}

export function montarProdutoPreco(l: Linha, padrao: number): ProdutoPreco {
  const preco = l.preco_venda_cents;
  return {
    ...l,
    vendavel: produtoVendavel(l),
    custo_nao_informado: custoNaoInformado(l),
    margem_pct: margemPct(preco, l.custo_cents),
    markup_pct: markupPct(preco, l.custo_cents),
    lucro_cents: lucroCents(preco, l.custo_cents),
    desconto_maximo_aplicavel_pct: descontoMaximoAplicavel(l.desconto_maximo_pct, padrao),
    preco_minimo_cents: preco === null ? null : precoMinimoCents(preco, l.desconto_maximo_pct, padrao),
    margem_no_minimo_pct: preco === null ? null : margemNoMinimoPct(preco, l.custo_cents, l.desconto_maximo_pct, padrao),
  };
}

const IdParam = z.object({ id: z.string().uuid() });

export const rotasDeProdutos: RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'produtos',
    acao: 'produto.editar_preco',
    carteira: 'nao_se_aplica',
    query: ProdutosPrecoQuerySchema,
    executar: (ctx) =>
      ctx.comTenant(async (db) => {
        const q = ctx.query as z.infer<typeof ProdutosPrecoQuerySchema>;
        const padrao = await padraoDeDesconto(db);
        const busca = q.q ? `%${q.q.replace(/[%_\\]/g, '\\$&')}%` : null;
        const r = await db.query<Linha>(
          `select ${COLUNAS} from core.produto where deleted_at is null and ($1::text is null or sku ilike $1 or nome ilike $1) order by nome, id limit $2`,
          [busca, q.limite],
        );
        return ProdutosPrecoListaSchema.parse({ padrao_desconto_pct: padrao, itens: r.rows.map((l) => montarProdutoPreco(l, padrao)) });
      }),
  },
  {
    metodo: 'PUT',
    caminho: 'produtos/:id/preco',
    acao: 'produto.editar_preco',
    carteira: 'nao_se_aplica',
    params: IdParam,
    corpo: ProdutoPrecoPutSchema,
    executar: (ctx) =>
      ctx.comTenant(async (db) => {
        const c = ctx.corpo as z.infer<typeof ProdutoPrecoPutSchema>;
        const id = (ctx.params as z.infer<typeof IdParam>).id;
        const antes = (await db.query<Linha>(`select ${COLUNAS} from core.produto where id = $1 and deleted_at is null`, [id])).rows[0];
        if (!antes) throw new ErroNaoEncontrado('PRODUTO_NAO_ENCONTRADO', 'Produto não encontrado. Atualize a lista e tente de novo.');
        await db.query('update core.produto set custo_cents = $2, preco_venda_cents = $3, desconto_maximo_pct = $4 where id = $1', [id, c.custo_cents, c.preco_venda_cents, c.desconto_maximo_pct]);
        await auditar(db, ctx, {
          acao: 'produto.editar_preco',
          entidade: 'produto',
          entidadeId: id,
          antes: { custo_cents: antes.custo_cents, preco_venda_cents: antes.preco_venda_cents, desconto_maximo_pct: antes.desconto_maximo_pct },
          depois: c,
        });
        return montarProdutoPreco({ ...antes, ...c }, await padraoDeDesconto(db));
      }),
  },
  {
    metodo: 'GET',
    caminho: 'produtos/parametros',
    acao: 'produto.parametros',
    carteira: 'nao_se_aplica',
    executar: (ctx) => ctx.comTenant(async (db) => ({ desconto_maximo_produto_pct: await padraoDeDesconto(db) })),
  },
  {
    metodo: 'PUT',
    caminho: 'produtos/parametros',
    acao: 'produto.parametros',
    carteira: 'nao_se_aplica',
    corpo: ProdutoParametrosSchema,
    executar: (ctx) =>
      ctx.comTenant(async (db) => {
        const c = ctx.corpo as z.infer<typeof ProdutoParametrosSchema>;
        const antes = await padraoDeDesconto(db);
        await db.query(
          `insert into plataforma.parametro (tenant_id, modulo, chave, valor) values (plataforma.tenant_atual(), 'core', $1, $2::jsonb)
           on conflict (tenant_id, modulo, chave) where deleted_at is null do update set valor = excluded.valor`,
          [CHAVE, JSON.stringify(c.desconto_maximo_produto_pct)],
        );
        await auditar(db, ctx, { acao: 'produto.parametros', entidade: 'parametro', entidadeId: null, antes: { [CHAVE]: antes }, depois: c });
        return c;
      }),
  },
];
