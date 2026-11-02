import { describe, expect, it } from 'vitest';
import { buscaDosFiltros, conteudoDoForm, formDaFicha, lerFiltrosBko, produtosParaCsv, sinonimoDoForm } from './formularios';

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
