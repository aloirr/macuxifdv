import { describe, expect, it } from 'vitest';
import { acaoTecladoOfereceJunto, adicionarOfereceJunto, anuncioOfereceJunto, listaOfereceJunto, moverOfereceJunto, removerOfereceJunto, sugestoesOfereceJunto, buscaDosFiltros, cadastroCatalogoDoForm, contadorAplicacao, limiteAplicacao, mensagemDoCadastro, mensagemDoConteudo, nomesDoOfereceJunto, textoRemoverFaixa, conteudoDoForm, formCadastroDaFicha, formDaFicha, lerFiltrosBko, mapaIdsPorCodigo, abrirEditores, abrirParaLeitura, fecharEditor, EDITORES_FECHADOS, produtosParaCsv, sinonimoDoForm } from './formularios';

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

  it('filtros na URL: aba, texto e nível da hierarquia; aba desconhecida volta para produtos', () => {
    expect(lerFiltrosBko('?aba=sinonimos&q=caf')).toEqual({ aba: 'sinonimos', q: 'caf', no: '' });
    expect(lerFiltrosBko('?aba=x')).toEqual({ aba: 'produtos', q: '', no: '' });
    expect(buscaDosFiltros({ aba: 'produtos', q: 'café', no: '' })).toBe('?q=caf%C3%A9');
    expect(lerFiltrosBko('?no=n1')).toEqual({ aba: 'produtos', q: '', no: 'n1' });
    expect(buscaDosFiltros({ aba: 'produtos', q: '', no: 'n1' })).toBe('?no=n1');
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

  it('RN-CAT-09: linhas vazias ficam de fora; marca sem código dá erro com a ação seguinte; código sem marca é aceito, com marca_id nulo', () => {
    const op = { idsPorCodigo: ids, aplicacaoMax: 2000 };
    expect(cadastroCatalogoDoForm(P, vazio, op)).toEqual({ ok: true, valor: { aplicacao: null, oferece_junto: [], referencias: [], etiquetas: [] } });
    expect(cadastroCatalogoDoForm(P, { ...vazio, referencias: [{ marca_id: MARCA, codigo: '' }, ...vazio.referencias.slice(1)] }, op)).toMatchObject({ ok: false, erro: expect.stringMatching(/Informe o código/) });
    expect(cadastroCatalogoDoForm(P, { ...vazio, referencias: [{ marca_id: '', codigo: 'CB 3401' }, ...vazio.referencias.slice(1)] }, op)).toMatchObject({ ok: true, valor: { referencias: [{ marca_id: null, codigo: 'CB 3401' }] } });
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
    expect(cadastroCatalogoDoForm(P, { ...vazio, aplicacao: 'x'.repeat(101) }, { idsPorCodigo: ids, aplicacaoMax: 100 })).toMatchObject({ ok: false, erro: expect.stringMatching(/Aplicação: use até 100 caracteres \(agora: 101\)/) });
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

  it('B6 (UX): quem não tem produto.enriquecer abre só a seção Catálogo (leitura), sem o editor de conteúdo', () => {
    const item = { id: 'a' };
    expect(abrirParaLeitura(item)).toEqual({ conteudo: null, catalogo: item });
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

describe('UX B5: mensagens sem o caminho técnico do campo', () => {
  const ids = new Map([['A-1', 'id-a1']]);
  const form = { aplicacao: '', ofereceJunto: '', referencias: [{ marca_id: '', codigo: '' }], etiquetas: '' };
  const erro = (f: object) => {
    const r = cadastroCatalogoDoForm('p1', { ...form, ...f }, { idsPorCodigo: ids, aplicacaoMax: 2000 });
    return r.ok ? '' : r.erro;
  };
  it('RN-CAT-09: código do concorrente acima de 30 → "Código 1: use até 30 caracteres."', () => {
    const e = erro({ referencias: [{ marca_id: '00000000-0000-4000-8000-000000000001', codigo: 'x'.repeat(31) }] });
    expect(e).toBe('Código 1: use até 30 caracteres.');
  });
  it('RN-CAT-10: mais de 4 etiquetas ou etiqueta longa → "Use até 4 etiquetas, com até 20 caracteres cada."', () => {
    expect(erro({ etiquetas: 'a,b,c,d,e' })).toBe('Use até 4 etiquetas, com até 20 caracteres cada.');
    expect(erro({ etiquetas: 'x'.repeat(21) })).toBe('Use até 4 etiquetas, com até 20 caracteres cada.');
  });
  it('RN-CAT-10: mais de 5 em oferece junto → "Oferece junto: use até 5 produtos."', () => {
    expect(erro({ ofereceJunto: 'A-1\nA-1\nA-1\nA-1\nA-1\nA-1' })).toBe('Oferece junto: use até 5 produtos.');
  });
  it('nenhuma mensagem mostra "Confira o campo"', () => {
    expect(mensagemDoCadastro({ path: ['referencias', 0, 'codigo'], message: 'x' })).not.toMatch(/Confira o campo|referencias\.0/);
    expect(mensagemDoConteudo({ path: ['faq', 0, 'answer'], message: 'Use até 500 caracteres.' })).toBe('Perguntas frequentes: Use até 500 caracteres.');
  });
});

describe('UX B2/B4 e T-0089 K3: contador, nomes e diálogo', () => {
  it('RN-CAT-11: o limite vem de aplicacao_max_cadastro (padrão 2.000) e o contador fica vermelho acima dele', () => {
    expect(limiteAplicacao({})).toBe(2000);
    expect(limiteAplicacao({ aplicacao_max_cadastro: 500 })).toBe(500);
    expect(limiteAplicacao({ aplicacao_max_cadastro: 50 })).toBe(2000);
    expect(contadorAplicacao(1234, 2000)).toEqual({ texto: '1.234 / 2.000', excede: false });
    expect(contadorAplicacao(501, 500).excede).toBe(true);
  });
  it('RN-CAT-09: Oferece junto mostra o nome do produto embaixo do código achado', () => {
    const r = nomesDoOfereceJunto('cb-0002\n\nXX-9', [{ erp_code: 'CB-0002', description: 'Disco de freio ventilado' }]);
    expect(r).toEqual([
      { codigo: 'cb-0002', rotulo: 'cb-0002 · Disco de freio ventilado' },
      { codigo: 'XX-9', rotulo: null },
    ]);
  });
  it('RN-VEN-23: remover a faixa pergunta com título e consequência', () => {
    expect(textoRemoverFaixa(10, 'Café 500 g')).toEqual({ titulo: 'Remover a faixa de 10 para Café 500 g?', corpo: 'O vendedor deixa de ver esta faixa no pedido na próxima sincronização.' });
  });
});

describe('seletor reordenável do Oferece junto (B6 de UX; RN-CAT-10)', () => {
  const texto = 'A-1\nB-2\nC-3';
  it('RN-CAT-10: sobe, desce e não passa dos extremos', () => {
    expect(moverOfereceJunto(texto, 1, -1)).toBe('B-2\nA-1\nC-3');
    expect(moverOfereceJunto(texto, 1, 1)).toBe('A-1\nC-3\nB-2');
    expect(moverOfereceJunto(texto, 0, -1)).toBe(texto);
    expect(moverOfereceJunto(texto, 2, 1)).toBe(texto);
  });
  it('RN-CAT-10: adicionar recusa repetido e o 6º produto, com a ação seguinte', () => {
    expect(adicionarOfereceJunto(texto, 'D-4', 5)).toEqual({ texto: 'A-1\nB-2\nC-3\nD-4', erro: null });
    expect(adicionarOfereceJunto(texto, 'a-1', 5).erro).toBe('a-1 já está na lista.');
    expect(adicionarOfereceJunto('A\nB\nC\nD\nE', 'F', 5).erro).toBe('Use até 5 produtos. Tire um para colocar outro.');
    expect(adicionarOfereceJunto(texto, '  ', 5).erro).toMatch(/Escolha um produto/);
  });
  it('remover tira só o item pedido', () => {
    expect(removerOfereceJunto(texto, 1)).toBe('A-1\nC-3');
    expect(listaOfereceJunto('A\r\n\n B \n')).toEqual(['A', 'B']);
  });
  it('teclado: Alt+setas movem, Home/End vão ao extremo, Delete remove, o resto passa', () => {
    expect(acaoTecladoOfereceJunto({ key: 'ArrowUp', altKey: true }, 1, 3)).toEqual({ tipo: 'mover', para: 0 });
    expect(acaoTecladoOfereceJunto({ key: 'ArrowDown', altKey: true }, 1, 3)).toEqual({ tipo: 'mover', para: 2 });
    expect(acaoTecladoOfereceJunto({ key: 'End', altKey: true }, 0, 3)).toEqual({ tipo: 'mover', para: 2 });
    expect(acaoTecladoOfereceJunto({ key: 'ArrowUp', altKey: true }, 0, 3)).toBeNull();
    expect(acaoTecladoOfereceJunto({ key: 'ArrowUp' }, 1, 3)).toBeNull();
    expect(acaoTecladoOfereceJunto({ key: 'Delete' }, 1, 3)).toEqual({ tipo: 'remover' });
  });
  it('anúncio para leitor de tela e sugestões sem repetidos nem o próprio produto', () => {
    expect(anuncioOfereceJunto('moveu', 'B-2 · Pastilha', 1, 3)).toBe('B-2 · Pastilha na posição 1 de 3.');
    expect(anuncioOfereceJunto('removeu', 'B-2', 0, 1)).toBe('B-2 removido. 1 produto na lista.');
    const ps = [{ erp_code: 'A-1', description: 'Disco' }, { erp_code: 'B-2', description: 'Pastilha de freio' }, { erp_code: 'EU', description: 'Freio' }];
    expect(sugestoesOfereceJunto(ps, 'freio', ['A-1'], 'EU').map((p) => p.erp_code)).toEqual(['B-2']);
    expect(sugestoesOfereceJunto(ps, ' ', [], 'EU')).toEqual([]);
  });
});
