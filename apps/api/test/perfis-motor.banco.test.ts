/**
 * ADR 0073, etapas E4 e E6 × Postgres real (fixture dois-tenants, papel macuxi_app, RLS): a fonte das licenças lê a marca do tenant
 * (`plataforma.catalogo_aplicado`) e, só no motor 'cargo', o perfil sem base do usuário (cargo + `plataforma.perfil_concessao`).
 * Depois da 0108 todo tenant fica em 'legado' (motor novo desligado na v1.0.37): os casos de tenant migrado forçam 'concessao'.
 * - RN-CORE-35: num tenant migrado, cada usuário tem o MESMO acesso nos dois motores (`diferencasEntreMotores` vazio) e o cargo
 *   do perfil é o da base;
 * - tenant em 'legado' (o padrão) segue o motor antigo (o perfil sem base nem é lido);
 * - ponta a ponta: a concessão desmarcada no banco recusa a rota no 'cargo' (403) e não muda nada no 'legado' (201).
 * - E6 (0109, `plataforma.perfil_do_usuario`): a mesma API com um tenant em 'concessao' e outro em 'legado'; RN-PRO-01 pelo
 *   cargo; licença antes da permissão (RN-CORE-02); escopo de carteira pela base congelada (RN-CORE-04); isolamento entre tenants.
 * Cada caso roda numa transação desfeita no fim (ROLLBACK), com o papel macuxi_app e o tenant da requisição.
 * Pula sem Postgres (aviso no fim); com MACUXI_PG_EXIGIR=1 (CI) falha.
 */
import { DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import {
  camposPeloCargo,
  cargoDaBase,
  diferencasEntreMotores,
  matrizDeFabrica,
  resolverPerfil,
  type AcessoBanco,
  type ClienteBanco,
  type UsuarioAutenticado,
} from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { licencasDoBanco, motorDoTenant } from '../src/licencas';
import { MODULOS_API } from '../src/modulos';
import { bancoFalso, CLIENTE_DA_CARTEIRA, modulosDeTeste } from './apoio';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const MATRIZ = matrizDeFabrica(MODULOS_API.map((m) => m.manifesto));

type Preparo = (c: pg.ClientBase) => Promise<unknown>;

/** `AcessoBanco` numa transação desfeita: o `preparo` roda como admin, o resto como macuxi_app com o tenant da requisição. */
function acessoEmRollback(c: pg.ClientBase, preparo: Preparo = async () => undefined): AcessoBanco {
  return {
    comTenant: async (tenantId, fn) => {
      await c.query('begin');
      try {
        await preparo(c);
        await c.query('set local role macuxi_app');
        await c.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
        return await fn(c as unknown as ClienteBanco);
      } finally {
        await c.query('rollback');
      }
    },
    semTenant: async () => {
      throw new Error('não usado neste teste');
    },
  };
}

const naLeitura = (tenant: string, leitura: 'legado' | 'concessao'): Preparo => (c) =>
  c.query('update plataforma.catalogo_aplicado set leitura = $2 where tenant_id = $1 and deleted_at is null', [tenant, leitura]);

/** Desmarca uma chave no perfil vivo do usuário (soft delete da concessão), como faria a API nova de perfis. */
const desmarcar = (usuario: string, chave: string): Preparo => (c) =>
  c.query(
    `update plataforma.perfil_concessao c set deleted_at = now()
       from plataforma.usuario_perfil up
      where up.usuario_id = $1 and up.deleted_at is null and c.tenant_id = up.tenant_id and c.perfil_id = up.perfil_id
        and c.chave = $2 and c.deleted_at is null`,
    [usuario, chave],
  );

const tokenDe = (id: string, tenant_id: string): UsuarioAutenticado => ({ id, tenant_id, perfil: 'vendedor' });

describe.skipIf(semBanco())('motor da permissão × Postgres (ADR 0073 E4)', () => {
  let admin: pg.Client;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });

  it('RN-CORE-35: tenant migrado — cada usuário com o mesmo acesso nos dois motores e o cargo da base', async () => {
    const casos = [
      ...Object.values(A.usuarios).map((id) => tokenDe(id, A.tenantId)),
      ...Object.values(B.usuarios).map((id) => tokenDe(id, B.tenantId)),
    ];
    for (const token of casos) {
      const lic = await licencasDoBanco(token, acessoEmRollback(admin, naLeitura(token.tenant_id, 'concessao')));
      expect(motorDoTenant(lic.catalogo), token.id).toBe('cargo');
      expect(lic.perfilPorCargo, token.id).toBeTruthy();
      const antigos = (lic.perfis ?? []).map((p) => resolverPerfil(p, MATRIZ));
      expect(antigos, token.id).toHaveLength(1);
      const { cargo, perfil_acesso } = camposPeloCargo(lic.perfilPorCargo);
      expect(cargo, token.id).toBe(cargoDaBase(antigos[0]!.base));
      expect(perfil_acesso?.codigo, token.id).toBe(antigos[0]!.codigo);
      expect(diferencasEntreMotores(antigos, perfil_acesso), token.id).toEqual([]);
    }
  });

  it("tenant em 'legado' (o padrão depois da 0108) segue o motor antigo: o perfil sem base nem é lido", async () => {
    const lic = await licencasDoBanco(tokenDe(B.usuarios.vendedor, B.tenantId), acessoEmRollback(admin));
    expect(lic.catalogo).toEqual({ versao: 2, leitura: 'legado' });
    expect(motorDoTenant(lic.catalogo)).toBe('base');
    expect(lic).not.toHaveProperty('perfilPorCargo');
    expect(lic.perfis?.map((p) => p.base)).toEqual(['vendedor']);
  });

  it("ponta a ponta: concessão desmarcada recusa no 'cargo' (403) e não muda o 'legado' (201)", async () => {
    const vendedor1 = tokenDe(A.usuarios.vendedor1, A.tenantId);
    const montar = (preparo: Preparo) => {
      const app = createApp({
        banco: bancoFalso().banco,
        modulos: modulosDeTeste(),
        autenticar: async () => vendedor1,
        carteira: async () => new Set([CLIENTE_DA_CARTEIRA]),
        licencas: (u) => licencasDoBanco(u, acessoEmRollback(admin, preparo)),
      });
      return { app };
    };
    const criar = (app: ReturnType<typeof createApp>) =>
      app.inject({
        method: 'POST',
        url: '/v1/vendedor/pedidos',
        payload: { id: '0e000000-0000-4000-8000-0000000000e4', cliente_id: CLIENTE_DA_CARTEIRA, total_centavos: 100 },
      });

    const intacto = montar(async () => undefined);
    expect((await criar(intacto.app)).statusCode).toBe(201);

    const semCriar = desmarcar(vendedor1.id, 'pedido.criar');
    const migrado = montar(async (c) => {
      await semCriar(c);
      await naLeitura(A.tenantId, 'concessao')(c);
    });
    const r = await criar(migrado.app);
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe('PERFIL_SEM_ACESSO');

    const legado = montar(semCriar);
    expect((await criar(legado.app)).statusCode).toBe(201);
    await Promise.all([intacto.app.close(), migrado.app.close(), legado.app.close()]);
  });
  describe('E6: o motor por concessão decide no tenant em concessao (0109, plataforma.perfil_do_usuario)', () => {
    const FORA = '0c000000-0000-4000-8000-0000000000ff';
    /** App com a fonte real (`licencasDoBanco`); o token vem do cabeçalho `x-quem` (`tenant:usuario:perfil`). */
    const montar = (preparo: Preparo) =>
      createApp({
        banco: bancoFalso().banco,
        modulos: modulosDeTeste(),
        autenticar: async (h) => {
          const [tenant_id, id, perfil] = String(h['x-quem'] ?? '').split(':');
          return tenant_id && id ? { id, tenant_id, perfil: (perfil || 'vendedor') as UsuarioAutenticado['perfil'] } : null;
        },
        carteira: async (u) => (u.perfil === 'analista' ? ('tenant' as const) : new Set([CLIENTE_DA_CARTEIRA])),
        licencas: (u) => licencasDoBanco(u, acessoEmRollback(admin, preparo)),
      });
    const criar = (app: ReturnType<typeof createApp>, quem: string, cliente = CLIENTE_DA_CARTEIRA) =>
      app.inject({
        method: 'POST',
        url: '/v1/vendedor/pedidos',
        headers: { 'x-quem': quem },
        payload: { id: '0e000000-0000-4000-8000-0000000000e6', cliente_id: cliente, total_centavos: 100 },
      });
    const vendedorA = `${A.tenantId}:${A.usuarios.vendedor1}`;
    const vendedorB = `${B.tenantId}:${B.usuarios.vendedor}`;
    const juntos = (...ps: Preparo[]): Preparo => async (c) => {
      for (const p of ps) await p(c);
    };

    it('perfil_do_usuario dá o código, o cargo, a base congelada e as concessões (iguais ao motor antigo no tenant recém-ligado)', async () => {
      const lic = await licencasDoBanco(tokenDe(A.usuarios.promotor, A.tenantId), acessoEmRollback(admin, naLeitura(A.tenantId, 'concessao')));
      expect(lic.perfilPorCargo).toMatchObject({ codigo: 'promotor', cargo: 'promotor', base: 'promotor' });
      const antigos = (lic.perfis ?? []).map((p) => resolverPerfil(p, MATRIZ));
      expect(diferencasEntreMotores(antigos, camposPeloCargo(lic.perfilPorCargo).perfil_acesso)).toEqual([]);
    });

    it('a mesma API com A em concessao e B em legado: a concessão desmarcada vale só em A', async () => {
      const app = montar(juntos(desmarcar(A.usuarios.vendedor1, 'pedido.criar'), desmarcar(B.usuarios.vendedor, 'pedido.criar'), naLeitura(A.tenantId, 'concessao')));
      const r = await criar(app, vendedorA);
      expect(r.statusCode).toBe(403);
      expect(r.json().codigo).toBe('PERFIL_SEM_ACESSO');
      expect((await criar(app, vendedorB)).statusCode).toBe(201);
      await app.close();
    });

    it('RN-PRO-01 pelo cargo: o perfil de cargo promotor não cria pedido, mesmo com o token de vendedor e a licença', async () => {
      // o perfil promotor com o Vendedor (e o Catálogo, de que ele depende) nos módulos: a licença passa e a barreira é a do cargo
      const comVendedor: Preparo = (c) =>
        c.query(
          "insert into plataforma.perfil_modulo (tenant_id, perfil, modulo) select $1, 'promotor', m from unnest(array['vendedor', 'catalogo']) m on conflict do nothing",
          [A.tenantId],
        );
      const app = montar(juntos(comVendedor, naLeitura(A.tenantId, 'concessao')));
      const r = await criar(app, `${A.tenantId}:${A.usuarios.promotor}:vendedor`);
      expect(r.statusCode).toBe(403);
      expect(r.json().codigo).toBe('PERFIL_SEM_ACESSO');
      expect((await criar(app, vendedorA)).statusCode).toBe(201);
      await app.close();
    });

    it('RN-CORE-02: a licença do módulo vem antes da permissão (módulo removido do usuário = MODULO_INATIVO)', async () => {
      const semModulo: Preparo = (c) =>
        c.query("insert into plataforma.usuario_modulo (tenant_id, usuario_id, modulo) values ($1, $2, 'vendedor')", [A.tenantId, A.usuarios.vendedor1]);
      const app = montar(juntos(semModulo, desmarcar(A.usuarios.vendedor1, 'pedido.criar'), naLeitura(A.tenantId, 'concessao')));
      const r = await criar(app, vendedorA);
      expect(r.statusCode).toBe(403);
      expect(r.json().codigo).toBe('MODULO_INATIVO');
      await app.close();
    });

    it('RN-CORE-04: o escopo de carteira sai da base congelada do perfil no banco, não do perfil do token', async () => {
      const comoAnalista = `${vendedorA}:analista`;
      const concessao = montar(naLeitura(A.tenantId, 'concessao'));
      expect((await criar(concessao, comoAnalista)).statusCode).toBe(201);
      const r = await criar(concessao, comoAnalista, FORA);
      expect(r.statusCode).toBe(403);
      expect(r.json().codigo).toBe('FORA_DA_CARTEIRA');
      const legado = montar(async () => undefined);
      expect((await criar(legado, comoAnalista, FORA)).statusCode).toBe(201);
      await Promise.all([concessao.close(), legado.close()]);
    });

    it('isolamento: o usuário de B com o tenant de A não tem perfil (RLS de perfil_do_usuario) e nada passa', async () => {
      const lic = await licencasDoBanco(tokenDe(B.usuarios.vendedor, A.tenantId), acessoEmRollback(admin, naLeitura(A.tenantId, 'concessao')));
      expect(motorDoTenant(lic.catalogo)).toBe('cargo');
      expect(lic.perfilPorCargo).toBeNull();
      const app = montar(naLeitura(A.tenantId, 'concessao'));
      const r = await criar(app, `${A.tenantId}:${B.usuarios.vendedor}`);
      expect(r.statusCode).toBe(403);
      await app.close();
    });
  });
});
