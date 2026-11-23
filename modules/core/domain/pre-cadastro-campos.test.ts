import { describe, expect, it } from 'vitest';
import { camposObrigatoriosEfetivos, validarPreCadastro } from './pre-cadastro-campos';

describe('pré-cadastro: campos obrigatórios efetivos (RN-CORE-16)', () => {
  it('RN-CORE-16: efetivos = sempre obrigatórios ∪ obrigatórios do parâmetro, sem duplicar, na ordem canônica', () => {
    const ordem = ['razao_social', 'documento', 'telefone', 'email'] as const;
    expect(camposObrigatoriosEfetivos(ordem, ['razao_social', 'documento'], ['email', 'telefone', 'email'])).toEqual(['razao_social', 'documento', 'telefone', 'email']);
  });
  it('RN-CORE-16: parâmetro ausente, inválido ou com código desconhecido não tira os sempre obrigatórios', () => {
    const ordem = ['razao_social', 'documento', 'telefone'] as const;
    expect(camposObrigatoriosEfetivos(ordem, ['razao_social', 'documento'], undefined)).toEqual(['razao_social', 'documento']);
    expect(camposObrigatoriosEfetivos(ordem, ['razao_social', 'documento'], 'x')).toEqual(['razao_social', 'documento']);
    expect(camposObrigatoriosEfetivos(ordem, ['razao_social', 'documento'], ['inexistente', 7])).toEqual(['razao_social', 'documento']);
  });
});

describe('pré-cadastro: validação do formulário (RN-CORE-16)', () => {
  const obrig = ['razao_social', 'documento', 'telefone'] as const;
  it('RN-CORE-16: CNPJ com dígito verificador inválido é recusado com a mensagem do campo', () => {
    const r = validarPreCadastro({ razao_social: 'Mercado Boa Vista', documento: '11.222.333/0001-80', telefone: '92999990000' }, obrig);
    expect(r.ok).toBe(false);
    expect(r.erros.documento).toMatch(/CNPJ|CPF/);
  });
  it('RN-CORE-16: aceita CNPJ e CPF válidos com ou sem máscara', () => {
    expect(validarPreCadastro({ razao_social: 'A', documento: '11.222.333/0001-81', telefone: '1' }, obrig).ok).toBe(true);
    expect(validarPreCadastro({ razao_social: 'A', documento: '529.982.247-25', telefone: '1' }, obrig).ok).toBe(true);
  });
  it('RN-CORE-16: campo obrigatório vazio ou só espaço aponta o campo; opcional vazio passa', () => {
    const r = validarPreCadastro({ razao_social: '   ', documento: '11222333000181', telefone: '', email: '' }, obrig);
    expect(Object.keys(r.erros).sort()).toEqual(['razao_social', 'telefone']);
  });
  it('RN-CORE-16: campo opcional preenchido e inválido (e-mail) é recusado', () => {
    const r = validarPreCadastro({ razao_social: 'A', documento: '11222333000181', telefone: '1', email: 'sem-arroba' }, obrig);
    expect(r.erros.email).toBeDefined();
  });
});
