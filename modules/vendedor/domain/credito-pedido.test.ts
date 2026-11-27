import { describe, expect, it } from 'vitest';
import { aprovacoesFinanceiras, creditoExcedido, disponivelParaAlerta, exigeAprovacaoPorCredito, soOrcamentoPorCredito, exigeAprovacaoPorInadimplencia, limiteInformadoPeloErp, motivosFinanceirosDoPedido } from './credito-pedido';

const base = { prazo_medio_dias: 28, total_cents: 10_000, limite_informado: true, disponivel_cents: 10_000 };

describe('RN-VEN-12: crédito estourado manda o pedido para aprovação (T-0184, P-6)', () => {
  it('RN-VEN-12: crédito disponível um centavo abaixo do total vai para aprovação', () => {
    expect(exigeAprovacaoPorCredito({ ...base, disponivel_cents: 9_999 })).toBe(true);
  });
  it('RN-VEN-12: crédito disponível igual ao total não vai', () => {
    expect(exigeAprovacaoPorCredito(base)).toBe(false);
    expect(exigeAprovacaoPorCredito({ ...base, disponivel_cents: 10_001 })).toBe(false);
  });
  it('RN-VEN-12: pedido à vista (prazo médio 0) nunca vai por crédito, nem sem limite', () => {
    expect(exigeAprovacaoPorCredito({ ...base, prazo_medio_dias: 0, disponivel_cents: 0 })).toBe(false);
    expect(exigeAprovacaoPorCredito({ ...base, prazo_medio_dias: 0, limite_informado: false })).toBe(false);
  });
  it('RN-VEN-12: cliente sem limite informado pelo ERP é sem restrição: nenhum motivo de crédito e nenhuma recusa, para cada ação do tenant', () => {
    for (const acao of ['aprovacao', 'orcamento', 'avisar'] as const) {
      const e = { ...base, limite_informado: false, disponivel_cents: 0, acao };
      expect(creditoExcedido(e)).toBe(false);
      expect(exigeAprovacaoPorCredito(e)).toBe(false);
      expect(soOrcamentoPorCredito(e)).toBe(false);
      expect(motivosFinanceirosDoPedido({ ...e, maior_atraso_dias: 0, limite_dias: 5 })).toEqual([]);
      expect(aprovacoesFinanceiras({ prazo_medio_dias: 28, total_cents: 10_000, financeiro: { limite_informado: false, disponivel_cents: 0, maior_atraso_dias: 0, limite_dias: 5 }, niveis: { credito: 'gerente', inadimplencia: 'gerente' }, acao_credito: acao })).toEqual([]);
    }
  });
  it('RN-VEN-12: com limite informado e estourado vale cada ação (aprovação, só orçamento, aviso)', () => {
    const e = { ...base, disponivel_cents: 9_999 };
    expect(exigeAprovacaoPorCredito({ ...e, acao: 'aprovacao' })).toBe(true);
    expect(soOrcamentoPorCredito({ ...e, acao: 'orcamento' })).toBe(true);
    expect(exigeAprovacaoPorCredito({ ...e, acao: 'avisar' })).toBe(false);
  });
  it('RN-VEN-12: limite 0 e limite ausente, sem disponível do ERP, contam como não informado e não restringem o crédito', () => {
    expect(limiteInformadoPeloErp({ limite_cents: 0, credito_disponivel_erp_cents: null })).toBe(false);
    expect(limiteInformadoPeloErp({ limite_cents: 1, credito_disponivel_erp_cents: null })).toBe(true);
    expect(limiteInformadoPeloErp({ limite_cents: 0, credito_disponivel_erp_cents: 0 })).toBe(true);
    for (const limite_informado of [limiteInformadoPeloErp({ limite_cents: 0, credito_disponivel_erp_cents: null }), false]) {
      expect(exigeAprovacaoPorCredito({ ...base, limite_informado, disponivel_cents: 0 })).toBe(false);
    }
  });
  it('RN-VEN-12: disponível negativo e total zero não geram falso positivo além da regra', () => {
    expect(exigeAprovacaoPorCredito({ ...base, disponivel_cents: -500 })).toBe(true);
    expect(exigeAprovacaoPorCredito({ ...base, total_cents: 0, disponivel_cents: 0 })).toBe(false);
  });
});

describe('RN-VEN-13: inadimplência manda para aprovação, também à vista (P1 A)', () => {
  it('RN-VEN-13: atraso acima do limite vai; no limite ou abaixo não', () => {
    expect(exigeAprovacaoPorInadimplencia({ maior_atraso_dias: 6, limite_dias: 5 })).toBe(true);
    expect(exigeAprovacaoPorInadimplencia({ maior_atraso_dias: 5, limite_dias: 5 })).toBe(false);
    expect(exigeAprovacaoPorInadimplencia({ maior_atraso_dias: 0, limite_dias: 5 })).toBe(false);
  });
  it('RN-VEN-13 (P1 A): inadimplente com pedido à vista também vai (o prazo não entra na conta)', () => {
    expect(motivosFinanceirosDoPedido({ ...base, prazo_medio_dias: 0, maior_atraso_dias: 12, limite_dias: 5 })).toEqual(['inadimplencia']);
  });
});

describe('RN-VEN-12 e RN-VEN-13: motivos separados, um por aprovação (P3 B)', () => {
  it('RN-VEN-13: crédito e inadimplência juntos geram os dois motivos, crédito primeiro', () => {
    expect(motivosFinanceirosDoPedido({ ...base, disponivel_cents: 0, maior_atraso_dias: 12, limite_dias: 5 })).toEqual(['credito', 'inadimplencia']);
  });
  it('RN-VEN-12: tudo em ordem = nenhum motivo', () => {
    expect(motivosFinanceirosDoPedido({ ...base, maior_atraso_dias: 0, limite_dias: 5 })).toEqual([]);
  });
});

describe('RN-VEN-12: o aviso offline não bloqueia o envio', () => {
  it('RN-VEN-12: à vista não mostra o aviso de crédito; a prazo sem limite informado também não mostra (sem restrição)', () => {
    expect(disponivelParaAlerta({ prazo_medio_dias: 0, limite_informado: true, disponivel_cents: 0 })).toBeNull();
    expect(disponivelParaAlerta({ prazo_medio_dias: 28, limite_informado: false, disponivel_cents: 5_000 })).toBeNull();
    expect(disponivelParaAlerta({ prazo_medio_dias: 28, limite_informado: true, disponivel_cents: 5_000 })).toBe(5_000);
    expect(disponivelParaAlerta({ prazo_medio_dias: undefined, limite_informado: true, disponivel_cents: 5_000 })).toBe(5_000);
  });
});

describe('RN-VEN-12 (P-6): a ação do tenant para o crédito excedido', () => {
  const estourado = { ...base, disponivel_cents: 9_999 };
  const financeiro = { limite_informado: true, disponivel_cents: 9_999, maior_atraso_dias: 0, limite_dias: 5 };
  const niveis = { credito: 'gerente', inadimplencia: 'gerente' } as const;
  it('RN-VEN-12: sem ação informada vale aprovacao (o comportamento de antes)', () => {
    expect(exigeAprovacaoPorCredito(estourado)).toBe(true);
    expect(exigeAprovacaoPorCredito({ ...estourado, acao: 'aprovacao' })).toBe(true);
  });
  it('RN-VEN-12: orcamento e avisar não mandam para aprovação, mas o crédito segue excedido', () => {
    for (const acao of ['orcamento', 'avisar'] as const) {
      expect(exigeAprovacaoPorCredito({ ...estourado, acao })).toBe(false);
      expect(creditoExcedido({ ...estourado, acao })).toBe(true);
    }
    expect(creditoExcedido(base)).toBe(false);
  });
  it('RN-VEN-12: só a ação orcamento deixa o pedido só como orçamento; à vista e dentro do limite nunca', () => {
    expect(soOrcamentoPorCredito({ ...estourado, acao: 'orcamento' })).toBe(true);
    expect(soOrcamentoPorCredito({ ...estourado, acao: 'avisar' })).toBe(false);
    expect(soOrcamentoPorCredito({ ...estourado, acao: 'aprovacao' })).toBe(false);
    expect(soOrcamentoPorCredito({ ...estourado, acao: 'orcamento', prazo_medio_dias: 0 })).toBe(false);
    expect(soOrcamentoPorCredito({ ...base, acao: 'orcamento' })).toBe(false);
  });
  it('RN-VEN-12: os motivos financeiros só trazem crédito com a ação aprovacao; a inadimplência segue', () => {
    const f = { ...estourado, maior_atraso_dias: 9, limite_dias: 5 };
    expect(motivosFinanceirosDoPedido(f)).toEqual(['credito', 'inadimplencia']);
    expect(motivosFinanceirosDoPedido({ ...f, acao: 'avisar' })).toEqual(['inadimplencia']);
    expect(motivosFinanceirosDoPedido({ ...f, acao: 'orcamento' })).toEqual(['inadimplencia']);
  });
  it('RN-VEN-12: o servidor abre a aprovação de crédito só com a ação aprovacao', () => {
    const entrada = { prazo_medio_dias: 28, total_cents: 10_000, financeiro, niveis };
    expect(aprovacoesFinanceiras(entrada).map((a) => a.motivo)).toEqual(['credito']);
    expect(aprovacoesFinanceiras({ ...entrada, acao_credito: 'aprovacao' }).map((a) => a.motivo)).toEqual(['credito']);
    expect(aprovacoesFinanceiras({ ...entrada, acao_credito: 'avisar' })).toEqual([]);
    expect(aprovacoesFinanceiras({ ...entrada, acao_credito: 'orcamento' })).toEqual([]);
  });
});
