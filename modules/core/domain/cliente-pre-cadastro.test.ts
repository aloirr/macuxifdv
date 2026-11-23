import { describe, expect, it } from 'vitest';
import { camposFaltantesPreCadastro, motivoRecusaCortado } from './cliente-pre-cadastro';

const completo = { razao_social: 'Mercado X', documento: '12345678000195', nome_fantasia: 'X', inscricao_estadual: '1', telefone: '9', email: 'a@b.c', logradouro: 'Rua', numero: '1', bairro: 'Centro', cidade: 'Manaus', uf: 'AM', cep: '69000000' };

describe('camposFaltantesPreCadastro', () => {
  it('RN-CORE-79: razão social e CPF/CNPJ são sempre obrigatórios, mesmo sem parâmetro', () => {
    expect(camposFaltantesPreCadastro({ razao_social: ' ', documento: null }, [])).toEqual(['razao_social', 'documento']);
    expect(camposFaltantesPreCadastro({ razao_social: 'X', documento: '12345678901' }, [])).toEqual([]);
  });
  it('RN-CORE-79: só os configurados pela empresa entram, na ordem fixa', () => {
    const d = { razao_social: 'X', documento: '12345678901' };
    expect(camposFaltantesPreCadastro(d, ['email', 'telefone'])).toEqual(['telefone', 'email']);
    expect(camposFaltantesPreCadastro(completo, ['nome_fantasia', 'inscricao_estadual', 'telefone', 'email', 'endereco'])).toEqual([]);
  });
  it('RN-CORE-79: endereço obrigatório falta se qualquer campo do grupo estiver vazio', () => {
    expect(camposFaltantesPreCadastro({ ...completo, cep: '' }, ['endereco'])).toEqual(['endereco']);
    expect(camposFaltantesPreCadastro({ ...completo, cep: '' }, [])).toEqual([]);
  });
});

describe('motivoRecusaCortado', () => {
  it('RN-CORE-78: o motivo do ERP é guardado até 500 caracteres e vazio vira nulo', () => {
    expect(motivoRecusaCortado('x'.repeat(600))).toHaveLength(500);
    expect(motivoRecusaCortado('  ')).toBeNull();
    expect(motivoRecusaCortado(undefined)).toBeNull();
    expect(motivoRecusaCortado(' CNPJ inativo ')).toBe('CNPJ inativo');
  });
});
