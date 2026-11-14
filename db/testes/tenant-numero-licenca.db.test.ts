/**
 * 0068 — o código da empresa é o número único da licença (pedido do dono do produto, R-20261114-130500). Dicionário:
 * docs/banco/plataforma.md, "0068". O que o BANCO garante:
 * - plataforma.tenant_numero_licenca_seq: integer 100001..999999, no cycle, sem grant;
 * - provisionar_tenant sem codigo (ausente, nulo ou "") gera o número (texto de 6 dígitos) e exige o id do chamador, que é a
 *   chave de idempotência: a mesma chamada devolve o mesmo tenant e o mesmo número, sem gastar outro; número já usado como
 *   código é pulado; codigo informado segue como antes; id e codigo de tenants diferentes = 23505;
 * - o retorno traz 'codigo'; o CHECK tenant_codigo_formato aceita 6 dígitos, demo e teste-macuxi;
 * - sa_provisionar_tenant: sem codigo e sem admin é empresa nova (RN-CORE-34) quando o id não é de tenant vivo;
 * - down volta a provisionar_tenant da 0040 e a sa_provisionar_tenant da 0039 (texto exato) e apaga a sequência.
 * Estático na sessão; up/down e as chamadas num banco efêmero (a sequência não volta com ROLLBACK) no CI.
 */
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { semBanco } from './estado';
import { erroDe, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const m39 = migracoes.find((m) => m.versao === '0039')!;
const m40 = migracoes.find((m) => m.versao === '0040')!;
const m68 = migracoes.find((m) => m.versao === '0068')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m68.up);
const down = semComentarios(m68.down);
const SEQ = 'plataforma.tenant_numero_licenca_seq';
const PROV = 'create function plataforma.provisionar_tenant(p jsonb)';
const SA = 'create or replace function plataforma.sa_provisionar_tenant(p_sid uuid, p jsonb)';
/** Do início até o `$$;` que fecha a função (o mesmo recorte da senha-email-saida.test.ts). */
const bloco = (sql: string, inicio: string) => {
  const i = sql.indexOf(inicio);
  if (i < 0) return '';
  const fim = /^ {0,2}\$\$;$/m.exec(sql.slice(i));
  return fim ? sql.slice(i, i + fim.index + fim[0].length) : '';
};

describe('0068 número da licença (estático)', () => {
  it('nome e posição: 0068_plataforma_tenant_numero_licenca logo depois da 0067', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0067_core_cliente_visita_resumo') + 1]).toBe('0068_plataforma_tenant_numero_licenca');
  });

  it('sequência de 6 dígitos sem ciclo e sem grant; nenhuma tabela, coluna ou CHECK muda', () => {
    expect(up).toContain(`create sequence ${SEQ} as integer start with 100001 minvalue 100001 maxvalue 999999 no cycle;`);
    expect(up).toContain(`revoke all on sequence ${SEQ} from public;`);
    expect(up).not.toMatch(/\bgrant\b[^;]*sequence/);
    expect(up).not.toMatch(/create table|alter table|create (unique )?index|tenant_codigo_formato|\bpolicy\b/i);
  });

  it('provisionar_tenant: mesma assinatura e segurança; id UUID como chave; codigo opcional; nextval só para tenant novo', () => {
    const b = bloco(up, PROV);
    expect(b).not.toBe('');
    expect(up.indexOf('drop function if exists plataforma.provisionar_tenant(jsonb);')).toBeLessThan(up.indexOf(PROV));
    expect(b).toMatch(/returns jsonb\s+language plpgsql volatile security invoker\s+set search_path = pg_catalog, plataforma, pg_temp\s/);
    expect(up).toContain('revoke all on function plataforma.provisionar_tenant(jsonb) from public;');
    expect(up).not.toMatch(/grant [^;]*provisionar_tenant\(jsonb\)/);
    expect(b).toContain("v_codigo := nullif(p ->> 'codigo', '');");
    expect(b).toContain("perform pg_advisory_xact_lock(hashtextextended('plataforma.provisionar_tenant:' || v_id::text, 0));");
    expect(b).toContain(`v_codigo := nextval('${SEQ}')::text;`);
    expect(b).toContain('exit when not exists (select 1 from plataforma.tenant t where lower(t.codigo) = v_codigo);');
    expect(b).toContain('values (coalesce(v_id, gen_random_uuid()), v_codigo, v_nome, v_documento, v_fuso, v_plano)');
    expect(b).toContain("'codigo', v_codigo,");
    // a validação toda (inclusive o admin) vem antes do nextval: entrada inválida não gasta número
    expect(b.indexOf("raise exception 'provisionar_tenant: senha_hash do admin")).toBeLessThan(b.indexOf('nextval('));
    expect(b.match(/nextval\(/g)).toHaveLength(1);
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
    // fora o bloco da condição, o corpo é o da 0039
    const fora = (s: string) => s.slice(0, s.indexOf('  if coalesce(jsonb_typeof(p -> \'admin\')')) + s.slice(s.indexOf('    v_entrada := (p - \'ator_id\' - \'admin\')'));
    expect(fora(novo)).toBe(fora(antigo));
  });

  it('down: provisionar_tenant com o texto EXATO da 0040, sa_provisionar_tenant com o da 0039 e a sequência apagada', () => {
    const prov40 = bloco(m40.up, PROV);
    const sa39 = bloco(m39.up, SA);
    expect(prov40).not.toBe('');
    expect(sa39).not.toBe('');
    expect(m68.down).toContain(prov40);
    expect(m68.down).toContain(sa39);
    expect(down).toContain('drop function if exists plataforma.provisionar_tenant(jsonb);');
    expect(down).toContain('revoke all on function plataforma.provisionar_tenant(jsonb) from public;');
    expect(down).toContain(`drop sequence if exists ${SEQ};`);
    expect(down).not.toMatch(/nextval|create sequence|\bgrant\b/);
  });
});

/** Hash argon2id de mentira (formato PHC válido; nunca uma senha real). */
const H1 = '$argon2id$v=19$m=1,t=1,p=1$c2FsdW0$aGFzaHVt';
const id = (n: number) => `aaaaaaaa-0068-4000-8000-0000000000${String(n).padStart(2, '0')}`;
function entrada(extra: Record<string, unknown>) {
  return { nome: 'Distribuidora 0068', modulos: [{ modulo: 'core', licencas: null, perfis: ['admin', 'vendedor'] }], sem_admin: true, ...extra };
}
interface Saida {
  tenant_id: string;
  codigo: string;
  resultado: 'criado' | 'atualizado' | 'sem_mudanca';
  admin: string;
}

describe.skipIf(semBanco())('0068 número da licença (banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('gera 100001, 100002...; idempotente pelo id; codigo explícito como antes; CHECK; erros sem gastar número; up/down', async () => {
    await comAdmin(b.nome, async (c: pg.Client) => {
      const provisionar = async (e: unknown): Promise<Saida> =>
        (await c.query<{ r: Saida }>('select plataforma.provisionar_tenant($1::jsonb) as r', [JSON.stringify(e)])).rows[0]!.r;
      const ultimo = async () =>
        (await c.query<{ v: number; chamado: boolean }>(`select last_value::int as v, is_called as chamado from ${SEQ}`)).rows[0]!;
      const codigoDe = async (tenant: string) =>
        (await c.query<{ codigo: string }>('select codigo from plataforma.tenant where id = $1', [tenant])).rows[0]?.codigo;

      await migrarUp(c, { ate: '0067' });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c, { ate: '0068' })).aplicadas).toEqual(['0068_plataforma_tenant_numero_licenca']);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toContain(`rel ${SEQ} S rls=false force=false`);
      const seq = await c.query(
        "select data_type::text as tipo, start_value::int as inicio, min_value::int as minimo, max_value::int as maximo, cycle from pg_sequences where schemaname = 'plataforma' and sequencename = 'tenant_numero_licenca_seq'",
      );
      expect(seq.rows).toEqual([{ tipo: 'integer', inicio: 100001, minimo: 100001, maximo: 999999, cycle: false }]);
      expect((await ultimo()).chamado).toBe(false);

      // sem codigo (ausente, nulo e vazio): números em sequência, distintos, com o id do chamador
      const r1 = await provisionar(entrada({ id: id(1), sem_admin: false, admin: { email: 'admin.0068@exemplo.com.br', nome: 'Admin 0068', senha_hash: H1 } }));
      expect(r1).toMatchObject({ tenant_id: id(1), codigo: '100001', resultado: 'criado', admin: 'criado' });
      const r2 = await provisionar(entrada({ id: id(2), codigo: null }));
      const r3 = await provisionar(entrada({ id: id(3), codigo: '' }));
      expect([r2.codigo, r3.codigo]).toEqual(['100002', '100003']);
      expect([await codigoDe(id(1)), await codigoDe(id(2)), await codigoDe(id(3))]).toEqual(['100001', '100002', '100003']);
      expect(await ultimo()).toEqual({ v: 100003, chamado: true });

      // idempotência pela chave (id): mesmo tenant, mesmo número, nenhum número novo
      const r1b = await provisionar(entrada({ id: id(1), sem_admin: false, admin: { email: 'admin.0068@exemplo.com.br', nome: 'Admin 0068', senha_hash: H1 } }));
      expect(r1b).toMatchObject({ tenant_id: id(1), codigo: '100001', resultado: 'sem_mudanca', admin: 'existente' });
      expect(await provisionar(entrada({ id: id(2), codigo: '100002' }))).toMatchObject({ tenant_id: id(2), codigo: '100002', resultado: 'sem_mudanca' });
      expect((await ultimo()).v).toBe(100003);
      expect((await c.query("select count(*)::int as n from plataforma.tenant where codigo ~ '^[0-9]{6}$'")).rows[0].n).toBe(3);

      // codigo explícito: como antes (idempotente pelo código), sem gastar número; com id novo, nasce com o id
      const rx = await provisionar(entrada({ codigo: 'empresa-x' }));
      expect(rx).toMatchObject({ codigo: 'empresa-x', resultado: 'criado' });
      expect(await provisionar(entrada({ codigo: 'empresa-x' }))).toMatchObject({ tenant_id: rx.tenant_id, codigo: 'empresa-x', resultado: 'sem_mudanca' });
      expect(await provisionar(entrada({ id: id(4), codigo: 'empresa-y' }))).toMatchObject({ tenant_id: id(4), codigo: 'empresa-y', resultado: 'criado' });
      expect((await ultimo()).v).toBe(100003);

      // CHECK tenant_codigo_formato: códigos existentes e 6 dígitos; número já usado como código é pulado na geração
      await c.query("insert into plataforma.tenant (codigo, nome) values ('demo', 'Demo'), ('teste-macuxi', 'Teste'), ('100004', 'Manual')");
      expect((await erroDe(c.query("insert into plataforma.tenant (codigo, nome) values ('Demo-Maiusc', 'X')")))?.code).toBe('23514');
      expect((await provisionar(entrada({ id: id(5) }))).codigo).toBe('100005');

      // erros: 22023 (entrada) e 23505 (id e codigo de tenants diferentes), nenhum número gasto
      for (const [caso, e, codigo] of [
        ['sem codigo e sem id', entrada({}), '22023'],
        ['id que não é UUID', entrada({ id: 'nao-e-uuid' }), '22023'],
        ['codigo não texto', entrada({ id: id(6), codigo: 100006 }), '22023'],
        ['codigo com maiúscula', entrada({ id: id(6), codigo: 'Maiusc' }), '22023'],
        ['id de um tenant com outro codigo', entrada({ id: id(1), codigo: 'outro' }), '23505'],
        ['codigo de um tenant com outro id', entrada({ id: id(6), codigo: '100001' }), '23505'],
        ['sem codigo, entrada inválida', entrada({ id: id(6), modulos: [] }), '22023'],
      ] as const) {
        expect((await erroDe(provisionar(e)))?.code, caso).toBe(codigo);
      }
      expect((await ultimo()).v).toBe(100005);
      expect(await codigoDe(id(6))).toBeUndefined();

      // down: volta ao catálogo da 0067 (função antiga exige o codigo); os números ficam; de novo = igual
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0068_plataforma_tenant_numero_licenca']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect((await erroDe(provisionar(entrada({ id: id(7) }))))?.code).toBe('22023');
      expect(await codigoDe(id(1))).toBe('100001');
      await c.query(m68.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);

      // up de novo: a sequência recomeça em 100001 e pula os números já usados
      await migrarUp(c, { ate: '0068' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      expect((await provisionar(entrada({ id: id(7) }))).codigo).toBe('100006');
    });
  });
});
