import { criarPermissoes, verificarAcao, PERFIS, type ClienteBanco, type ContextoBase, type RotaModulo, type TransacaoTenant } from '@macuxi/platform-sdk';
import { describe, expect, it, vi } from 'vitest';
import { InicioSchema } from '../contracts';
import { manifest } from '../manifest';
import { calcularInicio, rotasDeInicio } from './inicio';

const TENANT = '0a000000-0000-4000-8000-0000000000aa';
const VEND = '0b000000-0000-4000-8000-000000000001';
const PROM = '0b000000-0000-4000-8000-000000000002';
const SUP = '0b000000-0000-4000-8000-000000000003';
const EQ = '0c000000-0000-4000-8000-000000000001';
const CLI = '0d000000-0000-4000-8000-000000000001';
// terça 10/11/2026 12h em Manaus (UTC-4)
const AGORA = new Date('2026-11-10T16:00:00Z');

type Resposta = [RegExp, unknown[]];
function fakeDb(respostas: Resposta[]) {
  const chamadas: Array<{ sql: string; valores: readonly unknown[] }> = [];
  const db: ClienteBanco = {
    query: async (sql, valores = []) => {
      chamadas.push({ sql, valores });
      const r = respostas.find(([re]) => re.test(sql));
      const rows = (r?.[1] ?? []) as never[];
      return { rows, rowCount: rows.length };
    },
  };
  return { db, chamadas };
}
const pedido = (vendedor_id: string, emitido_em: string, total_cents: number, cliente_id = CLI) => ({ vendedor_id, criado_por: null, cliente_id, emitido_em, aprovado_em: emitido_em, status: 'aprovado' as const, total_cents, frete_cents: null, cancelado_cents: null });
const meta = (usuario_id: string, indicador: string, valor: number, tipo = 'pedido') => ({ usuario_id, indicador, valor, tipo });
const usuarioV = { id: VEND, nome: 'Vera', perfil: 'vendedor', equipe_id: EQ };
const usuarioP = { id: PROM, nome: 'Paulo', perfil: 'promotor', equipe_id: EQ };

describe('RN-CORE-26: permissões da rota GET /v1/core/inicio', () => {
  it('RN-CORE-26: só vendedor, promotor, supervisor e gerente têm Início (analista, assistente e admin recebem 403)', () => {
    const permissoes = criarPermissoes([manifest]);
    const quem = PERFIS.filter((perfil) => verificarAcao({ id: 'x', tenant_id: TENANT, perfil, modulos: ['core'] }, permissoes, 'inicio.ver').ok);
    expect(quem).toEqual(['vendedor', 'promotor', 'supervisor', 'gerente']);
    expect(rotasDeInicio.map((r) => `${r.metodo} ${r.caminho} ${r.acao}`)).toEqual(['GET inicio inicio.ver']);
  });
});

describe('RN-CORE-26: calcularInicio do vendedor', () => {
  const entrada = { usuarioId: VEND, perfil: 'vendedor', visiveis: new Set([VEND]), agora: AGORA, fuso: 'America/Manaus' };
  const respostas: Resposta[] = [
    [/from core.usuario/, [usuarioV]],
    [/from core.meta/, [meta(VEND, 'venda_cents', 3_000_000), meta(VEND, 'positivacao', 40)]],
  ];

  it('RN-CORE-26: realizado partido (até ontem × hoje) da consulta do Vendedor e meta do dia de R$ 1.000 (100.000 centavos)', async () => {
    const { db } = fakeDb(respostas);
    const fonte = vi.fn(async () => ({
      pedidos: [pedido(VEND, '2026-11-09T14:00:00Z', 1_200_000), pedido(VEND, '2026-11-10T14:00:00Z', 30_000, '0d000000-0000-4000-8000-000000000002')],
      faturamentos: [],
    }));
    const r = await calcularInicio(db, {}, entrada, fonte);
    expect(InicioSchema.safeParse(r).success).toBe(true);
    expect(r).toMatchObject({ dia: '2026-11-10', periodo: '2026-11', escopo: 'proprio' });
    expect(r.usuarios[0]).toMatchObject({ venda_cents: { ate_ontem: 1_200_000, hoje: 30_000 }, positivacao: { ate_ontem: 1, hoje: 1 }, tipo_meta_venda: 'pedido' });
    const venda = r.metas_do_dia.find((m) => m.indicador === 'venda_cents')!;
    expect(venda).toMatchObject({ meta_dia: 100_000, dias_uteis_restantes: 18, situacao: 'a_cumprir', realizado_hoje: 30_000 });
    expect(fonte).toHaveBeenCalledWith({ usuario_ids: [VEND], periodo: '2026-11' });
  });

  it('RN-CORE-26: pedido de 23h30 em Manaus (03h30 UTC do dia 10) é "até ontem"; o fuso do tenant decide o dia', async () => {
    const { db } = fakeDb(respostas);
    const r = await calcularInicio(db, {}, entrada, async () => ({ pedidos: [pedido(VEND, '2026-11-10T03:30:00Z', 5_000)], faturamentos: [] }));
    expect(r.usuarios[0]!.venda_cents).toEqual({ ate_ontem: 5_000, hoje: 0 });
  });

  it('RN-CORE-26: decisão do Alexandre (T-0073): sem o Vendedor e sem linha no indicador_diario, venda e positivação são nulas e NÃO entram nas metas do dia como zero', async () => {
    const { db } = fakeDb(respostas);
    const r = await calcularInicio(db, {}, entrada, async () => null);
    expect(r.usuarios[0]).toMatchObject({ venda_cents: null, positivacao: null });
    const inds = r.metas_do_dia.map((m) => m.indicador);
    expect(inds).not.toContain('venda_cents');
    expect(inds).not.toContain('positivacao');
  });

  it('RN-CORE-26: decisão do dono do produto (T-0073): com linha no indicador_diario a venda vem do read-model; positivação segue nula quando core.positivacao_do_mes não tem fonte (nulos)', async () => {
    const { db } = fakeDb([...respostas, [/from core.indicador_diario/, [{ usuario_id: VEND, data: '2026-11-10', vendido_cents: 20_000, cancelado_cents: 0 }]]]);
    const r = await calcularInicio(db, {}, entrada, async () => null);
    expect(r.usuarios[0]).toMatchObject({ venda_cents: { ate_ontem: 0, hoje: 20_000 }, positivacao: null });
    const inds = r.metas_do_dia.map((m) => m.indicador);
    expect(inds).toContain('venda_cents');
    expect(inds).not.toContain('positivacao');
  });

  it('RN-CORE-20/26: sem o Vendedor a positivação vem de core.positivacao_do_mes (cliente conta uma vez no mês): até ontem × novos hoje, com o dia e o período do tenant', async () => {
    const { db, chamadas } = fakeDb([...respostas, [/core.positivacao_do_mes/, [{ usuario_id: VEND, ate_ontem: 12, hoje: 2, mes: 14 }]]]);
    const r = await calcularInicio(db, {}, entrada, async () => null);
    expect(r.usuarios[0]).toMatchObject({ positivacao: { ate_ontem: 12, hoje: 2 } });
    const c = chamadas.find((x) => /core.positivacao_do_mes/.test(x.sql))!;
    expect(c.valores).toEqual([[VEND], '2026-11', '2026-11-10']);
    expect(r.metas_do_dia.find((x) => x.indicador === 'positivacao')).toMatchObject({ realizado_hoje: 2 });
  });

  it('RN-CORE-27: Vendedor desligado + Integração ativa com notas: a positivação vem das notas (um cliente uma vez) e core.positivacao_do_mes nem é chamada', async () => {
    const erp: Resposta[] = [[/select 1 from core.nota_erp/, [{ '?column?': 1 }]], [/group by usuario_id, cliente_id/, [{ usuario_id: VEND, cliente_id: CLI, emitida_em: '2026-11-03T15:00:00Z' }, { usuario_id: VEND, cliente_id: 'c2', emitida_em: '2026-11-10T15:00:00Z' }]]];
    const { db, chamadas } = fakeDb([...respostas, ...erp]);
    const r = await calcularInicio(db, {}, { ...entrada, integracaoNoTenant: true }, async () => null);
    expect(r.usuarios[0]!.positivacao).toEqual({ ate_ontem: 1, hoje: 1 });
    expect(chamadas.some((x) => /core.positivacao_do_mes/.test(x.sql))).toBe(false);
  });

  it('RN-CORE-27: sem notas atribuídas, ou com a Integração desligada, vale o read-model de antes; Vendedor ligado ignora as notas', async () => {
    const posm: Resposta = [/core.positivacao_do_mes/, [{ usuario_id: VEND, ate_ontem: 5, hoje: 1, mes: 6 }]];
    const semNota = fakeDb([...respostas, posm]);
    expect((await calcularInicio(semNota.db, {}, { ...entrada, integracaoNoTenant: true }, async () => null)).usuarios[0]!.positivacao).toEqual({ ate_ontem: 5, hoje: 1 });
    const semInteg = fakeDb([...respostas, posm, [/select 1 from core.nota_erp/, [{ '?column?': 1 }]]]);
    expect((await calcularInicio(semInteg.db, {}, { ...entrada, integracaoNoTenant: false }, async () => null)).usuarios[0]!.positivacao).toEqual({ ate_ontem: 5, hoje: 1 });
    expect(semInteg.chamadas.some((x) => /core.nota_erp/.test(x.sql))).toBe(false);
    const ligado = fakeDb([...respostas, [/select 1 from core.nota_erp/, [{ '?column?': 1 }]]]);
    await calcularInicio(ligado.db, {}, { ...entrada, integracaoNoTenant: true }, async () => ({ pedidos: [], faturamentos: [] }));
    expect(ligado.chamadas.some((x) => /core.nota_erp/.test(x.sql))).toBe(false);
  });

  it('RN-CORE-27: Vendedor licenciado no tenant com a consulta indisponível NÃO cai nas notas do ERP (decide a licença, não quem consulta)', async () => {
    const posm: Resposta = [/core.positivacao_do_mes/, [{ usuario_id: VEND, ate_ontem: 5, hoje: 1, mes: 6 }]];
    const { db, chamadas } = fakeDb([...respostas, posm, [/select 1 from core.nota_erp/, [{ '?column?': 1 }]]]);
    const r = await calcularInicio(db, {}, { ...entrada, integracaoNoTenant: true, vendedorNoTenant: true }, async () => null);
    expect(r.usuarios[0]!.positivacao).toEqual({ ate_ontem: 5, hoje: 1 });
    expect(chamadas.some((x) => /core.nota_erp/.test(x.sql))).toBe(false);
  });

  it('RN-CORE-26: mês novo com fonte e sem cliente positivado vale zero (não nulo) e a meta de positivação entra', async () => {
    const { db } = fakeDb([...respostas, [/core.positivacao_do_mes/, [{ usuario_id: VEND, ate_ontem: 0, hoje: 0, mes: 0 }]]]);
    const r = await calcularInicio(db, {}, entrada, async () => null);
    expect(r.usuarios[0]!.positivacao).toEqual({ ate_ontem: 0, hoje: 0 });
    expect(r.metas_do_dia.map((m) => m.indicador)).toContain('positivacao');
  });

  it('RN-CORE-26: com o Vendedor ligado a consulta dele manda e core.positivacao_do_mes nem é chamada', async () => {
    const { db, chamadas } = fakeDb(respostas);
    await calcularInicio(db, {}, entrada, async () => ({ pedidos: [], faturamentos: [] }));
    expect(chamadas.some((x) => /core.positivacao_do_mes/.test(x.sql))).toBe(false);
  });

  it('RN-CORE-26: sem o Vendedor cai no read-model indicador_diario (líquido de cancelamento)', async () => {
    const { db } = fakeDb([...respostas, [/from core.indicador_diario/, [{ usuario_id: VEND, data: '2026-11-09', vendido_cents: 900_000, cancelado_cents: 100_000 }, { usuario_id: VEND, data: '2026-11-10', vendido_cents: 20_000, cancelado_cents: 0 }]]]);
    const r = await calcularInicio(db, {}, entrada, async () => null);
    expect(r.usuarios[0]!.venda_cents).toEqual({ ate_ontem: 800_000, hoje: 20_000 });
  });

  it('RN-CORE-26: visitas e cobertura saem das linhas locais do dia (check-in de hoje conta em hoje)', async () => {
    const { db } = fakeDb([
      [/from core.usuario/, [usuarioV]],
      [/from core.meta/, [meta(VEND, 'visitas', 100), meta(VEND, 'cobertura_pct', 9000)]],
      [/from core.rota_parada/, [{ usuario_id: VEND, cliente_id: CLI, data: '2026-11-09' }, { usuario_id: VEND, cliente_id: '0d000000-0000-4000-8000-000000000002', data: '2026-11-10' }]],
      [/from core.visita/, [{ usuario_id: VEND, cliente_id: CLI, data_local: '2026-11-09' }, { usuario_id: VEND, cliente_id: '0d000000-0000-4000-8000-000000000002', data_local: '2026-11-10' }]],
    ]);
    const fonte = vi.fn();
    const r = await calcularInicio(db, {}, entrada, fonte);
    expect(fonte).toHaveBeenCalledTimes(1); // vendedor sempre consulta
    const visitas = r.metas_do_dia.find((m) => m.indicador === 'visitas')!;
    expect(visitas).toMatchObject({ realizado_ate_ontem: 1, realizado_hoje: 1 });
    const cob = r.metas_do_dia.find((m) => m.indicador === 'cobertura_pct')!;
    expect(cob).toMatchObject({ situacao: 'do_mes', meta_dia: null, realizado_ate_ontem: 5000, realizado_hoje: 5000 });
  });
});

describe('RN-PRO-01: promotor no Início', () => {
  const entrada = { usuarioId: PROM, perfil: 'promotor', visiveis: new Set([PROM]), agora: AGORA, fuso: 'America/Manaus' };
  it('RN-PRO-01: promotor sem meta de venda nem de positivação NÃO chama a consulta do Vendedor e devolve venda_cents nulo', async () => {
    const { db } = fakeDb([[/from core.usuario/, [usuarioP]], [/from core.meta/, [meta(PROM, 'visitas', 120)]]]);
    const tx = { consultar: vi.fn() };
    const r = await calcularInicio(db, tx as unknown as TransacaoTenant, entrada);
    expect(tx.consultar).not.toHaveBeenCalled();
    expect(r.usuarios[0]).toMatchObject({ perfil: 'promotor', venda_cents: null, positivacao: null });
    expect(r.metas_do_dia.map((m) => m.indicador)).toEqual(['visitas']);
  });
  it('RN-PRO-01: promotor com meta de venda cadastrada vê só o agregado (a consulta é chamada só para ele)', async () => {
    const { db } = fakeDb([[/from core.usuario/, [usuarioP]], [/from core.meta/, [meta(PROM, 'venda_cents', 500_000)]]]);
    const fonte = vi.fn(async () => ({ pedidos: [], faturamentos: [] }));
    const r = await calcularInicio(db, {}, entrada, fonte);
    expect(fonte).toHaveBeenCalledWith({ usuario_ids: [PROM], periodo: '2026-11' });
    expect(r.usuarios[0]!.venda_cents).toEqual({ ate_ontem: 0, hoje: 0 });
  });
  it('RN-PRO-01: sem consultar no contexto (Vendedor não instalado) a rota não quebra', async () => {
    const { db } = fakeDb([[/from core.usuario/, [usuarioV]], [/from core.meta/, []]]);
    const r = await calcularInicio(db, {}, { ...entrada, usuarioId: VEND, perfil: 'vendedor' });
    expect(r.usuarios[0]!.venda_cents).toBeNull();
  });
});

describe('RN-CORE-26: Início do supervisor soma a equipe', () => {
  it('RN-CORE-26: meta do dia da equipe = soma das metas do dia de cada pessoa (150.000 do caso 6) e só quem tem meta entra', async () => {
    const V2 = '0b000000-0000-4000-8000-000000000004';
    const V3 = '0b000000-0000-4000-8000-000000000005';
    const { db } = fakeDb([
      [/from core.usuario/, [usuarioV, { id: V2, nome: 'Beto', perfil: 'vendedor', equipe_id: EQ }, { id: V3, nome: 'Caio', perfil: 'vendedor', equipe_id: EQ }, usuarioP]],
      [/from core.meta/, [meta(VEND, 'venda_cents', 3_000_000), meta(V2, 'venda_cents', 1_800_000), meta(V3, 'venda_cents', 900_000)]],
    ]);
    const fonte = vi.fn(async () => ({
      pedidos: [pedido(VEND, '2026-11-09T14:00:00Z', 1_200_000), pedido(VEND, '2026-11-10T14:00:00Z', 50_000), pedido(V2, '2026-11-09T14:00:00Z', 2_000_000)],
      faturamentos: [],
    }));
    const r = await calcularInicio(db, {}, { usuarioId: SUP, perfil: 'supervisor', visiveis: new Set([SUP, VEND, V2, V3, PROM]), agora: AGORA, fuso: 'America/Manaus' }, fonte);
    expect(r.escopo).toBe('equipe');
    expect(r.usuarios).toHaveLength(4);
    expect(fonte).toHaveBeenCalledWith({ usuario_ids: [VEND, V2, V3], periodo: '2026-11' }); // promotor sem meta de venda fora
    expect(r.metas_do_dia).toHaveLength(1);
    expect(r.metas_do_dia[0]).toMatchObject({ indicador: 'venda_cents', meta_dia: 150_000, realizado_hoje: 50_000, membros: 3, membros_mes_batido: 1, situacao: 'a_cumprir' });
  });
  it('RN-CORE-04: o filtro de escopo vai ao banco (supervisor só vê a lista de usuariosVisiveis)', async () => {
    const { db, chamadas } = fakeDb([[/from core.usuario/, []]]);
    const r = await calcularInicio(db, {}, { usuarioId: SUP, perfil: 'supervisor', visiveis: new Set([VEND]), agora: AGORA, fuso: 'America/Manaus' });
    expect(r.usuarios).toEqual([]);
    expect(chamadas[0]!.valores).toEqual([[VEND]]);
  });
});

describe('RN-CORE-26: rota usa a data do fuso do tenant', () => {
  it('RN-CORE-26: o "hoje" da rota é ctx.agora() no fuso do tenant (01h UTC de 11/11 ainda é 10/11 em Manaus)', async () => {
    const { db } = fakeDb([[/from core.usuario/, [usuarioV]], [/from core.meta/, []]]);
    const tx = {} as unknown as TransacaoTenant;
    const ctx = {
      usuario: { id: VEND, tenant_id: TENANT, perfil: 'vendedor', modulos: ['core'] },
      agora: () => new Date('2026-11-11T01:00:00Z'),
      fuso: () => 'America/Manaus',
      comTenant: (fn: (d: ClienteBanco, t: TransacaoTenant) => Promise<unknown>) => fn(db, tx),
      usuariosVisiveis: async () => new Set([VEND]),
      query: {},
    } as unknown as ContextoBase;
    const rota = rotasDeInicio[0] as RotaModulo;
    const r = (await rota.executar(ctx as never)) as { dia: string };
    expect(r.dia).toBe('2026-11-10');
  });
});

describe('RN-CORE-27: a fonte das notas vale pela licença do tenant (D-T0080a)', () => {
  it('RN-CORE-27: vendedor sem "integracao" no perfil recebe a positivação das notas quando o tenant tem a Integração ativa', async () => {
    const { db, chamadas } = fakeDb([
      [/from core.usuario/, [usuarioV]], [/from core.meta/, []],
      [/plataforma.tenant_modulo/, [{ modulo: 'integracao' }]],
      [/select 1 from core.nota_erp/, [{ '?column?': 1 }]],
      [/group by usuario_id, cliente_id/, [{ usuario_id: VEND, cliente_id: CLI, emitida_em: '2026-11-10T15:00:00Z' }]],
    ]);
    const ctx = {
      usuario: { id: VEND, tenant_id: TENANT, perfil: 'vendedor', modulos: ['core'] },
      agora: () => new Date('2026-11-11T01:00:00Z'),
      fuso: () => 'America/Manaus',
      comTenant: (fn: (d: ClienteBanco, t: TransacaoTenant) => Promise<unknown>) => fn(db, {} as unknown as TransacaoTenant),
      usuariosVisiveis: async () => new Set([VEND]),
      query: {},
    } as unknown as ContextoBase;
    await (rotasDeInicio[0] as RotaModulo).executar(ctx as never);
    expect(chamadas.some((x) => /core.nota_erp/.test(x.sql))).toBe(true);
  });
});
