/**
 * RN-CAT-09 (marca opcional, R-20261115-073000) na exportação do catálogo (`GET /v1/catalogo/exportacao`, RF-CAT-09) na API
 * REAL: `createApp` com os 8 módulos, JWT de verdade e Postgres como `macuxi_app` (RLS), fixture dois-tenants num banco
 * efêmero próprio do arquivo. Agente `testes`. Banco só no CI (sem Docker na sessão).
 *
 * Depende do Catálogo (`referenciaVisivel` na exportação) e da migração 0075 (`marca_id` nulo).
 *
 * A exportação mostra a referência como a ficha, o cartão e a busca:
 *  X-1  marca ativa: sai com o nome do cadastro de marcas do Catálogo (não o retrato velho `marca_nome`).
 *  X-2  marca inativa: a referência some.
 *  X-3  marca ausente (apagada do cadastro): a referência some, mesmo com retrato `marca_nome`.
 *  X-4  sem marca: sai só com o código (`marca_id` e `marca_nome` nulos).
 *  X-5  a ordem do cadastro se mantém entre as visíveis.
 */
import { RespostaExportacao } from '@macuxi/catalogo/contracts';
import { semBanco } from '@macuxi/db/teste/estado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MARCAS_FIXTURE, MARCA_NOME_FIXTURE } from '../../../db/seeds/fixtures/dois-tenants';
import { A, subirApi, type ApiDeTeste } from '../apoio/api';

describe.skipIf(semBanco())('RN-CAT-09 — exportação com marca ativa, inativa, ausente e sem marca (createApp real × Postgres)', () => {
  let api: ApiDeTeste;
  let analista = '';
  const produto = A.produtos.p1;

  /** Troca as referências vivas do produto pelas da lista, na ordem (1..3), direto no banco (o PUT do BKO recusa marca inativa). */
  const gravarReferencias = async (refs: { marca_id: string | null; marca_nome: string | null; codigo: string }[]) => {
    await api.admin.query('update catalogo.produto_referencia set deleted_at = now() where tenant_id = $1 and produto_id = $2 and deleted_at is null', [A.tenantId, produto]);
    for (const [i, r] of refs.entries()) {
      await api.admin.query(
        `insert into catalogo.produto_referencia (id, tenant_id, produto_id, marca_id, marca_nome, codigo, codigo_compacto, ordem)
         values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
        [A.tenantId, produto, r.marca_id, r.marca_nome, r.codigo, r.codigo.toLowerCase().replace(/[^a-z0-9]/g, ''), i + 1],
      );
    }
  };
  const exportar = async () => {
    const r = await api.chamar(analista, { method: 'GET', url: '/v1/catalogo/exportacao' });
    expect(r.statusCode, r.body).toBe(200);
    const p = RespostaExportacao.parse(r.json()).produtos.find((x) => x.id === produto);
    expect(p, 'ALFA-001 (com preço) está na exportação').toBeDefined();
    return p!.referencias;
  };

  beforeAll(async () => {
    api = await subirApi();
    analista = (await api.sessao('analista@exemplo.com.br')).access_token;
  }, 300_000);

  afterAll(async () => {
    await api?.fechar();
  });

  it('X-1..X-3: com ativa, inativa e apagada, só a ativa sai, com o nome atual do cadastro', async () => {
    await gravarReferencias([
      { marca_id: MARCAS_FIXTURE.A.inativa, marca_nome: 'Marca Inativa Alfa', codigo: 'IN 0002' },
      { marca_id: MARCAS_FIXTURE.A.ativa, marca_nome: 'Retrato Antigo', codigo: 'AT 0001' },
      { marca_id: MARCAS_FIXTURE.A.apagada, marca_nome: 'Marca Apagada Alfa', codigo: 'AP 0003' },
    ]);
    expect(await exportar()).toEqual([{ marca_id: MARCAS_FIXTURE.A.ativa, marca_nome: MARCA_NOME_FIXTURE.A, codigo: 'AT 0001' }]);
  });

  it('X-4/X-5: sem marca sai só com o código; a inativa no meio some e a ordem do cadastro se mantém', async () => {
    await gravarReferencias([
      { marca_id: null, marca_nome: null, codigo: 'SM-0004' },
      { marca_id: MARCAS_FIXTURE.A.inativa, marca_nome: 'Marca Inativa Alfa', codigo: 'IN 0005' },
      { marca_id: MARCAS_FIXTURE.A.ativa, marca_nome: MARCA_NOME_FIXTURE.A, codigo: 'AT 0006' },
    ]);
    expect(await exportar()).toEqual([
      { marca_id: null, marca_nome: null, codigo: 'SM-0004' },
      { marca_id: MARCAS_FIXTURE.A.ativa, marca_nome: MARCA_NOME_FIXTURE.A, codigo: 'AT 0006' },
    ]);
  });
});
