/**
 * Catálogo v2 do Campo: cartão da grade, estoque, copiar e filtro padrão. Sem banco: roda local e no CI.
 * Spec aprovada: `docs/design/catalogo-campo-v2/spec.md` (branch `nuvem/catalogo-campo-designer-ux`, commit fd17f346;
 * R-20261115-073000, R-20261115-074500, R-20261115-082500 e R-20261115-084500-alexandre). Faixas e tenant que esconde a
 * quantidade: `docs/design/catalogo-grade.md` §4 (fonte da verdade pelo RD-0560). Roteiro do aparelho: `docs/testes/catalogo-v2-roteiro.md`.
 *
 * O cartão real (`CartaoGrade` de `modules/catalogo/app/telas/comum.tsx`) é renderizado com react-dom/server sobre um
 * react-native de mentira: cada `Text` de fora vira uma linha (`<p>`), e os toques ficam guardados pelo `testID` para o teste
 * apertar. O estoque é montado pelo domain real (`estoqueVisivel`, RN-CAT-07), do saldo das filiais até a tag (valor × regra).
 *
 * Os dois estados valem (este arquivo entra no `main` antes do PR do modulo-catalogo): cada critério tem o seu detector
 * (`apoio/estado-prs.ts`, e o dos códigos aqui, pelo cartão renderizado). Antes do PR, os casos novos são `it.fails`
 * (pendência explícita: o resultado mostra "expected fail"); com o PR, viram `it` sozinhos e têm de passar. Se o detector
 * virar e o caso falhar, o PR está fora da spec; se o caso passar com o detector parado, o `it.fails` fica vermelho.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Toque = () => unknown;
const toques = new Map<string, Toque>();
const copiados: string[] = [];

vi.mock('react-native', async () => {
  const { createContext: cc, createElement: ce, useContext: uc } = await import('react');
  const DentroDeTexto = cc(false);
  const Text = (p: { children?: ReactNode; testID?: string }) =>
    uc(DentroDeTexto)
      ? ce('span', p.testID ? { 'data-testid': p.testID } : {}, p.children)
      : ce(DentroDeTexto.Provider, { value: true }, ce('p', { 'data-linha': '1', ...(p.testID ? { 'data-testid': p.testID } : {}) }, p.children));
  const View = (p: { children?: ReactNode; testID?: string }) => ce('div', p.testID ? { 'data-testid': p.testID } : {}, p.children);
  const Pressable = (p: { children?: ReactNode; testID?: string; onPress?: Toque }) => {
    if (p.testID && p.onPress) toques.set(p.testID, p.onPress);
    return ce('button', p.testID ? { 'data-testid': p.testID } : {}, typeof p.children === 'function' ? null : p.children);
  };
  return {
    Text,
    View,
    Pressable,
    Image: () => null,
    StyleSheet: { create: <T,>(s: T) => s, flatten: <T,>(s: T) => s },
    Platform: { OS: 'android', select: <T,>(o: { android?: T; default?: T }) => o.android ?? o.default },
    Dimensions: { get: () => ({ width: 360, height: 800 }) },
    ToastAndroid: { show: () => undefined, SHORT: 0 },
    AccessibilityInfo: { announceForAccessibility: () => undefined },
    Clipboard: { setString: (t: string) => void copiados.push(t) },
  };
});

vi.mock('@macuxi/ui/mobile', async () => {
  const { createElement: ce } = await import('react');
  interface Props {
    children?: ReactNode;
    testID?: string;
    texto?: string;
    label?: string;
    rotulo?: string;
    tom?: string;
    onPress?: Toque;
  }
  const generico = (nome: string) => (p: Props) => {
    if (p.testID && p.onPress) toques.set(p.testID, p.onPress);
    const attrs: Record<string, string> = { 'data-c': nome };
    if (p.testID) attrs['data-testid'] = p.testID;
    if (p.tom) attrs['data-tom'] = p.tom;
    return ce('span', attrs, p.texto ?? p.label ?? p.rotulo ?? null, typeof p.children === 'function' ? null : p.children);
  };
  const conhecidos: Record<string, unknown> = {
    colors: new Proxy({}, { get: () => '#000' }),
    fonts: new Proxy({}, { get: () => 'f' }),
    type: new Proxy({}, { get: () => ({}) }),
    ALTURA: new Proxy({}, { get: () => 48 }),
    Icon: () => null,
    Cartao: (p: Props) => ce('section', p.testID ? { 'data-testid': p.testID } : {}, p.children),
  };
  // qualquer peça nova do kit que o cartão v2 usar renderiza o texto e o tom, sem quebrar a montagem
  return new Proxy(conhecidos, {
    get: (alvo, k) => (typeof k !== 'string' || k === 'then' || k === '__esModule' ? undefined : (alvo[k] ?? generico(k))),
    has: (_alvo, k) => typeof k === 'string' && k !== 'then',
  });
});

vi.mock('@macuxi/platform-sdk/react', () => ({ useExtensoes: () => [], useAmbiente: () => ({ online: () => true }) }));
vi.mock('../../modules/catalogo/app/telas/miniatura', () => ({ MiniaturaProduto: () => null }));

import { ItemVitrine, type EstoqueVisivel } from '../../modules/catalogo/contracts';
import { estoqueVisivel } from '../../modules/catalogo/domain/estoque';
import { definirCopiadorTexto } from '../../modules/catalogo/app/lib/copiar-codigo';
import { CartaoGrade } from '../../modules/catalogo/app/telas/comum';
import { CATALOGO_V2_ESTOQUE, CATALOGO_V2_FICHA, CATALOGO_V2_FILTRO } from './apoio/estado-prs';

const RAIZ = join(__dirname, '..', '..');
const fonte = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

// ---------- montagem do item ----------
const AGORA = '2026-11-15T11:28:00.000Z'; // 07:28 em Manaus
const PRODUTO = '0b9e7a40-0000-4000-8000-000000000001';
const BOA_VISTA = '0b9e7a40-0000-4000-8000-0000000000b1';
const MANAUS = '0b9e7a40-0000-4000-8000-0000000000a1';
const PARAMETROS = { estoque_baixo_ate: 9, estoque_mostrar_quantidade: true, estoque_defasado_horas: 24 };

/** Campo do código da marca no contrato (spec §6: o modulo-catalogo confirma a origem; hoje não existe). */
function campoCodigoDaMarca(): string | null {
  const def = (ItemVitrine as unknown as { _def?: { schema?: { shape?: Record<string, unknown> } } })._def;
  const chaves = Object.keys(def?.schema?.shape ?? {});
  return chaves.find((k) => /brand.*(code|codigo|external)|marca.*cod|cod.*marca/i.test(k)) ?? null;
}
const CAMPO_CODIGO_MARCA = campoCodigoDaMarca();

interface Saldo {
  filial: string;
  nome: string;
  quantidade: number;
}
function estoque(saldos: readonly Saldo[], opcoes: { filiais?: readonly string[] | null; mostrar?: boolean } = {}): EstoqueVisivel {
  return estoqueVisivel(
    PRODUTO,
    saldos.map((s) => ({ branch_id: s.filial, branch_name: s.nome, quantity: s.quantidade, updated_at: AGORA }) as Parameters<typeof estoqueVisivel>[1][number]),
    { filiais: opcoes.filiais === undefined ? [BOA_VISTA] : opcoes.filiais, agora: AGORA, parametros: { ...PARAMETROS, estoque_mostrar_quantidade: opcoes.mostrar ?? true } },
  );
}

interface Opcoes {
  marca?: string | null;
  codigoMarca?: string | null;
  codigo?: string;
  disponibilidade?: EstoqueVisivel | null;
  vePrecoEstoque?: boolean;
  equivale?: boolean;
}
function item(o: Opcoes = {}): ItemVitrine {
  const ve = o.vePrecoEstoque ?? true;
  const bruto: Record<string, unknown> = {
    id: PRODUTO,
    erp_code: o.codigo ?? 'PAF.1434',
    description: 'Pastilha de freio dianteira',
    brand: o.marca === undefined ? 'Travex' : (o.marca ?? ''), // sem marca no cadastro = texto vazio (`ProductBase.brand`)
    line: 'Freios',
    unit: 'PC',
    ean: '7891234500980',
    thumbnail_url: null,
    is_campaign: false,
    price: ve
      ? { product_id: PRODUTO, price_cents: 8640, base_cents: 8640, on_promotion: false, promotion_id: null, promotion_ends_at: null, price_table_id: null, source: 'padrao', sellable: true, reason: null, notice: null }
      : null,
    availability: ve ? (o.disponibilidade === undefined ? estoque([{ filial: BOA_VISTA, nome: 'Boa Vista', quantidade: 28 }]) : o.disponibilidade) : null,
    price_stock_visible: ve,
    ...(o.equivale ? { equivale_a: { marca_id: MANAUS, marca_nome: 'Freiomax', codigo: 'CB 3401', marcas: [] } } : {}),
  };
  if (CAMPO_CODIGO_MARCA) bruto[CAMPO_CODIGO_MARCA] = o.codigoMarca === undefined ? '980' : o.codigoMarca;
  return ItemVitrine.parse(bruto);
}

// ---------- leitura do cartão renderizado ----------
const decodificar = (s: string) =>
  s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").trim();

interface Cartao {
  html: string;
  linhas: string[];
  tags: { texto: string; tom: string }[];
  copiar: string[];
}
function renderizar(i: ItemVitrine, clienteId: string | null = null): Cartao {
  toques.clear();
  const html = renderToStaticMarkup(createElement(CartaoGrade, { item: i, clienteId, onPress: () => undefined }));
  const linhas = [...html.matchAll(/<p data-linha="1"[^>]*>([\s\S]*?)<\/p>/g)].map((m) => decodificar(m[1]!));
  const tags = [...html.matchAll(/<span[^>]*data-tom="([^"]+)"[^>]*>([\s\S]*?)<\/span>/g)].map((m) => ({ tom: m[1]!, texto: decodificar(m[2]!) }));
  return { html, linhas, tags, copiar: [...toques.keys()].filter((k) => /copiar/i.test(k)) };
}
const tagDeEstoque = (c: Cartao) => c.tags.filter((t) => /estoque/i.test(t.texto));

/** Códigos no cartão (critério b): o cartão v2 mostra o código do produto como texto; o de hoje, não (só na ficha). */
const CODIGOS_NO_CARTAO = renderizar(item()).linhas.some((l) => l.includes('PAF.1434'));

const seV2 = (detector: boolean) => (detector ? it : it.fails);

beforeEach(() => {
  copiados.length = 0;
  definirCopiadorTexto((t) => void copiados.push(t));
});

// ======================================================================================================================
describe('Catálogo v2 (a) — "Estoque: N" no cartão (spec §3, catalogo-grade.md §4; RN-CAT-07)', () => {
  const casos: { nome: string; saldos: Saldo[]; texto: string; tom: string }[] = [
    { nome: '84 (10 ou mais) → sucesso', saldos: [{ filial: BOA_VISTA, nome: 'Boa Vista', quantidade: 84 }], texto: 'Estoque: 84', tom: 'sucesso' },
    { nome: 'limite 10 → sucesso', saldos: [{ filial: BOA_VISTA, nome: 'Boa Vista', quantidade: 10 }], texto: 'Estoque: 10', tom: 'sucesso' },
    { nome: 'limite 9 → aviso', saldos: [{ filial: BOA_VISTA, nome: 'Boa Vista', quantidade: 9 }], texto: 'Estoque: 9', tom: 'aviso' },
    { nome: '6 (1 a 9) → aviso', saldos: [{ filial: BOA_VISTA, nome: 'Boa Vista', quantidade: 6 }], texto: 'Estoque: 6', tom: 'aviso' },
    { nome: 'limite 1 → aviso', saldos: [{ filial: BOA_VISTA, nome: 'Boa Vista', quantidade: 1 }], texto: 'Estoque: 1', tom: 'aviso' },
    { nome: '0 → "Estoque: 0" vermelho', saldos: [{ filial: BOA_VISTA, nome: 'Boa Vista', quantidade: 0 }], texto: 'Estoque: 0', tom: 'erro' },
    { nome: 'saldo negativo do ERP conta 0', saldos: [{ filial: BOA_VISTA, nome: 'Boa Vista', quantidade: -3 }], texto: 'Estoque: 0', tom: 'erro' },
    { nome: 'milhar em pt-BR', saldos: [{ filial: BOA_VISTA, nome: 'Boa Vista', quantidade: 1284 }], texto: 'Estoque: 1.284', tom: 'sucesso' },
  ];
  for (const c of casos) {
    seV2(CATALOGO_V2_ESTOQUE)(`EST-${c.nome}: valor × regra do saldo da filial até a tag`, () => {
      const tags = tagDeEstoque(renderizar(item({ disponibilidade: estoque(c.saldos) })));
      expect(tags).toEqual([{ texto: c.texto, tom: c.tom }]);
    });
  }

  seV2(CATALOGO_V2_ESTOQUE)('EST-sem saldo recebido = "Estoque: 0" vermelho (acaba o "Estoque sem informação"), com e sem cliente', () => {
    for (const cliente of [null, 'cli-1']) {
      const c = renderizar(item({ disponibilidade: estoque([]) }), cliente);
      expect(tagDeEstoque(c), `cliente ${cliente}`).toEqual([{ texto: 'Estoque: 0', tom: 'erro' }]);
      expect(c.html).not.toMatch(/sem informação/i);
    }
  });

  seV2(CATALOGO_V2_ESTOQUE)('EST-filial do vendedor sem saldo, com saldo em outra filial: "Estoque: 0" (o número é o da filial do filtro)', () => {
    const saldos = [{ filial: MANAUS, nome: 'Manaus', quantidade: 12 }];
    expect(tagDeEstoque(renderizar(item({ disponibilidade: estoque(saldos, { filiais: [BOA_VISTA] }) })))).toEqual([{ texto: 'Estoque: 0', tom: 'erro' }]);
  });

  seV2(CATALOGO_V2_ESTOQUE)('EST-"Todas as filiais" soma as filiais (12 + 16 = 28) — valor × regra', () => {
    const saldos = [
      { filial: BOA_VISTA, nome: 'Boa Vista', quantidade: 16 },
      { filial: MANAUS, nome: 'Manaus', quantidade: 12 },
    ];
    const esperado = saldos.reduce((s, x) => s + x.quantidade, 0);
    expect(tagDeEstoque(renderizar(item({ disponibilidade: estoque(saldos, { filiais: null }) })))).toEqual([{ texto: `Estoque: ${esperado}`, tom: 'sucesso' }]);
    expect(tagDeEstoque(renderizar(item({ disponibilidade: estoque(saldos, { filiais: [BOA_VISTA] }) })))).toEqual([{ texto: 'Estoque: 16', tom: 'sucesso' }]);
  });

  it('EST-tenant que esconde a quantidade: "Em estoque", "Pouco estoque", "Sem estoque", sem número (os dois estados)', () => {
    const caso = (q: number) => tagDeEstoque(renderizar(item({ disponibilidade: estoque([{ filial: BOA_VISTA, nome: 'Boa Vista', quantidade: q }], { mostrar: false }) })));
    expect(caso(84)).toEqual([{ texto: 'Em estoque', tom: 'sucesso' }]);
    expect(caso(6)).toEqual([{ texto: 'Pouco estoque', tom: 'aviso' }]);
    expect(caso(0)).toEqual([{ texto: 'Sem estoque', tom: 'erro' }]);
  });

  seV2(CATALOGO_V2_ESTOQUE)('EST-tenant que esconde a quantidade, sem saldo recebido: "Sem estoque" vermelho', () => {
    expect(tagDeEstoque(renderizar(item({ disponibilidade: estoque([], { mostrar: false }) })))).toEqual([{ texto: 'Sem estoque', tom: 'erro' }]);
  });

  it('EST-perfil que não vê preço nem estoque (RN-CAT-05): nenhuma tag de estoque no cartão (os dois estados)', () => {
    const c = renderizar(item({ vePrecoEstoque: false }));
    expect(tagDeEstoque(c)).toEqual([]);
    expect(c.html).not.toMatch(/estoque/i);
  });

  it('EST-uma tag de estoque por cartão (os dois estados)', () => {
    expect(tagDeEstoque(renderizar(item()))).toHaveLength(1);
  });
});

// ======================================================================================================================
describe('Catálogo v2 (b) — códigos em duas linhas, logo embaixo do nome (spec §1.3, R-20261115-082500)', () => {
  const linhaDoCodigo = (c: Cartao) => c.linhas.findIndex((l) => l.includes('PAF.1434'));
  const linhaDoNome = (c: Cartao) => c.linhas.findIndex((l) => l.startsWith('Pastilha de freio'));
  const primeiraLinha = CAMPO_CODIGO_MARCA ? '980 · Travex' : 'Travex';

  seV2(CODIGOS_NO_CARTAO)(`COD-1: nome; em cima "${primeiraLinha}"; embaixo só "PAF.1434" (sem rótulo); depois o preço`, () => {
    const c = renderizar(item());
    const nome = linhaDoNome(c);
    const codigo = linhaDoCodigo(c);
    expect(nome).toBeGreaterThanOrEqual(0);
    expect(c.linhas[nome + 1]).toBe(primeiraLinha);
    expect(codigo).toBe(nome + 2);
    expect(c.linhas[codigo]).toBe('PAF.1434');
    const preco = c.linhas.findIndex((l) => l.startsWith('R$'));
    expect(preco).toBeGreaterThan(codigo);
  });

  seV2(CODIGOS_NO_CARTAO)('COD-2: cada código aparece uma vez no cartão (o código do produto e a marca não se repetem)', () => {
    const c = renderizar(item());
    expect(c.linhas.filter((l) => l.includes('PAF.1434') && !l.startsWith('Pastilha'))).toHaveLength(1);
    expect(c.linhas.filter((l) => /\bTravex\b/.test(l) && !l.startsWith('Pastilha'))).toHaveLength(1);
  });

  seV2(CODIGOS_NO_CARTAO)('COD-3: sem marca, a linha de cima some e fica só o código do produto com o copiar', () => {
    const c = renderizar(item({ marca: null, codigoMarca: null }));
    const nome = linhaDoNome(c);
    expect(c.linhas[nome + 1]).toBe('PAF.1434');
    expect(c.copiar).toHaveLength(1);
  });

  seV2(CODIGOS_NO_CARTAO)('COD-4: com marca e sem código da marca, a linha de cima é só a marca (premissa: a spec não diz; ver roteiro 2.4)', () => {
    const c = renderizar(item({ codigoMarca: null }));
    const nome = linhaDoNome(c);
    expect(c.linhas.slice(nome + 1, nome + 3)).toEqual(['Travex', 'PAF.1434']);
  });

  seV2(CODIGOS_NO_CARTAO)('COD-5: busca pela referência cruzada acrescenta "Equivale a Freiomax CB 3401" sem tirar as linhas dos códigos (§1.4)', () => {
    const c = renderizar(item({ equivale: true }));
    const codigo = linhaDoCodigo(c);
    expect(c.linhas[codigo]).toBe('PAF.1434');
    expect(c.linhas[codigo - 1]).toBe(primeiraLinha);
    expect(c.linhas.indexOf('Equivale a Freiomax CB 3401')).toBeGreaterThan(codigo);
  });

  it.fails('COD-6 PENDÊNCIA (spec §6): o contrato `ItemVitrine` traz o código da marca ("980"); a origem é do modulo-catalogo/modulo-integracao', () => {
    expect(CAMPO_CODIGO_MARCA).not.toBeNull();
  });
});

// ======================================================================================================================
describe('Catálogo v2 (c) — o copiar copia só o código do produto (spec §1 e §2, R-20261115-084500)', () => {
  it('CP-1: um copiar só no cartão, e ele copia exatamente "PAF.1434" (os dois estados)', async () => {
    const c = renderizar(item());
    expect(c.copiar).toHaveLength(1);
    await toques.get(c.copiar[0]!)!();
    expect(copiados).toEqual(['PAF.1434']);
  });

  it('CP-2: sem rótulo, sem código da marca, sem marca e sem EAN no texto copiado (os dois estados)', async () => {
    const c = renderizar(item());
    await toques.get(c.copiar[0]!)!();
    const [texto] = copiados;
    expect(texto).not.toMatch(/c[óo]digo|:|·|Travex|980|7891234500980|\s/i);
  });

  it('CP-3: código com espaço nas pontas vindo do ERP: copia sem os espaços (os dois estados)', async () => {
    const c = renderizar(item({ codigo: '  PAF.1434 ' }));
    await toques.get(c.copiar[0]!)!();
    expect(copiados).toEqual(['PAF.1434']);
  });

  it('CP-4: na ficha, todo copiar recebe só o código do produto (`item.erp_code`) (os dois estados)', () => {
    const ficha = fonte('modules/catalogo/app/telas/produto.tsx');
    const usos = [...ficha.matchAll(/<BotaoCopiarCodigo\b([^>]*)\/?>/g)].map((m) => m[1]!);
    expect(usos.length).toBeGreaterThan(0);
    for (const u of usos) expect(u).toMatch(/codigo=\{item\.erp_code\}/);
  });

  seV2(CATALOGO_V2_FICHA)('CP-5: na ficha sai o botão "Copiar código" na caixa própria; fica só o ícone ao lado do código (§2)', () => {
    const ficha = fonte('modules/catalogo/app/telas/produto.tsx');
    const usos = [...ficha.matchAll(/<BotaoCopiarCodigo\b([^>]*)\/?>/g)].map((m) => m[1]!);
    expect(usos).toHaveLength(1);
    expect(usos[0]).toMatch(/variante="icone"/);
  });
});

// ======================================================================================================================
describe('Catálogo v2 (d) — filtro padrão: abre na filial do vendedor (spec §4, R-20261115-073000 e 074500)', () => {
  const telas = () =>
    ['modules/catalogo/app/telas/catalogo.tsx', 'modules/catalogo/app/telas/comum.tsx', 'modules/catalogo/app/lib/grade.ts'].map(fonte).join('\n');

  seV2(CATALOGO_V2_FILTRO)('FIL-1: a folha "Filtrar" tem Filial (sua filial, as outras, Todas as filiais) e Itens sem estoque (Mostrar/Ocultar)', () => {
    const f = telas();
    for (const t of ['Todas as filiais', 'sua filial', 'Itens sem estoque', 'Mostrar', 'Ocultar', 'Limpar']) expect(f, t).toContain(t);
  });

  seV2(CATALOGO_V2_FILTRO)('FIL-2: chip da filial "Filial <nome> ✕" e chip "Só com estoque ✕" com o Ocultar', () => {
    const f = telas();
    expect(f).toMatch(/`Filial \$\{/);
    expect(f).toContain('Só com estoque');
  });

  seV2(CATALOGO_V2_FILTRO)('FIL-3: o padrão de Pedidos na linha da busca (CampoBusca + BotaoFiltro + EtiquetaFiltro)', () => {
    const f = fonte('modules/catalogo/app/telas/catalogo.tsx');
    for (const c of ['CampoBusca', 'BotaoFiltro', 'EtiquetaFiltro']) expect(f, c).toContain(c);
  });

});
