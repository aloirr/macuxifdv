/**
 * T-0063 — medidas do produto pela API REAL (createApp + Core + Postgres como macuxi_app, RLS), cenários do agente `testes`.
 * Os testes do módulo (modules/core/api/medidas.db.test.ts) chamam `executar` das rotas e conferem perfil/licença com o SDK;
 * aqui o caminho é o HTTP de verdade: login, perfil (403 PERFIL_SEM_ACESSO), escopo do tenant (404 na medida do outro),
 * idempotência do POST pelo id do cliente, produto só com medida cadastrada e ativa (422), apagar em uso recusado (422),
 * inativar em uso permitido e apagar sem uso (204). RN-CORE-19, RF-CORE-14; RN-CORE-01 (o Core não desliga: a rota de
 * medida, que é do Core, não pode ficar sem licença). Banco efêmero próprio (apoio/api.ts). Pula sem Postgres.
 */
import { semBanco } from '@macuxi/db/teste/estado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A, B, erroDe, licenca, subirApi, type ApiDeTeste } from '../apoio/api';

const BASE = '/v1/core/medidas';
const id = (n: number) => `0e630000-0000-4000-8000-${String(900_000 + n).padStart(12, '0')}`;
const ID_QQ = id(1);
const ID_QR = id(2);
const ID_WB = id(3);

interface MedidaApi {
  id: string;
  sigla: string;
  descricao: string;
  ativo: boolean;
  em_uso: number;
}

describe.skipIf(semBanco())('T-0063 — medidas do produto pela API real (Postgres)', () => {
  let api: ApiDeTeste;
  let analista: string;
  let adminA: string;
  let adminB: string;
  let produtoA: { id: string; unidade: string };

  const listar = async (token: string): Promise<MedidaApi[]> => {
    const r = await api.chamar(token, { method: 'GET', url: BASE });
    expect(r.statusCode, r.body).toBe(200);
    return (r.json() as { itens: MedidaApi[] }).itens;
  };
  const criar = (token: string, mid: string, sigla: string, descricao = `Medida ${sigla}`) => api.chamar(token, { method: 'POST', url: BASE, payload: { id: mid, sigla, descricao } });
  const editar = (token: string, mid: string, corpo: Record<string, unknown>) => api.chamar(token, { method: 'PUT', url: `${BASE}/${mid}`, payload: corpo });
  const apagar = (token: string, mid: string) => api.chamar(token, { method: 'DELETE', url: `${BASE}/${mid}` });
  const medidasDoProduto = (token: string, pid: string, corpo: Record<string, unknown>) => api.chamar(token, { method: 'PUT', url: `/v1/core/produtos/${pid}/medidas`, payload: corpo });

  beforeAll(async () => {
    api = await subirApi();
    analista = (await api.sessao('analista@exemplo.com.br')).access_token;
    adminA = (await api.sessao('admin@exemplo.com.br')).access_token;
    adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
    const r = await api.admin.query<{ id: string; unidade: string }>('select id, unidade from core.produto where tenant_id = $1 and deleted_at is null order by sku limit 1', [A.tenantId]);
    produtoA = r.rows[0]!;
    expect(produtoA, 'fixture dois-tenants sem produto no tenant A').toBeTruthy();
  });
  afterAll(async () => {
    await api?.fechar();
  });

  it('RN-CORE-19: o tenant nasce com as 11 medidas iniciais (A e B), cada tenant com os seus ids', async () => {
    const siglas = ['BD', 'CX', 'DP', 'DZ', 'FD', 'GL', 'KG', 'LT', 'PCT', 'TB', 'UN'];
    const a = await listar(analista);
    const b = await listar(adminB);
    expect(a.map((m) => m.sigla)).toEqual(expect.arrayContaining(siglas));
    expect(b.map((m) => m.sigla)).toEqual(expect.arrayContaining(siglas));
    const idsA = new Set(a.map((m) => m.id));
    expect(b.filter((m) => idsA.has(m.id))).toEqual([]);
  });

  it('perfil: vendedor, promotor, supervisor, gerente e assistente recebem 403 PERFIL_SEM_ACESSO ao cadastrar, editar, apagar e mudar a medida do produto', async () => {
    const UN = (await listar(analista)).find((m) => m.sigla === 'UN')!;
    for (const email of ['vendedor@exemplo.com.br', 'promotor@exemplo.com.br', 'supervisor@exemplo.com.br', 'gerente@exemplo.com.br', 'assistente@exemplo.com.br']) {
      const t = (await api.sessao(email)).access_token;
      const tentativas = [
        await criar(t, id(90), 'ZZ'),
        await editar(t, UN.id, { descricao: 'Unidade (perfil errado)' }),
        await apagar(t, UN.id),
        await medidasDoProduto(t, produtoA.id, { unidade: produtoA.unidade }),
      ];
      for (const r of tentativas) {
        expect(r.statusCode, `${email}: ${r.body}`).toBe(403);
        expect(erroDe(r).codigo, email).toBe('PERFIL_SEM_ACESSO');
      }
    }
    // nada foi gravado pelos perfis errados
    const depois = await listar(analista);
    expect(depois.find((m) => m.sigla === 'ZZ')).toBeUndefined();
    expect(depois.find((m) => m.id === UN.id)!.descricao).toBe(UN.descricao);
  });

  it('perfil: leitura da lista — gerente consulta (200); vendedor e promotor recebem 403', async () => {
    const gerente = (await api.sessao('gerente@exemplo.com.br')).access_token;
    expect((await api.chamar(gerente, { method: 'GET', url: BASE })).statusCode).toBe(200);
    for (const email of ['vendedor@exemplo.com.br', 'promotor@exemplo.com.br']) {
      const t = (await api.sessao(email)).access_token;
      const r = await api.chamar(t, { method: 'GET', url: BASE });
      expect(r.statusCode, email).toBe(403);
      expect(erroDe(r).codigo, email).toBe('PERFIL_SEM_ACESSO');
    }
  });

  it('sem token: 401 em todas as rotas de medida', async () => {
    for (const op of [
      { method: 'GET' as const, url: BASE },
      { method: 'POST' as const, url: BASE, payload: { id: id(91), sigla: 'ZY', descricao: 'x' } },
      { method: 'PUT' as const, url: `${BASE}/${id(91)}`, payload: { ativo: false } },
      { method: 'DELETE' as const, url: `${BASE}/${id(91)}` },
    ]) {
      expect((await api.chamar(null, op)).statusCode, `${op.method} ${op.url}`).toBe(401);
    }
  });

  it('licença (RN-CORE-01/RN-CORE-02): as rotas de medida são do Core, que não desliga em nenhum nível (422 RN-CORE-01); a medida segue acessível', async () => {
    const r = await licenca(api, adminA, 'tenant', 'core', false);
    expect(r.statusCode, r.body).toBe(422);
    expect(erroDe(r).codigo).toBe('RN-CORE-01');
    expect((await api.chamar(analista, { method: 'GET', url: BASE })).statusCode).toBe(200);
  });

  it('RN-CORE-19: analista cadastra (201, sigla normalizada); repetir o POST com o mesmo id é idempotente; sigla repetida com outro id = 422 MEDIDA_DUPLICADA', async () => {
    const r1 = await criar(analista, ID_QQ, ' qq ', 'Quarto de quilo');
    expect(r1.statusCode, r1.body).toBe(201);
    expect(r1.json()).toMatchObject({ id: ID_QQ, sigla: 'QQ', descricao: 'Quarto de quilo', ativo: true, em_uso: 0 });
    const r2 = await criar(analista, ID_QQ, 'QQ', 'Quarto de quilo');
    expect(r2.statusCode, r2.body).toBe(201);
    expect(r2.json()).toMatchObject({ id: ID_QQ, sigla: 'QQ' });
    expect((await listar(analista)).filter((m) => m.sigla === 'QQ')).toHaveLength(1);
    const dup = await criar(analista, id(4), 'QQ');
    expect(dup.statusCode, dup.body).toBe(422);
    expect(erroDe(dup).codigo).toBe('MEDIDA_DUPLICADA');
    const invalida = await criar(analista, id(5), 'CX1');
    expect(invalida.statusCode, invalida.body).toBe(422);
    expect(erroDe(invalida).codigo).toBe('MEDIDA_INVALIDA');
  });

  it('tenant errado: B não vê a medida de A (lista), não edita nem apaga pelo id (404) e pode ter a mesma sigla', async () => {
    expect((await listar(adminB)).find((m) => m.sigla === 'QQ')).toBeUndefined();
    const e = await editar(adminB, ID_QQ, { ativo: false });
    expect(e.statusCode, e.body).toBe(404);
    expect(erroDe(e).codigo).toBe('MEDIDA_NAO_ENCONTRADA');
    const d = await apagar(adminB, ID_QQ);
    expect(d.statusCode, d.body).toBe(404);
    // A segue intacta
    expect((await listar(analista)).find((m) => m.id === ID_QQ)).toMatchObject({ ativo: true });
    // a mesma sigla convive no B (id próprio)
    const b = await criar(adminB, ID_WB, 'QQ');
    expect(b.statusCode, b.body).toBe(201);
  });

  it('RN-CORE-19: produto só aceita medida cadastrada (422 MEDIDA_NAO_CADASTRADA), ativa (422 MEDIDA_INATIVA) e do PRÓPRIO tenant', async () => {
    const naoCad2 = await medidasDoProduto(analista, produtoA.id, { unidade: 'WWW' });
    expect(naoCad2.statusCode, naoCad2.body).toBe(422);
    expect(erroDe(naoCad2).codigo).toBe('MEDIDA_NAO_CADASTRADA');
    // sigla que só existe no B não vale para o A
    expect((await criar(adminB, id(6), 'WB')).statusCode).toBe(201);
    const deB = await medidasDoProduto(analista, produtoA.id, { unidade: 'WB' });
    expect(deB.statusCode, deB.body).toBe(422);
    expect(erroDe(deB).codigo).toBe('MEDIDA_NAO_CADASTRADA');
    // inativa
    expect((await criar(analista, ID_QR, 'QR')).statusCode).toBe(201);
    expect((await editar(analista, ID_QR, { ativo: false })).statusCode).toBe(200);
    const inativa = await medidasDoProduto(analista, produtoA.id, { unidade: 'QR' });
    expect(inativa.statusCode, inativa.body).toBe(422);
    expect(erroDe(inativa).codigo).toBe('MEDIDA_INATIVA');
    // embalagem também conferida
    const emb = await medidasDoProduto(analista, produtoA.id, { unidade: produtoA.unidade, embalagem_medida: 'WWW', embalagem_quantidade: 12 });
    expect(emb.statusCode, emb.body).toBe(422);
    expect(erroDe(emb).codigo).toBe('MEDIDA_NAO_CADASTRADA');
    // nada mudou no produto
    const p = await api.admin.query('select unidade, embalagem_medida from core.produto where id = $1', [produtoA.id]);
    expect(p.rows[0]).toEqual({ unidade: produtoA.unidade, embalagem_medida: null });
  });

  it('RN-CORE-19: produto aceita medida cadastrada e ativa (unidade QQ + embalagem CX c/ 12) e a repetição não muda nada', async () => {
    const r = await medidasDoProduto(analista, produtoA.id, { unidade: 'qq', embalagem_medida: 'CX', embalagem_quantidade: 12 });
    expect(r.statusCode, r.body).toBe(200);
    const again = await medidasDoProduto(analista, produtoA.id, { unidade: 'QQ', embalagem_medida: 'CX', embalagem_quantidade: 12 });
    expect(again.statusCode, again.body).toBe(200);
    const p = await api.admin.query('select unidade, embalagem_medida, embalagem_quantidade from core.produto where id = $1', [produtoA.id]);
    expect(p.rows[0]).toEqual({ unidade: 'QQ', embalagem_medida: 'CX', embalagem_quantidade: 12 });
  });

  it('RN-CORE-19: não apaga medida em uso (422 MEDIDA_EM_USO) nem troca a sigla; inativar em uso pode e o produto mantém a sigla; apagar sem uso = 204', async () => {
    const qq = (await listar(analista)).find((m) => m.id === ID_QQ)!;
    expect(qq.em_uso).toBeGreaterThanOrEqual(1);
    const del = await apagar(analista, ID_QQ);
    expect(del.statusCode, del.body).toBe(422);
    expect(erroDe(del).codigo).toBe('MEDIDA_EM_USO');
    const troca = await editar(analista, ID_QQ, { sigla: 'QX' });
    expect(troca.statusCode, troca.body).toBe(422);
    expect(erroDe(troca).codigo).toBe('MEDIDA_EM_USO');
    // inativar em uso: permitido
    const inat = await editar(analista, ID_QQ, { ativo: false });
    expect(inat.statusCode, inat.body).toBe(200);
    expect(inat.json()).toMatchObject({ sigla: 'QQ', ativo: false });
    const p = await api.admin.query('select unidade from core.produto where id = $1', [produtoA.id]);
    expect(p.rows[0].unidade).toBe('QQ');
    // o produto que já usa a sigla inativa continua editável (mesma sigla); outro produto não pode escolhê-la
    expect((await medidasDoProduto(analista, produtoA.id, { unidade: 'QQ' })).statusCode).toBe(200);
    // volta o produto para a unidade original: QQ fica sem uso e pode ser apagada
    expect((await medidasDoProduto(analista, produtoA.id, { unidade: produtoA.unidade })).statusCode).toBe(200);
    // QR (inativa, sem uso) pode sair
    const apagada = await apagar(analista, ID_QR);
    expect(apagada.statusCode, apagada.body).toBe(204);
    expect((await listar(analista)).find((m) => m.id === ID_QR)).toBeUndefined();
    const qqSemUso = await apagar(analista, ID_QQ);
    expect(qqSemUso.statusCode, qqSemUso.body).toBe(204);
  });

  it('RN-AUD-01: as escritas de medida gravam auditoria no tenant de quem fez (sem dado pessoal no payload)', async () => {
    const r = await api.admin.query<{ acao: string; tenant_id: string }>(
      "select acao, tenant_id from plataforma.auditoria where acao like 'medida.%' or acao = 'produto.editar_medida' order by created_at",
    );
    const deA = r.rows.filter((x) => x.tenant_id === A.tenantId).map((x) => x.acao);
    expect(deA).toEqual(expect.arrayContaining(['medida.criar', 'medida.inativar', 'medida.apagar', 'produto.editar_medida']));
    // perfis errados (403) não deixaram rastro de escrita: nenhuma auditoria de 'ZZ'
    const zz = await api.admin.query("select count(*)::int n from plataforma.auditoria where acao like 'medida.%' and depois::text like '%\"ZZ\"%'");
    expect(zz.rows[0].n).toBe(0);
  });
});
