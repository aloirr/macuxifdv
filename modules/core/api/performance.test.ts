/**
 * Performance (T-0170; RN-CORE-41 a 46): funções puras da API sem banco — a apuração dos fatos do Vendedor, o calendário com
 * feriados do tenant, o almoço configurável e o `realizado_servidor` (hoje, até ontem, por mês e sem fonte).
 */
import { describe, expect, it } from 'vitest';
import { RealizadoServidorSchema } from '../contracts/performance';
import { agregarFatos, AGREGADO_VAZIO, calendarioComFeriados, realizadoDoServidor, rotasDePerformance, type Agregado, type FatosDoMes } from './performance';

const V1 = '0e000000-0000-4000-8000-000000000001';
const V2 = '0e000000-0000-4000-8000-000000000002';
const C1 = '0e000000-0000-4000-8000-0000000000c1';
const C2 = '0e000000-0000-4000-8000-0000000000c2';
const FUSO = 'America/Manaus';
// 13h UTC = 9h em Manaus (mesmo dia civil)
const em = (dia: string, hhmmUtc = '13:00') => `${dia}T${hhmmUtc}:00.000Z`;
const pedido = (dia: string, cliente: string | null, total: number, itens?: number, extra: Record<string, unknown> = {}) => ({
  vendedor_id: V1,
  criado_por: V1,
  cliente_id: cliente,
  emitido_em: em(dia),
  aprovado_em: null,
  status: 'aprovado',
  total_cents: total,
  frete_cents: null,
  cancelado_cents: null,
  ...(itens === undefined ? {} : { itens_distintos: itens }),
  ...extra,
});
const fatos = (pedidos: FatosDoMes['pedidos'], faturamentos: FatosDoMes['faturamentos'] = []): FatosDoMes => ({ pedidos, faturamentos });
const intervalo = (de: string, ate: string, tipo: 'pedido' | 'faturamento' = 'pedido') => ({ usuario_id: V1, tipo, fuso: FUSO, de, ate });

describe('RN-CORE-21/42: agregarFatos (venda, positivação, pedidos e itens do intervalo)', () => {
  const f = fatos([pedido('2026-11-03', C1, 100_000, 4), pedido('2026-11-03', C1, 50_000, 6), pedido('2026-11-10', C2, 80_000, 5), pedido('2026-11-12', null, 20_000, 2)]);

  it('RN-CORE-21: soma o líquido (sem frete nem cancelamento) dos pedidos aprovados do vendedor, pela emissão, no intervalo', () => {
    expect(agregarFatos(f, intervalo('2026-11-01', '2026-11-30')).venda_cents).toBe(250_000);
    expect(agregarFatos(f, intervalo('2026-11-01', '2026-11-09')).venda_cents).toBe(150_000);
    const comAbatimento = fatos([pedido('2026-11-03', C1, 100_000, 4, { frete_cents: 10_000, cancelado_cents: 5_000 })]);
    expect(agregarFatos(comAbatimento, intervalo('2026-11-01', '2026-11-30')).venda_cents).toBe(85_000);
  });

  it('RN-CORE-20: positivação = clientes distintos com pedido no intervalo (cliente repetido conta uma vez; pedido sem cliente não conta)', () => {
    expect(agregarFatos(f, intervalo('2026-11-01', '2026-11-30')).positivacao).toBe(2);
    expect(agregarFatos(f, intervalo('2026-11-03', '2026-11-03')).positivacao).toBe(1);
  });

  it('RN-CORE-42: itens por pedido = soma dos itens distintos dos mesmos pedidos que contam; um pedido sem o campo deixa os itens sem dado', () => {
    const a = agregarFatos(f, intervalo('2026-11-01', '2026-11-30'));
    expect(a).toMatchObject({ pedidos: 4, itens_distintos: 17 });
    expect(agregarFatos(fatos([pedido('2026-11-03', C1, 1, 4), pedido('2026-11-04', C1, 1)]), intervalo('2026-11-01', '2026-11-30'))).toMatchObject({ pedidos: 2, itens_distintos: null });
  });

  it('pedido de outro vendedor, status fora do aprovado e emissão fora do intervalo ficam de fora; sem pedido os totais valem 0, não nulo', () => {
    const sujo = fatos([pedido('2026-11-03', C1, 100_000, 4, { vendedor_id: V2 }), pedido('2026-11-04', C1, 100_000, 4, { status: 'cancelado' }), pedido('2026-12-01', C1, 100_000, 4)]);
    expect(agregarFatos(sujo, intervalo('2026-11-01', '2026-11-30'))).toEqual({ venda_cents: 0, positivacao: 0, pedidos: 0, itens_distintos: 0 });
  });

  it('RN-CORE-11: o dia da emissão é o do fuso do tenant (2h UTC de 4/11 ainda é 3/11 em Manaus)', () => {
    const noite = fatos([{ ...pedido('2026-11-04', C1, 10_000, 1), emitido_em: '2026-11-04T02:00:00.000Z' }]);
    expect(agregarFatos(noite, intervalo('2026-11-03', '2026-11-03')).pedidos).toBe(1);
    expect(agregarFatos(noite, intervalo('2026-11-04', '2026-11-04')).pedidos).toBe(0);
  });

  it('RN-CORE-21: com a meta de faturamento, a venda é o faturado (data do ERP) menos cancelamento e devolução', () => {
    const fat = fatos([pedido('2026-11-03', C1, 999_999, 1)], [{ vendedor_id: V1, cliente_id: C1, faturado_em: em('2026-11-05'), valor_cents: 200_000, cancelado_cents: 10_000, devolvido_cents: 20_000 }]);
    expect(agregarFatos(fat, intervalo('2026-11-01', '2026-11-30', 'faturamento')).venda_cents).toBe(170_000);
  });
});

describe('RN-CORE-41: calendário do tenant com os feriados cadastrados', () => {
  it('lê os dias úteis e os feriados do tenant; feriado inválido é ignorado; sem parâmetro vale segunda a sábado', () => {
    const p = (chave: string, valor: unknown) => ({ modulo: 'core', chave, valor });
    expect(calendarioComFeriados([])).toEqual({ dias_uteis_semana: [1, 2, 3, 4, 5, 6] });
    expect(calendarioComFeriados([p('metas.dias_uteis_semana', [1, 2, 3, 4, 5]), p('metas.feriados', ['2026-11-20', 'x', 5])])).toEqual({ dias_uteis_semana: [1, 2, 3, 4, 5], feriados: ['2026-11-20'] });
    expect(calendarioComFeriados([p('metas.feriados', 'nada')])).toEqual({ dias_uteis_semana: [1, 2, 3, 4, 5, 6] });
  });
});

describe('realizadoDoServidor: o que o aparelho guarda para recalcular offline', () => {
  /** Fonte falsa: devolve o número de dias do intervalo (venda = dias × 100) para provar quais intervalos foram pedidos. */
  const pedidos: Array<[string, string]> = [];
  const fonte =
    (nulosEm: Array<keyof Agregado> = []) =>
    async (de: string, ate: string): Promise<Agregado> => {
      pedidos.push([de, ate]);
      const dias = de > ate ? 0 : Math.round((Date.parse(ate) - Date.parse(de)) / 86_400_000) + 1;
      const a: Agregado = { venda_cents: dias * 100, positivacao: dias, pedidos: dias, itens_distintos: dias * 5 };
      for (const k of nulosEm) a[k] = null;
      return a;
    };

  it('RN-CORE-42: no mês de hoje, o período vai até hoje e "até ontem" fecha no dia anterior; o resultado cabe no contrato', async () => {
    pedidos.length = 0;
    const r = await realizadoDoServidor(fonte(), { de: '2026-11-01', ate: '2026-11-30', hoje: '2026-11-13', tipo: 'pedido' });
    expect(RealizadoServidorSchema.parse(r)).toMatchObject({ venda_cents: 1300, venda_ate_ontem_cents: 1200, pedidos: 13, pedidos_ate_ontem: 12, itens_distintos: 65, itens_distintos_ate_ontem: 60 });
    expect(r.por_mes).toEqual([{ periodo: '2026-11', venda_cents: 1300, positivacao: 13, pedidos: 13, itens_distintos: 65 }]);
  });

  it('dia 1: "até ontem" não tem dia no mês e vale 0 (com fonte), nunca nulo', async () => {
    const r = await realizadoDoServidor(fonte(), { de: '2026-11-01', ate: '2026-11-30', hoje: '2026-11-01', tipo: 'pedido' });
    expect(r).toMatchObject({ venda_cents: 100, venda_ate_ontem_cents: 0, positivacao_ate_ontem: 0, pedidos_ate_ontem: 0, itens_distintos_ate_ontem: 0 });
  });

  it('período no futuro: 0 quando há fonte (não há dia decorrido), por_mes só até o mês de hoje', async () => {
    const r = await realizadoDoServidor(fonte(), { de: '2026-12-01', ate: '2026-12-31', hoje: '2026-11-13', tipo: 'pedido' });
    expect(r).toMatchObject({ venda_cents: 0, positivacao: 0, pedidos: 0, itens_distintos: 0, por_mes: [] });
  });

  it('vários meses: um bloco por mês até o mês de hoje, cada um limitado ao próprio mês e a hoje', async () => {
    pedidos.length = 0;
    const r = await realizadoDoServidor(fonte(), { de: '2026-09-15', ate: '2026-12-31', hoje: '2026-11-13', tipo: 'pedido' });
    expect(r.por_mes.map((m) => m.periodo)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(r.por_mes.map((m) => m.venda_cents)).toEqual([1600, 3100, 1300]); // 15 a 30/9, 1 a 31/10, 1 a 13/11
  });

  it('sem fonte (nulos) ou fonte parcial (só venda): o que a fonte não sabe segue nulo — nunca zero', async () => {
    const semFonte = await realizadoDoServidor(async () => AGREGADO_VAZIO, { de: '2026-11-01', ate: '2026-11-30', hoje: '2026-11-13', tipo: 'pedido' });
    expect(semFonte).toMatchObject({ venda_cents: null, positivacao: null, pedidos: null, itens_distintos: null, venda_ate_ontem_cents: null });
    const parcial = await realizadoDoServidor(fonte(['positivacao', 'pedidos', 'itens_distintos']), { de: '2026-12-01', ate: '2026-12-31', hoje: '2026-11-13', tipo: 'faturamento' });
    expect(parcial).toMatchObject({ tipo_meta_venda: 'faturamento', venda_cents: 0, positivacao: null, pedidos: null, itens_distintos: null });
  });
});

describe('rotas da Performance', () => {
  it('GET /v1/core/performance: ação meta.ver (todos os perfis do app), query validada pelo contrato', () => {
    expect(rotasDePerformance).toHaveLength(1);
    const r = rotasDePerformance[0]!;
    expect(r).toMatchObject({ metodo: 'GET', caminho: 'performance', acao: 'meta.ver', carteira: 'filtrar_no_dominio' });
    expect(() => r.query!.parse({ de: '2026-11-30', ate: '2026-11-01' })).toThrow(/fim vem antes/);
    expect(() => r.query!.parse({ de: '2025-01-01', ate: '2026-11-01' })).toThrow(/366 dias/);
    expect(() => r.query!.parse({ de: '2026-11-01', ate: '2026-11-30', outro: 1 })).toThrow();
  });
});
