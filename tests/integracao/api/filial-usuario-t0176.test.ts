/**
 * T-0176 — filial de CADASTRO e filiais de VENDA do usuário pela API REAL (RN-CORE-39 revista; R-20261115-093000 "regra
 * definitiva" e R-20261115-094500 "respostas do dono do produto"). Matriz: docs/testes/T-0176.md (F-01..F-07).
 *
 * `createApp` + os 8 módulos + Postgres efêmero do arquivo (dois-tenants + 0077) pelo `macuxi_app` (RLS). O `subirApi` dá a filial
 * padrão a todo usuário da fixture (tests/integracao/apoio/filial-usuario.ts); cada caso trava quem precisa (`deixarSemFilial`) e
 * destrava no fim. Roda só com banco (CI) e com o contrato do Core que aceita a filial do usuário (`API_TEM_FILIAL_DE_USUARIO`,
 * lido em tempo de execução). Ligar quando o #361 (core, RN-CORE-39) entrar no main: o skip se desliga sozinho; depois do merge,
 * tirar o `!API_TEM_FILIAL_DE_USUARIO` do `describe.skipIf`. Até lá, os campos (`filial_cadastro_id`, `filial_venda_ids`,
 * `sem_filial`) são tipados aqui (`FiliaisDoUsuario`), sem importar símbolo que só existe no contrato novo: o typecheck:tests
 * passa no main com e sem o #361.
 *
 * Convenção: `it` = vale hoje; `it.fails` = defeito aberto (o caso diz o que falta; quando corrigir, fica vermelho e vira `it`).
 * v1.0.12: D-T0176-2 (ação `usuario.filial_editar` de admin/analista no Core) e D-T0176-3 (guarda global da plataforma, ADR 0056,
 * #339) corrigidos; os casos viraram `it`. O 403 traz `CODIGO_USUARIO_SEM_FILIAL` e `MENSAGEM_USUARIO_SEM_FILIAL` do SDK, vale em
 * toda rota autenticada (Catálogo, Vendedor…) e o sync do bloqueado só entrega a entidade `usuario` (push = 403 no lote inteiro).
 */
import { CriarUsuarioRespostaSchema, SessaoRespostaSchema, type SessaoResposta, type UsuarioSync } from '@macuxi/core/contracts';
import { definirTenant } from '@macuxi/db/teste';
import { semBanco } from '@macuxi/db/teste/estado';
import { CODIGO_USUARIO_SEM_FILIAL, MENSAGEM_USUARIO_SEM_FILIAL, type ContextoConsumo } from '@macuxi/platform-sdk';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { A, B, erroDe, subirApi, type ApiDeTeste, type Tenant } from '../apoio/api';
import { API_TEM_FILIAL_DE_USUARIO, deixarSemFilial, filiaisDoTenant, filiaisNoBanco, filialPadrao, garantirFilialDosUsuarios } from '../apoio/filial-usuario';

const SEM_FILIAL = CODIGO_USUARIO_SEM_FILIAL;
/** Campos da filial do usuário (aditivos no contrato do #361); tipados aqui para o typecheck passar também no main sem ele. */
interface FiliaisDoUsuario {
  filial_cadastro_id?: string | null;
  filial_venda_ids?: string[];
  sem_filial?: boolean;
}
type SessaoComFilial = Omit<SessaoResposta, 'usuario'> & { usuario: SessaoResposta['usuario'] & FiliaisDoUsuario };
const EVENTO_VENDEDOR = 'integracao.vendedor.atualizado@1';
/** Senha inicial dos usuários criados aqui (RN-CORE-32). */
const SENHA_NOVA = 'Filial#T0176-ok';
const EM = (x: string) => `${x}.t0176@exemplo.com.br`;
type App = 'campo' | 'gestao' | 'web';
/** Usuários da fixture de A em cada perfil, com o app em que entram. */
const PERFIS_A: readonly [perfil: string, email: string, id: string, app: App][] = [
  ['vendedor', 'vendedor@exemplo.com.br', A.usuarios.vendedor1, 'campo'],
  ['promotor', 'promotor@exemplo.com.br', A.usuarios.promotor, 'campo'],
  ['supervisor', 'supervisor@exemplo.com.br', A.usuarios.supervisor, 'gestao'],
  ['gerente', 'gerente@exemplo.com.br', A.usuarios.gerente, 'web'],
  ['analista', 'analista@exemplo.com.br', A.usuarios.analista, 'web'],
  ['assistente', 'assistente@exemplo.com.br', A.usuarios.assistente, 'web'],
  ['admin', 'admin@exemplo.com.br', A.usuarios.admin, 'web'],
];
/** Rotas de dados do Core: em cada perfil, as que dão 200 com filial têm de dar 403 USUARIO_SEM_FILIAL sem ela. */
const ROTAS_CORE = ['/v1/core/clientes', '/v1/core/carteira', '/v1/core/equipe/hierarquia', '/v1/core/usuarios', '/v1/core/licencas', '/v1/core/parametros/inicio', '/v1/core/farol', '/v1/core/filiais'];

// Ligar quando o #361 entrar no main: `!API_TEM_FILIAL_DE_USUARIO` pula tudo no main sem o contrato novo (422
// USUARIO_FILIAL_CADASTRO_OBRIGATORIA, 403 USUARIO_SEM_FILIAL no login, rota eu/filial-cadastro); com o #361, liga sozinho.
describe.skipIf(semBanco() || !API_TEM_FILIAL_DE_USUARIO)('T-0176 filial de cadastro e de venda do usuário pela API (RN-CORE-39)', () => {
  let api: ApiDeTeste;
  let padraoA = '';
  let boaVistaA = { id: '', external_id: '' };
  let padraoB = '';
  let campinasB = '';
  let tokenAdminA = '';

  const sessao = async (email: string, app?: App, tenant: Tenant = A): Promise<SessaoComFilial> => {
    const r = await api.entrar(email, { tenant, ...(app ? { app } : {}) });
    expect(r.statusCode, `${email}: ${r.body}`).toBe(200);
    return SessaoRespostaSchema.parse(r.json()) as SessaoComFilial;
  };
  const status = async (token: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) => {
    const r = await api.chamar(token, { method, url, ...(payload ? { payload } : {}) });
    return r.statusCode >= 400 ? `${r.statusCode} ${erroDe(r).codigo}` : String(r.statusCode);
  };
  /** 403 do usuário sem filial: código e texto aprovados, os do SDK (fonte única). */
  const esperarSemFilial = async (token: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) => {
    const r = await api.chamar(token, { method, url, ...(payload ? { payload } : {}) });
    expect(r.statusCode, `${url}: ${r.body}`).toBe(403);
    expect(erroDe(r), url).toMatchObject({ codigo: CODIGO_USUARIO_SEM_FILIAL, mensagem: MENSAGEM_USUARIO_SEM_FILIAL });
  };
  /** Volta o usuário ao estado da fixture (filial padrão). */
  const destravar = (id: string) => garantirFilialDosUsuarios(api.admin, [id]);

  beforeAll(async () => {
    api = await subirApi();
    padraoA = await filialPadrao(api.admin, A.tenantId);
    const outraA = (await filiaisDoTenant(api.admin, A.tenantId)).find((f) => !f.padrao && f.external_id);
    if (!outraA) throw new Error('fixture: A sem a 2ª filial com external_id (Boa Vista, FIL-BV)');
    boaVistaA = { id: outraA.id, external_id: outraA.external_id! };
    padraoB = await filialPadrao(api.admin, B.tenantId);
    campinasB = (await filiaisDoTenant(api.admin, B.tenantId)).find((f) => !f.padrao)!.id;
    tokenAdminA = (await sessao('admin@exemplo.com.br', 'web')).access_token;
  }, 180_000);
  afterAll(async () => {
    await api?.fechar();
  });

  // ------------------------------------------------------------------------------------------------------------------ F-01
  describe('F-01 sem filial, em cada perfil: login devolve sem_filial e as rotas de dados do Core dão 403 USUARIO_SEM_FILIAL', () => {
    it.each(PERFIS_A)('%s', async (perfil, email, id, app) => {
      const comFilial = await sessao(email, app);
      expect(comFilial.usuario).toMatchObject({ perfil, sem_filial: false, filial_cadastro_id: padraoA });
      expect(comFilial.usuario.filial_venda_ids).toContain(padraoA);
      const abertas: string[] = [];
      for (const url of ROTAS_CORE) if ((await status(comFilial.access_token, 'GET', url)) === '200') abertas.push(url);
      expect(abertas.length, `${perfil}: nenhuma rota de dados do Core aberta com filial`).toBeGreaterThan(0);

      await deixarSemFilial(api.admin, id);
      try {
        const s = await sessao(email, app);
        expect(s.usuario).toMatchObject({ id, perfil, sem_filial: true, filial_cadastro_id: null, filial_venda_ids: [] });
        // o token novo e o emitido ANTES do bloqueio: o bloqueio é lido a cada requisição
        for (const token of [s.access_token, comFilial.access_token]) {
          for (const url of abertas) await esperarSemFilial(token, 'GET', url);
        }
        // a única rota liberada: o estado do próprio usuário (o app/BKO abre só a tela de bloqueio ou a que pede a filial)
        const eu = await api.chamar(s.access_token, { method: 'GET', url: '/v1/core/eu/filial-cadastro' });
        expect(eu.statusCode, eu.body).toBe(200);
        const corpo = eu.json() as { sem_filial: boolean; pode_informar: boolean; filiais: { id: string }[] };
        expect(corpo.sem_filial).toBe(true);
        expect(corpo.pode_informar).toBe(perfil === 'admin' || perfil === 'analista');
        expect(corpo.filiais.length > 0).toBe(corpo.pode_informar);
      } finally {
        await destravar(id);
      }
      expect(await status(comFilial.access_token, 'GET', abertas[0]!)).toBe('200');
    });
  });

  // ------------------------------------------------------------------------------------------------------------------ F-02
  describe('F-02 destravamento pela rota própria (PUT /v1/core/eu/filial-cadastro)', () => {
    it('admin sem filial informa a própria filial: 200, vira cadastro e venda, as rotas voltam, auditado; o 2º PUT = 409', async () => {
      const id = A.usuarios.admin;
      await deixarSemFilial(api.admin, id);
      try {
        const t = (await sessao('admin@exemplo.com.br', 'web')).access_token;
        expect(await status(t, 'GET', '/v1/core/usuarios')).toBe(`403 ${SEM_FILIAL}`);
        const r = await api.chamar(t, { method: 'PUT', url: '/v1/core/eu/filial-cadastro', payload: { filial_cadastro_id: boaVistaA.id } });
        expect(r.statusCode, r.body).toBe(200);
        expect(r.json()).toMatchObject({ sem_filial: false, filial_cadastro_id: boaVistaA.id, filial_venda_ids: [boaVistaA.id] });
        expect(await filiaisNoBanco(api.admin, id)).toEqual({ cadastro: boaVistaA.id, venda: [boaVistaA.id] });
        expect(await status(t, 'GET', '/v1/core/usuarios')).toBe('200');
        const aud = await api.admin.query<{ depois: Record<string, unknown> }>("select depois from plataforma.auditoria where acao = 'usuario.filial_cadastro_propria' and entidade_id = $1", [id]);
        expect(aud.rows.map((x) => x.depois)).toEqual([{ filial_cadastro_id: boaVistaA.id, filial_venda_ids: [boaVistaA.id] }]);
        expect(await status(t, 'PUT', '/v1/core/eu/filial-cadastro', { filial_cadastro_id: padraoA })).toBe('409 USUARIO_FILIAL_JA_INFORMADA');
        expect((await filiaisNoBanco(api.admin, id)).cadastro).toBe(boaVistaA.id);
      } finally {
        await deixarSemFilial(api.admin, id);
        await destravar(id);
      }
    });

    it('vendedor sem filial não se destrava: PUT = 403 e nada muda; o GET diz pode_informar false e não lista filiais', async () => {
      const id = A.usuarios.vendedor1;
      await deixarSemFilial(api.admin, id);
      try {
        const t = (await sessao('vendedor@exemplo.com.br', 'campo')).access_token;
        const r = await api.chamar(t, { method: 'PUT', url: '/v1/core/eu/filial-cadastro', payload: { filial_cadastro_id: padraoA } });
        expect(r.statusCode, r.body).toBe(403);
        expect(await filiaisNoBanco(api.admin, id)).toEqual({ cadastro: null, venda: [] });
        const g = await api.chamar(t, { method: 'GET', url: '/v1/core/eu/filial-cadastro' });
        expect(g.json()).toMatchObject({ sem_filial: true, pode_informar: false, filiais: [] });
      } finally {
        await destravar(id);
      }
    });

    it('supervisor e gerente sem filial também não se destravam (403)', async () => {
      for (const [email, id, app] of [
        ['supervisor@exemplo.com.br', A.usuarios.supervisor, 'gestao'],
        ['gerente@exemplo.com.br', A.usuarios.gerente, 'web'],
      ] as const) {
        await deixarSemFilial(api.admin, id);
        try {
          const t = (await sessao(email, app)).access_token;
          expect((await status(t, 'PUT', '/v1/core/eu/filial-cadastro', { filial_cadastro_id: padraoA })).startsWith('403 '), email).toBe(true);
          expect((await filiaisNoBanco(api.admin, id)).cadastro).toBeNull();
        } finally {
          await destravar(id);
        }
      }
    });

    // D-T0176-2 corrigido na v1.0.12: a ação `usuario.filial_editar` (admin e analista) no Core
    it('analista sem filial se destrava como o admin (o GET diz pode_informar: true)', async () => {
      const id = A.usuarios.analista;
      await deixarSemFilial(api.admin, id);
      try {
        const t = (await sessao('analista@exemplo.com.br', 'web')).access_token;
        expect((await api.chamar(t, { method: 'GET', url: '/v1/core/eu/filial-cadastro' })).json()).toMatchObject({ pode_informar: true });
        expect(await status(t, 'PUT', '/v1/core/eu/filial-cadastro', { filial_cadastro_id: padraoA })).toBe('200');
      } finally {
        await destravar(id);
      }
    });
  });

  // ------------------------------------------------------------------------------------------------------------------ F-03
  describe('F-03 cadastro pelo BKO: filial de cadastro obrigatória e várias de venda (supervisor)', () => {
    it('supervisor com 2 filiais de venda: 201; a de cadastro entra na de venda; a lista e o banco mostram as duas', async () => {
      const r = await api.chamar(tokenAdminA, {
        method: 'POST',
        url: '/v1/core/usuarios',
        payload: { nome: 'Supervisora Filiais', email: EM('sup.varias'), perfil: 'supervisor', senha: SENHA_NOVA, filial_cadastro_id: padraoA, filial_venda_ids: [boaVistaA.id] },
      });
      expect(r.statusCode, r.body).toBe(201);
      const u = CriarUsuarioRespostaSchema.parse(r.json()) as ReturnType<typeof CriarUsuarioRespostaSchema.parse> & FiliaisDoUsuario;
      expect(u.filial_cadastro_id).toBe(padraoA);
      expect([...(u.filial_venda_ids ?? [])].sort()).toEqual([padraoA, boaVistaA.id].sort());
      expect(u.sem_filial).toBe(false);
      expect(await filiaisNoBanco(api.admin, u.id)).toEqual({ cadastro: padraoA, venda: [padraoA, boaVistaA.id].sort() });

      // edição: troca o cadastro para a Boa Vista e a venda para só ela; a padrão sai da venda (soft delete)
      const e = await api.chamar(tokenAdminA, { method: 'PUT', url: `/v1/core/usuarios/${u.id}`, payload: { filial_cadastro_id: boaVistaA.id, filial_venda_ids: [boaVistaA.id] } });
      expect(e.statusCode, e.body).toBe(200);
      expect(await filiaisNoBanco(api.admin, u.id)).toEqual({ cadastro: boaVistaA.id, venda: [boaVistaA.id] });
      // a venda sem a de cadastro: a API inclui a de cadastro (nunca grava venda sem ela)
      const e2 = await api.chamar(tokenAdminA, { method: 'PUT', url: `/v1/core/usuarios/${u.id}`, payload: { filial_venda_ids: [padraoA] } });
      expect(e2.statusCode, e2.body).toBe(200);
      expect(await filiaisNoBanco(api.admin, u.id)).toEqual({ cadastro: boaVistaA.id, venda: [padraoA, boaVistaA.id].sort() });
      const aud = await api.admin.query<{ n: number }>("select count(*)::int as n from plataforma.auditoria where acao = 'usuario.editar' and entidade_id = $1", [u.id]);
      expect(aud.rows[0]!.n).toBe(2);
    });

    it.each(['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'admin'])('%s sem filial de cadastro: 422 USUARIO_FILIAL_CADASTRO_OBRIGATORIA e nada gravado', async (perfil) => {
      const email = EM(`sem.filial.${perfil}`);
      const r = await api.chamar(tokenAdminA, { method: 'POST', url: '/v1/core/usuarios', payload: { nome: 'Sem Filial', email, perfil, senha: SENHA_NOVA } });
      expect(`${r.statusCode} ${erroDe(r).codigo}`, r.body).toBe('422 USUARIO_FILIAL_CADASTRO_OBRIGATORIA');
      expect((await api.admin.query('select 1 from core.usuario where email = $1', [email])).rowCount).toBe(0);
    });

    it('a sessão do supervisor da fixture traz a de cadastro e as de venda; o sync do vendedor traz a filial dele (offline)', async () => {
      // a fixture da 0077 dá ao supervisor de A a padrão (cadastro) e a Boa Vista (venda)
      const s = await sessao('supervisor@exemplo.com.br', 'gestao');
      expect(s.usuario.filial_cadastro_id).toBe(padraoA);
      expect([...(s.usuario.filial_venda_ids ?? [])].sort()).toEqual([padraoA, boaVistaA.id].sort());
      const v = await sessao('vendedor@exemplo.com.br', 'campo');
      const pull = await api.chamar(v.access_token, { method: 'GET', url: '/v1/sync/pull?entidade=usuario' });
      expect(pull.statusCode, pull.body).toBe(200);
      const minha = (pull.json() as { itens: (UsuarioSync & FiliaisDoUsuario)[] }).itens.find((l) => l.id === A.usuarios.vendedor1);
      expect(minha).toMatchObject({ filial_cadastro_id: padraoA, sem_filial: false });
      expect(minha!.filial_venda_ids).toContain(padraoA);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------ F-04
  describe('F-04 multi-tenant: filial de outro tenant = 422 USUARIO_FILIAL_INVALIDA, nada gravado', () => {
    it('criar com a de cadastro de B, ou com venda de B', async () => {
      for (const [k, filiais] of [
        ['cad', { filial_cadastro_id: padraoB }],
        ['venda', { filial_cadastro_id: padraoA, filial_venda_ids: [campinasB] }],
      ] as const) {
        const email = EM(`outro.tenant.${k}`);
        const r = await api.chamar(tokenAdminA, { method: 'POST', url: '/v1/core/usuarios', payload: { nome: 'Outro Tenant', email, perfil: 'vendedor', senha: SENHA_NOVA, ...filiais } });
        expect(`${r.statusCode} ${erroDe(r).codigo}`, `${k}: ${r.body}`).toBe('422 USUARIO_FILIAL_INVALIDA');
        expect((await api.admin.query('select 1 from core.usuario where email = $1', [email])).rowCount).toBe(0);
      }
    });

    it('editar o vendedor de A com filial de B, e o admin bloqueado se destravar com filial de B', async () => {
      const antes = await filiaisNoBanco(api.admin, A.usuarios.vendedor1);
      expect(await status(tokenAdminA, 'PUT', `/v1/core/usuarios/${A.usuarios.vendedor1}`, { filial_cadastro_id: padraoB })).toBe('422 USUARIO_FILIAL_INVALIDA');
      expect(await status(tokenAdminA, 'PUT', `/v1/core/usuarios/${A.usuarios.vendedor1}`, { filial_venda_ids: [padraoA, campinasB] })).toBe('422 USUARIO_FILIAL_INVALIDA');
      expect(await filiaisNoBanco(api.admin, A.usuarios.vendedor1)).toEqual(antes);
      await deixarSemFilial(api.admin, A.usuarios.admin);
      try {
        const t = (await sessao('admin@exemplo.com.br', 'web')).access_token;
        expect(await status(t, 'PUT', '/v1/core/eu/filial-cadastro', { filial_cadastro_id: padraoB })).toBe('422 USUARIO_FILIAL_INVALIDA');
        expect(await filiaisNoBanco(api.admin, A.usuarios.admin)).toEqual({ cadastro: null, venda: [] });
        // o GET só lista filiais do próprio tenant
        const g = (await api.chamar(t, { method: 'GET', url: '/v1/core/eu/filial-cadastro' })).json() as { filiais: { id: string }[] };
        expect(g.filiais.map((f) => f.id).sort()).toEqual([padraoA, boaVistaA.id].sort());
      } finally {
        await destravar(A.usuarios.admin);
      }
    });

    it('a sessão de B não traz filial de A; o bloqueio de um usuário de A não muda B', async () => {
      await deixarSemFilial(api.admin, A.usuarios.vendedor1);
      try {
        const sb = await sessao('vendedor@exemplo.com.br', 'campo', B);
        expect(sb.usuario.sem_filial).toBe(false);
        expect(sb.usuario.filial_cadastro_id).toBe(padraoB);
        for (const f of sb.usuario.filial_venda_ids ?? []) expect([padraoB, campinasB]).toContain(f);
        expect(await status(sb.access_token, 'GET', '/v1/core/clientes')).toBe('200');
      } finally {
        await destravar(A.usuarios.vendedor1);
      }
    });
  });

  // ------------------------------------------------------------------------------------------------------------------ F-05
  describe('F-05 carga do ERP (integracao.vendedor.atualizado@1, filial_external_id): filial inexistente deixa o vendedor bloqueado', () => {
    /** Roda o consumidor REAL do Core (o da API montada) numa transação do tenant A, como o worker. */
    const consumir = async (registro: Record<string, unknown>) => {
      const core = api.modulos.find((m) => m.manifesto.id === 'core')!;
      const consumidor = (core.consumidores ?? []).find((c) => c.evento.nome === EVENTO_VENDEDOR);
      if (!consumidor) throw new Error(`Core sem consumidor de ${EVENTO_VENDEDOR}`);
      const warn = vi.fn();
      const c = await api.pool.connect();
      try {
        await c.query('begin');
        await definirTenant(c, A.tenantId);
        const ctx = {
          db: c,
          agora: () => new Date('2026-11-15T16:00:00Z'),
          fuso: () => 'America/Manaus',
          parametros: () => ({}),
          envelope: { evento_id: randomUUID(), tenant_id: A.tenantId },
          publicar: vi.fn(async () => ({})),
          consultar: vi.fn(),
          log: { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() },
        } as unknown as ContextoConsumo;
        const payload = { lote_id: randomUUID(), entidade: 'vendedor', external_id: registro.external_id, acao: 'atualizado', hash: randomUUID(), registro, ocorrido_em: registro.alterado_em };
        await consumidor.executar(consumidor.evento.schema.parse(payload), ctx);
        await c.query('commit');
      } catch (e) {
        await c.query('rollback').catch(() => undefined);
        throw e;
      } finally {
        c.release();
      }
      return warn;
    };

    it('inexistente: sem filial (login sem_filial, Core 403) e FILIAL_INEXISTENTE no log sem dado pessoal; depois a filial certa destrava', async () => {
      const id = A.usuarios.vendedor2;
      const ext = 'V-T0176-ERP';
      await api.admin.query('update core.usuario set external_id = $2, erp_alterado_em = null where id = $1', [id, ext]);
      const base = { external_id: ext, ativo: true, nome: 'Vendedor Dois', email: 'vendedor2@exemplo.com.br' };
      try {
        const warn = await consumir({ ...base, alterado_em: '2026-11-15T13:00:00Z', filial_external_id: 'FIL-NAO-EXISTE' });
        expect(await filiaisNoBanco(api.admin, id)).toMatchObject({ cadastro: null });
        expect(warn.mock.calls.map((x) => (x[0] as { erro?: string }).erro)).toContain('FILIAL_INEXISTENTE');
        expect(JSON.stringify(warn.mock.calls)).not.toMatch(/@|Vendedor Dois/);
        const s = await sessao('vendedor2@exemplo.com.br', 'campo');
        expect(s.usuario).toMatchObject({ sem_filial: true, filial_cadastro_id: null });
        expect(await status(s.access_token, 'GET', '/v1/core/clientes')).toBe(`403 ${SEM_FILIAL}`);

        // ausente = não altera (segue bloqueado)
        await consumir({ ...base, alterado_em: '2026-11-15T14:00:00Z' });
        expect((await filiaisNoBanco(api.admin, id)).cadastro).toBeNull();

        // a filial certa pelo external_id destrava: cadastro e venda
        await consumir({ ...base, alterado_em: '2026-11-15T15:00:00Z', filial_external_id: boaVistaA.external_id });
        expect(await filiaisNoBanco(api.admin, id)).toMatchObject({ cadastro: boaVistaA.id });
        expect((await filiaisNoBanco(api.admin, id)).venda).toContain(boaVistaA.id);
        const s2 = await sessao('vendedor2@exemplo.com.br', 'campo');
        expect(s2.usuario).toMatchObject({ sem_filial: false, filial_cadastro_id: boaVistaA.id });
        expect(await status(s2.access_token, 'GET', '/v1/core/clientes')).toBe('200');
      } finally {
        await api.admin.query('update core.usuario set external_id = null where id = $1', [id]);
        await deixarSemFilial(api.admin, id);
        await destravar(id);
      }
    });
  });

  // ------------------------------------------------------------------------------------------------------------------ F-06
  describe('F-06 bloqueio fora do Core (guarda global, ADR 0056)', () => {
    // D-T0176-3 corrigido na v1.0.12 (#339): a guarda está no `preparar` da API, vale para toda rota autenticada
    it('vendedor sem filial: rota de dados do Vendedor (/v1/vendedor/formas-pagamento) = 403 USUARIO_SEM_FILIAL', async () => {
      const id = A.usuarios.vendedor1;
      const antes = (await sessao('vendedor@exemplo.com.br', 'campo')).access_token;
      expect(await status(antes, 'GET', '/v1/vendedor/formas-pagamento')).toBe('200');
      await deixarSemFilial(api.admin, id);
      try {
        await esperarSemFilial(antes, 'GET', '/v1/vendedor/formas-pagamento');
      } finally {
        await destravar(id);
      }
      expect(await status(antes, 'GET', '/v1/vendedor/formas-pagamento')).toBe('200');
    });

    it('vendedor sem filial: rota do Catálogo (/v1/catalogo/produtos) = 403 com o código e a mensagem do SDK; destravado, volta 200', async () => {
      const id = A.usuarios.vendedor1;
      const antes = (await sessao('vendedor@exemplo.com.br', 'campo')).access_token;
      expect(await status(antes, 'GET', '/v1/catalogo/produtos')).toBe('200');
      await deixarSemFilial(api.admin, id);
      try {
        await esperarSemFilial(antes, 'GET', '/v1/catalogo/produtos');
        await esperarSemFilial((await sessao('vendedor@exemplo.com.br', 'campo')).access_token, 'GET', '/v1/catalogo/produtos');
      } finally {
        await destravar(id);
      }
      expect(await status(antes, 'GET', '/v1/catalogo/produtos')).toBe('200');
    });
  });

  // ------------------------------------------------------------------------------------------------------------------ F-07
  describe('F-07 sync do usuário sem filial: só a entidade usuario', () => {
    it('novidades = só [usuario]; pull do usuario traz só a própria linha (sem_filial); pull de outra entidade e push = 403', async () => {
      const id = A.usuarios.vendedor1;
      const t = (await sessao('vendedor@exemplo.com.br', 'campo')).access_token;
      const livre = await api.chamar(t, { method: 'GET', url: '/v1/sync/novidades' });
      expect(livre.statusCode, livre.body).toBe(200);
      const todas = (livre.json() as { entidades: string[] }).entidades;
      const outra = todas.find((e) => e !== 'usuario');
      expect(todas, 'com filial: o vendedor recebe mais que a entidade usuario').toContain('usuario');
      expect(outra, 'com filial: alguma entidade além de usuario').toBeDefined();

      await deixarSemFilial(api.admin, id);
      try {
        const nov = await api.chamar(t, { method: 'GET', url: '/v1/sync/novidades' });
        expect(nov.statusCode, nov.body).toBe(200);
        expect((nov.json() as { entidades: string[] }).entidades).toEqual(['usuario']);

        const pull = await api.chamar(t, { method: 'GET', url: '/v1/sync/pull?entidade=usuario' });
        expect(pull.statusCode, pull.body).toBe(200);
        const itens = (pull.json() as { itens: (UsuarioSync & FiliaisDoUsuario)[] }).itens;
        expect(itens.map((l) => l.id)).toEqual([id]);
        expect(itens[0]).toMatchObject({ sem_filial: true, filial_cadastro_id: null });

        await esperarSemFilial(t, 'GET', `/v1/sync/pull?entidade=${outra!}`);
        const pedido = randomUUID();
        await esperarSemFilial(t, 'POST', '/v1/sync/push', { itens: [{ entidade: 'pedido', id: pedido, operacao: 'upsert', payload: {} }] });
        expect((await api.admin.query('select 1 from vendedor.pedido where id = $1', [pedido])).rowCount, 'push bloqueado não grava').toBe(0);
      } finally {
        await destravar(id);
      }
    });
  });
});
