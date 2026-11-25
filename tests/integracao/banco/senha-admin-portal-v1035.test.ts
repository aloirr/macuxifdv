/**
 * v1.0.35, item 3 — troca da senha do ADMIN DO CLIENTE pela sessão do portal (0107_plataforma_senha_admin_portal; dicionário
 * docs/banco/plataforma.md, "Senha do admin do cliente no portal (0107)"; RN-CORE-01: 5 falhas seguidas = 15 min).
 * Cenários do agente `testes`, independentes de db/testes/senha-admin-portal.db.test.ts (do banco-dados):
 *  - SA-01 sessão com duas empresas: a função age só na conta da empresa ESCOLHIDA; a outra fica intacta;
 *  - SA-02 bloqueio vencido recomeça a contagem: 4 falhas não bloqueiam; a 5ª bloqueia exatamente now() + 15 min;
 *  - SA-03 hash atual divergente com a conta bloqueada = false e não destrava (falhas, bloqueio e sessão ficam);
 *  - SA-04 conta desativada, perfil trocado ou senha a trocar = 28000 nas 3 (a sessão cai na hora) e nada muda;
 *  - SA-05 senha temporária pendente ("esqueci a senha") sai com a troca, junto com falhas e bloqueio;
 *  - SA-06 macuxi_app (e macuxi_worker, se houver a senha) = 42501 nas 3, com conexão real do papel.
 * As chamadas do portal rodam como macuxi_portal (set local role) na mesma transação da preparação; tudo SEMPRE desfeito
 * (rollback): o banco compartilhado do globalSetup não muda. Roda só com banco; sem banco, pula.
 */
import { DOIS_TENANTS, PAPEL_PORTAL } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conectar, tentar } from '../apoio/banco';

const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const ADMIN_A = DOIS_TENANTS.A.usuarios.admin;
const ADMIN_B = DOIS_TENANTS.B.usuarios.admin;
const HASH_NOVO = '$argon2id$v=19$m=1,t=1,p=1$c2EwMQ$c2VuaGFub3Zh';
const HASH_TEMP = '$argon2id$v=19$m=1,t=1,p=1$dGVtcA$dGVtcG9yYXJpYQ';
const HASH_ERRADO = '$argon2id$v=19$m=1,t=1,p=1$ZXJy$ZXJyYWRv';

interface Conta {
  senha_hash: string;
  tentativas_falhas: number;
  bloqueio_ate: Date | null;
  sessao_versao: number;
  trocar_senha: boolean;
  senha_temporaria_hash: string | null;
  senha_temporaria_expira_em: Date | null;
  senha_temporaria_criada_em: Date | null;
}
interface Estado {
  falhas: number;
  bloqueado_ate: Date | null;
}

describe.skipIf(semBanco())('v1.0.35 item 3: senha do admin do cliente no portal (0107)', () => {
  let admin: pg.Client;

  beforeAll(async () => {
    admin = await conectar(banco().urlAdmin);
  });
  afterAll(async () => {
    await admin?.end();
  });

  const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await admin.query<T>(sql, params)).rows;

  /** Como macuxi_portal, num savepoint: o erro vira { codigo } sem abortar a transação do caso. */
  async function portal<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<{ linhas: T[] } | { codigo: string }> {
    await admin.query('savepoint sa_portal');
    try {
      await admin.query(`set local role ${PAPEL_PORTAL}`);
      const r = await admin.query<T>(sql, params);
      await admin.query('reset role');
      await admin.query('release savepoint sa_portal');
      return { linhas: r.rows };
    } catch (e) {
      await admin.query('rollback to savepoint sa_portal');
      await admin.query('reset role');
      return { codigo: (e as { code?: string }).code ?? '?' };
    }
  }
  async function ok<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    const r = await portal<T>(sql, params);
    if ('codigo' in r) throw new Error(`esperava sucesso, veio ${r.codigo}: ${sql}`);
    return r.linhas;
  }
  const codigo = async (sql: string, params: unknown[] = []) => {
    const r = await portal(sql, params);
    return 'codigo' in r ? r.codigo : 'executou';
  };

  const abrir = async (p: unknown) =>
    (await ok<{ sessao_id: string }>('select * from plataforma.sa_abrir_sessao_portal($1::jsonb)', [JSON.stringify(p)]))[0]!.sessao_id;
  const adminDe = (t: string, u: string) => abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: t, usuario_id: u }] });
  // exatamente as chamadas da rota (parâmetros sem tipo, como o node-postgres manda)
  const SQL_REAUT = 'select * from plataforma.sa_reautenticar_admin($1)';
  const SQL_FALHA = 'select * from plataforma.sa_falha_senha_admin($1)';
  const SQL_GRAVAR = 'select plataforma.sa_gravar_senha_admin($1, $2, $3) as r';
  const reautenticar = async (sid: string) =>
    (await ok<{ tenant_id: string; usuario_id: string; senha_hash: string; falhas: number; bloqueado_ate: Date | null }>(SQL_REAUT, [sid]))[0]!;
  const falha = async (sid: string) => (await ok<Estado>(SQL_FALHA, [sid]))[0]!;
  const gravar = async (sid: string, atual: string, novo: string) => (await ok<{ r: boolean }>(SQL_GRAVAR, [sid, atual, novo]))[0]!.r;
  const conta = async (t: string, u: string) =>
    (await q<Conta>(
      `select senha_hash, tentativas_falhas, bloqueio_ate, sessao_versao, trocar_senha,
              senha_temporaria_hash, senha_temporaria_expira_em, senha_temporaria_criada_em
         from core.usuario where tenant_id = $1 and id = $2`,
      [t, u],
    ))[0]!;
  const agoraMais = async (min: number) => (await q<{ t: Date }>('select now() + make_interval(mins => $1) as t', [min]))[0]!.t;
  const viva = async (sid: string) =>
    (await q<{ n: number }>('select count(*)::int as n from plataforma.portal_sessao where id = $1 and revogada_em is null', [sid]))[0]!.n === 1;
  const auditadas = async (acao: string, u: string) =>
    (await q<{ n: number }>('select count(*)::int as n from plataforma.auditoria_plataforma where acao = $1 and usuario_id = $2', [acao, u]))[0]!.n;

  /** Cada caso numa transação desfeita; a falha do expect sai do tentar como { ok: false } e é relançada. */
  async function caso(fn: () => Promise<void>) {
    const r = await tentar(admin, null, async () => {
      try {
        await fn();
        return null;
      } catch (e) {
        return e;
      }
    });
    if (!r.ok) throw new Error(`erro de banco ${r.codigo}: ${r.mensagem}`);
    if (r.valor) throw r.valor;
  }

  it('SA-01 sessão com duas empresas: reautenticar, falha e gravação agem só na conta da empresa escolhida', async () => {
    await caso(async () => {
      const multi = await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A, usuario_id: ADMIN_A }, { tenant_id: B, usuario_id: ADMIN_B }] });
      // sem empresa escolhida, nenhuma das 3 age
      expect(await codigo(SQL_REAUT, [multi])).toBe('42501');
      await ok('select * from plataforma.sa_escolher_empresa($1, $2)', [multi, A]);
      const sidB = await adminDe(B, ADMIN_B);
      const antesA = await conta(A, ADMIN_A);
      const antesB = await conta(B, ADMIN_B);

      expect(await reautenticar(multi)).toMatchObject({ tenant_id: A, usuario_id: ADMIN_A, senha_hash: antesA.senha_hash, falhas: 0, bloqueado_ate: null });
      expect(await falha(multi)).toEqual({ falhas: 1, bloqueado_ate: null });
      expect(await conta(A, ADMIN_A)).toMatchObject({ tentativas_falhas: 1 });
      expect(await conta(B, ADMIN_B)).toEqual(antesB);

      // o hash da conta de B não serve para a de A (a escolhida)
      expect(await gravar(multi, antesB.senha_hash === antesA.senha_hash ? HASH_ERRADO : antesB.senha_hash, HASH_NOVO)).toBe(false);
      expect(await gravar(multi, antesA.senha_hash, HASH_NOVO)).toBe(true);
      expect(await conta(A, ADMIN_A)).toMatchObject({ senha_hash: HASH_NOVO, tentativas_falhas: 0, sessao_versao: antesA.sessao_versao + 1 });
      expect(await conta(B, ADMIN_B)).toEqual(antesB);
      // a sessão das duas empresas nasceu da senha de A: cai; a sessão só de B fica
      expect(await viva(multi)).toBe(false);
      expect(await viva(sidB)).toBe(true);
      expect(await reautenticar(sidB)).toMatchObject({ tenant_id: B, usuario_id: ADMIN_B, senha_hash: antesB.senha_hash });
    });
  });

  it('SA-02 bloqueio vencido: 4 falhas não bloqueiam; a 5ª bloqueia exatamente 15 min; o bloqueio vivo não conta nem estende', async () => {
    await caso(async () => {
      const sid = await adminDe(A, ADMIN_A);
      await q("update core.usuario set tentativas_falhas = 5, bloqueio_ate = now() - interval '1 second' where tenant_id = $1 and id = $2", [A, ADMIN_A]);
      expect(await reautenticar(sid)).toMatchObject({ falhas: 0, bloqueado_ate: null });
      const bloqueiosAntes = await auditadas('sa.bloqueio', ADMIN_A);
      for (let n = 1; n <= 4; n++) {
        expect(await falha(sid), `falha ${n}`).toEqual({ falhas: n, bloqueado_ate: null });
        expect(await conta(A, ADMIN_A), `falha ${n}`).toMatchObject({ tentativas_falhas: n, bloqueio_ate: null });
      }
      expect(await auditadas('sa.bloqueio', ADMIN_A)).toBe(bloqueiosAntes);
      const ate = await agoraMais(15);
      expect(await falha(sid)).toEqual({ falhas: 5, bloqueado_ate: ate });
      expect(await conta(A, ADMIN_A)).toMatchObject({ tentativas_falhas: 5, bloqueio_ate: ate });
      expect(await auditadas('sa.bloqueio', ADMIN_A)).toBe(bloqueiosAntes + 1);
      // 6ª com o bloqueio vivo: nada muda
      expect(await falha(sid)).toEqual({ falhas: 5, bloqueado_ate: ate });
      expect(await reautenticar(sid)).toMatchObject({ falhas: 5, bloqueado_ate: ate });
      expect(await auditadas('sa.bloqueio', ADMIN_A)).toBe(bloqueiosAntes + 1);
    });
  });

  it('SA-03 hash atual divergente com a conta bloqueada: false, não destrava, sessão viva, sem auditoria de troca', async () => {
    await caso(async () => {
      const sid = await adminDe(A, ADMIN_A);
      const ate = await agoraMais(10);
      await q('update core.usuario set tentativas_falhas = 5, bloqueio_ate = $3 where tenant_id = $1 and id = $2', [A, ADMIN_A, ate]);
      const antes = await conta(A, ADMIN_A);
      const trocasAntes = await auditadas('sa.senha.trocada', ADMIN_A);
      expect(await gravar(sid, HASH_ERRADO, HASH_NOVO)).toBe(false);
      expect(await conta(A, ADMIN_A)).toEqual(antes);
      expect(antes).toMatchObject({ tentativas_falhas: 5, bloqueio_ate: ate });
      expect(await viva(sid)).toBe(true);
      expect(await auditadas('sa.senha.trocada', ADMIN_A)).toBe(trocasAntes);
      expect(await reautenticar(sid)).toMatchObject({ falhas: 5, bloqueado_ate: ate });
    });
  });

  for (const [rotulo, mudanca] of [
    ['conta desativada', 'ativo = false'],
    ['perfil trocado', "perfil = 'vendedor'"],
    ['senha a trocar', 'trocar_senha = true'],
  ] as const) {
    it(`SA-04 ${rotulo}: 28000 nas 3 (a sessão cai na hora) e a conta não muda`, async () => {
      await caso(async () => {
        const sid = await adminDe(A, ADMIN_A);
        const hash = (await conta(A, ADMIN_A)).senha_hash;
        await q(`update core.usuario set ${mudanca} where tenant_id = $1 and id = $2`, [A, ADMIN_A]);
        const antes = await conta(A, ADMIN_A);
        expect(await codigo(SQL_REAUT, [sid]), 'reautenticar').toBe('28000');
        expect(await codigo(SQL_FALHA, [sid]), 'falha').toBe('28000');
        expect(await codigo(SQL_GRAVAR, [sid, hash, HASH_NOVO]), 'gravar').toBe('28000');
        expect(await conta(A, ADMIN_A)).toEqual(antes);
      });
    });
  }

  it('SA-05 senha temporária pendente ("esqueci a senha") sai com a troca, junto com falhas e bloqueio vencido', async () => {
    await caso(async () => {
      const sid = await adminDe(A, ADMIN_A);
      await q(
        `update core.usuario set senha_temporaria_hash = $3, senha_temporaria_expira_em = now() + interval '72 hours',
                senha_temporaria_criada_em = now(), tentativas_falhas = 2, bloqueio_ate = now() - interval '1 minute'
          where tenant_id = $1 and id = $2`,
        [A, ADMIN_A, HASH_TEMP],
      );
      const antes = await conta(A, ADMIN_A);
      expect(antes.senha_temporaria_hash).toBe(HASH_TEMP);
      // a temporária não é o hash atual: não grava
      expect(await gravar(sid, HASH_TEMP, HASH_NOVO)).toBe(false);
      expect(await gravar(sid, antes.senha_hash, HASH_NOVO)).toBe(true);
      expect(await conta(A, ADMIN_A)).toEqual({
        senha_hash: HASH_NOVO,
        tentativas_falhas: 0,
        bloqueio_ate: null,
        sessao_versao: antes.sessao_versao + 1,
        trocar_senha: false,
        senha_temporaria_hash: null,
        senha_temporaria_expira_em: null,
        senha_temporaria_criada_em: null,
      });
    });
  });

  describe('SA-06 conexões reais do app e do worker', () => {
    const FUNCOES = [
      'select * from plataforma.sa_reautenticar_admin(null::uuid)',
      'select * from plataforma.sa_falha_senha_admin(null::uuid)',
      'select plataforma.sa_gravar_senha_admin(null::uuid, null::text, null::text)',
    ];
    for (const [papel, url] of [
      ['macuxi_app', () => banco().urlApp],
      ['macuxi_worker', () => banco().urlWorker],
    ] as const) {
      it(`${papel} = 42501 nas 3`, async (ctx) => {
        const u = url();
        if (!u) ctx.skip();
        const c = await conectar(u!);
        try {
          for (const sql of FUNCOES) {
            const r = await tentar(c, A, () => c.query(sql));
            expect(r.ok ? 'executou' : r.codigo, `${papel}: ${sql}`).toBe('42501');
          }
        } finally {
          await c.end();
        }
      });
    }
  });
});
