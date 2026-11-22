/**
 * T-0193 critério 2 / RN-CAT-22: filtro de veículo com o mesmo resultado no aparelho e na API, sobre Postgres REAL.
 * Aparelho: o motor de sync real (pull de `createApp` como `macuxi_app`) e as consultas do Catálogo do app.
 * API: as mesmas consultas pelo registro da API (`transacaoTenant(...).consultar`, RLS do tenant), como o Vendedor chama.
 * Massa: modules/catalogo/fixtures/veiculo-massa.ts.
 */
import { CONSULTA_BUSCA_PRODUTOS, CONSULTA_VEICULOS, ENTIDADES_CONTEUDO, type VeiculoEscolhido } from '@macuxi/catalogo/contracts';
import { semBanco } from '@macuxi/db/teste/estado';
import type { ContextoConsultaAparelho, ModuloId, ValorCampoLinha } from '@macuxi/platform-sdk';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { criarBancoApp } from '../../../apps/api/src/banco';
import { registroDeConsultas, transacaoTenant } from '../../../apps/api/src/outbox';
import { esquecerMemoriaLocal } from '../../../modules/catalogo/app/lib/local';
import { consultaBuscaProdutosAparelho, esquecerMemoriaTextos } from '../../../modules/catalogo/app/texto-consultas';
import { consultaVeiculosAparelho, esquecerVeiculosRecentes } from '../../../modules/catalogo/app/veiculos-consulta';
import { A, B, subirApi, type ApiDeTeste, type Tenant } from '../apoio/api';
import { aparelhoCampo, esperarHorizonte, type AparelhoCampo } from '../apoio/campo';
import { ESCOLHAS, GOL_2018, LINHAS, VENDAVEIS, uuid } from '../../../modules/catalogo/fixtures/veiculo-massa';

/** Modelo com um ano só (2016): na cascata o ano se preenche sozinho e não filtra (R-20261121-211200). */
const ANO_UNICO = [
  { id: uuid(101), nome: 'Retentor de roda', aplicacao: 'Fiat Strada 2016 1.4' },
  { id: uuid(102), nome: 'Rolamento de roda', aplicacao: 'Fiat Strada 2016 1.8' },
  { id: uuid(103), nome: 'Tensor da correia', aplicacao: 'Fiat Strada' },
];

type Saida = Record<string, unknown> & { itens?: Array<Record<string, unknown> & { produto_id: string }>; recentes?: unknown };
const semAplicacao = (r: Saida) => (r.itens ?? []).map(({ aplicacao: _a, ...x }) => x);
const semRecentes = ({ recentes: _r, ...x }: Saida) => x;

describe.skipIf(semBanco())('T-0193 — filtro de veículo: aparelho × API sobre Postgres (RN-CAT-22)', () => {
  let api: ApiDeTeste;
  const ap = {} as Record<'A' | 'B', AparelhoCampo>;

  /** Contexto das consultas do app sobre as linhas que o motor puxou da API. */
  const ctxAparelho = (a: AparelhoCampo): ContextoConsultaAparelho => {
    const u = a.sessao.usuario;
    return {
      linhas: (e: string) => a.motor.linhas(e),
      linhasPorIds: (e: string, ids: readonly string[]) => a.motor.linhasPorIds(e, ids),
      linhasPorCampo: (e: string, c: string, v: readonly ValorCampoLinha[]) => a.motor.linhasPorCampo(e, c, v),
      versaoLinhas: (e: string) => a.motor.versaoLinhas(e),
      buscarComDesfecho: async () => ({ buscou: false, motivo: 'sem_busca' }),
      agora: () => new Date(),
      usuario: () => ({ id: u.id, nome: u.nome, perfil: u.perfil, fuso: a.sessao.tenant.fuso }),
      parametros: () => ({}),
    } as unknown as ContextoConsultaAparelho;
  };
  const noAparelho = async (t: 'A' | 'B', consulta: 'veiculos' | 'busca', entrada: object): Promise<Saida> => {
    const [def, impl] = consulta === 'veiculos' ? [CONSULTA_VEICULOS, consultaVeiculosAparelho] : [CONSULTA_BUSCA_PRODUTOS, consultaBuscaProdutosAparelho];
    const saida = await (impl as unknown as { executar(e: unknown, c: ContextoConsultaAparelho): Promise<unknown> }).executar(def.entrada.parse(entrada), ctxAparelho(ap[t]));
    return def.saida.parse(saida) as Saida;
  };
  const naApi = (tenant: Tenant, a: AparelhoCampo, consulta: 'veiculos' | 'busca', entrada: object): Promise<Saida> =>
    criarBancoApp(api.pool).comTenant(tenant.tenantId, async (db) => {
      const modulos: ModuloId[] = ['core', 'catalogo', 'vendedor'];
      const tx = transacaoTenant(db, {
        manifestos: api.modulos.map((m) => m.manifesto),
        modulo: 'vendedor',
        tenantId: tenant.tenantId,
        usuarioId: a.sessao.usuario.id,
        requestId: randomUUID(),
        agora: () => new Date(),
        usuario: { id: a.sessao.usuario.id, tenant_id: tenant.tenantId, perfil: 'vendedor', modulos },
        consultas: registroDeConsultas(api.modulos),
        parametros: () => ({}),
        fuso: () => tenant.fuso,
      });
      const def = consulta === 'veiculos' ? CONSULTA_VEICULOS : CONSULTA_BUSCA_PRODUTOS;
      return (await tx.consultar(def as typeof CONSULTA_VEICULOS, entrada as never)) as unknown as Saida;
    });
  const iguais = async (t: 'A' | 'B', consulta: 'veiculos' | 'busca', entrada: object) => {
    const a = await noAparelho(t, consulta, entrada);
    const b = await naApi(t === 'A' ? A : B, ap[t], consulta, entrada);
    if (consulta === 'busca') expect(semAplicacao(a), JSON.stringify(entrada)).toEqual(semAplicacao(b));
    else {
      expect(semRecentes(a), JSON.stringify(entrada)).toEqual(semRecentes(b));
      expect(b.recentes).toEqual([]);
    }
    return a;
  };
  const ids = async (veiculo: VeiculoEscolhido) => ((await iguais('A', 'busca', { q: '', veiculo, limite: 100 })).itens ?? []).map((i) => i.produto_id);

  beforeAll(async () => {
    api = await subirApi();
    const q = (sql: string, p: unknown[]) => api.admin.query(sql, p);
    for (const [i, l] of [...LINHAS, ...ANO_UNICO].entries()) {
      const sku = `T193-${i + 1}`;
      // o que o Hub grava no Core e no Catálogo; produto_busca como na fixture (texto cru da aplicação)
      await q("insert into core.produto (id, tenant_id, sku, nome, marca, categoria, unidade, ativo) values ($1, $2, $3, $4, 'BAP', 'Linha', 'UN', true)", [l.id, A.tenantId, sku, l.nome]);
      await q('insert into catalogo.produto_conteudo (tenant_id, produto_id, aplicacoes) values ($1, $2, $3)', [A.tenantId, l.id, l.aplicacao]);
      await q("insert into catalogo.produto_busca (tenant_id, produto_id, sku, nome, marca, categoria, ativo, aplicacao) values ($1, $2, $3, $4, 'BAP', 'Linha', true, $5)", [A.tenantId, l.id, sku, l.nome, l.aplicacao]);
    }
    for (const p of VENDAVEIS)
      await q("insert into catalogo.tabela_preco_item (tenant_id, tabela_preco_id, produto_id, preco_cents, vigencia_inicio) values ($1, $2, $3, 1000, now() - interval '1 day')", [A.tenantId, A.tabelasPreco.padrao, p]);
    await esperarHorizonte();
    ap.A = await aparelhoCampo(api, 'vendedor@exemplo.com.br', { entidadesExtras: [...ENTIDADES_CONTEUDO] });
    ap.B = await aparelhoCampo(api, 'vendedor@exemplo.com.br', { tenant: B, entidadesExtras: [...ENTIDADES_CONTEUDO] });
    for (const a of [ap.A, ap.B]) expect(await a.sincronizar(), a.motor.estado().erro ?? '').toBe(true);
  }, 300_000);

  afterAll(async () => {
    await api?.fechar();
  });

  beforeEach(() => {
    esquecerMemoriaLocal();
    esquecerMemoriaTextos();
    esquecerVeiculosRecentes();
  });

  it.each(ESCOLHAS.map((v, i) => [i, v] as const))('busca_produtos sem texto, escolha #%i: mesmos itens e mesma ordem', async (_i, veiculo) => {
    await iguais('A', 'busca', { q: '', veiculo, limite: 100 });
  });

  it.each(['amortecedor', 'freio', 'gol'])('busca_produtos com texto "%s" e Gol 2018: mesmos itens', async (q) => {
    await iguais('A', 'busca', { q, veiculo: GOL_2018, limite: 100 });
  });

  it.each([
    [{}],
    [{ escolha: { montadora: 'Volkswagen' } }],
    [{ escolha: { montadora: 'Volkswagen', modelo: 'Gol', ano: 2018 } }],
    [{ escolha: { montadora: 'Volkswagen', modelo: 'Gol', ano: 2018, motor: '1.0' } }],
    [{ busca: 'gol' }],
    [{ busca: 'xyz' }],
  ])('veiculos@1 %j: a mesma cascata', async (entrada) => {
    expect((await iguais('A', 'veiculos', entrada)).disponivel).toBe(true);
  });

  it('modelo com um ano só: o ano automático fica na trilha e não filtra; a lista do modelo é a mesma no aparelho e na API', async () => {
    const r = await iguais('A', 'veiculos', { escolha: { montadora: 'Fiat', modelo: 'Strada' } });
    expect((r.trilha as { nivel: string; valor: string; automatico: boolean }[]).find((p) => p.nivel === 'ano')).toMatchObject({ valor: '2016', automatico: true });
    expect(r).toMatchObject({ nivel: 'motor', escolha: { ano: null } });
    const strada: VeiculoEscolhido = { montadora: 'Fiat', modelo: 'Strada', ano: null, motor: null, versao: null };
    expect((await ids(strada)).sort()).toEqual(ANO_UNICO.map((l) => l.id));
    expect((await ids({ ...strada, ano: 2016 })).sort()).toEqual(ANO_UNICO.slice(0, 2).map((l) => l.id));
  });

  describe('escopo do cliente (RN-CAT-06)', () => {
    const POR_CLIENTE = { cliente_id: A.clientes.c1 };
    const POR_IDS = { produto_ids: [LINHAS[9]!.id, LINHAS[10]!.id, LINHAS[12]!.id] };

    it.each([
      [POR_CLIENTE, {}],
      [POR_CLIENTE, { escolha: { montadora: 'Volkswagen', modelo: 'Gol', ano: 2018 } }],
      [POR_CLIENTE, { busca: 'ecosport' }],
      [POR_IDS, {}],
      [POR_IDS, { busca: 'civic' }],
    ])('veiculos@1 com escopo %j e %j: a mesma cascata', async (escopo, resto) => {
      await iguais('A', 'veiculos', { ...resto, ...escopo });
    });

    it('com o cliente, só o vendável: o Ford some e o Gol Highline fica (aparelho = API)', async () => {
      const r = await iguais('A', 'veiculos', POR_CLIENTE);
      expect((r.trilha as { nivel: string; valor: string }[]).map((p) => [p.nivel, p.valor])).toEqual([
        ['montadora', 'Volkswagen'],
        ['modelo', 'Gol'],
      ]);
      expect((await iguais('A', 'veiculos', { ...POR_CLIENTE, busca: 'ecosport' })).busca).toEqual([]);
    });

    it('só a peça universal no escopo: disponivel falso nos dois (com uma peça do Gol junto, verdadeiro)', async () => {
      expect((await iguais('A', 'veiculos', { produto_ids: [LINHAS[15]!.id] })).disponivel).toBe(false);
      expect((await iguais('A', 'veiculos', { produto_ids: [LINHAS[15]!.id, LINHAS[0]!.id] })).disponivel).toBe(true);
    });
  });

  it('multi-tenant: B não vê o Gol de A (cascata e lista iguais no aparelho e na API de B)', async () => {
    expect((await iguais('A', 'veiculos', { busca: 'gol' })).busca).not.toEqual([]);
    expect(await iguais('B', 'veiculos', { busca: 'gol' })).toMatchObject({ disponivel: false, busca: null });
    expect((await iguais('B', 'busca', { q: '', veiculo: GOL_2018, limite: 100 })).itens).toEqual([]);
  });
  // DEFEITO (modulo-catalogo): nenhum código grava catalogo.produto_busca, que é o que a API lê (modules/catalogo/api/consultas-texto.ts,
  // indiceDaBase e consultaBuscaProdutos); o produto que chega pelo Hub (core.produto + produto_conteudo) aparece no aparelho e não na API.
  // Corrigido, este caso passa e vira `it`.
  it.fails('produto do Hub sem linha em produto_busca: aparelho e API dão o mesmo resultado', async () => {
    const id = uuid(99);
    await api.admin.query("insert into core.produto (id, tenant_id, sku, nome, marca, categoria, unidade, ativo) values ($1, $2, 'T193-99', 'Coxim do câmbio', 'BAP', 'Linha', 'UN', true)", [id, A.tenantId]);
    await api.admin.query('insert into catalogo.produto_conteudo (tenant_id, produto_id, aplicacoes) values ($1, $2, $3)', [A.tenantId, id, 'VW Gol 2018 1.0']);
    await esperarHorizonte();
    expect(await ap.A.sincronizar()).toBe(true);
    expect(await ids(GOL_2018)).toContain(id);
  });
});
