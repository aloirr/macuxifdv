import { describe, expect, it } from 'vitest';
import { decidirVinculoErp } from './cliente-vinculo-erp';

describe('decidirVinculoErp', () => {
  it('RN-CORE-74: cliente aprovado sem código grava o código do ERP', () => {
    expect(decidirVinculoErp({ aprovado: true, external_id: null }, ' 123 ', false)).toEqual({ acao: 'gravar' });
  });
  it('RN-CORE-74: o mesmo código de novo é ok e não grava', () => {
    expect(decidirVinculoErp({ aprovado: true, external_id: '123' }, '123', false)).toEqual({ acao: 'nada', resultado: 'ja_vinculado' });
  });
  it('RN-CORE-74: código diferente para cliente que já tem é conflito', () => {
    expect(decidirVinculoErp({ aprovado: true, external_id: '123' }, '999', false)).toEqual({ acao: 'recusar', resultado: 'conflito' });
  });
  it('RN-CORE-74: cliente inexistente, não aprovado ou com código já usado por outro é recusado', () => {
    expect(decidirVinculoErp(null, '1', false)).toEqual({ acao: 'recusar', resultado: 'nao_encontrado' });
    expect(decidirVinculoErp({ aprovado: false, external_id: null }, '1', false)).toEqual({ acao: 'recusar', resultado: 'nao_aprovado' });
    expect(decidirVinculoErp({ aprovado: true, external_id: null }, '1', true)).toEqual({ acao: 'recusar', resultado: 'codigo_em_uso' });
  });
});
