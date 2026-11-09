/**
 * `integracao.catalogo_no.atualizado@1` -> `catalogo.catalogo_no` e o campo `catalogo_no_external_id` de
 * `integracao.produto.atualizado@1` -> `catalogo.produto_no` (árvore do catálogo, RF-CAT-04, T-0061).
 * `integracao.preco.atualizado@1` -> `catalogo.tabela_preco` / `tabela_preco_item` e `integracao.estoque.atualizado@1`
 * -> `catalogo.deposito` / `estoque_saldo` (T-0066; RN-INT-02, RN-INT-04). Upsert por `external_id`, idempotente
 * (reentrega não duplica); inativação do ERP = soft delete do item (nunca apaga de verdade). O produto do payload é achado
 * pelo `external_id` na consulta `core.cadastro_resumo@1` (ADR 0012, nunca `core.produto`); produto que ainda não chegou
 * lança `ReferenciaAusenteErp`: a transação do consumo desfaz e a outbox repete com espera crescente, sem gravar órfão.
 * Os payloads vêm do `contracts` do Integracao (`EVENTO_ERP_*_ATUALIZADO`, leitura tolerante; T-0024), sem cópia local.
 */
import { CONSULTA_CADASTRO_RESUMO } from '@macuxi/core/contracts';
import { definirConsumidor, eventoTolerante, type ClienteBanco, type ConsumidorEvento, type ContextoConsumo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { EVENTO_REFERENCIA_MARCA_DESCONHECIDA } from '../contracts';
import { CatalogoNoPayload, ClientePayload, EVENTO_ERP_CLIENTE_ATUALIZADO, EstoquePayload, EVENTO_ERP_CATALOGO_NO_ATUALIZADO, EVENTO_ERP_ESTOQUE_ATUALIZADO, EVENTO_ERP_PRECO_ATUALIZADO, EVENTO_ERP_PRODUTO_ATUALIZADO, EVENTO_ERP_TABELA_ESCALONADA_ATUALIZADO, PrecoPayload, ProdutoPayload, TabelaEscalonadaPayload } from '../../integracao/contracts';
import { codigoCompacto, decidirColisaoEscalonada, parametrosDoTenant, planejarCadastroCatalogoDoErp, marcasDesconhecidasDaLinha, resolverReferenciasDoErp, planejarEscalonadaDoErp, planejarEstoqueDoErp, planejarNoDoErp, planejarPrecoDoErp, planejarProdutoNoDoErp, planejarVinculoTabelaDoErp, precoDoErpEhDaBase, type EventoErpBase, type MarcaDoCadastro } from '../domain';

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
  const saida = await ctx.consultar(CONSULTA_CADASTRO_RESUMO, { cliente_ids: [], usuario_ids: [], produto_ids: [], produto_external_ids: externalIds });
  const mapa = new Map<string, string>();
  for (const p of saida.produtos) if (p.external_id) mapa.set(p.external_id, p.id);
  return mapa;
};

/** Unidade base (sigla) do produto do ERP, pela consulta do Core; nula se o produto não chegou. Injetável nos testes. */
export type ResolverUnidadeBase = (ctx: ContextoConsumo, externalId: string) => Promise<string | null>;

export const resolverUnidadeBasePelaConsulta: ResolverUnidadeBase = async (ctx, externalId) => {
  const saida = await ctx.consultar(CONSULTA_CADASTRO_RESUMO, { cliente_ids: [], usuario_ids: [], produto_ids: [], produto_external_ids: [externalId] });
  return saida.produtos.find((p) => p.external_id === externalId)?.unidade ?? null;
};

/**
 * Campos do produto do ERP que o Catálogo lê além do nó (T-0084 C1/C2, T-0085 K11). Leitura tolerante e local: o contrato do
 * Hub (`ProdutoPayload`) ganha os campos no lote do modulo-integracao; aqui só se confere a forma do que interessa.
 */
const CadastroCatalogoErp = z
  .object({
    aplicacao: z.string().nullish().transform((v) => (v === null ? null : v)),
    oferece_junto: z.array(z.string()).nullish(),
    etiquetas: z.array(z.string()).nullish(),
    /** Doc 06: marca pelo `external_id` ou pelo nome da marca cadastrada em Marcas concorrentes (RN-CAT-09). */
    referencias: z.array(z.object({ marca_external_id: z.string().nullish(), marca_nome: z.string().nullish(), codigo: z.string() }).passthrough()).nullish(),
  })
  .passthrough();

export const EventoIntegracaoPrecoAtualizado = eventoTolerante(EVENTO_ERP_PRECO_ATUALIZADO);
export const EventoIntegracaoTabelaEscalonadaAtualizado = eventoTolerante(EVENTO_ERP_TABELA_ESCALONADA_ATUALIZADO);
export const EventoIntegracaoEstoqueAtualizado = eventoTolerante(EVENTO_ERP_ESTOQUE_ATUALIZADO);
export const EventoIntegracaoCatalogoNoAtualizado = eventoTolerante(EVENTO_ERP_CATALOGO_NO_ATUALIZADO);
/** Do produto do ERP o Catálogo lê só o nó da árvore; o cadastro do produto é do Core (que consome o mesmo evento). */
export const EventoIntegracaoProdutoAtualizado = eventoTolerante(EVENTO_ERP_PRODUTO_ATUALIZADO);

/**
 * O `registro` do evento do dono pode vir tipado como união das 12 entidades: `safeParse` do schema da entidade devolve o
 * registro certo (inválido vira `undefined` = "ignorar", como registro ausente).
 */
function comRegistro<S extends z.ZodTypeAny>(p: { external_id: string; acao: 'criado' | 'atualizado' | 'inativado'; registro?: unknown }, schema: S): EventoErpBase<z.output<S>> {
  const r = p.registro === undefined ? undefined : schema.safeParse(p.registro);
  return { external_id: p.external_id, acao: p.acao, registro: r?.success ? (r.data as z.output<S>) : undefined };
}

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

export function criarConsumidorPrecoDoErp(resolver: ResolverProdutos = resolverProdutosPelaConsulta, unidadeBase: ResolverUnidadeBase = resolverUnidadeBasePelaConsulta): ConsumidorEvento {
  return definirConsumidor({
    evento: EventoIntegracaoPrecoAtualizado,
    async executar(p, ctx: ContextoConsumo) {
      const plano = planejarPrecoDoErp(comRegistro(p, PrecoPayload));
      if (plano.tipo === 'ignorar') return;
      if (plano.tipo === 'inativar') {
        await ctx.db.query('update catalogo.tabela_preco_item set deleted_at = now() where external_id = $1 and deleted_at is null', [plano.external_id]);
        return;
      }
      const l = plano.linha;
      const produto = await produtoId(ctx, resolver, l.produto_external_id);
      // RN-VEN-15 (nova, T-0089): preço de outra medida (ex.: CX) não vira o preço da UN. Aviso no monitor (log), sem recusar a linha;
      // a embalagem vale UN × quantidade. Se já havia uma linha desse external_id, ela deixa de valer (soft delete).
      if (l.unidade && !precoDoErpEhDaBase(l.unidade, await unidadeBase(ctx, l.produto_external_id))) {
        ctx.log.warn({ external_id: l.external_id, unidade: l.unidade }, 'preço do ERP com unidade diferente da base do produto ignorado (a embalagem vale unidade base × quantidade, RN-VEN-15)');
        await ctx.db.query('update catalogo.tabela_preco_item set deleted_at = now() where external_id = $1 and deleted_at is null', [l.external_id]);
        return;
      }
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
      const plano = planejarEstoqueDoErp(comRegistro(p, EstoquePayload));
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

async function noId(db: ClienteBanco, externalId: string): Promise<string> {
  const r = (await db.query<{ id: string }>('select id from catalogo.catalogo_no where external_id = $1 and deleted_at is null', [externalId])).rows[0];
  if (!r) throw new ReferenciaAusenteErp('catalogo_no');
  return r.id;
}

/** RF-CAT-04: nó da árvore. O pai tem de existir (senão repete na outbox, RN-INT-04); código igual de nó sem external_id é adotado. */
export function criarConsumidorCatalogoNoDoErp(): ConsumidorEvento {
  return definirConsumidor({
    evento: EventoIntegracaoCatalogoNoAtualizado,
    async executar(p, ctx: ContextoConsumo) {
      const plano = planejarNoDoErp(comRegistro(p, CatalogoNoPayload));
      if (plano.tipo === 'ignorar') return;
      if (plano.tipo === 'inativar') {
        await ctx.db.query('update catalogo.catalogo_no set deleted_at = now() where external_id = $1 and deleted_at is null', [plano.external_id]);
        return;
      }
      const l = plano.linha;
      const pai = l.pai_external_id === null ? null : await noId(ctx.db, l.pai_external_id);
      const mesmoCodigo = (await ctx.db.query<{ id: string }>('select id from catalogo.catalogo_no where codigo = $1 and external_id is null and deleted_at is null', [l.codigo])).rows[0];
      if (mesmoCodigo) await ctx.db.query('update catalogo.catalogo_no set external_id = $2 where id = $1', [mesmoCodigo.id, l.external_id]);
      await ctx.db.query(
        `insert into catalogo.catalogo_no (tenant_id, pai_id, nivel, codigo, nome, ordem, ativo, external_id)
         values (plataforma.tenant_atual(), $1, $2, $3, $4, $5, true, $6)
         on conflict (tenant_id, external_id) where external_id is not null and deleted_at is null
         do update set pai_id = excluded.pai_id, nivel = excluded.nivel, codigo = excluded.codigo, nome = excluded.nome, ordem = excluded.ordem, ativo = true`,
        [pai, l.nivel, l.codigo, l.nome, l.ordem, l.external_id],
      );
    },
  });
}

/** RN-CAT-09: referências cruzadas do ERP (substituem o conjunto atual; ordem 1..3). `marca_nome` é o retrato do nome da marca do cadastro do Catálogo (0034). */
async function aplicarReferenciasDoErp(ctx: ContextoConsumo, produto: string, externalId: string, entrada: NonNullable<z.infer<typeof CadastroCatalogoErp>['referencias']>, origem: { lote_id: string | undefined; sku: string | null }): Promise<void> {
  const marcas = entrada.length > 0 ? (await ctx.db.query<MarcaDoCadastro>(`select id, nome, ativo, external_id from catalogo.marca_concorrente where deleted_at is null`)).rows : [];
  const r = resolverReferenciasDoErp(entrada.map((x) => ({ marca_external_id: x.marca_external_id, marca_nome: x.marca_nome, codigo: x.codigo })), marcas);
  if (r.descartadas.length > 0) ctx.log.warn({ external_id: externalId, descartadas: r.descartadas.map((d) => d.motivo) }, 'referências do produto do ERP descartadas (marca desconhecida ou inativa, código inválido, repetida ou acima de 3)');
  // T-0103: um aviso por (lote, produto) para o monitor do Hub; sem lote no evento não há a quem avisar
  const desconhecidas = marcasDesconhecidasDaLinha(entrada.map((x) => ({ marca_external_id: x.marca_external_id, marca_nome: x.marca_nome, codigo: x.codigo })), r.descartadas);
  if (desconhecidas && origem.lote_id) {
    await ctx.publicar(
      EVENTO_REFERENCIA_MARCA_DESCONHECIDA,
      { produto_external_id: externalId, produto_codigo: origem.sku, ...desconhecidas, lote_id: origem.lote_id, entidade: 'produto', ocorrido_em: ctx.agora().toISOString() },
      produto,
    );
  }
  await ctx.db.query(`update catalogo.produto_referencia set deleted_at = now() where produto_id = $1::uuid and deleted_at is null`, [produto]);
  let ordem = 1;
  for (const ref of r.referencias) {
    await ctx.db.query(
      `insert into catalogo.produto_referencia (tenant_id, produto_id, marca_id, codigo, codigo_compacto, ordem, marca_nome)
       values (plataforma.tenant_atual(), $1::uuid, $2::uuid, $3, $4, $5::int, $6)`,
      [produto, ref.marca_id, ref.codigo, codigoCompacto(ref.codigo), ordem++, ref.marca_nome.trim().slice(0, 120) || null],
    );
  }
}

/**
 * RN-CAT-11 / RN-CAT-09: aplicação, etiquetas e "oferece junto" do produto do ERP (upsert idempotente em `produto_conteudo` e
 * `produto_relacao` 'complementar'). Produto de "oferece junto" que ainda não chegou lança `ReferenciaAusenteErp` (a outbox
 * repete). Referências cruzadas: a marca é resolvida pelo cadastro de marcas do Catálogo (doc 06, RN-CAT-13); marca desconhecida ou inativa
 * descarta a referência, com aviso no log.
 */
async function aplicarCadastroCatalogoDoErp(p: { external_id: string; acao: 'criado' | 'atualizado' | 'inativado'; registro?: unknown; lote_id?: string }, ctx: ContextoConsumo, resolver: ResolverProdutos): Promise<void> {
  const lido = p.registro === undefined ? undefined : CadastroCatalogoErp.safeParse(p.registro);
  if (!lido?.success) return;
  const plano = planejarCadastroCatalogoDoErp({ external_id: p.external_id, acao: p.acao, registro: lido.data }, { aplicacaoMax: parametrosDoTenant(ctx.parametros()).aplicacao_max_cadastro });
  const referenciasDoErp = p.acao === 'inativado' ? undefined : lido.data.referencias;
  if (plano.aplicacao === undefined && plano.etiquetas === undefined && plano.ofereceJunto === undefined && referenciasDoErp === undefined) return;
  const produto = await produtoId(ctx, resolver, p.external_id);
  if (referenciasDoErp !== undefined) await aplicarReferenciasDoErp(ctx, produto, p.external_id, referenciasDoErp ?? [], { lote_id: p.lote_id, sku: typeof (p.registro as { sku?: unknown } | undefined)?.sku === 'string' ? ((p.registro as { sku: string }).sku).slice(0, 60) : null });
  if (plano.aplicacao !== undefined || plano.etiquetas !== undefined) {
    await ctx.db.query(
      `insert into catalogo.produto_conteudo (tenant_id, produto_id, aplicacoes, etiquetas)
       values (plataforma.tenant_atual(), $1::uuid, $2, coalesce($3::text[], '{}'::text[]))
       on conflict (tenant_id, produto_id) where deleted_at is null
       do update set aplicacoes = case when $4::boolean then excluded.aplicacoes else catalogo.produto_conteudo.aplicacoes end,
                     etiquetas = case when $5::boolean then excluded.etiquetas else catalogo.produto_conteudo.etiquetas end`,
      [produto, plano.aplicacao ?? null, plano.etiquetas ?? null, plano.aplicacao !== undefined, plano.etiquetas !== undefined],
    );
  }
  if (plano.ofereceJunto !== undefined) {
    const mapa = plano.ofereceJunto.length > 0 ? await resolver(ctx, plano.ofereceJunto) : new Map<string, string>();
    const faltam = plano.ofereceJunto.filter((x) => !mapa.has(x));
    if (faltam.length > 0) throw new ReferenciaAusenteErp('produto', faltam.length);
    const ids = plano.ofereceJunto.map((x) => mapa.get(x)!);
    await ctx.db.query(`update catalogo.produto_relacao set deleted_at = now() where produto_id = $1::uuid and tipo = 'complementar' and deleted_at is null and relacionado_id <> all($2::uuid[])`, [produto, ids]);
    let ordem = 0;
    for (const outro of ids) {
      await ctx.db.query(
        `insert into catalogo.produto_relacao (tenant_id, produto_id, relacionado_id, tipo, ordem, ativo)
         values (plataforma.tenant_atual(), $1::uuid, $2::uuid, 'complementar', $3::int, true)
         on conflict (tenant_id, produto_id, relacionado_id, tipo) where deleted_at is null do update set ordem = excluded.ordem, ativo = true`,
        [produto, outro, ordem++],
      );
    }
  }
}

/** RF-CAT-04: produto -> nó. Um vínculo vivo por produto (o external_id do vínculo é o do produto); troca de nó atualiza a linha. */
export function criarConsumidorProdutoNoDoErp(resolver: ResolverProdutos = resolverProdutosPelaConsulta): ConsumidorEvento {
  return definirConsumidor({
    evento: EventoIntegracaoProdutoAtualizado,
    async executar(p, ctx: ContextoConsumo) {
      await aplicarCadastroCatalogoDoErp(p, ctx, resolver);
      const plano = planejarProdutoNoDoErp(comRegistro(p, ProdutoPayload));
      if (plano.tipo === 'ignorar') return;
      if (plano.tipo === 'desvincular') {
        await ctx.db.query('update catalogo.produto_no set deleted_at = now() where external_id = $1 and deleted_at is null', [plano.produto_external_id]);
        return;
      }
      const no = await noId(ctx.db, plano.no_external_id);
      const produto = await produtoId(ctx, resolver, plano.produto_external_id);
      await ctx.db.query(
        `insert into catalogo.produto_no (tenant_id, produto_id, no_id, external_id)
         values (plataforma.tenant_atual(), $1, $2, $3)
         on conflict (tenant_id, external_id) where external_id is not null and deleted_at is null
         do update set produto_id = excluded.produto_id, no_id = excluded.no_id`,
        [produto, no, plano.external_id],
      );
    },
  });
}

/**
 * RN-VEN-23: `integracao.tabela_escalonada.atualizado@1` -> `catalogo.tabela_escalonada`. Upsert por `external_id`; faixa já cadastrada
 * à mão no BKO com a mesma chave (produto, medida, mínimo, tabela, início) é adotada (grava o external_id) em vez de bater no
 * índice único e deixar o evento em loop. Produto ou tabela que ainda não chegaram = `referencia_ausente` (repete, RN-INT-04).
 * Inativação do ERP = soft delete (a faixa sai das consultas, nunca se apaga de verdade).
 */
export function criarConsumidorTabelaEscalonadaDoErp(resolver: ResolverProdutos = resolverProdutosPelaConsulta): ConsumidorEvento {
  return definirConsumidor({
    evento: EventoIntegracaoTabelaEscalonadaAtualizado,
    async executar(p, ctx: ContextoConsumo) {
      const plano = planejarEscalonadaDoErp(comRegistro(p, TabelaEscalonadaPayload));
      if (plano.tipo === 'ignorar') return;
      if (plano.tipo === 'inativar') {
        await ctx.db.query('update catalogo.tabela_escalonada set deleted_at = now() where external_id = $1 and deleted_at is null', [plano.external_id]);
        return;
      }
      const l = plano.linha;
      const produto = await produtoId(ctx, resolver, l.produto_external_id);
      let tabela: string | null = null;
      if (l.tabela_external_id) {
        tabela = (await ctx.db.query<{ id: string }>('select id from catalogo.tabela_preco where external_id = $1 and deleted_at is null', [l.tabela_external_id])).rows[0]?.id ?? null;
        if (!tabela) throw new ReferenciaAusenteErp('tabela_preco');
      }
      const chave = [produto, l.medida, l.quantidade_minima, tabela, l.vigencia_inicio];
      await ctx.db.query(
        `update catalogo.tabela_escalonada set external_id = $6
          where external_id is null and deleted_at is null and produto_id = $1::uuid and medida is not distinct from $2::text
            and quantidade_minima = $3::int and tabela_preco_id is not distinct from $4::uuid and vigencia_inicio = $5::date
            and not exists (select 1 from catalogo.tabela_escalonada o where o.external_id = $6 and o.deleted_at is null)`,
        [...chave, l.external_id],
      );
      // colisão com OUTRA linha viva na mesma chave (outro external_id do ERP, ou manual que a adoção não pôde assumir): a do ERP vale,
      // a outra sai por soft delete e o aviso vai ao log. Sem isso o 23505 repetiria na outbox sem fim.
      const outras = await ctx.db.query<{ id: string; external_id: string | null }>(
        `select id, external_id from catalogo.tabela_escalonada
          where deleted_at is null and external_id is distinct from $6 and produto_id = $1::uuid and medida is not distinct from $2::text
            and quantidade_minima = $3::int and tabela_preco_id is not distinct from $4::uuid and vigencia_inicio = $5::date`,
        [...chave, l.external_id],
      );
      for (const o of outras.rows) {
        if (decidirColisaoEscalonada(o.external_id, l.external_id, true) === 'nenhuma') continue;
        await ctx.db.query('update catalogo.tabela_escalonada set deleted_at = now() where id = $1::uuid', [o.id]);
        ctx.log.warn({ external_id: l.external_id, substituida: o.external_id ? 'erp' : 'manual' }, 'faixa escalonada do ERP colidiu com outra faixa viva na mesma chave: a do ERP vale e a anterior foi inativada');
      }
      await ctx.db.query(
        `insert into catalogo.tabela_escalonada (tenant_id, produto_id, medida, quantidade_minima, preco_unidade_cents, vigencia_inicio, vigencia_fim, tabela_preco_id, ativo, external_id)
         values (plataforma.tenant_atual(), $1::uuid, $2, $3::int, $4::bigint, $5::date, $6::date, $7::uuid, true, $8)
         on conflict (tenant_id, external_id) where external_id is not null and deleted_at is null
         do update set produto_id = excluded.produto_id, medida = excluded.medida, quantidade_minima = excluded.quantidade_minima,
                       preco_unidade_cents = excluded.preco_unidade_cents, vigencia_inicio = excluded.vigencia_inicio,
                       vigencia_fim = excluded.vigencia_fim, tabela_preco_id = excluded.tabela_preco_id, ativo = true`,
        [produto, l.medida, l.quantidade_minima, l.preco_unidade_cents, l.vigencia_inicio, l.vigencia_fim, tabela, l.external_id],
      );
    },
  });
}

/** Resolve clientes do ERP (external_id) para o id interno. Injetável nos testes; o padrão usa `core.cadastro_resumo@1`. */
export type ResolverClientes = (ctx: ContextoConsumo, externalIds: string[]) => Promise<Map<string, string>>;

/**
 * Depende do campo aditivo `cliente_external_ids` na entrada de `core.cadastro_resumo@1` (pedido ao modulo-core, T-0120). Enquanto o
 * Core não o aceitar, a consulta recusa a entrada e o evento volta na outbox (nada é gravado errado).
 */
export const resolverClientesPelaConsulta: ResolverClientes = async (ctx, externalIds) => {
  const entrada = { cliente_ids: [], usuario_ids: [], produto_ids: [], produto_external_ids: [], endereco_ids: [], cliente_external_ids: externalIds };
  const saida = await ctx.consultar(CONSULTA_CADASTRO_RESUMO, entrada);
  const mapa = new Map<string, string>();
  for (const c of saida.clientes) if (c.external_id) mapa.set(c.external_id, c.id);
  return mapa;
};

export const EventoIntegracaoClienteAtualizado = eventoTolerante(EVENTO_ERP_CLIENTE_ATUALIZADO);

/**
 * RN-CAT-06 (T-0120): `tabela_preco_external_id` de `integracao.cliente.atualizado@1` -> `catalogo.cliente_tabela_preco` (uma viva por
 * cliente). Idempotente: atualiza a linha viva do cliente ou cria uma; `null` desvincula por soft delete. Cliente ou tabela que ainda
 * não chegaram = `referencia_ausente` (a outbox repete, RN-INT-04); desvincular cliente desconhecido não tem o que desfazer.
 */
export function criarConsumidorClienteTabelaDoErp(resolver: ResolverClientes = resolverClientesPelaConsulta): ConsumidorEvento {
  return definirConsumidor({
    evento: EventoIntegracaoClienteAtualizado,
    async executar(p, ctx: ContextoConsumo) {
      const plano = planejarVinculoTabelaDoErp(comRegistro(p, ClientePayload));
      if (plano.tipo === 'ignorar') return;
      const cliente = (await resolver(ctx, [plano.cliente_external_id])).get(plano.cliente_external_id);
      if (plano.tipo === 'desvincular') {
        if (cliente) await ctx.db.query('update catalogo.cliente_tabela_preco set deleted_at = now() where cliente_id = $1::uuid and deleted_at is null', [cliente]);
        return;
      }
      if (!cliente) throw new ReferenciaAusenteErp('cliente');
      const tabela = (await ctx.db.query<{ id: string }>('select id from catalogo.tabela_preco where external_id = $1 and deleted_at is null', [plano.tabela_external_id])).rows[0]?.id;
      if (!tabela) throw new ReferenciaAusenteErp('tabela_preco');
      const atualizada = await ctx.db.query<{ id: string }>(
        'update catalogo.cliente_tabela_preco set tabela_preco_id = $2::uuid, external_id = $3 where cliente_id = $1::uuid and deleted_at is null returning id',
        [cliente, tabela, plano.cliente_external_id],
      );
      if (atualizada.rows.length > 0) return;
      await ctx.db.query('insert into catalogo.cliente_tabela_preco (tenant_id, cliente_id, tabela_preco_id, external_id) values (plataforma.tenant_atual(), $1::uuid, $2::uuid, $3)', [cliente, tabela, plano.cliente_external_id]);
    },
  });
}

export const consumidoresDoErp: ConsumidorEvento[] = [
  criarConsumidorClienteTabelaDoErp(),
  criarConsumidorTabelaEscalonadaDoErp(),
  criarConsumidorPrecoDoErp(),
  criarConsumidorEstoqueDoErp(),
  criarConsumidorCatalogoNoDoErp(),
  criarConsumidorProdutoNoDoErp(),
];
