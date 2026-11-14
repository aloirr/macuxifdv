/**
 * T-0094 / T-0111 / T-0112 — MP-06: multiperfil pela API REAL com Postgres (RN-CORE-35, RN-CORE-33, RN-PRO-01, RN-CORE-01; ADR 0033
 * §6 e §7; 0041 `plataforma.perfis_do_usuario`). Complementa o MP-01..05 sem banco (tests/modulos/multiperfil-t0094.test.ts).
 * Matrizes: docs/testes/T-0094.md e docs/testes/T-0111.md.
 *
 * Usuários montados pela administração no banco efêmero do arquivo (dois-tenants + 0041): o perfil principal em core.usuario.perfil
 * (o gatilho liga o de fábrica) e os vínculos extras em plataforma.usuario_perfil.
 *  - MP-06a vendedor + promotor (A): entra no Campo, não no BKO/Gestão/portal; rotas `superficie: 'bko'` = 403 PERFIL_SEM_BKO;
 *           ESCRITA de pedido passa da permissão (400 VALIDACAO, o corpo vazio de propósito) enquanto o promotor sozinho, com o
 *           Vendedor licenciado no perfil dele, leva 403 PERFIL_SEM_ACESSO (RN-PRO-01 no perfil, não no usuário); a coleta do
 *           Promotor também passa; o vendedor sozinho = 403 MODULO_INATIVO na coleta;
 *  - MP-06b a perfil tirado ou devolvido vale na PRÓXIMA requisição, com o mesmo token (ADR 0033 §2; T-0111 critério 6);
 *  - MP-06c analista + vendedor (A): ADR 0033 §7 "o `app` do login confere `acesso.*`" pela regra mais restritiva → o login
 *           do BKO (`app: 'web'`) recusa e o do Campo aceita; com o token, as rotas `bko` = PERFIL_SEM_BKO;
 *  - MP-06d admin + vendedor (A) e analista + admin (A): o portal é só de quem é só admin (RN-CORE-35) → 401 igual a senha errada;
 *  - MP-06e perfil personalizado vendedor_balcao de B (acesso.campo revogado por sobreposição): o login do Campo recusa;
 *  - MP-06f redefinição de senha pelo BKO (P7, RN-CORE-35): o alvo [analista (principal), admin] é admin → 422 SENHA_DE_ADMIN
 *           e nada muda; idem [admin (principal), vendedor]. O Core lê TODOS os perfis reais do alvo (modules/core/api/usuarios.ts).
 * CORRIGIDOS (viraram `it`, ficam como regressão):
 *  - D-MP1 (modulo-core, entrega R-20261108-071028): o login decidia o app só pelo perfil PRINCIPAL; agora lê
 *    `plataforma.perfis_do_usuario` (modules/core/api/autenticacao.ts) e decide com `podeUsarApp`/`podeEntrar` (regra mais
 *    restritiva nos acessos: BKO e portal fecham com um perfil travado; Campo e Gestão somam) → MP-06c, MP-06d (web), MP-06e;
 *  - D-MP2 (banco-dados, entrega R-20261108-100916): o portal aceitava quem tem admin como principal e outro perfil; a 0046
 *    (`plataforma.usuario_entra_no_portal` nas sa_* do login e da sessão do portal) exige todos os perfis de base admin → MP-06d (portal).
 * Roda só com banco (CI); sem ele, pula. O caso do portal pula sem a senha do macuxi_portal.
 *
 * UM PERFIL POR USUÁRIO (0069, PR do banco `nuvem/cargos-banco-dados`; R-20261114-153500 "Cada usuario so pode ter um perfil"):
 * a exclusão adiada `usuario_perfil_um_vivo` recusa o 2º vínculo vivo (23P01 no COMMIT). Com a 0069 no repositório, as
 * combinações do MP-06a/b/c/d/f deixam de existir; aqui, a troca de perfil (novo vínculo + `deleted_at` no antigo, na mesma
 * transação) é o que a API lê. O MP-06e já era troca e vale nos dois estados. A regra no banco (todas as ordens, o gatilho do
 * principal) é do db/testes/cargo-hierarquia.db.test.ts.
 */
import { CODIGOS_AUTH } from '@macuxi/core/contracts';
import { estadoBanco, semBanco } from '@macuxi/db/teste/estado';
import { CODIGO_PERFIL_SEM_BKO, criarPermissoes, ehAcaoDeEscritaDePedido, type RotaModulo } from '@macuxi/platform-sdk';
import { manifest as catalogo } from '@macuxi/catalogo/manifest';
import { manifest as core } from '@macuxi/core/manifest';
import { manifest as gestor } from '@macuxi/gestor/manifest';
import { manifest as integracao } from '@macuxi/integracao/manifest';
import { manifest as pesquisa } from '@macuxi/pesquisa/manifest';
import { manifest as promotor } from '@macuxi/promotor/manifest';
import { manifest as treinamento } from '@macuxi/treinamento/manifest';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A, B, erroDe, ids, subirApi, type ApiDeTeste, type Tenant } from '../apoio/api';
import { outboxDeEmail } from '../apoio/email';
import { criarUsuarioNoTenant, entrarNoPortal } from '../apoio/portal';
import { UM_PERFIL } from '../../modulos/apoio/estado-prs';

const ESTADO = estadoBanco();
const SEM_PORTAL = ESTADO.disponivel && !ESTADO.urlPortal ? 'sem MACUXI_PG_PORTAL_SENHA neste ambiente' : null;
const PERMS = criarPermissoes([core, catalogo, vendedor, promotor, gestor, pesquisa, treinamento, integracao]);
const UM_UUID = '0e000000-0000-4000-8000-0000000000f6';
/** Senha das pessoas deste arquivo (RN-CORE-32) e e-mails fictícios. */
const SENHA_MP = 'Multi#Perfil-T0094';
const EM = (x: string) => `${x}.mp06@exemplo.com.br`;

describe.skipIf(semBanco())('T-0094/T-0111 MP-06 multiperfil pela API (RN-CORE-35, RN-PRO-01, RN-CORE-33)', () => {
  let api: ApiDeTeste;
  const pessoas = { vp: '', av: '', admv: '', balcao: '', aadm: '' };

  const login = (email: string, app?: 'campo' | 'gestao' | 'web', tenant: Tenant = A) => api.entrar(email, { senha: SENHA_MP, tenant, ...(app ? { app } : {}) });
  const tokenDe = async (email: string, app?: 'campo' | 'gestao' | 'web', tenant: Tenant = A) => {
    const r = await login(email, app, tenant);
    expect(r.statusCode, r.body).toBe(200);
    return (r.json() as { access_token: string }).access_token;
  };
  const perfilId = async (tenantId: string, codigo: string) =>
    (await api.admin.query<{ id: string }>('select id::text from plataforma.perfil where tenant_id = $1 and codigo = $2', [tenantId, codigo])).rows[0]!.id;
  const vincular = async (tenantId: string, usuarioId: string, codigo: string) =>
    api.admin.query('insert into plataforma.usuario_perfil (id, tenant_id, usuario_id, perfil_id) values ($1, $2, $3, $4)', [
      randomUUID(),
      tenantId,
      usuarioId,
      await perfilId(tenantId, codigo),
    ]);
  const desvincular = async (tenantId: string, usuarioId: string, codigo: string) =>
    api.admin.query('update plataforma.usuario_perfil set deleted_at = now() where tenant_id = $1 and usuario_id = $2 and perfil_id = $3 and deleted_at is null', [
      tenantId,
      usuarioId,
      await perfilId(tenantId, codigo),
    ]);
  const chamarRota = (token: string, modulo: string, r: RotaModulo) =>
    api.chamar(token, { method: r.metodo, url: `/v1/${modulo}/${r.caminho.replace(/:[a-zA-Z_]+/g, UM_UUID)}`, payload: [] });
  /** `<status> <codigo do erro>` (ou `<status> -` quando a resposta não é erro): a mensagem de falha mostra o que veio. */
  const fora = (r: { statusCode: number; json(): unknown }) => {
    try {
      return `${r.statusCode} ${erroDe(r).codigo}`;
    } catch {
      return `${r.statusCode} -`;
    }
  };
  const ACOES_PROMOTOR = promotor.acoes as Readonly<Record<string, { perfis: readonly string[] }>>;

  /** Rotas de ESCRITA de pedido que o vendedor de fábrica pode usar (com corpo e fora do BKO). */
  const escritaDePedido = () =>
    api.modulos.flatMap((m) =>
      (m.rotas ?? [])
        .filter((r) => r.metodo !== 'GET' && !!r.acao && ehAcaoDeEscritaDePedido(r.acao) && !!r.corpo && r.superficie !== 'bko')
        .filter((r) => m.manifesto.id === 'vendedor' && PERMS.regraDaAcao(r.acao!).perfis.includes('vendedor'))
        .map((r) => ({ modulo: m.manifesto.id, r })),
    );
  /** Rotas de coleta do Promotor (ações do promotor, com corpo, fora do BKO). */
  const coletas = () =>
    api.modulos
      .filter((m) => m.manifesto.id === 'promotor')
      .flatMap((m) =>
        (m.rotas ?? [])
          .filter((r) => r.metodo !== 'GET' && !!r.acao && !!r.corpo && r.superficie !== 'bko' && (ACOES_PROMOTOR[r.acao]?.perfis ?? []).includes('promotor'))
          .map((r) => ({ modulo: m.manifesto.id, r })),
      );

  beforeAll(async () => {
    api = await subirApi({ plataforma: { segredo: () => 'segredo-de-plataforma-do-agente-testes-mp06-com-folga' } });
    // MP-06a vendedor (principal) + promotor
    pessoas.vp = await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, email: EM('vp'), nome: 'Vende e Promove', senha: SENHA_MP, perfil: 'vendedor' });
    if (!UM_PERFIL) await vincular(A.tenantId, pessoas.vp, 'promotor');
    // MP-06c analista (principal) + vendedor
    pessoas.av = await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, email: EM('av'), nome: 'Analista que Vende', senha: SENHA_MP, perfil: 'analista' });
    if (!UM_PERFIL) await vincular(A.tenantId, pessoas.av, 'vendedor');
    // MP-06d admin (principal) + vendedor (o admin da fixture segue com a gestão: o último admin não é afetado)
    pessoas.admv = await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, email: EM('admv'), nome: 'Admin que Vende', senha: SENHA_MP, perfil: 'admin' });
    if (!UM_PERFIL) await vincular(A.tenantId, pessoas.admv, 'vendedor');
    // MP-06f analista (principal) + admin: alvo da redefinição de senha (o principal sozinho seria redefinível)
    pessoas.aadm = await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, email: EM('aadm'), nome: 'Analista que Administra', senha: SENHA_MP, perfil: 'analista' });
    if (!UM_PERFIL) await vincular(A.tenantId, pessoas.aadm, 'admin');
    // MP-06e só o perfil personalizado vendedor_balcao de B (acesso.campo revogado): troca o vínculo de fábrica pelo dele numa transação
    pessoas.balcao = await criarUsuarioNoTenant(api.admin, { tenantId: B.tenantId, email: EM('balcao'), nome: 'Balcão de B', senha: SENHA_MP, perfil: 'vendedor' });
    const c = await api.admin.connect();
    try {
      await c.query('begin');
      await c.query('insert into plataforma.usuario_perfil (id, tenant_id, usuario_id, perfil_id) values ($1, $2, $3, $4)', [randomUUID(), B.tenantId, pessoas.balcao, B.perfis.vendedorBalcao]);
      await c.query("update plataforma.usuario_perfil set deleted_at = now() where usuario_id = $1 and perfil_id <> $2 and deleted_at is null", [pessoas.balcao, B.perfis.vendedorBalcao]);
      await c.query('commit');
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
    // para comparar a RN-PRO-01: o Vendedor também no perfil promotor de A (pior caso, S0-064). RN-CORE-03: o Vendedor depende do
    // Catálogo (manifesto `depende: ['core', 'catalogo']`); sem o Catálogo no perfil, modulosEfetivos tira o Vendedor em cascata
    for (const modulo of ['catalogo', 'vendedor']) {
      await api.admin.query('insert into plataforma.perfil_modulo (id, tenant_id, perfil, modulo) values ($1, $2, $3, $4)', [randomUUID(), A.tenantId, 'promotor', modulo]);
    }
  }, 180_000);
  afterAll(async () => {
    await api?.fechar();
  });

  describe.runIf(UM_PERFIL)('0069 um perfil por usuário: as combinações do MP-06 viram troca de perfil', () => {
    /** Erro do COMMIT (a exclusão é adiada): `{ code, constraint }` ou null. */
    const noCommit = async (comandos: Array<[string, unknown[]]>) => {
      const c = await api.admin.connect();
      try {
        await c.query('begin');
        for (const [sql, args] of comandos) await c.query(sql, args);
        await c.query('commit');
        return null;
      } catch (e) {
        await c.query('rollback').catch(() => undefined);
        const { code, constraint } = e as { code?: string; constraint?: string };
        return { code, constraint };
      } finally {
        c.release();
      }
    };
    const vivos = async (usuarioId: string) =>
      (
        await api.admin.query<{ codigo: string }>(
          `select p.codigo from plataforma.usuario_perfil up join plataforma.perfil p on p.id = up.perfil_id and p.tenant_id = up.tenant_id
            where up.usuario_id = $1 and up.deleted_at is null order by p.codigo`,
          [usuarioId],
        )
      ).rows.map((r) => r.codigo);
    const inserir = async (tenantId: string, usuarioId: string, perfil: string): Promise<[string, unknown[]]> => [
      'insert into plataforma.usuario_perfil (id, tenant_id, usuario_id, perfil_id) values ($1, $2, $3, $4)',
      [randomUUID(), tenantId, usuarioId, perfil],
    ];
    const apagar = (usuarioId: string, perfil: string): [string, unknown[]] => [
      'update plataforma.usuario_perfil set deleted_at = now() where usuario_id = $1 and perfil_id = $2 and deleted_at is null',
      [usuarioId, perfil],
    ];

    it('fixture: cada pessoa tem UM vínculo vivo, o do principal (o balcão, o personalizado da troca)', async () => {
      expect(await vivos(pessoas.vp)).toEqual(['vendedor']);
      expect(await vivos(pessoas.av)).toEqual(['analista']);
      expect(await vivos(pessoas.admv)).toEqual(['admin']);
      expect(await vivos(pessoas.aadm)).toEqual(['analista']);
      expect(await vivos(pessoas.balcao)).toEqual(['vendedor_balcao']);
    });

    it('troca de perfil na mesma transação (novo vínculo + deleted_at no antigo) passa; o mesmo token e o login seguem', async () => {
      const vendedor = await perfilId(A.tenantId, 'vendedor');
      const externo = await perfilId(A.tenantId, 'vendedor_externo');
      const token = await tokenDe(EM('vp'), 'campo');
      try {
        // insere antes de apagar: a exclusão adiada só confere no COMMIT
        expect(await noCommit([await inserir(A.tenantId, pessoas.vp, externo), apagar(pessoas.vp, vendedor)])).toBeNull();
        expect(await vivos(pessoas.vp)).toEqual(['vendedor_externo']);
        // mesma base (vendedor): o mesmo token segue com o Vendedor e o login do Campo entra
        expect(ids(await api.meusModulos(token))).toContain('vendedor');
        expect((await login(EM('vp'), 'campo')).statusCode).toBe(200);
      } finally {
        expect(await noCommit([await inserir(A.tenantId, pessoas.vp, vendedor), apagar(pessoas.vp, externo)])).toBeNull();
      }
      expect(await vivos(pessoas.vp)).toEqual(['vendedor']);
    });
  });

  describe.runIf(!UM_PERFIL)('multiperfil (até a 0069)', () => {
    it('fixture: os vínculos estão no banco como a API lê (perfis_do_usuario pela administração)', async () => {
      const r = await api.admin.query<{ usuario_id: string; codigos: string[] }>(
        `select up.usuario_id::text, array_agg(p.codigo order by p.codigo) as codigos
           from plataforma.usuario_perfil up join plataforma.perfil p on p.id = up.perfil_id and p.tenant_id = up.tenant_id
          where up.deleted_at is null and up.usuario_id = any($1::uuid[]) group by up.usuario_id`,
        [Object.values(pessoas)],
      );
      const por = Object.fromEntries(r.rows.map((x) => [x.usuario_id, x.codigos]));
      expect(por[pessoas.vp]).toEqual(['promotor', 'vendedor']);
      expect(por[pessoas.av]).toEqual(['analista', 'vendedor']);
      expect(por[pessoas.admv]).toEqual(['admin', 'vendedor']);
      expect(por[pessoas.balcao]).toEqual(['vendedor_balcao']);
      expect(por[pessoas.aadm]).toEqual(['admin', 'analista']);
    });

    describe('MP-06a vendedor + promotor', () => {
      it('login: Campo = 200; BKO (web) e Gestão = 403 PERFIL_FORA_DO_APP sem sessão; módulos = vendedor e promotor', async () => {
        const token = await tokenDe(EM('vp'), 'campo');
        for (const app of ['web', 'gestao'] as const) {
          const r = await login(EM('vp'), app);
          expect(`${app} ${fora(r)}`).toBe(`${app} 403 ${CODIGOS_AUTH.perfilForaDoApp}`);
          expect(r.body).not.toMatch(/access_token/);
        }
        expect(ids(await api.meusModulos(token))).toEqual(expect.arrayContaining(['core', 'vendedor', 'promotor']));
      });

      it('rotas `superficie: "bko"` = 403 PERFIL_SEM_BKO (regra mais restritiva nos acessos)', async () => {
        const token = await tokenDe(EM('vp'), 'campo');
        for (const url of ['/v1/core/usuarios', '/v1/core/licencas']) {
          expect(`${url} ${fora(await api.chamar(token, { method: 'GET', url }))}`).toBe(`${url} 403 ${CODIGO_PERFIL_SEM_BKO}`);
        }
      });

      it('RN-PRO-01 trava o PERFIL: escrita de pedido passa da permissão para vendedor + promotor (400 VALIDACAO) e é 403 PERFIL_SEM_ACESSO para o promotor sozinho, com o Vendedor licenciado nos dois', async () => {
        const rotas = escritaDePedido();
        expect(rotas.map((x) => x.r.acao)).toContain('pedido.criar');
        const vp = await tokenDe(EM('vp'), 'campo');
        const so = (await api.sessao('promotor@exemplo.com.br')).access_token;
        expect(ids(await api.meusModulos(so))).toContain('vendedor');
        for (const { modulo, r } of rotas) {
          const caso = `${r.metodo} ${modulo}/${r.caminho} (${r.acao})`;
          expect(`${caso} ${fora(await chamarRota(vp, modulo, r))}`).toBe(`${caso} 400 VALIDACAO`);
          expect(`${caso} ${fora(await chamarRota(so, modulo, r))}`).toBe(`${caso} 403 PERFIL_SEM_ACESSO`);
        }
      });

      it('coleta do Promotor passa da permissão (400 VALIDACAO); o vendedor sozinho = 403 MODULO_INATIVO (licença antes do perfil)', async () => {
        const rotas = coletas();
        expect(rotas.length).toBeGreaterThan(3);
        const vp = await tokenDe(EM('vp'), 'campo');
        const v1 = (await api.sessao('vendedor@exemplo.com.br')).access_token;
        for (const { modulo, r } of rotas) {
          const caso = `${r.metodo} ${modulo}/${r.caminho} (${r.acao})`;
          expect(`${caso} ${fora(await chamarRota(vp, modulo, r))}`).toBe(`${caso} 400 VALIDACAO`);
          expect(`${caso} ${fora(await chamarRota(v1, modulo, r))}`).toBe(`${caso} 403 MODULO_INATIVO`);
        }
      });

      it.skipIf(!!SEM_PORTAL)('portal = 401, igual a senha errada', async () => {
        const r = await entrarNoPortal(api, EM('vp'), SENHA_MP);
        const errada = await entrarNoPortal(api, EM('vp'), 'Errada#Mp06-x1');
        expect(r.statusCode).toBe(401);
        expect(r.json()).toEqual(errada.json());
      });
    });

    it('MP-06b tirar o perfil promotor vale na PRÓXIMA requisição, com o mesmo token; devolver também (ADR 0033; T-0111 critério 6)', async () => {
      const token = await tokenDe(EM('vp'), 'campo');
      const coleta = coletas()[0]!;
      expect(fora(await chamarRota(token, coleta.modulo, coleta.r))).toBe('400 VALIDACAO');
      await desvincular(A.tenantId, pessoas.vp, 'promotor');
      try {
        expect(ids(await api.meusModulos(token))).not.toContain('promotor');
        expect(fora(await chamarRota(token, coleta.modulo, coleta.r))).toBe('403 MODULO_INATIVO');
      } finally {
        await vincular(A.tenantId, pessoas.vp, 'promotor');
      }
      expect(ids(await api.meusModulos(token))).toContain('promotor');
      expect(fora(await chamarRota(token, coleta.modulo, coleta.r))).toBe('400 VALIDACAO');
    });

    describe('MP-06c analista + vendedor (ADR 0033 §7: o login confere acesso.* de TODOS os perfis)', () => {
      it('[D-MP1 corrigido] login do BKO (web) = 403 PERFIL_FORA_DO_APP sem sessão (o vendedor fecha o BKO)', async () => {
        const r = await login(EM('av'), 'web');
        expect(fora(r)).toBe(`403 ${CODIGOS_AUTH.perfilForaDoApp}`);
        expect(r.body).not.toMatch(/access_token/);
      });

      it('[D-MP1 corrigido] login do Campo = 200 (os apps somam: o vendedor entra no Campo)', async () => {
        expect((await login(EM('av'), 'campo')).statusCode).toBe(200);
      });

      it('com o token (login sem `app`), as rotas `bko` = 403 PERFIL_SEM_BKO e nada é gravado', async () => {
        const token = await tokenDe(EM('av'));
        expect(fora(await api.chamar(token, { method: 'GET', url: '/v1/core/usuarios' }))).toBe(`403 ${CODIGO_PERFIL_SEM_BKO}`);
        const r = await api.chamar(token, { method: 'POST', url: '/v1/core/usuarios', payload: { nome: 'Não Grava', email: EM('nao-grava'), perfil: 'vendedor', senha: SENHA_MP } });
        expect(fora(r)).toBe(`403 ${CODIGO_PERFIL_SEM_BKO}`);
        expect((await api.admin.query('select 1 from core.usuario where email = $1', [EM('nao-grava')])).rowCount).toBe(0);
      });
    });

    it.skipIf(!!SEM_PORTAL)('[D-MP2 corrigido] MP-06d admin + vendedor e analista + admin: o portal é só de quem é só admin (RN-CORE-35) → 401 igual a senha errada', async () => {
      for (const quem of ['admv', 'aadm'] as const) {
        const r = await entrarNoPortal(api, EM(quem), SENHA_MP);
        const errada = await entrarNoPortal(api, EM(quem), 'Errada#Mp06-x2');
        expect(`${quem} ${r.statusCode}`).toBe(`${quem} 401`);
        expect(r.json(), quem).toEqual(errada.json());
      }
    });

    it('[D-MP1 corrigido] MP-06d admin + vendedor: o login do BKO (web) = 403 PERFIL_FORA_DO_APP', async () => {
      expect(fora(await login(EM('admv'), 'web'))).toBe(`403 ${CODIGOS_AUTH.perfilForaDoApp}`);
    });

    it('MP-06d admin + vendedor com o token: rotas `bko` = 403 PERFIL_SEM_BKO (a API já lê os perfis)', async () => {
      const token = await tokenDe(EM('admv'));
      expect(fora(await api.chamar(token, { method: 'GET', url: '/v1/core/usuarios' }))).toBe(`403 ${CODIGO_PERFIL_SEM_BKO}`);
    });

  });

  it('MP-06e controle: o vendedor de B (fábrica, sem a sobreposição) entra no Campo', async () => {
    expect((await api.entrar('vendedor@exemplo.com.br', { tenant: B, app: 'campo' })).statusCode).toBe(200);
  });

  it('[D-MP1 corrigido] MP-06e perfil personalizado com acesso.campo revogado (vendedor_balcao de B): login do Campo = 403 PERFIL_FORA_DO_APP sem sessão', async () => {
    const r = await login(EM('balcao'), 'campo', B);
    expect(fora(r)).toBe(`403 ${CODIGOS_AUTH.perfilForaDoApp}`);
    expect(r.body).not.toMatch(/access_token/);
  });

  it.runIf(!UM_PERFIL)('MP-06f redefinição pelo BKO: alvo [analista (principal), admin] e [admin (principal), vendedor] = 422 SENHA_DE_ADMIN; senha, sessões e outbox intactas (P7, RN-CORE-35)', async () => {
    const estado = async (id: string) =>
      (await api.admin.query('select senha_hash, trocar_senha, senha_expira_em, sessao_versao from core.usuario where id = $1', [id])).rows[0];
    const tokenAdmin = (await api.sessao('admin@exemplo.com.br')).access_token;
    for (const [quem, id] of [['aadm', pessoas.aadm], ['admv', pessoas.admv]] as const) {
      const antes = await estado(id);
      // com a senha informada: sem a trava, a redefinição passaria (200) mesmo sem e-mail configurado neste arquivo
      const r = await api.chamar(tokenAdmin, { method: 'PUT', url: `/v1/core/usuarios/${id}/senha`, payload: { senha: 'Outra#Mp06-r1' } });
      expect(`${quem} ${fora(r)}`).toBe(`${quem} 422 SENHA_DE_ADMIN`);
      expect(await estado(id), quem).toEqual(antes);
      expect((await outboxDeEmail(api.admin)).filter((l) => l.usuario_id === id), quem).toEqual([]);
      expect((await login(EM(quem))).statusCode, `${quem} entra com a senha de antes`).toBe(200);
    }
  });
});
