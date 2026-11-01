/**
 * Validação da T-0017 (agente `testes`, Sprint 1) — critérios 1 e 3: escopo de carteira (RN-CORE-04), isolamento
 * entre tenants (RN-CORE-05) e licença/perfil em TODA rota nova do Core, pelo `createApp` REAL (apps/api) com JWT,
 * licenças lidas a cada requisição e o Postgres como `macuxi_app` (RLS). Desenho T-0016 §3.3 e §3.5.
 *
 * Fixture dois-tenants: vendedor-1 {c1,c3}; vendedor-2 {c2}; promotor {c1}; supervisor = equipe 1 {c1,c3};
 * gerente = regional (equipes 1 e 2 abaixo) {c1,c2,c3}; analista/assistente/admin = tenant A; B tem só c1 de B.
 * Cenários S1-001..S1-012 de tests/plano/sprint-1.md.
 */
import { Cliente360Schema, ClienteListaRespostaSchema, HierarquiaEquipeSchema } from '@macuxi/core/contracts';
import { semBanco } from '@macuxi/db/teste/estado';
import type { LinhaSync, PaginaSync } from '@macuxi/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A, B, erroDe, licenca, subirApi, type ApiDeTeste, type Tenant } from '../apoio/api';

const C = A.clientes;
const U = A.usuarios;
const TODOS_A = [C.c1, C.c2, C.c3].sort();
const TODOS_CLIENTES = [C.c1, C.c2, C.c3, B.clientes.c1];

/** Escopo esperado (RN-CORE-04) por e-mail e tenant. */
const ESCOPO: ReadonlyArray<{ email: string; tenant: Tenant; perfil: string; clientes: string[] }> = [
  { email: 'vendedor@exemplo.com.br', tenant: A, perfil: 'vendedor', clientes: [C.c1, C.c3] },
  { email: 'vendedor2@exemplo.com.br', tenant: A, perfil: 'vendedor', clientes: [C.c2] },
  { email: 'promotor@exemplo.com.br', tenant: A, perfil: 'promotor', clientes: [C.c1] },
  { email: 'supervisor@exemplo.com.br', tenant: A, perfil: 'supervisor', clientes: [C.c1, C.c3] },
  { email: 'gerente@exemplo.com.br', tenant: A, perfil: 'gerente', clientes: TODOS_A },
  { email: 'analista@exemplo.com.br', tenant: A, perfil: 'analista', clientes: TODOS_A },
  { email: 'assistente@exemplo.com.br', tenant: A, perfil: 'assistente', clientes: TODOS_A },
  { email: 'admin@exemplo.com.br', tenant: A, perfil: 'admin', clientes: TODOS_A },
  { email: 'vendedor@exemplo.com.br', tenant: B, perfil: 'vendedor', clientes: [B.clientes.c1] },
  { email: 'admin.b@exemplo.com.br', tenant: B, perfil: 'admin', clientes: [B.clientes.c1] },
].map((e) => ({ ...e, clientes: [...e.clientes].sort() }));

/** Entidades de pull da T-0017 com o conjunto de clientes de A que têm linha na janela (fixture). */
const ENTIDADES_DE_CLIENTE: ReadonlyArray<{ entidade: string; tabela: string; comDados: string[]; chave: 'id' | 'cliente_id' }> = [
  { entidade: 'cliente', tabela: 'core.cliente', comDados: [...TODOS_A, B.clientes.c1], chave: 'id' },
  { entidade: 'carteira', tabela: 'core.carteira', comDados: [...TODOS_A, B.clientes.c1], chave: 'cliente_id' },
  { entidade: 'cliente_contato', tabela: 'core.cliente_contato', comDados: [...TODOS_A, B.clientes.c1], chave: 'cliente_id' },
  { entidade: 'cliente_financeiro', tabela: 'core.cliente_financeiro', comDados: [...TODOS_A, B.clientes.c1], chave: 'cliente_id' },
  { entidade: 'titulo', tabela: 'core.titulo', comDados: [...TODOS_A, B.clientes.c1], chave: 'cliente_id' },
  // c3 de A não tem histórico (borda da fixture)
  { entidade: 'historico_compra', tabela: 'core.historico_compra', comDados: [C.c1, C.c2, B.clientes.c1], chave: 'cliente_id' },
];

const ordenar = (xs: Iterable<string>) => [...new Set(xs)].sort();

describe.skipIf(semBanco())('T-0017 critérios 1 e 3 — escopo de carteira, tenant e licença nas rotas novas (createApp real × Postgres)', () => {
  let api: ApiDeTeste;
  const tokens = new Map<string, string>();
  const chave = (email: string, tenant: Tenant) => `${tenant.codigo}:${email}`;
  const token = (email: string, tenant: Tenant = A) => tokens.get(chave(email, tenant))!;
  /** ids de cada tabela por tenant, lidos pelo admin (sem RLS) para o teste de vazamento não depender da API. */
  const idsDoTenant = new Map<string, Set<string>>();

  const pullCompleto = async (t: string, entidade: string): Promise<{ linhas: Array<LinhaSync & Record<string, unknown>>; versao: string | undefined }> => {
    const linhas: Array<LinhaSync & Record<string, unknown>> = [];
    let cursor: string | null = null;
    let versao: string | undefined;
    for (let i = 0; i < 50; i += 1) {
      const q = new URLSearchParams({ entidade, ...(cursor ? { cursor } : {}) });
      const r = await api.chamar(t, { method: 'GET', url: `/v1/sync/pull?${q}` });
      expect(r.statusCode, `${entidade}: ${r.body}`).toBe(200);
      const p = r.json() as PaginaSync<LinhaSync & Record<string, unknown>>;
      versao = p.versao_escopo;
      linhas.push(...p.itens);
      if (!p.proximo_cursor) break;
      cursor = p.proximo_cursor;
    }
    return { linhas, versao };
  };

  beforeAll(async () => {
    api = await subirApi();
    for (const e of ESCOPO) tokens.set(chave(e.email, e.tenant), (await api.sessao(e.email, e.tenant)).access_token);
    for (const tabela of [...ENTIDADES_DE_CLIENTE.map((x) => x.tabela), 'core.produto', 'core.usuario']) {
      for (const t of [A, B]) {
        const r = await api.admin.query<{ id: string }>(`select id from ${tabela} where tenant_id = $1`, [t.tenantId]);
        idsDoTenant.set(`${t.codigo}:${tabela}`, new Set(r.rows.map((l) => l.id)));
      }
    }
    // horizonte seguro do pull (updated_at < now() − 2 s): a fixture acabou de entrar
    await new Promise((r) => setTimeout(r, 2_500));
  });
  afterAll(async () => {
    await api?.fechar();
  });

  describe('S1-001..S1-004 — RN-CORE-04/05 nas rotas /v1/core', () => {
    it.each(ESCOPO)('S1-001 GET clientes: $perfil $email ($tenant.codigo) vê exatamente o próprio escopo', async (e) => {
      const r = await api.chamar(token(e.email, e.tenant), { method: 'GET', url: '/v1/core/clientes' });
      expect(r.statusCode, r.body).toBe(200);
      const lista = ClienteListaRespostaSchema.parse(r.json());
      expect(ordenar(lista.itens.map((i) => i.id))).toEqual(e.clientes);
      // filtro nunca amplia o escopo nem atravessa o tenant (busca pelo nome do cliente de B)
      const busca = await api.chamar(token(e.email, e.tenant), { method: 'GET', url: '/v1/core/clientes?q=Mec%C3%A2nica%20Beta' });
      const achados = ClienteListaRespostaSchema.parse(busca.json()).itens.map((i) => i.id);
      expect(achados).toEqual(e.tenant === B ? [B.clientes.c1] : []);
    });

    it.each(ESCOPO)('S1-002 GET clientes/:id: $perfil $email ($tenant.codigo) abre só a ficha do escopo; fora dele é 404 igual a id inexistente', async (e) => {
      const inexistente = await api.chamar(token(e.email, e.tenant), { method: 'GET', url: '/v1/core/clientes/0c000000-0000-4000-8000-00000000dead' });
      expect(inexistente.statusCode).toBe(404);
      for (const id of TODOS_CLIENTES) {
        const r = await api.chamar(token(e.email, e.tenant), { method: 'GET', url: `/v1/core/clientes/${id}` });
        if (e.clientes.includes(id)) {
          expect(r.statusCode, `${id}: ${r.body}`).toBe(200);
          const f = Cliente360Schema.parse(r.json());
          expect(f.cliente.id).toBe(id);
          // tudo o que vem na ficha é do próprio cliente
          for (const x of [...f.contatos, ...f.titulos, ...f.historico, ...(f.financeiro ? [f.financeiro] : []), ...f.ultimas_visitas]) expect(x.cliente_id).toBe(id);
        } else {
          // não revela que existe: mesmo status, código e texto do id inexistente (nem o nome do outro tenant)
          expect([r.statusCode, erroDe(r)]).toEqual([404, erroDe(inexistente)]);
          expect(r.body).not.toMatch(/Beta|Alfa|Auto Peças|Mecânica/);
        }
      }
    });

    it('S1-003 Cliente 360 de c1 (vendedor-1): contatos, financeiro, títulos na janela, 12 meses de histórico e últimas visitas só dele', async () => {
      const r = await api.chamar(token('vendedor@exemplo.com.br'), { method: 'GET', url: `/v1/core/clientes/${C.c1}` });
      const f = Cliente360Schema.parse(r.json());
      expect(f.contatos.map((c) => c.nome)).toEqual(['Marcos Compras', 'Rita Financeiro']); // principal primeiro
      expect(f.financeiro).toMatchObject({ limite_cents: 5_000_000, saldo_aberto_cents: 1_000_000, bloqueado: false });
      expect(f.titulos).toHaveLength(3);
      expect(f.historico).toHaveLength(12);
      expect(f.resumo_financeiro).toMatchObject({ credito_disponivel_cents: 4_000_000, vencidos_qtd: 1, a_vencer_qtd: 1 });
      expect(f.ultimas_visitas.length).toBeGreaterThan(0);
      expect(f.ultimas_visitas.every((v) => v.usuario_id === U.vendedor1)).toBe(true);
      // o supervisor (equipe 1) vê também a visita do promotor no mesmo cliente
      const s = Cliente360Schema.parse((await api.chamar(token('supervisor@exemplo.com.br'), { method: 'GET', url: `/v1/core/clientes/${C.c1}` })).json());
      expect(ordenar(s.ultimas_visitas.map((v) => v.usuario_id))).toEqual(ordenar([U.vendedor1, U.promotor]));
    });

    it('S1-004 GET carteira: vendedor/promotor 403 PERFIL_SEM_ACESSO; supervisor só a equipe 1; gerente e analista o tenant; B só B; filtro não vaza', async () => {
      for (const email of ['vendedor@exemplo.com.br', 'vendedor2@exemplo.com.br', 'promotor@exemplo.com.br']) {
        const r = await api.chamar(token(email), { method: 'GET', url: '/v1/core/carteira' });
        expect([r.statusCode, erroDe(r).codigo], email).toEqual([403, 'PERFIL_SEM_ACESSO']);
      }
      const vinculos = async (email: string, tenant: Tenant = A, q = '') => {
        const r = await api.chamar(token(email, tenant), { method: 'GET', url: `/v1/core/carteira${q}` });
        expect(r.statusCode, r.body).toBe(200);
        return (r.json() as { itens: Array<{ id: string; cliente_id: string; usuario_id: string }> }).itens;
      };
      const sup = await vinculos('supervisor@exemplo.com.br');
      expect(ordenar(sup.map((v) => v.usuario_id))).toEqual(ordenar([U.vendedor1, U.promotor]));
      expect(ordenar(sup.map((v) => v.cliente_id))).toEqual([C.c1, C.c3].sort());
      expect(await vinculos('supervisor@exemplo.com.br', A, `?usuario_id=${U.vendedor2}`)).toEqual([]);
      expect(await vinculos('supervisor@exemplo.com.br', A, `?cliente_id=${C.c2}`)).toEqual([]);
      const ger = await vinculos('gerente@exemplo.com.br');
      expect(ordenar(ger.map((v) => v.usuario_id))).toEqual(ordenar([U.vendedor1, U.vendedor2, U.promotor]));
      expect((await vinculos('analista@exemplo.com.br')).length).toBe(4);
      const daB = await vinculos('admin.b@exemplo.com.br', B);
      expect(daB.map((v) => v.cliente_id)).toEqual([B.clientes.c1]);
      expect(await vinculos('admin@exemplo.com.br', A, `?cliente_id=${B.clientes.c1}`)).toEqual([]);
      expect(await vinculos('admin.b@exemplo.com.br', B, `?usuario_id=${U.vendedor1}`)).toEqual([]);
    });

    it('S1-005 GET equipe/hierarquia: vendedor/promotor 403; supervisor a equipe 1 sem quem está acima; gerente a regional; admin B só gente de B', async () => {
      for (const email of ['vendedor@exemplo.com.br', 'promotor@exemplo.com.br']) {
        const r = await api.chamar(token(email), { method: 'GET', url: '/v1/core/equipe/hierarquia' });
        expect([r.statusCode, erroDe(r).codigo], email).toEqual([403, 'PERFIL_SEM_ACESSO']);
      }
      const arvore = async (email: string, tenant: Tenant = A) => {
        const r = await api.chamar(token(email, tenant), { method: 'GET', url: '/v1/core/equipe/hierarquia' });
        expect(r.statusCode, r.body).toBe(200);
        return HierarquiaEquipeSchema.parse(r.json()).membros;
      };
      const sup = await arvore('supervisor@exemplo.com.br');
      expect(ordenar(sup.map((m) => m.id))).toEqual(ordenar([U.supervisor, U.vendedor1, U.promotor]));
      expect(sup.find((m) => m.id === U.supervisor)!.superior_id).toBeNull(); // não revela o gerente
      expect(sup.find((m) => m.id === U.vendedor1)!.superior_id).toBe(U.supervisor);
      const ger = await arvore('gerente@exemplo.com.br');
      expect(ger.map((m) => m.id)).toEqual(expect.arrayContaining([U.gerente, U.supervisor, U.vendedor1, U.vendedor2, U.promotor]));
      expect(ger.map((m) => m.id)).not.toContain(U.admin);
      expect(ger.find((m) => m.id === U.supervisor)!.superior_id).toBe(U.gerente);
      const idsB = idsDoTenant.get(`${B.codigo}:core.usuario`)!;
      const doB = await arvore('admin.b@exemplo.com.br', B);
      expect(doB.length).toBeGreaterThan(0);
      for (const m of doB) expect(idsB.has(m.id), m.id).toBe(true);
      const idsA = idsDoTenant.get(`${A.codigo}:core.usuario`)!;
      for (const m of await arvore('admin@exemplo.com.br')) expect(idsA.has(m.id), m.id).toBe(true);
    });
  });

  describe('S1-006 — pull das 7 entidades: escopo de carteira e tenant (RN-CORE-04/05)', () => {
    it.each(ESCOPO)('$perfil $email ($tenant.codigo): cada entidade de cliente traz exatamente o escopo ∩ dados; produto = tenant; nenhum id do outro tenant', async (e) => {
      const t = token(e.email, e.tenant);
      const outro = e.tenant === A ? B : A;
      for (const x of ENTIDADES_DE_CLIENTE) {
        const { linhas, versao } = await pullCompleto(t, x.entidade);
        expect(versao, `${x.entidade}: escopo carteira devolve versao_escopo`).toEqual(expect.any(String));
        const clientes = ordenar(linhas.map((l) => String(l[x.chave])));
        expect(clientes, `${x.entidade}`).toEqual(e.clientes.filter((c) => x.comDados.includes(c)));
        const proibidos = idsDoTenant.get(`${outro.codigo}:${x.tabela}`)!;
        for (const l of linhas) expect(proibidos.has(l.id), `${x.entidade} ${l.id} é do outro tenant`).toBe(false);
      }
      const produtos = (await pullCompleto(t, 'produto')).linhas.map((l) => l.id);
      expect(ordenar(produtos)).toEqual(ordenar(idsDoTenant.get(`${e.tenant.codigo}:core.produto`)!));
    });

    it('vendedor-2 (só c2) não recebe nenhum contato, financeiro, título ou histórico de c1/c3 (linha a linha)', async () => {
      const t = token('vendedor2@exemplo.com.br');
      for (const x of ENTIDADES_DE_CLIENTE.filter((y) => y.chave === 'cliente_id' && y.entidade !== 'carteira')) {
        const r = await api.admin.query<{ id: string }>(`select id from ${x.tabela} where tenant_id = $1 and cliente_id <> $2`, [A.tenantId, C.c2]);
        const fora = new Set(r.rows.map((l) => l.id));
        for (const l of (await pullCompleto(t, x.entidade)).linhas) expect(fora.has(l.id), `${x.entidade} ${l.id}`).toBe(false);
      }
    });
  });

  describe('S1-007..S1-009 — escrita da carteira: perfil, idempotência, auditoria e tenant', () => {
    it('S1-007 PUT carteira: só analista/admin (carteira.editar); vendedor, promotor, supervisor, gerente e assistente → 403 PERFIL_SEM_ACESSO', async () => {
      const corpo = { cliente_id: C.c2, usuario_id: U.vendedor1, papel: 'vendedor' };
      for (const email of ['vendedor@exemplo.com.br', 'promotor@exemplo.com.br', 'supervisor@exemplo.com.br', 'gerente@exemplo.com.br', 'assistente@exemplo.com.br']) {
        const r = await api.chamar(token(email), { method: 'PUT', url: '/v1/core/carteira', payload: corpo });
        expect([r.statusCode, erroDe(r).codigo], email).toEqual([403, 'PERFIL_SEM_ACESSO']);
        const d = await api.chamar(token(email), { method: 'DELETE', url: `/v1/core/carteira/0c000000-0000-4000-8000-00000000dead` });
        expect([d.statusCode, erroDe(d).codigo], `DELETE ${email}`).toEqual([403, 'PERFIL_SEM_ACESSO']);
      }
      const n = await api.admin.query('select count(*)::int as n from core.carteira where cliente_id = $1 and usuario_id = $2', [C.c2, U.vendedor1]);
      expect(n.rows[0].n).toBe(0);
    });

    it('S1-008 PUT idempotente pela chave (cliente, usuário, papel) com auditoria; DELETE remove e audita; papel incompatível → 422 RN-CORE-04', async () => {
      const corpo = { cliente_id: C.c2, usuario_id: U.vendedor1, papel: 'vendedor', frequencia_semanas: 2, dia_semana: 3 };
      const r1 = await api.chamar(token('analista@exemplo.com.br'), { method: 'PUT', url: '/v1/core/carteira', payload: corpo });
      expect(r1.statusCode, r1.body).toBe(200);
      const r2 = await api.chamar(token('admin@exemplo.com.br'), { method: 'PUT', url: '/v1/core/carteira', payload: corpo });
      expect(r2.statusCode, r2.body).toBe(200);
      const id = (r1.json() as { id: string }).id;
      expect((r2.json() as { id: string }).id).toBe(id);
      const vivos = await api.admin.query('select count(*)::int as n from core.carteira where cliente_id = $1 and usuario_id = $2 and deleted_at is null', [C.c2, U.vendedor1]);
      expect(vivos.rows[0].n).toBe(1);
      const aud = await api.admin.query<{ usuario_id: string; acao: string }>(
        `select usuario_id, acao from plataforma.auditoria where entidade_id = $1 and tenant_id = $2 order by created_at`,
        [id, A.tenantId],
      );
      expect(aud.rows.map((x) => x.acao)).toEqual(['carteira.vincular', 'carteira.vincular']);
      expect(aud.rows.map((x) => x.usuario_id)).toEqual([U.analista, U.admin]);

      const incompat = await api.chamar(token('analista@exemplo.com.br'), { method: 'PUT', url: '/v1/core/carteira', payload: { cliente_id: C.c2, usuario_id: U.promotor, papel: 'vendedor' } });
      expect([incompat.statusCode, erroDe(incompat).codigo]).toEqual([422, 'RN-CORE-04']);

      const d = await api.chamar(token('analista@exemplo.com.br'), { method: 'DELETE', url: `/v1/core/carteira/${id}` });
      expect(d.statusCode, d.body).toBe(204);
      const de2 = await api.chamar(token('analista@exemplo.com.br'), { method: 'DELETE', url: `/v1/core/carteira/${id}` });
      expect(de2.statusCode).toBe(404);
      const audD = await api.admin.query(`select 1 from plataforma.auditoria where entidade_id = $1 and acao = 'carteira.desvincular'`, [id]);
      expect(audD.rowCount).toBe(1);
      // a ficha de c2 volta a ser 404 para o vendedor-1 (o escopo é lido a cada requisição)
      const f = await api.chamar(token('vendedor@exemplo.com.br'), { method: 'GET', url: `/v1/core/clientes/${C.c2}` });
      expect(f.statusCode).toBe(404);
    });

    it('S1-009 RN-CORE-05: admin de B não vincula cliente nem usuário de A, nem apaga vínculo de A (404, nada muda em A)', async () => {
      const tb = token('admin.b@exemplo.com.br', B);
      const c = await api.chamar(tb, { method: 'PUT', url: '/v1/core/carteira', payload: { cliente_id: C.c1, usuario_id: B.usuarios.vendedor, papel: 'vendedor' } });
      expect([c.statusCode, erroDe(c).codigo]).toEqual([404, 'CLIENTE_NAO_ENCONTRADO']);
      const u = await api.chamar(tb, { method: 'PUT', url: '/v1/core/carteira', payload: { cliente_id: B.clientes.c1, usuario_id: U.vendedor1, papel: 'vendedor' } });
      expect([u.statusCode, erroDe(u).codigo]).toEqual([404, 'USUARIO_NAO_ENCONTRADO']);
      const vinculoA = (await api.admin.query<{ id: string }>('select id from core.carteira where tenant_id = $1 and deleted_at is null order by id limit 1', [A.tenantId])).rows[0]!.id;
      const d = await api.chamar(tb, { method: 'DELETE', url: `/v1/core/carteira/${vinculoA}` });
      expect([d.statusCode, erroDe(d).codigo]).toEqual([404, 'CARTEIRA_NAO_ENCONTRADA']);
      const ainda = await api.admin.query('select deleted_at from core.carteira where id = $1', [vinculoA]);
      expect(ainda.rows[0].deleted_at).toBeNull();
      const n = await api.admin.query('select count(*)::int as n from core.carteira where tenant_id = $1 and usuario_id = $2', [B.tenantId, U.vendedor1]);
      expect(n.rows[0].n).toBe(0);
    });
  });

  describe('S1-010..S1-012 — autenticação e licença em toda rota nova (critério 3)', () => {
    const ROTAS = [
      { method: 'GET' as const, url: '/v1/core/clientes' },
      { method: 'GET' as const, url: `/v1/core/clientes/${C.c1}` },
      { method: 'GET' as const, url: '/v1/core/carteira' },
      { method: 'PUT' as const, url: '/v1/core/carteira', payload: { cliente_id: C.c2, usuario_id: U.vendedor2, papel: 'vendedor' } },
      { method: 'DELETE' as const, url: '/v1/core/carteira/0c000000-0000-4000-8000-00000000dead' },
      { method: 'GET' as const, url: '/v1/core/equipe/hierarquia' },
      { method: 'GET' as const, url: '/v1/core/dispositivos' },
      { method: 'PUT' as const, url: `/v1/core/dispositivos/${A.dispositivos.vendedor1}/bloqueio`, payload: {} },
      { method: 'DELETE' as const, url: `/v1/core/dispositivos/${A.dispositivos.vendedor1}/bloqueio` },
      ...['cliente_contato', 'cliente_financeiro', 'titulo', 'historico_compra'].map((e) => ({ method: 'GET' as const, url: `/v1/sync/pull?entidade=${e}` })),
    ];

    it.each(ROTAS)('S1-010 $method $url: sem token ou com token inválido/de outro segredo → 401, sem tocar no banco', async (rota) => {
      for (const t of [null, 'nao.e.um.jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.assinatura-falsa']) {
        const r = await api.chamar(t, rota);
        expect(r.statusCode, `${String(t)}: ${r.body}`).toBe(401);
      }
    });

    it('S1-011 RN-CORE-01: o Core não desliga em nenhum nível (API 422; banco recusa por CHECK) e as rotas novas seguem 200', async () => {
      const adm = token('admin@exemplo.com.br');
      for (const [nivel, alvo] of [['tenant', undefined], ['perfil', 'vendedor'], ['usuario', U.vendedor1]] as const) {
        const r = await licenca(api, adm, nivel, 'core', false, alvo);
        expect(r.statusCode, `${nivel}: ${r.body}`).toBe(422);
      }
      // nem por fora da API: a trava final é do banco (tenant_modulo_core_sempre_ativo, SQLSTATE 23514)
      await expect(api.admin.query(`update plataforma.tenant_modulo set ativo = false where tenant_id = $1 and modulo = 'core'`, [A.tenantId])).rejects.toMatchObject({ code: '23514' });
      expect((await api.chamar(token('vendedor@exemplo.com.br'), { method: 'GET', url: '/v1/core/clientes' })).statusCode).toBe(200);
      expect((await api.chamar(token('vendedor@exemplo.com.br'), { method: 'GET', url: `/v1/core/clientes/${C.c1}` })).statusCode).toBe(200);
      expect((await api.chamar(token('supervisor@exemplo.com.br'), { method: 'GET', url: '/v1/core/equipe/hierarquia' })).statusCode).toBe(200);
    });

    it('S1-012 licença lida a cada requisição: sem o Vendedor (tenant) o Core continua; a entidade do Vendedor no pull vira 403 MODULO_INATIVO', async () => {
      const adm = token('admin@exemplo.com.br');
      const v1 = token('vendedor@exemplo.com.br');
      expect((await api.chamar(v1, { method: 'GET', url: '/v1/sync/pull?entidade=pedido' })).statusCode).toBe(200);
      expect((await licenca(api, adm, 'tenant', 'vendedor', false)).statusCode).toBe(200);
      try {
        const ficha = await api.chamar(v1, { method: 'GET', url: `/v1/core/clientes/${C.c1}` });
        expect(ficha.statusCode, ficha.body).toBe(200);
        expect((await api.chamar(v1, { method: 'GET', url: '/v1/sync/pull?entidade=titulo' })).statusCode).toBe(200);
        const ped = await api.chamar(v1, { method: 'GET', url: '/v1/sync/pull?entidade=pedido' });
        expect([ped.statusCode, erroDe(ped).codigo]).toEqual([403, 'MODULO_INATIVO']);
      } finally {
        expect((await licenca(api, adm, 'tenant', 'vendedor', true)).statusCode).toBe(200);
      }
      expect((await api.chamar(v1, { method: 'GET', url: '/v1/sync/pull?entidade=pedido' })).statusCode).toBe(200);
    });
  });
});
