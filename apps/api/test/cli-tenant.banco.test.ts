/**
 * `pnpm tenant:criar` × Postgres real (RN-CORE-31, desenho T-0083 §6): o comando sobre `plataforma.provisionar_tenant`
 * (0029, banco-dados) pela conexão de administração. Idempotente pelo código; `--simular` não grava; ao banco vai só o
 * hash; a saída não traz o e-mail. Os testes da função em si (contagens, 42501 do app/worker) são do banco-dados.
 * Cada execução usa um código próprio e apaga o tenant no fim (excluir_tenant, 0024).
 * Pula sem Docker/Postgres (aviso no fim); com MACUXI_PG_EXIGIR=1 (CI) falha.
 */
import { randomUUID } from 'node:crypto';
import { hashSenha, verificarSenha } from '@macuxi/db';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conectarBancoAdmin, executarTenant, VAR_SENHA_ADMIN, type DepsTenant } from '../src/cli/tenant';
import { MODULOS_API } from '../src/modulos';

const SENHA = 'SenhaDoAdmin2026';
const NOVA = 'OutraSenha2027';

describe.skipIf(semBanco())('pnpm tenant:criar × Postgres (RN-CORE-31)', () => {
  const codigo = `onb-${randomUUID().slice(0, 8)}`;
  const email = `admin.${codigo}@exemplo.com.br`;
  let admin: pg.Client;

  const rodar = async (extra: string[] = [], senha = SENHA, modulos = 'catalogo') => {
    const saida: string[] = [];
    const erro: string[] = [];
    const deps: DepsTenant = {
      env: { [VAR_SENHA_ADMIN]: senha },
      manifestos: MODULOS_API.map((m) => m.manifesto),
      politica: { normalizarEmail: (e) => e.trim().toLowerCase(), validarSenhaInicial: () => null },
      hashSenha,
      lerSenhaOculta: null,
      abrirBanco: () => conectarBancoAdmin(banco().urlAdmin, true),
      saida: (l) => saida.push(l),
      erro: (l) => erro.push(l),
    };
    const args = ['criar', '--codigo', codigo, '--nome', 'Tenant do onboarding', '--modulos', modulos, '--admin-email', email, '--admin-nome', 'Admin Teste', ...extra];
    const status = await executarTenant(args, deps);
    expect(erro, erro.join('\n')).toEqual([]);
    expect([...saida, ...erro].join('\n')).not.toContain(email);
    return { status, json: JSON.parse(saida[0] ?? 'null') as Record<string, unknown> };
  };

  const contagens = async () => {
    const r = await admin.query<{ t: string; n: string }>(
      `select 'tenant' t, count(*)::text n from plataforma.tenant where lower(codigo) = $1
       union all select 'tenant_modulo', count(*)::text from plataforma.tenant_modulo m join plataforma.tenant t on t.id = m.tenant_id where t.codigo = $1
       union all select 'perfil_modulo', count(*)::text from plataforma.perfil_modulo m join plataforma.tenant t on t.id = m.tenant_id where t.codigo = $1
       union all select 'usuario', count(*)::text from core.usuario u join plataforma.tenant t on t.id = u.tenant_id where t.codigo = $1
       union all select 'auditoria', count(*)::text from plataforma.auditoria a join plataforma.tenant t on t.id = a.tenant_id where t.codigo = $1
       union all select 'parametro', count(*)::text from plataforma.parametro p join plataforma.tenant t on t.id = p.tenant_id where t.codigo = $1`,
      [codigo],
    );
    return Object.fromEntries(r.rows.map((x) => [x.t, Number(x.n)]));
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });

  afterAll(async () => {
    if (!admin) return;
    const t = await admin.query<{ id: string }>('select id from plataforma.tenant where codigo = $1', [codigo]);
    if (t.rows[0]) {
      await admin.query("update plataforma.tenant set status = 'encerrado' where id = $1", [t.rows[0].id]);
      await admin.query('select * from plataforma.excluir_tenant($1, $2)', [t.rows[0].id, codigo]);
    }
    await admin.end();
  });

  it('--simular mostra o plano e não grava nada', async () => {
    const r = await rodar(['--simular']);
    expect(r.status).toBe(0);
    expect(r.json).toMatchObject({ resultado: 'criado', admin: 'criado', simulado: true });
    expect((await contagens()).tenant).toBe(0);
  });

  it('cria tenant, licenças com perfis do manifesto e admin com hash; 2ª rodada não duplica; módulo novo só acrescenta', async () => {
    const r1 = await rodar();
    expect(r1.status).toBe(0);
    expect(r1.json).toMatchObject({ codigo, resultado: 'criado', admin: 'criado', admin_email: `a***@exemplo.com.br` });
    expect([...(r1.json.modulos_adicionados as string[])].sort()).toEqual(['catalogo', 'core']);
    const depois1 = await contagens();
    expect(depois1).toMatchObject({ tenant: 1, tenant_modulo: 2, usuario: 1, auditoria: 1 });

    const u = await admin.query<{ senha_hash: string; perfil: string }>(
      'select u.senha_hash, u.perfil from core.usuario u join plataforma.tenant t on t.id = u.tenant_id where t.codigo = $1',
      [codigo],
    );
    expect(u.rows[0]!.perfil).toBe('admin');
    expect(u.rows[0]!.senha_hash).toMatch(/^\$argon2id\$/);
    expect(verificarSenha(SENHA, u.rows[0]!.senha_hash)).toBe(true);

    const r2 = await rodar();
    expect(r2.json).toMatchObject({ resultado: 'sem_mudanca', admin: 'existente', modulos_adicionados: [] });
    expect(await contagens()).toEqual(depois1);
    const u2 = await admin.query<{ senha_hash: string }>('select u.senha_hash from core.usuario u join plataforma.tenant t on t.id = u.tenant_id where t.codigo = $1', [codigo]);
    expect(u2.rows[0]!.senha_hash).toBe(u.rows[0]!.senha_hash);

    const r3 = await rodar([], SENHA, 'catalogo,vendedor');
    expect(r3.json).toMatchObject({ resultado: 'atualizado', admin: 'existente', modulos_adicionados: ['vendedor'] });
    const depois3 = await contagens();
    expect(depois3.tenant_modulo).toBe(3);
    expect(depois3.perfil_modulo).toBeGreaterThan(depois1.perfil_modulo!);
    expect(depois3.auditoria).toBe(2);
  });

  it('--redefinir-senha troca só o hash', async () => {
    const r = await rodar(['--redefinir-senha'], NOVA);
    expect(r.json).toMatchObject({ resultado: 'atualizado', admin: 'senha_redefinida' });
    const u = await admin.query<{ senha_hash: string }>('select u.senha_hash from core.usuario u join plataforma.tenant t on t.id = u.tenant_id where t.codigo = $1', [codigo]);
    expect(verificarSenha(NOVA, u.rows[0]!.senha_hash)).toBe(true);
  });
});
