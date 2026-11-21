/**
 * v1.0.19 — RF-CAT-04 / RN-CAT-18 (docs/produto/03 §8): o código do nó da árvore do catálogo é único ENTRE OS IRMÃOS (mesmo
 * pai, ou entre as raízes), não no tenant (migração 0092, `catalogo_no_pai_codigo_uk`). Diagnóstico de origem:
 * modules/integracao/docs/outbox-parada-am2808-catalogo.md (2 nós e 34 produtos parados na outbox da AM2808).
 *
 * API REAL: `createApp`, Conector simulado em `/integracao/v1/lotes` (ADR 0013), despachante real da outbox (`macuxi_worker`)
 * e Postgres com RLS, na fixture dois-tenants num banco efêmero próprio do arquivo. Agente `testes`.
 *
 * O que já está coberto e NÃO se repete aqui: o índice em si, inclusive o 23505 entre irmãos e o isolamento por tenant
 * (db/testes/catalogo-no-codigo-por-pai.db.test.ts e tests/integracao/multitenant/), e a adoção do nó sem external_id por
 * pai + código no consumidor (modules/catalogo/api/consumidores-erp.db.test.ts).
 */
import { createHash, randomUUID } from 'node:crypto';
import { lerMigracoes } from '@macuxi/db';
import { PEPPER_HUB_FIXTURE } from '@macuxi/db/teste';
import { semBanco } from '@macuxi/db/teste/estado';
import { LoteResultado, VERSAO_CONTRATO } from '@macuxi/integracao/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoApp } from '../../../apps/api/src/banco';
import { criarDespachante } from '../../../apps/api/src/despachante';
import { A, B, licenca, subirApi, type ApiDeTeste, type Tenant } from '../apoio/api';

/** O Conector de B só aceita 203.0.113.0/24 (fixture). */
const IP = { A: '198.51.100.10', B: '203.0.113.5' } as const;
/** Medida cadastrada em cada tenant da fixture (RN-CORE-19). */
const UNIDADE = { A: 'PC', B: 'GF' } as const;
const VERSAO_CONECTOR = '1.2.0';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/** A 0092 como está em db/migrations (down volta ao índice da 0013; up põe o catalogo_no_pai_codigo_uk). */
const M0092 = lerMigracoes().find((m) => m.versao === '0092');
if (!M0092) throw new Error('migração 0092 não encontrada em db/migrations');

interface No {
  ext: string;
  codigo: string;
  nome: string;
  pai: string | null;
  nivel: number;
}
/** A árvore da AM2808 (diagnóstico §1 e migração 0092): OUTROS raiz e filho; NAO_CLASSIFICADO em dois ramos. */
const arvore = (p: string): No[] => [
  { ext: `${p}-OUTROS`, codigo: 'OUTROS', nome: 'Outros', pai: null, nivel: 1 },
  { ext: `${p}-FILT`, codigo: 'FILTRACAO', nome: 'Filtração', pai: null, nivel: 1 },
  { ext: `${p}-OUTROS-F`, codigo: 'OUTROS', nome: 'Outros', pai: `${p}-OUTROS`, nivel: 2 },
  { ext: `${p}-NC-OUTROS`, codigo: 'NAO_CLASSIFICADO', nome: 'Não classificado', pai: `${p}-OUTROS`, nivel: 2 },
  { ext: `${p}-NC-FILT`, codigo: 'NAO_CLASSIFICADO', nome: 'Não classificado', pai: `${p}-FILT`, nivel: 2 },
];

describe.skipIf(semBanco())('v1.0.19 RN-CAT-18 — código do nó único entre irmãos, do Hub ao vínculo do produto (createApp × despachante)', () => {
  let api: ApiDeTeste;
  let worker: pg.Pool;
  const pepperAntes = process.env.MACUXI_HUB_CHAVE_PEPPER;
  let relogioErp = Date.now() - 30 * 60_000;
  const alterado = () => new Date((relogioErp += 1_000)).toISOString();

  const q = async <T extends pg.QueryResultRow>(sql: string, p: unknown[] = []) => (await api.admin.query<T>(sql, p)).rows;
  const despachar = async () => {
    const d = criarDespachante({ worker, app: criarBancoApp(api.pool), modulos: api.modulos, espera: () => 0 });
    for (let i = 0; i < 80; i += 1) if ((await d.ciclo()).lidos === 0) return;
    throw new Error('a outbox não esvaziou em 80 ciclos');
  };
  const parados = (t: Tenant) =>
    q<{ nome: string; external_id: string; tentativas: number; ultimo_erro: string | null }>(
      "select nome, payload->>'external_id' as external_id, tentativas, ultimo_erro from plataforma.evento where tenant_id = $1 and publicado_em is null and tentativas > 0 order by ocorrido_em, nome",
      [t.tenantId],
    );

  const enviar = async (t: Tenant, entidade: 'catalogo_no' | 'produto', registros: object[]) => {
    const corpo = { versao_contrato: VERSAO_CONTRATO, entidade, modo: 'delta', conector_id: t.integracao.identificador, versao_conector: VERSAO_CONECTOR, enviado_em: new Date().toISOString(), registros };
    const r = await api.app.inject({
      method: 'POST',
      url: '/integracao/v1/lotes',
      headers: {
        authorization: `Bearer ${t.integracao.chave.chave}`,
        'x-macuxi-conector-id': t.integracao.identificador,
        'x-macuxi-conector-versao': VERSAO_CONECTOR,
        'user-agent': `macuxi-conector/${VERSAO_CONECTOR}`,
        'idempotency-key': sha256(JSON.stringify({ ...corpo, enviado_em: undefined })),
      },
      remoteAddress: t === A ? IP.A : IP.B,
      payload: corpo,
    });
    expect(r.statusCode, r.body).toBe(202);
    await despachar();
    const loteId = (r.json() as { lote_id: string }).lote_id;
    const c = await api.app.inject({
      method: 'GET',
      url: `/integracao/v1/lotes/${loteId}`,
      headers: { authorization: `Bearer ${t.integracao.chave.chave}`, 'x-macuxi-conector-id': t.integracao.identificador, 'x-macuxi-conector-versao': VERSAO_CONECTOR, 'user-agent': `macuxi-conector/${VERSAO_CONECTOR}` },
      remoteAddress: t === A ? IP.A : IP.B,
    });
    expect(c.statusCode, c.body).toBe(200);
    return LoteResultado.parse(c.json());
  };
  const enviarNos = (t: Tenant, nos: No[]) =>
    enviar(
      t,
      'catalogo_no',
      nos.map((n, i) => ({ external_id: n.ext, alterado_em: alterado(), codigo: n.codigo, nome: n.nome, pai_external_id: n.pai, nivel: n.nivel, ordem: i + 1 })),
    );
  const enviarProdutos = (t: Tenant, prods: { ext: string; no: string }[]) =>
    enviar(
      t,
      'produto',
      prods.map((p) => ({ external_id: p.ext, alterado_em: alterado(), sku: p.ext, ean: null, nome: `Produto ${p.ext}`, marca: null, categoria: null, unidade: t === A ? UNIDADE.A : UNIDADE.B, catalogo_no_external_id: p.no })),
    );
  const nosVivos = (t: Tenant, prefixo: string) =>
    q<{ external_id: string; codigo: string; pai_ext: string | null }>(
      `select n.external_id, n.codigo, p.external_id as pai_ext from catalogo.catalogo_no n left join catalogo.catalogo_no p on p.id = n.pai_id
        where n.tenant_id = $1 and n.external_id like $2 and n.deleted_at is null order by n.external_id`,
      [t.tenantId, `${prefixo}-%`],
    );
  const vinculos = (t: Tenant, prefixo: string) =>
    q<{ produto: string; no: string }>(
      `select pr.external_id as produto, n.external_id as no from catalogo.produto_no pn join core.produto pr on pr.id = pn.produto_id
         join catalogo.catalogo_no n on n.id = pn.no_id where pn.tenant_id = $1 and pr.external_id like $2 and pn.deleted_at is null order by pr.external_id`,
      [t.tenantId, `${prefixo}-%`],
    );

  beforeAll(async () => {
    process.env.MACUXI_HUB_CHAVE_PEPPER = PEPPER_HUB_FIXTURE;
    api = await subirApi();
    if (!api.banco.urlWorker) throw new Error('banco de teste sem urlWorker (MACUXI_PG_WORKER_SENHA): o Hub precisa do despachante');
    worker = new pg.Pool({ connectionString: api.banco.urlWorker, max: 2 });
    for (const t of [A, B]) {
      const adm = (await api.sessao(t === A ? 'admin@exemplo.com.br' : 'admin.b@exemplo.com.br', t)).access_token;
      expect((await licenca(api, adm, 'tenant', 'integracao', true)).statusCode).toBe(200);
    }
    // a fixture não habilita a entidade catalogo_no nos Conectores (A: 8 entidades; B: cliente e produto)
    await api.admin.query("update integracao.conector set entidades = array_append(entidades, 'catalogo_no') where not ('catalogo_no' = any(entidades))");
    await despachar();
    await api.admin.query("update integracao.lote set status = 'concluido', concluido_em = now() where status in ('recebido', 'processando')");
  }, 300_000);

  afterAll(async () => {
    if (pepperAntes === undefined) delete process.env.MACUXI_HUB_CHAVE_PEPPER;
    else process.env.MACUXI_HUB_CHAVE_PEPPER = pepperAntes;
    await worker?.end().catch(() => undefined);
    await api?.fechar();
  });

  const P1 = `R15${randomUUID().slice(0, 4).toUpperCase()}`;

  it('C-1: OUTROS raiz + OUTROS filho e NAO_CLASSIFICADO em dois ramos entram; os produtos desses nós ganham o vínculo', async () => {
    const lote = await enviarNos(A, arvore(P1));
    expect(lote.erros, JSON.stringify(lote.erros)).toEqual([]);
    expect(await parados(A), 'nenhum evento parado').toEqual([]);
    expect((await nosVivos(A, P1)).map((n) => [n.external_id, n.codigo, n.pai_ext])).toEqual([
      [`${P1}-FILT`, 'FILTRACAO', null],
      [`${P1}-NC-FILT`, 'NAO_CLASSIFICADO', `${P1}-FILT`],
      [`${P1}-NC-OUTROS`, 'NAO_CLASSIFICADO', `${P1}-OUTROS`],
      [`${P1}-OUTROS`, 'OUTROS', null],
      [`${P1}-OUTROS-F`, 'OUTROS', `${P1}-OUTROS`],
    ]);
    await enviarProdutos(A, [
      { ext: `${P1}-P1`, no: `${P1}-OUTROS-F` },
      { ext: `${P1}-P2`, no: `${P1}-NC-OUTROS` },
      { ext: `${P1}-P3`, no: `${P1}-NC-FILT` },
    ]);
    expect(await parados(A)).toEqual([]);
    expect(await vinculos(A, P1)).toEqual([
      { produto: `${P1}-P1`, no: `${P1}-OUTROS-F` },
      { produto: `${P1}-P2`, no: `${P1}-NC-OUTROS` },
      { produto: `${P1}-P3`, no: `${P1}-NC-FILT` },
    ]);
  }, 120_000);

  describe('C-4: reprocesso da AM2808 (índice antigo → 0092 → tentativas zeradas)', () => {
    const P2 = `AM${randomUUID().slice(0, 4).toUpperCase()}`;
    let trocado = false;
    const voltarAo0092 = async () => {
      if (!trocado) return;
      await api.admin.query(M0092.up);
      trocado = false;
    };
    afterAll(voltarAo0092);

    it('antes da 0092 os 2 nós e os produtos deles param; depois dela e do reprocesso, tudo entra (nós antes dos produtos)', async () => {
      // estado da produção em 15/11: só o índice da 0013; os repetidos do C-1 em A saem para o down não falhar, e a carga vai para B
      await api.admin.query('update catalogo.catalogo_no set deleted_at = now() where tenant_id = $1 and deleted_at is null and codigo in ($2, $3)', [A.tenantId, 'OUTROS', 'NAO_CLASSIFICADO']);
      trocado = true;
      await api.admin.query(M0092.down);

      // NC-FILT num 2º lote: com o índice antigo, o NAO_CLASSIFICADO que chega primeiro entra; a ordem fixa o que para
      await enviarNos(B, arvore(P2).slice(0, 4));
      await enviarNos(B, arvore(P2).slice(4));
      const nosParados = await parados(B);
      expect(nosParados.map((x) => x.external_id).sort()).toEqual([`${P2}-NC-FILT`, `${P2}-OUTROS-F`]);
      for (const x of nosParados) {
        expect(x.tentativas).toBe(10);
        expect(x.ultimo_erro).toMatch(/23505.*catalogo_no_codigo_uk/);
      }
      await enviarProdutos(B, [
        { ext: `${P2}-P1`, no: `${P2}-OUTROS-F` },
        { ext: `${P2}-P2`, no: `${P2}-NC-FILT` },
        { ext: `${P2}-P3`, no: `${P2}-NC-OUTROS` },
      ]);
      const prodParados = (await parados(B)).filter((x) => x.nome.startsWith('integracao.produto.'));
      expect(prodParados.map((x) => x.external_id).sort()).toEqual([`${P2}-P1`, `${P2}-P2`]);
      for (const x of prodParados) expect(x.ultimo_erro).toMatch(/catalogo: ReferenciaAusenteErp.*catalogo_no/);
      expect(await vinculos(B, P2)).toEqual([{ produto: `${P2}-P3`, no: `${P2}-NC-OUTROS` }]);

      // a 0092 em produção e o reprocesso da opção C (§7): tentativas a zero, do mais antigo ao mais novo
      await voltarAo0092();
      await api.admin.query('update plataforma.evento set tentativas = 0, ultimo_erro = null where tenant_id = $1 and publicado_em is null and tentativas > 0', [B.tenantId]);
      await despachar();
      expect(await parados(B), 'nada parado depois do reprocesso').toEqual([]);
      expect((await nosVivos(B, P2)).map((n) => [n.external_id, n.codigo, n.pai_ext])).toEqual([
        [`${P2}-FILT`, 'FILTRACAO', null],
        [`${P2}-NC-FILT`, 'NAO_CLASSIFICADO', `${P2}-FILT`],
        [`${P2}-NC-OUTROS`, 'NAO_CLASSIFICADO', `${P2}-OUTROS`],
        [`${P2}-OUTROS`, 'OUTROS', null],
        [`${P2}-OUTROS-F`, 'OUTROS', `${P2}-OUTROS`],
      ]);
      expect(await vinculos(B, P2)).toEqual([
        { produto: `${P2}-P1`, no: `${P2}-OUTROS-F` },
        { produto: `${P2}-P2`, no: `${P2}-NC-FILT` },
        { produto: `${P2}-P3`, no: `${P2}-NC-OUTROS` },
      ]);
    }, 240_000);
  });
});
