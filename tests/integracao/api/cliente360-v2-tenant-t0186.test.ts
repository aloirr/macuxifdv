/**
 * T-0186 (Cliente 360 v2) — outro tenant nas rotas de permissões de documento do BKO e na ficha, com a API REAL (createApp ×
 * Postgres como macuxi_app, RLS × fixture dois-tenants). Regra: RN-CORE-05 (um tenant nunca lê nem altera dado de outro).
 *
 * Fixture (DOCUMENTOS_FIXTURE): por tenant um tipo, um documento do c1, a permissão "ve" do perfil vendedor e a exceção que tira
 * o documento dele (A: "Alvará de funcionamento"; B: "Contrato social"). O admin de B tenta ler e gravar com os ids de A:
 *  - a leitura do BKO só traz o que é de B;
 *  - a matriz com o tipo de A é recusada (DOCUMENTO_TIPO_DESCONHECIDO) e a de B não apaga a matriz de A;
 *  - a exceção no documento de A é 404 e a de A fica intacta;
 *  - a ficha (notas, NF, documentos) com o cliente, a nota ou o documento de A não devolve nada de A.
 * Matriz: docs/testes/T-0186.md (T-01..T-05).
 */
import { semBanco } from '@macuxi/db/teste/estado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A, B, erroDe, subirApi, type ApiDeTeste } from '../apoio/api';
import { DOCUMENTOS_FIXTURE, rotas360 } from '../apoio/cliente360-v2';

const DA = DOCUMENTOS_FIXTURE.A;
const DB = DOCUMENTOS_FIXTURE.B;

describe.skipIf(semBanco())('T-0186 — outro tenant nas permissões de documento do BKO e na ficha (createApp real × Postgres)', () => {
  let api: ApiDeTeste;
  const tk = { adminA: '', adminB: '', vendedorB: '' };
  let notaA = '';
  /** Estado de A no banco (tipo, perfil, nível e exceções vivas), lido pelo admin do banco, antes e depois de cada tentativa de B. */
  const estadoDeA = async () => ({
    matriz: (await api.admin.query('select tipo_id, perfil_id, nivel from core.documento_permissao where tenant_id = $1 and deleted_at is null order by tipo_id, perfil_id', [A.tenantId])).rows,
    excecoes: (await api.admin.query('select documento_id, perfil_id from core.documento_excecao where tenant_id = $1 and deleted_at is null order by documento_id, perfil_id', [A.tenantId])).rows,
  });

  beforeAll(async () => {
    api = await subirApi();
    tk.adminA = (await api.sessao('admin@exemplo.com.br', A)).access_token;
    tk.adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
    tk.vendedorB = (await api.sessao('vendedor@exemplo.com.br', B)).access_token;
    notaA = (await api.admin.query<{ id: string }>("select id from core.nota_erp where tenant_id = $1 and external_id = 'NF-1-5001'", [A.tenantId])).rows[0]!.id;
  }, 120_000);

  afterAll(async () => {
    await api?.fechar();
  });

  const rotasDeA = () => rotas360({ cliente: A.clientes.c1, nota: notaA, documento: DA.documento });

  it('T-01: GET documentos/permissoes do admin de B traz só o tipo, a matriz e a exceção de B', async () => {
    const r = await api.chamar(tk.adminB, rotasDeA().permissoes);
    expect(r.statusCode, r.body).toBe(200);
    const corpo = r.json() as { tipos: { id: string }[]; matriz: { tipo_id: string }[]; excecoes: { documento_id: string; cliente_id: string }[] };
    expect(corpo.tipos.map((t) => t.id)).toEqual([DB.tipo]);
    expect(new Set(corpo.matriz.map((m) => m.tipo_id))).toEqual(new Set([DB.tipo]));
    expect(corpo.excecoes.map((x) => [x.documento_id, x.cliente_id])).toEqual([[DB.documento, B.clientes.c1]]);
    expect(r.body).not.toContain(DA.tipo);
    expect(r.body).not.toContain(DA.documento);
  });

  it('T-02: PUT da matriz com o tipo de A pelo admin de B = 422 DOCUMENTO_TIPO_DESCONHECIDO; nada muda em A', async () => {
    const antes = await estadoDeA();
    const r = await api.chamar(tk.adminB, { ...rotasDeA().gravarPermissoes, payload: { matriz: [{ tipo_id: DA.tipo, perfil: 'vendedor', nivel: 'nao_ve' }] } });
    expect(r.statusCode, r.body).toBe(422);
    expect(erroDe(r).codigo).toBe('DOCUMENTO_TIPO_DESCONHECIDO');
    expect(await estadoDeA()).toEqual(antes);
  });

  it('T-03: PUT da matriz de B (substitui o estado inteiro) não apaga nem altera a matriz de A', async () => {
    const antes = await estadoDeA();
    expect(antes.matriz.length).toBeGreaterThan(0);
    const r = await api.chamar(tk.adminB, { ...rotasDeA().gravarPermissoes, payload: { matriz: [{ tipo_id: DB.tipo, perfil: 'gerente', nivel: 've' }] } });
    expect(r.statusCode, r.body).toBe(200);
    expect(await estadoDeA()).toEqual(antes);
    // B ficou só com a linha nova
    const b = (await api.admin.query<{ n: number }>('select count(*)::int as n from core.documento_permissao where tenant_id = $1 and deleted_at is null', [B.tenantId])).rows[0]!.n;
    expect(b).toBe(1);
  });

  it('T-04: PUT da exceção no documento de A pelo admin de B = 404 DOCUMENTO_NAO_ENCONTRADO; a exceção de A fica', async () => {
    const antes = await estadoDeA();
    for (const perfis of [[], ['gerente']]) {
      const r = await api.chamar(tk.adminB, { ...rotasDeA().gravarExcecao, payload: { documento_id: DA.documento, perfis } });
      expect(r.statusCode, `${JSON.stringify(perfis)}: ${r.body}`).toBe(404);
      expect(erroDe(r).codigo).toBe('DOCUMENTO_NAO_ENCONTRADO');
    }
    expect(await estadoDeA()).toEqual(antes);
  });

  it('T-05: a ficha com o cliente, a nota e o documento de A não devolve nada de A ao admin nem ao vendedor de B', async () => {
    const rotas = rotasDeA();
    for (const [quem, token] of [['adminB', tk.adminB], ['vendedorB', tk.vendedorB]] as const) {
      const notas = await api.chamar(token, rotas.notas);
      // vendedor de B: o cliente de A não está na carteira (404); admin de B: carteira do tenant, a lista vem vazia (RLS)
      if (notas.statusCode === 200) expect((notas.json() as { itens: unknown[] }).itens, quem).toEqual([]);
      else expect(notas.statusCode, `${quem}: ${notas.body}`).toBe(404);
      expect(notas.body, quem).not.toContain(notaA);
      const nota = await api.chamar(token, rotas.nota);
      expect(nota.statusCode, `${quem} nota: ${nota.body}`).toBe(404);
      const docs = await api.chamar(token, rotas.documentos);
      if (docs.statusCode === 200) expect((docs.json() as { itens: unknown[] }).itens, quem).toEqual([]);
      else expect(docs.statusCode, `${quem}: ${docs.body}`).toBe(404);
      const doc = await api.chamar(token, rotas.documento);
      expect(doc.statusCode, `${quem} documento: ${doc.body}`).toBe(404);
    }
  });
});
