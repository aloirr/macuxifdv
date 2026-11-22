/**
 * T-0193 critério 2 / RN-CAT-22: filtro de veículo com o mesmo resultado no aparelho e na API, sobre Postgres REAL.
 * Aparelho: o motor de sync real (pull de `createApp` como `macuxi_app`) e as consultas do Catálogo do app.
 * API: as mesmas consultas pelo registro da API (`transacaoTenant(...).consultar`, RLS do tenant), como o Vendedor chama.
 * As escolhas seguem modules/catalogo/api/veiculo-igualdade.test.ts (lá com banco falso).
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

const uuid = (n: number) => `0c193000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOMES = ['Amortecedor dianteiro', 'Amortecedor traseiro', 'Pastilha de freio', 'Disco de freio', 'Coxim do motor', 'Bucha da bandeja', 'Terminal de direção', 'Barra axial', 'Pivô da suspensão', 'Kit de embreagem', 'Correia dentada', 'Bomba de combustível', 'Filtro de ar', 'Vela de ignição', 'Junta do cabeçote', 'Fluido de freio'];
const APLICACOES = [
  ...Array(4).fill('VW Gol 2017–2019 1.0/1.6 Highline'),
  ...Array(3).fill('Volkswagen Gol 2018 1.0 Trendline'),
  'VW Gol',
  'Gol 2020>',
  ...Array(3).fill('Ford EcoSport 2012–2016 1.6'),
  ...Array(3).fill('Civic 07–11 · Fit 2003>'),
  null,
] as (string | null)[];
const LINHAS = NOMES.map((nome, i) => ({ id: uuid(i + 1), sku: `T193-${i + 1}`, nome, aplicacao: APLICACOES[i]! }));
/** Vendáveis ao cliente c1 de A (preço na tabela dele): Gol Highline (2), Civic (1) e o universal (1). */
const VENDAVEIS = [0, 1, 12, 15].map((i) => LINHAS[i]!.id);

const GOL_2018: VeiculoEscolhido = { montadora: 'Volkswagen', modelo: 'Gol', ano: 2018, motor: null, versao: null };
const ESCOLHAS: VeiculoEscolhido[] = [
  GOL_2018,
  { ...GOL_2018, motor: '1.0', versao: 'Highline' },
  { ...GOL_2018, motor: '1.6' },
  { ...GOL_2018, versao: 'Trendline' },
  { ...GOL_2018, ano: null },
  { ...GOL_2018, ano: 2020 },
  { montadora: null, modelo: 'Civic', ano: 2009, motor: null, versao: null },
  { montadora: 'Ford', modelo: 'EcoSport', ano: 2014, motor: '1.6', versao: null },
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
    for (const l of LINHAS) {
      // o que o Hub grava no Core e no Catálogo; produto_busca como na fixture (texto cru da aplicação)
      await q("insert into core.produto (id, tenant_id, sku, nome, marca, categoria, unidade, ativo) values ($1, $2, $3, $4, 'BAP', 'Linha', 'UN', true)", [l.id, A.tenantId, l.sku, l.nome]);
      await q('insert into catalogo.produto_conteudo (tenant_id, produto_id, aplicacoes) values ($1, $2, $3)', [A.tenantId, l.id, l.aplicacao]);
      await q("insert into catalogo.produto_busca (tenant_id, produto_id, sku, nome, marca, categoria, ativo, aplicacao) values ($1, $2, $3, $4, 'BAP', 'Linha', true, $5)", [A.tenantId, l.id, l.sku, l.nome, l.aplicacao]);
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

  it('D4: ano, motor e versão escolhidos restringem; não escolhidos, não (a peça sem ano só entra sem ano)', async () => {
    const semAno = LINHAS[7]!.id; // "VW Gol"
    const com = await ids(GOL_2018);
    expect(com).toHaveLength(7);
    expect(com).not.toContain(semAno);
    const sem = await ids({ ...GOL_2018, ano: null });
    expect(sem).toHaveLength(9);
    expect(sem).toContain(semAno);
    expect(await ids({ ...GOL_2018, motor: '1.6' })).toHaveLength(4);
    expect(await ids({ ...GOL_2018, versao: 'Trendline' })).toHaveLength(3);
    expect(await ids({ ...GOL_2018, motor: '1.0', versao: 'Highline' })).toHaveLength(4);
    expect(await ids(ESCOLHAS[6]!)).toHaveLength(3); // Civic 07–11, sem montadora
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

    it('só a peça universal no escopo: disponivel falso nos dois', async () => {
      expect((await iguais('A', 'veiculos', { produto_ids: [LINHAS[15]!.id] })).disponivel).toBe(false);
    });
  });

  it('multi-tenant: B não vê o Gol de A (cascata e lista iguais no aparelho e na API de B)', async () => {
    const r = await iguais('B', 'veiculos', { busca: 'gol' });
    expect(r.busca ?? []).toEqual([]);
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
