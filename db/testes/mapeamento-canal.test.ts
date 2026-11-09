/**
 * 0054 — tipo 'canal' no de-para da Integração (T-0115, RN-PES-05; pedido R-20261109-014928-modulo-integracao).
 * O que o BANCO garante em integracao.mapeamento: CHECK mapeamento_tipo_valido = TIPOS_MAPEAMENTO (com 'canal'); índices,
 * RLS e grants herdados da 0010. Down apaga os de-paras de canal e volta ao catálogo da 0053. Banco: papel de APLICAÇÃO
 * sobre a fixture dois-tenants (ROLLBACK); up/down num banco efêmero (CI).
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TIPOS_MAPEAMENTO } from '../../modules/integracao/contracts/bko';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m54 = migracoes.find((m) => m.versao === '0054')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const tiposDoCheck = (sql: string) =>
  [...(/add constraint mapeamento_tipo_valido\s+check \(tipo in \(([^)]*)\)\)/.exec(sql)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);

describe('0054 tipo canal no de-para (estático)', () => {
  it('nome e posição: 0054_integracao_mapeamento_canal logo depois da 0053', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0053_core_cliente_canal') + 1]).toBe('0054_integracao_mapeamento_canal');
  });

  it('up: só o CHECK de integracao.mapeamento, igual a TIPOS_MAPEAMENTO; sem índice, política, grant nem dado', () => {
    const up = semComentarios(m54.up);
    expect(TIPOS_MAPEAMENTO).toContain('canal');
    expect(tiposDoCheck(up)).toEqual([...TIPOS_MAPEAMENTO]);
    expect(up).toContain('alter table integracao.mapeamento drop constraint mapeamento_tipo_valido;');
    expect(up).not.toMatch(/create |drop index|policy|grant |revoke |update |insert into|delete from/);
    expect(new Set([...up.matchAll(/alter table ([a-z_]+\.[a-z_]+)/g)].map((x) => x[1]))).toEqual(new Set(['integracao.mapeamento']));
  });

  it('down: apaga os de-paras de canal e volta ao CHECK da 0010 (3 tipos)', () => {
    const down = semComentarios(m54.down);
    expect(down).toContain('drop constraint if exists mapeamento_tipo_valido;');
    expect(down).toContain("delete from integracao.mapeamento where tipo = 'canal';");
    expect(down.indexOf('delete from')).toBeLessThan(down.indexOf('add constraint'));
    expect(tiposDoCheck(down)).toEqual(['condicao_pagamento', 'deposito', 'status']);
  });
});

describe.skipIf(semBanco())('0054 tipo canal no de-para (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const inserir = (tenant: string, tipo: string, erp: string) =>
    app.query('insert into integracao.mapeamento (tenant_id, tipo, codigo_erp, codigo_macuxi) values ($1, $2, $3, $4) returning id', [tenant, tipo, erp, 'Supermercado']);

  it("grava tipo 'canal'; tipo fora da lista => 23514 (mapeamento_tipo_valido); codigo_erp repetido no canal => 23505", async () => {
    await emTransacao(app, A.tenantId, async () => {
      expect((await inserir(A.tenantId, 'canal', 'SUP')).rowCount).toBe(1);
      // o único-ativo por codigo_macuxi é só da condicao_pagamento: dois códigos do ERP no mesmo canal valem
      expect((await inserir(A.tenantId, 'canal', 'SUP2')).rowCount).toBe(1);
    });
    expect(await erroDe(emTransacao(app, A.tenantId, () => inserir(A.tenantId, 'canal_x', 'SUP')))).toMatchObject({ code: '23514', message: expect.stringContaining('mapeamento_tipo_valido') });
    expect(
      await erroDe(emTransacao(app, A.tenantId, async () => {
        await inserir(A.tenantId, 'canal', 'SUP');
        await inserir(A.tenantId, 'canal', 'SUP');
      })),
    ).toMatchObject({ code: '23505' });
  });

  it('vazamento: B não vê o de-para de canal de A', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await inserir(A.tenantId, 'canal', 'SUP');
      await app.query("select set_config('app.tenant_id', $1, true)", [B.tenantId]);
      expect((await app.query("select id from integracao.mapeamento where tipo = 'canal'")).rowCount).toBe(0);
    });
  });
});

describe.skipIf(semBanco())('0054 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up troca só o CHECK; down volta ao catálogo da 0053, idempotente; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0053' });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c, { ate: '0054' })).aplicadas).toEqual(['0054_integracao_mapeamento_canal']);
      const depois = await retratoDoCatalogo(c);
      const sumiram = antes.filter((l) => !depois.includes(l));
      const novas = depois.filter((l) => !antes.includes(l));
      expect(sumiram).toHaveLength(1);
      expect(sumiram[0]).toMatch(/^con integracao\.mapeamento_tipo_valido CHECK/);
      expect(novas).toHaveLength(1);
      expect(novas[0]).toMatch(/^con integracao\.mapeamento_tipo_valido CHECK .*'canal'/);
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0054_integracao_mapeamento_canal']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m54.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: '0054' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
