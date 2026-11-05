/**
 * Catálogo offline no aparelho (RF-CAT-02, T-0052): as linhas locais do sync da base demo passam pelo mesmo domain da API.
 */
import { criarRelogio } from '@macuxi/comum/relogio';
import type { LinhaSync } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { AVISO_BUSCA_OFFLINE } from '../../domain/ia';
import { MENSAGEM_SEM_PRECO_CLIENTE } from '../../domain/preco';
import { MENSAGEM_ESCOLHA_CLIENTE } from '../../domain/vitrine';
import { FILIAL_DEMO, idDemo, idProdutoDemo, ITENS_PRECO_DEMO, PRODUTOS_SEED_DEMO, TABELA_ATACADO_DEMO, TABELA_VAREJO_DEMO } from '../../fixtures/base-demo';
import { arvoreLocal, buscarLocal, esquecerMemoriaLocal, fichaLocal, filtrosLocais, ID_INDICE_BUSCA, LIMIAR_PRESELECAO_FTS, produtosDaNavegacao, vitrineLocal, type LeitorLocal } from './local';

const relogio = criarRelogio();
const QUANDO = relogio.relativo({ horas: -3 }).toISOString();
const base = (id: string, o: Record<string, unknown>): LinhaSync => ({ id, updated_at: QUANDO, deleted_at: null, external_id: null, ...o }) as LinhaSync;
const CLIENTE_VAREJO = idDemo('cliente:varejo');
const CLIENTE_ATACADO = idDemo('cliente:atacado');

function linhasDemo(): Record<string, LinhaSync[]> {
  return {
    produto: PRODUTOS_SEED_DEMO.map(([sku, nome, marca, categoria, unidade]) => base(idProdutoDemo(sku), { sku, ean: null, nome, marca, categoria, unidade, ativo: sku !== 'MAR-500' })),
    produto_atributo: [base(idDemo('attr:agua'), { produto_id: idProdutoDemo('AGU-500'), nome: 'Tipo', valor: 'Sem gás', ordem: 0 })],
    sinonimo: [
      base(idDemo('sin:refri'), { termo: 'refrigerante', sinonimos: ['refri'], ativo: true }),
      base(idDemo('sin:dente'), { termo: 'creme dental', sinonimos: ['pasta de dente'], ativo: true }),
      base(idDemo('sin:velho'), { termo: 'biscoito', sinonimos: ['bolacha'], ativo: true, deleted_at: QUANDO }),
    ],
    tabela_preco: [base(TABELA_VAREJO_DEMO, { codigo: 'VAREJO', nome: 'Varejo', ativo: true }), base(TABELA_ATACADO_DEMO, { codigo: 'ATACADO', nome: 'Atacado', ativo: true })],
    tabela_preco_item: ITENS_PRECO_DEMO.map((i) => base(idDemo(`item:${i.price_table_id}:${i.product_id}`), { tabela_preco_id: i.price_table_id, produto_id: i.product_id, preco_cents: i.price_cents, vigencia_inicio: null, vigencia_fim: null })),
    cliente_tabela_preco: [base(idDemo('ct:v'), { cliente_id: CLIENTE_VAREJO, tabela_preco_id: TABELA_VAREJO_DEMO }), base(idDemo('ct:a'), { cliente_id: CLIENTE_ATACADO, tabela_preco_id: TABELA_ATACADO_DEMO })],
    deposito: [base(FILIAL_DEMO, { codigo: 'CD-MAO', nome: 'CD Manaus', ativo: true })],
    estoque_saldo: PRODUTOS_SEED_DEMO.map(([sku]) => base(idDemo(`saldo:${sku}`), { produto_id: idProdutoDemo(sku), deposito_id: FILIAL_DEMO, quantidade: sku === 'ACA-1K' ? 0 : 50, atualizado_em: QUANDO })),
    produto_conteudo: [base(idDemo('cont:caf'), { produto_id: idProdutoDemo('CAF-500'), descricao: 'Torra média.', argumentos: ['Mais vendido'], faq: [{ pergunta: 'É moído?', resposta: 'Sim, moagem fina.' }], campanha: true })],
  };
}

function leitor(linhas = linhasDemo(), buscar?: LeitorLocal['buscar']): LeitorLocal {
  return { linhas: async <L extends LinhaSync>(e: string) => (linhas[e] ?? []) as L[], ...(buscar ? { buscar } : {}) };
}

const entrada = { perfil: 'vendedor' as const, parametros: {}, agora: relogio.iso(), clienteId: CLIENTE_VAREJO };
const sku = (id: string) => PRODUTOS_SEED_DEMO.find(([s]) => idProdutoDemo(s) === id)?.[0];

describe('busca offline no aparelho (RF-CAT-02)', () => {
  it('RF-CAT-02: sem sinal, acha pelo nome e pelo sinônimo do tenant, com o aviso discreto', async () => {
    const r = await buscarLocal(leitor(), { ...entrada, q: 'pasta de dente', limit: 20, offset: 0, offline: true });
    expect(r.items.map((i) => sku(i.id))).toEqual(['CRD-90']);
    expect(r.aviso).toBe(AVISO_BUSCA_OFFLINE);
    const refri = await buscarLocal(leitor(), { ...entrada, q: 'refri', limit: 20, offset: 0, offline: true });
    expect(refri.items.map((i) => sku(i.id)).sort()).toEqual(['REF-2L', 'REF-350']);
  });

  it('RF-CAT-02: sinônimo removido não vale; produto inativo não aparece; atributo local acha ("sem gás")', async () => {
    expect((await buscarLocal(leitor(), { ...entrada, q: 'bolacha', limit: 20, offset: 0, offline: false })).items).toEqual([]);
    expect((await buscarLocal(leitor(), { ...entrada, q: 'margarina', limit: 20, offset: 0, offline: false })).items).toEqual([]);
    expect((await buscarLocal(leitor(), { ...entrada, q: 'agua sem gas', limit: 20, offset: 0, offline: false })).items.map((i) => sku(i.id))[0]).toBe('AGU-500');
  });

  it('online (contingência local) não mostra o aviso de sem sinal', async () => {
    expect((await buscarLocal(leitor(), { ...entrada, q: 'café', limit: 20, offset: 0, offline: false })).aviso).toBeNull();
  });

  it('RN-CAT-06: preço da tabela local do cliente; Atacado sem o açaí; sem cliente pede para escolher', async () => {
    const atacado = await buscarLocal(leitor(), { ...entrada, clienteId: CLIENTE_ATACADO, q: 'açaí', limit: 20, offset: 0, offline: true });
    expect(atacado.items[0]!.price).toMatchObject({ sellable: false, notice: MENSAGEM_SEM_PRECO_CLIENTE });
    const varejo = await buscarLocal(leitor(), { ...entrada, q: 'açaí', limit: 20, offset: 0, offline: true });
    expect(varejo.items[0]!.price).toMatchObject({ sellable: true, price_cents: 2290 });
    expect(varejo.items[0]!.availability).toMatchObject({ band: 'sem_estoque', updated_at: QUANDO });
    const semCliente = await buscarLocal(leitor(), { ...entrada, clienteId: null, q: 'açaí', limit: 20, offset: 0, offline: true });
    expect(semCliente.items[0]!.price).toMatchObject({ sellable: false, notice: MENSAGEM_ESCOLHA_CLIENTE });
  });

  it('RN-CAT-05: o promotor (e o aparelho sem usuário) não lê preço nem estoque', async () => {
    for (const perfil of ['promotor', null] as const) {
      const r = await buscarLocal(leitor(), { ...entrada, perfil, q: 'café', limit: 20, offset: 0, offline: true });
      expect(r.items[0], String(perfil)).toMatchObject({ price: null, availability: null, price_stock_visible: false });
    }
    const ligado = await buscarLocal(leitor(), { ...entrada, perfil: 'promotor', parametros: { promotor_ve_preco_estoque: true }, q: 'café', limit: 20, offset: 0, offline: true });
    expect(ligado.items[0]!.price?.price_cents).toBe(1890);
  });

  it(`catálogo grande (> ${LIMIAR_PRESELECAO_FTS}): o FTS5 do aparelho pré-seleciona os candidatos antes do ranking`, async () => {
    const linhas = linhasDemo();
    const extras = Array.from({ length: LIMIAR_PRESELECAO_FTS }, (_, i) => base(idDemo(`extra:${i}`), { sku: `X-${i}`, ean: null, nome: `Parafuso ${i}`, marca: 'Ferro', categoria: 'Ferragens', unidade: 'UN', ativo: true }));
    linhas.produto = [...linhas.produto!, ...extras];
    const chamadas: string[] = [];
    const fts: LeitorLocal['buscar'] = async (indice, c) => {
      chamadas.push(`${indice}:${JSON.stringify(c.grupos)}`);
      return [{ chave: idProdutoDemo('CAF-500'), pontuacao: -1 }];
    };
    const r = await buscarLocal(leitor(linhas, fts), { ...entrada, q: 'café', limit: 20, offset: 0, offline: true });
    expect(chamadas).toEqual([`${ID_INDICE_BUSCA}:[["cafe"]]`]);
    expect(r.items.map((i) => sku(i.id))).toEqual(['CAF-500']);
  });
});

describe('pré-seleção do FTS5 em catálogo grande (T-0052-B2/B4)', () => {
  const grande = () => {
    const linhas = linhasDemo();
    const extras = Array.from({ length: LIMIAR_PRESELECAO_FTS }, (_, i) => base(idDemo(`extra:${i}`), { sku: `X-${i}`, ean: null, nome: `Parafuso ${i}`, marca: 'Ferro', categoria: 'Ferragens', unidade: 'UN', ativo: true }));
    linhas.produto = [...linhas.produto!, ...extras];
    return linhas;
  };

  it('RF-CAT-02: cada termo vira uma consulta própria e o conjunto é a união (a mesma semântica do catálogo pequeno)', async () => {
    const chamadas: string[] = [];
    const fts: LeitorLocal['buscar'] = async (_i, c) => {
      chamadas.push(JSON.stringify(c.grupos));
      const g = c.grupos[0]![0];
      return g === 'cafe' ? [{ chave: idProdutoDemo('CAF-500'), pontuacao: -2 }] : [{ chave: idProdutoDemo('ACU-1K'), pontuacao: -1 }];
    };
    const r = await buscarLocal(leitor(grande(), fts), { ...entrada, q: 'café açúcar', limit: 20, offset: 0, offline: true });
    expect(chamadas).toEqual(['[["cafe"]]', '[["acucar"]]']);
    expect(r.items.map((i) => sku(i.id)).sort()).toEqual(['ACU-1K', 'CAF-500']);
  });

  it('RF-CAT-02: FTS5 sem nenhum acerto cai na varredura do domain (tolerância a erro de digitação continua valendo)', async () => {
    const fts: LeitorLocal['buscar'] = async () => [];
    const r = await buscarLocal(leitor(grande(), fts), { ...entrada, q: 'cafee', limit: 20, offset: 0, offline: true });
    expect(r.items.map((i) => sku(i.id))).toContain('CAF-500');
  });

  it('RF-CAT-02: termo sem acerto no FTS5 (erro de digitação) é refeito pelo prefixo de 4 letras, sem varrer o catálogo', async () => {
    const chamadas: string[] = [];
    const fts: LeitorLocal['buscar'] = async (_i, c) => {
      chamadas.push(JSON.stringify(c.grupos));
      return c.grupos[0]![0] === 'cafe' ? [{ chave: idProdutoDemo('CAF-500'), pontuacao: -1 }] : [];
    };
    const r = await buscarLocal(leitor(grande(), fts), { ...entrada, q: 'cafee', limit: 20, offset: 0, offline: true });
    expect(chamadas).toEqual(['[["cafee"]]', '[["cafe"]]']);
    expect(r.items.map((i) => sku(i.id))).toEqual(['CAF-500']);
  });

  it('RF-CAT-01: o código digitado entra como termo próprio na consulta ao FTS5', async () => {
    const chamadas: string[] = [];
    const fts: LeitorLocal['buscar'] = async (_i, c) => {
      chamadas.push(JSON.stringify(c.grupos));
      return [{ chave: idProdutoDemo('CAF-500'), pontuacao: -1 }];
    };
    const r = await buscarLocal(leitor(grande(), fts), { ...entrada, q: 'caf500', limit: 20, offset: 0, offline: true });
    expect(chamadas).toContain('[["CAF500"]]');
    expect(r.items.map((i) => sku(i.id))).toEqual(['CAF-500']);
  });
});

describe('vitrine e ficha offline', () => {
  it('vitrine: campanha primeiro (boost), chips de categoria; filtros locais para os chips', async () => {
    const v = await vitrineLocal(leitor(), { ...entrada, limit: 50, offset: 0 });
    expect(sku(v.items[0]!.id)).toBe('CAF-500');
    expect(v.total).toBe(23);
    const limpeza = await vitrineLocal(leitor(), { ...entrada, chips: { line: 'Limpeza' }, limit: 50, offset: 0 });
    expect(limpeza.items.map((i) => sku(i.id)).sort()).toEqual(['DES-2L', 'DET-500', 'SAB-1K']);
    expect((await filtrosLocais(leitor())).linhas).toContain('Congelados');
  });

  it('RF-CAT-03: ficha com conteúdo e FAQ locais; produto inexistente ou inativo = null', async () => {
    const f = await fichaLocal(leitor(), { ...entrada, produtoId: idProdutoDemo('CAF-500') });
    expect(f).toMatchObject({ product: { erp_code: 'CAF-500', is_campaign: true }, content: { description: 'Torra média.', faq: [{ question: 'É moído?' }] } });
    expect(await fichaLocal(leitor(), { ...entrada, produtoId: idProdutoDemo('MAR-500') })).toBeNull();
    expect(await fichaLocal(leitor(), { ...entrada, produtoId: idDemo('nada') })).toBeNull();
  });
});

describe('árvore do catálogo offline (RF-CAT-04)', () => {
  const NO_BEBIDAS = idDemo('no:bebidas');
  const NO_REFRI = idDemo('no:refri');
  const NO_LIMPEZA = idDemo('no:limpeza');
  const no = (id: string, pai: string | null, nivel: number, nome: string, ordem: number) => base(id, { pai_id: pai, nivel, codigo: nome, nome, ordem, ativo: true });
  const vinc = (s: string, n: string) => base(idDemo(`pn:${s}`), { produto_id: idProdutoDemo(s), no_id: n });
  function comArvore() {
    return {
      ...linhasDemo(),
      catalogo_no: [no(NO_BEBIDAS, null, 1, 'Bebidas', 1), no(NO_REFRI, NO_BEBIDAS, 2, 'Refrigerantes', 1), no(NO_LIMPEZA, null, 1, 'Limpeza', 2)],
      produto_no: [vinc('REF-2L', NO_REFRI), vinc('REF-350', NO_REFRI), vinc('AGU-500', NO_BEBIDAS), vinc('DET-500', NO_LIMPEZA)],
    };
  }

  it('RF-CAT-04: lê nós e vínculos do aparelho e monta a árvore sem rede', async () => {
    const { arvore, vinculos } = await arvoreLocal(leitor(comArvore()));
    expect([...arvore.nos.keys()].sort()).toEqual([NO_BEBIDAS, NO_LIMPEZA, NO_REFRI].sort());
    expect(vinculos).toHaveLength(4);
  });

  it('RF-CAT-04: escolher o nó filtra a vitrine local pelos produtos dele e dos níveis abaixo, com os chips somando', async () => {
    const ids = await produtosDaNavegacao(leitor(comArvore()), { ...entrada, noId: NO_BEBIDAS, soDaTabelaDoCliente: false });
    const r = await vitrineLocal(leitor(comArvore()), { ...entrada, chips: { ...(ids ? { only_product_ids: ids } : {}) }, limit: 50, offset: 0 });
    expect(r.items.map((i) => sku(i.id)).sort()).toEqual(['AGU-500', 'REF-2L', 'REF-350']);
    const comEstoque = await vitrineLocal(leitor(comArvore()), { ...entrada, chips: { only_product_ids: ids!, only_in_stock: true }, limit: 50, offset: 0 });
    expect(comEstoque.items.length).toBeGreaterThan(0);
  });

  it('RF-CAT-04: raiz sem nó escolhido não restringe (null); tenant sem árvore continua com a vitrine inteira', async () => {
    expect(await produtosDaNavegacao(leitor(), { ...entrada, noId: null, soDaTabelaDoCliente: false })).toBeUndefined();
    expect((await arvoreLocal(leitor())).arvore.nos.size).toBe(0);
  });

  it('RN-CAT-06: dentro do pedido só os produtos da tabela do cliente, também dentro do nó', async () => {
    const ids = await produtosDaNavegacao(leitor(comArvore()), { ...entrada, noId: NO_BEBIDAS, soDaTabelaDoCliente: true });
    const todos = await produtosDaNavegacao(leitor(comArvore()), { ...entrada, noId: NO_BEBIDAS, soDaTabelaDoCliente: false });
    expect(ids!.size).toBeLessThanOrEqual(todos!.size);
    const tabela = await vitrineLocal(leitor(comArvore()), { ...entrada, chips: { only_product_ids: ids!, only_sellable: true }, limit: 50, offset: 0 });
    expect(tabela.items.every((i) => i.price?.sellable)).toBe(true);
    const semTabela = await produtosDaNavegacao(leitor(comArvore()), { ...entrada, clienteId: null, noId: null, soDaTabelaDoCliente: true });
    expect(semTabela!.size).toBe(0);
  });

  it('RN-CAT-05 / regra 7: o promotor navega a árvore só para leitura, sem preço nem estoque nos cartões', async () => {
    const ids = await produtosDaNavegacao(leitor(comArvore()), { ...entrada, perfil: 'promotor', noId: NO_REFRI, soDaTabelaDoCliente: false });
    const r = await vitrineLocal(leitor(comArvore()), { ...entrada, perfil: 'promotor', chips: { only_product_ids: ids! }, limit: 50, offset: 0 });
    expect(r.items.map((i) => sku(i.id)).sort()).toEqual(['REF-2L', 'REF-350']);
    expect(r.items.every((i) => i.price === null && i.availability === null)).toBe(true);
  });
});

describe('leituras do motor com versão (T-0052-B4)', () => {
  /** Leitor com `versaoLinhas`/`linhasPorCampo`, que conta as leituras de cada entidade. */
  function leitorVersionado(linhas = linhasDemo()) {
    const versoes = new Map<string, number>();
    const lidas: string[] = [];
    const porCampo: string[] = [];
    const l: LeitorLocal = {
      linhas: async <L extends LinhaSync>(e: string) => {
        lidas.push(e);
        return (linhas[e] ?? []) as L[];
      },
      linhasPorCampo: async <L extends LinhaSync>(e: string, campo: string, valores: readonly string[]) => {
        porCampo.push(`${e}.${campo}:${valores.length}`);
        return (linhas[e] ?? []).filter((x) => valores.includes((x as unknown as Record<string, string>)[campo]!)) as L[];
      },
      linhasPorIds: async <L extends LinhaSync>(e: string, ids: readonly string[]) => (linhas[e] ?? []).filter((x) => ids.includes(x.id)) as L[],
      versaoLinhas: (e) => versoes.get(e) ?? 1,
    };
    return { l, lidas, porCampo, versoes };
  }
  const buscar = (l: LeitorLocal, q = 'café') => buscarLocal(l, { ...entrada, q, limit: 20, offset: 0, offline: true });

  it('RF-CAT-02: produtos, atributos e sinônimos só são relidos quando a versão das linhas muda', async () => {
    esquecerMemoriaLocal();
    const { l, lidas, versoes } = leitorVersionado();
    const primeira = await buscar(l);
    const leituras = lidas.filter((e) => e === 'produto').length;
    expect(leituras).toBe(1);
    expect((await buscar(l)).items).toEqual(primeira.items);
    expect(lidas.filter((e) => e === 'produto'), 'segunda busca sai da memória').toHaveLength(1);
    expect(lidas.filter((e) => e === 'sinonimo')).toHaveLength(1);
    versoes.set('produto', 2); // o sync gravou produtos
    await buscar(l);
    expect(lidas.filter((e) => e === 'produto'), 'versão nova = relê').toHaveLength(2);
    expect(lidas.filter((e) => e === 'sinonimo'), 'sinônimos não mudaram').toHaveLength(1);
  });

  it('RN-CAT-06: com poucos candidatos, estoque e preço do cliente vêm por campo, só dos candidatos, com o mesmo resultado', async () => {
    esquecerMemoriaLocal();
    const completo = await buscar(leitor(), 'café');
    esquecerMemoriaLocal();
    const { l, lidas, porCampo } = leitorVersionado();
    const r = await buscarLocal(l, { ...entrada, clienteId: CLIENTE_ATACADO, q: 'café', limit: 20, offset: 0, offline: true });
    const igual = await buscarLocal(leitor(), { ...entrada, clienteId: CLIENTE_ATACADO, q: 'café', limit: 20, offset: 0, offline: true });
    expect(r.items).toEqual(igual.items);
    expect(completo.items.length).toBeGreaterThan(0);
    expect(porCampo.some((c) => c.startsWith('estoque_saldo.produto_id'))).toBe(true);
    expect(porCampo.some((c) => c.startsWith('tabela_preco_item.produto_id'))).toBe(true);
    expect(lidas, 'nada de ler a tabela inteira').not.toContain('estoque_saldo');
    expect(lidas).not.toContain('tabela_preco_item');
  });
});
