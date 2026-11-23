import { describe, expect, it } from 'vitest';
import { camposAusentesEmTodas, caminhoRelativoSeguro, dataBrParaPartes, dataHoraLocalParaUtc, montarUrl, numeroOuNull, reaisParaCentavos, simNao, textoOuNull } from './conversao';

describe('conversões dos adaptadores de ERP', () => {
  it('dinheiro em centavos inteiros, sem erro de ponto flutuante', () => {
    expect(reaisParaCentavos(10.5)).toBe(1050);
    expect(reaisParaCentavos('1234.56')).toBe(123456);
    expect(reaisParaCentavos(1.005)).toBe(101);
    expect(reaisParaCentavos(0.1 + 0.2)).toBe(30);
    expect(reaisParaCentavos(null)).toBeNull();
    expect(reaisParaCentavos('abc')).toBeNull();
  });

  it('§9 risco 9: data e hora locais do ERP viram UTC com o fuso informado (Manaus UTC−4, São Paulo UTC−3)', () => {
    expect(dataHoraLocalParaUtc('2026-11-20', '14:35:00', 'America/Manaus')).toBe('2026-11-20T18:35:00.000Z');
    expect(dataHoraLocalParaUtc('2026-11-20', '14:35', 'America/Sao_Paulo')).toBe('2026-11-20T17:35:00.000Z');
    expect(dataHoraLocalParaUtc('2026-11-20', null, 'America/Manaus')).toBe('2026-11-20T04:00:00.000Z');
    expect(dataHoraLocalParaUtc('2026-11-20T00:00:00Z', '23:59:59', 'America/Manaus')).toBe('2026-11-21T03:59:59.000Z');
    expect(dataHoraLocalParaUtc('20/11/2026', '10:00', 'America/Manaus')).toBeNull();
    expect(dataHoraLocalParaUtc('2026-11-20', 'xx', 'America/Manaus')).toBeNull();
    expect(dataHoraLocalParaUtc('2026-11-20', '10:00', 'Fuso/Inexistente')).toBeNull();
  });

  it('data da Sankhya dd/MM/yyyy HH:mm:ss', () => {
    expect(dataBrParaPartes('20/11/2026 14:35:10')).toEqual({ data: '2026-11-20', hora: '14:35:10' });
    expect(dataBrParaPartes('20/11/2026')).toEqual({ data: '2026-11-20', hora: null });
    expect(dataBrParaPartes('2026-11-20')).toBeNull();
  });

  it('sim/não dos ERPs e textos', () => {
    expect(simNao('tYES')).toBe(true);
    expect(simNao('N')).toBe(false);
    expect(simNao('talvez')).toBeNull();
    expect(textoOuNull('  A ')).toBe('A');
    expect(textoOuNull('   ')).toBeNull();
    expect(textoOuNull(12)).toBe('12');
    expect(numeroOuNull('3.5')).toBe(3.5);
  });

  it('a ficha de próxima página nunca leva a outro host', () => {
    expect(caminhoRelativoSeguro('Items?$skip=100')).toBe('Items?$skip=100');
    expect(caminhoRelativoSeguro('/Items?$skip=100')).toBe('Items?$skip=100');
    expect(caminhoRelativoSeguro('https://outro.com/Items')).toBeNull();
    expect(caminhoRelativoSeguro('//outro.com/Items')).toBeNull();
    expect(caminhoRelativoSeguro('..\\x')).toBeNull();
  });

  it('URL com query codificada e $ do OData preservado', () => {
    expect(montarUrl('https://erp.com:50000/b1s/v1/', 'Items', { $filter: "UpdateDate ge '2026-11-20'", $top: '10' })).toBe("https://erp.com:50000/b1s/v1/Items?$filter=UpdateDate%20ge%20'2026-11-20'&$top=10");
  });

  it('campo do modelo ausente em todas as linhas = formato mudou; em algumas, não', () => {
    expect(camposAusentesEmTodas([{ a: 1 }, { a: 2 }], ['a', 'b'])).toEqual(['b']);
    expect(camposAusentesEmTodas([{ a: 1 }, { a: 2, b: 1 }], ['a', 'b'])).toEqual([]);
    expect(camposAusentesEmTodas([], ['a'])).toEqual([]);
  });
});
