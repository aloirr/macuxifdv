/**
 * T-0083 — isolamento do tenant criado pelo onboarding (RN-CORE-05 isolamento, RN-CORE-31 onboarding; desenho
 * docs/desenho/T-0083.md §6, pedido R-20261105-060620 do engenheiro-software). Matriz: docs/testes/T-0083.md.
 *
 * O tenant N sai do comando REAL `pnpm tenant:criar` (`executarTenant` de apps/api/src/cli/tenant.ts, com a política do
 * Core (POLITICA_DO_CORE), o hash argon2id de verdade e a conexão de ADMINISTRAÇÃO) sobre `plataforma.provisionar_tenant` (0029), num banco
 * efêmero com a BASE DE DEMO e a fixture dois-tenants (A e B) juntas. Depois, pela API real (createApp, 8 módulos, JWT,
 * papel macuxi_app com RLS) e direto no banco pelo papel da aplicação:
 * - com o token de N nada de A, B ou demo em clientes, usuários, licenças, parâmetros, motivos, farol, pull e auditoria;
 * - com o token de A e o da demo nada de N; o admin de N entra só no código de N (mesmo e-mail do admin de A e da demo);
 * - licenças e perfis de N = os módulos pedidos com os perfis dos manifestos (promotor nunca recebe o vendedor, RN-PRO-01);
 * - rodar o comando de novo não duplica nada em NENHUMA tabela (retrato por tenant de todo o catálogo) e não troca a senha;
 *   acrescentar um módulo só acrescenta, sem tocar A, B e demo.
 * Só roda com Postgres (CI, MACUXI_PG_EXIGIR=1); sem banco pula com aviso (sem Docker no PC, R-20261105-053835).
 */
import { randomUUID } from 'node:crypto';
import { SessaoRespostaSchema, type SessaoResposta } from '@macuxi/core/contracts';
import { hashSenha } from '@macuxi/db';
import { CODIGO_DEMO, DOIS_TENANTS, TENANT_DEMO } from '@macuxi/db/teste';
import { semBanco } from '@macuxi/db/teste/estado';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conectarBancoAdmin, executarTenant, POLITICA_DO_CORE, VAR_SENHA_ADMIN, type DepsTenant } from '../../../apps/api/src/cli/tenant';
import { MODULOS_API } from '../../../apps/api/src/modulos';
import { comToken, novoIp, SENHA } from '../apoio/api';
import { tabelasDoCatalogo, tentar, type Tabela } from '../apoio/banco';
import { SENHA_DEMO, subirApiDemo, type ApiDemo } from '../apoio/demo';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
/** Mesmo e-mail do admin de A e da demo: o login separa pelo código da empresa, nunca pelo e-mail. */
const EMAIL_N = 'admin@exemplo.com.br';
const SENHA_N = 'TenantNovo2026';
const OUTRA_SENHA = 'TenantNovo2027';
const MODULOS_N = ['core', 'catalogo', 'vendedor', 'promotor'] as const;

interface Execucao {
  status: number;
  json: Record<string, unknown>;
  texto: string;
}

describe.skipIf(semBanco())('T-0083 — tenant novo do onboarding isolado de A, B e demo (RN-CORE-05, RN-CORE-31)', () => {
  const codigoN = `onb-${randomUUID().slice(0, 8)}`;
  let api: ApiDemo;
  let tabelas: Tabela[] = [];
  let N = '';
  let tokenN = '';
  let tokenA = '';
  let tokenDemo = '';
  let primeira: Execucao;
  let retratoAntesDaPrimeira: Record<string, Record<string, number>>;
  let retratoDepoisDaPrimeira: Record<string, Record<string, number>>;

  const rodar = async (modulos: readonly string[], senha = SENHA_N, extra: string[] = []): Promise<Execucao> => {
    const saida: string[] = [];
    const erro: string[] = [];
    const deps: DepsTenant = {
      env: { NODE_ENV: 'test', [VAR_SENHA_ADMIN]: senha },
      manifestos: MODULOS_API.map((m) => m.manifesto),
      politica: POLITICA_DO_CORE,
      hashSenha,
      lerSenhaOculta: null,
      abrirBanco: () => conectarBancoAdmin(api.banco.urlAdmin, true),
      saida: (l) => saida.push(l),
      erro: (l) => erro.push(l),
    };
    const args = ['criar', '--codigo', codigoN, '--nome', 'Distribuidora do Onboarding', '--fuso', 'America/Manaus', '--modulos', modulos.join(','), '--licencas', 'vendedor=3,promotor=2', '--admin-email', EMAIL_N, '--admin-nome', 'Admin do Tenant Novo', ...extra];
    const status = await executarTenant(args, deps);
    const texto = [...saida, ...erro].join('\n');
    return { status, json: JSON.parse(saida[0] ?? 'null') as Record<string, unknown>, texto };
  };

  const login = (codigo: string, email: string, senha: string) =>
    api.app.inject({ method: 'POST', url: '/v1/auth/login', remoteAddress: novoIp(), payload: { codigo_empresa: codigo, email, senha } });
  const sessao = async (codigo: string, email: string, senha: string): Promise<SessaoResposta> => {
    const r = await login(codigo, email, senha);
    if (r.statusCode !== 200) throw new Error(`login de ${email} em ${codigo}: ${r.statusCode} ${r.body}`);
    return SessaoRespostaSchema.parse(r.json());
  };
  const get = (token: string, url: string) => api.app.inject({ method: 'GET', url, headers: comToken(token) });

  const consultar = async <T extends pg.QueryResultRow>(sql: string, valores: unknown[] = []): Promise<T[]> => (await api.admin.query<T>(sql, valores)).rows;

  /** Contagem de linhas por tenant (N, A, B, demo, outros) em TODA tabela com tenant_id, mais plataforma.tenant. */
  const retrato = async (): Promise<Record<string, Record<string, number>>> => {
    const r: Record<string, Record<string, number>> = {};
    for (const t of tabelas) {
      const linhas = await consultar<{ quem: string; n: number }>(
        `select case tenant_id when $1::uuid then 'N' when $2::uuid then 'A' when $3::uuid then 'B' when $4::uuid then 'demo' else 'outros' end as quem,
                count(*)::int as n
           from ${t.sql} group by 1`,
        [N || '00000000-0000-4000-8000-000000000000', A.tenantId, B.tenantId, TENANT_DEMO],
      );
      r[t.nome] = Object.fromEntries(linhas.map((x) => [x.quem, x.n]));
    }
    r['plataforma.tenant'] = { total: (await consultar<{ n: number }>('select count(*)::int as n from plataforma.tenant'))[0]!.n };
    return r;
  };

  /** ids (texto) de todas as tabelas com tenant_id, filtrados por tenant: `de` = só esse; `menos` = todos os outros. */
  const idsDoBanco = async (filtro: { de: string } | { menos: string }): Promise<string[]> => {
    const ids: string[] = [];
    for (const t of tabelas) {
      const onde = 'de' in filtro ? 'tenant_id = $1' : 'tenant_id is distinct from $1';
      const valor = 'de' in filtro ? filtro.de : filtro.menos;
      ids.push(...(await consultar<{ id: string }>(`select id::text as id from ${t.sql} where ${onde}`, [valor])).map((x) => x.id.toLowerCase()));
    }
    return ids;
  };

  /** O que mudou de um retrato para o outro (só as tabelas e tenants com contagem diferente). */
  const diferenca = (antes: Record<string, Record<string, number>>, depois: Record<string, Record<string, number>>) => {
    const mudou: Record<string, Record<string, number>> = {};
    for (const tabela of new Set([...Object.keys(antes), ...Object.keys(depois)])) {
      const a = antes[tabela] ?? {};
      const d = depois[tabela] ?? {};
      for (const quem of new Set([...Object.keys(a), ...Object.keys(d)])) {
        const delta = (d[quem] ?? 0) - (a[quem] ?? 0);
        if (delta !== 0) (mudou[tabela] ??= {})[quem] = delta;
      }
    }
    return mudou;
  };

  /** Rotas de leitura que o admin do tenant usa no BKO e no app (mesmas da matriz docs/testes/T-0083.md). */
  const LEITURAS = [
    '/v1/me/modulos',
    '/v1/core/licencas',
    '/v1/core/usuarios',
    '/v1/core/clientes',
    '/v1/core/carteira',
    '/v1/core/motivos',
    '/v1/core/parametros/inicio',
    '/v1/core/farol',
    '/v1/auditoria?limite=200',
    '/v1/sync/pull?entidade=cliente',
    '/v1/sync/pull?entidade=motivo',
    '/v1/sync/pull?entidade=parametro',
  ];

  const corposDe = async (token: string) => {
    const corpos: { url: string; status: number; corpo: string }[] = [];
    for (const url of LEITURAS) {
      const r = await get(token, url);
      corpos.push({ url, status: r.statusCode, corpo: r.body.toLowerCase() });
    }
    return corpos;
  };

  beforeAll(async () => {
    api = await subirApiDemo({ comDoisTenants: true });
    const c = await api.admin.connect();
    try {
      tabelas = (await tabelasDoCatalogo(c)).filter((t) => t.temTenant);
    } finally {
      c.release();
    }
    retratoAntesDaPrimeira = await retrato();
    primeira = await rodar(MODULOS_N);
    N = String(primeira.json?.tenant_id ?? '');
    retratoDepoisDaPrimeira = await retrato();
    tokenN = (await sessao(codigoN, EMAIL_N, SENHA_N)).access_token;
    tokenA = (await sessao(A.codigo, 'admin@exemplo.com.br', SENHA)).access_token;
    tokenDemo = (await sessao(CODIGO_DEMO, 'admin@exemplo.com.br', SENHA_DEMO)).access_token;
  });
  afterAll(async () => {
    await api?.fechar();
  });

  it('O-01 o comando cria o tenant N (código, fuso, módulos) e a saída não traz e-mail, senha nem hash', async () => {
    expect(primeira.status, primeira.texto).toBe(0);
    expect(primeira.json).toMatchObject({ codigo: codigoN, resultado: 'criado', admin: 'criado', admin_email: 'a***@exemplo.com.br' });
    expect([...(primeira.json.modulos_adicionados as string[])].sort()).toEqual([...MODULOS_N].sort());
    expect(primeira.texto).not.toContain(EMAIL_N);
    expect(primeira.texto).not.toContain(SENHA_N);
    expect(primeira.texto).not.toMatch(/\$argon2/);
    const t = await consultar<{ codigo: string; fuso: string; status: string }>('select codigo, fuso, status from plataforma.tenant where id = $1', [N]);
    expect(t).toEqual([{ codigo: codigoN, fuso: 'America/Manaus', status: 'ativo' }]);
    expect([N, A.tenantId, B.tenantId, TENANT_DEMO].length).toBe(new Set([N, A.tenantId, B.tenantId, TENANT_DEMO]).size);
  });

  it('O-01b criar N só grava linhas de N: nenhuma contagem de A, B ou demo muda em nenhuma tabela', () => {
    const mudou = diferenca(retratoAntesDaPrimeira, retratoDepoisDaPrimeira);
    const foraDeN = Object.entries(mudou)
      .filter(([tabela]) => tabela !== 'plataforma.tenant')
      .flatMap(([tabela, porTenant]) => Object.keys(porTenant).filter((q) => q !== 'N').map((q) => `${tabela}:${q}`));
    expect(foraDeN).toEqual([]);
    expect(mudou['plataforma.tenant']).toEqual({ total: 1 });
    for (const t of ['plataforma.tenant_modulo', 'plataforma.perfil_modulo', 'core.usuario', 'plataforma.auditoria', 'core.motivo']) {
      expect(retratoDepoisDaPrimeira[t]?.N ?? 0, `${t} de N`).toBeGreaterThan(0);
    }
    expect(retratoDepoisDaPrimeira['core.usuario']?.N).toBe(1);
    expect(retratoDepoisDaPrimeira['plataforma.auditoria']?.N).toBe(1);
  });

  it('O-02 licenças: só os módulos pedidos, com o teto informado, e os perfis padrão dos manifestos (RN-CORE-31 item 1; RN-PRO-01)', async () => {
    const tm = await consultar<{ modulo: string; ativo: boolean; licencas: number | null }>(
      'select modulo, ativo, licencas from plataforma.tenant_modulo where tenant_id = $1 and deleted_at is null order by modulo',
      [N],
    );
    expect(tm).toEqual(
      [...MODULOS_N].sort().map((modulo) => ({ modulo, ativo: true, licencas: modulo === 'vendedor' ? 3 : modulo === 'promotor' ? 2 : null })),
    );
    const pm = await consultar<{ perfil: string; modulo: string }>(
      'select perfil, modulo from plataforma.perfil_modulo where tenant_id = $1 and deleted_at is null order by modulo, perfil',
      [N],
    );
    const esperado = MODULOS_API.map((m) => m.manifesto)
      .filter((m) => (MODULOS_N as readonly string[]).includes(m.id))
      .flatMap((m) => [...new Set(m.perfis)].map((perfil) => ({ perfil, modulo: m.id })))
      .sort((x, y) => (x.modulo + x.perfil < y.modulo + y.perfil ? -1 : x.modulo + x.perfil > y.modulo + y.perfil ? 1 : 0));
    expect(pm).toEqual(esperado);
    expect(pm.filter((x) => x.perfil === 'promotor' && x.modulo === 'vendedor'), 'RN-PRO-01').toEqual([]);

    // pela API: o painel de licenças e os módulos efetivos do admin de N
    const lic = await get(tokenN, '/v1/core/licencas');
    expect(lic.statusCode, lic.body).toBe(200);
    const tenantLic = (lic.json() as { tenant: Record<string, boolean> }).tenant;
    expect(Object.entries(tenantLic).filter(([, ativo]) => ativo).map(([m]) => m).sort()).toEqual([...MODULOS_N].sort());
    expect((await api.meusModulos(tokenN)).modulos.map((m) => m.id).sort()).toEqual([...MODULOS_N].sort());
  });

  it('O-03 módulo não contratado fica fechado no tenant N (403 MODULO_INATIVO)', async () => {
    const r = await get(tokenN, '/v1/auditoria?modulo=gestor');
    expect([r.statusCode, (r.json() as { codigo?: string }).codigo]).toEqual([403, 'MODULO_INATIVO']);
  });

  it('O-04 o admin de N entra só no código de N; o mesmo e-mail em A e na demo segue com a senha de lá (RN-CORE-05)', async () => {
    const s = await sessao(codigoN, EMAIL_N, SENHA_N);
    expect(s.tenant).toMatchObject({ id: N, codigo: codigoN, fuso: 'America/Manaus' });
    expect(s.usuario).toMatchObject({ perfil: 'admin' });
    // senha de N em outro código: recusa (mesmo e-mail existe lá)
    for (const codigo of [A.codigo, B.codigo, CODIGO_DEMO]) expect((await login(codigo, EMAIL_N, SENHA_N)).statusCode, codigo).toBe(401);
    // senhas de A/B/demo no código de N: recusa
    for (const [email, senha] of [
      ['admin@exemplo.com.br', SENHA],
      ['admin@exemplo.com.br', SENHA_DEMO],
      ['vendedor@exemplo.com.br', SENHA],
      ['vendedor@exemplo.com.br', SENHA_DEMO],
      ['admin.b@exemplo.com.br', SENHA],
    ] as const) {
      expect((await login(codigoN, email, senha)).statusCode, `${email} no código de N`).toBe(401);
    }
    // os admins de A e da demo continuam entrando nos próprios tenants
    expect((await sessao(A.codigo, 'admin@exemplo.com.br', SENHA)).tenant.id).toBe(A.tenantId);
    expect((await sessao(CODIGO_DEMO, 'admin@exemplo.com.br', SENHA_DEMO)).tenant.id).toBe(TENANT_DEMO);
  });

  it('O-05 com o token de N nada de A, B ou demo em clientes, usuários, licenças, parâmetros, motivos, farol, pull e auditoria', async () => {
    const alheios = new Set(await idsDoBanco({ menos: N }));
    alheios.add(A.tenantId);
    alheios.add(B.tenantId);
    alheios.add(TENANT_DEMO);
    expect(alheios.size).toBeGreaterThan(100); // a base demo e a fixture estão lá: o teste não passa no vazio
    for (const { url, status, corpo } of await corposDe(tokenN)) {
      expect(status, `${url}: ${corpo.slice(0, 300)}`).toBe(200);
      const achados = [...corpo.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)].map((m) => m[0]).filter((id) => alheios.has(id));
      expect(achados, `${url} com id de outro tenant`).toEqual([]);
    }
    // conteúdo próprio: N tem só o admin e nenhum cliente
    const usuarios = await get(tokenN, '/v1/core/usuarios');
    const meuAdmin = (await consultar<{ id: string }>('select id::text as id from core.usuario where tenant_id = $1', [N])).map((x) => x.id);
    expect(meuAdmin).toHaveLength(1);
    expect(usuarios.body).toContain(meuAdmin[0]!);
    const pull = await get(tokenN, '/v1/sync/pull?entidade=cliente');
    expect((pull.json() as { itens: unknown[] }).itens).toEqual([]);
    // auditoria: só linhas de N, entre elas a do provisionamento
    const aud = await get(tokenN, '/v1/auditoria?limite=200');
    const itens = (aud.json() as { itens: { id: string; acao: string }[] }).itens;
    const deN = new Set(await idsDoBanco({ de: N }));
    expect(itens.filter((i) => !deN.has(i.id.toLowerCase())), 'linha de auditoria de outro tenant').toEqual([]);
    expect(itens.map((i) => i.acao)).toContain('tenant.provisionar');
  });

  it('O-06 com o token de A e o da demo nada de N (o tenant novo não aparece nos tenants que já existiam)', async () => {
    const deN = new Set(await idsDoBanco({ de: N }));
    deN.add(N);
    expect(deN.size).toBeGreaterThan(5); // tenant, módulos, perfis, admin, auditoria, motivos de sistema
    for (const [rotulo, token] of [
      ['A', tokenA],
      ['demo', tokenDemo],
    ] as const) {
      for (const { url, status, corpo } of await corposDe(token)) {
        expect(status, `${rotulo} ${url}: ${corpo.slice(0, 300)}`).toBe(200);
        const achados = [...corpo.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)].map((m) => m[0]).filter((id) => deN.has(id));
        expect(achados, `${rotulo} ${url} com id de N`).toEqual([]);
        expect(corpo, `${rotulo} ${url}`).not.toContain(codigoN);
      }
    }
    // controle positivo: o pull de A traz os clientes de A (a leitura não está vazia por outro motivo)
    const pullA = await get(tokenA, '/v1/sync/pull?entidade=cliente');
    expect((pullA.json() as { itens: { id: string }[] }).itens.map((i) => i.id).sort()).toEqual([A.clientes.c1, A.clientes.c2, A.clientes.c3].sort());
  });

  it('O-07 RLS no papel da aplicação: no contexto de N, só linhas de N em toda tabela; nos de A, B e demo, nenhuma de N', async () => {
    const c = await api.pool.connect();
    try {
      for (const t of tabelas) {
        const deN = (await consultar<{ id: string }>(`select id::text as id from ${t.sql} where tenant_id = $1 order by id`, [N])).map((x) => x.id);
        const vistoN = await tentar(c, N, async () => (await c.query<{ id: string }>(`select id::text as id from ${t.sql} order by id`)).rows.map((x) => x.id));
        expect(vistoN, `${t.nome} no contexto de N`).toEqual({ ok: true, valor: deN });
        for (const outro of [A.tenantId, B.tenantId, TENANT_DEMO]) {
          const r = await tentar(c, outro, async () => (await c.query<{ n: number }>(`select count(*)::int as n from ${t.sql} where tenant_id = $1`, [N])).rows[0]!.n);
          expect(r, `${t.nome}: linha de N visível no contexto ${outro}`).toEqual({ ok: true, valor: 0 });
        }
      }
      for (const ctx of [N, A.tenantId, TENANT_DEMO]) {
        const r = await tentar(c, ctx, async () => (await c.query<{ id: string }>('select id::text as id from plataforma.tenant')).rows.map((x) => x.id));
        expect(r, `plataforma.tenant no contexto ${ctx}`).toEqual({ ok: true, valor: [ctx] });
      }
    } finally {
      c.release();
    }
  });

  it('O-08 tenant_por_codigo (login, sem contexto) devolve só o tenant do código pedido', async () => {
    const porCodigo = async (codigo: string) => (await api.pool.query<{ id: string }>('select id::text as id from plataforma.tenant_por_codigo($1)', [codigo])).rows.map((x) => x.id);
    expect(await porCodigo(codigoN)).toEqual([N]);
    expect(await porCodigo(codigoN.toUpperCase())).toEqual([N]);
    expect(await porCodigo(A.codigo)).toEqual([A.tenantId]);
    expect(await porCodigo(CODIGO_DEMO)).toEqual([TENANT_DEMO]);
    for (const curinga of ['onb-%', 'onb-_%', `${codigoN}%`, '%']) expect(await porCodigo(curinga), curinga).toEqual([]);
  });

  it('O-09 idempotência: 2ª execução igual = sem_mudanca, nenhuma linha a mais em nenhuma tabela, senha do admin intacta', async () => {
    // retrato tirado agora (os logins dos casos anteriores gravam sessão/tentativa): entre ele e o 2º retrato só o comando roda
    const antes = await retrato();
    // outra senha no ambiente SEM --redefinir-senha: a senha do admin não muda (RN-CORE-31 item 4)
    const r = await rodar(MODULOS_N, OUTRA_SENHA);
    expect(r.status, r.texto).toBe(0);
    expect(r.json).toMatchObject({ tenant_id: N, resultado: 'sem_mudanca', admin: 'existente', modulos_adicionados: [] });
    expect(await retrato()).toEqual(antes);
    // 3ª execução com a senha original: segue sem mudança (a chave é o código)
    const deNovo = await rodar(MODULOS_N);
    expect(deNovo.json).toMatchObject({ tenant_id: N, resultado: 'sem_mudanca', admin: 'existente' });
    expect(await retrato()).toEqual(antes);
    expect((await login(codigoN, EMAIL_N, SENHA_N)).statusCode).toBe(200);
    expect((await login(codigoN, EMAIL_N, OUTRA_SENHA)).statusCode).toBe(401);
  });

  it('O-10 acrescentar um módulo só mexe em N (licença, perfis e uma auditoria) e repetir não duplica', async () => {
    const antes = await retrato();
    const r = await rodar([...MODULOS_N, 'gestor']);
    expect(r.json).toMatchObject({ tenant_id: N, resultado: 'atualizado', admin: 'existente', modulos_adicionados: ['gestor'] });
    const depois = await retrato();
    const perfisGestor = new Set(MODULOS_API.find((m) => m.manifesto.id === 'gestor')!.manifesto.perfis).size;
    expect(diferenca(antes, depois)).toEqual({
      'plataforma.tenant_modulo': { N: 1 },
      'plataforma.perfil_modulo': { N: perfisGestor },
      'plataforma.auditoria': { N: 1 },
    });
    const repetida = await rodar([...MODULOS_N, 'gestor']);
    expect(repetida.json).toMatchObject({ resultado: 'sem_mudanca', modulos_adicionados: [] });
    expect(await retrato()).toEqual(depois);
    expect((await api.meusModulos(tokenN)).modulos.map((m) => m.id)).toContain('gestor');
  });
});
