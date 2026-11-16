/**
 * Catálogo v2, v1.0.14 (#453, parte 1) — valor × regra do estoque ONLINE do promotor (RN-CAT-05 revista, RN-CORE-39, regra 7).
 * Rotas reais do Catálogo (`criarRotasCatalogo`) com o repositório em memória (sem Postgres), na ordem do `createApp`:
 * licença (403 MODULO_INATIVO) → ação do perfil → Zod → execução.
 *  EP-1 vendedor: "Estoque: N" de um produto com saldo = soma dos saldos das filiais dele (fixture: CD Manaus 80).
 *  EP-2 promotor: mesma busca, vitrine e ficha, mesmo cliente → SEM preço e com o MESMO N do vendedor (não 0).
 *       Era DEFEITO T-0052-B5 (`it.fails`); corrigido no #453 d64cc794 (`contextoVitrine` entrega os saldos a quem não vê preço).
 *  EP-3 Catálogo desligado para o promotor: 403 MODULO_INATIVO; outro tenant não enxerga o produto de A.
 *  EP-4 filtro de filial do promotor (RN-CORE-39): filial do tenant fora das de venda = 403 FILIAL_FORA_DAS_SUAS (era a carteira,
 *       T-0052-B5); a de venda e "todas" = 200 com o N 80, sem preço.
 *  EP-5 montador único (RD-1800): busca, vitrine e ficha devolvem o MESMO `availability` do café; o cartão (`tagDeEstoque`) e a
 *       ficha (`rotuloEstoque`) dão o mesmo texto nas três, e a ficha e a folha (`dadosDaFolha`) a mesma linha "Atualizado às …"
 *       pelo único `rotuloCargaEstoque`.
 *  EP-6 DEFEITO T-0052-B6 (`it.fails`): o app esconde do promotor o estoque que a API manda (tag e texto nulos).
 * Fixture: a filial padrão do tenant é a do CD Manaus (`FILIAL_DEMO`), onde estão os saldos da demo; sem isso o usuário (venda =
 * padrão) não tem saldo nenhum e vendedor e promotor dariam 0 iguais, sem provar nada.
 */
import { criarRelogio } from '@macuxi/comum/relogio';
import { ErroHttpModulo, verificarAcesso, type ContextoRota, type ModuloId, type Perfil, type RotaModulo } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import type { FichaProduto, ItemVitrine, PaginaVitrine, RespostaBusca } from '../../modules/catalogo/contracts';
import { dadosDaFolha } from '../../modules/catalogo/app/lib/estoque-folha';
import { rotuloEstoque } from '../../modules/catalogo/app/lib/apresentacao';
import { tagDeEstoque } from '../../modules/catalogo/app/lib/grade';
import { rotuloCargaEstoque } from '../../modules/catalogo/domain/estoque-campo';
import { FILIAL_DEMO, idDemo, ITENS_PRECO_DEMO, PRODUTOS_DEMO, saldosDemo, TABELA_VAREJO_DEMO } from '../../modules/catalogo/fixtures/base-demo';
import { criarRepositorioMemoria } from '../../modules/catalogo/api/repositorio';
import { criarRotasCatalogo } from '../../modules/catalogo/api/rotas';
import { ROTAS_CATALOGO } from '../../modules/catalogo/contracts';

const relogio = criarRelogio();
const TENANT_A = idDemo('tenant:A');
const TENANT_B = idDemo('tenant:B');
const CLIENTE = idDemo('cliente:varejo');
const CAFE = PRODUTOS_DEMO.find((p) => p.sku === 'CAF-500')!;
/** Filial do tenant A que não é de venda de ninguém na fixture (o padrão de venda do repositório em memória é a padrão do tenant). */
const FILIAL_OUTRA = idDemo('filial:boa-vista');

const memoria = () =>
  criarRepositorioMemoria({
    [TENANT_A]: {
      produtos: structuredClone([...PRODUTOS_DEMO]),
      itensPreco: [...ITENS_PRECO_DEMO],
      tabelaDoCliente: { [CLIENTE]: TABELA_VAREJO_DEMO },
      saldos: saldosDemo(relogio.relativo({ horas: -1 }).toISOString()),
      filiaisDaTela: { padraoId: FILIAL_DEMO, filiais: [{ id: FILIAL_DEMO, nome: 'CD Manaus', padrao: true }, { id: FILIAL_OUTRA, nome: 'Boa Vista', padrao: false }] },
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

  it('EP-2 (era DEFEITO T-0052-B5) promotor vê o MESMO N do vendedor (80) sem preço na busca, na vitrine e na ficha', async () => {
    const doVendedor = (await cafeNasTres('vendedor')).map((i) => i.availability?.quantity);
    expect(doVendedor, 'contraprova: o vendedor vê 80 nas três').toEqual([80, 80, 80]);
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

  it('EP-4 (era DEFEITO T-0052-B5) filtro do promotor: filial fora das de venda = 403 FILIAL_FORA_DAS_SUAS; a de venda e "todas" = 200, N 80, sem preço', async () => {
    const rota = rotas();
    const busca = (filial: string) => chamar<RespostaBusca>(rota('GET', ROTAS_CATALOGO.busca), usuario('promotor'), { query: { q: 'café', mode: 'basica', filial } });
    const fora = await busca(FILIAL_OUTRA);
    expect([fora.status, fora.codigo]).toEqual([403, 'FILIAL_FORA_DAS_SUAS']);
    for (const filtro of [FILIAL_DEMO, 'todas']) {
      const r = await busca(filtro);
      expect(r.status, `${filtro}: ${r.codigo}`).toBe(200);
      const cafe = r.corpo.items.find((i) => i.id === CAFE.id)!;
      expect(cafe, filtro).toMatchObject({ price: null, price_stock_visible: false });
      expect(cafe.availability?.quantity, filtro).toBe(80);
    }
  });

  it('EP-5 montador único (RD-1800), vendedor: mesmo availability, mesma tag do cartão, mesmo texto da ficha e mesma linha "Atualizado às …" da folha', async () => {
    const agora = relogio.agora().toISOString();
    const tres = await cafeNasTres('vendedor');
    expect(tres[1]!.availability, 'vitrine × busca').toEqual(tres[0]!.availability);
    expect(tres[2]!.availability, 'ficha × busca').toEqual(tres[0]!.availability);
    const tags = tres.map((i) => tagDeEstoque(i, { filialDoCliente: true }));
    expect(tags[0], 'cartão da busca: valor × regra (N 80)').toEqual({ texto: '80 em estoque', tom: 'sucesso' });
    expect(tags[1], 'cartão da vitrine × busca').toEqual(tags[0]);
    const textos = tres.map((i) => rotuloEstoque(i, agora, 'America/Manaus', { filialDoCliente: true }));
    expect(textos[0]).not.toBeNull();
    expect(textos[1], 'texto vitrine × busca').toEqual(textos[0]);
    expect(textos[2], 'texto ficha × busca').toEqual(textos[0]);
    // a ficha e a folha "Estoque por filial" montam a hora pelo MESMO rotuloCargaEstoque (o único depois do RD-1800)
    const a = tres[2]!.availability!;
    const esperado = rotuloCargaEstoque(a.updated_at, agora, 'America/Manaus');
    expect(textos[2]!.detalhe, 'ficha: hora do estoque').toBe(esperado);
    expect(dadosDaFolha({ availability: a, cargaEm: a.updated_at, filialCadastro: FILIAL_DEMO, agora, fuso: 'America/Manaus' }).apoio, 'folha: hora do estoque').toBe(esperado);
    expect(esperado).toMatch(/^Atualizado (às|ontem às) \d{2}:\d{2}$/);
  });

  // DEFEITO T-0052-B6 (modulo-catalogo): a API já manda o estoque ao promotor (EP-2), mas o app o esconde: `tagDeEstoque`
  // (app/lib/grade.ts, cartão da busca e da vitrine) e `rotuloEstoque` (app/lib/apresentacao.ts, ficha) devolvem null quando
  // `price_stock_visible` é falso — e para o promotor ele é falso por causa do PREÇO (RN-CAT-05 revista: vê o estoque, não o preço).
  it.fails('EP-6 DEFEITO T-0052-B6: no app o promotor vê no cartão e na ficha o MESMO estoque do vendedor (hoje some: tag e texto nulos)', async () => {
    const agora = relogio.agora().toISOString();
    const vend = await cafeNasTres('vendedor');
    const prom = await cafeNasTres('promotor');
    for (const k of [0, 1, 2]) {
      expect(tagDeEstoque(prom[k]!, { filialDoCliente: true }), `tag ${k}`).toEqual(tagDeEstoque(vend[k]!, { filialDoCliente: true }));
      expect(rotuloEstoque(prom[k]!, agora, 'America/Manaus', { filialDoCliente: true }), `ficha ${k}`).toEqual(rotuloEstoque(vend[k]!, agora, 'America/Manaus', { filialDoCliente: true }));
    }
  });
});
