import { describe, expect, it } from 'vitest';
import { buscaDosFiltros, cadastroCatalogoDoForm, conteudoDoForm, formCadastroDaFicha, formDaFicha, lerFiltrosBko, mapaIdsPorCodigo, abrirEditores, fecharEditor, EDITORES_FECHADOS, produtosParaCsv, sinonimoDoForm } from './formularios';

describe('formulários do BKO de conteúdo (RF-CAT-07)', () => {
  it('conteúdo: ida e volta entre a ficha e o formulário', () => {
    const ficha = { content: { description: 'Torra média.', selling_points: ['Mais vendido'], faq: [{ question: 'É moído?', answer: 'Sim.' }] }, attributes: [{ name: 'Torra', value: 'Média' }] };
    const r = conteudoDoForm(formDaFicha(ficha));
    expect(r).toEqual({ ok: true, valor: { description: 'Torra média.', selling_points: ['Mais vendido'], faq: [{ question: 'É moído?', answer: 'Sim.' }], attributes: [{ name: 'Torra', value: 'Média' }] } });
  });

  it('conteúdo: erros com a ação seguinte (atributo sem ":", FAQ sem resposta ou sem pergunta)', () => {
    const vazio = { descricao: '', argumentos: '', faq: '', atributos: '' };
    expect(conteudoDoForm({ ...vazio, atributos: 'Torra média' })).toMatchObject({ ok: false, erro: expect.stringMatching(/"Nome: valor"/) });
    expect(conteudoDoForm({ ...vazio, faq: 'P: É moído?' })).toMatchObject({ ok: false, erro: expect.stringMatching(/sem resposta/) });
    expect(conteudoDoForm({ ...vazio, faq: 'R: Sim.' })).toMatchObject({ ok: false, erro: expect.stringMatching(/resposta sem pergunta/) });
    expect(conteudoDoForm(vazio)).toEqual({ ok: true, valor: { description: null, selling_points: [], faq: [], attributes: [] } });
  });

  it('sinônimo: separados por vírgula; vazio recusado', () => {
    expect(sinonimoDoForm({ termo: 'refrigerante', sinonimos: 'refri, soda ,', ativo: true })).toEqual({ ok: true, valor: { term: 'refrigerante', synonyms: ['refri', 'soda'], active: true } });
    expect(sinonimoDoForm({ termo: 'refrigerante', sinonimos: ' , ', ativo: true })).toMatchObject({ ok: false, erro: 'Informe ao menos um sinônimo.' });
  });

  it('CSV no padrão do Excel (;, aspas quando precisa, BOM)', () => {
    const csv = produtosParaCsv([{ id: '00000000-0000-4000-8000-000000000001', erp_code: 'CAF-500', description: 'Café; 500 g', brand: 'Aroma', line: 'Mercearia', unit: 'UN', ean: null, thumbnail_url: null, is_campaign: true, price: null, availability: null, price_stock_visible: false }]);
    expect(csv.startsWith('﻿Código;Produto')).toBe(true);
    expect(csv).toContain('CAF-500;"Café; 500 g";Aroma;Mercearia;UN;;Sim\r\n');
  });

  it('filtros na URL: aba, texto e linha; aba desconhecida volta para produtos', () => {
    expect(lerFiltrosBko('?aba=sinonimos&q=caf')).toEqual({ aba: 'sinonimos', q: 'caf', linha: '' });
    expect(lerFiltrosBko('?aba=x')).toEqual({ aba: 'produtos', q: '', linha: '' });
    expect(buscaDosFiltros({ aba: 'produtos', q: '', linha: 'Bebidas' })).toBe('?linha=Bebidas');
  });
});

describe('seção Catálogo do cadastro do produto (T-0085 K9; RN-CAT-09, RN-CAT-11)', () => {
  const P = '00000000-0000-4000-8000-000000000001';
  const OUTRO = '00000000-0000-4000-8000-000000000002';
  const MARCA = '00000000-0000-4000-8000-0000000000a1';
  const ids = new Map([['DIS-1', OUTRO]]);
  const vazio = { aplicacao: '', ofereceJunto: '', referencias: [{ marca_id: '', codigo: '' }, { marca_id: '', codigo: '' }, { marca_id: '', codigo: '' }], etiquetas: '' };

  it('ida e volta: a ficha vira o formulário com 3 linhas de referência', () => {
    const f = formCadastroDaFicha({ catalogo: { aplicacao: 'Uno 2010–2014', referencias: [{ marca_id: MARCA, marca_nome: 'Freiomax', codigo: 'CB 3401' }], oferece_junto: [{ produto_id: OUTRO, erp_code: 'DIS-1', description: 'Disco' }], etiquetas: ['Novo', 'Dianteira'] } });
    expect(f.referencias).toHaveLength(3);
    expect(f.ofereceJunto).toBe('DIS-1');
    expect(f.etiquetas).toBe('Novo, Dianteira');
    expect(cadastroCatalogoDoForm(P, f, { idsPorCodigo: ids, aplicacaoMax: 2000 })).toEqual({
      ok: true,
      valor: { aplicacao: 'Uno 2010–2014', oferece_junto: [OUTRO], referencias: [{ marca_id: MARCA, codigo: 'CB 3401' }], etiquetas: ['Novo', 'Dianteira'] },
    });
    expect(formCadastroDaFicha({})).toMatchObject({ aplicacao: '', ofereceJunto: '' });
  });

  it('RN-CAT-09: sem marcas carregadas o corpo não leva `referencias` (o servidor mantém as existentes)', () => {
    const f = { ...vazio, aplicacao: 'Uno', referencias: [{ marca_id: MARCA, codigo: 'CB 3401' }, ...vazio.referencias.slice(1)] };
    const r = cadastroCatalogoDoForm(P, f, { idsPorCodigo: ids, aplicacaoMax: 2000, semReferencias: true });
    expect(r.ok && 'referencias' in r.valor && r.valor.referencias !== undefined).toBe(false);
  });

  it('RN-CAT-09: linhas vazias ficam de fora; marca sem código, código sem marca dão erro com a ação seguinte', () => {
    const op = { idsPorCodigo: ids, aplicacaoMax: 2000 };
    expect(cadastroCatalogoDoForm(P, vazio, op)).toEqual({ ok: true, valor: { aplicacao: null, oferece_junto: [], referencias: [], etiquetas: [] } });
    expect(cadastroCatalogoDoForm(P, { ...vazio, referencias: [{ marca_id: MARCA, codigo: '' }, ...vazio.referencias.slice(1)] }, op)).toMatchObject({ ok: false, erro: expect.stringMatching(/Informe o código/) });
    expect(cadastroCatalogoDoForm(P, { ...vazio, referencias: [{ marca_id: '', codigo: 'CB 3401' }, ...vazio.referencias.slice(1)] }, op)).toMatchObject({ ok: false, erro: expect.stringMatching(/escolha a marca/) });
  });

  it('RN-CAT-09: código fora da página carregada vai ao servidor em oferece_junto_codigos; o que está na lista casa sem diferenciar maiúsculas', () => {
    const op = { idsPorCodigo: new Map([['DIS-1', 'id-dis']]), aplicacaoMax: 2000 };
    expect(cadastroCatalogoDoForm(P, { ...vazio, ofereceJunto: 'dis-1\nLONGE-9' }, op)).toMatchObject({ ok: true, valor: { oferece_junto: ['id-dis'], oferece_junto_codigos: ['LONGE-9'] } });
  });

  it('RN-CAT-09: limites do domain valem na tela (6 em oferece junto, etiqueta de 21 caracteres)', () => {
    const muitos = new Map(Array.from({ length: 6 }, (_, i) => [`P${i}`, `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`]));
    const op = { idsPorCodigo: muitos, aplicacaoMax: 2000 };
    expect(cadastroCatalogoDoForm(P, { ...vazio, ofereceJunto: [...muitos.keys()].join('\n') }, op)).toMatchObject({ ok: false });
    expect(cadastroCatalogoDoForm(P, { ...vazio, etiquetas: 'a'.repeat(21) }, op)).toMatchObject({ ok: false });
  });

  it('RN-CAT-11: aplicação acima do limite do tenant é recusada na tela', () => {
    expect(cadastroCatalogoDoForm(P, { ...vazio, aplicacao: 'x'.repeat(101) }, { idsPorCodigo: ids, aplicacaoMax: 100 })).toMatchObject({ ok: false, erro: expect.stringMatching(/passa de 100/) });
  });
});

describe('editores do produto e oferece junto (T-0085, BKO)', () => {
  it('editores: fechar um não fecha o outro (nem some o texto do que segue aberto)', () => {
    const item = { id: 'a' };
    const abertos = abrirEditores(item);
    expect(abertos).toEqual({ conteudo: item, catalogo: item });
    expect(fecharEditor(abertos, 'conteudo')).toEqual({ conteudo: null, catalogo: item });
    expect(fecharEditor(abertos, 'catalogo')).toEqual({ conteudo: item, catalogo: null });
    expect(fecharEditor(fecharEditor(abertos, 'catalogo'), 'conteudo')).toEqual(EDITORES_FECHADOS);
  });

  it('RN-CAT-09: oferece junto da ficha fora da página carregada entra no mapa e a validação aceita', () => {
    const mapa = mapaIdsPorCodigo([{ erp_code: 'A1', id: 'id-a1' }], [{ erp_code: 'Z9', produto_id: 'id-z9' }]);
    expect(mapa.get('Z9')).toBe('id-z9');
    expect(mapa.get('A1')).toBe('id-a1');
    const form = { ...formCadastroDaFicha({ catalogo: { aplicacao: null, referencias: [], oferece_junto: [{ produto_id: 'id-z9', erp_code: 'Z9', description: 'Z' }], etiquetas: [] } }) };
    const r = cadastroCatalogoDoForm('p1', form, { idsPorCodigo: mapa, aplicacaoMax: 2000 });
    expect(r.ok).toBe(true);
  });
});
