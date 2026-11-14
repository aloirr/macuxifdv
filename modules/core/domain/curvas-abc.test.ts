import { describe, expect, it } from 'vitest';

import { curvaPelaVariacao, curvasAbcDoCliente, FAIXAS_CURVA_ABC_PADRAO, faixasCurvaAbcDasLinhas, PARAMETROS_CURVA_ABC_PADRAO, totalDoMes, validarParametrosCurvaAbc } from './curvas-abc';

const h = (ano_mes: string, valor_cents: number, itens: number, pedidos: number, origem: 'erp' | 'macuxi' = 'erp') => ({ ano_mes, valor_cents, itens, pedidos, origem });
const F = FAIXAS_CURVA_ABC_PADRAO;
const P = PARAMETROS_CURVA_ABC_PADRAO;

describe('RN-CORE-49: curvas ABC do cliente (faturamento, volume, frequência)', () => {
  it('RN-CORE-49: padrão é A a partir de +20% e C abaixo da média (0%)', () => {
    expect(F).toEqual({ a_min_pct: 20, b_min_pct: 0 });
    expect(P).toEqual({ faturamento: F, volume: F, frequencia: F });
  });
  it('RN-CORE-49: variação ≥ +20% = A; de 0% (na média) até abaixo de +20% = B; abaixo de 0% = C', () => {
    expect(curvaPelaVariacao(20, F)).toBe('A');
    expect(curvaPelaVariacao(19.9, F)).toBe('B');
    expect(curvaPelaVariacao(0, F)).toBe('B');
    expect(curvaPelaVariacao(-0.1, F)).toBe('C');
  });
  it('RN-CORE-49: compara o mês atual com a média dos 3 meses anteriores, por dimensão', () => {
    const hist = [h('2026-08', 10000, 10, 3), h('2026-09', 10000, 10, 3), h('2026-10', 10000, 10, 3), h('2026-11', 15000, 9, 1)];
    expect(curvasAbcDoCliente(hist, '2026-11-14', P)).toEqual([
      { dimensao: 'faturamento', curva: 'A', rotulo: 'Faturamento A' },
      { dimensao: 'volume', curva: 'C', rotulo: 'Volume C' },
      { dimensao: 'frequencia', curva: 'C', rotulo: 'Frequência C' },
    ]);
  });
  it('RN-CORE-49: soma ERP e Macuxi do mesmo mês; mês sem linha vale zero na média', () => {
    const hist = [h('2026-08', 30000, 3, 3), h('2026-10', 15000, 3, 3, 'erp'), h('2026-10', 15000, 3, 3, 'macuxi'), h('2026-11', 20000, 3, 3)];
    // média = (30000 + 0 + 30000) / 3 = 20000 → 0% → B
    expect(curvasAbcDoCliente(hist, '2026-11-02', P)[0]).toMatchObject({ dimensao: 'faturamento', curva: 'B' });
  });
  it('RN-CORE-49: sem histórico até o 3º mês anterior, sem curva', () => {
    expect(curvasAbcDoCliente([h('2026-09', 100, 1, 1), h('2026-11', 100, 1, 1)], '2026-11-14', P)).toEqual([]);
    expect(curvasAbcDoCliente([], '2026-11-14', P)).toEqual([]);
  });
  it('RN-CORE-49: média zero numa dimensão não gera a curva dela', () => {
    const hist = [h('2026-08', 0, 0, 0), h('2026-10', 1000, 5, 2), h('2026-11', 5000, 5, 2)];
    const r = curvasAbcDoCliente(hist, '2026-11-14', P);
    expect(r.map((x) => x.dimensao)).toEqual(['faturamento', 'volume', 'frequencia']);
    expect(curvasAbcDoCliente([h('2026-08', 0, 0, 0), h('2026-11', 5000, 5, 2)], '2026-11-14', P)).toEqual([]);
  });
  it('RN-CORE-49: virada de ano usa dezembro, novembro e outubro de 2025', () => {
    const hist = [h('2025-10', 3000, 3, 3), h('2025-11', 3000, 3, 3), h('2025-12', 3000, 3, 3), h('2026-01', 9000, 3, 3)];
    expect(curvasAbcDoCliente(hist, '2026-01-10', P)[0]).toMatchObject({ curva: 'A' });
  });
  it('RN-CORE-49: cada dimensão usa a própria faixa', () => {
    const hist = [h('2026-08', 10000, 10, 10), h('2026-09', 10000, 10, 10), h('2026-10', 10000, 10, 10), h('2026-11', 11500, 11500 / 1000, 5)];
    const p = { faturamento: { a_min_pct: 10, b_min_pct: 5 }, volume: { a_min_pct: 20, b_min_pct: 0 }, frequencia: { a_min_pct: 20, b_min_pct: -60 } };
    expect(curvasAbcDoCliente(hist, '2026-11-14', p).map((x) => x.curva)).toEqual(['A', 'B', 'B']);
  });
  it('RN-CORE-49: variação igual a b_min é B; abaixo de b_min é C', () => {
    expect(curvaPelaVariacao(-10, { a_min_pct: 20, b_min_pct: -10 })).toBe('B');
    expect(curvaPelaVariacao(-10.1, { a_min_pct: 20, b_min_pct: -10 })).toBe('C');
  });
  it('RN-CORE-49: faixas do tenant vêm das chaves cliente.curva_abc.<dimensão>; cada dimensão inválida cai no padrão sozinha', () => {
    const l = (chave: string, valor: unknown, deleted_at: string | null = null) => ({ modulo: 'core', chave, valor, deleted_at });
    expect(faixasCurvaAbcDasLinhas([])).toEqual(P);
    expect(faixasCurvaAbcDasLinhas([l('cliente.curva_abc.volume', { a_min_pct: 30, b_min_pct: -10 })])).toEqual({ ...P, volume: { a_min_pct: 30, b_min_pct: -10 } });
    expect(faixasCurvaAbcDasLinhas([l('cliente.curva_abc.volume', { a_min_pct: 30, b_min_pct: -10 }), l('cliente.curva_abc.frequencia', { a_min_pct: 'x', b_min_pct: 0 })])).toEqual({ ...P, volume: { a_min_pct: 30, b_min_pct: -10 } });
    expect(faixasCurvaAbcDasLinhas([l('cliente.curva_abc.faturamento', { a_min_pct: 30, b_min_pct: 1 }, '2026-01-01T00:00:00Z')])).toEqual(P);
    expect(faixasCurvaAbcDasLinhas([l('cliente.curva_abc.faturamento', { a_min_pct: 5000, b_min_pct: 0 })])).toEqual(P);
    expect(faixasCurvaAbcDasLinhas([l('cliente.curva_abc.faturamento', { a_min_pct: 5, b_min_pct: 5 })])).toEqual(P);
    expect(faixasCurvaAbcDasLinhas([l('cliente.curva_abc.faturamento', 30)])).toEqual(P);
  });
  it('RN-CORE-49: validar rejeita A ≤ B e fora de −100..1000, apontando o campo, em português', () => {
    expect(validarParametrosCurvaAbc(P)).toEqual({ ok: true, valores: P });
    const r = validarParametrosCurvaAbc({ ...P, volume: { a_min_pct: 5, b_min_pct: 5 }, frequencia: { a_min_pct: 2000, b_min_pct: 0 } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erros.map((e) => e.campo)).toEqual(['volume.a_min_pct', 'frequencia.a_min_pct']);
      expect(r.erros[0]!.mensagem).toContain('Aumente');
    }
  });
  it('RN-CORE-49: total do mês soma as linhas do mês (ERP + Macuxi)', () => {
    const hist = [h('2026-11', 100, 1, 1), h('2026-11', 50, 1, 1, 'macuxi'), h('2026-10', 999, 1, 1)];
    expect(totalDoMes(hist, '2026-11')).toBe(150);
    expect(totalDoMes([], '2026-11')).toBe(0);
  });
});
