/**
 * v1.0.39 — Pedido mínimo (RN-VEN-22), Crédito excedido (RN-VEN-12, P-6) e Estoque insuficiente (RN-VEN-20) × Postgres real
 * (fixture dois-tenants, papel macuxi_app, RLS): o `receber` do push aplica a ação do tenant (parâmetros do contexto) e recusa ou abre
 * aprovação. As consultas entre módulos são simuladas AQUI, como em `pedido.db.test.ts`. Pula sem Postgres; com MACUXI_PG_EXIGIR=1 falha.
 */
import { CONSULTA_PRECOS_CLIENTE } from '@macuxi/catalogo/contracts';
import { CONSULTA_CADASTRO_RESUMO, CONSULTA_FILIAIS, CONSULTA_PROMOTOR_VE_PEDIDOS } from '@macuxi/core/contracts';
import { CONSULTA_CANCELAMENTO_ERP } from '@macuxi/integracao/contracts';
import { comTenant, dadosDoisTenants, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import {
  type ClienteBanco,
  type ContextoBase,
  type DefinicaoEvento,
  type ItemPush,
  type ResultadoItemPush,
  type UsuarioAutenticado,
} from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entidadePedido } from '../contracts/entidades';
import { responderFiliais } from './filial-simulada';
import { preVendaSql, usarPreVenda } from './pre-venda';
import { provedoresSyncVendedor } from './sync';

const A = DOIS_TENANTS.A;
/** Relógio único do arquivo (T-0042): lido do banco no beforeAll, o mesmo que grava created_at/updated_at. */
let AGORA!: Date;
const id = (n: number) => `0f2a0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** Cadastro do Core da fixture, em memória (a consulta real é do Core): o teste não faz SQL em schema de outro módulo. */
const CADASTRO = (() => {
  const d = dadosDoisTenants('hash-de-teste');
  return { cliente: d['core.cliente']!, produto: d['core.produto']!, usuario: d['core.usuario']! };
})();
/** Financeiro do cliente que a consulta simulada devolve (T-0184); os testes de aprovação por motivo trocam e voltam ao folgado. */
const FINANCEIRO_FOLGADO = { limite_cents: 100_000_000, saldo_aberto_cents: 0, credito_disponivel_erp_cents: null as number | null, bloqueado: false, motivo_bloqueio: null, vencidos_qtd: 0, vencidos_cents: 0, maior_atraso_dias: 0, atualizado_erp_em: null };
let financeiroDoTeste: typeof FINANCEIRO_FOLGADO | null = FINANCEIRO_FOLGADO;
const IDS = Array.from({ length: 40 }, (_, i) => id(i + 1));
/** Saldo do Catálogo simulado por produto na filial (RN-VEN-20); vazio = estoque não controlado. */
let saldoDoTeste: Array<{ produto_id: string; quantidade_base: number }> = [];

const vendedor1: UsuarioAutenticado = { id: A.usuarios.vendedor1, tenant_id: A.tenantId, perfil: 'vendedor' };

interface Registro {
  eventos: Array<{ nome: string; payload: Record<string, unknown> }>;
  auditoria: Array<{ acao: string; entidade_id: string | null; antes: unknown; depois: unknown }>;
}

describe.skipIf(semBanco())('Vendedor × Postgres: pedido mínimo, crédito excedido e estoque insuficiente (v1.0.39)', () => {
  let pool: pg.Pool;
  const opcaoPromotor = true;
  let prod1 = '';
  let prod2 = '';
  /** preço por cliente (a consulta do Catálogo é simulada); c3 sem tabela */
  const PRECOS = (): Record<string, Record<string, number>> => ({
    [A.clientes.c1]: { [prod1]: 100_000, [prod2]: 50_000 },
    [A.clientes.c2]: { [prod1]: 90_000, [prod2]: 45_000 },
    [A.clientes.c3]: {},
  });

  function contexto(u: UsuarioAutenticado, o: { visiveis?: ReadonlySet<string> | 'tenant'; carteira?: ReadonlySet<string> | 'tenant'; parametros?: Record<string, unknown>; registro?: Registro; fuso?: string } = {}) {
    const registro: Registro = o.registro ?? { eventos: [], auditoria: [] };
    const visiveis = o.visiveis ?? new Set([u.id]);
    const base = {
      usuario: { ...u, modulos: ['core', 'catalogo', 'vendedor'] },
      requestId: 'r-teste',
      agora: () => AGORA,
      fuso: () => o.fuso ?? 'America/Manaus',
      carteira: async () => o.carteira ?? 'tenant',
      usuariosVisiveis: async () => visiveis,
      parametros: () => o.parametros ?? {},
      log: { info() {}, warn() {}, error() {} },
      comTenant: <T>(fn: (db: ClienteBanco, tx: unknown) => Promise<T>) =>
        comTenant(pool, u.tenant_id, (c) => {
          const tx = {
            async consultar(def: { nome: string }, entrada: Record<string, unknown>) {
              if (def.nome === CONSULTA_FILIAIS.nome) return responderFiliais(entrada);
              if (def.nome === CONSULTA_CADASTRO_RESUMO.nome) {
                const ent = CONSULTA_CADASTRO_RESUMO.entrada.parse(entrada);
                const pegar = (tabela: 'cliente' | 'produto' | 'usuario', ids: string[], campos: string[]) =>
                  CADASTRO[tabela]
                    .filter((l) => ids.includes(l.id as string))
                    .map((l) => Object.fromEntries(campos.map((k) => [k, l[k] ?? null])));
                return CONSULTA_CADASTRO_RESUMO.saida.parse({
                  clientes: pegar('cliente', ent.cliente_ids, ['id', 'razao_social', 'nome_fantasia', 'documento', 'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'ativo', 'external_id']),
                  produtos: pegar('produto', ent.produto_ids, ['id', 'sku', 'nome', 'unidade', 'ativo', 'external_id']),
                  usuarios: pegar('usuario', ent.usuario_ids, ['id', 'nome', 'perfil', 'external_id']),
                });
              }
              if (def.nome === CONSULTA_PRECOS_CLIENTE.nome) {
                const ent = CONSULTA_PRECOS_CLIENTE.entrada.parse(entrada);
                const tabela = PRECOS()[ent.cliente_id];
                return {
                  tabela_preco_id: tabela && Object.keys(tabela).length > 0 ? id(59) : null,
                  itens: ent.produto_ids.map((p) => ({ produto_id: p, preco_cents: tabela?.[p] ?? null, motivo_sem_preco: tabela?.[p] ? null : 'Sem preço para este cliente.' })),
                };
              }
              if (def.nome === CONSULTA_CANCELAMENTO_ERP.nome) return { aceita: false }; // sem conector que aceite cancelar: mantém o 422 da RN-VEN-31
              if (def.nome === CONSULTA_PROMOTOR_VE_PEDIDOS.nome) return { ligado: opcaoPromotor }; // Core simulado, lido a cada requisição
              if (def.nome === 'catalogo.estoque_filial@1') return { itens: saldoDoTeste };
              if (def.nome === 'core.financeiro_cliente@1') return { financeiro: financeiroDoTeste }; // RN-VEN-12 e RN-VEN-13 (T-0184)
              throw new Error(`consulta não simulada: ${def.nome}`);
            },
            async publicar(def: DefinicaoEvento, payload: unknown) {
              const v = def.schema.parse(payload) as Record<string, unknown>; // o contrato do evento vale aqui
              registro.eventos.push({ nome: def.nome, payload: v });
              return {};
            },
            async auditar(r: { acao: string; entidade_id: string | null; antes?: unknown; depois?: unknown }) {
              registro.auditoria.push({ acao: r.acao, entidade_id: r.entidade_id, antes: r.antes, depois: r.depois });
            },
            async registrarArquivo() {
              throw new Error('não usado');
            },
          };
          return fn(c as unknown as ClienteBanco, tx);
        }),
    };
    return { ctx: base as unknown as ContextoBase, registro };
  }

  const push = (idPedido: string, payload: Record<string, unknown>): ItemPush =>
    ({ entidade: 'pedido', id: idPedido, operacao: 'upsert', payload: entidadePedido.schema.parse({ id: idPedido, ...payload }) }) as unknown as ItemPush;
  const receber = (c: ContextoBase, ...itens: ItemPush[]): Promise<ResultadoItemPush[]> => provedoresSyncVendedor[0]!.receber!(c, itens);

  const itens = (p1 = 2, p2 = 1) => [
    { product_id: prod1, quantity: p1 },
    { product_id: prod2, quantity: p2 },
  ];
  async function lerPedido(pedidoId: string, tenant = A.tenantId) {
    return comTenant(pool, tenant, async (c) => {
      const p = (await c.query('select * from vendedor.pedido where id = $1', [pedidoId])).rows[0];
      const it = (await c.query('select * from vendedor.pedido_item where pedido_id = $1 order by sequencia', [pedidoId])).rows;
      const ev = (await c.query('select * from vendedor.pedido_evento where pedido_id = $1 order by ocorrido_em, created_at, (de is not null)', [pedidoId])).rows;
      return { p, it, ev };
    });
  }

  /** O papel da aplicação não apaga histórico (pedido_evento é só INSERT): a limpeza do teste usa o papel administrador. */
  async function limpar() {
    const admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
    try {
      // T-0054: o retorno do ERP grava pedido_faturamento (0013, FK para o pedido)
      await admin.query('delete from vendedor.pedido_faturamento where pedido_id = any($1::uuid[])', [IDS]);
      await admin.query('delete from vendedor.pedido_aprovacao where pedido_id = any($1::uuid[])', [IDS]);
      await admin.query('delete from vendedor.pedido_evento where pedido_id = any($1::uuid[])', [IDS]);
      await admin.query('delete from vendedor.pedido_item where pedido_id = any($1::uuid[])', [IDS]);
      await admin.query('delete from vendedor.pedido where id = any($1::uuid[])', [IDS]);
    } finally {
      await admin.end();
    }
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 6 });
    AGORA = new Date((await pool.query<{ agora: Date }>('select now() as agora')).rows[0]!.agora); // hora-fixa-ok: é a linha do tempo única do arquivo
    await limpar();
    prod1 = CADASTRO.produto.find((x) => x.sku === 'ALFA-001' && x.tenant_id === A.tenantId)!.id as string;
    prod2 = CADASTRO.produto.find((x) => x.sku === 'ALFA-002' && x.tenant_id === A.tenantId)!.id as string;
  });
  afterAll(async () => {
    await limpar();
    await pool?.end();
  });

  // ---------- as três ações ----------
  /** Envia um pedido do vendedor 1 ao cliente c1 (itens 2×100.000 + 1×50.000 = R$ 2.500,00 de tabela) com os parâmetros do tenant. */
  async function enviar(n: number, parametros: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    const { ctx, registro } = contexto(vendedor1, { carteira: new Set([A.clientes.c1]), parametros });
    const [r] = await receber(ctx, push(id(n), { customer_id: A.clientes.c1, discount_pct: 0, items: itens(), ...extra }));
    return { r: r!, registro };
  }
  async function aprovacoesDe(pedidoId: string) {
    return comTenant(pool, A.tenantId, async (c) => (await c.query('select motivo, nivel, estado from vendedor.pedido_aprovacao where pedido_id = $1 order by motivo', [pedidoId])).rows);
  }
  const comFinanceiro = async <T,>(f: typeof FINANCEIRO_FOLGADO | null, fn: () => Promise<T>): Promise<T> => {
    financeiroDoTeste = f;
    try {
      return await fn();
    } finally {
      financeiroDoTeste = FINANCEIRO_FOLGADO;
      saldoDoTeste = [];
    }
  };
  const semCredito = { ...FINANCEIRO_FOLGADO, limite_cents: 1_000_000, credito_disponivel_erp_cents: 0 };

  describe('RN-VEN-22: pedido mínimo', () => {
    it('RN-VEN-22: sem linha gravada vale o padrão (sem mínimo) e o pedido segue', async () => {
      const { r } = await enviar(1, {});
      expect(r).toMatchObject({ status: 'aceito' });
      expect((await lerPedido(id(1))).p.status).toBe('approved');
    });
    it('RN-VEN-22: um centavo abaixo do mínimo é recusado (rejeitado, nada gravado); no mínimo passa', async () => {
      const { r } = await enviar(2, { pedido_minimo_cents: 250_001 });
      expect(r).toMatchObject({ status: 'rejeitado', codigo: 'RN-VEN-22', mensagem: expect.stringMatching(/^Pedido abaixo do mínimo de R\$\s2\.500,01\. Envie como orçamento/) });
      expect((await lerPedido(id(2))).p).toBeUndefined();
      expect((await enviar(3, { pedido_minimo_cents: 250_000 })).r).toMatchObject({ status: 'aceito' });
    });
    it('RN-VEN-22 (PA-4): a base é o total final com o desconto do pedido: 10% sobre R$ 2.500,00 fica abaixo do mínimo de R$ 2.500,00', async () => {
      const { r } = await enviar(4, { pedido_minimo_cents: 250_000 }, { discount_pct: 10 });
      expect(r).toMatchObject({ status: 'rejeitado', codigo: 'RN-VEN-22' });
    });
    it('RN-VEN-33: o reenvio do pedido recusado é recusado de novo, sem gravar; o aceito reenviado é idempotente', async () => {
      expect((await enviar(5, { pedido_minimo_cents: 999_999 })).r).toMatchObject({ status: 'rejeitado', codigo: 'RN-VEN-22' });
      expect((await enviar(5, { pedido_minimo_cents: 999_999 })).r).toMatchObject({ status: 'rejeitado', codigo: 'RN-VEN-22' });
      expect((await lerPedido(id(5))).p).toBeUndefined();
      await enviar(6, { pedido_minimo_cents: 100 });
      expect((await enviar(6, { pedido_minimo_cents: 100 })).r).toMatchObject({ status: 'aceito' });
      expect((await comTenant(pool, A.tenantId, async (c) => (await c.query('select count(*)::int as n from vendedor.pedido where id = $1', [id(6)])).rows[0])).n).toBe(1);
    });
    it('RN-VEN-22 (PA-3): o orçamento nunca é barrado pelo mínimo', async () => {
      const restaurar = usarPreVenda(preVendaSql);
      try {
        expect((await enviar(7, { pedido_minimo_cents: 10_000_000 }, { tipo: 'orcamento' })).r).toMatchObject({ status: 'aceito' });
        expect((await lerPedido(id(7))).p.status).toBe('received');
      } finally {
        restaurar();
      }
    });
  });

  describe('RN-VEN-12: crédito excedido (P-6)', () => {
    it('RN-VEN-12: padrão (aprovacao): a prazo acima do crédito vai para aprovação com o motivo crédito', async () => {
      await comFinanceiro(semCredito, () => enviar(10, {}));
      expect((await lerPedido(id(10))).p.status).toBe('pending_approval');
      expect((await aprovacoesDe(id(10))).map((a) => a.motivo)).toEqual(['credito']);
    });
    it('RN-VEN-12: orcamento recusa o pedido (rejeitado, nada gravado, nenhuma aprovação)', async () => {
      const { r } = await comFinanceiro(semCredito, () => enviar(11, { credito_excedido_acao: 'orcamento' }));
      expect(r).toMatchObject({ status: 'rejeitado', codigo: 'RN-VEN-12' });
      expect((await lerPedido(id(11))).p).toBeUndefined();
      expect(await aprovacoesDe(id(11))).toEqual([]);
    });
    it('RN-VEN-12: avisar segue sem aprovação', async () => {
      const { r } = await comFinanceiro(semCredito, () => enviar(12, { credito_excedido_acao: 'avisar' }));
      expect(r).toMatchObject({ status: 'aceito' });
      expect((await lerPedido(id(12))).p).toMatchObject({ status: 'approved', motivos_aprovacao: [] });
      expect(await aprovacoesDe(id(12))).toEqual([]);
    });
    it('RN-VEN-12: dentro do crédito a ação não muda nada; o título vencido segue para aprovação mesmo com avisar', async () => {
      const folgado = { ...FINANCEIRO_FOLGADO, credito_disponivel_erp_cents: 100_000_000 };
      await comFinanceiro(folgado, () => enviar(13, { credito_excedido_acao: 'orcamento' }));
      expect((await lerPedido(id(13))).p.status).toBe('approved');
      await comFinanceiro({ ...semCredito, maior_atraso_dias: 12, vencidos_qtd: 1, vencidos_cents: 8_000 }, () => enviar(14, { credito_excedido_acao: 'avisar' }));
      expect((await aprovacoesDe(id(14))).map((a) => a.motivo)).toEqual(['inadimplencia']);
    });
  });

  describe('RN-VEN-20: estoque insuficiente', () => {
    const faltaEstoque = () => {
      saldoDoTeste = [{ produto_id: prod1, quantidade_base: 1 }];
    };
    it('RN-VEN-20: padrão (orcamento): item acima do estoque da filial é recusado como sempre, nada gravado', async () => {
      faltaEstoque();
      const { r } = await comFinanceiro(FINANCEIRO_FOLGADO, () => enviar(20, {}));
      expect(r).toMatchObject({ status: 'rejeitado', codigo: 'RN-VEN-20' });
      expect((await lerPedido(id(20))).p).toBeUndefined();
    });
    it('RN-VEN-20: aprovacao abre a aprovação do motivo estoque, no nível de Alçadas (padrão gerente; supervisor quando configurado)', async () => {
      faltaEstoque();
      await comFinanceiro(FINANCEIRO_FOLGADO, () => enviar(21, { estoque_insuficiente_acao: 'aprovacao' }));
      expect((await lerPedido(id(21))).p).toMatchObject({ status: 'pending_approval', nivel_aprovacao: 'gerente', motivos_aprovacao: ['estoque'] });
      expect((await aprovacoesDe(id(21))).map((a) => [a.motivo, a.nivel, a.estado])).toEqual([['estoque', 'gerente', 'pendente']]);
      faltaEstoque();
      await comFinanceiro(FINANCEIRO_FOLGADO, () => enviar(22, { estoque_insuficiente_acao: 'aprovacao', 'aprovacao.estoque_nivel': 'supervisor' }));
      expect((await aprovacoesDe(id(22))).map((a) => [a.motivo, a.nivel])).toEqual([['estoque', 'supervisor']]);
    });
    it('RN-VEN-20: avisar segue sem aprovação; com estoque suficiente a ação aprovacao não abre nada', async () => {
      faltaEstoque();
      const { r } = await comFinanceiro(FINANCEIRO_FOLGADO, () => enviar(23, { estoque_insuficiente_acao: 'avisar' }));
      expect(r).toMatchObject({ status: 'aceito' });
      expect((await lerPedido(id(23))).p.status).toBe('approved');
      saldoDoTeste = [{ produto_id: prod1, quantidade_base: 1_000_000 }];
      await comFinanceiro(FINANCEIRO_FOLGADO, () => enviar(24, { estoque_insuficiente_acao: 'aprovacao' }));
      expect((await lerPedido(id(24))).p.status).toBe('approved');
    });
    it('RN-VEN-33: o reenvio do pedido que foi para aprovação por estoque é idempotente (uma aprovação só)', async () => {
      faltaEstoque();
      await comFinanceiro(FINANCEIRO_FOLGADO, () => enviar(25, { estoque_insuficiente_acao: 'aprovacao' }));
      faltaEstoque();
      const { r } = await comFinanceiro(FINANCEIRO_FOLGADO, () => enviar(25, { estoque_insuficiente_acao: 'aprovacao' }));
      expect(r).toMatchObject({ status: 'aceito' });
      expect(await aprovacoesDe(id(25))).toHaveLength(1);
    });
  });
});
