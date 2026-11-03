/**
 * RN-CORE-05 — isolamento entre tenants por RLS (T-0002 critério 2; plano S0-024 a S0-027).
 * Conecta como o papel de APLICAÇÃO (macuxi_app: sem SUPERUSER/BYPASSRLS, não dono) sobre a fixture
 * dois-tenants. Tabelas descobertas dinamicamente: tabela nova com tenant_id fica coberta sozinha.
 * Pula (com aviso do globalSetup) se o Postgres não estiver de pé.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comTenant } from '../src/contexto';
import { banco, semBanco } from './estado';
import { comCliente, emTransacao, erroDe, tabelasComTenant, type TabelaInfo } from './util';
import { ORDEM_TREINAMENTO } from './fixture-treinamento';

const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const SEM_TENANT = '00000000-0000-4000-8000-000000000000';

describe.skipIf(semBanco())('RLS: vazamento entre tenants (papel de aplicação)', () => {
  let app: pg.Client;
  let tabelas: TabelaInfo[] = [];
  /** id de uma linha de B por tabela (lido como admin), para tentar acesso direto por id. */
  const idDeB = new Map<string, string>();

  beforeAll(async () => {
    tabelas = await comCliente(banco().urlAdmin, async (admin) => {
      const ts = await tabelasComTenant(admin);
      for (const t of ts) {
        const r = await admin.query<{ id: string }>(`select id from ${t.nome} where tenant_id = $1 limit 1`, [B]);
        if (r.rows[0]) idDeB.set(t.nome, r.rows[0].id);
      }
      return ts;
    });
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });

  it('a conexão de teste é o papel de aplicação, não o admin', async () => {
    const r = await app.query<{ usuario: string; super: string }>("select current_user as usuario, current_setting('is_superuser') as super");
    expect(r.rows[0]).toEqual({ usuario: 'macuxi_app', super: 'off' });
  });

  it('descobre as tabelas com tenant_id de plataforma e core (e a fixture tem linha de B em todas)', () => {
    const nomes = tabelas.map((t) => t.nome);
    expect(nomes).toEqual(expect.arrayContaining(['plataforma.tenant_modulo', 'plataforma.evento', 'plataforma.auditoria', 'core.usuario', 'core.produto', 'core.carteira']));
    // Sprint 1 (0005–0007): toda tabela nova entra no teste de vazamento (com linha de A e de B na fixture)
    expect(nomes).toEqual(
      expect.arrayContaining([
        'plataforma.arquivo', 'core.cliente_contato', 'core.cliente_financeiro', 'core.titulo', 'core.historico_compra', 'core.motivo', 'core.rota',
        'core.rota_parada', 'core.visita', 'core.visita_etapa', 'core.notificacao', 'core.meta', 'core.indicador_diario', 'vendedor.pedido', 'vendedor.pedido_item',
      ]),
    );
    // T-0029 (0008–0009): preço do Catálogo e pedido completo do Vendedor
    expect(nomes).toEqual(
      expect.arrayContaining([
        'catalogo.tabela_preco', 'catalogo.tabela_preco_item', 'catalogo.cliente_tabela_preco',
        'vendedor.pedido_evento', 'vendedor.condicao_pagamento', 'vendedor.cliente_condicao', 'vendedor.numeracao_pedido',
      ]),
    );
    // T-0032 (0010): schema integracao inteiro (chaves, lotes, espelho, fila do ERP, auditoria das decisões)
    expect(nomes).toEqual(
      expect.arrayContaining([
        'integracao.conector', 'integracao.credencial', 'integracao.politica_versao', 'integracao.sessao_carga', 'integracao.sessao_carga_recebido',
        'integracao.lote', 'integracao.lote_staging', 'integracao.lote_linha_erro', 'integracao.registro_atual', 'integracao.pendencia_inativacao',
        'integracao.inativacao_auditoria', 'integracao.cursor_entidade', 'integracao.reconciliacao', 'integracao.mapeamento',
        'integracao.pedido_fila_erp', 'integracao.pedido_retorno', 'integracao.pedido_retorno_erro',
      ]),
    );
    // T-0055 (0014): schema gestor inteiro
    expect(nomes).toEqual(expect.arrayContaining(['gestor.evento_aplicado', 'gestor.projecao_fato', 'gestor.alerta', 'gestor.alerta_regra']));
    // T-0056 (0015): schema promotor inteiro (cadastros de trade e coletas da visita de loja)
    expect(nomes).toEqual(
      expect.arrayContaining([
        'promotor.categoria_gondola', 'promotor.checklist_loja', 'promotor.mix_obrigatorio', 'promotor.meta_share', 'promotor.concorrente',
        'promotor.produto_concorrente', 'promotor.foto_referencia', 'promotor.tarefa_trade', 'promotor.ponto_extra_negociado',
        'promotor.visita_loja', 'promotor.foto_coleta', 'promotor.checklist_resposta', 'promotor.gondola_registro', 'promotor.medicao_share',
        'promotor.coleta_preco', 'promotor.ruptura_item', 'promotor.validade_item', 'promotor.ponto_extra', 'promotor.acao_concorrencia',
        'promotor.tarefa_execucao',
      ]),
    );
    // T-0058 (0017): schema treinamento inteiro (fixture própria: testes/fixture-treinamento.ts, carregada no globalSetup)
    expect(nomes).toEqual(expect.arrayContaining([...ORDEM_TREINAMENTO]));
    // T-0063 (0018): medidas do tenant (lista inicial semeada pelo gatilho em A e B)
    expect(nomes).toEqual(expect.arrayContaining(['core.medida']));
    expect(nomes.filter((n) => !idDeB.has(n))).toEqual([]);
  });

  describe('S0-024 leitura: cada tenant só enxerga as próprias linhas', () => {
    it.each([
      ['A', A],
      ['B', B],
    ])('contexto %s', async (_rotulo, tenant) => {
      for (const t of tabelas) {
        const r = await emTransacao(app, tenant, () =>
          app.query<{ total: number; alheias: number }>(
            `select count(*)::int as total, count(*) filter (where tenant_id <> $1)::int as alheias from ${t.nome}`,
            [tenant],
          ),
        );
        expect(r.rows[0]!.total, `${t.nome}: fixture deveria ter linhas do tenant`).toBeGreaterThan(0);
        expect(r.rows[0]!.alheias, `${t.nome}: vazou linha de outro tenant`).toBe(0);
      }
    });

    it('no contexto de A, filtro explícito por tenant_id = B e acesso por id de B retornam 0', async () => {
      for (const t of tabelas) {
        const porTenant = await emTransacao(app, A, () => app.query<{ n: number }>(`select count(*)::int as n from ${t.nome} where tenant_id = $1`, [B]));
        expect(porTenant.rows[0]!.n, t.nome).toBe(0);
        const porId = await emTransacao(app, A, () => app.query<{ n: number }>(`select count(*)::int as n from ${t.nome} where id = $1`, [idDeB.get(t.nome)]));
        expect(porId.rows[0]!.n, t.nome).toBe(0);
      }
    });

    it('plataforma.tenant (exceção sem tenant_id): A vê só o próprio registro', async () => {
      const r = await emTransacao(app, A, () => app.query<{ id: string }>('select id from plataforma.tenant'));
      expect(r.rows.map((x) => x.id)).toEqual([A]);
    });
  });

  describe('S0-026 falha fechada: sem contexto válido, nenhuma linha', () => {
    it.each([
      ['sem set_config', null],
      ['contexto vazio', ''],
      ['tenant inexistente', SEM_TENANT],
    ])('%s => 0 linhas em toda tabela', async (_rotulo, ctx) => {
      for (const t of [...tabelas, { nome: 'plataforma.tenant' } as TabelaInfo]) {
        const r = await emTransacao(app, ctx, () => app.query<{ n: number }>(`select count(*)::int as n from ${t.nome}`));
        expect(r.rows[0]!.n, `${t.nome} (${String(ctx)})`).toBe(0);
      }
    });

    it('contexto que não é UUID => erro (nunca "todas as linhas")', async () => {
      const e = await erroDe(emTransacao(app, 'nao-e-uuid', () => app.query('select count(*) from core.usuario')));
      expect(e?.code).toBe('22P02');
    });

    it('fora de transação (conexão "crua"), nenhuma linha', async () => {
      const r = await app.query<{ n: number }>('select count(*)::int as n from core.usuario');
      expect(r.rows[0]!.n).toBe(0);
    });
  });

  describe('S0-025 escrita cruzada', () => {
    it('INSERT com tenant_id de B no contexto de A é rejeitado pela política (WITH CHECK)', async () => {
      for (const t of tabelas) {
        const e = await erroDe(
          emTransacao(app, A, () =>
            app.query(
              `insert into ${t.nome}
               select (jsonb_populate_record(null::${t.nome}, to_jsonb(r) || jsonb_build_object('id', gen_random_uuid(), 'tenant_id', $2::uuid))).*
                 from ${t.nome} r where r.tenant_id = $1 limit 1`,
              [A, B],
            ),
          ),
        );
        expect(e?.code, `${t.nome}: ${e?.message ?? 'INSERT passou!'}`).toBe('42501');
        expect(e?.message, t.nome).toMatch(/row-level security/);
      }
    });

    it('UPDATE e DELETE em linhas de B no contexto de A afetam 0 linhas (ou são negados)', async () => {
      for (const t of tabelas) {
        for (const sql of [`update ${t.nome} set updated_at = updated_at where tenant_id = $1`, `delete from ${t.nome} where tenant_id = $1`]) {
          const r = await emTransacao(app, A, () => app.query(sql, [B]).then((x) => ({ linhas: x.rowCount, erro: null }), (err: { code?: string }) => ({ linhas: 0, erro: err.code ?? '?' })));
          // auditorias (plataforma e integracao) e trilhas sem UPDATE/DELETE para a aplicação: "permission denied" (42501) também é isolamento
          expect(r.erro === null || r.erro === '42501', `${t.nome}: erro inesperado ${r.erro}`).toBe(true);
          expect(r.linhas, `${t.nome}: ${sql}`).toBe(0);
        }
      }
    });

    it('UPDATE que troca tenant_id de A para B é rejeitado', async () => {
      for (const t of tabelas) {
        const e = await erroDe(
          emTransacao(app, A, () => app.query(`update ${t.nome} set tenant_id = $2 where id = (select id from ${t.nome} where tenant_id = $1 limit 1)`, [A, B])),
        );
        expect(e?.code, `${t.nome}: ${e?.message ?? 'UPDATE passou!'}`).toBe('42501');
      }
    });

    it('FK composta impede referenciar linha de outro tenant (carteira A -> cliente B)', async () => {
      const e = await erroDe(
        emTransacao(app, A, () =>
          app.query('insert into core.carteira (tenant_id, cliente_id, usuario_id, papel) values ($1, $2, $3, $4)', [
            A,
            DOIS_TENANTS.B.clientes.c1,
            DOIS_TENANTS.A.usuarios.vendedor1,
            'vendedor',
          ]),
        ),
      );
      expect(e?.code).toBe('23503');
    });

    it('escrita no próprio tenant funciona (controle positivo)', async () => {
      const r = await emTransacao(app, A, () =>
        app.query('insert into core.produto (tenant_id, sku, nome) values ($1, $2, $3) returning tenant_id', [A, 'CONTROLE-1', 'Controle']),
      );
      expect(r.rows[0]).toEqual({ tenant_id: A });
    });

    it('login: plataforma.tenant_por_codigo resolve o tenant sem contexto, só pelo código', async () => {
      const r = await app.query<{ id: string }>('select id from plataforma.tenant_por_codigo($1)', ['ALFA']);
      expect(r.rows.map((x) => x.id)).toEqual([A]);
      const nada = await app.query('select id from plataforma.tenant_por_codigo($1)', ['nao-existe']);
      expect(nada.rowCount).toBe(0);
    });
  });

  describe('S0-027 pool: o contexto é por transação e não vaza para a próxima', () => {
    it('pool de 1 conexão alternando A, B, A e depois sem contexto', async () => {
      const pool = new pg.Pool({ connectionString: banco().urlApp, max: 1 });
      try {
        const usuarios = (t: string) => comTenant(pool, t, async (c) => (await c.query<{ tenant_id: string }>('select distinct tenant_id from core.usuario')).rows.map((x) => x.tenant_id));
        expect(await usuarios(A)).toEqual([A]);
        expect(await usuarios(B)).toEqual([B]);
        expect(await usuarios(A)).toEqual([A]);
        const solto = await pool.query<{ ctx: string | null; n: number }>(
          "select current_setting('app.tenant_id', true) as ctx, (select count(*)::int from core.usuario) as n",
        );
        expect(solto.rows[0]!.n).toBe(0);
        expect(solto.rows[0]!.ctx ?? '').toBe('');
      } finally {
        await pool.end();
      }
    });
  });
});
