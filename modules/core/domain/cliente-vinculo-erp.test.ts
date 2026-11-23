import { describe, expect, it } from 'vitest';
import { decidirRecusaErp, decidirVinculoErp } from './cliente-vinculo-erp';

const pend = { status_cadastro: 'pendente', external_id: null } as const;

describe('decidirVinculoErp', () => {
  it('RN-CORE-78: cliente pendente grava o código do ERP', () => {
    expect(decidirVinculoErp(pend, ' 123 ', false)).toEqual({ acao: 'gravar' });
  });
  it('RN-CORE-78: legado aprovado sem código também grava', () => {
    expect(decidirVinculoErp({ status_cadastro: 'aprovado', external_id: null }, '1', false)).toEqual({ acao: 'gravar' });
  });
  it('RN-CORE-78: o mesmo código de novo é ok e não grava', () => {
    expect(decidirVinculoErp({ status_cadastro: 'aprovado', external_id: '123' }, '123', false)).toEqual({ acao: 'nada', resultado: 'ja_vinculado' });
  });
  it('RN-CORE-78: código diferente para cliente que já tem é conflito', () => {
    expect(decidirVinculoErp({ status_cadastro: 'aprovado', external_id: '123' }, '999', false)).toEqual({ acao: 'recusar', resultado: 'conflito' });
  });
  it('RN-CORE-78: cliente inexistente, recusado ou com código já usado por outro é recusado', () => {
    expect(decidirVinculoErp(null, '1', false)).toEqual({ acao: 'recusar', resultado: 'nao_encontrado' });
    expect(decidirVinculoErp({ status_cadastro: 'recusado', external_id: null }, '1', false)).toEqual({ acao: 'recusar', resultado: 'cadastro_recusado' });
    expect(decidirVinculoErp(pend, '1', true)).toEqual({ acao: 'recusar', resultado: 'codigo_em_uso' });
  });
});

describe('decidirRecusaErp', () => {
  it('RN-CORE-78: recusa do ERP grava em cliente pendente ou legado aprovado sem código', () => {
    expect(decidirRecusaErp(pend)).toEqual({ acao: 'gravar' });
    expect(decidirRecusaErp({ status_cadastro: 'aprovado', external_id: null })).toEqual({ acao: 'gravar' });
  });
  it('RN-CORE-78: reentrega, cliente já com código ou inexistente não grava', () => {
    expect(decidirRecusaErp({ status_cadastro: 'recusado', external_id: null })).toEqual({ acao: 'nada', resultado: 'ja_recusado' });
    expect(decidirRecusaErp({ status_cadastro: 'aprovado', external_id: '1' })).toEqual({ acao: 'nada', resultado: 'ja_vinculado' });
    expect(decidirRecusaErp(null)).toEqual({ acao: 'nada', resultado: 'nao_encontrado' });
  });
});
