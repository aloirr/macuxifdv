/**
 * T-0003 C3.3 + T-0015 (O-3) — promotor × pedido pela API REAL (RN-PRO-01; doc 03 §2 "Ver pedidos": promotor =
 * carteira, leitura; esclarecimento O-3 abaixo da matriz). Cenários S0-063, S0-064 e S0-065.
 *
 * Regra validada:
 * - SEM o Vendedor (licença da fixture): toda rota de pedido, inclusive a leitura, dá 403 (`MODULO_INATIVO`).
 * - COM o Vendedor no perfil do promotor (pior caso, S0-064): LEITURA na carteira 200 (lista e detalhe), fora da
 *   carteira 404 `PEDIDO_NAO_ENCONTRADO` (inclusive pedido de outro tenant); toda ESCRITA 403 `PERFIL_SEM_ACESSO`,
 *   mesmo sobre pedido da própria carteira, e nada muda no banco.
 * Rotas REAIS montadas pelo createApp; a varredura lê `modulos[].rotas` (as que vierem entram sozinhas) e separa
 * leitura de escrita pela mesma regra do SDK (`promotorBarradoNaRota`).
 * Pedidos: `vendedor.pedido` vem da migração 0007 do banco-dados; se o banco efêmero ainda não a tiver, o teste cria
 * uma tabela mínima equivalente SÓ no banco efêmero deste arquivo (nada em db/).
 * O lado UI (shell/extensões/telas) está em tests/modulos/promotor-sem-pedido.test.ts.
 */
import { semBanco } from '@macuxi/db/teste/estado';
import { ehAcaoDeLeituraDePedido, ehAcaoDePedido, ehCaminhoDePedido, promotorBarradoNaRota, type RotaModulo } from '@macuxi/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A, B, erroDe, ids, licenca, subirApi, type ApiDeTeste } from '../apoio/api';

const UM_UUID = '0e000000-0000-4000-8000-000000000001';
/** Pedidos do teste: c1 está na carteira do promotor de A; c2 não; o de B é de outro tenant. */
const PED = {
  c1: '0e000000-0000-4000-8000-0000000000c1',
  c2: '0e000000-0000-4000-8000-0000000000c2',
  b: '0e000000-0000-4000-8000-0000000000b1',
};

const TABELA_MINIMA = `
  create schema if not exists vendedor;
  grant usage on schema vendedor to macuxi_app;
  create table if not exists vendedor.pedido (
    id uuid primary key, tenant_id uuid not null references plataforma.tenant (id), cliente_id uuid not null,
    vendedor_id uuid not null, autor_id uuid not null, status text not null default 'draft', motivo_cancelamento text,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    deleted_at timestamptz, external_id text);
  alter table vendedor.pedido enable row level security;
  alter table vendedor.pedido force row level security;
  create policy isolamento_tenant on vendedor.pedido for all to macuxi_app
    using (tenant_id = plataforma.tenant_atual()) with check (tenant_id = plataforma.tenant_atual());
  grant select, insert, update, delete on vendedor.pedido to macuxi_app;`;

describe.skipIf(semBanco())('T-0003 C3.3 / T-0015 O-3 — promotor lê pedidos da carteira e nunca escreve (RN-PRO-01, Postgres)', () => {
  let api: ApiDeTeste;
  let admin: string;
  let promotor: string;

  const rotasDePedido = () =>
    api.modulos.flatMap((m) =>
      (m.rotas ?? []).filter((r) => ehCaminhoDePedido(r.caminho) || (!!r.acao && ehAcaoDePedido(r.acao))).map((r) => ({ modulo: m.manifesto.id, r })),
    );
  const ehLeitura = (r: RotaModulo) => !promotorBarradoNaRota(r);
  const url = (modulo: string, r: RotaModulo, id = UM_UUID) => `/v1/${modulo}/${r.caminho.replace(/:[a-zA-Z_]+/g, id)}`;
  const chamarRota = (token: string, modulo: string, r: RotaModulo, id?: string) =>
    api.chamar(token, { method: r.metodo, url: url(modulo, r, id), ...(r.metodo === 'GET' ? {} : { payload: { motivo: 'teste' } }) });

  const estadoDosPedidos = async () => {
    const c = await api.admin.connect();
    try {
      const r = await c.query<{ id: string; status: string; motivo_cancelamento: string | null; updated_at: Date }>(
        'select id, status, motivo_cancelamento, updated_at from vendedor.pedido where id = any($1::uuid[]) order by id',
        [Object.values(PED)],
      );
      return r.rows;
    } finally {
      c.release();
    }
  };

  beforeAll(async () => {
    api = await subirApi();
    admin = (await api.sessao('admin@exemplo.com.br')).access_token;
    const s = await api.sessao('promotor@exemplo.com.br');
    expect(s.usuario.perfil).toBe('promotor');
    promotor = s.access_token;
    const c = await api.admin.connect();
    try {
      const existe = await c.query<{ t: string | null }>("select to_regclass('vendedor.pedido')::text t");
      if (!existe.rows[0]!.t) await c.query(TABELA_MINIMA);
      const ins = 'insert into vendedor.pedido (id, tenant_id, cliente_id, vendedor_id, autor_id, status) values ($1, $2, $3, $4, $4, $5)';
      await c.query(ins, [PED.c1, A.tenantId, A.clientes.c1, A.usuarios.vendedor1, 'received']);
      await c.query(ins, [PED.c2, A.tenantId, A.clientes.c2, A.usuarios.vendedor2, 'received']);
      await c.query(ins, [PED.b, B.tenantId, B.clientes.c1, B.usuarios.vendedor, 'received']);
    } finally {
      c.release();
    }
  });
  afterAll(async () => {
    await api?.fechar();
  });

  it('a varredura encontrou rotas de leitura (pedido.ver) e de escrita de pedido', () => {
    const lista = rotasDePedido();
    expect(lista.filter(({ r }) => ehLeitura(r)).map(({ r }) => `${r.metodo} ${r.caminho}`)).toEqual(expect.arrayContaining(['GET pedidos', 'GET pedidos/:id']));
    expect(lista.filter(({ r }) => ehLeitura(r)).every(({ r }) => r.metodo === 'GET' && ehAcaoDeLeituraDePedido(r.acao!))).toBe(true);
    expect(lista.filter(({ r }) => !ehLeitura(r)).length).toBeGreaterThan(0);
  });

  it('S0-063: SEM o Vendedor (licença da fixture), toda rota de pedido recusa o promotor — leitura 403 MODULO_INATIVO, escrita 403', async () => {
    expect(ids(await api.meusModulos(promotor))).toEqual(['core', 'promotor']);
    for (const { modulo, r } of rotasDePedido()) {
      const resp = await chamarRota(promotor, modulo, r, PED.c1);
      expect(resp.statusCode, `${r.metodo} ${r.caminho}`).toBe(403);
      const aceitos = ehLeitura(r) ? ['MODULO_INATIVO'] : ['MODULO_INATIVO', 'PERFIL_SEM_ACESSO'];
      expect(aceitos, `${r.metodo} ${r.caminho}`).toContain(erroDe(resp).codigo);
    }
  });

  describe('S0-064: COM o Vendedor e o Catálogo no perfil do promotor (pior caso; RN-PRO-01 é "nunca escreve")', () => {
    beforeAll(async () => {
      expect((await licenca(api, admin, 'perfil', 'catalogo', true, 'promotor')).statusCode).toBe(200);
      expect((await licenca(api, admin, 'perfil', 'vendedor', true, 'promotor')).statusCode).toBe(200);
      expect(ids(await api.meusModulos(promotor))).toEqual(expect.arrayContaining(['vendedor']));
    });
    afterAll(async () => {
      expect((await licenca(api, admin, 'perfil', 'vendedor', false, 'promotor')).statusCode).toBe(200);
      expect((await licenca(api, admin, 'perfil', 'catalogo', false, 'promotor')).statusCode).toBe(200);
    });

    it('O-3 leitura na carteira: GET pedidos 200 só com pedidos de clientes da carteira (c1); filtro por cliente (customer_id, T-0029) fora dela vem vazio', async () => {
      const r = await api.chamar(promotor, { method: 'GET', url: '/v1/vendedor/pedidos' });
      expect(r.statusCode, r.body).toBe(200);
      const itens = r.json().itens as { id: string; customer_id: string }[];
      expect(itens.map((i) => i.id)).toContain(PED.c1);
      expect(itens.map((i) => i.id)).not.toContain(PED.c2);
      expect(itens.map((i) => i.id)).not.toContain(PED.b);
      expect(itens.every((i) => i.customer_id === A.clientes.c1)).toBe(true);
      const fora = await api.chamar(promotor, { method: 'GET', url: `/v1/vendedor/pedidos?customer_id=${A.clientes.c2}` });
      expect([fora.statusCode, fora.json().itens]).toEqual([200, []]);
    });

    it('O-3 leitura: GET pedidos/:id da carteira 200; fora da carteira 404 PEDIDO_NAO_ENCONTRADO; de outro tenant 404', async () => {
      const dentro = await api.chamar(promotor, { method: 'GET', url: `/v1/vendedor/pedidos/${PED.c1}` });
      expect(dentro.statusCode, dentro.body).toBe(200);
      expect(dentro.json()).toMatchObject({ id: PED.c1, customer_id: A.clientes.c1, status: 'received' });
      for (const id of [PED.c2, PED.b, UM_UUID]) {
        const r = await api.chamar(promotor, { method: 'GET', url: `/v1/vendedor/pedidos/${id}` });
        expect([r.statusCode, erroDe(r).codigo], id).toEqual([404, 'PEDIDO_NAO_ENCONTRADO']);
      }
    });

    it('RN-PRO-01: toda rota de ESCRITA de pedido dá 403 PERFIL_SEM_ACESSO, até sobre pedido da própria carteira; nada muda no banco', async () => {
      const antes = await estadoDosPedidos();
      expect(antes).toHaveLength(3);
      const escrita = rotasDePedido().filter(({ r }) => !ehLeitura(r));
      expect(escrita.length).toBeGreaterThan(0);
      for (const { modulo, r } of escrita) {
        for (const id of [PED.c1, PED.c2]) {
          const resp = await chamarRota(promotor, modulo, r, id);
          expect([resp.statusCode, erroDe(resp).codigo], `${r.metodo} ${r.caminho} ${id}`).toEqual([403, 'PERFIL_SEM_ACESSO']);
        }
      }
      expect(await estadoDosPedidos()).toEqual(antes);
      const c = await api.admin.connect();
      try {
        const ev = await c.query("select count(*)::int n from plataforma.evento where nome like 'vendedor.pedido.%'");
        expect(ev.rows[0].n).toBe(0);
      } finally {
        c.release();
      }
    });

    it('contraprova: o vendedor passa da checagem de perfil na mesma rota de escrita (para no Zod com id inválido)', async () => {
      const v = (await api.sessao('vendedor@exemplo.com.br')).access_token;
      expect((await api.chamar(v, { method: 'POST', url: '/v1/vendedor/pedidos/x/cancelar', payload: {} })).statusCode).toBe(400);
    });

    it('S0-065 com o Vendedor: push de pedido/pedido_item/pedido_evento pelo promotor é rejeitado por item com RN-PRO-01', async () => {
      const itens = ['pedido', 'pedido_item', 'pedido_evento'].map((entidade, i) => ({
        entidade,
        id: `0e000000-0000-4000-8000-00000000020${i}`,
        operacao: 'upsert' as const,
        payload: { id: `0e000000-0000-4000-8000-00000000020${i}`, cliente_id: A.clientes.c1 },
      }));
      const r = await api.chamar(promotor, { method: 'POST', url: '/v1/sync/push', payload: { itens } });
      expect(r.statusCode, r.body).toBe(200);
      const resultados = r.json().resultados as { status: string; codigo?: string }[];
      expect(resultados.map((x) => [x.status, x.codigo])).toEqual(itens.map(() => ['rejeitado', 'RN-PRO-01']));
    });
  });

  it('S0-065 sem o Vendedor: push de pedido pelo promotor é rejeitado por item (MODULO_INATIVO, D-1); nada gravado', async () => {
    expect(ids(await api.meusModulos(promotor))).toEqual(['core', 'promotor']);
    const itens = ['pedido', 'pedido_item', 'pedido_evento'].map((entidade, i) => ({
      entidade,
      id: `0e000000-0000-4000-8000-00000000010${i}`,
      operacao: 'upsert' as const,
      payload: { id: `0e000000-0000-4000-8000-00000000010${i}`, cliente_id: '00000000-0000-4000-8000-000000000000' },
    }));
    const r = await api.chamar(promotor, { method: 'POST', url: '/v1/sync/push', payload: { itens } });
    expect(r.statusCode, r.body).toBe(200);
    const resultados = r.json().resultados as { status: string; codigo?: string }[];
    expect(resultados.map((x) => [x.status, x.codigo])).toEqual(itens.map(() => ['rejeitado', 'MODULO_INATIVO']));
    const c = await api.admin.connect();
    try {
      const ev = await c.query("select count(*)::int n from plataforma.evento where nome like 'vendedor.pedido.%'");
      expect(ev.rows[0].n).toBe(0);
      const ped = await c.query('select count(*)::int n from vendedor.pedido where id = any($1::uuid[])', [itens.map((i) => i.id)]);
      expect(ped.rows[0].n).toBe(0);
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
