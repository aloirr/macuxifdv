/**
 * T-0017 × Postgres real (fixture dois-tenants, papel macuxi_app, RLS): vazamento por escopo de carteira (RN-CORE-04),
 * isolamento entre tenants (RN-CORE-05), Cliente 360, carteira (PUT/DELETE com auditoria), hierarquia e bloqueio de
 * aparelho por tenant (RN-CORE-15). Pula sem Docker/Postgres (aviso no fim); com MACUXI_PG_EXIGIR=1 (CI) falha.
 * O escopo é calculado pelos serviços REAIS (`carteiraDoUsuario`, `usuariosVisiveisDoUsuario`), não por conjuntos fabricados.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { ErroNaoEncontrado, ErroRegraNegocio, type AcessoBanco, type ClienteBanco, type ContextoBase, type LinhaSync, type PedidoPull, type RotaModulo, type UsuarioAutenticado } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Cliente360Schema, HierarquiaEquipeSchema, TituloSyncSchema, ClienteFinanceiroSyncSchema, ClienteContatoSyncSchema, HistoricoCompraSyncSchema, CarteiraSyncSchema } from '../contracts';
import { criarAutenticacao } from './autenticacao';
import { assinarAcesso } from './seguranca';
import { fabricaSql } from './repositorio';
import { carteiraDoUsuario } from './carteira';
import { rotasDeClientes } from './clientes';
import { rotasDeDispositivos } from './dispositivos';
import { provedoresSyncCore } from './sync';
import { usuariosVisiveisDoUsuario } from './usuarios-visiveis';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const U = A.usuarios;
const C = A.clientes;

const TITULO_ANTIGO = '0e200000-0000-4000-8000-000000000001'; // liquidado, vencido há 100 dias: fora da janela
const TITULO_ANTIGO_REMOVIDO = '0e200000-0000-4000-8000-000000000002'; // idem, mas removido: passa (o aparelho apaga)
const HISTORICO_ANTIGO = '0e200000-0000-4000-8000-000000000003'; // 14 meses atrás: fora da janela
const CARTEIRA_ENCERRADA = '0e200000-0000-4000-8000-000000000004'; // encerrada há 60 dias: fora da janela

describe.skipIf(semBanco())('Core T-0017 × Postgres: escopo da carteira, Cliente 360, carteira, hierarquia e aparelho', () => {
  let pool: pg.Pool;
  let acesso: AcessoBanco;

  const usuario = (id: string, perfil: UsuarioAutenticado['perfil'], tenant = A.tenantId): UsuarioAutenticado => ({ id, tenant_id: tenant, perfil });
  const vendedor1 = usuario(U.vendedor1, 'vendedor');
  const vendedor2 = usuario(U.vendedor2, 'vendedor');
  const promotor = usuario(U.promotor, 'promotor');
  const supervisor = usuario(U.supervisor, 'supervisor');
  const gerente = usuario(U.gerente, 'gerente');
  const analista = usuario(U.analista, 'analista');
  const admin = usuario(U.admin, 'admin');
  const vendedorB = usuario(B.usuarios.vendedor, 'vendedor', B.tenantId);

  /** Contexto de provedor/rota com banco real e o escopo calculado pelos serviços do Core. */
  function ctx(u: UsuarioAutenticado): ContextoBase {
    return {
      usuario: u,
      requestId: 'req-teste',
      agora: () => new Date(),
      fuso: () => 'America/Manaus',
      comTenant: (fn: (db: pg.ClientBase, tx: unknown) => Promise<unknown>) => comTenant(pool, u.tenant_id, (c) => fn(c, { publicar: async () => ({}) })),
      carteira: () => carteiraDoUsuario(u, acesso),
      usuariosVisiveis: () => usuariosVisiveisDoUsuario(u, acesso),
    } as unknown as ContextoBase;
  }
  const pedido = (): PedidoPull => ({ desde: null, ate: new Date(Date.now() + 60_000).toISOString(), limite: 1001 });
  const provedor = (nome: string) => provedoresSyncCore.find((p) => p.entidade.nome === nome)!;
  const puxar = (nome: string, u: UsuarioAutenticado): Promise<LinhaSync[]> => provedor(nome).puxar!(ctx(u), pedido());
  const ids = (l: LinhaSync[]) => l.map((x) => x.id).sort();
  const clientesDe = (l: LinhaSync[]) => [...new Set(l.map((x) => (x as unknown as { cliente_id: string }).cliente_id))].sort();
  const rota = (metodo: string, caminho: string): RotaModulo => rotasDeClientes.concat(rotasDeDispositivos).find((r) => r.metodo === metodo && r.caminho === caminho)!;
  const chamar = (metodo: string, caminho: string, u: UsuarioAutenticado, extra: { corpo?: unknown; query?: unknown; params?: unknown } = {}) => {
    const r = rota(metodo, caminho);
    return r.executar({ ...ctx(u), corpo: r.corpo ? r.corpo.parse(extra.corpo ?? {}) : {}, query: r.query ? r.query.parse(extra.query ?? {}) : {}, params: r.params ? r.params.parse(extra.params ?? {}) : {} } as never) as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 6 });
    acesso = {
      comTenant: (tenantId, fn) => comTenant(pool, tenantId, (c) => fn(c as unknown as ClienteBanco)),
      semTenant: (fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) } as unknown as ClienteBanco),
    };
    await comTenant(pool, A.tenantId, async (c) => {
      await c.query(
        `insert into core.titulo (id, tenant_id, cliente_id, documento, emissao, vencimento, valor_cents, saldo_cents, situacao)
         values ($1, $3, $4, 'NF-ANTIGA', current_date - 200, current_date - 100, 1000, 0, 'liquidado'),
                ($2, $3, $4, 'NF-ANTIGA-2', current_date - 200, current_date - 100, 1000, 0, 'liquidado')`,
        [TITULO_ANTIGO, TITULO_ANTIGO_REMOVIDO, A.tenantId, C.c1],
      );
      await c.query('update core.titulo set deleted_at = now() where id = $1', [TITULO_ANTIGO_REMOVIDO]);
      await c.query(
        `insert into core.historico_compra (id, tenant_id, cliente_id, ano_mes, valor_cents, pedidos, itens)
         values ($1, $2, $3, to_char(current_date - interval '14 months', 'YYYY-MM'), 1000, 1, 1)`,
        [HISTORICO_ANTIGO, A.tenantId, C.c1],
      );
      await c.query(
        `insert into core.carteira (id, tenant_id, cliente_id, usuario_id, papel, inicio, fim)
         values ($1, $2, $3, $4, 'vendedor', current_date - 200, current_date - 60)`,
        [CARTEIRA_ENCERRADA, A.tenantId, C.c2, U.vendedor1],
      );
    });
  });
  afterAll(async () => {
    if (pool) {
      await comTenant(pool, A.tenantId, async (c) => {
        await c.query('delete from core.titulo where id = any($1::uuid[])', [[TITULO_ANTIGO, TITULO_ANTIGO_REMOVIDO]]);
        await c.query('delete from core.historico_compra where id = $1', [HISTORICO_ANTIGO]);
        await c.query('delete from core.carteira where id = $1', [CARTEIRA_ENCERRADA]);
      });
    }
    await pool?.end();
  });

  describe('serviços de escopo (RN-CORE-04)', () => {
    it('RN-CORE-04: carteira — vendedor-1 {c1,c3}; promotor {c1}; supervisor a equipe 1 {c1,c3}; gerente as equipes abaixo {c1,c2,c3}; analista o tenant', async () => {
      expect([...(await carteiraDoUsuario(vendedor1, acesso))].sort()).toEqual([C.c1, C.c3].sort());
      expect([...(await carteiraDoUsuario(promotor, acesso))]).toEqual([C.c1]);
      expect([...(await carteiraDoUsuario(supervisor, acesso))].sort()).toEqual([C.c1, C.c3].sort());
      expect([...(await carteiraDoUsuario(gerente, acesso))].sort()).toEqual([C.c1, C.c2, C.c3].sort());
      expect(await carteiraDoUsuario(analista, acesso)).toBe('tenant');
    });

    it('RN-CORE-04: carteira encerrada (fim já passado) não conta como vínculo vigente', async () => {
      expect([...(await carteiraDoUsuario(vendedor1, acesso))]).not.toContain(C.c2);
    });

    it('RN-CORE-04: usuariosVisiveis — vendedor só ele; supervisor ele + equipe 1; gerente + equipes abaixo; analista/admin o tenant', async () => {
      expect([...(await usuariosVisiveisDoUsuario(vendedor1, acesso))]).toEqual([U.vendedor1]);
      expect([...(await usuariosVisiveisDoUsuario(supervisor, acesso))].sort()).toEqual([U.supervisor, U.vendedor1, U.promotor].sort());
      expect([...(await usuariosVisiveisDoUsuario(gerente, acesso))].sort()).toEqual([U.gerente, U.supervisor, U.vendedor1, U.vendedor2, U.promotor].sort());
      expect(await usuariosVisiveisDoUsuario(analista, acesso)).toBe('tenant');
      expect(await usuariosVisiveisDoUsuario(admin, acesso)).toBe('tenant');
    });

    it('RN-CORE-05: o escopo de um usuário do tenant B nunca inclui id do tenant A (RLS)', async () => {
      const car = await carteiraDoUsuario(vendedorB, acesso);
      expect([...car]).toEqual([B.clientes.c1]);
      expect([...(await usuariosVisiveisDoUsuario(vendedorB, acesso))]).toEqual([B.usuarios.vendedor]);
    });
  });

  describe('vazamento por escopo de carteira no pull (RN-CORE-04, RN-CORE-05)', () => {
    const ENTIDADES = ['cliente', 'cliente_contato', 'cliente_financeiro', 'titulo', 'historico_compra', 'carteira'] as const;
    const clientesDaLinha = (nome: string, l: LinhaSync[]) => (nome === 'cliente' ? ids(l) : clientesDe(l));

    it('todos os provedores de cliente declaram escopo "carteira" (a API devolve versao_escopo); produto é "tenant"', () => {
      for (const n of ENTIDADES) expect(provedor(n).escopo, n).toBe('carteira');
      expect(provedor('produto').escopo).toBe('tenant');
    });

    it('RN-CORE-04: vendedor-1 recebe de c1 e c3 em TODAS as entidades de cliente — nunca de c2 nem do tenant B', async () => {
      for (const n of ENTIDADES) {
        const vistos = clientesDaLinha(n, await puxar(n, vendedor1));
        expect(vistos, n).not.toContain(C.c2);
        expect(vistos, n).not.toContain(B.clientes.c1);
        for (const v of vistos) expect([C.c1, C.c3], n).toContain(v);
      }
      expect(clientesDe(await puxar('cliente_contato', vendedor1))).toEqual([C.c1, C.c3].sort());
      expect(clientesDe(await puxar('cliente_financeiro', vendedor1))).toEqual([C.c1, C.c3].sort());
    });

    it('RN-CORE-04: vendedor-2 (só c2) não recebe contato, financeiro, título nem histórico de c1/c3', async () => {
      for (const n of ENTIDADES) {
        const vistos = clientesDaLinha(n, await puxar(n, vendedor2));
        for (const v of vistos) expect(v, n).toBe(C.c2);
      }
      expect((await puxar('titulo', vendedor2)).length).toBe(1);
    });

    it('RN-CORE-04: promotor só recebe o que é da carteira dele (c1)', async () => {
      for (const n of ENTIDADES) for (const v of clientesDaLinha(n, await puxar(n, promotor))) expect(v, n).toBe(C.c1);
    });

    it('RN-CORE-04: supervisor recebe a equipe (c1,c3) e não c2; gerente recebe as equipes abaixo (c1,c2,c3)', async () => {
      expect(clientesDe(await puxar('titulo', supervisor))).toEqual([C.c1, C.c3].sort());
      expect(clientesDe(await puxar('titulo', gerente))).toEqual([C.c1, C.c2, C.c3].sort());
    });

    it('RN-CORE-04/05: analista (escopo tenant) vê todo o tenant A e nada do B', async () => {
      for (const n of ENTIDADES) {
        const vistos = clientesDaLinha(n, await puxar(n, analista));
        expect(vistos, n).not.toContain(B.clientes.c1);
        expect(vistos, n).toEqual(expect.arrayContaining([C.c1, C.c2]));
      }
    });

    it('RN-CORE-05: usuário do tenant B só vê dado do B (nenhum id do A)', async () => {
      for (const n of ENTIDADES) {
        for (const v of clientesDaLinha(n, await puxar(n, vendedorB))) expect(v, n).toBe(B.clientes.c1);
      }
    });

    it('as linhas validam o schema do contrato (centavos como número, datas AAAA-MM-DD, instantes UTC)', async () => {
      const schemas = {
        cliente_contato: ClienteContatoSyncSchema,
        cliente_financeiro: ClienteFinanceiroSyncSchema,
        titulo: TituloSyncSchema,
        historico_compra: HistoricoCompraSyncSchema,
        carteira: CarteiraSyncSchema,
      } as const;
      for (const [n, schema] of Object.entries(schemas)) {
        const linhas = await puxar(n, analista);
        expect(linhas.length, n).toBeGreaterThan(0);
        for (const l of linhas) expect(() => schema.parse(l), `${n} ${l.id}`).not.toThrow();
      }
    });

    it('janelas do desenho §2: título liquidado antigo, histórico de 14 meses e carteira encerrada há 60 dias ficam de fora; título removido passa', async () => {
      const titulos = ids(await puxar('titulo', analista));
      expect(titulos).not.toContain(TITULO_ANTIGO);
      expect(titulos).toContain(TITULO_ANTIGO_REMOVIDO); // o aparelho precisa saber que saiu
      expect(ids(await puxar('historico_compra', analista))).not.toContain(HISTORICO_ANTIGO);
      expect(ids(await puxar('carteira', analista))).not.toContain(CARTEIRA_ENCERRADA);
    });

    it('cliente entra na carteira → o próximo pull traz os títulos dele; sai → somem do escopo (ADR 0009 §4)', async () => {
      expect(clientesDe(await puxar('titulo', vendedor1))).not.toContain(C.c2);
      const r = await chamar('PUT', 'carteira', admin, { corpo: { cliente_id: C.c2, usuario_id: U.vendedor1, papel: 'vendedor' } });
      expect(clientesDe(await puxar('titulo', vendedor1))).toContain(C.c2);
      expect(clientesDe(await puxar('cliente_contato', vendedor1))).toContain(C.c2);
      await chamar('DELETE', 'carteira/:id', admin, { params: { id: r.id } });
      expect(clientesDe(await puxar('titulo', vendedor1))).not.toContain(C.c2);
    });
  });

  describe('Cliente 360 e lista (rotas /v1/core)', () => {
    it('RN-CORE-04: vendedor-1 abre a ficha de c1 com contatos, financeiro, títulos, histórico e resumos', async () => {
      const r = Cliente360Schema.parse(await chamar('GET', 'clientes/:id', vendedor1, { params: { id: C.c1 } }));
      expect(r.contatos).toHaveLength(2);
      expect(r.contatos[0]!.principal).toBe(true);
      expect(r.financeiro?.limite_cents).toBe(5_000_000);
      expect(r.resumo_financeiro).toMatchObject({ credito_disponivel_cents: 4_000_000, vencidos_qtd: 1, a_vencer_qtd: 1, bloqueado: false });
      expect(r.titulos.map((t) => t.id)).not.toContain(TITULO_ANTIGO);
      expect(r.historico).toHaveLength(12);
      expect(r.resumo_compras.total_12m_cents).toBeGreaterThan(0);
    });

    it('RN-CORE-04: ficha de cliente fora da carteira é 404 (não 403), também para cliente de outro tenant', async () => {
      await expect(chamar('GET', 'clientes/:id', vendedor1, { params: { id: C.c2 } })).rejects.toBeInstanceOf(ErroNaoEncontrado);
      await expect(chamar('GET', 'clientes/:id', vendedor1, { params: { id: B.clientes.c1 } })).rejects.toBeInstanceOf(ErroNaoEncontrado);
      await expect(chamar('GET', 'clientes/:id', analista, { params: { id: B.clientes.c1 } })).rejects.toBeInstanceOf(ErroNaoEncontrado);
    });

    it('RN-CORE-04: analista abre qualquer cliente do tenant; c3 vence título HOJE e não conta como vencido (fuso do tenant)', async () => {
      const r = Cliente360Schema.parse(await chamar('GET', 'clientes/:id', analista, { params: { id: C.c3 } }));
      expect(r.resumo_financeiro).toMatchObject({ vencidos_qtd: 0, a_vencer_qtd: 1, credito_disponivel_cents: 700_000 });
      expect(r.historico).toEqual([]);
      expect(r.resumo_compras.dias_sem_compra).toBeNull();
    });

    it('RN-CORE-04: as últimas visitas do cliente só trazem as de usuários visíveis ao solicitante', async () => {
      const prop = Cliente360Schema.parse(await chamar('GET', 'clientes/:id', vendedor1, { params: { id: C.c1 } }));
      expect(prop.ultimas_visitas.every((v) => v.usuario_id === U.vendedor1)).toBe(true);
      const todas = Cliente360Schema.parse(await chamar('GET', 'clientes/:id', analista, { params: { id: C.c1 } }));
      expect(todas.ultimas_visitas.some((v) => v.usuario_id === U.promotor)).toBe(true);
    });

    it('RN-CORE-04: a lista online respeita o escopo e os filtros (bloqueados, com vencidos, busca)', async () => {
      const lista = async (u: UsuarioAutenticado, query: object = {}) => ((await chamar('GET', 'clientes', u, { query })) as { itens: Array<{ id: string }> }).itens.map((i) => i.id).sort();
      expect(await lista(vendedor1)).toEqual([C.c1, C.c3].sort());
      expect(await lista(vendedor2)).toEqual([C.c2]);
      expect(await lista(vendedorB)).toEqual([B.clientes.c1]);
      expect(await lista(analista)).toEqual([C.c1, C.c2, C.c3].sort());
      expect(await lista(analista, { bloqueado: 'true' })).toEqual([C.c2]);
      expect(await lista(analista, { com_vencidos: 'true' })).toEqual([C.c1, C.c2].sort());
      expect(await lista(vendedor1, { com_vencidos: 'true' })).toEqual([C.c1]);
      // o filtro nunca amplia o escopo
      expect(await lista(vendedor1, { bloqueado: 'true' })).toEqual([]);
    });

    it('a lista pagina por deslocamento opaco', async () => {
      const p1 = (await chamar('GET', 'clientes', analista, { query: { limite: '2' } })) as { itens: unknown[]; proximo_cursor: string | null };
      expect(p1.itens).toHaveLength(2);
      expect(p1.proximo_cursor).toBe('2');
      const p2 = (await chamar('GET', 'clientes', analista, { query: { limite: '2', cursor: p1.proximo_cursor } })) as { itens: unknown[]; proximo_cursor: string | null };
      expect(p2.itens).toHaveLength(1);
      expect(p2.proximo_cursor).toBeNull();
    });
  });

  describe('carteira (PUT/DELETE) com auditoria', () => {
    const auditorias = (acao: string) =>
      comTenant(pool, A.tenantId, async (c) => (await c.query<{ usuario_id: string }>("select usuario_id from plataforma.auditoria where acao = $1 and modulo = 'core'", [acao])).rows);

    it('RN-CORE-04: PUT é idempotente pela chave (cliente, usuário, papel) e audita quem vinculou', async () => {
      const corpo = { cliente_id: C.c2, usuario_id: U.vendedor1, papel: 'vendedor', frequencia_semanas: 2, dia_semana: 3 };
      const a = await chamar('PUT', 'carteira', analista, { corpo });
      const b = await chamar('PUT', 'carteira', analista, { corpo: { ...corpo, frequencia_semanas: 4 } });
      expect(b.id).toBe(a.id);
      const linha = await comTenant(pool, A.tenantId, async (c) => (await c.query('select frequencia_semanas from core.carteira where id = $1', [a.id])).rows[0]);
      expect(linha.frequencia_semanas).toBe(4);
      expect((await auditorias('carteira.vincular')).some((l) => l.usuario_id === U.analista)).toBe(true);
      await chamar('DELETE', 'carteira/:id', analista, { params: { id: a.id } });
      expect((await auditorias('carteira.desvincular')).length).toBeGreaterThan(0);
    });

    it('RN-CORE-04: papel incompatível com o perfil (promotor no papel vendedor) é recusado; RN-PRO-01', async () => {
      await expect(chamar('PUT', 'carteira', admin, { corpo: { cliente_id: C.c2, usuario_id: U.promotor, papel: 'vendedor' } })).rejects.toBeInstanceOf(ErroRegraNegocio);
    });

    it('RN-CORE-05: vincular cliente do tenant B a usuário do A é 404 (RLS esconde o cliente)', async () => {
      await expect(chamar('PUT', 'carteira', admin, { corpo: { cliente_id: B.clientes.c1, usuario_id: U.vendedor1, papel: 'vendedor' } })).rejects.toBeInstanceOf(ErroNaoEncontrado);
    });

    it('as ações de escrita da carteira e do aparelho não são de vendedor/promotor/supervisor/gerente (manifesto)', async () => {
      const { manifest } = await import('../manifest');
      expect(manifest.acoes['carteira.editar']?.perfis).toEqual(['analista', 'admin']);
      expect(manifest.acoes['dispositivo.bloquear']?.perfis).toEqual(['admin', 'analista']);
      expect(rota('PUT', 'carteira').acao).toBe('carteira.editar');
      expect(rota('PUT', 'dispositivos/:id/bloqueio').acao).toBe('dispositivo.bloquear');
    });

    it('GET carteira: supervisor vê só vínculos da equipe; vendedor não tem a rota (perfis)', async () => {
      const r = (await chamar('GET', 'carteira', supervisor)) as { itens: Array<{ usuario_id: string; cliente_id: string }> };
      expect(r.itens.length).toBeGreaterThan(0);
      for (const i of r.itens) expect([U.vendedor1, U.promotor, U.supervisor]).toContain(i.usuario_id);
      expect(rota('GET', 'carteira').perfis).not.toContain('vendedor');
      expect(rota('GET', 'carteira').perfis).not.toContain('promotor');
    });
  });

  describe('hierarquia da equipe (contrato para o Gestor)', () => {
    it('RN-CORE-04: gerente recebe a árvore das equipes abaixo, com o supervisor respondendo a ele', async () => {
      const h = HierarquiaEquipeSchema.parse(await chamar('GET', 'equipe/hierarquia', gerente));
      const sup = (id: string) => h.membros.find((m) => m.id === id)?.superior_id;
      expect(sup(U.vendedor1)).toBe(U.supervisor);
      expect(sup(U.promotor)).toBe(U.supervisor);
      expect(sup(U.supervisor)).toBe(U.gerente);
      expect(sup(U.vendedor2)).toBe(U.gerente);
      expect(sup(U.gerente)).toBeNull();
      expect(h.membros.map((m) => m.id)).not.toContain(U.admin);
    });

    it('RN-CORE-04: supervisor recebe só a equipe dele e não vê quem está acima (superior vira null)', async () => {
      const h = HierarquiaEquipeSchema.parse(await chamar('GET', 'equipe/hierarquia', supervisor));
      expect(h.membros.map((m) => m.id).sort()).toEqual([U.supervisor, U.vendedor1, U.promotor].sort());
      expect(h.membros.find((m) => m.id === U.supervisor)?.superior_id).toBeNull();
    });

    it('RN-CORE-05: o admin do tenant B vê só gente do B', async () => {
      const h = HierarquiaEquipeSchema.parse(await chamar('GET', 'equipe/hierarquia', usuario(B.usuarios.admin, 'admin', B.tenantId)));
      expect(h.membros.map((m) => m.id).sort()).toEqual([B.usuarios.admin, B.usuarios.vendedor].sort());
    });
  });

  describe('RN-CORE-15: aparelho bloqueado vale para o tenant inteiro', () => {
    const bloqueado = (tenantId: string, dispositivoId: string) => comTenant(pool, tenantId, (c) => fabricaSql.doTenant(c as unknown as ClienteBanco).dispositivoBloqueado(dispositivoId));
    const auditorias = (acao: string) =>
      comTenant(pool, A.tenantId, async (c) => (await c.query<{ usuario_id: string }>("select usuario_id from plataforma.auditoria where acao = $1 and modulo = 'core'", [acao])).rows);

    it('RN-CORE-15: o bloqueio do aparelho do promotor vale para qualquer usuário (a consulta não olha o dono)', async () => {
      expect(await bloqueado(A.tenantId, A.dispositivos.promotorBloqueado)).toBe(true);
      expect(await bloqueado(A.tenantId, A.dispositivos.vendedor1)).toBe(false);
    });

    it('RN-CORE-05: o RLS impede o tenant B de ver (ou bloquear) aparelho do tenant A', async () => {
      expect(await bloqueado(B.tenantId, A.dispositivos.promotorBloqueado)).toBe(false);
      await expect(chamar('PUT', 'dispositivos/:id/bloqueio', usuario(B.usuarios.admin, 'admin', B.tenantId), { params: { id: A.dispositivos.vendedor1 } })).rejects.toBeInstanceOf(ErroNaoEncontrado);
    });

    it('RN-CORE-15: analista bloqueia e desbloqueia pelo BKO, com auditoria; bloquear de novo é idempotente', async () => {
      const id = A.dispositivos.vendedor1;
      await chamar('PUT', 'dispositivos/:id/bloqueio', analista, { params: { id }, corpo: { motivo: 'roubo' } });
      expect(await bloqueado(A.tenantId, id)).toBe(true);
      const primeiro = await comTenant(pool, A.tenantId, async (c) => (await c.query('select bloqueado_em from core.dispositivo where id = $1', [id])).rows[0].bloqueado_em as Date);
      await chamar('PUT', 'dispositivos/:id/bloqueio', admin, { params: { id } });
      const depois = await comTenant(pool, A.tenantId, async (c) => (await c.query('select bloqueado_em from core.dispositivo where id = $1', [id])).rows[0].bloqueado_em as Date);
      expect(depois.getTime()).toBe(primeiro.getTime());
      expect((await auditorias('dispositivo.bloquear')).some((l) => l.usuario_id === U.analista)).toBe(true);

      const lista = (await chamar('GET', 'dispositivos', admin, { query: { bloqueado: 'true' } })) as { itens: Array<{ id: string; usuario_nome: string }> };
      expect(lista.itens.map((i) => i.id)).toEqual(expect.arrayContaining([id, A.dispositivos.promotorBloqueado]));

      await chamar('DELETE', 'dispositivos/:id/bloqueio', analista, { params: { id } });
      expect(await bloqueado(A.tenantId, id)).toBe(false);
      expect((await auditorias('dispositivo.desbloquear')).some((l) => l.usuario_id === U.analista)).toBe(true);
    });

    it('RN-CORE-15 (O-5): bloquear no BKO corta a próxima requisição do MESMO token (423) e o tenant B não é afetado', async () => {
      const segredo = 'segredo-de-teste-com-mais-de-32-caracteres!!';
      const auth = criarAutenticacao({ segredo: () => segredo });
      const agora = new Date();
      const ate = new Date(agora.getTime() + 15 * 60_000);
      const id = A.dispositivos.vendedor1;
      const tokenA = assinarAcesso({ sub: U.vendedor1, tid: A.tenantId, perfil: 'vendedor', did: id }, agora, ate, segredo);
      const tokenB = assinarAcesso({ sub: B.usuarios.vendedor, tid: B.tenantId, perfil: 'vendedor', did: id }, agora, ate, segredo);
      const semAparelho = assinarAcesso({ sub: U.vendedor1, tid: A.tenantId, perfil: 'vendedor' }, agora, ate, segredo);
      const chamarAuth = (t: string) => auth.autenticar({ authorization: `Bearer ${t}` }, acesso, agora);

      expect((await chamarAuth(tokenA))?.id).toBe(U.vendedor1);
      await chamar('PUT', 'dispositivos/:id/bloqueio', analista, { params: { id } });
      try {
        await expect(chamarAuth(tokenA)).rejects.toMatchObject({ status: 423, codigo: 'DISPOSITIVO_BLOQUEADO' });
        // outro tenant com o mesmo id de aparelho: o RLS não enxerga o bloqueio do A
        expect((await chamarAuth(tokenB))?.id).toBe(B.usuarios.vendedor);
        // sessão sem aparelho (login sem dispositivo_id) não é afetada
        expect((await chamarAuth(semAparelho))?.id).toBe(U.vendedor1);
      } finally {
        await chamar('DELETE', 'dispositivos/:id/bloqueio', analista, { params: { id } });
      }
      expect((await chamarAuth(tokenA))?.id).toBe(U.vendedor1);
    });

    it('RN-CORE-15: só admin e analista têm as rotas de aparelho', () => {
      expect(rota('GET', 'dispositivos').perfis).toEqual(['admin', 'analista']);
    });
  });
});
