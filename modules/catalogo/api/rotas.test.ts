/**
 * Rotas do Catálogo (T-0052) com o repositório em memória e dois tenants. `chamar` reproduz a ordem do `createApp`
 * (apps/api/src/app.ts): licença do módulo (403 MODULO_INATIVO) → ação do manifesto por perfil (403 PERFIL_SEM_ACESSO)
 * → entrada pelo Zod (400) → execução (erros de módulo com o status deles). O ponta a ponta com Fastify e Postgres é do
 * agente testes (pedido na entrega).
 */
import { CODIGOS_FILIAL_USUARIO } from '@macuxi/core/contracts';
import { criarRelogio } from '@macuxi/comum/relogio';
import { criarPermissoes, ErroHttpModulo, verificarAcao, verificarAcesso, type ContextoRota, type ModuloId, type Perfil, type RotaModulo } from '@macuxi/platform-sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FichaProduto, FiltrosCatalogo, ListaSinonimos, ListaTermosSemResultado, PaginaVitrine, RespostaBusca } from '../contracts';
import { RespostaExportacao, RespostaHierarquia } from '../contracts';
import { AVISO_BUSCA_FALHOU, ErroTempoEsgotadoIa, type PortaInterpretacaoLlm } from '../domain/ia';
import { MENSAGEM_IA_DESLIGADA, MENSAGEM_LIMITE_ATINGIDO } from '../domain/limite-ia';
import { MENSAGEM_SEM_PRECO_CLIENTE } from '../domain/preco';
import { FILIAL_DEMO, idDemo, idProdutoDemo, ITENS_PRECO_DEMO, PRODUTOS_DEMO, saldosDemo, TABELA_ATACADO_DEMO, TABELA_VAREJO_DEMO } from '../fixtures/base-demo';
import { manifest } from '../manifest';
import { criarRepositorioMemoria, FILIAL_PADRAO_MEMORIA, type DadosTenantMemoria } from './repositorio';
import { criarRepositorioPostgres } from './repositorio-postgres';
import { criarRotasCatalogo, type DependenciasRotas } from './rotas';

const relogio = criarRelogio();
const TENANT_A = idDemo('tenant:A');
const TENANT_B = idDemo('tenant:B');
const CLIENTE_VAREJO = idDemo('cliente:varejo');
const CLIENTE_ATACADO = idDemo('cliente:atacado');
const CLIENTE_FORA = idDemo('cliente:fora');
const permissoes = criarPermissoes([manifest]);

interface Usuario {
  id: string;
  tenant_id: string;
  perfil: Perfil;
  modulos: ModuloId[];
}
const usuario = (perfil: Perfil, o: Partial<Usuario> = {}): Usuario => ({ id: idDemo(`usuario:${perfil}`), tenant_id: TENANT_A, perfil, modulos: ['core', 'catalogo'], ...o });

interface Resposta<T> {
  status: number;
  corpo: T;
  codigo?: string;
}

const auditoria: unknown[] = [];
const parametrosGravados: Array<{ tenant: string; valores: Record<string, unknown>; acao?: string }> = [];
const eventos: Array<{ tenant: string; nome: string; payload: Record<string, unknown> }> = [];
const arquivosRegistrados: Array<Record<string, unknown>> = [];
const logs: Array<{ nivel: string; obj: Record<string, unknown>; msg?: string }> = [];

function dadosA(): DadosTenantMemoria {
  return {
    produtos: structuredClone([...PRODUTOS_DEMO]),
    itensPreco: [...ITENS_PRECO_DEMO],
    tabelaDoCliente: { [CLIENTE_VAREJO]: TABELA_VAREJO_DEMO, [CLIENTE_ATACADO]: TABELA_ATACADO_DEMO },
    saldos: saldosDemo(relogio.relativo({ horas: -1 }).toISOString()),
    sinonimos: [{ id: idDemo('sinonimo:refri'), term: 'refrigerante', synonyms: ['refri'], active: true }],
  };
}
const dadosB = (): DadosTenantMemoria => ({ produtos: [{ ...PRODUTOS_DEMO[0]!, id: idDemo('B:produto:1'), sku: 'B-1', nome: 'Pneu aro 13', marca: 'Rodabem', categoria: 'Pneus' }] });

let memoria = criarRepositorioMemoria({ [TENANT_A]: dadosA(), [TENANT_B]: dadosB() });

function montar(dep: Partial<DependenciasRotas> = {}) {
  const rotas = criarRotasCatalogo({ repositorio: memoria.fabrica, ...dep });
  const rota = (metodo: string, caminho: string) => rotas.find((r) => r.metodo === metodo && r.caminho === caminho)!;
  return { rotas, rota };
}

async function chamar<T>(rota: RotaModulo, u: Usuario, e: { query?: unknown; params?: unknown; corpo?: unknown } = {}, o: { carteira?: Set<string> | 'tenant'; parametros?: Record<string, unknown> } = {}): Promise<Resposta<T>> {
  const lic = verificarAcesso(u, { modulo: 'catalogo', perfis: [u.perfil] });
  if (!lic.ok) return { status: lic.status, codigo: lic.codigo, corpo: undefined as T };
  const perfil = rota.acao ? verificarAcao(u, permissoes, rota.acao) : verificarAcesso(u, { modulo: 'catalogo', perfis: rota.perfis ?? manifest.perfis });
  if (!perfil.ok) return { status: perfil.status, codigo: perfil.codigo, corpo: undefined as T };
  const validar = (schema: RotaModulo['query'], valor: unknown) => (schema ? schema.safeParse(valor ?? {}) : { success: true as const, data: valor ?? {} });
  const q = validar(rota.query, e.query);
  const p = validar(rota.params, e.params);
  const c = rota.corpo ? rota.corpo.safeParse(e.corpo) : { success: true as const, data: {} };
  if (!q.success || !p.success || !c.success) return { status: 400, codigo: 'VALIDACAO', corpo: undefined as T };
  const ctx: ContextoRota = {
    usuario: u,
    dependencias: {},
    requestId: 'req-teste',
    agora: () => relogio.agora(),
    fuso: () => 'America/Manaus',
    parametros: () => o.parametros ?? {},
    gravarParametros: async (v: Record<string, unknown>, op?: { acao?: string }) => void parametrosGravados.push({ tenant: u.tenant_id, valores: v, acao: op?.acao }),
    carteira: async () => o.carteira ?? new Set([CLIENTE_VAREJO, CLIENTE_ATACADO]),
    usuariosVisiveis: async () => new Set([u.id]),
    comTenant: async (fn) =>
      fn({ query: async () => ({ rows: [], rowCount: 0 }) }, {
        publicar: async (def: { nome: string }, payload: Record<string, unknown>) => {
          eventos.push({ tenant: u.tenant_id, nome: def.nome, payload });
          return {} as never;
        },
        registrarArquivo: async (a) => {
          arquivosRegistrados.push(a as unknown as Record<string, unknown>);
          return { criado: true };
        },
        consultar: async () => {
          throw new Error('consulta não usada pelo repositório em memória');
        },
        auditar: async (r) => {
          auditoria.push({ tenant: u.tenant_id, ...r });
        },
      }),
    log: {
      info: (obj, msg) => logs.push({ nivel: 'info', obj, msg }),
      warn: (obj, msg) => logs.push({ nivel: 'warn', obj, msg }),
      error: (obj, msg) => logs.push({ nivel: 'error', obj, msg }),
    },
    corpo: c.data,
    query: q.data,
    params: p.data,
  };
  try {
    const corpo = (await rota.executar(ctx as never)) as T;
    return { status: rota.status ?? 200, corpo };
  } catch (erro) {
    if (erro instanceof ErroHttpModulo) return { status: erro.status, codigo: erro.codigo, corpo: undefined as T };
    throw erro;
  }
}

const skus = (items: { id: string }[]) => items.map((i) => PRODUTOS_DEMO.find((p) => p.id === i.id)?.sku ?? i.id);

/** Porta de IA falsa: devolve filtros fixos e conta as chamadas. */
function portaFalsa(resposta: unknown | Error): PortaInterpretacaoLlm & { chamadas: number } {
  const p = {
    chamadas: 0,
    async interpretar() {
      p.chamadas++;
      if (resposta instanceof Error) throw resposta;
      return resposta;
    },
  };
  return p;
}

beforeEach(() => {
  memoria = criarRepositorioMemoria({ [TENANT_A]: dadosA(), [TENANT_B]: dadosB() });
  auditoria.length = 0;
  parametrosGravados.length = 0;
  eventos.length = 0;
  logs.length = 0;
});

describe('GET /v1/catalogo/busca — licença, perfil e escopo (regra 6)', () => {
  it('RN-CORE-01/03: sem o Catálogo efetivo para o usuário, 403 MODULO_INATIVO', async () => {
    const { rota } = montar();
    const r = await chamar(rota('GET', 'busca'), usuario('vendedor', { modulos: ['core'] }), { query: { q: 'café' } });
    expect(r).toMatchObject({ status: 403, codigo: 'MODULO_INATIVO' });
  });

  it('RN-CAT-04: todos os perfis do módulo consultam (vendedor, promotor, supervisor, gerente, analista, assistente, admin)', async () => {
    const { rota } = montar();
    for (const perfil of manifest.perfis) {
      const r = await chamar<RespostaBusca>(rota('GET', 'busca'), usuario(perfil), { query: { q: 'café' } }, { carteira: 'tenant' });
      expect(r.status, perfil).toBe(200);
      expect(skus(r.corpo.items)[0], perfil).toBe('CAF-500');
    }
  });

  it('RN-CORE-04: cliente fora da carteira = 403 FORA_DA_CARTEIRA (o preço dele não vaza)', async () => {
    const { rota } = montar();
    const r = await chamar(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'café', customer_id: CLIENTE_FORA } });
    expect(r).toMatchObject({ status: 403, codigo: 'FORA_DA_CARTEIRA' });
  });

  it('entrada inválida = 400 (texto vazio, limite fora da faixa, booleano que não é booleano)', async () => {
    const { rota } = montar();
    for (const query of [{ q: '' }, { q: 'café', limit: '500' }, { q: 'café', only_in_stock: 'talvez' }]) {
      expect((await chamar(rota('GET', 'busca'), usuario('vendedor'), { query })).status, JSON.stringify(query)).toBe(400);
    }
  });

  it('RN-CAT-01 (multi-tenant): cada tenant só acha os próprios produtos', async () => {
    const { rota } = montar();
    const b = usuario('vendedor', { tenant_id: TENANT_B });
    expect((await chamar<RespostaBusca>(rota('GET', 'busca'), b, { query: { q: 'café' } })).corpo.items).toEqual([]);
    expect((await chamar<RespostaBusca>(rota('GET', 'busca'), b, { query: { q: 'pneu' } })).corpo.items.map((i) => i.erp_code)).toEqual(['B-1']);
    expect((await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'pneu' } })).corpo.items).toEqual([]);
  });
});

describe('GET /v1/catalogo/busca — preço, estoque e perfil', () => {
  it('RN-CAT-06: preço da tabela do cliente; no Atacado o suco aparece "Sem preço para este cliente."', async () => {
    const { rota } = montar();
    const varejo = await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'suco de cupuaçu', customer_id: CLIENTE_VAREJO } });
    expect(varejo.corpo.items[0]!.price).toMatchObject({ price_cents: 899, sellable: true });
    const atacado = await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'suco de cupuaçu', customer_id: CLIENTE_ATACADO } });
    expect(atacado.corpo.items[0]!.price).toMatchObject({ price_cents: null, sellable: false, notice: MENSAGEM_SEM_PRECO_CLIENTE });
  });

  it('RN-CAT-05 (revista): o promotor vê o ESTOQUE e não o preço; "com estoque" filtra para ele como para o vendedor', async () => {
    const { rota } = montar();
    const r = await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('promotor'), { query: { q: 'açaí', customer_id: CLIENTE_VAREJO } });
    expect(skus(r.corpo.items)).toEqual(['ACA-1K']);
    expect(r.corpo.items[0]).toMatchObject({ price: null, price_stock_visible: false });
    expect(r.corpo.items[0]!.availability).toMatchObject({ band: 'sem_estoque' });
    expect((await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('promotor'), { query: { q: 'açaí com estoque', customer_id: CLIENTE_VAREJO } })).corpo.items).toEqual([]);
    const vendedor = await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'açaí com estoque', customer_id: CLIENTE_VAREJO } });
    expect(vendedor.corpo.items).toEqual([]);
  });

  it('RN-CAT-07: estoque das filiais do usuário, com a hora da atualização', async () => {
    memoria = criarRepositorioMemoria({ [TENANT_A]: { ...dadosA(), filiaisDeVenda: { [usuario('vendedor').id]: [FILIAL_DEMO] } }, [TENANT_B]: dadosB() });
    const { rota } = montar();
    const r = await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'café', customer_id: CLIENTE_VAREJO } });
    expect(r.corpo.items[0]!.availability).toMatchObject({ band: 'disponivel', quantity: 80, stale: false });
    expect(r.corpo.items[0]!.availability!.by_branch.map((b) => b.branch_id)).toEqual([FILIAL_DEMO]);
  });

  it('paginação: limit/offset, total e next_offset; chips somam aos filtros', async () => {
    const { rota } = montar();
    const p1 = await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'mercearia', limit: '3' } });
    expect(p1.corpo).toMatchObject({ total: 9, next_offset: 3 });
    const p3 = await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'mercearia', limit: '3', offset: '6' } });
    expect(p3.corpo).toMatchObject({ next_offset: null });
    const marca = await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'mercearia', brand: 'Bella Massa' } });
    expect(skus(marca.corpo.items).sort()).toEqual(['MAC-500', 'MOL-340']);
  });
});

describe('GET /v1/catalogo/busca — sem cliente: preço e estoque da filial (RN-VEN-01, RN-CORE-39)', () => {
  const FILIAL_BVB = idDemo('filial:BVB');
  const FILIAL_FORA = idDemo('filial:fora');
  const cafe = (c: { items: RespostaBusca['items'] }) => c.items.find((i) => PRODUTOS_DEMO.find((p) => p.id === i.id)?.sku === 'CAF-500') ?? c.items[0]!;
  function comFiliais(extra: Partial<DadosTenantMemoria> = {}) {
    const base = dadosA();
    const cafeId = base.produtos[0]!.id;
    memoria = criarRepositorioMemoria({
      [TENANT_A]: {
        ...base,
        filiaisDaTela: { padraoId: FILIAL_PADRAO_MEMORIA, filiais: [{ id: FILIAL_PADRAO_MEMORIA, nome: 'Manaus', padrao: true }, { id: FILIAL_BVB, nome: 'Boa Vista', padrao: false }, { id: FILIAL_DEMO, nome: 'CD Manaus', padrao: false }] },
        tabelas: [{ id: TABELA_VAREJO_DEMO, codigo: '01', nome: 'Varejo', ativo: true }, { id: TABELA_ATACADO_DEMO, codigo: '02', nome: 'Atacado', ativo: false }],
        itensPreco: [...ITENS_PRECO_DEMO.filter((i) => i.product_id !== cafeId), { price_table_id: TABELA_VAREJO_DEMO, product_id: cafeId, price_cents: 1000, valid_from: null, valid_to: null }, { price_table_id: TABELA_VAREJO_DEMO, product_id: cafeId, price_cents: 1234, valid_from: null, valid_to: null, filial_id: FILIAL_BVB }],
        ...extra,
      },
    });
    return cafeId;
  }

  it('RN-VEN-01: sem customer_id e sem filial, o preço é o da tabela da filial padrão (antes vinha sem preço)', async () => {
    comFiliais();
    const { rota } = montar();
    const r = await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'café' } });
    expect(cafe(r.corpo).price).toMatchObject({ price_cents: 1000, sellable: true });
  });

  it('RN-VEN-01: tabela inativa na filial não vale; sem tabela, o produto fica sem preço (nunca o de outra tabela)', async () => {
    comFiliais({ tabelas: [{ id: TABELA_VAREJO_DEMO, codigo: '01', nome: 'Varejo', ativo: false }] });
    const { rota } = montar();
    const r = await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'café' } });
    expect(cafe(r.corpo).price).toMatchObject({ price_cents: null, sellable: false });
  });

  it('RN-CORE-39: com `filial`, preço e estoque são os da filial escolhida', async () => {
    const em = relogio.relativo({ horas: -1 }).toISOString();
    const cafeId = dadosA().produtos[0]!.id;
    comFiliais({
      saldos: new Map([[cafeId, [{ branch_id: FILIAL_BVB, branch_name: 'Boa Vista', quantity: 7, updated_at: em }, { branch_id: FILIAL_DEMO, branch_name: 'CD Manaus', quantity: 80, updated_at: em }]]]),
      filiaisDeVenda: { [usuario('vendedor').id]: [FILIAL_BVB, FILIAL_DEMO] },
    });
    const { rota } = montar();
    const r = await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'café', filial: FILIAL_BVB } }, { carteira: 'tenant' });
    const item = cafe(r.corpo);
    expect(item.price).toMatchObject({ price_cents: 1234, sellable: true });
    // catalogo-campo-v2 §3 e §4: N é só da filial escolhida; a folha lista as filiais de venda
    expect(item.availability).toMatchObject({ quantity: 7 });
    expect(item.availability!.by_branch.map((b) => b.branch_id).sort()).toEqual([FILIAL_BVB, FILIAL_DEMO].sort());
  });

  it('catalogo-campo-v2 §3 / RN-CORE-39: o vendedor sem filtro soma as filiais de venda; `filial=todas` também; a folha lista só elas', async () => {
    const em = relogio.relativo({ horas: -1 }).toISOString();
    const cafeId = dadosA().produtos[0]!.id;
    comFiliais({
      saldos: new Map([[cafeId, [{ branch_id: FILIAL_BVB, branch_name: 'Boa Vista', quantity: 7, updated_at: em }, { branch_id: FILIAL_DEMO, branch_name: 'CD Manaus', quantity: 80, updated_at: em }]]]),
      filiaisDeVenda: { [usuario('vendedor').id]: [FILIAL_BVB] },
    });
    const { rota } = montar();
    const sem = cafe((await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'café' } }, { carteira: 'tenant' })).corpo).availability!;
    expect(sem.quantity).toBe(7);
    expect(sem.by_branch.map((b) => b.branch_id)).toEqual([FILIAL_BVB]);
    expect(cafe((await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'café', filial: 'todas' } }, { carteira: 'tenant' })).corpo).availability!.quantity).toBe(7);
  });

  it.each(['vendedor', 'admin', 'analista'] as const)('RN-CORE-39: %s sem filial é recusado (403 USUARIO_SEM_FILIAL), como no Core; preço e estoque não saem', async (perfil) => {
    comFiliais({ filiaisDeVenda: { [usuario(perfil).id]: [] } });
    const { rota } = montar();
    expect(await chamar(rota('GET', 'busca'), usuario(perfil), { query: { q: 'café' } })).toMatchObject({ status: 403, codigo: CODIGOS_FILIAL_USUARIO.semFilial });
  });

  it('RN-CAT-05 (revista) / spec §4: supervisor soma as filiais dele e a folha lista só as dele (a de venda sem saldo com 0, RN-CORE-39)', async () => {
    const em = relogio.relativo({ horas: -1 }).toISOString();
    const cafeId = dadosA().produtos[0]!.id;
    comFiliais({
      saldos: new Map([[cafeId, [{ branch_id: FILIAL_BVB, branch_name: 'Boa Vista', quantity: 7, updated_at: em }, { branch_id: FILIAL_DEMO, branch_name: 'CD Manaus', quantity: 80, updated_at: em }]]]),
      filiaisDeVenda: { [usuario('supervisor').id]: [FILIAL_BVB, FILIAL_PADRAO_MEMORIA] },
    });
    const { rota } = montar();
    const a = cafe((await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('supervisor'), { query: { q: 'café' } })).corpo).availability!;
    expect(a.quantity).toBe(7);
    expect(a.by_branch.map((b) => [b.branch_id, b.quantity])).toEqual([[FILIAL_BVB, 7], [FILIAL_PADRAO_MEMORIA, 0]]);
  });

  it('RN-CORE-39: filial que não é do tenant dá 422; a API revalida mesmo com a tela certa', async () => {
    comFiliais();
    const { rota } = montar();
    const r = await chamar(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'café', filial: FILIAL_FORA } });
    expect(r).toMatchObject({ status: 422, codigo: 'FILIAL_INEXISTENTE' });
  });

  it('RN-CORE-39: filial que não é de venda do usuário dá 403', async () => {
    comFiliais({ filiaisDeVenda: { [usuario('vendedor').id]: [FILIAL_PADRAO_MEMORIA] } });
    const { rota } = montar();
    const r = await chamar(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'café', filial: FILIAL_BVB } });
    expect(r).toMatchObject({ status: 403, codigo: 'FILIAL_FORA_DAS_SUAS' });
  });

  it('RN-CAT-05 (revista): o promotor continua sem preço, mesmo com `filial`, e vê o estoque da filial dele', async () => {
    comFiliais({ filiaisDeVenda: { [usuario('promotor').id]: [FILIAL_BVB] } });
    const { rota } = montar();
    const r = await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('promotor'), { query: { q: 'café', filial: FILIAL_BVB } });
    expect(r.status).toBe(200);
    expect(cafe(r.corpo)).toMatchObject({ price: null, price_stock_visible: false });
    expect(cafe(r.corpo).availability).not.toBeNull();
  });

  it('RN-CAT-06: com customer_id a filial pedida é ignorada (vale a tabela e a filial do cliente)', async () => {
    comFiliais();
    const { rota } = montar();
    const r = await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'café', customer_id: CLIENTE_VAREJO, filial: FILIAL_FORA } });
    expect(r.status).toBe(200);
  });
});

describe('GET /v1/catalogo/busca — IA, contingência e cota (RN-CAT-03)', () => {
  const filtrosLlm = { text: 'refrigerante', brand: null, line: 'Bebidas', min_price_cents: null, max_price_cents: null, stock: null, code: null, measures: [], sort: null };

  it('RN-CAT-03: provedor respondeu → interpretado pelo LLM, consome 1 da cota e informa o que resta', async () => {
    const porta = portaFalsa(filtrosLlm);
    const { rota } = montar({ portaIa: () => porta });
    const r = await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'uma bebida de guaraná pra festa' } });
    expect(r.corpo).toMatchObject({ interpreted_by: 'llm', degraded: false, notice: null, remaining_ai_queries: 199 });
    expect(skus(r.corpo.items).slice(0, 2).sort()).toEqual(['REF-2L', 'REF-350']);
    expect(porta.chamadas).toBe(1);
    expect([...memoria.estado(TENANT_A).usoIa.values()]).toEqual([1]);
  });

  it('RN-CAT-03: texto que parece código não chama a IA, não gasta cota e não mostra o aviso de indisponível', async () => {
    const porta = portaFalsa(new Error('fora do ar'));
    const { rota } = montar({ portaIa: () => porta });
    const r = await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'CAF-500' } });
    expect(r.corpo).toMatchObject({ interpreted_by: 'regras', degraded: false, notice: null, remaining_ai_queries: null });
    expect(skus(r.corpo.items)).toEqual(['CAF-500']);
    expect(porta.chamadas).toBe(0);
    expect([...memoria.estado(TENANT_A).usoIa.values()]).toEqual([]);
  });

  it('RN-CAT-03: provedor falhou ou estourou o tempo → busca textual com aviso discreto e NÃO consome', async () => {
    for (const erro of [new Error('fora do ar'), new ErroTempoEsgotadoIa()]) {
      memoria = criarRepositorioMemoria({ [TENANT_A]: dadosA() });
      const { rota } = montar({ portaIa: () => portaFalsa(erro) });
      const r = await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'refri' } });
      expect(r.corpo, erro.name).toMatchObject({ interpreted_by: 'regras', degraded: true, notice: AVISO_BUSCA_FALHOU });
      expect(skus(r.corpo.items).slice(0, 2).sort()).toEqual(['REF-2L', 'REF-350']);
      expect(memoria.estado(TENANT_A).usoIa.size).toBe(0);
    }
  });

  it('RN-CAT-03: limite atingido ou IA desligada → nem chama o provedor; avisa com a mensagem da regra', async () => {
    const porta = portaFalsa(filtrosLlm);
    const { rota } = montar({ portaIa: () => porta });
    const limite1 = { limite_consultas_ia_dia: 1 };
    await chamar(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'refri' } }, { parametros: limite1 });
    const segunda = await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'refri' } }, { parametros: limite1 });
    expect(segunda.corpo).toMatchObject({ interpreted_by: 'regras', degraded: true, notice: MENSAGEM_LIMITE_ATINGIDO, remaining_ai_queries: 0 });
    const desligada = await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('supervisor'), { query: { q: 'refri' } }, { parametros: { limite_consultas_ia_dia: 0 } });
    expect(desligada.corpo).toMatchObject({ notice: MENSAGEM_IA_DESLIGADA });
    expect(porta.chamadas).toBe(1);
  });

  it('RN-CAT-03: sem onde guardar a cota (banco sem a 0013) a IA não é chamada — falha fechada, com aviso', async () => {
    memoria = criarRepositorioMemoria({ [TENANT_A]: { ...dadosA(), semCotaIa: true } });
    const porta = portaFalsa(filtrosLlm);
    const { rota } = montar({ portaIa: () => porta });
    const r = await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'refri' } });
    expect(r.corpo).toMatchObject({ interpreted_by: 'regras', degraded: true, notice: AVISO_BUSCA_FALHOU });
    expect(porta.chamadas).toBe(0);
  });

  it('RN-CAT-03: consultas simultâneas não passam do limite (o débito é condicional)', async () => {
    const { rota } = montar({ portaIa: () => portaFalsa(filtrosLlm) });
    await Promise.all(Array.from({ length: 6 }, () => chamar(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'refri' } }, { parametros: { limite_consultas_ia_dia: 2 } })));
    expect([...memoria.estado(TENANT_A).usoIa.values()]).toEqual([2]);
  });

  it('modo básico: sem IA e sem aviso (interpreted_by = nenhum); sem provedor configurado também não avisa', async () => {
    const porta = portaFalsa(filtrosLlm);
    const basica = await chamar<RespostaBusca>(montar({ portaIa: () => porta }).rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'refri', mode: 'basica' } });
    expect(basica.corpo).toMatchObject({ interpreted_by: 'nenhum', degraded: false, notice: null, remaining_ai_queries: null });
    const semPorta = await chamar<RespostaBusca>(montar().rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'refri' } });
    expect(semPorta.corpo).toMatchObject({ interpreted_by: 'regras', degraded: false, notice: null });
    expect(porta.chamadas).toBe(0);
  });

  it('log sem o texto da busca e sem dado pessoal (só tenant, contagens e desfecho)', async () => {
    const { rota } = montar({ portaIa: () => portaFalsa(new Error('x')) });
    await chamar(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'refrigerante do João', customer_id: CLIENTE_VAREJO } });
    expect(logs.length).toBeGreaterThan(0);
    const tudo = JSON.stringify(logs);
    for (const proibido of ['refrigerante', 'João', CLIENTE_VAREJO, usuario('vendedor').id]) expect(tudo).not.toContain(proibido);
  });
});

describe('vitrine, ficha e filtros', () => {
  it('GET produtos: vitrine paginada, campanha e chips; o promotor sem preço', async () => {
    const { rota } = montar();
    const r = await chamar<PaginaVitrine>(rota('GET', 'produtos'), usuario('vendedor'), { query: { limit: '5', customer_id: CLIENTE_VAREJO } });
    expect(r.corpo).toMatchObject({ total: 24, next_offset: 5 });
    const campanha = await chamar<PaginaVitrine>(rota('GET', 'produtos'), usuario('vendedor'), { query: { campaign: 'true' } });
    expect(skus(campanha.corpo.items).sort()).toEqual(['ACA-1K', 'CAF-500']);
    const promotor = await chamar<PaginaVitrine>(rota('GET', 'produtos'), usuario('promotor'), { query: { line: 'Limpeza' } });
    expect(promotor.corpo.items.every((i) => !i.price_stock_visible && i.price === null)).toBe(true);
    expect(promotor.corpo.total).toBe(3);
  });

  it('GET produtos/:id: ficha com atributos e conteúdo; inexistente, inativo ou de outro tenant = 404', async () => {
    const { rota } = montar();
    const f = await chamar<FichaProduto>(rota('GET', 'produtos/:id'), usuario('vendedor'), { params: { id: idProdutoDemo('CAF-500') }, query: { customer_id: CLIENTE_VAREJO } });
    expect(f.corpo.product.price?.price_cents).toBe(1890);
    expect(f.corpo.attributes.map((a) => a.name)).toEqual(['Moagem', 'Torra']);
    expect((await chamar(rota('GET', 'produtos/:id'), usuario('vendedor', { tenant_id: TENANT_B }), { params: { id: idProdutoDemo('CAF-500') } })).status).toBe(404);
    expect((await chamar(rota('GET', 'produtos/:id'), usuario('vendedor'), { params: { id: idDemo('nao-existe') } })).status).toBe(404);
    memoria.estado(TENANT_A).dados.produtos.find((p) => p.sku === 'CAF-500')!.ativo = false;
    expect((await chamar(rota('GET', 'produtos/:id'), usuario('vendedor'), { params: { id: idProdutoDemo('CAF-500') } })).status).toBe(404);
  });

  it('GET filtros: marcas e categorias do tenant', async () => {
    const r = await chamar<FiltrosCatalogo>(montar().rota('GET', 'filtros'), usuario('promotor'));
    expect(r.corpo.lines).toEqual(['Bebidas', 'Biscoitos', 'Congelados', 'Higiene', 'Laticínios', 'Limpeza', 'Mercearia']);
    expect(r.corpo.brands).toContain('Grão Nobre');
  });
});

describe('BKO de conteúdo (RF-CAT-07, RN-CAT-04: analista e admin)', () => {
  const SIN = idDemo('sinonimo:novo');

  it('RN-CAT-04: vendedor, promotor, supervisor, gerente e assistente recebem 403 em todas as rotas do BKO', async () => {
    const { rota } = montar();
    const bko = [rota('GET', 'sinonimos'), rota('PUT', 'sinonimos/:id'), rota('DELETE', 'sinonimos/:id'), rota('PUT', 'produtos/:id/destaque'), rota('PUT', 'produtos/:id/conteudo'), rota('GET', 'termos-sem-resultado')];
    for (const perfil of ['vendedor', 'promotor', 'supervisor', 'gerente', 'assistente'] as const) {
      for (const r of bko) expect((await chamar(r, usuario(perfil))).codigo, `${perfil} ${r.metodo} ${r.caminho}`).toBe('PERFIL_SEM_ACESSO');
    }
  });

  it('PUT sinonimos/:id: cria, repete sem duplicar (idempotente), audita e passa a valer na busca', async () => {
    const { rota } = montar();
    const corpo = { term: 'sabão em pó', synonyms: ['lava roupas', 'Lava-roupas'] };
    const r1 = await chamar(rota('PUT', 'sinonimos/:id'), usuario('analista'), { params: { id: SIN }, corpo });
    const r2 = await chamar(rota('PUT', 'sinonimos/:id'), usuario('analista'), { params: { id: SIN }, corpo });
    expect([r1.corpo, r2.corpo]).toEqual([{ id: SIN, criado: true }, { id: SIN, criado: false }]);
    const lista = await chamar<ListaSinonimos>(rota('GET', 'sinonimos'), usuario('admin'));
    expect(lista.corpo.items.find((s) => s.id === SIN)).toMatchObject({ term: 'sabão em pó', synonyms: ['lava roupas'] });
    expect(auditoria).toHaveLength(2);
    const busca = await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'lava roupas' } });
    expect(skus(busca.corpo.items)[0]).toBe('SAB-1K');
  });

  it('PUT sinonimos/:id: grupo vazio = 422; termo já ativo em outro grupo = 409 com a ação seguinte', async () => {
    const { rota } = montar();
    const vazio = await chamar(rota('PUT', 'sinonimos/:id'), usuario('analista'), { params: { id: SIN }, corpo: { term: 'café', synonyms: ['cafés'] } });
    expect(vazio).toMatchObject({ status: 422, codigo: 'SINONIMO_VAZIO' });
    const conflito = await chamar(rota('PUT', 'sinonimos/:id'), usuario('analista'), { params: { id: SIN }, corpo: { term: 'Refrigerantes', synonyms: ['soda'] } });
    expect(conflito).toMatchObject({ status: 409, codigo: 'SINONIMO_EM_CONFLITO' });
  });

  it('DELETE sinonimos/:id: 204 e idempotente (só a primeira remoção é auditada)', async () => {
    const { rota } = montar();
    const id = idDemo('sinonimo:refri');
    expect((await chamar(rota('DELETE', 'sinonimos/:id'), usuario('admin'), { params: { id } })).status).toBe(204);
    expect((await chamar(rota('DELETE', 'sinonimos/:id'), usuario('admin'), { params: { id } })).status).toBe(204);
    expect(auditoria).toHaveLength(1);
  });

  it('PUT produtos/:id/destaque e /conteudo: gravam, auditam e aparecem na vitrine/ficha; produto inexistente = 404', async () => {
    const { rota } = montar();
    const id = idProdutoDemo('FEI-1K');
    expect((await chamar(rota('PUT', 'produtos/:id/destaque'), usuario('analista'), { params: { id }, corpo: { is_campaign: true } })).status).toBe(200);
    const conteudo = { description: 'Feijão novo, cozimento rápido.', selling_points: ['Safra 2026'], faq: [{ question: 'Precisa deixar de molho?', answer: 'Não é obrigatório.' }], attributes: [{ name: 'Tipo', value: '1' }] };
    expect((await chamar(rota('PUT', 'produtos/:id/conteudo'), usuario('admin'), { params: { id }, corpo: conteudo })).corpo).toEqual({ id, criado: true });
    const f = await chamar<FichaProduto>(rota('GET', 'produtos/:id'), usuario('promotor'), { params: { id } });
    expect(f.corpo).toMatchObject({ product: { is_campaign: true, price: null }, content: { description: 'Feijão novo, cozimento rápido.' }, content_updated_at: relogio.iso() });
    expect(auditoria.map((a) => (a as { acao: string }).acao)).toEqual(['destaque.gerenciar', 'produto.enriquecer']);
    expect((await chamar(rota('PUT', 'produtos/:id/destaque'), usuario('analista'), { params: { id: idDemo('x') }, corpo: { is_campaign: true } })).status).toBe(404);
  });

  it('T-0119: as gravações que mudam o retrato avisam o fim da transação (aposGravar com o tenant, inclusive quando falha); a leitura não avisa', async () => {
    const avisos: string[] = [];
    const { rota } = montar({ aposGravar: (t) => avisos.push(t) });
    const id = idProdutoDemo('FEI-1K');
    await chamar(rota('GET', 'produtos/:id'), usuario('promotor'), { params: { id } });
    expect(avisos).toEqual([]);
    await chamar(rota('PUT', 'produtos/:id/destaque'), usuario('analista'), { params: { id }, corpo: { is_campaign: true } });
    expect(avisos).toEqual([TENANT_A]);
    await chamar(rota('PUT', 'produtos/:id/destaque'), usuario('analista'), { params: { id: idDemo('x') }, corpo: { is_campaign: true } }); // 404: a transação acabou do mesmo jeito
    expect(avisos).toEqual([TENANT_A, TENANT_A]);
  });

  it('RF-CAT-03: PUT produtos/:id/foto-principal registra o arquivo do produto (sem cliente), define a principal, audita e é idempotente; vendedor 403, produto inexistente 404', async () => {
    const { rota } = montar();
    const id = idProdutoDemo('CAF-500');
    const arquivo_id = idDemo('foto:cafe');
    arquivosRegistrados.length = 0;
    auditoria.length = 0;
    expect((await chamar(rota('PUT', 'produtos/:id/foto-principal'), usuario('vendedor'), { params: { id }, corpo: { arquivo_id } })).status).toBe(403);
    expect((await chamar(rota('PUT', 'produtos/:id/foto-principal'), usuario('analista'), { params: { id: idDemo('x') }, corpo: { arquivo_id } })).status).toBe(404);
    expect((await chamar(rota('PUT', 'produtos/:id/foto-principal'), usuario('analista'), { params: { id }, corpo: { arquivo_id: 'nao-e-uuid' } })).status).toBe(400);
    const r = await chamar(rota('PUT', 'produtos/:id/foto-principal'), usuario('analista'), { params: { id }, corpo: { arquivo_id } });
    expect(r.corpo).toEqual({ id, criado: true });
    expect(arquivosRegistrados).toEqual([{ id: arquivo_id, finalidade: 'foto_produto', entidade: 'produto', entidade_id: id, cliente_id: null }]);
    const ficha = await chamar<FichaProduto>(rota('GET', 'produtos/:id'), usuario('vendedor'), { params: { id } });
    expect(ficha.corpo.product.thumbnail_url).toBe(`/v1/arquivos/${arquivo_id}`);
    expect((await chamar(rota('PUT', 'produtos/:id/foto-principal'), usuario('analista'), { params: { id }, corpo: { arquivo_id } })).corpo).toEqual({ id, criado: false });
    expect(auditoria).toHaveLength(1);
  });

  it('GET termos-sem-resultado: a busca sem resultado entra (normalizada), a com resultado não; outro tenant não vê', async () => {
    const { rota } = montar();
    for (const q of ['Cuscuz', 'cuscuz', 'café']) await chamar(rota('GET', 'busca'), usuario('vendedor'), { query: { q } });
    const r = await chamar<ListaTermosSemResultado>(rota('GET', 'termos-sem-resultado'), usuario('analista'));
    expect(r.corpo.items.map((t) => [t.term, t.count])).toEqual([['cuscuz', 2]]);
    const b = await chamar<ListaTermosSemResultado>(rota('GET', 'termos-sem-resultado'), usuario('analista', { tenant_id: TENANT_B }));
    expect(b.corpo.items).toEqual([]);
  });
});

describe('repositório Postgres (0013 ligada)', () => {
  const fake = (rows: Record<string, unknown[]>) => {
    const sqls: string[] = [];
    const db = {
      async query(sql: string) {
        sqls.push(sql);
        const chave = Object.keys(rows).find((k) => sql.includes(k));
        return { rows: (chave ? rows[chave] : []) as never[], rowCount: 0 };
      },
    };
    const consultas: unknown[] = [];
    const tx = {
      publicar: async () => {
        throw new Error('não');
      },
      registrarArquivo: async () => ({ criado: false }),
      auditar: async () => {},
      consultar: async (def: { nome?: string }, entrada: { produto_ids: string[] }) => {
        if (def.nome === 'promotor.concorrentes@1') return { concorrentes: [] };
        consultas.push(entrada);
        return { clientes: [], usuarios: [], produtos: entrada.produto_ids.map((id) => ({ id, sku: `S-${id.slice(0, 4)}`, nome: 'Produto', unidade: 'UN', ativo: true, external_id: null })) };
      },
    };
    return { db, tx, sqls, consultas };
  };
  const ctx = { usuario: usuario('vendedor') } as never;

  it('ADR 0012: produtos = ids com preço no schema catalogo + cadastro pela consulta do Core (nunca core.produto)', async () => {
    const f = fake({ 'from catalogo.tabela_preco_item where deleted_at is null order by produto_id': [{ produto_id: idDemo('p1') }, { produto_id: idDemo('p2') }] });
    const repo = criarRepositorioPostgres()(ctx, f.db, f.tx as never);
    const ps = await repo.produtos();
    expect(ps.map((p) => p.id)).toEqual([idDemo('p1'), idDemo('p2')]);
    expect(f.consultas).toEqual([{ cliente_ids: [], usuario_ids: [], produto_ids: [idDemo('p1'), idDemo('p2')] }]);
    expect(f.sqls.every((s) => !/\bcore\./.test(s))).toBe(true);
  });

  it('RN-CAT-06: sem cliente não há tabela (nada vendável); cliente sem tabela viva também não', async () => {
    const f = fake({});
    const repo = criarRepositorioPostgres()(ctx, f.db, f.tx as never);
    expect(await repo.precos(null, [idDemo('p1')])).toEqual({ tabelaClienteId: null, itens: [] });
    expect(await repo.precos(CLIENTE_VAREJO, [idDemo('p1')])).toEqual({ tabelaClienteId: null, itens: [] });
  });

  it('RN-CAT-03: cota pelas funções atômicas do banco (nulo = limite atingido); sinônimo e estoque saem das tabelas da 0013 (RLS, sem core.)', async () => {
    const f = fake({
      'catalogo.consultas_ia_do_dia': [{ n: 3 }],
      'catalogo.debitar_cota_ia': [{ n: null }],
      'from catalogo.sinonimo': [{ id: idDemo('s'), termo: 'sapata', sinonimos: ['pastilha'], ativo: true, external_id: null }],
    });
    const repo = criarRepositorioPostgres()({ usuario: usuario('vendedor'), agora: () => new Date('2026-11-02T15:00:00Z') } as never, f.db, f.tx as never);
    expect(await repo.usoIa('2026-11-02')).toEqual({ dia: '2026-11-02', consultas: 3 });
    expect(await repo.debitarIa('2026-11-02', 3)).toBe(false);
    expect(await repo.sinonimos()).toEqual([{ id: idDemo('s'), term: 'sapata', synonyms: ['pastilha'], active: true, external_id: null }]);
    expect(await repo.saldos([])).toEqual(new Map());
    expect(f.sqls.every((s) => !/\bcore\./.test(s))).toBe(true);
  });
});

describe('PUT produtos/:id/cadastro-catalogo e a ficha (T-0084/T-0085; RN-CAT-09, RN-CAT-11)', () => {
  const MARCA_A = idDemo('marca:freiomax');
  const MARCA_B = idDemo('marca:rodaforte');
  const MARCA_INATIVA = idDemo('marca:inativa');
  const FEI = idProdutoDemo('FEI-1K');
  const CAF = idProdutoDemo('CAF-500');
  const corpo = (o: Record<string, unknown> = {}) => ({ aplicacao: 'Fiat Uno 1.0/1.4 2010–2014', oferece_junto: [CAF], referencias: [{ marca_id: MARCA_A, codigo: 'CB 3401' }], etiquetas: ['Dianteira'], ...o });
  beforeEach(() => {
    const dados = dadosA();
    dados.marcas = new Map([
      [MARCA_A, { nome: 'Freiomax', ativo: true }],
      [MARCA_B, { nome: 'Rodaforte', ativo: true }],
      [MARCA_INATIVA, { nome: 'Velha', ativo: false }],
    ]);
    memoria = criarRepositorioMemoria({ [TENANT_A]: dados, [TENANT_B]: dadosB() });
  });

  it('RN-CAT-09: o analista grava o conjunto e a ficha mostra aplicação, equivalência, oferece junto e etiquetas (até para o promotor)', async () => {
    const { rota } = montar();
    const r = await chamar<{ id: string }>(rota('PUT', 'produtos/:id/cadastro-catalogo'), usuario('analista'), { params: { id: FEI }, corpo: corpo() });
    expect(r.status).toBe(200);
    const f = await chamar<FichaProduto>(rota('GET', 'produtos/:id'), usuario('promotor'), { params: { id: FEI } });
    expect(f.corpo.catalogo).toEqual({
      aplicacao: 'Fiat Uno 1.0/1.4 2010–2014',
      referencias: [{ marca_id: MARCA_A, marca_nome: 'Freiomax', codigo: 'CB 3401' }],
      oferece_junto: [expect.objectContaining({ produto_id: CAF })],
      etiquetas: ['Dianteira'],
    });
  });

  it('RN-CAT-09: salvar aplicação e oferece junto sem `referencias` mantém as referências; lista vazia explícita apaga', async () => {
    const { rota } = montar();
    const put = (c: unknown) => chamar(rota('PUT', 'produtos/:id/cadastro-catalogo'), usuario('analista'), { params: { id: FEI }, corpo: c });
    const ficha = async () => (await chamar<FichaProduto>(rota('GET', 'produtos/:id'), usuario('promotor'), { params: { id: FEI } })).corpo.catalogo!;
    await put(corpo());
    const { referencias: _omitida, ...semRef } = corpo({ aplicacao: 'Gol G5 2009', oferece_junto: [] });
    expect((await put(semRef)).status).toBe(200);
    const mantida = await ficha();
    expect(mantida.referencias).toEqual([{ marca_id: MARCA_A, marca_nome: 'Freiomax', codigo: 'CB 3401' }]);
    expect(mantida.aplicacao).toBe('Gol G5 2009');
    expect((await put(corpo({ referencias: [] }))).status).toBe(200);
    expect((await ficha()).referencias).toEqual([]);
  });

  it('RN-CAT-09: a alteração é auditada com antes e depois, sem o texto livre da aplicação', async () => {
    const { rota } = montar();
    await chamar(rota('PUT', 'produtos/:id/cadastro-catalogo'), usuario('admin'), { params: { id: FEI }, corpo: corpo() });
    const a = auditoria[0] as { acao: string; depois: { evento: string; aplicacao_tamanho: number; aplicacao?: string } };
    expect(a).toMatchObject({ acao: 'produto.enriquecer', depois: { evento: 'catalogo.produto.cadastro_alterado', aplicacao_tamanho: 26 } });
    expect(a.depois.aplicacao).toBeUndefined();
  });

  it('RN-CAT-04: só analista e admin gravam (vendedor, promotor e supervisor recebem 403); o módulo precisa estar ativo', async () => {
    const { rota } = montar();
    for (const p of ['vendedor', 'promotor', 'supervisor'] as const) {
      expect((await chamar(rota('PUT', 'produtos/:id/cadastro-catalogo'), usuario(p), { params: { id: FEI }, corpo: corpo() })).status).toBe(403);
    }
    expect((await chamar(rota('PUT', 'produtos/:id/cadastro-catalogo'), usuario('analista', { modulos: ['core'] }), { params: { id: FEI }, corpo: corpo() })).status).toBe(403);
  });

  it('RN-CAT-09: 4 referências, o próprio produto, marca inativa ou desconhecida e produto inexistente = 422 com a regra', async () => {
    const { rota } = montar();
    const put = (c: unknown) => chamar(rota('PUT', 'produtos/:id/cadastro-catalogo'), usuario('analista'), { params: { id: FEI }, corpo: c });
    const quatro = ['A1', 'B2', 'C3', 'D4'].map((codigo) => ({ marca_id: MARCA_A, codigo }));
    expect(await put(corpo({ referencias: quatro }))).toMatchObject({ status: 422, codigo: 'RN-CAT-09' });
    expect(await put(corpo({ oferece_junto: [FEI] }))).toMatchObject({ status: 422, codigo: 'RN-CAT-09' });
    expect(await put(corpo({ referencias: [{ marca_id: MARCA_INATIVA, codigo: 'X1' }] }))).toMatchObject({ status: 422, codigo: 'RN-CAT-09' });
    expect(await put(corpo({ referencias: [{ marca_id: idDemo('marca:nao-existe'), codigo: 'X1' }] }))).toMatchObject({ status: 422, codigo: 'RN-CAT-09' });
    expect(await put(corpo({ oferece_junto: [idDemo('produto:nao-existe')] }))).toMatchObject({ status: 422, codigo: 'RN-CAT-09' });
    expect(auditoria).toHaveLength(0);
  });

  it('RN-CAT-09: consulta de marcas indisponível (sem o Promotor) recusa a referência com mensagem clara, mas grava o resto sem referências', async () => {
    memoria = criarRepositorioMemoria({ [TENANT_A]: dadosA(), [TENANT_B]: dadosB() });
    const { rota } = montar();
    const put = (c: unknown) => chamar<{ id: string }>(rota('PUT', 'produtos/:id/cadastro-catalogo'), usuario('analista'), { params: { id: FEI }, corpo: c });
    const r = await put(corpo());
    expect(r).toMatchObject({ status: 422, codigo: 'RN-CAT-09' });
    expect((await put(corpo({ referencias: [] }))).status).toBe(200);
    const lista = await chamar<{ items: unknown[] }>(rota('GET', 'marcas-concorrentes'), usuario('analista'));
    expect(lista.corpo.items).toEqual([]);
  });

  it('RN-CAT-09: "oferece junto" por código resolve no servidor sem diferenciar maiúsculas; código inexistente = 422', async () => {
    const { rota } = montar();
    const put = (c: unknown) => chamar(rota('PUT', 'produtos/:id/cadastro-catalogo'), usuario('analista'), { params: { id: FEI }, corpo: c });
    expect((await put(corpo({ oferece_junto: [], oferece_junto_codigos: [' caf-500 '] }))).status).toBe(200);
    const f = await chamar<FichaProduto>(rota('GET', 'produtos/:id'), usuario('promotor'), { params: { id: FEI } });
    expect(f.corpo.catalogo?.oferece_junto.map((o) => o.produto_id)).toEqual([CAF]);
    expect(await put(corpo({ oferece_junto: [], oferece_junto_codigos: ['NAO-EXISTE'] }))).toMatchObject({ status: 422, codigo: 'RN-CAT-09' });
  });

  it('RN-CAT-11: aplicação acima de aplicacao_max_cadastro = 422 RN-CAT-11 (cadastro-catalogo e conteudo)', async () => {
    const { rota } = montar();
    const o = { parametros: { aplicacao_max_cadastro: 100 } };
    const longa = 'x'.repeat(101);
    expect(await chamar(rota('PUT', 'produtos/:id/cadastro-catalogo'), usuario('analista'), { params: { id: FEI }, corpo: corpo({ aplicacao: longa }) }, o)).toMatchObject({ status: 422, codigo: 'RN-CAT-11' });
    const conteudo = { description: null, selling_points: [], faq: [], attributes: [], aplicacao: longa };
    expect(await chamar(rota('PUT', 'produtos/:id/conteudo'), usuario('analista'), { params: { id: FEI }, corpo: conteudo }, o)).toMatchObject({ status: 422, codigo: 'RN-CAT-11' });
  });

  it('RN-CAT-11: salvar o conteúdo sem o campo aplicação não apaga a aplicação já cadastrada', async () => {
    const { rota } = montar();
    await chamar(rota('PUT', 'produtos/:id/cadastro-catalogo'), usuario('analista'), { params: { id: FEI }, corpo: corpo() });
    await chamar(rota('PUT', 'produtos/:id/conteudo'), usuario('analista'), { params: { id: FEI }, corpo: { description: 'Novo texto', selling_points: [], faq: [], attributes: [] } });
    const f = await chamar<FichaProduto>(rota('GET', 'produtos/:id'), usuario('vendedor'), { params: { id: FEI } });
    expect(f.corpo.catalogo?.aplicacao).toBe('Fiat Uno 1.0/1.4 2010–2014');
  });

  it('RN-CAT-01: a aplicação e as referências de um tenant não aparecem no outro', async () => {
    const { rota } = montar();
    await chamar(rota('PUT', 'produtos/:id/cadastro-catalogo'), usuario('analista'), { params: { id: FEI }, corpo: corpo() });
    const outro = await chamar(rota('GET', 'produtos/:id'), usuario('vendedor', { tenant_id: TENANT_B }), { params: { id: FEI } });
    expect(outro.status).toBe(404);
  });

  it('RN-CAT-12: a busca da rota acha o produto pela aplicação com "Serve em" e "inclui 2012"; "2015" vem só como o mais próximo', async () => {
    const { rota } = montar();
    await chamar(rota('PUT', 'produtos/:id/cadastro-catalogo'), usuario('analista'), { params: { id: FEI }, corpo: corpo({ aplicacao: 'Feijão carioca tipo 1 safra 2010–2014' }) });
    const dentro = await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'carioca 2012', mode: 'basica' } });
    expect(dentro.corpo.items.map((i) => i.id)).toContain(FEI);
    expect(dentro.corpo.items.find((i) => i.id === FEI)?.serve_em).toMatchObject({ inclui_ano: 2012 });
    const fora = await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'carioca 2015', mode: 'basica' } });
    expect(fora.corpo.items.map((i) => i.id)).toContain(FEI);
    expect(fora.corpo.items.find((i) => i.id === FEI)?.serve_em).not.toMatchObject({ inclui_ano: 2015 });
  });

  it('RN-CAT-09: a busca pelo código do concorrente mostra "Equivale a"', async () => {
    const { rota } = montar();
    await chamar(rota('PUT', 'produtos/:id/cadastro-catalogo'), usuario('analista'), { params: { id: FEI }, corpo: corpo() });
    const r = await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'cb3401', mode: 'basica' } });
    expect(r.corpo.items[0]?.id).toBe(FEI);
    expect(r.corpo.items[0]?.equivale_a).toMatchObject({ marca_nome: 'Freiomax', codigo: 'CB 3401' });
  });

  it('RF-CAT-09: GET hierarquia abre pelo nível mais alto, conta só produtos ativos e leva "Sem classificação"; produtos?no= filtra pelo nível', async () => {
    const { rota } = montar();
    const no = (id: string, pai: string | null, nivel: number, nome: string, ordem: number) => ({ id: idDemo(`no:${id}`), pai_id: pai ? idDemo(`no:${pai}`) : null, nivel, codigo: id.toUpperCase(), nome, ordem, ativo: true });
    const dados = memoria.estado(TENANT_A).dados;
    dados.nos = [no('ali', null, 1, 'Alimentos', 1), no('mer', 'ali', 2, 'Mercearia', 1), no('aut', null, 1, 'Automotivo', 2)];
    dados.vinculos = [
      { produto_id: CAF, no_id: idDemo('no:mer') },
      { produto_id: FEI, no_id: idDemo('no:mer') },
      { produto_id: idDemo('produto:em-automotivo'), no_id: idDemo('no:aut') },
    ];
    const novo = (n: string) => ({ ...dados.produtos[0]!, id: idDemo(`produto:${n}`), sku: n.toUpperCase(), nome: n, ativo: true });
    dados.produtos.push(novo('em-automotivo'), novo('sem-nivel'));
    const ativos = dados.produtos.filter((p) => p.ativo).length;
    const raiz = await chamar<RespostaHierarquia>(rota('GET', 'hierarquia'), usuario('vendedor'));
    expect(raiz.status).toBe(200);
    expect(RespostaHierarquia.safeParse(raiz.corpo).success).toBe(true);
    expect(raiz.corpo).toMatchObject({ tipo: 'niveis', rotulo_plural: 'Sistemas', raiz_tocavel: false, trilha: [], total_produtos: ativos });
    // valor × regra: Alimentos = 2, Automotivo = 1 e o resto cai em "Sem classificação"; a soma bate com o total
    expect(raiz.corpo.niveis.map((n) => [n.nome, n.total])).toEqual([['Alimentos', 2], ['Automotivo', 1], ['Sem classificação', ativos - 3]]);
    expect(raiz.corpo.niveis.reduce((t, n) => t + n.total, 0)).toBe(ativos);
    // Alimentos tem um grupo só (Mercearia): pula direto para os produtos dele
    const ali = await chamar<RespostaHierarquia>(rota('GET', 'hierarquia'), usuario('vendedor'), { query: { no: idDemo('no:ali') } });
    expect(ali.corpo).toMatchObject({ tipo: 'produtos', no: idDemo('no:mer'), total_produtos: 2 });
    // a lista do BKO/app por nível: só os produtos do nível
    const lista = await chamar<PaginaVitrine>(rota('GET', 'produtos'), usuario('vendedor'), { query: { no: idDemo('no:ali') } });
    expect(lista.corpo.items.map((i) => i.id).sort()).toEqual([CAF, FEI].sort());
    // "Outros produtos" (outros:<uuid>, 43 caracteres) e "Sem classificação" (sem-linha) são ids válidos nas duas rotas
    const outros = `outros:${idDemo('no:ali')}`;
    expect(outros.length).toBe(43);
    for (const id of [outros, 'sem-linha']) {
      expect((await chamar(rota('GET', 'hierarquia'), usuario('vendedor'), { query: { no: id } })).status).toBe(200);
      expect((await chamar(rota('GET', 'produtos'), usuario('vendedor'), { query: { no: id } })).status).toBe(200);
    }
    expect((await chamar(rota('GET', 'produtos'), usuario('vendedor'), { query: { no: 'lixo' } })).status).toBe(400);
    // tenant sem hierarquia: lista de produtos
    const b = await chamar<RespostaHierarquia>(rota('GET', 'hierarquia'), usuario('vendedor', { tenant_id: TENANT_B }));
    expect(b.corpo).toMatchObject({ tipo: 'produtos', sem_hierarquia: true });
    expect((await chamar(rota('GET', 'hierarquia'), usuario('vendedor', { modulos: ['core'] }))).status).toBe(403);
  });

  it('RF-CAT-09: GET exportacao devolve produtos com aplicação, referências e oferece junto, e as marcas ativas; só analista e admin', async () => {
    const { rota } = montar();
    await chamar(rota('PUT', 'produtos/:id/cadastro-catalogo'), usuario('analista'), { params: { id: FEI }, corpo: corpo() });
    const r = await chamar<RespostaExportacao>(rota('GET', 'exportacao'), usuario('analista'));
    expect(r.status).toBe(200);
    expect(RespostaExportacao.safeParse(r.corpo).success).toBe(true);
    const p = r.corpo.produtos.find((x) => x.id === FEI)!;
    expect(p).toMatchObject({ aplicacao: 'Fiat Uno 1.0/1.4 2010–2014', referencias: [{ marca_id: MARCA_A, marca_nome: 'Freiomax', codigo: 'CB 3401' }], oferece_junto: [CAF] });
    expect(r.corpo.marcas.map((m) => m.nome)).toEqual(['Freiomax', 'Rodaforte']);
    expect(r.corpo.truncado).toBe(false);
    expect((await chamar(rota('GET', 'exportacao'), usuario('admin'))).status).toBe(200);
    for (const perfil of ['vendedor', 'promotor', 'supervisor'] as const) expect((await chamar(rota('GET', 'exportacao'), usuario(perfil))).status).toBe(403);
  });

  it('RN-CAT-09: GET exportacao sem o cadastro de marcas usa o retrato marca_nome; sem retrato a referência sai sem marca e sem quebrar', async () => {
    const { rota } = montar();
    await chamar(rota('PUT', 'produtos/:id/cadastro-catalogo'), usuario('analista'), { params: { id: FEI }, corpo: corpo() });
    memoria.estado(TENANT_A).dados.marcas = new Map(); // Promotor indisponível
    const com = await chamar<RespostaExportacao>(rota('GET', 'exportacao'), usuario('analista'));
    expect(RespostaExportacao.safeParse(com.corpo).success).toBe(true);
    expect(com.corpo.produtos.find((x) => x.id === FEI)!.referencias).toEqual([{ marca_id: MARCA_A, marca_nome: 'Freiomax', codigo: 'CB 3401' }]);
    expect(com.corpo.marcas).toEqual([]);
    const prod = memoria.estado(TENANT_A).dados.produtos.find((x) => x.id === FEI)!;
    prod.referencias = [{ marca_id: MARCA_A, marca_nome: '', codigo: 'CB 3401' }];
    const sem = await chamar<RespostaExportacao>(rota('GET', 'exportacao'), usuario('analista'));
    expect(sem.status).toBe(200);
    expect(sem.corpo.produtos.find((x) => x.id === FEI)!.referencias).toEqual([{ marca_id: MARCA_A, marca_nome: null, codigo: 'CB 3401' }]);
  });

  it('RF-CAT-09: GET exportacao sem a licença do catálogo é 403 e só traz o tenant do usuário', async () => {
    const { rota } = montar();
    const semLicenca = await chamar(rota('GET', 'exportacao'), usuario('analista', { modulos: ['core'] }));
    expect(semLicenca.status).toBe(403);
    const b = await chamar<RespostaExportacao>(rota('GET', 'exportacao'), usuario('analista', { tenant_id: TENANT_B }));
    expect(b.corpo.produtos.map((x) => x.codigo)).toEqual(['B-1']);
    expect(b.corpo.marcas).toEqual([]);
  });

  it('RN-CAT-09: GET marcas-concorrentes lista só as ativas, em ordem de nome, e só para quem enriquece', async () => {
    const { rota } = montar();
    const r = await chamar<{ items: { id: string; nome: string }[] }>(rota('GET', 'marcas-concorrentes'), usuario('analista'));
    expect(r.corpo.items.map((m) => m.nome)).toEqual(['Freiomax', 'Rodaforte']);
    expect((await chamar(rota('GET', 'marcas-concorrentes'), usuario('vendedor'))).status).toBe(403);
  });
});

describe('BKO Tabelas de preço e Escalonada (RN-VEN-23, RN-VEN-15; T-0089: analista e admin)', () => {
  const FAIXA = idDemo('faixa:1');
  const FAIXA_ERP = idDemo('faixa:erp');
  const produto = PRODUTOS_DEMO[0]!;
  const corpo = (extra: Record<string, unknown> = {}) => ({ produto_id: produto.id, medida: null, quantidade_minima: 10, preco_unidade_cents: 900, vigencia_inicio: '2026-01-01', vigencia_fim: null, tabela_preco_id: null, ativo: true, ...extra });
  const semear = () => {
    const d = memoria.estado(TENANT_A).dados;
    d.tabelas = [{ id: TABELA_ATACADO_DEMO, codigo: 'ATACADO', nome: 'Atacado', ativo: true }];
    d.faixas = [{ id: FAIXA_ERP, external_id: 'ESC-1', produto_id: produto.id, medida: 'FD', quantidade_minima: 5, preco_unidade_cents: 950, vigencia_inicio: '2026-01-01', vigencia_fim: null, tabela_preco_id: TABELA_ATACADO_DEMO, ativo: true }];
  };

  it('RN-CAT-04: vendedor, promotor, supervisor, gerente e assistente recebem 403 nas rotas de tabela de preço', async () => {
    const { rota } = montar();
    const rotasBko = [rota('GET', 'tabelas-preco'), rota('GET', 'tabelas-preco/:id/precos'), rota('GET', 'escalonada'), rota('PUT', 'escalonada/:id'), rota('DELETE', 'escalonada/:id')];
    for (const perfil of ['vendedor', 'promotor', 'supervisor', 'gerente', 'assistente'] as const) {
      for (const r of rotasBko) expect((await chamar(r, usuario(perfil))).codigo, `${perfil} ${r.metodo} ${r.caminho}`).toBe('PERFIL_SEM_ACESSO');
    }
  });

  it('RN-VEN-15: a lista de preços da tabela mostra só o preço da unidade (a linha de embalagem não aparece)', async () => {
    semear();
    memoria.estado(TENANT_A).dados.itensPreco = [
      { price_table_id: TABELA_ATACADO_DEMO, product_id: produto.id, price_cents: 1890 },
      { price_table_id: TABELA_ATACADO_DEMO, product_id: produto.id, price_cents: 21546, unit: 'CX' },
    ];
    const { rota } = montar();
    const tabelas = await chamar<{ items: { id: string; itens: number }[] }>(rota('GET', 'tabelas-preco'), usuario('analista'));
    expect(tabelas.corpo.items).toEqual([expect.objectContaining({ id: TABELA_ATACADO_DEMO, itens: 1 })]);
    const r = await chamar<{ items: { preco_cents: number; sku: string }[]; total: number }>(rota('GET', 'tabelas-preco/:id/precos'), usuario('admin'), { params: { id: TABELA_ATACADO_DEMO } });
    expect(r.corpo.items).toEqual([expect.objectContaining({ preco_cents: 1890, sku: produto.sku })]);
    expect(r.corpo.total).toBe(1);
  });

  it('RN-CORE-39: Tabelas de preço mostra uma filial por vez (a padrão por omissão), sem duplicar o produto', async () => {
    semear();
    const BVB = '0f000000-0000-4000-8000-0000000000b1';
    const d = memoria.estado(TENANT_A).dados;
    d.filiaisDaTela = { padraoId: FILIAL_PADRAO_MEMORIA, filiais: [{ id: FILIAL_PADRAO_MEMORIA, nome: 'Manaus', padrao: true }, { id: BVB, nome: 'Boa Vista', padrao: false }] };
    d.itensPreco = [
      { price_table_id: TABELA_ATACADO_DEMO, product_id: produto.id, price_cents: 1890 },
      { price_table_id: TABELA_ATACADO_DEMO, product_id: produto.id, price_cents: 2000, filial_id: BVB },
    ];
    const { rota } = montar();
    const padrao = await chamar<{ filial_id: string; filiais: unknown[]; items: { itens: number }[] }>(rota('GET', 'tabelas-preco'), usuario('analista'));
    expect(padrao.corpo.filial_id).toBe(FILIAL_PADRAO_MEMORIA);
    expect(padrao.corpo.filiais).toHaveLength(2);
    expect(padrao.corpo.items[0]!.itens).toBe(1);
    const bv = await chamar<{ items: { itens: number }[] }>(rota('GET', 'tabelas-preco'), usuario('analista'), { query: { filial: BVB } });
    expect(bv.corpo.items[0]!.itens).toBe(1);
    const precosPadrao = await chamar<{ items: { preco_cents: number }[]; total: number }>(rota('GET', 'tabelas-preco/:id/precos'), usuario('admin'), { params: { id: TABELA_ATACADO_DEMO } });
    const precosBv = await chamar<{ filial_id: string; items: { preco_cents: number }[]; total: number }>(rota('GET', 'tabelas-preco/:id/precos'), usuario('admin'), { params: { id: TABELA_ATACADO_DEMO }, query: { filial: BVB } });
    expect(precosPadrao.corpo.items.map((i) => i.preco_cents)).toEqual([1890]);
    expect([precosBv.corpo.filial_id, precosBv.corpo.total, precosBv.corpo.items[0]!.preco_cents]).toEqual([BVB, 1, 2000]);
    const fora = await chamar(rota('GET', 'tabelas-preco'), usuario('analista'), { query: { filial: '0f000000-0000-4000-8000-0000000000ff' } });
    expect(fora.status).toBe(422);
  });

  it('RN-VEN-23: PUT cria a faixa, repete sem duplicar (idempotente), audita e a lista a mostra como vigente e cadastrada aqui', async () => {
    semear();
    const { rota } = montar();
    const r1 = await chamar(rota('PUT', 'escalonada/:id'), usuario('analista'), { params: { id: FAIXA }, corpo: corpo() });
    const r2 = await chamar(rota('PUT', 'escalonada/:id'), usuario('analista'), { params: { id: FAIXA }, corpo: corpo({ preco_unidade_cents: 880 }) });
    expect([r1.corpo, r2.corpo]).toEqual([{ id: FAIXA, criado: true }, { id: FAIXA, criado: false }]);
    expect(auditoria).toHaveLength(2);
    const lista = await chamar<{ items: Array<{ id: string; preco_unidade_cents: number; vigente: boolean; origem: string }> }>(rota('GET', 'escalonada'), usuario('admin'));
    expect(lista.corpo.items.find((f) => f.id === FAIXA)).toMatchObject({ preco_unidade_cents: 880, vigente: true, origem: 'manual' });
  });

  it('RN-VEN-23: a API revalida a faixa (quantidade zero, fim antes do início) com 422 RN-VEN-23', async () => {
    semear();
    const { rota } = montar();
    for (const ruim of [corpo({ quantidade_minima: 0 }), corpo({ vigencia_fim: '2025-12-31' }), corpo({ preco_unidade_cents: 0 })]) {
      const r = await chamar(rota('PUT', 'escalonada/:id'), usuario('analista'), { params: { id: FAIXA }, corpo: ruim });
      expect(r.status).toBe(422);
    }
  });

  it('RN-VEN-23: produto que não existe no tenant é 422 PRODUTO_INEXISTENTE (sem faixa órfã)', async () => {
    semear();
    const { rota } = montar();
    const r = await chamar(rota('PUT', 'escalonada/:id'), usuario('analista'), { params: { id: FAIXA }, corpo: corpo({ produto_id: idDemo('produto:fantasma') }) });
    expect(r).toMatchObject({ status: 422, codigo: 'PRODUTO_INEXISTENTE' });
  });

  it('RN-VEN-23: faixa com a mesma chave de outra viva é 409 FAIXA_EM_CONFLITO', async () => {
    semear();
    const { rota } = montar();
    await chamar(rota('PUT', 'escalonada/:id'), usuario('analista'), { params: { id: FAIXA }, corpo: corpo() });
    const r = await chamar(rota('PUT', 'escalonada/:id'), usuario('analista'), { params: { id: idDemo('faixa:2') }, corpo: corpo() });
    expect(r).toMatchObject({ status: 409, codigo: 'FAIXA_EM_CONFLITO' });
  });

  it('RN-INT-02: faixa que veio do ERP é só leitura no BKO (409 FAIXA_DO_ERP ao editar ou remover)', async () => {
    semear();
    const { rota } = montar();
    expect(await chamar(rota('PUT', 'escalonada/:id'), usuario('analista'), { params: { id: FAIXA_ERP }, corpo: corpo({ medida: 'FD', quantidade_minima: 5 }) })).toMatchObject({ status: 409, codigo: 'FAIXA_DO_ERP' });
    expect(await chamar(rota('DELETE', 'escalonada/:id'), usuario('analista'), { params: { id: FAIXA_ERP } })).toMatchObject({ status: 409, codigo: 'FAIXA_DO_ERP' });
  });

  it('DELETE remove a faixa cadastrada aqui e é idempotente (204 também quando já não existe)', async () => {
    semear();
    const { rota } = montar();
    await chamar(rota('PUT', 'escalonada/:id'), usuario('analista'), { params: { id: FAIXA }, corpo: corpo() });
    expect((await chamar(rota('DELETE', 'escalonada/:id'), usuario('analista'), { params: { id: FAIXA } })).status).toBe(204);
    expect((await chamar(rota('DELETE', 'escalonada/:id'), usuario('analista'), { params: { id: FAIXA } })).status).toBe(204);
    expect(auditoria).toHaveLength(2);
    const lista = await chamar<{ items: { id: string }[] }>(rota('GET', 'escalonada'), usuario('analista'));
    expect(lista.corpo.items.map((f) => f.id)).toEqual([FAIXA_ERP]);
  });

  it('RN-VEN-23: filtros da lista (só vigentes, tabela, busca) e aviso P4 de faixa acima do preço da tabela', async () => {
    semear();
    const d = memoria.estado(TENANT_A).dados;
    d.itensPreco = [{ price_table_id: TABELA_ATACADO_DEMO, product_id: produto.id, price_cents: 900 }];
    d.faixas!.push({ id: FAIXA, external_id: null, produto_id: produto.id, medida: null, quantidade_minima: 10, preco_unidade_cents: 800, vigencia_inicio: '2099-01-01', vigencia_fim: null, tabela_preco_id: null, ativo: true });
    const { rota } = montar();
    const todas = await chamar<{ items: Array<{ id: string; mais_cara_que_a_tabela: boolean; vigente: boolean }>; total: number }>(rota('GET', 'escalonada'), usuario('analista'));
    expect(todas.corpo.total).toBe(2);
    expect(todas.corpo.items.find((f) => f.id === FAIXA_ERP)).toMatchObject({ mais_cara_que_a_tabela: true, vigente: true });
    expect(todas.corpo.items.find((f) => f.id === FAIXA)).toMatchObject({ vigente: false });
    const vigentes = await chamar<{ items: { id: string }[] }>(rota('GET', 'escalonada'), usuario('analista'), { query: { vigente: 'true' } });
    expect(vigentes.corpo.items.map((f) => f.id)).toEqual([FAIXA_ERP]);
    const outraTabela = await chamar<{ total: number }>(rota('GET', 'escalonada'), usuario('analista'), { query: { tabela_preco_id: idDemo('tabela:inexistente') } });
    expect(outraTabela.corpo.total).toBe(0);
    const porNome = await chamar<{ total: number }>(rota('GET', 'escalonada'), usuario('analista'), { query: { q: 'zzzz-nada' } });
    expect(porNome.corpo.total).toBe(0);
  });

  it('RN-CAT-01: o outro tenant não vê nem altera as faixas', async () => {
    semear();
    const { rota } = montar();
    const lista = await chamar<{ total: number }>(rota('GET', 'escalonada'), usuario('analista', { tenant_id: TENANT_B }));
    expect(lista.corpo.total).toBe(0);
  });
});

describe('Marcas concorrentes do Catálogo (RN-CAT-13, T-0113, ADR 0034)', () => {
  const M1 = idDemo('marca:1');
  const M2 = idDemo('marca:2');
  type Item = { id: string; nome: string; ativo: boolean; referencias: number };
  const lista = async (rota: ReturnType<typeof montar>['rota'], situacao?: string, busca?: string) =>
    (await chamar<{ marcas: Item[] }>(rota('GET', 'marcas'), usuario('analista'), { query: { ...(situacao ? { situacao } : {}), ...(busca ? { busca } : {}) } })).corpo.marcas;

  it('RN-CAT-13: o analista cria a marca sem o Promotor nos módulos, ela aparece na lista e o evento sai com o fato "criada"', async () => {
    const { rota } = montar();
    const analista = usuario('analista', { modulos: ['core', 'catalogo'] });
    const r = await chamar<{ id: string; criado: boolean }>(rota('POST', 'marcas'), analista, { corpo: { id: M1, nome: '  Freiomax ' } });
    expect(r.status).toBe(200);
    expect(r.corpo).toEqual({ id: M1, criado: true });
    expect((await lista(rota)).map((m) => m.nome)).toEqual(['Freiomax']);
    expect(eventos.map((e) => [e.nome, e.payload.fato, e.payload.nome, e.payload.ativo])).toEqual([['catalogo.marca_concorrente.alterada@1', 'criada', 'Freiomax', true]]);
    expect(JSON.stringify(auditoria)).not.toContain('Freiomax');
  });

  it('RN-CAT-13: criar de novo com o mesmo id é idempotente (não duplica nem publica de novo)', async () => {
    const { rota } = montar();
    await chamar(rota('POST', 'marcas'), usuario('analista'), { corpo: { id: M1, nome: 'Freiomax' } });
    const r = await chamar<{ criado: boolean }>(rota('POST', 'marcas'), usuario('analista'), { corpo: { id: M1, nome: 'Freiomax' } });
    expect(r.corpo.criado).toBe(false);
    expect(await lista(rota)).toHaveLength(1);
    expect(eventos).toHaveLength(1);
  });

  it('RN-CAT-13: POST com id de marca apagada ou de outro tenant é 409 ID_EM_USO, sem gravar nem publicar evento', async () => {
    const { rota } = montar();
    memoria.estado(TENANT_A).dados.marcasIdsEmUso = new Set([M1]);
    const r = await chamar(rota('POST', 'marcas'), usuario('analista'), { corpo: { id: M1, nome: 'Freiomax' } });
    expect([r.status, r.codigo]).toEqual([409, 'ID_EM_USO']);
    expect(await lista(rota, 'todas')).toEqual([]);
    expect(eventos).toHaveLength(0);
    expect(auditoria).toHaveLength(0);
  });

  it('RN-CAT-13: nome repetido sem diferenciar caixa, acento ou espaços é 422; nome vazio ou com mais de 120 é recusado', async () => {
    const { rota } = montar();
    await chamar(rota('POST', 'marcas'), usuario('analista'), { corpo: { id: M1, nome: 'Pneu Máximo' } });
    const repetida = await chamar(rota('POST', 'marcas'), usuario('analista'), { corpo: { id: M2, nome: ' pneu maximo ' } });
    expect([repetida.status, repetida.codigo]).toEqual([422, 'RN-CAT-13']);
    expect((await chamar(rota('POST', 'marcas'), usuario('analista'), { corpo: { id: M2, nome: '   ' } })).status).toBe(400);
    expect((await chamar(rota('PUT', 'marcas/:id'), usuario('analista'), { params: { id: M1 }, corpo: { nome: 'x'.repeat(121) } })).status).toBe(400);
    expect(eventos).toHaveLength(1);
  });

  it('RN-CAT-13: renomear, inativar e reativar publicam o fato certo; a inativa some da lista padrão e volta em "inativas" e "todas"', async () => {
    const { rota } = montar();
    await chamar(rota('POST', 'marcas'), usuario('analista'), { corpo: { id: M1, nome: 'Freiomax' } });
    await chamar(rota('PUT', 'marcas/:id'), usuario('analista'), { params: { id: M1 }, corpo: { nome: 'Freio Max' } });
    await chamar(rota('PUT', 'marcas/:id'), usuario('analista'), { params: { id: M1 }, corpo: { ativo: false } });
    expect(await lista(rota)).toEqual([]);
    expect((await lista(rota, 'inativas')).map((m) => m.nome)).toEqual(['Freio Max']);
    expect(await lista(rota, 'todas')).toHaveLength(1);
    await chamar(rota('PUT', 'marcas/:id'), usuario('analista'), { params: { id: M1 }, corpo: { ativo: true } });
    expect(eventos.map((e) => e.payload.fato)).toEqual(['criada', 'alterada', 'inativada', 'reativada']);
    // nada mudou: não publica
    await chamar(rota('PUT', 'marcas/:id'), usuario('analista'), { params: { id: M1 }, corpo: { nome: 'Freio Max' } });
    expect(eventos).toHaveLength(4);
  });

  it('RN-CAT-13: a busca ignora caixa e acento; marca inexistente no PUT é 404', async () => {
    const { rota } = montar();
    await chamar(rota('POST', 'marcas'), usuario('analista'), { corpo: { id: M1, nome: 'Pneu Máximo' } });
    await chamar(rota('POST', 'marcas'), usuario('analista'), { corpo: { id: M2, nome: 'Rodaforte' } });
    expect((await lista(rota, undefined, 'MAXIMO')).map((m) => m.nome)).toEqual(['Pneu Máximo']);
    expect((await chamar(rota('PUT', 'marcas/:id'), usuario('analista'), { params: { id: idDemo('marca:x') }, corpo: { ativo: false } })).status).toBe(404);
  });

  it('RN-CAT-13: todos consultam a lista; só analista e admin escrevem (marca.gerenciar), e o módulo precisa estar ativo', async () => {
    const { rota } = montar();
    for (const p of ['vendedor', 'promotor', 'supervisor', 'gerente', 'assistente'] as const) {
      expect((await chamar(rota('GET', 'marcas'), usuario(p))).status).toBe(200);
      expect((await chamar(rota('POST', 'marcas'), usuario(p), { corpo: { id: M1, nome: 'X' } })).status).toBe(403);
      expect((await chamar(rota('PUT', 'marcas/:id'), usuario(p), { params: { id: M1 }, corpo: { ativo: false } })).status).toBe(403);
    }
    expect((await chamar(rota('POST', 'marcas'), usuario('admin'), { corpo: { id: M1, nome: 'X' } })).status).toBe(200);
    expect((await chamar(rota('POST', 'marcas'), usuario('analista', { modulos: ['core'] }), { corpo: { id: M2, nome: 'Y' } })).status).toBe(403);
  });

  it('RN-CAT-13 + RN-CAT-09: um tenant sem o Promotor cadastra a marca e grava a referência cruzada do produto', async () => {
    const { rota } = montar();
    const analista = usuario('analista', { modulos: ['core', 'catalogo'] });
    await chamar(rota('POST', 'marcas'), analista, { corpo: { id: M1, nome: 'Freiomax' } });
    const r = await chamar(rota('PUT', 'produtos/:id/cadastro-catalogo'), analista, {
      params: { id: PRODUTOS_DEMO[0]!.id },
      corpo: { aplicacao: null, oferece_junto: [], etiquetas: [], referencias: [{ marca_id: M1, codigo: 'FM-100' }] },
    });
    expect(r.status).toBe(200);
  });
});

describe('GET|PUT /v1/catalogo/parametros — limite da Aplicação (RN-CAT-11)', () => {
  it('RN-CAT-11: o GET devolve o limite do tenant, ou 2.000 sem o parâmetro', async () => {
    const { rota } = montar();
    expect((await chamar(rota('GET', 'parametros'), usuario('admin'))).corpo).toEqual({ aplicacao_max_cadastro: 2000 });
    expect((await chamar(rota('GET', 'parametros'), usuario('analista'), {}, { parametros: { aplicacao_max_cadastro: 300 } })).corpo).toEqual({ aplicacao_max_cadastro: 300 });
  });

  it('RN-CAT-04: só analista e admin leem e gravam o limite; os demais perfis levam 403 PERFIL_SEM_ACESSO', async () => {
    const { rota } = montar();
    for (const perfil of ['vendedor', 'promotor', 'supervisor', 'gerente', 'assistente'] as const) {
      expect(await chamar(rota('GET', 'parametros'), usuario(perfil)), perfil).toMatchObject({ status: 403, codigo: 'PERFIL_SEM_ACESSO' });
      expect(await chamar(rota('PUT', 'parametros'), usuario(perfil), { corpo: { aplicacao_max_cadastro: 500 } }), perfil).toMatchObject({ status: 403, codigo: 'PERFIL_SEM_ACESSO' });
    }
    expect((await chamar(rota('PUT', 'parametros'), usuario('analista'), { corpo: { aplicacao_max_cadastro: 500 } })).status).toBe(200);
  });

  it('RN-CORE-03: sem a licença do Catálogo, 403 MODULO_INATIVO', async () => {
    const { rota } = montar();
    expect(await chamar(rota('PUT', 'parametros'), usuario('admin', { modulos: ['core'] }), { corpo: { aplicacao_max_cadastro: 500 } })).toMatchObject({ status: 403, codigo: 'MODULO_INATIVO' });
  });

  it('RN-CAT-11: o PUT grava pelo SDK (auditado, idempotente) só a chave aplicacao_max_cadastro, no tenant do token', async () => {
    const { rota } = montar();
    const r = await chamar(rota('PUT', 'parametros'), usuario('admin'), { corpo: { aplicacao_max_cadastro: 800 } });
    expect(r).toMatchObject({ status: 200, corpo: { aplicacao_max_cadastro: 800 } });
    expect(parametrosGravados).toEqual([{ tenant: TENANT_A, valores: { aplicacao_max_cadastro: 800 }, acao: 'parametro.catalogo' }]);
  });

  it('RN-CAT-11: valor fora de 100 a 2.000, decimal ou campo a mais = 400 (nada é gravado)', async () => {
    const { rota } = montar();
    for (const corpo of [{ aplicacao_max_cadastro: 99 }, { aplicacao_max_cadastro: 2001 }, { aplicacao_max_cadastro: 100.5 }, { aplicacao_max_cadastro: '500' }, {}, { aplicacao_max_cadastro: 500, peso_estoque: 1 }]) {
      expect((await chamar(rota('PUT', 'parametros'), usuario('admin'), { corpo })).status, JSON.stringify(corpo)).toBe(400);
    }
    expect(parametrosGravados).toEqual([]);
  });
});
