import { describe, expect, it } from 'vitest';

import { LIMITES_ENDERECO_PEDIDO } from '../contracts/frete';
import { LIMITES_ENDERECO, enderecoDoPedido, normalizarEnderecoEditado, validarEnderecoEditado, type EnderecoDigitado, type EnderecoDoCadastro } from './endereco-pedido';

const ok: EnderecoDigitado = { logradouro: 'Rua Pará', numero: '140', complemento: 'fundos', bairro: 'São Geraldo', cidade: 'Manaus', uf: 'AM', cep: '69053-000' };
const cad = (o: Partial<EnderecoDoCadastro> & { id: string }): EnderecoDoCadastro => ({
  external_id: null, tipo: 'entrega', descricao: null, logradouro: 'Rua Pará', numero: '137', complemento: null, bairro: 'São Geraldo', cidade: 'Manaus', uf: 'AM', cep: '69053000', principal: false, ativo: true, ...o,
});

describe('RN-VEN-17: endereço digitado só no pedido', () => {
  it('RN-VEN-17: os limites do domain são os do contrato', () => {
    expect(LIMITES_ENDERECO).toEqual(LIMITES_ENDERECO_PEDIDO);
  });
  it('RN-VEN-17: normaliza espaços, UF em maiúscula, CEP só com dígitos e complemento vazio vira nulo', () => {
    const n = normalizarEnderecoEditado({ ...ok, logradouro: '  Rua   Pará ', uf: 'am', cep: '69053-000', complemento: '   ' });
    expect(n).toEqual({ logradouro: 'Rua Pará', numero: '140', complemento: null, bairro: 'São Geraldo', cidade: 'Manaus', uf: 'AM', cep: '69053000' });
  });
  it('RN-VEN-17: endereço completo é válido', () => {
    expect(validarEnderecoEditado(ok)).toBeNull();
  });
  it('RN-VEN-17: cada campo obrigatório vazio é apontado pelo nome (sem o conteúdo)', () => {
    const r = validarEnderecoEditado({ ...ok, logradouro: '', numero: ' ', bairro: '', cidade: '', uf: '', cep: '' });
    expect(r).toEqual({ codigo: 'endereco_invalido', campos: ['cep', 'logradouro', 'numero', 'bairro', 'cidade', 'uf'] });
    expect(JSON.stringify(r)).not.toContain('Pará');
  });
  it('RN-VEN-17: Cidade e UF são obrigatórias (sem sinal, preenchido à mão)', () => {
    expect(validarEnderecoEditado({ ...ok, cidade: '' })?.campos).toEqual(['cidade']);
    expect(validarEnderecoEditado({ ...ok, uf: '' })?.campos).toEqual(['uf']);
  });
  it('RN-VEN-17: CEP precisa de 8 dígitos e 00000-000 não existe', () => {
    expect(validarEnderecoEditado({ ...ok, cep: '6905300' })?.campos).toEqual(['cep']);
    expect(validarEnderecoEditado({ ...ok, cep: '690530000' })?.campos).toEqual(['cep']);
    expect(validarEnderecoEditado({ ...ok, cep: '00000-000' })?.campos).toEqual(['cep']);
  });
  it('RN-VEN-17: UF inexistente é recusada e os mínimos de 2 letras valem (rua, bairro, cidade)', () => {
    expect(validarEnderecoEditado({ ...ok, uf: 'XX' })?.campos).toEqual(['uf']);
    expect(validarEnderecoEditado({ ...ok, logradouro: 'R', bairro: 'B', cidade: 'M' })?.campos).toEqual(['logradouro', 'bairro', 'cidade']);
  });
  it('RN-VEN-17: limites da NF-e (60/20/60/60/60)', () => {
    expect(validarEnderecoEditado({ ...ok, logradouro: 'x'.repeat(61) })?.campos).toEqual(['logradouro']);
    expect(validarEnderecoEditado({ ...ok, numero: '1'.repeat(21) })?.campos).toEqual(['numero']);
    expect(validarEnderecoEditado({ ...ok, complemento: 'x'.repeat(61) })?.campos).toEqual(['complemento']);
    expect(validarEnderecoEditado({ ...ok, logradouro: 'x'.repeat(60), numero: 'S/N' })).toBeNull();
  });

  it('RN-VEN-17: sem digitado, vale o principal e o retrato sai com origem erp', () => {
    const r = enderecoDoPedido({ editado: null, escolhido_id: null, enderecos: [cad({ id: 'e1', principal: true }), cad({ id: 'e2' })] });
    expect(r).toMatchObject({ ok: true, endereco_id: 'e1', retrato: { id: 'e1', origem: 'erp', principal: true } });
  });
  it('RN-VEN-17: sem digitado, escolha fora dos ativos continua endereco_invalido', () => {
    expect(enderecoDoPedido({ editado: null, escolhido_id: 'zz', enderecos: [cad({ id: 'e1', principal: true })] })).toEqual({ ok: false, codigo: 'endereco_invalido' });
  });
  it('RN-VEN-17: cliente sem endereço e sem digitado fica sem endereço de entrega', () => {
    expect(enderecoDoPedido({ editado: null, escolhido_id: null, enderecos: [] })).toEqual({ ok: true, endereco_id: null, retrato: null });
  });
  it('RN-VEN-17: digitado diferente vira origem editado, sem id, sem external_id e não principal', () => {
    const r = enderecoDoPedido({ editado: ok, escolhido_id: 'e1', enderecos: [cad({ id: 'e1', principal: true, numero: '137', external_id: 'X1' })] });
    expect(r).toMatchObject({ ok: true, endereco_id: null, retrato: { id: null, external_id: null, origem: 'editado', principal: false, numero: '140', complemento: 'fundos', cep: '69053000', uf: 'AM' } });
  });
  it('RN-VEN-17: digitado igual a um endereço ativo do cliente (sem diferenciar maiúscula) vira origem erp daquele endereço', () => {
    const r = enderecoDoPedido({
      editado: { ...ok, logradouro: 'RUA PARÁ', numero: '137', complemento: null },
      escolhido_id: null,
      enderecos: [cad({ id: 'e1', principal: true, external_id: 'X1' })],
    });
    expect(r).toMatchObject({ ok: true, endereco_id: 'e1', retrato: { id: 'e1', external_id: 'X1', origem: 'erp', principal: true } });
  });
  it('RN-VEN-17: digitado igual a endereço desativado não casa (vira editado); escolha desativada nunca recusa o digitado', () => {
    const r = enderecoDoPedido({ editado: { ...ok, numero: '137', complemento: null }, escolhido_id: 'e9', enderecos: [cad({ id: 'e1', ativo: false })] });
    expect(r).toMatchObject({ ok: true, endereco_id: null, retrato: { origem: 'editado' } });
  });
  it('RN-VEN-17: digitado inválido recusa com endereco_invalido e os campos', () => {
    expect(enderecoDoPedido({ editado: { ...ok, cidade: '' }, escolhido_id: null, enderecos: [] })).toEqual({ ok: false, codigo: 'endereco_invalido', campos: ['cidade'] });
  });
});
