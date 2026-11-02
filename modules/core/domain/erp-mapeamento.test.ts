import { describe, expect, it } from 'vitest';
import { datasDaRotaErp, emailDoVendedorErp, planejarParadasErp, situacaoTituloDoErp } from './erp-mapeamento';

describe('RN-INT-04/06: rota do ERP vira rotas datadas do Core', () => {
  it('RN-INT-06: rota com dia da semana gera as próximas ocorrências a partir de hoje (inclusive), no calendário do tenant', () => {
    // 2026-11-02 é segunda-feira (1); a rota de quarta (3) cai em 04/11, 11/11, 18/11, 25/11
    expect(datasDaRotaErp(3, '2026-11-02', 4)).toEqual(['2026-11-04', '2026-11-11', '2026-11-18', '2026-11-25']);
    expect(datasDaRotaErp(1, '2026-11-02', 2)).toEqual(['2026-11-02', '2026-11-09']);
  });
  it('RN-INT-06: rota sem dia fixo vale só para hoje', () => {
    expect(datasDaRotaErp(null, '2026-11-02', 4)).toEqual(['2026-11-02']);
    expect(datasDaRotaErp(undefined, '2026-11-02', 4)).toEqual(['2026-11-02']);
  });
  it('RN-INT-04: paradas ordenadas por ordem, sem cliente repetido (vale a última citação) e renumeradas de 1', () => {
    const r = planejarParadasErp([
      { ordem: 5, cliente_external_id: 'C3' },
      { ordem: 1, cliente_external_id: 'C1' },
      { ordem: 3, cliente_external_id: 'C2' },
      { ordem: 7, cliente_external_id: 'C1' },
    ]);
    expect(r).toEqual([
      { sequencia: 1, cliente_external_id: 'C2' },
      { sequencia: 2, cliente_external_id: 'C3' },
      { sequencia: 3, cliente_external_id: 'C1' },
    ]);
  });
});

describe('RN-INT-02: título e vendedor do ERP', () => {
  it('título baixado vira liquidado; aberto e cancelado seguem iguais', () => {
    expect(situacaoTituloDoErp('baixado')).toBe('liquidado');
    expect(situacaoTituloDoErp('aberto')).toBe('aberto');
    expect(situacaoTituloDoErp('cancelado')).toBe('cancelado');
  });
  it('vendedor sem e-mail válido recebe e-mail provisório estável e válido para a coluna', () => {
    const a = emailDoVendedorErp(undefined, 'V-001');
    expect(a.provisorio).toBe(true);
    expect(a.email).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    expect(emailDoVendedorErp('xx', 'V-001').email).toBe(a.email);
    expect(emailDoVendedorErp(undefined, 'V-002').email).not.toBe(a.email);
    expect(emailDoVendedorErp(' Ana@Loja.com.br ', 'V-001')).toEqual({ email: 'ana@loja.com.br', provisorio: false });
  });
});
