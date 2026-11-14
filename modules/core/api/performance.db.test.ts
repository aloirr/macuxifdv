/**
 * T-0170 × Postgres real (fixture dois-tenants, RLS): `GET /v1/core/performance` (RN-CORE-41 a 46; desenho `performance-produtividade.md`
 * §2, §4 e §7.3). Resultados e produtividade pelas mesmas funções puras do aparelho; o realizado de venda vem da consulta
 * `vendedor.pedidos_da_meta@1` (programada no teste), do `indicador_diario` ou fica sem dado; o promotor nunca chama o Vendedor
 * (RN-PRO-01); escopo de equipe (404 fora dele) e isolamento do tenant B (RN-CORE-05). Pula sem Postgres.
 */
import { semBanco } from '@macuxi/db/teste/estado';
import { somarDiasCivis } from '@macuxi/comum/relogio';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PerformanceSchema } from '../contracts/performance';
import { dataLocal } from '../domain';
import { ultimoDiaDoMes } from '../domain/performance/tempo';
import { A, AmbienteBanco, B, U } from './apoio-teste-t0170';
import { rotasDePerformance } from './performance';

const hoje = dataLocal(new Date(), 'America/Manaus'); // hora-fixa-ok: o banco real grava com now()
const MES = hoje.slice(0, 7);
const DE = `${MES}-01`;
const ATE = ultimoDiaDoMes(MES);

describe.skipIf(semBanco())('Core T-0170 × Postgres: Performance', () => {
  const amb = new AmbienteBanco();
  const vendedor1 = amb.usuario(U.vendedor1, 'vendedor');
  const promotor = amb.usuario(U.promotor, 'promotor');
  const supervisor = amb.usuario(U.supervisor, 'supervisor');
  const gerente = amb.usuario(U.gerente, 'gerente');
  const analista = amb.usuario(U.analista, 'analista');
  const adminB = amb.usuario(B.usuarios.admin, 'admin', B.tenantId);
  let chamadasAoVendedor = 0;
  const pedido = (cliente: string | null, itens: number | undefined, total = 100_000) => ({
    vendedor_id: U.vendedor1,
    criado_por: U.vendedor1,
    cliente_id: cliente,
    emitido_em: new Date().toISOString(), // hora-fixa-ok: emitido agora, no dia de hoje
    aprovado_em: null,
    status: 'aprovado',
    total_cents: total,
    frete_cents: null,
    cancelado_cents: null,
    ...(itens === undefined ? {} : { itens_distintos: itens }),
  });
  const performance = (u = vendedor1, query: Record<string, unknown> = {}): Promise<any> => amb.chamar(rotasDePerformance, 'GET', 'performance', u, { query: { de: DE, ate: ATE, ...query } }); // eslint-disable-line @typescript-eslint/no-explicit-any
  const resultado = (p: { resultados: Array<{ indicador: string }> }, indicador: string) => p.resultados.find((r) => r.indicador === indicador) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** A fixture já tem metas do mês do vendedor-1: guarda o que havia, troca pelos valores do teste e devolve no fim. */
  const antes = new Map<string, { valor: number; tipo: string } | null>();
  const limpar = async () => {
    for (const [indicador, original] of antes) {
      if (original) await amb.limpar('update core.meta set valor = $4, tipo = $5 where tenant_id = $1 and usuario_id = $2 and periodo = $3 and indicador = $6 and deleted_at is null', [A.tenantId, U.vendedor1, MES, original.valor, original.tipo, indicador]);
      else await amb.limpar('delete from core.meta where tenant_id = $1 and usuario_id = $2 and periodo = $3 and indicador = $4', [A.tenantId, U.vendedor1, MES, indicador]);
    }
    antes.clear();
  };

  beforeAll(async () => {
    await amb.abrir();
    await limpar();
    const meta = async (indicador: string, valor: number) => {
      const r = await amb.admin.query<{ valor: number; tipo: string }>('select valor::float8 as valor, tipo from core.meta where tenant_id = $1 and usuario_id = $2 and periodo = $3 and indicador = $4 and deleted_at is null', [A.tenantId, U.vendedor1, MES, indicador]);
      antes.set(indicador, r.rows[0] ?? null);
      if (r.rows[0]) await amb.limpar("update core.meta set valor = $5, tipo = 'pedido' where tenant_id = $1 and usuario_id = $2 and periodo = $3 and indicador = $4", [A.tenantId, U.vendedor1, MES, indicador, valor]);
      else await amb.limpar("insert into core.meta (tenant_id, usuario_id, periodo, indicador, valor, tipo) values ($1, $2, $3, $4, $5, 'pedido')", [A.tenantId, U.vendedor1, MES, indicador, valor]);
    };
    await meta('venda_cents', 1_000_000);
    await meta('positivacao', 10);
    await meta('visitas', 20);
    await meta('itens_por_pedido', 800);
  });
  afterAll(async () => {
    await limpar();
    await amb.fechar();
  });
  beforeEach(() => {
    chamadasAoVendedor = 0;
    amb.consultas['vendedor.pedidos_da_meta@1'] = () => {
      chamadasAoVendedor += 1;
      return { pedidos: [pedido(A.clientes.c1, 4), pedido(A.clientes.c1, 6), pedido(A.clientes.c3, 5)], faturamentos: [] };
    };
  });

  it('RN-CORE-42: com a consulta do Vendedor, venda, positivação, pedidos e itens saem das mesmas regras do aparelho; o contrato fecha (strict)', async () => {
    const p = PerformanceSchema.parse(await performance());
    expect(p).toMatchObject({ usuario_id: U.vendedor1, de: DE, ate: ATE, hoje });
    expect(p.realizado_servidor).toMatchObject({ tipo_meta_venda: 'pedido', venda_cents: 300_000, positivacao: 2, pedidos: 3, itens_distintos: 15 });
    const venda = resultado(p, 'venda_cents');
    expect(venda).toMatchObject({ situacao: 'a_cumprir', meta: 1_000_000, realizado: 300_000, gap: 700_000, atingimento_pb: 3000 });
    expect(resultado(p, 'positivacao')).toMatchObject({ meta: 10, realizado: 2, gap: 8 });
    expect(resultado(p, 'itens_por_pedido')).toMatchObject({ situacao: 'a_cumprir', meta: 800, realizado: 500, gap: 300 }); // 100 × 15 ÷ 3
    expect(resultado(p, 'visitas')).toMatchObject({ meta: 20 });
    expect(p.produtividade.map((i: { indicador: string }) => i.indicador)).toHaveLength(12);
    expect(p.calendario.du_total).toBeGreaterThan(0);
    expect(p.realizado_servidor.por_mes.map((m: { periodo: string }) => m.periodo)).toEqual([MES]);
    expect(chamadasAoVendedor).toBeGreaterThan(0);
  });

  it('a meta do dia de Itens por pedido em Hoje usa o realizado até ontem (pedidos de hoje não entram); sem pedido, o card vale 0 (A-3)', async () => {
    const p = await performance(vendedor1, { de: hoje, ate: hoje });
    expect(p.realizado_servidor).toMatchObject({ venda_cents: 300_000, pedidos: 3, pedidos_ate_ontem: 0, itens_distintos_ate_ontem: 0 });
    amb.consultas['vendedor.pedidos_da_meta@1'] = () => ({ pedidos: [], faturamentos: [] });
    const vazio = await performance();
    expect(vazio.realizado_servidor).toMatchObject({ venda_cents: 0, positivacao: 0, pedidos: 0, itens_distintos: 0 });
    expect(resultado(vazio, 'itens_por_pedido')).toMatchObject({ situacao: 'a_cumprir', realizado: 0, atingimento_pb: 0, gap: 800 });
  });

  it('Vendedor antigo (pedido sem itens_distintos): Itens por pedido fica sem_dado e os outros cards seguem', async () => {
    amb.consultas['vendedor.pedidos_da_meta@1'] = () => ({ pedidos: [pedido(A.clientes.c1, undefined)], faturamentos: [] });
    const p = await performance();
    expect(p.realizado_servidor).toMatchObject({ venda_cents: 100_000, itens_distintos: null });
    expect(resultado(p, 'itens_por_pedido').situacao).toBe('sem_dado');
    expect(resultado(p, 'venda_cents').situacao).toBe('a_cumprir');
  });

  it('sem o Vendedor: venda do indicador_diario (positivação e itens sem dado); sem nenhuma fonte, tudo sem_dado — nunca zero', async () => {
    delete amb.consultas['vendedor.pedidos_da_meta@1'];
    const liquido = Number((await amb.admin.query("select coalesce(sum(greatest(0, vendido_cents - cancelado_cents)), 0)::float8 as v from core.indicador_diario where deleted_at is null and tenant_id = $1 and usuario_id = $2 and data between $3::date and $4::date", [A.tenantId, U.vendedor1, DE, hoje])).rows[0].v);
    const diario = await performance();
    expect(diario.realizado_servidor).toMatchObject({ venda_cents: liquido, positivacao: null, pedidos: null, itens_distintos: null });
    expect(resultado(diario, 'venda_cents')).toMatchObject({ situacao: 'a_cumprir', realizado: liquido });
    expect(resultado(diario, 'positivacao').situacao).toBe('sem_dado');
    expect(resultado(diario, 'itens_por_pedido').situacao).toBe('sem_dado');
    // sem nenhuma linha do read-model, o card de venda é sem_dado (nunca zero)
    const vivas = (await amb.admin.query<{ id: string }>('update core.indicador_diario set deleted_at = now() where tenant_id = $1 and usuario_id = $2 and deleted_at is null returning id', [A.tenantId, U.vendedor1])).rows.map((r) => r.id);
    try {
      const semFonte = await performance();
      expect(semFonte.realizado_servidor).toMatchObject({ venda_cents: null, positivacao: null, pedidos: null, itens_distintos: null });
      expect(['venda_cents', 'positivacao', 'itens_por_pedido'].map((i) => resultado(semFonte, i).situacao)).toEqual(['sem_dado', 'sem_dado', 'sem_dado']);
      expect(resultado(semFonte, 'visitas').situacao).not.toBe('sem_dado');
    } finally {
      await amb.limpar('update core.indicador_diario set deleted_at = null where id = any($1::uuid[])', [vivas]);
    }
  });

  it('RN-PRO-01: o promotor só tem Visitas; a consulta do Vendedor nunca é chamada para ele', async () => {
    const p = await performance(promotor);
    expect(chamadasAoVendedor).toBe(0);
    expect(p.realizado_servidor).toMatchObject({ venda_cents: null, positivacao: null, pedidos: null, itens_distintos: null, por_mes: [] });
    expect(['venda_cents', 'positivacao', 'itens_por_pedido'].map((i) => resultado(p, i).situacao)).toEqual(['sem_dado', 'sem_dado', 'sem_dado']);
    expect(resultado(p, 'visitas').situacao).not.toBe('sem_dado');
  });

  it('RN-CORE-04: vendedor só a si (404 para outro usuário); supervisor e gerente, a equipe; analista, o tenant; tenant B nunca alcança o A', async () => {
    await expect(performance(vendedor1, { usuario_id: U.vendedor2 })).rejects.toMatchObject({ status: 404, codigo: 'USUARIO_NAO_ENCONTRADO' });
    expect((await performance(vendedor1, { usuario_id: U.vendedor1 })).usuario_id).toBe(U.vendedor1);
    expect((await performance(supervisor, { usuario_id: U.vendedor1 })).usuario_id).toBe(U.vendedor1);
    await expect(performance(supervisor, { usuario_id: U.vendedor2 })).rejects.toMatchObject({ status: 404 });
    expect((await performance(gerente, { usuario_id: U.vendedor2 })).usuario_id).toBe(U.vendedor2);
    expect((await performance(analista, { usuario_id: U.promotor })).usuario_id).toBe(U.promotor);
    await expect(performance(adminB, { usuario_id: U.vendedor1 })).rejects.toMatchObject({ status: 404 });
    await expect(performance(supervisor)).rejects.toMatchObject({ status: 422, codigo: 'PERFORMANCE_USUARIO_INVALIDO' }); // o supervisor não é consultor
    // as metas são de cada usuário: a meta de venda do vendedor-2 não é a do vendedor-1
    expect(resultado(await performance(gerente, { usuario_id: U.vendedor2 }), 'venda_cents').meta).not.toBe(1_000_000);
  });

  it('RN-CORE-45: a meta de produtividade resolvida (usuário > equipe > tenant > padrão do FDV) chega com a origem; a fixture tem meta da equipe 2', async () => {
    const p = await performance(gerente, { usuario_id: U.vendedor2 });
    const visitasDia = p.produtividade.find((i: { indicador: string }) => i.indicador === 'visitas_dia');
    expect(visitasDia).toMatchObject({ meta: 12, meta_origem: 'equipe' });
    const tma = p.produtividade.find((i: { indicador: string }) => i.indicador === 'tma');
    expect(tma).toMatchObject({ meta: 30, meta_origem: 'padrao_fdv' });
    // vendedor-1 está na equipe 1: herda o padrão
    expect((await performance(vendedor1)).produtividade.find((i: { indicador: string }) => i.indicador === 'visitas_dia')).toMatchObject({ meta: 110, meta_origem: 'padrao_fdv' });
  });

  it('RN-CORE-41: período de vários meses traz um bloco por mês até o mês de hoje; o limite de 366 dias e o fim antes do início são recusados pelo contrato', async () => {
    const dozeMeses = await performance(vendedor1, { de: somarDiasCivis(DE, -90), ate: ATE });
    expect(dozeMeses.realizado_servidor.por_mes.length).toBeGreaterThanOrEqual(3);
    expect(dozeMeses.realizado_servidor.por_mes[dozeMeses.realizado_servidor.por_mes.length - 1].periodo).toBe(MES);
    await expect(performance(vendedor1, { de: ATE, ate: DE })).rejects.toThrow();
    await expect(performance(vendedor1, { de: somarDiasCivis(DE, -400), ate: ATE })).rejects.toThrow();
  });

  it('sem dado pessoal em log: só ids e datas', () => {
    expect(amb.linhasDeLog.join('\n')).not.toMatch(/Vendedor|Gerente|@exemplo/);
  });
});
