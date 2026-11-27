import { describe, expect, it } from 'vitest';
import { CorrecaoPreCadastroSchema } from '../../contracts';
import { colunaExigida, dadosDoFormulario, erroDoVendedor, errosDaRecusaPorColuna, primeiraColunaMarcada, rotuloDoCampo, valoresDosDados } from './pre-cadastro-formulario';

describe('formulário do pré-cadastro (RN-CORE-78, RN-CORE-79)', () => {
  it('RN-CORE-78: o erro por campo da recusa marca a coluna exata; o primeiro de cada coluna vale e campo fora do formulário fica de fora', () => {
    const erros = [
      { campo: 'numero', mensagem: 'Número inválido' },
      { campo: ' cep ', mensagem: 'CEP não existe' },
      { campo: 'cep', mensagem: 'Outro erro do CEP' },
      { campo: 'regime_tributario', mensagem: 'Fora do formulário' },
    ];
    expect(errosDaRecusaPorColuna(erros)).toEqual({ numero: 'Número inválido', cep: 'CEP não existe' });
    expect(errosDaRecusaPorColuna(null)).toEqual({});
  });

  it('RN-CORE-78: a recusa por vendedor_external_id tem o rótulo "Vendedor", não marca coluna do formulário e sai por erroDoVendedor', () => {
    const erros = [{ campo: ' vendedor_external_id ', mensagem: 'Vendedor não existe no ERP' }, { campo: 'cep', mensagem: 'CEP não existe' }];
    expect(rotuloDoCampo('vendedor_external_id')).toBe('Vendedor');
    expect(errosDaRecusaPorColuna(erros)).toEqual({ cep: 'CEP não existe' });
    expect(erroDoVendedor(erros)).toBe('Vendedor não existe no ERP');
    expect(erroDoVendedor([{ campo: 'cep', mensagem: 'x' }])).toBeNull();
    expect(erroDoVendedor(null)).toBeNull();
  });

  it('RN-CORE-78: a primeira coluna marcada segue a ordem do formulário (CEP antes do Número)', () => {
    expect(primeiraColunaMarcada({ numero: 'x', cep: 'y' })).toBe('cep');
    expect(primeiraColunaMarcada({})).toBeNull();
    // a ordem da tela entra como parâmetro (a grade do BKO põe a IE logo depois do CPF/CNPJ)
    expect(primeiraColunaMarcada({ cep: 'y', inscricao_estadual: 'x' }, ['documento', 'inscricao_estadual', 'cep'])).toBe('inscricao_estadual');
  });

  it('RN-CORE-79: o documento vai só com dígitos no envio, do Campo e do BKO (a mesma função), com ou sem a máscara', () => {
    expect(dadosDoFormulario({ documento: '529.982.247-25' }).documento).toBe('52998224725');
    expect(dadosDoFormulario({ documento: '11222333000181' }).documento).toBe('11222333000181');
    expect(dadosDoFormulario({}).documento).toBe('');
  });

  it('RN-CORE-78: rótulo da coluna e do campo do erro vem do contrato e do endereço; campo desconhecido aparece com o nome que veio', () => {
    expect(rotuloDoCampo('documento')).toBe('CPF/CNPJ');
    expect(rotuloDoCampo('cep')).toBe('CEP');
    expect(rotuloDoCampo('numero')).toBe('Número');
    expect(rotuloDoCampo('regime')).toBe('regime');
  });

  it('RN-CORE-79: os dados vão ao contrato da correção sem máscara (documento, telefone e CEP só com dígitos) e o vazio vira nulo', () => {
    const v = valoresDosDados({ documento: '11.222.333/0001-81', razao_social: 'Mercado', telefone: '(92) 99999-0000', cep: '69000-000', email: ' ', uf: 'am' });
    expect(v.nome_fantasia).toBe('');
    const corpo = CorrecaoPreCadastroSchema.parse({ ...dadosDoFormulario(v), revisao_base: 2 });
    expect(corpo).toMatchObject({ documento: '11222333000181', telefone: '92999990000', cep: '69000000', email: null, uf: 'AM', nome_fantasia: null, revisao_base: 2 });
  });

  it('RN-CORE-16: a IE só é exigida com CNPJ válido, como na cadastroCompleto do domain; o que a lista não pede é opcional', () => {
    const lista = ['razao_social', 'documento', 'inscricao_estadual'] as const;
    expect(colunaExigida({ documento: '11.222.333/0001-81' }, lista, 'inscricao_estadual')).toBe(true);
    expect(colunaExigida({ documento: '529.982.247-25' }, lista, 'inscricao_estadual')).toBe(false);
    expect(colunaExigida({ documento: '112223330001' }, lista, 'inscricao_estadual')).toBe(false);
    expect(colunaExigida({}, lista, 'razao_social')).toBe(true);
    expect(colunaExigida({}, lista, 'email')).toBe(false);
  });
});
