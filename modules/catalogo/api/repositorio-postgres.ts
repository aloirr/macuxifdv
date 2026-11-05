/**
 * Repositório do Catálogo no Postgres (T-0052). Só SQL no schema `catalogo` (regra 1), dentro da transação do tenant
 * (RLS). O cadastro base do produto é do Core: vem pela consulta `core.cadastro_resumo@1` (ADR 0012), nunca pela tabela.
 *
 * Tudo ligado na migração 0013: preço, estoque e depósito, atributos, mídia, conteúdo, sinônimos, destaque, cota de IA
 * (funções `catalogo.debitar_cota_ia` e `consultas_ia_do_dia`) e registro de buscas. Produtos = os que têm item de
 * tabela de preço no tenant (cadastro pelo Core: sku, nome, unidade, ativo; marca, categoria e EAN ainda não vêm na
 * consulta — pedido ao modulo-core).
 */
import { ErroHttpModulo, type ClienteBanco, type TransacaoTenant } from '@macuxi/platform-sdk';
import { CONSULTA_CADASTRO_RESUMO } from '@macuxi/core/contracts';
import type { ItemTabelaPreco, MidiaProduto, Sinonimo, StockByBranch } from '../contracts';
import type { ProdutoCatalogo } from '../domain/vitrine';
import type { FabricaRepositorio, RepositorioCatalogo } from './repositorio';

const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const LOTE_CONSULTA = 500;

const quebrar = (t: string | null): string[] =>
  (t ?? '')
    .split('\n')
    .map((x) => x.trim())
    .filter((x) => x !== '');

async function idsComPreco(db: ClienteBanco): Promise<string[]> {
  const r = await db.query<{ produto_id: string }>(`select distinct produto_id from catalogo.tabela_preco_item where deleted_at is null order by produto_id`);
  return r.rows.map((x) => x.produto_id);
}

async function cadastroDoCore(tx: TransacaoTenant, ids: readonly string[]): Promise<ProdutoCatalogo[]> {
  const saida: ProdutoCatalogo[] = [];
  for (let i = 0; i < ids.length; i += LOTE_CONSULTA) {
    const r = await tx.consultar(CONSULTA_CADASTRO_RESUMO, { cliente_ids: [], usuario_ids: [], produto_ids: ids.slice(i, i + LOTE_CONSULTA) });
    for (const p of r.produtos) {
      saida.push({ id: p.id, sku: p.sku, ean: null, nome: p.nome, marca: '', categoria: '', unidade: p.unidade, ativo: p.ativo, atributos: [], thumbnail_url: null, campanha: false, vendas: 0 });
    }
  }
  return saida;
}

/** Atributos, destaque e miniatura do próprio Catálogo (0013) sobre o cadastro do Core. */
async function enriquecer(db: ClienteBanco, produtos: ProdutoCatalogo[]): Promise<ProdutoCatalogo[]> {
  if (produtos.length === 0) return produtos;
  const ids = produtos.map((p) => p.id);
  const at = await db.query<{ produto_id: string; nome: string; valor: string }>(
    `select produto_id, nome, valor from catalogo.produto_atributo where produto_id = any($1::uuid[]) and deleted_at is null order by ordem, nome`,
    [ids],
  );
  const co = await db.query<{ produto_id: string; campanha: boolean }>(
    `select produto_id, (campanha or destaque) as campanha from catalogo.produto_conteudo where produto_id = any($1::uuid[]) and deleted_at is null`,
    [ids],
  );
  const mi = await db.query<{ produto_id: string; url: string | null; arquivo_id: string | null }>(
    `select produto_id, url, arquivo_id from catalogo.produto_midia where produto_id = any($1::uuid[]) and principal and deleted_at is null`,
    [ids],
  );
  const atributos = new Map<string, { name: string; value: string }[]>();
  for (const r of at.rows) {
    const lista = atributos.get(r.produto_id) ?? [];
    lista.push({ name: r.nome, value: r.valor });
    atributos.set(r.produto_id, lista);
  }
  const campanha = new Map(co.rows.map((r) => [r.produto_id, r.campanha]));
  const thumb = new Map(mi.rows.map((r) => [r.produto_id, r.url ?? (r.arquivo_id ? `/v1/arquivos/${r.arquivo_id}` : null)]));
  return produtos.map((p) => ({ ...p, atributos: atributos.get(p.id) ?? [], campanha: campanha.get(p.id) ?? false, thumbnail_url: thumb.get(p.id) ?? null }));
}

export function criarRepositorioPostgres(): FabricaRepositorio {
  return (ctx, db, tx): RepositorioCatalogo => ({
    async produtos() {
      return enriquecer(db, await cadastroDoCore(tx, await idsComPreco(db)));
    },
    async produto(id) {
      const [p] = await enriquecer(db, await cadastroDoCore(tx, [id]));
      return p ?? null;
    },
    async sinonimos() {
      const r = await db.query<{ id: string; termo: string; sinonimos: string[]; ativo: boolean; external_id: string | null }>(
        `select id, termo, sinonimos, ativo, external_id from catalogo.sinonimo where deleted_at is null order by lower(termo), id`,
      );
      return r.rows.map((x): Sinonimo => ({ id: x.id, term: x.termo, synonyms: x.sinonimos, active: x.ativo, external_id: x.external_id }));
    },
    async precos(clienteId, produtoIds) {
      // RN-CAT-06: só a tabela viva e ativa do cliente; sem cliente não há tabela padrão no schema (nada vendável)
      if (clienteId === null || produtoIds.length === 0) return { tabelaClienteId: null, itens: [] };
      const t = await db.query<{ tabela_preco_id: string }>(
        `select ct.tabela_preco_id
           from catalogo.cliente_tabela_preco ct
           join catalogo.tabela_preco t on t.tenant_id = ct.tenant_id and t.id = ct.tabela_preco_id and t.ativo and t.deleted_at is null
          where ct.cliente_id = $1::uuid and ct.deleted_at is null`,
        [clienteId],
      );
      const tabela = t.rows[0]?.tabela_preco_id ?? null;
      if (!tabela) return { tabelaClienteId: null, itens: [] };
      const r = await db.query<{ produto_id: string; preco_cents: number; vigencia_inicio: string | null; vigencia_fim: string | null }>(
        `select produto_id, preco_cents::float8 as preco_cents,
                to_char(vigencia_inicio at time zone 'UTC', ${UTC}) as vigencia_inicio,
                to_char(vigencia_fim at time zone 'UTC', ${UTC}) as vigencia_fim
           from catalogo.tabela_preco_item
          where tabela_preco_id = $1::uuid and produto_id = any($2::uuid[]) and deleted_at is null`,
        [tabela, [...produtoIds]],
      );
      const itens: ItemTabelaPreco[] = r.rows.map((x) => ({ price_table_id: tabela, product_id: x.produto_id, price_cents: x.preco_cents, valid_from: x.vigencia_inicio, valid_to: x.vigencia_fim }));
      return { tabelaClienteId: tabela, itens };
    },
    async promocoes() {
      return [];
    },
    async saldos(produtoIds) {
      const saida = new Map<string, StockByBranch[]>();
      if (produtoIds.length === 0) return saida;
      const r = await db.query<{ produto_id: string; deposito_id: string; nome: string; quantidade: number; atualizado_em: string | null }>(
        `select s.produto_id, s.deposito_id, d.nome, s.quantidade::float8 as quantidade,
                to_char(s.atualizado_erp_em at time zone 'UTC', ${UTC}) as atualizado_em
           from catalogo.estoque_saldo s
           join catalogo.deposito d on d.tenant_id = s.tenant_id and d.id = s.deposito_id and d.ativo and d.deleted_at is null
          where s.produto_id = any($1::uuid[]) and s.deleted_at is null
          order by d.nome, d.id`,
        [[...produtoIds]],
      );
      for (const x of r.rows) {
        const lista = saida.get(x.produto_id) ?? [];
        lista.push({ branch_id: x.deposito_id, branch_name: x.nome, quantity: Math.round(x.quantidade), updated_at: x.atualizado_em });
        saida.set(x.produto_id, lista);
      }
      return saida;
    },
    async filiaisDoUsuario() {
      return null;
    },
    async conteudo(produtoId) {
      const c = await db.query<{ descricao: string | null; argumentos_venda: string | null; faq: { pergunta: string; resposta: string }[]; updated_at: string }>(
        `select descricao, argumentos_venda, faq, to_char(updated_at at time zone 'UTC', ${UTC}) as updated_at
           from catalogo.produto_conteudo where produto_id = $1::uuid and deleted_at is null`,
        [produtoId],
      );
      const m = await db.query<{ id: string; tipo: 'foto' | 'video' | 'pdf'; url: string | null; arquivo_id: string | null; titulo: string | null; ordem: number }>(
        `select id, tipo, url, arquivo_id, titulo, ordem from catalogo.produto_midia where produto_id = $1::uuid and deleted_at is null order by ordem, id`,
        [produtoId],
      );
      const midias: MidiaProduto[] = m.rows.map((x) => ({ id: x.id, type: x.tipo, url: x.url ?? `/v1/arquivos/${x.arquivo_id}`, title: x.titulo, order: x.ordem }));
      const l = c.rows[0];
      if (!l) return { conteudo: null, midias };
      return {
        conteudo: { description: l.descricao, selling_points: quebrar(l.argumentos_venda), faq: l.faq.map((f) => ({ question: f.pergunta, answer: f.resposta })), updated_at: l.updated_at },
        midias,
      };
    },
    async usoIa(dia) {
      const r = await db.query<{ n: number }>(`select catalogo.consultas_ia_do_dia($1::uuid, $2::timestamptz) as n`, [ctx.usuario.id, ctx.agora().toISOString()]);
      return { dia, consultas: Number(r.rows[0]?.n ?? 0) };
    },
    async debitarIa(_dia, limite) {
      // RN-CAT-03: incremento atômico e condicional no banco; nulo = limite atingido (ou IA desligada)
      const r = await db.query<{ n: number | null }>(`select catalogo.debitar_cota_ia($1::uuid, $2::int, $3::timestamptz) as n`, [ctx.usuario.id, limite, ctx.agora().toISOString()]);
      return r.rows[0]?.n != null;
    },
    async registrarBusca(r) {
      // RF-CAT-07: termo normalizado, sem texto livre; 'nenhum' (sem interpretação) conta como regras
      await db.query(
        `insert into catalogo.busca_log (tenant_id, usuario_id, termo, origem, resultados, ocorrido_em)
         values (plataforma.tenant_atual(), $1::uuid, left($2, 200), $3, $4::int, $5::timestamptz)`,
        [ctx.usuario.id, r.termo, r.interpretado_por === 'llm' ? 'llm' : 'regras', r.resultados, r.em],
      );
    },
    async termosSemResultado(desde, limite) {
      const r = await db.query<{ termo: string; n: number; ultimo: string }>(
        `select termo, count(*)::int as n, to_char(max(ocorrido_em) at time zone 'UTC', ${UTC}) as ultimo
           from catalogo.busca_log where resultados = 0 and ocorrido_em >= $1::timestamptz and deleted_at is null
          group by termo order by n desc, max(ocorrido_em) desc, termo limit $2::int`,
        [desde, limite],
      );
      return r.rows.map((x) => ({ term: x.termo, count: x.n, last_searched_at: x.ultimo }));
    },
    async salvarSinonimo(id, s) {
      // sinonimo_termo_uk (tenant, lower(termo)) vale também para inativo: a rota checa antes, a corrida cai aqui
      const r = await db
        .query<{ criado: boolean }>(
        `insert into catalogo.sinonimo (id, tenant_id, termo, sinonimos, ativo)
         values ($1::uuid, plataforma.tenant_atual(), $2, $3::text[], $4)
         on conflict (id) do update set termo = excluded.termo, sinonimos = excluded.sinonimos, ativo = excluded.ativo, deleted_at = null
         returning (xmax = 0) as criado`,
        [id, s.term, s.synonyms, s.active],
        )
        .catch((e: unknown) => {
          const err = e as { code?: string; constraint?: string };
          if (err.code === '23505' && err.constraint === 'sinonimo_termo_uk') {
            throw new ErroHttpModulo(409, 'SINONIMO_EM_CONFLITO', `Já existe um grupo para "${s.term}". Edite esse grupo antes de criar outro.`);
          }
          throw e;
        });
      return { criado: r.rows[0]?.criado ?? false };
    },
    async removerSinonimo(id) {
      const r = await db.query(`update catalogo.sinonimo set deleted_at = now() where id = $1::uuid and deleted_at is null`, [id]);
      return (r.rowCount ?? 0) > 0;
    },
    async marcarDestaque(produtoId, destaque) {
      await db.query(
        `insert into catalogo.produto_conteudo (tenant_id, produto_id, campanha, destaque) values (plataforma.tenant_atual(), $1::uuid, $2, $2)
         on conflict (tenant_id, produto_id) where deleted_at is null do update set campanha = excluded.campanha, destaque = excluded.destaque`,
        [produtoId, destaque],
      );
    },
    async salvarConteudo(produtoId, c, em) {
      const r = await db.query<{ criado: boolean }>(
        `insert into catalogo.produto_conteudo (tenant_id, produto_id, descricao, argumentos_venda, faq, updated_at)
         values (plataforma.tenant_atual(), $1::uuid, $2, $3, $4::jsonb, $5::timestamptz)
         on conflict (tenant_id, produto_id) where deleted_at is null
         do update set descricao = excluded.descricao, argumentos_venda = excluded.argumentos_venda, faq = excluded.faq
         returning (xmax = 0) as criado`,
        [produtoId, c.description, c.selling_points.join('\n'), JSON.stringify(c.faq.map((f) => ({ pergunta: f.question, resposta: f.answer }))), em],
      );
      // atributos: a lista enviada substitui a anterior (sai o que não veio, entra ou atualiza o que veio)
      await db.query(`update catalogo.produto_atributo set deleted_at = now() where produto_id = $1::uuid and deleted_at is null and nome <> all($2::text[])`, [
        produtoId,
        c.attributes.map((a) => a.name),
      ]);
      let ordem = 0;
      for (const a of c.attributes) {
        await db.query(
          `insert into catalogo.produto_atributo (tenant_id, produto_id, nome, valor, ordem) values (plataforma.tenant_atual(), $1::uuid, $2, $3, $4::int)
           on conflict (tenant_id, produto_id, nome) where deleted_at is null do update set valor = excluded.valor, ordem = excluded.ordem`,
          [produtoId, a.name, a.value, ordem++],
        );
      }
      return { criado: r.rows[0]?.criado ?? false };
    },
  });
}
