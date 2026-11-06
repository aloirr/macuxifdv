/**
 * Lista por linha (RF-CAT-09, T-0085 fatia D): agrupamento sistema › grupo › linha, itens com referência cruzada e
 * oferece junto, e a regra do promotor sem preço nem estoque (RN-CAT-05).
 */
import { criarRelogio } from '@macuxi/comum/relogio';
import type { LinhaSync } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { ProdutoConteudoSyncSchema, ProdutoReferenciaSyncSchema, ProdutoRelacaoSyncSchema, type ItemVitrine } from '../../contracts';
import type { NoCatalogo, VinculoProdutoNo } from '../../domain/arvore';
import { agruparPorLinha, etiquetasDoItem, MAXIMO_OFERECE_JUNTO, MAXIMO_REFERENCIAS, medidaEmbalagem, montarExtras, montarItemLista, NO_SEM_LINHA, ofereceJuntoDoItem, referenciasDoItem, SEM_EXTRAS, textoEquivale, type ProdutoLista } from './lista-por-linha';
import { listaPorLinhaLocal } from './lista-por-linha-local';
import type { LeitorLocal } from './local';

const relogio = criarRelogio();
const AGORA = relogio.iso();
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const no = (n: number, nivel: number, pai: number | null, nome: string, ordem = n): NoCatalogo => ({ id: uuid(n), pai_id: pai === null ? null : uuid(pai), nivel, codigo: `N${n}`, nome, ordem, ativo: true });
const prod = (n: number, nome: string, extras: Partial<ProdutoLista['extras']> = {}): ProdutoLista => ({ id: uuid(100 + n), sku: `P-${n}`, nome, unidade: 'UN', extras: { ...SEM_EXTRAS, ...extras } });
const liga = (p: number, n: number): VinculoProdutoNo => ({ produto_id: uuid(100 + p), no_id: uuid(n) });

// Sistema 1 (Freios) › Grupo 2 (Pastilhas) › Linha 3 (Cerâmica); Grupo 4 (Discos) › Linha 5 (Ventilado); Sistema 6 (Motor)
const NOS = [no(1, 1, null, 'Freios'), no(2, 2, 1, 'Pastilhas'), no(3, 3, 2, 'Cerâmica'), no(4, 2, 1, 'Discos'), no(5, 3, 4, 'Ventilado'), no(6, 1, null, 'Motor', 2)];

describe('RF-CAT-09: agrupa em sistema › grupo › linha', () => {
  const produtos = [prod(1, 'Pastilha dianteira'), prod(2, 'Pastilha traseira'), prod(3, 'Disco ventilado'), prod(4, 'Vela de ignição'), prod(5, 'Sem lugar')];
  const vinculos = [liga(1, 3), liga(2, 3), liga(3, 5), liga(4, 6)];

  it('RF-CAT-09: cada nível traz a contagem de tudo abaixo dele, na ordem da árvore', () => {
    const r = agruparPorLinha(NOS, vinculos, produtos);
    expect(r.sistemas.map((s) => [s.no!.nome, s.rotuloNivel, s.total])).toEqual([['Freios', 'Sistema', 3], ['Motor', 'Sistema', 1]]);
    const freios = r.sistemas[0]!;
    expect(freios.filhos.map((g) => [g.no!.nome, g.rotuloNivel, g.total])).toEqual([['Pastilhas', 'Grupo', 2], ['Discos', 'Grupo', 1]]);
    expect(freios.filhos[0]!.filhos.map((l) => [l.no!.nome, l.rotuloNivel, l.total])).toEqual([['Cerâmica', 'Linha', 2]]);
  });

  it('RF-CAT-09: dentro da linha a ordem é por nome, estável (empate: código e id)', () => {
    const iguais = [{ ...prod(7, 'Pastilha'), sku: 'B' }, { ...prod(8, 'Pastilha'), sku: 'A' }, prod(9, 'Abraçadeira')];
    const r = agruparPorLinha(NOS, [liga(7, 3), liga(8, 3), liga(9, 3)], iguais);
    expect(r.sistemas[0]!.filhos[0]!.filhos[0]!.produtos.map((p) => p.nome + p.sku)).toEqual(['AbraçadeiraP-9', 'PastilhaA', 'PastilhaB']);
    const de_novo = agruparPorLinha(NOS, [liga(9, 3), liga(8, 3), liga(7, 3)], [...iguais].reverse());
    expect(de_novo.sistemas[0]!.filhos[0]!.filhos[0]!.produtos.map((p) => p.id)).toEqual(r.sistemas[0]!.filhos[0]!.filhos[0]!.produtos.map((p) => p.id));
  });

  it('RF-CAT-09: produto sem hierarquia (sem vínculo, nó inativo ou removido) vai para "sem linha" e nunca some', () => {
    const r = agruparPorLinha(NOS.map((n) => (n.id === uuid(6) ? { ...n, ativo: false } : n)), [...vinculos, { ...liga(5, 3), deleted_at: 'x' }], produtos);
    expect(r.semHierarquia.map((p) => p.nome)).toEqual(['Sem lugar', 'Vela de ignição']);
    expect(r.sistemas).toHaveLength(1);
  });

  it('RF-CAT-09: produto em duas linhas aparece nas duas e conta uma vez no sistema', () => {
    const r = agruparPorLinha(NOS, [liga(1, 3), liga(1, 5)], produtos);
    expect(r.sistemas[0]!.total).toBe(1);
    expect(r.sistemas[0]!.filhos.map((g) => g.total)).toEqual([1, 1]);
  });
});

const MARCA = (n: number) => uuid(700 + n);
const agora = AGORA;
const conteudo = (n: number, o: Record<string, unknown> = {}) => ProdutoConteudoSyncSchema.parse({ id: uuid(600 + n), updated_at: agora, deleted_at: null, external_id: null, produto_id: uuid(100 + n), descricao: null, ...o });
const ref = (n: number, ordem: number, o: Record<string, unknown> = {}) => ProdutoReferenciaSyncSchema.parse({ id: uuid(650 + n * 10 + ordem), updated_at: agora, deleted_at: null, external_id: null, produto_id: uuid(100 + n), marca_id: MARCA(ordem), codigo: `C${ordem}`, ordem, marca_nome: `M${ordem}`, ...o });
const relacao = (n: number, para: number, o: Record<string, unknown> = {}) => ProdutoRelacaoSyncSchema.parse({ id: uuid(800 + n * 10 + para), updated_at: agora, deleted_at: null, external_id: null, produto_id: uuid(100 + n), relacionado_id: uuid(100 + para), tipo: 'complementar', ordem: para, ativo: true, ...o });

describe('RN-CAT-09: referências cruzadas e oferece junto', () => {
  it(`RN-CAT-09: o texto é "Equivale a: <marca_nome> <código>" e o corte defensivo é de ${MAXIMO_REFERENCIAS}`, () => {
    const extras = montarExtras(undefined, [ref(1, 1, { marca_nome: 'Bosch', codigo: 'CB 3401' })], []);
    expect(textoEquivale(referenciasDoItem(extras.referencias))).toBe('Equivale a: Bosch CB 3401');
    const tres = montarExtras(undefined, [ref(1, 1), ref(1, 2), ref(1, 3)], []);
    expect(textoEquivale(referenciasDoItem(tres.referencias))).toBe('Equivale a: M1 C1 · M2 C2 · M3 C3');
    const lixo = Array.from({ length: 5 }, (_, i) => ({ marca_id: MARCA(i), marca_nome: `M${i}`, codigo: `C${i}` }));
    expect(referenciasDoItem(lixo)).toHaveLength(MAXIMO_REFERENCIAS);
  });
  it('RN-CAT-09: sem referência a linha some; referência apagada ou sem retrato de marca fica de fora; ordem do cadastro', () => {
    expect(textoEquivale([])).toBeNull();
    const extras = montarExtras(undefined, [ref(1, 3), ref(1, 1, { marca_nome: null }), ref(1, 2, { deleted_at: agora }), ref(1, 1, { id: uuid(1), marca_nome: 'NGK', codigo: 'X9' })], []);
    expect(extras.referencias).toEqual([{ marca_id: MARCA(1), marca_nome: 'NGK', codigo: 'X9' }, { marca_id: MARCA(3), marca_nome: 'M3', codigo: 'C3' }]);
  });
  it('RN-CAT-11: aplicação e etiquetas vêm do conteúdo; conteúdo removido ou ausente = vazio', () => {
    expect(montarExtras(conteudo(1, { aplicacao: ' Gol G5 ', etiquetas: ['Dianteira', 'Novo'] }), [], [])).toMatchObject({ aplicacao: 'Gol G5', etiquetas: ['Dianteira', 'Novo'] });
    expect(montarExtras(conteudo(1, { aplicacao: 'x', deleted_at: agora }), [], [])).toEqual(SEM_EXTRAS);
    expect(montarExtras(undefined, [], [])).toEqual(SEM_EXTRAS);
  });
  it('RN-CAT-09: oferece junto = só relação complementar viva e ativa, na ordem do cadastro', () => {
    const extras = montarExtras(undefined, [], [relacao(1, 4), relacao(1, 2), relacao(1, 3, { tipo: 'substituto' }), relacao(1, 5, { ativo: false }), relacao(1, 6, { deleted_at: agora })]);
    expect(extras.oferece_junto).toEqual([uuid(102), uuid(104)]);
  });
  it(`RN-CAT-09: oferece junto trunca em ${MAXIMO_OFERECE_JUNTO}, sem repetido, sem o próprio produto e sem o que não está no aparelho`, () => {
    const nomes = new Map(Array.from({ length: 8 }, (_, i) => [uuid(i + 1), `Produto ${i + 1}`]));
    const ids = [uuid(1), uuid(1), uuid(2), uuid(99), uuid(3), uuid(4), uuid(5), uuid(6), uuid(7)];
    expect(ofereceJuntoDoItem(ids, uuid(2), nomes).map((o) => o.rotulo)).toEqual(['Produto 1', 'Produto 3', 'Produto 4', 'Produto 5', 'Produto 6']);
  });
  it('etiquetas: sem repetir (ignora maiúsculas); tamanho e quantidade ficam com o contrato (até 4 de 20)', () => {
    expect(etiquetasDoItem(['Novo', 'novo', ' ', 'Promo'])).toEqual(['Novo', 'Promo']);
    expect(ProdutoConteudoSyncSchema.safeParse({ ...conteudo(1), etiquetas: ['a', 'b', 'c', 'd', 'e'] }).success).toBe(false);
  });
  it('medida e embalagem do cadastro: "UN" ou "UN · CX com 12"', () => {
    expect(medidaEmbalagem({ unidade: 'UN' })).toBe('UN');
    expect(medidaEmbalagem({ unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: 12 })).toBe('UN · CX com 12');
  });
});

const vitrine = (visivel: boolean): ItemVitrine => ({
  id: uuid(101), erp_code: 'P-1', description: 'Pastilha', brand: 'X', line: 'Y', unit: 'UN', ean: null, thumbnail_url: null, is_campaign: false,
  price: visivel ? { sellable: true, price_cents: 12990, base_cents: 12990, on_promotion: false, notice: null, valid_until: null } as never : null,
  availability: visivel ? ({ band: 'disponivel', quantity: 40, by_branch: [{ branch_id: uuid(7), branch_name: 'CD', band: 'disponivel', quantity: 40, updated_at: AGORA }], stale: false, updated_at: AGORA } as never) : null,
  price_stock_visible: visivel,
});

describe('RN-CAT-05: item da lista por perfil', () => {
  const p = prod(1, 'Pastilha', montarExtras(conteudo(1, { aplicacao: 'Gol G5 1.6' }), [ref(1, 1, { marca_nome: 'Bosch', codigo: 'CB 3401' })], []));
  const c = { agora: AGORA, fuso: 'America/Manaus', nomesPorId: new Map<string, string>() };
  it('RN-CAT-05: quem não vê preço e estoque (promotor) recebe o item sem os dois; o resto continua', () => {
    const i = montarItemLista(p, vitrine(false), c);
    expect(i.preco).toBeNull();
    expect(i.estoque).toBeNull();
    expect(i).toMatchObject({ codigo: 'P-1', aplicacao: 'Gol G5 1.6', equivale: 'Equivale a: Bosch CB 3401' });
  });
  it('RN-CAT-06: quem vê recebe preço e estoque do contexto', () => {
    const i = montarItemLista(p, vitrine(true), c);
    expect(i.preco?.vendavel).toBe(true);
    expect(i.estoque?.texto).toContain('Disponível');
  });
});

describe('RN-CAT-05: a lista lida do aparelho (motor de sync)', () => {
  const base = (id: string, o: Record<string, unknown>): LinhaSync => ({ id, updated_at: AGORA, deleted_at: null, external_id: null, ...o }) as LinhaSync;
  const linhas: Record<string, LinhaSync[]> = {
    catalogo_no: NOS.map((n) => base(n.id, { ...n })),
    produto_no: [liga(1, 3), liga(2, 3), liga(3, 5)].map((v, i) => base(uuid(500 + i), { ...v })),
    produto: [1, 2, 3, 4].map((n) => base(uuid(100 + n), { sku: `P-${n}`, ean: null, nome: `Produto ${n}`, marca: 'X', categoria: 'Y', unidade: 'UN', ativo: true })),
    produto_conteudo: [1, 2, 3, 4].map((n) => conteudo(n, { aplicacao: `Aplicação ${n}`, etiquetas: ['Novo'] })),
    produto_referencia: [1, 2, 3, 4].map((n) => ref(n, 1, { marca_nome: 'Bosch', codigo: `CB ${n}` })),
    produto_relacao: [1, 2, 3, 4].map((n) => relacao(n, 2)),
    tabela_preco: [base(uuid(900), { codigo: 'V', nome: 'Varejo', ativo: true })],
    tabela_preco_item: [1, 2, 3].map((n) => base(uuid(910 + n), { tabela_preco_id: uuid(900), produto_id: uuid(100 + n), preco_cents: 1000 * n, vigencia_inicio: null, vigencia_fim: null })),
    cliente_tabela_preco: [base(uuid(920), { cliente_id: uuid(800), tabela_preco_id: uuid(900) })],
    deposito: [base(uuid(7), { codigo: 'CD', nome: 'CD', ativo: true })],
    estoque_saldo: [1, 2, 3].map((n) => base(uuid(930 + n), { produto_id: uuid(100 + n), deposito_id: uuid(7), quantidade: 10, atualizado_em: AGORA })),
  };
  const lidas: string[] = [];
  const leitor: LeitorLocal = {
    linhas: async <L extends LinhaSync>(e: string) => ((lidas.push(`linhas:${e}`), linhas[e] ?? []) as L[]),
    linhasPorIds: async <L extends LinhaSync>(e: string, ids: readonly string[]) => ((lidas.push(`ids:${e}`), (linhas[e] ?? []).filter((l) => ids.includes(l.id))) as L[]),
    linhasPorCampo: async <L extends LinhaSync>(e: string, campo: string, valores: readonly string[]) => ((lidas.push(`campo:${e}.${campo}`), (linhas[e] ?? []).filter((l) => valores.includes((l as unknown as Record<string, string>)[campo]!))) as L[]),
    versaoLinhas: () => 1,
  };
  const entrada = { perfil: 'vendedor' as const, parametros: {}, agora: AGORA, clienteId: uuid(800), fuso: 'America/Manaus' };

  it('RF-CAT-09: na raiz mostra os sistemas e o grupo "Sem linha" com a contagem', async () => {
    const r = await listaPorLinhaLocal(leitor, { ...entrada, noId: null });
    expect(r.filhos.map((f) => [f.nome, f.total])).toEqual([['Freios', 3], ['Motor', 0], ['Sem linha', 1]]);
    expect(r.itens).toEqual([]);
    expect(r.vazio).toBe(false);
  });

  it('RF-CAT-09: na linha lê só os vínculos do nível (linhasPorCampo) e mostra os itens, com preço do cliente', async () => {
    lidas.length = 0;
    const r = await listaPorLinhaLocal(leitor, { ...entrada, noId: uuid(3) });
    expect(r.trilha.map((n) => n.nome)).toEqual(['Freios', 'Pastilhas', 'Cerâmica']);
    expect(r.itens.map((i) => i.codigo)).toEqual(['P-1', 'P-2']);
    expect(r.itens[0]).toMatchObject({ aplicacao: 'Aplicação 1', equivale: 'Equivale a: Bosch CB 1', etiquetas: ['Novo'] });
    expect(r.itens[0]!.ofereceJunto.map((o) => o.rotulo)).toEqual(['Produto 2']);
    expect(r.itens[0]!.preco?.texto).toContain('10,00');
    expect(lidas).toContain('campo:produto_no.no_id');
    expect(lidas).not.toContain('linhas:produto_no');
  });

  it('RN-CAT-05: o promotor vê a lista sem preço nem estoque', async () => {
    const r = await listaPorLinhaLocal(leitor, { ...entrada, perfil: 'promotor', noId: uuid(3) });
    expect(r.itens).toHaveLength(2);
    for (const i of r.itens) {
      expect(i.preco).toBeNull();
      expect(i.estoque).toBeNull();
    }
    expect(r.itens[0]!.equivale).toBe('Equivale a: Bosch CB 1');
  });

  it('RF-CAT-09: o grupo mostra os níveis abaixo; "sem linha" lista os soltos; nó que sumiu volta à raiz', async () => {
    const grupo = await listaPorLinhaLocal(leitor, { ...entrada, noId: uuid(1) });
    expect(grupo.filhos.map((f) => [f.nome, f.total])).toEqual([['Pastilhas', 2], ['Discos', 1]]);
    expect(grupo.itens).toEqual([]);
    const soltos = await listaPorLinhaLocal(leitor, { ...entrada, noId: NO_SEM_LINHA });
    expect(soltos.itens.map((i) => i.codigo)).toEqual(['P-4']);
    const sumido = await listaPorLinhaLocal(leitor, { ...entrada, noId: uuid(77) });
    expect(sumido.noInexistente).toBe(true);
    expect(sumido.trilha).toEqual([]);
  });

  it('RF-CAT-09: nível sem produtos fica vazio (a tela mostra o EstadoVazio)', async () => {
    const r = await listaPorLinhaLocal(leitor, { ...entrada, noId: uuid(6) });
    expect(r.vazio).toBe(true);
  });
});
