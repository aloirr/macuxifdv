import { describe, expect, it } from 'vitest';
import { buscaDosFiltrosTabelas, centavosDoTexto, faixaDoForm, FORM_FAIXA_VAZIO, formDaFaixa, faixasParaCsv, lerFiltrosTabelas, textoDosCentavos, precosParaCsv } from './tabelas-preco';

const P1 = '0b000000-0000-4000-8000-000000000001';
const faixa = {
  id: '0c000000-0000-4000-8000-000000000001',
  produto_id: P1,
  sku: 'P-1',
  nome: 'Pastilha; "dianteira"',
  medida: 'FD',
  quantidade_minima: 10,
  preco_unidade_cents: 1590,
  vigencia_inicio: '2026-11-01',
  vigencia_fim: null,
  tabela_preco_id: null,
  tabela_preco_nome: null,
  ativo: true,
  origem: 'manual' as const,
  mais_cara_que_a_tabela: false,
  vigente: true,
};

describe('BKO Tabelas de preço: preço da UN e aba Escalonada (RN-VEN-23, RN-VEN-15)', () => {
  it('filtros na URL: aba, tabela, busca e só vigentes ida e volta; padrão = aba Preço da UN', () => {
    expect(lerFiltrosTabelas('')).toEqual({ aba: 'precos', tabela: '', q: '', vigente: false });
    const f = { aba: 'escalonada' as const, tabela: 'abc', q: 'pastilha', vigente: true };
    expect(buscaDosFiltrosTabelas(f)).toBe('?aba=escalonada&tabela=abc&q=pastilha&vigente=1');
    expect(lerFiltrosTabelas(buscaDosFiltrosTabelas(f))).toEqual(f);
    expect(buscaDosFiltrosTabelas({ aba: 'precos', tabela: '', q: '', vigente: false })).toBe('');
    expect(lerFiltrosTabelas('?aba=outra').aba).toBe('precos');
  });

  it('RN-VEN-23: o preço da faixa digitado em reais com vírgula vira centavos, sem erro de ponto flutuante', () => {
    expect(centavosDoTexto('15,90')).toBe(1590);
    expect(centavosDoTexto('1.234,5')).toBe(123450);
    expect(centavosDoTexto('0,07')).toBe(7);
    expect(centavosDoTexto('19,999')).toBeNull();
    expect(centavosDoTexto('abc')).toBeNull();
    expect(centavosDoTexto('')).toBeNull();
    expect(textoDosCentavos(1590)).toBe('15,90');
  });

  it('RN-VEN-23: formulário válido vira o corpo do PUT (medida em maiúsculas, fim vazio = aberta, "todas as tabelas" = nulo)', () => {
    const r = faixaDoForm({ ...FORM_FAIXA_VAZIO, produto_id: P1, medida: 'fd', quantidade_minima: '10', preco: '15,90', vigencia_inicio: '2026-11-01' });
    expect(r).toEqual({ ok: true, valor: { produto_id: P1, medida: 'FD', quantidade_minima: 10, preco_unidade_cents: 1590, vigencia_inicio: '2026-11-01', vigencia_fim: null, tabela_preco_id: null, ativo: true } });
  });

  it('RN-VEN-23: erros dizem o campo e a ação seguinte, em português', () => {
    const base = { ...FORM_FAIXA_VAZIO, produto_id: P1, quantidade_minima: '10', preco: '15,90', vigencia_inicio: '2026-11-01' };
    expect(faixaDoForm({ ...base, produto_id: '' })).toEqual({ ok: false, erro: 'Escolha o produto da faixa.' });
    expect(faixaDoForm({ ...base, preco: '0' })).toMatchObject({ ok: false, erro: expect.stringContaining('preço') });
    expect(faixaDoForm({ ...base, preco: 'x' })).toMatchObject({ ok: false, erro: expect.stringContaining('preço') });
    expect(faixaDoForm({ ...base, quantidade_minima: '2,5' })).toMatchObject({ ok: false, erro: expect.stringContaining('quantidade') });
    expect(faixaDoForm({ ...base, vigencia_fim: '2026-10-01' })).toMatchObject({ ok: false, erro: expect.stringContaining('fim da vigência') });
  });

  it('o formulário de edição reflete a faixa (ida e volta)', () => {
    const f = formDaFaixa(faixa);
    expect(f).toMatchObject({ produto_id: P1, medida: 'FD', quantidade_minima: '10', preco: '15,90', vigencia_inicio: '2026-11-01', vigencia_fim: '', tabela_preco_id: '', ativo: true });
    expect(faixaDoForm(f)).toMatchObject({ ok: true, valor: { preco_unidade_cents: 1590, medida: 'FD' } });
  });

  it('CSV da escalonada: BOM, ponto e vírgula, aspas dobradas, preço em reais e origem em português', () => {
    const csv = faixasParaCsv([faixa, { ...faixa, id: 'x', origem: 'erp', medida: null, tabela_preco_nome: 'Atacado', vigencia_fim: '2026-12-31', ativo: false }]);
    const linhas = csv.replace(/^\uFEFF/, '').split('\r\n');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(linhas[0]).toBe('Código;Produto;Medida;Quantidade mínima;Preço da unidade (R$);Tabela;Início;Fim;Situação;Origem');
    expect(linhas[1]).toBe('P-1;"Pastilha; ""dianteira""";FD;10;15,90;Todas;2026-11-01;;Ativa;Cadastrada aqui');
    expect(linhas[2]).toBe('P-1;"Pastilha; ""dianteira""";Unidade;10;15,90;Atacado;2026-11-01;2026-12-31;Inativa;ERP');
  });

  it('CSV do preço da UN: uma linha por produto', () => {
    const csv = precosParaCsv([{ produto_id: P1, sku: 'P-1', nome: 'Pastilha', preco_cents: 1890, vigencia_inicio: null, vigencia_fim: '2026-12-31T00:00:00.000000Z' }]);
    expect(csv.replace(/^\uFEFF/, '').split('\r\n').slice(0, 2)).toEqual(['Código;Produto;Preço da unidade (R$);Início;Fim', 'P-1;Pastilha;18,90;;2026-12-31']);
  });
});
