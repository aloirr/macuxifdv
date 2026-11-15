/**
 * Catálogo offline no aparelho (RF-CAT-02, T-0052): as linhas locais do sync da base demo passam pelo mesmo domain da API.
 */
import { criarRelogio } from '@macuxi/comum/relogio';
import type { DesfechoBusca, LinhaSync, MotivoSemBusca } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { AVISO_BUSCA_OFFLINE } from '../../domain/ia';
import { MENSAGEM_SEM_PRECO_CLIENTE } from '../../domain/preco';
import { MENSAGEM_SEM_PRECO_CATALOGO } from '../../domain/vitrine';
import { FILIAL_DEMO, idDemo, idProdutoDemo, ITENS_PRECO_DEMO, PRODUTOS_SEED_DEMO, TABELA_ATACADO_DEMO, TABELA_VAREJO_DEMO } from '../../fixtures/base-demo';
import { arvoreLocal, buscarLocal, esquecerMemoriaLocal, estoqueLocalDosProdutos, fichaLocal, filialDeCadastroLocal, filtrosLocais, ID_INDICE_BUSCA, LIMIAR_PRESELECAO_FTS, LIMIAR_SEM_VARREDURA, preselecionar, produtosDaNavegacao, vitrineLocal, type LeitorLocal } from './local';

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
    expect(semCliente.items[0]!.price).toMatchObject({ sellable: false, notice: MENSAGEM_SEM_PRECO_CATALOGO });
  });

  it('RN-CAT-05 (revista): o promotor lê o ESTOQUE e não o preço; o aparelho sem usuário não lê nada (estoque 0, sem preço)', async () => {
    const sem = await buscarLocal(leitor(), { ...entrada, perfil: null, q: 'café', limit: 20, offset: 0, offline: true });
    expect(sem.items[0]).toMatchObject({ price: null, price_stock_visible: false });
    expect(sem.items[0]!.availability?.quantity ?? 0).toBe(0);
    const promotor = await buscarLocal(leitor(), { ...entrada, perfil: 'promotor', q: 'café', limit: 20, offset: 0, offline: true });
    expect(promotor.items[0]).toMatchObject({ price: null, price_stock_visible: false });
    expect(promotor.items[0]!.availability).toMatchObject({ band: 'disponivel', quantity: 50 });
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

describe('estoque por filial no aparelho (catalogo-campo-v2 §3 e §4; RN-CAT-05, RN-CORE-39)', () => {
  const F1 = idDemo('filial:um');
  const F2 = idDemo('filial:dois');
  const U = idDemo('usuario:u');
  const comFiliais = (filialIds: string[] | undefined) => {
    const l = linhasDemo();
    l.deposito = [base(idDemo('dep:1'), { codigo: 'D1', nome: 'D1', ativo: true, filial_id: F1 }), base(idDemo('dep:2'), { codigo: 'D2', nome: 'D2', ativo: true, filial_id: F2 })];
    l.filial = [base(F1, { codigo: '01', nome: 'Boa Vista', padrao: true, ativo: true }), base(F2, { codigo: '02', nome: 'Manaus', padrao: false, ativo: true })];
    l.estoque_saldo = [
      base(idDemo('s:1'), { produto_id: idProdutoDemo('CAF-500'), deposito_id: idDemo('dep:1'), quantidade: 10, atualizado_em: QUANDO }),
      base(idDemo('s:2'), { produto_id: idProdutoDemo('CAF-500'), deposito_id: idDemo('dep:2'), quantidade: 7, atualizado_em: QUANDO }),
    ];
    l.usuario = [base(U, { ...(filialIds ? { filial_cadastro_id: filialIds[0] ?? null, filial_venda_ids: filialIds, sem_filial: filialIds.length === 0 } : {}) })];
    return l;
  };
  const cafe = async (perfil: 'vendedor' | 'promotor' | 'supervisor', filialIds: string[] | undefined, extra: Record<string, unknown> = {}) => {
    const r = await buscarLocal(leitor(comFiliais(filialIds)), { ...entrada, perfil, usuarioId: U, clienteId: null, q: 'café', limit: 20, offset: 0, offline: true, ...extra });
    return r.items[0]!.availability!;
  };

  it('RN-CORE-39 / spec §3: o N soma as filiais de venda do vendedor e a folha lista só elas', async () => {
    const a = await cafe('vendedor', [F1]);
    expect(a.quantity).toBe(10);
    expect(a.by_branch.map((b) => [b.branch_name, b.quantity])).toEqual([['Boa Vista', 10]]);
    const duas = await cafe('vendedor', [F1, F2]);
    expect(duas.quantity).toBe(17);
    expect(duas.by_branch.map((b) => b.branch_name).sort()).toEqual(['Boa Vista', 'Manaus']);
  });

  it('spec §3: filtro com uma filial de venda mostra só aquela; "todas" soma as de venda', async () => {
    expect((await cafe('vendedor', [F1, F2], { filtroFilial: F2 })).quantity).toBe(7);
    expect((await cafe('vendedor', [F1, F2], { filtroFilial: 'todas' })).quantity).toBe(17);
    expect((await cafe('vendedor', [F1], { filtroFilial: 'todas' })).quantity).toBe(10);
  });

  it('RN-CAT-05 / RN-CORE-39: todo perfil soma as filiais de venda e a folha só lista as dessas', async () => {
    for (const perfil of ['vendedor', 'promotor', 'supervisor'] as const) {
      expect((await cafe(perfil, [F1, F2])).quantity, perfil).toBe(17);
      const so = await cafe(perfil, [F2]);
      expect(so.quantity, perfil).toBe(7);
      expect(so.by_branch.map((b) => b.branch_name), perfil).toEqual(['Manaus']);
    }
  });

  it('RN-CAT-05 / RN-CORE-39: ninguém escolhe filial que não é de venda dele, nem pelo filtro', async () => {
    for (const perfil of ['vendedor', 'promotor'] as const) expect((await cafe(perfil, [F1], { filtroFilial: F2 })).quantity, perfil).toBe(0);
  });

  it('RN-CORE-39: sem_filial = preço e estoque vazios no aparelho', async () => {
    const r = await buscarLocal(leitor(comFiliais([])), { ...entrada, perfil: 'vendedor', usuarioId: U, clienteId: null, q: 'café', limit: 20, offset: 0, offline: true });
    expect(r.items[0]!.availability!.quantity).toBe(0);
    expect(r.items[0]!.availability!.by_branch).toEqual([]);
    expect(r.items[0]!.price).toMatchObject({ price_cents: null, sellable: false });
  });

  it('RN-CORE-39: com cliente vale a filial do cliente (o filtro não vale)', async () => {
    const l = comFiliais([F1, F2]);
    l.cliente = [base(CLIENTE_VAREJO, { filial_id: F2 })];
    const r = await buscarLocal(leitor(l), { ...entrada, perfil: 'vendedor', usuarioId: U, q: 'café', limit: 20, offset: 0, offline: true, filtroFilial: F1 });
    expect(r.items[0]!.availability!.quantity).toBe(7);
  });

  it('decisão 4 do R-20261115-100000: na busca online o estoque vem do aparelho (mesma regra do N: soma das filiais de venda; filtro; cliente)', async () => {
    const id = idProdutoDemo('CAF-500');
    const dos = (l: ReturnType<typeof comFiliais>, extra: Record<string, unknown> = {}) => estoqueLocalDosProdutos(leitor(l), { ...entrada, perfil: 'vendedor', usuarioId: U, clienteId: null, ...extra }, [id, 'fora-do-aparelho']);
    const r = await dos(comFiliais([F1, F2]));
    expect(r.get(id)!.quantity).toBe(17);
    expect(r.has('fora-do-aparelho')).toBe(false);
    expect((await dos(comFiliais([F1, F2]), { filtroFilial: F2 })).get(id)!.quantity).toBe(7);
    const l = comFiliais([F1, F2]);
    l.cliente = [base(CLIENTE_VAREJO, { filial_id: F2 })];
    expect((await dos(l, { clienteId: CLIENTE_VAREJO, filtroFilial: F1 })).get(id)!.quantity).toBe(7);
  });

  it('decisão 2 do R-20261115-100000: a faixa mostra a filial de CADASTRO (id do adaptador, nome da linha filial), sem mudar o N', async () => {
    expect(await filialDeCadastroLocal(leitor(comFiliais([F2, F1])), U)).toEqual({ id: F2, nome: 'Manaus' });
    expect(await filialDeCadastroLocal(leitor(comFiliais(undefined)), U)).toBeNull();
    expect(await filialDeCadastroLocal(leitor(comFiliais([F2, F1])), null)).toBeNull();
    expect((await cafe('vendedor', [F2, F1])).quantity).toBe(17);
  });

  it('emissor antigo (sem filiais de venda no sync): mantém o que o aparelho recebeu, sem esconder nada', async () => {
    expect((await cafe('promotor', undefined)).quantity).toBe(17);
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
    expect(chamadas).toEqual(['[["cafe"],["acucar"]]', '[["cafe"]]', '[["acucar"]]']); // 1º o AND, que traz só 1 (< CANDIDATOS_POR_TERMO): cai na união termo a termo
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

describe('consulta sem acerto em catálogo grande (T-0052, R-20261105-142853)', () => {
  const comProdutos = (n: number) => {
    const linhas = linhasDemo();
    const extras = Array.from({ length: n }, (_, i) => base(idDemo(`vazio:${i}`), { sku: `V-${i}`, ean: null, nome: `Parafuso ${i}`, marca: 'Ferro', categoria: 'Ferragens', unidade: 'UN', ativo: true }));
    linhas.produto = [...linhas.produto!, ...extras];
    return linhas;
  };
  const comDesfecho = (linhas: Record<string, LinhaSync[]>, d: (g: string) => DesfechoBusca) => {
    const chamadas: string[] = [];
    let varreduras = 0;
    const l: LeitorLocal = {
      linhas: async <L extends LinhaSync>(e: string) => {
        if (e === 'produto') varreduras++;
        return (linhas[e] ?? []) as L[];
      },
      buscarComDesfecho: async (_i, c) => {
        chamadas.push(c.grupos[0]![0]!);
        return d(c.grupos[0]![0]!);
      },
    };
    return { l, chamadas, varreduras: () => varreduras };
  };
  const nada: DesfechoBusca = { buscou: true, resultados: [] };
  const semBusca = (motivo: MotivoSemBusca): DesfechoBusca => ({ buscou: false, motivo });
  const busca = (l: LeitorLocal, q: string) => buscarLocal(l, { ...entrada, q, limit: 20, offset: 0, offline: true });

  it('RF-CAT-02: acima de 5.000 produtos, todas as buscas (termo e prefixos) sem acerto e com buscou:true devolvem vazio sem varrer', async () => {
    const { l, chamadas } = comDesfecho(comProdutos(LIMIAR_SEM_VARREDURA), () => nada);
    const r = await busca(l, 'xyzwkqpl');
    expect(r.items).toEqual([]);
    expect(chamadas).toEqual(['xyzwkqpl', 'xyzw', 'xyz']);
  });

  it.each<MotivoSemBusca>(['modulo_indisponivel', 'erro_busca', 'indice_invalido', 'indexando'])('RF-CAT-02: acima de 5.000 produtos, um termo que não conseguiu buscar (%s) mantém a varredura', async (motivo) => {
    const { l } = comDesfecho(comProdutos(LIMIAR_SEM_VARREDURA), (g) => (g === 'cafee' ? semBusca(motivo) : nada));
    const r = await busca(l, 'cafee');
    expect(r.items.map((i) => sku(i.id))).toContain('CAF-500');
  });

  it('RF-CAT-02: com o índice sendo refeito (indexando) a busca varre, sinaliza a aba e, pronto o índice, volta a usar o FTS5', async () => {
    let pronto = false;
    const { l, chamadas } = comDesfecho(comProdutos(LIMIAR_SEM_VARREDURA), (g) => (pronto ? { buscou: true, resultados: g === 'cafee' ? [{ chave: idProdutoDemo('CAF-500'), pontuacao: -1 }] : [] } : semBusca('indexando')));
    const durante = await busca(l, 'cafee');
    expect(durante.items.map((i) => sku(i.id))).toContain('CAF-500');
    expect(durante.indexando).toBe(true);
    pronto = true;
    chamadas.length = 0;
    const depois = await busca(l, 'cafee');
    expect(depois.indexando).toBe(false);
    expect(depois.items.map((i) => sku(i.id))).toEqual(['CAF-500']);
  });

  it('RF-CAT-02: a C9 (preselecionar) varre com indexando sem aviso e sem erro', async () => {
    const { l } = comDesfecho(comProdutos(LIMIAR_SEM_VARREDURA), () => semBusca('indexando'));
    expect(await preselecionar(l, 'cafee', null, [], LIMIAR_SEM_VARREDURA + 20)).toBeNull();
  });

  it('RF-CAT-02: o prefixo que não conseguiu buscar também mantém a varredura', async () => {
    const { l } = comDesfecho(comProdutos(LIMIAR_SEM_VARREDURA), (g) => (g === 'cafe' ? semBusca('erro_busca') : nada));
    const r = await busca(l, 'cafee');
    expect(r.items.map((i) => sku(i.id))).toContain('CAF-500');
  });

  it('RF-CAT-02: até 5.000 produtos, sem acerto no FTS5 varre como antes (tolerância a erro de digitação)', async () => {
    const { l } = comDesfecho(comProdutos(LIMIAR_SEM_VARREDURA - 100), () => nada);
    const r = await busca(l, 'cafee');
    expect(r.items.map((i) => sku(i.id))).toContain('CAF-500');
  });

  it('RF-CAT-02: consulta curta (consulta_vazia) acima de 5.000 produtos varre, não devolve vazio', async () => {
    const { l } = comDesfecho(comProdutos(LIMIAR_SEM_VARREDURA), () => semBusca('consulta_vazia'));
    const r = await busca(l, 'cafee');
    expect(r.items.map((i) => sku(i.id))).toContain('CAF-500');
  });

  it('RF-CAT-02: sem buscarComDesfecho (leitor só com buscar) a regra do vazio não se aplica: varre', async () => {
    const r = await busca(leitor(comProdutos(LIMIAR_SEM_VARREDURA), async () => []), 'cafee');
    expect(r.items.map((i) => sku(i.id))).toContain('CAF-500');
  });

  it('RF-CAT-02: busca só com chips não consulta o FTS5 e continua varrendo', async () => {
    const { l, chamadas } = comDesfecho(comProdutos(LIMIAR_SEM_VARREDURA), () => nada);
    const r = await buscarLocal(l, { ...entrada, q: '', chips: { brand: 'Ferro' }, limit: 20, offset: 0, offline: true });
    expect(chamadas).toEqual([]);
    expect(r.total).toBeGreaterThan(0);
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

  it('RN-CAT-05 / regra 7: o promotor navega a árvore só para leitura, sem preço nos cartões (o estoque aparece)', async () => {
    const ids = await produtosDaNavegacao(leitor(comArvore()), { ...entrada, perfil: 'promotor', noId: NO_REFRI, soDaTabelaDoCliente: false });
    const r = await vitrineLocal(leitor(comArvore()), { ...entrada, perfil: 'promotor', chips: { only_product_ids: ids! }, limit: 50, offset: 0 });
    expect(r.items.map((i) => sku(i.id)).sort()).toEqual(['REF-2L', 'REF-350']);
    expect(r.items.every((i) => i.price === null && i.availability !== null)).toBe(true);
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
