/**
 * T-0187 (v1.0.16) — supervisor em campo no Gestão: o pedido em nome do vendedor, entre módulos, com a API REAL (createApp ×
 * Postgres como macuxi_app × fixture dois-tenants × despachante real da outbox). Desenho: docs/desenho/T-0187.md §1.4, §2 e §4
 * (branch nuvem/v1016-supervisor-engenheiro-software). Matriz: docs/testes/T-0187.md.
 * Regras: RF-GES-05, RN-VEN-35 (em nome; P3 A), RN-VEN-10 (alçada do autor; P4 A), RN-CORE-04 (carteira da equipe),
 * RN-CORE-05 (tenant), RN-PRO-01 (promotor nunca faz pedido; regra 7 do CLAUDE.md).
 *
 * Fixture: equipe 1 = supervisor + vendedor-1 + promotor (carteira de c1 e c3); equipe 2 = vendedor-2 (carteira de c2), as duas
 * abaixo da regional do gerente. B tem um vendedor e o c1 dele.
 *
 * Convenção: `it` = critério que o código do `main` já atende (vermelho = defeito em recado ao dono); `it.runIf(<código entregue>)`
 * = critério que depende de código ainda não entregue (liga sozinho quando o símbolo do dono chegar ao `main`); `it.todo` = critério
 * sem como testar aqui até o dono entregar (o motivo e o dono estão no título).
 *
 * VALOR × REGRA (alçada): o esperado é calculado aqui pela RN-VEN-10, a partir da política lida em `GET /v1/vendedor/alcadas`
 * (nunca copiado do resultado): desconto ≤ alçada do autor = aprovado na hora; acima = aprovação no nível seguinte ao do autor.
 */
import * as dominioVendedor from '../../../modules/vendedor/domain';
import { semBanco } from '@macuxi/db/teste/estado';
import { PAGAMENTO_FIXTURE } from '@macuxi/db/teste';
import type { ResultadoItemPush } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoApp } from '../../../apps/api/src/banco';
import { criarDespachante } from '../../../apps/api/src/despachante';
import { A, B, licenca, poolComEncerramento, subirApi, type ApiDeTeste } from '../apoio/api';

const id = (n: number) => `0f187000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PED = {
  outraEquipe: id(1),
  promotorComoVendedor: id(2),
  vendedorB: id(3),
  inexistente: id(4),
  foraDaCarteira: id(5),
  clienteB: id(6),
  ok: id(7),
  oitoPct: id(8),
  dozePct: id(9),
  promotorAutor: id(10),
  vendedorAutor: id(11),
  saiuDaEquipe: id(12),
  vencido: id(14),
} as const;
const PA = PAGAMENTO_FIXTURE.A;
/** Autor nunca vem do aparelho (desenho §1.4): o payload tenta mentir e a API tem de ignorar. */
const AUTOR_FALSO = A.usuarios.vendedor1;
/** P4 A (desenho §1.4): a função pura nova do modulo-vendedor; enquanto não chega, os casos de nível do autor ficam desligados. */
const TEM_NIVEL_DO_AUTOR = typeof (dominioVendedor as Record<string, unknown>).nivelMinimoDoAutor === 'function';
/** D-187-01 corrigido (modulo-vendedor): o dono que não existe volta VENDEDOR_INVALIDO antes da equipe. Sonda pela função pura. */
const TEM_VENDEDOR_INVALIDO = (() => {
  const f = (dominioVendedor as Record<string, unknown>).verificarPedidoEmNome as ((e: object) => { codigo?: string } | null) | undefined;
  try {
    return f?.({ autor: { id: 'sup', perfil: 'supervisor' }, vendedor_id: 'x', vendedor: null, visiveis: new Set(['sup']) })?.codigo === 'VENDEDOR_INVALIDO';
  } catch {
    return false;
  }
})();
/** P4 A (modulo-vendedor): a decisão do próprio pedido volta 422 APROVACAO_DO_PROPRIO_PEDIDO. */
const TEM_PROPRIO_PEDIDO = typeof (dominioVendedor as Record<string, unknown>).MSG_APROVACAO_DO_PROPRIO_PEDIDO === 'string';

type Linha = Record<string, unknown>;
const codigoDe = (r: ResultadoItemPush | undefined) => (r && 'codigo' in r ? r.codigo : undefined);

describe.skipIf(semBanco())('T-0187 — pedido em nome do vendedor pelo supervisor (createApp real × Postgres × despachante)', () => {
  let api: ApiDeTeste;
  let worker: ReturnType<typeof poolComEncerramento> | null = null;
  const tk = { vendedor: '', promotor: '', supervisor: '', gerente: '', adminA: '' };
  let prodA = '';
  let alcadas = { seller_pct: 0, supervisor_pct: 0, manager_pct: 0 };

  const q = async <T extends pg.QueryResultRow = Linha>(sql: string, p: unknown[] = []) => (await api.admin.query<T>(sql, p)).rows;
  const push = async (token: string, itens: object[]): Promise<ResultadoItemPush[]> => {
    const r = await api.chamar(token, { method: 'POST', url: '/v1/sync/push', payload: { itens } });
    expect(r.statusCode, r.body).toBe(200);
    return (r.json() as { resultados: ResultadoItemPush[] }).resultados;
  };
  /** Pedido à vista (PIX: sem crédito), com o vendedor escolhido em `vendedor_id` e um autor falso no payload. */
  const emNome = (pid: string, e: { cliente?: string; vendedor: string | null; desconto?: number; prazo?: boolean }) => ({
    entidade: 'pedido',
    id: pid,
    operacao: 'upsert',
    payload: {
      id: pid,
      created_offline_at: new Date().toISOString(),
      customer_id: e.cliente ?? A.clientes.c1,
      ...(e.vendedor !== null ? { vendedor_id: e.vendedor } : {}),
      autor_id: AUTOR_FALSO,
      discount_pct: e.desconto ?? 0,
      items: [{ product_id: prodA, quantity: 1 }],
      forma_pagamento_id: e.prazo ? PA.formas.boleto : PA.formas.pix,
      prazo_pagamento_id: e.prazo ? PA.prazos.bol2856 : PA.prazos.pixAvista,
    },
  });
  const pedido = async (pid: string) =>
    (await q<{ status: string; vendedor_id: string; autor_id: string; nivel_aprovacao: string | null }>('select status, vendedor_id::text, autor_id::text, nivel_aprovacao from vendedor.pedido where id = $1', [pid]))[0];
  const aprovacoes = (pid: string) => q<{ motivo: string; nivel: string; estado: string }>('select motivo, nivel, estado from vendedor.pedido_aprovacao where pedido_id = $1 and deleted_at is null order by motivo', [pid]);
  const eventos = (pid: string, nome: string) => q<{ payload: Linha }>('select payload from plataforma.evento where agregado_id = $1 and nome = $2', [pid, nome]);
  const parametro = async (chave: string, valor: string | null) => {
    await q("delete from plataforma.parametro where tenant_id = $1 and modulo = 'vendedor' and chave = $2", [A.tenantId, chave]);
    if (valor !== null) await q("insert into plataforma.parametro (tenant_id, modulo, chave, valor) values ($1, 'vendedor', $2, $3::jsonb)", [A.tenantId, chave, valor]);
  };
  const despachar = async () => {
    if (!worker) return;
    const d = criarDespachante({ worker: worker.pool, app: criarBancoApp(api.pool), modulos: api.modulos });
    for (let i = 0; i < 40; i += 1) if ((await d.ciclo()).lidos === 0) return;
  };
  /** Recusa por item: o pedido NÃO é gravado (o rascunho fica no aparelho, que recebe `rejeitado`, não `conflito`). */
  const recusado = async (r: ResultadoItemPush | undefined, pid: string, codigo: string) => {
    expect(r, JSON.stringify(r)).toMatchObject({ id: pid, status: 'rejeitado', codigo });
    expect(await pedido(pid), `${pid}: não pode ter sido gravado`).toBeUndefined();
    expect(await eventos(pid, 'vendedor.pedido.criado@1')).toEqual([]);
  };
  /** RN-VEN-10 (oráculo): nível de quem aprova um desconto acima da alçada do autor supervisor. */
  const nivelEsperadoSupervisor = (pct: number): 'aprovado' | 'gerente' | 'diretoria' =>
    pct <= alcadas.supervisor_pct ? 'aprovado' : pct <= alcadas.manager_pct ? 'gerente' : 'diretoria';

  const limpar = async () => {
    const ids = Object.values(PED);
    await api.admin.query('delete from integracao.pedido_fila_erp where pedido_uuid = any($1::uuid[])', [ids]).catch(() => undefined);
    await api.admin.query('delete from vendedor.pedido_aprovacao where pedido_id = any($1::uuid[])', [ids]).catch(() => undefined);
    await api.admin.query('delete from vendedor.pedido_evento where pedido_id = any($1::uuid[])', [ids]);
    await api.admin.query('delete from vendedor.pedido_item where pedido_id = any($1::uuid[])', [ids]);
    await api.admin.query('delete from vendedor.pedido where id = any($1::uuid[])', [ids]);
    await parametro('titulo_vencido_dias', null);
  };

  beforeAll(async () => {
    api = await subirApi();
    if (api.banco.urlWorker) worker = poolComEncerramento(new pg.Pool({ connectionString: api.banco.urlWorker, max: 2 }));
    tk.vendedor = (await api.sessao('vendedor@exemplo.com.br')).access_token;
    tk.promotor = (await api.sessao('promotor@exemplo.com.br')).access_token;
    tk.supervisor = (await api.sessao('supervisor@exemplo.com.br')).access_token;
    tk.gerente = (await api.sessao('gerente@exemplo.com.br')).access_token;
    tk.adminA = (await api.sessao('admin@exemplo.com.br')).access_token;
    prodA = (await q<{ id: string }>("select id from core.produto where tenant_id = $1 and sku = 'ALFA-001'", [A.tenantId]))[0]!.id;
    const r = await api.chamar(tk.supervisor, { method: 'GET', url: '/v1/vendedor/alcadas' });
    expect(r.statusCode, r.body).toBe(200);
    alcadas = r.json() as typeof alcadas;
    // o oráculo da alçada só faz sentido com 8% dentro e 12% fora da alçada do supervisor (critério 17: alçada de 10%)
    expect(alcadas.supervisor_pct, 'fixture: alçada do supervisor').toBeGreaterThanOrEqual(8);
    expect(alcadas.supervisor_pct, 'fixture: alçada do supervisor').toBeLessThan(12);
    await limpar();
    // o A.c1 tem título vencido há 10 dias: com o limite em 30 dias não há inadimplência (só o desconto decide)
    await parametro('titulo_vencido_dias', '30');
    await despachar();
  }, 300_000);

  afterAll(async () => {
    if (!api) return;
    await limpar().catch(() => undefined);
    await q("update core.usuario set equipe_id = $2, deleted_at = null where id = $1", [A.usuarios.vendedor1, A.equipes.equipe1]).catch(() => undefined);
    await worker?.encerrar();
    await api.fechar();
  });

  // ------------------------------------------------------------------------------------------ Critério 15 (a API revalida)
  describe('Critério 15 — a API revalida o vendedor e o cliente (o pedido não é gravado)', () => {
    it('15a. vendedor_id de outra equipe (vendedor-2) volta FORA_DA_EQUIPE', async () => {
      await recusado((await push(tk.supervisor, [emNome(PED.outraEquipe, { vendedor: A.usuarios.vendedor2, cliente: A.clientes.c1 })]))[0], PED.outraEquipe, 'FORA_DA_EQUIPE');
    });
    it('15b. vendedor_id de promotor (da própria equipe) volta RN-PRO-01', async () => {
      await recusado((await push(tk.supervisor, [emNome(PED.promotorComoVendedor, { vendedor: A.usuarios.promotor })]))[0], PED.promotorComoVendedor, 'RN-PRO-01');
    });
    // 15c: o desenho §4 pede VENDEDOR_INVALIDO para id de outro tenant ou inexistente. O D-187-01 (o `main` respondia FORA_DA_EQUIPE)
    // foi corrigido pelo modulo-vendedor (`verificarPedidoEmNome` confere o dono antes da equipe); o código exato liga com a correção.
    it('15c. vendedor_id de outro tenant ou inexistente: recusado e nunca gravado (RN-CORE-05)', async () => {
      const res = await push(tk.supervisor, [emNome(PED.vendedorB, { vendedor: B.usuarios.vendedor }), emNome(PED.inexistente, { vendedor: id(999) })]);
      for (const [r, pid] of [[res[0], PED.vendedorB], [res[1], PED.inexistente]] as const) {
        expect(r?.status, JSON.stringify(r)).toBe('rejeitado');
        expect(['VENDEDOR_INVALIDO', 'FORA_DA_EQUIPE']).toContain(codigoDe(r));
        expect(await pedido(pid)).toBeUndefined();
      }
    });
    it.runIf(TEM_VENDEDOR_INVALIDO)('15c (código exato, D-187-01). vendedor_id de outro tenant ou inexistente volta VENDEDOR_INVALIDO (desenho §4)', async () => {
      const res = await push(tk.supervisor, [emNome(PED.vendedorB, { vendedor: B.usuarios.vendedor }), emNome(PED.inexistente, { vendedor: id(999) })]);
      await recusado(res[0], PED.vendedorB, 'VENDEDOR_INVALIDO');
      await recusado(res[1], PED.inexistente, 'VENDEDOR_INVALIDO');
    });
    it('15d. cliente fora da carteira da equipe (c2, equipe 2) com o vendedor-1 volta FORA_DA_CARTEIRA', async () => {
      await recusado((await push(tk.supervisor, [emNome(PED.foraDaCarteira, { vendedor: A.usuarios.vendedor1, cliente: A.clientes.c2 })]))[0], PED.foraDaCarteira, 'FORA_DA_CARTEIRA');
    });
  });

  // ------------------------------------------------------------------------------------------ Critério 16
  it('16. o pedido gravado tem vendedor_id do escolhido e autor_id do supervisor (do token, nunca do payload); o criado@1 leva os dois; o vendedor é notificado', async () => {
    const t0 = (await q<{ agora: Date }>('select now() as agora'))[0]!.agora;
    expect((await push(tk.supervisor, [emNome(PED.ok, { vendedor: A.usuarios.vendedor1 })]))[0]).toMatchObject({ id: PED.ok, status: 'aceito' });
    expect(await pedido(PED.ok)).toMatchObject({ vendedor_id: A.usuarios.vendedor1, autor_id: A.usuarios.supervisor });
    const criado = await eventos(PED.ok, 'vendedor.pedido.criado@1');
    expect(criado).toHaveLength(1);
    expect(criado[0]!.payload).toMatchObject({ vendedor_id: A.usuarios.vendedor1, autor_id: A.usuarios.supervisor });
    await despachar();
    if (worker) {
      const n = await q<{ n: number }>('select count(*)::int as n from core.notificacao where tenant_id = $1 and usuario_id = $2 and created_at >= $3', [A.tenantId, A.usuarios.vendedor1, t0]);
      expect(n[0]!.n, 'RN-VEN-35: notificação ao vendedor escolhido').toBeGreaterThanOrEqual(1);
    }
  });

  // ------------------------------------------------------------------------------------------ Critério 17 (valor × regra)
  describe('Critério 17 — alçada do autor (RN-VEN-10) e ninguém aprova o próprio pedido (P4 A)', () => {
    it('17a. 8% de desconto: dentro da alçada do supervisor, aprovado na hora, sem aprovação aberta', async () => {
      expect(nivelEsperadoSupervisor(8)).toBe('aprovado');
      expect((await push(tk.supervisor, [emNome(PED.oitoPct, { vendedor: A.usuarios.vendedor1, desconto: 8 })]))[0]).toMatchObject({ status: 'aceito' });
      expect((await pedido(PED.oitoPct))!.status).toBe('approved');
      expect(await aprovacoes(PED.oitoPct)).toEqual([]);
    });
    it('17b. 12% de desconto: acima da alçada do supervisor, a aprovação do desconto vai ao gerente (nunca ao supervisor autor)', async () => {
      const esperado = nivelEsperadoSupervisor(12);
      expect((await push(tk.supervisor, [emNome(PED.dozePct, { vendedor: A.usuarios.vendedor1, desconto: 12 })]))[0]).toMatchObject({ status: 'aceito' });
      expect((await pedido(PED.dozePct))!.status).toBe('pending_approval');
      const desconto = (await aprovacoes(PED.dozePct)).filter((a) => a.motivo === 'desconto');
      expect(desconto.map((a) => a.nivel)).toEqual([esperado]);
      expect(desconto.map((a) => a.nivel)).not.toContain('supervisor');
    });
    it.runIf(TEM_NIVEL_DO_AUTOR)('17c. título vencido (inadimplência no nível supervisor): o motivo sobe ao gerente, nunca fica com o supervisor autor (P4 A)', async () => {
      await parametro('titulo_vencido_dias', null); // padrão (5 dias): o título vencido há 10 dias pesa
      try {
        expect((await push(tk.supervisor, [emNome(PED.vencido, { vendedor: A.usuarios.vendedor1, prazo: true })]))[0]).toMatchObject({ status: 'aceito' });
        const niveis = (await aprovacoes(PED.vencido)).map((a) => `${a.motivo}:${a.nivel}`);
        expect(niveis.length, JSON.stringify(niveis)).toBeGreaterThan(0);
        for (const n of niveis) expect(n.endsWith(':supervisor'), n).toBe(false);
      } finally {
        await parametro('titulo_vencido_dias', '30');
      }
    });
    it.runIf(TEM_PROPRIO_PEDIDO)('17d. o supervisor autor que tenta decidir o próprio pedido recebe 422 APROVACAO_DO_PROPRIO_PEDIDO, o pedido não muda e some da fila dele; o gerente decide (o motivo subiu um nível)', async () => {
      const url = (d: string) => `/v1/vendedor/pedidos/${PED.dozePct}/${d}`;
      for (const [d, corpo] of [['aprovar', {}], ['rejeitar', { motivo: 'Desconto acima do combinado com o cliente' }], ['recusar', { motivo: 'Desconto acima do combinado com o cliente' }]] as const) {
        const r = await api.chamar(tk.supervisor, { method: 'POST', url: url(d), payload: corpo });
        expect(r.statusCode, `${d}: ${r.body}`).toBe(422);
        expect((r.json() as { codigo?: string }).codigo, d).toBe('APROVACAO_DO_PROPRIO_PEDIDO');
      }
      expect((await pedido(PED.dozePct))!.status).toBe('pending_approval');
      expect((await aprovacoes(PED.dozePct)).filter((a) => a.motivo === 'desconto')).toEqual([{ motivo: 'desconto', nivel: nivelEsperadoSupervisor(12), estado: 'pendente' }]);
      await despachar();
      if (worker) {
        // a fila é do Gestor: ligado ao tenant e ao supervisor, como nos outros testes da fila (aprovacao-motivo-t0184)
        expect((await licenca(api, tk.adminA, 'tenant', 'gestor', true)).statusCode).toBe(200);
        expect((await licenca(api, tk.adminA, 'perfil', 'gestor', true, 'supervisor')).statusCode).toBe(200);
        const fila = await api.chamar(tk.supervisor, { method: 'GET', url: '/v1/gestor/aprovacoes' });
        expect(fila.statusCode, fila.body).toBe(200);
        expect((fila.json() as { itens: { pedido_id: string }[] }).itens.map((i) => i.pedido_id)).not.toContain(PED.dozePct);
      }
      // contraprova: o nível acima (gerente) decide o pedido do supervisor
      const g = await api.chamar(tk.gerente, { method: 'POST', url: url('aprovar'), payload: {} });
      expect(g.statusCode, g.body).toBe(200);
      expect((await pedido(PED.dozePct))!.status).toBe('approved');
    });
  });

  // ------------------------------------------------------------------------------------------ Critério 18 (offline)
  it('18. pedido feito sem rede (created_offline_at antigo) com o vendedor que saiu da equipe antes do envio: volta recusado (FORA_DA_EQUIPE) e não é gravado', async () => {
    await q('update core.usuario set equipe_id = $2 where id = $1', [A.usuarios.vendedor1, A.equipes.equipe2]);
    try {
      // c1 segue na carteira da equipe 1 (o promotor também o atende): a recusa é pela equipe, não pela carteira
      const item = emNome(PED.saiuDaEquipe, { vendedor: A.usuarios.vendedor1, cliente: A.clientes.c1 });
      item.payload.created_offline_at = new Date(Date.now() - 2 * 3600_000).toISOString();
      await recusado((await push(tk.supervisor, [item]))[0], PED.saiuDaEquipe, 'FORA_DA_EQUIPE');
    } finally {
      await q('update core.usuario set equipe_id = $2 where id = $1', [A.usuarios.vendedor1, A.equipes.equipe1]);
    }
  });

  // ------------------------------------------------------------------------------------------ Critérios 19, 20 e 21
  it('19. o supervisor de A não usa cliente de B: pedido com o c1 de B volta recusado e nada é gravado em nenhum tenant', async () => {
    const r = (await push(tk.supervisor, [emNome(PED.clienteB, { vendedor: A.usuarios.vendedor1, cliente: B.clientes.c1 })]))[0];
    expect(r?.status, JSON.stringify(r)).toBe('rejeitado');
    expect(['FORA_DA_CARTEIRA', 'CLIENTE_NAO_ENCONTRADO', 'VENDEDOR_INVALIDO']).toContain(codigoDe(r));
    expect(await pedido(PED.clienteB)).toBeUndefined();
  });

  it('20. promotor que chama o push de pedido com vendedor_id recebe RN-PRO-01 (com o Vendedor licenciado no perfil, o pior caso)', async () => {
    expect((await licenca(api, tk.adminA, 'perfil', 'catalogo', true, 'promotor')).statusCode).toBe(200);
    expect((await licenca(api, tk.adminA, 'perfil', 'vendedor', true, 'promotor')).statusCode).toBe(200);
    try {
      const r = (await push(tk.promotor, [emNome(PED.promotorAutor, { vendedor: A.usuarios.vendedor1 })]))[0];
      expect(r, JSON.stringify(r)).toMatchObject({ status: 'rejeitado', codigo: 'RN-PRO-01' });
      expect(await pedido(PED.promotorAutor)).toBeUndefined();
    } finally {
      await licenca(api, tk.adminA, 'perfil', 'vendedor', false, 'promotor');
      await licenca(api, tk.adminA, 'perfil', 'catalogo', false, 'promotor');
    }
  });

  it('21 (API). o vendedor não faz pedido em nome de outro: vendedor_id do vendedor-2 volta recusado e nada é gravado', async () => {
    const r = (await push(tk.vendedor, [emNome(PED.vendedorAutor, { vendedor: A.usuarios.vendedor2 })]))[0];
    expect(r?.status, JSON.stringify(r)).toBe('rejeitado');
    expect(['PERFIL_SEM_ACESSO', 'FORA_DA_EQUIPE']).toContain(codigoDe(r));
    expect(await pedido(PED.vendedorAutor)).toBeUndefined();
  });
});
