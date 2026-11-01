/**
 * T-0029 — regras que o BANCO garante nas migrações 0008 (preço do Catálogo) e 0009 (pedido completo do Vendedor),
 * desenho docs/desenho/T-0029.md §10. Tudo como o papel de APLICAÇÃO (macuxi_app, sujeito a RLS) sobre a fixture
 * dois-tenants, em transações desfeitas no fim (não sujam a fixture). O vazamento entre tenants das tabelas novas está em
 * vazamento.test.ts (descoberta dinâmica de toda tabela com tenant_id) e o up/down/up em migracoes.test.ts.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const tA = A.tenantId;
const P = (n: number) => `9d0c2f4e-0029-4000-8000-${String(n).padStart(12, '0')}`;

describe.skipIf(semBanco())('T-0029: regras garantidas pelo banco (papel de aplicação)', () => {
  let app: pg.Client;

  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });

  const comA = <T>(fn: () => Promise<T>) => emTransacao(app, tA, fn);
  /** erroDe dentro de um SAVEPOINT: o erro esperado não aborta a transação do teste. */
  const tentar = async (fn: () => Promise<unknown>) => {
    await app.query('savepoint t');
    const e = await erroDe(fn());
    await app.query(e ? 'rollback to savepoint t' : 'release savepoint t');
    return e;
  };
  const pedido = (id: string, status: string, extra: Record<string, unknown> = {}) => {
    const cols = { id, tenant_id: tA, cliente_id: A.clientes.c1, vendedor_id: A.usuarios.vendedor1, autor_id: A.usuarios.vendedor1, status, ...extra };
    const nomes = Object.keys(cols);
    return app.query(`insert into vendedor.pedido (${nomes.join(', ')}) values (${nomes.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(cols));
  };

  describe('vendedor.pedido (0009)', () => {
    it('RN-VEN-10: pending_approval sem nível => 23514; com nível válido passa; nível fora da lista => 23514', async () => {
      await comA(async () => {
        expect((await tentar(() => pedido(P(1), 'pending_approval')))?.code).toBe('23514');
        expect(await tentar(() => pedido(P(2), 'pending_approval', { nivel_aprovacao: 'supervisor', motivos_aprovacao: ['desconto'] }))).toBeNull();
        expect((await tentar(() => pedido(P(3), 'approved', { nivel_aprovacao: 'diretor' })))?.code).toBe('23514');
      });
    });

    it('RN-GES-08: rejected exige motivo com 3+ caracteres (sem contar espaços)', async () => {
      await comA(async () => {
        expect((await tentar(() => pedido(P(4), 'rejected')))?.code).toBe('23514');
        expect((await tentar(() => pedido(P(5), 'rejected', { motivo_rejeicao: '  ab  ' })))?.code).toBe('23514');
        expect(await tentar(() => pedido(P(6), 'rejected', { motivo_rejeicao: 'abc' }))).toBeNull();
      });
    });

    it('motivos só da lista do contrato; hash_envio sha256 hex; retrato do cliente é objeto', async () => {
      await comA(async () => {
        expect((await tentar(() => pedido(P(7), 'approved', { motivos_aprovacao: ['desconto', 'outro'] })))?.code).toBe('23514');
        expect((await tentar(() => pedido(P(8), 'approved', { hash_envio: 'ABC' })))?.code).toBe('23514');
        expect((await tentar(() => pedido(P(9), 'approved', { cliente_resumo: JSON.stringify(['x']) })))?.code).toBe('23514');
        expect(await tentar(() => pedido(P(10), 'approved', { hash_envio: 'f'.repeat(64), cliente_resumo: JSON.stringify({ razao_social: 'X' }) }))).toBeNull();
      });
    });

    it('número único por tenant (23505) e gerado pelo contador do tenant, em sequência', async () => {
      await comA(async () => {
        const n1 = (await app.query<{ n: string }>('select vendedor.proximo_numero_pedido() as n')).rows[0]!.n;
        const n2 = (await app.query<{ n: string }>('select vendedor.proximo_numero_pedido() as n')).rows[0]!.n;
        expect(n1).toMatch(/^\d{6}$/);
        expect(Number(n2)).toBe(Number(n1) + 1);
        expect(Number(n1)).toBeGreaterThan(3); // a fixture de A já usou 000001..000003
        expect(await tentar(() => pedido(P(11), 'approved', { numero: n1 }))).toBeNull();
        expect((await tentar(() => pedido(P(12), 'approved', { numero: n1 })))?.code).toBe('23505');
      });
      // o contador de B não andou (cada tenant tem o seu)
      const b = await emTransacao(app, B.tenantId, () => app.query<{ n: string }>('select vendedor.proximo_numero_pedido() as n'));
      expect(b.rows[0]!.n).toBe('000002');
    });

    it('condição do pedido é FK no schema: id inexistente ou de outro tenant => 23503', async () => {
      await comA(async () => {
        expect((await tentar(() => pedido(P(13), 'approved', { condicao_pagamento_id: B.condicoes.avista })))?.code).toBe('23503');
        expect(await tentar(() => pedido(P(14), 'approved', { condicao_pagamento_id: A.condicoes.d28 }))).toBeNull();
      });
    });
  });

  describe('vendedor.pedido_evento, condicao_pagamento, cliente_condicao (0009)', () => {
    it('histórico: só INSERT e SELECT para a aplicação; status fora da lista => 23514; de = para => 23514', async () => {
      await comA(async () => {
        const ins = (de: string | null, para: string) =>
          app.query('insert into vendedor.pedido_evento (tenant_id, pedido_id, de, para) values ($1, $2, $3, $4)', [tA, A.pedidos.p1, de, para]);
        expect(await tentar(() => ins('received', 'approved'))).toBeNull();
        expect((await tentar(() => ins('received', 'aprovado')))?.code).toBe('23514');
        expect((await tentar(() => ins('approved', 'approved')))?.code).toBe('23514');
      });
      await comA(async () => {
        expect((await tentar(() => app.query("update vendedor.pedido_evento set motivo = 'x'")))?.code).toBe('42501');
      });
      await comA(async () => {
        expect((await tentar(() => app.query('delete from vendedor.pedido_evento')))?.code).toBe('42501');
      });
    });

    it('evento de pedido de outro tenant => 23503 (FK composta)', async () => {
      await comA(async () => {
        const e = await tentar(() => app.query("insert into vendedor.pedido_evento (tenant_id, pedido_id, para) values ($1, $2, 'received')", [tA, B.pedidos.p1]));
        expect(e?.code).toBe('23503');
      });
    });

    it('condição: código único vivo; no máximo uma padrão viva; padrão precisa estar ativa', async () => {
      await comA(async () => {
        const ins = (codigo: string, padrao: boolean, ativo = true) =>
          app.query('insert into vendedor.condicao_pagamento (tenant_id, codigo, descricao, padrao, ativo) values ($1, $2, $3, $4, $5)', [tA, codigo, codigo, padrao, ativo]);
        expect((await tentar(() => ins('28D', false)))?.code).toBe('23505');
        expect((await tentar(() => ins('NOVA', true)))?.code).toBe('23505');
        expect((await tentar(() => ins('INATIVA', false, false))) === null).toBe(true);
        expect((await tentar(() => ins('PAD-INATIVA', true, false)))?.code).toBe('23514');
        // a padrão removida libera outra padrão
        await app.query('update vendedor.condicao_pagamento set deleted_at = now(), padrao = false where id = $1', [A.condicoes.avista]);
        expect(await tentar(() => ins('NOVA', true))).toBeNull();
      });
    });

    it('cliente_condicao: par (cliente, condição) único vivo; condição de outro tenant => 23503', async () => {
      await comA(async () => {
        const ins = (condicao: string) =>
          app.query('insert into vendedor.cliente_condicao (tenant_id, cliente_id, condicao_pagamento_id) values ($1, $2, $3)', [tA, A.clientes.c1, condicao]);
        expect((await tentar(() => ins(A.condicoes.d28)))?.code).toBe('23505');
        expect((await tentar(() => ins(B.condicoes.avista)))?.code).toBe('23503');
      });
    });
  });

  describe('catalogo (0008)', () => {
    it('preço > 0 e vigência com fim depois do início (23514); início repetido no mesmo produto e tabela => 23505', async () => {
      await comA(async () => {
        const ins = (produto: string, preco: number, inicio: string | null, fim: string | null) =>
          app.query(
            'insert into catalogo.tabela_preco_item (tenant_id, tabela_preco_id, produto_id, preco_cents, vigencia_inicio, vigencia_fim) values ($1, $2, $3, $4, $5, $6)',
            [tA, A.tabelasPreco.padrao, produto, preco, inicio, fim],
          );
        const outro = '9d0c2f4e-0029-4000-8000-0000000000ff';
        expect((await tentar(() => ins(outro, 0, null, null)))?.code).toBe('23514');
        expect((await tentar(() => ins(outro, 100, '2026-10-10T00:00:00Z', '2026-10-10T00:00:00Z')))?.code).toBe('23514');
        expect(await tentar(() => ins(outro, 100, null, '2026-10-01T00:00:00Z'))).toBeNull();
        // dois "desde sempre" no mesmo produto e tabela (NULLS NOT DISTINCT)
        expect((await tentar(() => ins(outro, 120, null, null)))?.code).toBe('23505');
        expect(await tentar(() => ins(outro, 120, '2026-10-01T00:00:00Z', null))).toBeNull();
      });
    });

    it('uma tabela viva por cliente (23505); tabela de outro tenant => 23503; código de tabela único vivo', async () => {
      await comA(async () => {
        const ins = (cliente: string, tabela: string) =>
          app.query('insert into catalogo.cliente_tabela_preco (tenant_id, cliente_id, tabela_preco_id) values ($1, $2, $3)', [tA, cliente, tabela]);
        expect((await tentar(() => ins(A.clientes.c1, A.tabelasPreco.padrao)))?.code).toBe('23505');
        expect((await tentar(() => ins(A.clientes.c3, B.tabelasPreco.padrao)))?.code).toBe('23503');
        expect(await tentar(() => ins(A.clientes.c3, A.tabelasPreco.padrao))).toBeNull();
        const e = await tentar(() => app.query("insert into catalogo.tabela_preco (tenant_id, codigo, nome) values ($1, 'PADRAO', 'Outra')", [tA]));
        expect(e?.code).toBe('23505');
      });
    });

    it('preço vigente do cliente pela consulta do dicionário (RN-CAT-06): c3 sem tabela não tem preço; vigência vencida não vale', async () => {
      const r = await comA(() =>
        app.query<{ cliente_id: string; produto_id: string; preco_cents: string }>(
          `select distinct on (ct.cliente_id, i.produto_id) ct.cliente_id, i.produto_id, i.preco_cents
             from catalogo.cliente_tabela_preco ct
             join catalogo.tabela_preco t on t.tenant_id = ct.tenant_id and t.id = ct.tabela_preco_id and t.ativo and t.deleted_at is null
             join catalogo.tabela_preco_item i on i.tenant_id = ct.tenant_id and i.tabela_preco_id = ct.tabela_preco_id
            where ct.deleted_at is null and i.deleted_at is null and ct.cliente_id = any($1::uuid[])
              and (i.vigencia_inicio is null or i.vigencia_inicio <= $2) and (i.vigencia_fim is null or i.vigencia_fim > $2)
            order by ct.cliente_id, i.produto_id, i.vigencia_inicio desc nulls last`,
          [[A.clientes.c1, A.clientes.c3], '2099-01-01T00:00:00Z'],
        ),
      );
      expect(r.rows.map((x) => [x.cliente_id, Number(x.preco_cents)])).toEqual([[A.clientes.c1, 100_000]]);
    });
  });
});
