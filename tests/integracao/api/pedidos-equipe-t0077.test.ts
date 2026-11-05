/**
 * T-0077 critério 4 (e 3 com dados reais) — o que o servidor entrega ao aparelho alimenta a lista de Pedidos e o filtro por
 * vendedor do Gestão: createApp REAL × Postgres (macuxi_app, RLS), fixture dois-tenants, pull `GET /v1/sync/pull`.
 * PRECISA DE BANCO: pula sem Docker (local); no CI (`MACUXI_PG_EXIGIR=1`) roda.
 *
 * Fixture: equipe 1 = supervisor, vendedor-1 e promotor (carteira c1, c3); equipe 2 = vendedor-2 (c2); gerente = regional.
 * Pedidos: p1 (vendedor-1, c1, nº 000003), p3 (vendedor-1, c3, faturado), p2 (vendedor-2, c2, digitado pelo supervisor
 * em nome do vendedor-2); B: p1 do vendedor de B.
 *
 *  E1 supervisor: o seletor de vendedor (opcoesDeVendedor sobre o pull) lista só a equipe 1 (vendedor-1); nunca o
 *     vendedor-2 (outra equipe, mesmo com pedido digitado pelo supervisor), o promotor nem gente de B.
 *  E2 gerente (regional): vendedor-1 e vendedor-2; nada de B.
 *  E3 vendedor-1: só os próprios pedidos (carteira); o vendedor de B só o de B (multi-tenant).
 *  E4 busca sobre os dados reais do pull (razão social da linha `cliente`, número com e sem zeros) e período no fuso do
 *     tenant (A = America/Manaus).
 */
import { semBanco } from '@macuxi/db/teste/estado';
import type { ClienteSync } from '@macuxi/core/contracts';
import { filtrarLista, periodoDe, type PedidoSync } from '@macuxi/vendedor/contracts';
import type { LinhaSync } from '@macuxi/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LINHAS_VAZIAS, listaDeClientes, listaDePedidos } from '../../../modules/vendedor/app/lib/pull';
import { opcoesDeVendedor, TODOS_OS_VENDEDORES } from '../../../modules/vendedor/domain/filtro-vendedor';
import { A, B, subirApi, type ApiDeTeste } from '../apoio/api';
import { esperarHorizonte } from '../apoio/campo';

describe.skipIf(semBanco())('T-0077 — lista de Pedidos e filtro por vendedor sobre o pull real (createApp × Postgres; RN-CORE-04, RN-PRO-01)', () => {
  let api: ApiDeTeste;
  const token: Record<'supervisor' | 'gerente' | 'vendedor1' | 'vendedorB', string> = { supervisor: '', gerente: '', vendedor1: '', vendedorB: '' };

  /** Pull completo da entidade (todas as páginas), como o motor faz. */
  const pullTudo = async <L extends LinhaSync>(t: string, entidade: string): Promise<L[]> => {
    const out: L[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 50; i++) {
      const q = new URLSearchParams({ entidade, ...(cursor ? { cursor } : {}) });
      const r = await api.chamar(t, { method: 'GET', url: `/v1/sync/pull?${q}` });
      expect(r.statusCode, `${entidade}: ${r.body}`).toBe(200);
      const p = r.json() as { itens: L[]; proximo_cursor: string | null };
      out.push(...p.itens);
      cursor = p.proximo_cursor;
      if (!cursor) break;
    }
    return out.filter((l) => !l.deleted_at);
  };

  /** O aparelho de quem entrou: pedidos e clientes do pull, montados como a tela (lib/pull do Vendedor). */
  const aparelho = async (t: string) => {
    const pedidos = await pullTudo<PedidoSync>(t, 'pedido');
    const clientes = await pullTudo<ClienteSync>(t, 'cliente');
    const linhas = { ...LINHAS_VAZIAS, pedidos, clientes };
    return { pedidos, clientes, lista: listaDePedidos(linhas, {}), razaoDe: new Map(listaDeClientes(linhas, { id: 'x', name: 'x' }).map((c) => [c.id, c.legal_name])) };
  };

  beforeAll(async () => {
    api = await subirApi();
    token.supervisor = (await api.sessao('supervisor@exemplo.com.br')).access_token;
    token.gerente = (await api.sessao('gerente@exemplo.com.br')).access_token;
    token.vendedor1 = (await api.sessao('vendedor@exemplo.com.br')).access_token;
    token.vendedorB = (await api.sessao('vendedor@exemplo.com.br', B)).access_token;
    // fixture carregada agora: espera o horizonte seguro do pull (updated_at < now() − 2 s)
    await esperarHorizonte();
  });
  afterAll(async () => {
    await api?.fechar();
  });

  it('E1 supervisor: o seletor lista só a equipe 1 (vendedor-1); nem vendedor-2, nem promotor, nem B', async () => {
    const { lista } = await aparelho(token.supervisor);
    expect(lista.length).toBeGreaterThan(0);
    const opcoes = opcoesDeVendedor(lista).map((o) => o.id);
    expect(opcoes[0]).toBe(TODOS_OS_VENDEDORES);
    expect(opcoes).toContain(A.usuarios.vendedor1);
    const equipe1 = new Set([A.usuarios.supervisor, A.usuarios.vendedor1]);
    for (const id of opcoes.slice(1)) expect(equipe1.has(id), `vendedor ${id} fora da equipe 1`).toBe(true);
    expect(opcoes).not.toContain(A.usuarios.vendedor2);
    expect(opcoes).not.toContain(A.usuarios.promotor);
    expect(opcoes).not.toContain(B.usuarios.vendedor);
    expect(lista.map((p) => p.id)).not.toContain(A.pedidos.p2);
    expect(lista.map((p) => p.id)).not.toContain(B.pedidos.p1);
  });

  it('E2 gerente (regional): vendedor-1 e vendedor-2; nada de B nem promotor', async () => {
    const { lista } = await aparelho(token.gerente);
    const opcoes = opcoesDeVendedor(lista).map((o) => o.id);
    expect(opcoes).toEqual(expect.arrayContaining([TODOS_OS_VENDEDORES, A.usuarios.vendedor1, A.usuarios.vendedor2]));
    expect(opcoes).not.toContain(A.usuarios.promotor);
    expect(opcoes).not.toContain(B.usuarios.vendedor);
  });

  it('E3 vendedor: só os próprios pedidos; o vendedor de B só o de B (mesmo e-mail, outro tenant)', async () => {
    const v1 = await aparelho(token.vendedor1);
    expect(v1.lista.map((p) => p.id).sort()).toEqual([A.pedidos.p1, A.pedidos.p3].sort());
    expect(v1.lista.every((p) => p.seller_id === A.usuarios.vendedor1)).toBe(true);
    const vb = await aparelho(token.vendedorB);
    expect(vb.lista.map((p) => p.id)).toEqual([B.pedidos.p1]);
  });

  it('E4 busca e período sobre o pull real: razão social da linha cliente, nº com e sem zeros, mês no fuso de A', async () => {
    const { lista, razaoDe, clientes } = await aparelho(token.supervisor);
    const itens = lista.map((o) => ({
      id: o.id,
      numero: o.number,
      nome_fantasia: o.customer_name,
      razao_social: razaoDe.get(o.customer_id) ?? '',
      tipo: o.tipo,
      status: o.status,
      local: false,
      total_cents: o.total_cents,
      emitido_em: o.received_at,
      status_alterado_em: o.updated_at || null,
    }));
    const periodo = periodoDe('mes', new Date(), A.fuso);
    const achar = (busca: string) => filtrarLista(itens, { periodo: { tipo: 'ano', valor: '1999' }, busca, tz: A.fuso }).map((i) => i.id);
    // p1 é o nº 000003 do cliente c1
    expect(achar('3')).toContain(A.pedidos.p1);
    expect(achar('000003')).toEqual(achar('3'));
    const c1 = clientes.find((c) => c.id === A.clientes.c1)!;
    expect(c1, 'o supervisor recebe o cliente c1 da equipe').toBeDefined();
    const razaoSemAcento = c1.razao_social.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    expect(achar(razaoSemAcento)).toContain(A.pedidos.p1);
    // sem texto: p1 (emitido hoje no fuso de A) está no mês corrente
    expect(filtrarLista(itens, { periodo, busca: '', tz: A.fuso }).map((i) => i.id)).toContain(A.pedidos.p1);
  });
});
