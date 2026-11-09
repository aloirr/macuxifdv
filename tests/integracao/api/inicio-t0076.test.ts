/**
 * T-0076 critério 6 (multi-tenant e permissões do Início) e 4 (promotor, RN-PRO-01), com o `createApp` REAL × Postgres como
 * `macuxi_app` (RLS) e a fixture dois-tenants (A: Equipe 1 = supervisor + vendedor-1 + promotor; Equipe 2 = vendedor-2;
 * Regional Alfa = gerente; B: Equipe Beta = vendedor Beta). PRECISA DE BANCO: pula sem Postgres; no CI (MACUXI_PG_EXIGIR=1) roda.
 *
 * 1. `GET /v1/core/inicio` (`core.inicio@1`, campo aditivo `equipe_nome`): cada um vê o nome da SUA equipe e só os números do
 *    seu escopo (vendedor = ele; supervisor = a equipe dele; gerente = as equipes abaixo; nunca o outro tenant). Promotor sem
 *    dado de pedido (venda e positivação nulas, meta só de visitas). Perfis sem Início (analista) = 403.
 * 2. Cards Orçamentos e A faturar: saem do APARELHO. O motor de sync real puxa os pedidos da carteira e o `resumoDoInicio` do
 *    Vendedor (a mesma função do card) conta só os do vendedor logado; o outro vendedor e o outro tenant ficam de fora.
 * Matriz: docs/testes/T-0076.md (I-01..I-09).
 */
import { InicioSchema, type Inicio } from '@macuxi/core/contracts';
import { semBanco } from '@macuxi/db/teste/estado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lerLinhas, listaDePedidos } from '../../../modules/vendedor/app/lib/pull';
import { mergeOrders } from '../../../modules/vendedor/app/lib/pedidos';
import { resumoDoInicio } from '../../../modules/vendedor/app/lib/resumo-inicio';
import { A, B, erroDe, licenca, subirApi, type ApiDeTeste, type Tenant } from '../apoio/api';
import { aparelhoCampo, esperarHorizonte } from '../apoio/campo';

const U = A.usuarios;
const VENDEDOR = 'vendedor@exemplo.com.br'; // e-mail repetido nos dois tenants (vendedor-1 em A, vendedor Beta em B)

describe.skipIf(semBanco())('T-0076 — GET /v1/core/inicio: equipe e números só do escopo de quem pede (createApp real × Postgres)', () => {
  let api: ApiDeTeste;
  const tokens: Record<string, string> = {};
  const inicio = async (quem: string): Promise<Inicio> => {
    const r = await api.chamar(tokens[quem]!, { method: 'GET', url: '/v1/core/inicio' });
    expect(r.statusCode, `${quem}: ${r.body}`).toBe(200);
    return InicioSchema.parse(r.json());
  };
  const indicadores = (r: Inicio) => r.metas_do_dia.map((m) => m.indicador);
  const metaDe = (r: Inicio, ind: string) => r.metas_do_dia.find((m) => m.indicador === ind);

  beforeAll(async () => {
    api = await subirApi();
    const entrar = async (chave: string, email: string, tenant: Tenant = A) => {
      tokens[chave] = (await api.sessao(email, tenant)).access_token;
    };
    await entrar('vendedor1', VENDEDOR);
    await entrar('vendedor2', 'vendedor2@exemplo.com.br');
    await entrar('promotor', 'promotor@exemplo.com.br');
    await entrar('supervisor', 'supervisor@exemplo.com.br');
    await entrar('gerente', 'gerente@exemplo.com.br');
    await entrar('analista', 'analista@exemplo.com.br');
    await entrar('admin', 'admin@exemplo.com.br');
    await entrar('vendedorB', VENDEDOR, B);
  });
  afterAll(async () => {
    await api?.fechar();
  });

  it('I-01 vendedor: escopo próprio, só ele, equipe_nome da equipe dele (Equipe 1); nada do vendedor-2 nem do tenant B', async () => {
    const r = await inicio('vendedor1');
    expect(r.escopo).toBe('proprio');
    expect(r.equipe_nome).toBe('Equipe 1');
    expect(r.usuarios.map((u) => u.usuario_id)).toEqual([U.vendedor1]);
    // meta do mês é a DELE (R$ 150.000), não a soma com o vendedor-2 (R$ 120.000) nem com o vendedor Beta (R$ 80.000)
    expect(metaDe(r, 'venda_cents')).toMatchObject({ meta_mes: 15_000_000, membros: 1 });
  });

  it('I-02 outro vendedor do mesmo tenant: Equipe 2 e só ele', async () => {
    const r = await inicio('vendedor2');
    expect(r.equipe_nome).toBe('Equipe 2');
    expect(r.usuarios.map((u) => u.usuario_id)).toEqual([U.vendedor2]);
    expect(metaDe(r, 'venda_cents')).toMatchObject({ meta_mes: 12_000_000, membros: 1 });
  });

  it('I-03 mesmo e-mail no tenant B: Equipe Beta e só o vendedor Beta (RLS; nenhum usuário de A)', async () => {
    const r = await inicio('vendedorB');
    expect(r.equipe_nome).toBe('Equipe Beta');
    expect(r.usuarios.map((u) => u.usuario_id)).toEqual([B.usuarios.vendedor]);
    expect(metaDe(r, 'venda_cents')).toMatchObject({ meta_mes: 8_000_000, membros: 1 });
    const idsDeA = new Set<string>(Object.values(U));
    expect(r.usuarios.some((u) => idsDeA.has(u.usuario_id))).toBe(false);
  });

  it('I-04 supervisor: escopo equipe = Equipe 1 (vendedor-1 + promotor); vendedor-2 (Equipe 2) e o tenant B ficam fora da soma', async () => {
    const r = await inicio('supervisor');
    expect(r.escopo).toBe('equipe');
    expect(r.equipe_nome).toBe('Equipe 1');
    expect(r.usuarios.map((u) => u.usuario_id).sort()).toEqual([U.vendedor1, U.promotor].sort());
    // venda: só o vendedor-1 tem meta na equipe (15M; com o vendedor-2 seria 27M); visitas: vendedor-1 (80) + promotor (100)
    expect(metaDe(r, 'venda_cents')).toMatchObject({ meta_mes: 15_000_000, membros: 1 });
    expect(metaDe(r, 'visitas')).toMatchObject({ meta_mes: 180, membros: 2 });
  });

  it('I-05 gerente: Regional Alfa e as equipes abaixo (vendedor-1, vendedor-2, promotor); nada de B', async () => {
    const r = await inicio('gerente');
    expect(r.escopo).toBe('equipe');
    expect(r.equipe_nome).toBe('Regional Alfa');
    expect(r.usuarios.map((u) => u.usuario_id).sort()).toEqual([U.vendedor1, U.vendedor2, U.promotor].sort());
    expect(metaDe(r, 'venda_cents')).toMatchObject({ meta_mes: 27_000_000, membros: 2 });
    expect(r.usuarios.some((u) => u.usuario_id === B.usuarios.vendedor)).toBe(false);
  });

  it('I-06 promotor (RN-PRO-01): sem dado de pedido (venda e positivação nulas) e meta só do indicador em que tem meta (visitas)', async () => {
    const r = await inicio('promotor');
    expect(r.escopo).toBe('proprio');
    expect(r.equipe_nome).toBe('Equipe 1');
    expect(r.usuarios).toHaveLength(1);
    expect(r.usuarios[0]).toMatchObject({ usuario_id: U.promotor, perfil: 'promotor', venda_cents: null, positivacao: null });
    expect(indicadores(r)).toEqual(['visitas']);
    expect(metaDe(r, 'visitas')).toMatchObject({ meta_mes: 100, membros: 1 });
  });

  it('I-07 perfil sem Início (analista e admin): 403, sem corpo de dados', async () => {
    for (const quem of ['analista', 'admin']) {
      const r = await api.chamar(tokens[quem]!, { method: 'GET', url: '/v1/core/inicio' });
      expect(r.statusCode, quem).toBe(403);
      expect(erroDe(r).codigo, quem).toBeTruthy();
    }
    expect((await api.chamar(null, { method: 'GET', url: '/v1/core/inicio' })).statusCode).toBe(401);
  });

  it('I-08 Vendedor desligado no tenant: o Início continua (Core), positivação sem fonte e fora das metas; religado, volta', async () => {
    const desl = await licenca(api, tokens.admin!, 'tenant', 'vendedor', false);
    expect(desl.statusCode, desl.body).toBe(200);
    try {
      const r = await inicio('vendedor1');
      expect(r.usuarios[0]!.positivacao).toBeNull();
      expect(indicadores(r)).not.toContain('positivacao');
      expect(r.equipe_nome).toBe('Equipe 1');
    } finally {
      const lig = await licenca(api, tokens.admin!, 'tenant', 'vendedor', true);
      expect(lig.statusCode, lig.body).toBe(200);
    }
    const volta = await inicio('vendedor1');
    expect(volta.usuarios[0]!.positivacao).not.toBeNull();
  });
});

describe.skipIf(semBanco())('T-0076 — cards Orçamentos e A faturar saem do aparelho, só da carteira de quem está logado (motor real)', () => {
  let api: ApiDeTeste;

  beforeAll(async () => {
    api = await subirApi();
    await esperarHorizonte();
  });
  afterAll(async () => {
    await api?.fechar();
  });

  /** O que o card calcula (useResumoInicio): linhas do pull → lista de pedidos → resumoDoInicio do vendedor logado. */
  async function cardsDoAparelho(email: string, tenant: Tenant) {
    const ap = await aparelhoCampo(api, email, { tenant });
    expect(await ap.sincronizar()).toBe(true);
    const linhas = await lerLinhas(ap.motor);
    const eu = { id: ap.sessao.usuario.id, name: ap.sessao.usuario.nome, branch_id: '' };
    const pedidos = mergeOrders(listaDePedidos(linhas, {}), [], eu);
    const resumo = resumoDoInicio(pedidos, { vendedorId: eu.id, preVendaLigada: true });
    return { ids: linhas.pedidos.map((p) => p.id).sort(), resumo };
  }

  it('I-09 vendedor-2 (A): A faturar = o pedido aguardando aprovação dele (R$ 4.400, 1 aguardando); nada do vendedor-1 nem de B', async () => {
    const { ids, resumo } = await cardsDoAparelho('vendedor2@exemplo.com.br', A);
    expect(ids).toEqual([A.pedidos.p2]);
    expect(resumo.aFaturar).toEqual({ quantidade: 1, valor_cents: 440_000, aguardando_aprovacao: 1 });
    expect(resumo.orcamentos).toEqual({ quantidade: 0, valor_cents: 0 }); // RN-VEN-18 (09/11): sem "vence amanhã"
  });

  it('I-09 vendedor-1 (A): o recebido (legado) e o faturado não contam; o aguardando do vendedor-2 não chega ao aparelho', async () => {
    const { ids, resumo } = await cardsDoAparelho(VENDEDOR, A);
    expect(ids).not.toContain(A.pedidos.p2);
    expect(ids).not.toContain(B.pedidos.p1);
    expect(resumo.aFaturar).toEqual({ quantidade: 0, valor_cents: 0, aguardando_aprovacao: 0 });
  });

  it('I-09 vendedor Beta (B, mesmo e-mail): A faturar = o aprovado dele (R$ 450); nada de A', async () => {
    const { ids, resumo } = await cardsDoAparelho(VENDEDOR, B);
    expect(ids).toEqual([B.pedidos.p1]);
    expect(resumo.aFaturar).toEqual({ quantidade: 1, valor_cents: 45_000, aguardando_aprovacao: 0 });
  });
});
