import { describe, expect, it } from 'vitest';
import { codigoMarcaPeloNome, completarCodigosMarcaReferencia, nomeMarcaNormalizado, PREFIXO_CODIGO_MARCA_GERADO } from './marca-referencia-codigo';

type Linha = Record<string, string>;
const produto = (p: Linha): Linha => ({ marca: '', marca_codigo: '', referencia_1: '', marca_referencia_codigo_1: '', marca_referencia_1: '', referencia_2: '', marca_referencia_codigo_2: '', marca_referencia_2: '', ...p });

describe('código da marca da referência gerado pelo nome (RN-CAT-09, R-20261115-094000-alexandre item 6)', () => {
  it('RN-CAT-09: o mesmo nome dá sempre o mesmo código; caixa, acento e espaços não mudam o código', () => {
    const c = codigoMarcaPeloNome('Marca Beta');
    expect(c).toMatch(new RegExp(`^${PREFIXO_CODIGO_MARCA_GERADO}[0-9A-F]{8}$`));
    expect(codigoMarcaPeloNome('  marca   beta ')).toBe(c);
    expect(codigoMarcaPeloNome('MARCA BETA')).toBe(c);
    expect(codigoMarcaPeloNome('Fréio Ão')).toBe(codigoMarcaPeloNome('FREIO AO'));
    expect(codigoMarcaPeloNome('Marca Gama')).not.toBe(c);
  });

  it('RN-CAT-09: o código gerado cabe no campo do código da marca (30) e não tem cara de código do ERP', () => {
    const c = codigoMarcaPeloNome('x'.repeat(500));
    expect(c.length).toBeLessThanOrEqual(30);
    expect(c.startsWith(PREFIXO_CODIGO_MARCA_GERADO)).toBe(true);
  });

  it('RN-CAT-09: o nome normalizado tira acento, junta espaços e põe em maiúsculas; nome vazio não tem código', () => {
    expect(nomeMarcaNormalizado(' Cobréq  Freios ')).toBe('COBREQ FREIOS');
    expect(nomeMarcaNormalizado('   ')).toBe('');
    expect(() => codigoMarcaPeloNome('  ')).toThrow();
  });

  it('RN-CAT-09: referência com nome e sem código ganha o código gerado; a que já tem código fica como está', () => {
    const r = completarCodigosMarcaReferencia(
      [produto({ referencia_1: 'R1', marca_referencia_1: 'Marca Beta', referencia_2: 'R2', marca_referencia_codigo_2: '777', marca_referencia_2: 'Marca Delta' })],
      2,
    );
    expect(r.linhas[0]?.marca_referencia_codigo_1).toBe(codigoMarcaPeloNome('Marca Beta'));
    expect(r.linhas[0]?.marca_referencia_codigo_2).toBe('777');
    expect(r.resumo).toEqual({ codigosGerados: 1, codigosDoErp: 0, celulasPreenchidas: 1 });
  });

  it('RN-CAT-09: quando a base já traz o código da mesma marca (no produto ou noutra referência), usa o código do ERP, não gera', () => {
    const r = completarCodigosMarcaReferencia(
      [
        produto({ marca: 'Marca Beta', marca_codigo: '980' }),
        produto({ referencia_1: 'R1', marca_referencia_1: 'marca beta' }),
        produto({ referencia_1: 'R9', marca_referencia_codigo_1: '555', marca_referencia_1: 'Marca Ômega' }),
        produto({ referencia_2: 'R2', marca_referencia_2: 'MARCA OMEGA' }),
      ],
      2,
    );
    expect(r.linhas[1]?.marca_referencia_codigo_1).toBe('980');
    expect(r.linhas[3]?.marca_referencia_codigo_2).toBe('555');
    expect(r.resumo).toEqual({ codigosGerados: 0, codigosDoErp: 2, celulasPreenchidas: 2 });
  });

  it('RN-CAT-09: o mesmo nome com dois códigos no ERP usa o menor (resultado não depende da ordem das linhas)', () => {
    const linhas = [produto({ marca: 'Marca Beta', marca_codigo: '981' }), produto({ marca: 'Marca Beta', marca_codigo: '980' }), produto({ referencia_1: 'R', marca_referencia_1: 'Marca Beta' })];
    expect(completarCodigosMarcaReferencia(linhas, 2).linhas[2]?.marca_referencia_codigo_1).toBe('980');
    expect(completarCodigosMarcaReferencia([...linhas].reverse(), 2).linhas[0]?.marca_referencia_codigo_1).toBe('980');
  });

  it('RN-CAT-09: sem nome da marca a referência fica só com o código dela; o mesmo nome gerado em várias linhas conta uma vez', () => {
    const r = completarCodigosMarcaReferencia(
      [produto({ referencia_1: 'R1' }), produto({ referencia_1: 'R2', marca_referencia_1: 'Marca Zeta' }), produto({ referencia_2: 'R3', marca_referencia_2: 'zeta marca'.split(' ').reverse().join(' ') })],
      2,
    );
    expect(r.linhas[0]?.marca_referencia_codigo_1).toBe('');
    expect(r.linhas[1]?.marca_referencia_codigo_1).toBe(r.linhas[2]?.marca_referencia_codigo_2);
    expect(r.resumo).toEqual({ codigosGerados: 1, codigosDoErp: 0, celulasPreenchidas: 2 });
  });

  it('RN-CAT-09: não altera as linhas recebidas', () => {
    const entrada = [produto({ referencia_1: 'R1', marca_referencia_1: 'Marca Beta' })];
    completarCodigosMarcaReferencia(entrada, 2);
    expect(entrada[0]?.marca_referencia_codigo_1).toBe('');
  });
});
