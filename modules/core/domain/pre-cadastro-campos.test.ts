import { describe, expect, it } from 'vitest';
import {
  MOTIVO_ENVIO_FALHOU,
  motivoSoDeCamposFaltantes,
  camposObrigatoriosPreCadastro,
  ehSempreObrigatorio,
  podePreCadastrarCliente,
  situacaoDoPreCadastro,
  validarPreCadastro,
} from './pre-cadastro-campos';

describe('pré-cadastro: campos obrigatórios efetivos (RN-CORE-79)', () => {
  it('RN-CORE-79: efetivos = sempre obrigatórios ∪ parâmetro, na ordem canônica, sem repetir', () => {
    expect(camposObrigatoriosPreCadastro([])).toEqual(['razao_social', 'documento']);
    expect(camposObrigatoriosPreCadastro(['email', 'telefone', 'email'])).toEqual(['razao_social', 'documento', 'telefone', 'email']);
  });
  it('RN-CORE-79: razão social e documento ficam travados', () => {
    expect(ehSempreObrigatorio('documento')).toBe(true);
    expect(ehSempreObrigatorio('email')).toBe(false);
  });
});

describe('pré-cadastro: validação do formulário (RN-CORE-79)', () => {
  const base = { razao_social: 'Mercado Boa Vista', documento: '11.222.333/0001-81' };
  const obrig = camposObrigatoriosPreCadastro(['telefone', 'endereco']);
  it('RN-CORE-79: CNPJ com dígito verificador errado é recusado; CNPJ e CPF válidos passam, com ou sem máscara', () => {
    expect(validarPreCadastro({ ...base, documento: '11.222.333/0001-80' }, ['razao_social', 'documento']).erros.documento).toBe('CNPJ inválido');
    expect(validarPreCadastro({ ...base, documento: '111.111.111-11' }, ['razao_social', 'documento']).erros.documento).toBe('CPF inválido');
    expect(validarPreCadastro(base, ['razao_social', 'documento']).ok).toBe(true);
    expect(validarPreCadastro({ ...base, documento: '52998224725' }, ['razao_social', 'documento']).ok).toBe(true);
  });
  it('RN-CORE-79: obrigatório vazio ou só espaço aponta o campo; endereço vale pelo grupo todo', () => {
    const r = validarPreCadastro({ ...base, razao_social: '  ', telefone: '', logradouro: 'Rua A', numero: '1' }, obrig);
    expect(Object.keys(r.erros).sort()).toEqual(['bairro', 'cep', 'cidade', 'razao_social', 'telefone', 'uf']);
    expect(r.erros.cep).toBe('Obrigatório');
  });
  it('RN-CORE-79: opcional vazio passa; opcional preenchido e inválido (CEP, telefone, e-mail) é recusado', () => {
    expect(validarPreCadastro({ ...base, email: '', cep: '' }, ['razao_social', 'documento']).ok).toBe(true);
    const r = validarPreCadastro({ ...base, cep: '123', telefone: '9299', email: 'sem-arroba' }, ['razao_social', 'documento']);
    expect(r.erros).toEqual({ cep: 'CEP inválido', telefone: 'Telefone inválido', email: 'E-mail inválido' });
  });
});

describe('pré-cadastro: perfil e selo (RN-CORE-78)', () => {
  it('RN-CORE-78: só o vendedor pré-cadastra; promotor e gestão não', () => {
    expect(podePreCadastrarCliente('vendedor')).toBe(true);
    for (const p of ['promotor', 'supervisor', 'gerente', 'admin']) expect(podePreCadastrarCliente(p)).toBe(false);
  });
  it('RN-CORE-78: pendente ou sem código = aguardando o ERP', () => {
    expect(situacaoDoPreCadastro({ status_cadastro: 'pendente', external_id: null }).situacao).toBe('aguardando_erp');
    expect(situacaoDoPreCadastro({ external_id: null }).situacao).toBe('aguardando_erp');
  });
  it('RN-CORE-78: recusado mostra o motivo do ERP', () => {
    expect(situacaoDoPreCadastro({ status_cadastro: 'recusado', external_id: null, motivo_recusa: ' CNPJ duplicado ' })).toEqual({ situacao: 'recusado_erp', motivo: 'CNPJ duplicado' });
  });
  it('RN-CORE-78: com o código do ERP o cliente está aprovado (sem selo)', () => {
    expect(situacaoDoPreCadastro({ status_cadastro: 'aprovado', external_id: 'C-100' }).situacao).toBe('aprovado_erp');
    expect(situacaoDoPreCadastro({ external_id: 'C-100' }).situacao).toBe('aprovado_erp');
  });
});

describe('pré-cadastro: motivo do 422 (RN-CORE-78)', () => {
  it('RN-CORE-78: só a lista "Preencha ..." do servidor é motivo de campo; recusa do ERP e 409 ficam no topo', () => {
    expect(motivoSoDeCamposFaltantes('Preencha o telefone. Preencha o endereço.')).toBe(true);
    expect(motivoSoDeCamposFaltantes('CNPJ duplicado no ERP')).toBe(false);
    expect(motivoSoDeCamposFaltantes(null)).toBe(false);
  });
  it('RD-2654: o sentinela de envio que falhou não vira motivo no "Não enviado"', () => {
    expect(situacaoDoPreCadastro({ status_cadastro: 'pendente', motivo_recusa: MOTIVO_ENVIO_FALHOU })).toEqual({ situacao: 'nao_enviado', motivo: null });
  });
});
