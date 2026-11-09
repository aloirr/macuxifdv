/**
 * 0051 — nome do perfil de fábrica do assistente: "Assistente" (RD-0014, T-0111; pedido R-20261108-202329-designer-ux).
 * O que o BANCO garante: plataforma.semear_perfis_fabrica(uuid) semeia 'Assistente' (o resto do texto é o da 0041, letra por
 * letra); os tenants que já existem passam a 'Assistente' só no perfil de fábrica de base assistente que ainda tinha o nome
 * antigo exato; quem renomeou não muda. Down volta ao texto da 0041 e ao nome antigo.
 * Banco: papel de APLICAÇÃO (macuxi_app) sobre a fixture dois-tenants; up/down num banco efêmero. Os casos de banco rodam no CI
 * (sem Docker no PC do dono do produto, R-20261105-053835).
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const m41 = migracoes.find((m) => m.versao === '0041')!;
const m51 = migracoes.find((m) => m.versao === '0051')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const FUNCAO = /create (?:or replace )?function plataforma\.semear_perfis_fabrica\(p_tenant uuid\)[\s\S]*?\n\$\$;/;
const NOMES_FABRICA = ['Admin', 'Analista', 'Assistente', 'Gerente', 'Promotor', 'Supervisor', 'Vendedor'];

describe('0051 nome do perfil Assistente (estático)', () => {
  it('nome e posição: 0051_plataforma_perfil_assistente logo depois da 0050', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0050_vendedor_pedido_devolucao') + 1]).toBe('0051_plataforma_perfil_assistente');
  });

  it("a função é a da 0041 com 'Assistente' no lugar de 'Assistente de BKO' (nada mais muda; ACLs ficam pelo create or replace)", () => {
    const f41 = FUNCAO.exec(semComentarios(m41.up))![0];
    const f51 = FUNCAO.exec(semComentarios(m51.up))![0];
    expect(f51).toBe(f41.replace('create function', 'create or replace function').replace("'Assistente de BKO'", "'Assistente'"));
    expect(f51).not.toContain('de BKO');
    // o down devolve exatamente o texto da 0041
    expect(FUNCAO.exec(semComentarios(m51.down))![0]).toBe(f41.replace('create function', 'create or replace function'));
  });

  it('o update só toca perfil de fábrica, base assistente e o nome antigo exato; sem grant, revoke, tabela nem coluna', () => {
    const up = semComentarios(m51.up);
    expect(up).toContain("update plataforma.perfil set nome = 'Assistente'\n where fabrica and base = 'assistente' and nome = 'Assistente de BKO';");
    expect([...up.matchAll(/^update /gm)]).toHaveLength(1);
    expect(up).not.toMatch(/grant |revoke |create table|alter table|drop /);
    const down = semComentarios(m51.down);
    expect(down).toContain("update plataforma.perfil set nome = 'Assistente de BKO'\n where fabrica and base = 'assistente' and nome = 'Assistente';");
  });
});

describe.skipIf(semBanco())('0051 nome do perfil Assistente (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });

  it('fixture: os 7 perfis de fábrica de A e de B com os nomes da tela (Assistente, não Assistente de BKO)', async () => {
    for (const t of [DOIS_TENANTS.A, DOIS_TENANTS.B]) {
      await emTransacao(app, t.tenantId, async () => {
        const r = await app.query<{ nome: string }>('select nome from plataforma.perfil where fabrica order by nome');
        expect(r.rows.map((x) => x.nome)).toEqual(NOMES_FABRICA);
      });
    }
  });
});

describe.skipIf(semBanco())('0051 up/down com dados (banco efêmero)', () => {
  let b: BancoDeTeste;
  const ANTIGO = 'dddddddd-0051-4000-8000-000000000001';
  const RENOMEADO = 'dddddddd-0051-4000-8000-000000000002';
  const NOVO = 'dddddddd-0051-4000-8000-000000000003';
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('tenant antigo passa a Assistente; o renomeado não muda; tenant novo nasce com Assistente; down volta; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0050' });
      const antes = await retratoDoCatalogo(c);
      const nomeDoAssistente = async (tenant: string) =>
        (await c.query<{ nome: string }>("select nome from plataforma.perfil where tenant_id = $1 and fabrica and base = 'assistente'", [tenant])).rows[0]?.nome;
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo51', 'Antigo'), ($2, 'renomeado51', 'Renomeado')", [ANTIGO, RENOMEADO]);
      expect(await nomeDoAssistente(ANTIGO)).toBe('Assistente de BKO');
      await c.query("update plataforma.perfil set nome = 'Assistente Comercial' where tenant_id = $1 and fabrica and base = 'assistente'", [RENOMEADO]);

      expect((await migrarUp(c, { ate: '0051' })).aplicadas).toEqual(['0051_plataforma_perfil_assistente']);
      expect(await retratoDoCatalogo(c)).toEqual(antes); // só o texto da função e dados mudam
      expect(await nomeDoAssistente(ANTIGO)).toBe('Assistente');
      expect(await nomeDoAssistente(RENOMEADO)).toBe('Assistente Comercial');
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'novo51', 'Novo')", [NOVO]);
      expect(await nomeDoAssistente(NOVO)).toBe('Assistente');
      // os outros 6 nomes de fábrica não mudam
      const nomes = await c.query<{ nome: string }>('select nome from plataforma.perfil where tenant_id = $1 and fabrica order by nome', [NOVO]);
      expect(nomes.rows.map((x) => x.nome)).toEqual(NOMES_FABRICA);

      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0051_plataforma_perfil_assistente']);
      expect(await nomeDoAssistente(ANTIGO)).toBe('Assistente de BKO');
      expect(await nomeDoAssistente(NOVO)).toBe('Assistente de BKO');
      expect(await nomeDoAssistente(RENOMEADO)).toBe('Assistente Comercial');
      await c.query(m51.down);
      expect(await nomeDoAssistente(ANTIGO)).toBe('Assistente de BKO');

      await migrarUp(c, { ate: '0051' });
      expect(await nomeDoAssistente(ANTIGO)).toBe('Assistente');
      expect(await retratoDoCatalogo(c)).toEqual(antes);
    });
  });
});
