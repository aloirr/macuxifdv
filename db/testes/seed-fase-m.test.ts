/**
 * T-0002 critério 3 — seed carrega os usuários fake da Fase M (plano S0-031 a S0-034).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { carregarFaseM, TENANT_FASE_M } from '../seeds/fase-m/fase-m';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { verificarSenha } from '../src/senha';
import { semBanco } from './estado';

const SENHA = 'senha-do-teste';

describe.skipIf(semBanco())('seed Fase M', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ preparar: (c) => carregarFaseM(c, { senha: SENHA }).then(() => undefined) });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('S0-031 12 usuários com e-mail e perfil mapeados (seller->vendedor, manager->gerente, ...)', async () => {
    const r = await comAdmin(b.nome, (c) => c.query<{ email: string; perfil: string }>('select email, perfil from core.usuario where tenant_id = $1 order by email', [TENANT_FASE_M]));
    expect(r.rows).toHaveLength(12);
    expect(r.rows.filter((u) => u.perfil === 'vendedor')).toHaveLength(8);
    expect(r.rows.find((u) => u.email === 'fernando@exemplo.com.br')?.perfil).toBe('gerente');
    expect(r.rows.find((u) => u.email === 'juliana@exemplo.com.br')?.perfil).toBe('analista');
    expect(r.rows.find((u) => u.email === 'ana@exemplo.com.br')?.perfil).toBe('assistente');
    expect(r.rows.find((u) => u.email === 'patricia@exemplo.com.br')?.perfil).toBe('admin');
  });

  it('S0-032 cada vendedor na equipe certa; equipes sob a gerência do Fernando', async () => {
    const r = await comAdmin(b.nome, (c) =>
      c.query<{ email: string; equipe: string; pai: string | null; responsavel_pai: string | null }>(`
        select u.email, e.nome as equipe, p.nome as pai, g.email as responsavel_pai
          from core.usuario u join core.equipe e on e.id = u.equipe_id
          left join core.equipe p on p.id = e.equipe_pai_id left join core.usuario g on g.id = p.responsavel_id
         where u.perfil = 'vendedor' order by u.email`),
    );
    const mapa = Object.fromEntries(r.rows.map((x) => [x.email, x.equipe]));
    expect(mapa).toEqual({
      'bruna@exemplo.com.br': 'Zona Sul', 'carla@exemplo.com.br': 'Interior', 'diego@exemplo.com.br': 'Centro', 'livia@exemplo.com.br': 'Zona Oeste',
      'marcos@exemplo.com.br': 'Zona Leste', 'paula@exemplo.com.br': 'Zona Norte', 'rafael@exemplo.com.br': 'Zona Norte', 'thiago@exemplo.com.br': 'Interior',
    });
    expect(new Set(r.rows.map((x) => x.responsavel_pai))).toEqual(new Set(['fernando@exemplo.com.br']));
  });

  it('S0-033 idempotente: rodar de novo não duplica nada', async () => {
    const contar = () =>
      comAdmin(b.nome, (c) =>
        c.query<{ t: string; n: number }>(`
          select 'usuario' t, count(*)::int n from core.usuario union all select 'equipe', count(*)::int from core.equipe
          union all select 'produto', count(*)::int from core.produto union all select 'cliente', count(*)::int from core.cliente
          union all select 'carteira', count(*)::int from core.carteira union all select 'perfil_modulo', count(*)::int from plataforma.perfil_modulo
          union all select 'parametro', count(*)::int from plataforma.parametro order by 1`),
      );
    const antes = (await contar()).rows;
    const hashAntes = await comAdmin(b.nome, (c) => c.query('select id, senha_hash from core.usuario order by id'));
    await comAdmin(b.nome, (c) => carregarFaseM(c, { senha: SENHA }));
    expect((await contar()).rows).toEqual(antes);
    const hashDepois = await comAdmin(b.nome, (c) => c.query('select id, senha_hash from core.usuario order by id'));
    expect(hashDepois.rows).toEqual(hashAntes.rows);
  });

  it('S0-034 senhas em argon2id (nenhuma em texto) e só e-mails fictícios', async () => {
    const r = await comAdmin(b.nome, (c) => c.query<{ email: string; senha_hash: string }>('select email, senha_hash from core.usuario'));
    for (const u of r.rows) {
      expect(u.senha_hash.startsWith('$argon2id$')).toBe(true);
      expect(u.senha_hash).not.toContain(SENHA);
      expect(u.email.endsWith('@exemplo.com.br')).toBe(true);
    }
    expect(verificarSenha(SENHA, r.rows[0]!.senha_hash)).toBe(true);
  });
});
