import { describe, expect, it } from 'vitest';
import { exigeAprovacaoPorTituloVencido, pagamentoDoClienteDoErp, financeiroDoCliente, pagamentoPermitidoAoCliente, PRAZO_TITULO_VENCIDO_PADRAO_DIAS } from './pagamento-cliente';

const fin = { limite_cents: 1_000_000, saldo_aberto_cents: 300_000, credito_disponivel_cents: null, bloqueado: false, motivo_bloqueio: null, atualizado_erp_em: '2026-11-05T12:00:00.000Z' };
const aberto = (vencimento: string, saldo_cents: number) => ({ vencimento, saldo_cents, situacao: 'aberto' as const });

describe('financeiroDoCliente (RN-VEN-12/13)', () => {
  it('RN-VEN-12: sem linha financeira devolve null (o card mostra "Sem dados de crédito")', () => {
    expect(financeiroDoCliente(null, [], '2026-11-06')).toBeNull();
  });
  it('RN-VEN-12: crédito do ERP nulo fica nulo (o Vendedor calcula limite − saldo)', () => {
    const r = financeiroDoCliente(fin, [], '2026-11-06')!;
    expect(r).toMatchObject({ limite_cents: 1_000_000, saldo_aberto_cents: 300_000, credito_disponivel_erp_cents: null, vencidos_qtd: 0, vencidos_cents: 0, maior_atraso_dias: 0 });
  });
  it('RN-VEN-12: crédito do ERP, quando vem, é repassado', () => {
    expect(financeiroDoCliente({ ...fin, credito_disponivel_cents: 650_000 }, [], '2026-11-06')!.credito_disponivel_erp_cents).toBe(650_000);
  });
  it('RN-VEN-13: conta vencidos, soma o saldo e dá o maior atraso; vence hoje ainda não é vencido', () => {
    const r = financeiroDoCliente(fin, [aberto('2026-10-27', 10_000), aberto('2026-11-01', 5_000), aberto('2026-11-06', 7_000), { ...aberto('2026-09-01', 9_000), situacao: 'liquidado' }], '2026-11-06')!;
    expect(r).toMatchObject({ vencidos_qtd: 2, vencidos_cents: 15_000, maior_atraso_dias: 10 });
  });
  it('RN-VEN-13: devolve atualizado_erp_em e o motivo do bloqueio', () => {
    const r = financeiroDoCliente({ ...fin, bloqueado: true, motivo_bloqueio: 'Inadimplência' }, [], '2026-11-06')!;
    expect(r).toMatchObject({ bloqueado: true, motivo_bloqueio: 'Inadimplência', atualizado_erp_em: '2026-11-05T12:00:00.000Z' });
  });
});

describe('exigeAprovacaoPorTituloVencido (RN-VEN-13)', () => {
  it('RN-VEN-13: padrão de 5 dias', () => expect(PRAZO_TITULO_VENCIDO_PADRAO_DIAS).toBe(5));
  it('RN-VEN-13: vencido há mais de 5 dias e prazo a prazo exige aprovação', () => {
    expect(exigeAprovacaoPorTituloVencido({ maior_atraso_dias: 6, prazo_medio_dias: 28 })).toBe(true);
  });
  it('RN-VEN-13: exatamente 5 dias de atraso ainda não exige', () => {
    expect(exigeAprovacaoPorTituloVencido({ maior_atraso_dias: 5, prazo_medio_dias: 28 })).toBe(false);
  });
  it('RN-VEN-13: à vista (prazo médio 0) segue sem aprovação', () => {
    expect(exigeAprovacaoPorTituloVencido({ maior_atraso_dias: 45, prazo_medio_dias: 0 })).toBe(false);
  });
  it('RN-VEN-13: respeita o limite do parâmetro titulo_vencido_dias', () => {
    expect(exigeAprovacaoPorTituloVencido({ maior_atraso_dias: 11, prazo_medio_dias: 7, limite_dias: 10 })).toBe(true);
    expect(exigeAprovacaoPorTituloVencido({ maior_atraso_dias: 10, prazo_medio_dias: 7, limite_dias: 10 })).toBe(false);
  });
});

describe('pagamentoPermitidoAoCliente (RN-VEN-25)', () => {
  const ok = { forma_codigo: 'BOLETO', prazo_medio_dias: 42 };
  it('RN-VEN-25: cliente sem restrição aceita qualquer forma e prazo', () => {
    expect(pagamentoPermitidoAoCliente({ formas_pagamento: null, prazo_medio_max_dias: null }, ok)).toEqual({ ok: true });
    expect(pagamentoPermitidoAoCliente({ formas_pagamento: [], prazo_medio_max_dias: undefined }, ok)).toEqual({ ok: true });
  });
  it('RN-VEN-25: forma fora da lista do cliente é recusada', () => {
    const r = pagamentoPermitidoAoCliente({ formas_pagamento: ['PIX'], prazo_medio_max_dias: null }, ok);
    expect(r).toMatchObject({ ok: false, regra: 'RN-VEN-25', motivo: 'forma_nao_permitida' });
  });
  it('RN-VEN-25: prazo médio acima do máximo é recusado; igual ao máximo passa', () => {
    expect(pagamentoPermitidoAoCliente({ formas_pagamento: null, prazo_medio_max_dias: 30 }, ok)).toMatchObject({ ok: false, motivo: 'prazo_acima_do_maximo' });
    expect(pagamentoPermitidoAoCliente({ formas_pagamento: null, prazo_medio_max_dias: 42 }, ok)).toEqual({ ok: true });
  });
  it('RN-VEN-25: prazo médio máximo 0 só aceita à vista', () => {
    expect(pagamentoPermitidoAoCliente({ formas_pagamento: null, prazo_medio_max_dias: 0 }, { forma_codigo: 'PIX', prazo_medio_dias: 0 })).toEqual({ ok: true });
    expect(pagamentoPermitidoAoCliente({ formas_pagamento: null, prazo_medio_max_dias: 0 }, { forma_codigo: 'PIX', prazo_medio_dias: 1 })).toMatchObject({ ok: false });
  });
  it('RN-VEN-25: código da forma é comparado sem diferenciar maiúsculas', () => {
    expect(pagamentoPermitidoAoCliente({ formas_pagamento: ['boleto'], prazo_medio_max_dias: null }, ok)).toEqual({ ok: true });
  });
});

describe('pagamentoDoClienteDoErp (RN-VEN-25, integracao.cliente.atualizado@1)', () => {
  it('RN-VEN-25: campos ausentes não alteram nada', () => {
    expect(pagamentoDoClienteDoErp({})).toEqual({});
  });
  it('RN-VEN-25: null ou lista vazia limpam as formas; null limpa o prazo médio máximo', () => {
    expect(pagamentoDoClienteDoErp({ prazo_medio_max_dias: null, formas_pagamento: [] })).toEqual({ prazo_medio_max_dias: null, formas_pagamento: null });
    expect(pagamentoDoClienteDoErp({ formas_pagamento: null })).toEqual({ formas_pagamento: null });
  });
  it('RN-VEN-25: normaliza os códigos (maiúsculas, sem repetir, sem vazios, até 20)', () => {
    expect(pagamentoDoClienteDoErp({ prazo_medio_max_dias: 45, formas_pagamento: [' pix ', 'PIX', '', 'boleto'] })).toEqual({ prazo_medio_max_dias: 45, formas_pagamento: ['PIX', 'BOLETO'] });
  });
  it('RN-VEN-25: prazo fora de 0..365 ou não inteiro é descartado (fica sem alterar)', () => {
    expect(pagamentoDoClienteDoErp({ prazo_medio_max_dias: 400 })).toEqual({});
    expect(pagamentoDoClienteDoErp({ prazo_medio_max_dias: 3.5 })).toEqual({});
  });
});
