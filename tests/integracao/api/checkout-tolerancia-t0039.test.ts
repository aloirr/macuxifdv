/**
 * T-0039 §2 (agente testes) — tolerância no checkout (RN-CORE-12 com o complemento de 05/11 no doc 03; desenho
 * docs/desenho/T-0039.md §2 e §2.5a; textos docs/design/checkout-pendencia.md §1.3 e §2.1), ponta a ponta entre módulos:
 * aparelho (push do lote + MOTOR DE SYNC real no pull) → `createApp` REAL (8 módulos, JWT de verdade) → Core (`visita_checkout`
 * chamando `pesquisa.etapas_checkout@1` da Pesquisa REAL) → Postgres como `macuxi_app` (RLS), banco efêmero próprio do arquivo
 * com a fixture dois-tenants; baixa pelo DESPACHANTE real (`pesquisa.resposta.registrada@1`, papel macuxi_worker); alerta pela
 * varredura do Core (`alertarPendenciasVencidas`) na transação do tenant, com as consultas e o publicador reais da API.
 * PRECISA DE BANCO: pula sem Postgres; no CI (MACUXI_PG_EXIGIR=1) roda.
 *
 * Fixture: tenant A tem a pesquisa "Satisfação no checkout" (checkout_obrigatoria, a cada visita, público = perfil vendedor;
 * db/seeds/fixtures/pesquisa.ts), mas a Pesquisa NÃO vem licenciada em A: o `beforeAll` a liga no tenant A e nos perfis
 * vendedor, promotor e supervisor pela rota real de licenças (admin).
 *
 * "422" no push = item `rejeitado` com o código da regra (o lote volta 200, um resultado por item; apps/api/src/sync.ts).
 * Relógio: nenhum instante fixo comparado com o relógio real. Horas relativas a `Date.now()`; o prazo do alerta recua
 * `pendente_desde` no banco em vez de esperar.
 *
 * Convenção: `it` = vale com a ligação do modulo-core no working tree de 05/11 (modules/core/api/etapas-pendencia.ts,
 * visita-push.ts com `avaliarCheckoutTolerante`); `it.todo` = parte que ainda não existe. Matriz: docs/testes/T-0039.md
 * (bloco "Tolerância ponta a ponta", TP-01..TP-15).
 */
import { randomUUID } from 'node:crypto';
import { manifest as manifestoCore } from '@macuxi/core/manifest';
import { semBanco } from '@macuxi/db/teste/estado';
import { ehAcaoDePedido, USUARIO_SISTEMA_ID, type ItemPush, type LinhaSync, type ModuloId, type ResultadoItemPush } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { criarBancoApp } from '../../../apps/api/src/banco';
import { criarDespachante } from '../../../apps/api/src/despachante';
import { registroDeConsultas, transacaoTenant } from '../../../apps/api/src/outbox';
import { PESQUISA_FIXTURE } from '../../../db/seeds/fixtures/pesquisa';
import { alertarPendenciasVencidas } from '../../../modules/core/api/etapas-pendencia';
import { A, B, erroDe, licenca, subirApi, type ApiDeTeste } from '../apoio/api';
import { aparelhoCampo, esperarHorizonte } from '../apoio/campo';

const U = A.usuarios;
const C = A.clientes;
const PQ = PESQUISA_FIXTURE.A;
const MIN = 60_000;
const ETAPA = 'pesquisa.obrigatoria';
const ROTULO = 'Pesquisa obrigatória: "Satisfação no checkout"';
/** Instante relativo ao relógio real (nunca hora fixa). */
const haMin = (m: number) => new Date(Date.now() - m * MIN).toISOString();

const checkin = (vid: string, cliente: string): ItemPush => ({
  id: vid,
  entidade: 'visita',
  operacao: 'upsert',
  payload: { id: vid, cliente_id: cliente, checkin_em: haMin(10), extra: true },
});
const checkout = (cmd: string, vid: string, extra: Record<string, unknown> = {}): ItemPush => ({
  id: cmd,
  entidade: 'visita_checkout',
  operacao: 'upsert',
  payload: { id: cmd, visita_id: vid, checkout_em: haMin(1), resultado: 'sem_pedido', motivo_id: A.motivos.estoqueAlto, etapas: [], ...extra },
});
/** Resposta da pesquisa obrigatória "Satisfação no checkout" de A, ligada à visita (`vid = null`: sem visita). */
const resposta = (rid: string, vid: string | null, cliente: string, extra: Record<string, unknown> = {}): ItemPush => ({
  id: rid,
  entidade: 'resposta_pesquisa',
  operacao: 'upsert',
  payload: {
    id: rid,
    questionario_id: PQ.questionarios.checkout,
    versao_id: PQ.versoes.checkoutV1,
    cliente_id: cliente,
    visita_id: vid,
    respondida_em: haMin(5),
    itens: [{ pergunta_id: PQ.perguntas.checkoutNota, tipo: 'escala', valor: 4 }],
    ...extra,
  },
});

interface EtapaLinha {
  id: string;
  modulo: string;
  etapa: string;
  situacao: string;
  rotulo: string | null;
  referencia_id: string | null;
  pendente_desde: Date | null;
  resolvida_em: Date | null;
  alertada_em: Date | null;
}
const resumo = (e: EtapaLinha) => ({ modulo: e.modulo, etapa: e.etapa, situacao: e.situacao });

describe.skipIf(semBanco())('T-0039 §2 — tolerância no checkout: Campo (motor real) × API real × Pesquisa × despachante × Postgres', () => {
  let api: ApiDeTeste;
  let worker: pg.Pool;
  const tk = { admin: '', adminB: '', vendedor1: '', vendedor2: '', supervisor: '', promotor: '' };

  const push = async (token: string, itens: ItemPush[]): Promise<ResultadoItemPush[]> => {
    const r = await api.chamar(token, { method: 'POST', url: '/v1/sync/push', payload: { itens } });
    expect(r.statusCode, r.body).toBe(200);
    return (r.json() as { resultados: ResultadoItemPush[] }).resultados;
  };
  const status = (rs: ResultadoItemPush[]) => rs.map((r) => [r.status, 'codigo' in r ? (r.codigo ?? null) : null]);
  const visita = async (id: string) =>
    (await api.admin.query('select usuario_id, checkout_em, checkout_id, resultado, etapas_pendentes from core.visita where id = $1', [id])).rows[0] as
      | { usuario_id: string; checkout_em: Date | null; checkout_id: string | null; resultado: string | null; etapas_pendentes: number }
      | undefined;
  const etapas = async (vid: string): Promise<EtapaLinha[]> =>
    (
      await api.admin.query(
        'select id, modulo, etapa, situacao, rotulo, referencia_id, pendente_desde, resolvida_em, alertada_em from core.visita_etapa where visita_id = $1 and deleted_at is null order by modulo, etapa',
        [vid],
      )
    ).rows as EtapaLinha[];
  const etapaPesquisa = async (vid: string) => (await etapas(vid)).find((e) => e.modulo === 'pesquisa' && e.etapa === ETAPA);
  const eventos = async (nome: string, agregado: string) =>
    Number((await api.admin.query('select count(*)::int as n from plataforma.evento where nome = $1 and agregado_id = $2', [nome, agregado])).rows[0].n);
  const auditorias = async (entidadeId: string) =>
    (await api.admin.query("select usuario_id, depois from plataforma.auditoria where acao = 'visita.dispensar_etapa' and entidade_id = $1", [entidadeId])).rows as Array<{
      usuario_id: string;
      depois: Record<string, unknown>;
    }>;
  const notificacoes = async (envioId: string) =>
    (await api.admin.query('select usuario_id, titulo, corpo, link from core.notificacao where envio_id = $1 order by titulo', [envioId])).rows as Array<{
      usuario_id: string;
      titulo: string;
      corpo: string;
      link: string | null;
    }>;
  /** `etapas_pendentes` da visita como o APARELHO a vê depois do pull (motor real; espera o horizonte de 2 s do pull). */
  const pendentesNoAparelho = async (email: string, vid: string, tenant: typeof A | typeof B = A): Promise<number | undefined | null> => {
    await esperarHorizonte();
    const ap = await aparelhoCampo(api, email, { tenant });
    expect(await ap.sincronizar(), ap.motor.estado().erro ?? '').toBe(true);
    const linha = (await ap.motor.linhas<LinhaSync & { etapas_pendentes?: number }>('visita')).find((l) => l.id === vid);
    if (!linha) return null;
    return linha.etapas_pendentes;
  };
  const despachar = async () => {
    const d = criarDespachante({ worker, app: criarBancoApp(api.pool), modulos: api.modulos });
    for (let i = 0; i < 40; i += 1) if ((await d.ciclo()).lidos === 0) return;
    throw new Error('a outbox não esvaziou em 40 ciclos');
  };
  /**
   * Varredura do alerta do Core em A, como o agendador rodaria: transação do tenant, usuário de sistema (perfil admin, como o
   * despachante), consultas e publicador reais da API. O agendador do worker chamando a tarefa do Core é o TP-15 (it.todo).
   */
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
  const recuarPendencia = (linhaId: string, horas: number) =>
    api.admin.query(`update core.visita_etapa set pendente_desde = now() - make_interval(mins => $2::int) where id = $1`, [linhaId, Math.round(horas * 60)]);
  const dispensar = (token: string, vid: string, justificativa: string, etapa = ETAPA) =>
    api.chamar(token, { method: 'POST', url: `/v1/core/visitas/${vid}/etapas/pesquisa/${encodeURIComponent(etapa)}/dispensa`, payload: { justificativa } });
  const ligar = async (token: string, nivel: 'tenant' | 'perfil', ativo: boolean, perfil?: string) => {
    const r = await licenca(api, token, nivel, 'pesquisa', ativo, perfil);
    expect(r.statusCode, r.body).toBe(200);
  };
  /** Visita do vendedor com checkout aceito SEM a resposta: 1 pendência (cenário base de TP-02, TP-07..TP-12, TP-14). */
  const visitaComPendencia = async (token: string, cliente: string): Promise<{ vid: string; linha: EtapaLinha }> => {
    const vid = randomUUID();
    expect(status(await push(token, [checkin(vid, cliente), checkout(randomUUID(), vid)]))).toEqual([
      ['aceito', null],
      ['aceito', null],
    ]);
    const linha = await etapaPesquisa(vid);
    expect(linha, 'pendência gravada no checkout').toMatchObject({ situacao: 'pendente' });
    expect(await visita(vid)).toMatchObject({ etapas_pendentes: 1 });
    return { vid, linha: linha! };
  };

  beforeAll(async () => {
    api = await subirApi();
    if (!api.banco.urlWorker) throw new Error('banco de teste sem urlWorker (MACUXI_PG_WORKER_SENHA): a baixa precisa do despachante');
    worker = new pg.Pool({ connectionString: api.banco.urlWorker, max: 2 });
    tk.admin = (await api.sessao('admin@exemplo.com.br')).access_token;
    tk.adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
    await ligar(tk.admin, 'tenant', true);
    for (const perfil of ['vendedor', 'promotor', 'supervisor']) await ligar(tk.admin, 'perfil', true, perfil);
    tk.vendedor1 = (await api.sessao('vendedor@exemplo.com.br')).access_token;
    tk.vendedor2 = (await api.sessao('vendedor2@exemplo.com.br')).access_token;
    tk.supervisor = (await api.sessao('supervisor@exemplo.com.br')).access_token;
    tk.promotor = (await api.sessao('promotor@exemplo.com.br')).access_token;
    // eventos antigos da fixture não podem segurar a fila do despachante
    await despachar();
    await esperarHorizonte();
  });
  afterAll(async () => {
    await worker?.end().catch(() => undefined);
    await api?.fechar();
  });
  // cada cenário começa sem atendimento aberto dos usuários de campo (um caso que falha não contamina o seguinte)
  beforeEach(async () => {
    await api.admin.query(
      "update core.visita set checkout_em = now(), resultado = 'nao_finalizado', fechada_por = 'auto' where usuario_id = any($1::uuid[]) and checkout_em is null",
      [[U.vendedor1, U.vendedor2, U.promotor]],
    );
  });

  // ---------------------------------------------------------------------------------------------------------------------
  // Checkout: pendência, resposta no mesmo lote, regras do Core
  // ---------------------------------------------------------------------------------------------------------------------

  it('TP-01 RN-CORE-12 (complemento): checkout com a pesquisa obrigatória NÃO respondida é aceito com 1 pendência (rótulo e pendente_desde do servidor), etapas_pendentes = 1 no banco e no pull do aparelho; reenvio do lote não duplica', async () => {
    const vid = randomUUID();
    const cmd = randomUUID();
    const antes = Date.now();
    const lote = [checkin(vid, C.c1), checkout(cmd, vid)];
    expect(status(await push(tk.vendedor1, lote))).toEqual([
      ['aceito', null],
      ['aceito', null],
    ]);
    expect(await visita(vid), 'a visita fica concluída').toMatchObject({ checkout_id: cmd, resultado: 'sem_pedido', etapas_pendentes: 1 });
    const linhas = await etapas(vid);
    expect(linhas.map(resumo)).toEqual([{ modulo: 'pesquisa', etapa: ETAPA, situacao: 'pendente' }]);
    expect(linhas[0]).toMatchObject({ rotulo: ROTULO, resolvida_em: null, alertada_em: null });
    // instante do SERVIDOR (não o checkout_em do aparelho, que é 1 min atrás)
    expect(linhas[0]!.pendente_desde!.getTime()).toBeGreaterThanOrEqual(antes - 5_000);
    expect(await eventos('core.visita.checkout@1', vid)).toBe(1);

    expect(status(await push(tk.vendedor1, lote))).toEqual([
      ['aceito', null],
      ['aceito', null],
    ]);
    expect(await etapas(vid)).toHaveLength(1);
    expect(await visita(vid)).toMatchObject({ etapas_pendentes: 1 });
    expect(await eventos('core.visita.checkout@1', vid)).toBe(1);

    expect(await pendentesNoAparelho('vendedor@exemplo.com.br', vid)).toBe(1);
  });

  it('TP-03 RN-CORE-12/RN-PES-03: resposta ANTES do checkout no mesmo lote → checkout aceito SEM pendência (etapa concluída pela consulta do servidor), etapas_pendentes = 0 no banco e no pull; reenvio do lote não duplica', async () => {
    const vid = randomUUID();
    const rid = randomUUID();
    const cmd = randomUUID();
    const lote = [checkin(vid, C.c1), resposta(rid, vid, C.c1), checkout(cmd, vid)];
    expect((await push(tk.vendedor1, lote)).map((r) => r.status)).toEqual(['aceito', 'aceito', 'aceito']);
    expect(await visita(vid)).toMatchObject({ checkout_id: cmd, resultado: 'sem_pedido', etapas_pendentes: 0 });
    expect((await etapas(vid)).map(resumo), 'a etapa da Pesquisa fica concluída, verificada pelo servidor').toEqual([{ modulo: 'pesquisa', etapa: ETAPA, situacao: 'concluida' }]);
    expect(await eventos('pesquisa.resposta.registrada@1', rid)).toBe(1);

    expect((await push(tk.vendedor1, lote)).map((r) => r.status)).toEqual(['aceito', 'aceito', 'aceito']);
    expect(await etapas(vid)).toHaveLength(1);
    expect(await eventos('pesquisa.resposta.registrada@1', rid)).toBe(1);
    expect(await eventos('core.visita.checkout@1', vid)).toBe(1);

    // o evento da resposta chega ao Core depois do checkout e não muda nada (a linha já está concluída)
    await despachar();
    expect((await etapas(vid)).map(resumo)).toEqual([{ modulo: 'pesquisa', etapa: ETAPA, situacao: 'concluida' }]);
    expect(await pendentesNoAparelho('vendedor@exemplo.com.br', vid)).toBe(0);
  });

  it('TP-04 RN-CORE-12: resposta REJEITADA no mesmo lote antes do checkout (questionário inexistente) → resposta rejeitada, checkout aceito com 1 pendência (o checkout não fica preso)', async () => {
    const vid = randomUUID();
    const rid = randomUUID();
    const r = await push(tk.vendedor1, [checkin(vid, C.c1), resposta(rid, vid, C.c1, { questionario_id: randomUUID(), versao_id: randomUUID() }), checkout(randomUUID(), vid)]);
    expect(status(r)).toEqual([
      ['aceito', null],
      ['rejeitado', 'QUESTIONARIO_INEXISTENTE'],
      ['aceito', null],
    ]);
    expect(await visita(vid)).toMatchObject({ etapas_pendentes: 1 });
    expect((await etapaPesquisa(vid))?.situacao).toBe('pendente');
  });

  it('TP-05 módulo desligado (ConsultaIndisponivel): com a Pesquisa desligada no tenant, checkout sem resposta é aceito sem etapa da Pesquisa e sem pendência', async () => {
    await ligar(tk.admin, 'tenant', false);
    try {
      const vid = randomUUID();
      const cmd = randomUUID();
      expect((await push(tk.vendedor1, [checkin(vid, C.c3), checkout(cmd, vid)])).map((x) => x.status)).toEqual(['aceito', 'aceito']);
      expect(await visita(vid)).toMatchObject({ checkout_id: cmd, etapas_pendentes: 0 });
      expect((await etapas(vid)).filter((e) => e.modulo === 'pesquisa')).toEqual([]);
    } finally {
      await ligar(tk.admin, 'tenant', true);
    }
  });

  it('TP-06 RN-CORE-12: motivo de "sem pedido" fora da lista do tenant (inexistente ou de B) → item rejeitado MOTIVO_INVALIDO; visita segue aberta, nenhuma etapa nem pendência gravada, nenhum checkout publicado', async () => {
    for (const motivo of [randomUUID(), B.motivos.inadimplente]) {
      // com a resposta no lote (a pesquisa não é a causa) e sem ela (a regra do Core vem antes da tolerância)
      const casos: Array<{ vid: string; cmd: string; itens: (vid: string, cmd: string) => ItemPush[] }> = [
        { vid: randomUUID(), cmd: randomUUID(), itens: (v, c) => [checkin(v, C.c1), resposta(randomUUID(), v, C.c1), checkout(c, v, { motivo_id: motivo })] },
        { vid: randomUUID(), cmd: randomUUID(), itens: (v, c) => [checkin(v, C.c3), checkout(c, v, { motivo_id: motivo })] },
      ];
      for (const k of casos) {
        const r = await push(tk.vendedor1, k.itens(k.vid, k.cmd));
        expect(status(r).at(-1)).toEqual(['rejeitado', 'MOTIVO_INVALIDO']);
        expect(r.slice(0, -1).every((x) => x.status === 'aceito')).toBe(true);
        expect(await visita(k.vid), 'nada do checkout gravado').toMatchObject({ checkout_em: null, checkout_id: null, resultado: null, etapas_pendentes: 0 });
        expect(await etapas(k.vid)).toEqual([]);
        expect(await eventos('core.visita.checkout@1', k.vid)).toBe(0);
        expect(Number((await api.admin.query('select count(*)::int as n from core.visita where checkout_id = $1', [k.cmd])).rows[0].n)).toBe(0);
        await api.admin.query("update core.visita set checkout_em = now(), resultado = 'nao_finalizado', fechada_por = 'auto' where usuario_id = $1 and checkout_em is null", [U.vendedor1]);
      }
    }
  });

  // ---------------------------------------------------------------------------------------------------------------------
  // Baixa pelo evento pesquisa.resposta.registrada@1 (despachante real)
  // ---------------------------------------------------------------------------------------------------------------------

  it('TP-02 RN-CORE-12: a resposta da MESMA visita chega num push seguinte → o despachante entrega pesquisa.resposta.registrada@1 ao Core, que reconsulta e baixa (concluida, resolvida_em, referencia_id = resposta); etapas_pendentes = 0 no banco e no pull; reentregar não muda nada', async () => {
    const { vid, linha } = await visitaComPendencia(tk.vendedor1, C.c1);
    expect(await pendentesNoAparelho('vendedor@exemplo.com.br', vid)).toBe(1);
    const rid = randomUUID();
    const item = resposta(rid, vid, C.c1);
    expect(status(await push(tk.vendedor1, [item]))).toEqual([['aceito', null]]);
    expect((await etapaPesquisa(vid))?.situacao, 'a baixa é assíncrona: antes do despacho segue pendente').toBe('pendente');
    await despachar();
    const depois = await etapaPesquisa(vid);
    expect(depois).toMatchObject({ id: linha.id, situacao: 'concluida', referencia_id: rid, alertada_em: null });
    expect(depois!.resolvida_em).not.toBeNull();
    expect(depois!.pendente_desde, 'pendente_desde fica como histórico').not.toBeNull();
    expect(await visita(vid)).toMatchObject({ etapas_pendentes: 0 });
    // o aparelho reenvia a MESMA resposta (não recebeu o aceite): duplicada, sem evento novo; novo despacho não muda nada
    expect(status(await push(tk.vendedor1, [item]))).toEqual([['aceito', null]]);
    expect(await eventos('pesquisa.resposta.registrada@1', rid)).toBe(1);
    await despachar();
    expect(await etapaPesquisa(vid)).toMatchObject({ situacao: 'concluida', referencia_id: rid, resolvida_em: depois!.resolvida_em });
    expect(await visita(vid)).toMatchObject({ etapas_pendentes: 0 });
    expect(await pendentesNoAparelho('vendedor@exemplo.com.br', vid)).toBe(0);
  });

  it('TP-07 RN-CORE-12: resposta de OUTRA visita e resposta sem visita_id não baixam a pendência; a da visita certa baixa', async () => {
    const { vid } = await visitaComPendencia(tk.vendedor1, C.c1);
    expect(status(await push(tk.vendedor1, [resposta(randomUUID(), randomUUID(), C.c1), resposta(randomUUID(), null, C.c1)]))).toEqual([
      ['aceito', null],
      ['aceito', null],
    ]);
    await despachar();
    expect((await etapaPesquisa(vid))?.situacao).toBe('pendente');
    expect(await visita(vid)).toMatchObject({ etapas_pendentes: 1 });
    expect(status(await push(tk.vendedor1, [resposta(randomUUID(), vid, C.c1)]))).toEqual([['aceito', null]]);
    await despachar();
    expect((await etapaPesquisa(vid))?.situacao).toBe('concluida');
    expect(await visita(vid)).toMatchObject({ etapas_pendentes: 0 });
  });

  // ---------------------------------------------------------------------------------------------------------------------
  // Alerta no prazo (checkout_pendencia_alerta_h, padrão 24 h)
  // ---------------------------------------------------------------------------------------------------------------------

  it('TP-08 RN-CORE-12: 24 h sem baixa → UMA notificação ao vendedor e UMA ao supervisor da equipe, com os textos da especificação (§1.3 e §2.1); alertada_em gravada; rodar de novo não repete; a pendência continua (a reconsulta pelo usuário de sistema não baixa sem a resposta)', async () => {
    const { vid, linha } = await visitaComPendencia(tk.vendedor1, C.c1);
    await recuarPendencia(linha.id, 24 + 1 / 60);
    await rodarAlerta();
    const ns = await notificacoes(linha.id);
    const ck = (await api.admin.query('select checkin_em from core.visita where id = $1', [vid])).rows[0].checkin_em as Date;
    const ddmm = new Intl.DateTimeFormat('pt-BR', { timeZone: A.fuso, day: '2-digit', month: '2-digit' }).format(ck);
    expect(ns.map((n) => n.usuario_id).sort()).toEqual([U.supervisor, U.vendedor1].sort());
    expect(ns.find((n) => n.usuario_id === U.vendedor1)).toMatchObject({
      titulo: 'Etapa pendente na visita a Auto Peças Um',
      corpo: `${ROTULO} · visita de ${ddmm} · confira a fila do aparelho ou fale com seu supervisor`,
      link: `/m/cliente?id=${C.c1}`,
    });
    expect(ns.find((n) => n.usuario_id === U.supervisor)).toMatchObject({
      titulo: 'Etapa pendente na visita de Vendedor a Auto Peças Um',
      corpo: `${ROTULO} · visita de ${ddmm} · não chegou em 24 h`,
    });
    const alertada = await etapaPesquisa(vid);
    expect(alertada).toMatchObject({ situacao: 'pendente' });
    expect(alertada!.alertada_em).not.toBeNull();
    expect(await visita(vid)).toMatchObject({ etapas_pendentes: 1 });

    await rodarAlerta();
    expect(await notificacoes(linha.id)).toHaveLength(2);
    expect((await etapaPesquisa(vid))!.alertada_em).toEqual(alertada!.alertada_em);
  });

  it('TP-09 RN-CORE-12: antes do prazo (23 h) não alerta; pendência baixada antes do prazo não alerta depois', async () => {
    const cedo = await visitaComPendencia(tk.vendedor1, C.c1);
    await recuarPendencia(cedo.linha.id, 23);
    await rodarAlerta();
    expect(await notificacoes(cedo.linha.id)).toEqual([]);
    expect((await etapaPesquisa(cedo.vid))!.alertada_em).toBeNull();

    // a resposta chega e baixa; depois o tempo passa do prazo: nada a alertar
    expect(status(await push(tk.vendedor1, [resposta(randomUUID(), cedo.vid, C.c1)]))).toEqual([['aceito', null]]);
    await despachar();
    await recuarPendencia(cedo.linha.id, 30);
    await rodarAlerta();
    expect(await notificacoes(cedo.linha.id)).toEqual([]);
    expect(await etapaPesquisa(cedo.vid)).toMatchObject({ situacao: 'concluida', alertada_em: null });
  });

  it('TP-17 RN-CORE-12: com checkout_pendencia_alerta_h = 2 no tenant (PUT do admin), a pendência de 2 h já alerta e o corpo do supervisor diz "não chegou em 2 h"', async () => {
    const put = (valor: number) =>
      api.chamar(tk.admin, { method: 'PUT', url: '/v1/core/parametros/checkout-pendencia', payload: { checkout_pendencia_alerta_h: valor } });
    expect((await put(2)).statusCode).toBe(200);
    try {
      const { linha } = await visitaComPendencia(tk.vendedor1, C.c1);
      await recuarPendencia(linha.id, 1.5);
      await rodarAlerta();
      expect(await notificacoes(linha.id), '1 h 30 < 2 h: ainda não').toEqual([]);
      await recuarPendencia(linha.id, 2 + 1 / 60);
      await rodarAlerta();
      const sup = (await notificacoes(linha.id)).find((n) => n.usuario_id === U.supervisor);
      expect(sup?.corpo).toMatch(/ · não chegou em 2 h$/);
    } finally {
      expect((await put(24)).statusCode).toBe(200);
    }
  });

  // ---------------------------------------------------------------------------------------------------------------------
  // Dispensa manual (§2.5a) e multi-tenant
  // ---------------------------------------------------------------------------------------------------------------------

  it('TP-10 RN-CORE-12 §2.5a: o supervisor da equipe dispensa com justificativa → 200 (dispensada, alterada, etapas_pendentes 0), auditoria com ator e justificativa, pull com 0; segunda dispensa 200 sem mudança nem auditoria nova; justificativa curta → 400 e nada muda', async () => {
    const { vid, linha } = await visitaComPendencia(tk.vendedor1, C.c1);
    const curta = await dispensar(tk.supervisor, vid, 'ok');
    expect(curta.statusCode, curta.body).toBe(400);
    expect((await etapaPesquisa(vid))?.situacao).toBe('pendente');

    const justificativa = 'Cliente respondeu no papel; conferido na loja';
    const r = await dispensar(tk.supervisor, vid, justificativa);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({ visita_id: vid, modulo: 'pesquisa', etapa: ETAPA, situacao: 'dispensada', alterada: true, etapas_pendentes: 0 });
    const linhaDepois = await etapaPesquisa(vid);
    expect(linhaDepois).toMatchObject({ situacao: 'dispensada' });
    expect(linhaDepois!.resolvida_em).not.toBeNull();
    expect(await visita(vid)).toMatchObject({ etapas_pendentes: 0 });
    const aud = await auditorias(linha.id);
    expect(aud).toHaveLength(1);
    expect(aud[0]!.usuario_id).toBe(U.supervisor);
    expect(aud[0]!.depois).toMatchObject({ situacao: 'dispensada', visita_id: vid, modulo: 'pesquisa', etapa: ETAPA, justificativa });

    const de_novo = await dispensar(tk.supervisor, vid, justificativa);
    expect(de_novo.statusCode, de_novo.body).toBe(200);
    expect(de_novo.json()).toMatchObject({ situacao: 'dispensada', alterada: false, etapas_pendentes: 0 });
    expect(await auditorias(linha.id)).toHaveLength(1);
    expect(await pendentesNoAparelho('vendedor@exemplo.com.br', vid)).toBe(0);
  });

  it('TP-11 RN-CORE-12 §2.5a / RN-PRO-01: vendedor (dono da visita) e promotor → 403 PERFIL_SEM_ACESSO na dispensa; nada muda', async () => {
    const { vid, linha } = await visitaComPendencia(tk.vendedor1, C.c1);
    for (const token of [tk.vendedor1, tk.promotor]) {
      const r = await dispensar(token, vid, 'Tentativa sem permissão');
      expect(r.statusCode, r.body).toBe(403);
      expect(erroDe(r).codigo).toBe('PERFIL_SEM_ACESSO');
    }
    expect((await etapaPesquisa(vid))?.situacao).toBe('pendente');
    expect(await visita(vid)).toMatchObject({ etapas_pendentes: 1 });
    expect(await auditorias(linha.id)).toEqual([]);
  });

  it('TP-12 RN-CORE-12 §2.5a / RN-CORE-04: supervisor fora da equipe da visita (vendedor-2, equipe 2) não dispensa (404, a visita não existe para ele); o admin do tenant dispensa', async () => {
    const { vid, linha } = await visitaComPendencia(tk.vendedor2, C.c2);
    const r = await dispensar(tk.supervisor, vid, 'Fora da minha equipe');
    // desenho §2.5a item 4 fala em 403; a API segue o padrão do escopo (fora do escopo = não encontrado). Ver docs/testes/T-0039.md
    expect(r.statusCode, r.body).toBe(404);
    expect(erroDe(r).codigo).toBe('VISITA_NAO_ENCONTRADA');
    expect((await etapaPesquisa(vid))?.situacao).toBe('pendente');
    const adm = await dispensar(tk.admin, vid, 'Dispensada pelo admin do tenant');
    expect(adm.statusCode, adm.body).toBe(200);
    expect(adm.json()).toMatchObject({ situacao: 'dispensada', alterada: true, etapas_pendentes: 0 });
    expect((await auditorias(linha.id))[0]?.usuario_id).toBe(U.admin);
  });

  it('TP-14 multi-tenant: o admin de B não acha a visita de A na dispensa (404) e nada muda; o pull do vendedor de B não traz a visita de A', async () => {
    const { vid } = await visitaComPendencia(tk.vendedor1, C.c1);
    const r = await dispensar(tk.adminB, vid, 'Tentativa de outro tenant');
    expect(r.statusCode, r.body).toBe(404);
    expect(erroDe(r).codigo).toBe('VISITA_NAO_ENCONTRADA');
    expect((await etapaPesquisa(vid))?.situacao).toBe('pendente');
    expect(await visita(vid)).toMatchObject({ etapas_pendentes: 1 });
    expect(await pendentesNoAparelho('vendedor@exemplo.com.br', vid, B)).toBeNull();
  });

  // ---------------------------------------------------------------------------------------------------------------------
  // Promotor (RN-PRO-01): sem pedido e sem ação nova
  // ---------------------------------------------------------------------------------------------------------------------

  it('TP-13 RN-PRO-01: a tolerância não dá ação nova ao promotor nem cria ação de pedido; o checkout do promotor fecha como atendido, sem pendência (a pesquisa obrigatória de A é só do vendedor), e sem_pedido continua recusado', async () => {
    const acoes = manifestoCore.acoes as Record<string, { perfis: readonly string[] }>;
    for (const a of ['visita.dispensar_etapa', 'parametro.checkout_pendencia']) {
      expect(acoes[a], `ação ${a} declarada no manifesto do Core`).toBeDefined();
      expect(acoes[a]!.perfis).not.toContain('promotor');
      expect(acoes[a]!.perfis).not.toContain('vendedor');
      expect(ehAcaoDePedido(a)).toBe(false);
    }
    expect(Object.entries(acoes).filter(([k, a]) => ehAcaoDePedido(k) && a.perfis.includes('promotor'))).toEqual([]);

    const vid = randomUUID();
    expect(status(await push(tk.promotor, [checkin(vid, C.c1), checkout(randomUUID(), vid)]))).toEqual([
      ['aceito', null],
      ['rejeitado', 'RN-CORE-12'],
    ]);
    const cmd = randomUUID();
    expect(status(await push(tk.promotor, [checkout(cmd, vid, { resultado: 'atendido', motivo_id: null })]))).toEqual([['aceito', null]]);
    expect(await visita(vid)).toMatchObject({ checkout_id: cmd, resultado: 'atendido', etapas_pendentes: 0 });
    expect((await etapas(vid)).filter((e) => e.situacao === 'pendente')).toEqual([]);
    expect(await pendentesNoAparelho('promotor@exemplo.com.br', vid)).toBe(0);
  });

  // ---------------------------------------------------------------------------------------------------------------------
  // Alerta sozinho: agendador do worker (ADR 0022) com plataforma.tenants_ativos() (0027) pelo macuxi_worker
  // ---------------------------------------------------------------------------------------------------------------------

  it.todo(
    'TP-15 RN-CORE-12 / RN-CORE-23: o agendador do worker (criarAgendador real, tenants de plataforma.tenants_ativos() pelo macuxi_worker) roda core.alerta_pendencia_checkout em A e B, alerta a pendência de 24 h uma vez só, não volta antes de 60 min; macuxi_app → 42501 na função — bloqueado: apps/api/src/agendador.ts:187 (timer.unref) não compila sob o tests/tsconfig.json (lib DOM: setTimeout devolve number); pedido ao engenheiro-software',
  );
});

describe.skipIf(semBanco())('T-0039 §2 — prazo do alerta (checkout_pendencia_alerta_h) × API real × Postgres', () => {
  let api: ApiDeTeste;
  const parametro = (token: string, valor?: unknown) =>
    api.chamar(token, { method: valor === undefined ? 'GET' : 'PUT', url: '/v1/core/parametros/checkout-pendencia', ...(valor === undefined ? {} : { payload: { checkout_pendencia_alerta_h: valor } }) });

  beforeAll(async () => {
    api = await subirApi();
  });
  afterAll(async () => {
    await api?.fechar();
  });

  it('TP-16 RN-CORE-12: só o admin muda o prazo (1..168 h, padrão 24, auditado); vendedor, supervisor e promotor → 403; fora da faixa → 400; outro tenant segue no padrão', async () => {
    const admin = (await api.sessao('admin@exemplo.com.br')).access_token;
    const adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
    const padrao = await parametro(admin);
    expect(padrao.statusCode, padrao.body).toBe(200);
    expect(padrao.json()).toEqual({ checkout_pendencia_alerta_h: 24 });
    for (const email of ['vendedor@exemplo.com.br', 'supervisor@exemplo.com.br', 'promotor@exemplo.com.br']) {
      const t = (await api.sessao(email)).access_token;
      const r = await parametro(t, 2);
      expect(r.statusCode, `${email}: ${r.body}`).toBe(403);
    }
    for (const ruim of [0, 169, 2.5, '2']) expect((await parametro(admin, ruim)).statusCode, String(ruim)).toBe(400);
    const r = await parametro(admin, 2);
    expect(r.statusCode, r.body).toBe(200);
    expect((await parametro(admin)).json()).toEqual({ checkout_pendencia_alerta_h: 2 });
    const aud = (await api.admin.query("select usuario_id, antes, depois from plataforma.auditoria where acao = 'parametro.checkout_pendencia' and tenant_id = $1", [A.tenantId])).rows;
    expect(aud).toEqual([{ usuario_id: U.admin, antes: { checkout_pendencia_alerta_h: 24 }, depois: { checkout_pendencia_alerta_h: 2 } }]);
    expect((await parametro(adminB)).json(), 'B não vê o parâmetro de A').toEqual({ checkout_pendencia_alerta_h: 24 });
  });
});
