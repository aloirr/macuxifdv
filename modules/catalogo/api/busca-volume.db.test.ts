/**
 * T-0119 (D-T0107b): a busca com 20 mil produtos × Postgres real. Regressão do defeito em que cada pedido relia o catálogo
 * inteiro (155 consultas, ~0,7 s) e ranqueava 20 mil produtos no Node (~4 s). Trava:
 * - o plano (EXPLAIN) das leituras de preço e de estoque dos candidatos usa índice (nenhum Seq Scan nas tabelas grandes);
 * - o retrato do catálogo sai do banco uma vez e as buscas seguintes não voltam ao banco por produto (de cache);
 * - o caminho da busca (retrato → candidatos → teto de candidatos → preço/estoque → ranking) responde em menos de 300 ms (p95) com 20 mil;
 * - o resultado da busca com índice e teto de candidatos tem a mesma primeira página do ranking sobre a lista inteira (o total para
 *   no teto: `TETO_CANDIDATOS`).
 * Pula sem Postgres; com MACUXI_PG_EXIGIR=1 (CI) falha. O tempo limite do CI é folgado (a máquina é compartilhada): a meta fina
 * de 300 ms por requisição HTTP é medida na carga da T-0107 (`MACUXI_CARGA_MEDIR=1`).
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ClienteBanco, ContextoBase, TransacaoTenant } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { candidatosDaBusca, cortarCandidatos, TETO_CANDIDATOS } from '../domain/indice-busca';
import { interpretarConsulta } from '../domain/consulta';
import { PARAMETROS_PADRAO } from '../domain/parametros';
import { buscarProdutos, vocabularioDe, type ContextoVitrine, type ProdutoCatalogo } from '../domain/vitrine';
import { consultarFiliaisDeTeste } from './filiais-teste';
import type { RepositorioCatalogo } from './repositorio';
import { criarRepositorioPostgres, esquecerRetratoCatalogo, SEM_MARCAS } from './repositorio-postgres';

const A = DOIS_TENANTS.A;
const TOTAL = 20_000;
const uuid = (base: number, n: number) => `0ca00000-0000-4000-8000-${String(base + n).padStart(12, '0')}`;
const PRODUTO = (n: number) => uuid(20_000_000, n);
const TABELA = uuid(30_000_000, 1);
const DEPOSITO = uuid(30_000_000, 2);
const CLIENTE = uuid(30_000_000, 3);
const MARCA = uuid(30_000_000, 4);
const AGORA = '2026-11-08T12:00:00.000Z'; // hora-fixa-ok: instante injetado no contexto, não o relógio
const USUARIO = uuid(30_000_000, 9);

const PECAS = ['Pastilha de freio', 'Disco de freio', 'Filtro de oleo', 'Filtro de ar', 'Amortecedor dianteiro', 'Correia dentada', 'Vela de ignicao', 'Bateria 60 Ah', 'Lampada farol', 'Bomba de combustivel'];
const MARCAS = ['Cobreq', 'Fremax', 'Tecfil', 'Bosch', 'NGK', 'Moura', 'Cofap', 'Gates'];
const CONSULTAS = ['pastilha de freio', 'pastilha freio cobreq', 'filtro oleo tecfil', 'amortecedor dianteiro', 'pastlha de freio', 'SKU-0012345', 'CB-3100-X', 'correia dentada gates 1500', 'bateria moura', 'xyz inexistente'];

describe.skipIf(semBanco())('Catálogo × Postgres: busca com 20 mil produtos (T-0119, D-T0107b)', () => {
  let pool: pg.Pool;
  const cadastro = new Map<string, { id: string; sku: string; nome: string; unidade: string; ativo: boolean; external_id: null }>();

  async function limpar() {
    await comTenant(pool, A.tenantId, async (c) => {
      const ids = `select ('0ca00000-0000-4000-8000-' || lpad((20000000 + g)::text, 12, '0'))::uuid from generate_series(1, ${TOTAL}) g`;
      await c.query(`delete from catalogo.produto_referencia where produto_id in (${ids})`);
      await c.query(`delete from catalogo.produto_conteudo where produto_id in (${ids})`);
      await c.query(`delete from catalogo.produto_atributo where produto_id in (${ids})`);
      await c.query('delete from catalogo.estoque_saldo where deposito_id = $1', [DEPOSITO]);
      await c.query('delete from catalogo.tabela_preco_item where tabela_preco_id = $1', [TABELA]);
      await c.query('delete from catalogo.cliente_tabela_preco where tabela_preco_id = $1', [TABELA]);
      await c.query('delete from catalogo.deposito where id = $1', [DEPOSITO]);
      await c.query('delete from catalogo.tabela_preco where id = $1', [TABELA]);
      // 0045: o papel do app não tem delete em marca_concorrente (apagar = deleted_at).
      await c.query('update catalogo.marca_concorrente set deleted_at = now() where id = $1', [MARCA]);
    });
  }

  /** Repositório do tenant A sobre a conexão da transação; o Core é simulado pelo contrato `core.cadastro_resumo@1`. */
  async function noTenant<T>(fn: (repo: RepositorioCatalogo, db: pg.ClientBase, consultasAoBanco: string[]) => Promise<T>): Promise<T> {
    const ctx = { usuario: { id: USUARIO, tenant_id: A.tenantId, perfil: 'vendedor' }, agora: () => new Date(AGORA) } as unknown as ContextoBase;
    return comTenant(pool, A.tenantId, async (c) => {
      const filiais = consultarFiliaisDeTeste(c);
      const tx = {
        // core.cadastro_resumo@1 e core.filiais@1 (T-0149) simuladas; o Catálogo nunca lê tabela do Core
        consultar: async (def: { nome: string }, e: { produto_ids: string[] }) =>
          def.nome === 'core.filiais@1' ? filiais(def, e as never) : { clientes: [], usuarios: [], produtos: e.produto_ids.map((id) => cadastro.get(id)!).filter(Boolean) },
      } as unknown as TransacaoTenant;
      const sqls: string[] = [];
      const espiao = new Proxy(c, {
        get(alvo, prop) {
          if (prop === 'query') {
            return (texto: unknown, ...resto: unknown[]) => {
              sqls.push(typeof texto === 'string' ? texto : '');
              return (alvo.query as (...a: unknown[]) => unknown)(texto, ...resto);
            };
          }
          const v = (alvo as unknown as Record<string | symbol, unknown>)[prop];
          return typeof v === 'function' ? v.bind(alvo) : v;
        },
      }) as unknown as ClienteBanco;
      return fn(criarRepositorioPostgres({ marcas: SEM_MARCAS })(ctx, espiao, tx), c, sqls);
    });
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    esquecerRetratoCatalogo();
    await limpar();
    for (let n = 1; n <= TOTAL; n++) {
      cadastro.set(PRODUTO(n), {
        id: PRODUTO(n),
        sku: `SKU-${String(n).padStart(7, '0')}`,
        nome: `${PECAS[n % PECAS.length]} ${MARCAS[(n >> 3) % MARCAS.length]} ${100 + (n % 900)}`,
        unidade: 'UN',
        ativo: n % 100 !== 0,
        external_id: null,
      });
    }
    await comTenant(pool, A.tenantId, async (c) => {
      const t = A.tenantId;
      const idDe = (expr: string, base: number) => `('0ca00000-0000-4000-8000-' || lpad((${base} + ${expr})::text, 12, '0'))::uuid`;
      await c.query("insert into catalogo.tabela_preco (id, tenant_id, codigo, nome) values ($1, $2, 'T119-TAB', 'T119')", [TABELA, t]);
      await c.query("insert into catalogo.deposito (id, tenant_id, codigo, nome) values ($1, $2, 'T119-DEP', 'CD T119')", [DEPOSITO, t]);
      await c.query('insert into catalogo.cliente_tabela_preco (id, tenant_id, cliente_id, tabela_preco_id) values ($1, $2, $3, $4)', [uuid(30_000_000, 5), t, CLIENTE, TABELA]);
      await c.query("insert into catalogo.marca_concorrente (id, tenant_id, nome) values ($1, $2, 'T119 Concorrente') on conflict (id) do update set deleted_at = null", [MARCA, t]);
      await c.query(
        `insert into catalogo.tabela_preco_item (id, tenant_id, tabela_preco_id, produto_id, preco_cents)
         select gen_random_uuid(), $1, $2, ${idDe('g', 20_000_000)}, 1000 + (g % 90) * 100 from generate_series(1, ${TOTAL}) g`,
        [t, TABELA],
      );
      await c.query(
        `insert into catalogo.estoque_saldo (id, tenant_id, deposito_id, produto_id, quantidade, atualizado_erp_em)
         select gen_random_uuid(), $1, $2, ${idDe('g', 20_000_000)}, g % 40, now() from generate_series(1, ${TOTAL}) g`,
        [t, DEPOSITO],
      );
      await c.query(
        `insert into catalogo.produto_atributo (id, tenant_id, produto_id, nome, valor)
         select gen_random_uuid(), $1, ${idDe('g', 20_000_000)}, 'Posição', case when g % 2 = 0 then 'dianteiro' else 'traseiro' end from generate_series(1, ${TOTAL}, 2) g`,
        [t],
      );
      await c.query(
        `insert into catalogo.produto_conteudo (id, tenant_id, produto_id, aplicacoes)
         select gen_random_uuid(), $1, ${idDe('g', 20_000_000)}, 'Fiat Uno 2010-2014; VW Gol 2008-2016' from generate_series(1, ${TOTAL}, 2) g`,
        [t],
      );
      await c.query(
        `insert into catalogo.produto_referencia (id, tenant_id, produto_id, marca_id, codigo, codigo_compacto, ordem)
         select gen_random_uuid(), $1, ${idDe('g', 20_000_000)}, $2, 'CB-' || (3000 + g % 500) || '-X', 'cb' || (3000 + g % 500) || 'x', 1 from generate_series(1, ${TOTAL}, 5) g`,
        [t, MARCA],
      );
    });
  }, 300_000);

  afterAll(async () => {
    esquecerRetratoCatalogo();
    await limpar();
    await pool?.end();
  });

  it('T-0119: o preço e o estoque dos candidatos são lidos por índice (EXPLAIN sem Seq Scan nas tabelas de 20 mil linhas)', async () => {
    await noTenant(async (repo, db, sqls) => {
      const ids = Array.from({ length: 300 }, (_, i) => PRODUTO(1 + i * 50));
      sqls.length = 0;
      await repo.precos(CLIENTE, ids);
      await repo.saldos(ids);
      const consultas = sqls.filter((s) => /catalogo\.(tabela_preco_item|estoque_saldo)/.test(s) && !/cliente_tabela_preco/.test(s) && !/select exists/.test(s));
      expect(consultas.length).toBeGreaterThanOrEqual(2);
      // parâmetros de cada consulta, na ordem em que o repositório as executa
      // RN-CORE-39: o preço é filtrado pela filial do preço ($3); a do item da tabela de teste
      const filial = (await db.query<{ filial_id: string }>('select filial_id from catalogo.tabela_preco_item where tabela_preco_id = $1 limit 1', [TABELA])).rows[0]!.filial_id;
      const params = [[TABELA, ids, filial], [ids]];
      for (const [i, sql] of consultas.entries()) {
        const plano = await db.query<{ 'QUERY PLAN': unknown }>(`explain (format json) ${sql}`, params[i]);
        const texto = JSON.stringify(plano.rows[0]!['QUERY PLAN']);
        expect(texto, `plano de: ${sql.replace(/\s+/g, ' ').slice(0, 80)}`).not.toContain('"Node Type":"Seq Scan"');
      }
    });
  });

  it('T-0119: o retrato do catálogo sai do banco uma vez; o segundo pedido não faz nenhuma consulta de produto', async () => {
    esquecerRetratoCatalogo();
    const primeira = await noTenant(async (repo, _c, sqls) => ({ lista: await repo.produtosEmCache!(), consultas: sqls.length }));
    expect(primeira.lista).toHaveLength(TOTAL);
    expect(primeira.consultas).toBeGreaterThan(0);
    const segunda = await noTenant(async (repo, _c, sqls) => {
      const t0 = performance.now();
      const lista = await repo.produtosEmCache!();
      return { lista, consultas: sqls.length, ms: performance.now() - t0 };
    });
    expect(segunda.consultas).toBe(0);
    expect(segunda.lista).toBe(primeira.lista);
    expect(segunda.ms).toBeLessThan(50);
  });

  it('T-0119: a gravação do Catálogo descarta o retrato (a busca seguinte relê)', async () => {
    const antes = await noTenant((repo) => repo.produtosEmCache!());
    await noTenant((repo) => repo.marcarDestaque(PRODUTO(5), true));
    const depois = await noTenant((repo) => repo.produtosEmCache!());
    expect(depois).not.toBe(antes);
    expect(depois.find((p) => p.id === PRODUTO(5))?.campanha).toBe(true);
    await noTenant((repo) => repo.marcarDestaque(PRODUTO(5), false));
  });

  // D-T0107b: o catálogo sintético tem só 10 peças × 8 marcas, então cada consulta de texto vira 2 a 7 mil candidatos (10 a 35% do catálogo).
  // Resolvido em duas frentes: (1) a varredura do vocabulário do índice deixou de montar a matriz de edição para cada termo (máscara de
  // caracteres + distância com faixa e saída antecipada); (2) teto de `TETO_CANDIDATOS` antes do ranking completo (`cortarCandidatos`), que só
  // lê o estoque dos candidatos, nunca o preço, e fica com os melhores pela nota barata + os boosts do ranking.
  // D-T0107b: p95 677 ms no CI do lote 02, teto 300→200 a medir (medida definitiva: carga semanal, workflow carga-t0107)
  it('RF-CAT-01 (T-0119): D-T0107b: p95 244 ms no CI da v1.0.4 — busca com 20 mil — mesma primeira página do ranking sobre a lista inteira e p95 < 300 ms no caminho da busca', async () => {
    esquecerRetratoCatalogo();
    const tempos: number[] = [];
    await noTenant(async (repo) => {
      const produtos = (await repo.produtosEmCache!()) as ProdutoCatalogo[];
      const vocab = vocabularioDe(produtos);
      const sinonimos = await repo.sinonimos();
      const base = { perfil: 'vendedor' as const, parametros: PARAMETROS_PADRAO, agora: AGORA };
      const buscar = async (q: string, completa: boolean) => {
        const filtros = interpretarConsulta(q, vocab);
        let cand = completa ? null : candidatosDaBusca({ produtos, contexto: base, filtros, sinonimos });
        if (cand && cand.produtos.length > TETO_CANDIDATOS) {
          // como na rota: o corte lê só o estoque de todos os candidatos; o preço fica para os que ficam
          const saldosTodos = await repo.saldos(cand.produtos.filter((p) => p.ativo).map((p) => p.id));
          cand = cortarCandidatos(cand, { ...base, clienteId: CLIENTE, tabelaClienteId: null, itensPreco: [], promocoes: [], saldos: saldosTodos, filiais: null });
        }
        const lista = cand?.produtos ?? produtos;
        const precos = await repo.precos(CLIENTE, lista.filter((p) => p.ativo).map((p) => p.id));
        const saldos = await repo.saldos(lista.filter((p) => p.ativo).map((p) => p.id));
        const contexto: ContextoVitrine = { ...base, clienteId: CLIENTE, tabelaClienteId: precos.tabelaClienteId, itensPreco: precos.itens, promocoes: [], saldos, filiais: null };
        return buscarProdutos({ produtos: lista, contexto, filtros, sinonimos, limit: 20, offset: 0, ...(cand ? { maxVendas: cand.maxVendas } : {}) });
      };
      await buscar('pastilha', false); // aquece o índice (uma vez por retrato, como em produção)
      for (const q of CONSULTAS) {
        const t0 = performance.now();
        const rapida = await buscar(q, false);
        tempos.push(performance.now() - t0);
        // a conferência com a lista inteira (lenta de propósito) só para as consultas de texto
        if (q === 'pastilha freio cobreq' || q === 'SKU-0012345' || q === 'CB-3100-X') {
          const cheia = await buscar(q, true);
          // com o corte o total para no teto; sem corte (poucos candidatos) é o mesmo do ranking completo
          expect(rapida.total, q).toBe(Math.min(cheia.total, TETO_CANDIDATOS));
          expect(rapida.items.map((x) => x.id), q).toEqual(cheia.items.map((x) => x.id));
        }
      }
    });
    tempos.sort((a, b) => a - b);
    const p95 = tempos[Math.min(tempos.length - 1, Math.ceil(tempos.length * 0.95) - 1)]!;
    console.log(`[T-0119] busca com ${TOTAL} produtos, caminho completo (ms): ${tempos.map((t) => t.toFixed(0)).join(' ')} · p95 ${p95.toFixed(0)}`);
    expect(p95).toBeLessThan(300);
  }, 600_000);
});
