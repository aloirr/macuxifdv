/**
 * Repositório do Catálogo no Postgres (T-0052). Só SQL no schema `catalogo` (regra 1), dentro da transação do tenant
 * (RLS). O cadastro base do produto é do Core: vem pela consulta `core.cadastro_resumo@1` (ADR 0012), nunca pela tabela.
 *
 * Situação até a migração 0013 (banco-dados, pedido R-… da T-0052):
 * - LIGADO: preço (`catalogo.tabela_preco`, `tabela_preco_item`, `cliente_tabela_preco`, 0008); produtos = os que têm
 *   item de tabela de preço no tenant (cadastro pelo Core: sku, nome, unidade, ativo; marca/categoria/EAN ainda não vêm
 *   na consulta — pedido ao modulo-core).
 * - ESPERANDO 0013: estoque e depósito, atributos, mídia, conteúdo, sinônimos, destaque, vendas, cota de IA e registro
 *   de buscas. Leitura devolve vazio/neutro; a cota devolve `'indisponivel'` (a IA não é chamada — falha fechada, sem
 *   gasto sem limite); escrita do BKO responde 503 com a ação seguinte.
 */
import { ErroHttpModulo, type ClienteBanco, type TransacaoTenant } from '@macuxi/platform-sdk';
import { CONSULTA_CADASTRO_RESUMO } from '@macuxi/core/contracts';
import type { ItemTabelaPreco } from '../contracts';
import type { ProdutoCatalogo } from '../domain/vitrine';
import type { FabricaRepositorio, RepositorioCatalogo } from './repositorio';

const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const LOTE_CONSULTA = 500;

/** Escrita do BKO antes da 0013: 503 com a ação seguinte (a tela mostra a mensagem). */
export function conteudoIndisponivel(): never {
  throw new ErroHttpModulo(503, 'CATALOGO_CONTEUDO_INDISPONIVEL', 'O cadastro de conteúdo do catálogo ainda não está disponível neste servidor. Tente de novo depois da próxima atualização.');
}

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

export function criarRepositorioPostgres(): FabricaRepositorio {
  return (_ctx, db, tx): RepositorioCatalogo => ({
    async produtos() {
      return cadastroDoCore(tx, await idsComPreco(db));
    },
    async produto(id) {
      const [p] = await cadastroDoCore(tx, [id]);
      return p ?? null;
    },
    async sinonimos() {
      return [];
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
    async saldos() {
      return new Map();
    },
    async filiaisDoUsuario() {
      return null;
    },
    async conteudo() {
      return { conteudo: null, midias: [] };
    },
    async usoIa() {
      return 'indisponivel';
    },
    async debitarIa() {
      return false;
    },
    async registrarBusca() {
      // 0013: catalogo.busca_log (termo normalizado, resultados, interpretado_por, created_at; sem usuário)
    },
    async termosSemResultado() {
      return [];
    },
    async salvarSinonimo() {
      return conteudoIndisponivel();
    },
    async removerSinonimo() {
      return conteudoIndisponivel();
    },
    async marcarDestaque() {
      return conteudoIndisponivel();
    },
    async salvarConteudo() {
      return conteudoIndisponivel();
    },
  });
}
