import { afterEach, describe, expect, it, vi } from 'vitest';
import * as contrato from './busca-cliente';
import * as dominio from '../domain/clientes';

describe('busca de clientes (contrato)', () => {
  it('RF-CORE-02: o domain reexporta a mesma regra do contrato', () => {
    expect(dominio.clienteCasaBusca).toBe(contrato.clienteCasaBusca);
    expect(dominio.normalizarBusca).toBe(contrato.normalizarBusca);
    expect(dominio.palavrasDaBusca).toBe(contrato.palavrasDaBusca);
  });
  it('RF-CORE-02: cidade e bairro não entram na busca', () => {
    const c = { razao_social: 'Mercado', bairro: 'Centro', cidade: 'Centro' } as Parameters<typeof contrato.clienteCasaBusca>[1];
    expect(contrato.clienteCasaBusca('centro', c)).toBe(false);
  });
  describe('palavra por palavra (R-20261120-101755)', () => {
    const joao = { razao_social: 'JOAO', external_id: '0103', documento: '12.345.678/0001-90' };
    it('RF-CORE-02: "JOAO 0103" traz o JOAO de código 0103', () => {
      expect(contrato.clienteCasaBusca('JOAO 0103', joao)).toBe(true);
    });
    it('RF-CORE-02: "joão 0103" casa sem acento e sem caixa', () => {
      expect(contrato.clienteCasaBusca('joão 0103', joao)).toBe(true);
    });
    it('RF-CORE-02: "JOAO 9999" não casa (todas as palavras precisam casar)', () => {
      expect(contrato.clienteCasaBusca('JOAO 9999', joao)).toBe(false);
    });
    it('RF-CORE-02: "quimera atacado" casa com uma palavra na razão e a outra na fantasia', () => {
      expect(contrato.clienteCasaBusca('quimera atacado', { razao_social: 'Quimera Ltda', nome_fantasia: 'Atacado Norte' })).toBe(true);
    });
    it('RF-CORE-02: o CNPJ entra como uma das palavras', () => {
      expect(contrato.clienteCasaBusca('joao 12.345', joao)).toBe(true);
    });
    it('RF-CORE-02: espaços sobrando e termo vazio', () => {
      expect(contrato.palavrasDaBusca('  JOÃO   0103 ')).toEqual(['joao', '0103']);
      expect(contrato.clienteCasaBusca('   ', joao)).toBe(true);
    });
  });
  it('RF-CORE-02: documentoCasa — dígitos do termo (3 ou mais) contidos nos do documento, com ou sem máscara', () => {
    expect(contrato.documentoCasa('12.345.678', '12345678000190')).toBe(true);
    expect(contrato.documentoCasa('12345678000190', '12.345.678/0001-90')).toBe(true);
    expect(contrato.documentoCasa('12', '12345678000190')).toBe(false);
    expect(contrato.documentoCasa('abc', '12345678000190')).toBe(false);
    expect(contrato.documentoCasa('123', null)).toBe(false);
  });
  it('RF-CORE-02: digitosDeBuscaDoDocumento — a regra dos 3 dígitos que a API usa em SQL; menos de 3 não busca documento', () => {
    expect(contrato.digitosDeBuscaDoDocumento('12.345.678/0001-90')).toBe('12345678000190');
    expect(contrato.digitosDeBuscaDoDocumento('Loja 12')).toBeNull();
    expect(contrato.digitosDeBuscaDoDocumento('abc')).toBeNull();
  });
  describe('expressão SQL (R-20261120-101755)', () => {
    it('RF-CORE-02: o translate vem antes do lower e as listas têm o mesmo tamanho, com maiúsculas acentuadas', () => {
      expect(contrato.sqlBuscaNormalizada('c.razao_social')).toBe(`lower(translate(c.razao_social, '${contrato.ACENTOS_PT}', '${contrato.SEM_ACENTOS_PT}'))`);
      expect([...contrato.ACENTOS_PT]).toHaveLength([...contrato.SEM_ACENTOS_PT].length);
      expect(contrato.ACENTOS_PT).toContain('Ã');
    });
    it('RF-CORE-02: cada letra da lista vira a mesma letra que normalizarBusca produz', () => {
      const de = [...contrato.ACENTOS_PT];
      const para = [...contrato.SEM_ACENTOS_PT];
      de.forEach((c, i) => expect(para[i]!.toLowerCase()).toBe(contrato.normalizarBusca(c)));
    });
  });
  describe('aparelho sem String.normalize (RD-7)', () => {
    const original = String.prototype.normalize;
    afterEach(() => {
      String.prototype.normalize = original;
      vi.resetModules();
    });
    /** Carrega o contrato de novo com o `normalize` trocado (ausente ou quebrado), como num aparelho sem ele. */
    const contratoSem = async (troca: ((this: string) => string) | undefined): Promise<typeof contrato> => {
      vi.resetModules();
      (String.prototype as { normalize?: unknown }).normalize = troca;
      return import('./busca-cliente');
    };
    const amostras = [
      ...contrato.ACENTOS_PT,
      ...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)),
      'JOÃO DA SILVA', 'Açougue São José', 'CONFECÇÕES ÍRIS', 'Pão de Açúcar', 'ÔNIBUS Ü', ' Maçã Ñandu ',
      'Joa\u0303o', // acento já separado (forma decomposta)
      '', '12.345.678/0001-90',
    ];
    it.each([
      ['ausente', undefined],
      ['que lança erro', function (this: string): string { throw new RangeError('sem ICU'); }],
      ['que não decompõe', function (this: string): string { return String(this); }],
    ])('RF-CORE-02: com normalize %s, normalizarBusca dá o mesmo resultado da versão com normalize', async (_nome, troca) => {
      const esperado = amostras.map((a) => contrato.normalizarBusca(a));
      const sem = await contratoSem(troca);
      expect(amostras.map((a) => sem.normalizarBusca(a))).toEqual(esperado);
      expect(sem.clienteCasaBusca('joão 0103', { razao_social: 'JOAO', external_id: '0103' })).toBe(true);
      expect(sem.clienteCasaBusca('acougue', { nome_fantasia: 'Açougue Central' })).toBe(true);
    });
  });
});
