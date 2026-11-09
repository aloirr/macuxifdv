/**
 * 0055 — endereço de entrega editado só no pedido (T-0141 item C; RN-VEN-17; desenho docs/desenho/T-0141.md §6).
 * O que o BANCO garante em vendedor.pedido: o retrato endereco_entrega (jsonb, 0013) aceita `origem` ausente (= 'erp', linhas
 * antigas), 'erp' ou 'editado'; o editado não aponta para endereço do cadastro (coluna endereco_entrega_id, id e external_id
 * do retrato nulos: o Conector usa os textos quando o external_id é nulo) e vem completo (logradouro, número, bairro, cidade,
 * UF com 2 letras maiúsculas, CEP com 8 dígitos). Sem coluna nova, sem dado migrado; RLS e grants da 0007/0013.
 * Banco: papel de APLICAÇÃO sobre a fixture dois-tenants (ROLLBACK); up/down num banco efêmero. Os casos de banco rodam no
 * CI (sem Docker no PC do dono do produto, R-20261105-053835).
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m55 = migracoes.find((m) => m.versao === '0055')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const CHECKS = ['pedido_endereco_entrega_origem', 'pedido_endereco_editado_sem_id', 'pedido_endereco_editado_completo'];

/** Retrato do editado como o Vendedor grava (desenho §2.1): sem id/external_id, principal false, campos normalizados. */
const EDITADO = {
  id: null, external_id: null, descricao: null, logradouro: 'Rua Nova do Depósito', numero: 'S/N', complemento: null,
  bairro: 'Distrito Industrial', cidade: 'Manaus', uf: 'AM', cep: '69075000', principal: false, origem: 'editado',
} as const;
const DO_ERP = { id: '00000000-0000-4000-8000-0000000000e1', external_id: 'END-1', tipo: 'principal', descricao: 'Principal', logradouro: 'Rua A', numero: '10', complemento: null, bairro: 'Centro', cidade: 'Manaus', uf: 'AM', cep: '69000000', principal: true };

describe('0055 endereço editado no pedido (estático)', () => {
  it('nome e posição: 0055_vendedor_endereco_editado logo depois da 0054', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0054_integracao_mapeamento_canal') + 1]).toBe('0055_vendedor_endereco_editado');
  });

  it('up: só os 3 CHECKs em vendedor.pedido; sem coluna, índice, política, grant nem dado', () => {
    const up = semComentarios(m55.up);
    expect([...up.matchAll(/add constraint ([a-z_]+)\s+check/g)].map((x) => x[1])).toEqual(CHECKS);
    expect(new Set([...up.matchAll(/alter table ([a-z_]+\.[a-z_]+)/g)].map((x) => x[1]))).toEqual(new Set(['vendedor.pedido']));
    expect(up).not.toMatch(/add column|create |drop |policy|grant |revoke |update |insert into|delete from|not valid/);
    // origem ausente = 'erp' (linhas anteriores à T-0141 seguem válidas sem migração de dados)
    expect(up).toContain("coalesce(endereco_entrega->>'origem', 'erp') in ('erp', 'editado')");
  });

  it('down: remove os 3 CHECKs (idempotente) e não mexe em dado', () => {
    const down = semComentarios(m55.down);
    expect([...down.matchAll(/drop constraint if exists ([a-z_]+);/g)].map((x) => x[1]).sort()).toEqual([...CHECKS].sort());
    expect(down).not.toMatch(/update |delete from|add constraint|drop column/);
  });
});

describe.skipIf(semBanco())('0055 endereço editado no pedido (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  /** O update que receber.ts/orcamentos.ts fazem (coluna + retrato). */
  const gravar = (pedido: string, enderecoId: string | null, retrato: unknown) =>
    app.query('update vendedor.pedido set endereco_entrega_id = $2, endereco_entrega = $3::jsonb where id = $1', [pedido, enderecoId, retrato === null ? null : JSON.stringify(retrato)]);

  it('RN-VEN-17: grava o editado (coluna nula) e lê de volta; o do ERP com e sem origem e o retrato nulo continuam valendo', async () => {
    await emTransacao(app, A.tenantId, async () => {
      expect((await gravar(A.pedidos.p1, null, EDITADO)).rowCount).toBe(1);
      const r = await app.query<{ id: string | null; e: Record<string, unknown> }>('select endereco_entrega_id as id, endereco_entrega as e from vendedor.pedido where id = $1', [A.pedidos.p1]);
      expect(r.rows[0]).toEqual({ id: null, e: EDITADO });
      expect((await gravar(A.pedidos.p2, DO_ERP.id, DO_ERP)).rowCount).toBe(1); // sem origem (APK atual / linha antiga)
      expect((await gravar(A.pedidos.p2, DO_ERP.id, { ...DO_ERP, origem: 'erp' })).rowCount).toBe(1);
      expect((await gravar(A.pedidos.p3, null, null)).rowCount).toBe(1);
    });
  });

  it.each([
    ['origem desconhecida', null, { ...EDITADO, origem: 'manual' }, 'pedido_endereco_entrega_origem'],
    ['origem não texto', DO_ERP.id, { ...DO_ERP, origem: 1 }, 'pedido_endereco_entrega_origem'],
    ['editado com a coluna endereco_entrega_id', DO_ERP.id, EDITADO, 'pedido_endereco_editado_sem_id'],
    ['editado com o id do cadastro no retrato', null, { ...EDITADO, id: DO_ERP.id }, 'pedido_endereco_editado_sem_id'],
    ['editado com o external_id do ERP (o Conector entregaria no cadastro)', null, { ...EDITADO, external_id: 'END-1' }, 'pedido_endereco_editado_sem_id'],
    ['editado sem logradouro', null, { ...EDITADO, logradouro: '  ' }, 'pedido_endereco_editado_completo'],
    ['editado sem número', null, { ...EDITADO, numero: null }, 'pedido_endereco_editado_completo'],
    ['editado sem bairro', null, { ...EDITADO, bairro: '' }, 'pedido_endereco_editado_completo'],
    ['editado sem cidade', null, { ...EDITADO, cidade: undefined }, 'pedido_endereco_editado_completo'],
    ['editado com UF minúscula', null, { ...EDITADO, uf: 'am' }, 'pedido_endereco_editado_completo'],
    ['editado com CEP de 7 dígitos', null, { ...EDITADO, cep: '6907500' }, 'pedido_endereco_editado_completo'],
    ['editado com CEP com máscara', null, { ...EDITADO, cep: '69075-000' }, 'pedido_endereco_editado_completo'],
    ['editado sem CEP', null, { ...EDITADO, cep: null }, 'pedido_endereco_editado_completo'],
  ])('restrição: %s', async (_nome, enderecoId, retrato, check) => {
    const e = await erroDe(emTransacao(app, A.tenantId, () => gravar(A.pedidos.p1, enderecoId, retrato)));
    expect(e).toMatchObject({ code: '23514', message: expect.stringContaining(check) });
  });

  it('vazamento entre tenants: B não vê nem altera o pedido editado de A', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await gravar(A.pedidos.p1, null, EDITADO);
      await app.query("select set_config('app.tenant_id', $1, true)", [B.tenantId]);
      expect((await app.query("select id from vendedor.pedido where endereco_entrega->>'origem' = 'editado'")).rowCount).toBe(0);
      expect((await gravar(A.pedidos.p1, null, null)).rowCount).toBe(0);
      await app.query("select set_config('app.tenant_id', $1, true)", [A.tenantId]);
      expect((await app.query("select id from vendedor.pedido where endereco_entrega->>'origem' = 'editado'")).rows).toEqual([{ id: A.pedidos.p1 }]);
    });
  });
});

describe.skipIf(semBanco())('0055 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up acrescenta só os 3 CHECKs; down volta ao catálogo da 0054, idempotente; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0054' });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c, { ate: '0055' })).aplicadas).toEqual(['0055_vendedor_endereco_editado']);
      const depois = await retratoDoCatalogo(c);
      expect(antes.filter((l) => !depois.includes(l))).toEqual([]);
      const novas = depois.filter((l) => !antes.includes(l));
      expect(novas.map((l) => /^con vendedor\.([a-z_]+) CHECK/.exec(l)?.[1]).sort()).toEqual([...CHECKS].sort());
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0055_vendedor_endereco_editado']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m55.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: '0055' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
