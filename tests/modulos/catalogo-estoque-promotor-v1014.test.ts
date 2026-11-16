/**
 * Catálogo v2, v1.0.14 (#453, parte 1) — valor × regra do estoque ONLINE do promotor (RN-CAT-05 revista, RN-CORE-39, regra 7).
 * Rotas reais do Catálogo (`criarRotasCatalogo`) com o repositório em memória (sem Postgres), na ordem do `createApp`:
 * licença (403 MODULO_INATIVO) → ação do perfil → Zod → execução.
 *  EP-1 vendedor: "Estoque: N" de um produto com saldo = soma dos saldos das filiais dele (fixture: CD Manaus 80).
 *  EP-2 promotor: mesma busca, vitrine e ficha, mesmo cliente → SEM preço e com o MESMO N do vendedor (não 0).
 *       DEFEITO T-0052-B5 (`it.fails`): `contextoVitrine` (modules/catalogo/api/rotas.ts) ainda zera saldos e filiais para quem
 *       não vê preço, e o #453 deixou o `availability` passar → o promotor vê "Estoque: 0" onde o vendedor vê 80. O teste do
 *       módulo (rotas.test.ts) usa ACA-1K, que tem saldo 0, e não pega. Vira `it` quando a parte 2 ligar o estoque ao promotor.
 *  EP-3 Catálogo desligado para o promotor: 403 MODULO_INATIVO; outro tenant não enxerga o produto de A.
 */
import { criarRelogio } from '@macuxi/comum/relogio';
import { ErroHttpModulo, verificarAcesso, type ContextoRota, type ModuloId, type Perfil, type RotaModulo } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import type { FichaProduto, ItemVitrine, PaginaVitrine, RespostaBusca } from '../../modules/catalogo/contracts';
import { idDemo, ITENS_PRECO_DEMO, PRODUTOS_DEMO, saldosDemo, TABELA_VAREJO_DEMO } from '../../modules/catalogo/fixtures/base-demo';
import { criarRepositorioMemoria } from '../../modules/catalogo/api/repositorio';
import { criarRotasCatalogo } from '../../modules/catalogo/api/rotas';
import { ROTAS_CATALOGO } from '../../modules/catalogo/contracts';

const relogio = criarRelogio();
const TENANT_A = idDemo('tenant:A');
const TENANT_B = idDemo('tenant:B');
const CLIENTE = idDemo('cliente:varejo');
const CAFE = PRODUTOS_DEMO.find((p) => p.sku === 'CAF-500')!;

const memoria = () =>
  criarRepositorioMemoria({
    [TENANT_A]: {
      produtos: structuredClone([...PRODUTOS_DEMO]),
      itensPreco: [...ITENS_PRECO_DEMO],
      tabelaDoCliente: { [CLIENTE]: TABELA_VAREJO_DEMO },
      saldos: saldosDemo(relogio.relativo({ horas: -1 }).toISOString()),
    },
    [TENANT_B]: { produtos: [] },
  });

interface Usuario { id: string; tenant_id: string; perfil: Perfil; modulos: ModuloId[] }
const usuario = (perfil: Perfil, o: Partial<Usuario> = {}): Usuario => ({ id: idDemo(`usuario:${perfil}`), tenant_id: TENANT_A, perfil, modulos: ['core', 'catalogo'], ...o });

async function chamar<T>(rota: RotaModulo, u: Usuario, e: { query?: unknown; params?: unknown }): Promise<{ status: number; codigo?: string; corpo: T }> {
  const lic = verificarAcesso(u, { modulo: 'catalogo', perfis: [u.perfil] });
  if (!lic.ok) return { status: lic.status, codigo: lic.codigo, corpo: undefined as T };
  const q = rota.query ? rota.query.parse(e.query ?? {}) : {};
  const p = rota.params ? rota.params.parse(e.params ?? {}) : {};
  const ctx: ContextoRota = {
    usuario: u,
    dependencias: {},
    requestId: 'req-teste',
    agora: () => relogio.agora(),
    fuso: () => 'America/Manaus',
    parametros: () => ({}),
    carteira: async () => new Set([CLIENTE]),
    usuariosVisiveis: async () => new Set([u.id]),
    comTenant: async (fn) =>
      fn({ query: async () => ({ rows: [], rowCount: 0 }) }, {
        publicar: async () => ({}) as never,
        registrarArquivo: async () => ({ criado: true }),
        consultar: async () => {
          throw new Error('consulta não usada pelo repositório em memória');
        },
        auditar: async () => undefined,
      }),
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    corpo: {},
    query: q,
    params: p,
  };
  try {
    return { status: rota.status ?? 200, corpo: (await rota.executar(ctx as never)) as T };
  } catch (erro) {
    if (erro instanceof ErroHttpModulo) return { status: erro.status, codigo: erro.codigo, corpo: undefined as T };
    throw erro;
  }
}

function rotas() {
  const todas = criarRotasCatalogo({ repositorio: memoria().fabrica });
  return (metodo: string, caminho: string) => todas.find((r) => r.metodo === metodo && r.caminho === caminho)!;
}

/** Busca, vitrine e ficha do café, para o perfil, com o cliente da carteira. */
async function cafeNasTres(perfil: Perfil): Promise<ItemVitrine[]> {
  const rota = rotas();
  const b = await chamar<RespostaBusca>(rota('GET', ROTAS_CATALOGO.busca), usuario(perfil), { query: { q: 'café', customer_id: CLIENTE, mode: 'basica' } });
  const v = await chamar<PaginaVitrine>(rota('GET', ROTAS_CATALOGO.produtos), usuario(perfil), { query: { customer_id: CLIENTE, limit: 50 } });
  const f = await chamar<FichaProduto>(rota('GET', ROTAS_CATALOGO.produto), usuario(perfil), { params: { id: CAFE.id }, query: { customer_id: CLIENTE } });
  for (const r of [b, v, f]) expect(r.status, `${perfil}: ${r.codigo}`).toBe(200);
  return [b.corpo.items.find((i) => i.id === CAFE.id)!, v.corpo.items.find((i) => i.id === CAFE.id)!, f.corpo.product];
}

describe('Catálogo v2 (#453) — estoque online do promotor = o do vendedor, sem preço (RN-CAT-05 revista, RN-CORE-39)', () => {
  it('EP-1 vendedor: N do café = soma das filiais dele (CD Manaus 80) na busca, na vitrine e na ficha, com preço', async () => {
    const esperado = saldosDemo(relogio.agora().toISOString()).get(CAFE.id)!.reduce((s, x) => s + x.quantity, 0);
    expect(esperado).toBe(80);
    for (const i of await cafeNasTres('vendedor')) {
      expect(i.price_stock_visible).toBe(true);
      expect(i.price).not.toBeNull();
      expect(i.availability?.quantity).toBe(esperado);
    }
  });

  it.fails('EP-2 DEFEITO T-0052-B5: promotor vê o MESMO N do vendedor (80) sem preço — hoje recebe 0 (rotas.ts, contextoVitrine)', async () => {
    const doVendedor = (await cafeNasTres('vendedor')).map((i) => i.availability?.quantity);
    const doPromotor = await cafeNasTres('promotor');
    for (const i of doPromotor) expect(i).toMatchObject({ price: null, price_stock_visible: false });
    expect(doPromotor.map((i) => i.availability?.quantity)).toEqual(doVendedor);
  });

  it('EP-3 Catálogo desligado para o promotor = 403 MODULO_INATIVO; tenant B não acha o café de A', async () => {
    const rota = rotas();
    const off = await chamar(rota('GET', ROTAS_CATALOGO.busca), usuario('promotor', { modulos: ['core'] }), { query: { q: 'café' } });
    expect([off.status, off.codigo]).toEqual([403, 'MODULO_INATIVO']);
    const deB = await chamar<RespostaBusca>(rota('GET', ROTAS_CATALOGO.busca), usuario('promotor', { tenant_id: TENANT_B }), { query: { q: 'café', mode: 'basica' } });
    expect(deB.status).toBe(200);
    expect(deB.corpo.items.map((i) => i.id)).not.toContain(CAFE.id);
  });
});
