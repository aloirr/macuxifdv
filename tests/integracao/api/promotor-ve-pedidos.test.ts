/**
 * T-0061 (pedido do dono do produto R-20261102-204544, item 3) — e2e de permissões da opção `promotor_ve_pedidos`
 * do perfil Promotor (Core, #65), com a consulta REAL `core.promotor_ve_pedidos@1` (nenhum leitor trocado:
 * `modules/vendedor/api/opcao-promotor.ts` usa o padrão, que chama `tx.consultar` do createApp), createApp real × Postgres.
 *
 * - LIGADA (padrão de fábrica, sem registro): o promotor lê lista, detalhe e pull (pedido, pedido_item) SÓ da carteira;
 *   403 em criar, editar, duplicar e excluir (push → rejeitado RN-PRO-01; o pedido nasce/muda/some só pelo sync) e em
 *   cancelar, aprovar e rejeitar (REST → 403 PERFIL_SEM_ACESSO). RN-PRO-01, regra 7 do CLAUDE.md.
 * - DESLIGADA pelo admin no BKO (PUT /v1/core/parametros/promotor-ve-pedidos, auditado antes/depois, idempotente):
 *   403 RN-PRO-01 em lista e detalhe, pull de pedido/pedido_item/pedido_evento vazio; escrita segue 403; os outros
 *   perfis não mudam; religar devolve a leitura na requisição seguinte (sem cache).
 * - Outro tenant: a opção é por tenant (RLS em plataforma.parametro); desligar em A não muda B e vice-versa.
 */
import { semBanco } from '@macuxi/db/teste/estado';
import { ehAcaoDePedido, ehCaminhoDePedido, promotorBarradoNaRota, type RotaModulo } from '@macuxi/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A, B, erroDe, ids, licenca, subirApi, type ApiDeTeste } from '../apoio/api';

/** c1 está na carteira do promotor de A; c2 não; b1 é do tenant B. */
const PED = {
  c1: '0f000000-0000-4000-8000-0000000000c1',
  c2: '0f000000-0000-4000-8000-0000000000c2',
  b1: '0f000000-0000-4000-8000-0000000000b1',
};
const ITEM_C1 = '0f000000-0000-4000-8000-0000000001c1';
const ITEM_C2 = '0f000000-0000-4000-8000-0000000001c2';
const URL_OPCAO = '/v1/core/parametros/promotor-ve-pedidos';

describe.skipIf(semBanco())('T-0061 — opção promotor_ve_pedidos pela consulta real do Core (createApp × Postgres; RN-PRO-01, regra 7)', () => {
  let api: ApiDeTeste;
  let adminA: string;
  let adminB: string;
  let promotor: string;
  let vendedor1: string;
  let vendedorB: string;

  const opcao = (token: string, ligado?: boolean) =>
    ligado === undefined ? api.chamar(token, { method: 'GET', url: URL_OPCAO }) : api.chamar(token, { method: 'PUT', url: URL_OPCAO, payload: { ligado } });

  const pull = async (token: string, entidade: string) => {
    const r = await api.chamar(token, { method: 'GET', url: `/v1/sync/pull?entidade=${entidade}` });
    expect(r.statusCode, `${entidade}: ${r.body}`).toBe(200);
    return (r.json().itens as Array<{ id: string; pedido_id?: string }>).map((x) => x.id);
  };

  const rotasDeEscrita = () =>
    api.modulos.flatMap((m) =>
      (m.rotas ?? [])
        .filter((r) => (ehCaminhoDePedido(r.caminho) || (!!r.acao && ehAcaoDePedido(r.acao))) && promotorBarradoNaRota(r))
        .map((r) => ({ modulo: m.manifesto.id, r })),
    );
  const url = (modulo: string, r: RotaModulo, id: string) => `/v1/${modulo}/${r.caminho.replace(/:[a-zA-Z_]+/g, id)}`;

  const estadoDosPedidos = async () => {
    const c = await api.admin.connect();
    try {
      const p = await c.query('select id, status, motivo_cancelamento, updated_at, deleted_at from vendedor.pedido where id = any($1::uuid[]) order by id', [Object.values(PED)]);
      const i = await c.query('select id, quantidade, updated_at, deleted_at from vendedor.pedido_item where id = any($1::uuid[]) order by id', [[ITEM_C1, ITEM_C2]]);
      const ev = await c.query("select count(*)::int n from plataforma.evento where nome like 'vendedor.pedido.%'");
      return { pedidos: p.rows, itens: i.rows, eventos: ev.rows[0].n as number };
    } finally {
      c.release();
    }
  };

  const auditoriasDaOpcao = async (tenantId: string) => {
    const c = await api.admin.connect();
    try {
      const r = await c.query<{ usuario_id: string; antes: unknown; depois: unknown }>(
        "select usuario_id, antes, depois from plataforma.auditoria where tenant_id = $1 and acao = 'parametro.promotor_ve_pedidos' order by created_at, id",
        [tenantId],
      );
      return r.rows;
    } finally {
      c.release();
    }
  };

  /** Escrita do promotor: REST (cancelar/aprovar/rejeitar e qualquer rota de escrita que vier) e push (criar/editar/duplicar/excluir). */
  const provarEscritaNegada = async () => {
    const antes = await estadoDosPedidos();
    const meus = new Set(ids(await api.meusModulos(promotor)));
    const rest = rotasDeEscrita();
    const caminhos = rest.map(({ r }) => `${r.metodo} ${r.caminho}`);
    expect(caminhos).toEqual(expect.arrayContaining(['POST pedidos/:id/cancelar', 'POST pedidos/:id/aprovar', 'POST pedidos/:id/rejeitar']));
    for (const { modulo, r } of rest) {
      const esperado = meus.has(modulo) ? 'PERFIL_SEM_ACESSO' : 'MODULO_INATIVO';
      for (const id of [PED.c1, PED.c2]) {
        const resp = await api.chamar(promotor, { method: r.metodo, url: url(modulo, r, id), ...(r.metodo === 'GET' ? {} : { payload: { motivo: 'teste' } }) });
        expect([resp.statusCode, erroDe(resp).codigo], `${modulo}: ${r.metodo} ${r.caminho} ${id}`).toEqual([403, esperado]);
      }
    }
    const novo = '0f000000-0000-4000-8000-000000000301';
    const duplicado = '0f000000-0000-4000-8000-000000000302';
    const itens = [
      { caso: 'criar', entidade: 'pedido', id: novo, operacao: 'upsert', payload: { id: novo, cliente_id: A.clientes.c1, itens: [] } },
      { caso: 'editar', entidade: 'pedido', id: PED.c1, operacao: 'upsert', payload: { id: PED.c1, cliente_id: A.clientes.c1, observacao: 'editado' } },
      { caso: 'duplicar', entidade: 'pedido', id: duplicado, operacao: 'upsert', payload: { id: duplicado, cliente_id: A.clientes.c1, duplicado_de: PED.c1 } },
      { caso: 'excluir', entidade: 'pedido', id: PED.c1, operacao: 'remover', payload: { id: PED.c1 } },
      { caso: 'editar item', entidade: 'pedido_item', id: ITEM_C1, operacao: 'upsert', payload: { id: ITEM_C1, pedido_id: PED.c1, quantidade: 99 } },
      { caso: 'excluir item', entidade: 'pedido_item', id: ITEM_C1, operacao: 'remover', payload: { id: ITEM_C1 } },
    ];
    const r = await api.chamar(promotor, { method: 'POST', url: '/v1/sync/push', payload: { itens: itens.map(({ caso: _c, ...x }) => x) } });
    expect(r.statusCode, r.body).toBe(200);
    const res = r.json().resultados as Array<{ status: string; codigo?: string }>;
    expect(res.map((x, i) => [itens[i]!.caso, x.status, x.codigo])).toEqual(itens.map((x) => [x.caso, 'rejeitado', 'RN-PRO-01']));
    expect(await estadoDosPedidos(), 'nada muda no banco (pedido, item, outbox)').toEqual(antes);
  };

  beforeAll(async () => {
    api = await subirApi();
    adminA = (await api.sessao('admin@exemplo.com.br')).access_token;
    adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
    const sp = await api.sessao('promotor@exemplo.com.br');
    expect(sp.usuario.perfil).toBe('promotor');
    promotor = sp.access_token;
    vendedor1 = (await api.sessao('vendedor@exemplo.com.br')).access_token;
    vendedorB = (await api.sessao('vendedor@exemplo.com.br', B)).access_token;
    const c = await api.admin.connect();
    try {
      // Fixture nasce ANTES do horizonte seguro do pull (`updated_at < now() − 2 s`, apps/api/src/banco.ts, desenho T-0004 §5):
      // no runner do CI o arquivo inteiro roda em ~1,5 s, e um pedido com updated_at = now() ainda não sai no pull.
      // Retroagir created_at/updated_at 1 h (também abaixo de transação aberta de outro arquivo, que entra no horizonte;
      // a janela de 90 dias segue cobrindo) deixa o pull determinístico sem espera.
      const ins =
        "insert into vendedor.pedido (id, tenant_id, cliente_id, vendedor_id, autor_id, status, created_at, updated_at) values ($1, $2, $3, $4, $4, $5, now() - interval '1 hour', now() - interval '1 hour')";
      await c.query(ins, [PED.c1, A.tenantId, A.clientes.c1, A.usuarios.vendedor1, 'received']);
      await c.query(ins, [PED.c2, A.tenantId, A.clientes.c2, A.usuarios.vendedor2, 'received']);
      await c.query(ins, [PED.b1, B.tenantId, B.clientes.c1, B.usuarios.vendedor, 'received']);
      const item =
        "insert into vendedor.pedido_item (id, tenant_id, pedido_id, sequencia, produto_id, quantidade, preco_tabela_cents, preco_unitario_cents, total_cents, created_at, updated_at) values ($1, $2, $3, 1, $4, 2, 1000, 1000, 2000, now() - interval '1 hour', now() - interval '1 hour')";
      await c.query(item, [ITEM_C1, A.tenantId, PED.c1, A.produtos.p1]);
      await c.query(item, [ITEM_C2, A.tenantId, PED.c2, A.produtos.p1]);
    } finally {
      c.release();
    }
    // Pior caso da regra 7: o perfil Promotor com o Vendedor (e o Catálogo, dependência) licenciado.
    expect((await licenca(api, adminA, 'perfil', 'catalogo', true, 'promotor')).statusCode).toBe(200);
    expect((await licenca(api, adminA, 'perfil', 'vendedor', true, 'promotor')).statusCode).toBe(200);
    expect(ids(await api.meusModulos(promotor))).toEqual(expect.arrayContaining(['vendedor']));
  });
  afterAll(async () => {
    await api?.fechar();
  });

  describe('LIGADA (padrão de fábrica, nenhum registro em plataforma.parametro)', () => {
    it('GET da opção pelo admin de A e de B: ligado = true; o promotor não lê nem muda a opção (403 PERFIL_SEM_ACESSO)', async () => {
      for (const t of [adminA, adminB]) {
        const r = await opcao(t);
        expect([r.statusCode, r.json()], r.body).toEqual([200, { ligado: true }]);
      }
      for (const r of [await opcao(promotor), await opcao(promotor, false), await opcao(vendedor1, false)]) {
        expect([r.statusCode, erroDe(r).codigo], r.body).toEqual([403, 'PERFIL_SEM_ACESSO']);
      }
      expect(await auditoriasDaOpcao(A.tenantId)).toEqual([]);
    });

    it('lista: só pedidos da carteira (c1); c2 e o de B ficam de fora', async () => {
      const r = await api.chamar(promotor, { method: 'GET', url: '/v1/vendedor/pedidos' });
      expect(r.statusCode, r.body).toBe(200);
      const itens = r.json().itens as Array<{ id: string; customer_id: string }>;
      expect(itens.map((i) => i.id)).toContain(PED.c1);
      expect(itens.map((i) => i.id)).not.toContain(PED.c2);
      expect(itens.map((i) => i.id)).not.toContain(PED.b1);
      expect(itens.every((i) => i.customer_id === A.clientes.c1)).toBe(true);
    });

    it('detalhe: c1 200; c2 (fora da carteira) e o de B 404 PEDIDO_NAO_ENCONTRADO', async () => {
      const dentro = await api.chamar(promotor, { method: 'GET', url: `/v1/vendedor/pedidos/${PED.c1}` });
      expect(dentro.statusCode, dentro.body).toBe(200);
      expect(dentro.json()).toMatchObject({ id: PED.c1, customer_id: A.clientes.c1 });
      for (const id of [PED.c2, PED.b1]) {
        const r = await api.chamar(promotor, { method: 'GET', url: `/v1/vendedor/pedidos/${id}` });
        expect([r.statusCode, erroDe(r).codigo], id).toEqual([404, 'PEDIDO_NAO_ENCONTRADO']);
      }
    });

    it('pull: pedido e pedido_item só da carteira (c1 e o item de c1)', async () => {
      const ped = await pull(promotor, 'pedido');
      expect(ped).toContain(PED.c1);
      expect(ped).not.toContain(PED.c2);
      expect(ped).not.toContain(PED.b1);
      const itensPull = await pull(promotor, 'pedido_item');
      expect(itensPull).toContain(ITEM_C1);
      expect(itensPull).not.toContain(ITEM_C2);
    });

    it('RN-PRO-01: criar, editar, duplicar, excluir (push), cancelar, aprovar e rejeitar (REST) → 403/rejeitado; nada muda no banco', async () => {
      await provarEscritaNegada();
    });
  });

  describe('DESLIGADA pelo admin de A no BKO (rota do Core, auditada)', () => {
    beforeAll(async () => {
      const r = await opcao(adminA, false);
      expect([r.statusCode, r.json()], r.body).toEqual([200, { ligado: false }]);
    });

    it('auditoria: uma linha do admin de A (antes true → depois false); repetir o PUT é idempotente e não audita de novo', async () => {
      const esperado = [{ usuario_id: A.usuarios.admin, antes: { promotor_ve_pedidos: true }, depois: { promotor_ve_pedidos: false } }];
      expect(await auditoriasDaOpcao(A.tenantId)).toEqual(esperado);
      const de_novo = await opcao(adminA, false);
      expect([de_novo.statusCode, de_novo.json()]).toEqual([200, { ligado: false }]);
      expect(await auditoriasDaOpcao(A.tenantId)).toEqual(esperado);
      expect((await opcao(adminA)).json()).toEqual({ ligado: false });
    });

    it('lista e detalhe: 403 RN-PRO-01 (inclusive o pedido da própria carteira)', async () => {
      const lista = await api.chamar(promotor, { method: 'GET', url: '/v1/vendedor/pedidos' });
      expect([lista.statusCode, erroDe(lista).codigo], lista.body).toEqual([403, 'RN-PRO-01']);
      for (const id of [PED.c1, PED.c2]) {
        const r = await api.chamar(promotor, { method: 'GET', url: `/v1/vendedor/pedidos/${id}` });
        expect([r.statusCode, erroDe(r).codigo], id).toEqual([403, 'RN-PRO-01']);
      }
    });

    it('pull: nada de pedido, pedido_item nem pedido_evento (200 com lista vazia)', async () => {
      for (const e of ['pedido', 'pedido_item', 'pedido_evento']) expect(await pull(promotor, e), e).toEqual([]);
    });

    it('RN-PRO-01: a escrita segue negada do mesmo jeito (criar, editar, duplicar, excluir, cancelar, aprovar, rejeitar)', async () => {
      await provarEscritaNegada();
    });

    it('só o promotor muda: o vendedor-1 de A segue lendo os próprios pedidos (lista, detalhe e pull)', async () => {
      const r = await api.chamar(vendedor1, { method: 'GET', url: '/v1/vendedor/pedidos' });
      expect(r.statusCode, r.body).toBe(200);
      expect((r.json().itens as Array<{ id: string }>).map((i) => i.id)).toContain(PED.c1);
      expect((await api.chamar(vendedor1, { method: 'GET', url: `/v1/vendedor/pedidos/${PED.c1}` })).statusCode).toBe(200);
      expect(await pull(vendedor1, 'pedido')).toContain(PED.c1);
    });

    it('outro tenant não é afetado: B segue com a opção ligada (GET do admin de B), sem registro nem auditoria em B, e o vendedor de B lê o pedido dele', async () => {
      expect((await opcao(adminB)).json()).toEqual({ ligado: true });
      expect(await auditoriasDaOpcao(B.tenantId)).toEqual([]);
      const c = await api.admin.connect();
      try {
        const p = await c.query("select tenant_id from plataforma.parametro where modulo = 'core' and chave = 'promotor_ve_pedidos' and deleted_at is null");
        expect(p.rows).toEqual([{ tenant_id: A.tenantId }]);
      } finally {
        c.release();
      }
      const r = await api.chamar(vendedorB, { method: 'GET', url: '/v1/vendedor/pedidos' });
      expect(r.statusCode, r.body).toBe(200);
      const vistos = (r.json().itens as Array<{ id: string }>).map((i) => i.id);
      expect(vistos).toContain(PED.b1);
      expect(vistos).not.toContain(PED.c1);
    });
  });

  describe('religar e isolamento no sentido inverso', () => {
    it('B desliga a dele: A (religada pelo admin de A) devolve a leitura da carteira ao promotor na requisição seguinte; B fica desligada só em B', async () => {
      const offB = await opcao(adminB, false);
      expect([offB.statusCode, offB.json()], offB.body).toEqual([200, { ligado: false }]);
      // A ainda desligada: o desligar de B não "liga" nada em A
      expect((await api.chamar(promotor, { method: 'GET', url: '/v1/vendedor/pedidos' })).statusCode).toBe(403);
      const onA = await opcao(adminA, true);
      expect([onA.statusCode, onA.json()], onA.body).toEqual([200, { ligado: true }]);
      expect((await opcao(adminB)).json()).toEqual({ ligado: false });

      const lista = await api.chamar(promotor, { method: 'GET', url: '/v1/vendedor/pedidos' });
      expect(lista.statusCode, lista.body).toBe(200);
      expect((lista.json().itens as Array<{ id: string }>).map((i) => i.id)).toEqual(expect.arrayContaining([PED.c1]));
      expect((await api.chamar(promotor, { method: 'GET', url: `/v1/vendedor/pedidos/${PED.c1}` })).statusCode).toBe(200);
      expect(await pull(promotor, 'pedido')).toContain(PED.c1);

      expect((await auditoriasDaOpcao(A.tenantId)).map((x) => x.depois)).toEqual([{ promotor_ve_pedidos: false }, { promotor_ve_pedidos: true }]);
      expect(await auditoriasDaOpcao(B.tenantId)).toEqual([{ usuario_id: B.usuarios.admin, antes: { promotor_ve_pedidos: true }, depois: { promotor_ve_pedidos: false } }]);
      // a escrita segue negada com a opção religada
      await provarEscritaNegada();
    });
  });
});
