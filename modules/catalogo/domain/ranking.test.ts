import { describe, expect, it } from 'vitest';
import type { FiltrosInterpretados } from '../contracts';
import { PARAMETROS_PADRAO } from './parametros';
import { codigoCompacto, combinarNotas, distanciaEdicao, notaFinal, pontuacaoTextual, rankear, type DocBusca } from './ranking';
import { expandirSinonimos } from './texto';

const doc = (o: Partial<DocBusca> & { id: string }): DocBusca => ({
  sku: o.id.toUpperCase(),
  ean: null,
  nome: 'Produto',
  marca: '',
  categoria: '',
  atributos: '',
  estoque: 10,
  vendas: 0,
  campanha: false,
  preco_cents: 1000,
  ...o,
});
const grupos = (q: string, sin: Parameters<typeof expandirSinonimos>[1] = []) => expandirSinonimos(q, sin);
const filtros = (o: Partial<FiltrosInterpretados> = {}): FiltrosInterpretados => ({
  text: '',
  brand: null,
  line: null,
  min_price_cents: null,
  max_price_cents: null,
  stock: null,
  code: null,
  measures: [],
  sort: null,
  ...o,
});

describe('RF-CAT-01 / RF-CAT-02: pontuação textual', () => {
  it('RF-CAT-02: acerto no nome vale mais que na marca, na categoria e nos atributos', () => {
    const g = grupos('limpex');
    const nome = pontuacaoTextual(g, doc({ id: 'a', nome: 'Limpex Multiuso' })).pontos;
    const marca = pontuacaoTextual(g, doc({ id: 'b', marca: 'Limpex' })).pontos;
    const cat = pontuacaoTextual(g, doc({ id: 'c', categoria: 'Limpex' })).pontos;
    const atr = pontuacaoTextual(g, doc({ id: 'd', atributos: 'linha limpex' })).pontos;
    expect(nome).toBe(1);
    expect(nome).toBeGreaterThan(marca);
    expect(marca).toBeGreaterThan(cat);
    expect(cat).toBeGreaterThan(atr);
    expect(atr).toBeGreaterThan(0);
  });

  it('RF-CAT-02: cobrir todos os termos da consulta pontua mais que cobrir só parte', () => {
    const g = grupos('detergente neutro');
    const todos = pontuacaoTextual(g, doc({ id: 'a', nome: 'Detergente Neutro 500ml' }));
    const parte = pontuacaoTextual(g, doc({ id: 'b', nome: 'Detergente Coco' }));
    expect(todos).toMatchObject({ pontos: 1, casados: 2, total: 2 });
    expect(parte).toMatchObject({ casados: 1, total: 2 });
    expect(parte.pontos).toBe(0.5);
  });

  it('RF-CAT-02: plural e acento não atrapalham ("sabões" acha "Sabão")', () => {
    expect(pontuacaoTextual(grupos('sabões'), doc({ id: 'a', nome: 'Sabão em Pó' })).pontos).toBe(1);
  });

  it('RF-CAT-02: prefixo de 3+ letras pontua menos que a palavra inteira', () => {
    const p = pontuacaoTextual(grupos('deterg'), doc({ id: 'a', nome: 'Detergente' })).pontos;
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
    expect(pontuacaoTextual(grupos('de'), doc({ id: 'a', nome: 'Detergente' })).pontos).toBe(0);
  });

  it('RF-CAT-02: tolera erro de digitação (troca, falta ou sobra de letra) e pontua menos que o acerto exato', () => {
    const exato = pontuacaoTextual(grupos('detergente'), doc({ id: 'a', nome: 'Detergente' })).pontos;
    for (const errado of ['detregente', 'detergnte', 'detergentee', 'detargente']) {
      const p = pontuacaoTextual(grupos(errado), doc({ id: 'a', nome: 'Detergente' })).pontos;
      expect(p, errado).toBeGreaterThan(0);
      expect(p, errado).toBeLessThan(exato);
    }
    expect(pontuacaoTextual(grupos('amaciante'), doc({ id: 'a', nome: 'Detergente' })).pontos).toBe(0);
  });

  it('RF-CAT-02: palavra curta (até 3 letras) e medida não aceitam erro de digitação', () => {
    expect(pontuacaoTextual(grupos('gas'), doc({ id: 'a', nome: 'Gel' })).pontos).toBe(0);
    expect(pontuacaoTextual(grupos('2 litros'), doc({ id: 'a', nome: 'Água 3 L' })).pontos).toBe(0);
    expect(pontuacaoTextual(grupos('2 litros'), doc({ id: 'a', nome: 'Água 2L' })).pontos).toBe(1);
  });

  it('RF-CAT-02: sinônimo do tenant acha o produto cadastrado com o outro nome', () => {
    const sin = [{ term: 'amaciante', synonyms: ['suavizante'], active: true }];
    expect(pontuacaoTextual(grupos('suavizante', sin), doc({ id: 'a', nome: 'Amaciante Brisa' })).pontos).toBe(1);
    expect(pontuacaoTextual(grupos('suavizante'), doc({ id: 'a', nome: 'Amaciante Brisa' })).pontos).toBe(0);
  });

  it('RF-CAT-02: código ou EAN igual a um termo da consulta pontua como nome', () => {
    expect(pontuacaoTextual(grupos('7891000100103'), doc({ id: 'a', ean: '7891000100103', nome: 'Sem relação' })).pontos).toBe(1);
  });

  it('RF-CAT-02: número solto não basta — "televisão 50" não acha o "Saco 50 L", mas "50" sozinho ainda acha', () => {
    const saco = doc({ id: 'a', nome: 'Saco de Lixo 50 pcs' });
    expect(pontuacaoTextual(grupos('televisao 50'), saco).pontos).toBe(0);
    expect(pontuacaoTextual(grupos('50'), saco).pontos).toBe(1);
  });

  it('consulta sem termos de texto não pontua (só filtros)', () => {
    expect(pontuacaoTextual([], doc({ id: 'a' }))).toEqual({ pontos: 0, casados: 0, total: 0 });
  });

  it('distanciaEdicao conta troca de letras vizinhas como 1', () => {
    expect(distanciaEdicao('detregente', 'detergente')).toBe(1);
    expect(distanciaEdicao('abc', 'abc')).toBe(0);
    expect(distanciaEdicao('abc', 'xyz')).toBe(3);
  });
});

describe('RF-CAT-01: ranking híbrido (texto + semântico + boosts)', () => {
  const P = PARAMETROS_PADRAO;

  it('RF-CAT-01: sem nota semântica vale só o texto', () => {
    expect(combinarNotas(0.8, null, P.peso_semantico)).toBe(0.8);
  });

  it('RF-CAT-01: com nota semântica, média ponderada pelo peso do tenant (padrão 0,4)', () => {
    expect(combinarNotas(1, 0, 0.4)).toBeCloseTo(0.6, 6);
    expect(combinarNotas(0, 1, 0.4)).toBeCloseTo(0.4, 6);
    expect(combinarNotas(0.5, 0.5, 0.7)).toBeCloseTo(0.5, 6);
  });

  it('RF-CAT-01: a nota semântica é limitada ao intervalo 0..1', () => {
    expect(combinarNotas(0, 7, 0.5)).toBeCloseTo(0.5, 6);
    expect(combinarNotas(0, -3, 0.5)).toBe(0);
  });

  it('RF-CAT-01: boost por estoque, mais vendido e campanha somam à nota-base', () => {
    const base = 0.5;
    expect(notaFinal(base, { estoque: 5, vendas_norm: 0, campanha: false }, P)).toBeCloseTo(0.6, 6);
    expect(notaFinal(base, { estoque: 0, vendas_norm: 1, campanha: false }, P)).toBeCloseTo(0.6, 6);
    expect(notaFinal(base, { estoque: 0, vendas_norm: 0.5, campanha: true }, P)).toBeCloseTo(0.6, 6);
    expect(notaFinal(base, { estoque: 5, vendas_norm: 1, campanha: true }, P)).toBeCloseTo(0.75, 6);
  });

  it('RF-CAT-01: boost nunca ressuscita produto sem relevância (nota-base zero fica zero)', () => {
    expect(notaFinal(0, { estoque: 99, vendas_norm: 1, campanha: true }, P)).toBe(0);
  });

  it('RF-CAT-01: com estoque e mais vendido sobe acima de um texto um pouco melhor', () => {
    const lista = rankear(
      [
        doc({ id: 'sem', nome: 'Detergente Neutro', estoque: 0, vendas: 0 }),
        doc({ id: 'com', nome: 'Detergente Neutro', estoque: 30, vendas: 100 }),
      ],
      { filtros: filtros({ text: 'detergente neutro' }), sinonimos: [], parametros: P },
    );
    expect(lista.map((i) => i.doc.id)).toEqual(['com', 'sem']);
  });

  it('RF-CAT-01: texto muito melhor continua vencendo os boosts', () => {
    const lista = rankear(
      [
        doc({ id: 'ruim', nome: 'Detergente Coco', estoque: 30, vendas: 100, campanha: true }),
        doc({ id: 'bom', nome: 'Detergente Neutro', estoque: 0, vendas: 0 }),
      ],
      { filtros: filtros({ text: 'detergente neutro' }), sinonimos: [], parametros: P },
    );
    expect(lista[0]!.doc.id).toBe('bom');
  });

  it('RF-CAT-01: produto de campanha desempata a favor da campanha', () => {
    const lista = rankear([doc({ id: 'a', nome: 'Sabão' }), doc({ id: 'b', nome: 'Sabão', campanha: true })], { filtros: filtros({ text: 'sabao' }), sinonimos: [], parametros: P });
    expect(lista.map((i) => i.doc.id)).toEqual(['b', 'a']);
  });

  it('RF-CAT-01: produto só com nota semântica (sem termo em comum) entra no resultado', () => {
    const lista = rankear([doc({ id: 'a', nome: 'Lava-roupas líquido' }), doc({ id: 'b', nome: 'Água mineral' })], {
      filtros: filtros({ text: 'sabao para roupa' }),
      sinonimos: [],
      parametros: P,
      semantica: new Map([['a', 0.8]]),
    });
    expect(lista.map((i) => i.doc.id)).toEqual(['a']);
  });

  it('RF-CAT-01: sem texto na consulta, só filtros, ordena pelos boosts', () => {
    const lista = rankear([doc({ id: 'a', estoque: 0 }), doc({ id: 'b', estoque: 4, vendas: 10 })], { filtros: filtros({ stock: null }), sinonimos: [], parametros: P });
    expect(lista.map((i) => i.doc.id)).toEqual(['b', 'a']);
  });

  it('RF-CAT-01: termo sem nenhum acerto fica fora do resultado', () => {
    const lista = rankear([doc({ id: 'a', nome: 'Detergente' })], { filtros: filtros({ text: 'televisao' }), sinonimos: [], parametros: P });
    expect(lista).toEqual([]);
  });

  it('RF-CAT-01: desempate determinístico — nota, texto, estoque, vendas, nome, id (independe da ordem de entrada)', () => {
    const docs = [
      doc({ id: 'z', nome: 'Sabão', estoque: 5, vendas: 0 }),
      doc({ id: 'a', nome: 'Sabão', estoque: 5, vendas: 0 }),
      doc({ id: 'm', nome: 'Sabão Azul', estoque: 5, vendas: 0 }),
      doc({ id: 'k', nome: 'Sabão', estoque: 5, vendas: 0 }),
    ];
    const ordens = new Set<string>();
    const permutar = (xs: DocBusca[], pref: DocBusca[] = []) => {
      if (xs.length === 0) {
        const r = rankear(pref, { filtros: filtros({ text: 'sabao' }), sinonimos: [], parametros: PARAMETROS_PADRAO });
        ordens.add(r.map((i) => i.doc.id).join(','));
        return;
      }
      xs.forEach((x, i) => permutar([...xs.slice(0, i), ...xs.slice(i + 1)], [...pref, x]));
    };
    permutar(docs);
    expect([...ordens]).toEqual(['a,k,z,m']);
  });

  it('RF-CAT-01: "mais barato" ordena por preço crescente (sem preço por último) e desempata pela nota', () => {
    const lista = rankear(
      [doc({ id: 'a', nome: 'Sabão', preco_cents: 900 }), doc({ id: 'b', nome: 'Sabão', preco_cents: null }), doc({ id: 'c', nome: 'Sabão', preco_cents: 500 })],
      { filtros: filtros({ text: 'sabao', sort: 'preco_asc' }), sinonimos: [], parametros: P },
    );
    expect(lista.map((i) => i.doc.id)).toEqual(['c', 'a', 'b']);
    const desc = rankear(
      [doc({ id: 'a', nome: 'Sabão', preco_cents: 900 }), doc({ id: 'b', nome: 'Sabão', preco_cents: null }), doc({ id: 'c', nome: 'Sabão', preco_cents: 500 })],
      { filtros: filtros({ text: 'sabao', sort: 'preco_desc' }), sinonimos: [], parametros: P },
    );
    expect(desc.map((i) => i.doc.id)).toEqual(['a', 'c', 'b']);
  });
});

describe('RN-CAT-01: filtros estruturados no ranking', () => {
  const P = PARAMETROS_PADRAO;
  const docs = [
    doc({ id: 'a', nome: 'Detergente', marca: 'Limpex', categoria: 'Detergentes', preco_cents: 500, estoque: 10 }),
    doc({ id: 'b', nome: 'Detergente', marca: 'Ypê', categoria: 'Detergentes', preco_cents: 1500, estoque: 0 }),
    doc({ id: 'c', nome: 'Detergente', marca: 'Limpex', categoria: 'Limpeza', preco_cents: null, estoque: 3 }),
  ];
  const ids = (f: Partial<FiltrosInterpretados>) => rankear(docs, { filtros: filtros({ text: 'detergente', ...f }), sinonimos: [], parametros: P }).map((i) => i.doc.id).sort();

  it('RN-CAT-01: marca e categoria comparam sem acento e sem diferença de caixa', () => {
    expect(ids({ brand: 'LIMPEX' })).toEqual(['a', 'c']);
    expect(ids({ brand: 'ype' })).toEqual(['b']);
    expect(ids({ line: 'detergentes' })).toEqual(['a', 'b']);
  });

  it('RN-CAT-01: faixa de preço exclui quem está fora e quem não tem preço', () => {
    expect(ids({ max_price_cents: 1000 })).toEqual(['a']);
    expect(ids({ min_price_cents: 1000 })).toEqual(['b']);
    expect(ids({ min_price_cents: 500, max_price_cents: 1500 })).toEqual(['a', 'b']);
  });

  it('RN-CAT-01: "com estoque" e "sem estoque"', () => {
    expect(ids({ stock: 'com' })).toEqual(['a', 'c']);
    expect(ids({ stock: 'sem' })).toEqual(['b']);
  });

  it('RF-CAT-02: código exato (SKU ou EAN) devolve só o produto e vem antes de qualquer texto', () => {
    const lista = rankear([doc({ id: 'a', sku: 'DET-5L', nome: 'Detergente' }), doc({ id: 'b', ean: '7891000100103', nome: 'Outro' })], {
      filtros: filtros({ code: { type: 'sku', value: 'det-5l' } }),
      sinonimos: [],
      parametros: P,
    });
    expect(lista.map((i) => i.doc.id)).toEqual(['a']);
    const porEan = rankear([doc({ id: 'b', ean: '7891000100103', nome: 'Outro' })], { filtros: filtros({ code: { type: 'ean', value: '7891000100103' } }), sinonimos: [], parametros: P });
    expect(porEan).toHaveLength(1);
  });

  it('RF-CAT-02: código sem nenhum produto cai para a busca de texto; EAN sem texto e sem produto não devolve nada', () => {
    const semNada = rankear([doc({ id: 'a', nome: 'Detergente' })], { filtros: filtros({ text: 'detergente', code: { type: 'sku', value: 'NAOEXISTE' } }), sinonimos: [], parametros: P });
    expect(semNada.map((i) => i.doc.id)).toEqual(['a']);
    const ean = rankear([doc({ id: 'a', nome: 'Detergente' })], { filtros: filtros({ code: { type: 'ean', value: '7891000100103' } }), sinonimos: [], parametros: P });
    expect(ean).toEqual([]);
  });
});

describe('RF-CAT-01: código exato pela forma compacta (T-0052-B1)', () => {
  const P = PARAMETROS_PADRAO;
  const docs = [doc({ id: 'a', sku: 'PAS-DIA-150', nome: 'Pastilha de freio dianteira' }), doc({ id: 'b', sku: 'PAS-TRA-150', nome: 'Pastilha de freio traseira' })];
  const achar = (value: string) =>
    rankear(docs, { filtros: filtros({ text: value.toLowerCase().replace(/[^a-z0-9]/g, ''), code: { type: 'sku', value } }), sinonimos: [], parametros: P })
      .filter((i) => i.exato)
      .map((i) => i.doc.id);

  it('RF-CAT-01: SKU digitado sem hífen, em minúsculas ou com ponto acha o mesmo produto', () => {
    expect(achar('PASDIA150')).toEqual(['a']);
    expect(achar('pasdia150')).toEqual(['a']);
    expect(achar('PAS.DIA.150')).toEqual(['a']);
    expect(achar('PAS-DIA-150')).toEqual(['a']);
  });

  it('RF-CAT-01: código parecido, mas diferente, não vira acerto exato', () => {
    expect(achar('PASDIA15')).toEqual([]);
  });
});

describe('RF-CAT-02: desempenho do ranking com catálogo grande (T-0052-B4; limite folgado, sem relógio de negócio)', () => {
  const P = PARAMETROS_PADRAO;
  const palavras = ['freio', 'pastilha', 'oleo', 'filtro', 'cabo', 'corrente', 'pneu', 'vela', 'lona', 'fluido', 'sapata', 'disco', 'bateria', 'lampada', 'retrovisor'];
  const motos = ['CG 150', 'Biz 125', 'Fan 160', 'Bros 160', 'XRE 300', 'Factor 150'];
  const catalogo = (n: number): DocBusca[] =>
    Array.from({ length: n }, (_, i) =>
      doc({
        id: `p${i}`,
        sku: `SKU-${String(i).padStart(5, '0')}`,
        nome: `${palavras[i % palavras.length]} ${palavras[(i * 7 + 3) % palavras.length]} ${motos[i % motos.length]} ref ${i}`,
        marca: `Marca ${i % 40}`,
        categoria: `Linha ${i % 12}`,
        atributos: `Aplicação ${motos[(i + 1) % motos.length]} cor ${i % 5}`,
      }),
    );
  const medir = (docs: DocBusca[], q: string) => {
    const t0 = performance.now();
    const r = rankear(docs, { filtros: filtros({ text: grupos(q).map((g) => g[0]).join(' ') }), sinonimos: [], parametros: P });
    return { ms: performance.now() - t0, r };
  };

  it('RF-CAT-02: 400 candidatos (o que o FTS5 entrega) rankeiam em menos de 3 s, mesmo na primeira busca (antes: 1,2 s sem carga; folga para máquina ocupada)', () => {
    const { ms, r } = medir(catalogo(400), 'freio dianteiro');
    expect(r.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(3000);
  });

  it('RF-CAT-02: 2.154 produtos na varredura completa (pior caso, sem FTS5) não passam de 5 s (eram 3,8 a 14 s)', () => {
    const { ms, r } = medir(catalogo(2154), 'freio dianteiro');
    expect(r.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(5000);
  });
});

describe('forma compacta do SKU (T-0052, única para ranking e índice)', () => {
  it('RN-CAT-01: PAS-DIA-150, "pas dia 150" e "Pás/Dia 150" têm a mesma forma compacta; vazio e nulo dão vazio', () => {
    expect(codigoCompacto('PAS-DIA-150')).toBe('pasdia150');
    expect(codigoCompacto('pas dia 150')).toBe('pasdia150');
    expect(codigoCompacto('Pás/Dia 150')).toBe('pasdia150');
    expect(codigoCompacto('DET-5L')).toBe('det5l');
    expect(codigoCompacto(null)).toBe('');
    expect(codigoCompacto('')).toBe('');
  });
});
