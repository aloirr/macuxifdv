/**
 * T-0032 — regras que o BANCO garante na migração 0010 (schema integracao) e na 0011 (retenção da outbox), desenho
 * docs/desenho/T-0032.md §8. Quase tudo como o papel de APLICAÇÃO (macuxi_app, sujeito a RLS) sobre a fixture dois-tenants, em
 * transações desfeitas no fim (não sujam a fixture). O vazamento entre tenants das 17 tabelas novas está em vazamento.test.ts
 * (descoberta dinâmica de toda tabela com tenant_id); o up/down/up em migracoes.test.ts. Os expurgos rodam numa transação do
 * admin com `set local role macuxi_worker` (o worker não grava nas tabelas; prepara-se o dado antigo como admin).
 */
import { relogioDoBanco } from '@macuxi/comum/relogio';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { banco, semBanco } from './estado';
import { comCliente, emTransacao, erroDe } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const tA = A.tenantId;
const tB = B.tenantId;
const IA = A.integracao;
const IB = B.integracao;
const P = (n: number) => `9d0c2f4e-0032-4000-8000-${String(n).padStart(12, '0')}`;
const HEX = (c: string) => c.repeat(64);
/**
 * Instantes informados pelo ERP/Conector (alterado_em, ocorrido_em, aprovado_em, decidida_em) e a validade longe: dados que o
 * teste grava e compara ENTRE SI (upsert monotônico e cursor), nunca com o now() do banco, que aqui é a linha do tempo da
 * retenção e das decisões. Por isso convivem no mesmo arquivo (ADR 0015).
 */
const ERP = {
  dia: '2026-10-30T00:00:00Z', // hora-fixa-ok: instante do ERP, só comparado com outros instantes do ERP
  antesDoCursor: '2026-10-30T08:00:00Z', // hora-fixa-ok: instante do ERP, só comparado com outros instantes do ERP
  quaseNove: '2026-10-30T08:59:59.999Z', // hora-fixa-ok: instante do ERP, só comparado com outros instantes do ERP
  nove: '2026-10-30T09:00:00Z', // hora-fixa-ok: instante do ERP, só comparado com outros instantes do ERP
  cursor: '2026-10-30T09:00:00.123Z', // hora-fixa-ok: instante do ERP, só comparado com outros instantes do ERP
  dez: '2026-10-30T10:00:00Z', // hora-fixa-ok: instante do ERP, só comparado com outros instantes do ERP
  faturado: '2026-10-30T11:30:00Z', // hora-fixa-ok: instante do ERP, só comparado com outros instantes do ERP
  decisao: '2026-10-31T10:00:00Z', // hora-fixa-ok: instante do ERP, só comparado com outros instantes do ERP
  expiraLonge: '2099-01-01T00:00:00Z', // hora-fixa-ok: instante do ERP, só comparado com outros instantes do ERP
} as const;

describe.skipIf(semBanco())('T-0032: regras garantidas pelo banco no schema integracao (papel de aplicação)', () => {
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
  const inserir = (tabela: string, cols: Record<string, unknown>) => {
    const nomes = Object.keys(cols);
    return app.query(`insert into integracao.${tabela} (${nomes.join(', ')}) values (${nomes.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, Object.values(cols));
  };

  describe('autenticar_chave (RN-INT-10): única leitura sem tenant', () => {
    it('sem contexto a tabela devolve 0 linhas; a função devolve só a linha da chave, com tenant, entidades e recebe_pedidos e SEM o hash', async () => {
      const semCtx = await emTransacao(app, null, () => app.query<{ n: number }>('select count(*)::int as n from integracao.credencial'));
      expect(semCtx.rows[0]!.n).toBe(0);
      const r = await emTransacao(app, null, () => app.query('select * from integracao.autenticar_chave($1)', [IA.chave.hash]));
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]).toMatchObject({
        credencial_id: IA.credencial, tenant_id: tA, conector_id: IA.conector, prefixo: IA.chave.prefixo, escopo: 'integracao.v1', papel: 'atual',
        conector_identificador: IA.identificador, conector_ativo: true, recebe_pedidos: true, revogada_em: null,
        entidades: ['vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota'],
      });
      expect(Object.keys(r.rows[0] as object)).not.toContain('hash_chave');
      expect(JSON.stringify(r.rows[0])).not.toContain(IA.chave.hash);
      const rb = await emTransacao(app, null, () => app.query('select tenant_id, entidades, ips_permitidos from integracao.autenticar_chave($1)', [IB.chave.hash]));
      expect(rb.rows).toEqual([{ tenant_id: tB, entidades: ['cliente', 'produto'], ips_permitidos: ['203.0.113.0/24'] }]);
    });

    it('hash desconhecido, malformado ou de Conector apagado => nenhuma linha', async () => {
      for (const h of [HEX('0'), 'nao-e-hash', '']) {
        const r = await emTransacao(app, null, () => app.query('select * from integracao.autenticar_chave($1)', [h]));
        expect(r.rowCount, h).toBe(0);
      }
      await comA(async () => {
        // hora-fixa-ok: soft delete, o instante nunca é comparado
        await app.query('update integracao.conector set deleted_at = now() where id = $1', [IA.conector]);
        const r = await app.query('select * from integracao.autenticar_chave($1)', [IA.chave.hash]);
        expect(r.rowCount).toBe(0);
      });
    });

    it('com contexto de A, a tabela continua isolada (B invisível) e o hash é único GLOBAL (23505 mesmo de outro tenant)', async () => {
      await comA(async () => {
        const r = await app.query<{ tenant_id: string }>('select tenant_id from integracao.credencial');
        expect(r.rows.map((x) => x.tenant_id)).toEqual([tA]);
        const e = await tentar(() => inserir('credencial', { tenant_id: tA, conector_id: IA.conector, prefixo: 'outra001', hash_chave: IB.chave.hash, papel: 'anterior' }));
        expect(e?.code).toBe('23505');
      });
    });

    it('no máximo 1 atual e 1 anterior não revogadas por Conector; rotação = linha nova; revogada libera o papel', async () => {
      await comA(async () => {
        expect((await tentar(() => inserir('credencial', { tenant_id: tA, conector_id: IA.conector, prefixo: 'nova0001', hash_chave: HEX('1') })))?.code).toBe('23505');
        expect(await tentar(() => inserir('credencial', { tenant_id: tA, conector_id: IA.conector, prefixo: 'nova0001', hash_chave: HEX('1'), papel: 'anterior' }))).toBeNull();
        expect((await tentar(() => inserir('credencial', { tenant_id: tA, conector_id: IA.conector, prefixo: 'nova0002', hash_chave: HEX('2'), papel: 'anterior' })))?.code).toBe('23505');
        // hora-fixa-ok: revogação pelo now() do banco; o teste só confere o papel liberado, nunca compara com instante fixo
        await app.query("update integracao.credencial set revogada_em = now() where conector_id = $1 and papel = 'atual'", [IA.conector]);
        expect(await tentar(() => inserir('credencial', { tenant_id: tA, conector_id: IA.conector, prefixo: 'nova0003', hash_chave: HEX('3') }))).toBeNull();
        expect((await tentar(() => inserir('credencial', { tenant_id: tA, conector_id: IA.conector, prefixo: 'nova0004', hash_chave: 'ABC' })))?.code).toBe('23514');
        // sem DELETE para a aplicação (revogar = revogada_em)
        expect((await tentar(() => app.query('delete from integracao.credencial where conector_id = $1', [IA.conector])))?.code).toBe('42501');
      });
    });
  });

  describe('conector (RN-INT-13, P-6/P-7)', () => {
    const novo = (extra: Record<string, unknown> = {}) => inserir('conector', { tenant_id: tA, identificador: 'erp-filial', nome: 'Filial', recebe_pedidos: false, ...extra });

    it('P-7: segundo Conector ativo que recebe pedidos => 23505; sem recebe_pedidos ou inativo passa', async () => {
      await comA(async () => {
        expect((await tentar(() => novo({ recebe_pedidos: true })))?.code).toBe('23505');
        expect(await tentar(() => novo({ identificador: 'erp-inativo', recebe_pedidos: true, ativo: false }))).toBeNull();
        expect(await tentar(() => novo())).toBeNull();
        // identificador único entre os vivos do tenant
        expect((await tentar(() => novo({ nome: 'Outro' })))?.code).toBe('23505');
      });
    });

    it('entidades: padrão as 8; vazia, repetida ou desconhecida => 23514; identificador fora do formato => 23514', async () => {
      await comA(async () => {
        const r = await novo();
        expect(r.rows[0].entidades).toEqual(['vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota']);
        for (const entidades of [[], ['cliente', 'cliente'], ['cliente', 'fornecedor']]) {
          expect((await tentar(() => novo({ identificador: 'erp-x', entidades })))?.code, JSON.stringify(entidades)).toBe('23514');
        }
        expect(await tentar(() => novo({ identificador: 'erp-y', entidades: ['preco', 'estoque'] }))).toBeNull();
        expect((await tentar(() => novo({ identificador: 'erp com espaço' })))?.code).toBe('23514');
        expect((await tentar(() => novo({ identificador: 'erp-ip', ips_permitidos: ['nao-e-ip'] })))?.code).toBe('22P02');
        expect(await tentar(() => novo({ identificador: 'erp-ip', ips_permitidos: ['10.0.0.0/8', '200.1.2.3'] }))).toBeNull();
      });
    });
  });

  describe('external_id até 200 caracteres (T-0027)', () => {
    const x200 = 'X'.repeat(200);
    const x201 = 'X'.repeat(201);

    it('registro_atual, sessao_carga_recebido, lote_linha_erro, cursor_entidade e pedido_retorno_erro: 200 passa, 201 e vazio => 23514', async () => {
      await comA(async () => {
        const reg = (id: string) => inserir('registro_atual', { tenant_id: tA, entidade: 'cliente', conector_id: IA.conector, hash: HEX('a'), alterado_em: ERP.dia, external_id: id });
        const rec = (id: string) => inserir('sessao_carga_recebido', { tenant_id: tA, sessao_id: IA.sessoes.cliente, external_id: id });
        const err = (id: string | null, i: number) => inserir('lote_linha_erro', { tenant_id: tA, lote_id: IA.lotes.delta, indice: i, origem: 'conector', codigo: 'registro_invalido', mensagem: 'x', external_id: id });
        const cur = (id: string) => inserir('cursor_entidade', { tenant_id: tA, conector_id: IA.conector, entidade: 'rota', cursor_alterado_em: ERP.dia, cursor_external_id: id });
        const ret = (id: string) => inserir('pedido_retorno_erro', {
          tenant_id: tA, pedido_uuid: A.pedidos.p3, status: 'faturado_parcial', ocorrido_em: ERP.dia, indice: 5, sequencia: 7, produto_external_id: id,
          quantidade: 1, codigo: 'produto_divergente', codigos: ['produto_divergente'], campo: 'itens_faturados[5].produto_external_id', motivo: 'x', conector_id: IA.conector,
        });
        for (const [nome, f] of [['registro_atual', reg], ['sessao_carga_recebido', rec], ['cursor_entidade', cur], ['pedido_retorno_erro', ret]] as const) {
          expect((await tentar(() => f(x201)))?.code, `${nome} 201`).toBe('23514');
          expect((await tentar(() => f('')))?.code, `${nome} vazio`).toBe('23514');
          expect(await tentar(() => f(x200)), `${nome} 200`).toBeNull();
        }
        expect((await tentar(() => err(x201, 10)))?.code).toBe('23514');
        expect(await tentar(() => err(x200, 11))).toBeNull();
        expect(await tentar(() => err(null, 12))).toBeNull(); // ilegível: nulo permitido
      });
    });

    it('sessao_carga_recebido: o mesmo id inválido na mesma sessão é único (on conflict do nothing)', async () => {
      await comA(async () => {
        const sql = 'insert into integracao.sessao_carga_recebido (tenant_id, sessao_id, external_id) values ($1, $2, $3) on conflict (tenant_id, sessao_id, external_id) do nothing';
        const r = await app.query(sql, [tA, IA.sessoes.produto, 'PRD-INVALIDO-9']);
        expect(r.rowCount).toBe(0);
        expect((await app.query(sql, [tA, IA.sessoes.produto, 'PRD-INVALIDO-10'])).rowCount).toBe(1);
      });
    });
  });

  describe('lote (RN-INT-01/12)', () => {
    const lote = (extra: Record<string, unknown>) =>
      inserir('lote', {
        tenant_id: tA, conector_id: IA.conector, entidade: 'produto', modo: 'delta', versao_contrato: 'v1', chave_idempotencia: 'k'.repeat(64), hash_conteudo: HEX('b'), recebidas: 1, ...extra,
      });

    it('mesma Idempotency-Key no mesmo Conector => 23505; chave fora do formato, recebidas 0 ou completo sem sessão => 23514', async () => {
      await comA(async () => {
        expect(await tentar(() => lote({}))).toBeNull();
        expect((await tentar(() => lote({ hash_conteudo: HEX('c') })))?.code).toBe('23505');
        expect((await tentar(() => lote({ chave_idempotencia: 'curta' })))?.code).toBe('23514');
        expect((await tentar(() => lote({ chave_idempotencia: 'z'.repeat(64), recebidas: 0 })))?.code).toBe('23514');
        expect((await tentar(() => lote({ chave_idempotencia: 'y'.repeat(64), modo: 'completo' })))?.code).toBe('23514');
        expect((await tentar(() => lote({ chave_idempotencia: 'w'.repeat(64), sessao_id: IA.sessoes.produto })))?.code).toBe('23514');
      });
    });

    it('um lote processando por Conector+entidade (quem perde a corrida leva 23505)', async () => {
      await comA(async () => {
        expect(await tentar(() => lote({ chave_idempotencia: 'p'.repeat(64), status: 'processando' }))).toBeNull();
        expect((await tentar(() => lote({ chave_idempotencia: 'q'.repeat(64), status: 'processando' })))?.code).toBe('23505');
        expect(await tentar(() => lote({ chave_idempotencia: 'r'.repeat(64), status: 'processando', entidade: 'cliente' }))).toBeNull();
      });
    });
  });

  describe('escritas-guarda monotônicas (RN-INT-06, 🔴 V1)', () => {
    it('upsert do registro: alterado_em menor não troca hash/payload; igual ou maior troca; xmax = 0 separa a linha nova', async () => {
      await comA(async () => {
        const upsert = (externalId: string, alterado: string, hash: string) =>
          app.query<{ hash: string; nova: boolean }>(
            `insert into integracao.registro_atual as r (tenant_id, entidade, external_id, conector_id, hash, payload, alterado_em, lote_id, visto_em)
             values ($1, 'produto', $2, $3, $4, '{}'::jsonb, $5, $6, now())
             on conflict (tenant_id, entidade, external_id) do update
               set hash = excluded.hash, payload = excluded.payload, alterado_em = excluded.alterado_em, lote_id = excluded.lote_id, visto_em = excluded.visto_em
             where excluded.alterado_em >= r.alterado_em
             returning hash, (xmax = 0) as nova`,
            [tA, externalId, IA.conector, hash, alterado, IA.lotes.delta],
          );
        const obsoleta = await upsert('PRD-1', ERP.quaseNove, HEX('d'));
        expect(obsoleta.rowCount).toBe(0); // mais antigo: nada muda
        const igual = await upsert('PRD-1', ERP.cursor, HEX('e'));
        expect(igual.rows).toEqual([{ hash: HEX('e'), nova: false }]);
        const nova = await upsert('PRD-NOVO', ERP.nove, HEX('f'));
        expect(nova.rows).toEqual([{ hash: HEX('f'), nova: true }]);
        // milissegundos preservados (timestamptz(3))
        const ms = await app.query<{ t: string }>("select to_char(alterado_em at time zone 'UTC', 'HH24:MI:SS.MS') as t from integracao.registro_atual where external_id = 'PRD-1'");
        expect(ms.rows[0]!.t).toBe('09:00:00.123');
      });
    });

    it('cursor: (alterado_em, external_id) só avança, em ordem ordinal (collation "C")', async () => {
      await comA(async () => {
        const avancar = (alterado: string, id: string) =>
          app.query(
            `insert into integracao.cursor_entidade as c (tenant_id, conector_id, entidade, cursor_alterado_em, cursor_external_id)
             values ($1, $2, 'produto', $3, $4)
             on conflict (tenant_id, conector_id, entidade) do update
               set cursor_alterado_em = excluded.cursor_alterado_em, cursor_external_id = excluded.cursor_external_id, atualizado_em = now()
             where (c.cursor_alterado_em, c.cursor_external_id) < (excluded.cursor_alterado_em, excluded.cursor_external_id)`,
            [tA, IA.conector, alterado, id],
          );
        expect((await avancar(ERP.antesDoCursor, 'ZZZ')).rowCount).toBe(0); // instante menor
        // mesmo instante: 'PRD-1' < 'PRD-2' < 'prd-0' na ordem ordinal (maiúsculas antes de minúsculas)
        expect((await avancar(ERP.cursor, 'PRD-0')).rowCount).toBe(0);
        expect((await avancar(ERP.cursor, 'PRD-2')).rowCount).toBe(1);
        expect((await avancar(ERP.cursor, 'prd-0')).rowCount).toBe(1);
        expect((await avancar(ERP.cursor, 'PRD-9')).rowCount).toBe(0);
        const c = await app.query('select cursor_external_id from integracao.cursor_entidade where conector_id = $1 and entidade = $2', [IA.conector, 'produto']);
        expect(c.rows[0]).toEqual({ cursor_external_id: 'prd-0' });
      });
    });
  });

  describe('pendência e auditoria da inativação (RN-INT-06, P-3)', () => {
    it('decisão: update ... where estado = aguardando returning (2ª vez = 0 linhas); decisão sem perfil => 23514; perfil fora de admin|analista => 23514', async () => {
      await comA(async () => {
        const decidir = (perfil: string | null) =>
          app.query(
            `update integracao.pendencia_inativacao set estado = 'confirmada', decidida_em = now(), decidida_por = $2, decidida_por_perfil = $3, motivo_decisao = 'ok'
              where id = $1 and estado = 'aguardando' returning id`,
            [IA.pendencias.aguardando, A.usuarios.admin, perfil],
          );
        expect((await tentar(() => decidir(null)))?.code).toBe('23514');
        expect((await tentar(() => decidir('supervisor')))?.code).toBe('23514');
        expect((await decidir('admin')).rowCount).toBe(1);
        expect((await decidir('admin')).rowCount).toBe(0); // já decidida por outro
        const motivo = await tentar(() => app.query("update integracao.pendencia_inativacao set motivo_decisao = $2 where id = $1", [IA.pendencias.aguardando, 'm'.repeat(301)]));
        expect(motivo?.code).toBe('23514');
      });
    });

    it('uma pendência aguardando por Conector+entidade e uma por sessão', async () => {
      await comA(async () => {
        const e = await tentar(() =>
          inserir('pendencia_inativacao', {
            tenant_id: tA, sessao_id: IA.sessoes.produto, entidade: 'cliente', conector_id: IA.conector, lote_id: IA.lotes.completoCliente, candidatos: 1, total_ativos: 2,
            percentual: 50, limite_pct: 30, expira_em: ERP.expiraLonge,
          }),
        );
        expect(e?.code).toBe('23505');
      });
    });

    it('auditoria APPEND-ONLY: insert passa; UPDATE e DELETE negados ao macuxi_app (42501); inativadas só ao confirmar', async () => {
      await comA(async () => {
        const base = {
          tenant_id: tA, pendencia_id: IA.pendencias.aguardando, sessao_id: IA.sessoes.cliente, lote_id: IA.lotes.completoCliente, entidade: 'cliente', conector_id: IA.conector,
          decidida_por: A.usuarios.analista, perfil: 'analista', decidida_em: ERP.decisao, quantidade: 1, total_ativos: 2, percentual: 50,
        };
        expect(await tentar(() => inserir('inativacao_auditoria', { ...base, acao: 'confirmar', inativadas: 1 }))).toBeNull();
        expect((await tentar(() => inserir('inativacao_auditoria', { ...base, acao: 'recusar', inativadas: 0 })))?.code).toBe('23514');
        expect((await tentar(() => inserir('inativacao_auditoria', { ...base, acao: 'recusar', perfil: 'supervisor' })))?.code).toBe('23514');
        expect((await tentar(() => inserir('inativacao_auditoria', { ...base, acao: 'recusar', motivo: 'm'.repeat(301) })))?.code).toBe('23514');
        expect((await tentar(() => app.query('update integracao.inativacao_auditoria set motivo = $1', ['x'])))?.code).toBe('42501');
        expect((await tentar(() => app.query('delete from integracao.inativacao_auditoria')))?.code).toBe('42501');
        const n = await app.query<{ n: number }>('select count(*)::int as n from integracao.inativacao_auditoria');
        expect(n.rows[0]!.n).toBe(2); // fixture (1) + a inserida agora; B invisível
      });
    });
  });

  describe('fila de pedidos e retorno do ERP (RN-INT-08, P-4)', () => {
    it('fila única por pedido (mesmo removida); retido não tem payload', async () => {
      await comA(async () => {
        expect((await tentar(() => inserir('pedido_fila_erp', { tenant_id: tA, pedido_uuid: A.pedidos.p3, payload_origem: {}, aprovado_em: ERP.dia })))?.code).toBe('23505');
        const retido = { tenant_id: tA, pedido_uuid: A.pedidos.p2, payload_origem: {}, aprovado_em: ERP.dia, retencao_codigo: 'mapeamento_ausente' };
        expect((await tentar(() => inserir('pedido_fila_erp', { ...retido, payload: {} })))?.code).toBe('23514');
        expect(await tentar(() => inserir('pedido_fila_erp', retido))).toBeNull();
        expect((await tentar(() => app.query('delete from integracao.pedido_fila_erp')))?.code).toBe('42501');
      });
    });

    it('pedido_retorno: segunda guarda de idempotência com nota nula igual a nota nula (23505); só select/insert', async () => {
      await comA(async () => {
        const ret = () => inserir('pedido_retorno', { tenant_id: tA, pedido_uuid: A.pedidos.p3, status: 'integrado', numero_erp: 'PV1003', ocorrido_em: ERP.dez, conector_id: IA.conector });
        expect(await tentar(ret)).toBeNull();
        expect((await tentar(ret))?.code).toBe('23505');
        expect((await tentar(() => app.query('update integracao.pedido_retorno set motivo = $1', ['x'])))?.code).toBe('42501');
      });
    });

    it('pedido_retorno_erro: códigos do contrato + sequencia_repetida; codigos não vazio e da lista; pedido de outro tenant => 23503', async () => {
      await comA(async () => {
        const erro = (extra: Record<string, unknown>) =>
          inserir('pedido_retorno_erro', {
            tenant_id: tA, pedido_uuid: A.pedidos.p3, pedido_retorno_id: IA.retornos.p3, status: 'faturado_parcial', ocorrido_em: ERP.faturado, indice: 3,
            sequencia: 4, produto_external_id: 'PRD-4', quantidade: 2, codigo: 'sequencia_repetida', codigos: ['sequencia_repetida'], campo: 'itens_faturados[3].sequencia',
            motivo: 'Sequência repetida em itens_faturados.', conector_id: IA.conector, ...extra,
          });
        expect(await tentar(() => erro({}))).toBeNull();
        expect(await tentar(() => erro({ pedido_retorno_id: null, codigo: 'quantidade_acima_do_saldo', codigos: ['quantidade_acima_do_saldo', 'produto_divergente'] }))).toBeNull();
        expect((await tentar(() => erro({ codigo: 'outro' })))?.code).toBe('23514');
        expect((await tentar(() => erro({ codigos: [] })))?.code).toBe('23514');
        expect((await tentar(() => erro({ codigos: ['produto_divergente', 'outro'] })))?.code).toBe('23514');
        expect((await tentar(() => erro({ pedido_uuid: B.pedidos.p1, pedido_retorno_id: null })))?.code).toBe('23503');
        expect((await tentar(() => erro({ pedido_retorno_id: IB.retornos.p1 })))?.code).toBe('23503');
        // alerta das últimas 24 h do monitor (created_at): as duas de agora entram, a da fixture também (created_at = carga)
        const r = await app.query<{ n: number }>("select count(*)::int as n from integracao.pedido_retorno_erro where created_at > now() - interval '24 hours'");
        expect(r.rows[0]!.n).toBeGreaterThanOrEqual(2);
      });
    });
  });

  describe('expurgos (worker)', () => {
    /** Transação do ADMIN (prepara dado antigo e ignora RLS) que chama a função como macuxi_worker; sempre ROLLBACK. */
    const comoWorker = <T>(preparar: (c: pg.Client) => Promise<void>, fn: (c: pg.Client) => Promise<T>) =>
      comCliente(banco().urlAdmin, async (c) => {
        await c.query('begin');
        try {
          await preparar(c);
          await c.query('set local role macuxi_worker');
          return await fn(c);
        } finally {
          await c.query('rollback');
        }
      });
    const contagens = (rows: { item: string; quantidade: string }[]) => Object.fromEntries(rows.map((r) => [r.item, Number(r.quantidade)]));

    it('integracao.expurgar_retencao: lote > 12 meses (cascata), credencial revogada > 12 meses, payloads e corpo, recebidos de sessão fechada', async () => {
      const r = await comoWorker(
        async (c) => {
          // datas da fixture são fixas: traz tudo para "agora" e envelhece só o que deve sair (o teste não depende do dia em que roda)
          await c.query('update integracao.lote set recebido_em = now(), concluido_em = case when concluido_em is null then null else now() end');
          await c.query("update integracao.sessao_carga set fechada_em = now() where situacao <> 'aberta'");
          await c.query("update integracao.lote set recebido_em = now() - interval '13 months', concluido_em = now() - interval '13 months' where id = $1", [IA.lotes.completoProduto]);
          await c.query("update integracao.lote set status = 'concluido', concluido_em = now() - interval '8 days' where id = $1", [IA.lotes.delta]);
          await c.query("update integracao.lote_linha_erro set created_at = now() - interval '31 days' where id = (select id from integracao.lote_linha_erro where tenant_id = $1)", [tB]);
          await c.query("update integracao.credencial set revogada_em = now() - interval '13 months' where id = $1", [IB.credencial]);
          await c.query("update integracao.sessao_carga set fechada_em = now() - interval '8 days' where tenant_id = $1", [tB]);
          await c.query("update integracao.registro_atual set deleted_at = now() - interval '31 days' where tenant_id = $1 and deleted_at is not null", [tA]);
        },
        async (c) => {
          const papel = await c.query<{ u: string }>('select current_user as u');
          expect(papel.rows[0]!.u).toBe('macuxi_worker');
          const x = contagens((await c.query('select * from integracao.expurgar_retencao(now(), 1000)')).rows);
          // o worker não lê as tabelas (só chama a função)
          await c.query('savepoint leitura');
          expect((await erroDe(c.query('select 1 from integracao.lote limit 1')))?.code).toBe('42501');
          await c.query('rollback to savepoint leitura');
          await c.query('reset role');
          const sobra = await c.query(`select (select count(*) from integracao.lote where id = $1)::int as lote,
                                              (select count(*) from integracao.lote_linha_erro where lote_id = $1)::int as erros,
                                              (select count(*) from integracao.lote_staging where corpo is not null and tenant_id = $2)::int as corpos_a,
                                              (select count(*) from integracao.credencial where id = $3)::int as cred_b,
                                              (select count(*) from integracao.sessao_carga_recebido where tenant_id = $4)::int as receb_b,
                                              (select count(*) from integracao.registro_atual where payload is null)::int as sem_payload`,
            [IA.lotes.completoProduto, tA, IB.credencial, tB]);
          return { x, sobra: sobra.rows[0] };
        },
      );
      expect(r.x).toEqual({ lote: 1, credencial: 1, 'lote_linha_erro.payload': 0, 'lote_staging.corpo': 1, sessao_carga_recebido: 1, 'registro_atual.payload': 1 });
      expect(r.sobra).toEqual({ lote: 0, erros: 0, corpos_a: 0, cred_b: 0, receb_b: 0, sem_payload: 1 });
    });

    it('integracao.expurgar_retencao: sessão com pendência aguardando válida mantém os recebidos; app não executa a função (42501)', async () => {
      const x = await comoWorker(
        async (c) => {
          await c.query("update integracao.sessao_carga set fechada_em = now() where situacao <> 'aberta'");
          await c.query("update integracao.sessao_carga set fechada_em = now() - interval '8 days' where id = $1", [IA.sessoes.cliente]);
          await c.query('insert into integracao.sessao_carga_recebido (tenant_id, sessao_id, external_id) values ($1, $2, $3)', [tA, IA.sessoes.cliente, 'CLI-X']);
        },
        async (c) => contagens((await c.query('select * from integracao.expurgar_retencao(now(), 1000)')).rows),
      );
      expect(x.sessao_carga_recebido).toBe(0);
      const e = await erroDe(emTransacao(app, tA, () => app.query('select * from integracao.expurgar_retencao(now(), 10)')));
      expect(e?.code).toBe('42501');
      const e2 = await comCliente(banco().urlAdmin, async (c) => {
        await c.query('begin');
        await c.query('set local role macuxi_worker');
        const r = await erroDe(c.query('select * from integracao.autenticar_chave($1)', [IA.chave.hash]));
        await c.query('rollback');
        return r;
      });
      expect(e2?.code).toBe('42501');
    });

    it('plataforma.expurgar_outbox (0011): só publicados mais antigos que a retenção do tenant (padrão 30 dias; parâmetro 7..365), com os consumos', async () => {
      const x = await comoWorker(
        async (c) => {
          const ev = `insert into plataforma.evento (id, tenant_id, nome, modulo, publicado_em) values ($1, $2, 'integracao.lote.recebido@1', 'integracao', $3)`;
          // a retenção é contada pelo now() do banco (expurgar_outbox(now(), …)): os instantes saem do mesmo relógio
          const relogio = await relogioDoBanco(c);
          await c.query(ev, [P(1), tA, relogio.relativo({ dias: -31 })]); // A: 31 dias > 30 (padrão) => sai
          await c.query(ev, [P(2), tA, relogio.relativo({ dias: -29 })]); // A: 29 dias => fica
          await c.query(ev, [P(3), tA, null]); // pendente => nunca sai
          await c.query("insert into plataforma.evento_consumo (tenant_id, consumidor, evento_id) values ($1, 'integracao', $2)", [tA, P(1)]);
          await c.query(ev, [P(4).replace('9d0c2f4e', 'bbbbbbbb'), tB, relogio.relativo({ dias: -10 })]); // B: 10 dias, retenção 3 => mínimo 7 => sai
          await c.query("insert into plataforma.parametro (tenant_id, modulo, chave, valor) values ($1, 'plataforma', 'outbox.retencao_dias', '3')", [tB]);
        },
        async (c) => {
          const r = contagens((await c.query('select * from plataforma.expurgar_outbox(now(), 1000)')).rows);
          await c.query('reset role');
          const ficaram = await c.query<{ id: string }>('select id from plataforma.evento where id = any($1) order by id', [[P(1), P(2), P(3), P(4).replace('9d0c2f4e', 'bbbbbbbb')]]);
          return { r, ficaram: ficaram.rows.map((y) => y.id) };
        },
      );
      expect(x.r.evento).toBeGreaterThanOrEqual(2);
      expect(x.r.evento_consumo).toBeGreaterThanOrEqual(1);
      expect(x.ficaram).toEqual([P(2), P(3)]);
    });
  });
});
