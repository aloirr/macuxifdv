/**
 * Defeito do APK v1.0.32 (AM2808; recado R-20261124-110450): em Campo → Novo pedido → aba Itens, com o mesmo texto na busca,
 * a lista alternava sozinha entre os produtos e "Nenhum produto com …" a cada sincronização, por nome e por código.
 * Garante (RN-VEN-02): a cada sync nenhum render da lista fica vazio (0/N); quando o sync muda preço ou traz produto, a tabela
 * do cliente é recalculada e trocada de uma vez, e o preço novo e o produto novo aparecem.
 */
import { CONSULTA_BUSCA_PRODUTOS, CONSULTA_PRECOS_CLIENTE, type Product } from '@macuxi/catalogo/contracts';
import type { CustomerSummary, ProdutoSync } from '@macuxi/core/contracts';
import type { AmbienteModulo, ArmazenamentoSync, EstadoMotorSync, MotorSync } from '@macuxi/platform-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { codigoExatoPrimeiro, resolverBusca } from '../../modules/vendedor/domain/busca-seletor';
import { searchProducts } from '../../modules/vendedor/app/lib/catalog';
import { useVendedor } from '../../modules/vendedor/app/state/use-vendedor';
import { estabilizar, hooks, montar } from './apoio/mini-hooks';

vi.mock('react', async (original) => ({ ...(await original<object>()), ...(await import('./apoio/mini-hooks')).hooks }));

// ---------- aparelho falso: motor, armazenamento do módulo e consultas do Catálogo ----------
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const produto = (n: number, sku: string, nome: string): ProdutoSync => ({
  id: ID(n),
  updated_at: '2026-11-20T12:00:00.000Z',
  deleted_at: null,
  external_id: sku,
  sku,
  ean: null,
  nome,
  marca: 'AM',
  categoria: 'Vestuário',
  unidade: 'UN',
  ativo: true,
});
const PRODUTOS: readonly ProdutoSync[] = [
  produto(1, 'BL001', 'Blusa manga curta azul'),
  produto(2, 'BL002', 'Blusa regata branca'),
  produto(3, 'BL003', 'Blusão moletom cinza'),
  produto(4, 'CA001', 'Calça jeans reta'),
  produto(5, 'SA001', 'Saia midi preta'),
];
const PRECO_INICIAL = 4990;
/** linhas de produto e preços do aparelho; um caso troca as duas antes de um sync */
let produtosNoAparelho: ProdutoSync[] = [...PRODUTOS];
let precoPorProduto = new Map<string, number>();
const CLIENTE_ID = ID(900);
/** linha `cliente` do Core no aparelho (só os campos que `clienteResumo` lê); sem `cliente_tabela_preco` = tabela `default` */
const CLIENTE_SYNC = { id: CLIENTE_ID, updated_at: '2026-11-20T12:00:00.000Z', deleted_at: null, external_id: 'C900', razao_social: 'Loja AM Ltda', nome_fantasia: 'Loja AM', documento: null, ativo: true };

const guardado = new Map<string, unknown>();
const armazenamento: ArmazenamentoSync = {
  ler: async <T,>(k: string) => (guardado.has(k) ? (structuredClone(guardado.get(k)) as T) : null),
  gravar: async (k, v) => {
    if (v == null) guardado.delete(k);
    else guardado.set(k, structuredClone(v));
  },
  remover: async (k) => {
    guardado.delete(k);
  },
  chaves: async (p) => [...guardado.keys()].filter((k) => k.startsWith(p)).sort(),
};

let estado = {
  sincronizado_em: '2026-11-24T14:00:00.000Z',
  sincronizando: false,
  fila: [],
  aceitos: [],
  erro: null,
  avisos: [],
  arquivos: [],
  pendentes: [],
} as unknown as EstadoMotorSync;
const motor = {
  armazenamentoDoModulo: () => armazenamento,
  linhas: async (e: string) => (e === 'produto' ? structuredClone(produtosNoAparelho) : e === 'cliente' ? [structuredClone(CLIENTE_SYNC)] : []),
  estado: () => estado,
  enviar: async () => [],
  sincronizar: async () => true,
} as unknown as MotorSync;

const PARAMETROS = Object.freeze({});
const USUARIO = Object.freeze({ id: ID(800), nome: 'Vendedora', perfil: 'vendedor', fuso: 'America/Manaus' });
/** O Catálogo do aparelho: mesmo resultado em toda consulta (prefixo no nome ou no código), como o FTS acharia. */
const consultar = (async (def: { nome: string }, entrada: Record<string, unknown>) => {
  if (def.nome === CONSULTA_PRECOS_CLIENTE.nome) {
    return { itens: (entrada.produto_ids as string[]).map((id) => ({ produto_id: id, preco_cents: precoPorProduto.get(id) ?? PRECO_INICIAL })) };
  }
  if (def.nome === CONSULTA_BUSCA_PRODUTOS.nome) {
    const q = String(entrada.q).toLowerCase();
    const itens = produtosNoAparelho.filter((p) => p.nome.toLowerCase().split(' ').some((t) => t.startsWith(q)) || p.sku.toLowerCase().startsWith(q)).map((p) => ({
      produto_id: p.id,
      nota: 1,
      so_aplicacao: false,
      serve_em: null,
      equivale_a: null,
    }));
    return { itens, total: itens.length, sugestao: null };
  }
  throw new Error(`consulta inesperada no teste: ${def.nome}`);
}) as unknown as AmbienteModulo['consultar'];
const ambiente = {
  usuario: () => USUARIO,
  parametros: () => PARAMETROS,
  consultar,
  online: () => false,
  novoId: () => ID(999),
  http: { requisitar: async () => ({}), get: async () => ({}) },
} as unknown as AmbienteModulo;

vi.mock('@macuxi/platform-sdk/react', () => ({
  useMotorSync: () => ({ motor, estado }),
  useAmbiente: () => ambiente,
}));

afterEach(() => {
  guardado.clear();
  produtosNoAparelho = [...PRODUTOS];
  precoPorProduto = new Map();
});

/**
 * A lista da aba Itens como new-order-screen.tsx monta, sobre o hook REAL `useVendedor` (mini-hooks, sem DOM): catalogBase →
 * byId/idsDoCatalogo → efeito do ensureProducts → busca do Catálogo com guarda `vivo` → resolverBusca, ou a busca local
 * (sem o debounce de 250 ms). Devolve, por render, os códigos da lista, o tamanho da tabela e o preço de cada código.
 */
function telaDaBusca(q: string) {
  const app = useVendedor();
  // como a tela: o cliente vem de `dados.clientes` (linhas do aparelho) e a tabela é a do `price_table_id` dele
  const customer: CustomerSummary | null = app.dados.clientes.find((c) => c.id === CLIENTE_ID) ?? null;
  const tableKey = customer?.price_table_id ?? 'default';
  const catalogBase = hooks.useMemo(() => app.dados.produtos[tableKey]?.items ?? [], [app.dados.produtos, tableKey]);
  const byId = hooks.useMemo(() => new Map<string, Product>(catalogBase.map((p) => [p.id, p])), [catalogBase]);
  const idsDoCatalogo = hooks.useMemo(() => (catalogBase.length <= 5000 ? catalogBase.map((p) => p.id) : null), [catalogBase]);
  const [buscaCatalogo, setBuscaCatalogo] = hooks.useState<{ q: string; itens: Array<{ produto_id: string; serve_em: null }> } | null>(null);
  const ensureProducts = app.garantirProdutos;
  // igual ao efeito da tela: vazia calcula; com sync novo recalcula por trás e troca a tabela de uma vez
  hooks.useEffect(() => {
    if (customer) void ensureProducts(customer);
  }, [customer, catalogBase.length === 0, app.sincronizadoEm, ensureProducts]);
  const buscar = app.buscarProdutos;
  hooks.useEffect(() => {
    let vivo = true;
    void buscar(q, idsDoCatalogo, CLIENTE_ID, null).then((r) => {
      if (!vivo) return;
      setBuscaCatalogo(r.tipo === 'ok' ? { q, itens: r.itens.map((i) => ({ produto_id: i.produto_id, serve_em: null })) } : null);
    });
    return () => {
      vivo = false;
    };
  }, [q, idsDoCatalogo, buscar]);
  const resultados = buscaCatalogo && buscaCatalogo.q === q ? resolverBusca(buscaCatalogo.itens, byId, 400).map((r) => r.produto) : searchProducts(catalogBase, q, 400);
  const lista = codigoExatoPrimeiro(resultados, q);
  return { tabela: catalogBase.length, lista: lista.map((p) => p.erp_code), precos: Object.fromEntries(lista.map((p) => [p.erp_code, p.price_cents])) };
}

async function sincronizar(quando: string) {
  estado = { ...estado, sincronizado_em: quando };
  tela?.renderizar();
  await estabilizar();
}

let tela: ReturnType<typeof montar<ReturnType<typeof telaDaBusca>>> | null = null;

describe('v1.0.32 — busca do Novo pedido pisca sozinha (R-20261124-110450)', () => {
  it.each([
    ['por nome', 'blu', ['BL001', 'BL002', 'BL003']],
    ['por nome', 'blusa', ['BL001', 'BL002']],
    ['por código', 'bl0', ['BL001', 'BL002', 'BL003']],
  ])('%s ("%s"): a lista não some nem volta a cada sincronização sem mudança no catálogo', async (_modo, q, esperada) => {
    tela = montar(() => telaDaBusca(q));
    await estabilizar();
    // controle: a tela carregou a tabela do cliente e a busca acha os produtos
    expect(tela.ultimo().tabela).toBe(PRODUTOS.length);
    expect([...tela.ultimo().lista].sort()).toEqual(esperada);
    const desde = tela.historico.length;

    // três sincronizações seguidas (segundo plano), sem nenhuma linha de produto nova e sem digitar nada
    await sincronizar('2026-11-24T14:15:00.000Z');
    await sincronizar('2026-11-24T14:30:00.000Z');
    await sincronizar('2026-11-24T14:45:00.000Z');

    const depois = tela.historico.slice(desde);
    tela.desmontar();
    tela = null;
    // o que o vendedor vê em cada render depois das sincronizações: "itens da lista / itens da tabela do cliente";
    // o defeito dava, a cada sync, 3/5 → 0/0 ("Nenhum produto com …") → 3/5 de novo
    const vistas = depois.map((r) => `${r.lista.length}/${r.tabela}`);
    expect(vistas, 'lista da busca / tabela do cliente em cada render depois de cada sync').toEqual(vistas.map(() => `${esperada.length}/${PRODUTOS.length}`));
  });

  it('sync que muda o preço e traz produto novo: a tabela é recalculada, o preço novo e o produto novo aparecem, e a lista nunca fica vazia', async () => {
    const q = 'blu';
    tela = montar(() => telaDaBusca(q));
    await estabilizar();
    expect(tela.ultimo().lista.length).toBe(3);
    expect(tela.ultimo().precos['BL001']).toBe(PRECO_INICIAL);
    const desde = tela.historico.length;

    // o pull trouxe: preço novo da BL001 na tabela do cliente e um produto novo que casa com "blu"
    precoPorProduto = new Map([[ID(1), 5990]]);
    produtosNoAparelho = [...PRODUTOS, produto(6, 'BL004', 'Blusa gola polo verde')];
    await sincronizar('2026-11-24T15:00:00.000Z');

    const depois = tela.historico.slice(desde);
    const fim = tela.ultimo();
    tela.desmontar();
    tela = null;
    // antes do recálculo vale a tabela antiga (3/5); depois, a nova (4/6). Nunca 0/N nem lista vazia.
    const vistas = depois.map((r) => `${r.lista.length}/${r.tabela}`);
    expect(vistas.filter((v) => v !== '3/5' && v !== '4/6'), 'render fora de "antiga 3/5" ou "nova 4/6"').toEqual([]);
    expect(fim.tabela).toBe(PRODUTOS.length + 1);
    expect(fim.precos).toEqual({ BL001: 5990, BL002: PRECO_INICIAL, BL003: PRECO_INICIAL, BL004: PRECO_INICIAL });
  });
});
