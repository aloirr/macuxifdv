import { describe, expect, it } from 'vitest';
import { abrirFotoDoProduto, idsComFoto, MENSAGEM_SEM_SINAL_FOTO } from './foto-produto';

describe('T-0148 foto do produto na busca (catalogo.foto_produto@1)', () => {
  it('T-0148: o ícone só aparece para quem tem foto e a checagem não abre (sem rede)', async () => {
    const chamadas: boolean[] = [];
    const r = await idsComFoto(async (e) => {
      chamadas.push(e.abrir);
      return { itens: [{ produto_id: 'a', tem_foto: true, uri: null }, { produto_id: 'b', tem_foto: false, uri: null }] };
    }, ['a', 'b', 'a']);
    expect([...r]).toEqual(['a']);
    expect(chamadas).toEqual([false]);
  });
  it('T-0148: falha da consulta = nenhum ícone, sem quebrar a busca', async () => {
    expect((await idsComFoto(async () => { throw new Error('x'); }, ['a'])).size).toBe(0);
    expect((await idsComFoto(async () => ({ itens: [] }), [])).size).toBe(0);
  });
  it('T-0148: tocar abre a foto pelo endereço local devolvido', async () => {
    const r = await abrirFotoDoProduto(async (e) => ({ itens: [{ produto_id: e.produto_ids[0]!, tem_foto: true, uri: 'file://a.jpg' }] }), 'a');
    expect(r).toEqual({ tipo: 'foto', uri: 'file://a.jpg' });
  });
  it('T-0148: sem sinal e sem cache (uri nula) ou falha = mensagem curta com a ação seguinte', async () => {
    const semUri = await abrirFotoDoProduto(async () => ({ itens: [{ produto_id: 'a', tem_foto: true, uri: null }] }), 'a');
    const falha = await abrirFotoDoProduto(async () => { throw new Error('x'); }, 'a');
    expect(semUri).toEqual({ tipo: 'aviso', texto: MENSAGEM_SEM_SINAL_FOTO });
    expect(falha).toEqual(semUri);
    expect(MENSAGEM_SEM_SINAL_FOTO).toBe('Sem sinal para abrir a foto.');
  });
});
