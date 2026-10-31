/**
 * T-0003 C3.1 e C3.2 pela API real (createApp + Core + Postgres como macuxi_app), cenários S0-041..045, S0-049,
 * S0-052..056 do plano (tests/plano/sprint-0.md). O "módulo de teste" da fixture (`teste`) não está instalado
 * (manifesto inexistente: a API o ignora), então o liga/desliga é feito com módulos reais: Promotor (tenant),
 * Vendedor (perfil e usuário) e Catálogo (dependência do Vendedor, RN-CORE-03).
 * Banco efêmero próprio (apoio/api.ts): as alterações de licença não vazam para outros arquivos.
 */
import { ehCaminhoDePedido } from '@macuxi/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { semBanco } from '@macuxi/db/teste/estado';
import { A, B, erroDe, ids, licenca, subirApi, type ApiDeTeste } from '../apoio/api';

const NAO_UUID = 'nao-e-uuid';
const itemChecklist = { entidade: 'checklist_loja', id: '0f000000-0000-4000-8000-000000000001', operacao: 'upsert' as const, payload: {} };

describe.skipIf(semBanco())('T-0003 C3.1/C3.2 — licença de módulo pela API real (Postgres)', () => {
  let api: ApiDeTeste;
  let admin: string;

  beforeAll(async () => {
    api = await subirApi();
    admin = (await api.sessao('admin@exemplo.com.br')).access_token;
  });
  afterAll(async () => {
    await api?.fechar();
  });

  it('S0-041/S0-042: efetivos de partida = tenant ∩ perfil − exceção (core sempre; `teste` não instalado é ignorado)', async () => {
    const quem = {
      vendedor1: 'vendedor@exemplo.com.br',
      vendedor2: 'vendedor2@exemplo.com.br',
      promotor: 'promotor@exemplo.com.br',
      supervisor: 'supervisor@exemplo.com.br',
      admin: 'admin@exemplo.com.br',
      assistente: 'assistente@exemplo.com.br',
    };
    const esperado: Record<keyof typeof quem, string[]> = {
      vendedor1: ['core', 'catalogo', 'vendedor'],
      vendedor2: ['core', 'catalogo', 'vendedor'],
      promotor: ['core', 'promotor'],
      supervisor: ['core', 'catalogo', 'vendedor', 'promotor'],
      admin: ['core'],
      assistente: ['core', 'catalogo', 'vendedor'],
    };
    for (const [k, email] of Object.entries(quem) as [keyof typeof quem, string][]) {
      const s = await api.sessao(email);
      const r = await api.meusModulos(s.access_token);
      expect(ids(r), k).toEqual(esperado[k]);
      expect(r.modulos.every((m) => /^\d+\.\d+\.\d+/.test(m.versao)), k).toBe(true);
    }
    // B: só core, catálogo e vendedor no tenant
    const vb = await api.sessao('vendedor@exemplo.com.br', B);
    expect(ids(await api.meusModulos(vb.access_token))).toEqual(['core', 'catalogo', 'vendedor']);
  });

  it('S0-041/S0-055/S0-056: TENANT desliga o Promotor → o MESMO token já perde o módulo (me/modulos e sync 403 MODULO_INATIVO) → religa e volta', async () => {
    const promotor = (await api.sessao('promotor@exemplo.com.br')).access_token;
    const supervisor = (await api.sessao('supervisor@exemplo.com.br')).access_token;
    const antes = await api.meusModulos(promotor);
    // ativo: o pull de entidade do Promotor passa da licença (sem provedor ainda → 501)
    const pullAtivo = await api.chamar(promotor, { method: 'GET', url: '/v1/sync/pull?entidade=checklist_loja' });
    expect(pullAtivo.statusCode).toBe(501);
    expect(erroDe(pullAtivo).codigo).toBe('SYNC_NAO_IMPLEMENTADO');

    const r = await licenca(api, admin, 'tenant', 'promotor', false);
    expect(r.statusCode, r.body).toBe(200);

    const depois = await api.meusModulos(promotor);
    expect(ids(depois)).toEqual(['core']);
    expect(depois.versao_licencas).not.toBe(antes.versao_licencas);
    expect(ids(await api.meusModulos(supervisor))).toEqual(['core', 'catalogo', 'vendedor']);
    const pull = await api.chamar(promotor, { method: 'GET', url: '/v1/sync/pull?entidade=checklist_loja' });
    expect(pull.statusCode).toBe(403);
    expect(erroDe(pull)).toMatchObject({ codigo: 'MODULO_INATIVO', detalhes: { modulo: 'promotor' } });
    // push de item do módulo desligado: rejeitado por item (nunca aceito nem descartado em silêncio). O código
    // certo (MODULO_INATIVO) está no teste "DEFEITO D-1" abaixo.
    const push = await api.chamar(promotor, { method: 'POST', url: '/v1/sync/push', payload: { itens: [itemChecklist] } });
    expect(push.statusCode, push.body).toBe(200);
    expect(push.json().resultados).toEqual([expect.objectContaining({ id: itemChecklist.id, status: 'rejeitado' })]);

    expect((await licenca(api, admin, 'tenant', 'promotor', true)).statusCode).toBe(200);
    const religado = await api.meusModulos(promotor);
    expect(ids(religado)).toEqual(['core', 'promotor']);
    expect(religado.versao_licencas).toBe(antes.versao_licencas);
  });

  // DEFEITO D-1 (relatório da Sprint 0; recado ao engenheiro-software): entidade do manifesto de um módulo INATIVO
  // que ainda não tem provedor no servidor volta ENTIDADE_DESCONHECIDA, e não MODULO_INATIVO (desenho T-0004 §5;
  // o pull já usa o dono pelo manifesto). No app o item vira "falhou" em vez de "não enviado — módulo desativado"
  // e não volta sozinho para a fila quando o módulo é religado. `it.fails`: quando corrigirem, este teste fica
  // vermelho de propósito — troque por `it`.
  it.fails('DEFEITO D-1 / S0-048: push de entidade de módulo inativo deveria voltar MODULO_INATIVO', async () => {
    const promotor = (await api.sessao('promotor@exemplo.com.br')).access_token;
    expect((await licenca(api, admin, 'tenant', 'promotor', false)).statusCode).toBe(200);
    try {
      const push = await api.chamar(promotor, { method: 'POST', url: '/v1/sync/push', payload: { itens: [itemChecklist] } });
      expect(push.json().resultados).toEqual([expect.objectContaining({ id: itemChecklist.id, status: 'rejeitado', codigo: 'MODULO_INATIVO' })]);
    } finally {
      expect((await licenca(api, admin, 'tenant', 'promotor', true)).statusCode).toBe(200);
    }
  });

  it('S0-042/S0-053/S0-055: PERFIL vendedor sem o Vendedor → vendedores perdem, supervisor mantém; rota real dá 403 MODULO_INATIVO no mesmo token', async () => {
    const v1 = (await api.sessao('vendedor@exemplo.com.br')).access_token;
    const sup = (await api.sessao('supervisor@exemplo.com.br')).access_token;
    const url = `/v1/vendedor/pedidos/${NAO_UUID}/cancelar`;
    // ativo: passa licença e perfil e para no Zod (400) — prova a ordem sem tocar a tabela de pedido
    expect((await api.chamar(v1, { method: 'POST', url, payload: {} })).statusCode).toBe(400);

    expect((await licenca(api, admin, 'perfil', 'vendedor', false, 'vendedor')).statusCode).toBe(200);
    expect(ids(await api.meusModulos(v1))).toEqual(['core', 'catalogo']);
    expect(ids(await api.meusModulos(sup))).toContain('vendedor');
    const negado = await api.chamar(v1, { method: 'POST', url, payload: {} });
    expect(negado.statusCode).toBe(403);
    expect(erroDe(negado)).toMatchObject({ codigo: 'MODULO_INATIVO', detalhes: { modulo: 'vendedor' } });
    expect((await api.chamar(sup, { method: 'POST', url, payload: {} })).statusCode).toBe(400);

    expect((await licenca(api, admin, 'perfil', 'vendedor', true, 'vendedor')).statusCode).toBe(200);
    expect(ids(await api.meusModulos(v1))).toEqual(['core', 'catalogo', 'vendedor']);
  });

  it('S0-042/S0-053: exceção do USUÁRIO remove só dele (vendedor2 perde, vendedor1 mantém); mesmo código MODULO_INATIVO', async () => {
    const v1 = (await api.sessao('vendedor@exemplo.com.br')).access_token;
    const v2 = (await api.sessao('vendedor2@exemplo.com.br')).access_token;
    expect((await licenca(api, admin, 'usuario', 'vendedor', false, A.usuarios.vendedor2)).statusCode).toBe(200);
    expect(ids(await api.meusModulos(v2))).toEqual(['core', 'catalogo']);
    expect(ids(await api.meusModulos(v1))).toEqual(['core', 'catalogo', 'vendedor']);
    const r = await api.chamar(v2, { method: 'POST', url: `/v1/vendedor/pedidos/${NAO_UUID}/cancelar`, payload: {} });
    expect(r.statusCode).toBe(403);
    expect(erroDe(r).codigo).toBe('MODULO_INATIVO');
    expect((await licenca(api, admin, 'usuario', 'vendedor', true, A.usuarios.vendedor2)).statusCode).toBe(200);
    expect(ids(await api.meusModulos(v2))).toEqual(['core', 'catalogo', 'vendedor']);
  });

  it('S0-044 (RN-CORE-03): desligar o Catálogo no tenant derruba o Vendedor de quem depende dele, sem erro; religar devolve os dois', async () => {
    const v1 = (await api.sessao('vendedor@exemplo.com.br')).access_token;
    expect((await licenca(api, admin, 'tenant', 'catalogo', false)).statusCode).toBe(200);
    expect(ids(await api.meusModulos(v1))).toEqual(['core']);
    const r = await api.chamar(v1, { method: 'POST', url: `/v1/vendedor/pedidos/${NAO_UUID}/cancelar`, payload: {} });
    expect(erroDe(r)).toMatchObject({ codigo: 'MODULO_INATIVO', detalhes: { modulo: 'vendedor' } });
    expect((await licenca(api, admin, 'tenant', 'catalogo', true)).statusCode).toBe(200);
    expect(ids(await api.meusModulos(v1))).toEqual(['core', 'catalogo', 'vendedor']);
  });

  it('S0-045 (RN-CORE-01): o Core não desliga em nenhum nível (422) e só o admin altera licença (403 para os outros perfis)', async () => {
    for (const [nivel, alvo] of [['tenant', undefined], ['perfil', 'vendedor'], ['usuario', A.usuarios.vendedor1]] as const) {
      const r = await licenca(api, admin, nivel, 'core', false, alvo);
      expect(r.statusCode, `${nivel}: ${r.body}`).toBe(422);
      expect(erroDe(r).codigo).toBe('RN-CORE-01');
    }
    for (const email of ['analista@exemplo.com.br', 'assistente@exemplo.com.br', 'gerente@exemplo.com.br', 'vendedor@exemplo.com.br']) {
      const t = (await api.sessao(email)).access_token;
      const r = await licenca(api, t, 'tenant', 'promotor', false);
      expect(r.statusCode, email).toBe(403);
      expect(erroDe(r).codigo, email).toBe('PERFIL_SEM_ACESSO');
      const leitura = await api.chamar(t, { method: 'GET', url: '/v1/core/licencas' });
      expect(leitura.statusCode, email).toBe(403);
    }
  });

  it('S0-043 (RN-AUD-01): cada alteração grava auditoria e core.usuario.modulos_alterados@1 na outbox, no tenant do admin', async () => {
    const c = await api.admin.connect();
    try {
      const contar = async () => {
        const ev = await c.query<{ n: string }>("select count(*) n from plataforma.evento where nome = 'core.usuario.modulos_alterados@1' and tenant_id = $1", [A.tenantId]);
        const au = await c.query<{ n: string }>("select count(*) n from plataforma.auditoria where acao = 'licenca.alterar' and tenant_id = $1", [A.tenantId]);
        return { ev: Number(ev.rows[0]!.n), au: Number(au.rows[0]!.n) };
      };
      const antes = await contar();
      expect((await licenca(api, admin, 'usuario', 'vendedor', false, A.usuarios.vendedor1)).statusCode).toBe(200);
      expect((await licenca(api, admin, 'usuario', 'vendedor', true, A.usuarios.vendedor1)).statusCode).toBe(200);
      // repetir o mesmo estado: auditoria sim, evento não (nada mudou)
      expect((await licenca(api, admin, 'usuario', 'vendedor', true, A.usuarios.vendedor1)).statusCode).toBe(200);
      const depois = await contar();
      expect(depois.ev - antes.ev).toBe(2);
      expect(depois.au - antes.au).toBe(3);
      const ultimo = await c.query<{ payload: Record<string, unknown>; usuario_id: string; request_id: string | null; modulo: string }>(
        "select payload, usuario_id, request_id, modulo from plataforma.evento where nome = 'core.usuario.modulos_alterados@1' and tenant_id = $1 order by created_at desc, id desc limit 1",
        [A.tenantId],
      );
      expect(ultimo.rows[0]).toMatchObject({ modulo: 'core', usuario_id: A.usuarios.admin, payload: expect.objectContaining({ nivel: 'usuario', modulo: 'vendedor' }) });
      expect(ultimo.rows[0]!.request_id).toBeTruthy();
    } finally {
      c.release();
    }
  });

  it('S0-049 (RN-CORE-02): desligar não apaga dado na nuvem (contagens de cliente/carteira/produto iguais)', async () => {
    const c = await api.admin.connect();
    try {
      const retrato = async () =>
        (
          await c.query<{ t: string; n: string }>(
            `select 'cliente' t, count(*) n from core.cliente union all select 'carteira', count(*) from core.carteira union all select 'produto', count(*) from core.produto`,
          )
        ).rows;
      const antes = await retrato();
      expect((await licenca(api, admin, 'tenant', 'vendedor', false)).statusCode).toBe(200);
      expect(await retrato()).toEqual(antes);
      expect((await licenca(api, admin, 'tenant', 'vendedor', true)).statusCode).toBe(200);
    } finally {
      c.release();
    }
  });

  it('S0-052/S0-087: varredura — TODA rota montada de módulo não-core responde 403 MODULO_INATIVO a quem não tem o módulo', async () => {
    // admin de A só tem o core: qualquer rota de outro módulo tem de recusar pela licença, antes de perfil e Zod
    const rotas = api.modulos.filter((m) => m.manifesto.id !== 'core').flatMap((m) => (m.rotas ?? []).map((r) => ({ modulo: m.manifesto.id, r })));
    expect(rotas.length).toBeGreaterThan(0);
    for (const { modulo, r } of rotas) {
      const url = `/v1/${modulo}/${r.caminho.replace(/:[a-zA-Z_]+/g, NAO_UUID)}`;
      const resp = await api.chamar(admin, { method: r.metodo, url, ...(r.metodo === 'GET' ? {} : { payload: {} }) });
      expect(resp.statusCode, `${r.metodo} ${url}`).toBe(403);
      expect(erroDe(resp), `${r.metodo} ${url}`).toMatchObject({ codigo: 'MODULO_INATIVO', detalhes: { modulo } });
    }
    // e toda entidade de sync de módulo não efetivo, no pull
    for (const m of api.modulos.filter((x) => x.manifesto.id !== 'core')) {
      for (const entidade of m.manifesto.sync) {
        const p = await api.chamar(admin, { method: 'GET', url: `/v1/sync/pull?entidade=${entidade}` });
        expect(p.statusCode, `pull ${entidade}`).toBe(403);
        expect(erroDe(p).codigo, `pull ${entidade}`).toBe('MODULO_INATIVO');
      }
    }
    // rota de módulo instalado que não existe: 404 (não confunde com licença)
    expect((await api.chamar(admin, { method: 'GET', url: '/v1/vendedor/nao-existe' })).statusCode).toBe(404);
    expect(rotas.some(({ r }) => ehCaminhoDePedido(r.caminho))).toBe(true);
  });

  it('S0-054: precedência 401 → 403 MODULO_INATIVO → 403 PERFIL_SEM_ACESSO → 400 → 404', async () => {
    const url = `/v1/vendedor/pedidos/${NAO_UUID}/cancelar`;
    const sem = await api.chamar(null, { method: 'POST', url, payload: {} });
    expect([sem.statusCode, erroDe(sem).codigo]).toEqual([401, 'NAO_AUTENTICADO']);
    const lixo = await api.chamar('nao.e.um.jwt', { method: 'POST', url, payload: {} });
    expect([lixo.statusCode, erroDe(lixo).codigo]).toEqual([401, 'NAO_AUTENTICADO']);
    const inativo = await api.chamar(admin, { method: 'POST', url, payload: {} });
    expect([inativo.statusCode, erroDe(inativo).codigo]).toEqual([403, 'MODULO_INATIVO']);
    // vendedor ativo, mas a ação do Core é só do admin
    const v1 = (await api.sessao('vendedor@exemplo.com.br')).access_token;
    const perfil = await licenca(api, v1, 'tenant', 'vendedor', false);
    expect([perfil.statusCode, erroDe(perfil).codigo]).toEqual([403, 'PERFIL_SEM_ACESSO']);
    const zod = await api.chamar(v1, { method: 'POST', url, payload: {} });
    expect([zod.statusCode, erroDe(zod).codigo]).toEqual([400, 'VALIDACAO']);
    const naoExiste = await api.chamar(v1, { method: 'GET', url: '/v1/nao-existe' });
    expect(naoExiste.statusCode).toBe(404);
  });

  it('S0-055: licença nunca vai no JWT (payload só sub/tid/perfil/iat/exp)', async () => {
    const s = await api.sessao('vendedor@exemplo.com.br');
    const payload = JSON.parse(Buffer.from(s.access_token.split('.')[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'perfil', 'sub', 'tid']);
    expect(JSON.stringify(payload)).not.toMatch(/vendedor@|catalogo|modulos/);
  });
});

