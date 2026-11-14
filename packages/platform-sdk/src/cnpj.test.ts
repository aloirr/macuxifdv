import { describe, expect, it } from 'vitest';
import { ConsultaCnpjPedidoSchema, ConsultaCnpjRespostaSchema, type ConsultaCnpjResposta } from './cnpj';

const OK: ConsultaCnpjResposta = {
  cnpj: '00000000000191',
  razao_social: 'BANCO DO BRASIL SA',
  nome_fantasia: null,
  endereco: { logradouro: 'QUADRA SAUN QUADRA 5 BLOCO B', numero: 'S/N', complemento: null, bairro: 'ASA NORTE' },
  municipio: 'BRASILIA',
  uf: 'DF',
  cep: '70040912',
  situacao_cadastral: 'ativa',
  cnae_principal: { codigo: '6422100', descricao: 'Bancos múltiplos, com carteira comercial' },
  telefone: '6134939002',
  email: null,
  fonte: 'brasilapi',
};

describe('consulta de CNPJ (ADR 0048)', () => {
  it('pedido aceita com ou sem máscara e sai com 14 dígitos', () => {
    expect(ConsultaCnpjPedidoSchema.parse({ cnpj: '00.000.000/0001-91' })).toEqual({ cnpj: '00000000000191' });
    expect(ConsultaCnpjPedidoSchema.parse({ cnpj: '11222333000181' })).toEqual({ cnpj: '11222333000181' });
  });

  it('pedido recusa dígito errado, sequência repetida e campo extra', () => {
    expect(ConsultaCnpjPedidoSchema.safeParse({ cnpj: '11222333000182' }).success).toBe(false);
    expect(ConsultaCnpjPedidoSchema.safeParse({ cnpj: '11111111111111' }).success).toBe(false);
    expect(ConsultaCnpjPedidoSchema.safeParse({ cnpj: '11222333000181', x: 1 }).success).toBe(false);
  });

  it('resposta aceita o formato combinado e recusa sócios (strict), UF fora da lista e situação desconhecida', () => {
    expect(ConsultaCnpjRespostaSchema.parse(OK)).toEqual(OK);
    expect(ConsultaCnpjRespostaSchema.safeParse({ ...OK, qsa: [] }).success).toBe(false);
    expect(ConsultaCnpjRespostaSchema.safeParse({ ...OK, uf: 'XX' }).success).toBe(false);
    expect(ConsultaCnpjRespostaSchema.safeParse({ ...OK, situacao_cadastral: 'ATIVA' }).success).toBe(false);
    expect(ConsultaCnpjRespostaSchema.safeParse({ ...OK, telefone: '(61) 3493-9002' }).success).toBe(false);
    expect(ConsultaCnpjRespostaSchema.parse({ ...OK, uf: null, cep: null, cnae_principal: null })).toMatchObject({ uf: null });
  });
});
