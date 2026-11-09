import { describe, expect, it } from 'vitest';

import type { EnderecoEditadoValido } from '../../domain/endereco-pedido';
import type { EnderecoDaTela } from './novo-pedido';
import {
  cartaoDoEndereco,
  errosDoFormulario,
  formularioDoEndereco,
  linhasDoEndereco,
  mascaraDoCep,
  opcoesDaFolhaDeEnderecos,
  rascunhoComEnderecoEditado,
  rascunhoComEnderecoEscolhido,
  TEXTOS_ENDERECO,
} from './endereco-pedido';

const base = { cliente_id: 'c1', tipo: 'entrega', complemento: null, bairro: 'São Geraldo', cidade: 'Manaus', uf: 'AM', ativo: true } as const;
const principal: EnderecoDaTela = { ...base, id: 'e1', tipo: 'principal', descricao: null, logradouro: 'Rua Pará', numero: '137', cep: '69053000', principal: true };
const deposito: EnderecoDaTela = { ...base, id: 'e2', descricao: 'Depósito', logradouro: 'Av. Torquato Tapajós', numero: '4010', bairro: 'Flores', cep: '69048000', principal: false };
const editado: EnderecoEditadoValido = { logradouro: 'Rua Pará', numero: '140', complemento: 'fundos', bairro: 'São Geraldo', cidade: 'Manaus', uf: 'AM', cep: '69053000' };

describe('RN-VEN-17: cartão do endereço de entrega (T-0141 C.1)', () => {
  it('RN-VEN-17: 2 ou mais endereços do ERP: ação Alterar abre a folha; selo Principal; duas linhas', () => {
    const c = cartaoDoEndereco({ rascunho: {}, lista: [principal, deposito] });
    expect(c.acao).toEqual({ rotulo: 'Alterar', abre: 'folha' });
    expect(c.selo).toEqual({ texto: 'Principal', tom: 'neutro' });
    expect(c.linhas).toEqual(['Rua Pará, 137 · São Geraldo', 'Manaus/AM · 69053-000']);
  });
  it('RN-VEN-17: com 1 endereço a ação é Editar e abre direto o formulário', () => {
    expect(cartaoDoEndereco({ rascunho: {}, lista: [principal] }).acao).toEqual({ rotulo: 'Editar', abre: 'formulario' });
  });
  it('RN-VEN-17: endereço de entrega escolhido mostra o nome dele no selo', () => {
    const c = cartaoDoEndereco({ rascunho: { endereco_entrega_id: 'e2' }, lista: [principal, deposito] });
    expect(c.selo).toEqual({ texto: 'Depósito', tom: 'neutro' });
    expect(c.linhas[0]).toBe('Av. Torquato Tapajós, 4010 · Flores');
  });
  it('RN-VEN-17: endereço editado leva o selo Editado neste pedido, em destaque, com complemento na rua', () => {
    const c = cartaoDoEndereco({ rascunho: { endereco_entrega_editado: editado }, lista: [principal, deposito] });
    expect(c.selo).toEqual({ texto: 'Editado neste pedido', tom: 'destaque' });
    expect(c.linhas).toEqual(['Rua Pará, 140, fundos · São Geraldo', 'Manaus/AM · 69053-000']);
  });
  it('RN-VEN-17: cliente sem endereço no aparelho: texto do cadastro, sem selo, ação Editar', () => {
    const c = cartaoDoEndereco({ rascunho: {}, lista: [] });
    expect(c).toEqual({ selo: null, linhas: [], texto: 'Endereço do cadastro do cliente', acao: { rotulo: 'Editar', abre: 'formulario' } });
  });
  it('RN-VEN-17: linhas do endereço sem partes vazias', () => {
    expect(linhasDoEndereco({ logradouro: 'Rua A', numero: null, complemento: null, bairro: null, cidade: 'Boa Vista', uf: 'RR', cep: null })).toEqual(['Rua A', 'Boa Vista/RR']);
  });
});

describe('RN-VEN-17: folha de endereços (C.2)', () => {
  it('RN-VEN-17: lista os do ERP, o editado se houver, e marca o escolhido; sem editado não aparece a opção', () => {
    const o = opcoesDaFolhaDeEnderecos({ rascunho: { endereco_entrega_editado: editado }, lista: [principal, deposito] });
    expect(o.map((x) => [x.id, x.titulo, x.marcada])).toEqual([['e1', 'Principal', false], ['e2', 'Depósito', false], ['editado', 'Editado neste pedido', true]]);
    expect(opcoesDaFolhaDeEnderecos({ rascunho: {}, lista: [principal, deposito] }).map((x) => [x.id, x.marcada])).toEqual([['e1', true], ['e2', false]]);
  });
  it('RN-VEN-17: escolher um endereço do ERP desfaz a edição; o principal limpa o id (ausente = principal)', () => {
    const r = rascunhoComEnderecoEscolhido({ endereco_entrega_editado: editado, endereco_entrega_id: null }, deposito, principal.id);
    expect(r.endereco_entrega_id).toBe('e2');
    expect(r.endereco_entrega_editado).toBeNull();
    expect(rascunhoComEnderecoEscolhido(r, principal, principal.id).endereco_entrega_id).toBeNull();
  });
});

describe('RN-VEN-17: formulário Endereço deste pedido (C.3)', () => {
  it('RN-VEN-17: abre preenchido com o endereço escolhido (CEP com máscara); vazio quando não há', () => {
    expect(formularioDoEndereco(principal)).toEqual({ cep: '69053-000', logradouro: 'Rua Pará', numero: '137', complemento: '', bairro: 'São Geraldo', cidade: 'Manaus', uf: 'AM' });
    expect(formularioDoEndereco(null)).toEqual({ cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '' });
  });
  it('RN-VEN-17: máscara do CEP 00000-000 e no máximo 8 números', () => {
    expect(mascaraDoCep('69053')).toBe('69053');
    expect(mascaraDoCep('690530')).toBe('69053-0');
    expect(mascaraDoCep('69053-000999')).toBe('69053-000');
    expect(mascaraDoCep('ab')).toBe('');
  });
  it('RN-VEN-17: vazio é Obrigatório, CEP incompleto diz 8 números, 1 letra pede 2; Cidade e UF obrigatórias; só o texto, sem o conteúdo', () => {
    const v = { cep: '690', logradouro: '', numero: '', complemento: '', bairro: 'S', cidade: '', uf: '' };
    expect(errosDoFormulario(v)).toEqual({ cep: 'CEP com 8 números', logradouro: 'Obrigatório', numero: 'Obrigatório', bairro: 'Use pelo menos 2 letras', cidade: 'Obrigatório', uf: 'Obrigatório' });
    expect(errosDoFormulario({ ...v, cep: '' }).cep).toBe('Obrigatório');
    expect(errosDoFormulario(formularioDoEndereco(principal))).toEqual({});
  });
  it('RN-VEN-17: digitado igual ao do ERP volta como o do ERP (sem selo à toa); diferente vira editado, sem id', () => {
    const igual = rascunhoComEnderecoEditado({}, formularioDoEndereco(principal), [principal, deposito]);
    expect(igual).toMatchObject({ endereco_entrega_id: null, endereco_entrega_editado: null });
    const dep = rascunhoComEnderecoEditado({}, formularioDoEndereco(deposito), [principal, deposito]);
    expect(dep).toMatchObject({ endereco_entrega_id: 'e2', endereco_entrega_editado: null });
    const novo = rascunhoComEnderecoEditado({ endereco_entrega_id: 'e2' }, { ...formularioDoEndereco(principal), numero: '140', complemento: 'fundos' }, [principal, deposito]);
    expect(novo).toEqual({ endereco_entrega_id: null, endereco_entrega_editado: editado });
  });
  it('RN-VEN-17: textos da spec', () => {
    expect(TEXTOS_ENDERECO.tituloFormulario).toBe('Endereço deste pedido');
    expect(TEXTOS_ENDERECO.aviso).toBe('Só neste pedido. O cadastro do cliente não muda.');
    expect(TEXTOS_ENDERECO.usar).toBe('Usar neste pedido');
    expect(TEXTOS_ENDERECO.editarNestePedido).toBe('Editar endereço deste pedido');
    expect(TEXTOS_ENDERECO.descartar).toMatchObject({ titulo: 'Descartar a edição?', continuar: 'Continuar editando', confirmar: 'Descartar' });
  });
});
