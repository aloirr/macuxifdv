/**
 * Rotas do Catálogo (T-0052) com o repositório em memória e dois tenants. `chamar` reproduz a ordem do `createApp`
 * (apps/api/src/app.ts): licença do módulo (403 MODULO_INATIVO) → ação do manifesto por perfil (403 PERFIL_SEM_ACESSO)
 * → entrada pelo Zod (400) → execução (erros de módulo com o status deles). O ponta a ponta com Fastify e Postgres é do
 * agente testes (pedido na entrega).
 */
import { criarRelogio } from '@macuxi/comum/relogio';
import { criarPermissoes, ErroHttpModulo, verificarAcao, verificarAcesso, type ContextoRota, type ModuloId, type Perfil, type RotaModulo } from '@macuxi/platform-sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FichaProduto, FiltrosCatalogo, ListaSinonimos, ListaTermosSemResultado, PaginaVitrine, RespostaBusca } from '../contracts';
import { AVISO_BUSCA_FALHOU, ErroTempoEsgotadoIa, type PortaInterpretacaoLlm } from '../domain/ia';
import { MENSAGEM_IA_DESLIGADA, MENSAGEM_LIMITE_ATINGIDO } from '../domain/limite-ia';
import { MENSAGEM_SEM_PRECO_CLIENTE } from '../domain/preco';
import { FILIAL_DEMO, idDemo, idProdutoDemo, ITENS_PRECO_DEMO, PRODUTOS_DEMO, saldosDemo, TABELA_ATACADO_DEMO, TABELA_VAREJO_DEMO } from '../fixtures/base-demo';
import { manifest } from '../manifest';
import { criarRepositorioMemoria, type DadosTenantMemoria } from './repositorio';
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
    carteira: async () => o.carteira ?? new Set([CLIENTE_VAREJO, CLIENTE_ATACADO]),
    usuariosVisiveis: async () => new Set([u.id]),
    comTenant: async (fn) =>
      fn({ query: async () => ({ rows: [], rowCount: 0 }) }, {
        publicar: async () => {
          throw new Error('o Catálogo não publica nesta fatia');
        },
        registrarArquivo: async () => ({ criado: false }),
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

  it('RN-CAT-05: o promotor acha o produto sem preço nem estoque, e "com estoque" não filtra para ele', async () => {
    const { rota } = montar();
    const r = await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('promotor'), { query: { q: 'açaí com estoque', customer_id: CLIENTE_VAREJO } });
    expect(skus(r.corpo.items)).toEqual(['ACA-1K']);
    expect(r.corpo.items[0]).toMatchObject({ price: null, availability: null, price_stock_visible: false });
    const vendedor = await chamar<RespostaBusca>(rota('GET', 'busca'), usuario('vendedor'), { query: { q: 'açaí com estoque', customer_id: CLIENTE_VAREJO } });
    expect(vendedor.corpo.items).toEqual([]);
  });

  it('RN-CAT-07: estoque das filiais do usuário, com a hora da atualização', async () => {
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
      consultar: async (_def: unknown, entrada: { produto_ids: string[] }) => {
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
