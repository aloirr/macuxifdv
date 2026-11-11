/**
 * Repositório do Catálogo no Postgres (T-0052). Só SQL no schema `catalogo` (regra 1), dentro da transação do tenant
 * (RLS). O cadastro base do produto é do Core: vem pela consulta `core.cadastro_resumo@1` (ADR 0012), nunca pela tabela.
 *
 * Tudo ligado na migração 0013: preço, estoque e depósito, atributos, mídia, conteúdo, sinônimos, destaque, cota de IA
 * (funções `catalogo.debitar_cota_ia` e `consultas_ia_do_dia`) e registro de buscas. Produtos = os que têm item de
 * tabela de preço no tenant (cadastro pelo Core: sku, nome, unidade, ativo; marca, categoria e EAN vêm na consulta como campos
 * aditivos opcionais, T-0119).
 */
import { randomUUID } from 'node:crypto';
import { montarUrlMiniatura } from './miniatura';
import { ErroHttpModulo, ErroRegraNegocio, type ClienteBanco, type ContextoBase, type TransacaoTenant } from '@macuxi/platform-sdk';
import { CONSULTA_CADASTRO_RESUMO } from '@macuxi/core/contracts';
import { anoCivilNoFuso } from '../domain/ano-civil';
import { filiaisDoEstoque } from '../domain/estoque';
import { prepararIndice } from '../domain/indice-busca';
import { filialDaTabela, filialDoClienteNoCore, filiaisDaCarteiraNoCore, nomeDaFilial } from './filiais-core';
import type { ItemTabelaPreco, MidiaProduto, Referencia, SalvarFaixa, Sinonimo, StockByBranch } from '../contracts';
import type { NoCatalogo, VinculoProdutoNo } from '../domain/arvore';
import { nomeMarcaDaReferencia } from '../domain/marcas';
import { codigoCompacto } from '../domain/ranking';
import { produtoDoCadastroCore } from './cadastro-core';
import { definirFotoPrincipal } from './miniatura';
import type { ProdutoCatalogo } from '../domain/vitrine';
import type { FabricaRepositorio, MarcaGuardada, RepositorioCatalogo } from './repositorio';

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
      saida.push(produtoDoCadastroCore(p));
    }
  }
  return saida;
}

/** Marcas concorrentes (id → nome e ativo), do cadastro do próprio Catálogo (RN-CAT-13, ADR 0034). */
export type ResolvedorMarcas = (tx: TransacaoTenant, db: ClienteBanco) => Promise<Map<string, { nome: string; ativo: boolean }>>;

/** Sem cadastro: lista vazia (testes). */
export const SEM_MARCAS: ResolvedorMarcas = async () => new Map();

/** Todas as marcas vivas do tenant, inclusive inativas (para dizer "inativa" em vez de "desconhecida"; quem lista filtra). */
export const MARCAS_DO_CATALOGO: ResolvedorMarcas = async (_tx, db) => {
  const r = await db.query<{ id: string; nome: string; ativo: boolean }>(`select id, nome, ativo from catalogo.marca_concorrente where deleted_at is null`);
  return new Map(r.rows.map((c) => [c.id, { nome: c.nome, ativo: c.ativo }]));
};

/** Atributos, destaque, aplicação, referências cruzadas e miniatura do próprio Catálogo (0013, 0033) sobre o cadastro do Core. */
async function enriquecer(db: ClienteBanco, produtos: ProdutoCatalogo[], marcas: Map<string, { nome: string; ativo: boolean }>): Promise<ProdutoCatalogo[]> {
  if (produtos.length === 0) return produtos;
  const ids = produtos.map((p) => p.id);
  const at = await db.query<{ produto_id: string; nome: string; valor: string }>(
    `select produto_id, nome, valor from catalogo.produto_atributo where produto_id = any($1::uuid[]) and deleted_at is null order by ordem, nome`,
    [ids],
  );
  const co = await db.query<{ produto_id: string; campanha: boolean; aplicacao: string | null }>(
    `select produto_id, (campanha or destaque) as campanha, aplicacoes as aplicacao from catalogo.produto_conteudo where produto_id = any($1::uuid[]) and deleted_at is null`,
    [ids],
  );
  const rf = await db.query<{ produto_id: string; marca_id: string; codigo: string; marca_nome: string | null }>(
    `select produto_id, marca_id, codigo, marca_nome from catalogo.produto_referencia where produto_id = any($1::uuid[]) and deleted_at is null order by ordem`,
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
  const aplicacao = new Map(co.rows.map((r) => [r.produto_id, r.aplicacao ?? '']));
  const referencias = new Map<string, Referencia[]>();
  for (const r of rf.rows) {
    // cadastro de marcas disponível: manda (marca inativa/ausente esconde); vazio: retrato marca_nome (RN-CAT-09)
    const nome = nomeMarcaDaReferencia(r.marca_id, r.marca_nome, marcas);
    if (nome === null) continue;
    referencias.set(r.produto_id, [...(referencias.get(r.produto_id) ?? []), { marca_id: r.marca_id, marca_nome: nome, codigo: r.codigo }]);
  }
  const thumb = new Map(mi.rows.map((r) => [r.produto_id, montarUrlMiniatura(r.arquivo_id, r.url)]));
  return produtos.map((p) => ({
    ...p,
    atributos: atributos.get(p.id) ?? [],
    aplicacao: aplicacao.get(p.id) ?? '',
    referencias: referencias.get(p.id) ?? [],
    campanha: campanha.get(p.id) ?? false,
    thumbnail_url: thumb.get(p.id) ?? null,
  }));
}

/**
 * Retrato do catálogo por tenant em memória (T-0119, D-T0107b): a busca lia os 20 mil produtos (155 consultas, ~0,7 s) a cada
 * pedido. O retrato vale `TTL_RETRATO_MS`; as gravações do próprio Catálogo o descartam na hora; quem renova é uma só
 * requisição por vez (as outras esperam a mesma leitura). O que muda por usuário (preço, estoque) NUNCA entra aqui.
 */
export const TTL_RETRATO_MS = 60_000;
/** Sem mudança de versão, o cadastro do Core (que a versão não enxerga) é relido ao menos a cada 10 minutos. */
export const RECONFERENCIA_RETRATO_MS = 600_000;
/** A renovação em segundo plano espera a transação da requisição fechar antes de pedir a sua (guarda de conexão da API). */
const ATRASO_RENOVACAO_MS = 1_000;
const MAX_TENANTS_RETRATO = 20;
interface Retrato {
  /** Quando o retrato foi conferido pela última vez (carga ou renovação sem mudança). */
  em: number;
  /** Quando a lista foi lida de fato do banco e do Core. */
  carregadoEm: number;
  produtos: readonly ProdutoCatalogo[] | null;
  /** Versão barata do Catálogo no momento da leitura (`versaoDoCatalogo`); nulo = desconhecida. */
  versao: string | null;
  /** Assinatura do conteúdo da lista, calculada na primeira renovação que precisar compará-la. */
  assinatura: string | null;
  carregando: Promise<readonly ProdutoCatalogo[]> | null;
  /** Uma só renovação por tenant: enquanto true, as requisições seguem servindo o retrato antigo. */
  renovando: boolean;
}
const RETRATOS = new Map<string, Retrato>();
/**
 * Geração do retrato por tenant: cada descarte a incrementa. Uma carga anota a geração ao começar e só guarda o resultado se ela não
 * mudou — senão uma carga que já estava em andamento quando chegou o descarte gravaria de volta o dado velho (ou sobrescreveria uma
 * carga mais nova). Quem pediu a carga velha recebe a lista dela (leu o catálogo antes da gravação), mas ela não vira retrato.
 */
const GERACAO = new Map<string, number>();
let geracaoGlobal = 0;
const geracaoDe = (tenant: string): number => geracaoGlobal + (GERACAO.get(tenant) ?? 0);
/** Descarta o retrato (do tenant, ou todos). Chamado antes da gravação e, pela rota, DEPOIS do commit (`aposGravar`). */
export function esquecerRetratoCatalogo(tenantId?: string): void {
  if (tenantId === undefined) {
    geracaoGlobal++;
    RETRATOS.clear();
  } else {
    GERACAO.set(tenantId, (GERACAO.get(tenantId) ?? 0) + 1);
    RETRATOS.delete(tenantId);
  }
}

async function lerProdutos(db: ClienteBanco, tx: TransacaoTenant, marcas: ResolvedorMarcas): Promise<ProdutoCatalogo[]> {
  return enriquecer(db, await cadastroDoCore(tx, await idsComPreco(db)), await marcas(tx, db));
}

/**
 * Versão barata do Catálogo (T-0119, proposta do banco-dados): a maior `updated_at` das tabelas que mudam o retrato, por varredura
 * de índice (`*_sync_ix`). A mudança do cadastro no Core não passa por aqui (ver `RECONFERENCIA_RETRATO_MS` e `aposGravar`).
 */
async function versaoDoCatalogo(db: ClienteBanco): Promise<string | null> {
  const r = await db.query<{ versao: string | null }>(
    `select greatest(
       (select max(updated_at) from catalogo.tabela_preco_item),
       (select max(updated_at) from catalogo.produto_atributo),
       (select max(updated_at) from catalogo.produto_conteudo),
       (select max(updated_at) from catalogo.produto_referencia),
       (select max(updated_at) from catalogo.produto_midia))::text as versao`,
  );
  return r.rows[0]?.versao ?? null;
}

const cederLaco = (): Promise<void> => new Promise((r) => setImmediate(r));

/** Assinatura do conteúdo da lista (dois FNV-1a de 32 bits sobre o JSON de cada produto), em pedaços que cedem o laço de eventos. */
async function assinaturaDaLista(produtos: readonly ProdutoCatalogo[]): Promise<string> {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < produtos.length; i++) {
    const s = JSON.stringify(produtos[i]);
    for (let k = 0; k < s.length; k++) {
      const c = s.charCodeAt(k);
      h1 = Math.imul(h1 ^ c, 0x01000193);
      h2 = Math.imul(h2 + c, 0x85ebca6b) ^ (h2 >>> 13);
    }
    if (i % 250 === 249) await cederLaco();
  }
  return `${produtos.length}:${(h1 >>> 0).toString(16)}:${(h2 >>> 0).toString(16)}`;
}

/** Ano do índice (a aplicação expande faixas de anos); o relógio é o da requisição (ADR 0015). */
const anoDoIndice = (ctx: ContextoBase): number => anoCivilNoFuso(ctx.agora());

export function criarRepositorioPostgres(opcoes: { marcas?: ResolvedorMarcas } = {}): FabricaRepositorio {
  const resolverMarcas = opcoes.marcas ?? MARCAS_DO_CATALOGO;
  return (ctx, db, tx): RepositorioCatalogo => {
    const tenant = ctx.usuario.tenant_id;

    /** Relê o catálogo e, se mudou, troca o retrato só depois de o índice novo estar pronto (stale-while-revalidate). */
    async function renovar(r: Retrato, geracao: number, executar: <T>(fn: (db: ClienteBanco, tx: TransacaoTenant) => Promise<T>) => Promise<T>): Promise<void> {
      try {
        const lido = await executar(async (db2, tx2) => ({ versao: await versaoDoCatalogo(db2), produtos: await lerProdutos(db2, tx2, resolverMarcas) }));
        const antiga = (r.assinatura ??= await assinaturaDaLista(r.produtos!));
        const nova = await assinaturaDaLista(lido.produtos);
        if (geracaoDe(tenant) !== geracao || RETRATOS.get(tenant) !== r) return; // descartado no meio: a próxima requisição carrega do zero
        if (nova === antiga) {
          // nada mudou: mantém a lista e o índice (o mesmo objeto) e só confirma o retrato
          r.em = Date.now();
          r.carregadoEm = r.em;
          r.versao = lido.versao;
          return;
        }
        if (typeof ctx.agora === 'function') await prepararIndice(lido.produtos, anoDoIndice(ctx));
        if (geracaoDe(tenant) !== geracao || RETRATOS.get(tenant) !== r) return;
        const agora = Date.now();
        RETRATOS.set(tenant, { em: agora, carregadoEm: agora, produtos: lido.produtos, versao: lido.versao, assinatura: nova, carregando: null, renovando: false });
      } catch {
        // falha na renovação: segue com o retrato antigo e tenta de novo em 5 s
        r.em = Date.now() - TTL_RETRATO_MS + 5_000;
      } finally {
        r.renovando = false;
      }
    }

    /** TTL vencido: confere a versão (uma consulta de índice) e, se preciso, renova em segundo plano. Quem pediu recebe o retrato antigo. */
    async function conferir(r: Retrato): Promise<void> {
      if (r.renovando) return;
      r.renovando = true;
      let precisa = true;
      try {
        const versao = await versaoDoCatalogo(db);
        precisa = !(versao !== null && versao === r.versao && Date.now() - r.carregadoEm < RECONFERENCIA_RETRATO_MS);
        if (!precisa) r.em = Date.now();
      } catch {
        r.em = Date.now() - TTL_RETRATO_MS + 5_000;
        precisa = false;
      }
      if (!precisa) {
        r.renovando = false;
        return;
      }
      const geracao = geracaoDe(tenant);
      if (typeof ctx.comTenant !== 'function') {
        await renovar(r, geracao, (fn) => fn(db, tx));
        return;
      }
      const executar = <T>(fn: (db: ClienteBanco, tx: TransacaoTenant) => Promise<T>): Promise<T> => ctx.comTenant(fn);
      const temporizador = setTimeout(() => void renovar(r, geracao, executar), ATRASO_RENOVACAO_MS);
      (temporizador as unknown as { unref?: () => void }).unref?.();
    }

    return {
    async produtos() {
      return lerProdutos(db, tx, resolverMarcas);
    },
    async produtosEmCache() {
      const r = RETRATOS.get(tenant);
      if (r?.produtos) {
        if (Date.now() - r.em < TTL_RETRATO_MS) return r.produtos;
        await conferir(r);
        const atual = RETRATOS.get(tenant);
        if (atual?.produtos) return atual.produtos;
        if (atual?.carregando) return atual.carregando;
        // descartado durante a conferência: carrega do zero, abaixo
      } else if (r?.carregando) return r.carregando;
      const geracao = geracaoDe(tenant);
      const carregando: Promise<readonly ProdutoCatalogo[]> = (async () => {
        const versao = await versaoDoCatalogo(db).catch(() => null);
        const produtos = await lerProdutos(db, tx, resolverMarcas);
        // o índice nasce aqui, em pedaços que cedem o laço de eventos, e não na primeira busca (T-0119)
        if (typeof ctx.agora === 'function') await prepararIndice(produtos, anoDoIndice(ctx));
        return { versao, produtos };
      })().then(
        ({ versao, produtos }) => {
          // só guarda se nada foi descartado durante a carga e se esta carga ainda é a registrada (não há uma mais nova)
          if (geracaoDe(tenant) === geracao && RETRATOS.get(tenant)?.carregando === carregando) {
            if (RETRATOS.size >= MAX_TENANTS_RETRATO && !RETRATOS.has(tenant)) RETRATOS.delete(RETRATOS.keys().next().value!);
            const agora = Date.now();
            RETRATOS.set(tenant, { em: agora, carregadoEm: agora, produtos, versao, assinatura: null, carregando: null, renovando: false });
          }
          return produtos;
        },
        (e: unknown) => {
          if (RETRATOS.get(tenant)?.carregando === carregando) RETRATOS.delete(tenant);
          throw e;
        },
      );
      RETRATOS.set(tenant, { em: 0, carregadoEm: 0, produtos: null, versao: null, assinatura: null, carregando, renovando: false });
      return carregando;
    },
    async produto(id) {
      const [p] = await enriquecer(db, await cadastroDoCore(tx, [id]), await resolverMarcas(tx, db));
      return p ?? null;
    },
    async marcasConcorrentes() {
      return resolverMarcas(tx, db);
    },
    async marcasCadastro() {
      const r = await db.query<MarcaGuardada>(
        `select m.id, m.nome, m.ativo, m.external_id,
                (select count(*)::int from catalogo.produto_referencia r where r.tenant_id = m.tenant_id and r.marca_id = m.id and r.deleted_at is null) as referencias
           from catalogo.marca_concorrente m where m.deleted_at is null order by lower(m.nome), m.id`,
      );
      return r.rows;
    },
    async gravarMarca(id, m) {
      esquecerRetratoCatalogo(ctx.usuario.tenant_id);
      const gravou = await db
        .query(
          `insert into catalogo.marca_concorrente (id, tenant_id, nome, ativo, external_id)
           values ($1::uuid, plataforma.tenant_atual(), $2, $3, $4)
           on conflict (id) do update set nome = excluded.nome, ativo = excluded.ativo, external_id = excluded.external_id
             where catalogo.marca_concorrente.deleted_at is null`,
          [id, m.nome, m.ativo, m.external_id],
        )
        .catch((e: unknown) => {
          const err = e as { code?: string; constraint?: string };
          if (err.code === '23505' && err.constraint === 'marca_concorrente_nome_uk') throw new ErroRegraNegocio('RN-CAT-13', `Já existe a marca "${m.nome}". Use a que existe ou escolha outro nome.`, { campo: 'nome' });
          if (err.code === '23505' && err.constraint === 'marca_concorrente_external_uk') throw new ErroRegraNegocio('RN-CAT-13', 'Este código do ERP já está em outra marca. Confira o código e salve de novo.', { campo: 'external_id' });
          // 42501: o id existe em OUTRO tenant (linha invisível pela RLS no conflito); trata como id em uso, sem dizer de quem
          if (err.code === '42501') return null;
          throw e;
        });
      // 0 linhas = o id é de uma marca apagada deste tenant (o `where deleted_at is null` do upsert não grava); 42501 = de outro tenant
      if (gravou === null || gravou.rowCount === 0) return false;
      // retrato do nome e toque nas referências (sync: some/volta conforme a marca estiver ativa, ADR 0034 §6), na mesma transação
      await db.query(`update catalogo.produto_referencia set marca_nome = $2 where marca_id = $1::uuid and deleted_at is null`, [id, m.nome.trim().slice(0, 120)]);
      return true;
    },
    async dadosExportacao() {
      const nos = await db.query<NoCatalogo>(`select id, pai_id, nivel, codigo, nome, ordem, ativo from catalogo.catalogo_no where deleted_at is null`);
      const vinculos = await db.query<VinculoProdutoNo>(`select produto_id, no_id from catalogo.produto_no where deleted_at is null`);
      const rel = await db.query<{ produto_id: string; relacionado_id: string }>(
        `select produto_id, relacionado_id from catalogo.produto_relacao where tipo = 'complementar' and ativo and deleted_at is null order by produto_id, ordem, id`,
      );
      const ofereceJunto = new Map<string, string[]>();
      for (const r of rel.rows) ofereceJunto.set(r.produto_id, [...(ofereceJunto.get(r.produto_id) ?? []), r.relacionado_id]);
      return { nos: nos.rows, vinculos: vinculos.rows, ofereceJunto };
    },
    async extrasFicha(produtoId) {
      const rel = await db.query<{ relacionado_id: string }>(
        `select relacionado_id from catalogo.produto_relacao where produto_id = $1::uuid and tipo = 'complementar' and ativo and deleted_at is null order by ordem, id limit 5`,
        [produtoId],
      );
      const cadastro = new Map((await cadastroDoCore(tx, rel.rows.map((x) => x.relacionado_id))).map((p) => [p.id, p]));
      const ofereceJunto = rel.rows.flatMap((x) => {
        const p = cadastro.get(x.relacionado_id);
        return p && p.ativo ? [{ produto_id: p.id, erp_code: p.sku, description: p.nome }] : [];
      });
      const et = await db.query<{ etiquetas: string[] }>(`select etiquetas from catalogo.produto_conteudo where produto_id = $1::uuid and deleted_at is null`, [produtoId]);
      return { ofereceJunto, etiquetas: et.rows[0]?.etiquetas ?? [] };
    },
    async filiaisDaTela() {
      const r = await filiaisDaCarteiraNoCore(tx.consultar);
      return { padraoId: r.filialPadrao, filiais: [...r.filiais.values()].filter((f) => f.ativo).map((f) => ({ id: f.id, nome: f.nome, padrao: f.id === r.filialPadrao })) };
    },
    async tabelasPreco(filialId) {
      // RN-CORE-39: a contagem é dos itens da filial escolhida (a mesma tabela tem itens por filial; sem filtro duplicava)
      const r = await db.query<{ id: string; codigo: string; nome: string; ativo: boolean; itens: string }>(
        `select t.id, t.codigo, t.nome, t.ativo,
                (select count(*) from catalogo.tabela_preco_item i where i.tabela_preco_id = t.id and i.filial_id = $1::uuid and i.unidade is null and i.deleted_at is null) as itens
           from catalogo.tabela_preco t where t.deleted_at is null order by lower(t.nome), t.id`,
        [filialId],
      );
      return r.rows.map((x) => ({ id: x.id, codigo: x.codigo, nome: x.nome, ativo: x.ativo, itens: Number(x.itens) }));
    },
    async precosUnidade(tabelaId, filialId) {
      // RN-VEN-15 (nova): só o preço da unidade base; a linha de embalagem antiga (unidade não nula) não aparece
      const r = await db.query<{ produto_id: string; preco_cents: number; vigencia_inicio: string | null; vigencia_fim: string | null }>(
        `select produto_id, preco_cents::float8 as preco_cents,
                to_char(vigencia_inicio at time zone 'UTC', ${UTC}) as vigencia_inicio, to_char(vigencia_fim at time zone 'UTC', ${UTC}) as vigencia_fim
           from catalogo.tabela_preco_item where tabela_preco_id = $1::uuid and filial_id = $2::uuid and unidade is null and deleted_at is null order by produto_id`,
        [tabelaId, filialId],
      );
      return r.rows;
    },
    async faixas() {
      const r = await db.query<{ id: string; external_id: string | null; produto_id: string; medida: string | null; quantidade_minima: number; preco_unidade_cents: number; vigencia_inicio: string; vigencia_fim: string | null; tabela_preco_id: string | null; ativo: boolean }>(
        `select id, external_id, produto_id, medida, quantidade_minima::int as quantidade_minima, preco_unidade_cents::float8 as preco_unidade_cents,
                vigencia_inicio::text as vigencia_inicio, vigencia_fim::text as vigencia_fim, tabela_preco_id, ativo
           from catalogo.tabela_escalonada where deleted_at is null order by produto_id, medida nulls first, quantidade_minima, vigencia_inicio, id`,
      );
      return r.rows;
    },
    async salvarFaixa(id: string, f: SalvarFaixa) {
      const r = await db
        .query<{ criado: boolean }>(
          `insert into catalogo.tabela_escalonada (id, tenant_id, produto_id, medida, quantidade_minima, preco_unidade_cents, vigencia_inicio, vigencia_fim, tabela_preco_id, ativo)
           values ($1::uuid, plataforma.tenant_atual(), $2::uuid, $3, $4::int, $5::bigint, $6::date, $7::date, $8::uuid, $9)
           on conflict (id) do update set produto_id = excluded.produto_id, medida = excluded.medida, quantidade_minima = excluded.quantidade_minima,
             preco_unidade_cents = excluded.preco_unidade_cents, vigencia_inicio = excluded.vigencia_inicio, vigencia_fim = excluded.vigencia_fim,
             tabela_preco_id = excluded.tabela_preco_id, ativo = excluded.ativo, deleted_at = null
             where catalogo.tabela_escalonada.external_id is null
           returning (xmax = 0) as criado`,
          [id, f.produto_id, f.medida, f.quantidade_minima, f.preco_unidade_cents, f.vigencia_inicio, f.vigencia_fim, f.tabela_preco_id, f.ativo],
        )
        .catch((e: unknown) => {
          const err = e as { code?: string; constraint?: string };
          // a rota checa antes; a corrida cai aqui (tabela_escalonada_faixa_uk) e a tabela inexistente na FK
          if (err.code === '23505' && err.constraint === 'tabela_escalonada_faixa_uk') throw new ErroHttpModulo(409, 'FAIXA_EM_CONFLITO', 'Já existe uma faixa para este produto, medida, quantidade mínima, tabela e início de vigência.');
          if (err.code === '23503') throw new ErroHttpModulo(422, 'TABELA_PRECO_INEXISTENTE', 'A tabela de preço escolhida não existe mais. Atualize a lista e escolha outra.');
          throw e;
        });
      // nada devolvido = o id é de uma faixa do ERP (viva ou apagada): não reabre
      if (r.rows.length === 0) throw new ErroHttpModulo(409, 'FAIXA_DO_ERP', 'Esta faixa vem do ERP e é alterada lá. Cadastre outra faixa aqui se precisar de uma exceção.');
      return { criado: r.rows[0]?.criado ?? false };
    },
    async removerFaixa(id: string) {
      const r = await db.query(`update catalogo.tabela_escalonada set deleted_at = now() where id = $1::uuid and deleted_at is null`, [id]);
      return (r.rowCount ?? 0) > 0;
    },
    async salvarCadastroCatalogo(produtoId, c, em) {
      esquecerRetratoCatalogo(ctx.usuario.tenant_id);
      const r = await db.query<{ criado: boolean }>(
        `insert into catalogo.produto_conteudo (tenant_id, produto_id, aplicacoes, etiquetas, updated_at)
         values (plataforma.tenant_atual(), $1::uuid, $2, $3::text[], $4::timestamptz)
         on conflict (tenant_id, produto_id) where deleted_at is null
         do update set aplicacoes = excluded.aplicacoes, etiquetas = excluded.etiquetas
         returning (xmax = 0) as criado`,
        [produtoId, c.aplicacao?.trim() ? c.aplicacao.trim() : null, c.etiquetas.map((e) => e.trim()), em],
      );
      // referências: o conjunto enviado substitui o anterior (ordem 1..3 na ordem recebida)
      // `referencias` ausente = não mexe (B1); lista vazia explícita = apaga todas
      if (c.referencias !== undefined) await db.query(`update catalogo.produto_referencia set deleted_at = now() where produto_id = $1::uuid and deleted_at is null`, [produtoId]);
      let ordem = 1;
      // retrato do nome da marca (0034): a rota já validou o marca_id contra o cadastro de marcas
      const marcasDoCadastro = (c.referencias ?? []).length > 0 ? await resolverMarcas(tx, db) : new Map<string, { nome: string; ativo: boolean }>();
      for (const ref of c.referencias ?? []) {
        await db.query(
          `insert into catalogo.produto_referencia (tenant_id, produto_id, marca_id, codigo, codigo_compacto, ordem, marca_nome)
           values (plataforma.tenant_atual(), $1::uuid, $2::uuid, $3, $4, $5::int, $6)`,
          [produtoId, ref.marca_id, ref.codigo.trim(), codigoCompacto(ref.codigo), ordem++, marcasDoCadastro.get(ref.marca_id)?.nome.trim().slice(0, 120) || null],
        );
      }
      // oferece junto: relação complementar, até 5, na ordem recebida
      await db.query(`update catalogo.produto_relacao set deleted_at = now() where produto_id = $1::uuid and tipo = 'complementar' and deleted_at is null and relacionado_id <> all($2::uuid[])`, [
        produtoId,
        c.oferece_junto,
      ]);
      let posicao = 0;
      for (const outro of c.oferece_junto) {
        await db.query(
          `insert into catalogo.produto_relacao (tenant_id, produto_id, relacionado_id, tipo, ordem, ativo)
           values (plataforma.tenant_atual(), $1::uuid, $2::uuid, 'complementar', $3::int, true)
           on conflict (tenant_id, produto_id, relacionado_id, tipo) where deleted_at is null do update set ordem = excluded.ordem, ativo = true`,
          [produtoId, outro, posicao++],
        );
      }
      return { criado: r.rows[0]?.criado ?? false };
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
      // RN-CORE-39: itens da filial do preço (a do cliente; a padrão se a tabela não tem item nenhum na filial dele)
      const filial = await filialDaTabela(db, tabela, await filialDoClienteNoCore(tx.consultar, clienteId));
      const r = await db.query<{ produto_id: string; preco_cents: number; vigencia_inicio: string | null; vigencia_fim: string | null }>(
        `select produto_id, preco_cents::float8 as preco_cents,
                to_char(vigencia_inicio at time zone 'UTC', ${UTC}) as vigencia_inicio,
                to_char(vigencia_fim at time zone 'UTC', ${UTC}) as vigencia_fim
           from catalogo.tabela_preco_item
          where tabela_preco_id = $1::uuid and filial_id = $3::uuid and produto_id = any($2::uuid[]) and deleted_at is null`,
        [tabela, [...produtoIds], filial.filialId],
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
      const filiais = (await filiaisDaCarteiraNoCore(tx.consultar)).filiais;
      const r = await db.query<{ produto_id: string; filial_id: string; quantidade: number; atualizado_em: string | null }>(
        `select s.produto_id, d.filial_id, s.quantidade::float8 as quantidade,
                to_char(s.atualizado_erp_em at time zone 'UTC', ${UTC}) as atualizado_em
           from catalogo.estoque_saldo s
           join catalogo.deposito d on d.tenant_id = s.tenant_id and d.id = s.deposito_id and d.ativo and d.deleted_at is null
          where s.produto_id = any($1::uuid[]) and s.deleted_at is null
          order by d.filial_id, d.id`,
        [[...produtoIds]],
      );
      for (const x of r.rows) {
        const lista = saida.get(x.produto_id) ?? [];
        // RN-CORE-39: o saldo é da FILIAL do depósito (o domain soma os depósitos da mesma filial)
        lista.push({ branch_id: x.filial_id, branch_name: nomeDaFilial(filiais, x.filial_id), quantity: Math.round(x.quantidade), updated_at: x.atualizado_em });
        saida.set(x.produto_id, lista);
      }
      return saida;
    },
    async filiaisDoUsuario(clienteId) {
      const carteira = await ctx.carteira();
      const cliente = clienteId ? (await filialDoClienteNoCore(tx.consultar, clienteId)).filialCliente : null;
      const da = cliente === null && carteira !== 'tenant' ? (await filiaisDaCarteiraNoCore(tx.consultar)).daCarteira : null;
      const lista = filiaisDoEstoque({ filialDoCliente: cliente, escopo: carteira === 'tenant' ? 'tenant' : 'carteira', filiaisDaCarteira: da });
      return lista === null ? null : [...lista];
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
      esquecerRetratoCatalogo(ctx.usuario.tenant_id);
      await db.query(
        `insert into catalogo.produto_conteudo (tenant_id, produto_id, campanha, destaque) values (plataforma.tenant_atual(), $1::uuid, $2, $2)
         on conflict (tenant_id, produto_id) where deleted_at is null do update set campanha = excluded.campanha, destaque = excluded.destaque`,
        [produtoId, destaque],
      );
    },
    async definirFotoPrincipal(produtoId, arquivoId, titulo) {
      const atual = await db.query<{ arquivo_id: string | null }>(
        `select arquivo_id from catalogo.produto_midia where produto_id = $1::uuid and principal and tipo = 'foto' and deleted_at is null limit 1`,
        [produtoId],
      );
      if (atual.rows[0]?.arquivo_id === arquivoId) return { alterou: false };
      esquecerRetratoCatalogo(ctx.usuario.tenant_id);
      await definirFotoPrincipal(db, ctx.usuario.tenant_id, produtoId, { id: randomUUID(), arquivoId, titulo: titulo ?? null });
      return { alterou: true };
    },
    async salvarConteudo(produtoId, c, em) {
      esquecerRetratoCatalogo(ctx.usuario.tenant_id);
      const r = await db.query<{ criado: boolean }>(
        `insert into catalogo.produto_conteudo (tenant_id, produto_id, descricao, argumentos_venda, faq, updated_at, aplicacoes)
         values (plataforma.tenant_atual(), $1::uuid, $2, $3, $4::jsonb, $5::timestamptz, $6)
         on conflict (tenant_id, produto_id) where deleted_at is null
         do update set descricao = excluded.descricao, argumentos_venda = excluded.argumentos_venda, faq = excluded.faq,
                       aplicacoes = case when $7::boolean then excluded.aplicacoes else catalogo.produto_conteudo.aplicacoes end
         returning (xmax = 0) as criado`,
        [produtoId, c.description, c.selling_points.join('\n'), JSON.stringify(c.faq.map((f) => ({ pergunta: f.question, resposta: f.answer }))), em, c.aplicacao?.trim() ? c.aplicacao.trim() : null, c.aplicacao !== undefined],
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
    };
  };
}
