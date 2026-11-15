/**
 * Preço e custo do produto no BKO (`/v1/core/produtos`; RN-CORE-18, RN-VEN-11; T-0062). Margem, markup, lucro e preço mínimo
 * vêm do domínio (`produto-preco`), a mesma regra do app e da API de pedido. O CUSTO só sai aqui (ação `produto.editar_preco`);
 * o pull do app e o `cadastro_resumo` não o levam. Toda edição é auditada.
 */
import { ErroNaoEncontrado, ErroRegraNegocio } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { ProdutoMedidasPutSchema, ProdutoParametrosSchema, ProdutoPrecoPutSchema, ProdutosPrecoListaSchema, ProdutosPrecoQuerySchema } from '../contracts';
import { custoNaoInformado, DESCONTO_MAXIMO_PRODUTO_PADRAO_PCT, descontoMaximoAplicavel, lucroCents, margemNoMinimoPct, margemPct, markupPct, precoMinimoCents, produtoVendavel, validarMedidasDoProduto, unidadesDoProduto, } from '../domain';
import { auditar } from './auditoria';
import { comErroDeMedida, medidasDoTenant } from './medidas';
const CHAVE = 'desconto_maximo_produto_pct';
const COLUNAS = 'id, sku, nome, unidade, embalagem_medida, embalagem_quantidade, ativo, custo_cents::float8 as custo_cents, preco_venda_cents::float8 as preco_venda_cents, desconto_maximo_pct::float8 as desconto_maximo_pct';
export async function padraoDeDesconto(db) {
    const r = await db.query("select valor from plataforma.parametro where modulo = 'core' and chave = $1 and deleted_at is null limit 1", [CHAVE]);
    const v = r.rows[0]?.valor;
    return typeof v === 'number' && v >= 0 && v <= 100 ? v : DESCONTO_MAXIMO_PRODUTO_PADRAO_PCT;
}
/**
 * Unidades de venda ativas do produto (RN-VEN-15) para o BKO: a padrão marcada primeiro, rótulo "UN" / "CX c/ 12".
 * Produto sem unidade cadastrada mostra a unidade base (fator 1) como padrão.
 */
export async function unidadesDosProdutos(db, produtos) {
    const mapa = new Map();
    if (produtos.length === 0)
        return mapa;
    const r = await db.query('select id, produto_id, unidade, fator, ean, padrao, ativo, deleted_at::text as deleted_at from core.produto_unidade where deleted_at is null and ativo and produto_id = any($1::uuid[])', [produtos.map((p) => p.id)]);
    const porProduto = new Map();
    for (const u of r.rows)
        porProduto.set(u.produto_id, [...(porProduto.get(u.produto_id) ?? []), u]);
    for (const p of produtos) {
        const linhas = porProduto.get(p.id) ?? [];
        const ean = new Map(linhas.map((u) => [`${u.unidade}|${u.fator}`, u.ean]));
        mapa.set(p.id, unidadesDoProduto(linhas, p.id, p.unidade).map((u) => ({ unidade: u.unidade, fator: u.fator, padrao: u.padrao, ativo: u.ativo, ean: ean.get(`${u.unidade}|${u.fator}`) ?? null, rotulo: u.rotulo })));
    }
    return mapa;
}
export function montarProdutoPreco(l, padrao, unidades) {
    const preco = l.preco_venda_cents;
    return {
        ...l,
        ...(unidades ? { unidades } : {}),
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
export const rotasDeProdutos = [
    {
        metodo: 'GET',
        caminho: 'produtos',
        acao: 'produto.editar_preco',
        carteira: 'nao_se_aplica',
        query: ProdutosPrecoQuerySchema,
        executar: (ctx) => ctx.comTenant(async (db) => {
            const q = ctx.query;
            const padrao = await padraoDeDesconto(db);
            const busca = q.q ? `%${q.q.replace(/[%_\\]/g, '\\$&')}%` : null;
            const r = await db.query(`select ${COLUNAS} from core.produto where deleted_at is null and ($1::text is null or sku ilike $1 or nome ilike $1) order by nome, id limit $2`, [busca, q.limite]);
            const unidades = await unidadesDosProdutos(db, r.rows);
            return ProdutosPrecoListaSchema.parse({ padrao_desconto_pct: padrao, itens: r.rows.map((l) => montarProdutoPreco(l, padrao, unidades.get(l.id))) });
        }),
    },
    {
        metodo: 'PUT',
        caminho: 'produtos/:id/preco',
        acao: 'produto.editar_preco',
        carteira: 'nao_se_aplica',
        params: IdParam,
        corpo: ProdutoPrecoPutSchema,
        executar: (ctx) => ctx.comTenant(async (db) => {
            const c = ctx.corpo;
            const id = ctx.params.id;
            const antes = (await db.query(`select ${COLUNAS} from core.produto where id = $1 and deleted_at is null`, [id])).rows[0];
            if (!antes)
                throw new ErroNaoEncontrado('PRODUTO_NAO_ENCONTRADO', 'Produto não encontrado. Atualize a lista e tente de novo.');
            await db.query('update core.produto set custo_cents = $2, preco_venda_cents = $3, desconto_maximo_pct = $4 where id = $1', [id, c.custo_cents, c.preco_venda_cents, c.desconto_maximo_pct]);
            await auditar(db, ctx, {
                acao: 'produto.editar_preco',
                entidade: 'produto',
                entidadeId: id,
                antes: { custo_cents: antes.custo_cents, preco_venda_cents: antes.preco_venda_cents, desconto_maximo_pct: antes.desconto_maximo_pct },
                depois: c,
            });
            const unidades = await unidadesDosProdutos(db, [antes]);
            return montarProdutoPreco({ ...antes, ...c }, await padraoDeDesconto(db), unidades.get(id));
        }),
    },
    {
        // RN-CORE-19: medida da unidade (obrigatória) e embalagem opcional; só medida cadastrada e ativa do tenant.
        metodo: 'PUT',
        caminho: 'produtos/:id/medidas',
        acao: 'medida.gerenciar',
        carteira: 'nao_se_aplica',
        params: IdParam,
        corpo: ProdutoMedidasPutSchema,
        executar: (ctx) => ctx.comTenant(async (db) => {
            const c = ctx.corpo;
            const id = ctx.params.id;
            const antes = (await db.query(`select ${COLUNAS} from core.produto where id = $1 and deleted_at is null`, [id])).rows[0];
            if (!antes)
                throw new ErroNaoEncontrado('PRODUTO_NAO_ENCONTRADO', 'Produto não encontrado. Atualize a lista e tente de novo.');
            // RN-VEN-15: unidades de venda vivas do ERP (sigla -> fator); se a sigla da embalagem está aí, a quantidade tem de ser o fator.
            const vendas = (await db.query('select unidade, fator from core.produto_unidade where produto_id = $1 and deleted_at is null', [id])).rows;
            const v = validarMedidasDoProduto(c, await medidasDoTenant(db), antes, new Map(vendas.map((u) => [u.unidade, u.fator])));
            if (!v.ok)
                throw new ErroRegraNegocio(v.codigo, v.mensagem);
            const m = v.valor;
            if (m.unidade !== antes.unidade || m.embalagem_medida !== (antes.embalagem_medida ?? null) || m.embalagem_quantidade !== (antes.embalagem_quantidade ?? null)) {
                await comErroDeMedida(() => db.query('update core.produto set unidade = $2, embalagem_medida = $3, embalagem_quantidade = $4 where id = $1', [id, m.unidade, m.embalagem_medida, m.embalagem_quantidade]));
                await auditar(db, ctx, {
                    acao: 'produto.editar_medida',
                    entidade: 'produto',
                    entidadeId: id,
                    antes: { unidade: antes.unidade, embalagem_medida: antes.embalagem_medida ?? null, embalagem_quantidade: antes.embalagem_quantidade ?? null },
                    depois: m,
                });
            }
            return montarProdutoPreco({ ...antes, ...m }, await padraoDeDesconto(db));
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
        executar: (ctx) => ctx.comTenant(async (db) => {
            const c = ctx.corpo;
            const antes = await padraoDeDesconto(db);
            await db.query(`insert into plataforma.parametro (tenant_id, modulo, chave, valor) values (plataforma.tenant_atual(), 'core', $1, $2::jsonb)
           on conflict (tenant_id, modulo, chave) where deleted_at is null do update set valor = excluded.valor`, [CHAVE, JSON.stringify(c.desconto_maximo_produto_pct)]);
            // T-0151: o pull do produto leva o desconto efetivo; mudou o padrão, os produtos sem desconto próprio voltam ao aparelho
            if (antes !== c.desconto_maximo_produto_pct)
                await db.query('update core.produto set updated_at = now() where deleted_at is null and desconto_maximo_pct is null');
            await auditar(db, ctx, { acao: 'produto.parametros', entidade: 'parametro', entidadeId: null, antes: { [CHAVE]: antes }, depois: c });
            return c;
        }),
    },
];
