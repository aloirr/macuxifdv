/** RN-CAT-09 (referência cruzada, oferece junto) e RN-CAT-11 (aplicação): validação do cadastro do Catálogo. */
import { describe, expect, it } from 'vitest';
import type { SalvarCadastroCatalogo } from '../contracts';
import { LIMITES_CADASTRO_CATALOGO, validarCadastroCatalogo } from './cadastro-catalogo';

const P = '00000000-0000-4000-8000-000000000001';
const M1 = '00000000-0000-4000-8000-0000000000a1';
const M2 = '00000000-0000-4000-8000-0000000000a2';
const idp = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base: SalvarCadastroCatalogo = { aplicacao: null, oferece_junto: [], referencias: [], etiquetas: [] };
const validar = (c: Partial<SalvarCadastroCatalogo>) => validarCadastroCatalogo(P, { ...base, ...c }, { aplicacaoMax: 2000 });
const regras = (c: Partial<SalvarCadastroCatalogo>) => validar(c).map((e) => e.regra);

describe('validarCadastroCatalogo', () => {
  it('RN-CAT-09: limites exatos (3 referências, código de 30, 5 oferece junto, 4 etiquetas de 20) são aceitos', () => {
    expect(
      validar({
        referencias: [
          { marca_id: M1, codigo: 'A'.repeat(30) },
          { marca_id: M1, codigo: 'B1' },
          { marca_id: M2, codigo: 'B2' },
        ],
        oferece_junto: [11, 12, 13, 14, 15].map(idp),
        etiquetas: ['a'.repeat(20), 'b', 'c', 'd'],
        aplicacao: 'x'.repeat(2000),
      }),
    ).toEqual([]);
    expect(LIMITES_CADASTRO_CATALOGO).toEqual({ referencias: 3, codigo: 30, ofereceJunto: 5, etiquetas: 4, etiqueta: 20 });
  });

  it('RN-CAT-09: 4 referências é erro', () => {
    const r = [1, 2, 3, 4].map((n) => ({ marca_id: M1, codigo: `COD${n}` }));
    expect(regras({ referencias: r })).toEqual(['RN-CAT-09']);
  });

  it('RN-CAT-09: código com 31 caracteres é erro', () => {
    expect(regras({ referencias: [{ marca_id: M1, codigo: 'A'.repeat(31) }] })).toEqual(['RN-CAT-09']);
  });

  it('RN-CAT-09: código que vira vazio depois de compactado ("--") é erro', () => {
    expect(regras({ referencias: [{ marca_id: M1, codigo: '--' }] })).toEqual(['RN-CAT-09']);
  });

  it('RN-CAT-09: o código é único no produto, mesmo com marcas diferentes ou sem marca', () => {
    expect(validar({ referencias: [{ marca_id: M1, codigo: 'CB 3401' }, { marca_id: M2, codigo: 'cb-3401' }] })).toHaveLength(1);
    expect(validar({ referencias: [{ marca_id: null, codigo: 'CB 3401' }, { codigo: 'cb 3401' }] })).toHaveLength(1);
    expect(validar({ referencias: [{ marca_id: null, codigo: 'CB 3401' }, { marca_id: M1, codigo: 'AB 1' }] })).toEqual([]);
  });

  it('RN-CAT-09: 6 em oferece junto é erro', () => {
    expect(regras({ oferece_junto: [11, 12, 13, 14, 15, 16].map(idp) })).toEqual(['RN-CAT-09']);
  });

  it('RN-CAT-09: o próprio produto em oferece junto é erro', () => {
    expect(validar({ oferece_junto: [P] })[0]!.campo).toBe('oferece_junto');
  });

  it('RN-CAT-09: id repetido em oferece junto é erro', () => {
    expect(validar({ oferece_junto: [idp(2), idp(2)] })[0]!.campo).toBe('oferece_junto');
  });

  it('RN-CAT-09: 5 etiquetas é erro', () => {
    expect(regras({ etiquetas: ['a', 'b', 'c', 'd', 'e'] })).toEqual(['RN-CAT-09']);
  });

  it('RN-CAT-09: etiqueta de 21 caracteres é erro', () => {
    expect(regras({ etiquetas: ['a'.repeat(21)] })).toEqual(['RN-CAT-09']);
  });

  it('RN-CAT-11: aplicação acima de aplicacao_max_cadastro é erro, com o campo', () => {
    const e = validarCadastroCatalogo(P, { ...base, aplicacao: 'x'.repeat(301) }, { aplicacaoMax: 300 });
    expect(e).toEqual([expect.objectContaining({ regra: 'RN-CAT-11', campo: 'aplicacao' })]);
  });

  it('RN-CAT-09: as mensagens de erro vêm em português com a ação seguinte', () => {
    for (const e of validar({ oferece_junto: [P], etiquetas: ['', 'a', 'b', 'c', 'd'] })) expect(e.mensagem).toMatch(/\.$/);
  });
});

describe('validarCadastroCatalogo: oferece junto por código', () => {
  it('RN-CAT-09: ids e códigos digitados somam no limite de 5', () => {
    expect(validar({ oferece_junto: [11, 12, 13].map(idp), oferece_junto_codigos: ['A', 'B'] })).toEqual([]);
    expect(regras({ oferece_junto: [11, 12, 13].map(idp), oferece_junto_codigos: ['A', 'B', 'C'] })).toEqual(['RN-CAT-09']);
  });
});
