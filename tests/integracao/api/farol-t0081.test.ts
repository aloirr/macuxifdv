/**
 * T-0081 (agente testes) — Farol de clientes pela API REAL: `createApp` × Postgres como `macuxi_app` (RLS), banco efêmero
 * próprio do arquivo com a fixture dois-tenants, login de verdade (JWT) e licenças lidas do banco a cada requisição.
 * PRECISA DE BANCO: pula sem Postgres (local, sem Docker no PC); no CI (`MACUXI_PG_EXIGIR=1`) roda.
 * Regras: RN-CORE-28 (farol), RN-CORE-04 (escopo), RN-CORE-05 (tenant), RN-CORE-01/02/03 (licença), RN-CORE-20/27 (fonte).
 *
 * O que o modulo-core já cobre e NÃO se repete aqui: a regra pura (`modules/core/domain/farol.test.ts`), a rota em memória com
 * a matriz de ações do manifesto (`modules/core/api/farol.test.ts`) e o `executar` das rotas × Postgres com o escopo real
 * (`modules/core/api/farol.db.test.ts`: supervisor só a equipe, B invisível, cores pelo histórico, PUT auditado e idempotente,
 * 422 sem gravar). Aqui: o caminho HTTP inteiro (token → licença → ação do perfil → contrato → escopo do `app.ts`).
 *
 * Matriz: docs/testes/T-0081.md (F-01..F-07). Defeito D-T0081a (F-07, corrigido pelo modulo-core em R-20261105-100141): a fonte
 * da positivação dependia dos módulos de QUEM CONSULTA; agora vem da licença do tenant (`plataforma.tenant_modulo`).
 */
import { FarolSchema, ParametrosFarolSchema, type Farol } from '@macuxi/core/contracts';
import { semBanco } from '@macuxi/db/teste/estado';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A, B, erroDe, ids, licenca, subirApi, type ApiDeTeste } from '../apoio/api';

type Quem = 'admin' | 'analista' | 'assistente' | 'gerente' | 'supervisor' | 'vendedor' | 'promotor' | 'adminB';
const EMAIL: Record<Quem, [string, typeof A | typeof B]> = {
  admin: ['admin@exemplo.com.br', A],
  analista: ['analista@exemplo.com.br', A],
  assistente: ['assistente@exemplo.com.br', A],
  gerente: ['gerente@exemplo.com.br', A],
  supervisor: ['supervisor@exemplo.com.br', A],
  vendedor: ['vendedor@exemplo.com.br', A],
  promotor: ['promotor@exemplo.com.br', A],
  adminB: ['admin.b@exemplo.com.br', B],
};
/** RN-CORE-28 item 7 e manifesto do Core (`farol.ver`, `parametro.farol`). */
const VEEM_FAROL: Quem[] = ['supervisor', 'gerente', 'analista', 'assistente', 'admin'];
const SEM_FAROL: Quem[] = ['vendedor', 'promotor'];
const EDITAM_PARAMETROS: Quem[] = ['analista', 'admin'];
const SEM_PARAMETROS: Quem[] = ['supervisor', 'gerente', 'assistente', 'vendedor', 'promotor'];
const PADRAO = { verde_ate_dias: 30, amarelo_ate_dias: 45, positivacao_verde_pct: 70, positivacao_amarelo_pct: 50 };

describe.skipIf(semBanco())('T-0081 — Farol de clientes pela API real (createApp × Postgres; RN-CORE-28, RN-CORE-04, RN-CORE-05)', () => {
  let api: ApiDeTeste;
  const token = {} as Record<Quem, string>;

  const get = (q: Quem, url: string) => api.chamar(token[q], { method: 'GET', url });
  const farol = async (q: Quem, query = ''): Promise<Farol> => {
    const r = await get(q, `/v1/core/farol${query}`);
    expect(r.statusCode, `${q} GET farol${query}: ${r.body}`).toBe(200);
    return FarolSchema.parse(r.json());
  };
  const negado = (r: LightMyRequestResponse, codigo: string, quem: string) => {
    expect(r.statusCode, `${quem}: ${r.body}`).toBe(403);
    expect(erroDe(r).codigo, quem).toBe(codigo);
  };
  const auditoriasFarol = async (tenant: string) =>
    Number((await api.admin.query<{ n: string }>("select count(*) as n from plataforma.auditoria where tenant_id = $1 and acao = 'parametro.farol'", [tenant])).rows[0]!.n);

  beforeAll(async () => {
    api = await subirApi();
    for (const q of Object.keys(EMAIL) as Quem[]) token[q] = (await api.sessao(EMAIL[q][0], EMAIL[q][1])).access_token;
  });
  afterAll(async () => {
    await api?.fechar();
  });

  it('F-01 RN-CORE-28: GET /v1/core/farol — supervisor, gerente, analista, assistente e admin 200; vendedor e promotor 403 PERFIL_SEM_ACESSO; sem token 401', async () => {
    for (const q of VEEM_FAROL) await farol(q);
    for (const q of SEM_FAROL) negado(await get(q, '/v1/core/farol'), 'PERFIL_SEM_ACESSO', q);
    const anonimo = await api.chamar(null, { method: 'GET', url: '/v1/core/farol' });
    expect(anonimo.statusCode).toBe(401);
  });

  it('F-02 RN-CORE-28 item 7: GET/PUT /v1/core/parametros/farol só analista e admin; os demais 403 e nada gravado', async () => {
    const antes = await auditoriasFarol(A.tenantId);
    for (const q of SEM_PARAMETROS) {
      negado(await get(q, '/v1/core/parametros/farol'), 'PERFIL_SEM_ACESSO', `${q} GET`);
      negado(await api.chamar(token[q], { method: 'PUT', url: '/v1/core/parametros/farol', payload: { ...PADRAO, verde_ate_dias: 5 } }), 'PERFIL_SEM_ACESSO', `${q} PUT`);
    }
    for (const q of EDITAM_PARAMETROS) {
      const r = await get(q, '/v1/core/parametros/farol');
      expect(r.statusCode, r.body).toBe(200);
      expect(ParametrosFarolSchema.parse(r.json())).toEqual(PADRAO);
    }
    // os 403 não gravaram parâmetro nem auditoria
    expect(await auditoriasFarol(A.tenantId)).toBe(antes);
    const linhas = await api.admin.query("select 1 from plataforma.parametro where tenant_id = $1 and modulo = 'core' and chave like 'farol.%' and deleted_at is null", [A.tenantId]);
    expect(linhas.rowCount).toBe(0);
  });

  it('F-03 RN-CORE-04: escopo pelo app real — supervisor só a equipe 1; equipe ou vendedor fora do escopo = 200 vazio (contrato do desenho §5, nunca 403/404); gerente a regional', async () => {
    const sup = await farol('supervisor');
    expect(sup.vendedores.map((v) => v.usuario_id)).toEqual([A.usuarios.vendedor1]);
    expect(sup.clientes.map((c) => c.cliente_id).sort()).toEqual([A.clientes.c1, A.clientes.c3].sort());
    expect(sup.clientes.map((c) => c.cliente_id)).not.toContain(A.clientes.c2);

    for (const query of [`?usuario_id=${A.usuarios.vendedor2}`, `?equipe_id=${A.equipes.equipe2}`]) {
      const f = await farol('supervisor', query);
      expect(f.clientes, query).toEqual([]);
      expect(f.vendedores, query).toEqual([]);
      expect(f.resumo.carteira, query).toBe(0);
    }
    // filtro dentro do escopo funciona (controle positivo do caso acima)
    expect((await farol('supervisor', `?usuario_id=${A.usuarios.vendedor1}`)).vendedores.map((v) => v.usuario_id)).toEqual([A.usuarios.vendedor1]);

    const ger = await farol('gerente');
    expect(ger.vendedores.map((v) => v.usuario_id)).toEqual(expect.arrayContaining([A.usuarios.vendedor1, A.usuarios.vendedor2]));
    expect(ger.vendedores.map((v) => v.usuario_id)).not.toContain(A.usuarios.promotor);
    expect(ger.clientes.map((c) => c.cliente_id)).toEqual(expect.arrayContaining([A.clientes.c1, A.clientes.c2, A.clientes.c3]));
  });

  it('F-04 RN-CORE-05: A e B não se veem em /v1/core/farol* (lista, filtro por id do outro tenant e parâmetros)', async () => {
    const idsA = new Set<string>([...Object.values(A.clientes), ...Object.values(A.usuarios)]);
    const idsB = new Set<string>([...Object.values(B.clientes), ...Object.values(B.usuarios)]);
    const fb = await farol('adminB');
    expect(fb.clientes.length, 'controle positivo: B tem carteira').toBeGreaterThan(0);
    expect(fb.clientes.every((c) => !idsA.has(c.cliente_id) && !idsA.has(c.usuario_id))).toBe(true);
    expect(fb.vendedores.every((v) => !idsA.has(v.usuario_id))).toBe(true);
    const fa = await farol('admin');
    expect(fa.clientes.every((c) => !idsB.has(c.cliente_id) && !idsB.has(c.usuario_id))).toBe(true);
    expect(fa.vendedores.every((v) => !idsB.has(v.usuario_id))).toBe(true);

    // filtro com id do outro tenant: vazio, sem erro que revele a existência
    for (const query of [`?usuario_id=${A.usuarios.vendedor1}`, `?equipe_id=${A.equipes.equipe1}`]) {
      const f = await farol('adminB', query);
      expect(f.clientes, query).toEqual([]);
      expect(f.vendedores, query).toEqual([]);
    }
    expect((await farol('admin', `?usuario_id=${B.usuarios.vendedor}`)).clientes).toEqual([]);

    // parâmetros por tenant: A grava, B segue no padrão; A volta ao padrão no fim
    const novo = { verde_ate_dias: 12, amarelo_ate_dias: 24, positivacao_verde_pct: 80, positivacao_amarelo_pct: 40 };
    const put = await api.chamar(token.admin, { method: 'PUT', url: '/v1/core/parametros/farol', payload: novo });
    expect(put.statusCode, put.body).toBe(200);
    expect((await farol('admin')).parametros).toEqual(novo);
    expect((await farol('adminB')).parametros).toEqual(PADRAO);
    const getB = await get('adminB', '/v1/core/parametros/farol');
    expect(getB.json()).toEqual(PADRAO);
    const volta = await api.chamar(token.admin, { method: 'PUT', url: '/v1/core/parametros/farol', payload: PADRAO });
    expect(volta.statusCode, volta.body).toBe(200);
  });

  it('F-05 RN-AUD-01 / RN-CORE-28: PUT repetido pela API não audita de novo; PUT incoerente 422 RN-CORE-28 sem gravar', async () => {
    const corpo = { verde_ate_dias: 20, amarelo_ate_dias: 60, positivacao_verde_pct: 90, positivacao_amarelo_pct: 60 };
    const antes = await auditoriasFarol(A.tenantId);
    for (let i = 0; i < 2; i++) {
      const r = await api.chamar(token.analista, { method: 'PUT', url: '/v1/core/parametros/farol', payload: corpo });
      expect(r.statusCode, r.body).toBe(200);
    }
    expect(await auditoriasFarol(A.tenantId)).toBe(antes + 1);
    const ruim = await api.chamar(token.analista, { method: 'PUT', url: '/v1/core/parametros/farol', payload: { ...corpo, amarelo_ate_dias: 10 } });
    expect(ruim.statusCode, ruim.body).toBe(422);
    expect(erroDe(ruim).codigo).toBe('RN-CORE-28');
    // campo estranho: contrato estrito
    const estranho = await api.chamar(token.analista, { method: 'PUT', url: '/v1/core/parametros/farol', payload: { ...corpo, extra: 1 } });
    expect(estranho.statusCode).toBe(400);
    expect(await auditoriasFarol(A.tenantId)).toBe(antes + 1);
    expect((await farol('analista')).parametros).toEqual(corpo);
    await api.chamar(token.analista, { method: 'PUT', url: '/v1/core/parametros/farol', payload: PADRAO });
  });

  it('F-06 RN-CORE-01/02/03: o farol é do Core (sempre ativo) — não há MODULO_INATIVO: o core não desliga (422) e desligar Vendedor e Promotor no tenant não derruba a rota', async () => {
    for (const r of [
      await licenca(api, token.admin, 'tenant', 'core', false),
      await licenca(api, token.admin, 'perfil', 'core', false, 'supervisor'),
      await licenca(api, token.admin, 'usuario', 'core', false, A.usuarios.supervisor),
    ]) {
      expect(r.statusCode, r.body).toBe(422);
    }
    try {
      for (const m of ['vendedor', 'promotor']) expect((await licenca(api, token.admin, 'tenant', m, false)).statusCode).toBe(200);
      expect(ids(await api.meusModulos(token.supervisor))).not.toContain('vendedor');
      const f = await farol('supervisor');
      expect(f.vendedores.map((v) => v.usuario_id)).toEqual([A.usuarios.vendedor1]);
      // vendedor e promotor continuam sem a rota pelo perfil (não pela licença)
      negado(await get('vendedor', '/v1/core/farol'), 'PERFIL_SEM_ACESSO', 'vendedor');
    } finally {
      for (const m of ['vendedor', 'promotor']) await licenca(api, token.admin, 'tenant', m, true);
    }
    expect(ids(await api.meusModulos(token.supervisor))).toContain('vendedor');
  });

  describe('F-07 RN-CORE-27/28: positivação pela fonte do TENANT, igual para qualquer perfil que consulta', () => {
    it('preparo: Integração ativa no tenant A, Vendedor ativo no tenant; nota de faturamento do mês atribuída ao vendedor-1 (c1); admin sem Vendedor nos módulos, analista com', async () => {
      expect((await licenca(api, token.admin, 'tenant', 'integracao', true)).statusCode).toBe(200);
      const r = await api.admin.query("update core.nota_erp set usuario_id = $2 where tenant_id = $1 and external_id = 'NF-1-5001' and deleted_at is null and not cancelada", [A.tenantId, A.usuarios.vendedor1]);
      expect(r.rowCount).toBe(1);
      expect(ids(await api.meusModulos(token.admin))).not.toContain('vendedor');
      expect(ids(await api.meusModulos(token.analista))).toContain('vendedor');
    });

    // D-T0081a (corrigido): `calcularFarol` decidia a fonte por `fontePorConsulta(tx)`, que só responde se QUEM CONSULTA tem
    // o Vendedor nos módulos efetivos; o admin (perfil só com core na fixture) caía nas notas do ERP e o analista no pedido.
    // Agora a rota lê `plataforma.tenant_modulo` (Integração e Vendedor) e, com o Vendedor ativo no tenant, a fonte é o pedido
    // para qualquer perfil (RN-CORE-27/28; mesma decisão do Início, D-T0080a). Último caso do arquivo: o preparo acima não é
    // desfeito; se entrar caso novo depois deste, desfaça a Integração e a NF-1-5001 no fim.
    it('D-T0081a: admin e analista veem a mesma fonte e a mesma positivação do c1 no farol do mesmo tenant', async () => {
      const [doAdmin, doAnalista] = [await farol('admin'), await farol('analista')];
      expect(doAdmin.fonte_positivacao).toBe(doAnalista.fonte_positivacao);
      expect(doAdmin.fonte_positivacao, 'Vendedor ativo no tenant: vale só a RN-CORE-20 (pedido)').not.toBe('nota_erp');
      const c1 = (f: Farol) => f.clientes.find((c) => c.cliente_id === A.clientes.c1 && c.usuario_id === A.usuarios.vendedor1)?.positivado_mes;
      expect(c1(doAdmin)).toBe(c1(doAnalista));
      expect(doAdmin.resumo.positivados).toBe(doAnalista.resumo.positivados);
    });
  });
});
