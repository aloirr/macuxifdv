import { describe, expect, it } from 'vitest';
import { corDaPositivacao, mascararDocumentoDoFarol, corDoCliente, diasSemCompraDoFarol, ordenarClientesDoFarol, parametrosFarolDasLinhas, PARAMETROS_FAROL_PADRAO, resumirFarol, validarParametrosFarol } from './farol';

const P = PARAMETROS_FAROL_PADRAO;
const cor = (dias: number | null, positivado_mes = false) => corDoCliente({ dias_sem_compra: dias, positivado_mes }, P);

describe('RN-CORE-28: farol de clientes', () => {
  it('RN-CORE-28: padrão 30/45 dias e 70%/50% de positivação', () => {
    expect(P).toEqual({ verde_ate_dias: 30, amarelo_ate_dias: 45, positivacao_verde_pct: 70, positivacao_amarelo_pct: 50 });
  });
  it('RN-CORE-28: limites exatos do cliente (30 verde, 31 amarelo, 45 amarelo, 46 vermelho)', () => {
    expect([cor(0), cor(30), cor(31), cor(45), cor(46)]).toEqual(['verde', 'verde', 'amarelo', 'amarelo', 'vermelho']);
  });
  it('RN-CORE-28: positivado no mês é verde sempre, mesmo com 90 dias sem compra', () => {
    expect(cor(90, true)).toBe('verde');
    expect(cor(null, true)).toBe('verde');
  });
  it('RN-CORE-28: sem compra registrada fica "sem_compra" (cinza), não vermelho', () => {
    expect(cor(null)).toBe('sem_compra');
  });
  it('RN-CORE-28: usa os parâmetros do tenant', () => {
    const p = { ...P, verde_ate_dias: 10, amarelo_ate_dias: 20 };
    const c = (d: number) => corDoCliente({ dias_sem_compra: d, positivado_mes: false }, p);
    expect([c(10), c(11), c(21)]).toEqual(['verde', 'amarelo', 'vermelho']);
  });
  it('RN-CORE-28: dias sem compra vêm da mesma função do Cliente 360 (resumoCompras)', () => {
    const h = [{ ano_mes: '2026-10', valor_cents: 100, pedidos: 1, ultima_compra_em: '2026-10-02' }];
    expect(diasSemCompraDoFarol(h, '2026-10-12')).toEqual({ ultima_compra_em: '2026-10-02', dias_sem_compra: 10 });
    expect(diasSemCompraDoFarol([], '2026-10-12')).toEqual({ ultima_compra_em: null, dias_sem_compra: null });
  });
  it('RN-CORE-28: cor do vendedor/equipe pela positivação (70% verde, 50% amarelo, abaixo vermelho; limites inclusos)', () => {
    expect([corDaPositivacao(7, 10, P), corDaPositivacao(69, 100, P), corDaPositivacao(5, 10, P), corDaPositivacao(49, 100, P), corDaPositivacao(0, 3, P)]).toEqual(['verde', 'amarelo', 'amarelo', 'vermelho', 'vermelho']);
  });
  it('RN-CORE-28: carteira vazia não tem cor', () => {
    expect(corDaPositivacao(0, 0, P)).toBeNull();
  });
  it('RN-CORE-28: resumo conta o cliente de dois vendedores uma vez no total e uma vez em cada vendedor', () => {
    const r = resumirFarol(
      [
        { cliente_id: 'c1', usuario_id: 'v1', dias_sem_compra: 5, positivado_mes: true },
        { cliente_id: 'c1', usuario_id: 'v2', dias_sem_compra: 5, positivado_mes: true },
        { cliente_id: 'c2', usuario_id: 'v1', dias_sem_compra: 50, positivado_mes: false },
        { cliente_id: 'c3', usuario_id: 'v2', dias_sem_compra: null, positivado_mes: false },
      ],
      P,
    );
    expect(r.resumo).toEqual({ carteira: 3, positivados: 1, positivacao_pct: 3333, cor: 'vermelho', por_cor: { verde: 1, amarelo: 0, vermelho: 1, sem_compra: 1 } });
    expect(r.vendedores.map((v) => [v.usuario_id, v.carteira, v.positivados, v.positivacao_pct, v.cor])).toEqual([
      ['v1', 2, 1, 5000, 'amarelo'],
      ['v2', 2, 1, 5000, 'amarelo'],
    ]);
    expect(r.vendedores[0]?.por_cor).toEqual({ verde: 1, amarelo: 0, vermelho: 1, sem_compra: 0 });
  });
  it('RN-CORE-28: resumo de carteira vazia', () => {
    expect(resumirFarol([], P).resumo).toEqual({ carteira: 0, positivados: 0, positivacao_pct: 0, cor: null, por_cor: { verde: 0, amarelo: 0, vermelho: 0, sem_compra: 0 } });
  });
  it('RN-CORE-28: lista ordena vermelho primeiro, depois mais dias sem compra', () => {
    const itens = [
      { nome: 'A', cor: 'verde' as const, dias_sem_compra: 2 },
      { nome: 'B', cor: 'vermelho' as const, dias_sem_compra: 50 },
      { nome: 'C', cor: 'vermelho' as const, dias_sem_compra: 90 },
      { nome: 'D', cor: 'amarelo' as const, dias_sem_compra: 40 },
    ];
    expect(ordenarClientesDoFarol(itens).map((i) => i.nome)).toEqual(['C', 'B', 'D', 'A']);
  });
  it('RN-CORE-28: sem linha vale o padrão; chave inválida ou removida cai no padrão sozinha', () => {
    expect(parametrosFarolDasLinhas([])).toEqual(P);
    const r = parametrosFarolDasLinhas([
      { modulo: 'core', chave: 'farol.verde_ate_dias', valor: 20 },
      { modulo: 'core', chave: 'farol.amarelo_ate_dias', valor: 'x' },
      { modulo: 'core', chave: 'farol.positivacao_verde_pct', valor: 80, deleted_at: '2026-11-01T00:00:00Z' },
      { modulo: 'vendedor', chave: 'farol.positivacao_amarelo_pct', valor: 10 },
    ]);
    expect(r).toEqual({ verde_ate_dias: 20, amarelo_ate_dias: 45, positivacao_verde_pct: 70, positivacao_amarelo_pct: 50 });
  });
  it('RN-CORE-28: combinação incoerente gravada (verde ≥ amarelo) volta ao padrão inteiro', () => {
    const r = parametrosFarolDasLinhas([
      { modulo: 'core', chave: 'farol.verde_ate_dias', valor: 60 },
      { modulo: 'core', chave: 'farol.amarelo_ate_dias', valor: 40 },
    ]);
    expect(r).toEqual(P);
  });
  it('RN-CORE-28: validação aceita o padrão e valores nos limites', () => {
    expect(validarParametrosFarol(P)).toEqual({ ok: true, valores: P });
    expect(validarParametrosFarol({ verde_ate_dias: 1, amarelo_ate_dias: 365, positivacao_verde_pct: 100, positivacao_amarelo_pct: 0 }).ok).toBe(true);
  });
  it('RN-CORE-28: verde ≥ amarelo (dias) é recusado no campo certo, com a ação seguinte', () => {
    const r = validarParametrosFarol({ ...P, verde_ate_dias: 45 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erros.map((e) => e.campo)).toEqual(['amarelo_ate_dias']);
      expect(r.erros[0]?.mensagem).toMatch(/maior que/);
    }
  });
  it('RN-CORE-28: positivação amarelo ≥ verde, fora de 0..100, decimal ou dias fora de 1..365 são recusados', () => {
    expect(validarParametrosFarol({ ...P, positivacao_amarelo_pct: 70 }).ok).toBe(false);
    expect(validarParametrosFarol({ ...P, positivacao_verde_pct: 101 }).ok).toBe(false);
    expect(validarParametrosFarol({ ...P, positivacao_amarelo_pct: -1 }).ok).toBe(false);
    expect(validarParametrosFarol({ ...P, verde_ate_dias: 0 }).ok).toBe(false);
    expect(validarParametrosFarol({ ...P, amarelo_ate_dias: 366 }).ok).toBe(false);
    expect(validarParametrosFarol({ ...P, verde_ate_dias: 10.5 }).ok).toBe(false);
    expect(validarParametrosFarol({ ...P, verde_ate_dias: Number.NaN }).ok).toBe(false);
  });
  it('RN-CORE-28: documento sai mascarado na lista (CPF só o miolo, CNPJ sem filial e dígito)', () => {
    expect(mascararDocumentoDoFarol('123.456.789-01')).toBe('***.456.789-**');
    expect(mascararDocumentoDoFarol('12345678000199')).toBe('12.345.678/****-**');
    expect(mascararDocumentoDoFarol('123')).toBeNull();
    expect(mascararDocumentoDoFarol(null)).toBeNull();
  });
});
