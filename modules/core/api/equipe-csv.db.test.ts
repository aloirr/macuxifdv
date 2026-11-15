/**
 * T-0087 fatia E × Postgres real (fixture dois-tenants, papel macuxi_app, RLS): Equipe por CSV sem convite (T-0094, RN-CORE-34).
 * Prova a gravação em ordem (gerente → supervisor → vendedor), a árvore pelo `email_superior`, a idempotência pelo e-mail, a senha
 * temporária gerada (hash no banco, 72 h, `trocar_senha`) enviada só pelo e-mail falso, o 503 sem e-mail ANTES de gravar e o
 * isolamento entre tenants. Pula sem Docker/Postgres (roda no CI).
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ContextoBase, RotaModulo, UsuarioAutenticado } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MensagemEmail, ServicoEmail } from './email';
import { perfisDeFabrica } from '../domain';
import { rotasDeEquipeCsv } from './equipe-csv';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
/** Código da filial padrão do tenant A (lido no beforeAll): o A tem 2 filiais, então a coluna `filial` é obrigatória para quem é criado (RN-CORE-39). */
let FIL = '';
const CAB = 'nome,email,telefone,perfil,email_superior,codigo_erp,modulos,filial';
let CSV = '';

describe.skipIf(semBanco())('Core T-0087 E × Postgres: Equipe por CSV com senha temporária por e-mail', () => {
  const enviados: MensagemEmail[] = [];
  let emailAtivo = true;
  const email: ServicoEmail = {
    disponivel: () => emailAtivo,
    enfileirar: async (_db, m) => {
      if (!emailAtivo) return 'indisponivel';
      enviados.push(m);
      return 'enfileirado';
    },
  };
  let pool: pg.Pool;
  const admin: UsuarioAutenticado = { id: A.usuarios.admin, tenant_id: A.tenantId, perfil: 'admin' };

  const ctx = (u: UsuarioAutenticado): ContextoBase =>
    ({
      usuario: { ...u, perfis: perfisDeFabrica(u.perfil) },
      requestId: 'req-teste-equipe-csv',
      email,
      agora: () => new Date(),
      fuso: () => 'America/Manaus',
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      comTenant: (fn: (db: pg.ClientBase, tx: unknown) => Promise<unknown>) =>
        comTenant(pool, u.tenant_id, (c) => fn(c, { publicar: async () => ({}), auditar: async () => undefined })),
    }) as unknown as ContextoBase;
  const rota = (metodo: string, caminho: string): RotaModulo => rotasDeEquipeCsv.find((r) => r.metodo === metodo && r.caminho === caminho)!;
  const chamar = (metodo: string, caminho: string, u: UsuarioAutenticado, extra: { corpo?: unknown; params?: unknown } = {}) => {
    const r = rota(metodo, caminho);
    return r.executar({ ...ctx(u), corpo: r.corpo ? r.corpo.parse(extra.corpo ?? {}) : {}, query: {}, params: r.params ? r.params.parse(extra.params ?? {}) : {} } as never) as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const linhas = <R,>(tenant: string, sql: string, v: unknown[] = []) => comTenant(pool, tenant, async (c) => (await c.query<R & object>(sql, v)).rows);

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    FIL = (await linhas<{ codigo: string }>(A.tenantId, 'select codigo from core.filial where padrao and deleted_at is null'))[0]!.codigo;
    CSV = [
      CAB,
      `Vera Campo,vera.csv@exemplo.com.br,,vendedor,sandra.csv@exemplo.com.br,CSV-V1,,${FIL}`,
      `Sandra Sup,sandra.csv@exemplo.com.br,95991112222,supervisor,gil.csv@exemplo.com.br,,,${FIL}`,
      `Gil Gerente,gil.csv@exemplo.com.br,,gerente,,,,${FIL}`,
    ].join('\n');
  });
  afterAll(async () => {
    await pool?.end();
  });

  it('RN-CORE-31: conferir não grava nada e devolve o plano em ordem gerente → supervisor → campo', async () => {
    const r = await chamar('POST', 'equipe/importacoes', admin, { corpo: { csv: CSV, modo: 'conferir' } });
    expect(r.erros).toEqual([]);
    expect(r.gravado).toBe(false);
    expect(r.plano.map((p: { email: string }) => p.email)).toEqual(['gil.csv@exemplo.com.br', 'sandra.csv@exemplo.com.br', 'vera.csv@exemplo.com.br']);
    expect(await linhas(A.tenantId, "select 1 from core.usuario where email like '%.csv@exemplo.com.br'")).toHaveLength(0);
  });

  it('RN-CORE-34: sem e-mail configurado, gravar com gente nova responde 503 EMAIL_INDISPONIVEL e não grava nada; conferir funciona', async () => {
    emailAtivo = false;
    try {
      await expect(chamar('POST', 'equipe/importacoes', admin, { corpo: { csv: CSV, modo: 'gravar' } })).rejects.toMatchObject({ status: 503, codigo: 'EMAIL_INDISPONIVEL' });
      expect(await linhas(A.tenantId, "select 1 from core.usuario where email like '%.csv@exemplo.com.br'")).toHaveLength(0);
      const c = await chamar('POST', 'equipe/importacoes', admin, { corpo: { csv: CSV, modo: 'conferir' } });
      expect(c.erros).toEqual([]);
    } finally {
      emailAtivo = true;
    }
  });

  it('RN-CORE-34: gravar cria os 3 com senha temporária (hash, trocar_senha, 72 h), monta a árvore, manda 1 e-mail por pessoa nova e é idempotente', async () => {
    const antes = Date.now();
    const r = await chamar('POST', 'equipe/importacoes', admin, { corpo: { csv: CSV, modo: 'gravar' } });
    expect(r.erros).toEqual([]);
    expect(r.gravado).toBe(true);
    expect(r.acessos_enviados).toBe(3);
    expect(r.email_acesso).toBe('enfileirado');
    expect(enviados).toHaveLength(3);
    expect(enviados.every((m) => m.modelo === 'acesso_inicial' && m.dados.senha.length === 12 && m.dados.validade_horas === 72)).toBe(true);
    const us = await linhas<{ email: string; senha_hash: string | null; trocar_senha: boolean; senha_expira_em: Date; equipe_id: string | null; external_id: string | null; telefone: string | null }>(
      A.tenantId,
      "select email, senha_hash, trocar_senha, senha_expira_em, equipe_id, external_id, telefone from core.usuario where email like '%.csv@exemplo.com.br' order by email",
    );
    expect(us).toHaveLength(3);
    for (const u of us) {
      expect(u.senha_hash).toMatch(/^\$argon2id\$/);
      expect(u.trocar_senha).toBe(true);
      expect(u.senha_expira_em.getTime()).toBeGreaterThan(antes + 71 * 3_600_000);
    }
    expect(us.find((u) => u.email.startsWith('vera'))).toMatchObject({ external_id: 'CSV-V1' });
    expect(us.find((u) => u.email.startsWith('sandra'))?.telefone).toBe('95991112222');
    // a senha em claro não está no banco nem na auditoria
    const aud = JSON.stringify(await linhas(A.tenantId, "select antes, depois from plataforma.auditoria where acao = 'usuario.criar' and depois->>'origem' = 'csv'"));
    for (const m of enviados) expect(aud).not.toContain(m.dados.senha);
    expect(aud).not.toContain('exemplo.com.br');
    // árvore: vera -> sandra -> gil (pela equipe que o superior responde)
    const arv = await linhas<{ filho: string; superior: string }>(
      A.tenantId,
      `select f.email as filho, s.email as superior from core.usuario f join core.equipe e on e.id = f.equipe_id join core.usuario s on s.id = e.responsavel_id
        where f.email like '%.csv@exemplo.com.br'`,
    );
    expect(arv.map((a) => `${a.filho}>${a.superior}`).sort()).toEqual(['sandra.csv@exemplo.com.br>gil.csv@exemplo.com.br', 'vera.csv@exemplo.com.br>sandra.csv@exemplo.com.br']);
    // idempotente: rodar de novo não cria nem manda e-mail de novo
    const deNovo = await chamar('POST', 'equipe/importacoes', admin, { corpo: { csv: CSV, modo: 'gravar' } });
    expect(deNovo.resumo).toMatchObject({ novos: 0, atualizados: 0, sem_mudanca: 3 });
    expect(deNovo.acessos_enviados).toBe(0);
    expect(enviados).toHaveLength(3);
  });

  it('RN-CORE-31: arquivo com erro não grava nada (superior inexistente) e o erro não repete o dado da célula', async () => {
    const csv = `nome,email,perfil,email_superior,filial\nZed,zed.csv@exemplo.com.br,vendedor,ninguem@exemplo.com.br,${FIL}`;
    const r = await chamar('POST', 'equipe/importacoes', admin, { corpo: { csv, modo: 'gravar' } });
    expect(r.gravado).toBe(false);
    expect(r.erros[0]).toMatchObject({ linha: 2, coluna: 'email_superior' });
    expect(JSON.stringify(r.erros)).not.toContain('ninguem@');
    expect(await linhas(A.tenantId, "select 1 from core.usuario where email = 'zed.csv@exemplo.com.br'")).toHaveLength(0);
  });

  it('RN-CORE-05: o outro tenant não vê usuários desta importação e não há rotas de convite', async () => {
    expect(await linhas(B.tenantId, "select 1 from core.usuario where email like '%.csv@exemplo.com.br'")).toHaveLength(0);
    expect(rotasDeEquipeCsv.some((r) => r.caminho.includes('convite'))).toBe(false);
    expect(rotasDeEquipeCsv.every((r) => r.superficie === 'bko')).toBe(true);
  });

  it('RN-CORE-31: só o telefone mudou no arquivo — é gravado', async () => {
    const csv = `${CAB}\nSandra Sup,sandra.csv@exemplo.com.br,95993334444,supervisor,gil.csv@exemplo.com.br,,,${FIL}`;
    const r = await chamar('POST', 'equipe/importacoes', admin, { corpo: { csv, modo: 'gravar' } });
    expect(r.resumo).toMatchObject({ atualizados: 1 });
    expect((await linhas<{ telefone: string }>(A.tenantId, "select telefone from core.usuario where email = 'sandra.csv@exemplo.com.br'"))[0]!.telefone).toBe('95993334444');
  });

  it('RN-CORE-04: supervisor que troca de gerente leva a equipe dele junto (equipe_pai_id acompanha)', async () => {
    const csv = [CAB, `Sandra Sup,sandra.csv@exemplo.com.br,,supervisor,gina.csv@exemplo.com.br,,,${FIL}`, `Gina Gerente,gina.csv@exemplo.com.br,,gerente,,,,${FIL}`].join('\n');
    const r = await chamar('POST', 'equipe/importacoes', admin, { corpo: { csv, modo: 'gravar' } });
    expect(r.erros).toEqual([]);
    const l = await linhas<{ pai: string }>(
      A.tenantId,
      `select g.email as pai from core.equipe e join core.usuario s on s.id = e.responsavel_id
         join core.equipe ep on ep.id = e.equipe_pai_id join core.usuario g on g.id = ep.responsavel_id
        where s.email = 'sandra.csv@exemplo.com.br'`,
    );
    expect(l).toEqual([{ pai: 'gina.csv@exemplo.com.br' }]);
  });
});
