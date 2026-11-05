/**
 * T-0039 §2 (RN-CORE-12, complemento): baixa por pesquisa.resposta.registrada@1, alerta de 24 h e dispensa manual.
 * Sem banco: o `db` falso responde por trecho de SQL e guarda os comandos. Relógio injetado (sem Date.now).
 */
import { describe, expect, it, vi } from 'vitest';
import type { ClienteBanco, ContextoConsumo } from '@macuxi/platform-sdk';
import { alertarPendenciasVencidas, consumidorBaixaPorResposta, rotasDePendenciaCheckout } from './etapas-pendencia';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const VISITA = uuid(1);
const CLIENTE = uuid(2);
const VENDEDOR = uuid(3);
const SUPERVISOR = uuid(4);
const ETAPA_ID = uuid(5);
const RESPOSTA = uuid(6);
const AGORA = new Date('2026-11-05T12:00:00.000Z');

interface Cenario {
  etapas?: { situacao: string; alertada_em?: Date | null; pendente_desde?: Date }[];
  concluidaNoModulo?: boolean;
  prazo?: unknown;
  visitaDe?: string;
}

function montar(c: Cenario = {}) {
  const comandos: string[] = [];
  const params: unknown[][] = [];
  const etapas = (c.etapas ?? [{ situacao: 'pendente' }]).map((e) => ({
    id: ETAPA_ID,
    visita_id: VISITA,
    modulo: 'pesquisa',
    etapa: 'pesquisa.obrigatoria',
    rotulo: 'Pesquisa obrigatória: "Gôndola do mês"',
    pendente_desde: new Date('2026-11-04T08:00:00.000Z'),
    alertada_em: null,
    ...e,
  }));
  const db = {
    query: vi.fn(async (sql: string, p: unknown[] = []) => {
      comandos.push(sql);
      params.push(p);
      if (sql.includes('from core.visita_etapa\n        where visita_id = $1')) return { rows: etapas };
      if (sql.includes('select cliente_id, usuario_id from core.visita where id = $1')) return { rows: [{ cliente_id: CLIENTE, usuario_id: VENDEDOR }] };
      if (sql.includes('from plataforma.parametro')) return { rows: c.prazo === undefined ? [] : [{ valor: c.prazo }] };
      if (sql.includes('from core.visita_etapa e\n         join core.visita v')) {
        return {
          rows: etapas
            .filter((e) => e.situacao === 'pendente' && !e.alertada_em)
            .map((e) => ({ ...e, cliente_id: CLIENTE, usuario_id: VENDEDOR, checkin_em: new Date('2026-11-04T07:30:00.000Z'), cliente_nome: 'Mercado Boa Vista', vendedor_nome: 'Maria Souza', supervisor_id: SUPERVISOR })),
        };
      }
      if (sql.includes('select situacao, alertada_em from core.visita_etapa where id = $1')) return { rows: [{ situacao: etapas[0]?.situacao ?? 'pendente', alertada_em: etapas[0]?.alertada_em ?? null }] };
      if (sql.includes('insert into core.notificacao')) return { rows: [{ id: uuid(900 + comandos.length) }] };
      if (sql.includes('returning v.etapas_pendentes')) return { rows: [{ n: 0 }] };
      return { rows: [] };
    }),
  } as unknown as ClienteBanco;
  const consultar = vi.fn(async () => ({ etapas: [{ etapa: 'pesquisa.obrigatoria', rotulo: 'Pesquisa obrigatória', obrigatoria: true, concluida: c.concluidaNoModulo ?? false }] }));
  const publicar = vi.fn(async () => undefined);
  const ctx = {
    db,
    consultar,
    publicar,
    fuso: () => 'America/Manaus',
    agora: () => AGORA,
    envelope: { evento: 'pesquisa.resposta.registrada@1' },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as unknown as ContextoConsumo;
  return { ctx, consultar, publicar, comandos, params, db };
}

const evento = (visita: string | null = VISITA) => ({
  resposta_id: RESPOSTA,
  tenant_id: uuid(10),
  questionario_id: uuid(11),
  versao_id: uuid(12),
  usuario_id: VENDEDOR,
  equipe_id: null,
  cliente_id: CLIENTE,
  visita_id: visita,
  modo: 'visita',
  respondida_em: '2026-11-05T11:00:00.000Z',
  recebida_em: '2026-11-05T11:00:01.000Z',
  total_itens: 1,
  suspeita: false,
});

describe('RN-CORE-12: baixa da pendência por pesquisa.resposta.registrada@1', () => {
  it('RN-CORE-12: a resposta registrada + reconsulta concluída baixa a pendência (concluida, resolvida_em, referencia = resposta) e recalcula a contagem', async () => {
    const t = montar({ concluidaNoModulo: true });
    await consumidorBaixaPorResposta.executar(evento() as never, t.ctx);
    expect(t.consultar).toHaveBeenCalledTimes(1);
    const up = t.comandos.findIndex((s) => s.includes("set situacao = 'concluida'"));
    expect(up).toBeGreaterThan(-1);
    expect(t.params[up]).toEqual([VISITA, 'pesquisa', 'pesquisa.obrigatoria', AGORA.toISOString(), RESPOSTA]);
    expect(t.comandos.some((s) => s.includes('set etapas_pendentes'))).toBe(true);
  });

  it('RN-CORE-12: a baixa remove (deleted_at e updated_at) as notificações da pendência, na mesma transação', async () => {
    const t = montar({ concluidaNoModulo: true });
    await consumidorBaixaPorResposta.executar(evento() as never, t.ctx);
    const n = t.comandos.findIndex((s) => s.includes('update core.notificacao set deleted_at'));
    expect(n).toBeGreaterThan(-1);
    expect(t.comandos[n]).toContain('updated_at');
    expect(t.comandos[n]).toContain('deleted_at is null');
    expect(t.params[n]).toEqual([ETAPA_ID, AGORA.toISOString()]);
    expect(n).toBeGreaterThan(t.comandos.findIndex((s) => s.includes("set situacao = 'concluida'")));
  });

  it('RN-CORE-12: sem baixa (reconsulta ainda pendente) as notificações ficam', async () => {
    const t = montar({ concluidaNoModulo: false });
    await consumidorBaixaPorResposta.executar(evento() as never, t.ctx);
    expect(t.comandos.some((s) => s.includes('update core.notificacao'))).toBe(false);
  });

  it('RN-CORE-12: o alerta grava o subtipo etapa_pendente_checkout', async () => {
    const t = montar();
    await alertarPendenciasVencidas(t.ctx);
    const i = t.comandos.findIndex((s) => s.includes('insert into core.notificacao'));
    expect(t.comandos[i]).toContain("'etapa_pendente_checkout'");
  });

  it('RN-CORE-12: uma resposta que não cobre todas as obrigatórias NÃO baixa (a reconsulta manda)', async () => {
    const t = montar({ concluidaNoModulo: false });
    await consumidorBaixaPorResposta.executar(evento() as never, t.ctx);
    expect(t.comandos.some((s) => s.includes("set situacao = 'concluida'"))).toBe(false);
  });

  it('RN-CORE-12: idempotente — repetir o evento sobre linha já concluída não consulta nem muda nada', async () => {
    const t = montar({ etapas: [{ situacao: 'concluida' }], concluidaNoModulo: true });
    await consumidorBaixaPorResposta.executar(evento() as never, t.ctx);
    expect(t.consultar).not.toHaveBeenCalled();
    expect(t.comandos.some((s) => s.includes('update core.visita_etapa') || s.includes('update core.visita v'))).toBe(false);
  });

  it('RN-CORE-12: resposta sem visita (ou evento antes do checkout, sem linha) não faz nada', async () => {
    const a = montar();
    await consumidorBaixaPorResposta.executar(evento(null) as never, a.ctx);
    expect(a.db.query).not.toHaveBeenCalled();
    const b = montar({ etapas: [] });
    await consumidorBaixaPorResposta.executar(evento() as never, b.ctx);
    expect(b.consultar).not.toHaveBeenCalled();
  });
});

describe('RN-CORE-12: ordem de trava da baixa', () => {
  it('RN-CORE-12: reconsultarEBaixar trava core.visita ANTES de core.visita_etapa (mesma ordem do checkout e da dispensa; sem deadlock)', async () => {
    const t = montar({ concluidaNoModulo: true });
    await consumidorBaixaPorResposta.executar(evento() as never, t.ctx);
    const iVisita = t.comandos.findIndex((s) => s.includes('from core.visita where id = $1') && s.includes('for update'));
    const iEtapa = t.comandos.findIndex((s) => s.includes('from core.visita_etapa') && s.includes('for update'));
    expect(iVisita).toBeGreaterThan(-1);
    expect(iEtapa).toBeGreaterThan(iVisita);
  });

  it('RN-CORE-12: o upsert do checkout não regrava linha concluída nem dispensada', async () => {
    const t = montar();
    const { gravarEtapasDoCheckout } = await import('./etapas-pendencia');
    await gravarEtapasDoCheckout(t.db, VISITA, [{ modulo: 'pesquisa', etapa: 'pesquisa.obrigatoria', situacao: 'pendente' }], AGORA);
    expect(t.comandos.some((s) => s.includes("situacao not in ('concluida', 'dispensada')"))).toBe(true);
  });
});

describe('RN-CORE-12: alerta da pendência (checkout_pendencia_alerta_h, padrão 24)', () => {
  it('RN-CORE-12: pendente há mais de 24 h notifica vendedor e supervisor UMA vez, com os textos do designer, e grava alertada_em', async () => {
    const t = montar();
    const r = await alertarPendenciasVencidas(t.ctx);
    expect(r).toEqual({ baixadas: 0, alertadas: 1, notificacoes: 2 });
    const ins = t.comandos.flatMap((s, i) => (s.includes('insert into core.notificacao') ? [i] : []));
    const [v, s] = ins.map((i) => t.params[i]!);
    expect(v).toEqual([VENDEDOR, 'Etapa pendente na visita a Mercado Boa Vista', 'Pesquisa obrigatória: "Gôndola do mês" · visita de 04/11 · confira a fila do aparelho ou fale com seu supervisor', `/m/cliente?id=${CLIENTE}`, ETAPA_ID]);
    expect(s).toEqual([SUPERVISOR, 'Etapa pendente na visita de Maria a Mercado Boa Vista', 'Pesquisa obrigatória: "Gôndola do mês" · visita de 04/11 · não chegou em 24 h', `/m/cliente?id=${CLIENTE}`, ETAPA_ID]);
    expect(t.publicar).toHaveBeenCalledTimes(2);
    const al = t.comandos.findIndex((c) => c.includes('set alertada_em'));
    expect(t.params[al]).toEqual([ETAPA_ID, AGORA.toISOString()]);
  });

  it('RN-CORE-12: a varredura filtra pelo corte do prazo do tenant (parâmetro 48 h)', async () => {
    const t = montar({ prazo: 48 });
    await alertarPendenciasVencidas(t.ctx);
    const q = t.comandos.findIndex((s) => s.includes('from core.visita_etapa e\n         join core.visita v'));
    expect((t.params[q]![0] as string)).toBe(new Date(AGORA.getTime() - 48 * 3_600_000).toISOString());
  });

  it('RN-CORE-12: pendência que a reconsulta já vê concluída é baixada e NÃO gera alerta', async () => {
    const t = montar({ concluidaNoModulo: true });
    const q = t.db.query as unknown as ReturnType<typeof vi.fn>;
    const base = q.getMockImplementation()!;
    let baixou = false;
    q.mockImplementation(async (sql: string, p?: unknown[]) => {
      if (sql.includes("set situacao = 'concluida'")) baixou = true;
      if (sql.includes('select situacao, alertada_em from core.visita_etapa where id = $1')) return { rows: [{ situacao: baixou ? 'concluida' : 'pendente', alertada_em: null }] };
      return base(sql, p);
    });
    const r = await alertarPendenciasVencidas(t.ctx);
    expect(r).toEqual({ baixadas: 1, alertadas: 0, notificacoes: 0 });
    expect(t.publicar).not.toHaveBeenCalled();
  });

  it('RN-CORE-12: já alertada não alerta de novo (uma notificação por pendência)', async () => {
    const t = montar({ etapas: [{ situacao: 'pendente', alertada_em: new Date('2026-11-05T01:00:00.000Z') }] });
    const r = await alertarPendenciasVencidas(t.ctx);
    expect(r.alertadas).toBe(0);
    expect(t.publicar).not.toHaveBeenCalled();
  });
});

describe('RN-CORE-12 / RN-AUD-01: dispensa manual da etapa pendente (T-0039 §2.5a)', () => {
  const rota = rotasDePendenciaCheckout.find((r) => r.caminho === 'visitas/:id/etapas/:modulo/:etapa/dispensa')!;

  function ctxRota(c: Cenario & { visiveis?: 'tenant' | string[] }) {
    const t = montar(c);
    const antes = t.db.query as unknown as ReturnType<typeof vi.fn>;
    const base = antes.getMockImplementation()!;
    antes.mockImplementation(async (sql: string, p?: unknown[]) => {
      if (sql.includes('select usuario_id from core.visita where id = $1')) return { rows: p?.[0] === VISITA ? [{ usuario_id: c.visitaDe ?? VENDEDOR }] : [] };
      if (sql.includes('select id, situacao from core.visita_etapa')) return { rows: (c.etapas ?? [{ situacao: 'pendente' }]).map((e) => ({ id: ETAPA_ID, situacao: e.situacao })) };
      if (sql.includes('select etapas_pendentes as n')) return { rows: [{ n: 0 }] };
      return base(sql, p);
    });
    const visiveis = c.visiveis ?? 'tenant';
    const ctx = {
      params: { id: VISITA, modulo: 'pesquisa', etapa: 'pesquisa.obrigatoria' },
      corpo: { justificativa: 'Questionário foi desativado' },
      usuario: { id: SUPERVISOR },
      requestId: 'req-1',
      agora: () => AGORA,
      usuariosVisiveis: async () => (visiveis === 'tenant' ? 'tenant' : new Set(visiveis)),
      comTenant: async (fn: (d: ClienteBanco) => Promise<unknown>) => fn(t.db),
    };
    return { t, ctx };
  }

  it('RN-CORE-12: supervisor da equipe dispensa com justificativa; grava dispensada + resolvida_em, recalcula a contagem e audita', async () => {
    const { t, ctx } = ctxRota({ visiveis: [VENDEDOR] });
    const r = await rota.executar(ctx as never);
    expect(r).toMatchObject({ visita_id: VISITA, situacao: 'dispensada', alterada: true, etapas_pendentes: 0 });
    const up = t.comandos.findIndex((s) => s.includes("set situacao = 'dispensada'"));
    expect(t.params[up]).toEqual([ETAPA_ID, AGORA.toISOString()]);
    const n = t.comandos.findIndex((s) => s.includes('update core.notificacao set deleted_at'));
    expect(t.params[n]).toEqual([ETAPA_ID, AGORA.toISOString()]);
    const aud = t.comandos.findIndex((s) => s.includes('plataforma.auditoria'));
    expect(t.params[aud]![1]).toBe('visita.dispensar_etapa');
    expect(String(t.params[aud]![5])).toContain('Questionário foi desativado');
  });

  it('RN-CORE-12: supervisor de outra equipe (visita fora do escopo) recebe 404 e nada muda', async () => {
    const { t, ctx } = ctxRota({ visiveis: [uuid(77)] });
    await expect(rota.executar(ctx as never)).rejects.toMatchObject({ status: 404, codigo: 'VISITA_NAO_ENCONTRADA' });
    expect(t.comandos.some((s) => s.includes('update core.visita_etapa'))).toBe(false);
  });

  it('RN-CORE-12: segunda dispensa é 200 sem efeito (idempotente) e não audita de novo', async () => {
    const { t, ctx } = ctxRota({ etapas: [{ situacao: 'dispensada' }] });
    const r = await rota.executar(ctx as never);
    expect(r).toMatchObject({ situacao: 'dispensada', alterada: false });
    expect(t.comandos.some((s) => s.includes('plataforma.auditoria'))).toBe(false);
  });

  it('RN-CORE-12: a rota exige a ação visita.dispensar_etapa e justificativa de 3 a 300 caracteres', () => {
    expect(rota.acao).toBe('visita.dispensar_etapa');
    expect(rota.corpo!.safeParse({ justificativa: 'ok' }).success).toBe(false);
    expect(rota.corpo!.safeParse({ justificativa: 'x'.repeat(301) }).success).toBe(false);
    expect(rota.corpo!.safeParse({ justificativa: 'Pesquisa cancelada' }).success).toBe(true);
  });
});
