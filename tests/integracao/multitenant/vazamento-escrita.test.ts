/**
 * T-0002 C2.2 — RN-CORE-05, escrita cruzada (cenário S0-025 do plano tests/plano/sprint-0.md).
 *
 * Complementa db/testes/vazamento.test.ts com caminhos que a escrita idempotente da API vai usar
 * (regra 4: UUID do aparelho + upsert) e com as chaves estrangeiras descobertas pelo catálogo:
 * - upsert (`on conflict (id) do update`) com o id de uma linha de B, no contexto de A: erro e B intacto;
 * - UPDATE/DELETE por id de B: 0 linhas e B intacto;
 * - toda FK entre tabelas de tenant inclui tenant_id (composta) — e, na prática, apontar para linha
 *   de B a partir de linha de A é recusado (23503).
 * Conexão: papel macuxi_app. Tudo em transação desfeita (não suja a fixture compartilhada).
 */
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { DOIS_TENANTS } from '@macuxi/db/teste';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conectar, tabelasDoCatalogo, tentar, type Tabela } from '../apoio/banco';

const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;

/**
 * Colunas que um CHECK da tabela-filha amarra à coluna da FK. Sem acertá-las no mesmo UPDATE, o CHECK (23514, avaliado
 * na hora da escrita) dispara antes da FK (23503, gatilho no fim do comando) e o teste reprovaria pelo motivo errado.
 * Os acertos só deixam a linha COERENTE com a coluna da FK preenchida; a mãe continua sendo a linha de B, então quem
 * recusa é a FK cruzada. Tudo em transação desfeita. Chave: nome da FK (migração 0013).
 */
const COERENCIA_DA_FK: Record<string, string> = {
  // catalogo_no_raiz_nivel_1: (pai_id is null) = (nivel = 1) — nó com pai tem nível > 1 (faixa 1..8)
  catalogo_no_pai_fk: 'nivel = greatest(nivel, 2)',
  // pedido_cif_sem_transportadora / pedido_fob_com_transportadora / pedido_transportadora_digitada:
  // transportadora cadastrada só existe com frete FOB e sem transportadora digitada
  pedido_transportadora_fk: "frete_modalidade = 'FOB', transportadora_digitada = false",
  // pedido_orcamento_origem / pedido_orcamento_campos: só pedido (tipo 'pedido', sem validade nem conversão) aponta orçamento
  pedido_orcamento_fk: "tipo = 'pedido', orcamento_validade = null, convertido_em = null",
  // 0018 (T-0063) produto_embalagem_completa / produto_embalagem_quantidade_minima: embalagem só com a quantidade (> 1)
  produto_embalagem_medida_fk: 'embalagem_quantidade = 12',
  // 0021 (T-0073) notificacao_recado_do_dia_par / notificacao_recado_do_dia_so_recado: quem marcou só existe com o dia
  // marcado, e o dia só em recado (tipo 'recado'); a fixture não marca recado do dia, então o único parcial
  // notificacao_recado_do_dia_uk não colide
  notificacao_recado_do_dia_por_fk: "tipo = 'recado', recado_do_dia = date '2026-01-01'",
  // 0037 (T-0089) pedido_pagamento_completo: forma, prazo e os 6 retratos do pagamento vêm juntos ou nenhum (num_nulls in (0, 8));
  // a fixture não leva pagamento em pedido, então completa-se a linha com o prazo/forma de A (a subconsulta roda como
  // macuxi_app no contexto de A: RLS só devolve linha de A) e o retrato "À vista" [0] (médio 0 passa em
  // pedido_prazo_parcelas_validas e pedido_prazo_medio_coerente). A outra FK aponta para A e passa; a da coluna testada,
  // para B, e é ela que recusa (23503). Não repete a coluna da própria FK (o UPDATE já faz set "<coluna>" = $2).
  pedido_forma_pagamento_fk:
    "prazo_pagamento_id = coalesce(prazo_pagamento_id, (select p.id from vendedor.prazo_pagamento p order by p.id limit 1)), forma_pagamento_codigo = coalesce(forma_pagamento_codigo, 'AVISTA'), forma_pagamento_nome = coalesce(forma_pagamento_nome, 'À vista'), prazo_codigo = coalesce(prazo_codigo, 'AVISTA'), prazo_descricao = coalesce(prazo_descricao, 'À vista'), prazo_parcelas_dias = coalesce(prazo_parcelas_dias, '{0}'::int[]), prazo_medio_dias = coalesce(prazo_medio_dias, 0)",
  pedido_prazo_pagamento_fk:
    "forma_pagamento_id = coalesce(forma_pagamento_id, (select f.id from vendedor.forma_pagamento f order by f.id limit 1)), forma_pagamento_codigo = coalesce(forma_pagamento_codigo, 'AVISTA'), forma_pagamento_nome = coalesce(forma_pagamento_nome, 'À vista'), prazo_codigo = coalesce(prazo_codigo, 'AVISTA'), prazo_descricao = coalesce(prazo_descricao, 'À vista'), prazo_parcelas_dias = coalesce(prazo_parcelas_dias, '{0}'::int[]), prazo_medio_dias = coalesce(prazo_medio_dias, 0)",
};

interface Fk {
  nome: string;
  filha: string;
  colunasFilha: string[];
  mae: string;
  colunasMae: string[];
}

describe.skipIf(semBanco())('S0-025 escrita cruzada entre tenants (papel macuxi_app)', () => {
  let admin: pg.Client;
  let app: pg.Client;
  let tabelas: Tabela[] = [];
  /** Uma linha de A e uma de B por tabela (id), lidas como admin. */
  const linha = new Map<string, { A: string; B: string }>();
  /** Retrato (jsonb) de todas as linhas de B, para provar que nada mudou no fim. */
  let retratoB = '';

  const retratarB = async () => {
    const partes: string[] = [];
    for (const t of tabelas) {
      const r = await admin.query<{ j: string }>(`select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]')::text as j from ${t.sql} x where tenant_id = $1`, [B]);
      partes.push(`${t.nome}=${r.rows[0]!.j}`);
    }
    return partes.join('\n');
  };

  beforeAll(async () => {
    admin = await conectar(banco().urlAdmin);
    app = await conectar(banco().urlApp);
    tabelas = (await tabelasDoCatalogo(admin)).filter((t) => t.temTenant);
    for (const t of tabelas) {
      const um = async (tenant: string) =>
        (await admin.query<{ id: string }>(`select id::text as id from ${t.sql} where tenant_id = $1 order by id limit 1`, [tenant])).rows[0]?.id;
      const [a, b] = [await um(A), await um(B)];
      if (a && b) linha.set(t.nome, { A: a, B: b });
    }
    retratoB = await retratarB();
  });
  afterAll(async () => {
    await app?.end();
    await admin?.end();
  });

  it('pré-condição: há linha de A e de B em toda tabela com tenant_id', () => {
    expect(tabelas.filter((t) => !linha.has(t.nome)).map((t) => t.nome)).toEqual([]);
  });

  it('upsert (on conflict (id) do update) com id de linha de B no contexto de A é recusado (42501)', async () => {
    for (const t of tabelas) {
      const { A: idA, B: idB } = linha.get(t.nome)!;
      const r = await tentar(app, A, () =>
        app.query(
          `insert into ${t.sql}
           select (jsonb_populate_record(null::${t.sql}, to_jsonb(r) || jsonb_build_object('id', $2::uuid))).*
             from ${t.sql} r where r.id = $1
           on conflict (id) do update set updated_at = excluded.updated_at`,
          [idA, idB],
        ),
      );
      // 42501 = violação de política (USING do UPDATE) ou falta de privilégio (auditoria só tem INSERT)
      expect(r.ok ? 'upsert passou!' : r.codigo, `${t.nome}: ${r.ok ? '' : r.mensagem}`).toBe('42501');
    }
  });

  it('UPDATE e DELETE por id de B, no contexto de A, afetam 0 linhas (ou são negados)', async () => {
    for (const t of tabelas) {
      const idB = linha.get(t.nome)!.B;
      for (const sql of [`update ${t.sql} set external_id = 'invadido' where id = $1`, `delete from ${t.sql} where id = $1`]) {
        const r = await tentar(app, A, async () => (await app.query(sql, [idB])).rowCount);
        if (r.ok) expect(r.valor, `${t.nome}: ${sql}`).toBe(0);
        else expect(r.codigo, `${t.nome}: ${r.mensagem}`).toBe('42501');
      }
    }
  });

  it('INSERT de linha nova com tenant_id de B no contexto de A é recusado; no próprio tenant passa (controle)', async () => {
    for (const t of tabelas) {
      const idA = linha.get(t.nome)!.A;
      const copia = (tenant: string) =>
        app.query(
          `insert into ${t.sql}
           select (jsonb_populate_record(null::${t.sql}, to_jsonb(r) || jsonb_build_object('id', gen_random_uuid(), 'tenant_id', $2::uuid))).*
             from ${t.sql} r where r.id = $1`,
          [idA, tenant],
        );
      const cruzado = await tentar(app, A, () => copia(B));
      expect(cruzado.ok ? 'INSERT cruzado passou!' : cruzado.codigo, t.nome).toBe('42501');
    }
    // controle positivo numa tabela sem índice único além do id
    const proprio = await tentar(app, A, async () =>
      (await app.query<{ tenant_id: string }>(
        "insert into plataforma.auditoria (tenant_id, modulo, acao, entidade) values ($1, 'core', 'teste', 'controle') returning tenant_id::text",
        [A],
      )).rows[0]!.tenant_id,
    );
    expect(proprio).toEqual({ ok: true, valor: A });
  });

  describe('chaves estrangeiras entre tabelas de tenant', () => {
    let fks: Fk[] = [];

    beforeAll(async () => {
      const r = await admin.query<{ nome: string; filha: string; cf: string[]; mae: string; cm: string[] }>(`
        select k.conname as nome,
               fn.nspname || '.' || fc.relname as filha,
               array(select a.attname from unnest(k.conkey) with ordinality u(n, o) join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.n order by u.o)::text[] as cf,
               mn.nspname || '.' || mc.relname as mae,
               array(select a.attname from unnest(k.confkey) with ordinality u(n, o) join pg_attribute a on a.attrelid = k.confrelid and a.attnum = u.n order by u.o)::text[] as cm
          from pg_constraint k
          join pg_class fc on fc.oid = k.conrelid join pg_namespace fn on fn.oid = fc.relnamespace
          join pg_class mc on mc.oid = k.confrelid join pg_namespace mn on mn.oid = mc.relnamespace
         where k.contype = 'f'
         order by 1`);
      fks = r.rows.map((x) => ({ nome: x.nome, filha: x.filha, colunasFilha: x.cf, mae: x.mae, colunasMae: x.cm }));
    });

    it('toda FK de tabela de tenant para outra tabela de tenant é composta com tenant_id (o banco impede apontar para B)', () => {
      const comTenant = new Set(tabelas.map((t) => t.nome));
      const entreTenants = fks.filter((f) => comTenant.has(f.filha) && comTenant.has(f.mae));
      expect(entreTenants.length, 'esperava FKs entre tabelas de tenant (ex.: core.carteira -> core.cliente)').toBeGreaterThan(0);
      const simples = entreTenants.filter((f) => f.colunasFilha[0] !== 'tenant_id' || f.colunasMae[0] !== 'tenant_id').map((f) => `${f.nome} (${f.filha} -> ${f.mae})`);
      expect(simples).toEqual([]);
      // as que apontam para plataforma.tenant usam a própria coluna tenant_id (protegida pelo WITH CHECK)
      const paraTenant = fks.filter((f) => comTenant.has(f.filha) && f.mae === 'plataforma.tenant');
      expect(paraTenant.filter((f) => f.colunasFilha.join() !== 'tenant_id').map((f) => f.nome)).toEqual([]);
    });

    it('em cada FK composta, apontar uma linha de A para a linha-mãe de B é recusado (23503)', async () => {
      const comTenant = new Set(tabelas.map((t) => t.nome));
      const compostas = fks.filter((f) => comTenant.has(f.filha) && comTenant.has(f.mae) && f.colunasFilha.length === 2);
      // acerto de coerência para FK que não existe mais = lista desatualizada (revisar junto com a migração)
      // (produto_embalagem_medida_fk só existe com a 0018 na pasta: tolerada até a T-0063 entrar no main; depois, tirar daqui)
      expect(Object.keys(COERENCIA_DA_FK).filter((n) => n !== 'produto_embalagem_medida_fk' && !compostas.some((f) => f.nome === n))).toEqual([]);
      for (const f of compostas) {
        const coluna = f.colunasFilha[1]!;
        const sqlFilha = f.filha.split('.').map((p) => `"${p}"`).join('.');
        const idFilhaA = linha.get(f.filha)!.A;
        // FK que não aponta para o id (0018: (tenant_id, sigla) -> core.medida): o valor é a chave de uma linha de B que NÃO
        // existe em A (ex.: GF), senão o UPDATE passaria por apontar para a linha de A com a mesma chave
        const colunaMae = f.colunasMae[1]!;
        const idMaeB =
          colunaMae === 'id'
            ? linha.get(f.mae)!.B
            : (
                await admin.query<{ v: string }>(
                  `select "${colunaMae}"::text as v from ${f.mae.split('.').map((p) => `"${p}"`).join('.')} m where m.tenant_id = $1 and m."${colunaMae}" not in (select "${colunaMae}" from ${f.mae.split('.').map((p) => `"${p}"`).join('.')} where tenant_id = $2) order by 1 limit 1`,
                  [B, A],
                )
              ).rows[0]?.v;
        expect(idMaeB, `${f.nome}: falta em B uma linha de ${f.mae} com ${colunaMae} que A não tenha (fixture dois-tenants)`).toBeTruthy();
        const coerencia = COERENCIA_DA_FK[f.nome];
        const sql = `update ${sqlFilha} set "${coluna}" = $2${coerencia ? `, ${coerencia}` : ''} where id = $1`;
        const podeAlterar = (await app.query<{ p: boolean }>("select has_table_privilege(current_user, $1, 'UPDATE') as p", [f.filha])).rows[0]!.p;
        if (!podeAlterar) {
          // tabela só de inserção para a aplicação (ex.: vendedor.pedido_evento, T-0029): o UPDATE já é negado (42501);
          // a FK composta é provada como dono, em transação desfeita
          const r = await tentar(app, A, () => app.query(sql, [idFilhaA, idMaeB]));
          expect(r.ok ? 'UPDATE passou!' : r.codigo, `${f.nome} (app): ${r.ok ? '' : r.mensagem}`).toBe('42501');
          const rd = await tentar(admin, A, () => admin.query(sql, [idFilhaA, idMaeB]));
          expect(rd.ok ? 'UPDATE passou!' : rd.codigo, `${f.nome} (dono): ${rd.ok ? '' : rd.mensagem}`).toBe('23503');
          continue;
        }
        const r = await tentar(app, A, () => app.query(sql, [idFilhaA, idMaeB]));
        expect(r.ok ? 'UPDATE passou!' : r.codigo, `${f.nome}: ${r.ok ? '' : r.mensagem}`).toBe('23503');
      }
    });
  });

  it('nenhuma linha de B mudou depois de todas as tentativas', async () => {
    expect(await retratarB()).toBe(retratoB);
  });
});
