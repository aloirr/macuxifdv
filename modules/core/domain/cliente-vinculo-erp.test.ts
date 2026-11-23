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

describe('decidirRecusaErp com revisão e erros (v1.0.29, ADR 0069)', () => {
  const e1 = { campo: 'cep', codigo: 'INVALIDO', mensagem: 'CEP não existe' };
  const e2 = { campo: 'ie', codigo: 'FALTA', mensagem: 'Informe a IE' };
  const rec = { status_cadastro: 'recusado', external_id: null, revisao_cadastro: 2, motivo_recusa: 'Dados inválidos', erros_recusa: [e1, e2] } as const;
  it('RN-CORE-78: recusa de revisão anterior não vale sobre a nova', () => {
    expect(decidirRecusaErp({ ...pend, revisao_cadastro: 2 }, { revisao: 1, motivo: 'x', erros: [] })).toEqual({ acao: 'nada', resultado: 'revisao_antiga' });
  });
  it('RN-CORE-78: revisão maior que a do cliente é desconhecida e não grava', () => {
    expect(decidirRecusaErp({ ...pend, revisao_cadastro: 2 }, { revisao: 3, motivo: 'x', erros: [] })).toEqual({ acao: 'nada', resultado: 'revisao_desconhecida' });
  });
  it('RN-CORE-78: revisão atual (ou ausente) em cliente pendente grava', () => {
    expect(decidirRecusaErp({ ...pend, revisao_cadastro: 2 }, { revisao: 2, motivo: 'x', erros: [] })).toEqual({ acao: 'gravar' });
    expect(decidirRecusaErp({ ...pend, revisao_cadastro: 2 }, { motivo: 'x', erros: [] })).toEqual({ acao: 'gravar' });
    expect(decidirRecusaErp(pend, { revisao: 1, motivo: 'x', erros: [] })).toEqual({ acao: 'gravar' });
  });
  it('RN-INT-22: já recusado na mesma revisão com o mesmo motivo e os mesmos erros (em qualquer ordem) é repetição', () => {
    expect(decidirRecusaErp(rec, { revisao: 2, motivo: ' Dados inválidos ', erros: [e2, e1] })).toEqual({ acao: 'nada', resultado: 'ja_recusado' });
  });
  it('RN-INT-22: já recusado na mesma revisão com outro motivo ou outros erros é fato novo e grava', () => {
    expect(decidirRecusaErp(rec, { revisao: 2, motivo: 'Outro motivo', erros: [e1, e2] })).toEqual({ acao: 'gravar' });
    expect(decidirRecusaErp(rec, { revisao: 2, motivo: 'Dados inválidos', erros: [e1] })).toEqual({ acao: 'gravar' });
  });
});
