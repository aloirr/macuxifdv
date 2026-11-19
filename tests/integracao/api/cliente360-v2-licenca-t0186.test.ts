/**
 * T-0186 (Cliente 360 v2) — licença nas 7 rotas novas do Core, com a API REAL (createApp × Postgres como macuxi_app × fixture
 * dois-tenants). Regras: RN-CORE-01 (o Core não desliga), RN-CORE-02 (rota de módulo inativo = 403 MODULO_INATIVO), RN-CORE-03.
 *
 * As rotas novas (`clientes/:id/notas`, `.../notas/:nota_id`, `.../documentos`, `.../documentos/:documento_id`,
 * `documentos/permissoes` GET/PUT e `documentos/excecoes`) são do Core. O Core está sempre ativo (RN-CORE-01), então:
 *  - nenhuma delas pode responder MODULO_INATIVO, nem com todos os outros módulos desligados para o usuário;
 *  - a ficha não depende da licença do Vendedor nem do Catálogo (o Histórico é de notas do ERP, no Core).
 * Matriz: docs/testes/T-0186.md (L-01..L-04).
 */
import { semBanco } from '@macuxi/db/teste/estado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A, erroDe, licenca, subirApi, type ApiDeTeste } from '../apoio/api';
import { DOCUMENTOS_FIXTURE, rotas360 } from '../apoio/cliente360-v2';

describe.skipIf(semBanco())('T-0186 — licença nas rotas novas do Cliente 360 v2 (createApp real × Postgres)', () => {
  let api: ApiDeTeste;
  const tk = { admin: '', vendedor: '' };
  let rotas: ReturnType<typeof rotas360>;
  /** Módulos do vendedor-1 na fixture, além do Core (desligados no nível do usuário no caso L-02). */
  const OUTROS = ['catalogo', 'vendedor'] as const;

  beforeAll(async () => {
    api = await subirApi();
    tk.admin = (await api.sessao('admin@exemplo.com.br', A)).access_token;
    tk.vendedor = (await api.sessao('vendedor@exemplo.com.br', A)).access_token;
    const [nota] = (await api.admin.query<{ id: string }>("select id from core.nota_erp where tenant_id = $1 and external_id = 'NF-1-5001'", [A.tenantId])).rows;
    rotas = rotas360({ cliente: A.clientes.c1, nota: nota!.id, documento: DOCUMENTOS_FIXTURE.A.documento });
  }, 120_000);

  afterAll(async () => {
    for (const m of OUTROS) await licenca(api, tk.admin, 'usuario', m, true, A.usuarios.vendedor1);
    await api?.fechar();
  });

  it('L-01 (RN-CORE-01): o admin da fixture tem só o Core e usa as 7 rotas sem MODULO_INATIVO', async () => {
    expect((await api.meusModulos(tk.admin)).modulos.map((m) => m.id)).toEqual(['core']);
    const respostas = {
      notas: await api.chamar(tk.admin, rotas.notas),
      nota: await api.chamar(tk.admin, rotas.nota),
      documentos: await api.chamar(tk.admin, rotas.documentos),
      permissoes: await api.chamar(tk.admin, rotas.permissoes),
      gravarExcecao: await api.chamar(tk.admin, { ...rotas.gravarExcecao, payload: { documento_id: DOCUMENTOS_FIXTURE.A.documento, perfis: ['vendedor'] } }),
    };
    for (const [nome, r] of Object.entries(respostas)) expect(r.statusCode, `${nome}: ${r.body}`).toBe(200);
    // o PUT da matriz devolve o estado inteiro lido; regrava o mesmo
    const atual = respostas.permissoes.json() as { matriz: unknown[] };
    const put = await api.chamar(tk.admin, { ...rotas.gravarPermissoes, payload: { matriz: atual.matriz } });
    expect(put.statusCode, put.body).toBe(200);
  });

  it('L-02 (RN-CORE-02/03): com Catálogo e Vendedor desligados no usuário, o vendedor continua com o Histórico e a Documentação (rotas do Core)', async () => {
    for (const m of OUTROS) {
      const r = await licenca(api, tk.admin, 'usuario', m, false, A.usuarios.vendedor1);
      expect(r.statusCode, `${m}: ${r.body}`).toBe(200);
    }
    try {
      expect((await api.meusModulos(tk.vendedor)).modulos.map((m) => m.id)).toEqual(['core']);
      for (const nome of ['notas', 'nota', 'documentos'] as const) {
        const r = await api.chamar(tk.vendedor, rotas[nome]);
        expect(r.statusCode, `${nome}: ${r.body}`).toBe(200);
      }
      // o documento da fixture não tem arquivo: 404 do documento, nunca MODULO_INATIVO
      const doc = await api.chamar(tk.vendedor, rotas.documento);
      expect(doc.statusCode, doc.body).toBe(404);
      expect(erroDe(doc).codigo).toBe('DOCUMENTO_NAO_ENCONTRADO');
    } finally {
      for (const m of OUTROS) await licenca(api, tk.admin, 'usuario', m, true, A.usuarios.vendedor1);
    }
  });

  it('L-03 (RN-CORE-01): o Core não desliga em nenhum nível, então as rotas novas nunca respondem MODULO_INATIVO', async () => {
    for (const [nivel, alvo] of [['tenant', undefined], ['perfil', 'vendedor'], ['usuario', A.usuarios.vendedor1]] as const) {
      const r = await licenca(api, tk.admin, nivel, 'core', false, alvo);
      expect(r.statusCode, `${nivel}: ${r.body}`).toBe(422);
    }
    const r = await api.chamar(tk.vendedor, rotas.notas);
    expect(r.statusCode, r.body).toBe(200);
  });

  it('L-04 (perfil): as permissões do BKO são só do admin; o vendedor recebe 403 sem chegar à regra (PERFIL_SEM_BKO), nunca MODULO_INATIVO', async () => {
    for (const op of [rotas.permissoes, { ...rotas.gravarPermissoes, payload: { matriz: [] } }, { ...rotas.gravarExcecao, payload: { documento_id: DOCUMENTOS_FIXTURE.A.documento, perfis: [] } }]) {
      const r = await api.chamar(tk.vendedor, op);
      expect(r.statusCode, `${op.method} ${op.url}: ${r.body}`).toBe(403);
      expect(erroDe(r).codigo).not.toBe('MODULO_INATIVO');
    }
  });
});
