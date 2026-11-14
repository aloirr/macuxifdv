/**
 * T-0039 (agente testes) — etapa pendente do checkout VISTA NO APARELHO, de ponta a ponta (RN-CORE-12 com o complemento de
 * 05/11; desenho docs/desenho/T-0039.md §2; telas docs/design/checkout-pendencia.md §1.1, §1.2, §1.3 e §2.1):
 * app Campo (MOTOR DE SYNC real + `fazerCheckin`/`fazerCheckout` de lib/acoes-visita.ts + `ArmazemCore` real) → `createApp`
 * REAL (8 módulos, JWT de verdade) → Core chamando `pesquisa.etapas_checkout@1` → Postgres como `macuxi_app` (RLS); baixa
 * pelo DESPACHANTE real (`pesquisa.resposta.registrada@1`, macuxi_worker) ou pela dispensa do supervisor (rota real); alerta
 * pela varredura do Core (`alertarPendenciasVencidas`) com as consultas e o publicador reais.
 * O que a tela mostra sai das funções reais: rota efetiva (`effectiveRoute`, a mesma da `useCore`), condição do chip de
 * telas/rota.tsx (`StopRow`: parada `done` e `visit.etapas_pendentes > 0`), Banner da ficha (`visitaComEtapaPendente` +
 * `avisoDeEtapaPendente`, como telas/cliente.tsx) e caixa de notificações (`montarCaixa`, como telas/notificacoes.tsx).
 * Sem o hardware: o ambiente do motor gera UUID do Node e lê um GPS controlado (`posicaoAgora`); `naFila` = itens na fila do motor (o shell entrega
 * esse número à `useSincronizacao`).
 *
 * Complementa tests/integracao/api/checkout-tolerancia-t0039.test.ts (TP-01..TP-17, que lê só a contagem num aparelho
 * NOVO): aqui o MESMO aparelho puxa de novo (pull incremental pelo cursor) e a pendência some da Rota, da ficha e da caixa.
 * PRECISA DE BANCO: pula sem Postgres; no CI (MACUXI_PG_EXIGIR=1) roda. Matriz: docs/testes/T-0039.md, bloco "Aparelho".
 * Relógio: nenhum instante fixo; o prazo do alerta recua `pendente_desde` no banco.
 */
import { randomUUID } from 'node:crypto';
import { semBanco } from '@macuxi/db/teste/estado';
import { linkInternoNavegavel as linkNavegavel, USUARIO_SISTEMA_ID, type LinhaSync, type ModuloId } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { criarBancoApp } from '../../../apps/api/src/banco';
import { criarDespachante } from '../../../apps/api/src/despachante';
import { registroDeConsultas, transacaoTenant } from '../../../apps/api/src/outbox';
import { PESQUISA_FIXTURE } from '../../../db/seeds/fixtures/pesquisa';
import { alertarPendenciasVencidas } from '../../../modules/core/api/etapas-pendencia';
import { fazerCheckin, fazerCheckout, type ContextoAcao } from '../../../modules/core/app/lib/acoes-visita';
import { armazemDe } from '../../../modules/core/app/lib/estado';
import { avisoDeEtapaPendente, visitaComEtapaPendente } from '../../../modules/core/app/lib/etapa-pendente';
import { montarCaixa } from '../../../modules/core/app/lib/notificacoes';
import { effectiveRoute } from '../../../modules/core/app/lib/route';
import type { NotificacaoSync } from '../../../modules/core/contracts';
import { A, B, licenca, subirApi, type ApiDeTeste, type Tenant } from '../apoio/api';
import { aparelhoCampo, esperarHorizonte, gpsDeTeste, type AparelhoCampo } from '../apoio/campo';

/** GPS do "aparelho": lido uma vez por ação (RN-CORE-13), pelo ambiente do motor (`posicaoAgora`, RD-0046). */
const gps = gpsDeTeste();

const U = A.usuarios;
const C = A.clientes;
const PQ = PESQUISA_FIXTURE.A;
const ETAPA = 'pesquisa.obrigatoria';
/** c3 (Manacapuru) não tem coordenada: o check-in segue sem pedir justificativa. */
const EM_C3 = { lat: -3.2995, lng: -60.6206, precisao_m: 12 };

interface Campo {
  ap: AparelhoCampo;
  acao: ContextoAcao;
  armazem: ReturnType<typeof armazemDe>;
}

/** Dia local (fuso do tenant) em dd/mm, ou "hoje" — como a ficha decide "de hoje" (§1.2). */
const quando = (iso: string, fuso: string) => {
  const dia = (d: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit' }).format(d);
  return dia(new Date(iso)) === dia(new Date()) ? 'de hoje' : `de ${dia(new Date(iso))}`;
};

describe.skipIf(semBanco())('T-0039 — etapa pendente no app (Rota, ficha, notificação): motor real × API real × despachante × Postgres', () => {
  let api: ApiDeTeste;
  let worker: pg.Pool;
  const tk = { admin: '', adminB: '', vendedor1: '', supervisor: '' };

  const noCampo = async (email: string, tenant: Tenant = A): Promise<Campo> => {
    const ap = await aparelhoCampo(api, email, { tenant, posicaoAgora: gps.posicaoAgora });
    const armazem = armazemDe(ap.motor);
    return { ap, armazem, acao: { motor: ap.motor, armazem, tz: ap.sessao.tenant.fuso, vendedorId: ap.sessao.usuario.id } };
  };
  /** Sincronizar do app depois do horizonte do pull (as escritas recentes só descem depois de 2 s). */
  const sincronizar = async (c: Campo) => {
    await esperarHorizonte();
    expect(await c.ap.sincronizar(), c.ap.motor.estado().erro ?? '').toBe(true);
    await c.armazem.carregar();
  };
  /** O que as telas do Core mostram neste aparelho agora. */
  const tela = async (c: Campo) => {
    await c.armazem.carregar();
    const estado = c.armazem.obter();
    const agora = new Date();
    const rota = effectiveRoute(estado.rota, estado.visitas, agora, c.acao.tz);
    const naFila = c.ap.motor.estado().fila.length;
    const caixa = montarCaixa(await c.ap.motor.linhas<NotificacaoSync & LinhaSync>('notificacao'), c.ap.motor.sobreposicao(['notificacao_leitura']), agora);
    return {
      estado,
      /** Chip "Etapa pendente" da parada (telas/rota.tsx, `StopRow`). */
      chip: (paradaId: string) => {
        const s = rota?.stops.find((x) => x.id === paradaId);
        return Boolean(s && s.status === 'done' && (s.visit?.etapas_pendentes ?? 0) > 0);
      },
      statusDaParada: (paradaId: string) => rota?.stops.find((x) => x.id === paradaId)?.status ?? null,
      /** Banner da ficha do cliente (telas/cliente.tsx). */
      aviso: (clienteId: string) => {
        const p = visitaComEtapaPendente(estado.visitas, clienteId);
        return p ? avisoDeEtapaPendente({ ...p, agora, fuso: c.acao.tz, naFila }) : null; // RD-0181: o sinal não entra no aviso (só a fila)
      },
      caixa,
    };
  };
  /** Check-in na parada c3 da rota de hoje e checkout "sem pedido" SEM responder a pesquisa obrigatória, sem sinal; depois sincroniza. */
  const visitaPendentePeloApp = async (v: Campo): Promise<{ vid: string; checkin_at: string }> => {
    await sincronizar(v);
    const parada = v.armazem.obter().rota?.stops.find((s) => s.id === A.paradas.v1c3);
    expect(parada, 'a parada c3 da rota de hoje chega pelo pull').toBeDefined();
    v.ap.online.valor = false;
    gps.posicao = EM_C3;
    const ci = await fazerCheckin(v.acao, parada!.customer, parada!.id);
    expect(ci.kind).toBe('created');
    if (ci.kind !== 'created') throw new Error('check-in não criado');
    const fechada = await fazerCheckout(v.acao, ci.visit.id, { resultado: 'sem_pedido', motivo_id: A.motivos.estoqueAlto, cliente: 'Auto Peças Três' });
    expect(fechada?.checkout_at).toBeTruthy();
    // sem sinal: a parada fecha no aparelho e NÃO há chip (a pendência só nasce no servidor; §0 "não há aviso na hora do checkout")
    const offline = await tela(v);
    expect(offline.statusDaParada(A.paradas.v1c3)).toBe('done');
    expect(offline.chip(A.paradas.v1c3)).toBe(false);
    expect(offline.aviso(C.c3)).toBeNull();
    v.ap.online.valor = true;
    expect(await v.ap.sincronizar(), v.ap.motor.estado().erro ?? '').toBe(true);
    expect(v.ap.motor.estado().fila, 'a fila esvaziou').toEqual([]);
    expect(await visitaNoBanco(ci.visit.id)).toMatchObject({ etapas_pendentes: 1 });
    await sincronizar(v);
    return { vid: ci.visit.id, checkin_at: ci.visit.checkin_at };
  };
  const visitaNoBanco = async (id: string) =>
    (await api.admin.query('select checkout_id, resultado, etapas_pendentes from core.visita where id = $1', [id])).rows[0] as { etapas_pendentes: number } | undefined;
  const etapaPesquisa = async (vid: string) =>
    (await api.admin.query("select id, situacao from core.visita_etapa where visita_id = $1 and modulo = 'pesquisa' and etapa = $2 and deleted_at is null", [vid, ETAPA])).rows[0] as
      | { id: string; situacao: string }
      | undefined;
  const notificacoesDaEtapa = async (etapaId: string) =>
    (await api.admin.query('select id, usuario_id, titulo, deleted_at from core.notificacao where envio_id = $1 order by usuario_id', [etapaId])).rows as Array<{
      id: string;
      usuario_id: string;
      titulo: string;
      deleted_at: Date | null;
    }>;
  const despachar = async () => {
    const d = criarDespachante({ worker, app: criarBancoApp(api.pool), modulos: api.modulos });
    for (let i = 0; i < 40; i += 1) if ((await d.ciclo()).lidos === 0) return;
    throw new Error('a outbox não esvaziou em 40 ciclos');
  };
  /** Varredura do alerta do Core em A (como o agendador: transação do tenant, usuário de sistema, consultas e publicador reais). */
  const rodarAlerta = () =>
    criarBancoApp(api.pool).comTenant(A.tenantId, async (db) => {
      const modulos: ModuloId[] = ['core', 'vendedor', 'promotor', 'catalogo', 'pesquisa'];
      const tx = transacaoTenant(db, {
        manifestos: api.modulos.map((m) => m.manifesto),
        modulo: 'core',
        tenantId: A.tenantId,
        usuarioId: null,
        requestId: randomUUID(),
        agora: () => new Date(),
        usuario: { id: USUARIO_SISTEMA_ID, tenant_id: A.tenantId, perfil: 'admin', modulos },
        consultas: registroDeConsultas(api.modulos),
        fuso: () => A.fuso,
      });
      return alertarPendenciasVencidas({ db, consultar: tx.consultar, publicar: tx.publicar, fuso: () => A.fuso, agora: () => new Date() });
    });
  /** Pendência de 24 h + 1 min (recuada no banco) e varredura: 1 notificação ao vendedor e 1 ao supervisor. */
  const alertar = async (vid: string) => {
    const etapa = await etapaPesquisa(vid);
    expect(etapa).toMatchObject({ situacao: 'pendente' });
    await api.admin.query('update core.visita_etapa set pendente_desde = now() - make_interval(mins => 1441) where id = $1', [etapa!.id]);
    await rodarAlerta();
    const ns = await notificacoesDaEtapa(etapa!.id);
    expect(ns.map((n) => n.usuario_id).sort()).toEqual([U.supervisor, U.vendedor1].sort());
    return { etapaId: etapa!.id, doVendedor: ns.find((n) => n.usuario_id === U.vendedor1)!, doSupervisor: ns.find((n) => n.usuario_id === U.supervisor)! };
  };
  const resposta = (rid: string, vid: string) => ({
    id: rid,
    entidade: 'resposta_pesquisa',
    operacao: 'upsert' as const,
    payload: {
      id: rid,
      questionario_id: PQ.questionarios.checkout,
      versao_id: PQ.versoes.checkoutV1,
      cliente_id: C.c3,
      visita_id: vid,
      respondida_em: new Date(Date.now() - 60_000).toISOString(),
      itens: [{ pergunta_id: PQ.perguntas.checkoutNota, tipo: 'escala', valor: 4 }],
    },
  });
  const dispensar = (token: string, vid: string, justificativa: string) =>
    api.chamar(token, { method: 'POST', url: `/v1/core/visitas/${vid}/etapas/pesquisa/${encodeURIComponent(ETAPA)}/dispensa`, payload: { justificativa } });

  beforeAll(async () => {
    api = await subirApi();
    if (!api.banco.urlWorker) throw new Error('banco de teste sem urlWorker (MACUXI_PG_WORKER_SENHA): a baixa precisa do despachante');
    worker = new pg.Pool({ connectionString: api.banco.urlWorker, max: 2 });
    tk.admin = (await api.sessao('admin@exemplo.com.br')).access_token;
    tk.adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
    // a fixture traz a pesquisa "Satisfação no checkout" (checkout_obrigatoria, público = perfil vendedor), mas sem licença em A
    for (const [nivel, perfil] of [['tenant'], ['perfil', 'vendedor'], ['perfil', 'promotor'], ['perfil', 'supervisor']] as const) {
      const r = await licenca(api, tk.admin, nivel, 'pesquisa', true, perfil);
      expect(r.statusCode, r.body).toBe(200);
    }
    tk.vendedor1 = (await api.sessao('vendedor@exemplo.com.br')).access_token;
    tk.supervisor = (await api.sessao('supervisor@exemplo.com.br')).access_token;
    await despachar(); // eventos da fixture não seguram a fila
    await esperarHorizonte();
  });
  afterAll(async () => {
    await worker?.end().catch(() => undefined);
    await api?.fechar();
  });
  beforeEach(async () => {
    gps.posicao = null;
    await api.admin.query(
      "update core.visita set checkout_em = greatest(now(), checkin_em), resultado = 'nao_finalizado', fechada_por = 'auto' where usuario_id = any($1::uuid[]) and checkout_em is null",
      [[U.vendedor1, U.vendedor2, U.promotor]],
    );
  });

  it('AP-01 RN-CORE-12 §1.1/§1.2: checkout feito pelo app sem a pesquisa obrigatória é aceito com pendência; o pull traz etapas_pendentes = 1 e a Rota mostra o chip na parada c3 (não na c1); a ficha de c3 mostra o aviso; sem sinal tudo continua na tela', async () => {
    const v = await noCampo('vendedor@exemplo.com.br');
    const { vid, checkin_at } = await visitaPendentePeloApp(v);
    const t = await tela(v);
    expect(t.estado.visitas.find((x) => x.id === vid)?.etapas_pendentes, 'contagem do pull na visita local').toBe(1);
    expect(t.statusDaParada(A.paradas.v1c3)).toBe('done');
    expect(t.chip(A.paradas.v1c3), 'chip na parada feita com pendência').toBe(true);
    expect(t.chip(A.paradas.v1c1), 'c1 (visita da fixture, sem pendência) sem chip').toBe(false);
    expect(t.aviso(C.c3)).toEqual({ linha1: `Uma etapa da visita ${quando(checkin_at, v.acao.tz)} não chegou`, linha2: 'Fale com seu supervisor' });
    expect(t.aviso(C.c1)).toBeNull();

    // modo avião: offline-first, a tela continua a mesma (o SyncStamp diz de quando é a informação)
    v.ap.online.valor = false;
    const sem = await tela(v);
    expect(sem.chip(A.paradas.v1c3)).toBe(true);
    expect(sem.aviso(C.c3)).toEqual(t.aviso(C.c3)); // T-0166: o sinal não muda o aviso
    v.ap.online.valor = true;

    // limpeza para os cenários seguintes (a ficha usa a visita mais recente do cliente)
    expect((await dispensar(tk.supervisor, vid, 'Limpeza do cenário AP-01')).statusCode).toBe(200);
  });

  it('AP-02 RN-CORE-12 §1.3/§2.1: a notificação do alerta chega ao app do vendedor e ao do supervisor; a resposta da pesquisa chega e o despachante baixa: no PRÓXIMO pull do mesmo aparelho o chip, o aviso e a notificação somem (notificação com deleted_at, nas duas caixas)', async () => {
    const v = await noCampo('vendedor@exemplo.com.br');
    const s = await noCampo('supervisor@exemplo.com.br');
    await sincronizar(s);
    const { vid } = await visitaPendentePeloApp(v);
    const { etapaId, doVendedor, doSupervisor } = await alertar(vid);

    await sincronizar(v);
    await sincronizar(s);
    const antes = await tela(v);
    expect(antes.chip(A.paradas.v1c3)).toBe(true);
    const nV = antes.caixa.find((n) => n.id === doVendedor.id);
    expect(nV, 'a notificação do alerta chega ao app do vendedor').toMatchObject({ tipo: 'sistema', prioridade: 'normal', titulo: doVendedor.titulo, link: `/m/cliente?id=${C.c3}` });
    expect(linkNavegavel(nV!.link), 'o toque abre a ficha do cliente').toBe(`/m/cliente?id=${C.c3}`);
    expect(antes.caixa.some((n) => n.id === doSupervisor.id), 'a do supervisor não vai ao vendedor').toBe(false);
    const caixaSup = (await tela(s)).caixa;
    expect(caixaSup.find((n) => n.id === doSupervisor.id)).toMatchObject({ tipo: 'sistema', prioridade: 'normal', titulo: doSupervisor.titulo });
    expect(caixaSup.some((n) => n.id === doVendedor.id)).toBe(false);

    // a resposta chega (outro aparelho/fila da Pesquisa); a baixa é assíncrona, pelo evento
    const r = await api.chamar(tk.vendedor1, { method: 'POST', url: '/v1/sync/push', payload: { itens: [resposta(randomUUID(), vid)] } });
    expect(r.statusCode, r.body).toBe(200);
    await despachar();
    expect(await etapaPesquisa(vid)).toMatchObject({ situacao: 'concluida' });
    expect(await visitaNoBanco(vid)).toMatchObject({ etapas_pendentes: 0 });
    const ns = await notificacoesDaEtapa(etapaId);
    expect(ns.every((n) => n.deleted_at !== null), 'as duas notificações recebem baixa (deleted_at)').toBe(true);

    await sincronizar(v);
    await sincronizar(s);
    const depois = await tela(v);
    expect(depois.estado.visitas.find((x) => x.id === vid)?.etapas_pendentes ?? 0, 'pull incremental traz 0').toBe(0);
    expect(depois.statusDaParada(A.paradas.v1c3)).toBe('done');
    expect(depois.chip(A.paradas.v1c3), 'o chip some').toBe(false);
    expect(depois.aviso(C.c3), 'o aviso some').toBeNull();
    expect((await v.ap.motor.linhas('notificacao')).some((n) => n.id === doVendedor.id), 'a notificação sai do aparelho').toBe(false);
    expect(depois.caixa.some((n) => n.id === doVendedor.id)).toBe(false);
    expect((await tela(s)).caixa.some((n) => n.id === doSupervisor.id), 'e da caixa do supervisor').toBe(false);
  });

  it('AP-03 RN-CORE-12 §2.5a: o supervisor dispensa a etapa; no próximo pull do mesmo aparelho o chip, o aviso e a notificação somem', async () => {
    const v = await noCampo('vendedor@exemplo.com.br');
    const { vid } = await visitaPendentePeloApp(v);
    const { etapaId, doVendedor } = await alertar(vid);
    await sincronizar(v);
    const antes = await tela(v);
    expect(antes.chip(A.paradas.v1c3)).toBe(true);
    expect(antes.aviso(C.c3)).not.toBeNull();
    expect(antes.caixa.some((n) => n.id === doVendedor.id)).toBe(true);

    const d = await dispensar(tk.supervisor, vid, 'Cliente respondeu no papel; conferido na loja');
    expect(d.statusCode, d.body).toBe(200);
    expect(d.json()).toMatchObject({ situacao: 'dispensada', alterada: true, etapas_pendentes: 0 });
    expect((await notificacoesDaEtapa(etapaId)).every((n) => n.deleted_at !== null)).toBe(true);

    await sincronizar(v);
    const depois = await tela(v);
    expect(depois.chip(A.paradas.v1c3)).toBe(false);
    expect(depois.aviso(C.c3)).toBeNull();
    expect(depois.caixa.some((n) => n.id === doVendedor.id)).toBe(false);
  });

  it('AP-04 RN-PRO-01 / RN-CORE-04 / multi-tenant: com uma pendência alertada do vendedor-1 em A, o promotor de A, o supervisor (Gestão, §2.2 em backlog) e o vendedor de B não veem chip, aviso nem notificação dela; o pull de B não traz a visita', async () => {
    const v = await noCampo('vendedor@exemplo.com.br');
    const { vid } = await visitaPendentePeloApp(v);
    const { doVendedor, doSupervisor } = await alertar(vid);
    const deA = new Set([doVendedor.id, doSupervisor.id]);

    const p = await noCampo('promotor@exemplo.com.br');
    await sincronizar(p);
    const tp = await tela(p);
    expect(tp.estado.visitas.filter((x) => (x.etapas_pendentes ?? 0) > 0), 'promotor: nenhuma visita com pendência').toEqual([]);
    expect(tp.aviso(C.c3)).toBeNull();
    expect(tp.caixa.filter((n) => deA.has(n.id))).toEqual([]);

    const s = await noCampo('supervisor@exemplo.com.br');
    await sincronizar(s);
    const ts = await tela(s);
    expect(ts.aviso(C.c3), 'Gestão: o Banner do vendedor não aparece ao supervisor (§2.2)').toBeNull();
    expect(ts.caixa.filter((n) => deA.has(n.id)).map((n) => n.id), 'só a notificação do próprio supervisor').toEqual([doSupervisor.id]);

    const b = await noCampo('vendedor@exemplo.com.br', B);
    await sincronizar(b);
    expect((await b.ap.motor.linhas('visita')).some((x) => x.id === vid), 'o pull de B não traz a visita de A').toBe(false);
    const tb = await tela(b);
    expect(tb.estado.visitas.filter((x) => (x.etapas_pendentes ?? 0) > 0)).toEqual([]);
    expect(tb.aviso(C.c3)).toBeNull();
    expect(tb.caixa.filter((n) => deA.has(n.id))).toEqual([]);

    expect((await dispensar(tk.admin, vid, 'Limpeza do cenário AP-04')).statusCode).toBe(200);
  });
});
