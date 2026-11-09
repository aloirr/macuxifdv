import { describe, expect, it } from 'vitest';

import type { MudancaNaConversao } from '../../domain/orcamento';
import { folhaPrecosDeHoje, TEXTOS_PRECOS_DE_HOJE } from './precos-de-hoje';

const nome = (id: string) => ({ cafe: 'Café torrado 500 g', acucar: 'Açúcar 1 kg', agua: 'Água mineral 1,5 L' })[id] ?? 'Produto';
const reconf = (over: Partial<Parameters<typeof folhaPrecosDeHoje>[0]['r']> = {}) => ({
  itens_hoje: [
    { product_id: 'cafe', unidade: 'UN', quantity: 2, antes_cents: 2322, hoje_cents: 2430 },
    { product_id: 'acucar', unidade: 'FD', quantity: 1, antes_cents: 3960, hoje_cents: 4066 },
    { product_id: 'agua', unidade: 'UN', quantity: 1, antes_cents: 714, hoje_cents: 714 },
  ],
  total_orcado_cents: 6996,
  total_hoje_cents: 7210,
  mudancas: [] as MudancaNaConversao[],
  bloqueio: null as string | null,
  ...over,
});
const base = { preco_vale: false, preco_data: '09/11', nome };

describe('RN-VEN-18: folha "Preços de hoje" (T-0141 G, prancha 2)', () => {
  it('RN-VEN-18: só aparece com o preço vencido e o total diferente; com o preço vigente ou total igual, transforma direto', () => {
    expect(folhaPrecosDeHoje({ ...base, preco_vale: true, r: reconf() })).toBeNull();
    expect(folhaPrecosDeHoje({ ...base, r: reconf({ total_hoje_cents: 6996, itens_hoje: [{ product_id: 'agua', unidade: 'UN', quantity: 1, antes_cents: 714, hoje_cents: 714 }] }) })).toBeNull();
  });
  it('RN-VEN-18: totais Orçamento (preço de dd/mm), Hoje e Diferença com "+" (valor × regra: hoje − orçamento)', () => {
    const f = folhaPrecosDeHoje({ ...base, r: reconf() })!;
    expect(f.titulo).toBe('Preços de hoje');
    expect(f.totais.map((t) => t.rotulo)).toEqual(['Orçamento (preço de 09/11)', 'Hoje', 'Diferença']);
    expect(f.totais[0]!.valor).toMatch(/^R\$\s69,96$/);
    expect(f.totais[1]!.valor).toMatch(/^R\$\s72,10$/);
    expect(f.totais[2]!.valor).toMatch(/^\+R\$\s2,14$/);
    expect(f.totais[2]!.tom).toBeUndefined();
  });
  it('RN-VEN-18: queda do total sai com "−" e em verde', () => {
    const f = folhaPrecosDeHoje({ ...base, r: reconf({ total_hoje_cents: 6800 }) })!;
    expect(f.totais[2]!.valor).toMatch(/^−R\$\s1,96$/);
    expect(f.totais[2]!.tom).toBe('sucesso');
  });
  it('RN-VEN-18: "Mudaram" lista só os itens que mudaram, "nome · qtd medida" e "R$ antes → R$ hoje"', () => {
    const f = folhaPrecosDeHoje({ ...base, r: reconf() })!;
    expect(f.mudaram.map((m) => m.rotulo)).toEqual(['Café torrado 500 g · 2 UN', 'Açúcar 1 kg · 1 FD']);
    expect(f.mudaram[0]!.valor).toMatch(/^R\$\s23,22 → R\$\s24,30$/);
    expect(f.mudaram[1]!.valor).toMatch(/^R\$\s39,60 → R\$\s40,66$/);
    expect(f.verTodos).toBeNull();
    expect(f.acao).toBe('Transformar com os preços de hoje');
    expect(f.semPreco).toEqual([]);
  });
  it('RN-VEN-18: mais de 8 itens: mostra 8 e "Ver os 12 itens"', () => {
    const itens = Array.from({ length: 12 }, (_, i) => ({ product_id: `p${i}`, unidade: 'UN', quantity: 1, antes_cents: 100, hoje_cents: 110 }));
    const f = folhaPrecosDeHoje({ ...base, r: reconf({ itens_hoje: itens, total_hoje_cents: 8000 }) })!;
    expect(f.mudaram).toHaveLength(8);
    expect(f.verTodos).toBe('Ver os 12 itens');
    expect(folhaPrecosDeHoje({ ...base, todos: true, r: reconf({ itens_hoje: itens, total_hoje_cents: 8000 }) })!.mudaram).toHaveLength(12);
  });
  it('RN-VEN-18: item sem preço hoje aparece em "Sem preço hoje" e o principal vira "Transformar sem este item" (2 ou mais: "estes itens")', () => {
    const sem = (id: string): MudancaNaConversao => ({ tipo: 'sem_preco', produto_id: id });
    const um = folhaPrecosDeHoje({ ...base, r: reconf({ mudancas: [sem('agua')] }) })!;
    expect(um.semPreco).toEqual(['Água mineral 1,5 L']);
    expect(um.acao).toBe('Transformar sem este item');
    const dois = folhaPrecosDeHoje({ ...base, r: reconf({ mudancas: [sem('agua'), sem('acucar')] }) })!;
    expect(dois.acao).toBe('Transformar sem estes itens');
  });
  it('RN-VEN-18: com bloqueio (abaixo do mínimo, estoque, cliente) a folha é a da conferência, não esta', () => {
    expect(folhaPrecosDeHoje({ ...base, r: reconf({ bloqueio: 'Um item ficou abaixo do preço mínimo de hoje.' }) })).toBeNull();
  });
  it('RN-VEN-18: textos da spec', () => {
    expect(TEXTOS_PRECOS_DE_HOJE.apoioDoBotao).toBe('Entra pelos preços de hoje');
    expect(TEXTOS_PRECOS_DE_HOJE.mudaram).toBe('Mudaram');
    expect(TEXTOS_PRECOS_DE_HOJE.semPrecoHoje).toBe('Sem preço hoje');
  });
});
