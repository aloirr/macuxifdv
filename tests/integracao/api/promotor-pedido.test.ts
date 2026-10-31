/**
 * T-0003 C3.3 "promotor não vê nenhuma ação de pedido" — lado API (RN-PRO-01), cenários S0-063, S0-064 e S0-065.
 * Rotas REAIS montadas pelo createApp (as que existem hoje e as que vierem: a varredura lê `modulos[].rotas`).
 * S0-064 é o pior caso: o admin coloca o Vendedor (e o Catálogo) no PERFIL do promotor; mesmo assim nenhuma rota
 * de pedido passa (RN-PRO-01 é "nunca", independe de licença).
 * O lado UI (shell/extensões/telas) está em tests/modulos/promotor-sem-pedido.test.ts.
 */
import { semBanco } from '@macuxi/db/teste/estado';
import { ehAcaoDePedido, ehCaminhoDePedido } from '@macuxi/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { erroDe, ids, licenca, subirApi, type ApiDeTeste } from '../apoio/api';

const UM_UUID = '0e000000-0000-4000-8000-000000000001';

describe.skipIf(semBanco())('T-0003 C3.3 — promotor sem nenhuma ação de pedido na API (RN-PRO-01, Postgres)', () => {
  let api: ApiDeTeste;
  let admin: string;
  let promotor: string;

  const rotasDePedido = () =>
    api.modulos.flatMap((m) =>
      (m.rotas ?? []).filter((r) => ehCaminhoDePedido(r.caminho) || (!!r.acao && ehAcaoDePedido(r.acao))).map((r) => ({ modulo: m.manifesto.id, r })),
    );

  const varrer = async (codigosAceitos: string[]) => {
    const lista = rotasDePedido();
    expect(lista.length).toBeGreaterThan(0);
    for (const { modulo, r } of lista) {
      const url = `/v1/${modulo}/${r.caminho.replace(/:[a-zA-Z_]+/g, UM_UUID)}`;
      const resp = await api.chamar(promotor, { method: r.metodo, url, ...(r.metodo === 'GET' ? {} : { payload: { motivo: 'teste' } }) });
      expect(resp.statusCode, `${r.metodo} ${url}`).toBe(403);
      expect(codigosAceitos, `${r.metodo} ${url}`).toContain(erroDe(resp).codigo);
    }
  };

  beforeAll(async () => {
    api = await subirApi();
    admin = (await api.sessao('admin@exemplo.com.br')).access_token;
    const s = await api.sessao('promotor@exemplo.com.br');
    expect(s.usuario.perfil).toBe('promotor');
    promotor = s.access_token;
  });
  afterAll(async () => {
    await api?.fechar();
  });

  it('S0-063: com a licença da fixture, toda rota de pedido montada recusa o promotor (403)', async () => {
    expect(ids(await api.meusModulos(promotor))).toEqual(['core', 'promotor']);
    await varrer(['MODULO_INATIVO', 'PERFIL_SEM_ACESSO']);
  });

  it('S0-064: mesmo com Vendedor e Catálogo no perfil do promotor, toda rota de pedido dá 403 PERFIL_SEM_ACESSO', async () => {
    expect((await licenca(api, admin, 'perfil', 'catalogo', true, 'promotor')).statusCode).toBe(200);
    expect((await licenca(api, admin, 'perfil', 'vendedor', true, 'promotor')).statusCode).toBe(200);
    try {
      // a licença o deixa "com" o Vendedor; a regra RN-PRO-01 continua valendo
      expect(ids(await api.meusModulos(promotor))).toEqual(expect.arrayContaining(['vendedor']));
      await varrer(['PERFIL_SEM_ACESSO']);
      // contraprova: o vendedor passa da checagem de perfil na mesma rota (para no Zod com id inválido)
      const v = (await api.sessao('vendedor@exemplo.com.br')).access_token;
      expect((await api.chamar(v, { method: 'POST', url: '/v1/vendedor/pedidos/x/cancelar', payload: {} })).statusCode).toBe(400);
    } finally {
      expect((await licenca(api, admin, 'perfil', 'vendedor', false, 'promotor')).statusCode).toBe(200);
      expect((await licenca(api, admin, 'perfil', 'catalogo', false, 'promotor')).statusCode).toBe(200);
    }
  });

  it('S0-065: push de pedido vindo do promotor nunca é aceito (rejeitado por item; nada gravado)', async () => {
    const itens = ['pedido', 'pedido_item', 'pedido_evento'].map((entidade, i) => ({
      entidade,
      id: `0e000000-0000-4000-8000-00000000010${i}`,
      operacao: 'upsert' as const,
      payload: { id: `0e000000-0000-4000-8000-00000000010${i}`, cliente_id: '00000000-0000-4000-8000-000000000000' },
    }));
    const r = await api.chamar(promotor, { method: 'POST', url: '/v1/sync/push', payload: { itens } });
    expect(r.statusCode, r.body).toBe(200);
    const resultados = r.json().resultados as { status: string; codigo?: string }[];
    expect(resultados).toHaveLength(3);
    for (const x of resultados) {
      expect(x.status).toBe('rejeitado');
      expect(x.codigo).toBeTruthy();
    }
    const c = await api.admin.connect();
    try {
      const ev = await c.query("select count(*)::int n from plataforma.evento where nome like 'vendedor.pedido.%'");
      expect(ev.rows[0].n).toBe(0);
    } finally {
      c.release();
    }
  });

  it('promotor também não administra licenças (ação só do admin) nem lê o estado delas', async () => {
    const r = await licenca(api, promotor, 'perfil', 'vendedor', true, 'promotor');
    expect([r.statusCode, erroDe(r).codigo]).toEqual([403, 'PERFIL_SEM_ACESSO']);
    expect((await api.chamar(promotor, { method: 'GET', url: '/v1/core/licencas' })).statusCode).toBe(403);
  });
});
