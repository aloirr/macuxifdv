/**
 * 0068 — o código da empresa é o código da licença: UF do cliente + 4 dígitos aleatórios, ex.: AM4821 (pedidos do dono do
 * produto R-20261114-130500, R-20261114-131200 e R-20261114-131500). Dicionário: docs/banco/plataforma.md, "0068". O que o
 * BANCO garante:
 * - CHECK tenant_codigo_formato: os códigos de antes (thathyany, demo, teste-macuxi) ou UF (27) + 4 dígitos em maiúsculas;
 * - uf_valida, sortear_codigo_licenca (trava por UF, até 20 sorteios e depois um número livre; UF esgotada = 54000);
 * - provisionar_tenant sem codigo (ausente, nulo ou "") exige id e uf; sorteia o código da UF; o id do chamador é a chave de
 *   idempotência (mesmo tenant, mesmo código, sem novo sorteio); uf inválida = 22023; codigo informado segue como antes;
 *   id e codigo de tenants diferentes = 23505; o retorno traz 'codigo'; login (tenant_por_codigo) sem diferenciar maiúsculas;
 * - sa_provisionar_tenant: sem codigo e sem admin é empresa nova (RN-CORE-34) quando o id não é de tenant vivo;
 * - atribuir_codigo_licenca dá o código a um tenant existente, idempotente pela UF, com auditoria;
 * - down volta a provisionar_tenant da 0040, a sa_provisionar_tenant da 0039 e o CHECK da 0001, e falha (55000) se houver
 *   tenant com código da licença.
 * Estático na sessão; up/down e as chamadas num banco efêmero no CI.
 */
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { semBanco } from './estado';
import { erroDe, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const m01 = migracoes.find((m) => m.versao === '0001')!;
const m39 = migracoes.find((m) => m.versao === '0039')!;
const m40 = migracoes.find((m) => m.versao === '0040')!;
const m68 = migracoes.find((m) => m.versao === '0068')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m68.up);
const down = semComentarios(m68.down);
const UFS = 'AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO';
const CHECK_0001 = "check (codigo ~ '^[a-z0-9][a-z0-9-]{1,39}$')";
const PROV = 'create function plataforma.provisionar_tenant(p jsonb)';
const SA = 'create or replace function plataforma.sa_provisionar_tenant(p_sid uuid, p jsonb)';
const SORTEAR = 'create function plataforma.sortear_codigo_licenca(p_uf text)';
const ATRIBUIR = 'create function plataforma.atribuir_codigo_licenca(p_tenant_id uuid, p_uf text)';
/** Do início até o `$$;` que fecha a função (o mesmo recorte da senha-email-saida.test.ts). */
const bloco = (sql: string, inicio: string) => {
  const i = sql.indexOf(inicio);
  if (i < 0) return '';
  const fim = /^ {0,2}\$\$;$/m.exec(sql.slice(i));
  return fim ? sql.slice(i, i + fim.index + fim[0].length) : '';
};

describe('0068 código da licença (estático)', () => {
  it('nome e posição: 0068_plataforma_tenant_numero_licenca logo depois da 0067', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0067_core_cliente_visita_resumo') + 1]).toBe('0068_plataforma_tenant_numero_licenca');
  });

  it('sem sequência; CHECK: os códigos de antes OU UF (27) + 4 dígitos; nenhuma tabela, coluna, índice ou política muda', () => {
    expect(m01.up).toContain(`constraint tenant_codigo_formato ${CHECK_0001}`);
    expect(up).not.toMatch(/sequence|nextval/i);
    expect(up).toContain('alter table plataforma.tenant drop constraint tenant_codigo_formato;');
    expect(up.replace(/\s+/g, ' ')).toContain(
      `add constraint tenant_codigo_formato check (codigo ~ '^[a-z0-9][a-z0-9-]{1,39}$' or codigo ~ '^(${UFS})[0-9]{4}$') not valid;`,
    );
    expect(up).toContain('alter table plataforma.tenant validate constraint tenant_codigo_formato;');
    expect(up).not.toMatch(/create table|add column|create (unique )?index|\bpolicy\b/i);
    const ufs = /array\[([^\]]+)\]/.exec(bloco(up, 'create function plataforma.uf_valida(p_uf text)').replace(/\s+/g, ' '))?.[1];
    expect(ufs?.replace(/[' ]/g, '').split(',').join('|')).toBe(UFS);
  });

  it('funções novas: SECURITY INVOKER, search_path fixo, sem EXECUTE para ninguém além do dono', () => {
    for (const [assinatura, inicio] of [
      ['plataforma.uf_valida(text)', 'create function plataforma.uf_valida(p_uf text)'],
      ['plataforma.sortear_codigo_licenca(text)', SORTEAR],
      ['plataforma.atribuir_codigo_licenca(uuid, text)', ATRIBUIR],
    ] as const) {
      const b = bloco(up, inicio);
      expect(b, assinatura).not.toBe('');
      expect(b, assinatura).toMatch(/security invoker\s+set search_path = pg_catalog, (plataforma, )?pg_temp\s/);
      expect(up).toContain(`revoke all on function ${assinatura} from public;`);
    }
    expect(up).not.toMatch(/\bgrant\b/);
  });

  it('sorteio: UF em maiúsculas + 4 dígitos aleatórios, trava por UF, tentativas limitadas, UF esgotada = 54000', () => {
    const b = bloco(up, SORTEAR);
    expect(b).toContain("perform pg_advisory_xact_lock(hashtextextended('plataforma.codigo_licenca:' || v_uf, 0));");
    expect(b).toContain('c_tentativas constant integer := 20;');
    expect(b).toContain("v_codigo := v_uf || lpad(floor(random() * 10000)::integer::text, 4, '0');");
    expect(b).toContain('if not exists (select 1 from plataforma.tenant t where lower(t.codigo) = lower(v_codigo)) then');
    expect(b).toContain('from generate_series(0, 9999) n');
    expect(b).toContain("using errcode = '54000';");
    expect(b).toContain('for i in 1 .. c_tentativas loop');
    expect(b.match(/\bloop\b/g)).toHaveLength(2); // nenhum laço sem limite: só o for 1 .. c_tentativas
  });

  it('provisionar_tenant: mesma assinatura e segurança; id e uf sem codigo; sorteio só para tenant novo, depois da validação', () => {
    const b = bloco(up, PROV);
    expect(b).not.toBe('');
    expect(up.indexOf('drop function if exists plataforma.provisionar_tenant(jsonb);')).toBeLessThan(up.indexOf(PROV));
    expect(b).toMatch(/returns jsonb\s+language plpgsql volatile security invoker\s+set search_path = pg_catalog, plataforma, pg_temp\s/);
    expect(up).toContain('revoke all on function plataforma.provisionar_tenant(jsonb) from public;');
    expect(b).toContain("v_codigo := nullif(p ->> 'codigo', '');");
    expect(b).toContain("v_uf := upper(nullif(btrim(p ->> 'uf'), ''));");
    expect(b).toContain('if v_codigo is null and (v_id is null or v_uf is null) then');
    expect(b).toContain("perform pg_advisory_xact_lock(hashtextextended('plataforma.provisionar_tenant:' || v_id::text, 0));");
    expect(b).toContain('v_codigo := plataforma.sortear_codigo_licenca(v_uf);');
    expect(b).toContain('values (coalesce(v_id, gen_random_uuid()), v_codigo, v_nome, v_documento, v_fuso, v_plano)');
    expect(b).toContain("'codigo', v_codigo,");
    expect(b.indexOf("raise exception 'provisionar_tenant: senha_hash do admin")).toBeLessThan(b.indexOf('sortear_codigo_licenca('));
    expect(b.match(/sortear_codigo_licenca\(/g)).toHaveLength(1);
  });

  it('sa_provisionar_tenant: só a condição de empresa nova muda (sem codigo e id que não é de tenant vivo)', () => {
    const novo = bloco(up, SA);
    const antigo = bloco(semComentarios(m39.up), SA);
    expect(novo).not.toBe('');
    expect(novo.replace(/\s+/g, ' ')).toContain(
      "or (coalesce(p ->> 'codigo', '') = '' and not exists (select 1 from plataforma.tenant t where t.id::text = lower(p ->> 'id') and t.deleted_at is null)) then",
    );
    expect(novo).toMatch(/security definer/);
    expect(up).not.toMatch(/sa_provisionar_tenant[^;]*to macuxi_(app|worker)\b/);
    const fora = (s: string) => s.slice(0, s.indexOf('  if coalesce(jsonb_typeof(p -> \'admin\')')) + s.slice(s.indexOf('    v_entrada := (p - \'ator_id\' - \'admin\')'));
    expect(fora(novo)).toBe(fora(antigo));
  });

  it('atribuir_codigo_licenca: trava a linha, idempotente pela UF, sorteia, grava e audita o antes e o depois', () => {
    const b = bloco(up, ATRIBUIR);
    expect(b).toContain('from plataforma.tenant t where t.id = p_tenant_id for update;');
    expect(b).toContain("if v_tenant.codigo ~ ('^' || v_uf || '[0-9]{4}$') then");
    expect(b).toContain('v_codigo := plataforma.sortear_codigo_licenca(v_uf);');
    expect(b).toContain("'tenant.codigo_licenca'");
    expect(b).toContain("jsonb_build_object('codigo', v_tenant.codigo), jsonb_build_object('codigo', v_codigo)");
  });

  it('down: guarda (55000) antes de tudo; textos EXATOS da 0040 e da 0039; CHECK da 0001; funções novas apagadas', () => {
    const prov40 = bloco(m40.up, PROV);
    const sa39 = bloco(m39.up, SA);
    expect(prov40).not.toBe('');
    expect(sa39).not.toBe('');
    expect(m68.down).toContain(prov40);
    expect(m68.down).toContain(sa39);
    expect(down.indexOf("errcode = '55000'")).toBeLessThan(down.indexOf('drop function if exists plataforma.provisionar_tenant(jsonb);'));
    expect(down).toContain("where t.codigo !~ '^[a-z0-9][a-z0-9-]{1,39}$';");
    expect(down).toContain('revoke all on function plataforma.provisionar_tenant(jsonb) from public;');
    expect(down).toContain(`alter table plataforma.tenant add constraint tenant_codigo_formato ${CHECK_0001};`);
    for (const f of ['atribuir_codigo_licenca(uuid, text)', 'sortear_codigo_licenca(text)', 'uf_valida(text)']) {
      expect(down).toContain(`drop function if exists plataforma.${f};`);
    }
    expect(down).not.toMatch(/sequence|\bgrant\b|sortear_codigo_licenca\(v_|update plataforma\.tenant/);
  });
});

/** Hash argon2id de mentira (formato PHC válido; nunca uma senha real). */
const H1 = '$argon2id$v=19$m=1,t=1,p=1$c2FsdW0$aGFzaHVt';
const id = (n: number) => `aaaaaaaa-0068-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const ADMIN = { email: 'admin.0068@exemplo.com.br', nome: 'Admin 0068', senha_hash: H1 };
function entrada(extra: Record<string, unknown>) {
  return { nome: 'Distribuidora 0068', modulos: [{ modulo: 'core', licencas: null, perfis: ['admin', 'vendedor'] }], sem_admin: true, ...extra };
}
interface Saida {
  tenant_id: string;
  codigo: string;
  resultado: 'criado' | 'atualizado' | 'sem_mudanca';
  admin: string;
  avisos: string[];
}
interface Atribuicao {
  tenant_id: string;
  codigo_anterior: string;
  codigo: string;
  resultado: 'atribuido' | 'sem_mudanca';
}

describe.skipIf(semBanco())('0068 código da licença (banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('sorteia UF + 4 dígitos; idempotente pelo id; uf; codigo explícito; CHECK; login; atribuir; UF esgotada; up/down', async () => {
    await comAdmin(b.nome, async (c: pg.Client) => {
      const provisionar = async (e: unknown): Promise<Saida> =>
        (await c.query<{ r: Saida }>('select plataforma.provisionar_tenant($1::jsonb) as r', [JSON.stringify(e)])).rows[0]!.r;
      const atribuir = async (tenant: string, uf: string | null): Promise<Atribuicao> =>
        (await c.query<{ r: Atribuicao }>('select plataforma.atribuir_codigo_licenca($1, $2) as r', [tenant, uf])).rows[0]!.r;
      const codigoDe = async (tenant: string) =>
        (await c.query<{ codigo: string }>('select codigo from plataforma.tenant where id = $1', [tenant])).rows[0]?.codigo;
      const total = async () => (await c.query<{ n: number }>('select count(*)::int as n from plataforma.tenant')).rows[0]!.n;

      await migrarUp(c, { ate: '0067' });
      const antes = await retratoDoCatalogo(c);
      // legados de produção e da demo existem ANTES da 0068 e passam no CHECK novo sem mudar
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'thathyany', 'Thathyany'), ($2, 'demo', 'Demo')", [id(90), id(91)]);
      expect((await migrarUp(c, { ate: '0068' })).aplicadas).toEqual(['0068_plataforma_tenant_numero_licenca']);
      const depois = await retratoDoCatalogo(c);
      // só o que a 0068 acrescentou: o retrato inteiro já traz sequências de outras migrações (ex.: 0058)
      const novos = depois.filter((x) => !antes.includes(x));
      expect(novos.filter((x) => x.includes('sequence') || x.includes('_seq ') || / S rls=/.test(x))).toEqual([]);
      expect([await codigoDe(id(90)), await codigoDe(id(91))]).toEqual(['thathyany', 'demo']);

      // sem codigo (ausente, nulo e vazio): UF da entrada (minúscula aceita) + 4 dígitos, em maiúsculas, distintos
      const r1 = await provisionar(entrada({ id: id(1), uf: 'am', sem_admin: false, admin: ADMIN }));
      expect(r1).toMatchObject({ tenant_id: id(1), resultado: 'criado', admin: 'criado' });
      expect(r1.codigo).toMatch(/^AM\d{4}$/);
      const r2 = await provisionar(entrada({ id: id(2), codigo: null, uf: ' RR ' }));
      const r3 = await provisionar(entrada({ id: id(3), codigo: '', uf: 'Sp' }));
      expect(r2.codigo).toMatch(/^RR\d{4}$/);
      expect(r3.codigo).toMatch(/^SP\d{4}$/);
      expect([await codigoDe(id(1)), await codigoDe(id(2)), await codigoDe(id(3))]).toEqual([r1.codigo, r2.codigo, r3.codigo]);

      // unicidade: 30 tenants da mesma UF, 30 códigos diferentes
      const varios: string[] = [];
      for (let n = 10; n < 40; n++) varios.push((await provisionar(entrada({ id: id(n), uf: 'AC' }))).codigo);
      expect(new Set(varios).size).toBe(30);
      for (const v of varios) expect(v).toMatch(/^AC\d{4}$/);

      // idempotência pela chave (id): mesmo tenant, mesmo código, nenhum sorteio novo; UF diferente não troca (aviso)
      const n0 = await total();
      const r1b = await provisionar(entrada({ id: id(1), uf: 'AM', sem_admin: false, admin: ADMIN }));
      expect(r1b).toMatchObject({ tenant_id: id(1), codigo: r1.codigo, resultado: 'sem_mudanca', admin: 'existente', avisos: [] });
      expect(await provisionar(entrada({ id: id(2), codigo: r2.codigo.toLowerCase() }))).toMatchObject({ tenant_id: id(2), codigo: r2.codigo, resultado: 'sem_mudanca' });
      const r2c = await provisionar(entrada({ id: id(2), uf: 'PA' }));
      expect(r2c).toMatchObject({ tenant_id: id(2), codigo: r2.codigo, resultado: 'sem_mudanca' });
      expect(r2c.avisos).toEqual([`tenant existente: o código ${r2.codigo} não muda (troca: atribuir_codigo_licenca)`]);
      expect(await total()).toBe(n0);

      // codigo explícito: como antes (idempotente pelo código, minúsculas), uf não é exigida
      const rx = await provisionar(entrada({ codigo: 'empresa-x' }));
      expect(rx).toMatchObject({ codigo: 'empresa-x', resultado: 'criado' });
      expect(await provisionar(entrada({ codigo: 'empresa-x' }))).toMatchObject({ tenant_id: rx.tenant_id, codigo: 'empresa-x', resultado: 'sem_mudanca' });
      expect(await provisionar(entrada({ id: id(4), codigo: 'empresa-y', uf: 'AM' }))).toMatchObject({ tenant_id: id(4), codigo: 'empresa-y', resultado: 'criado' });

      // CHECK tenant_codigo_formato: legados e UF + 4 dígitos em maiúsculas; fora disso = 23514
      await c.query("insert into plataforma.tenant (codigo, nome) values ('teste-macuxi', 'Teste'), ('DF0001', 'Manual')");
      for (const ruim of ['Demo-Maiusc', 'XX0001', 'AM482', 'AM48210', 'Am4821']) {
        expect((await erroDe(c.query('insert into plataforma.tenant (codigo, nome) values ($1, $2)', [ruim, 'X'])))?.code, ruim).toBe('23514');
      }
      // único na plataforma sem diferenciar maiúsculas (índice da 0001)
      expect((await erroDe(c.query("insert into plataforma.tenant (codigo, nome) values ('df0001', 'X')")))?.code).toBe('23505');

      // login: tenant_por_codigo acha o código da licença em qualquer caixa
      for (const digitado of [r1.codigo, r1.codigo.toLowerCase(), `${r1.codigo.slice(0, 1)}${r1.codigo.slice(1).toLowerCase()}`]) {
        expect((await c.query('select id from plataforma.tenant_por_codigo($1)', [digitado])).rows, digitado).toEqual([{ id: id(1) }]);
      }

      // erros: 22023 (entrada) e 23505 (id e codigo de tenants diferentes), nenhum tenant novo
      const n1 = await total();
      for (const [caso, e, codigo] of [
        ['sem codigo e sem id', entrada({ uf: 'AM' }), '22023'],
        ['sem codigo e sem uf', entrada({ id: id(6) }), '22023'],
        ['uf vazia', entrada({ id: id(6), uf: '  ' }), '22023'],
        ['uf inexistente', entrada({ id: id(6), uf: 'XX' }), '22023'],
        ['uf não texto', entrada({ id: id(6), uf: 13 }), '22023'],
        ['uf inválida com codigo', entrada({ id: id(6), codigo: 'empresa-z', uf: 'ZZ' }), '22023'],
        ['id que não é UUID', entrada({ id: 'nao-e-uuid', uf: 'AM' }), '22023'],
        ['codigo não texto', entrada({ id: id(6), codigo: 100006 }), '22023'],
        ['codigo com maiúscula', entrada({ id: id(6), codigo: 'Maiusc' }), '22023'],
        ['id de um tenant com outro codigo', entrada({ id: id(1), codigo: 'outro' }), '23505'],
        ['codigo de um tenant com outro id', entrada({ id: id(6), codigo: r1.codigo.toLowerCase() }), '23505'],
        ['sem codigo, entrada inválida', entrada({ id: id(6), uf: 'AM', modulos: [] }), '22023'],
      ] as const) {
        expect((await erroDe(provisionar(e)))?.code, caso).toBe(codigo);
      }
      expect(await total()).toBe(n1);
      expect(await codigoDe(id(6))).toBeUndefined();

      // atribuir_codigo_licenca: thathyany ganha o código da UF; de novo = o mesmo; auditoria com antes e depois
      const a1 = await atribuir(id(90), 'rr');
      expect(a1).toMatchObject({ tenant_id: id(90), codigo_anterior: 'thathyany', resultado: 'atribuido' });
      expect(a1.codigo).toMatch(/^RR\d{4}$/);
      expect(a1.codigo).not.toBe(r2.codigo);
      expect(await codigoDe(id(90))).toBe(a1.codigo);
      expect(await atribuir(id(90), 'RR')).toEqual({ ...a1, resultado: 'sem_mudanca' });
      const aud = await c.query("select antes, depois from plataforma.auditoria where tenant_id = $1 and acao = 'tenant.codigo_licenca'", [id(90)]);
      expect(aud.rows).toEqual([{ antes: { codigo: 'thathyany' }, depois: { codigo: a1.codigo } }]);
      // quem nasceu com o código da UF: o mesmo, sem auditoria
      expect(await atribuir(id(1), 'AM')).toEqual({ tenant_id: id(1), codigo_anterior: r1.codigo, codigo: r1.codigo, resultado: 'sem_mudanca' });
      for (const [caso, p, codigo] of [
        ['uf inválida', atribuir(id(91), 'XX'), '22023'],
        ['uf nula', atribuir(id(91), null), '22023'],
        ['tenant inexistente', atribuir(id(99), 'AM'), 'P0002'],
      ] as const) {
        expect((await erroDe(p))?.code, caso).toBe(codigo);
      }
      expect(await codigoDe(id(91))).toBe('demo');

      // UF esgotada: com 9.999 números de TO em uso, o sorteio acha o último livre; com os 10.000, 54000
      await c.query('set session_replication_role = replica'); // sem os gatilhos de semeadura do tenant
      await c.query("insert into plataforma.tenant (codigo, nome) select 'TO' || lpad(n::text, 4, '0'), 'Cheia' from generate_series(0, 9998) n");
      await c.query('set session_replication_role = origin');
      expect((await c.query<{ v: string }>("select plataforma.sortear_codigo_licenca('to') as v")).rows[0]!.v).toBe('TO9999');
      await c.query('set session_replication_role = replica');
      await c.query("insert into plataforma.tenant (codigo, nome) values ('TO9999', 'Cheia')");
      await c.query('set session_replication_role = origin');
      const esgotada = await erroDe(provisionar(entrada({ id: id(7), uf: 'TO' })));
      expect(esgotada?.code).toBe('54000');
      expect(esgotada?.message).toContain('não há código livre para a UF TO');
      await c.query('set session_replication_role = replica');
      await c.query("delete from plataforma.tenant where nome = 'Cheia'");
      await c.query('set session_replication_role = origin');

      // down com código da licença em uso: falha (55000, transação implícita do texto todo) sem mudar nada
      const comLicenca = await retratoDoCatalogo(c);
      const recusado = await erroDe(c.query(m68.down));
      expect(recusado?.code).toBe('55000');
      expect(recusado?.message).toContain('com código da licença (UF + 4 dígitos) não cabem no CHECK da 0001');
      expect(await retratoDoCatalogo(c)).toEqual(comLicenca);
      await expect(migrarDown(c, { passos: 1 })).rejects.toThrow(/Falha ao desfazer 0068_plataforma_tenant_numero_licenca/);

      // sem nenhum código da licença: down volta ao catálogo da 0067; os legados ficam; de novo = igual
      await c.query("update plataforma.tenant set codigo = lower(codigo) where codigo ~ '^[A-Z]{2}[0-9]{4}$' and id <> $1", [id(90)]);
      await c.query("update plataforma.tenant set codigo = 'thathyany' where id = $1", [id(90)]);
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0068_plataforma_tenant_numero_licenca']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect((await erroDe(provisionar(entrada({ id: id(8), uf: 'AM' }))))?.code).toBe('22023');
      expect([await codigoDe(id(90)), await codigoDe(id(91))]).toEqual(['thathyany', 'demo']);
      await c.query(m68.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);

      // up de novo: igual
      await migrarUp(c, { ate: '0068' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      expect((await provisionar(entrada({ id: id(8), uf: 'AM' }))).codigo).toMatch(/^AM\d{4}$/);
    });
  });
});
